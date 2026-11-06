import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { keepVary, mergeVary } from "./keep-vary.ts";

test("mergeVary - 기존 토큰을 지키고 대소문자 중복을 합친다", () => {
  assert.equal(mergeVary("Accept-Language, Cookie", "rsc, accept-language"), "Accept-Language, Cookie, rsc");
  assert.equal(mergeVary(undefined, ["a", "b, a"]), "a, b");
});

test("keepVary - Vary를 덮어써도 먼저 달린 Accept-Language가 남는다", () => {
  const proto = Object.create(ServerResponse.prototype);
  keepVary(proto);
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  Object.setPrototypeOf(res, proto);
  res.setHeader("Vary", "Accept-Language, Cookie");
  res.setHeader("Vary", "rsc, next-router-state-tree");
  assert.equal(res.getHeader("vary"), "Accept-Language, Cookie, rsc, next-router-state-tree");
  res.setHeader("Content-Type", "text/html");
  assert.equal(res.getHeader("content-type"), "text/html");
});
