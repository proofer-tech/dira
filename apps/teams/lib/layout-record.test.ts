import { test } from "node:test";
import assert from "node:assert";
import { serializeLayout } from "./layout-record.ts";

test("모르는 키를 버리고 값 필드를 만들지 않는다", () => {
  const out = serializeLayout({
    theme: "dark",
    sidebar: { width: 256, collapsed: true, title: "비밀 티켓 이름" },
    screen: "ticket",
    panes: { main: 900, ticket: 5 },
    ticketName: "abcd1234 secret",
    extra: { a: 1 },
  })!;
  assert.deepStrictEqual(JSON.parse(out), {
    v: 1, theme: "dark", sidebar: { width: 256, collapsed: true }, screen: "ticket", panes: { main: 900 },
  });
  assert.ok(!out.includes("secret") && !out.includes("비밀"));
});

test("문자열 값과 모르는 화면은 들어가지 않는다", () => {
  const r = JSON.parse(serializeLayout({ theme: "x", sidebar: { width: "넓음" }, screen: "my-ticket-title", panes: { main: "문구" } })!);
  assert.deepStrictEqual(r, { v: 1, theme: "light", sidebar: { width: 0, collapsed: false }, screen: null, panes: {} });
});

test("객체가 아니면 null", () => {
  assert.equal(serializeLayout("x"), null);
  assert.equal(serializeLayout(null), null);
});
