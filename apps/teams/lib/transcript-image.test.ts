import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 진짜 레지스트리를 밟지 않는다. import 전에 건다.
const LOCAL = mkdtempSync(path.join(tmpdir(), "fst-img-local-"));
process.env.TICKET_LOCAL = LOCAL;
const tmp = mkdtempSync(path.join(tmpdir(), "fst-img-"));
process.on("exit", () => {
  rmSync(LOCAL, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

const { addProject } = await import("./projects.ts");
const { recordToEvents, tailEvents } = await import("./transcript.ts");
const { serveTranscriptImage } = await import("./transcript-image.ts");

const SID = "11111111-2222-3333-4444-555555555555";
const PNG = Buffer.from("fake-png-bytes").toString("base64");
const ts = "2026-10-27T00:00:00.000Z";
const result = (content: unknown[], uuid = "rec-1") => ({
  type: "user",
  uuid,
  timestamp: ts,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content }] },
});
const png = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } };

test("이미지 참조만 사건에 싣고 base64는 싣지 않는다", () => {
  const evs = recordToEvents(result([{ type: "text", text: "ok" }, png]));
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0].images, [{ sub: 1, mime: "image/png" }]);
  assert.ok(!JSON.stringify(evs).includes(PNG));
  assert.equal(evs[0].body, "ok");
});

test("바이트 없는 이미지는 [image] 글자로 남는다", () => {
  const evs = recordToEvents(result([{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }]));
  assert.equal(evs[0].images, undefined);
  assert.equal(evs[0].body, "[image]");
});

test("최상위 image 블록은 이미지 줄이 되고 [Image: original ...] 문장은 사라진다", () => {
  const evs = recordToEvents({
    type: "user",
    uuid: "rec-2",
    timestamp: ts,
    message: {
      role: "user",
      content: [png, { type: "text", text: "[Image: original 390x2400, displayed at 325x2000.]" }],
    },
  });
  assert.deepEqual(evs.map((e) => [e.kind, e.key]), [["image", "rec-2:0"]]);
  assert.deepEqual(evs[0].images, [{ mime: "image/png" }]);
});

test("문자열 content인 [Image: original ...] user 레코드도 사건을 만들지 않는다", () => {
  const evs = recordToEvents({
    type: "user",
    uuid: "rec-3",
    timestamp: ts,
    message: { role: "user", content: "[Image: original 390x2400, displayed at 325x2000.]" },
  });
  assert.deepEqual(evs, []);
});

test("라우트 - 프로젝트 id와 세션 id가 맞아야 바이트를 주고, 아니면 404", async () => {
  const root = path.join(tmp, "q");
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  await addProject("이미지", root, "img");
  const projects = path.join(tmp, "projects");
  mkdirSync(path.join(projects, "d"), { recursive: true });
  const file = path.join(projects, "d", `${SID}.jsonl`);
  writeFileSync(file, JSON.stringify(result([{ type: "text", text: "x" }, png])) + "\n");

  const get = (o: Record<string, string>) => serveTranscriptImage(new URLSearchParams(o), projects);
  const ref = { project: "img", session: SID, rec: "rec-1", block: "0", sub: "1" };
  const ok = await get(ref);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), "fake-png-bytes");

  assert.equal((await get({ ...ref, project: "other" })).status, 404); // 다른 프로젝트 id
  assert.equal((await get({ ...ref, session: "99999999-2222-3333-4444-555555555555" })).status, 404); // 없는 세션
  assert.equal((await get({ ...ref, session: "../../etc/passwd" })).status, 404); // 경로
  assert.equal((await get({ ...ref, sub: "0" })).status, 404); // 이미지가 아닌 블록
  assert.equal((await get({ ...ref, rec: "nope" })).status, 404);

  // tailEvents가 세션 id를 참조에 붙인다
  const { events } = await tailEvents(file, 0);
  assert.deepEqual(events[0].images, [{ sub: 1, mime: "image/png", session: SID }]);
});
