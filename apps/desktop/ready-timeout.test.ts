// 판정 둘 다 순수 함수라 electron도 자식 프로세스도 없이 분기 전부를 밟는다.
// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { describeReadyTimeout, readyTimeoutHint } from "./ready-timeout.ts";

test("describeReadyTimeout — 준비 전에 죽은 경우 종료 코드를 명시한다", () => {
  const reason = describeReadyTimeout(30, "http://127.0.0.1:1", { kind: "exited", code: 127, signal: null });
  assert.match(reason, /code 127/);
});

test("describeReadyTimeout — 살아 있는 채 타임아웃하면 PID를 명시하고 죽은 경우와 문장이 다르다", () => {
  const dead = describeReadyTimeout(30, "http://127.0.0.1:1", { kind: "exited", code: 1, signal: null });
  const hung = describeReadyTimeout(30, "http://127.0.0.1:1", { kind: "hung", pid: 4242, stdoutTail: "" });
  assert.match(hung, /프로세스는 살아 있으나 응답하지 않음/);
  assert.match(hung, /4242/);
  assert.notEqual(hung, dead);
});

test("describeReadyTimeout — 신호로 죽은 경우 signal을 적는다", () => {
  const reason = describeReadyTimeout(30, "http://127.0.0.1:1", { kind: "exited", code: null, signal: "SIGSEGV" });
  assert.match(reason, /SIGSEGV/);
});

test("readyTimeoutHint — 살아 있는 채 멈춘 경우 stdout 꼬리와 sample 명령을 담는다", () => {
  const hint = readyTimeoutHint({ kind: "hung", pid: 4242, stdoutTail: "starting up\nlistening soon\n" });
  assert.match(hint, /starting up/);
  assert.match(hint, /sample 4242/);
});

test("readyTimeoutHint — stdout이 비어 있으면 그 사실을 적는다", () => {
  const hint = readyTimeoutHint({ kind: "hung", pid: 4242, stdoutTail: "" });
  assert.match(hint, /비어 있음/);
});

test("readyTimeoutHint — 준비 전에 죽은 경우는 단서가 없다", () => {
  assert.equal(readyTimeoutHint({ kind: "exited", code: 1, signal: null }), "");
});
