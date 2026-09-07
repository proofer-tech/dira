import { test } from "node:test";
import assert from "node:assert";
import { readPtyStream } from "./pty-stream.ts";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
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
  const res = new Response(streamOf(["<html>404</html>"]), { status: 404 });
  const chunks: string[] = [];
  const outcome = await readPtyStream(res, (t) => chunks.push(t));
  assert.equal(outcome, "disconnected");
  assert.deepEqual(chunks, []);
});

test("한 바이트도 못 받고 끝난 스트림은 끊김이다", async () => {
  const res = new Response(streamOf([]), { status: 200 });
  const chunks: string[] = [];
  const outcome = await readPtyStream(res, (t) => chunks.push(t));
  assert.equal(outcome, "disconnected");
  assert.deepEqual(chunks, []);
});

test("정상 청크는 그대로 흘러가고 ok다", async () => {
  const res = new Response(streamOf(["hello ", "world"]), { status: 200 });
  const chunks: string[] = [];
  const outcome = await readPtyStream(res, (t) => chunks.push(t));
  assert.equal(outcome, "ok");
  assert.equal(chunks.join(""), "hello world");
});

test("signal이 이미 끊긴 채 읽기가 던지면 aborted다 - disconnected로 안 샌다", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new DOMException("aborted", "AbortError"));
    },
  });
  const res = new Response(stream, { status: 200 });
  const ac = new AbortController();
  ac.abort();
  const chunks: string[] = [];
  const outcome = await readPtyStream(res, (t) => chunks.push(t), ac.signal);
  assert.equal(outcome, "aborted");
  assert.deepEqual(chunks, []);
});
