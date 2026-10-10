/** dira 환경변수 <-> Vercel production+preview 변수 양방향 동기화 (DESIGN.md §Vercel 환경변수 연동
 *  "동기화 규칙" 1-8항, 요구 6f610c77). 값과 토큰을 로그, 응답, 상태 파일에 싣지 않는다. 키별 상태 파일은
 *  `vercel-sync-<프로젝트키>.json`(0600)이고 revision과 updatedAt 같은 메타만 둔다. development와
 *  브랜치 지정 레코드는 읽지도 쓰지도 않는다. */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EnvError, nameProblem, resolveProject, type EnvMeta, type EnvStore } from "./env-store.ts";
import type { createVercelLink } from "./vercel-link.ts";

type Link = ReturnType<typeof createVercelLink>;
type Rec = { id: string; key: string; type: string; target?: string[] | string; gitBranch?: string | null; updatedAt?: number; createdAt?: number; value?: string };
type Side = "dira" | "vercel";
type KeyState = {
  linked: boolean;
  /** 마지막 동기화 때 dira revision과 Vercel updatedAt(ms). */
  dira: string | null;
  vercel: number | null;
  pending?: boolean;
  reenter?: boolean;
  note?: { side: Side; until: string };
};
type SyncFile = { version: 1; lastSyncAt: string | null; deployPending: boolean; keys: Record<string, KeyState>; only?: VercelOnly[] };

export type SyncKind = "synced" | "pending" | "conflict" | "reenter";
export type SyncInfo = { kind: SyncKind; side?: Side; until?: string };
export type VercelOnly = { name: string; kind: "vercel_only" | "skipped"; reason?: string };
export type SyncResult =
  | { ok: true; lastSyncAt: string; deployPending: boolean }
  | { ok: false; error: "login_required" | "unlinked" | "io" | "locked" };

const RELEVANT = ["production", "preview"];
const NOTE_MS = 24 * 3600 * 1000;
const targets = (r: Rec) => (Array.isArray(r.target) ? r.target : r.target ? [r.target] : []);
const relevant = (r: Rec) => !r.gitBranch && targets(r).some((t) => RELEVANT.includes(t));
const stampOf = (r: Rec) => r.updatedAt ?? r.createdAt ?? 0;

export function createVercelSync(opts: { dir: string; store: EnvStore; link: Link; now?: () => Date }) {
  const now = opts.now ?? (() => new Date());
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
    chains.set(key, run.catch(() => undefined));
    return run;
  };

  async function load(key: string): Promise<SyncFile> {
    try {
      const b = JSON.parse(await readFile(path.join(opts.dir, `vercel-sync-${key}.json`), "utf8"));
      if (b?.version === 1 && b.keys && typeof b.keys === "object") return b;
    } catch {
      // 없거나 깨졌으면 처음 만나는 것으로 본다 - 값이 아니라 메타뿐이라 잃어도 다음 동기화가 다시 만든다.
    }
    return { version: 1, lastSyncAt: null, deployPending: false, keys: {} };
  }
  async function save(key: string, b: SyncFile) {
    await mkdir(opts.dir, { recursive: true, mode: 0o700 });
    const f = path.join(opts.dir, `vercel-sync-${key}.json`);
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(b), { mode: 0o600 });
    await rename(tmp, f);
  }

  type Ctx = { token: string; projectId: string; q: Record<string, string> };
  const req = (c: Ctx, method: string, p: string, body?: unknown, q: Record<string, string> = {}) =>
    opts.link.request(c.token, p, { ...c.q, ...q }, method === "GET" ? undefined : { method, body: body ?? {} });

  async function listRecs(c: Ctx): Promise<Map<string, Rec[]>> {
    const r = (await req(c, "GET", `/v10/projects/${encodeURIComponent(c.projectId)}/env`)) as { envs?: Rec[] };
    const m = new Map<string, Rec[]>();
    for (const e of r.envs ?? []) if (relevant(e)) m.set(e.key, [...(m.get(e.key) ?? []), e]);
    return m;
  }
  const chosen = (rs: Rec[]) => rs.find((r) => targets(r).includes("production")) ?? rs[0];
  const readable = (rs: Rec[]) => ["plain", "encrypted"].includes(chosen(rs).type);
  const vstamp = (rs: Rec[]) => Math.max(...rs.map(stampOf));

  async function readValue(c: Ctx, r: Rec): Promise<string> {
    if (typeof r.value === "string" && r.type === "plain") return r.value;
    const x = (await req(c, "GET", `/v1/projects/${encodeURIComponent(c.projectId)}/env/${encodeURIComponent(r.id)}`)) as { value?: string };
    if (typeof x.value !== "string") throw new EnvError("io");
    return x.value;
  }

  /** development를 함께 가진 레코드는 development만 남기고 떼어 낸다. 나머지는 지운다. */
  async function detach(c: Ctx, rs: Rec[]) {
    for (const r of rs) {
      if (targets(r).includes("development")) await req(c, "PATCH", `/v9/projects/${encodeURIComponent(c.projectId)}/env/${encodeURIComponent(r.id)}`, { target: ["development"] });
      else await req(c, "DELETE", `/v9/projects/${encodeURIComponent(c.projectId)}/env/${encodeURIComponent(r.id)}`);
    }
  }

  /** production+preview를 덮는 sensitive 레코드로 맞춘다. */
  async function upsert(c: Ctx, name: string, value: string, rs: Rec[]) {
    const covered = new Set<string>();
    for (const r of rs) {
      if (targets(r).includes("development")) {
        await detach(c, [r]);
        continue;
      }
      await req(c, "PATCH", `/v9/projects/${encodeURIComponent(c.projectId)}/env/${encodeURIComponent(r.id)}`, { value, type: "sensitive" });
      for (const t of targets(r)) covered.add(t);
    }
    const missing = RELEVANT.filter((t) => !covered.has(t));
    if (missing.length) {
      await req(c, "POST", `/v10/projects/${encodeURIComponent(c.projectId)}/env`, { key: name, value, type: "sensitive", target: missing }, { upsert: "true" });
    }
  }

  const plain = async (root: string, name: string) => (await opts.store.resolveForRun(root, [name]))[name];

  async function runSync(root: string, key: string): Promise<SyncResult> {
    const s = await opts.link.session(root);
    if (!("token" in s)) return { ok: false, error: s.state };
    const c: Ctx = { token: s.token, projectId: s.project.projectId, q: s.project.teamId ? { teamId: s.project.teamId } : {} };
    try {
      const st = await load(key);
      const vm = await listRecs(c);
      const dm = new Map((await opts.store.list(root)).map((m) => [m.name, m]));
      const keys: Record<string, KeyState> = {};
      let changed = false;
      const only: VercelOnly[] = [];
      const names = new Set([...dm.keys(), ...vm.keys(), ...Object.keys(st.keys)]);

      for (const name of names) {
        const d = dm.get(name), v = vm.get(name), prev = st.keys[name];
        const mark = (k: Partial<KeyState> & { linked: boolean }) => {
          keys[name] = { dira: null, vercel: null, ...k };
        };
        const push = async () => {
          await upsert(c, name, await plain(root, name), v ?? []);
          changed = true;
        };
        const fresh = async () => {
          // 방금 쓴 뒤의 updatedAt을 다시 읽어 기억한다.
          const rs = (await listRecs(c)).get(name);
          return rs ? vstamp(rs) : null;
        };
        const note = (side: Side) => ({ side, until: new Date(now().getTime() + NOTE_MS).toISOString() });
        const keepNote = prev?.note && prev.note.until > now().toISOString() ? prev.note : undefined;
        try {
          if (d && !v) {
            if (prev?.linked && prev.dira === d.revision && !prev.pending) {
              // Vercel에서 지워졌다 - 연결된 키는 dira에서도 지운다(5항).
              await opts.store.delete(root, name, d.revision);
              continue;
            }
            await push();
            mark({ linked: true, dira: d.revision, vercel: await fresh() });
          } else if (!d && v) {
            if (prev?.linked) {
              await detach(c, v); // dira에서 지워졌다 - 연결된 키는 Vercel에서도 지운다.
              changed = true;
              continue;
            }
            const problem = nameProblem(name);
            if (problem || !readable(v)) {
              only.push(problem ? { name, kind: "skipped", reason: problem } : { name, kind: "vercel_only" });
              continue;
            }
            const val = await readValue(c, chosen(v));
            const m = await opts.store.create(root, name, val);
            mark({ linked: true, dira: m.revision, vercel: vstamp(v) });
          } else if (d && v) {
            const vs = vstamp(v);
            if (!prev?.linked) {
              if (!readable(v)) {
                mark({ linked: true, dira: d.revision, vercel: vs }); // 값을 비교할 수 없다 - 건드리지 않고 연결만 한다.
              } else {
                const vval = await readValue(c, chosen(v));
                if (vval === (await plain(root, name))) mark({ linked: true, dira: d.revision, vercel: vs });
                else if (Date.parse(d.updatedAt) >= vs) {
                  await push();
                  mark({ linked: true, dira: d.revision, vercel: await fresh(), note: note("dira") });
                } else {
                  const m = await opts.store.replace(root, name, vval, d.revision);
                  mark({ linked: true, dira: m.revision, vercel: vs, note: note("vercel") });
                }
              }
              continue;
            }
            const dChanged = prev.dira !== d.revision || !!prev.pending;
            const vChanged = prev.vercel !== vs;
            if (!dChanged && !vChanged) mark({ ...prev, note: keepNote });
            else if (dChanged && !vChanged) {
              await push();
              mark({ linked: true, dira: d.revision, vercel: await fresh(), note: keepNote });
            } else if (!dChanged && vChanged) {
              if (readable(v)) {
                const m = await opts.store.replace(root, name, await readValue(c, chosen(v)), d.revision);
                mark({ linked: true, dira: m.revision, vercel: vs, note: keepNote });
              } else mark({ linked: true, dira: d.revision, vercel: vs, reenter: true, note: keepNote });
            } else {
              // 양쪽이 다 바뀌었다 - 더 늦게 바뀐 쪽을 따른다.
              if (Date.parse(d.updatedAt) >= vs) {
                await push();
                mark({ linked: true, dira: d.revision, vercel: await fresh(), note: note("dira") });
              } else if (readable(v)) {
                const m = await opts.store.replace(root, name, await readValue(c, chosen(v)), d.revision);
                mark({ linked: true, dira: m.revision, vercel: vs, note: note("vercel") });
              } else mark({ linked: true, dira: d.revision, vercel: vs, reenter: true, note: note("vercel") });
            }
          }
          // 어느 쪽에도 없으면 상태도 버린다.
        } catch (e) {
          if (e instanceof EnvError && (e.code === "locked" || e.code === "unauthorized")) throw e;
          // 이 키만 다음 동기화로 미룬다.
          if (d) keys[name] = { ...(prev ?? { linked: false, dira: null, vercel: null }), pending: true };
          else if (prev) keys[name] = prev;
        }
      }
      const out: SyncFile = {
        version: 1,
        lastSyncAt: now().toISOString(),
        deployPending: st.deployPending || changed,
        keys,
        only,
      };
      await save(key, out);
      return { ok: true, lastSyncAt: out.lastSyncAt!, deployPending: out.deployPending };
    } catch (e) {
      const code = e instanceof EnvError ? e.code : "io";
      return { ok: false, error: code === "unauthorized" ? "login_required" : code === "locked" ? "locked" : "io" };
    }
  }

  /** dira 쓰기 직후 한 키만 반영한다. 실패하면 그 키를 반영 대기로 남긴다. */
  async function afterWrite(root: string, name: string, deleted: boolean) {
    const { key } = await resolveProject(root);
    await serial(key, async () => {
      const st = await load(key);
      const prev = st.keys[name];
      const s = await opts.link.session(root).catch(() => null);
      const linkedRoot = s && "token" in s ? s : null;
      if (!linkedRoot) {
        // 연결 안 됨 - 연결되지 않은 프로젝트는 상태를 만들지 않는다. 로그인만 필요한 경우 다음 동기화가 맞춘다.
        if (prev?.linked && !deleted) st.keys[name] = { ...prev, pending: true };
        else if (!deleted && (await opts.link.status(root)).state === "connected") st.keys[name] = { linked: false, dira: null, vercel: null, pending: true };
        await save(key, st);
        return;
      }
      const c: Ctx = { token: linkedRoot.token, projectId: linkedRoot.project.projectId, q: linkedRoot.project.teamId ? { teamId: linkedRoot.project.teamId } : {} };
      try {
        const rs = (await listRecs(c)).get(name) ?? [];
        if (deleted) {
          if (prev?.linked) await detach(c, rs);
          delete st.keys[name];
          if (prev?.linked) st.deployPending = true;
        } else {
          const m = (await opts.store.list(root)).find((x) => x.name === name);
          await upsert(c, name, await plain(root, name), rs);
          const after = (await listRecs(c)).get(name);
          st.keys[name] = { linked: true, dira: m?.revision ?? null, vercel: after ? vstamp(after) : null };
          st.deployPending = true;
        }
      } catch {
        if (deleted) {
          if (prev) st.keys[name] = prev; // 지움 전파는 다음 동기화가 이어받는다(dira에 없고 연결된 키).
        } else st.keys[name] = { ...(prev ?? { linked: false, dira: null, vercel: null }), pending: true };
      }
      await save(key, st);
    });
  }

  async function info(root: string): Promise<{ items: (EnvMeta & { sync?: SyncInfo })[]; vercelOnly?: VercelOnly[]; vercel?: { lastSyncAt: string | null; deployPending: boolean } }> {
    const items = await opts.store.list(root);
    const { key } = await resolveProject(root);
    if ((await opts.link.status(root)).state !== "connected") return { items };
    const st = await load(key);
    const t = now().toISOString();
    const out = items.map((m) => {
      const k = st.keys[m.name];
      let sync: SyncInfo;
      if (!k || k.pending || !k.linked) sync = { kind: "pending" };
      else if (k.reenter) sync = { kind: "reenter" };
      else if (k.note && k.note.until > t) sync = { kind: "conflict", side: k.note.side, until: k.note.until };
      else sync = { kind: "synced" };
      return { ...m, sync };
    });
    const have = new Set(items.map((m) => m.name));
    const vercelOnly = (st.only ?? []).filter((o) => !have.has(o.name));
    return { items: out, vercelOnly, vercel: { lastSyncAt: st.lastSyncAt, deployPending: st.deployPending } };
  }

  return {
    sync: async (root: string): Promise<SyncResult> => {
      const { root: real, key } = await resolveProject(root);
      return serial(key, () => runSync(real, key));
    },
    afterWrite,
    info,
  };
}
