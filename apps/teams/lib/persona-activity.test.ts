import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Ticket } from "./queue.ts";
import { personaActivity } from "./persona-activity.ts";

const SFX = { inProgress: ".wip", done: ".done" };
const DAY_MS = 24 * 60 * 60 * 1000;

const tmps: string[] = [];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

function makeRoot(log: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "fst-pa-"));
  tmps.push(root);
  mkdirSync(path.join(root, "workers"));
  writeFileSync(path.join(root, "workers", "runner.log"), log);
  return root;
}

/** runner.log 시각 원문 — 이 머신 로컬, `personaActivity`의 `logTimeMs`와 짝이 맞는 형식. */
function fmtLog(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 테스트 픽스처용 최소 `Ticket`. 실제 파일을 안 거친다 — `personaActivity`는 배열만 받는다. */
function mkTicket(o: { hash: string; persona: string; state: "open" | "wip" | "done"; mtime?: number }): Ticket {
  return {
    hash: o.hash,
    stem: o.hash,
    hashResolves: true,
    path: `/tmp/${o.hash}.md`,
    state: o.state,
    title: `제목 ${o.hash}`,
    kind: "work",
    persona: o.persona,
    squad: "",
    deps: [],
    unmet: [],
    assigned: false,
    priority: 3,
    baseline: 3,
    effective: 3,
    effectiveDue: null,
    fm: {},
    body: "",
    birth: o.mtime ?? 0,
    mtime: o.mtime ?? 0,
  };
}

test("personaActivity — 중앙값(짝수 개)은 가운데 두 값의 평균이다, 평균이 아니다", async () => {
  const now = Date.now();
  const asym = [1, 2, 3, 40]; // 정렬 후 중앙 (2+3)/2=2.5, 평균 11.5 — 평균이면 이 테스트가 잡는다
  const lines: string[] = [];
  const tickets: Ticket[] = [];
  asym.forEach((min, i) => {
    const hash = `a${i}a${i}a${i}a${i}`;
    const dispatchAt = now - 5 * DAY_MS - i * DAY_MS;
    const endAt = dispatchAt + min * 60_000;
    lines.push(
      `${fmtLog(dispatchAt)} [w1] DISPATCH ${hash} kind=work persona=dev sid=x log=x.log prio=3`,
      `${fmtLog(endAt)} [w1] DONE ${hash} sid=x`,
    );
    tickets.push(mkTicket({ hash, persona: "dev", state: "done", mtime: endAt }));
  });
  const root = makeRoot(lines.join("\n") + "\n");

  const activity = await personaActivity("dev", tickets, root, SFX);
  assert.strictEqual(activity.thirtyDay.durationMedianMin, 2.5); // (2+3)/2, 평균(11.5)이 아니다
});

test("personaActivity — 최근 절: 로그가 안 닿는 해시는 소요·되돌아옴이 null이다 (0으로 안 채운다)", async () => {
  const now = Date.now();
  const root = makeRoot(""); // 로그가 아예 비어 있다 — 이 해시는 절대 안 걸린다
  const tickets = [mkTicket({ hash: "cccc3333", persona: "dev", state: "done", mtime: now })];

  const activity = await personaActivity("dev", tickets, root, SFX);
  assert.strictEqual(activity.recent.length, 1);
  assert.strictEqual(activity.recent[0].durationMin, null);
  assert.strictEqual(activity.recent[0].reassigns, null);
  assert.strictEqual(activity.lastActivity, null); // 한 번도 안 돌았다
});

test("personaActivity — 다른 persona 티켓은 안 섞인다 (지금·최근 둘 다)", async () => {
  const now = Date.now();
  const root = makeRoot(
    [
      `${fmtLog(now - 60_000)} [w1] DISPATCH dddd4444 kind=work persona=pm sid=x log=x.log prio=3`,
      `${fmtLog(now)} [w1] DONE dddd4444 sid=x`,
      "",
    ].join("\n"),
  );
  const tickets = [
    mkTicket({ hash: "dddd4444", persona: "pm", state: "done", mtime: now }), // 다른 페르소나
    mkTicket({ hash: "eeee5555", persona: "dev", state: "wip" }), // 찾는 페르소나
  ];

  const activity = await personaActivity("dev", tickets, root, SFX);
  assert.deepStrictEqual(
    activity.now.map((t) => t.hash),
    ["eeee5555"],
  );
  assert.deepStrictEqual(activity.recent, []); // pm의 완료 티켓이 dev 최근에 안 샌다
});
