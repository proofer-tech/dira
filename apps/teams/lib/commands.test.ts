import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCommand, deleteCommand, listCommands, parseCommand, renderCommand, updateCommand,
  type CommandSpec,
} from "./commands.ts";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-")), ".dira", "commands");

test("왕복 - 쓰고 읽으면 같은 값이고 0755다", async () => {
  const dir = tmp();
  const spec: CommandSpec = {
    name: "빌드", env: ["A", "B_2"], schedule: "*/5 * * * *",
    steps: [{ kind: "shell", body: "echo a\necho b" }, { kind: "prompt", body: "요약해 줘\n\n두 줄" }],
  };
  const id = await createCommand(dir, spec);
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.equal(fs.statSync(path.join(dir, `${id}.sh`)).mode & 0o777, 0o755);
  const [e] = await listCommands(dir);
  assert.ok(e && e.editable);
  assert.deepEqual(e.editable && e.spec, spec);
  assert.equal(parseCommand(renderCommand(spec))!.extra, "");
});

test("shell 두 단계는 차례로 돌고 첫 단계가 실패하면 둘째는 안 돈다", async () => {
  const dir = tmp();
  const out = path.join(path.dirname(dir), "out.txt");
  const ok = await createCommand(dir, { name: "ok", env: [], steps: [
    { kind: "shell", body: `echo 1 >> ${out}` }, { kind: "shell", body: `echo 2 >> ${out}` }] });
  execFileSync("bash", [path.join(dir, `${ok}.sh`)]);
  assert.equal(fs.readFileSync(out, "utf8"), "1\n2\n");
  fs.rmSync(out);
  const bad = await createCommand(dir, { name: "bad", env: [], steps: [
    { kind: "shell", body: "false" }, { kind: "shell", body: `echo 2 >> ${out}` }] });
  assert.notEqual(spawnSync("bash", [path.join(dir, `${bad}.sh`)]).status, 0);
  assert.equal(fs.existsSync(out), false);
});

test("prompt 단계는 claude -p heredoc이고 구분자가 본문에 있어도 bash -n이 통과한다", async () => {
  const dir = tmp();
  const body = "a\nDIRA_PROMPT\nDIRA_PROMPT1\n$(rm -rf /) `x`";
  const spec: CommandSpec = { name: "p", env: [], steps: [{ kind: "prompt", body }] };
  const text = renderCommand(spec);
  assert.match(text, /claude -p "\$\(cat <<'DIRA_PROMPT2'/);
  const id = await createCommand(dir, spec);
  const f = path.join(dir, `${id}.sh`);
  assert.equal(spawnSync("bash", ["-n", f]).status, 0);
  const [e] = await listCommands(dir);
  assert.equal(e!.editable && e!.spec.steps[0]!.body, body);
  // 실제 실행에서 본문이 그대로 인자로 간다
  const bin = path.join(path.dirname(dir), "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), '#!/bin/sh\nprintf %s "$2" > "$(dirname "$0")/arg"\n', { mode: 0o755 });
  execFileSync("bash", [f], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(fs.readFileSync(path.join(bin, "arg"), "utf8"), body);
});

test("머리 없는 .sh는 편집 불가고 손편집 줄은 다시 저장해도 남는다", async () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "deadbeef.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "notanid.sh"), "x");
  let list = await listCommands(dir);
  assert.deepEqual(list, [{ id: "deadbeef", editable: false }]);
  await assert.rejects(updateCommand(dir, "deadbeef", { name: "x", env: [], steps: [{ kind: "shell", body: "x" }] }));

  const id = await createCommand(dir, { name: "n", env: [], steps: [{ kind: "shell", body: "echo a" }] });
  const f = path.join(dir, `${id}.sh`);
  let t = fs.readFileSync(f, "utf8");
  t = t.replace('cd "$(dirname "$0")/../.."\n', 'cd "$(dirname "$0")/../.."\nexport FOO=1\n').replace("echo a\n", "echo a\nls -l # 손\n");
  fs.writeFileSync(f, t);
  await updateCommand(dir, id, { name: "n2", env: ["X"], steps: [{ kind: "shell", body: "echo a\nls -l # 손" }, { kind: "shell", body: "echo c" }] });
  const after = fs.readFileSync(f, "utf8");
  assert.match(after, /^export FOO=1$/m);
  assert.match(after, /^ls -l # 손$/m);
  assert.match(after, /^# name: n2$/m);
  assert.equal(fs.statSync(f).mode & 0o777, 0o755);
  list = await listCommands(dir);
  assert.equal(list.length, 2);
});

test("삭제는 .sh와 .log를 지우고 id 검증과 잘못된 입력을 거부한다", async () => {
  const dir = tmp();
  const id = await createCommand(dir, { name: "n", env: [], steps: [{ kind: "shell", body: "true" }] });
  fs.writeFileSync(path.join(dir, `${id}.log`), "x");
  await deleteCommand(dir, id);
  assert.deepEqual(fs.readdirSync(dir), []);
  for (const bad of ["../etc", "ABCDEF12", "abc", "deadbeef/x", ""]) await assert.rejects(deleteCommand(dir, bad), bad);
  await assert.rejects(createCommand(dir, { name: "", env: [], steps: [{ kind: "shell", body: "x" }] }));
  await assert.rejects(createCommand(dir, { name: "n", env: ["a b"], steps: [{ kind: "shell", body: "x" }] }));
  await assert.rejects(createCommand(dir, { name: "n", env: [], steps: [] }));
  await assert.rejects(createCommand(dir, { name: "n", env: [], steps: [{ kind: "shell", body: "# step: prompt" }] }));
});
