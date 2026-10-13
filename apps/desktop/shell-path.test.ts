/** `shell-path.ts` - 임시 HOME에서 설정 파일 덧붙이기를 확인한다. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installShellPath } from "./shell-path.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "shellpath-"));
const env = () => ({ PATH: "/usr/bin:/bin" }) as NodeJS.ProcessEnv;
const count = (s: string) => s.split(">>> dira >>>").length - 1;

test(".zshrc가 없으면 만들고 블록 하나, 두 번 불러도 하나다", async () => {
  const h = tmp();
  await installShellPath(h, "/bin/zsh", env());
  await installShellPath(h, "/bin/zsh", env());
  assert.equal(count(readFileSync(join(h, ".zshrc"), "utf8")), 1);
});

test("사람이 넣은 줄이 있으면 바이트가 그대로다", async () => {
  const h = tmp();
  const own = 'export PATH="$HOME/.config/dira/bin:$PATH"\n';
  writeFileSync(join(h, ".zshrc"), own);
  await installShellPath(h, "/bin/zsh", env());
  assert.equal(readFileSync(join(h, ".zshrc"), "utf8"), own);
});

test("끝에 개행이 없으면 기존 줄이 남고 블록이 새 줄에서 시작한다", async () => {
  const h = tmp();
  writeFileSync(join(h, ".bash_profile"), "alias a=b");
  await installShellPath(h, "/bin/bash", env());
  const s = readFileSync(join(h, ".bash_profile"), "utf8");
  assert.ok(s.startsWith("alias a=b\n# >>> dira >>>\n"));
});

test("fish면 아무 파일도 안 생기고 이번 기동 PATH에는 더한다", async () => {
  const h = tmp();
  const e = env();
  await installShellPath(h, "/usr/local/bin/fish", e);
  assert.deepEqual(readdirSync(h), []);
  assert.equal(e.PATH, `${h}/.config/dira/bin:/usr/bin:/bin`);
});

test("덧붙인 블록은 디렉터리가 있으면 PATH 맨 앞에 한 번, 없으면 안 넣는다", async () => {
  const h = tmp();
  await installShellPath(h, "/bin/zsh", env());
  const run = () =>
    execFileSync("zsh", ["-c", `source ${join(h, ".zshrc")}; source ${join(h, ".zshrc")}; echo $PATH`], {
      env: { HOME: h, PATH: "/usr/bin:/bin" },
    }).toString().trim();
  assert.equal(run(), "/usr/bin:/bin");
  mkdirSync(join(h, ".config/dira/bin"), { recursive: true });
  assert.equal(run(), `${h}/.config/dira/bin:/usr/bin:/bin`);
  assert.ok(existsSync(join(h, ".zshrc")));
});

test("첫 기동: installShellPath 뒤에 띄운 자식 PATH에 .config/dira/bin이 있다", async () => {
  const h = tmp();
  const e = env();
  await installShellPath(h, "/bin/zsh", e); // main.ts가 process.env로 하는 일과 같다
  const out = execFileSync("/bin/sh", ["-c", "echo $PATH"], { env: { ...e } }).toString().trim();
  assert.ok(out.split(":").includes(`${h}/.config/dira/bin`));
});

test("main.ts boot()는 installShellPath를 startServer보다 먼저 부른다", () => {
  const boot = readFileSync(new URL("./main.ts", import.meta.url), "utf8").split("async function boot()")[1];
  const i = boot.indexOf("await installShellPath(");
  assert.ok(i >= 0 && i < boot.indexOf("child = startServer("));
});
