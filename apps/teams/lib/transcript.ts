/** 세션 스트림(DESIGN.md §2-1)의 읽기 코어 — 화면 없는 순수 레이어.
 *
 *  원본은 Claude Code가 실시간 append하는 자기 트랜스크립트
 *  (`~/.claude/projects/<디렉터리>/<session_id>.jsonl`)다. 엔진도 같은 파일을 본다
 *  (`tickets.py:299 newest_transcript` · `:319 transcript_state`).
 *
 *  **출처가 하나 더 있다 — grok**(§4-3 §grok §세션 스트림, 요구 `390f788b`).
 *  `~/.grok/sessions/<pct-enc cwd>/<sid>/updates.jsonl`이고 자리·형식이 갈릴 뿐 사건은 같다.
 *  그 형식은 **`grokRecord`가 claude 레코드 모양으로 접고 나머지 전부는 두 엔진이 공유한다** —
 *  요약·키·첫 프롬프트 접기가 두 벌이 되면 화면이 엔진마다 다르게 보인다.
 *
 *  **여기가 틀리면 사건이 조용히 사라진다.** 그래서 이 파일의 계약은 두 줄이다:
 *  모르는 것은 던지지 말고 건너뛴다, 그리고 **불완전한 마지막 줄은 버리고 offset을 되돌린다**. */
import { readFileSync } from "node:fs";
import { access, open, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { lineDiff, type DiffLine } from "./edit-diff.ts";
import { engineRepo } from "./scaffold.ts";

/** 사건 한 줄. `label`이 비면 접지 않고 `body`를 그대로 보여준다(assistant text · 사용자 프롬프트).
 *  비지 않으면 접힌 줄이 `HH:MM:SS <label> <summary>`이고 펼치면 `body`다(§2-1 표). */
export type StreamEvent = {
  key: string; // 렌더 키. `<레코드 uuid>:<블록 index>`
  ts: string; // 레코드의 timestamp (UTC ISO). **로컬 시간 렌더는 화면이 한다**
  kind: "prompt" | "text" | "thinking" | "tool_use" | "tool_result" | "interject";
  label: string;
  summary: string;
  // §9: 요약이 리터럴이면 mono, 읽는 문장이면 sans. 판정이 도구 이름에 달렸으므로(파일 도구의
  // 상대경로는 리터럴, `Bash`의 `description`은 문장) 화면이 도구 목록을 다시 갖지 않게 여기서 준다
  summaryMono: boolean;
  body: string;
  sidechain: boolean; // isSidechain — 화면이 `서브` 표시를 붙인다
  // Edit 모양(`old_string`·`new_string` 둘 다 문자열)인 `tool_use`에서만 선다(§2-1 §펼친 Edit).
  // 있으면 화면이 `body`(JSON 전문) 대신 이 줄 단위 diff를 그린다 — 없으면(대부분의 tool_use)
  // 키 자체가 없다. `undefined`로 채우면 골든 테스트의 `deepEqual`이 키 유무로 갈린다.
  diff?: DiffLine[];
  replaceAll?: boolean; // `diff`가 있을 때만 뜻이 있다 — `replace_all: true`
};

/** §경로 방어. `session_id`는 사람 입력이 아니라 티켓 fm에서만 오고, 경로가 되기 전에 이걸 통과한다.
 *  트랜스크립트는 등록된 root 밖이라 이 정규식이 그 예외의 유일한 방어다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 티켓 fm → 이 티켓의 `session_id`, 또는 null. **경로가 되는 값이 여기 하나뿐이게 하는 관문이다.**
 *  `queue.ts`의 unquote와 같은 정규화(python `.strip().strip("\"'")`)를 거쳐 UUID_RE를 통과해야 한다.
 *  null 두 경우(키 없음 · 사람이 손으로 쓴 값)는 §9 빈 상태 표에서 **절 자체를 감춘다**로 같다 —
 *  그래서 화면이 둘을 구별할 필요가 없고 이 함수도 나누지 않는다. */
export function sessionIdOf(fm: Record<string, string>): string | null {
  const v = (fm.session_id ?? "").trim().replace(/^["']+|["']+$/g, "");
  return UUID_RE.test(v) ? v : null;
}

/** `<root>/<디렉터리>/<leaf>` 글롭. 매치가 **정확히 1개**일 때만 경로다.
 *  0개·2개 이상이면 빈 상태(null) — 디렉터리 이름을 유도하지 않는다(§2-1).
 *
 *  ponytail: 디렉터리 수만큼 access(**디렉터리** 실측 이 머신 75개 · 2026-08-04. 그 아래 트랜스크립트
 *  파일은 1900개대이고 §2-1 본문의 `864개`가 세는 것이 그 축이다). `fs.glob`이 하는 일과 같고
 *  @types/node@20에 없는 API를 안 쓴다. 느려지면 <session_id> → 경로를 프로세스 캐시에 둔다. */
async function globOne(root: string, leaf: string): Promise<string | null> {
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return null; // 그 CLI를 안 쓰는 머신은 디렉터리 자체가 없다 — 빈 상태다
  }
  const hits = (
    await Promise.all(
      dirs.map(async (d) => {
        if (!d.isDirectory()) return null;
        const p = path.join(root, d.name, leaf);
        return access(p).then(
          () => p,
          () => null,
        );
      }),
    )
  ).filter((p) => p !== null);
  return hits.length === 1 ? hits[0] : null; // 0개·2개 이상은 빈 상태
}

/** `~/.claude/projects/*​/<session_id>.jsonl`.
 *  `root`는 테스트가 픽스처 디렉터리를 주기 위한 것이다. 사용자 입력이 들어오는 자리가 아니다. */
export async function findTranscript(
  sessionId: string,
  root = path.join(homedir(), ".claude", "projects"),
): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null;
  return globOne(root, `${sessionId}.jsonl`);
}

/** `~/.grok/sessions/*​/<session_id>/updates.jsonl` (§4-3 §grok · 실측 `grok 0.2.118`).
 *
 *  **`chat_history.jsonl`이 아니다.** 그건 모델에 보내는 원본 대화 배열이라 `timestamp`·`uuid`가
 *  없다 — 이 파일이 요구하는 두 값이다. `updates.jsonl`은 ACP 세션 업데이트 NDJSON이다.
 *
 *  **디렉터리 이름을 cwd에서 찍지 않고 claude와 같은 글롭을 돈다.** 규칙(퍼센트 인코딩)을 아는
 *  것과 그 자리에서 cwd를 아는 것은 다른 문제다: 완료 티켓은 무는 워커가 없어 `holderEngine`이
 *  `null`인데 스트림은 리플레이로 서야 하고(claude가 그렇다), cwd를 화면에서 받으면 경로가 되는
 *  입력이 둘로 는다(§경로 방어는 `session_id` 하나만 통과시킨다). **규칙 자체는 `grokCwd`가
 *  되돌리는 방향으로 쓴다** — claude의 규칙(`usage.ts:166`)과 한 함수가 아니다. */
export async function findGrokTranscript(
  sessionId: string,
  root = path.join(homedir(), ".grok", "sessions"),
): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null;
  return globOne(root, path.join(sessionId, "updates.jsonl"));
}

/** 세션 id → 트랜스크립트 파일 + **어느 엔진 형식인가**(§2-1 · §4-3 §grok).
 *
 *  **엔진 이름을 묻지 않는다.** 두 CLI가 각자 자기 트리에만 자기 세션을 남기므로 *파일이 어느
 *  트리에 있느냐*가 곧 형식이고, 그래서 이 값이 `holderEngine`과 독립이다 — 워커가 이미 놓아 준
 *  완료 티켓에서도 스트림이 선다. claude를 먼저 보므로 claude 큐에서는 읽기가 종전과 같다
 *  (`~/.grok`을 아예 안 연다). */
export async function findStream(sessionId: string): Promise<{ file: string; grok: boolean } | null> {
  const claude = await findTranscript(sessionId);
  if (claude) return { file: claude, grok: false };
  const grok = await findGrokTranscript(sessionId);
  return grok ? { file: grok, grok: true } : null;
}

/** `offset` 뒤에 붙은 바이트만 읽어 사건 + 새 offset. 2MB를 매번 다시 읽지 않는다.
 *
 *  - **불완전한 마지막 줄을 버린다.** 새 offset은 마지막 `\n`까지로 되돌리고 다음 폴링이
 *    그 줄을 처음부터 다시 읽는다. 잘린 줄을 파싱해 건너뛰면 그 사건이 영구히 사라진다.
 *  - `offset`이 파일 크기보다 크면 `0`부터 다시 읽는다(있을 수 없는 상태지만 무한 빈 응답보다 낫다).
 *  - `grok`이면 줄마다 `grokRecord`를 한 번 지난다. **위 두 계약이 그 경로에서도 그대로다** —
 *    깨진 꼬리 줄은 여전히 버려지고(offset이 되돌아온다), 접히지 않는 종류는 건너뛴다. */
export async function tailEvents(
  file: string,
  offset: number,
  grok = false,
): Promise<{ events: StreamEvent[]; offset: number }> {
  let fh;
  try {
    fh = await open(file, "r");
  } catch {
    return { events: [], offset }; // 아직 없는 트랜스크립트 = 빈 상태
  }
  try {
    const { size } = await fh.stat();
    const start = offset >= 0 && offset <= size ? offset : 0;
    if (start === size) return { events: [], offset: start };

    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    const chunk = buf.subarray(0, bytesRead);
    // `\n`은 UTF-8 멀티바이트 시퀀스 안에 나타나지 않으므로 바이트로 잘라도 글자가 깨지지 않는다
    const cut = chunk.lastIndexOf(0x0a);
    if (cut < 0) return { events: [], offset: start }; // 온전한 줄이 하나도 없다

    const events: StreamEvent[] = [];
    let promptSeen = start > 0; // offset>0이면 세션 프롬프트도 그 `enqueue`도 이미 지나갔다
    let enqueueSeen = start > 0;
    // grok 레코드에는 `cwd`가 없다 — 담긴 자리가 **디렉터리 이름**이라 그것을 되돌려 쓴다
    const cwd = grok ? grokCwd(path.basename(path.dirname(path.dirname(file)))) : undefined;
    for (const line of chunk.subarray(0, cut).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 파싱 불가능한 줄은 조용히 건너뛴다. 스트림이 멈추는 것이 최악이다
      }
      if (grok) {
        rec = grokRecord(rec, cwd);
        if (rec === null) continue; // 대응물 없는 종류(`hook_execution` 등)는 건너뛴다
      }
      // **첫 `enqueue`는 안 흘린다**(§2-1) — 세션 프롬프트와 같은 글이고 이미 접힌 줄로 있다.
      // 판정은 `content` 비교가 아니라 **레코드 단위 첫 하나**이고(실측: record 0), 그래서
      // 레코드 간 상태다 — `promptSeen`과 같은 자리에 산다.
      if (isEnqueue(rec)) {
        const first = !enqueueSeen;
        enqueueSeen = true;
        if (first) continue;
      }
      const evs = recordToEvents(rec, !promptSeen);
      if (evs.some((e) => e.kind === "prompt")) promptSeen = true;
      events.push(...evs);
    }
    return { events, offset: start + cut + 1 };
  } finally {
    await fh.close();
  }
}

/** 이 세션이 **방금 한 일** 하나 — `.wip` 칸반 카드 맨 아래 줄의 값이다(§1-1).
 *
 *  파일 **전문**을 읽고 **뒤에서부터** 줄 단위로 훑어 **세울 글자가 있는** 첫 `tool_use`·assistant
 *  `text`에서 멈춘다. `tool_result`·`thinking`·`prompt`·`interject`는 *진행중이다*만 말하는데 그건
 *  이미 셋이 말한다(레인 · §18 점 · §19 워커 마크) — 걸러도 갱신은 산다(§1-1 실측: 남는 둘의
 *  간격 p50 8.6s). 히트 0 · 읽기 실패는 둘 다 `null`이고 화면은 **줄 자체를 안 세운다**
 *  (§1-1 §없을 때 · §경계).
 *
 *  **요약이 빈 `tool_use`는 안 고르고 뒤로 더 훑는다**(§1-1 §개정 · 요구 `d8772349`). 그 줄이
 *  `Bash`처럼 도구 이름만 서는 것이 실측 히트의 8.2%(화면 시간 8.5%)였다. 지우지 않고 물러서는
 *  이유는 지우면 카드가 24px 줄었다 늘었다 하며 레인 안 카드를 밀어서다(§36 §버린 안). 물러선
 *  값의 나이는 p50 16.9초 · p90 119.1초이고, 뒤로 더 훑는 사건 수는 p50 2 · 최대 27이다.
 *
 *  **꼬리 창으로는 못 맞힌다.** 거대한 `tool_result` 한 줄이 창을 통째로 먹어서(실측 한 줄 최대
 *  1307KB) 64KB 창의 적중률이 90.00%다 — 놓치는 조건이 *방금 큰 도구 결과가 왔을 때*라
 *  세션이 제일 바쁠 때 줄이 꺼진다(§1-1 §꼬리 창을 안 쓰는 이유).
 *
 *  ponytail: 트랜스크립트 전문을 읽고 뒤에서 훑는다(실측 p90 1.5MB · 5건 3.6ms). 파일이 수십
 *  MB가 되거나 진행중이 두 자릿수가 되면 그때 꼬리 창 + 미스 시 직전 값 유지(세션별 오프셋 캐시)
 *
 *  **`grok`이면 줄마다 `grokRecord`를 한 번 지난다** — `tailEvents`와 같은 규칙(§4-3 §grok · §1-1
 *  §grok 확장). claude 경로는 `grok`을 안 주면(기본 `false`) 이 줄 전에 아무것도 안 바뀐다.
 *
 *  스캔 자체(파일 전문을 뒤에서부터 레코드 단위로 훑는 것)는 `recordsBackward`가 하고, 여기는
 *  레코드마다 "세울 글자가 있는 tool_use·text"만 고르는 판정만 얹는다. `lastEvent`(홈 §7 활동
 *  3종)가 같은 스캔에 다른 판정(필터 없음)을 얹는 둘째 소비자다. */
export async function lastActivity(file: string, grok = false): Promise<StreamEvent | null> {
  for await (const rec of recordsBackward(file, grok)) {
    // 같은 레코드 안에서는 뒤 블록이 더 나중이다(assistant 한 장이 thinking+text+tool_use를 담는다)
    const hit = recordToEvents(rec)
      .filter(
        (e) =>
          (e.kind === "tool_use" || e.kind === "text") &&
          // **세울 글자가 없으면 안 고른다**(§1-1 §개정). 화면(§36 `wipLine`)이 세우는 것과 같은
          // 식이다 — `label`이 있으면 `summary`, 없으면 `body` 첫 줄. 도구 이름을 나열하지
          // 않는 이유는 지목된 `Bash`(87.6%) 말고 나머지 12.4%도 성질이 같아서다.
          (e.label ? e.summary : e.body.split("\n")[0]).trim() !== "",
      )
      .pop();
    if (hit) return hit;
  }
  return null;
}

/** 이 세션의 **마지막 사건 하나** — 필터가 없다(§7 §도는 워커 세션은 스레드에서도 돈다).
 *  `lastActivity`와 달리 `tool_result`·`thinking`·`prompt`도 히트다: 홈의 활동 3종 매핑
 *  (`activityFromEvent`, `lib/home-agent.ts`)이 그 갈래까지 셋으로 접으므로 여기서 먼저 걸러내면
 *  안 된다. 같은 이유로 "요약이 빈 tool_use"도 그대로 돌려준다 — 도구 이름 자체가 활동 문구다. */
export async function lastEvent(file: string, grok = false): Promise<StreamEvent | null> {
  for await (const rec of recordsBackward(file, grok)) {
    const events = recordToEvents(rec);
    if (events.length) return events.at(-1) ?? null;
  }
  return null;
}

/** `lastActivity`·`lastEvent`가 공유하는 스캔. 파일 **전문**을 읽고 **뒤에서부터** 레코드 단위로
 *  훑어 넘긴다(grok이면 `grokRecord`로 접은 뒤). 멈추는 것은 부르는 쪽이 정한다(첫 히트에서
 *  `return`) — 그래서 제너레이터다.
 *
 *  ponytail: 트랜스크립트 전문을 읽고 뒤에서 훑는다(실측 p90 1.5MB · 5건 3.6ms). 파일이 수십
 *  MB가 되거나 진행중이 두 자릿수가 되면 그때 꼬리 창 + 미스 시 직전 값 유지(세션별 오프셋 캐시) */
async function* recordsBackward(file: string, grok: boolean): AsyncGenerator<unknown> {
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    return; // 삭제·권한·아직 없는 파일 — 사람에게는 `히트 0`과 같은 뜻이다(*지금 말할 게 없다*)
  }
  // grok 레코드에는 `cwd`가 없다 — `tailEvents`와 같은 자리에서 디렉터리 이름을 되돌린다
  const cwd = grok ? grokCwd(path.basename(path.dirname(path.dirname(file)))) : undefined;
  // 줄을 끊는 것은 **바이트**다(`tailEvents`와 같은 근거 — `\n`은 UTF-8 멀티바이트 시퀀스 안에
  // 나타나지 않는다). 그래서 **훑은 줄만 문자열이 된다**: 전문을 `toString().split("\n")`으로 한 번에
  // 펴면 11MB 파일 하나에 50ms가 드는데(실측) 실제로 파싱하는 것은 뒤 두세 줄·수 KB다.
  let end = buf.length; // 지금 보는 줄은 `[개행+1, end)`
  while (end > 0) {
    const nl = buf.lastIndexOf(0x0a, end - 1); // -1이면 파일의 첫 줄이다
    const line = buf.toString("utf8", nl + 1, end);
    end = nl < 0 ? 0 : nl;
    if (!line.trim()) continue; // 마지막 줄은 개행 뒤 빈 문자열이고, append 중이면 반쪽 줄이다
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // 깨진 줄에 **멈추지 않는다** — 그 한 줄 때문에 줄이 꺼지는 것이 최악이다
    }
    if (grok) {
      rec = grokRecord(rec, cwd);
      if (rec === null) continue; // 대응물 없는 종류는 건너뛴다(`tailEvents`와 같은 규칙)
    }
    yield rec;
  }
}

/** **사람이 쓴 참견이 아니라 하니스가 스스로 밀어 넣은 봉투**를 거른다.
 *
 *  §2-2의 실측 세션에는 없던 것이 실측 코퍼스에는 있다 — 이 머신 트랜스크립트의 첫 줄 아닌
 *  `enqueue` 859건 중 `<task-notification>` 234 · `<observed_from_primary_session>` 553,
 *  사람 글은 72건뿐이다. **이 레포의 워커 세션에도 있다**(`e0d418fd` = `2100d54a`를 돌린 w3 세션,
 *  백그라운드 Bash 완료 4건). 거르지 않으면 사람이 아무 말도 안 한 티켓에 `참견 ·` 줄이 4개
 *  뜨고, 그 본문이 15줄짜리 XML이라 접지 않는 전문 줄이 스트림을 삼킨다.
 *
 *  판정은 **첫 줄이 여는 태그 하나뿐인가**다. 태그 이름을 나열하지 않는 이유는 하니스가 봉투를
 *  하나 더 만들면 그때마다 여기가 늘기 때문이고, 사람이 참견 첫 줄에 태그만 달랑 쓰는 일은 없다. */
const HARNESS_ENVELOPE = /^<[a-z][a-z0-9_-]*>\s*\n/;

/** `tick.sh`의 `TICKET_PROMPT_FMT` 값으로 만든 정규식 — 엔진이 찍는 티켓 배정 문구인지 판정한다
 *  (§2-9 ②). **문구를 이 파일에 베끼지 않는다** — `scaffold.test.ts:145`가 `package.json`을
 *  직접 읽는 그 수법 그대로다. `TICKET_PROMPT_FMT`을 바꾸면 이 판정도 같이 갈린다.
 *  `%s`(티켓 해시) 자리만 와일드카드고 나머지는 리터럴 — 매칭은 **머리만**(`^`, `$` 없음):
 *  `tick.sh`가 참조 컨텍스트·언어 문장을 배정 문구 뒤에 더 붙이기 때문이다(524행 이후).
 *  엔진 레포를 못 찾으면(배치 밖) `null` — 그 배치에서는 배정 문구를 그냥 참견으로 둔다. */
let assignmentPattern: RegExp | null | undefined;

function ticketAssignmentPattern(): RegExp | null {
  if (assignmentPattern !== undefined) return assignmentPattern;
  assignmentPattern = null;
  try {
    const repo = engineRepo();
    if ("path" in repo) {
      const sh = readFileSync(path.join(repo.path, "tick.sh"), "utf8");
      const m = sh.match(/^TICKET_PROMPT_FMT="\$\{TICKET_PROMPT_FMT:-(.*)\}"\s*$/m);
      if (m) {
        const escaped = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%s/g, ".*");
        assignmentPattern = new RegExp(`^${escaped}`);
      }
    }
  } catch {
    // 읽기 실패 — null 그대로, 판정을 건너뛴다
  }
  return assignmentPattern;
}

/** 참견 문구가 **엔진의 티켓 배정**인가(§2-9 ②) — 참인 것은 말풍선이 아니라 기록으로 간다. */
const isTicketAssignment = (text: string): boolean => ticketAssignmentPattern()?.test(text) ?? false;

/** 참견을 나르는 레코드인가(§2-2). **`content`가 있느냐와 무관하다** — 첫 `enqueue`를 안 흘리는
 *  판정이 레코드 단위라서(§2-1) `content` 없는 `enqueue`(실측 있다)도 그 한 장을 쓴다.
 *  안 그러면 그 뒤에 온 **진짜 참견**이 대신 사라진다. */
const isEnqueue = (rec: unknown): boolean => {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as { type?: unknown; operation?: unknown };
  return r.type === "queue-operation" && r.operation === "enqueue";
};

/** grok 세션 디렉터리 이름 → cwd. **규칙은 퍼센트 인코딩이다**
 *  (`/private/tmp/x` ↔ `%2Fprivate%2Ftmp%2Fx` — 실측 2026-08-05 · `grok 0.2.118`).
 *
 *  **claude의 규칙과 한 함수가 아니다.** 저쪽은 *비영숫자 전부 `-`*이고(`usage.ts:166`) 되돌릴 수
 *  없다. 이쪽은 정확히 되돌아오고, 우리가 쓰는 방향이 그 되돌리기다 — 파일을 찾는 것은 글롭이
 *  하고(`findGrokTranscript`) 이 값은 도구 요약의 상대경로에만 든다(claude가 레코드의 `cwd`로
 *  하는 그 일이다. §4-3 §grok "엔진마다 규칙 하나다"). */
export function grokCwd(dir: string): string | undefined {
  try {
    return decodeURIComponent(dir);
  } catch {
    return undefined; // 홀로 선 `%` — 요약이 절대경로로 선다(빈 상태가 아니다)
  }
}

/** ACP `content` 블록 → 글자. 실측은 `{type:"text", text}` 하나다 */
const grokText = (c: unknown): string => {
  const b = (c ?? {}) as { text?: unknown };
  return typeof b.text === "string" ? b.text : "";
};

/** `tool_call_update`의 `content` 블록 → claude `tool_result` 블록. 실측 두 종류다
 *  (`content` 67 · `diff` 8). `diff`는 **경로만** 세운다 — 앞선 `tool_use` 줄이 입력을 이미
 *  들고 있어서 여기서 diff 본문을 다시 펴면 같은 글이 두 번 흐른다.
 *  모르는 종류는 그대로 넘겨 `resultText`가 `[종류]`로 접는다(계약 그대로). */
const grokBlock = (raw: unknown): unknown => {
  const b = (raw ?? {}) as { type?: unknown; content?: unknown; path?: unknown };
  if (b.type === "content") return { type: "text", text: grokText(b.content) };
  if (b.type === "diff" && typeof b.path === "string") return { type: "text", text: b.path };
  return raw;
};

/** grok `updates.jsonl` 한 줄 → **claude 트랜스크립트 레코드 모양**(§4-3 §grok §세션 스트림).
 *  접히지 않는 줄은 `null`이고 부르는 쪽이 건너뛴다 — 실측에 `hook_execution` 99 ·
 *  `retry_state` 14 · `turn_completed` 10 · `plan` 1이 있고 claude에 대응물이 없다.
 *
 *  `sessionUpdate` → §2-1 `kind`가 스펙이 정한 다섯이다: `user_message_chunk`→`prompt` ·
 *  `agent_thought_chunk`→`thinking` · `agent_message_chunk`→`text` · `tool_call`→`tool_use` ·
 *  `tool_call_update`→`tool_result`.
 *
 *  **갈리는 값 셋.** `timestamp`가 unix **초**다(claude는 ISO 문자열 — `StreamEvent.ts`는
 *  종전대로 UTC ISO라 화면이 무수정이다) · `uuid`가 없어서 키가 `params._meta.eventId`다
 *  (초 단위라 `timestamp`로는 한 초에 온 줄들을 못 가른다) · 도구 이름표가
 *  `update._meta["x.ai/tool"].label`이다.
 *
 *  ponytail: 그 이름표로 `toolSummary`가 걸리는 것은 claude와 낱말이 같은 `Write` 하나다
 *  (`file_path`까지 같다). `Run Command`의 `description`·`Read`의 `target_file`도 세우려면
 *  grok 도구 이름표를 하나 둬야 하는데 그 표는 도구가 늘 때마다 낡는다 — 지금은 접힌 줄에
 *  라벨이 서고 펼치면 `rawInput` 전문이 있다. 요약이 빈 도구가 눈에 걸리면 그때 표를 만든다. */
function grokRecord(rec: unknown, cwd?: string): unknown {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as { timestamp?: unknown; params?: unknown };
  const at = typeof r.timestamp === "number" ? new Date(r.timestamp * 1000) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const p = (r.params ?? {}) as { update?: unknown; _meta?: unknown };
  const u = p.update;
  if (!u || typeof u !== "object") return null;
  const up = u as { sessionUpdate?: unknown; content?: unknown; rawInput?: unknown; _meta?: unknown };
  const eventId = ((p._meta ?? {}) as { eventId?: unknown }).eventId;
  const label = (((up._meta ?? {}) as Record<string, unknown>)["x.ai/tool"] ?? {}) as {
    label?: unknown;
  };
  const msg = (role: "user" | "assistant", content: unknown[]) => ({
    timestamp: at.toISOString(),
    uuid: typeof eventId === "string" ? eventId : undefined,
    cwd,
    message: { role, content },
  });
  switch (up.sessionUpdate) {
    case "user_message_chunk":
      return msg("user", [{ type: "text", text: grokText(up.content) }]);
    case "agent_message_chunk":
      return msg("assistant", [{ type: "text", text: grokText(up.content) }]);
    case "agent_thought_chunk":
      return msg("assistant", [{ type: "thinking", thinking: grokText(up.content) }]);
    case "tool_call":
      return msg("assistant", [
        { type: "tool_use", name: label.label, input: up.rawInput },
      ]);
    case "tool_call_update": {
      // **본문 없는 갱신은 안 흘린다.** 한 도구 호출에 갱신이 여러 번 오고(실측 세션 하나에서
      // 호출 24 · 갱신 85) 그중 26건은 상태만 바뀐 줄이라 `결과 · 0줄`이 스트림을 덮는다.
      // 같은 판정이 이 파일에 이미 있다 — 본문 없는 `enqueue`를 안 흘리는 그 줄(피드백
      // `edec37eb`)이고, 판정을 `resultText`로 하므로 **사건이 쓸 글과 같은 값**을 본다.
      const content = (Array.isArray(up.content) ? up.content : []).map(grokBlock);
      return resultText(content).trim() ? msg("user", [{ type: "tool_result", content }]) : null;
    }
    default:
      return null;
  }
}

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  tool_name?: string;
  input?: unknown;
  content?: unknown;
};

/** 레코드 하나 → 사건 0..n개 (§2-1 표). assistant 한 레코드가 thinking+text+tool_use를 함께 담는다.
 *  `message`가 없으면(`attachment`·`last-prompt`) 빈 배열이다 — **`queue-operation` 하나만 예외**고
 *  `timestamp`가 없으면 그것도 빈 배열이다.
 *  `collapseFirstPrompt`가 참이면 이 레코드의 첫 사용자 프롬프트를 `세션 프롬프트 n자`로 접는다. */
export function recordToEvents(rec: unknown, collapseFirstPrompt = false): StreamEvent[] {
  if (!rec || typeof rec !== "object") return [];
  const r = rec as {
    type?: unknown;
    operation?: unknown;
    content?: unknown;
    timestamp?: unknown;
    uuid?: unknown;
    cwd?: unknown;
    isSidechain?: unknown;
    message?: unknown;
  };
  const ts = typeof r.timestamp === "string" ? r.timestamp : "";
  if (!ts) return [];
  const uid = typeof r.uuid === "string" ? r.uuid : ts;

  // **참견**(§2-2). `message`가 없는 레코드 중 이것 하나만 흘린다 — `content`와 `timestamp`를
  // 자기가 들고 있어서(실측 §2-2 표 2) 화면이 낙관적 에코를 만들 필요가 없다.
  // `remove`는 세션이 그걸 집어 갔다는 뜻이라 **같은 문장이 두 번 뜬다** — 안 흘린다.
  // `dequeue`·모르는 `operation`·`content` 없는 줄(실측 셋 다 있다)은 조용히 건너뛴다.
  // `content`가 없는 `enqueue`는 이 머신 실측 1675건 중 815건이다(피드백 `edec37eb`) — 흘리면
  // 본문 없는 `참견` 줄이 서서 화면이 "사람이 참견했다"고 거짓말한다. 공백뿐인 것도 같다.
  if (r.type === "queue-operation") {
    const text = typeof r.content === "string" ? r.content : "";
    if (!isEnqueue(r) || !text.trim() || HARNESS_ENVELOPE.test(text)) return [];
    // §9의 **전문 줄**이다(§2-1 표: 펼칠 것이 없다 — 한 줄이 이미 전문이다). 사용자 프롬프트와
    // 같은 모양을 받는 이유는 같은 것이라서다: 밖에서 들어온 사람의 말.
    // **엔진 배정 문구는 예외다**(§2-9 ②) — 세션 프롬프트와 같은 성질이라 기록(접힌 줄)으로 간다.
    const assigned = isTicketAssignment(text);
    return [
      {
        key: `${uid}:q`, // 이 레코드에는 `uuid`가 없다(실측 키 5개) — `ts`가 키가 된다
        ts,
        kind: "interject",
        label: assigned ? "배정" : "", // 비면 화면이 전문 줄(말풍선)로, 있으면 접힌 줄로 그린다
        summary: assigned ? `${chars(text)}자` : "",
        summaryMono: false,
        body: text,
        sidechain: false,
      },
    ];
  }

  const msg = r.message;
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  const role = (msg as { role?: unknown }).role;
  const cwd = typeof r.cwd === "string" ? r.cwd : undefined;

  const events: StreamEvent[] = [];
  let promptDone = !collapseFirstPrompt;
  type Push = Omit<StreamEvent, "key" | "ts" | "sidechain" | "summaryMono"> & {
    summaryMono?: boolean;
  };
  const push = (i: number, e: Push) =>
    events.push({
      key: `${uid}:${i}`,
      ts,
      sidechain: r.isSidechain === true,
      ...e,
      summaryMono: e.summaryMono ?? false,
    });
  const prompt = (i: number, text: string) => {
    const first = !promptDone;
    promptDone = true;
    // 첫 프롬프트는 페르소나 + 프로토콜 전문이고 세션마다 같다(실측 8.6KB). **첫 아닌 프롬프트도
    // 전부 접힌다**(§2-9 ②) — 하니스가 새 턴으로 집어 간 참견의 재등장 · 이미지 자리표시자 ·
    // 엔진 배정의 재등장을 종류별로 나열해 거르지 않는다(§2-9 §버린 안: 문구 목록은 하니스가 문구를
    // 하나 더 만들 때마다 조용히 다시 샌다). 판정은 **자리**(첫이 아니다) 하나다.
    push(i, {
      kind: "prompt",
      label: first ? "세션 프롬프트" : "프롬프트",
      summary: `${chars(text)}자`,
      body: text,
    });
  };

  if (typeof content === "string") {
    prompt(0, content);
    return events;
  }
  if (!Array.isArray(content)) return [];

  content.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const b = raw as Block;
    switch (b.type) {
      case "text":
        if (role === "user") prompt(i, b.text ?? "");
        else push(i, { kind: "text", label: "", summary: "", body: b.text ?? "" });
        break;
      case "thinking": {
        // 본문이 암호화돼 `thinking: ""`로 오는 레코드가 대부분이다(실측 91개 중 86개).
        // 그래도 **줄은 흘린다** — 빼면 생각하는 동안 화면이 조용해져서 "멈춘 것"과
        // 구별되지 않는다(§2-1이 서브에이전트 줄을 빼지 않는 것과 같은 이유). 크기만 감춘다.
        const t = b.thinking ?? "";
        push(i, { kind: "thinking", label: "생각", summary: t ? `${chars(t)}자` : "", body: t });
        break;
      }
      case "tool_use": {
        const name = typeof b.name === "string" ? b.name : "도구";
        const s = toolSummary(name, b.input, cwd);
        const edit = editShape(b.input);
        push(i, {
          kind: "tool_use",
          label: name,
          summary: s.text,
          summaryMono: s.mono,
          body: b.input === undefined ? "" : JSON.stringify(b.input, null, 2),
          ...(edit ? { diff: lineDiff(edit.old, edit.new), replaceAll: edit.replaceAll } : {}),
        });
        break;
      }
      case "tool_result": {
        const body = resultText(b.content);
        push(i, { kind: "tool_result", label: "결과", summary: `${lines(body)}줄`, body });
        break;
      }
      // 모르는 블록(`image` 등)은 조용히 건너뛴다
    }
  });
  return events;
}

/** 코드포인트 수. 한글·이모지에서 UTF-16 길이와 갈린다 */
const chars = (s: string) => [...s].length;
const lines = (s: string) => (s.trimEnd() === "" ? 0 : s.trimEnd().split("\n").length);

/** `<요약>`은 도구마다 다르다. **모르는 도구에 인자를 추측해 넣지 않는다**(§2-1).
 *  `mono`는 §9의 서체 판정이다 — 경로는 리터럴, `description`은 읽는 문장이다. */
function toolSummary(name: string, input: unknown, cwd?: string): { text: string; mono: boolean } {
  const none = { text: "", mono: false };
  if (!input || typeof input !== "object") return none;
  const inp = input as { description?: unknown; file_path?: unknown };
  if (name === "Bash") {
    return typeof inp.description === "string" ? { text: inp.description, mono: false } : none;
  }
  if (name === "Read" || name === "Edit" || name === "Write") {
    if (typeof inp.file_path !== "string") return none;
    const rel = cwd && path.isAbsolute(inp.file_path) ? path.relative(cwd, inp.file_path) : "";
    // cwd 밖(`..`)은 전체 경로가 정보다 — 상대경로로 접어 놓으면 어디를 만졌는지가 사라진다
    return { text: rel && !rel.startsWith("..") ? rel : inp.file_path, mono: true };
  }
  return none;
}

/** `input`이 Edit 모양인가(§2-1 §펼친 Edit) — `old_string`·`new_string`이 **둘 다 문자열**일 때만.
 *  도구 이름을 안 보는 이유는 판정이 모양 하나여서다 — codex의 Edit형 `tool_call`이 같은 모양으로
 *  오면 이 판정이 공짜로 덮는다(§2-1). */
function editShape(input: unknown): { old: string; new: string; replaceAll: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const i = input as { old_string?: unknown; new_string?: unknown; replace_all?: unknown };
  if (typeof i.old_string !== "string" || typeof i.new_string !== "string") return null;
  return { old: i.old_string, new: i.new_string, replaceAll: i.replace_all === true };
}

/** tool_result의 `content`는 문자열이거나 블록 배열이다(실측: text · image · tool_reference). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((raw) => {
      if (!raw || typeof raw !== "object") return "";
      const b = raw as Block;
      if (typeof b.text === "string") return b.text;
      if (b.type === "tool_reference") return `[${b.tool_name ?? "tool_reference"}]`;
      return `[${b.type ?? "?"}]`; // image 등 — 원문 대신 종류만
    })
    .join("\n");
}
