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
 *               --tools Read,Glob,Grep
 *               --strict-mcp-config
 *               --permission-mode manual
 *               --allowed-tools Read,Glob,Grep
 *               --output-format json
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
 *  - **`--allowed-tools`는 그 `manual` 위에서 읽기 셋을 물어보지 않게 한다.** 이제 도구 집합의
 *    가드가 아니다 — 그 일은 `--tools`가 한다. 값은 **쉼표로 붙인 한 토큰**이어야 한다: 이 옵션도
 *    `--tools`도 variadic(`<tools...>`)이라 `--allowed-tools Read Glob Grep "<질문>"`으로 띄우면
 *    질문까지 도구 이름으로 먹고 `Input must be provided either through stdin or as a prompt
 *    argument`로 죽는다.
 *  - **모델 플래그가 없다.** §7이 `claude` 고정 · `모델 지정 안 함`으로 박았다(codex는 트랜스크립트를
 *    안 남겨서 고를 수 있게 하는 순간 이 화면이 빈다 — §4-3 표).
 *  - **`--output-format json`.** 마지막 한 줄이 `{is_error, result, session_id, permission_denials}`다.
 *    화면이 그리는 것은 트랜스크립트(§2-1 읽기 코어)이고 여기서 필요한 건 성패와 사유뿐이라
 *    stream-json을 파싱하지 않는다.
 *
 *  프롬프트는 **argv 마지막 토큰**이다(stdin이 아니다). 그리고 자식의 stdin을 **즉시 닫는다** —
 *  안 닫으면 `claude`가 `Warning: no stdin data received in 3s`로 3초를 버린다(실측 11.3s → 5.9s).
 *  `promisify(execFile)`을 못 쓰는 이유가 이것이다: 저 래퍼는 자식 핸들을 안 주고, `stdio` 옵션은
 *  `execFile`이 통째로 버린다(넘겨도 경고가 그대로 난다 — 실측). tick.sh 비스트리밍 경로가
 *  `</dev/null`을 붙인 것과 같은 사건이다(`7d9fbe9`). */
import { execFile, type ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findClaude, tokenPath } from "./auth.ts";
import type { Run } from "./engine.ts";
import { registryPath, resolveConfig, type Project, type ProjectConfig } from "./projects.ts";
import { isAwaiting, listTickets, reqTitle, statusOf, type Ticket } from "./queue.ts";
import { findTranscript, sessionIdOf, tailEvents, type StreamEvent } from "./transcript.ts";
import { engineCell, listWorkers, type Worker } from "./workers.ts";

/** §7: **상한 5분.** `runWorker`의 60초와 다른 값이다 — 저건 python 스캔이고 이건 세션이다. */
const TIMEOUT_MS = 5 * 60_000;

/** 세션에 존재하는 도구 전부(§7 표 `세션의 도구는 Read·Glob·Grep 셋뿐이다`). **쉼표 한 토큰**이다(머리 주석의 variadic 함정). */
const TOOLS = "Read,Glob,Grep";

/** 도구 표면을 정하는 플래그 **전부**. 세 조각이 각자 다른 층을 막으므로 하나라도 빠지면 표면이
 *  넓어진다(머리 주석의 A/B): `--tools`가 built-in 목록을 셋으로 만들고, `--strict-mcp-config`가
 *  사람 머신의 MCP 도구를 빼고, `--permission-mode manual`이 남은 것의 관문이다.
 *  `--allowed-tools`는 그 `manual`이 읽기 셋을 물어보지 않게 하는 조각이지 도구 가드가 아니다.
 *
 *  **`home-agent.test.ts`가 이 배열을 검증한다.** `--allowed-tools`만 남기는 회귀가 `89962e56`
 *  그 사건이었고, 그건 코드를 봐서는 안 틀려 보인다 — 플래그 이름이 하는 일을 말해주지 않는다. */
export const TOOL_FLAGS: readonly string[] = [
  "--tools",
  TOOLS,
  "--strict-mcp-config",
  "--permission-mode",
  "manual",
  "--allowed-tools",
  TOOLS,
];

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
};

/** 한 프로젝트가 이 파일에 갖는 것 전부. `current`는 **목록에 있는 줄**만 가리킨다. */
export type Home = { conversations: Conversation[]; current: string | null };

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
    return id ? { conversations: [{ id, title: "", created: "" }], current: id } : { conversations: [], current: null };
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
      },
    ];
  });
  const cur = uuid(o.current);
  return { conversations, current: cur && conversations.some((c) => c.id === cur) ? cur : null };
}

/** 목록 읽기 — 화면이 대화 목록을 그리는 출처(§비주얼 §24). */
export async function readHome(projectId: string): Promise<Home> {
  return parseHome((await readSessions())[projectId]);
}

/** 한 프로젝트만 갈아 끼운다 — 파일 하나에 프로젝트 전부가 사므로 나머지는 읽은 그대로 다시 쓴다. */
async function writeHome(projectId: string, home: Home): Promise<void> {
  const p = sessionsPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ ...(await readSessions()), [projectId]: home }, null, 2) + "\n");
}

/** 지금 보는 대화의 session id. 없으면 null(= 다음 질문이 새 줄을 연다). */
export async function readSessionId(projectId: string): Promise<string | null> {
  return (await readHome(projectId)).current;
}

/** 목록 끝에 줄 하나를 붙이고 **오래된 쪽을 상한에서 자른다**(§7 상한 20). 새 줄은 항상 끝이라
 *  앞에서 자르는 것이 곧 "가장 오래된 줄이 빠진다"이고, 방금 연 대화는 잘릴 수 없다. */
function append(home: Home, row: Conversation): Home {
  return { conversations: [...home.conversations, row].slice(-LIMIT), current: row.id };
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

/** 대화 전환 — `current` 교체가 전부다. **목록에 없는 값은 안 받는다**: 이 값은 경로가 되고,
 *  클라이언트가 들고 오는 문자열이다(관문이 `sessionIdOf` 하나인 것과 같은 이유). */
export async function switchConversation(projectId: string, sessionId: string): Promise<boolean> {
  const home = await readHome(projectId);
  if (!home.conversations.some((c) => c.id === sessionId)) return false;
  await writeHome(projectId, { ...home, current: sessionId });
  return true;
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
};

/** 스냅샷 문자열. **순수 함수다**(fs를 안 탄다) — `home-agent.test.ts`가 이걸 검증한다.
 *
 *  `readSummary`를 부르지 않고 같은 판정 함수를 직접 부른다: 저건 `listWorkers`를 **티켓 없이**
 *  불러서 `holding`이 항상 null이고(§7 표가 요구하는 "물고 있는 티켓"이 통째로 빈다), 여기서
 *  다시 부르면 큐를 두 번 읽는다. 세는 식(`state === "open"` …)은 그 파일과 글자로 같다. */
export function renderSnapshot({ project, config, tickets, workers }: SnapshotInput): string {
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
    `- 프로토콜: \`${config.protocols}/\``,
    `- 페르소나: \`${config.personas}/\``,
    `- 제품 스펙(단일 출처): \`${path.join(path.dirname(project.root), "docs/DESIGN.md")}\``,
    `- 엔진 계약: \`${path.join(path.dirname(project.root), "README.md")}\``,
  ].join("\n");
}

/** 큐를 한 번 읽어 스냅샷을 만든다. 못 읽으면 **사유를 그대로 담은 스냅샷**이다 — 던지면
 *  질문 자체가 사라지고, 삼키면 에이전트가 "워커가 없다"고 거짓말한다(§6 에러 3요소). */
export async function snapshotOf(project: Pick<Project, "name" | "root">): Promise<string> {
  try {
    const config = await resolveConfig(project);
    const tickets = await listTickets(project.root, config);
    const workers = await listWorkers(project.root, tickets);
    return renderSnapshot({ project, config, tickets, workers });
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

/** 스냅샷 + 질문. **질문마다 새로 붙인다** — 세션 첫 턴에만 넣으면 두 번째 질문부터 낡은 상태를
 *  말한다(§7). 읽기 전용이라는 사실을 글로도 적는 이유: 플래그가 막는 것과 별개로, 막힌 도구를
 *  두드리다 답을 못 하고 끝나는 턴이 사람에게는 그냥 고장으로 보인다. */
export function buildPrompt(snapshot: string, question: string): string {
  return `${snapshot}

---

너는 이 큐를 보는 GUI의 **질의응답 에이전트**다. 읽고 답하는 것이 전부다 — 티켓을 만들지도
고치지도 않는다(쓰기 도구는 애초에 막혀 있다). 사실만 말하고, 모르면 어느 파일을 봐야 하는지
말한다. 답은 한국어로, 화면의 대화 칸에 들어갈 길이로 쓴다.
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
 *  (`InterjectReason`과 같은 규약). `other`는 §24 표에 항이 없는 나머지다. */
export type AnswerReason = "spawn" | "auth" | "timeout" | "busy" | "no-transcript" | "other";

/** `Run`(`lib/engine.ts`)과 **같은 모양**에 세션 두 값을 더한 것. rc와 사유를 삼키지 않는다. */
export type Answer = Run & {
  /** 이 답이 들어간 세션. 화면이 `findTranscript`에 그대로 넘긴다 */
  sessionId: string;
  /** 이어붙인 질문인가(`--resume`) — 첫 질문이면 false */
  resumed: boolean;
  /** 실패했을 때만. 성공에는 갈릴 것이 없다 */
  reason?: AnswerReason;
};

/** 질문 하나 = 프로세스 하나(§7). 첫 질문이 세션을 열고 다음 질문이 그것을 잇는다.
 *
 *  **cwd는 큐의 부모**(`dirname(project.root)`)다 — 등록값이 `<프로젝트>/.dira`라 그 부모가 repo다.
 *  트랜스크립트 디렉터리 이름도 이 cwd에서 나오므로 여기를 바꾸면 §2-1 읽기 코어가 못 찾는다.
 *
 *  **동시 실행을 막지 않는다**(§7: "한 프로젝트에 한 번에 한 질문"). 그 잠금은 입력 칸을 잠그는
 *  화면의 일이고, 여기에 큐잉 층을 만들지 않는다. */
export async function ask(project: Pick<Project, "id" | "name" | "root">, question: string): Promise<Answer> {
  const q = question.trim();
  if (!q) return { ok: false, reason: "other", output: "질문이 비어 있습니다.", sessionId: "", resumed: false };

  // `claude`를 우리가 PATH에서 찾는다 — 셸에 맡기면 손에 남는 게 rc 127뿐이다(§0-4 `bcf66f01`).
  const bin = findClaude();
  if (!bin) {
    return {
      ok: false,
      reason: "spawn",
      output: `PATH에서 claude를 찾지 못했습니다. (PATH=${process.env.PATH ?? ""})`,
      sessionId: "",
      resumed: false,
    };
  }

  const { sessionId, resumed } = await beginTurn(project.id, q);
  const prompt = buildPrompt(await snapshotOf(project), q);

  const run = await runClaude(bin, path.dirname(project.root), prompt, [
    ...(resumed ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ]);

  if (!resumed) await settleFirstTurn(project.id, sessionId, run.ok);

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
  await writeHome(projectId, {
    conversations: home.conversations.map((c) => (c.id === sessionId ? next : c)),
    current: home.current === sessionId ? next.id : home.current,
  });
}

async function runClaude(
  bin: string,
  cwd: string,
  prompt: string,
  session: string[],
): Promise<Run & { reason?: AnswerReason }> {
  const args = [
    "-p",
    ...session,
    ...TOOL_FLAGS,
    "--output-format",
    "json",
    prompt, // variadic 옵션 뒤에 오면 먹힌다 — `--output-format json`이 사이를 끊어 준다
  ];

  // tick.sh 57~59행과 **같은 한 줄**: claude 엔진일 때만 헤드리스 OAuth 토큰을 넣는다.
  // GUI가 Finder에서 뜬 `.app`이면 사람 셸의 환경을 못 물려받는다 — 그때 이 파일이 유일한 인증이다.
  const env = { ...process.env };
  const tok = await readFile(tokenPath(), "utf8").catch(() => null);
  if (tok?.trim()) env.CLAUDE_CODE_OAUTH_TOKEN = tok.replace(/[\r\n]/g, "");

  const { err, stdout, stderr } = await new Promise<{
    err: ExecFileException | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = execFile(
      bin,
      args,
      { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 4 << 20 },
      (e, out, errOut) => resolve({ err: e, stdout: out, stderr: errOut }),
    );
    child.stdin?.end(); // 머리 주석: 안 닫으면 3초를 버린다
  });

  if (err?.killed) {
    return {
      ok: false,
      reason: "timeout",
      // §비주얼 §24 실패 ③의 **원인 원문 열**이다(`상한 300초 초과 · session <id>` — session은
      // 화면이 `Answer.sessionId`로 붙인다). 한국어 문장을 여기 두지 않는 이유: 제목이 이미
      // `5분을 넘겼습니다`라 같은 말이 두 줄로 겹치고, 원문 줄은 사람이 손으로 재현할 값의 자리다.
      output: `상한 ${TIMEOUT_MS / 1000}초 초과`,
    };
  }

  // `--output-format json`은 마지막 줄 하나가 결과 객체다. 앞줄(경고 등)은 결과가 아니다.
  const last = stdout.trim().split("\n").pop() ?? "";
  let d: { is_error?: unknown; result?: unknown; subtype?: unknown; api_error_status?: unknown };
  try {
    d = JSON.parse(last) as typeof d;
  } catch {
    // 파싱 실패 = 엔진이 결과를 못 낸 것이다. 원문을 그대로 올린다 — 여기서 문구를 지어내면
    // 사람이 손으로 같은 커맨드를 돌려 볼 단서가 사라진다(§6 에러 3요소).
    // spawn 자체가 실패한 것(`ENOENT`·권한)도 여기로 떨어진다 — 그래서 §24 ①이다.
    return {
      ok: false,
      reason: "spawn",
      output: (stdout + stderr).trim() || err?.message || "엔진이 아무것도 출력하지 않았습니다.",
    };
  }
  const text = typeof d.result === "string" ? d.result : "";
  if (d.is_error === true || !text) {
    return {
      // **인증 실패 판정은 문장이 아니라 `api_error_status`다**(§24 ②). 실측(이 머신,
      // 2026-08-01, `HOME=<빈 디렉터리>` + 못 쓰는 토큰): `is_error:true` · `subtype:"success"` ·
      // `api_error_status:401` · `result:"Failed to authenticate. API Error: 401 OAuth access
      // token is invalid."`. `subtype`이 `success`라 저 키로는 안 갈리고, 문장으로 갈리면
      // CLI가 문구를 고치는 날 이 화면이 §0-4 설정을 가리키지 못한다.
      reason: d.api_error_status === 401 || d.api_error_status === 403 ? "auth" : "other",
      ok: false,
      output:
        [text, String(d.subtype ?? ""), stderr.trim()].filter(Boolean).join("\n") ||
        "엔진이 빈 답을 냈습니다.",
    };
  }
  return { ok: true, output: text };
}

// ── 대화 (§비주얼 §24) ──────────────────────────────────────────────────────
//
// 화면이 그리는 것은 **트랜스크립트 파일**이다(§7). 그래서 새로고침이 언제나 같은 것을 그리고,
// 낙관적 에코가 없고, 이 앱에 대화 이력 저장소가 없다.

/** 대화 줄 **두 종**(§24: 도구 호출 줄을 안 그린다 — 그건 §2-1 스트림의 일이다). */
export type Turn = {
  key: string; // `StreamEvent.key` 그대로 — `<레코드 uuid>:<블록 index>`
  role: "question" | "answer";
  text: string;
};

/** 사건 → 대화 줄. 남는 것은 사용자 프롬프트와 assistant `text` 둘뿐이고 나머지(생각·도구·결과)는
 *  이 화면에 없다. 서브에이전트 줄(`sidechain`)도 뺀다 — 이 세션의 도구는 읽기 셋뿐이라 날 일이
 *  없지만, 나면 그건 대화가 아니라 로그다. */
export function toTurns(events: StreamEvent[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of events) {
    if (e.sidechain) continue;
    const text = e.kind === "prompt" ? questionOf(e.body) : e.kind === "text" ? e.body.trim() : "";
    if (text) turns.push({ key: e.key, role: e.kind === "prompt" ? "question" : "answer", text });
  }
  return turns;
}

/** 지금 이 프로젝트에서 도는 질문. **`result`가 채워지는 순간이 곧 끝**이고, 그걸 집어 가는 것은
 *  폴링 한 번이다(집어 가면서 지운다).
 *
 *  이 맵이 **§24 실패 ④의 근거**다 — 화면의 잠금은 새로고침 한 번에 풀리므로(폼 상태다) 서버가
 *  한 번 더 판정한다. 큐잉 층이 아니다: 둘째 질문은 기다리지 않고 **거절**된다(§7).
 *  // ponytail: 프로세스 메모리다. dev의 HMR·재시작에 날아가면 폴링이 멈추고 답은 다음
 *  //           새로고침에 트랜스크립트에서 그대로 뜬다 — 잃는 것은 실패 Alert 한 장이다. */
const runs = new Map<string, { result: Answer | null }>();

export const isAsking = (projectId: string): boolean => runs.has(projectId);

/** 질문을 **띄우고 바로 돌아온다**(§24). 5분을 응답 하나로 붙들고 있지 않는 이유 셋:
 *  ① 도는 동안 폴링이 답의 조각을 그려야 하고 ② 새로고침해도 따라가야 하고
 *  ③ 실패 ④를 판정할 곳이 서버여야 한다. 셋 다 "누가 도는지"를 서버가 알아야 한다는 한 사실이다.
 *
 *  돌려주는 것은 **실패뿐**이다(`null` = 시작했다). 성공의 도착은 폴링이 말한다.
 *  검사와 등록 사이에 `await`가 없다 — 두 요청이 동시에 통과하지 못하는 근거가 그것이다. */
export async function startAsk(
  project: Pick<Project, "id" | "name" | "root">,
  question: string,
): Promise<Answer | null> {
  if (runs.has(project.id)) {
    const sid = await readSessionId(project.id);
    return {
      ok: false,
      reason: "busy",
      output: `session ${sid ?? "(시작 중)"}`,
      sessionId: sid ?? "",
      resumed: true,
    };
  }
  const q = question.trim();
  if (!q) {
    return { ok: false, reason: "other", output: "질문이 비어 있습니다.", sessionId: "", resumed: false };
  }
  const entry: { result: Answer | null } = { result: null };
  runs.set(project.id, entry);
  void ask(project, q).then(
    (a) => (entry.result = a),
    // `ask`는 던지지 않게 쓰여 있지만(안이 전부 catch다) 여기서 던지면 unhandled rejection으로
    // 서버가 죽고 화면은 영영 `도는 중`이다. 마지막 관문 하나를 둔다.
    (e: Error) => (entry.result = { ok: false, reason: "other", output: e.message, sessionId: "", resumed: false }),
  );
  return null;
}

/** 폴링 한 번 = 화면이 아는 전부. 페이지의 첫 렌더도 이걸 부른다(`offset` 0 · `sessionId` null). */
export type HomeChunk = {
  sessionId: string | null;
  turns: Turn[];
  offset: number;
  /** 세션이 갈렸다(`새 대화` 뒤 첫 질문 · 첫 질문 실패 뒤 재시도) — 화면은 **갈아 끼운다** */
  reset: boolean;
  running: boolean;
  /** 끝난 **실패**. 성공은 말풍선이 이미 말했으므로 여기 안 담는다 */
  failed: Answer | null;
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
  // **끝났는지를 읽는 것이 파일을 읽는 것보다 먼저다.** 뒤집으면 tail과 종료 사이에 쓰인 마지막
  // 줄을 못 읽은 채로 `running: false`를 돌려주고, 폴링이 멈춰서 답이 새로고침 전까지 안 뜬다.
  const done = runs.get(projectId)?.result ?? null;
  if (done) runs.delete(projectId);

  const sid = await readSessionId(projectId);
  const reset = sid !== sessionId;
  const at = reset || !Number.isSafeInteger(offset) || offset < 0 ? 0 : offset;
  const failed = done && !done.ok ? done : null;
  const running = runs.has(projectId);

  if (!sid) return { sessionId: null, turns: [], offset: 0, reset, running, failed };

  const file = await findTranscript(sid);
  if (!file) {
    return {
      sessionId: sid,
      turns: [],
      offset: at,
      reset,
      running,
      // 답은 끝났다는데 읽을 파일이 없다 = §24 실패 ⑤. §9에서 같은 사실은 **빈 상태**였다 —
      // 세션이 붙은 적 없는 티켓은 부재지만, 여기는 방금 사람이 물었는데 답이 안 보이는 것이다.
      failed:
        failed ??
        (done
          ? { ...done, ok: false, reason: "no-transcript", output: `~/.claude/projects/*/${sid}.jsonl` }
          : null),
    };
  }
  const r = await tailEvents(file, at);
  return { sessionId: sid, turns: toTurns(r.events), offset: r.offset, reset, running, failed };
}
