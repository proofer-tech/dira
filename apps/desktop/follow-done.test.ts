import { test } from "node:test";
import assert from "node:assert/strict";
import { followDoneBody, parseFollowDone } from "./follow-done.ts";

const it = { project: "p", projectName: "프로젝트", stem: "abcd1234.done", hash: "abcd1234", title: "제목", continued: "" };

test("본문: 제목 - 프로젝트, 제목이 없으면 해시", () => {
  assert.equal(followDoneBody(it), "제목 - 프로젝트");
  assert.equal(followDoneBody({ ...it, title: "" }), "abcd1234 - 프로젝트");
});

test("본문: continued가 있으면 끝에 이어받기", () => {
  assert.equal(followDoneBody({ ...it, continued: "ffff0000" }), "제목 - 프로젝트 (이어받기 ffff0000)");
});

test("검증: 배열이 아니면 던지고, 깨진 항목은 버린다", () => {
  assert.throws(() => parseFollowDone({ a: 1 }));
  assert.throws(() => parseFollowDone(null));
  assert.deepEqual(parseFollowDone([it, null, { project: "p" }, 3]), [it]);
  assert.equal(parseFollowDone([{ project: "p", stem: "s" }])[0].projectName, "p");
});
