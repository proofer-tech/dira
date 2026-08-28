// QA 임시 스크립트 - 화면 수용조건 (10)-(19) 재려고 임시 프로젝트 둘을 실제 GUI 코드 경로로 만든다.
// 티켓 1e7545a5 작업용. 다 쓰면 지운다.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LOCAL = "/tmp/qa-screen/local";
process.env.TICKET_LOCAL = LOCAL;
mkdirSync(LOCAL, { recursive: true });

function makeRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "qa@example.com");
  git("config", "user.name", "qa");
  writeFileSync(path.join(dir, "README.md"), "# qa\n");
  git("add", "-A");
  git("commit", "-qm", "init");
}

// app/actions.ts는 next/cache를 껴서 순수 node로 못 돈다 - createProject가 하는 일
// (scaffold -> registerCron -> addProject)을 lib 함수로 그대로 재현한다.
const { scaffold } = await import("./lib/scaffold.ts");
const { registerCron } = await import("./lib/workers.ts");
const { addProject } = await import("./lib/projects.ts");

async function makeProject(name: string, dir: string, id: string) {
  makeRepo(dir);
  const made = await scaffold(dir, { branch: "main" });
  await registerCron(path.join(made.root, "workers", "w1.sh"));
  return addProject(name, made.root, id);
}

const A = "/tmp/qa-screen/proj-A";
const B = "/tmp/qa-screen/proj-B";

const ra = await makeProject("QA 프로젝트 A", A, "qa-proj-a");
console.log("A registered:", JSON.stringify(ra));
const rb = await makeProject("QA 프로젝트 B", B, "qa-proj-b");
console.log("B registered:", JSON.stringify(rb));

// 각 프로젝트에 열린 티켓 한 장씩 - 워커 화면/통계가 빈 큐가 아니게.
for (const project of [ra, rb]) {
  mkdirSync(path.join(project.root, "tickets"), { recursive: true });
  writeFileSync(
    path.join(project.root, "tickets", "qa000001.md"),
    "---\nticket: qa000001\ntitle: QA 표본 티켓\nkind: work\n---\n\n## Goal\nQA 화면 검증용.\n",
  );
}

console.log("DONE");
