/** 실행기 계약(P559-1 결정 3): `list` / `call` 모두 한 줄 JSON + 종료 코드 0, 던지면 `ok: false`.
 *  `project_create`는 임시 `TICKET_LOCAL`과 빈 임시 git 저장소로 진짜 `cli.ts`를 자식 프로세스로 돌린다.
 *  crontab은 PATH 앞에 가짜 `crontab`을 둬서 막는다(진짜 사용자 crontab은 안 건드린다). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");

function sandbox() {
  const base = mkdtempSync(path.join(tmpdir(), "ops-test-"));
  const bin = path.join(base, "bin");
  const local = path.join(base, "local");
  const repo = path.join(base, "repo");
  spawnSync("mkdir", ["-p", bin, local, repo]);
  // 가짜 crontab: 표를 파일 하나에 저장한다(-l은 읽고, - 는 stdin으로 덮는다). 등록 뒤 다시 읽어 확인하기 때문이다.
  const tab = path.join(base, "tab");
  writeFileSync(path.join(bin, "crontab"), `#!/bin/sh\nif [ "$1" = "-l" ]; then [ -f "${tab}" ] && cat "${tab}" || { echo "no crontab for x" >&2; exit 1; }; else cat > "${tab}"; fi\n`);
  chmodSync(path.join(bin, "crontab"), 0o755);
  // 가짜 python3: dira_apm.py(패키지를 네트워크로 받는다)만 건너뛰고 나머지는 진짜로 넘긴다.
  const realPy = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(path.join(bin, "python3"), `#!/bin/sh\ncase "$1" in */dira_apm.py) exit 0;; esac\nexec ${realPy} "$@"\n`);
  chmodSync(path.join(bin, "python3"), 0o755);
  spawnSync("git", ["init", "-q", repo]);
  // HOME도 가른다: 새 프로젝트가 스킬을 ~/.claude에 설치하므로 진짜 홈을 건드리면 안 된다.
  const home = path.join(base, "home");
  spawnSync("mkdir", ["-p", home]);
  // 스킬 받기는 네트워크를 탄다(타임아웃 30초 x 여럿) - 자식의 fetch를 즉시 거절시켜 실패로 센다.
  const nofetch = path.join(base, "nofetch.mjs");
  writeFileSync(nofetch, 'globalThis.fetch = () => Promise.reject(new Error("offline (test)"));\n');
  const env = { ...process.env, NODE_OPTIONS: `--import ${nofetch}`, HOME: home, TICKET_LOCAL: local, PATH: `${bin}:${process.env.PATH}`, DIRA_ANALYTICS: "0" };
  const run = (args: string[], input = "") => {
    const r = spawnSync("node", [CLI, ...args], { env, input, encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, `종료 코드 0이어야 한다: ${r.stderr}`);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 1, `표준 출력은 한 줄이다: ${r.stdout}`);
    return JSON.parse(lines[0]);
  };
  return { local, repo, run };
}

test("list - project_create가 들어 있다", () => {
  const { run } = sandbox();
  const r = run(["list"]);
  assert.equal(r.ok, true);
  assert.ok(r.result.some((o: { name: string }) => o.name === "project_create"));
});

test("모르는 op와 던지는 op는 ok:false + 종료 코드 0", () => {
  const { run } = sandbox();
  const unknown = run(["call", "no_such_op"], "{}");
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown op/);
  // project_create에 path가 없으면 인자 검사가 던진다.
  const thrown = run(["call", "project_create"], "{}");
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /path is required/);
  assert.equal(run(["call", "project_create"], "not json").ok, false);
});

test("project_create - 임시 저장소에 큐를 만들고 gui-projects.json에 항목이 생긴다", () => {
  const { local, repo, run } = sandbox();
  const r = run(["call", "project_create"], JSON.stringify({ path: repo, name: "t", branch: "dev" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.error, undefined, JSON.stringify(r.result));
  assert.ok(r.result.created, JSON.stringify(r.result));
  assert.equal(r.result.created.cron, true);
  const reg = JSON.parse(readFileSync(path.join(local, "gui-projects.json"), "utf8"));
  const list = Array.isArray(reg) ? reg : (reg.projects ?? reg.tenants);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "t");
  // 같은 경로로 다시 만들면 아무것도 안 만들고 exists로 답한다.
  const again = run(["call", "project_create"], JSON.stringify({ path: repo, name: "t2", branch: "dev" }));
  assert.equal(again.ok, true);
  assert.ok(again.result.exists);
});
