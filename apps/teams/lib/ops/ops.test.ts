/** 실행기 계약(P559-1 결정 3): `list` / `call` 모두 한 줄 JSON + 종료 코드 0, 던지면 `ok: false`.
 *  `project_create`는 임시 `TICKET_LOCAL`과 빈 임시 git 저장소로 진짜 `cli.ts`를 자식 프로세스로 돌린다.
 *  crontab은 PATH 앞에 가짜 `crontab`을 둬서 막는다(진짜 사용자 crontab은 안 건드린다). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  return { local, repo, run, tab };
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

/** P559-6: 같은 큐 상태에 op와 서버 액션 본체(lib/ops/persona.ts)를 따로 돌려 파일 상태가 같은지 본다. */
test("persona - squad - trash op 순서가 성공하고 서버 액션 본체와 같은 파일 상태를 남긴다", () => {
  const base = mkdtempSync(path.join(tmpdir(), "ops-persona-"));
  const home = path.join(base, "home");
  const local = path.join(base, "local");
  const mk = (n: string) => {
    const root = path.join(base, n, ".dira");
    mkdirSync(path.join(root, "personas"), { recursive: true });
    mkdirSync(path.join(root, "squads"), { recursive: true });
    return root;
  };
  const rootA = mk("a"); // op로 돌린다
  const rootB = mk("b"); // 본체 함수로 돌린다
  mkdirSync(home, { recursive: true });
  mkdirSync(local, { recursive: true });
  writeFileSync(
    path.join(local, "gui-projects.json"),
    JSON.stringify({ projects: [{ id: "a", name: "a", root: rootA }, { id: "b", name: "b", root: rootB }] }),
  );
  const env = { ...process.env, HOME: home, TICKET_LOCAL: local, DIRA_ANALYTICS: "0" };
  const call = (name: string, input: object) => {
    const r = spawnSync("node", [CLI, "call", name], { env, input: JSON.stringify(input), encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const steps: [string, object][] = [
    ["persona_create", { name: "dev" }],
    ["persona_color_set", { name: "dev", color: "blue" }],
    ["persona_skills_set", { name: "dev", picked: [] }],
    ["squad_create", { name: "crew" }],
    ["squad_members_set", { name: "crew", members: [{ name: "dev", role: "lead" }] }],
    ["persona_delete", { name: "dev" }],
  ];
  const viaOp = steps.map(([n, a]) => call(n, { id: "a", ...a }));
  for (const r of viaOp) {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.ok, true, JSON.stringify(r));
  }
  // 지운 페르소나가 휴지통에 보이고 되살려진다.
  const trash = call("trash_list", { id: "a" });
  assert.equal(trash.result.length, 1, JSON.stringify(trash));
  assert.equal(trash.result[0].name, "dev");
  const entry = trash.result[0].entry;
  const restored = call("trash_restore", { id: "a", kind: "persona", entry });
  assert.equal(restored.result.ok, true, JSON.stringify(restored));
  assert.ok(existsSync(path.join(rootA, "personas", "dev")), "되살린 페르소나 디렉터리");
  const del = call("squad_delete", { id: "a", name: "crew" });
  assert.equal(del.result.ok, true);
  // 같은 순서를 본체 함수로 돌려 B에 만들고 두 큐의 파일 목록을 견준다(휴지통 항목 이름의 시각 조각은 뺀다).
  const script = `
    import * as p from ${JSON.stringify(path.join(path.dirname(CLI), "persona.ts"))};
    await p.personaCreate("b","dev"); await p.personaColorSet("b","dev","blue"); await p.personaSkillsSet("b","dev",[]);
    await p.squadCreate("b","crew"); await p.squadMembersSet("b","crew",[{name:"dev",role:"lead"}]); await p.personaDelete("b","dev");
    const t = await p.trashList("b"); await p.trashRestore("b","persona",t[0].entry);
    await p.squadDelete("b","crew");`;
  const body = spawnSync("node", ["--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(body.status, 0, body.stderr);
  const tree = (r: string) =>
    spawnSync("sh", ["-c", `cd "${r}" && find personas squads -type f | grep -v '^\\.trash' | sed 's/@[0-9-]*/@T/' | sort`], { encoding: "utf8" }).stdout;
  assert.equal(tree(rootA), tree(rootB));
  const reg = JSON.parse(readFileSync(path.join(local, "gui-projects.json"), "utf8"));
  const colors = (id: string) => JSON.stringify((Array.isArray(reg) ? reg : reg.projects).find((x: { id: string }) => x.id === id)?.personaColors ?? null);
  assert.equal(colors("a"), colors("b"));
});

test("워커 op - w2 만들기 - 목록 - cron 빼기 - 지우기, 모르는 repair kind는 ok:false", () => {
  const { repo, run, tab } = sandbox();
  const made = run(["call", "project_create"], JSON.stringify({ path: repo, name: "t", branch: "dev" }));
  const root = made.result.created.root;
  const w2 = path.join(root, "workers", "w2.sh");
  const lines = () => readFileSync(tab, "utf8").split("\n").filter((l) => l.includes(w2) && !l.startsWith("#"));

  const c = run(["call", "worker_create"], JSON.stringify({ root, name: "w2" }));
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.result.ok, true, JSON.stringify(c.result));
  assert.equal(c.result.created.name, "w2");
  assert.equal(c.result.created.cron, true);
  assert.ok(existsSync(w2));
  assert.equal(lines().length, 2, readFileSync(tab, "utf8"));

  const list = run(["call", "worker_list"], JSON.stringify({ root }));
  const row = list.result.find((w: { name: string }) => w.name === "w2");
  assert.equal(row.cron, true);

  const u = run(["call", "cron_unregister"], JSON.stringify({ root, worker: "w2" }));
  assert.equal(u.result.ok, true, JSON.stringify(u));
  assert.equal(lines().length, 0);
  assert.equal(run(["call", "worker_list"], JSON.stringify({ root })).result.find((w: { name: string }) => w.name === "w2").cron, false);

  const d = run(["call", "worker_delete"], JSON.stringify({ root, name: "w2" }));
  assert.equal(d.result.ok, true, JSON.stringify(d));
  assert.equal(existsSync(w2), false);

  const bad = run(["call", "project_repair"], JSON.stringify({ root, kind: "no_such_kind" }));
  assert.equal(bad.ok, true);
  assert.equal(bad.result.ok, false);
});

test("P559-8 - 티켓 편집 - 온톨로지 쓰기 - 비상 정지 읽기", () => {
  const { repo, run } = sandbox();
  const made = run(["call", "project_create"], JSON.stringify({ path: repo, name: "t", branch: "dev" }));
  const root: string = made.result.created.root;
  const call = (name: string, input: Record<string, unknown>) => {
    const r = run(["call", name], JSON.stringify({ root, ...input }));
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.result;
  };
  const tfile = path.join(root, "tickets", "abcd1234.md");
  const body = "## Goal\n\n한 줄  \n\n- [ ] 항목\n";
  writeFileSync(tfile, `---\nticket: abcd1234\ntitle: t\nkind: work\npersona: developer\nfoo: 1\n---\n\n${body}`);
  const before = readFileSync(tfile, "utf8");
  const r1 = call("ticket_frontmatter_set", { hash: "abcd1234", key: "foo", value: "2" });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(readFileSync(tfile, "utf8"), before.replace("foo: 1", "foo: 2"), "fm 한 키만 바뀌고 나머지는 바이트 그대로다");
  assert.equal(call("ticket_frontmatter_set", { hash: "abcd1234", key: "title", value: "x" }).ok, false);
  assert.equal(call("ticket_frontmatter_set", { hash: "abcd1234", key: "session_id", value: "x" }).ok, false);
  assert.equal(call("ticket_epic_set", { hash: "abcd1234", epic: "E1" }).ok, true);
  assert.match(readFileSync(tfile, "utf8"), /^epic: E1$/m);
  writeFileSync(path.join(root, "tickets", "beef5678.wip.md"), "---\nticket: beef5678\ntitle: w\n---\n\nx\n");
  assert.equal(call("ticket_frontmatter_set", { hash: "beef5678", key: "foo", value: "1" }).ok, false);
  assert.equal(call("ticket_delete", { hash: "beef5678" }).ok, false);
  assert.equal(call("ticket_delete", { hash: "abcd1234" }).ok, true);
  assert.equal(existsSync(tfile), false);

  const created = call("ontology_create", { rel: "notes/a.md" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const renamed = call("ontology_rename", { from: "notes/a.md", to: "notes/b.md" });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  assert.equal(call("ontology_delete", { rel: "notes/b.md" }).ok, true);
  assert.equal(call("ontology_delete", { rel: "../x.md" }).ok, false, "루트 밖 경로는 거절한다");

  const es = call("emergency_stop_get", {});
  assert.equal(typeof es.on, "boolean");
  const names = run(["list"]).result.map((o: { name: string }) => o.name);
  assert.ok(!names.some((n: string) => /emergency_stop_(on|off|enable|disable|set)/.test(n)));
});

test("command - epic - protocol op가 임시 큐의 파일을 만들고 바꾸고 지운다(P559-7)", () => {
  const { repo, run } = sandbox();
  const made = run(["call", "project_create"], JSON.stringify({ path: repo, name: "t", branch: "dev" }));
  assert.ok(made.result.created, JSON.stringify(made));
  const root = made.result.created.root;
  const call = (name: string, input: object) => run(["call", name], JSON.stringify({ root, ...input }));
  const ok = (r: { ok: boolean; error?: string; result?: unknown }) => {
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.result as never;
  };

  // 커맨드
  const spec = { name: "n1", steps: [{ kind: "shell", body: "echo hi" }], env: [] };
  const { id } = ok(call("command_create", { spec })) as { id: string };
  assert.match(id, /^[0-9a-f]{8}$/);
  const file = path.join(root, "commands", `${id}.sh`);
  assert.equal(statSync(file).mode & 0o777, 0o755);
  const listed = ok(call("command_list", {})) as { id: string }[];
  assert.ok(listed.some((c) => c.id === id));
  ok(call("command_update", { command_id: id, spec: { ...spec, name: "n2" } }));
  assert.match(readFileSync(file, "utf8"), /n2/);
  assert.equal(call("command_update", { command_id: "../x", spec }).ok, false);
  ok(call("command_delete", { command_id: id }));
  assert.equal(existsSync(file), false);

  // 에픽
  ok(call("epic_create", { key: "P900", title: "제목" }));
  assert.equal(readFileSync(path.join(root, "epics", "P900", "README.md"), "utf8"), "제목\n");
  assert.equal(call("epic_create", { key: "P900", title: "again" }).ok, false);
  ok(call("epic_readme_save", { epic: "P900", title: "새 제목", body: "본문" }));
  assert.equal(readFileSync(path.join(root, "epics", "P900", "README.md"), "utf8"), "새 제목\n\n본문\n");
  assert.equal(call("epic_create", { key: "../../evil", title: "x" }).ok, false);

  // 프로토콜
  ok(call("protocol_create", { rel: "sub/GUIDE.md" }));
  ok(call("protocol_rename", { from: "sub/GUIDE.md", to: "sub/G2.md" }));
  ok(call("protocol_delete", { rel: "sub/G2.md" }));
  assert.equal(call("protocol_delete", { rel: "../../etc/passwd" }).ok, false);

  // 일정: 잘못된 when은 거절한다
  assert.equal(call("schedule_create", { when: "garbage", prompt: "p" }).ok, false);
});
