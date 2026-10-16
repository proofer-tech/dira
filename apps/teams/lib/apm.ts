/** 페르소나 - 스쿼드 화면의 읽기 쓰기 위치 (DESIGN.md P506 "엔진 - 주입 경로" 마지막 항목).
 *
 *  `dira-team/apm.yml`이 있는 프로젝트에서는 PROFILE.md - skills.md - members - rules 가
 *  `dira_apm.py resolve`가 준 디렉터리에 있다. 판정은 엔진 것을 그대로 부르고 TS에 복제하지 않는다.
 *  없으면(rc 3 포함) 지금 위치(`.dira/personas`, `.dira/squads`)를 그대로 쓴다. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { childEnv } from "./child-env.ts";
import { NAME_RE } from "./paths.ts";
import { readSquadMembers, readSquadRules, type Persona, type Squad } from "./projects.ts";
import type { Ticket } from "./queue.ts";

export type ApmKind = "persona" | "squad";

/** `base/name`이 파일을 읽고 쓰는 패키지 디렉터리다(기존 `(dir, name)` 함수에 그대로 넘긴다).
 *  `shared`면 `apm_modules` 안 패키지라 쓰기를 막는다. */
export type Home = { base: string; name: string; shared: boolean };

/** 프로젝트 저장소 루트 = 큐(`.dira`)의 부모. */
export const repoOf = (queueRoot: string) => path.dirname(queueRoot);
const teamOf = (queueRoot: string) => path.join(repoOf(queueRoot), "dira-team");

export const hasTeam = (queueRoot: string) => existsSync(path.join(teamOf(queueRoot), "apm.yml"));

function enginePy(): string | null {
  const raw = process.env.DIRA_ENGINE?.trim();
  const repo = raw && path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), "..", "..");
  const py = path.join(repo, "dira_apm.py");
  return existsSync(py) ? py : null;
}

const runPy = (py: string, args: string[]) =>
  new Promise<{ rc: number; out: string }>((resolve) => {
    execFile("python3", [py, ...args], { env: childEnv(), timeout: 120_000 }, (err, stdout) => {
      resolve({ rc: err ? (typeof err.code === "number" ? err.code : 2) : 0, out: stdout.toString().trim() });
    });
  });

/** `resolve`가 준 디렉터리. 새 체계가 아니거나 패키지가 없으면 `fallbackBase/<name>`(지금 위치). */
export async function resolveHome(
  queueRoot: string,
  kind: ApmKind,
  name: string,
  fallbackBase: string,
): Promise<Home> {
  const old: Home = { base: fallbackBase, name, shared: false };
  const py = enginePy();
  if (!NAME_RE.test(name) || !py || !hasTeam(queueRoot)) return old;
  // ponytail: 이름마다 python을 한 번 띄운다. 페르소나가 수십 개가 되면 resolve에 --all
  const { rc, out } = await runPy(py, ["resolve", repoOf(queueRoot), kind, name]);
  if (rc !== 0 || !out) return old;
  return { base: path.dirname(out), name: path.basename(out), shared: out.split(path.sep).includes("apm_modules") };
}

/** 화면에 올릴 이름: 로컬 패키지 디렉터리 + 설치된 `<kind>-<이름>` 공용 패키지. */
export async function packageNames(queueRoot: string, kind: ApmKind): Promise<string[]> {
  if (!hasTeam(queueRoot)) return [];
  const team = teamOf(queueRoot);
  const out = new Set<string>();
  for (const e of await readdir(path.join(team, `${kind}s`), { withFileTypes: true }).catch(() => []))
    if (e.isDirectory() && NAME_RE.test(e.name)) out.add(e.name);
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name === ".git" || e.name === "node_modules") continue;
      const sub = path.join(dir, e.name);
      if (existsSync(path.join(sub, "apm.yml"))) {
        const n = e.name.startsWith(`${kind}-`) ? e.name.slice(kind.length + 1) : "";
        if (NAME_RE.test(n)) out.add(n);
      } else if (depth < 5) await walk(sub, depth + 1);
    }
  };
  await walk(path.join(team, "apm_modules"), 0);
  return [...out].sort();
}

/** 공용 패키지를 `dira-team/<kind>s/<이름>/`로 옮기고 `dira-team/apm.yml` 의존성을 `./<kind>s/<이름>`으로
 *  바꾼 뒤 install 한다. 이미 로컬이 있으면 거절한다(덮지 않는다). */
export async function copyToLocal(queueRoot: string, kind: ApmKind, name: string): Promise<void> {
  const py = enginePy();
  if (!py) throw new Error("dira_apm.py 없음");
  const home = await resolveHome(queueRoot, kind, name, "");
  if (!home.shared) throw new Error("공용 패키지가 아닙니다: " + name);
  const team = teamOf(queueRoot);
  const dest = path.join(team, `${kind}s`, name);
  if (existsSync(dest)) throw new Error("이미 로컬 패키지가 있습니다: " + name);
  const src = path.join(home.base, home.name);
  await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  const ymlPath = path.join(team, "apm.yml");
  const lines = (await readFile(ymlPath, "utf8")).split("\n");
  const local = `./${kind}s/${name}`;
  const rel = path.relative(path.join(team, "apm_modules"), src).split(path.sep).join("/");
  let hit = false;
  const next = lines.map((l) => {
    const m = /^(\s+-\s+)(['"]?)([^\s'"]+)\2\s*$/.exec(l);
    if (!hit && m && m[3].split("#")[0] === rel) {
      hit = true;
      return `${m[1]}${local}`;
    }
    return l;
  });
  if (!hit) {
    // 간접 의존성이면 직접 의존성으로 올린다 — `apm:` 목록 끝에 붙인다.
    const i = next.findIndex((l) => /^\s+apm:\s*$/.test(l));
    if (i < 0) throw new Error("dira-team/apm.yml에 dependencies.apm 목록이 없습니다");
    let j = i + 1;
    while (j < next.length && /^\s+-\s/.test(next[j])) j++;
    next.splice(j, 0, `    - ${local}`);
  }
  await writeFile(ymlPath, next.join("\n"), "utf8");
  const r = await runPy(py, ["install", repoOf(queueRoot), "--no-frozen"]);
  if (r.rc !== 0) throw new Error("apm install 실패 rc " + r.rc);
}

export type PersonaView = Persona & { shared: boolean };
export type SquadView = Squad & { shared: boolean };

/** 목록의 PROFILE.md 본문을 `resolve` 위치로 바꾸고, 패키지로만 있는 이름을 더한다.
 *  `file`은 그대로 둔다 - 메모리 경로 표시가 그것을 쓰고 memory/는 옛 자리에 남는다.
 *  `homes`는 이어서 skills.md를 읽는 데 쓴다. */
export async function overlayPersonas(
  queueRoot: string,
  base: string,
  personas: Persona[],
  tickets: Ticket[],
): Promise<{ personas: PersonaView[]; homes: Map<string, Home> }> {
  const have = new Set(personas.map((p) => p.name));
  const extra: Persona[] = (await packageNames(queueRoot, "persona"))
    .filter((n) => !have.has(n))
    .map((name) => {
      const refs = tickets.filter((t) => t.persona === name);
      return {
        name,
        file: path.join(base, name, "PROFILE.md"),
        body: null,
        refs: {
          open: refs.filter((t) => t.state === "open").length,
          wip: refs.filter((t) => t.state === "wip").length,
          total: refs.length,
        },
      };
    });
  const all = [...personas, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  const homes = new Map<string, Home>();
  const views = await Promise.all(
    all.map(async (p) => {
      const home = await resolveHome(queueRoot, "persona", p.name, base);
      homes.set(p.name, home);
      if (!hasTeam(queueRoot)) return { ...p, shared: false };
      const body = await readFile(path.join(home.base, home.name, "PROFILE.md"), "utf8").catch(() => null);
      return { ...p, body, shared: home.shared };
    }),
  );
  return { personas: views, homes };
}

/** 스쿼드 members - rules 를 `resolve` 위치에서 읽는다. 패키지로만 있는 스쿼드도 더한다. */
export async function overlaySquads(queueRoot: string, base: string, squads: Squad[]): Promise<SquadView[]> {
  if (!hasTeam(queueRoot)) return squads.map((s) => ({ ...s, shared: false }));
  const have = new Set(squads.map((s) => s.name));
  const names = [...have, ...(await packageNames(queueRoot, "squad")).filter((n) => !have.has(n))].sort();
  return Promise.all(
    names.map(async (name) => {
      const home = await resolveHome(queueRoot, "squad", name, base);
      return {
        name,
        members: await readSquadMembers(home.base, home.name),
        rules: await readSquadRules(home.base, home.name),
        shared: home.shared,
      };
    }),
  );
}
