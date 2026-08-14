/** 에픽 읽기 층 — 사이드바·스윔레인·에픽 화면이 같이 쓴다(제품 스펙 §에픽 결정 1·2·5).
 *
 *  에픽 목록의 정본은 큐(티켓 `epic:` 값)다 — 이 파일은 스펙 문서를 읽지 않는다(§검증 (4)).
 *  dira는 아무 프로젝트에나 붙는 GUI라 스펙 문서를 파싱하면 dira 전용 기능이 된다. */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "./paths.ts";
import { epicOf, type Ticket, type TicketState } from "./queue.ts";
// 발췌 규칙(첫 줄, 선두 `# ` 제거)이 페르소나 메모리와 같은 값이다 — 두 벌을 안 둔다(§32 ③).
import { memoryExcerpt } from "./skills.ts";
// 워커 이름 파싱은 여기서 다시 안 짓는다 — 워커 화면·칸반 카드와 같은 규칙 하나(§에픽 결정 9).
import { workerOf } from "./workers.ts";

/** `epic:` 없는 티켓이 모이는 자리(결정 1·5). 값이 아니라 GUI가 붙이는 라벨이다. */
export const NO_EPIC = "(에픽 없음)";

export type EpicCounts = Record<TicketState, number>;
/** `workers` — 이 에픽의 `.wip`을 지금 물고 있는 워커 이름 집합(distinct·오름차순, §에픽 결정 9).
 *  `.done`의 `owner:`는 안 세고, `workerOf`가 `null`이면(형식 아님) 그 티켓도 안 센다. */
export type Epic = { epic: string; counts: EpicCounts; workers: string[] };

/** 큐 티켓을 `epic:` 값으로 묶는다. 정렬은 P번호 문자열, `(에픽 없음)`이 맨 뒤(결정 5).
 *  건수는 `queue.ts`의 기존 `state` 판정을 그대로 쓴다 — 새 상태 판정을 안 만든다.
 *  워커 집합도 **같은 루프**에서 같이 낸다 — 새 읽기·새 폴링·새 상태 0(§에픽 결정 9). */
export function listEpics(tickets: Ticket[]): Epic[] {
  const byEpic = new Map<string, EpicCounts>();
  const workersByEpic = new Map<string, Set<string>>();
  for (const t of tickets) {
    const key = epicOf(t) || NO_EPIC;
    const counts = byEpic.get(key) ?? { open: 0, wip: 0, done: 0 };
    counts[t.state]++;
    byEpic.set(key, counts);
    if (t.state === "wip") {
      const worker = workerOf(t.fm.owner ?? "");
      if (worker) {
        const set = workersByEpic.get(key) ?? new Set<string>();
        set.add(worker);
        workersByEpic.set(key, set);
      }
    }
  }
  return [...byEpic.entries()]
    .sort(([a], [b]) => (a === NO_EPIC ? 1 : b === NO_EPIC ? -1 : a.localeCompare(b)))
    .map(([epic, counts]) => ({
      epic,
      counts,
      workers: [...(workersByEpic.get(epic) ?? [])].sort((a, b) => a.localeCompare(b)),
    }));
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

/** `README.md` 첫 줄 **뒤** 본문(§결정 6 §README) — 이 에픽이 무슨 작업인지 사람이 적어 두는
 *  자리. 제목 줄 자신은 안 실린다. 파일이 없으면 `epicTitle`과 같은 판정으로 null이다. */
export async function epicReadmeBody(root: string, epic: string): Promise<string | null> {
  const dir = await epicDir(root, epic);
  if (!dir) return null;
  const text = await readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
  if (text === null) return null;
  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim() !== "");
  if (titleIdx === -1) return "";
  return lines
    .slice(titleIdx + 1)
    .join("\n")
    .trim();
}

export type EpicMemory = { file: string; excerpt: string; text: string };

/** 메모리 디렉터리 글롭 하나 — 읽기(`epicMemory`)와 삭제(`deleteEpicMemory`)가 같이 쓴다
 *  (`lib/skills.ts`의 `memoryFiles`와 같은 자리). 디렉터리가 없으면 빈 목록(정상 — 결정 2). */
async function memoryFiles(root: string, epic: string): Promise<{ dir: string; name: string }[]> {
  const epicRoot = await epicDir(root, epic);
  if (!epicRoot) return [];
  const dir = path.join(epicRoot, "memory");
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return ents
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ dir, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `<root>/epics/<epic>/memory/*.md` 한 단계 글롭(결정 2) — 파일만, 이름 오름차순. 하위
 *  디렉터리는 안 읽는다. 디렉터리가 없으면 빈 목록이고 경고 없다(정상 — 결정 2). */
export async function epicMemory(root: string, epic: string): Promise<EpicMemory[]> {
  const files = await memoryFiles(root, epic);
  return Promise.all(
    files.map(async (f) => {
      const text = await readFile(path.join(f.dir, f.name), "utf8");
      return { file: f.name, excerpt: memoryExcerpt(text), text };
    }),
  );
}

/** 삭제. 클라이언트가 준 파일명은 이 디렉터리를 실제로 나열해 나온 목록 안에 있을 때만 지운다
 *  (§경로 방어 — `lib/skills.ts`의 `deletePersonaMemory`와 같은 규칙). NFC로 대조한다(같은 이유:
 *  macOS HFS+가 파일명을 NFD로 돌려주는 자리가 있다). */
export async function deleteEpicMemory(root: string, epic: string, file: string): Promise<void> {
  const files = await memoryFiles(root, epic);
  const target = files.find((f) => f.name.normalize("NFC") === file.normalize("NFC"));
  if (!target) throw new Error(`메모리 파일이 목록에 없습니다: ${file}`);
  await rm(path.join(target.dir, target.name));
}
