import { test } from "node:test";
import assert from "node:assert";
import {
  browserPortPath,
  isValidCdpHash,
  portFromDevToolsFile,
  readCdpFrameStream,
  toCdpInputCommand,
} from "./cdp-relay.ts";

test("해시는 8자리 소문자 hex만 통과한다", () => {
  assert.equal(isValidCdpHash("9aef55ab"), true);
  assert.equal(isValidCdpHash("9AEF55AB"), false);
  assert.equal(isValidCdpHash("../../etc/passwd"), false);
  assert.equal(isValidCdpHash("9aef55ab0"), false);
  assert.equal(isValidCdpHash(""), false);
});

test("포트 경로는 browser.sh의 _existing_port()와 같은 자리다", () => {
  assert.equal(
    browserPortPath("9aef55ab"),
    "/tmp/qa-9aef55ab/chrome-profile/DevToolsActivePort",
  );
});

test("파일이 없으면(null) 브라우저를 안 쥔 것이다", () => {
  assert.equal(portFromDevToolsFile(null), null);
  assert.equal(portFromDevToolsFile(""), null);
  assert.equal(portFromDevToolsFile("\n"), null);
});

test("첫 줄이 포트다 - 뒤에 다른 줄이 있어도 무시한다", () => {
  assert.equal(portFromDevToolsFile("51674\n"), 51674);
  assert.equal(portFromDevToolsFile("51674\nws://127.0.0.1:51674/devtools/browser/x"), 51674);
});

test("포트 줄이 숫자가 아니면 null이다", () => {
  assert.equal(portFromDevToolsFile("not-a-port\n"), null);
});

test("마우스 type은 Input.dispatchMouseEvent로 간다", () => {
  const cmd = toCdpInputCommand({ type: "mousePressed", x: 10, y: 20, button: "left" });
  assert.deepEqual(cmd, {
    method: "Input.dispatchMouseEvent",
    params: { type: "mousePressed", x: 10, y: 20, button: "left" },
  });
});

test("키 type은 Input.dispatchKeyEvent로 간다", () => {
  const cmd = toCdpInputCommand({ type: "keyDown", key: "a" });
  assert.deepEqual(cmd, { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "a" } });
});

test("모르는 type이나 형식이 아닌 본문은 null이다 - 임의 메서드가 못 나간다", () => {
  assert.equal(toCdpInputCommand({ type: "Page.navigate", url: "https://evil" }), null);
  assert.equal(toCdpInputCommand({ method: "Page.navigate" }), null);
  assert.equal(toCdpInputCommand(null), null);
  assert.equal(toCdpInputCommand("mousePressed"), null);
});

function sseOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

test("200이 아닌 응답은 본문을 안 읽고 끊김이다", async () => {
  const res = new Response(sseOf(["data: abcd\n\n"]), { status: 404 });
  const frames: string[] = [];
  const outcome = await readCdpFrameStream(res, (f) => frames.push(f));
  assert.equal(outcome, "disconnected");
  assert.deepEqual(frames, []);
});

test("프레임을 한 장도 못 받고 끝난 스트림은 끊김이다", async () => {
  const res = new Response(sseOf([]), { status: 200 });
  const frames: string[] = [];
  const outcome = await readCdpFrameStream(res, (f) => frames.push(f));
  assert.equal(outcome, "disconnected");
});

test("data: 줄 하나가 프레임 하나다 - 값은 그대로 넘긴다", async () => {
  const res = new Response(sseOf(["data: aGVsbG8=\n\n", "data: d29ybGQ=\n\n"]), { status: 200 });
  const frames: string[] = [];
  const outcome = await readCdpFrameStream(res, (f) => frames.push(f));
  assert.equal(outcome, "ok");
  assert.deepEqual(frames, ["aGVsbG8=", "d29ybGQ="]);
});

test("청크 경계가 줄 중간에서 끊겨도 이어 붙여 읽는다", async () => {
  const res = new Response(sseOf(["data: ab", "cd==\n\n"]), { status: 200 });
  const frames: string[] = [];
  const outcome = await readCdpFrameStream(res, (f) => frames.push(f));
  assert.equal(outcome, "ok");
  assert.deepEqual(frames, ["abcd=="]);
});

test("signal이 이미 끊긴 채 읽기가 던지면 aborted다", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new DOMException("aborted", "AbortError"));
    },
  });
  const res = new Response(stream, { status: 200 });
  const ac = new AbortController();
  ac.abort();
  const frames: string[] = [];
  const outcome = await readCdpFrameStream(res, (f) => frames.push(f), ac.signal);
  assert.equal(outcome, "aborted");
  assert.deepEqual(frames, []);
});
