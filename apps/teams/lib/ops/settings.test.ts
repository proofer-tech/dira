/** P559-4 op: 온톨로지 자리 - 컨텍스트 - project_settings_set. 실행기(`cli.ts`)를 자식 프로세스로 돌린다.
 *  임시 큐(`.dira`)를 손으로 만들고 레지스트리에 한 줄 적는다. crontab은 가짜(상태 없는 빈 표)로 막고 슬림 실행은
 *  PATH의 가짜 python3가 받는다. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");

function sandbox() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ops-settings-")));
  const bin = path.join(base, "bin");
  const local = path.join(base, "local");
  const root = path.join(base, "repo", ".dira");
  const onto = path.join(base, "onto");
  for (const d of [bin, local, path.join(root, "workers"), onto]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(bin, "crontab"), '#!/bin/sh\nif [ "$1" = "-l" ]; then exit 1; fi\ncat >/dev/null\n');
  // 슬림은 엔진 slim.py가 하는 일이다 - 여기서는 값 파일만 본다.
  writeFileSync(path.join(bin, "python3"), `#!/bin/sh\ncase "$1" in */slim.py) echo '{}'; exit 0;; esac\nexec ${spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim()} "$@"\n`);
  chmodSync(path.join(bin, "crontab"), 0o755);
  chmodSync(path.join(bin, "python3"), 0o755);
  const w = (name: string) =>
    writeFileSync(
      path.join(root, "workers", `${name}.sh`),
      `#!/bin/bash\nTICKET_NAME=${name}\nTICKET_CONTEXT=(\n  "a.md|first"\n)\n. "/nonexistent/tick.sh"\n`,
      { mode: 0o755 },
    );
  w("w1");
  w("w2");
  writeFileSync(
    path.join(local, "gui-projects.json"),
    JSON.stringify({ projects: [{ id: "p", name: "p", root }] }),
  );
  const env = { ...process.env, TICKET_LOCAL: local, PATH: `${bin}:${process.env.PATH}`, HOME: base };
  const call = (name: string, input: object) => {
    const r = spawnSync("node", [CLI, "call", name], { env, input: JSON.stringify(input), encoding: "utf8", timeout: 100_000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  return { root, onto, call, read: (rel: string) => readFileSync(path.join(root, rel), "utf8") };
}

test("project_ontology_set - 모든 워커 TICKET_ONTOLOGY가 그 폴더, 없는 경로는 ok:false", () => {
  const { root, onto, call, read } = sandbox();
  const ok = call("project_ontology_set", { root, path: onto });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.match(read("workers/w1.sh"), new RegExp(`TICKET_ONTOLOGY="?${onto}"?`));
  assert.match(read("workers/w2.sh"), new RegExp(`TICKET_ONTOLOGY="?${onto}"?`));
  assert.equal(call("project_ontology_get", { root }).result.value, onto);
  const bad = call("project_ontology_set", { root, path: path.join(onto, "nope") });
  assert.equal(bad.ok, false);
  // 거절되면 파일은 그대로다
  assert.match(read("workers/w1.sh"), new RegExp(`TICKET_ONTOLOGY="?${onto}"?`));
});

test("project_context_set - worker 없으면 context.sh, worker면 그 워커 블록, get이 돌려준다", () => {
  const { root, call, read } = sandbox();
  const common = call("project_context_set", { root, items: [{ path: "/tmp", desc: "공통" }] });
  assert.equal(common.ok, true, JSON.stringify(common));
  assert.match(read("context.sh"), /TICKET_CONTEXT_COMMON/);
  assert.match(read("context.sh"), /\/tmp\|공통/);
  const w1 = call("project_context_set", { root, worker: "w1", items: [{ path: "b.md", desc: "second" }] });
  assert.equal(w1.ok, true, JSON.stringify(w1));
  assert.match(read("workers/w1.sh"), /b\.md\|second/);
  assert.doesNotMatch(read("workers/w1.sh"), /a\.md/);
  assert.match(read("workers/w2.sh"), /a\.md\|first/); // 다른 워커는 그대로
  const got = call("project_context_get", { root }).result;
  assert.deepEqual(got.common.items.map((i: { path: string }) => i.path), ["/tmp"]);
  const g1 = got.workers.find((x: { name: string }) => x.name === "w1");
  assert.deepEqual(g1.context.items.map((i: { path: string }) => i.path), ["b.md"]);
  // 복사: w1 -> w2
  assert.equal(call("project_context_copy", { root, from: "w1", to: "w2" }).ok, true);
  assert.match(read("workers/w2.sh"), /b\.md\|second/);
});

test("project_settings_set - integration_branch 파일과 changed, slim은 on", () => {
  const { root, call, read } = sandbox();
  const r = call("project_settings_set", { root, integration_branch: "main" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(read("integration-branch").trim(), "main");
  assert.ok(Array.isArray(r.result.integration_branch.changed));
  assert.equal(r.result.integration_branch.branch, "main");
  const s = call("project_settings_set", { root, slim: true });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(read("slim-checkout").trim(), "on");
  assert.equal(call("project_settings_set", { root, integration_branch: "bad branch" }).ok, false);
});
