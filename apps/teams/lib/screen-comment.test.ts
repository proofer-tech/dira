import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { screenComment } from "./screen-comment.ts";
import { withAttachments } from "./attachments.ts";

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "fst-sc-")));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(path.join(tmp, "attachments"));
const shot = path.join(tmp, "attachments", "ab12cd34-comment.jpg");
writeFileSync(shot, "x");
const proj = { root: tmp };

const ok = { comment_url: "https://a.test/x", comment_shot: shot, comment_x: "10", comment_y: "20", comment_size: "800x600" };
const run = (o: Record<string, string>, locale: "ko" | "en" = "ko") =>
  screenComment(proj, (k) => o[k] ?? "", locale);

test("다섯 값이 없으면 null이라 본문이 종전과 같다", async () => {
  assert.equal(await run({}), null);
});

test("다 오면 블록 글자가 스펙 그대로다", async () => {
  const r = await run(ok);
  assert.equal(
    r?.block,
    `## 화면 댓글\n\n- URL: https://a.test/x\n- 스크린샷: ${shot}\n- 클릭 위치: (10, 20) - 스크린샷 800x600 기준`,
  );
  assert.match((await run(ok, "en"))!.block, /^## Screen comment\n\n- URL: .*\n- Screenshot: .*\n- Click: \(10, 20\) - in 800x600 screenshot$/);
});

test("블록은 본문 다음 첨부 줄 앞이고 스크린샷은 첨부 줄에 안 나온다", async () => {
  const r = await run(ok);
  const out = withAttachments("본문\n\n" + r!.block, ["/q/attachments/zz-a.png"]);
  assert.ok(out.indexOf("## 화면 댓글") < out.indexOf("첨부 파일"));
  assert.equal(out.split(shot).length, 2);
});

const bads: [string, Record<string, string>, string][] = [
  ["일부만", { comment_url: ok.comment_url }, "comment_shot"],
  ["x 정수 아님", { ...ok, comment_x: "1.5" }, "comment_x"],
  ["y 음수", { ...ok, comment_y: "-1" }, "comment_y"],
  ["x 범위 밖", { ...ok, comment_x: "800" }, "comment_x"],
  ["y 범위 밖", { ...ok, comment_y: "600" }, "comment_y"],
  ["size 모양", { ...ok, comment_size: "800" }, "comment_size"],
  ["shot attachments 밖", { ...ok, comment_shot: "/etc/passwd" }, "comment_shot"],
  ["shot ..", { ...ok, comment_shot: path.join(tmp, "attachments", "..", "x") }, "comment_shot"],
  ["url 스킴", { ...ok, comment_url: "javascript:alert(1)" }, "comment_url"],
  ["url 아님", { ...ok, comment_url: "nope" }, "comment_url"],
];
for (const [name, o, item] of bads) {
  test(`거부: ${name}`, async () => {
    await assert.rejects(run(o), { message: `화면 댓글 값이 올바르지 않습니다 - ${item}` });
  });
}

test("about: 과 file: 스킴은 통과한다", async () => {
  assert.ok(await run({ ...ok, comment_url: "about:blank" }));
  assert.ok(await run({ ...ok, comment_url: "file:///tmp/a.html" }));
});
