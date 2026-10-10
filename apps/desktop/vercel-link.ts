/** Vercel 인증과 프로젝트 자동 연결 (DESIGN.md §Vercel 환경변수 연동 "연결" 1-3항, 요구 6f610c77).
 *  electron을 import하지 않는다 - 암호화기와 API 주소는 주입받는다. 토큰은 로그, 오류, 응답, 상태
 *  파일에 싣지 않는다. 인증은 (a) Vercel CLI 로그인 파일을 호출할 때마다 읽고 (b) 그것이 없거나
 *  Vercel이 거절하면 붙여넣어 safeStorage로 보관한 토큰을 쓴다. 상태 파일에는 팀 ID, 프로젝트 ID,
 *  이름, 발견 경로만 둔다. */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { EnvError, resolveProject, type Cipher } from "./env-store.ts";

export type VercelProject = { teamId: string | null; projectId: string; name: string };
export type VercelLinkState = VercelProject & { version: 1; path: string; connectedAt: string };
export type VercelStatus =
  | { state: "login_required" }
  | { state: "unlinked"; source: "cli" | "token" }
  | { state: "connected"; source: "cli" | "token"; project: VercelLinkState };
export type VercelConnectResult =
  | { state: "connected"; source: "cli" | "token"; project: VercelLinkState }
  | { state: "choose"; source: "cli" | "token"; candidates: VercelProject[] }
  | { state: "login_required" };

const SKIP = new Set(["node_modules", ".git", ".dira", "worktrees"]);
const MAX_DEPTH = 3;

export function defaultAuthPaths(): string[] {
  return [
    path.join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    path.join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
  ];
}

/** git origin URL -> "owner/repo"(소문자). ssh와 https 형태를 모두 받는다. */
export function normalizeOrigin(url: string): string | null {
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export function createVercelLink(opts: {
  dir: string;
  cipher: Cipher;
  api?: string;
  authPaths?: string[];
  now?: () => Date;
  /** 테스트가 git을 부르지 않게 바꾼다. 기본은 `git remote get-url origin`. */
  origin?: (cwd: string) => Promise<string | null>;
}) {
  const api = opts.api ?? "https://api.vercel.com";
  const authPaths = opts.authPaths ?? defaultAuthPaths();
  const now = opts.now ?? (() => new Date());
  const tokenFile = path.join(opts.dir, "vercel-token.enc");
  const origin =
    opts.origin ??
    ((cwd) =>
      new Promise<string | null>((res) =>
        execFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: 5000 }, (e, out) => res(e ? null : out.trim() || null)),
      ));

  async function cliToken(): Promise<string | null> {
    for (const p of authPaths) {
      try {
        const t = JSON.parse(await readFile(p, "utf8"))?.token;
        if (typeof t === "string" && t) return t;
      } catch {
        // 파일이 없거나 깨졌으면 다음 후보로 간다.
      }
    }
    return null;
  }
  async function pastedToken(): Promise<string | null> {
    try {
      if (!opts.cipher.isEncryptionAvailable()) return null;
      return opts.cipher.decryptString(await readFile(tokenFile));
    } catch {
      return null;
    }
  }

  async function call(token: string, p: string, query: Record<string, string> = {}): Promise<unknown> {
    const u = new URL(p, api);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    let r: Response;
    try {
      r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
    } catch {
      throw new EnvError("io", "vercel unreachable");
    }
    if (r.status === 401 || r.status === 403) throw new EnvError("unauthorized");
    if (r.status === 404) throw new EnvError("not_found");
    if (!r.ok) throw new EnvError("io", `vercel ${r.status}`);
    return r.json();
  }

  /** 쓸 수 있는 토큰을 고른다. CLI 토큰을 Vercel이 거절하면 붙여넣은 토큰으로 넘어간다. */
  async function pickAuth(): Promise<{ token: string; source: "cli" | "token" } | null> {
    for (const [source, get] of [["cli", cliToken], ["token", pastedToken]] as const) {
      const token = await get();
      if (!token) continue;
      try {
        await call(token, "/v2/user");
        return { token, source };
      } catch (e) {
        if (!(e instanceof EnvError && e.code === "unauthorized")) throw e;
      }
    }
    return null;
  }

  const stateFile = async (root: string) => path.join(opts.dir, `vercel-link-${(await resolveProject(root)).key}.json`);
  async function readState(root: string): Promise<VercelLinkState | null> {
    try {
      const s = JSON.parse(await readFile(await stateFile(root), "utf8"));
      return s?.version === 1 && typeof s.projectId === "string" ? s : null;
    } catch {
      return null;
    }
  }
  async function writeState(root: string, p: VercelProject, found: string): Promise<VercelLinkState> {
    const s: VercelLinkState = { version: 1, ...p, path: found, connectedAt: now().toISOString() };
    const f = await stateFile(root);
    await mkdir(opts.dir, { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await rename(tmp, f);
    return s;
  }

  /** 루트에서 깊이 3까지 `.vercel/project.json`을 너비 우선으로 찾는다. */
  async function findProjectJson(base: string): Promise<{ file: string; projectId: string; orgId: string } | null> {
    let level = [base];
    for (let d = 0; d <= MAX_DEPTH && level.length; d++) {
      const next: string[] = [];
      for (const dir of level) {
        const file = path.join(dir, ".vercel", "project.json");
        try {
          const j = JSON.parse(await readFile(file, "utf8"));
          if (typeof j?.projectId === "string" && typeof j?.orgId === "string") return { file, projectId: j.projectId, orgId: j.orgId };
        } catch {
          // 없거나 깨졌으면 하위로 간다.
        }
        if (d === MAX_DEPTH) continue;
        for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory() && !SKIP.has(e.name) && e.name !== ".vercel") next.push(path.join(dir, e.name));
        }
      }
      level = next;
    }
    return null;
  }

  const teamOf = (orgId: string) => (orgId.startsWith("team_") ? orgId : null);

  async function listCandidates(token: string, repo: string): Promise<VercelProject[]> {
    const scopes: (string | null)[] = [null];
    const teams = (await call(token, "/v2/teams", { limit: "100" })) as { teams?: { id: string }[] };
    for (const t of teams.teams ?? []) scopes.push(t.id);
    const out: VercelProject[] = [];
    for (const teamId of scopes) {
      const r = (await call(token, "/v9/projects", { limit: "100", ...(teamId ? { teamId } : {}) })) as {
        projects?: { id: string; name: string; link?: { org?: string; repo?: string } }[];
      };
      for (const p of r.projects ?? []) {
        const l = p.link;
        if (l?.org && l?.repo && `${l.org}/${l.repo}`.toLowerCase() === repo) out.push({ teamId, projectId: p.id, name: p.name });
      }
    }
    return out;
  }

  return {
    /** 상태 조회 - 네트워크를 쓰지 않는다. 토큰이 있는지와 상태 파일만 본다. */
    async status(root: string): Promise<VercelStatus> {
      const source = (await cliToken()) ? "cli" : (await pastedToken()) ? "token" : null;
      if (!source) return { state: "login_required" };
      const project = await readState(root);
      return project ? { state: "connected", source, project } : { state: "unlinked", source };
    },

    /** 연결 - 묻지 않고 찾는다. `pick`은 후보 목록에서 사용자가 고른 프로젝트 ID다. */
    async connect(root: string, pick?: unknown): Promise<VercelConnectResult> {
      const { root: real } = await resolveProject(root);
      const auth = await pickAuth();
      if (!auth) return { state: "login_required" };
      const base = path.dirname(real);
      const done = async (p: VercelProject, found: string): Promise<VercelConnectResult> => ({
        state: "connected",
        source: auth.source,
        project: await writeState(real, p, found),
      });
      if (pick !== undefined) {
        if (typeof pick !== "string" || !pick) throw new EnvError("bad_project");
        const found = await findCandidateById(auth.token, pick);
        return done(found, "picked");
      }
      const pj = await findProjectJson(base);
      if (pj) {
        const teamId = teamOf(pj.orgId);
        const p = (await call(auth.token, `/v9/projects/${encodeURIComponent(pj.projectId)}`, teamId ? { teamId } : {})) as { id: string; name: string };
        return done({ teamId, projectId: p.id, name: p.name }, path.relative(base, pj.file) || ".vercel/project.json");
      }
      const o = await origin(base);
      const repo = o && normalizeOrigin(o);
      const cands = repo ? await listCandidates(auth.token, repo) : [];
      if (cands.length === 1) return done(cands[0], "origin");
      return { state: "choose", source: auth.source, candidates: cands.length ? cands : await listAll(auth.token) };
    },

    /** 연결 해제 - 상태 파일만 지운다. dira와 Vercel 어느 쪽 변수도 건드리지 않는다. */
    async disconnect(root: string): Promise<{ ok: true }> {
      await rm(await stateFile(root), { force: true });
      return { ok: true };
    },

    /** 붙여넣은 토큰 저장. Vercel이 받아들일 때만 보관한다. `null`이면 보관분을 지운다. */
    async setToken(token: unknown): Promise<{ ok: true }> {
      if (token === null) {
        await rm(tokenFile, { force: true });
        return { ok: true };
      }
      if (typeof token !== "string" || !token.trim() || /\s/.test(token.trim()) || token.length > 4096) throw new EnvError("invalid_value");
      if (!opts.cipher.isEncryptionAvailable()) throw new EnvError("locked");
      const t = token.trim();
      await call(t, "/v2/user"); // 거절되면 unauthorized로 나가고 저장하지 않는다.
      await mkdir(opts.dir, { recursive: true, mode: 0o700 });
      const tmp = `${tokenFile}.${process.pid}.tmp`;
      await writeFile(tmp, opts.cipher.encryptString(t), { mode: 0o600 });
      await rename(tmp, tokenFile);
      return { ok: true };
    },
  };

  /** 선택 목록용 전체 프로젝트. */
  async function listAll(token: string): Promise<VercelProject[]> {
    const scopes: (string | null)[] = [null];
    const teams = (await call(token, "/v2/teams", { limit: "100" })) as { teams?: { id: string }[] };
    for (const t of teams.teams ?? []) scopes.push(t.id);
    const out: VercelProject[] = [];
    for (const teamId of scopes) {
      const r = (await call(token, "/v9/projects", { limit: "100", ...(teamId ? { teamId } : {}) })) as { projects?: { id: string; name: string }[] };
      for (const p of r.projects ?? []) out.push({ teamId, projectId: p.id, name: p.name });
    }
    return out;
  }
  async function findCandidateById(token: string, id: string): Promise<VercelProject> {
    const hit = (await listAll(token)).find((p) => p.projectId === id);
    if (!hit) throw new EnvError("not_found");
    return hit;
  }
}
