import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSquadName } from "./projects.ts";
import { DESIGN_PROCEDURE, REVIEW_PROCEDURE, issueSquadTicket } from "./squad-tickets.ts";

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "squad-tickets-"));
  const queue = path.join(base, "queue");
  const templates = path.join(base, "templates");
  await mkdir(path.join(queue, "tickets"), { recursive: true });
  await mkdir(path.join(templates, "protocols"), { recursive: true });
  await writeFile(path.join(templates, DESIGN_PROCEDURE), "설계 절차 템플릿\n");
  await writeFile(path.join(templates, REVIEW_PROCEDURE), "점검 절차 템플릿\n");
  return { queue, templates };
}

const only = async (queue: string) => {
  const names = await readdir(path.join(queue, "tickets"));
  assert.equal(names.length, 1);
  return readFile(path.join(queue, "tickets", names[0]), "utf8");
};

test("설계 티켓: 제목-설명 원문-절차 경로-상자 다섯, 스쿼드 디렉터리 없음", async () => {
  const { queue, templates } = await fixture();
  await issueSquadTicket(queue, templates, "design", "s1", { description: "리뷰 봇\n두 줄", persona: "pm" });
  const text = await only(queue);
  assert.match(text, /^title: 스쿼드 설계 - s1$/m);
  assert.match(text, /^persona: pm$/m);
  assert.ok(text.includes("> 리뷰 봇\n> 두 줄"));
  assert.ok(text.includes("protocols/스쿼드-설계.md"));
  assert.equal(text.split("## Done when")[1].match(/^- \[ \] /gm)?.length, 5);
  assert.deepEqual(await readdir(queue).then((n) => n.filter((x) => x === "squads")), []);
});

test("점검 티켓: squad 키-제목-상자 셋", async () => {
  const { queue, templates } = await fixture();
  await issueSquadTicket(queue, templates, "review", "default", { squad: "default" });
  const text = await only(queue);
  assert.match(text, /^squad: default$/m);
  assert.match(text, /^title: 스쿼드 점검 - default$/m);
  assert.equal(text.split("## Done when")[1].match(/^- \[ \] /gm)?.length, 3);
});

test("절차 파일: 없으면 템플릿과 같은 바이트로 생기고 있으면 안 덮는다", async () => {
  const { queue, templates } = await fixture();
  await issueSquadTicket(queue, templates, "review", "a", { squad: "a" });
  assert.deepEqual(await readFile(path.join(queue, REVIEW_PROCEDURE)), await readFile(path.join(templates, REVIEW_PROCEDURE)));
  await writeFile(path.join(queue, REVIEW_PROCEDURE), "고쳐 둔 절차\n");
  await issueSquadTicket(queue, templates, "review", "a", { squad: "a" });
  assert.equal(await readFile(path.join(queue, REVIEW_PROCEDURE), "utf8"), "고쳐 둔 절차\n");
});

test("NAME_RE 밖 이름은 종전 만들기와 같은 검사에서 거부된다", async () => {
  await assert.rejects(checkSquadName("/tmp/x", "a b"));
  await assert.rejects(checkSquadName("/tmp/x", "../x"));
});
