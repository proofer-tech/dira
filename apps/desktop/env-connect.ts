/** 세션용 브리지 연결 파일 (요구 04daa929). 앱이 떠 있는 동안 등록된 프로젝트마다
 *  `<local>/env-bridge/<프로젝트 키>.json`(0600) `{port, token}`을 둔다. 토큰은 그 프로젝트 하나에
 *  묶인 파생값이고 secret은 담지 않는다. `dira env`(dira_env.py)가 읽는다. 앱이 닫히면 지워서
 *  남은 파일이 다른 프로세스에 토큰을 보내지 않게 한다. 계약 정본은 dira_env.py 머리말이다. */
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveToken } from "./env-bridge.ts";
import { resolveProject } from "./env-store.ts";

export async function publishConnections(opts: { local: string; port: number; secret: string }): Promise<string[]> {
  const dir = join(opts.local, "env-bridge");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  let roots: string[] = [];
  try {
    const reg = JSON.parse(readFileSync(join(opts.local, "gui-projects.json"), "utf8"));
    roots = (reg.projects ?? []).map((p: { root?: unknown }) => p.root).filter((r: unknown) => typeof r === "string");
  } catch {
    // 레지스트리가 없거나 깨졌으면 파일을 두지 않는다 - 세션은 unavailable로 끝난다.
  }
  const keys = new Set<string>();
  for (const r of roots) {
    const p = await resolveProject(r).catch(() => null);
    if (!p || keys.has(p.key)) continue;
    keys.add(p.key);
    const f = join(dir, `${p.key}.json`);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ port: opts.port, token: deriveToken(opts.secret, p.key) }), { mode: 0o600 });
    renameSync(tmp, f);
  }
  for (const f of readdirSync(dir)) if (f.endsWith(".json") && !keys.has(f.slice(0, -5))) rmSync(join(dir, f), { force: true });
  return [...keys];
}

export function unpublishConnections(local: string) {
  const dir = join(local, "env-bridge");
  try {
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f), { force: true });
  } catch {
    // 디렉터리가 없으면 지울 것도 없다.
  }
}
