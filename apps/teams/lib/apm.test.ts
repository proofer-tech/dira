import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyToLocal, overlayPersonas, resolveHome } from "./apm.ts";
import { savePersona } from "./projects.ts";

const w = (p: string, text: string) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};

// dira_apm.py는 이 저장소 것을, apm CLI는 아무것도 안 하는 가짜를 쓴다.
process.env.DIRA_ENGINE = path.resolve(import.meta.dirname, "../../..");
const fake = path.join(mkdtempSync(path.join(tmpdir(), "apm-bin-")), "apm");
w(fake, "#!/bin/sh\nexit 0\n");
chmodSync(fake, 0o755);
process.env.DIRA_APM_BIN = fake;

function project(withTeam = true) {
  const repo = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), "apm-"))), "proj");
  const queue = path.join(repo, ".dira");
  mkdirSync(path.join(queue, "personas"), { recursive: true });
  if (withTeam) {
    w(
      path.join(repo, "dira-team/apm.yml"),
      "name: team\nversion: 1.0.0\ndependencies:\n  apm:\n    - ./personas/dev\n    - o/r/persona-pm#v1\n",
    );
    w(path.join(repo, "dira-team/personas/dev/apm.yml"), "name: persona-dev\nversion: 1.0.0\n");
    w(path.join(repo, "dira-team/personas/dev/PROFILE.md"), "# dev\n");
    w(path.join(repo, "dira-team/apm_modules/o/r/persona-pm/apm.yml"), "name: persona-pm\nversion: 1.0.0\n");
    w(path.join(repo, "dira-team/apm_modules/o/r/persona-pm/PROFILE.md"), "# pm\n");
  }
  return { repo, queue };
}

test("dira-team의 로컬 페르소나는 그 자리에 쓰고 .dira에는 안 만든다", async () => {
  const { repo, queue } = project();
  const home = await resolveHome(queue, "persona", "dev", path.join(queue, "personas"));
  assert.equal(home.shared, false);
  await savePersona(home.base, home.name, "# dev2\n");
  assert.equal(readFileSync(path.join(repo, "dira-team/personas/dev/PROFILE.md"), "utf8"), "# dev2\n");
  assert.equal(existsSync(path.join(queue, "personas/dev/PROFILE.md")), false);
});

test("공용 패키지는 shared, 로컬로 복사하면 apm.yml이 바뀌고 쓸 수 있다", async () => {
  const { repo, queue } = project();
  const base = path.join(queue, "personas");
  assert.equal((await resolveHome(queue, "persona", "pm", base)).shared, true);
  const { personas } = await overlayPersonas(queue, base, [], []);
  assert.deepEqual(personas.map((p) => [p.name, p.shared, p.body]), [["dev", false, "# dev\n"], ["pm", true, "# pm\n"]]);
  await copyToLocal(queue, "persona", "pm");
  const yml = readFileSync(path.join(repo, "dira-team/apm.yml"), "utf8");
  assert.match(yml, /- \.\/personas\/pm\n/);
  assert.doesNotMatch(yml, /persona-pm#v1/);
  const home = await resolveHome(queue, "persona", "pm", base);
  assert.equal(home.shared, false);
  await savePersona(home.base, home.name, "# pm2\n");
  assert.equal(readFileSync(path.join(repo, "dira-team/personas/pm/PROFILE.md"), "utf8"), "# pm2\n");
  await assert.rejects(copyToLocal(queue, "persona", "pm"));
});

test("dira-team이 없으면 지금 위치를 그대로 쓴다", async () => {
  const { queue } = project(false);
  const base = path.join(queue, "personas");
  assert.deepEqual(await resolveHome(queue, "persona", "dev", base), { base, name: "dev", shared: false });
});
