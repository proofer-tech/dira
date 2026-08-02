import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 키맵(~/.config/dira/keymap.json)을 밟지 않는다. import 전에 건다 — `auth.test.ts`와 같다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-keymap-"));
process.env.TICKET_LOCAL = LOCAL;
process.on("exit", () => rmSync(LOCAL, { recursive: true, force: true }));

const { DEFAULT_KEYMAP, comboOf, formatCombo, matchCombo, shouldFire, validateBinding } =
  await import("./keymap.ts");
// 파일 세 함수는 `registryPath()` 옆에 산다 — `keymap.ts`가 클라이언트 번들로 가기 때문이다
// (그 파일 머리 주석). 여기서 같이 검증한다: 계약이 하나고 픽스처도 하나다.
const { keymapPath, readKeymap, writeKeymap } = await import("./projects.ts");

const FILE = path.join(LOCAL, "keymap.json");
const put = (o: unknown) => writeFileSync(FILE, typeof o === "string" ? o : JSON.stringify(o));
const clear = () => rmSync(FILE, { force: true });

// ── ① 기본값 · 경로 ─────────────────────────────────────────────────────────

test("DEFAULT_KEYMAP — §0-6 액션 표 8줄과 id·기본키가 같다", () => {
  assert.deepStrictEqual(
    DEFAULT_KEYMAP.map((a) => [a.id, a.combo]),
    [
      ["project.search", "Mod+k"],
      ["settings.open", "?"],
      ["board.search", "/"],
      ["board.new", "n"],
      ["board.request", "r"],
      ["nav.board", "b"],
      ["nav.workers", "w"],
      ["interject.send", "Mod+Enter"],
    ],
  );
  // 목록 화면이 그리는 이름도 비어 있지 않다
  assert.ok(DEFAULT_KEYMAP.every((a) => a.name));
  assert.strictEqual(DEFAULT_KEYMAP.find((a) => a.id === "project.search")!.name, "프로젝트 검색");
  // 기본값끼리 겹치면 첫 화면부터 거짓말이다
  assert.strictEqual(new Set(DEFAULT_KEYMAP.map((a) => a.combo)).size, DEFAULT_KEYMAP.length);
  // 기본값 전부가 자기 검증을 통과한다(못 쓰는 키를 기본값으로 박지 않았다)
  const b = Object.fromEntries(DEFAULT_KEYMAP.map((a) => [a.id, a.combo]));
  for (const a of DEFAULT_KEYMAP) assert.strictEqual(validateBinding(b, a.id, a.combo), null, a.id);
});

test("keymapPath — TICKET_LOCAL을 존중하고 레지스트리와 같은 디렉터리다", () => {
  assert.strictEqual(keymapPath(), FILE);
});

// ── ② 읽기 — 셋 다 던지지 않는다 ────────────────────────────────────────────

test("readKeymap — 파일이 없으면 기본값 전부, broken은 false", async () => {
  clear();
  const k = await readKeymap();
  assert.strictEqual(k.broken, false);
  assert.strictEqual(Object.keys(k.bindings).length, 8);
  assert.strictEqual(k.bindings["project.search"], "Mod+k");
});

test("readKeymap — JSON이 깨져도 던지지 않고 broken으로 말한다", async () => {
  put("{ 이건 JSON이 아니다");
  const k = await readKeymap();
  assert.strictEqual(k.broken, true);
  assert.ok(k.error); // 사유 원문을 삼키지 않는다 — 화면이 그대로 그린다(§비주얼 §22)
  assert.strictEqual(k.bindings["project.search"], "Mod+k"); // 그래도 완전하다
  put([1, 2]); // 객체가 아닌 JSON도 같다
  assert.strictEqual((await readKeymap()).broken, true);
  clear();
  assert.strictEqual((await readKeymap()).error, undefined); // 없음은 깨진 것이 아니다
});

test("readKeymap — 모르는 액션 id·이상한 값은 무시하고 아는 것만 얹는다", async () => {
  put({ "project.search": "Mod+j", "nope.gone": "x", "board.new": 7 });
  const k = await readKeymap();
  assert.strictEqual(k.broken, false);
  assert.strictEqual(k.bindings["project.search"], "Mod+j"); // 바꾼 것
  assert.strictEqual(k.bindings["board.new"], "n"); // 문자열이 아니면 기본값
  assert.ok(!("nope.gone" in k.bindings));
});

// ── ③ 쓰기 — 모르는 id 보존 · 기본값은 뺀다 ─────────────────────────────────

test("writeKeymap — 읽은 객체 위에 덮어써 모르는 id를 보존한다", async () => {
  put({ "nope.gone": "x", "board.new": "m" });
  await writeKeymap({ "project.search": "Mod+j" });
  assert.deepStrictEqual(JSON.parse(readFileSync(FILE, "utf8")), {
    "nope.gone": "x",
    "board.new": "m",
    "project.search": "Mod+j",
  });
});

test("writeKeymap — 기본값과 같아진 값은 파일에서 빠진다(되돌리기)", async () => {
  put({ "project.search": "Mod+j", "board.new": "m" });
  await writeKeymap({ "project.search": "Mod+k" }); // 기본값으로 되돌린다
  assert.deepStrictEqual(JSON.parse(readFileSync(FILE, "utf8")), { "board.new": "m" });
  await writeKeymap({ "board.new": "n" });
  assert.deepStrictEqual(JSON.parse(readFileSync(FILE, "utf8")), {});
  clear();
});

// ── ④ 매칭 · 표기 ───────────────────────────────────────────────────────────

const ev = (o: Partial<Parameters<typeof matchCombo>[0]> & { key: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

test("matchCombo — Mod는 metaKey 또는 ctrlKey", () => {
  assert.ok(matchCombo(ev({ key: "k", metaKey: true }), "Mod+k"));
  assert.ok(matchCombo(ev({ key: "k", ctrlKey: true }), "Mod+k"));
  assert.ok(!matchCombo(ev({ key: "k" }), "Mod+k")); // 맨손은 아니다
  assert.ok(!matchCombo(ev({ key: "n", metaKey: true }), "n")); // Mod 없는 조합에 ⌘를 얹어도 아니다
  assert.ok(matchCombo(ev({ key: "Enter", metaKey: true }), "Mod+Enter"));
});

test("matchCombo — 글자는 대소문자로 갈리지 않고, `?`는 Shift와 함께 와도 듣는다", () => {
  assert.ok(matchCombo(ev({ key: "K", metaKey: true }), "Mod+k"));
  assert.ok(matchCombo(ev({ key: "N", shiftKey: true }), "n"));
  // `?`는 US 배열에서 Shift+/다 — shiftKey를 없음으로 따지면 §0-6 기본키가 안 듣는다
  assert.ok(matchCombo(ev({ key: "?", shiftKey: true }), "?"));
  assert.ok(!matchCombo(ev({ key: "/", shiftKey: true }), "?")); // 그래도 키 자체는 갈린다
});

test("matchCombo — 조합 중(isComposing)이면 무조건 false", () => {
  assert.ok(!matchCombo(ev({ key: "Enter", metaKey: true, isComposing: true }), "Mod+Enter"));
  assert.ok(!matchCombo(ev({ key: "n", isComposing: true }), "n"));
});

test("shouldFire — 글 쓰는 중이면 Mod 없는 조합만 죽는다", () => {
  // 검색 칸에 `n`을 쳐도 발행 다이얼로그가 열리지 않는다 — 이 기능 전체의 성패다(§0-6)
  assert.ok(!shouldFire(ev({ key: "n" }), "n", true));
  assert.ok(shouldFire(ev({ key: "n" }), "n", false));
  // `Mod+k`는 가드를 안 받는다 — §4-1이 "어디서나"라고 적었다
  assert.ok(shouldFire(ev({ key: "k", metaKey: true }), "Mod+k", true));
  // 가드를 통과해도 매칭은 매칭이다
  assert.ok(!shouldFire(ev({ key: "j" }), "n", false));
  assert.ok(!shouldFire(ev({ key: "n", isComposing: true }), "n", false));
});

test("comboOf — 누른 키를 저장형으로. `matchCombo`가 그 값을 도로 잡는다", () => {
  assert.strictEqual(comboOf(ev({ key: "k", metaKey: true })), "Mod+k");
  assert.strictEqual(comboOf(ev({ key: "K", metaKey: true, shiftKey: true })), "Mod+k");
  assert.strictEqual(comboOf(ev({ key: "Enter", ctrlKey: true })), "Mod+Enter");
  assert.strictEqual(comboOf(ev({ key: " " })), "Space");
  const up = ev({ key: "ArrowUp", metaKey: true, shiftKey: true });
  assert.strictEqual(comboOf(up), "Mod+Shift+ArrowUp");
  assert.strictEqual(comboOf(ev({ key: "j", altKey: true })), "Alt+j");
  // 왕복: 캡처가 만든 값을 그 키가 도로 잡는다(둘이 갈리면 바꾼 키가 안 듣는다)
  for (const e of [
    ev({ key: "K", metaKey: true }),
    ev({ key: "?", shiftKey: true }),
    ev({ key: "Enter", metaKey: true }),
    ev({ key: "ArrowUp", shiftKey: true }),
  ]) {
    assert.ok(matchCombo(e, comboOf(e)), JSON.stringify(e));
  }
});

test("comboOf — 글자 키의 Shift는 안 적는다(같은 물리 키가 두 값이 되면 충돌을 못 잡는다)", () => {
  // `Shift+/`의 `e.key`는 이미 `?`다 — `Shift+?`로 적으면 §0-6 기본키 `?`와 안 겹치는 값이 된다
  const q = comboOf(ev({ key: "?", shiftKey: true }));
  assert.strictEqual(q, "?");
  assert.strictEqual(validateBinding(BOUND, "board.new", q)!.conflict, "settings.open");
  // 이름 있는 키는 Shift가 뜻을 바꾸므로 적는다
  assert.strictEqual(comboOf(ev({ key: "Enter", metaKey: true, shiftKey: true })), "Mod+Shift+Enter");
});

test("comboOf — 조합자만 누른 것은 검증이 거절한다(캡처 상자는 흘려보낸다)", () => {
  for (const key of ["Meta", "Control", "Shift", "Alt"]) {
    assert.match(validateBinding(BOUND, "board.new", comboOf(ev({ key })))!.reason, /조합키만/, key);
  }
});

test("formatCombo — 화면 표기는 여기 하나에서 나온다", () => {
  assert.strictEqual(formatCombo("Mod+k"), "⌘K");
  assert.strictEqual(formatCombo("Mod+Enter"), "⌘↵");
  assert.strictEqual(formatCombo("?"), "?");
  assert.strictEqual(formatCombo("n"), "N");
  assert.strictEqual(formatCombo("Mod+Shift+ArrowUp"), "⇧⌘↑");
});

// ── ⑤ 검증 ─────────────────────────────────────────────────────────────────

const BOUND = Object.fromEntries(DEFAULT_KEYMAP.map((a) => [a.id, a.combo])) as Parameters<
  typeof validateBinding
>[0];

test("validateBinding — 겹치면 상대 액션 id를 담아 거절한다", () => {
  const e = validateBinding(BOUND, "board.new", "/")!;
  assert.strictEqual(e.conflict, "board.search");
  assert.match(e.reason, /보드 검색과 겹칩니다/); // 문구가 상대 액션의 **이름**을 말한다
  // 자기 자신과는 안 겹친다(안 바꾸고 저장해도 통과한다)
  assert.strictEqual(validateBinding(BOUND, "board.new", "n"), null);
  assert.strictEqual(validateBinding(BOUND, "board.new", "j"), null);
  // 받침 없는 이름은 `와`다
  assert.match(validateBinding(BOUND, "board.new", "Mod+Enter")!.reason, /보내기와 겹칩니다/);
});

test("validateBinding — 못 쓰는 키는 사유와 함께 거절한다", () => {
  for (const combo of ["Mod+Shift", "Mod+", "Shift", ""]) {
    assert.match(validateBinding(BOUND, "board.new", combo)!.reason, /조합키만/, combo);
  }
  assert.match(validateBinding(BOUND, "board.new", "Escape")!.reason, /Esc/);
  assert.match(validateBinding(BOUND, "board.new", "Tab")!.reason, /Tab/);
  assert.match(validateBinding(BOUND, "board.new", "Enter")!.reason, /⌘/);
  assert.match(validateBinding(BOUND, "board.new", "Space")!.reason, /⌘/);
  // Mod가 붙으면 둘 다 쓸 수 있다
  assert.strictEqual(validateBinding(BOUND, "board.new", "Mod+Space"), null);
  assert.strictEqual(validateBinding(BOUND, "interject.send", "Mod+Enter"), null);
});
