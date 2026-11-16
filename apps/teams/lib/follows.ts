/** 티켓 팔로우 (DESIGN.md §P564). 기계 로컬 파일 `follows.json` 하나가 상태다.
 *  티켓 fm은 건드리지 않는다. 도는 `.wip`을 GUI가 고치면 세션 편집과 겹친다.
 *  판정은 여기(서버)가 하고, 알림은 데스크톱 main이 `/api/follows/done`을 물어 띄운다. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";

export type Follow = { project: string; stem: string; at: string };
export type DoneFollow = {
  project: string;
  projectName: string;
  stem: string;
  hash: string;
  title: string;
  continued: string;
};
/** 큐 조회 결과. `null`이면 프로젝트가 레지스트리에 없다(지우지 않고 남긴다).
 *  `tickets`에 그 stem이 없으면 큐에서 사라진 것이다. */
export type FollowLookup = (
  project: string,
) => Promise<{ name: string; tickets: Map<string, { done: boolean; hash: string; title: string; continued: string }> } | null>;

export const followsPath = () => path.join(localDir(), "follows.json");

export async function readFollows(): Promise<Follow[]> {
  let raw: string;
  try {
    raw = await readFile(followsPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("follows.json is not an array");
  return data.filter((f) => f && typeof f.project === "string" && typeof f.stem === "string");
}

// ponytail: 읽고-고치고-쓰는 사이 잠금이 없다. 호출이 사람 클릭과 30초 타이머뿐이라 충돌 창이 좁다.
async function writeFollows(list: Follow[]): Promise<void> {
  const file = followsPath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2) + "\n", { flag: "wx" });
  await rename(tmp, file);
}

export async function isFollowing(project: string, stem: string): Promise<boolean> {
  return (await readFollows()).some((f) => f.project === project && f.stem === stem);
}

/** 켜져 있으면 끄고 꺼져 있으면 켠다. 바뀐 뒤 상태를 돌려준다. */
export async function toggleFollow(project: string, stem: string): Promise<boolean> {
  const list = await readFollows();
  const rest = list.filter((f) => !(f.project === project && f.stem === stem));
  const on = rest.length === list.length;
  if (on) rest.push({ project, stem, at: new Date().toISOString() });
  await writeFollows(rest);
  return on;
}

/** 없는 항목이어도 조용히 끝난다(쓰기도 안 한다). */
export async function ackFollow(project: string, stem: string): Promise<void> {
  const list = await readFollows();
  const rest = list.filter((f) => !(f.project === project && f.stem === stem));
  if (rest.length !== list.length) await writeFollows(rest);
}

/** 팔로우 중이면서 `.done`인 것만 돌려주고, 큐에서 사라진 항목은 목록에서 지운다. */
export async function doneFollows(lookup: FollowLookup): Promise<DoneFollow[]> {
  const list = await readFollows();
  const cache = new Map<string, Awaited<ReturnType<FollowLookup>>>();
  const keep: Follow[] = [];
  const out: DoneFollow[] = [];
  for (const f of list) {
    if (!cache.has(f.project)) cache.set(f.project, await lookup(f.project));
    const q = cache.get(f.project);
    if (!q) {
      keep.push(f);
      continue;
    }
    const t = q.tickets.get(f.stem);
    if (!t) continue;
    keep.push(f);
    if (t.done) {
      out.push({ project: f.project, projectName: q.name, stem: f.stem, hash: t.hash, title: t.title, continued: t.continued });
    }
  }
  if (keep.length !== list.length) await writeFollows(keep);
  return out;
}
