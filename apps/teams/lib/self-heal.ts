/** A/S 모듈(DESIGN.md §0-25) — 사람이 화면에서 누른 조작이 실패하면 지나는 공통 지점. 일회성
 *  에이전트가 오류 로그를 한 번 읽고 성질을 가른다(결정 2): **사용자 환경의 상태**면 그 자리에서
 *  직접 고치고, **제품 결함**이면 `kind: work` 티켓 한 장을 발행하고 즉시 디스패치한다.
 *
 *  **새 실행층을 안 만든다.** 띄우는 장치는 `home-session.ts`의 `runClaudeAt`을 그대로 쓴다 —
 *  갈리는 것은 `cwd` 하나뿐이다(홈 대화는 큐 부모를, 여기는 오류가 난 프로젝트의 git 루트를 넘긴다).
 *
 *  **금지 넷이 이 에이전트에게는 안 걸린다**(결정 3, 답 `2.(c)`) — `protocols/AGENTS.md` §git의
 *  `push --force`·`reset --hard`·`stash`·origin push 금지는 워커 세션의 것이고 이 즉석 에이전트의
 *  범위가 아니다. 다만 세 경계는 그대로 프롬프트가 진다: cwd 밖을 안 건드리고, `.dira/` 아래에는
 *  발행하는 티켓 한 장 말고 안 쓰며, `stash`는 태그를 단 형태만 쓴다.
 *
 *  **한 번이다(결정 5).** 이 함수가 재시도 곡선을 돌리지 않는다 — 실패하면 `"noop"`을 낸다.
 *  호출자(예: `scmPull`)가 자기 원래 액션을 다시 시도해 최종 성패를 스스로 정한다. 이 모듈은
 *  "고쳤다"고 선언하지 않는다 — 원래 액션의 재시도 결과가 유일한 성공 판정이다. */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { execClaude } from "./auth.ts";
import { newLive, runClaudeAt } from "./home-session.ts";
import { DEFAULT_LOCALE } from "./i18n.ts";
import { kickTicket } from "./kick.ts";
import { resolveConfig, type Project } from "./projects.ts";
import { listTickets } from "./queue.ts";

export type SelfHealInput = {
  /** git 자신의 실패 사유 그대로(§0-25 결정 1 — 화면이 이미 낸 그 문구). */
  error: string;
  /** 오류가 난 표면 이름(라우트에서 얻는다). 에이전트에게 맥락을 주는 것 하나뿐이다. */
  surface: string;
  /** 오류가 난 프로젝트의 git 루트 — 자식 프로세스가 도는 디렉터리(결정 3). */
  cwd: string;
  /** 제품 결함 갈래가 티켓을 낼 큐. `kickTicket`도 이 루트로 부른다. */
  project: Pick<Project, "root">;
};

/** 결정 2가 가른 두 갈래 중 무엇이 일어났나(호출자가 화면을 그리는 데 쓴다).
 *  `ticketed` — 제품 결함으로 갈려 티켓이 나갔다. 재시도해도 사유가 안 바뀔 것이 뻔하므로
 *  호출자는 원래 액션을 다시 안 부르고 종전 오류 문구로 되돌린다.
 *  `attempted` — 사용자 환경 갈래로 무언가 시도됐다. 호출자가 원래 액션을 한 번 더 불러 성패를 본다.
 *  `noop` — A/S 자신이 실패했다(결정 5 "A/S 자신이 낸 오류로 A/S를 다시 안 부른다"). `attempted`와
 *  같이 처리해도 안전하다 — 재시도가 그저 같은 실패를 한 번 더 낼 뿐이다. */
export type SelfHealOutcome = "ticketed" | "attempted" | "noop";

export async function selfHeal(input: SelfHealInput): Promise<SelfHealOutcome> {
  const bin = execClaude();
  if (!bin) return "noop";

  const hash = await freshTicketHash(input.project.root);
  const ticketPath = path.join(input.project.root, "tickets", `${hash}.md`);

  const run = await runClaudeAt(
    bin,
    input.cwd,
    "", // ontologyDir — `toolFlags`가 무시한다(§7-5 이후 스코프에 안 쓰인다)
    buildSelfHealPrompt(input.error, input.surface, ticketPath),
    ["--session-id", randomUUID()],
    newLive(),
    DEFAULT_LOCALE,
  );
  if (!run.ok) return "noop";

  const filed = await stat(ticketPath)
    .then(() => true)
    .catch(() => false);
  if (!filed) return "attempted";
  await kickTicket(input.project.root, hash);
  return "ticketed";
}

/** `snapshotOf`(home-session.ts)와 같은 조립 — 8-hex, 큐에 없는 값. 여기서 미리 정해 에이전트가
 *  쓸 파일명을 통제한다(에이전트가 직접 지으면 "어느 파일이 새 것인가"를 다시 찾아야 한다). */
async function freshTicketHash(root: string): Promise<string> {
  const tickets = await listTickets(root, await resolveConfig({ root })).catch(() => []);
  const stems = new Set(tickets.map((t) => t.stem));
  let hash = randomUUID().slice(0, 8);
  while (stems.has(hash)) hash = randomUUID().slice(0, 8);
  return hash;
}

function buildSelfHealPrompt(error: string, surface: string, ticketPath: string): string {
  const hash = path.basename(ticketPath, ".md");
  return `사람이 dira GUI의 '${surface}' 화면에서 조작을 하다가 오류를 만났습니다. 아래 오류
하나를 한 번 보고 고치는 것이 당신의 일입니다(DESIGN.md §0-25). 시도는 이 한 번뿐이고,
재시도 곡선은 없습니다.

## 오류 문구

${error}

## 오류의 성질을 가르고 그에 맞게 하세요

1. **사용자 환경의 상태** (트리가 더럽다 - ff가 안 된다 - 파일이 없다 - 권한이 막혔다) — 지금
   이 디렉터리(cwd)에서 직접 고치세요. 고친 내용을 따로 보고하지 않아도 됩니다.
2. **제품 결함** (코드가 틀렸다 - 엔진이 틀렸다 - 스펙이 틀렸다) — 고치지 말고, 정확히 아래
   경로에 아래 형식대로 파일 하나만 쓰세요. 그 밖에는 \`.dira/\` 아래 아무것도 쓰지 않습니다.

\`${ticketPath}\`:
\`\`\`
---
ticket: ${hash}
title: <오류를 한 줄로 요약, 80자 이하>
kind: work
persona: developer
---

${error}
\`\`\`

## 경계

- cwd의 git 루트 밖은 건드리지 않습니다.
- \`git stash\`가 필요하면 태그를 단 형태만 씁니다 — \`git stash push -u -m "<태그>"\`로 넣고
  자기 항목을 \`git stash list\`에서 찾아 \`git stash apply <sha>\`로 되돌린 뒤 그 항목을
  지웁니다. 맨 \`git stash pop\`은 쓰지 않습니다 — 이 스택은 다른 워크트리와 같이 씁니다.`;
}
