import { test } from "node:test";
import assert from "node:assert";
import {
  chatRows,
  interjectMode,
  parentPath,
  projectPath,
  relationPath,
  timeLabel,
  type Anchor,
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

test("parentPath — 프로젝트 화면 넷의 부모는 보드다(§0-7 표 3~6행)", () => {
  assert.equal(parentPath("/p/a/workers"), "/p/a");
  assert.equal(parentPath("/p/a/personas"), "/p/a");
  assert.equal(parentPath("/p/a/protocols"), "/p/a");
  assert.equal(parentPath("/p/a/tickets/fff28e90"), "/p/a");
  assert.equal(parentPath("/p/a/tickets/new"), "/p/a"); // 발행도 보드에서 들어간다(§비주얼 §4)
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

/** 스트림 아래 입력 form의 모드 (DESIGN.md §비주얼 §21 `어느 폼을 그리나` 표 + 예외 둘).
 *  JSX 안에서 이 판정이 갈리면 완료 티켓에서 참견을 보내거나(닿을 곳이 없다) 열린 티켓에
 *  없어야 할 입구가 선다 — 그래서 판정만 순수 함수로 나와 있다. */
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

/** 홈 대화 목록의 한 줄 (§비주얼 §24 대화 목록). 파일이 주는 순서와 화면이 그리는 순서가 다르고
 *  (파일은 만든 순, 화면은 최근이 위) 제목·시각 둘 다 비어 있을 수 있어서 판정이 여기 산다. */
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
