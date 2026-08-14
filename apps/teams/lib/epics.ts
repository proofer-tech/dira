/** 에픽 읽기 층 — 사이드바·스윔레인·에픽 화면이 같이 쓴다(제품 스펙 §에픽 결정 1·2·5).
 *
 *  에픽 목록의 정본은 큐(티켓 `epic:` 값)다 — 이 파일은 스펙 문서를 읽지 않는다(§검증 (4)).
 *  dira는 아무 프로젝트에나 붙는 GUI라 스펙 문서를 파싱하면 dira 전용 기능이 된다. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "./paths.ts";
import { epicOf, type Ticket, type TicketState } from "./queue.ts";

/** `epic:` 없는 티켓이 모이는 자리(결정 1·5). 값이 아니라 GUI가 붙이는 라벨이다. */
export const NO_EPIC = "(에픽 없음)";

export type EpicCounts = Record<TicketState, number>;
export type Epic = { epic: string; counts: EpicCounts };

/** 큐 티켓을 `epic:` 값으로 묶는다. 정렬은 P번호 문자열, `(에픽 없음)`이 맨 뒤(결정 5).
 *  건수는 `queue.ts`의 기존 `state` 판정을 그대로 쓴다 — 새 상태 판정을 안 만든다. */
export function listEpics(tickets: Ticket[]): Epic[] {
  const byEpic = new Map<string, EpicCounts>();
  for (const t of tickets) {
    const key = epicOf(t) || NO_EPIC;
    const counts = byEpic.get(key) ?? { open: 0, wip: 0, done: 0 };
    counts[t.state]++;
    byEpic.set(key, counts);
  }
  return [...byEpic.entries()]
    .sort(([a], [b]) => (a === NO_EPIC ? 1 : b === NO_EPIC ? -1 : a.localeCompare(b)))
    .map(([epic, counts]) => ({ epic, counts }));
}

/** `epic` 값은 URL에서 온다 — `../`가 큐(`root`) 밖으로 못 나간다(§경로 방어).
 *  벗어나면 null(존재하지 않는 것과 같게 떨어진다 — 던지지 않는다: 이 값은 필터·표시용이지
 *  이 경로에 쓰기가 걸리지 않는다). */
async function epicDir(root: string, epic: string): Promise<string | null> {
  try {
    return await resolveWithin(root, path.join("epics", epic));
  } catch {
    return null;
  }
}

/** `<root>/epics/<epic>/README.md` 첫 줄(결정 5). 파일이 없으면 제목 없음(null) — 사이드바는
 *  P번호만 띄운다. 이건 결정 1이 막은 "이름 짓기"가 아니라 화면에 거는 라벨이다. */
export async function epicTitle(root: string, epic: string): Promise<string | null> {
  const dir = await epicDir(root, epic);
  if (!dir) return null;
  const text = await readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
  if (text === null) return null;
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? null;
}

export type EpicMemory = { file: string; text: string };

/** `<root>/epics/<epic>/memory/*.md` 한 단계 글롭(결정 2) — 파일만, 이름 오름차순. 하위
 *  디렉터리는 안 읽는다. 디렉터리가 없으면 빈 목록이고 경고 없다(정상 — 결정 2). */
export async function epicMemory(root: string, epic: string): Promise<EpicMemory[]> {
  const epicRoot = await epicDir(root, epic);
  if (!epicRoot) return [];
  const dir = path.join(epicRoot, "memory");
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = ents
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (file) => ({ file, text: await readFile(path.join(dir, file), "utf8") })),
  );
}
