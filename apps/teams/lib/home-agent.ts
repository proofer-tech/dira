/** 홈 에이전트(DESIGN.md §7)의 실행층 — **화면이 없는 서버 층**이다.
 *
 *  이 파일이 `lib/`에서 유일하게 하는 일: GUI가 **큐를 안 거치고** `claude` 세션을 하나 띄운다.
 *  질문이 티켓으로 들어가지 않고 답이 티켓으로 나오지 않는다(요구 `feb754bf`: "요구사항을
 *  처리하는것 말고"). `engine.ts`와 짝이 아니다 — 저기는 **이미 있는 워커 스크립트**에
 *  하위명령을 넘기고, 여기는 우리가 argv를 조립해 세션을 소유한다.
 *
 *  ## 커맨드 (실측으로 확정 · §7 표의 넷)
 *
 *  ```
 *  <claude> -p  --session-id <uuid> | --resume <uuid>
 *               --tools Read,Glob,Grep,Write,Edit,Bash
 *               --strict-mcp-config
 *               --permission-mode manual
 *               --allowed-tools Read Glob Grep 'Bash(ls:*)' … (열하나) 'Write(//<큐 루트>/personas/**)' 'Edit(…)' …
 *               --output-format stream-json --include-partial-messages --verbose
 *               "<프롬프트>"
 *  ```
 *
 *  근거는 전부 실측이다(이 머신, 2026-08-01 · 티켓 `89962e56`):
 *
 *  - **도구 목록을 줄이는 것은 `--tools`뿐이다.** `--allowed-tools`는 이름과 달리 도구를 빼지
 *    않는다 — **권한 자동승인 목록**이라, 목록 밖 도구도 도구 목록에는 그대로 있고 사람이 없는
 *    `-p`에서도 하네스가 승인하는 것은 그냥 돈다. `Bash`가 그랬다. 같은 cwd·같은 프롬프트
 *    (``Bash 도구로 `cat a.txt` 를 실행하고 결과를 그대로 보고해라``) A/B:
 *
 *    | 플래그 | 트랜스크립트 | `permission_denials` |
 *    |---|---|---|
 *    | `--allowed-tools Read,Glob,Grep` | `TOOL_USE: Bash {cat a.txt}` **is_error: false** | `[]` |
 *    | `--tools Read,Glob,Grep` | `TOOL_USE: Read` 1건 · **Bash 0건** | `[]` |
 *
 *    아래 칸의 답이 그대로 근거다: "Bash 도구는 이번 세션에 없어서(사용 가능한 도구는
 *    Glob/Grep/Read뿐) Read로 대신 읽었다." **거부가 아니라 부재다** — 그래서 `permission_denials`가
 *    양쪽 다 비어 있다. 이 빈 배열을 "안 두드렸다"로 읽으면 위 칸을 안전으로 오독한다.
 *  - **`--strict-mcp-config`가 MCP 도구를 뺀다.** `--tools`는 문서 그대로 **built-in set**만
 *    줄인다 — 이걸 빼면 사람 머신에 붙은 MCP 서버의 도구가 그대로 남는다(실측: 답이 원격
 *    샌드박스 실행 도구를 스스로 후보로 꼽았다). 붙이면 도구가 셋으로 떨어진다:
 *    "현재 제게 실제로 주어진 도구는 3개입니다: Glob · Grep · Read. **MCP 도구: 없습니다.**"
 *    GUI 서버는 사람 셸의 설정을 물려받으므로 이 표면은 우리 코드가 아니라 그 머신이 정한다.
 *  - **`--permission-mode manual`은 위 둘이 놓친 것의 마지막 관문이다.** 이 머신의
 *    `~/.claude/settings.json`이 `"defaultMode":"bypassPermissions"`라, 이걸 안 덮으면 도구 목록에
 *    남은 것은 무엇이든 그냥 통과한다(§7: `--dangerously-skip-permissions`를 쓰지 않는다).
 *  - **`--allowed-tools`는 그 `manual` 위에서 물어보지 않을 것을 적는다 — 그리고 거기 쓴 경로가
 *    실제로 경계다**(`7e35d300` 실측 · §7 §경계를 지는 것). 여전히 **도구 집합의 가드는 아니다**
 *    (그 일은 `--tools`가 한다) — 바뀐 것은 `Write(//<경로>/**)` 꼴의 스코프가 먹는다는 것 하나다.
 *    그래서 이 옵션 값은 **argv 여러 토큰**이다(실측이 그 모양으로 쟀다). variadic(`<tools...>`)
 *    함정은 그대로 있으므로 **바로 뒤에 `--output-format`이 오는 자리를 지킨다**: 마지막에 두면
 *    `--allowed-tools … "<질문>"`이 되어 질문까지 도구 이름으로 먹고 `Input must be provided
 *    either through stdin or as a prompt argument`로 죽는다. `--tools` 값은 그와 별개로 **쉼표로
 *    붙인 한 토큰**이다.
 *  - **모델 플래그가 없다.** §7이 `claude` 고정 · `모델 지정 안 함`으로 정했다(codex는 트랜스크립트를
 *    안 남겨서 고를 수 있게 하는 순간 이 화면이 빈다 — §4-3 표).
 *  - **`--output-format stream-json --include-partial-messages --verbose`** (`88ff08f8` 실측 ·
 *    §7 §답은 흐른다 — 실측). 종전은 `json` 한 줄이었고, 답을 **글자가 도착하는 대로** 그리려면
 *    부분 텍스트의 원본이 있어야 해서 갈았다. 셋이 한 묶음인 이유:
 *    ① 부분 텍스트를 주는 것은 `--include-partial-messages` **하나뿐**이다(A/B: 빼면
 *    `stream_event` 0건 · `assistant` 한 건에 완성된 답이 통째로 온다),
 *    ② `--verbose`는 선택이 아니다 — 빼면 stdout 0바이트에 stderr 한 줄로 죽는다
 *    (`Error: When using --print, --output-format=stream-json requires --verbose`),
 *    ③ 대신 stdout에 `system`·`rate_limit_event`가 섞이므로 **결과를 "마지막 줄"로 집으면 안 된다**
 *    — 줄마다 파싱해 `type`으로 가른다(`eatLine`).
 *    **성패·사유 판정은 그대로 남는다**: `is_error`·`result`·`api_error_status`(§비주얼 §24 ②의
 *    401/403)가 전부 `{"type":"result"}` **한 줄**에 있고, `json` 형식에서 잰 값과 글자로 같았다.
 *
 *  프롬프트는 **argv 마지막 토큰**이다(stdin이 아니다). 그리고 자식의 stdin을 **즉시 닫는다** —
 *  안 닫으면 `claude`가 `Warning: no stdin data received in 3s`로 3초를 버린다(실측 11.3s → 5.9s).
 *  `execFile`을 못 쓰는 이유가 이것이다: 저 래퍼는 stdout을 **다 모아서** 한 번에 주므로 흐르는
 *  답의 원본이 콜백까지 안 나오고, `promisify`를 씌우면 자식 핸들조차 안 준다(`중지`가 죽일
 *  대상이 그 핸들이다). `stdio` 옵션도 `execFile`이 통째로 버린다(넘겨도 경고가 그대로 난다 —
 *  실측). tick.sh 비스트리밍 경로가 `</dev/null`을 붙인 것과 같은 사건이다(`7d9fbe9`).
 *  `execFile`이 대신 해 주던 것 하나는 여기서 직접 든다: stdout 버퍼 — 상한이 없다(줄 단위로
 *  먹고 버린다). **시계 타이머는 없다**(요구 `8db4d0f6` — §7 §천장이 없다). 끝의 근거는 결과
 *  객체 · 프로세스의 죽음(`close`에 결과 줄이 없으면 실패 ③) · `stopAsk`의 `SIGTERM` 셋뿐이다.
 *
 *  **`Bash`가 빠져 있던 근거(위 A/B)는 안 죽었다 — 그 위에 §7-3이 한 층을 더 얹었다**(요구
 *  `b100a3aa`). 셸이 경로 스코프를 못 지는 것은 그대로 참이라 열리는 것은 `Bash` 전체가
 *  아니라 **허용목록에 든 읽기 전용 명령 열하나**(`TOOLS`·`toolFlags` 주석)이고, 그 목록이
 *  `;`·`&&`·`$( )`·`>` 우회를 실제로 막는지는 실측(`ef1e8c89`, DESIGN.md §7-3)이 쟀다 — 갈래는
 *  (가) 세그먼트별: 허용 명령 단독·허용 명령만의 파이프라인은 돌고 비허용이 섞이면 전부 거부된다. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { findClaude, tokenPath } from "./auth.ts";
import type { Run } from "./engine.ts";
import { listEpics, resolveMarkdownRefs } from "./epics.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import { mayHaveRefs, type RefIndex } from "./markdown-refs.ts";
import {
  getProject,
  readLanguage,
  readProjects,
  registryPath,
  resolveConfig,
  type Project,
  type ProjectConfig,
} from "./projects.ts";
import { isAwaiting, listTickets, reqTitle, statusOf, type Ticket } from "./queue.ts";
import { findTranscript, lastEvent, sessionIdOf, tailEvents, type StreamEvent } from "./transcript.ts";
import { engineCell, listWorkers, workerOf, type Worker } from "./workers.ts";

/** 세션에 존재하는 도구 전부. **쉼표 한 토큰**이다(머리 주석의 variadic 함정). `Bash`가 들어간
 *  것은 §7-3(요구 `b100a3aa`)의 승격이다 — 셸이 경로 스코프를 못 넘는 것은 그대로 참이라
 *  `--allowed-tools`의 프리픽스 허용목록(`BASH_ALLOWED`)이 그 자리를 진다. `Write`·`Edit`의
 *  경로 스코프는 한 글자도 안 갈렸다(§7-3 결정 1). */
const TOOLS = "Read,Glob,Grep,Write,Edit,Bash";

/** §7-3 결정 4 — `--allowed-tools`에 여는 읽기 전용 명령 열하나. `Bash(<명령>:*)` 꼴로 붙는다.
 *  실측(`ef1e8c89`)이 갈래 (가) 세그먼트별을 확정했다 — 허용 명령 단독·허용 명령만의
 *  파이프라인은 돌고, `;`·`&&`·`$( )`·`>`·비허용 단독이 섞이면 전부 거부된다. **목록이 계약이고
 *  여기 없는 것은 세션에 없다**(자동 거부) — `awk`·`sed`(이름은 읽기 같지만 쓴다),
 *  `python3`·`sh`·`bash`·`xargs`·`find`(임의 실행/삭제)는 뺐다. `git`은 **두 낱말 프리픽스로만**
 *  든다(`Bash(git log:*)`) — 통째로 열면 `commit`·`checkout`·`push`가 같은 이름 아래 들어온다
 *  (두 낱말 프리픽스가 먹는 것도 실측이 쟀다). `cat`은 파이프의 앞자리일 뿐 — 파일 한 장을
 *  읽을 때 쓰는 것은 여전히 `Read`다(결정 1). */
const BASH_ALLOWED = ["ls", "cat", "head", "tail", "wc", "sort", "uniq", "cut", "grep", "jq", "git log"];

/** 쓰기가 닿는 곳 중 **큐 루트 기준** 다섯(§7 §쓰기가 닿는 곳이 **다섯**이 된다 — 요구
 *  `bd3cd201`) + `tickets/**`. **상대 글롭**이라 값이 프로젝트마다 다르다 — 아래가 상수 배열
 *  (`TOOL_FLAGS`)이 아니라 함수인 이유가 이 한 줄이다. 여기 없는 것은 밖이다: `worktrees/**`
 *  (아래에 실제 프로젝트 코드가 있다) · repo의 나머지 전부(소스 · `docs/**` · 엔진) · 큐 밖 전부.
 *
 *  `ontology/**`는 여기 없다 — **해석된 온톨로지 기준**이라 큐 루트에 얹을 수 없고
 *  `toolFlags`가 따로 받는다(요구 `85114387` §결정 4 — `TICKET_ONTOLOGY`가 큐 밖을 가리키면
 *  이 자리도 큐 밖이 된다). AGENTS.md가 아카이빙 산출물의 나머지 한 자리다(§5-3 산출물 ②).
 *  **종전엔 그 둘 다 repo(`dirname(root)`) 기준이었다** — 큐는 git에 안 들어가는 것이 불변식이라
 *  (CORE §큐의 불변식 3) 온톨로지를 큐 안에 두면 clone한 사람에게 0장이라는 근거였다. 그 값은
 *  뒤집힌 것이 아니라 **대가로 지불됐다**(§5-3 §아카이빙 산출물은 큐 안에 있다 §파는 것). 대신
 *  repo 쪽 예외가 **0**이 되어 요구 `20e4a6f4`(실제 프로젝트는 못 고친다)가 예외 없이 뜬다 —
 *  개정 `22a803de`. `AGENTS.md`는 아직 그 자리에 파일이 없을 수 있어 `Write`가 필요하다.
 *
 *  **`tickets/**`는 종전에 `Write`가 안 붙는 자리였다**(별도 상수 `EDIT_ONLY` — 시킨 일이
 *  *티켓 본문에 링크를 추가*(산출물 ③)이지 티켓 발행이 아니었다). 요구 `64b45d3c`가 그 결정을
 *  뒤집었다(§7 §홈 대화에서 요구사항이 접수된다) — 열린 것은 `kind: request` 하나뿐이고,
 *  플래그는 파일 내용을 못 봐서 그 제약은 여기서 안 지고 `buildPrompt`의 경계 문단이 진다. */
const WRITABLE = ["personas/**", "protocols/**", "workers/*.sh", "AGENTS.md", "tickets/**"];

/** 도구 표면을 정하는 플래그 **전부**. **네 조각이 각자 다른 층을 막으므로** 하나라도 빠지면
 *  표면이 넓어진다(머리 주석의 A/B): `--tools`가 built-in 목록을 다섯으로 만들고,
 *  `--strict-mcp-config`가 사람 머신의 MCP 도구를 빼고, `--permission-mode manual`이 남은 것의
 *  관문이고, **`--allowed-tools`가 그 관문 위에서 경로 스코프를 건다.**
 *
 *  넷째가 종전에는 "읽기 셋을 물어보지 않게 하는 조각"이었다. 지금은 **권한 목록이면서 동시에
 *  경계 그 자체**다(`7e35d300` 실측: `..`도 심링크도 못 뚫는다 — 양방향 보수적 교집합).
 *  그래도 **혼자서는 도구 가드가 아니다**(`89962e56` 그대로) — `manual`을 빼면 이 목록 밖 도구가
 *  그냥 돌고, 이 목록을 빼면 `manual`이 다 물어보다 턴이 끝난다. **둘 중 하나를 빼는 변경은
 *  경계를 통째로 없앤다.**
 *
 *  **`home-agent.test.ts`가 이 반환값을 검증한다.** `--allowed-tools`만 남기는 회귀가 `89962e56`
 *  그 사건이었고, 그건 코드를 봐서는 안 틀려 보인다 — 플래그 이름이 하는 일을 알려 주지 않는다. */
/** `ontologyDir`은 **해석된 값**(`resolveConfig(project).ontology`)이다 — 기본값 큐에서는
 *  `<root>/ontology`와 글자로 같고, `TICKET_ONTOLOGY`가 재정의한 큐에서는 큐 밖 절대경로일 수
 *  있다(요구 `85114387` §결정 4). 이 함수는 그 값을 그대로 스코프에 얹을 뿐 해석하지 않는다 —
 *  고정 함수(`ontologyDir(project)`)를 여기 두지 않는다(DESIGN.md §5-3: 고정 함수가 남으면
 *  그 하나가 옛 자리를 판다). */
export function toolFlags(root: string, ontologyDir: string): string[] {
  // 절대경로는 **슬래시 둘로 시작한다**(`Write(//<절대경로>/**)` — 실측 `7e35d300`. `**`는 깊이 무제한).
  const abs = (base: string, glob: string) => `//${path.join(base, glob)}`;
  // 다섯은 큐 루트 아래다 — repo(`dirname(root)`) 기준 항이 **0**이다(개정 `22a803de`).
  // `tickets/**`가 `Write`까지 받는 것은 요구 `64b45d3c`가 뒤집은 자리다(위 `WRITABLE` 주석).
  // 여섯째(온톨로지)만 `ontologyDir` 기준이다 — 재정의한 큐에서는 그게 큐 밖이다(§결정 4).
  const scope = [...WRITABLE.map((g) => abs(root, g)), abs(ontologyDir, "**")].flatMap((p) => [
    `Write(${p})`,
    `Edit(${p})`,
  ]);
  // `--allowed-tools`의 값은 여기서 **토큰 여러 개**다 — 뒤에 `--output-format`이 와야 한다(머리 주석).
  const bash = BASH_ALLOWED.map((cmd) => `Bash(${cmd}:*)`);
  return ["--tools", TOOLS, "--strict-mcp-config", "--permission-mode", "manual", "--allowed-tools", "Read", "Glob", "Grep", ...bash, ...scope];
}

// ── 프로젝트 → 대화 목록 (§7 §대화가 여럿이다) ──────────────────────────────
//
// **대화 이력 저장소를 만들지 않는다.** `claude`가 자기 트랜스크립트를 이미 쓰고 있고 그걸 읽는
// 코어가 `lib/transcript.ts`에 있다. GUI가 남기는 것은 프로젝트 → **session id 목록**뿐이다
// (종전은 한 줄이었다 — 요구 `c5d22429`로 값이 문자열에서 목록이 됐다. 파일도 자리도 그대로다).

/** 목록의 한 줄. **내용은 여기 없다** — 트랜스크립트가 정본이고 이 줄은 그 파일을 찾는 열쇠다. */
export type Conversation = {
  /** session id(UUID). `--resume` 인자이자 트랜스크립트 글롭의 값이다 */
  id: string;
  /** 첫 질문의 첫 줄(`reqTitle`). 옛 형식에서 올라온 줄은 첫 질문을 모르므로 빈다 */
  title: string;
  /** ISO. 옛 형식에서 올라온 줄은 모른다 — 빈 문자열이다(지어내지 않는다) */
  created: string;
  /** **아직 세션이 안 떴다.** 다음 질문이 `--resume`이 아니라 `--session-id`로 연다 */
  fresh?: true;
  /** 세션이 스스로 말한 모델(§7 §세션 정보 한 줄 — 요구 `8db4d0f6`). 첫 성공한 턴이 적고
   *  그 뒤로는 안 바뀐다(모델 지정이 없어 세션 내내 고정이다). 아직 성공한 턴이 없으면 없다 */
  model?: string;
};

// ── 스케줄 (§7-2) — 좌측 패널 둘째 그룹이 시각에 홈 에이전트를 깨운다 ───────────
//
// **엔진이 한 번도 안 읽는다** — 읽는 쪽도 쓰는 쪽도 이 GUI 서버 하나다. 그래서 저장 자리는
// 대화 목록과 같은 파일(`home-sessions.json`)이고 새 파일은 0개다(§7-2 §저장).

/** `when`의 갈래를 가르는 것은 **`T` 하나다**(§7-2 §단발과 주기가 한 칸에 담긴다). 단발은
 *  ISO 8601 + 오프셋, 나머지 셋(매일·매주·매월)은 5필드 cron — 화면이 만들고 사람은 안 쓴다. */
export function isOnceWhen(when: string): boolean {
  return when.includes("T");
}

/** 화면이 만드는 넷뿐이라 각 자리는 `*` 아니면 정수 하나다(리스트·범위 문법이 없다). **못 읽는
 *  `when`은 없는 것으로 친다**(§7-2 — `parseHome`의 관문과 같은 선) — 이 판정이 그 관문이다. */
export function isValidWhen(when: string): boolean {
  if (isOnceWhen(when)) return Number.isFinite(Date.parse(when));
  const fields = when.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => f === "*" || /^\d+$/.test(f));
}

/** 5필드 cron 한 분을 **머신 로컬 시각**과 맞춘다(§7-2 §시간대 — `Date` getter가 이미 로컬이고,
 *  지금 crontab이 워커를 깨우는 판정과 같은 자다). */
function matchesCronMinute(cron: string, d: Date): boolean {
  const [min, hour, dom, month, dow] = cron.trim().split(/\s+/);
  const eq = (f: string, v: number) => f === "*" || Number(f) === v;
  return (
    eq(min!, d.getMinutes()) &&
    eq(hour!, d.getHours()) &&
    eq(dom!, d.getDate()) &&
    eq(month!, d.getMonth() + 1) &&
    eq(dow!, d.getDay())
  );
}

/** §7-2 §되짚는 창 — 그보다 오래 앱이 꺼져 있었으면 놓친 회차는 없는 것으로 하고 다음 맞는
 *  분부터 돈다. 새 수를 발명한 게 아니다 — 갈래 넷의 가장 긴 주기(매월)가 한 주기다. */
export const SCHEDULE_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000;

/** §7-2 §판정의 입력. **시계도 인자다** — `judgeSchedule`이 순수 함수로 뜨는 이유가 이것이다
 *  (`pnpm test`가 시계를 주입해 판정한다). `lastDueMs`가 없으면(`null`) 창의 시작은 `createdMs`다
 *  ("오늘 만든 스케줄이 어제 회차를 돌지 않는다"). */
export type ScheduleJudgeInput = { when: string; lastDueMs: number | null; createdMs: number; nowMs: number };

/** §7-2 §판정 — `(마지막 예정 시각, 지금]`에 맞는 분이 하나라도 있으면 그 회차의 예정 시각(ms)을
 *  낸다. 없으면 `null`. 맞는 분이 여럿이면 **마지막** 것 하나 — 몰아 돌리지 않는다. 단발은
 *  `lastDueMs`가 있으면(=이미 돌았으면) 다시 안 돈다. 못 읽는 `when`은 없는 것으로 친다.
 *
 *  **31일 캡이 `once`에도 그냥 적용된다** — 창의 시작을 뒤로 못 미는 것 하나로 "31일보다 오래
 *  지난 단발은 안 돈다"가 따로 분기 없이 뜬다(§7-2 수용조건). */
export function judgeSchedule({ when, lastDueMs, createdMs, nowMs }: ScheduleJudgeInput): number | null {
  if (!isValidWhen(when)) return null;
  const windowStart = Math.max(lastDueMs ?? createdMs, nowMs - SCHEDULE_LOOKBACK_MS);
  if (isOnceWhen(when)) {
    if (lastDueMs !== null) return null;
    const at = Date.parse(when);
    return at > windowStart && at <= nowMs ? at : null;
  }
  // 분 단위로 훑는다 — 최악(31일 공백)도 44,640회라 값이 트리비얼하다(핫패스가 아니다: 15초마다
  // 한 번, 보통 창은 1~2분이다).
  const startMinute = Math.floor(windowStart / 60_000) + 1;
  const endMinute = Math.floor(nowMs / 60_000);
  let due: number | null = null;
  for (let m = startMinute; m <= endMinute; m++) {
    const t = m * 60_000;
    if (matchesCronMinute(when, new Date(t))) due = t;
  }
  return due;
}

/** §비주얼 §62 (3) §다음 예정 시각 — `judgeSchedule`과 짝인 순수 함수다. 저건 "지금 돌아야
 *  하나"를 묻는 트리거고 이건 "다음엔 언제 돌 것 같나"를 묻는 화면의 값이다 — 트리거가 아니라서
 *  결과를 저장하지 않는다(호출마다 다시 잰다). **단발**은 자기 시각이 유일한 값이라 `last`가
 *  있으면(이미 돌았다) `overdue`이고, 없어도 `judgeSchedule`이 다시 못 돌릴 만큼 지났으면
 *  (`at <= windowStart`, `judgeSchedule`과 같은 셈) 역시 `overdue`다. **반복**은 정의상 항상
 *  다음 맞는 미래 분이라 `overdue`가 설 자리가 없다 — 그래서 갈래 두 함수가 아니라 한 함수의
 *  두 분기다. */
export function nextScheduleDue(
  { when, created, last }: Pick<Schedule, "when" | "created" | "last">,
  nowMs: number = Date.now(),
): { at: number; overdue: boolean } {
  if (isOnceWhen(when)) {
    const at = Date.parse(when);
    if (last) return { at, overdue: true };
    const createdMs = Date.parse(created);
    const windowStart = Math.max(Number.isFinite(createdMs) ? createdMs : nowMs, nowMs - SCHEDULE_LOOKBACK_MS);
    return { at, overdue: at <= windowStart };
  }
  // 다음 맞는 분을 앞으로 훑는다 — 최악(매월 28일)도 31일 = 44,640분이라 `judgeSchedule`의 같은
  // 셈으로 트리비얼하다. 화면의 갈래 넷이 `dom`을 1~28로 닫아 두므로 이 창 안에 반드시 있다.
  const start = Math.floor(nowMs / 60_000) + 1;
  const end = start + SCHEDULE_LOOKBACK_MS / 60_000;
  for (let m = start; m <= end; m++) {
    const t = m * 60_000;
    if (matchesCronMinute(when, new Date(t))) return { at: t, overdue: false };
  }
  return { at: nowMs, overdue: false }; // 못 찾을 리 없다 — 위 문단이 근거다(방어값)
}

/** 저장 형식(§7-2 §저장) 그대로. `home-sessions.json`의 그 프로젝트 값에 `schedules` 배열 한
 *  칸으로 남는다 — `Conversation`과 같은 파일, 같은 원자적 쓰기(`writeHome`)를 탄다. */
export type Schedule = {
  id: string;
  /** ISO. `last`가 없을 때 판정 창의 시작이 된다 */
  created: string;
  /** 단발(ISO 8601 + 오프셋) 또는 5필드 cron. 화면이 쓰고 사람은 안 고친다 */
  when: string;
  /** 사람의 문장 그대로 — 고쳐 쓰지 않는다(§7-2 §회차의 질문) */
  prompt: string;
  /** 첫 회차가 민 값 — 그 뒤 회차가 `--resume`으로 잇는다. **`sessionIdOf` 관문을 통과한 값만
   *  남는다** — 통과 못 하거나 가리키는 트랜스크립트가 없으면 다음 회차가 새 세션으로 민다 */
  session_id: string;
  /** 마지막으로 판정한 예정 시각과 그때의 실제 시각 — <돌았나>를 담지 않는다(§7-2) */
  last?: { due: string; at: string };
};

/** 패널 줄이 그리는 값 — `Schedule`에 `nextScheduleDue`의 결과를 얹는다. 화면(client)은
 *  `isOnceWhen`·`matchesCronMinute` 같은 값 함수를 이 파일에서 못 가져온다(`node:fs` import가
 *  섞여 있어 클라이언트 번들이 안 된다 — `lib/urls.ts` 머리 주석과 같은 선) — 그래서 서버가
 *  이미 계산해 데이터로 내려보낸다. `lib/urls.ts`의 `scheduleRows`가 이 값을 문자열로만 접는다. */
export type ScheduleView = Schedule & { at: number; overdue: boolean };

/** 폴링·서버 액션 응답에 실어 보낼 스케줄 목록 — `readHome`이 주는 원본에 화면용 값을 얹는다. */
export function scheduleViews(schedules: Schedule[], nowMs: number = Date.now()): ScheduleView[] {
  return schedules.map((s) => ({ ...s, ...nextScheduleDue(s, nowMs) }));
}

/** 한 줄의 관문. **못 읽는 `when`은 없는 것으로 친다**(`parseHome`의 대화 관문과 같은 선) —
 *  `id`·`prompt`도 형이 아니면 같이 없는 줄이다. `session_id`는 형만 본다(빈 값·깨진 값이어도
 *  줄 자체는 그대로다 — 그 값을 실제로 쓰는 자리(디스패치)가 `sessionIdOf` 관문을 다시 지난다). */
function parseSchedule(v: unknown): Schedule | null {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.prompt !== "string") return null;
  if (typeof o.when !== "string" || !isValidWhen(o.when)) return null;
  const rawLast = o.last && typeof o.last === "object" ? (o.last as Record<string, unknown>) : null;
  const last =
    rawLast && typeof rawLast.due === "string" && typeof rawLast.at === "string"
      ? { due: rawLast.due, at: rawLast.at }
      : undefined;
  return {
    id: o.id,
    created: typeof o.created === "string" ? o.created : "",
    when: o.when,
    prompt: o.prompt,
    session_id: sessionIdOf({ session_id: typeof o.session_id === "string" ? o.session_id : "" }) ?? "",
    ...(last ? { last } : {}),
  };
}

/** 한 프로젝트가 이 파일에 갖는 것 전부. **`current`는 대화 목록 밖을 가리킬 수 있다** —
 *  좌측 패널의 워커 세션을 고르면 그 session id가 여기 들어오고 `conversations`에는 줄이
 *  안 생긴다(§7 §고르면 홈 대화 스레드에 열린다 — 워커 세션이 사람 대화 20을 밀어내면 안 된다).
 *  `schedules`는 §7-2 — 화면·엔진 둘 다 안 읽는 프로젝트는 언제나 빈 배열이다. */
export type Home = { conversations: Conversation[]; current: string | null; schedules: Schedule[] };

/** §7: **프로젝트당 최근 20개.** 넘으면 오래된 줄이 이 파일에서 빠진다 —
 *  **트랜스크립트는 안 지운다**(`~/.claude`는 남의 디렉터리다). */
const LIMIT = 20;

/** 레지스트리·토큰·키맵과 **같은 디렉터리**(엔진의 `$LOCAL`). **`gui-projects.json`에 넣지 않는다** —
 *  등록 정보와 대화 상태는 수명이 다르다(§7). 파일 하나에 프로젝트 전부를 담는다. */
export function sessionsPath(): string {
  return path.join(path.dirname(registryPath()), "home-sessions.json");
}

/** 파일 없음·JSON 깨짐을 **빈 맵으로 흡수한다.** 최악이 "대화 하나를 잃고 새로 시작"이라
 *  던져서 홈 화면을 500으로 만들 값이 없다(`readKeymap`과 같은 선). */
async function readSessions(): Promise<Record<string, unknown>> {
  try {
    const o: unknown = JSON.parse(await readFile(sessionsPath(), "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 한 프로젝트의 값 → 대화 목록.
 *
 *  **옛 형식(문자열 한 줄)이 대화 한 개짜리 목록이 된다.** 이 파일은 사람 머신에 이미 있고,
 *  못 읽으면 그 사람은 돌던 대화를 잃는다. 제목·만든 시각은 그 형식에 없던 값이라 **비운다** —
 *  트랜스크립트를 열어 지어내지 않는다(그 파일은 여기서 읽는 것이 아니다).
 *
 *  **경로가 되는 값의 관문은 `sessionIdOf` 하나다.** 목록의 각 줄이 그 관문을 통과하고
 *  통과 못 하는 줄은 없는 것으로 친다 — 사람이 이 파일을 손으로 고칠 수 있고, 이 값은 그대로
 *  `--resume` 인자가 되고 `findTranscript`가 `~/.claude/projects/*​/<이것>.jsonl`을 찾는 데 쓴다. */
function parseHome(v: unknown): Home {
  const uuid = (x: unknown) => sessionIdOf({ session_id: typeof x === "string" ? x : "" });
  if (typeof v === "string") {
    const id = uuid(v);
    return id
      ? { conversations: [{ id, title: "", created: "" }], current: id, schedules: [] }
      : { conversations: [], current: null, schedules: [] };
  }
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const conversations = (Array.isArray(o.conversations) ? o.conversations : []).flatMap((r): Conversation[] => {
    const c = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const id = uuid(c.id);
    if (!id) return [];
    return [
      {
        id,
        title: typeof c.title === "string" ? c.title : "",
        created: typeof c.created === "string" ? c.created : "",
        ...(c.fresh === true ? { fresh: true as const } : {}),
        ...(typeof c.model === "string" ? { model: c.model } : {}),
      },
    ];
  });
  // **못 읽는 줄은 없는 것으로 친다**(§7-2 — 대화 관문과 같은 선). 사람이 이 파일을 손으로
  // 고칠 수 있다는 전제도 같다.
  const schedules = (Array.isArray(o.schedules) ? o.schedules : []).flatMap((r): Schedule[] => {
    const s = parseSchedule(r);
    return s ? [s] : [];
  });
  // **`current`의 관문은 `sessionIdOf` 하나다**(§7 §고르면 홈 대화 스레드에 열린다 — 종전
  // *"목록에 있는 줄만 가리킨다"*에서 넓혔다). 워커 세션을 고르면 대화 목록에 없는 값이 여기
  // 들어오기 때문이다. **무엇을 가리키는지는 읽는 쪽이 판정한다**(`pollHome`) — 대화도 워커
  // 세션도 아니면 화면은 대화 0건과 같이 뜬다(온보딩). 경로가 되는 값의 방어는 그대로 이 한 줄이다.
  return { conversations, current: uuid(o.current) || null, schedules };
}

/** 목록 읽기 — 화면이 대화 목록을 그리는 출처(§비주얼 §24). */
export async function readHome(projectId: string): Promise<Home> {
  return parseHome((await readSessions())[projectId]);
}

/** 한 프로젝트만 갈아 끼운다 — 파일 하나에 프로젝트 전부가 사므로 나머지는 읽은 그대로 다시 쓴다.
 *
 *  **임시 파일에 쓰고 `rename`으로 갈아 끼운다**(플레이크 `083fb571`). `writeFile`은 **자르고
 *  쓰므로** 그 사이의 폴링이 반쪽 JSON을 읽고, `readSessions`가 그 예외를 `{}`로 흡수해
 *  `pollHome`의 `sid`가 null이 된다 — 화면이 순간 **대화 0건(온보딩)**으로 깜빡이고 그 폴링은
 *  `running: false`를 실패 없이 돌려준다. 실측(이 머신, 8프로젝트 × 대화 20 크기로 400회 왕복):
 *  `writeFile` 367~398회 읽기 중 82~103회가 깨진 JSON, `rename`은 770~844회 중 0회.
 *  같은 값을 두 요청이 겹쳐 쓰면 나중 것이 이기는 것은 종전과 같다 — 여기서 없앤 것은 **찢긴
 *  읽기**뿐이고, 읽고-고쳐-쓰는 창은 대화 파일 하나라 다투는 자리가 아니다(§7).
 *  이름에 uuid를 붙이는 이유는 프로젝트 둘이 동시에 물으면 이 함수가 겹쳐 도는 것 하나다. */
async function writeHome(projectId: string, home: Home): Promise<void> {
  const p = sessionsPath();
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...(await readSessions()), [projectId]: home }, null, 2) + "\n");
  await rename(tmp, p);
}

/** 지금 보는 대화의 session id. 없으면 null(= 다음 질문이 새 줄을 연다). */
export async function readSessionId(projectId: string): Promise<string | null> {
  return (await readHome(projectId)).current;
}

/** 목록 끝에 줄 하나를 붙이고 **오래된 쪽을 상한에서 자른다**(§7 상한 20). 새 줄은 항상 끝이라
 *  앞에서 자르는 것이 곧 "가장 오래된 줄이 빠진다"이고, 방금 연 대화는 잘릴 수 없다. */
function append(home: Home, row: Conversation): Home {
  return { ...home, conversations: [...home.conversations, row].slice(-LIMIT), current: row.id };
}

const openRow = (): Conversation => ({
  id: randomUUID(),
  title: "",
  created: new Date().toISOString(),
  fresh: true,
});

/** 화면의 `새 대화` — **지우는 것이 아니라 여는 것이다**(§7 — 요구 `c5d22429`로 뒤집혔다).
 *  옛 대화는 목록에 남고 옛 트랜스크립트도 그대로다. 세션은 아직 안 뜬다(`fresh`) —
 *  뜨는 것은 이 대화의 첫 질문이다. */
export async function newConversation(projectId: string): Promise<string> {
  const home = await readHome(projectId);
  // 아직 아무것도 안 물은 대화를 또 열지 않는다 — 두 번 누르면 빈 줄이 둘이고, 상한 20이 그걸로 찬다
  const empty = home.conversations.find((c) => c.id === home.current && c.fresh && !c.title);
  if (empty) return empty.id;
  const row = openRow();
  await writeHome(projectId, append(home, row));
  return row.id;
}

/** 좌측 패널에서 한 줄을 고른다 — `current` 교체가 전부다. **실재하지 않는 값은 안 받는다**:
 *  이 값은 경로가 되고, 클라이언트가 들고 오는 문자열이다(관문이 `sessionIdOf` 하나인 것과 같은
 *  이유). 실재하는 줄은 둘이다 — **대화 목록의 한 줄**이거나 **큐에서 파생된 워커 세션 한 줄**
 *  (§7 좌측 패널). 워커 세션이어도 `conversations`에는 줄을 안 만든다: 파일에 갈리는 것은
 *  `current` 한 칸이다. */
export async function switchConversation(projectId: string, sessionId: string): Promise<boolean> {
  const home = await readHome(projectId);
  const known =
    home.conversations.some((c) => c.id === sessionId) ||
    // 회차가 있는 스케줄 줄(§7-2 §고르면 무엇이 서나 — 워커 세션 줄과 같은 자다: `current`가
    // 그 `session_id`가 된다). 아직 한 번도 안 돈 스케줄은 `session_id`가 빈 문자열이라 여기
    // 걸리지 않는다 — 그 줄을 고르는 것은 화면이 로컬로 처리한다(§비주얼 §62 (6)).
    home.schedules.some((s) => s.session_id === sessionId) ||
    (await workerSessionsById(projectId)).some((w) => w.id === sessionId);
  if (!known) return false;
  await writeHome(projectId, { ...home, current: sessionId });
  return true;
}

// ── 워커 세션 목록 (§7 좌측 패널 — 요구 `48b13597` 답 3=(c)) ────────────────
//
// **저장소를 만들지 않는다** — 대화 목록과 같은 선이다. 워커 세션의 열쇠(`session_id`)는 이미
// 티켓 fm에 있고(엔진이 claim할 때 쓴다) 내용은 트랜스크립트가 정본이다. 여기서 하는 일은
// **큐에서 파생**하는 것뿐이라 이 목록에는 폴링 주기도 캐시도 없다.

/** 좌측 패널의 워커 세션 한 줄. 대화 한 줄(`Conversation`)과 자리가 같고 출처가 다르다 —
 *  저건 우리가 쓴 파일이고 이건 큐에서 파생된다. */
export type WorkerSession = {
  /** 티켓 fm의 `session_id`. `--resume` 인자이자 트랜스크립트 열쇠다 —
   *  **`sessionIdOf`를 통과한 값만** 이 목록에 든다(경로가 되는 값의 관문이 그 함수 하나다) */
  id: string;
  /** `owner:`의 워커 이름(`workerOf`). 형식이 아니면 **빈 문자열**이다 —
   *  모르는 것을 `?`로 그리지 않는다(§1 보드와 같은 선). 화면이 빈 값을 감춘다 */
  worker: string;
  /** 티켓 제목. `title:` 없는 fm이면 빈다 */
  title: string;
  /** 티켓 식별자. 화면이 티켓 상세로 거는 링크가 이것이다(§식별자 — 표시값 `hash`가 아니다) */
  stem: string;
  /** 티켓 **표시값**(`fm.ticket || 파일명`). 줄에 적히는 해시가 이것이다(§식별자) —
   *  `ticket:`이 파일명과 갈린 티켓에서 링크(`stem`)와 글자가 다를 수 있다 */
  hash: string;
  /** `.wip` = 지금 도는 세션. 목록에서 **먼저 온다** */
  running: boolean;
};

/** §7: 끝난 세션은 **최근 10개**(대화 20과 같은 자리에 두는 수다 — 세지 않으면 티켓 수백 장이
 *  좌측에 뜬다). 도는 것(`.wip`)은 안 자른다: 그건 지금 이 큐의 사실이고 워커 수만큼이다. */
const WORKER_SESSION_LIMIT = 10;

/** 큐 → 워커 세션 목록. **순수 함수다**(`renderSnapshot`과 같은 선 — fs를 안 탄다).
 *
 *  열린 티켓은 안 든다: 상태 셋 중 세션이 붙은 것은 `.wip`(도는 중)과 `.done`(끝난 기록)이다.
 *  `reap`이 되돌린 티켓의 `session_id`는 그 세션이 실패한 기록이라 목록에 세우지 않는다. */
export function workerSessions(tickets: Ticket[]): WorkerSession[] {
  const rows = (state: Ticket["state"]) =>
    tickets
      .filter((t) => t.state === state)
      .sort((a, b) => b.mtime - a.mtime) // 최신순. filter가 새 배열을 줘서 제자리 정렬이 안전하다
      .flatMap((t) => {
        const id = sessionIdOf(t.fm);
        if (!id) return []; // 키 없음 · 사람이 손으로 쓴 값 — 둘 다 없는 줄이다
        return [
          {
            id,
            worker: workerOf(t.fm.owner ?? "") ?? "",
            title: t.title,
            stem: t.stem,
            hash: t.hash,
            running: state === "wip",
          },
        ];
      });
  return [...rows("wip"), ...rows("done").slice(0, WORKER_SESSION_LIMIT)];
}

/** 한 프로젝트의 워커 세션 목록. **못 읽으면 빈 목록이다** — 패널 전용 실패를 만들지 않는다
 *  (§비주얼 §24 다섯 상태 에러: 큐를 못 읽는 사건은 §4-1 3번이 본문을 통째로 사유 블록으로
 *  바꾸고 패널도 같이 없다).
 *
 *  // ponytail: 폴링(500ms)마다 큐를 다시 읽는다. `listTickets`가 mtime+size 캐시를 들고 있어
 *  //           두 번째부터는 파일당 `stat` 하나이고, 그 대가로 `.wip` → `.done`이 답이 도는
 *  //           중에도 목록에 붙는다. 무거워지면 첫 응답과 전환 응답에만 담는다. */
async function listWorkerSessions(project: Pick<Project, "root">): Promise<WorkerSession[]> {
  try {
    return workerSessions(await listTickets(project.root, await resolveConfig(project)));
  } catch {
    return [];
  }
}

/** 같은 것을 프로젝트 id로 — 등록이 풀렸으면 큐 루트를 모르므로 빈 목록이다. */
async function workerSessionsById(projectId: string): Promise<WorkerSession[]> {
  const project = await getProject(projectId);
  return project ? listWorkerSessions(project) : [];
}

// ── 상태 스냅샷 (§7 표) ─────────────────────────────────────────────────────
//
// **아는 것 중 대부분은 에이전트가 직접 읽는다** — repo·프로토콜·스펙·티켓 본문은 전부 파일이라
// 읽기 도구로 닿는다. GUI가 하는 일은 **어디를 보라고 짚는 것**이지 내용을 프롬프트에 복사하는
// 것이 아니다(이 레포의 스펙 문서 하나가 9천 줄이다).
//
// 파일이 아닌 것 하나가 여기 든다: "w2가 지금 무슨 일을 하나"는 락 디렉터리 · `.wip` 소유자 ·
// `TICKET_ENGINE` 해석의 합이다. 그 판정은 새로 쓰지 않고 `listWorkers`·`statusOf`·`isAwaiting`·
// `engineCell`을 그대로 부른다 — 화면과 다른 수를 말하면 이 에이전트는 거짓말을 한다.

export type SnapshotInput = {
  project: Pick<Project, "name" | "root">;
  config: ProjectConfig;
  tickets: Ticket[];
  workers: Worker[];
  /** 이번 턴에 새 요구사항 티켓을 쓸 때 쓰는 8-hex(§7 §해시는 사람이 손으로 안 민다). 서버
   *  (`snapshotOf`)가 밀고 충돌 검사까지 마친 값을 인자로 받는다 — 여기서 `crypto`를 안 탄다. */
  newTicketHash: string;
};

/** 스냅샷 문자열. **순수 함수다**(fs를 안 탄다) — `home-agent.test.ts`가 이걸 검증한다.
 *
 *  `readSummary`를 부르지 않고 같은 판정 함수를 직접 부른다: 저건 `listWorkers`를 **티켓 없이**
 *  불러서 `holding`이 항상 null이고(§7 표가 요구하는 "물고 있는 티켓"이 통째로 빈다), 여기서
 *  다시 부르면 큐를 두 번 읽는다. 세는 식(`state === "open"` …)은 그 파일과 글자로 같다. */
export function renderSnapshot({ project, config, tickets, workers, newTicketHash }: SnapshotInput): string {
  const count = (s: Ticket["state"]) => tickets.filter((t) => t.state === s).length;
  const title = (stem: string) => tickets.find((t) => t.stem === stem)?.title ?? "";

  const rows = workers.map((w) => {
    const e = engineCell(w.engine);
    // `assumed` = 워커 파일에 `TICKET_ENGINE` 대입이 아예 없다(= tick.sh 기본값이 실제로 돈다).
    // `custom` = 카탈로그와 안 맞는 손편집. 둘 다 사실이라 라벨 옆에 그대로 적는다(§비주얼 §23 ①).
    const engine = e.badge ? `${e.label} (${e.badge === "assumed" ? "기본값 가정" : "커스텀"})` : e.label;
    // 제목이 비는 티켓이 있다(`title:` 없는 fm) — 그때 `— ` 꼬리를 남기지 않는다
    const held = w.holding ? [w.holding, title(w.holding)].filter(Boolean).join(" — ") : "—";
    return `| ${w.name} | ${w.status} | ${w.cron ? "등록" : "미등록"} | ${engine} | ${held} |`;
  });

  return [
    "# 지금 이 프로젝트의 상태",
    "",
    "GUI가 **이 질문을 보내는 순간** 큐에서 읽어 조립한 스냅샷이다. 아래 수치는 지금 값이고,",
    "여기 없는 것은 파일을 직접 읽어서 답한다.",
    "",
    `- 프로젝트: ${project.name}`,
    `- 큐 루트: ${project.root}`,
    `- 작업 디렉터리(= 이 세션의 cwd): ${path.dirname(project.root)}`,
    `- 상태 접미사: 진행중 \`${config.inProgress}\` · 완료 \`${config.done}\` (접미사가 없으면 열린 티켓)`,
    "",
    `## 티켓 ${tickets.length}건`,
    "",
    `- 열림 ${count("open")} · 진행중 ${count("wip")} · 완료 ${count("done")}`,
    `- 할당됨 ${tickets.filter((t) => statusOf(t) === "assigned").length}건` +
      ` · 답변 대기 ${tickets.filter(isAwaiting).length}건`,
    "",
    `## 워커 ${workers.length}개`,
    "",
    ...(workers.length === 0
      ? ["워커가 없다 — 이 큐는 아무것도 디스패치하지 않는다."]
      : [
          "| 워커 | 상태 | cron | 엔진 | 물고 있는 티켓 |",
          "|---|---|---|---|---|",
          ...rows,
          "",
          "상태 4종: `running`(락 있음 + pid 생존) · `idle`(락 없음 + cron 등록) ·",
          "`stopped`(락 없음 + cron 미등록) · `stale`(락 있음 + pid 죽음, 회수 대상).",
        ]),
    "",
    "## 여기 없는 것은 이 파일들을 읽어라",
    "",
    `- 티켓 전부: \`${path.join(project.root, "tickets")}/\` — 파일명이 곧 상태다`,
    `- 새 요구사항 티켓 해시(이번 턴 한 번 · 8-hex · 큐에 없는 값): \`${newTicketHash}\``,
    `- 프로토콜: \`${config.protocols}/\``,
    `- 페르소나: \`${config.personas}/\``,
    `- 제품 스펙(단일 출처): \`${path.join(path.dirname(project.root), "docs/DESIGN.md")}\``,
    `- 엔진 계약: \`${path.join(path.dirname(project.root), "README.md")}\``,
  ].join("\n");
}

/** 큐를 한 번 읽어 스냅샷을 만든다. 못 읽으면 **사유를 그대로 담은 스냅샷**이다 — 던지면
 *  질문 자체가 사라지고, 삼키면 에이전트가 "워커가 없다"고 거짓알려 준다(§6 에러 3요소).
 *
 *  **새 티켓 해시도 여기서 민다**(§7 §해시는 사람이 손으로 안 민다) — 큐를 못 읽으면 안 민다:
 *  쓰기도 못 하는 자리에서 못 쓸 값을 실어 주면 에이전트가 그걸 믿는다. 그래서 실패 갈래의
 *  스냅샷 문자열에는 그 줄이 없다. */
export async function snapshotOf(project: Pick<Project, "name" | "root">): Promise<string> {
  try {
    const config = await resolveConfig(project);
    const tickets = await listTickets(project.root, config);
    const workers = await listWorkers(project.root, tickets);
    // 충돌 검사가 공짜다 — `tickets`를 이미 손에 들고 있다(§7 §해시는 사람이 손으로 안 민다).
    const stems = new Set(tickets.map((t) => t.stem));
    let newTicketHash = randomUUID().slice(0, 8);
    while (stems.has(newTicketHash)) newTicketHash = randomUUID().slice(0, 8);
    return renderSnapshot({ project, config, tickets, workers, newTicketHash });
  } catch (e) {
    return [
      "# 지금 이 프로젝트의 상태",
      "",
      `**큐를 읽지 못했다**: ${(e as Error).message}`,
      `- 큐 루트: ${project.root}`,
      "",
      "워커·티켓 수는 모른다. 모르는 것을 추측해서 답하지 마라.",
    ].join("\n");
  }
}

/** 프롬프트 안에서 **사람이 쓴 질문**이 시작하는 자리. `buildPrompt`가 붙이고 `questionOf`가
 *  떼어낸다 — 상수 하나를 두 함수가 나눠 쓰는 것이 스냅샷 수천 자가 말풍선에 뜨지 않는 이유다.
 *  스냅샷 쪽에는 이 문자열이 나타날 수 없다(그 글의 `##` 절 이름은 넷이고 표 행은 한 줄짜리다). */
const QUESTION_MARK = "\n## 질문\n\n";

// ── 페르소나 (§5-3 · §7 §페르소나가 실린다) ─────────────────────────────────

/** 홈 에이전트가 도는 페르소나(§5-3). **큐가 고르는 값이 아니다** — 워커 쪽은 티켓 fm의
 *  `persona:`가 고르고 여기는 하나로 고정이다(§5-3 §입구가 둘이고 PROFILE은 한 벌이다:
 *  두 입구가 **같은 세 파일**을 읽고 갈리는 것은 도구와 커밋 권한뿐이다). */
const HOME_PERSONA = "archive-manager";

/** 페르소나 세 조각을 **`tick.sh:265`와 같은 순서**로 읽어 한 블록으로 만든다 —
 *  `PROFILE.md` → `skills.md` → `memory/*.md`(**한 단계** 글롭 · 이름 오름차순).
 *
 *  **`buildPrompt` 밖에서 읽는다.** 저 함수는 순수로 남아야 하고(`home-agent.test.ts`가 그걸
 *  검증한다) fs를 들이는 순간 그 테스트가 죽는다 — 그래서 조립된 문자열을 인자로 넘긴다.
 *
 *  **파일이 없으면 빈 문자열이고 WARN도 없다**(§7). `PROFILE.md`가 없으면 사이드카도 안 싣는다 —
 *  `tick.sh`가 `persona:`가 빈 티켓에 내린 판정과 같은 선이고, 스캐폴딩 전 큐·옛 큐에서 홈 화면이
 *  그대로 도는 근거가 이것이다(이 티켓이 `39ee5ae0` 없이 먼저 들어도 되는 이유다). */
export async function personaBlock(personasDir: string, name: string = HOME_PERSONA): Promise<string> {
  const dir = path.join(personasDir, name);
  const read = (...p: string[]) => readFile(path.join(dir, ...p), "utf8").catch(() => null);

  const profile = await read("PROFILE.md");
  if (profile === null) return "";

  const skills = await read("skills.md");
  // 글롭이 한 단계인 것은 tick.sh와 같다(`memory/<하위>/x.md`는 안 읽는다). 디렉터리 이름이
  // `*.md`여도 `readFile`이 EISDIR로 떨어져 null이 되므로 `[ -f ]` 검사가 따로 필요 없다.
  const memDir = path.join(dir, "memory");
  const mem: string[] = [];
  for (const f of (await readdir(memDir).catch(() => [] as string[])).filter((n) => n.endsWith(".md")).sort()) {
    const body = await readFile(path.join(memDir, f), "utf8").catch(() => null);
    if (body !== null) mem.push(`--- ${f}\n${body}`);
  }

  return [
    `당신은 이 프로젝트의 '${name}'입니다. 아래 프로필이 당신의 역할·권한·판단 기준이고,`,
    "이 대화 내내 이 페르소나로 일관되게 행동하세요.",
    "",
    `===== ${name} PROFILE (${path.join(dir, "PROFILE.md")}) =====`,
    profile,
    "===== PROFILE 끝 =====",
    ...(skills === null
      ? []
      : ["", `===== ${name} 스킬 (${path.join(dir, "skills.md")}) =====`, skills, "===== 스킬 끝 ====="]),
    ...(mem.length === 0 ? [] : ["", `===== ${name} 메모리 (${memDir}) =====`, ...mem, "===== 메모리 끝 ====="]),
  ].join("\n");
}

/** 페르소나 + 스냅샷 + 경계 + 질문. **순수 함수다**(fs를 안 탄다 — 읽기는 `personaBlock`이
 *  밖에서 하고 조립된 문자열이 인자로 온다). **질문마다 새로 붙인다** — 세션 첫 턴에만 넣으면
 *  두 번째 질문부터 낡은 상태를 알려 준다(§7).
 *
 *  **종전 고정 지시문(`너는 이 큐를 보는 GUI의 질의응답 에이전트다 …`)은 죽었다**(§7 §페르소나가
 *  실린다). PROFILE과 정면으로 부딪쳐서다 — 저 문단은 *티켓을 고치지 않는다*고 적었고 이 페르소나가
 *  하는 일이 **티켓 본문에 링크를 다는 것**이다(§5-3 산출물 ③). 누구인지는 이제 PROFILE이 알려 준다.
 *
 *  **경계 문장은 살아 있다.** 플래그가 막는 것과 별개로 글이 필요한 이유는 종전과 같다: **막힌 것을
 *  두드리다 답을 못 하고 끝나는 턴**은 사람에게 그냥 고장으로 보인다. 그 자리가 `worktrees/**`와
 *  repo 전부다(개정 `22a803de`로 repo 쪽 예외가 0이 됐다).
 *
 *  **§7-3(요구 `b100a3aa`)이 셸 문단을 하나 더 얹는다.** `Bash`가 열려도 읽고 세는 것만
 *  되고(`BASH_ALLOWED`) 쓰는 명령은 거부되는 것을 글로도 적는다 — 근거는 위와 같다. 목록을
 *  전재하지 않는다(정본은 플래그다) — 글이 지는 것은 *우회하지 않는다* 하나뿐이라 기존 문장을
 *  그대로 재사용한다.
 *
 *  **`tickets/**`에 `Write`가 붙은 자리는 종전과 다르게 진다**(요구 `64b45d3c` — §7 §홈 대화에서
 *  요구사항이 접수된다). 플래그의 경로 스코프는 파일 내용을 못 보므로 *`kind: request`만 만든다*는
 *  제약을 여기 프롬프트 글이 진다 — §7 §`kind`를 지는 것이 글이다가 정한 그 자리다. 경로를
 *  절대경로로 안 쓰는 것은 스냅샷이 이미 큐 루트를 적어 주기 때문이다.
 *
 *  **`ontologyDir`은 예외 — 절대경로 그대로 적는다.** 나머지 다섯은 큐 루트 기준이라 상대
 *  글롭으로 충분하지만, 온톨로지는 재정의한 큐에서 큐 밖을 가리킬 수 있어(요구 `85114387`
 *  §결정 4) 상대 표기로 못 박으면 에이전트가 큐 루트 아래 옛 자리를 판다. */
export function buildPrompt(snapshot: string, question: string, ontologyDir: string, persona = ""): string {
  return `${persona ? `${persona}\n\n` : ""}${snapshot}

---

**고칠 수 있는 것은 이것뿐이다** — 큐 루트 아래 \`personas/**\` · \`protocols/**\` ·
\`workers/*.sh\` · \`AGENTS.md\`, 그리고 온톨로지 \`${ontologyDir}/**\`. 그 밖(\`worktrees/**\` 아래
프로젝트 코드 · repo 나머지 · 여기 없는 자리 전부)은 도구가 거부한다. 거부되면 우회하지 말고
무엇이 왜 막혔는지 그대로 알려 준다.

**셸로는 읽고 세는 것만 된다.** 로그를 자르고 세고 줄 세우는 읽기 전용 명령만 돌고, 쓰는
명령(파일을 만들거나 덮어쓰거나 리다이렉트하는 것)은 거부된다. 거부되면 우회하지 말고 무엇이
왜 막혔는지 그대로 알려 준다.

**\`tickets/**\`에는 새 파일도 쓸 수 있다 — 사람이 그 턴에 요구사항으로 올려 달라고 했을
때만.** 그때 만드는 것은 \`kind: request\` 티켓 하나뿐이다(\`work\`·\`feedback\`·\`answer\`는
안 만든다). 해시는 위 스냅샷이 준 새 티켓 해시를 그대로 쓴다(직접 짓지 않는다) — 쓰기 전에
\`Glob\`으로 그 이름이 아직 큐에 없는지 한 번 더 본다. **있는 티켓 파일은 \`Write\`로 덮지
않는다** — 본문을 고치는 것은 여전히 \`Edit\`이다. 본문은 두 층이다: 사람이 말한 문장 그대로
(고쳐 쓰지 않는다) 다음에 \`## 맥락\` 절(이 요구가 나온 대화의 맥락, 사람의 말은 인용으로
표시). 형식:

\`\`\`
---
ticket: <위 스냅샷이 준 새 티켓 해시>
title: <사람의 요구 한 줄, 80자에서 자른다>
kind: request
persona: pm
---

<사람이 말한 문장 그대로>

## 맥락 - 홈 대화에서 옮겼다
<이 요구가 나온 대화의 맥락. 사람의 말은 인용으로 표시한다>
\`\`\`
${QUESTION_MARK}${question}`;
}

/** 트랜스크립트의 사용자 프롬프트 → **사람이 쓴 질문**. 앞의 스냅샷·지시문을 떼어낸다.
 *  표식이 없으면(우리가 안 만든 세션, 사람이 터미널에서 이어 쓴 턴) 전문을 그대로 그린다 —
 *  거기서 잘라내면 화면이 그 턴을 통째로 삼킨다. `indexOf`인 것은 위 상수 주석의 근거다. */
export function questionOf(prompt: string): string {
  const i = prompt.indexOf(QUESTION_MARK);
  return (i < 0 ? prompt : prompt.slice(i + QUESTION_MARK.length)).trim();
}

// ── 실행 ────────────────────────────────────────────────────────────────────

/** §비주얼 §24 실패 5종의 **코드**. 화면이 제목·다음 행동을 이걸로 가른다 —
 *  `output` 문장을 되짚어 갈리면 문구 한 자를 고치는 날 화면이 조용히 뭉친다
 *  (`InterjectReason`과 같은 규약). `other`는 §24 표에 항이 없는 나머지다.
 *
 *  **`timeout`은 이름이 낡았다 — 값은 안 바꾼다.** 시계가 걷힌 뒤(요구 `8db4d0f6` — §7
 *  §천장이 없다) 이 사유는 **③이 재정의된 자리**로 옮겨 간다: "5분을 넘겼다"가 아니라
 *  "자식이 결과 객체 없이 죽었다"다(아래 `judge`의 `!result` 분기). 화면 쪽(`home-ui.tsx`
 *  `FAIL.timeout`)이 이 문자열 키로 걸려 있어(§24 문구 갈이는 4c8e82d8) 여기서 이름을 갈면
 *  그 파일까지 손대야 한다 — 값의 뜻만 바꾸고 키는 그대로 둔다. */
export type AnswerReason = "spawn" | "auth" | "timeout" | "busy" | "no-transcript" | "other";

/** `Run`(`lib/engine.ts`)과 **같은 모양**에 세션 두 값을 더한 것. rc와 사유를 삼키지 않는다. */
export type Answer = Run & {
  /** 이 답이 들어간 세션. 화면이 `findTranscript`에 그대로 넘긴다 */
  sessionId: string;
  /** 이어붙인 질문인가(`--resume`) — 첫 질문이면 false */
  resumed: boolean;
  /** 실패했을 때만. 성공에는 갈릴 것이 없다 */
  reason?: AnswerReason;
  /** 사람이 `중지`를 눌러 끝났다. **`ok: true`이고 `reason`이 없다** — §7이 고정한 그대로
   *  실패 5종에 여섯 번째를 만들지 않는다(사람이 한 일은 고장이 아니다). 받은 데까지는
   *  트랜스크립트에 남으므로(실측 ⑵) 화면이 지울 것도 없다 */
  stopped?: boolean;
};

/** §7 §천장이 없다 §안심 장치 — 표식이 지금 하는 일을 말하는 값 하나. **이력이 아니다**
 *  (마지막 활동 하나만 든다 — 트랜스크립트가 이미 정본이다). `eatLine`이 종전에 버리던
 *  `thinking_delta`·도구 이벤트가 여기로 접힌다. 문구·그릇은 화면 결선(4c8e82d8)의 것이다 —
 *  이 칸은 **구분값 + 도구 이름**까지만 낸다.
 *
 *  **`tool`의 `tool` 필드는 이름뿐이다 — "대상"(예: `docs/DESIGN.md`)은 아직 없다.** 설계는
 *  `input_json_delta`가 도구 인자를 나르는 것을 안다(`88ff08f8`이 `{"file_path": "…`를 이미
 *  봤다 — 머리 주석 §답은 흐른다 인용) 그런데 그 파편을 모아 JSON으로 완성하는 시점
 *  (`content_block_stop`)과 키 이름(`file_path`·`pattern`·…)이 도구마다 갈리는 것은 **이
 *  티켓의 계정이 주간 한도로 막혀 실측하지 못했다**(`## 블록` 참조) — 잘못 짚으면 조용히
 *  아무 값도 안 잡힐 뿐이라 대상 없이 이름만 먼저 낸다. */
export type Activity = { kind: "thinking" } | { kind: "tool"; tool: string } | { kind: "answering" };

/** 트랜스크립트의 **마지막 사건 하나**를 위 활동 3종으로 옮긴다(§7 §도는 워커 세션은 스레드에서도
 *  돈다 — 요구 `161a881e`). 남의 프로세스(워커 세션)에는 `Live` 핸들이 없어서 이 값이 유일한
 *  출처다 — 우리 자식이 스트림 델타로 채우는 `live.activity`와 자리는 같고 재료만 다르다.
 *
 *  `thinking` 말고 나머지 전부(`text`·`tool_result`·`prompt`·`interject`)가 `answering`으로
 *  뭉치는 것이 값이다 — §2-6 ③의 두 문구(`생각하는 중`·`따라가는 중`)를 안 가져오는 것과 같은
 *  근거로, 이 요구가 지목한 낱말이 홈 §24의 셋(`생각 중`·도구 이름·`답하는 중`)이다. */
export const activityFromEvent = (event: StreamEvent | null): Activity | null =>
  event === null
    ? null
    : event.kind === "thinking"
      ? { kind: "thinking" }
      : event.kind === "tool_use"
        ? { kind: "tool", tool: event.label }
        : { kind: "answering" };

/** 도는 질문 하나가 서버에 남기는 것 전부 — **부분 텍스트 · 활동 · 모델 · 자식 핸들 · 중지 요청**.
 *  다섯이 한 객체인 이유는 다 `runs` 맵의 수명과 같아서다(§7: 도는 동안만 있는 것). */
type Live = {
  /** 지금까지 받은 글(`text_delta` 누적). 도는 동안만 화면이 받는다 — 끝나면 정본은 트랜스크립트다 */
  partial: string;
  /** 지금 하는 일 하나(§7 §안심 장치). 아무 신호도 안 왔으면 `null` */
  activity: Activity | null;
  /** 세션이 스스로 말한 모델(§7 §세션 정보 한 줄) — `system`/`init` 레코드의 `model` 필드
   *  (아래 `eatLine` 주석이 출처를 실측했다). 첫 신호 뒤로는 안 바뀐다 — 세션 내내 모델
   *  지정이 고정이라 두 번째 값을 볼 일이 없다 */
  model: string | null;
  /** `중지`가 `SIGTERM`을 보낼 대상. spawn 전과 종료 후에는 null이다 */
  child: ChildProcess | null;
  /** 사람이 멈췄다. spawn보다 먼저 눌렸을 수도 있어서 **핸들이 아니라 이 플래그**가 근거다 */
  stopping: boolean;
  /** 트랜스크립트가 이미 들인 답 중 아직 겹침 판정을 안 거친 마지막 텍스트(§7 §누적기를 비우는
   *  자리 — 실측 `2cad40e3`). CPU 경합에서 `delta`가 `keep`보다 늦게 처리되면, 답 줄이 `turns`로
   *  넘어간 그 폴링에서는 `partial`이 아직 비어 있어 겹침 판정이 못 걸리고, 다음 폴링에 `partial`이
   *  뒤늦게 채워질 땐 그 답 줄이 이미 소비돼 이 폴링의 `turns`엔 없다 — 폴링 하나짜리 지역 비교로는
   *  이 창을 못 잡는다. `message_start`에서 `partial`과 함께 비운다(새 라운드가 시작되면 옛 값과
   *  더는 비교하지 않는다). */
  lastAnswer: string | null;
};

const newLive = (): Live => ({
  partial: "",
  activity: null,
  model: null,
  child: null,
  stopping: false,
  lastAnswer: null,
});

/** 질문 하나 = 프로세스 하나(§7). 첫 질문이 세션을 열고 다음 질문이 그것을 잇는다.
 *
 *  **cwd는 큐의 부모**(`dirname(project.root)`)다 — 등록값이 `<프로젝트>/.dira`라 그 부모가 repo다.
 *  트랜스크립트 디렉터리 이름도 이 cwd에서 나오므로 여기를 바꾸면 §2-1 읽기 코어가 못 찾는다.
 *
 *  **동시 실행을 막지 않는다**(§7 §대화마다 따로 돈다). 잠금의 단위는 **한 대화에 한 질문**이고
 *  그 판정은 `startAsk`에 있다 — 여기에 큐잉 층도 동시 상한도 만들지 않는다. */
export async function ask(
  project: Pick<Project, "id" | "name" | "root">,
  question: string,
  live: Live = newLive(),
  /** 질문이 들어갈 세션을 **밖에서 정해 온다.** `startAsk`가 `runs`에 등록할 키가 이 값이라
   *  그쪽이 `beginTurn`을 먼저 부른다(§7 §서버가 갈리는 자리 넷 ②). 안 주면 여기서 정한다 —
   *  이 함수를 그대로 부르는 자리(테스트)가 종전과 같이 돈다. */
  turn?: { sessionId: string; resumed: boolean },
): Promise<Answer> {
  // **동기로 판정한다** — `readLanguage()`(fs 읽기)를 아직 안 문다: 실패 ①(spawn)은 이 자리에서
  // 즉시 끝나야 하는 계약이다(`home-agent.test.ts` "한 대화에 한 질문" — 폴링 없이 그 자리에서
  // `isAsking() === false`). 이 두 문구는 그래서 `DEFAULT_LOCALE`로 고정한다(원래도 로케일이
  // 없던 자리다) — 실제 로케일은 아래 시스템 프롬프트 자리에서만 읽는다.
  const q = question.trim();
  if (!q) {
    return {
      ok: false,
      reason: "other",
      output: t(DEFAULT_LOCALE, "home.errors.emptyQuestion"),
      sessionId: "",
      resumed: false,
    };
  }

  // `claude`를 우리가 PATH에서 찾는다 — 셸에 맡기면 손에 남는 게 rc 127뿐이다(§0-4 `bcf66f01`).
  const bin = findClaude();
  if (!bin) {
    return {
      ok: false,
      reason: "spawn",
      output: `${t(DEFAULT_LOCALE, "home.errors.claudeNotFoundPrefix")}${process.env.PATH ?? ""})`,
      sessionId: "",
      resumed: false,
    };
  }

  const { sessionId, resumed } = turn ?? (await beginTurn(project.id, q));
  // 페르소나·온톨로지 둘 다 워커 스크립트가 옮길 수 있다(`TICKET_PERSONAS`·`TICKET_ONTOLOGY`) —
  // 기본값을 여기 다시 쓰지 않고 `resolveConfig`가 해석한 값을 그대로 쓴다(고정 함수를 안 둔다 —
  // DESIGN.md §5-3). 못 읽으면 페르소나 없이, 온톨로지는 기본 자리(`<root>/ontology`)로 간다
  // (§7: WARN 없다 — 큐를 못 읽는 사건은 `snapshotOf`가 이미 사유를 담아 알려 준다).
  const config = await resolveConfig(project).catch(() => null);
  const ontology = config?.ontology ?? path.join(project.root, "ontology");
  const prompt = buildPrompt(
    await snapshotOf(project),
    q,
    ontology,
    config?.personas ? await personaBlock(config.personas) : "",
  );
  const locale = await readLanguage(); // 위 §언어 층 둘 — 못 읽으면 `ko`로 흡수한다(같은 판정)

  const run = await runClaude(
    bin,
    project.root, // 큐 루트 하나로 cwd(그 부모)와 경로 스코프 다섯이 같이 나온다 — 둘이 갈릴 자리가 없다
    ontology,
    prompt,
    [...(resumed ? ["--resume", sessionId] : ["--session-id", sessionId])],
    live,
    locale,
  );

  // **중지는 여기서 실패가 아니다**(`ok: true`): 중지한 턴도 트랜스크립트에 남고 같은 sid로
  // `--resume`이 그대로 돈다(실측 ⑵⑶) — id를 갈면 다음 질문이 그 대화를 잃는다.
  if (!resumed) await settleFirstTurn(project.id, sessionId, run.ok);
  // **성공한 턴에서만 적는다**(§7 §세션 정보 한 줄). 실패한 첫 턴은 방금 `settleFirstTurn`이
  // id를 새것으로 갈아서, 그 id 아래 적어도 다음 질문이 여는 새 세션과 무관한 값이 된다.
  if (run.ok && live.model) await saveModel(project.id, sessionId, live.model);

  return { ...run, sessionId, resumed };
}

/** 질문이 돌기 **전에** 파일에 남는 것: 줄 하나와 제목. 끝난 뒤에 쓰면 도는 동안 화면이 폴링할
 *  sid가 없다(§7).
 *
 *  `current`가 없으면(첫 질문 · 파일이 빈 상태) 여기서 줄을 연다 — 사람이 `새 대화`를 누르지
 *  않고 그냥 물었을 때의 경로다. **제목은 첫 질문의 첫 줄**이고(`reqTitle` — 요구 접수 모드와
 *  같은 자, 80자에서 `…`) 이미 제목이 있는 대화는 안 건드린다: 제목은 그 대화의 첫 질문이지
 *  마지막 질문이 아니다. */
async function beginTurn(projectId: string, question: string): Promise<{ sessionId: string; resumed: boolean }> {
  const home = await readHome(projectId);
  const cur = home.conversations.find((c) => c.id === home.current);
  // **대화 목록에 없는 `current` = 워커 세션이다**(§7 좌측 패널 — 답 1(b)·2(c)). 그 sid를 그대로
  // 이어붙이고 **파일을 한 바이트도 안 건드린다**: `conversations`에 줄이 생기면 워커 세션이
  // 사람 대화 20을 밀어낸다. 제목도 안 쓴다 — 이 줄의 이름은 큐에 있다(티켓 제목).
  if (!cur && home.current) return { sessionId: home.current, resumed: true };
  const row = cur ?? openRow();
  const next: Conversation = { ...row, title: row.title || reqTitle(question) };
  await writeHome(
    projectId,
    cur
      ? { ...home, conversations: home.conversations.map((c) => (c.id === cur.id ? next : c)) }
      : append(home, next),
  );
  return { sessionId: next.id, resumed: !next.fresh };
}

/** 세션을 **여는** 질문이 끝난 뒤. 성공이면 그 줄은 이제 열린 세션이다(다음 질문은 `--resume`).
 *
 *  실패면 **id만 새것으로 갈고 줄은 남긴다.** 안 열린 세션에 `--resume`을 걸면 다음 질문도 실패하고
 *  (그게 종전에 줄을 통째로 지우던 이유다), 반대로 그 uuid를 그대로 두면 이미 뜬 세션에
 *  `--session-id`를 다시 거는 경우(타임아웃·인증 실패는 세션이 먼저 생긴다)가 남는다. 새 uuid는
 *  둘 다 아니다. 사람이 연 줄과 제목은 그대로 남는다 — 다음 질문이 그 자리에서 다시 연다. */
async function settleFirstTurn(projectId: string, sessionId: string, ok: boolean): Promise<void> {
  const home = await readHome(projectId);
  const row = home.conversations.find((c) => c.id === sessionId);
  if (!row) return; // 도는 사이에 `새 대화`·전환이 있었다 — 남의 줄을 고치지 않는다
  const next: Conversation = ok
    ? { id: row.id, title: row.title, created: row.created }
    : { ...row, id: randomUUID() };
  // **`runs`의 키가 그 줄을 따라간다**(§7 §서버가 갈리는 자리 넷 ①: 키가 session id다).
  // 실패한 첫 턴은 여기서 id를 갈므로, 안 걸어 두면 그 대화를 여는 폴링이 `runs.get(<새 id>)`에서
  // 아무것도 못 찾고 **실패 5종이 사람에게 한 번도 안 보인다.** 객체를 그대로 걸므로
  // `startAsk`의 `.then`이 채우는 `result`는 새 키 아래에도 들어간다(같은 객체다).
  //
  // **옛 키를 여기서 떼지 않는다**(플레이크 `083fb571`). 폴링은 **파일을 읽고 맵을 읽으므로**
  // 둘이 어긋나는 순간이 있으면 그 틈의 폴링이 `entry === undefined`를 보고 `running: false`를
  // **실패 없이** 돌려준다 — 화면이 `pollDone`(= `!running && turns.length > 0`)으로 폴링을 끊는
  // 자리라, 트랜스크립트가 이미 있는 첫 턴 실패(가령 답 없이 죽은 세션 — §7 §천장이 없다 실패 ③)면
  // 그 실패가 영영 안 뜨고 다음 질문이 실패 ④로 막힌다. 떼는 쪽을 뒤로 미뤄도 창은 반대편에 그대로
  // 생긴다(파일이 새 id인데 맵은 옛 id다). 그래서 **두 키가 동시에 같은 객체를 가리키게 두고**,
  // 결과를 집어 가는 폴링이 그 객체를 가진 키를 전부 지운다(`dropRun`). 옛 키는 그 줄이 파일에서
  // 이미 갈려 다시 안 잡힌다.
  const entry = runs.get(sessionId);
  if (entry && next.id !== sessionId) runs.set(next.id, entry);
  await writeHome(projectId, {
    ...home,
    conversations: home.conversations.map((c) => (c.id === sessionId ? next : c)),
    current: home.current === sessionId ? next.id : home.current,
  });
}

/** 세션이 스스로 말한 모델을 그 대화 줄에 한 번 적는다(§7 §세션 정보 한 줄). 이미 같은 값이
 *  적혀 있으면 다시 안 쓴다 — 모델은 세션 내내 고정이라 매 턴 갈아 끼울 이유가 없다. */
async function saveModel(projectId: string, sessionId: string, model: string): Promise<void> {
  const home = await readHome(projectId);
  const row = home.conversations.find((c) => c.id === sessionId);
  if (!row || row.model === model) return;
  await writeHome(projectId, {
    ...home,
    conversations: home.conversations.map((c) => (c.id === sessionId ? { ...c, model } : c)),
  });
}

/** 스트림 끝의 결과 객체(`{"type":"result"}`). 성패·사유가 **이 한 줄에 다 있다**(실측). */
type ResultLine = { is_error?: unknown; result?: unknown; subtype?: unknown; api_error_status?: unknown };

/** stdout 한 줄을 먹는다 — 부분 텍스트면 `live.partial`에 붙이고, 결과 객체면 그걸 돌려준다.
 *  그 사이에 활동(§7 §안심 장치)과 모델(§7 §세션 정보 한 줄)도 `live`에 얹는다 — 종전에
 *  버리기만 하던 두 종류를 이제는 값으로 쓴다.
 *
 *  **결과를 "마지막 줄"로 집지 않는 이유**(§7 §답은 흐른다 — 실측): `--verbose`가
 *  `system`(`init`·`status`·`hook_started`·`hook_response`·`api_retry`)과 `rate_limit_event`를
 *  같은 stdout에 섞는다. 그래서 줄마다 파싱해 `type`으로 가른다.
 *
 *  붙이는 것은 **`text_delta` 한 종류뿐**이다. `thinking_delta`는 본문이 빈 문자열로 오고
 *  (`{"thinking":"","estimated_tokens":50}`) — 본문은 안 붙이되 **활동은 "생각 중"이 된다**.
 *  `input_json_delta`는 도구 인자다 — §비주얼 §24가 도구 호출 줄을 안 그린다(대상 추출은 아직
 *  없다 — `Activity` 타입 주석과 `## 블록` 참조). 도구 시작(`content_block_start`의
 *  `content_block.type === "tool_use"`)은 **미확정 후보다** — 이 티켓의 계정이 주간 한도에
 *  막혀 실측 원본 줄을 못 붙였다. 틀렸으면 이 가지는 그냥 안 걸린다(조용히 무해하다).
 *
 *  **모델의 출처는 `system`/`init` 레코드의 최상위 `model` 필드다.** 실측(이 머신, 2026-08-06,
 *  `--tools Read,Glob,Grep --strict-mcp-config --permission-mode manual --output-format
 *  stream-json --include-partial-messages --verbose`): 계정 주간 한도로 그 왕복은 `result`까지
 *  못 갔지만 `init` 줄은 한도 검사보다 먼저 찍힌다 —
 *  `{"type":"system","subtype":"init",…,"model":"claude-opus-5",…}`. `assistant.message.model`도
 *  후보였으나(§7 §천장이 없다 ④) `init`이 항상 먼저이고 매 턴 있어서 그거 하나로 충분하다. */
function eatLine(line: string, live: Live): ResultLine | null {
  type Stream = ResultLine & {
    type?: unknown;
    subtype?: unknown;
    model?: unknown;
    parent_tool_use_id?: unknown;
    event?: {
      type?: unknown;
      delta?: { type?: unknown; text?: unknown };
      content_block?: { type?: unknown; name?: unknown };
    };
  };
  let o: Stream;
  try {
    o = JSON.parse(line) as Stream;
  } catch {
    return null; // JSON이 아닌 줄(경고 등). 결과가 아니다
  }
  if (!o || typeof o !== "object") return null;
  if (o.type === "system" && o.subtype === "init" && typeof o.model === "string" && !live.model) {
    live.model = o.model;
  }
  if (o.type === "result") return o;
  // 서브에이전트 줄은 대화가 아니라 로그다 — `parent_tool_use_id`가 §2-1 `sidechain`의 자리다
  if (o.type !== "stream_event" || o.parent_tool_use_id) return null;
  const ev = o.event;
  if (ev?.type === "message_start") {
    // **메시지가 바뀌면 비운다.** `index`는 메시지 안에서만 유일하다(실측: 도구를 한 번 쓴
    // 세션에서 `index: 0`이 두 번 났다). 앞 메시지의 완결된 답은 이미 트랜스크립트에 있어서
    // 폴링이 **진짜 줄**로 데려온다 — 여기 남겨 두면 그 답이 화면에 두 벌이 된다.
    live.partial = "";
    live.lastAnswer = null;
  } else if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
    if (typeof ev.content_block.name === "string") live.activity = { kind: "tool", tool: ev.content_block.name };
  } else if (ev?.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
    live.activity = { kind: "thinking" };
  } else if (
    ev?.type === "content_block_delta" &&
    ev.delta?.type === "text_delta" &&
    typeof ev.delta.text === "string"
  ) {
    live.partial += ev.delta.text;
    live.activity = { kind: "answering" };
  }
  return null;
}

/** 결과 객체 → 성패·사유(§비주얼 §24 실패 5종). **판정이 `--output-format json` 시절과 같다** —
 *  실측에서 세 키가 stream-json의 `{"type":"result"}` 한 줄에 **글자로 같이** 있었다.
 *
 *  **`!result`는 이제 시계가 아니라 죽음이다**(요구 `8db4d0f6` — §7 §천장이 없다 실패 ③ 재정의).
 *  결과 줄 없이 `close`가 왔다 = 자식이 답 없이 끝났다. 원인 원문은 종료 코드(또는 신호) ·
 *  stderr 꼬리다 — `session <id>`는 화면이 `Answer.sessionId`로 붙인다(§24 표와 같은 자리). */
function judge(
  result: ResultLine | null,
  live: Live,
  stderr: string,
  exit: { code: number | null; signal: NodeJS.Signals | null },
  locale: Locale,
): Run & { reason?: AnswerReason } {
  if (!result) {
    const where = exit.code !== null ? `exit ${exit.code}` : `signal ${exit.signal}`;
    const tail = stderr.trim().split("\n").slice(-10).join("\n");
    return { ok: false, reason: "timeout", output: [where, tail].filter(Boolean).join(" · ") };
  }
  const text = typeof result.result === "string" ? result.result : "";
  if (result.is_error === true || !text) {
    return {
      // **인증 실패 판정은 문장이 아니라 `api_error_status`다**(§24 ②). 실측(이 머신,
      // 2026-08-01, `HOME=<빈 디렉터리>` + 못 쓰는 토큰): `is_error:true` · `subtype:"success"` ·
      // `api_error_status:401` · `result:"Failed to authenticate. API Error: 401 OAuth access
      // token is invalid."`. `subtype`이 `success`라 저 키로는 안 갈리고, 문장으로 갈리면
      // CLI가 문구를 고치는 날 이 화면이 §0-4 설정을 가리키지 못한다. **stream-json에서도 같은
      // 자리다** — `88ff08f8`이 두 형식을 나란히 재서 §7 §답은 흐른다 — 실측의 표에 적었다.
      // 그때 `stream_event`는 0건이라 `live.partial`이 비어 있다(흐르다 만 글과 구분된다).
      reason: result.api_error_status === 401 || result.api_error_status === 403 ? "auth" : "other",
      ok: false,
      // `subtype:"success"`는 위 주석대로 오탐이다 — 화면에 새는 걸 여기서 거른다.
      output:
        [text, result.subtype === "success" ? "" : String(result.subtype ?? ""), stderr.trim()]
          .filter(Boolean)
          .join("\n") || t(locale, "home.errors.emptyAnswer"),
    };
  }
  return { ok: true, output: text };
}

// ── 언어 층 둘 (§0-16 §주입 §개정 3-4) ──────────────────────────────────────
//
// `tick.sh`가 워커에 주는 두 층을 홈 세션에도 준다 — 언어 안내(로케일이 ko/en을 가른다)와
// 한국어 문장 지침(로케일을 안 가리고 상시). 워커는 이 둘을 프롬프트 문자열에 섞어 넣지만
// (캐시 갈래가 있다 — §엔진 수정 스물다섯 번째 승인) 홈은 CLI가 질문마다 새 프로세스를 띄우니
// 캐시가 없다 — 그래서 `--append-system-prompt` 하나로 두 블록을 그대로 넘긴다. `buildPrompt`는
// 안 건드린다(이 층은 시스템 프롬프트로 간다).
//
// 언어 안내 두 짝은 `tick.sh`의 `case "$LOCALE"` 블록과 **틀이 같고 산출물 목록만 다르다** —
// 홈이 실제로 쓰는 자리(`kind: request` 티켓 본문 · `personas/**` · `protocols/**` ·
// `workers/*.sh` · 온톨로지)로 갈린다. 커밋 메시지 · `docs/`는 안 적는다 — 홈은 `Bash`가 없어
// 커밋을 못 하고 `docs/`는 쓰기 스코프 밖이다. 워커 쪽 문장의 마지막 줄(지침 블록을 가리키는
// 한 줄)은 안 붙인다 — 그 줄이 산 근거(한국어 1만 줄 뒤에 묻히는 것을 막는다)가 홈의 시스템
// 프롬프트에는 없다.
//
// `FLUENT_KO`는 `tick.sh`의 `FLUENTKO` 히어독 본문과 **바이트로 같아야 한다**(`home-agent.test.ts`가
// 지킨다). 파일이 아니라 인라인 상수인 이유 · 부분 손질 금지 근거는 그 히어독 머리 주석과 같다 —
// 사본을 큐에 두면 사람이 지울 수 있고 dmg 배포에는 폴백할 엔진 레포가 없다. 갱신은 그 히어독을
// 통째로 갈아 끼울 때 이 상수도 같이 간다.
export const FLUENT_KO = `===== 한국어 문장 지침 (fluent-korean, MIT (c) 2026 snflkd) =====
당신은 한국어를 활용해야 하는 상황에 있다면 본 문서에 제시된 지침들을 준수해야 합니다. 그럼으로써 의사소통의 효율성을 높일 수 있습니다. 이 지침들은, 의미가 명확하며 비교적 가독성이 높고 안정적인 구조를 지닌 한국어 문장을 출력하는 방법을 자세히 설명합니다. 인용, 코드, 코드 주석에는 이 지침들을 적용하지 않습니다.


## 상황과 목표

- LLM은 한국어를 구사할 때 몇 가지 특징을 보이는데, 일부 특징은 결과물의 완성도를 낮추거나, 사용자가 소통에 더 많은 노력을 들이게 만듭니다. 이 문서에 작성된 사항들을 준수하면 이런 현상을 개선할 수 있습니다.

- 이 문서에서 제시하는 지침들을 요약하는 것은 일반적으로 권장되지 않습니다. 그렇게 한다면 조항마다 첨부된 예시를 확인할 수 없으므로 조항의 문구가 구체적으로 어떤 동작을 의도했는지 파악하기 어렵습니다. 또한 요약에 포함된 몇 가지 지침을 제외한 나머지 지침들은 잘 준수되지 않는 방향으로 서술 압력이 작동하게 될 수도 있습니다. 그리고 목적과 의도를 생략하고 제한 사항만 요약한다면 목적에 부합하지 않게 기계적으로 지침을 준수했는지 확인하게 될 수도 있습니다.


## 동작 범위

1. 본문의 지침들은 한국어를 활용하는 상황에서 그 한국어를 명확하게 출력하라는 지시입니다. 외국어 문장이나 어휘를 출력해야 하는 상황에서, 그것을 한국어로 번역하거나 대체하라는 지시가 아닙니다.

2. 변수명과 주석, 커밋 메시지, 로그 문자열처럼 코드에 속하는 텍스트는 프로젝트의 기존 관례를 준수해야 합니다. 이러한 텍스트는 지침을 적용하면 안 되기 때문에 이 조항에서 한 번 더 강조하고 있습니다.

3. 고유 명사와 기술 용어 등은, 통상적인 용례로 정착된 번역어 혹은 음차가 있다면 우선적으로 사용하고, 그렇지 않다면 원어를 유지함으로써, 한국어 사용자가 이해하기 편하고 의미를 잘 이해할 수 있도록 합니다.

4. 사용자가 어떤 어조나 어휘를 사용하든지, 사용자 메시지의 어조를 모방하지 않고, 본문에서 제시하는 지침들을 일관되게 유지합니다.


## 문장 단위

1. 읽는 이가 문장의 의미를 충분히 이해할 수 있어야 하므로, 의미가 있는 문장 성분을 생략하지 않습니다. [그러면 경고가 붙습니다.→ ('그러면 이미 작업 중인 파일에도 경고 표지가 추가됩니다.'와 같이, 맥락과 정보를 충분히 제공하도록 수정) ]  특히 관형격 조사인 '~의'를 필요 이상으로 사용한다면, 의미를 담고 있는 문장 성분을 생략하기 쉬우므로 유의해야 합니다.  [사본의 문구는 작업의 상황을 → 사본에 기재된 문구는 작업이 진행되는 상황을]

2. (이 2번 조항은 헤더와 목록에는 강제로 적용되는 사항이 아닙니다.) 명사구나 부사구, 연결어미로 문장을 끝내지 말고, 서술어와 종결어미를 사용하여 완성된 형태의 문장으로 끝을 맺어야 합니다.


## 구 단위

1. 필수적인 경우가 아니라면 조사와 어미를 생략하지 말아야 합니다. 또한 부사, 보조사와 선어말어미, 보조 용언을 적극적으로 활용하면, 의미가 명확한 한국어 문장을 완성할 수 있습니다. [이 결정은 이후 중요 정책이 갈리는 자리. 컨텍스트 압축 전 신중 반영한다. → 이 결정은 이후 중요한 정책에 지속적으로 영향을 주기 때문에, 컨텍스트가 압축되기 전에 신중히 반영합니다. → 지금 답변해주신 결정 사항은 이후 중요한 정책에도 지속적으로 영향을 미치기 때문에, 컨텍스트가 압축되기 전에 미리 신중하게 반영해 놓겠습니다.]

2. 구체적인 의미를 담고 있는 한자어와 자연스러운 통사 구조를 결합하면, 풍부하고 명확한 의미를 전달할 수 있습니다. 따라서 맥락에 적합한 한자어를 적극적으로 활용하고, 그 한자어에 조사와 어미를 붙여서 어휘 사이의 관계를 확실하게 나타내야 합니다. [<쓴 비용을 구하는 토큰 카운트 함수에 문제가 생기면 (상황에 적합한 어휘가 사용되지 않아 의미가 불충분함) /지출 비용 추론 용도의 토큰 카운트 함수의 오류 상황에서 (조사와 어미가 없어 가독성이 낮고 의미 관계가 불분명함)>  → 지출한 비용을 추론하는 토큰 카운트 함수에 오류가 발생하면 (이 지침의 목표 예시)]

3. 일반적인 어휘를 사용해야 하는 자리에 비유적 어휘를 사용하면 가독성이 낮고, 의미가 변질되기 쉽습니다. 따라서 꼭 필요한 경우가 아니라면 비유적 어휘로 일반적인 명사나 동사를 대체하지 않습니다. 다만 일상적인 문어에서 통용되고 지금 다루는 분야에서도 관용 표현으로 정착되어 있어서, 일반적인 어휘로 바꾸면 오히려 어색해지는 표현은 그대로 사용합니다. [<분석의 흐름 → 분석의 방향성>, <코드로 박는 자리 → 코드에 명시하는 상황 (혹은 코드에 명시하는 작업)>, <요청을 받습니다 -> 요청을 확인했습니다 (혹은 요청대로 수행하겠습니다)>]

4. 엠대시(—)는 앞뒤 문장의 관계를 지나치게 함축하기 때문에 자제하고, 문맥과 형식에 따라 콜론이나 접속사로 대체합니다.


## 추가 사항

- 서브에이전트를 호출할 때, 한국어로 프롬프트를 작성했다면 실제로 서브에이전트 호출 도구를 사용하기 전에 이 본문의 지침들이 준수되어 있는지 점검합니다. 서브에이전트가 산출한 결과를 사용자에게 전달할 때에도 본문의 지침들이 그대로 적용됩니다.
===== 지침 끝 =====

===== 추가 금지 표현 (dira 엔진) =====
사람이 읽는 글(티켓 본문, \`## 결과\`, \`## 블록\`, 커밋 메시지, \`docs/\` 아래)에서 무생물 주어에
생물 동사를 붙이지 않습니다(위 <구 단위> 3의 구체적 사례입니다). 파일/카드/설정/규칙/계약은
어디에 "산다"고도, "앉는다"고도, "선다"고도, 무엇을 "말한다"고도 쓰지 않습니다. 넷을 이렇게
씁니다.
- \`산다\` \`삽니다\` \`사는 자리\` \`살아난다\` -> "있다 / 둔다 / 붙는다 / 남는다 / 켜진다"
- \`앉는다\` \`앉힌다\` \`앉을 자리\` -> "붙는다 / 들어간다 / 놓인다 / 들어갈 자리"
- \`선다\` \`서 있다\` \`세운다\`(화면 요소가) -> "뜬다 / 생긴다 / 그려진다 / 성립한다 / 만든다"
- \`말한다\` \`말해 준다\`(화면/제목/문서/수가) -> "보여준다 / 알려 준다 / 적혀 있다 / 가리킨다"
\`박다\` \`못박다\`도 같은 이유로 안 씁니다 - 규칙/값/판정을 "박았다"고 쓰지 말고 "정했다 /
명시했다 / 고정한다 / 적는다 / 넣는다"로 쓰십시오(위 <구 단위> 3이 든 예가 이것입니다).
명사 \`못\`도 같은 이유로 안 씁니다 - 고정된 규칙이나 결정을 \`못 5\` \`뽑은 못\` \`못 하나\`처럼
세지 말고 \`규칙 5\` \`뽑은 규칙\` \`규칙 하나\` \`결정 하나\`로 쓰십시오. \`못 5를 깬다\`는 \`규칙 5를
어긴다\`입니다. 부정 부사 \`못\`(\`못 읽는다\` \`못 지운다\`)은 이 규칙의 대상이 아닙니다.
예외는 실제로 도는 프로세스, 세션, pid 하나뿐입니다 - \`pid가 살아 있다\`, \`부모가 wait에 서
있다\`는 그대로 씁니다. 사람이 주어인 문장도 이 규칙의 대상이 아닙니다. 티켓과 파일은
\`열려 있는 동안\`, \`그대로 남는다\`로 씁니다. 치환표는 \`CORE-TICKETS.md\` §Words에 있습니다.
이미 쓰인 파일을 이 규칙으로 일괄 수정하지는 않습니다.
===== 추가 끝 =====`;

/** 워커 쪽(`tick.sh`) 문장과 같은 틀 — 마지막 줄(지침 블록을 가리키는 문장)만 뺀다. */
const HOME_LANGUAGE_NOTE_KO = `언어 안내: 이번 세션 동안 사용자에게 하는 모든 말을 한국어로 하세요 -- 참견에
답할 때만이 아니라 아무도 말을 안 걸어도 진행 기록 스트림에 남기는 산문까지입니다.
생각하거나 내부적으로 추론하는 구간은 이 지시의 대상이 아닙니다 -- 어느 언어로
생각해도 됩니다. 산출물은 그대로 한국어로 고정합니다 -- \`kind: request\` 티켓
본문, \`personas/**\`, \`protocols/**\`, \`workers/*.sh\`, 온톨로지 전부입니다.`;

const HOME_LANGUAGE_NOTE_EN = `Language note: say everything you say to the user in English for the rest of
this session -- not only replies when someone writes in, but also any prose
you leave in the progress stream even when no one does. Thinking or internal
reasoning is not covered by this instruction -- you may think in any language.
Keep every written deliverable in Korean regardless -- the \`kind: request\`
ticket body, \`personas/**\`, \`protocols/**\`, \`workers/*.sh\`, and the ontology.`;

function languageNote(locale: Locale): string {
  return locale === "en" ? HOME_LANGUAGE_NOTE_EN : HOME_LANGUAGE_NOTE_KO;
}

/** `--append-system-prompt`로 넘길 값. 지침 블록이 앞, 언어 안내가 뒤다(워커 쪽 문서 층 -
 *  꼬리 순서와 같다). */
function systemPromptLayers(locale: Locale): string {
  return `${FLUENT_KO}\n\n${languageNote(locale)}`;
}

/** `root`는 **큐 루트**다. cwd(그 부모 — 머리 주석)와 경로 스코프 다섯이 **한 값에서 나온다** —
 *  둘을 따로 받으면 스코프가 다른 큐를 가리키는 조합이 만들어질 수 있다. `ontologyDir`은
 *  따로 받는다 — 재정의한 큐에서는 그 값이 `root` 밖이라 같은 값에서 못 나온다(`toolFlags` 주석). */
async function runClaude(
  bin: string,
  root: string,
  ontologyDir: string,
  prompt: string,
  session: string[],
  live: Live,
  locale: Locale,
): Promise<Run & { reason?: AnswerReason; stopped?: boolean }> {
  const args = [
    "-p",
    ...session,
    ...toolFlags(root, ontologyDir),
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose", // 빼면 stdout 0바이트 + stderr 한 줄로 죽는다(머리 주석)
    "--append-system-prompt", // 위 §언어 층 둘 — 단일 값이라 variadic 함정이 없다
    systemPromptLayers(locale),
    prompt, // variadic 옵션 뒤에 오면 먹힌다 — 위 플래그들이 사이를 끊어 준다
  ];

  // tick.sh 57~59행과 **같은 한 줄**: claude 엔진일 때만 헤드리스 OAuth 토큰을 넣는다.
  // GUI가 Finder에서 뜬 `.app`이면 사람 셸의 환경을 못 물려받는다 — 그때 이 파일이 유일한 인증이다.
  const env = { ...process.env };
  const tok = await readFile(tokenPath(), "utf8").catch(() => null);
  if (tok?.trim()) env.CLAUDE_CODE_OAUTH_TOKEN = tok.replace(/[\r\n]/g, "");

  return await new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: path.dirname(root), env });
    live.child = child;
    // `중지`가 spawn보다 먼저 왔다(스냅샷 조립 중에 눌렀다) — 뜨자마자 죽인다.
    // 그래서 중지의 근거가 핸들이 아니라 `stopping` 플래그다.
    if (live.stopping) child.kill("SIGTERM");

    let rest = ""; // 아직 개행을 못 만난 꼬리
    let stderr = "";
    let result: ResultLine | null = null;
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? ""; // 마지막 조각은 아직 한 줄이 아니다 — 다음 chunk가 마저 준다
      for (const line of lines) result = eatLine(line, live) ?? result;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdin.end(); // 머리 주석: 안 닫으면 3초를 버린다

    const settle = (r: Run & { reason?: AnswerReason; stopped?: boolean }) => {
      if (settled) return; // `error` 뒤에 `close`가 따라온다 — 먼저 온 것 하나만 답이다
      settled = true;
      live.child = null;
      resolve(r);
    };
    child.on("error", (e) => settle({ ok: false, reason: "spawn", output: [e.message, stderr].join("\n").trim() }));
    // `exit`이 아니라 `close`다 — 결과 줄이 **마지막에** 오므로 stdout을 다 읽은 뒤라야 판정이 뜬다.
    // ponytail: 손자 프로세스가 stdout을 물고 있으면 자식이 죽어도 이게 안 온다(화면은 영영
    //           `도는 중`이다). `--strict-mcp-config`라 지금 손자가 없다 — 생기는 날 `exit` +
    //           유예 타이머로 내린다.
    child.on("close", (code, signal) => {
      if (rest.trim()) result = eatLine(rest, live) ?? result; // 개행 없이 끝난 마지막 줄
      // **사람이 멈춘 것이 먼저다.** `SIGTERM`을 받은 `claude`는 스스로 rc 143으로 나가면서
      // 받은 데까지를 트랜스크립트에 남긴다(실측 ⑴⑵) — 그래서 여기서 실패로 만들 것이 없다.
      // **시계는 여기 없다**(§7 §천장이 없다) — 나머지 경우는 결과 객체가 있나 없나 하나로
      // 갈린다. 결과 객체가 없으면 `judge`가 종료 코드·신호·stderr 꼬리로 실패 ③을 짓는다.
      if (live.stopping) settle({ ok: true, stopped: true, output: live.partial });
      else settle(judge(result, live, stderr, { code, signal }, locale));
    });
  });
}

// ── 대화 (§비주얼 §24) ──────────────────────────────────────────────────────
//
// 화면이 그리는 것은 **트랜스크립트 파일**이다(§7). 그래서 새로고침이 언제나 같은 것을 그리고,
// 낙관적 에코가 없고, 이 앱에 대화 이력 저장소가 없다.

/** 대화 줄 **세 종**(§7 §스레드가 트랜스크립트 전부를 그린다 — 요구 `10714c38`). 종전은
 *  `question`·`answer` 둘뿐이고 도구·생각·결과·서브에이전트 줄을 통째로 버렸다 — 이제 그 전부가
 *  `line`이다. **화면이 종을 고르지 않는다**: 이 파일이 셋으로 가른 뒤에는 무엇을 어떻게 그리는지가
 *  §2-1과 같은 문법을 쓰는 화면(다음 티켓 `08345f02`)의 일이다. */
export type Turn = {
  key: string; // `StreamEvent.key` 그대로 — `<레코드 uuid>:<블록 index>`
  role: "question" | "answer" | "line";
  /** `question`·`answer`는 사람이 읽는 산문이다. `line`은 접힌 줄의 **한 줄 요약**(펼치기 전에
   *  보이는 값) — 아래 `event`가 있으면 펼친 모양은 그걸로 그린다(§2-1과 같은 그릇). */
  text: string;
  /** 이 답은 사람이 `중지`로 끊었다(답에만 붙는다). **새로고침해도 `중지됨`이 남는 근거**가
   *  이 한 칸이다 — 근거는 파일에 있다(아래 `INTERRUPTED`) */
  stopped?: true;
  /** `role === "line"`일 때만 있다. **원본 사건 그대로다** — `label`·`summary`·`summaryMono`·
   *  `body`·`diff`를 이 화면이 다시 뽑지 않는다(§2-1 렌더러 재사용, `lib/transcript.ts`가 이미
   *  낸 값이다). */
  event?: StreamEvent;
};

/** **사람도 에이전트도 쓰지 않은 줄 셋**(§7 §도는 답을 멈춘다 — 실측 ⑷). `중지`가 첫째를 남기고,
 *  중지한 세션을 `--resume`으로 이으면 나머지 둘이 뒤따라 들어온다(중지 직후엔 없다).
 *  `recordToEvents`가 `role === "user"`인 `text` 블록을 전부 `prompt`로 만들기 때문에 그냥 두면
 *  화면에 질문 말풍선으로 뜬다 — §비주얼 §24가 그리는 것은 사람의 질문과 에이전트의 답 둘뿐이다.
 *
 *  **문자열 셋이 지금 가진 유일한 단서다** — 이 레코드에는 사람이 쓴 것과 구분되는 플래그가 없다.
 *  그래서 `includes`가 아니라 **전문 일치**다: 사람이 답 안에서 이 문장을 인용하는 날 그 줄까지
 *  삼키지 않는다. */
const GHOST_LINES = new Set([
  "[Request interrupted by user]",
  "Continue from where you left off.",
  "No response requested.",
]);

/** 셋 중 하나는 **버리기만 하면 사실을 잃는다.** 이 줄은 `중지`가 남긴 것이라(§7 실측 ⑵) 그
 *  존재가 곧 *앞 답이 중지됐다*이고, §비주얼 §24가 새로고침 뒤에도 `중지됨`을 요구하는 근거가
 *  이것 하나다(GUI는 그 사실을 아무 데도 저장하지 않는다 — 도는 동안만 `runs` 맵에 있다).
 *  그래서 말풍선으로는 안 그리되 **앞 답에 표식으로 옮겨 적는다**. */
const INTERRUPTED = "[Request interrupted by user]";

/** 사건 → 대화 줄. **셋 중 하나로 판정하고, 넷째는 없다**(§7 — 화면이 종을 고르지 않는다).
 *  최상위(`sidechain` 아님) `prompt`·`text`만 사람 질문·에이전트 답이고, 나머지 전부(생각·도구·
 *  결과·`interject` 그리고 **서브에이전트 줄까지**)가 `line`이다 — 종전엔 sidechain을 통째로
 *  버렸다(이 세션의 도구는 읽기 셋뿐이라 날 일이 없었지만, 좌측 패널에서 여는 워커 세션은 Task를
 *  쓸 수 있다). `line`의 `text`는 `label`·`summary`가 둘 다 비는 드문 경우(sidechain의 `text`
 *  블록 — `recordToEvents`가 그 kind에 label·summary를 안 채운다)를 위한 안전망으로 `body` 앞
 *  40자를 쓴다 — 빈 접힌 줄을 만들지 않는다. */
export function toTurns(events: StreamEvent[]): Turn[] {
  const turns: Turn[] = [];
  // 중지 표식은 **가장 가까운 답**의 것이다(`line`을 건너뛴다 — 도구가 도는 중에도 표식이 그
  // 답을 찾는다). `question`에 닿으면 글자가 한 자도 안 왔다는 뜻이라 옮겨 적을 자리가 없다
  // (§비주얼 §24는 띠를 답의 산문 블록에 붙인다 — 그 블록 자체가 없다).
  const markInterrupted = () => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "answer") {
        turns[i] = { ...turns[i], stopped: true };
        return;
      }
      if (turns[i].role === "question") return;
    }
  };
  for (const e of events) {
    if (!e.sidechain && (e.kind === "prompt" || e.kind === "text")) {
      const text = e.kind === "prompt" ? questionOf(e.body) : e.body.trim();
      if (!text) continue;
      if (GHOST_LINES.has(text)) {
        if (text === INTERRUPTED) markInterrupted();
        continue;
      }
      turns.push({ key: e.key, role: e.kind === "prompt" ? "question" : "answer", text });
      continue;
    }
    turns.push({
      key: e.key,
      role: "line",
      text: e.summary || e.label || e.body.trim().slice(0, 40),
      event: e,
    });
  }
  return turns;
}

/** 지금 도는 질문 — **키가 session id다**(§7 §대화마다 따로 돈다. 종전은 `project.id`였고 그
 *  한 칸이 "한 프로젝트에 한 질문"의 정체였다). UUID라 프로젝트끼리 겹칠 수 없고, 값에
 *  `projectId`가 같이 있어 한 프로젝트에서 도는 줄만 걸러낸다.
 *
 *  **`result`가 채워지는 순간이 곧 끝**이고 **`도는 중`의 정의가 그 한 칸이다** — 맵에 있나가
 *  아니다. A가 끝나는 순간 사람이 B를 보고 있을 수 있어 **집어 갈 폴링이 없기 때문**이고,
 *  그래서 끝난 객체를 안 지우고 **그 대화를 여는 폴링까지** 들고 있는다(지우면 A의 실패 5종이
 *  사람에게 한 번도 안 보인다). 남는 것은 대화 수(상한 20)만큼의 문자열 몇 개다.
 *
 *  이 맵이 **§24 실패 ④의 근거**다 — 화면의 잠금은 새로고침 한 번에 풀리므로(폼 상태다) 서버가
 *  한 번 더 판정한다. 큐잉 층이 아니다: **같은 대화의** 둘째 질문은 기다리지 않고 **거절**된다.
 *  동시 상한은 안 둔다(§7 §상한을 안 두는 근거 — 세는 값은 이 맵에 이미 있다).
 *  // ponytail: 프로세스 메모리다. dev의 HMR·재시작에 날아가면 폴링이 멈추고 답은 다음
 *  //           새로고침에 트랜스크립트에서 그대로 뜬다 — 잃는 것은 실패 Alert 한 장과
 *  //           **자식 핸들**(그때 `중지`는 죽일 것을 못 찾는다 — 시계 등받이도 없다,
 *  //           §7 §천장이 없다. 그 자식은 사람이 손으로 찾아 죽여야 한다). */
const runs = new Map<string, { projectId: string; result: Answer | null; live: Live }>();

/** 결과를 집어 간 폴링이 그 줄을 뗀다. **키가 아니라 객체로 지운다** — 첫 턴이 실패하면
 *  `settleFirstTurn`이 같은 객체를 옛 id와 새 id **둘 다**에 걸어 두기 때문이다(그 주석이 근거다).
 *  키 하나만 지우면 나머지 하나가 남아 다음 질문이 실패 ④(`busy`)로 막힌다. 맵 크기는 대화 수
 *  남짓이라 훑는 값이 아니다. */
const dropRun = (entry: object | undefined): void => {
  if (!entry) return;
  for (const [k, v] of runs) if (v === entry) runs.delete(k);
};

/** 이 프로젝트에서 **지금 도는** session id 전부 — 패널이 진행 표식을 그리는 출처다(§7 표).
 *  끝났는데 아직 아무도 안 집어 간 줄은 여기 없다(`result`가 찼다 = 안 돈다). */
const runningIn = (projectId: string): string[] =>
  [...runs].filter(([, r]) => r.projectId === projectId && !r.result).map(([id]) => id);

export const isAsking = (projectId: string): boolean => runningIn(projectId).length > 0;

/** `중지`(§7 §도는 답을 멈춘다) — **우리가 띄운 자식 하나에 `SIGTERM`을 보내는 게 전부다.**
 *
 *  `SIGKILL` 재시도 사다리를 만들지 않는다. 근거는 실측 ⑴이다: `claude`는 이 신호를 받아
 *  **스스로** rc 143으로 나가고(신호사면 rc가 음수로 온다) 나가면서 받은 데까지를 트랜스크립트에
 *  남긴다. **시계 등받이는 없다**(§7 §천장이 없다) — 안 죽는 날이 오면 그게 `SIGKILL` 한 칸을
 *  여는 신호다(같은 절이 그 조건을 적어 뒀다).
 *
 *  **죽이는 것은 그 대화의 자식 하나다**(§7 §서버가 갈리는 자리 넷 ③) — 인자가 project id가
 *  아니라 session id인 것이 그 전부다. 남의 대화를 멈추는 경로를 안 만든다(가서 누른다).
 *
 *  돌려주는 것은 **죽일 것이 있었나**다 — 누르는 사이에 답이 도착했으면 false다(화면은 그 다음
 *  폴링이 이미 `running: false`를 알려 준다). 여기서 맵을 지우지 않는다: 자식이 실제로 닫히면
 *  `runClaude`가 `stopped`를 채우고, 그걸 집어 가는 것은 종전대로 폴링 한 번이다. */
export function stopAsk(sessionId: string): boolean {
  const live = runs.get(sessionId)?.live;
  if (!live || live.stopping) return false;
  live.stopping = true; // 아직 spawn 전이면 `runClaude`가 뜨자마자 이걸 보고 죽인다
  live.child?.kill("SIGTERM");
  return true;
}

/** 질문을 **띄우고 바로 돌아온다**(§24). 답 하나가 얼마나 오래 돌든 그 응답을 붙들고 있지 않는
 *  이유 셋(천장이 없어진 뒤로는 "오래"의 상한도 없다 — §7 §천장이 없다):
 *  ① 도는 동안 폴링이 답의 조각을 그려야 하고 ② 새로고침해도 따라가야 하고
 *  ③ 실패 ④를 판정할 곳이 서버여야 한다. 셋 다 "누가 도는지"를 서버가 알아야 한다는 한 사실이다.
 *
 *  돌려주는 것은 **실패뿐**이다(`null` = 시작했다). 성공의 도착은 폴링이 알려 준다.
 *
 *  **잠금의 단위는 한 대화다**(§7 §대화마다 따로 돈다). A가 도는 동안 B의 질문은 그냥 받는다 —
 *  그래서 질문이 들어갈 **session id를 먼저 정하고**(`beginTurn`) 그 키로 본다. 검사와 등록
 *  사이에 `await`가 없다는 종전 근거는 무수정이다: 옮긴 `await` **뒤에** 둘이 붙어 있어야
 *  두 요청이 같이 통과하지 못한다. */
export async function startAsk(
  project: Pick<Project, "id" | "name" | "root">,
  question: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Answer | null> {
  const q = question.trim();
  if (!q) {
    return { ok: false, reason: "other", output: t(locale, "home.errors.emptyQuestion"), sessionId: "", resumed: false };
  }
  // **도는 워커 세션에는 이어 묻지 못한다**(§7 §이어 묻는 것은 홈 에이전트다). 화면이 이미
  // `보내기`를 잠그지만(§비주얼 §24 §잠금 두 자리 ②) 여기서 한 번 더 본다 — 그 절이 든 근거는
  // 자리가 아니라 **파일**이다: 홈이 같은 트랜스크립트에 `--resume`으로 붙으면 한 파일에 두
  // 프로세스가 쓴다. 화면의 잠금은 폼 상태라 새로고침·낡은 탭이면 없는 것과 같다.
  // **여섯 번째 실패를 안 만든다**(§24 5종 그대로 + `other`) — 다음 행동은 이 한 줄이 준다.
  const cur = await readSessionId(project.id);
  const held = cur ? (await listWorkerSessions(project)).find((w) => w.id === cur && w.running) : undefined;
  if (held) {
    return {
      ok: false,
      reason: "other",
      output: `${t(locale, "home.errors.workerRunningPrefix")}${held.hash}${t(locale, "home.workerNote.runningSuffix")}`,
      sessionId: held.id,
      resumed: true,
    };
  }
  // 여기까지가 마지막 `await`다 — 아래 **검사와 등록 사이에는 없다**(머리 주석).
  const turn = await beginTurn(project.id, q);
  if (runs.has(turn.sessionId)) {
    // **같은 대화의 둘째 질문만** 실패 ④다(§24 문구 무수정 — 다른 대화는 여기까지 안 온다).
    // `running`(= `result`가 비었나)이 아니라 **맵에 있나**로 보는 것이 여기서는 맞다: 끝났는데
    // 아직 아무도 안 집어 간 결과 객체를 덮으면 그 실패가 사람에게 한 번도 안 보인다. 화면이
    // 입력칸을 여는 것은 그 객체를 집어 간 폴링 뒤이고, 집어 가면서 이 줄이 지워진다.
    return { ok: false, reason: "busy", output: `session ${turn.sessionId}`, sessionId: turn.sessionId, resumed: true };
  }
  const entry = { projectId: project.id, result: null as Answer | null, live: newLive() };
  runs.set(turn.sessionId, entry);
  void ask(project, q, entry.live, turn).then(
    (a) => (entry.result = a),
    // `ask`는 던지지 않게 쓰여 있지만(안이 전부 catch다) 여기서 던지면 unhandled rejection으로
    // 서버가 죽고 화면은 영영 `도는 중`이다. 마지막 관문 하나를 둔다.
    (e: Error) => (entry.result = { ok: false, reason: "other", output: e.message, sessionId: "", resumed: false }),
  );
  return null;
}

// ── 스케줄 만들기 - 지우기 (§7-2 §화면 - §비주얼 §62 (4)(5)) ─────────────────
//
// 화면이 부르는 쪽이다(위 `newConversation`·`switchConversation`과 같은 층). `when`은
// 클라이언트가 갈래 넷을 접어 만든 문자열이라 **신뢰 경계 값이다** — 클라이언트 검증(폼의
// `disabled`)은 검증이 아니라서 여기서 `isValidWhen`을 다시 본다.

/** `새 스케줄` 다이얼로그의 `만들기` — 갈래 넷이 이미 `when` 한 칸으로 접힌 값을 받는다(§7-2
 *  §단발과 주기가 한 칸에 담긴다). 빈 문장이나 못 읽는 `when`은 **줄을 안 만들고 `null`을 낸다** —
 *  빈 문장은 아무 말도 안 하는 회차를 영영 반복하고, 못 읽는 `when`은 `parseSchedule`의 관문에
 *  걸려 다음 읽기부터 없는 줄이 된다(사람이 방금 만든 줄이 새로고침하면 사라지는 유령이 된다). */
export async function createSchedule(projectId: string, when: string, prompt: string): Promise<Schedule | null> {
  const p = prompt.trim();
  if (!p || !isValidWhen(when)) return null;
  const home = await readHome(projectId);
  const row: Schedule = { id: randomUUID(), created: new Date().toISOString(), when, prompt: p, session_id: "" };
  await writeHome(projectId, { ...home, schedules: [...home.schedules, row] });
  return row;
}

/** `스케줄 삭제`(§7-2 §안 하는 것 — 켜고 끄기 대신 이 자리가 받는다). **트랜스크립트는 안
 *  지운다**(`~/.claude`는 남의 디렉터리다) — 지우는 것은 이 배열의 줄 하나뿐이라 그 스레드로
 *  가는 길이 화면에서 사라질 뿐이다(§비주얼 §62 (4) §확인을 끼우는 이유). */
export async function deleteSchedule(projectId: string, id: string): Promise<void> {
  const home = await readHome(projectId);
  await writeHome(projectId, { ...home, schedules: home.schedules.filter((s) => s.id !== id) });
}

/** 만들기·삭제 뒤 화면이 즉시 받아 갈 최신 목록(§비주얼 §24 로딩 항 — 다음 5초/폴링을 안
 *  기다린다). `readHome`을 다시 부르는 것이 값이다: 같은 파일에 쓰는 다른 탭·회차와 겹쳐도
 *  이 함수가 방금 쓴 값이 아니라 **지금 파일에 있는 값**을 낸다. */
export async function readScheduleViews(projectId: string, nowMs: number = Date.now()): Promise<ScheduleView[]> {
  return scheduleViews((await readHome(projectId)).schedules, nowMs);
}

// ── 스케줄 디스패치 (§7-2 §깨우는 것은 앱의 서버다) ──────────────────────────
//
// **하트비트(`machine-state.ts`)가 매 틱 부르는 것 하나** — 새 타이머 0 · 새 프로세스 0 ·
// 새 cron 줄 0. 판정(`judgeSchedule`)은 순수하고, 여기부터는 그 결과를 큐 → 프로젝트 전부에
// 대해 돌리는 불순한 절반이다(§7-2 §판정의 자리).

/** 한 줄만 갈아 끼운다 — `writeHome`을 그대로 타므로 새 쓰기 경로가 없다(§7-2 새 파일 0개). */
async function patchSchedule(projectId: string, id: string, patch: Partial<Schedule>): Promise<void> {
  const home = await readHome(projectId);
  await writeHome(projectId, { ...home, schedules: home.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

/** 한 스케줄의 회차 하나. **`current`를 안 본다** — `beginTurn`을 안 거치고 `ask`에 세션을
 *  직접 넣는다(§7-2: "회차는 그 줄의 `session_id`로 돈다" — `conversations`에 줄이 안 생긴다).
 *
 *  **이미 도는 회차가 있으면 버린다**(§7-2 §판정) — 판정 기준은 "그 스케줄이 마지막으로 쓴
 *  `session_id`가 지금 `runs`에 결과 없이 살아 있나"다. 새로 뽑을 세션 id가 아니라 **저장된
 *  옛 값**으로 봐야 한다: 아직 트랜스크립트가 없는 도는 회차는(`findTranscript`가 파일 생성
 *  전이면 null) 그 검사를 새 uuid로 하면 늘 "안 도는 것"으로 오판해 중복 스폰이 난다.
 *
 *  버렸든 쐈든 **`last`는 이번 판정의 분으로 올라간다** — 안 올리면 다음 15초 틱이 같은 분을
 *  또 맞다고 보고 회차가 밀려 쌓인다(§7-2). */
async function runScheduleTurn(
  project: Pick<Project, "id" | "name" | "root">,
  schedule: Schedule,
  dueMs: number,
  nowMs: number,
): Promise<void> {
  const due = new Date(dueMs).toISOString();
  const at = new Date(nowMs).toISOString();

  const prev = runs.get(schedule.session_id);
  if (prev && prev.result === null) {
    await patchSchedule(project.id, schedule.id, { last: { due, at } });
    return; // 이번 회차는 버린다 — 세션도 안 갈고 스폰도 안 한다
  }

  // **`sessionIdOf` 관문을 통과하고 트랜스크립트가 실재해야 이어붙인다** — 통과 못 하거나
  // 가리키는 파일이 없으면(다른 머신에서 온 값 · `~/.claude` 정리) 새 세션으로 민다(§7-2 §저장).
  const known = sessionIdOf({ session_id: schedule.session_id });
  const transcript = known ? await findTranscript(known) : null;
  const sessionId = transcript ? known! : randomUUID();
  const resumed = transcript !== null;

  await patchSchedule(project.id, schedule.id, { session_id: sessionId, last: { due, at } });

  const entry = { projectId: project.id, result: null as Answer | null, live: newLive() };
  runs.set(sessionId, entry);
  // §7-2 §회차의 질문 — `prompt`는 고쳐 쓰지 않는다. 붙는 것은 한 줄뿐이고 시각 둘 다 인자로
  // 왔다(`buildPrompt`는 이 문자열을 그대로 `question`으로 받아 여전히 순수하다).
  const q = `${schedule.prompt}\n\n스케줄이 깨웠다 - 예정 시각 ${due} - 실제 시각 ${at}`;
  void ask(project, q, entry.live, { sessionId, resumed }).then(
    (a) => (entry.result = a),
    (e: Error) => (entry.result = { ok: false, reason: "other", output: e.message, sessionId: "", resumed: false }),
  );
}

/** §7-2 §깨우는 자리 — `machine-state.ts`의 15초 하트비트가 부르는 것 하나. 등록된 프로젝트
 *  전부를 훑어 각자의 `schedules`를 판정한다.
 *
 *  레지스트리·홈 파일을 못 읽으면 이번 틱은 조용히 건너뛴다 — 하트비트가 던지면 §0-14 판정까지
 *  같이 죽는다(다음 틱이 15초 뒤에 다시 본다).
 *
 *  // ponytail: 회차가 스레드로 열려야 `runs` 항목이 `dropRun`으로 지워진다(폴링이 그 자리다).
 *  //           사람이 그 스케줄을 한 번도 안 열면 안 지워진다 — 대화(상한 20)와 달리 스케줄은
 *  //           수가 안 막혀 있어 오래 도는 프로젝트에서 이 맵이 자란다. 문제라고 말하는 날
 *  //           `dropRun`을 여기서도 부른다(결과가 이미 있으면 폴링 없이도 지운다). */
export async function runSchedules(nowMs: number = Date.now()): Promise<void> {
  const projects = await readProjects().catch(() => [] as Project[]);
  for (const project of projects) {
    const home = await readHome(project.id).catch(() => null);
    if (!home) continue;
    for (const schedule of home.schedules) {
      const createdMs = Date.parse(schedule.created);
      const lastDueMs = schedule.last ? Date.parse(schedule.last.due) : null;
      const due = judgeSchedule({
        when: schedule.when,
        createdMs: Number.isFinite(createdMs) ? createdMs : nowMs,
        lastDueMs: lastDueMs !== null && Number.isFinite(lastDueMs) ? lastDueMs : null,
        nowMs,
      });
      // 한 스케줄의 디스패치 실패(fs 오류 등)가 이 틱의 나머지 스케줄·§0-14 판정까지 죽이면 안 된다
      if (due !== null) await runScheduleTurn(project, schedule, due, nowMs).catch(() => {});
    }
  }
}

/** 폴링 한 번 = 화면이 아는 전부. 페이지의 첫 렌더도 이걸 부른다(`offset` 0 · `sessionId` null). */
export type HomeChunk = {
  sessionId: string | null;
  /** **대화 목록**(§7 §대화가 여럿이다 · §비주얼 §24). `sessionId`가 곧 이 목록의 `current`다.
   *  폴링이 이걸 같이 데려오는 이유는 셋이다 — ① 이 함수가 `readHome`을 **이미** 부른다(공짜다)
   *  ② 첫 질문이 제목을 파일에 쓰므로(`beginTurn`) 그 답이 도는 동안 트리거의 `새 대화`가
   *  질문의 첫 줄로 갈려야 한다 ③ 화면이 아는 전부가 이 응답 하나라는 계약이 안 갈린다.
   *  **상한 20은 여기서 안 재는다** — 실행층이 파일에서 자르고 화면은 받은 줄을 그대로 그린다 */
  conversations: Conversation[];
  /** **좌측 패널의 워커 세션 그룹**(§7 좌측 패널 · §비주얼 §24). 대화 목록과 같은 응답에 담는
   *  이유도 같다 — 화면이 아는 전부가 이 응답 하나다. 출처만 다르다(저건 우리가 쓴 파일이고
   *  이건 큐에서 파생된다). 못 읽으면 빈 목록이다(`listWorkerSessions`) */
  workers: WorkerSession[];
  /** **좌측 패널의 스케줄 그룹**(§7-2 §화면 · §비주얼 §62). 대화·워커 세션과 같은 응답에 담는
   *  이유도 같다 — `readHome`이 이미 `schedules`를 들고 있다(공짜다). `at`·`overdue`는
   *  `scheduleViews`가 이 폴링 시각 기준으로 얹는 값이라 화면은 시계를 다시 안 잰다. */
  schedules: ScheduleView[];
  turns: Turn[];
  offset: number;
  /** 세션이 갈렸다(`새 대화` 뒤 첫 질문 · 첫 질문 실패 뒤 재시도) — 화면은 **갈아 끼운다** */
  reset: boolean;
  /** **보고 있는 대화**가 도는가(§7 §대화마다 따로 돈다 — 이 한 칸의 뜻은 무수정이다).
   *  갈린 것은 매달린 곳이다: 프로젝트가 아니라 이 세션이다 */
  running: boolean;
  /** **이 프로젝트에서 도는 session id 전부**(§7 §서버가 갈리는 자리 넷 ④). 보고 있는 대화가
   *  아닌 줄도 든다 — 패널이 진행 표식을 그리는 출처이자, 화면이 폴링을 계속하는 근거다
   *  (보는 대화가 먼저 끝나도 A가 돌고 있으면 그 표식이 살아 있어야 한다). `running`이 참이면
   *  `sessionId`가 이 목록에 있다 */
  runningSessions: string[];
  /** **도는 동안 받은 글**(§7 §답은 흐른다). 출처가 `turns`와 다르다 — 이건 자식 프로세스의
   *  stdout이고 저건 트랜스크립트다. `running`이 false면 **언제나 빈 문자열**이다(아래 주석) */
  partial: string;
  /** **지금 하는 일**(§7 §천장이 없다 §안심 장치 · §도는 워커 세션은 스레드에서도 돈다). 출처는
   *  둘이다 — 우리 자식이면 `partial`과 같은 자리(자식의 stdout) `running`이 false면 `null`.
   *  **워커 세션이 `.wip`인 동안은 예외다** — 남의 프로세스라 그 자식의 stdout이 없어서
   *  트랜스크립트의 마지막 사건에서 뽑는다(`activityFromEvent`). 문구·그릇은 화면
   *  결선(`4c8e82d8`)이 정한다 — 여기는 구분값 + 도구 이름까지만 낸다 */
  activity: Activity | null;
  /** 사람이 `중지`로 끝냈다. 실패가 아니다 — 화면은 `중지됨`이라고 말하고 입력칸을 연다(§7) */
  stopped: boolean;
  /** 끝난 **실패**. 성공은 말풍선이 이미 말했으므로 여기 안 담는다 */
  failed: Answer | null;
  /** **이 폴링이 실행층에서 끝을 집어 갔다** — `runs`의 결과 객체가 채워져 있었고 여기서
   *  지웠다(성패·중지 무관). `running`의 반대가 아니다: 맵이 휘발하면 **둘 다 false**다.
   *  그 갈림이 `pollDone`의 전부다 */
  answered: boolean;
  /** **폴링을 끊어도 되는가**(`pollDone`). `running`의 반대가 아니다 — 아래 주석이 그 자리다 */
  done: boolean;
  /** 이 회차의 새 `turns`(+ 도는 답 `partial`)만 훑어 나온 산문 속 해시-P번호 표식의 값
   *  (§9 §클라이언트가 폴링하는 자리 — `tailSession`의 `refs`와 같은 계약). `mayHaveRefs`가
   *  그 모양을 못 찾으면(대부분의 회차) 빈 인덱스고 `listTickets`를 다시 안 돈다. */
  refs: RefIndex;
};

const NO_REFS: RefIndex = { tickets: {}, epics: {} };

/** **폴링을 끊는 근거**(§7 §폴링은 서버가 잊어도 안 끊긴다 — 요구 `116b3c37`). `running: false`
 *  하나로는 못 끊는다: `runs`는 프로세스 메모리라 dev의 recompile·서버 재시작에 휘발하고, 그러면
 *  자식이 아직 도는데도 그 값이 false로 온다. 화면이 거기서 끊으면 질문만 든 채 얼고 새로고침
 *  전까지 안 통한다.
 *
 *  **끝의 증거는 `answered`가 첫째다** — 실행층이 결과 객체를 채웠고 이 폴링이 그걸 집어 갔다.
 *  휘발한 자리에는 그 객체가 아예 없으므로 둘이 정확히 갈린다. `failed`·`stopped`를 따로 안 보는
 *  이유도 이것이다: 둘 다 그 객체가 있어야 채워지는 값이라 이미 포함된다.
 *
 *  **`turns`만으로는 못 끊었다**(QA `0a284011` 실측, 왕복 5회 전부 · 워커 세션도 `새 대화`도).
 *  답 줄은 프로세스가 죽기 한참 전에 트랜스크립트에 뜨고(답 5~40초 · 자식 죽음 14초) **도는 중의
 *  폴링이 그것을 이미 집어 가 `offset`을 밀어 둔다.** `running: false`가 오는 마지막 응답의
 *  `turns`는 그래서 **빈 배열**이고, 여기가 영영 false라 화면은 천장 5분(`CEILING_MS`)까지
 *  `보내기`·패널 줄 16개·`새 대화`를 잠갔다. *"마지막 응답이 그 답을 함께 데려온다"*가 그 오독이다.
 *
 *  **그래도 `turns`가 둘째 증거로 남는다** — 맵이 휘발한 뒤의 복구 경로가 그것 하나다: 그때는
 *  `answered`가 영영 false이므로, 늦게 끝낸 자식이 쓴 답 줄을 화면이 집어 가는 폴링이 끊는 자리다.
 *  아무 증거도 없는 `running: false`는 여전히 안 끊는다. **`CEILING_MS`는 그 QA 실측 때 서버의
 *  상한 5분(이 파일에 있던 타이머 상수 — 이 티켓이 걷었다)과 같은 수였다. 둘 다 걷기로 했다
 *  (요구 `8db4d0f6` — §7 §천장이 없다) — 화면 쪽은 화면 결선 티켓(`4c8e82d8`)이 걷는다.**
 *
 *  **`turns.length`는 종을 안 가린다** — `line`이 늘어도 이 판정은 그대로다. 첫 증거(`answered`)는
 *  이미 종과 무관하고, 둘째 증거는 원래도 "질문이 파일에 먼저 뜨는" 것만으로 채워지는 수였다
 *  (`toTurns`가 항상 첫 프롬프트를 맨 먼저 넣는다) — `line`이 그 사실을 안 바꾼다.
 *
 *  **워커 세션은 셋째 증거를 쓴다**(§7 §도는 워커 세션은 스레드에서도 돈다 — 요구 `161a881e`).
 *  `sessionId`가 `workers` 목록의 한 줄을 가리키면(남의 프로세스) `turns.length`를 아예 안 본다 —
 *  그 대신 **그 줄의 `running`이 전부다**(`.wip`이면 안 끊고 `.done`이면 끊는다). 이유 둘:
 *  ① 남의 워커 세션은 이미 턴이 있는 채로 시작하므로(티켓 배정 지시 한 줄이 최소한 있다)
 *  `!running && turns.length > 0`이 첫 폴링부터 참이라, `turns`로 재면 활동이 뜨는 바로 그
 *  순간 폴링이 끊긴다. ② 반대쪽 끝 — 티켓이 방금 `.done`으로 갈렸는데 그 사이 트랜스크립트에
 *  새 줄이 안 붙었으면(흔하다: 상태 변화는 큐 파일 쪽이지 트랜스크립트 쪽이 아니다) `turns`가
 *  이 폴링에서 여전히 0건이라 둘째 증거로도 못 끊는다. `workers` 목록은 **매 폴링 큐를 다시
 *  읽으므로**(`workerSessionsById`) 트랜스크립트에 새 줄이 있든 없든 그 전환을 그 폴링에서
 *  바로 안다 — 첫째 증거(`answered`)는 그대로 남는다(그건 우리 자식의 것이라 워커 세션에는
 *  애초에 안 뜬다). */
export const pollDone = (
  c: Pick<HomeChunk, "running" | "turns" | "answered" | "sessionId" | "workers">,
): boolean => {
  const worker = c.sessionId ? c.workers.find((w) => w.id === c.sessionId) : undefined;
  return c.answered || (!c.running && (worker ? !worker.running : c.turns.length > 0));
};

/** 트랜스크립트를 `offset` 뒤부터 읽어 대화 줄 + 새 offset(§2-1 읽기 코어 재사용).
 *
 *  **`sessionId`를 클라이언트가 들고 오는 이유는 하나다** — 그 값이 서버의 것과 다르면 `offset`이
 *  다른 파일의 바이트 수라 그대로 쓰면 새 세션의 앞부분을 통째로 건너뛴다. 경로가 되는 값은
 *  여전히 서버가 읽은 쪽뿐이고(`readSessionId` → `sessionIdOf`), 클라이언트 값은 **비교에만** 쓴다. */
export async function pollHome(
  projectId: string,
  sessionId: string | null,
  offset: number,
): Promise<HomeChunk> {
  /** 나가는 문 셋이 **같은 판정 하나**를 지난다 — 둘이 예외 경로라 잊기 쉬운 자리다 */
  const chunk = (c: Omit<HomeChunk, "done">): HomeChunk => ({ ...c, done: pollDone(c) });
  // 목록과 `current`를 **한 번에** 읽는다 — 화면이 둘 다 이 응답에서 받는다(위 `conversations`).
  const { conversations, current, schedules } = await readHome(projectId);
  const workers = await workerSessionsById(projectId);
  const scheduleList = scheduleViews(schedules);
  // **`current`가 아무것도 안 가리킬 수 있다.** 보던 워커 세션의 티켓이 큐에서 사라지면 이름도
  // 줄도 없다 — 그때는 **대화 0건과 같다**(§7 §고르면 홈 대화 스레드에 열린다: 온보딩이 뜬다.
  // 트랜스크립트는 안 지운다). **실패 ⑤가 아니다** — 그건 줄이 있는데 트랜스크립트만 없는
  // 경우고(§비주얼 §24 다섯 상태 에러), 둘을 가르는 것이 이 판정 하나다.
  // **회차가 있는 스케줄도 여기 걸린다**(§7-2 §고르면 무엇이 서나 — 워커 세션 줄과 같은 자다).
  // 아직 안 돈 스케줄은 `session_id`가 빈 문자열이라 `current`가 그 값이 될 수 없다 — 그 줄을
  // 고르는 것은 화면이 로컬로 처리한다(§비주얼 §62 (6), `home-ui.tsx`).
  const sid =
    current &&
    (conversations.some((c) => c.id === current) ||
      workers.some((w) => w.id === current) ||
      schedules.some((s) => s.session_id === current))
      ? current
      : null;
  const reset = sid !== sessionId;
  const at = reset || !Number.isSafeInteger(offset) || offset < 0 ? 0 : offset;

  // **끝났는지를 읽는 것이 트랜스크립트를 읽는 것보다 먼저다.** 뒤집으면 tail과 종료 사이에 쓰인
  // 마지막 줄을 못 읽은 채로 `running: false`를 돌려주고, 폴링이 멈춰서 답이 새로고침 전까지
  // 안 뜬다. (`readHome`은 그 파일이 아니다 — sid를 모르면 볼 칸을 못 고른다.)
  // **집어 가는 것은 보고 있는 대화 하나뿐이다**(§7: 남의 대화의 결과 객체는 그 대화를 열 때까지
  // 남는다). `running`이 맵의 유무가 아니라 `result`가 비었나인 근거도 이것이다.
  const entry = sid ? runs.get(sid) : undefined;
  const done = entry?.result ?? null;
  if (done) dropRun(entry);
  // **끝을 집어 간 폴링은 이 한 번뿐이다**(위에서 지웠다) — 그래서 이 값이 곧 `pollDone`이다.
  const answered = done !== null;
  const failed = done && !done.ok ? done : null;
  const running = entry !== undefined && done === null;
  const runningSessions = runningIn(projectId);
  const stopped = done?.stopped === true;
  // **누적분과 트랜스크립트가 겹치는 자리가 여기다**(§7: 완료된 답을 두 벌로 그리지 않는다).
  // 도는 동안은 이 문자열이 그 답의 전부이고, 끝나는 순간 **정본이 트랜스크립트로 넘어간다** —
  // 같은 응답의 `turns`가 그 답을 진짜 줄로 데려오므로 여기서 빈 문자열을 준다. 중지도 같다:
  // 받은 데까지가 트랜스크립트에 남으므로(실측 ⑵) 화면이 지울 것도 붙일 것도 없다.
  // 순서가 근거다 — `done`을 파일보다 먼저 읽으므로 `partial`이 비는 응답은 이미 그 줄을 담고 있다.
  const partial = running ? (entry?.live.partial ?? "") : "";
  // **워커 세션이 `.wip`인 동안**(§7 §도는 워커 세션은 스레드에서도 돈다 — 요구 `161a881e`).
  // 우리 자식(`running`)과 배타적이다 — 남의 프로세스라 `Live`가 없다. 활동을 트랜스크립트에서
  // 뽑을지 정하는 값이다 — `pollDone`은 이 값이 아니라 `workers` 목록 자체를 본다(그 함수 주석).
  const workerLive = sid !== null && workers.some((w) => w.id === sid && w.running);

  if (!sid) {
    // 같은 근거로 같은 값이다(§7 §안심 장치) — 끝나면·볼 곳이 없으면 활동도 없다.
    return chunk({
      sessionId: null,
      conversations,
      workers,
      schedules: scheduleList,
      turns: [],
      offset: 0,
      reset,
      running,
      runningSessions,
      partial,
      activity: null,
      stopped,
      failed,
      answered,
      refs: NO_REFS,
    });
  }

  const file = await findTranscript(sid);
  // **우리 자식이면 자식의 stdout**(`live.activity`) — **남의 `.wip` 워커 세션이면 트랜스크립트의
  // 마지막 사건**(`activityFromEvent`) — 그 외(끝났거나 파일이 없다)는 `null`이다.
  const activity = running
    ? (entry?.live.activity ?? null)
    : workerLive && file
      ? activityFromEvent(await lastEvent(file))
      : null;
  if (!file) {
    return chunk({
      sessionId: sid,
      conversations,
      workers,
      schedules: scheduleList,
      turns: [],
      offset: at,
      reset,
      running,
      runningSessions,
      partial,
      activity,
      stopped,
      answered,
      // 답은 끝났다는데 읽을 파일이 없다 = §24 실패 ⑤. §9에서 같은 사실은 **빈 상태**였다 —
      // 세션이 붙은 적 없는 티켓은 부재지만, 여기는 방금 사람이 물었는데 답이 안 보이는 것이다.
      failed:
        failed ??
        (done
          ? { ...done, ok: false, reason: "no-transcript", output: `~/.claude/projects/*/${sid}.jsonl` }
          : null),
      refs: NO_REFS,
    });
  }
  const r = await tailEvents(file, at);
  const turns = toTurns(r.events);
  // **겹침 판정**(§7 §누적기를 비우는 자리 — 요구 `3dc948ac` · 실측 `c5d287ac`, 이 머신).
  // 누적기는 `message_start`에서만 비므로(`eatLine` 무수정) 도구가 도는 동안은 그대로 있다.
  // 비우는 자리를 `content_block_start`로 당기는 갈래는 버렸다 — 실측(3회 재현)에서 텍스트
  // 블록의 트랜스크립트 레코드가 다음 `content_block_start`보다 늘 105~587ms **뒤**에 떴다.
  // 그 자리로 당기면 그 지연만큼 화면에 빈 구간이 생긴다(§7이 "두 벌보다 나쁘다"고 적은 그것).
  // 대신 여기서 **마지막 답 줄과 누적분이 같으면 누적분을 뺀다** — 트랜스크립트가 그 답을
  // 이미 `turns`로 들인 바로 이 응답에서 뺀다(순서와 무관하게 통하는 이유는 `## 결과` 참조).
  // **가리는 것으로 끝내지 않고 누적기를 비운다**(신고: 답이 두 벌로 겹쳐 보인다). 종전에는 이
  // 응답의 `partial`만 빈 문자열로 내렸는데, `turns`는 **이 왕복에 새로 붙은 줄**뿐이다 —
  // 그 답 줄을 집어 간 폴링은 한 번뿐이라 다음 폴링부터는 `lastAnswer`가 `undefined`고 판정이
  // 다시 안 걸린다. 도구가 도는 동안(`message_start` 전) 그 창이 통째로 두 벌이었다.
  // 누적기를 비워도 잃을 글이 없다: 한 메시지에서 텍스트 블록 뒤에 오는 델타는 도구 인자
  // (`input_json_delta`)뿐이고 그건 애초에 안 붙는다(`eatLine`).
  // 이 폴링이 새로 읽은 `turns`에 답이 있으면 그게 최신이다 — 없으면 `entry.live.lastAnswer`가
  // 앞선 폴링에서 기억해 둔 값을 댄다(CPU 경합에서 `partial`이 한 박자 늦게 채워지는 창 — 실측
  // `2cad40e3`, 위 `Live.lastAnswer` 주석 참조).
  const newAnswer = turns.filter((t) => t.role === "answer").at(-1)?.text;
  if (newAnswer !== undefined && entry) entry.live.lastAnswer = newAnswer;
  const lastAnswer = newAnswer ?? entry?.live.lastAnswer;
  const overlap = partial !== "" && partial === lastAnswer;
  if (overlap && entry) entry.live.partial = "";
  const dedupedPartial = overlap ? "" : partial;
  // 산문 속 해시-P번호 표식(§9) — 이 회차의 새 `turns`(질문·답만, 접힌 줄 제외) + 도는 답의
  // `partial`만 훑는다. `mayHaveRefs`가 그 모양을 못 찾으면(대부분의 회차) `listTickets`를
  // 다시 안 돈다 — 홈은 이 앱에서 폴링 주기가 가장 짧은 자리라(§7 §천장이 없다) 여기가
  // 걸리면 비용이 가장 크다.
  const newText = [...turns.filter((t) => t.role !== "line").map((t) => t.text), dedupedPartial].join("\n");
  const refs = mayHaveRefs(newText)
    ? await (async () => {
        const project = await getProject(projectId);
        if (!project) return NO_REFS;
        const config = await resolveConfig(project);
        const homeTickets = await listTickets(project.root, config);
        const epics = await listEpics(project.root, homeTickets);
        return resolveMarkdownRefs(project.root, projectId, [newText], homeTickets, epics);
      })()
    : NO_REFS;
  return chunk({
    sessionId: sid,
    conversations,
    workers,
    schedules: scheduleList,
    turns,
    offset: r.offset,
    reset,
    running,
    runningSessions,
    partial: dedupedPartial,
    activity,
    stopped,
    failed,
    answered,
    refs,
  });
}
