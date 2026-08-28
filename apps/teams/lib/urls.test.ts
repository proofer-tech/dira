import { test } from "node:test";
import assert from "node:assert";
import {
  activeEpicFrom,
  chatRows,
  dateTimeLabel,
  doneLimit,
  DONE_LANE_LIMIT,
  engineCan,
  engineMissing,
  findMatches,
  formatElapsed,
  formatRemaining,
  groupProgress,
  hasFindBar,
  interjectMode,
  matchesStreamFilter,
  mergeProgress,
  pairTool,
  parentPath,
  planBlocks,
  progressFilterKindOf,
  progressMarkerText,
  relativeElapsed,
  toolChipCounts,
  projectPath,
  relationPath,
  relativeUnderAny,
  remainingLabel,
  rowLimit,
  ROW_PAGE,
  scheduleRows,
  screenOf,
  timeLabel,
  visibleChatRows,
  windowEvents,
  type Anchor,
  type GroupedItem,
  type ProgressItem,
} from "./urls.ts";

/** 전환기는 **같은 화면 종류를 유지한다**(DESIGN.md §0-1). 홈이 그 규칙의 다섯 번째 줄이다 —
 *  홈에서 프로젝트를 바꾸면 보드가 아니라 그쪽 홈이다. 티켓 상세만 예외로 보드로 떨어진다. */
test("projectPath — 홈 → 홈이다(§7)", () => {
  assert.equal(projectPath("/p/a/home", "b"), "/p/b/home");
  assert.equal(projectPath("/p/a/workers", "b"), "/p/b/workers");
  assert.equal(projectPath("/p/a", "b"), "/p/b"); // 보드
  assert.equal(projectPath("/p/a/tickets/fff28e90", "b"), "/p/b"); // 해시는 큐마다 독립이다
});

/** 화면 부모 표 (DESIGN.md §0-7). `Esc`의 목적지가 이 함수 하나에서 나온다 — 표가 코드와
 *  갈리면 `Esc`가 선언에 없는 곳으로 가거나(더 나쁘게) 보드에서 화면이 흔들린다. */
test("parentPath — 부모가 없는 화면은 `null`이다(§0-7 표 1·2행)", () => {
  assert.equal(parentPath("/"), null);
  assert.equal(parentPath("/p/a"), null);
  assert.equal(parentPath("/p/a/"), null); // 보드의 정본 URL과 같은 화면이다
  assert.equal(parentPath("/p/a/home"), null); // 홈도 부모가 없다 — `Esc`는 무동작이다(§7)
});

test("parentPath — 프로젝트 화면 여섯의 부모는 보드다(§0-7 표 3~7행)", () => {
  assert.equal(parentPath("/p/a/workers"), "/p/a");
  assert.equal(parentPath("/p/a/personas"), "/p/a");
  assert.equal(parentPath("/p/a/protocols"), "/p/a");
  assert.equal(parentPath("/p/a/ontology"), "/p/a");
  assert.equal(parentPath("/p/a/tickets/fff28e90"), "/p/a");
  assert.equal(parentPath("/p/a/tickets/new"), "/p/a"); // 발행도 보드에서 들어간다(§비주얼 §4)
  assert.equal(parentPath("/p/a/epics"), "/p/a");
  assert.equal(parentPath("/p/a/epics/P273"), "/p/a"); // 에픽 화면(§에픽 §결정 6)
});

test("parentPath — 한글 stem은 인코딩돼도 같은 부모다", () => {
  // Next는 세그먼트를 퍼센트 인코딩된 원문으로 넘긴다(`decodeHash`) — 목적지가 프로젝트
  // id뿐이라 풀지 않는다. 두 표기가 갈리면 한글 티켓에서만 `Esc`가 죽는다.
  assert.equal(parentPath("/p/a/tickets/한글제목"), "/p/a");
  assert.equal(parentPath("/p/a/tickets/%ED%95%9C%EA%B8%80%EC%A0%9C%EB%AA%A9"), "/p/a");
});

test("parentPath — 표에 없는 경로에 부모를 지어내지 않는다", () => {
  assert.equal(parentPath("/settings"), null);
  assert.equal(parentPath("/p/a/bogus"), null);
  assert.equal(parentPath("/p/a/ticketsss"), null); // 접두만 같은 것에 안 걸린다
});

test("activeEpicFrom — 보드의 `?epic=`이 우선이고, 값 그대로 돌려준다(§에픽 §결정 10)", () => {
  assert.equal(activeEpicFrom("/p/a", "?epic=P273"), "P273");
  assert.equal(activeEpicFrom("/p/a", "?epic="), ""); // `(에픽 없음)` — 필터는 있으나 값이 없다
});

test("activeEpicFrom — 에픽 화면은 경로 세그먼트에서 읽는다", () => {
  assert.equal(activeEpicFrom("/p/a/epics/P273", ""), "P273");
  assert.equal(activeEpicFrom("/p/a/epics/한글", ""), "한글"); // decodeHash로 푼다
});

test("activeEpicFrom — 필터도 세그먼트도 없으면 빈 문자열이다(워커·설정·티켓 상세 등)", () => {
  assert.equal(activeEpicFrom("/p/a/workers", ""), "");
  assert.equal(activeEpicFrom("/p/a/tickets/fff28e90", ""), "");
  assert.equal(activeEpicFrom("/p/a/epics", ""), ""); // 목록 화면은 세그먼트가 없다
});

/** 사용 통계 화면 enum (DESIGN.md §0-11 이벤트 표 · 익명 규칙). 이 매핑이 틀리면 GA에 **경로가
 *  아니라 잘못된 화면 이름**이 쌓이고, 표 밖 경로에 이름을 지어내면 없는 화면이 뜬다. */
test("screenOf — 화면 8종이 표 그대로 나온다(§0-11 `screen_view`)", () => {
  assert.equal(screenOf("/"), "root");
  assert.equal(screenOf("/p/dira"), "board");
  assert.equal(screenOf("/p/dira/"), "board"); // 보드의 정본 URL과 같은 화면이다
  assert.equal(screenOf("/p/dira/tickets/fff28e90"), "ticket");
  assert.equal(screenOf("/p/dira/workers"), "workers");
  assert.equal(screenOf("/p/dira/personas"), "personas");
  assert.equal(screenOf("/p/dira/protocols"), "protocols");
  assert.equal(screenOf("/p/dira/ontology"), "ontology");
  assert.equal(screenOf("/p/dira/home"), "home");
});

test("screenOf — 프로젝트 이름도 티켓 해시도 값에 안 남는다(익명 규칙)", () => {
  // 나가는 것은 enum 하나다. 두 경로가 담은 이름·해시가 결과에 한 글자도 없어야 한다.
  assert.equal(screenOf("/p/비밀프로젝트/tickets/%ED%95%9C%EA%B8%80"), "ticket");
  assert.equal(screenOf("/p/비밀프로젝트/workers"), "workers");
});

test("screenOf — 표에 없는 경로는 `null`이라 아무것도 안 보낸다", () => {
  assert.equal(screenOf("/nosuchpage"), null);
  assert.equal(screenOf("/p/dira/bogus"), null);
  assert.equal(screenOf("/p/dira/ticketsss"), null); // 접두만 같은 것에 안 걸린다
  assert.equal(screenOf("/p/dira/tickets"), null); // 해시 없는 자리에는 화면이 없다
  assert.equal(screenOf("/p/dira/workers/x"), null);
});

/** 페르소나 선택이 경로에 담긴다 (DESIGN.md §5 §선택이 경로에 담긴다 — 깨지는 자리 표 ①②④).
 *  세그먼트 하나가 더 붙는 것을 아무도 예상하지 않고 쓴 판정 셋이다. 넓히지 않으면 그 화면이
 *  통계에서 통째로 빠지고(①), 찾기 바가 사라지고(②), 전환기가 남의 큐에 없는 이름을 연다(④). */
test("페르소나 이름이 경로에 붙어도 같은 화면이다(§5 ①②)", () => {
  assert.equal(screenOf("/p/a/personas/designer"), "personas"); // 이름은 값에 안 남는다(§0-11)
  assert.equal(screenOf("/p/a/personas"), "personas"); // 세그먼트 없는 정본 URL도 종전대로
  assert.equal(hasFindBar("/p/a/personas/designer"), true); // ①을 고치면 저절로 뜬다 — N5
  assert.equal(parentPath("/p/a/personas/designer"), "/p/a"); // 안 고쳤다. 정규식이 이미 문다
});

test("projectPath — 페르소나 이름은 옮겨 붙이지 않는다(§5 ④)", () => {
  // 이름은 프로젝트마다 독립이라 붙여 옮기면 남의 큐에 없는 이름을 연다(티켓 해시와 같은 이유).
  // 화면 종류는 유지되므로 보드가 아니라 선택 없는 `/personas`로 떨어진다.
  assert.equal(projectPath("/p/a/personas/designer", "b"), "/p/b/personas");
  assert.equal(projectPath("/p/a/personas", "b"), "/p/b/personas"); // 종전 그대로
});

/** N5의 찾기 바가 뜨는 자리 (DESIGN.md §데스크톱 앱 N5 표 1행). **보드·홈에서 뜨면 `⌘F`가
 *  두 벌이 된다** — 그 두 화면은 §0-6의 자기 갈래가 같은 키를 먹고 있어서 `preventDefault`가
 *  둘 다 걸리고 사람이 누른 키가 검색창 포커스와 이 바 열기를 동시에 한다. */
test("hasFindBar — 보드·홈만 빼고 여섯 화면에 뜬다(§데스크톱 앱 N5)", () => {
  assert.equal(hasFindBar("/p/dira"), false); // 보드 — `board-ui.tsx`가 먹는다
  assert.equal(hasFindBar("/p/dira/"), false); // 보드의 정본 URL과 같은 화면이다
  assert.equal(hasFindBar("/p/dira/home"), false); // 홈 — 자기 `<FindBar>`가 이미 있다(§7)
  for (const p of [
    "/",
    "/p/dira/workers",
    "/p/dira/personas",
    "/p/dira/protocols",
    "/p/dira/ontology",
    "/p/dira/tickets/fff28e90",
  ])
    assert.equal(hasFindBar(p), true, p);
  assert.equal(hasFindBar("/nosuchpage"), false); // 표 밖에는 안 뜬다(404)
});

/** 칸반 호버 관계선 기하 (DESIGN.md §비주얼 §17). 레인이 하한 폭 288(`min-w-72`)까지
 *  좁아진 배치다 — 카드는 280폭, 카드 테두리 사이 거터는 24다. 레인은 `flex-1`이라 보통은
 *  이보다 넓지만 `relationPath`는 실측 rect를 받으므로 식은 그대로다(거터 24는 레인 폭과
 *  무관하다 — `p-1`×2 + `gap-4`). 아래 x값은 그 하한 배치 그대로다. */
const card = (left: number, y: number): Anchor => ({
  left,
  right: left + 280,
  cx: left + 140,
  y,
});

/** `?rows=`는 사람이 손으로 고칠 수 있는 값이고, 서버(자를 수)와 바디(다음 URL)가 **같은 수**를
 *  유도해야 한다(§성능 예산 §초과분 ②). 갈리면 표가 30행씩 밀리거나 영영 안 이어진다. */
test("rowLimit — 정본 URL도 쓰레기 값도 30행으로 떨어진다(§1 §테이블 바디는 30행씩)", () => {
  assert.equal(ROW_PAGE, 30);
  for (const v of [null, "", "0", "abc", "-5", "10", "30"]) assert.equal(rowLimit(v), 30);
});

test("rowLimit — 30보다 큰 값은 그대로 남는다(내려 읽던 자리가 폴링에 안 되감긴다)", () => {
  assert.equal(rowLimit("60"), 60);
  assert.equal(rowLimit("786"), 786);
  // 소수·공백이 섞여도 `Number`가 판정한다 — `parseInt`처럼 앞자리만 먹고 넘어가지 않는다
  assert.equal(rowLimit(" 90 "), 90);
  assert.equal(rowLimit("60px"), 30);
});

/** `?done=`은 칸반 `완료` 레인의 무한스크롤 몫이다(§1 §완료 항, 요구 `79cad792`) — `rowLimit`과
 *  같은 유도라 서버(자를 수)와 레인 감시행(다음 URL)이 어긋나면 20건씩 밀리거나 영영 안 이어진다. */
test("doneLimit — 정본 URL도 쓰레기 값도 20건으로 떨어진다(§1 §완료 항)", () => {
  assert.equal(DONE_LANE_LIMIT, 20);
  for (const v of [null, "", "0", "abc", "-5", "10", "20"]) assert.equal(doneLimit(v), 20);
});

test("doneLimit — 20보다 큰 값은 그대로 남는다(내려 읽던 자리가 폴링에 안 되감긴다)", () => {
  assert.equal(doneLimit("40"), 40);
  assert.equal(doneLimit("206"), 206);
});

test("relationPath — 이웃 레인은 거터(24) 안에서 끝난다", () => {
  // §17 배치 표 1행: `+1 −1` · d = 24. 오른쪽 카드의 왼쪽 테두리(304)까지 |Δx| = 24 → clamp 하한
  const d = relationPath(card(0, 100), card(304, 200));
  assert.equal(d, "M 280,100 C 304,100 280,200 304,200");
});

test("relationPath — 레인 건너뜀은 d가 상한 96에서 잘린다", () => {
  // 한 레인 건너: 왼쪽 카드 오른쪽 테두리 280 → 오른쪽 카드 왼쪽 테두리 608. |Δx|/2 = 164 > 96
  const d = relationPath(card(0, 100), card(608, 300));
  assert.equal(d, "M 280,100 C 376,100 512,300 608,300");
});

test("relationPath — 같은 레인은 둘 다 +1이라 오른쪽으로 부푼다", () => {
  // 가로 중심이 같으면 `s₁ s₂` 둘 다 +1 → 양 끝이 오른쪽 테두리, |Δx| = 0 → d = 24(하한).
  // 3차 베지어의 최대 부풀기는 0.75·d ≈ 18px다(§17 배치 표 3행).
  const d = relationPath(card(0, 100), card(0, 400));
  assert.equal(d, "M 280,100 C 304,100 304,400 280,400");
});

test("relationPath — 오른쪽에서 왼쪽으로 걸면 부호가 뒤집힌다", () => {
  // 위 1행과 **같은 획**이어야 한다(선에 방향이 없다) — 시작·끝만 바뀐다
  const d = relationPath(card(304, 200), card(0, 100));
  assert.equal(d, "M 304,200 C 280,200 304,100 280,100");
});

test("relationPath — 제어점의 y가 앵커의 y와 같다(선이 레인 머리로 안 올라간다)", () => {
  const [, , c1y, , c2y] = /C ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/
    .exec(relationPath(card(0, 120), card(304, 480)))!
    .map(Number);
  assert.equal(c1y, 120);
  assert.equal(c2y, 480);
});

/** 기능 → 되는 엔진 집합 (DESIGN.md §4-3 개정 2026-08-05, 요구 `390f788b`).
 *
 *  **이게 틀리면 화면이 조용히 거짓알려 준다.** grok이 `=== "codex"`를 통과하지 못해 claude로
 *  읽히면 참견 form이 활성으로 떠서 보낸 글이 아무 데도 안 가고, 반대로 스트림을 codex와 한
 *  집합으로 묶으면 있는 트랜스크립트를 안 읽고 `없습니다`를 그린다. 어느 쪽도 에러가 안 난다 —
 *  그래서 여섯 자리가 이 함수 하나에 걸려 있고 검증도 여기 하나다. */
test("engineCan — 기능마다 집합이 다르다. grok에서 둘이 갈린다(§4-3 표)", () => {
  // 표 1행: 참견은 `{claude}` — FIFO는 `--input-format stream-json` 인접에서만 파인다
  assert.equal(engineCan("interject", "claude"), true);
  assert.equal(engineCan("interject", "codex"), false);
  assert.equal(engineCan("interject", "grok"), false);
  // 표 2행: 세션 스트림은 `{claude, grok}` — **이 한 칸이 이 회차의 전부다**
  assert.equal(engineCan("stream", "claude"), true);
  assert.equal(engineCan("stream", "codex"), false);
  assert.equal(engineCan("stream", "grok"), true);
  // agy는 `FEATURE_ENGINES` 어느 집합에도 없다(4dfe01fb) — 두 기능 다 `false`
  assert.equal(engineCan("interject", "agy"), false);
  assert.equal(engineCan("stream", "agy"), false);
});

test("engineCan — 엔진을 모르면 `null`이고 집합 밖 이름은 `false`다", () => {
  // 완료 티켓은 아무도 안 물고 있어 되짚을 워커가 없다. `false`로 접으면 화면이 없는 값을
  // 추측해 `이 워커의 엔진은 null입니다`를 그린다(§비주얼 §23 ⑤ 마지막 항).
  assert.equal(engineCan("stream", null), null);
  assert.equal(engineCan("interject", null), null);
  // 손으로 쓴 `TICKET_ENGINE`은 아는 이름이 아니다 — 되는 집합에 없으니 안 되는 것이다.
  assert.equal(engineCan("stream", "aider"), false);
  assert.equal(engineCan("interject", "aider"), false);
});

test("engineMissing — 없는 기능의 이름만, 표 순서대로(§비주얼 §23 ⑤ 예고 줄)", () => {
  // 이 배열이 그대로 `<엔진> 워커는 <…과 …>이 없습니다` 한 줄이 된다. claude에서 비는 것이
  // 곧 그 줄이 안 뜨는 근거다 — 정상 상태에 안내를 켜지 않는다(§0-2).
  assert.deepEqual(engineMissing("claude"), []);
  assert.deepEqual(engineMissing("codex"), ["참견", "세션 스트림"]);
  assert.deepEqual(engineMissing("grok"), ["참견"]);
  // agy는 FEATURE_ENGINES에 없어서 둘 다 빠진다(4dfe01fb) — 카탈로그에 새 엔진을 더할 때
  // 이 표에 줄을 안 더하면 이 자리가 그것을 잡는다.
  assert.deepEqual(engineMissing("agy"), ["참견", "세션 스트림"]);
  // 종전 문장이 한 글자도 안 갈린다는 근거(회귀) — codex 워커의 예고 줄 그대로다.
  assert.equal(
    `codex 워커는 ${engineMissing("codex").join("과 ")}이 없습니다 — 티켓 수행은 같습니다.`,
    "codex 워커는 참견과 세션 스트림이 없습니다 — 티켓 수행은 같습니다.",
  );
});

/** 스트림 아래 입력 form의 모드 (DESIGN.md §비주얼 §21 `어느 폼을 그리나` 표 + 예외 둘).
 *  JSX 안에서 이 판정이 갈리면 완료 티켓에서 참견을 보내거나(닿을 곳이 없다) 열린 티켓에
 *  없어야 할 입구가 뜬다 — 그래서 판정만 순수 함수로 나와 있다. */
const m = (o: Partial<Parameters<typeof interjectMode>[0]>) =>
  interjectMode({ polled: true, live: false, done: false, failed: false, ...o });

test("interjectMode — 티켓 상태가 폼을 가른다(§21 표 3행)", () => {
  assert.equal(m({ live: true }), "interject"); // `.wip`
  assert.equal(m({ done: true }), "followup"); // `.done`
  assert.equal(m({}), null); // 열림 — 이 입구가 없다(§2-2 안 만드는 것 3)
});

test("interjectMode — 첫 폴링 전에는 아무것도 안 그린다", () => {
  // `live`를 서버가 넘겨준 뒤에도 `.done`인지는 첫 폴링이 온 뒤에 안다. 먼저 그리면
  // 완료 티켓에서 `참견` 폼이 한 번 깜빡였다가 `이어받기`로 바뀐다.
  assert.equal(m({ polled: false, live: true }), null);
  assert.equal(m({ polled: false, done: true }), null);
});

test("interjectMode — 실패가 남아 있으면 `live`가 내려가도 폼이 남는다(§21 예외)", () => {
  // `ENXIO`는 세션이 끝나서 나는 실패다 — 다음 폴링이 곧 `live`를 내린다. 그때 사라지면
  // 방금 실패한 사유와 사람이 쓴 글이 같이 증발한다.
  assert.equal(m({ live: false, failed: true }), "interject");
  assert.equal(m({ live: false, failed: false }), null);
});

test("interjectMode — `.done`이 실패 잔해를 이긴다(글은 남고 Alert만 지운다)", () => {
  // `.wip` → `.done`으로 굳는 그 폴링. 읽기 전용 잔해가 아니라 **보낼 수 있는 이어받기 칸**이다 —
  // `ENXIO`의 다음 행동(`위 글을 복사해 새 티켓으로`)을 같은 칸이 바로 할 수 있게 된다.
  assert.equal(m({ done: true, failed: true }), "followup");
});

test("interjectMode — 답변 대기면 `answer`다(§2-3 ③ 표 2행)", () => {
  assert.equal(m({ awaiting: true }), "answer"); // 열림 + `awaiting` 미충족
  assert.equal(m({ awaiting: false }), null); // 그냥 열림 — 칸이 없다
});

test("interjectMode — `.wip`에서 `answer`가 절대 안 나온다(제약 5)", () => {
  // 세 모드가 배타인 것은 이미 참이던 사실이지만(`awaiting`은 열린 티켓에만 걸린다),
  // 그 사실을 호출부가 아니라 **이 함수가 구조로** 지킨다. 둘이 같이 참인 값이 들어와도
  // `.wip`에 답변칸이 서지 않는다 — 뜨면 `.wip`인 요구사항에 답이 달린다.
  assert.equal(m({ live: true, awaiting: true }), "interject");
  assert.equal(m({ failed: true, awaiting: true }), "interject"); // 실패 잔해도 같다
  assert.equal(m({ done: true, awaiting: true }), "followup"); // `.done`은 종전대로 이긴다
});

/** 진행 기록의 순서 (DESIGN.md §2-3 ②). **이 묶음에서 조용히 틀릴 수 있는 유일한 것이 순서다** —
 *  틀려도 화면은 멀쩡히 그려지고, 사람은 인과가 뒤집힌 기록을 사실로 읽는다. */
const ev = (ts: string, key = ts) => ({ key, ts });
const q = (heading: string) => ({ role: "question" as const, heading });
const a = (heading: string, birth: number) => ({ role: "answer" as const, heading, birth });
/** 순서만 보는 납작한 표기 — `event`면 그 사건의 key, `thread`면 그 칸의 heading. */
const order = (rows: { event?: { key: string }; thread?: { heading: string } }[]) =>
  rows.map((r) => r.event?.key ?? r.thread!.heading);

test("mergeProgress ① — 사건만이면 준 순서 그대로다", () => {
  const events = [ev("2026-08-01T01:00:00Z"), ev("2026-08-01T02:00:00Z")];
  assert.deepEqual(order(mergeProgress(events, [])), [
    "2026-08-01T01:00:00Z",
    "2026-08-01T02:00:00Z",
  ]);
  assert.deepEqual(mergeProgress([], []), []); // 절이 아예 안 뜨는 티켓
});

test("mergeProgress ② — 스레드만(세션 없음)이면 스레드가 그대로 나온다", () => {
  // 한 번도 디스패치된 적 없는 요구사항이다 — `session_id`가 없어 사건이 0건이고,
  // 그래도 절은 뜬다(§2-3 ① 절이 뜨는 조건 3행).
  const thread = [q("질문 1"), a("답변 1", 100), q("질문 2")];
  assert.deepEqual(order(mergeProgress([], thread)), ["질문 1", "답변 1", "질문 2"]);
});

test("mergeProgress ③ — 옛 답변이 지금 세션 첫 사건보다 앞에 뜬다(라운드 2)", () => {
  // 스트림은 여전히 지금 `session_id` 하나다(§2-1 Q2=(a)) — 옛 세션 사건은 화면에 없고
  // 옛 라운드의 질문·답변만 남는다. 그래도 순서는 맞는다: 답변의 `birth`가 첫 사건보다 앞이다.
  const first = Date.parse("2026-08-01T03:00:00Z");
  const thread = [q("질문 1"), a("답변 1", first - 3600_000)];
  const events = [ev("2026-08-01T03:00:00Z", "e1"), ev("2026-08-01T03:00:05Z", "e2")];
  assert.deepEqual(order(mergeProgress(events, thread)), ["질문 1", "답변 1", "e1", "e2"]);

  // 답변이 세션 도중에 달렸으면 그 자리에 낀다 — 질문은 짝인 답변 **바로 앞**이다.
  const mid = [q("질문 1"), a("답변 1", Date.parse("2026-08-01T03:00:02Z"))];
  assert.deepEqual(order(mergeProgress(events, mid)), ["e1", "질문 1", "답변 1", "e2"]);
});

test("mergeProgress ④ — 답 없는 마지막 질문은 배열 맨 끝이다", () => {
  // 정렬 규칙이 아니라 UX 결정이다(§2-3 ②): 바로 밑 입력칸이 그 답을 쓰는 자리다.
  const thread = [q("질문 1"), a("답변 1", Date.parse("2026-08-01T01:00:00Z")), q("질문 2")];
  const events = [ev("2026-08-01T02:00:00Z", "e1"), ev("2026-08-01T09:00:00Z", "e2")];
  const rows = mergeProgress(events, thread);
  assert.deepEqual(order(rows), ["질문 1", "답변 1", "e1", "e2", "질문 2"]);
  assert.equal(rows[rows.length - 1].thread?.heading, "질문 2");
});

test("mergeProgress — `ts` 없는 레코드는 앞 사건 뒤 그대로다(§2-1 줄 순서가 곧 시간순)", () => {
  const events = [ev("2026-08-01T01:00:00Z", "e1"), { key: "e2", ts: "" }, ev("2026-08-01T05:00:00Z", "e3")];
  const thread = [q("질문 1"), a("답변 1", Date.parse("2026-08-01T03:00:00Z"))];
  // `e2`는 앞 사건(`e1`, 01:00)의 시각을 물려받으므로 03:00 답변보다 위에 남는다.
  assert.deepEqual(order(mergeProgress(events, thread)), ["e1", "e2", "질문 1", "답변 1", "e3"]);
});

test("mergeProgress — 원본을 통째로 들고 있다(뭉개지 않는다 — §2-3 ⑥3)", () => {
  // 화면이 사건과 사람의 말을 다른 모양으로 그려야 한다. 중간 타입으로 접으면 그게 불가능해진다.
  const e = { key: "e1", ts: "2026-08-01T01:00:00Z", kind: "text", body: "본문" };
  const t = { role: "answer", heading: "답변 1", text: "답", hash: "abc", birth: 1 };
  const rows = mergeProgress([e], [t]);
  assert.deepEqual(rows, [{ thread: t }, { event: e }]);
  assert.equal(rows[1].event, e); // 사본이 아니라 같은 객체다
});

/** 말풍선 사이 묶음 (DESIGN.md §2-6 ②, designer `f0202829`). `label`이 빈 사건이 말풍선이고
 *  (assistant `text` · 참견 · 첫 아닌 사용자 프롬프트), 나머지가 묶이는 사건이다. */
type EvL = { key: string; ts: string; label: string };
type Th = { heading: string };
const isBubble = (e: EvL) => e.label === "";
const evL = (key: string, label: string): EvL => ({ key, ts: key, label });
const group = (items: ProgressItem<EvL, Th>[]) => groupProgress<EvL, Th>(items, isBubble);
/** 그룹 하나를 납작한 표기로 — `event`는 key, `thread`는 heading, `bundle`은 `묶음(n)`. */
const gorder = (rows: GroupedItem<EvL, Th>[]) =>
  rows.map((r) =>
    r.kind === "event" ? r.event.key : r.kind === "thread" ? r.thread.heading : `묶음(${r.events.length})`,
  );

test("groupProgress ① — 말풍선 사이 연속 사건은 한 묶음이다", () => {
  const items: ProgressItem<EvL, Th>[] = [
    { event: evL("e1", "세션 프롬프트") }, // 묶임
    { event: evL("e2", "Bash") }, // 묶임
    { event: evL("e3", "") }, // 말풍선(assistant text)
    { event: evL("e4", "결과") }, // 다음 묶음 시작
    { thread: { heading: "질문 1" } },
  ];
  assert.deepEqual(gorder(group(items)), ["묶음(2)", "e3", "묶음(1)", "질문 1"]);
});

test("groupProgress ② — 0건이면 묶음 줄 자체가 없다(상자 시작·끝 포함)", () => {
  // 말풍선이 연달아 뜨면 그 사이엔 아무것도 안 그린다 — 빈 `기록 0건`을 세우지 않는다.
  const items: ProgressItem<EvL, Th>[] = [{ event: evL("e1", "") }, { event: evL("e2", "") }];
  assert.deepEqual(gorder(group(items)), ["e1", "e2"]);
});

test("groupProgress ③ — 꼬리 묶음도 만든다(마지막 말풍선 뒤)", () => {
  const items: ProgressItem<EvL, Th>[] = [{ event: evL("e1", "") }, { event: evL("e2", "Bash") }];
  const groups = group(items);
  assert.deepEqual(gorder(groups), ["e1", "묶음(1)"]);
  // 묶음의 key는 그 묶음 첫 사건의 key다(§2-6 ② — 폴링이 뒤에 사건을 더해도 첫 사건은 안 바뀐다).
  assert.equal(groups[1].kind === "bundle" && groups[1].events[0].key, "e2");
});

/** 창 배분 (DESIGN.md §2-11④). `plan()`이 `PlanItem` 모양을 그대로 만든다 — 배열 순서가 계획
 *  줄 순서(파일 순서)다. */
const plan = (
  text: string,
  state: "todo" | "doing" | "done" | "cancelled",
  start: string | null,
  end: string | null = null,
) => ({ text, state, start, end });
const we = (key: string, ts: string) => ({ key, ts });
const wKeys = (bucket: { key: string }[]) => bucket.map((e) => e.key);

test("windowEvents — 진행중 둘: 마지막만 진짜 진행중, 앞은 다음 계획의 시작으로 닫힌다(§2-11④)", () => {
  const plans = [plan("a", "doing", "2026-08-01T01:00:00Z"), plan("b", "doing", "2026-08-01T03:00:00Z")];
  const now = Date.parse("2026-08-01T05:00:00Z");
  const events = [
    we("e1", "2026-08-01T01:30:00Z"), // a의 창 [01:00, 03:00)
    we("e2", "2026-08-01T03:30:00Z"), // b의 창 [03:00, now)
    we("e3", "2026-08-01T04:30:00Z"),
  ];
  const { buckets, outside } = windowEvents(plans, events, now);
  assert.deepEqual(wKeys(buckets[0]), ["e1"]);
  assert.deepEqual(wKeys(buckets[1]), ["e2", "e3"]);
  assert.deepEqual(outside, []);
});

test("windowEvents — 계획 밖 사건: 어느 창에도 안 들면 시간순 그대로 outside다(§2-11④)", () => {
  const plans = [plan("a", "doing", "2026-08-01T02:00:00Z")];
  const now = Date.parse("2026-08-01T05:00:00Z");
  const events = [we("before", "2026-08-01T01:00:00Z"), we("during", "2026-08-01T03:00:00Z")];
  const { buckets, outside } = windowEvents(plans, events, now);
  assert.deepEqual(wKeys(buckets[0]), ["during"]);
  assert.deepEqual(wKeys(outside), ["before"]);
});

test("windowEvents — `ts` 없는 사건은 앞 사건의 시각을 물려받는다(§2-3② · mergeProgress와 같은 규칙)", () => {
  const plans = [plan("a", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z")];
  const events = [we("e1", "2026-08-01T01:10:00Z"), { key: "e2", ts: "" }, we("e3", "2026-08-01T03:00:00Z")];
  const { buckets, outside } = windowEvents(plans, events, 0);
  assert.deepEqual(wKeys(buckets[0]), ["e1", "e2"]); // e2는 e1(01:10)의 시각을 물려받아 같은 창에 든다
  assert.deepEqual(wKeys(outside), ["e3"]);
});

test("windowEvents — 겹치는 창: 앞 계획이 먼저 집는다, 한 사건은 한 계획에만(§2-11④)", () => {
  const plans = [
    plan("a", "done", "2026-08-01T01:00:00Z", "2026-08-01T03:00:00Z"),
    plan("b", "done", "2026-08-01T02:00:00Z", "2026-08-01T04:00:00Z"),
  ];
  const events = [we("e1", "2026-08-01T02:30:00Z")]; // a·b 창 둘 다에 든다
  const { buckets, outside } = windowEvents(plans, events, 0);
  assert.deepEqual(wKeys(buckets[0]), ["e1"]); // 앞 계획(a)이 집는다
  assert.deepEqual(wKeys(buckets[1]), []);
  assert.deepEqual(outside, []);
});

/** 계획 아코디언 배치 순서 (DESIGN.md §비주얼 §59 ⑦). `plan()`·`we()`·`wKeys()`는 위
 *  `windowEvents` 테스트가 이미 정의한 헬퍼를 그대로 쓴다. */
const planKinds = (blocks: { kind: string; index?: number; events: { key: string }[] }[]) =>
  blocks.map((b) => (b.kind === "plan" ? `plan${b.index}` : "outside"));

test("planBlocks — 계획 세우기 전 구간은 첫 계획 앞에 뜬다(§비주얼 §59 ⑦)", () => {
  const plans = [plan("a", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z")];
  const events = [we("before", "2026-08-01T00:30:00Z"), we("during", "2026-08-01T01:30:00Z")];
  const blocks = planBlocks(plans, events, 0);
  assert.deepEqual(planKinds(blocks), ["outside", "plan0"]);
  assert.deepEqual(wKeys(blocks[0].events), ["before"]);
  assert.deepEqual(wKeys(blocks[1].events), ["during"]);
});

test("planBlocks — 창 없는 계획(미착수 · 기록 0건)도 파일 순서 자리를 지킨다(§비주얼 §59 ①)", () => {
  const plans = [
    plan("a", "done", "2026-08-01T00:00:00Z", "2026-08-01T01:00:00Z"),
    plan("b", "todo", null),
    plan("c", "doing", "2026-08-01T01:00:00Z"),
  ];
  const events = [we("e1", "2026-08-01T00:30:00Z"), we("e2", "2026-08-01T01:30:00Z")];
  const blocks = planBlocks(plans, events, Date.parse("2026-08-01T02:00:00Z"));
  assert.deepEqual(planKinds(blocks), ["plan0", "plan1", "plan2"]);
  assert.deepEqual(wKeys(blocks[0].events), ["e1"]);
  assert.deepEqual(wKeys(blocks[1].events), []); // 미착수 — 창이 없어 사건을 못 문다
  assert.deepEqual(wKeys(blocks[2].events), ["e2"]);
});

test("planBlocks — 계획 사이의 시간 틈은 그 두 계획 블록 사이에 뜬다(§비주얼 §59 ⑦)", () => {
  const plans = [
    plan("a", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z"),
    plan("b", "done", "2026-08-01T03:00:00Z", "2026-08-01T04:00:00Z"),
  ];
  const events = [
    we("inA", "2026-08-01T01:30:00Z"),
    we("gap", "2026-08-01T02:30:00Z"),
    we("inB", "2026-08-01T03:30:00Z"),
  ];
  const blocks = planBlocks(plans, events, 0);
  assert.deepEqual(planKinds(blocks), ["plan0", "outside", "plan1"]);
  assert.deepEqual(wKeys(blocks[1].events), ["gap"]);
});

/** 배치 개정(DESIGN.md §2-11⑨ 판정1-4, 요구 `1c01c2d6`) — 묶음·닻·구간과 균등 분배 나머지. */
test("windowEvents — 시작이 같은 계획 셋은 한 묶음이라 창 하나의 사건을 파일 순서대로 균등하게 나눠 갖는다(§2-11⑨ 판정1)", () => {
  const plans = [
    plan("a", "done", "2026-08-01T01:00:00Z"),
    plan("b", "done", "2026-08-01T01:00:00Z"),
    plan("c", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z"),
  ];
  const events = [
    we("e1", "2026-08-01T01:10:00Z"),
    we("e2", "2026-08-01T01:20:00Z"),
    we("e3", "2026-08-01T01:30:00Z"),
    we("e4", "2026-08-01T01:40:00Z"),
    we("e5", "2026-08-01T01:50:00Z"),
    we("e6", "2026-08-01T01:55:00Z"),
  ];
  const { buckets, outside } = windowEvents(plans, events, 0);
  assert.deepEqual(wKeys(buckets[0]), ["e1", "e2"]);
  assert.deepEqual(wKeys(buckets[1]), ["e3", "e4"]);
  assert.deepEqual(wKeys(buckets[2]), ["e5", "e6"]);
  assert.deepEqual(outside, []);
});

test("windowEvents — 묶음의 균등 분배가 안 떨어지면 나머지는 앞 계획부터 한 건씩 간다(§2-11⑨ 판정1)", () => {
  const plans = [
    plan("a", "done", "2026-08-01T01:00:00Z"),
    plan("b", "done", "2026-08-01T01:00:00Z"),
    plan("c", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z"),
  ];
  const events = [
    we("e1", "2026-08-01T01:10:00Z"),
    we("e2", "2026-08-01T01:20:00Z"),
    we("e3", "2026-08-01T01:30:00Z"),
    we("e4", "2026-08-01T01:40:00Z"),
  ];
  const { buckets } = windowEvents(plans, events, 0);
  assert.deepEqual(wKeys(buckets[0]), ["e1", "e2"]); // 나머지 첫 건이 앞 계획으로
  assert.deepEqual(wKeys(buckets[1]), ["e3"]);
  assert.deepEqual(wKeys(buckets[2]), ["e4"]);
});

test("planBlocks — 닻이 하나도 없으면 세션 전체가 한 구간이라 계획들이 사건을 나눠 갖고 계획 밖이 0건이다(§2-11⑨ 판정3)", () => {
  const plans = [plan("a", "todo", null), plan("b", "todo", null), plan("c", "todo", null)];
  const events = [
    we("e1", "2026-08-01T01:00:00Z"),
    we("e2", "2026-08-01T01:10:00Z"),
    we("e3", "2026-08-01T01:20:00Z"),
  ];
  const blocks = planBlocks(plans, events, 0);
  assert.deepEqual(planKinds(blocks), ["plan0", "plan1", "plan2"]);
  assert.deepEqual(wKeys(blocks[0].events), ["e1"]);
  assert.deepEqual(wKeys(blocks[1].events), ["e2"]);
  assert.deepEqual(wKeys(blocks[2].events), ["e3"]);
});

test("planBlocks — 닻 사이의 비닻 계획 둘은 그 구간 사건을 파일 순서로 나눠 갖는다(§2-11⑨ 판정3)", () => {
  const plans = [
    plan("anchor1", "done", "2026-08-01T01:00:00Z", "2026-08-01T02:00:00Z"),
    plan("mid1", "todo", null),
    plan("mid2", "todo", null),
    plan("anchor2", "done", "2026-08-01T04:00:00Z", "2026-08-01T05:00:00Z"),
  ];
  const events = [
    we("in1", "2026-08-01T01:30:00Z"),
    we("g1", "2026-08-01T02:30:00Z"),
    we("g2", "2026-08-01T03:00:00Z"),
    we("in2", "2026-08-01T04:30:00Z"),
  ];
  const blocks = planBlocks(plans, events, 0);
  assert.deepEqual(planKinds(blocks), ["plan0", "plan1", "plan2", "plan3"]);
  assert.deepEqual(wKeys(blocks[0].events), ["in1"]);
  assert.deepEqual(wKeys(blocks[1].events), ["g1"]);
  assert.deepEqual(wKeys(blocks[2].events), ["g2"]);
  assert.deepEqual(wKeys(blocks[3].events), ["in2"]);
});

test("progressMarkerText — 마지막 레코드가 thinking이면 '생각하는 중', 그 외엔 종전 문구", () => {
  assert.equal(progressMarkerText("thinking"), "생각하는 중 · 2초마다");
  assert.equal(progressMarkerText("tool_use"), "따라가는 중 · 2초마다");
  assert.equal(progressMarkerText(undefined), "따라가는 중 · 2초마다");
});

test("formatElapsed — §2-15 ⑦ 표 셋: 10초 미만 소수 한 자리, 60초 미만 정수, 그 위 <m>m <s>s", () => {
  assert.equal(formatElapsed(0), "0.0s");
  assert.equal(formatElapsed(500), "0.5s");
  assert.equal(formatElapsed(8_000), "8.0s");
  assert.equal(formatElapsed(9_999), "10.0s"); // toFixed가 반올림하는 경계 — 10초 갈래가 하나 밀린다
  assert.equal(formatElapsed(20_000), "20s");
  assert.equal(formatElapsed(59_000), "59s");
  assert.equal(formatElapsed(60_000), "1m 0s");
  assert.equal(formatElapsed(230_000), "3m 50s");
});

test("progressFilterKindOf — §2-15 ⑥ 표: kind 하나 + interject의 label로 넷을 가른다", () => {
  assert.equal(progressFilterKindOf({ kind: "text", label: "" }), "talk");
  assert.equal(progressFilterKindOf({ kind: "interject", label: "" }), "talk");
  assert.equal(progressFilterKindOf({ kind: "tool_use", label: "Bash" }), "tool");
  assert.equal(progressFilterKindOf({ kind: "tool_result", label: "" }), "tool");
  assert.equal(progressFilterKindOf({ kind: "thinking", label: "생각" }), "thinking");
  assert.equal(progressFilterKindOf({ kind: "prompt", label: "프롬프트" }), "prompt");
  assert.equal(progressFilterKindOf({ kind: "interject", label: "배정" }), "prompt");
});

const ALL_ON = { talk: true, tool: true, thinking: true, prompt: true };

test("matchesStreamFilter — 필터가 kind로 먼저 거르고, 검색어는 label · summary · body를 대소문자 무시로 훑는다", () => {
  const e = { kind: "tool_use", label: "Bash", summary: "ls -la", body: "실행 결과" };
  assert.equal(matchesStreamFilter(e, ALL_ON, ""), true);
  assert.equal(matchesStreamFilter(e, { ...ALL_ON, tool: false }, ""), false);
  assert.equal(matchesStreamFilter(e, ALL_ON, "bash"), true); // label, 대소문자 무시
  assert.equal(matchesStreamFilter(e, ALL_ON, "결과"), true); // body
  assert.equal(matchesStreamFilter(e, ALL_ON, "없는말"), false);
  // 검색어가 맞아도 필터가 그 kind를 껐으면 진다
  assert.equal(matchesStreamFilter(e, { ...ALL_ON, tool: false }, "bash"), false);
});

test("toolChipCounts — 도구 이름별 개수, 횟수 내림차순 · 동률은 처음 나온 순 · tool_use만 센다", () => {
  const events = [
    { kind: "tool_use", label: "Read" },
    { kind: "tool_use", label: "Bash" },
    { kind: "tool_result", label: "" },
    { kind: "tool_use", label: "Bash" },
    { kind: "tool_use", label: "Edit" },
    { kind: "tool_use", label: "Read" },
    { kind: "tool_use", label: "Bash" },
  ];
  assert.deepEqual(toolChipCounts(events), [
    ["Bash", 3],
    ["Read", 2],
    ["Edit", 1],
  ]);
  assert.deepEqual(toolChipCounts([]), []);
});

test("pairTool — toolId로 짝을 잇는다. 짝이 여럿이면 전부 이어지고 소요는 마지막 짝까지다", () => {
  const events: { kind: string; toolId?: string; ts: string }[] = [
    { kind: "tool_use", toolId: "a", ts: "2026-08-21T00:00:00Z" },
    { kind: "tool_result", toolId: "a", ts: "2026-08-21T00:00:01Z" },
    { kind: "tool_use", toolId: "b", ts: "2026-08-21T00:00:02Z" }, // grok — 갱신 여럿
    { kind: "tool_result", toolId: "b", ts: "2026-08-21T00:00:03Z" },
    { kind: "tool_result", toolId: "b", ts: "2026-08-21T00:00:05Z" },
    { kind: "tool_use", toolId: "c", ts: "2026-08-21T00:00:06Z" }, // 도는 마지막 호출 — 짝 없음
  ];
  const single = pairTool(events[0], events);
  assert.equal(single.results.length, 1);
  assert.equal(single.elapsedMs, 1000);

  const multi = pairTool(events[2], events);
  assert.deepEqual(multi.results, [events[3], events[4]]);
  assert.equal(multi.elapsedMs, 3000); // 마지막 짝까지

  const none = pairTool(events[5], events);
  assert.deepEqual(none.results, []);
  assert.equal(none.elapsedMs, null);

  // tool_use가 아니거나 toolId가 없으면 짝이 없다
  assert.deepEqual(pairTool(events[1], events).results, []);
  assert.deepEqual(pairTool({ kind: "tool_use", ts: "2026-08-21T00:00:00Z" }, events).results, []);
});

test("relativeElapsed — `+mm:ss`, mm은 두 자 패딩(60분을 넘으면 세 자)", () => {
  const base = "2026-08-21T00:00:00Z";
  assert.equal(relativeElapsed(base, base), "+00:00");
  assert.equal(relativeElapsed("2026-08-21T00:02:02Z", base), "+02:02");
  assert.equal(relativeElapsed("2026-08-21T01:42:37Z", base), "+102:37");
});

/** §비주얼 §26 ④. `lib/usage.ts`에 있던 `resetLabel`이 이 파일로 온 검증이다 — 홈 대화 목록(§24)이
 *  같은 서식을 **클라이언트에서** 쓰게 되면서 옮겼고(저 파일은 `node:fs`다), 값은 한 자도 안 갈렸다. */
test("timeLabel — 오늘은 HH:MM · 다른 날은 M/D (24시간제)", () => {
  const now = new Date(2026, 7, 1, 15, 30).getTime(); // 2026-08-01 15:30 로컬
  // claude 5시간 창 — 실측 `resets_at`이 KST 19:00이었다
  assert.equal(timeLabel(new Date(2026, 7, 1, 19, 0).getTime(), now), "19:00");
  // 오후를 `오후 5:40`으로 쓰지 않는다(로케일마다 폭이 흔들린다)
  assert.equal(timeLabel(new Date(2026, 7, 1, 17, 40).getTime(), now), "17:40");
  assert.equal(timeLabel(new Date(2026, 7, 1, 9, 5).getTime(), now), "09:05"); // 0 패딩
  // codex 30일 창 — 실측 `resets_at` 1787984956 = 2026-08-29 15:29
  assert.equal(timeLabel(new Date(2026, 7, 29, 15, 29).getTime(), now), "8/29");
  // 자정 경계: 5분 뒤여도 날짜가 다르면 `M/D`다 — 시각만 쓰면 "오늘 그 시각"으로 읽힌다
  assert.equal(timeLabel(new Date(2026, 7, 2, 0, 5).getTime(), new Date(2026, 7, 1, 23, 55).getTime()), "8/2");
});

/** §0-14 · §비주얼 §28 ⑤ — ⑥의 `<from>~<to>` 표기. `timeLabel`과 갈리는 자리는 다른 날일 때뿐이다:
 *  그쪽은 시각을 버리는데(`M/D`만) 여기는 날짜를 시각 앞에 붙인다(`M/D HH:MM`) — 밤샘 복귀의
 *  두 끝이 같은 단위(시각)를 유지해야 한다. */
test("dateTimeLabel — 같은 날은 HH:MM · 다른 날은 M/D HH:MM", () => {
  const now = new Date(2026, 7, 6, 9, 12).getTime(); // 2026-08-06 09:12 로컬(복귀 직후)
  assert.equal(dateTimeLabel(new Date(2026, 7, 6, 8, 40).getTime(), now), "08:40"); // 같은 날
  // 밤샘: from은 어제 23:40 → 날짜가 붙는다. to는 오늘 09:12 → 안 붙는다(§0-14 실측 예시 그대로)
  assert.equal(dateTimeLabel(new Date(2026, 7, 5, 23, 40).getTime(), now), "8/5 23:40");
  assert.equal(dateTimeLabel(now, now), "09:12");
});

/** §1-4 §종 항목 ⑦ — 나열의 `<남은>`. 이 알림이 켜지는 창(≤5시간)만 대상이라 일 단위는 없다. */
test("remainingLabel — 시·분, 0분도 그대로 그린다", () => {
  assert.equal(remainingLabel(3 * 3600_000, "ko"), "3시간");
  assert.equal(remainingLabel(3 * 3600_000 + 30 * 60_000, "ko"), "3시간 30분");
  assert.equal(remainingLabel(42 * 60_000, "ko"), "42분");
  assert.equal(remainingLabel(0, "ko"), "0분");
  assert.equal(remainingLabel(-1000, "ko"), "0분"); // 경계를 지나도 음수를 안 그린다
});

// en 화면에 한글이 새는 회귀(`4f7def31`)를 고정한다 — `i18n.test.ts`의 조립 문구
// 테스트(`blocked("en", "3h 30m", 2)`)가 미리 고정한 그 낱말과 같다.
test("remainingLabel — en은 약어로 그린다", () => {
  assert.equal(remainingLabel(3 * 3600_000 + 30 * 60_000, "en"), "3h 30m");
  assert.equal(remainingLabel(42 * 60_000, "en"), "42m");
});

/** §1-4 §화면 — 상세 파생 한 줄의 `<남은>`. 지난 마감(`ms <= 0`)은 이 함수에 안 온다 —
 *  호출부(`ticket-ui.tsx`)가 그 갈래를 먼저 걷어낸다(`4f7def31`). */
test("formatRemaining — 1시간 미만·시간·일 경계, 두 언어", () => {
  assert.equal(formatRemaining(30 * 60_000, "ko"), "1시간 미만");
  assert.equal(formatRemaining(30 * 60_000, "en"), "Under 1h");
  assert.equal(formatRemaining(5 * 3600_000, "ko"), "5시간");
  assert.equal(formatRemaining(5 * 3600_000, "en"), "5h");
  assert.equal(formatRemaining(3 * 24 * 3600_000, "ko"), "3일");
  assert.equal(formatRemaining(3 * 24 * 3600_000, "en"), "3d");
});

/** 홈 대화 목록의 한 줄 (§비주얼 §24 대화 목록). 파일이 주는 순서와 화면이 그리는 순서가 다르고
 *  (파일은 만든 순, 화면은 최근이 위) 제목·시각 둘 다 비어 있을 수 있어서 판정이 여기 있다. */
test("chatRows — 최근이 위 · 제목 없는 대화는 `새 대화` · 시각은 §26 ④", () => {
  const now = new Date(2026, 7, 1, 17, 30).getTime();
  const iso = (...a: [number, number, number, number, number]) => new Date(...a).toISOString();
  const rows = chatRows(
    [
      // 파일에 든 순서 = 만든 순(오래된 것이 앞). `append`가 끝에 붙인다
      { id: "c1", title: "이 큐의 프로토콜을 요약해 달라", created: iso(2026, 6, 31, 9, 41) },
      { id: "c2", title: "답변 대기 티켓이 왜 안 도나", created: iso(2026, 7, 1, 9, 41) },
      { id: "c3", title: "", created: iso(2026, 7, 1, 17, 26) }, // 아직 아무것도 안 물었다
    ],
    now,
  );
  assert.deepEqual(rows, [
    { id: "c3", title: "새 대화", time: "17:26" }, // 최근이 위 · 제목이 없으면 `새 대화`
    { id: "c2", title: "답변 대기 티켓이 왜 안 도나", time: "09:41" },
    { id: "c1", title: "이 큐의 프로토콜을 요약해 달라", time: "7/31" }, // 다른 날은 `M/D`
  ]);

  // 옛 형식(문자열 한 줄)에서 올라온 줄 — 만든 시각이 없다. **지어내지 않고 빈 칸이고 맨 아래다**
  assert.deepEqual(
    chatRows([{ id: "old", title: "", created: "" }, { id: "new", title: "", created: iso(2026, 7, 1, 17, 30) }], now),
    [
      { id: "new", title: "새 대화", time: "17:30" },
      { id: "old", title: "새 대화", time: "" },
    ],
  );

  assert.deepEqual(chatRows([]), []); // 0건 — 트리거를 안 그리는 화면의 근거다
});

/** `대화` 목록 자르기 (§7 §`대화` 목록은 3줄부터 — 요구 `bf3f247a`). `chatRows`가 정렬을
 *  끝낸 뒤 여기서 화면에 세울 줄 수 · `더보기` 표시를 정한다. */
test("visibleChatRows — 0줄 · 3줄 · 4줄 · 20줄 · current가 창 밖", () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

  // 0줄 — 버튼이 안 뜬다
  assert.deepEqual(visibleChatRows(rowsOf(0), 3, undefined), { rows: [], showMore: false });

  // 3줄 — 처음부터 다 보이고 버튼이 안 뜬다(안 보이는 줄이 0)
  assert.deepEqual(visibleChatRows(rowsOf(3), 3, undefined), { rows: rowsOf(3), showMore: false });

  // 4줄 — 처음 3줄만 뜨고 버튼이 뜬다(안 보이는 줄이 1)
  assert.deepEqual(visibleChatRows(rowsOf(4), 3, undefined), { rows: rowsOf(3), showMore: true });

  // 20줄 — 더보기 한 번(openCount 6)에 3줄이 늘고, 남은 것이 3줄보다 적으면(openCount 18일 때
  // 남은 2줄) 그만큼만 늘고 버튼이 없어진다
  assert.deepEqual(visibleChatRows(rowsOf(20), 6, undefined), { rows: rowsOf(6), showMore: true });
  assert.deepEqual(visibleChatRows(rowsOf(20), 18, undefined), { rows: rowsOf(18), showMore: true });
  assert.deepEqual(visibleChatRows(rowsOf(20), 21, undefined), { rows: rowsOf(20), showMore: false });

  // current가 처음 3줄 밖(넷째 줄, index 3) — 그 줄이 들 때까지 처음부터 열려 있다
  assert.deepEqual(visibleChatRows(rowsOf(20), 3, "c3"), { rows: rowsOf(4), showMore: true });

  // current가 null(워커 세션을 보는 중) — openCount 그대로, 창 밖 취급을 안 한다
  assert.deepEqual(visibleChatRows(rowsOf(20), 3, null), { rows: rowsOf(3), showMore: true });
});

/** 스케줄 목록 한 줄 (§비주얼 §62 (2)(3)) — `title`은 `prompt` 첫 줄, `time`은 `dateTimeLabel`
 *  + 지난 단발이면 `지남`. **정렬은 안 한다**(§62 (9) — `schedules` 배열 순서 그대로, `at`으로
 *  다시 정렬하면 매일 스케줄 셋의 순서가 자정마다 뒤집힌다). */
test("scheduleRows — 제목은 prompt 첫 줄 · 시각은 dateTimeLabel · 지난 단발은 `지남` · 정렬 안 함", () => {
  const now = new Date(2026, 7, 20, 9, 0).getTime();
  const iso = (...a: [number, number, number, number, number]) => new Date(...a).getTime();
  const rows = scheduleRows(
    [
      // 뒤에 왔지만(만든 순 나중) 시각은 더 이르다 — 그래도 순서가 안 바뀐다(정렬 없음)
      { id: "s2", prompt: "매일 아침 보드를 훑어라", at: iso(2026, 7, 20, 9, 0), overdue: false },
      { id: "s1", prompt: "답변 대기 티켓을 훑고\n요구사항으로 올려라", at: iso(2026, 7, 24, 9, 0), overdue: false },
      { id: "s3", prompt: "릴리스 노트 초안", at: iso(2026, 7, 18, 9, 0), overdue: true },
    ],
    now,
  );
  assert.deepEqual(rows, [
    { id: "s2", title: "매일 아침 보드를 훑어라", time: "09:00" }, // 오늘 — HH:MM
    { id: "s1", title: "답변 대기 티켓을 훑고", time: "8/24 09:00" }, // 다른 날 — M/D HH:MM, 제목은 첫 줄만
    { id: "s3", title: "릴리스 노트 초안", time: "8/18 09:00 지남" }, // 이미 돈 단발
  ]);

  assert.deepEqual(scheduleRows([]), []); // 0건 — 머리 행만 뜨는 화면의 근거다
});

/** 찾기 바가 훑는 자 (DESIGN.md §7 §대화 안에서 찾기 · §비주얼 §30) — **대소문자 무시
 *  부분일치 하나**다. `<FindBar>`는 이 목록으로 `Range`를 만들 뿐이라 판정이 전부 여기 있다. */
test("findMatches — 대소문자 무시 · 0건 · 빈 검색어", () => {
  // 대소문자 무시: 질의도 원문도 어느 쪽이 대문자든 같은 자리를 준다
  assert.deepEqual(findMatches("Ticket ticket TICKET", "ticket"), [0, 7, 14]);
  assert.deepEqual(findMatches("ticket", "TiCkEt"), [0]);

  // 0건 — 빈 배열이다. 화면은 이 길이로 `0/0`을 그린다
  assert.deepEqual(findMatches("w2가 지금 무슨 일을 하나", "w4"), []);
  assert.deepEqual(findMatches("", "w2"), []);

  // 빈 검색어 — **0건과 다른 사실이다**(§30 ③: 안 찾은 것과 못 찾은 것). 여기서는 둘 다
  // 빈 배열이고, 건수 칸을 비우는 판정은 화면이 질의 문자열로 한다
  assert.deepEqual(findMatches("아무 글", ""), []);

  // 한글 부분일치 · 겹치는 일치는 안 센다(§30 ④ 겹침 없음)
  assert.deepEqual(findMatches("답변 대기 티켓이 왜 안 도나", "티켓"), [6]);
  assert.deepEqual(findMatches("aaaa", "aa"), [0, 2]);
});

/** 공통 컨텍스트 카드의 기준(DESIGN.md §데스크톱 앱 N3 §공통 컨텍스트의 기준) — 워커 전부의
 *  `TICKET_CWD` 중 가장 깊은 것으로 되돌린다. */
test("relativeUnderAny — 겹치는 기준 · 어디에도 안 걸림 · 기준 0개", () => {
  // 겹치는 기준 둘 — 워크트리 하나가 다른 워크트리 아래인 큐. 더 깊은(더 긴) 쪽을 쓴다
  assert.equal(relativeUnderAny("/root/worktrees/w1/README.md", ["/root", "/root/worktrees/w1"]), "README.md");

  // 순서와 무관하다 — 짧은 기준이 배열 앞에 와도 깊은 쪽이 이긴다
  assert.equal(relativeUnderAny("/root/worktrees/w1/README.md", ["/root/worktrees/w1", "/root"]), "README.md");

  // 어디에도 안 걸림 — 절대경로를 그대로 돌려준다(피커는 채울 뿐, 판정은 서버가 한다)
  assert.equal(
    relativeUnderAny("/elsewhere/README.md", ["/root/worktrees/w1", "/root/worktrees/w2"]),
    "/elsewhere/README.md",
  );

  // 기준 0개 — 마찬가지로 절대경로 그대로
  assert.equal(relativeUnderAny("/elsewhere/README.md", []), "/elsewhere/README.md");
});
