import { test } from "node:test";
import assert from "node:assert";
import { ticketsWithMissingSquad, type Ticket } from "./queue.ts";

const tk = (hash: string, state: string, squad: string) => ({ hash, state, squad }) as unknown as Ticket;
const names = new Set(["default"]);

test("done 티켓만 없는 스쿼드를 가리키면 경고 대상이 없다", () => {
  assert.deepStrictEqual(ticketsWithMissingSquad([tk("a", "done", "qa")], names), []);
});

test("open과 wip은 경고 대상이고, 있는 스쿼드와 squad 없음은 아니다", () => {
  const out = ticketsWithMissingSquad(
    [tk("a", "open", "qa"), tk("b", "wip", "qa"), tk("c", "done", "qa"), tk("d", "open", "default"), tk("e", "open", "")],
    names,
  );
  assert.deepStrictEqual(out.map((x) => x.hash), ["a", "b"]);
});
