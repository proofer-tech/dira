import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// 진짜 락 디렉터리를 밟지 않는다(`kick.test.ts`·`workers.test.ts`와 같은 이유).
const LOCAL = mkdtempSync(path.join(tmpdir(), "dispatch-local-"));
process.env.TICKET_LOCAL = LOCAL;

const { dispatchToWip } = await import("./dispatch.ts");
const { lockPath } = await import("./workers.ts");

const tmps: string[] = [LOCAL];
process.on("exit", () => tmps.forEach((p) => rmSync(p, { recursive: true, force: true })));

/** `crontab -l`을 가로챈다 (`kick.test.ts`의 같은 수법). */
function withFakeCrontab(text: string): () => void {
  const bin = mkdtempSync(path.join(tmpdir(), "dispatch-bin-"));
  tmps.push(bin);
  const out = path.join(bin, "out.txt");
  writeFileSync(out, text);
  writeFileSync(path.join(bin, "crontab"), `#!/bin/sh\ncat ${JSON.stringify(out)}\n`, {
    mode: 0o755,
  });
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return () => {
    process.env.PATH = prev;
  };
}

/** tick.sh와 같은 모양의 락. */
function putLock(dir: string, name: string, pid: number) {
  const lock = lockPath(dir, name);
  mkdirSync(lock, { recursive: true });
  writeFileSync(path.join(lock, "pid"), String(pid));
}

function scratch(): { root: string; dir: string; ran: string } {
  const root = mkdtempSync(path.join(tmpdir(), "dispatch-root-"));
  tmps.push(root);
  const dir = path.join(root, "workers");
  mkdirSync(dir, { recursive: true });
  return { root, dir, ran: path.join(root, "ran.txt") };
}

/** 지목 kick 스텁 — 자기 이름 + args를 `ran.txt`에 적는다(엔진 명령이 아직 없어도 `kick.test.ts`
 *  처럼 스텁으로 착수한다). */
function writeKickStub(dir: string, name: string, ran: string) {
  writeFileSync(
    path.join(dir, `${name}.sh`),
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(ran)}\n`,
    { mode: 0o755 },
  );
}

/** preempt 스텁 — `--dryrun`이면 `dryrunOut`을, 아니면 `realOut`을 낸다. `code`가 0이 아니면
 *  그 종료 코드로 나간다(`engine.ts runWorker`가 실패로 판정하는 경로). */
function writePreemptStub(
  dir: string,
  name: string,
  opts: { dryrunOut?: string; dryrunCode?: number; realOut?: string; realCode?: number },
) {
  const dryrunOut = opts.dryrunOut ?? "";
  const realOut = opts.realOut ?? "선점: victim1234";
  const dryrunCode = opts.dryrunCode ?? 0;
  const realCode = opts.realCode ?? 0;
  writeFileSync(
    path.join(dir, `${name}.sh`),
    `#!/bin/sh
if [ "$3" = "--dryrun" ]; then
  printf '%s' ${JSON.stringify(dryrunOut)}
  exit ${dryrunCode}
else
  printf '%s' ${JSON.stringify(realOut)}
  exit ${realCode}
fi
`,
    { mode: 0o755 },
  );
}

async function waitFor(file: string, ms = 3000): Promise<string> {
  for (let i = 0; i < ms / 20 && !existsSync(file); i++) await sleep(20);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

test("dispatchToWip — idle 워커가 있으면 지목 kick으로 끝난다(갈래 B)", async () => {
  const { root, dir, ran } = scratch();
  putLock(dir, "w1", process.pid); // running — 후보 아님
  writeKickStub(dir, "w2", ran); // idle
  const restore = withFakeCrontab(`* * * * * "${path.join(dir, "w2.sh")}" >> /dev/null 2>&1\n`);
  try {
    const r = await dispatchToWip(root, "abcd1234", false);
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(await waitFor(ran), "tick abcd1234");
  } finally {
    restore();
  }
});

test("dispatchToWip — idle이 없으면 dryrun으로 피해자를 물어 확인을 돌려준다(갈래 C 1단계)", async () => {
  const { root, dir } = scratch();
  putLock(dir, "w1", process.pid); // 유일한 워커가 running = idle 0개
  writePreemptStub(dir, "w1", { dryrunOut: "victim9999 - 제목 - w1" });
  const restore = withFakeCrontab(""); // w1은 크론에도 없다(그래도 락이 있어 running)
  try {
    const r = await dispatchToWip(root, "abcd1234", false);
    assert.deepStrictEqual(r, { ok: false, reason: "confirm", victim: "victim9999 - 제목 - w1" });
  } finally {
    restore();
  }
});

test("dispatchToWip — 피해자가 없으면 이유를 담아 실패한다", async () => {
  const { root, dir } = scratch();
  putLock(dir, "w1", process.pid);
  writePreemptStub(dir, "w1", { dryrunOut: "", dryrunCode: 1 });
  const restore = withFakeCrontab("");
  try {
    const r = await dispatchToWip(root, "abcd1234", false);
    assert.strictEqual(r.ok, false);
    assert.strictEqual((r as { reason: string }).reason, "other");
  } finally {
    restore();
  }
});

test("dispatchToWip — 확인 뒤(confirmed)에는 dryrun 없이 진짜로 선점한다(갈래 C 2단계)", async () => {
  const { root, dir } = scratch();
  putLock(dir, "w1", process.pid);
  writePreemptStub(dir, "w1", { realOut: "선점: victim9999" });
  const restore = withFakeCrontab("");
  try {
    const r = await dispatchToWip(root, "abcd1234", true);
    assert.deepStrictEqual(r, { ok: true });
  } finally {
    restore();
  }
});

test("dispatchToWip — 확인 뒤 선점이 실패하면 이유를 돌려준다", async () => {
  const { root, dir } = scratch();
  putLock(dir, "w1", process.pid);
  writePreemptStub(dir, "w1", { realCode: 1, realOut: "유효 5는 안 끊는다" });
  const restore = withFakeCrontab("");
  try {
    const r = await dispatchToWip(root, "abcd1234", true);
    assert.strictEqual(r.ok, false);
    assert.strictEqual((r as { reason: string }).reason, "other");
  } finally {
    restore();
  }
});
