import { test } from "node:test";
import assert from "node:assert";
import { commentPoint, keyBody, mouseButtonBody, scaleToFrame, wheelBody } from "./browser-input.ts";
import { toCdpInputCommand } from "./cdp-relay.ts";

test("scaleToFrame — 화면 사각형 안 비율을 그대로 프레임 원본 해상도로 옮긴다", () => {
  const rect = { left: 100, top: 50, width: 640, height: 400 };
  const natural = { width: 1280, height: 800 };
  assert.deepStrictEqual(scaleToFrame(100, 50, rect, natural), { x: 0, y: 0 }); // 좌상단
  assert.deepStrictEqual(scaleToFrame(420, 250, rect, natural), { x: 640, y: 400 }); // 중앙
  assert.deepStrictEqual(scaleToFrame(740, 450, rect, natural), { x: 1280, y: 800 }); // 우하단
});

test("scaleToFrame — 사각형 폭·높이가 0이면 (0, 0)으로 물러난다(마운트 직후 등)", () => {
  assert.deepStrictEqual(scaleToFrame(10, 10, { left: 0, top: 0, width: 0, height: 0 }, { width: 1280, height: 800 }), {
    x: 0,
    y: 0,
  });
});

test("mouseButtonBody — DOM 타입·버튼을 CDP 타입·버튼 이름으로 옮긴다", () => {
  assert.deepStrictEqual(mouseButtonBody("mousedown", 0, 10, 20), {
    type: "mousePressed",
    x: 10,
    y: 20,
    button: "left",
    clickCount: 1,
  });
  assert.deepStrictEqual(mouseButtonBody("mouseup", 2, 10, 20), {
    type: "mouseReleased",
    x: 10,
    y: 20,
    button: "right",
    clickCount: 1,
  });
  assert.deepStrictEqual(mouseButtonBody("mousemove", 0, 10, 20), {
    type: "mouseMoved",
    x: 10,
    y: 20,
    button: "none",
    clickCount: undefined,
  });
});

test("wheelBody — mouseWheel 타입에 델타를 싣는다", () => {
  assert.deepStrictEqual(wheelBody(5, 5, 0, 100), { type: "mouseWheel", x: 5, y: 5, button: "none", deltaX: 0, deltaY: 100 });
});

test("keyBody — 출력 가능한 한 글자 keydown은 text를 같이 싣고, 그 밖은 안 싣는다", () => {
  assert.deepStrictEqual(keyBody("keydown", "a", "KeyA"), { type: "keyDown", key: "a", code: "KeyA", text: "a" });
  assert.deepStrictEqual(keyBody("keydown", "Enter", "Enter"), { type: "keyDown", key: "Enter", code: "Enter" });
  assert.deepStrictEqual(keyBody("keyup", "a", "KeyA"), { type: "keyUp", key: "a", code: "KeyA" });
});

test("이 모듈이 낸 본문 전부가 cdp-relay의 화이트리스트(toCdpInputCommand)를 통과한다", () => {
  const bodies = [
    mouseButtonBody("mousedown", 0, 1, 1),
    mouseButtonBody("mouseup", 1, 1, 1),
    mouseButtonBody("mousemove", 0, 1, 1),
    wheelBody(1, 1, 0, 10),
    keyBody("keydown", "a", "KeyA"),
    keyBody("keyup", "a", "KeyA"),
  ];
  for (const body of bodies) assert.ok(toCdpInputCommand(body) !== null, JSON.stringify(body));
});

test("commentPoint — 위아래 띠: 내용 사각형 기준 프레임 좌표, 띠 위 클릭은 null", () => {
  // 상자 800x600, 프레임 1280x640 -> 배율 0.625, 내용 800x400, 위아래 띠 100px
  const box = { left: 10, top: 20, width: 800, height: 600 };
  const nat = { width: 1280, height: 640 };
  assert.deepStrictEqual(commentPoint(10, 120, box, nat), { x: 0, y: 0, px: 0, py: 100 });
  assert.deepStrictEqual(commentPoint(410, 320, box, nat), { x: 640, y: 320, px: 400, py: 300 });
  assert.strictEqual(commentPoint(410, 119, box, nat), null); // 위 띠
  assert.strictEqual(commentPoint(410, 520, box, nat), null); // 아래 띠
  assert.deepStrictEqual(commentPoint(809, 519, box, nat)?.x, 1278);
});

test("commentPoint — 좌우 띠", () => {
  // 상자 800x400, 프레임 400x400 -> 배율 1, 내용 400x400, 좌우 띠 200px
  const box = { left: 0, top: 0, width: 800, height: 400 };
  const nat = { width: 400, height: 400 };
  assert.strictEqual(commentPoint(199, 100, box, nat), null);
  assert.strictEqual(commentPoint(600, 100, box, nat), null);
  assert.deepStrictEqual(commentPoint(200, 0, box, nat), { x: 0, y: 0, px: 200, py: 0 });
  assert.deepStrictEqual(commentPoint(599, 399, box, nat)?.x, 399);
});

test("commentPoint — 띠 없음, 프레임 없음", () => {
  const box = { left: 0, top: 0, width: 640, height: 400 };
  assert.deepStrictEqual(commentPoint(320, 200, box, { width: 1280, height: 800 }), { x: 640, y: 400, px: 320, py: 200 });
  assert.strictEqual(commentPoint(640, 200, box, { width: 1280, height: 800 }), null); // 오른쪽 끝 밖
  assert.strictEqual(commentPoint(10, 10, box, { width: 0, height: 0 }), null);
});
