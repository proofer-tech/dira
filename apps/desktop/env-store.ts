/** 프로젝트 환경변수 저장소 (DESIGN.md §프로젝트 환경변수, 요구 04daa929). 값은 Electron
 *  `safeStorage`로 암호화한 암호문만 디스크에 닿는다. 이 파일은 electron을 import하지 않는다 -
 *  암호화기는 주입받아서 단위 테스트가 가짜 암호화기로 돈다. 로그를 남기지 않고, 오류 메시지에도
 *  값을 싣지 않는다. */
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/** Electron `safeStorage`의 쓰는 부분. 앱 어댑터가 `isEncryptionAvailable`에 백엔드 판정까지 담는다. */
export type Cipher = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
};

export type EnvErrorCode =
  | "invalid_name"
  | "reserved_name"
  | "invalid_value"
  | "too_large"
  | "duplicate"
  | "not_found"
  | "conflict"
  | "locked"
  | "corrupt"
  | "io"
  | "bad_project"
  | "unauthorized";

export class EnvError extends Error {
  code: EnvErrorCode;
  constructor(code: EnvErrorCode, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export type EnvMeta = { name: string; updatedAt: string; revision: string };
type Entry = EnvMeta & { cipher: string };
type FileBody = { version: 1; root: string; seq: number; entries: Entry[] };

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_VALUE_BYTES = 64 * 1024;
const RESERVED_RE = /^(PATH|HOME|SHELL|ENV|BASH_ENV|NODE_OPTIONS|PYTHONPATH|LD_.*|DYLD_.*|TICKET_.*|DIRA_.*)$/;

/** 프로젝트 식별 - 티켓 루트(`.dira` 디렉터리)의 실경로 sha256. 워크트리의 `.dira`는 큐를 가리키는
 *  심링크라 같은 큐의 워크트리는 같은 키가 된다. 절대경로가 아니거나 실재하지 않는 디렉터리는 거부한다. */
export async function resolveProject(root: unknown): Promise<{ root: string; key: string }> {
  if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0")) throw new EnvError("bad_project");
  let real: string;
  try {
    real = (await realpath(root)).normalize("NFC");
    if (!(await stat(real)).isDirectory()) throw new Error("not a dir");
  } catch {
    throw new EnvError("bad_project");
  }
  return { root: real, key: createHash("sha256").update(real).digest("hex").slice(0, 32) };
}

/** 가져올 수 없는 이름의 사유. 가져올 수 있으면 null. */
export function nameProblem(name: string): "invalid_name" | "reserved_name" | "vercel_system" | null {
  if (!NAME_RE.test(name)) return "invalid_name";
  if (name.startsWith("VERCEL_")) return "vercel_system";
  return RESERVED_RE.test(name) ? "reserved_name" : null;
}

function validateName(name: unknown): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new EnvError("invalid_name");
  if (RESERVED_RE.test(name)) throw new EnvError("reserved_name");
}

function validateValue(value: unknown): void {
  if (typeof value !== "string" || value.includes("\0")) throw new EnvError("invalid_value");
  if (typeof value.isWellFormed === "function" && !value.isWellFormed()) throw new EnvError("invalid_value");
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) throw new EnvError("too_large");
}

const meta = ({ name, updatedAt, revision }: Entry): EnvMeta => ({ name, updatedAt, revision });

export function createEnvStore(opts: { dir: string; cipher: Cipher; now?: () => Date }) {
  const now = opts.now ?? (() => new Date());
  const locks = new Map<string, Promise<unknown>>();

  /** 프로젝트별 쓰기 직렬화 - 같은 키의 연산은 앞 연산이 끝난 뒤 읽기부터 시작한다. */
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    locks.set(key, run.catch(() => undefined));
    return run;
  }

  const file = (key: string) => path.join(opts.dir, `${key}.json`);

  async function ensureDir() {
    await mkdir(opts.dir, { recursive: true, mode: 0o700 });
    await chmod(opts.dir, 0o700);
  }

  async function load(key: string, root: string): Promise<FileBody> {
    let text: string;
    try {
      text = await readFile(file(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, root, seq: 0, entries: [] };
      throw new EnvError("io");
    }
    try {
      const b = JSON.parse(text) as FileBody;
      if (b.version !== 1 || !Array.isArray(b.entries) || typeof b.seq !== "number") throw new Error("shape");
      for (const e of b.entries) {
        if (!NAME_RE.test(e.name) || typeof e.cipher !== "string" || typeof e.revision !== "string") throw new Error("shape");
      }
      return b;
    } catch {
      throw new EnvError("corrupt"); // 덮어쓰지 않는다 - 사람이 파일을 보고 판단한다
    }
  }

  /** 임시 파일(O_EXCL, 0600) -> fsync -> rename. 어느 단계가 실패해도 기존 파일은 그대로다. */
  async function save(key: string, body: FileBody) {
    try {
      await ensureDir();
      const tmp = path.join(opts.dir, `.${key}.${randomBytes(6).toString("hex")}.tmp`);
      const fh = await open(tmp, "wx", 0o600);
      try {
        await fh.writeFile(JSON.stringify(body));
        await fh.sync();
      } finally {
        await fh.close();
      }
      try {
        await rename(tmp, file(key));
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      await chmod(file(key), 0o600);
    } catch {
      throw new EnvError("io");
    }
  }

  function requireCipher() {
    if (!opts.cipher.isEncryptionAvailable()) throw new EnvError("locked");
  }

  function encrypt(value: string): string {
    try {
      return opts.cipher.encryptString(value).toString("base64");
    } catch {
      throw new EnvError("locked");
    }
  }

  async function mutate(
    rootIn: unknown,
    fn: (b: FileBody) => EnvMeta | null,
  ): Promise<EnvMeta | null> {
    const p = await resolveProject(rootIn);
    return serial(p.key, async () => {
      requireCipher();
      const b = await load(p.key, p.root);
      b.root = p.root;
      const r = fn(b);
      await save(p.key, b);
      return r;
    });
  }

  const stamp = (b: FileBody) => ({ updatedAt: now().toISOString(), revision: String(++b.seq) });

  return {
    async list(rootIn: unknown): Promise<EnvMeta[]> {
      const p = await resolveProject(rootIn);
      return serial(p.key, async () => {
        requireCipher();
        return (await load(p.key, p.root)).entries.map(meta).sort((a, b) => a.name.localeCompare(b.name));
      });
    },

    async create(rootIn: unknown, name: unknown, value: unknown): Promise<EnvMeta> {
      validateName(name);
      validateValue(value);
      return (await mutate(rootIn, (b) => {
        if (b.entries.some((e) => e.name === name)) throw new EnvError("duplicate");
        const e: Entry = { name, cipher: encrypt(value), ...stamp(b) };
        b.entries.push(e);
        return meta(e);
      }))!;
    },

    async replace(rootIn: unknown, name: unknown, value: unknown, expectedRevision: unknown): Promise<EnvMeta> {
      validateName(name);
      validateValue(value);
      return (await mutate(rootIn, (b) => {
        const e = b.entries.find((x) => x.name === name);
        if (!e) throw new EnvError("not_found");
        if (e.revision !== expectedRevision) throw new EnvError("conflict");
        Object.assign(e, { cipher: encrypt(value), ...stamp(b) });
        return meta(e);
      }))!;
    },

    async delete(rootIn: unknown, name: unknown, expectedRevision: unknown): Promise<EnvMeta> {
      validateName(name);
      return (await mutate(rootIn, (b) => {
        const i = b.entries.findIndex((x) => x.name === name);
        if (i < 0) throw new EnvError("not_found");
        if (b.entries[i].revision !== expectedRevision) throw new EnvError("conflict");
        const [gone] = b.entries.splice(i, 1);
        b.seq++; // 같은 이름을 다시 만들어도 옛 revision이 일치하지 않는다
        return meta(gone);
      }))!;
    },

    /** **내부 실행 전용** - `run`이 선택한 이름의 값을 메모리로 복호화한다. 브리지의 HTTP 경로에
     *  연결하지 않는다. 하나라도 없으면 아무것도 돌려주지 않고 `not_found`다(자식을 시작하지 않는다). */
    async resolveForRun(rootIn: unknown, names: string[]): Promise<Record<string, string>> {
      const p = await resolveProject(rootIn);
      return serial(p.key, async () => {
        requireCipher();
        const b = await load(p.key, p.root);
        const out: Record<string, string> = {};
        for (const n of names) {
          validateName(n);
          const e = b.entries.find((x) => x.name === n);
          if (!e) throw new EnvError("not_found", n);
          try {
            out[n] = opts.cipher.decryptString(Buffer.from(e.cipher, "base64"));
          } catch {
            throw new EnvError("corrupt");
          }
        }
        return out;
      });
    },
  };
}

export type EnvStore = ReturnType<typeof createEnvStore>;
