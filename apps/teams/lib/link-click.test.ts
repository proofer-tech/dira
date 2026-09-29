import { strict as assert } from "node:assert";
import test from "node:test";
import { dispatchLinkClick } from "./link-click.ts";

test("dispatchLinkClick — metaKey면 windowOpen만 부른다", () => {
  let openLinkCalls = 0;
  const windowOpenCalls: [string, string, string][] = [];
  dispatchLinkClick(
    { metaKey: true, ctrlKey: false },
    "https://example.com",
    () => openLinkCalls++,
    (url, target, features) => windowOpenCalls.push([url, target, features]),
  );
  assert.equal(openLinkCalls, 0);
  assert.deepEqual(windowOpenCalls, [["https://example.com", "_blank", "noopener"]]);
});

test("dispatchLinkClick — ctrlKey면 windowOpen만 부른다", () => {
  let openLinkCalls = 0;
  const windowOpenCalls: [string, string, string][] = [];
  dispatchLinkClick(
    { metaKey: false, ctrlKey: true },
    "https://example.com",
    () => openLinkCalls++,
    (url, target, features) => windowOpenCalls.push([url, target, features]),
  );
  assert.equal(openLinkCalls, 0);
  assert.deepEqual(windowOpenCalls, [["https://example.com", "_blank", "noopener"]]);
});

test("dispatchLinkClick — 둘 다 없으면 openLink만 부른다", () => {
  let openLinkCalls = 0;
  const windowOpenCalls: [string, string, string][] = [];
  dispatchLinkClick(
    { metaKey: false, ctrlKey: false },
    "https://example.com",
    () => openLinkCalls++,
    (url, target, features) => windowOpenCalls.push([url, target, features]),
  );
  assert.equal(openLinkCalls, 1);
  assert.deepEqual(windowOpenCalls, []);
});
