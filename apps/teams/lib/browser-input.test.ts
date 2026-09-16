import { test } from "node:test";
import assert from "node:assert";
import { keyBody, mouseButtonBody, scaleToFrame, wheelBody } from "./browser-input.ts";
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
