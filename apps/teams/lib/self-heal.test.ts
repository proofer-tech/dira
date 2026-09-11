import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// 진짜 락 디렉터리를 안 밟는다(kick.test.ts와 같은 수법 — import 전에 건다).
const LOCAL = mkdtempSync(path.join(tmpdir(), "self-heal-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { selfHeal } = await import("./self-heal.ts");
const { lockPath } = await import("./workers.ts");

const tmps: string[] = [LOCAL];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** `crontab -l`을 가로챈다(kick.test.ts와 같은 이유 — 이 머신의 실제 등록 상태에 안 흔들린다). */
function withFakeCrontab(text: string): () => void {
  const bin = mkdtempSync(path.join(tmpdir(), "self-heal-bin-"));
  tmps.push(bin);
  const out = path.join(bin, "out.txt");
  writeFileSync(out, text);
  writeFileSync(path.join(bin, "crontab"), `#!/bin/sh\ncat ${JSON.stringify(out)}\n`, { mode: 0o755 });
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return () => {
    process.env.PATH = prev;
  };
}

function putLock(dir: string, name: string, pid: number) {
  const lock = lockPath(dir, name);
  mkdirSync(lock, { recursive: true });
  writeFileSync(path.join(lock, "pid"), String(pid));
}
void putLock; // 이 파일은 idle 하나짜리 픽스처만 쓴다 — running/stopped 판정은 kick.test.ts가 이미 검다

/** 큐 픽스처 — 워커 하나(`w1`, cron에 있어 idle)와 빈 `tickets/`. */
function fixture(): { root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "self-heal-root-"));
  tmps.push(root);
  mkdirSync(path.join(root, "workers"), { recursive: true });
  mkdirSync(path.join(root, "tickets"), { recursive: true });
  const ran = path.join(root, "ran.txt");
  writeFileSync(path.join(root, "workers", "w1.sh"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(ran)}\n`, {
    mode: 0o755,
  });
  return { root };
}

/** PATH에 놓는 가짜 `claude`. `body`가 프롬프트(마지막 argv — home-session.ts 머리 주석과 같은
 *  variadic 함정 회피 규칙)를 받아 결정한다 — 그 문자열 안에서 `<root>/tickets/<8-hex>.md` 경로를
 *  찾으면(제품 결함 갈래를 흉내내는 테스트에서만) 그 파일을 만들어 둔다. */
function fakeClaude(root: string, opts: { ok: boolean; fileTicket: boolean }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "self-heal-bin2-"));
  tmps.push(dir);
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = opts.ok
    ? `last="\${@: -1}"
if ${opts.fileTicket ? "true" : "false"}; then
  hit=$(echo "$last" | grep -oE "${escapedRoot}/tickets/[0-9a-f]{8}\\.md" | head -1)
  if [ -n "$hit" ]; then
    mkdir -p "$(dirname "$hit")"
    printf -- '---\\nticket: x\\nkind: work\\npersona: developer\\n---\\n\\nerror\\n' > "$hit"
  fi
fi
echo '{"type":"result","is_error":false,"result":"ok"}'`
    : `exit 1`;
  writeFileSync(path.join(dir, "claude"), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return dir;
}

async function waitFor(file: string, ms = 3000): Promise<string> {
  for (let i = 0; i < ms / 20 && !existsSync(file); i++) await sleep(20);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

test("selfHeal — claude 바이너리가 없으면 재시도 없이 noop이다(결정 5)", async () => {
  const { root } = fixture();
  const prevPath = process.env.PATH;
  process.env.PATH = ""; // execClaude()가 아무것도 못 찾는다
  try {
    const outcome = await selfHeal({ error: "git pull 실패", surface: "test", cwd: root, project: { root } });
    assert.strictEqual(outcome, "noop");
  } finally {
    process.env.PATH = prevPath;
  }
});

test("selfHeal — 에이전트가 실패하면(rc!=0) noop이고 티켓이 안 생긴다", async () => {
  const { root } = fixture();
  const prevPath = process.env.PATH;
  process.env.PATH = `${fakeClaude(root, { ok: false, fileTicket: false })}:${prevPath}`;
  try {
    const outcome = await selfHeal({ error: "git pull 실패", surface: "test", cwd: root, project: { root } });
    assert.strictEqual(outcome, "noop");
    assert.deepStrictEqual(readdirSync(path.join(root, "tickets")), []);
  } finally {
    process.env.PATH = prevPath;
  }
});

test("selfHeal — 사용자 환경 갈래(티켓 없음)면 attempted다", async () => {
  const { root } = fixture();
  const prevPath = process.env.PATH;
  process.env.PATH = `${fakeClaude(root, { ok: true, fileTicket: false })}:${prevPath}`;
  try {
    const outcome = await selfHeal({ error: "git pull 실패", surface: "test", cwd: root, project: { root } });
    assert.strictEqual(outcome, "attempted");
    assert.deepStrictEqual(readdirSync(path.join(root, "tickets")), []);
  } finally {
    process.env.PATH = prevPath;
  }
});

test("selfHeal — 제품 결함 갈래는 ticketed다: 티켓이 남고 idle 워커가 그 해시로 디스패치된다", async () => {
  const { root } = fixture();
  const restoreCron = withFakeCrontab(`* * * * * "${path.join(root, "workers", "w1.sh")}" >> /dev/null 2>&1\n`);
  const prevPath = process.env.PATH;
  process.env.PATH = `${fakeClaude(root, { ok: true, fileTicket: true })}:${prevPath}`;
  try {
    const outcome = await selfHeal({ error: "git pull 실패", surface: "test", cwd: root, project: { root } });
    assert.strictEqual(outcome, "ticketed");
    const files = readdirSync(path.join(root, "tickets"));
    assert.strictEqual(files.length, 1);
    const body = readFileSync(path.join(root, "tickets", files[0]), "utf8");
    assert.ok(!/^req:/m.test(body), "req: 필드가 없어야 한다");
    assert.match(body, /kind: work/);
    // kickTicket이 idle 워커를 그 해시로 지목 디스패치했다(w1.sh의 스텁이 argv를 그대로 남긴다)
    const hash = files[0].replace(/\.md$/, "");
    assert.strictEqual(await waitFor(path.join(root, "ran.txt")), `tick ${hash}`);
  } finally {
    process.env.PATH = prevPath;
    restoreCron();
  }
});
