/** 머신 전체 동시 세션 상한 (`~/.config/dira/session-limit`, §세션이 120초 안에 못 뜬다 §개정
 *  결정 2-3). 값·세는 법의 단일 출처는 `.dira/session-cap.sh` — 이 파일은 그 판정을 화면이
 *  읽고 돌리게 옮긴 것뿐이고, 상한값도 세는 법(산 세션 하나)도 안 바꾼다.
 *
 *  세는 판정은 `session-cap.sh`의 `live_count`와 같다: 등록 프로젝트 `root` 아래
 *  `tickets/*.wip.md`의 `pid:`가 살아 있는 것. `listTickets`가 이미 상태·프론트매터를 파싱해
 *  주므로 그 결과를 거르기만 한다(`readSummary`의 `open`·`wip`·`done`과 같은 결) — 두 벌째
 *  파서를 만들지 않는다. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import type { Project } from "./projects.ts";
import { resolveConfig } from "./projects.ts";
import { listTickets } from "./queue.ts";
import { alive } from "./workers.ts";

function sessionLimitPath(): string {
  return path.join(localDir(), "session-limit");
}

/** `null` = 파일 없음(`없음`), `warn` = 파일은 있는데 못 읽은 값(문자·음수·빈 파일)이었다는
 *  뜻이고 그때 `limit`은 `0`이다. */
export type SessionLimit = { limit: number | null; warn: boolean };

export async function readSessionLimit(): Promise<SessionLimit> {
  const text = await readFile(sessionLimitPath(), "utf8").catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  });
  if (text === null) return { limit: null, warn: false };
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? { limit: Number(trimmed), warn: false } : { limit: 0, warn: true };
}

/** `limit === null`이면 파일을 지운다(트리거가 `없음`이 된다, 결정 2 "비우고 저장하면 파일이
 *  없어진다"). 없음이 "상한 없음"이라는 상태라 값 하나로는 못 나타내서, 다른 상한류처럼
 *  `0`으로 뭉치지 않고 삭제 규약을 따로 둔다. */
export async function writeSessionLimit(
  limit: number | null,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  if (limit === null) {
    await rm(sessionLimitPath(), { force: true });
    return;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`${t(locale, "sessionCap.limit.invalidPrefix")} ${limit}`);
  }
  await mkdir(localDir(), { recursive: true });
  await writeFile(sessionLimitPath(), `${limit}\n`, "utf8");
}

/** 프로젝트 하나의 산 세션 수. 못 읽으면 0(`readSummary`의 "못 읽은 프로젝트는 빈 배열이다"와
 *  같은 규칙 — 연결 안 됨 사유는 이미 다른 자리(`readWorkersPanelAction`의 `error`)가 든다). */
export async function liveSessionCount(project: Pick<Project, "root">): Promise<number> {
  const config = await resolveConfig(project).catch(() => null);
  if (!config) return 0;
  const tickets = await listTickets(project.root, config).catch(() => []);
  return tickets.filter((ticket) => {
    if (ticket.state !== "wip") return false;
    const pid = Number.parseInt(ticket.fm.pid ?? "", 10);
    return Number.isInteger(pid) && pid > 0 && alive(pid);
  }).length;
}
