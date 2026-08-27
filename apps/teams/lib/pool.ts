/** 공통 워커 풀 (DESIGN.md §4-16 결정 2·3·4). **화면은 여기 없다** — 이 모듈이 내는 것은 큐 밖의
 *  풀 디스패처 한 장(`${TICKET_LOCAL}/pool/<이름>.sh`)과, 프로젝트별 shim 워커·`pool-limit` 파일을
 *  다루는 함수들뿐이다. 엔진은 한 줄도 안 갈린다 — 이 파일도 `dispatch-gate.sh`·`self-heal.sh`와
 *  같은 층이다(GUI가 만들고 관리하는 사이드카, bash + python3 표준 라이브러리만 쓴다).
 *
 *  풀 디스패처는 워커 파일과 달리 **source되지 않는다** — cron 줄이 직접 부르는 진입점이고 어느
 *  프로젝트에도 속하지 않는다(큐 밖). 그래서 워커의 `TICKET_NAME`·`TICKET_CWD` 같은 개념이 없고,
 *  이름은 파일 stem(`$0`)에서 그때그때 읽는다. */
import { chmod, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NAME_RE, localDir } from "./paths.ts";
import { createWorker, deleteWorker } from "./workers.ts";

function validPoolName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`공통 워커 이름은 영문·숫자·_·- 만 됩니다: ${name || "(비어 있음)"}`);
  }
}

// ── 풀 디스패처 (`${TICKET_LOCAL}/pool/<이름>.sh`) ──────────────────────────

export function poolDir(): string {
  return path.join(localDir(), "pool");
}

/** 풀 디스패처의 전문(§4-16 결정 2 §"디스패처가 하는 일은 일곱 줄이다"). **파일 목록이 곧
 *  풀이다** — 워커마다 다른 값이 없으므로 이름별로 치환하는 자리가 없다(파일 stem을 `$0`에서
 *  그때그때 읽는다).
 *
 *  1~7단계 전부가 이 문자열 하나다:
 *  1) `pool-<이름>.lock`을 `mkdir`로 잡는다(엔진의 tick 잠금과 같은 원자적 관용구). 이미 있고
 *     주인 pid가 살아 있으면 한 줄만 남기고 끝낸다 — 죽은 잠금은 되찾는다(두 번째 mkdir 없이 그
 *     안의 `pid`만 다시 쓴다).
 *  2~6) 후보 선정(등록 프로젝트 읽기 → `pool-limit` 미만 거르기 → 자기 상한 도달 거르기 → 열린
 *     티켓 0장 거르기 → 라운드로빈)은 python3 한 토막으로 한다 — 상한·병행 카운트·정수 파싱을
 *     셸로 짜면 훨씬 길고 틀리기 쉽다. `gui-projects.json`·`run/pool-*.lock`·`<루트>/pool-limit`·
 *     `<루트>/tickets/*.md`만 읽고, 골랐으면 `id`와 `root` 두 줄을 낸다(없으면 아무것도 안 낸다).
 *  7) `project` 파일에 그 id를 적고 그 큐의 shim(`<루트>/workers/<이 이름>.sh`)을 `bash`로 돌린다
 *     (cron이 평범한 워커를 부르는 것과 같은 방식 — source가 아니다). 끝나면 트랩이 잠금을 지운다.
 *
 *  **`TICKET_NAME`을 안 준다** — shim의 파일 stem이 이미 이 공통 워커 이름이라 엔진이 그대로
 *  읽는다(tick.sh:37). 그래서 잠금·로그·`owner:`가 전부 이 이름으로 나온다. */
export const POOL_DISPATCHER_SH = `#!/bin/bash
# 공통 워커 풀 디스패처 (DESIGN.md §4-16 결정 2) — GUI가 만들고 관리한다. 손으로 고치지 않는다.
#
# cron 줄이 직접 부르는 진입점이다(워커 파일처럼 source되지 않는다) — 큐 밖에 있어서 어느
# 프로젝트에도 속하지 않는다. $0의 파일명(stem)이 곧 이 공통 워커의 이름이고, 매 tick마다 등록된
# 프로젝트 중 하나를 골라 그 큐의 shim 워커 파일(<루트>/workers/<이 이름>.sh)을 실행한다.
#
# 의존성은 dispatch-gate.sh와 같은 층이다: bash + python3 표준 라이브러리뿐이다(엔진 0줄).

set -u
_pool_name=$(basename "$0" .sh)
_pool_local="\${TICKET_LOCAL:-$HOME/.config/dira}"
_pool_run="$_pool_local/run"
_pool_lock="$_pool_run/pool-$_pool_name.lock"
mkdir -p "$_pool_run" 2>/dev/null

# 1) 슬롯 잠금 — mkdir이 원자적 획득이다. 이미 있고 주인 pid가 살아 있으면 한 줄만 남기고 끝낸다.
if ! mkdir "$_pool_lock" 2>/dev/null; then
  _pool_pid=$(cat "$_pool_lock/pid" 2>/dev/null)
  if [ -n "\${_pool_pid:-}" ] && kill -0 "$_pool_pid" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') SKIP $_pool_name — 슬롯이 이미 pid $_pool_pid에 잡혀 있다."
    exit 0
  fi
  # 죽은 잠금(주인이 없다) — 되찾는다. mkdir은 다시 안 친다(안이 이미 있는 디렉터리다).
fi
echo $$ > "$_pool_lock/pid"
trap 'rm -rf "$_pool_lock"' EXIT

# 2~6) 후보 선정. 골랐으면 1행 id · 2행 root를 낸다. 후보가 없으면 아무것도 안 낸다.
_pool_pick=$(TICKET_LOCAL="$_pool_local" POOL_LOCK_NAME="$_pool_name" python3 - <<'PY'
import os
import re

local = os.environ["TICKET_LOCAL"]
lock_name = os.environ["POOL_LOCK_NAME"]
run_dir = os.path.join(local, "run")
my_lock = f"pool-{lock_name}.lock"

import json
try:
    with open(os.path.join(local, "gui-projects.json"), encoding="utf-8") as f:
        registry = json.load(f)
except (OSError, ValueError):
    raise SystemExit(0)
projects = registry.get("projects") or registry.get("tenants") or []

INT_RE = re.compile(r"^\\d+\$")

def read_limit(root):
    try:
        text = open(os.path.join(root, "pool-limit"), encoding="utf-8").read().strip()
    except OSError:
        return 0
    return int(text) if INT_RE.match(text) else 0

def live_holders(project_id):
    n = 0
    entries = os.listdir(run_dir) if os.path.isdir(run_dir) else []
    for entry in entries:
        if not entry.startswith("pool-") or not entry.endswith(".lock") or entry == my_lock:
            continue
        lock_dir = os.path.join(run_dir, entry)
        try:
            pid = int(open(os.path.join(lock_dir, "pid")).read().strip())
            os.kill(pid, 0)
        except (OSError, ValueError):
            continue  # 죽었거나 못 읽는 잠금은 세지 않는다
        try:
            holding = open(os.path.join(lock_dir, "project")).read().strip()
        except OSError:
            continue
        if holding == project_id:
            n += 1
    return n

def open_ticket_count(root):
    try:
        names = os.listdir(os.path.join(root, "tickets"))
    except OSError:
        return 0
    return sum(
        1 for n in names
        if n.endswith(".md") and not n.endswith(".wip.md") and not n.endswith(".done.md")
    )

candidates = []
for p in projects:
    pid, root = p.get("id"), p.get("root")
    if not pid or not root or not os.path.isdir(root):
        continue
    if read_limit(root) < 1:
        continue
    if live_holders(pid) >= read_limit(root):
        continue
    if open_ticket_count(root) == 0:
        continue
    turn_file = os.path.join(run_dir, f"pool-turn-{pid}")
    mtime = os.stat(turn_file).st_mtime if os.path.exists(turn_file) else 0
    candidates.append((mtime, pid, root))

if not candidates:
    raise SystemExit(0)
candidates.sort(key=lambda c: c[0])
_, pid, root = candidates[0]
os.makedirs(run_dir, exist_ok=True)
turn_file = os.path.join(run_dir, f"pool-turn-{pid}")
open(turn_file, "a").close()
os.utime(turn_file, None)
print(pid)
print(root)
PY
)

if [ -z "$_pool_pick" ]; then
  exit 0
fi

# 7) project 파일에 고른 id를 적고 그 큐의 shim을 실행한다.
_pool_project=$(printf '%s\\n' "$_pool_pick" | sed -n 1p)
_pool_root=$(printf '%s\\n' "$_pool_pick" | sed -n 2p)
printf '%s' "$_pool_project" > "$_pool_lock/project"
bash "$_pool_root/workers/$_pool_name.sh"
`;

/** 등록. **파일 이름 목록이 풀이다** — 있는 공통 워커를 덮지 않는다(`O_EXCL`, 다른 shim
 *  생성·삭제와 같은 규칙). */
export async function createPoolWorker(name: string): Promise<{ path: string }> {
  validPoolName(name);
  const dir = poolDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.sh`);
  await writeFile(file, POOL_DISPATCHER_SH, { flag: "wx" });
  await chmod(file, 0o755);
  return { path: file };
}

export async function listPoolWorkers(): Promise<{ name: string; path: string }[]> {
  const dir = poolDir();
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh")).sort();
  return names.map((n) => ({ name: n.slice(0, -3), path: path.join(dir, n) }));
}

/** 슬롯 잠금(`run/pool-<이름>.lock`)의 `pid`·`project`. `null` = 지금 아무 프로젝트도 안 물고
 *  있다(잠금이 없거나, 있어도 주인이 죽었다 — `listWorkers`의 `lockOf`+`alive`와 같은 판정을
 *  잠금 이름 규칙만 다르게 다시 쓴다: 이 락은 sha1 해시가 아니라 `pool-<이름>` 그대로다). */
async function poolSlotHolder(name: string): Promise<{ pid: number; project: string } | null> {
  const dir = path.join(localDir(), "run", `pool-${name}.lock`);
  const isDir = await stat(dir).then((s) => s.isDirectory(), () => false);
  if (!isDir) return null;
  const pid = Number.parseInt((await readFile(path.join(dir, "pid"), "utf8").catch(() => "")).trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return null; // 죽었다
  }
  const project = (await readFile(path.join(dir, "project"), "utf8").catch(() => "")).trim();
  return { pid, project };
}

export async function poolWorkerStatus(name: string): Promise<"running" | "idle"> {
  return (await poolSlotHolder(name)) ? "running" : "idle";
}

/** 삭제. 지금 어느 프로젝트를 물고 있으면 막는다 — `deleteWorker`의 `running` 판정과 같은
 *  이유다(락과 도는 세션이 붕 뜬다). **빌리는 프로젝트 전부의 shim을 걷는 것은 이 함수의 몫이
 *  아니다** — 등록 프로젝트를 전부 훑어야 하는 화면 쪽 오케스트레이션이고, 이 티켓은 그
 *  화면이 부를 원자 함수(`returnPoolWorker`)까지만 낸다. */
export async function deletePoolWorker(name: string): Promise<void> {
  validPoolName(name);
  const holder = await poolSlotHolder(name);
  if (holder) {
    throw new Error(
      `${name}이(가) 지금 ${holder.project} 프로젝트를 물고 있습니다(pid ${holder.pid}). 끝난 뒤 삭제하세요.`,
    );
  }
  const file = path.join(poolDir(), `${name}.sh`);
  await unlink(file).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`없는 공통 워커입니다: ${name}`);
    throw e;
  });
}

// ── shim 워커 (`<루트>/workers/<공통 워커 이름>.sh`) ────────────────────────
//
// shim은 프로젝트 워커와 파일 모양이 같다 — 다른 것은 cron 줄이 안 붙는 것 하나뿐이고, 표식은
// 둘째 줄 주석 `# dira-pool: <이름>`이다(§4-16 결정 2). `createWorker`가 이미 하는 일(템플릿
// 복사·TICKET_CWD 재작성·TICKET_ENGINE 카탈로그 값 적용·`O_EXCL`)을 그대로 쓰고 마커 한 줄만
// 더한다 — 그래서 그 프로젝트의 공통 컨텍스트·통합 게이트·자가 정리·멀티플레잉 훅도 shim에
// 그대로 실린다(템플릿에 이미 있던 `source` 줄이 복사되므로).

function poolMarkerLine(name: string): string {
  return `# dira-pool: ${name}`;
}

/** shim 여부 판정. 표식은 **파일의 둘째 줄**이어야 한다(§4-16 결정 2) — 아무 데나 있는 주석과
 *  가르기 위해서다. */
function poolWorkerNameOf(text: string): string | null {
  const line = text.split("\n")[1] ?? "";
  const m = /^# dira-pool: (\S+)$/.exec(line);
  return m ? m[1] : null;
}

/** 대여. **이름이 겹치면 거절한다** — 같은 이름의 프로젝트 워커가 이미 있는 큐에는 shim을 안
 *  넣고 사유를 던진다(넣으면 남의 워커 파일을 덮는다). 이미 이 공통 워커를 빌린 상태(shim이
 *  이미 있다)는 멱등하게 그 경로를 돌려준다 — 화면이 상한을 두 번 저장해도 안 죽는다.
 *
 *  **워크트리는 미리 안 만든다**(§4-16 결정 2) — `createWorker`도 `prepareWorktree`를 안 부르니
 *  그 계약을 그대로 잇는다. `<루트>/worktrees/<이름>`은 첫 디스패치 때 통합 게이트가 만든다
 *  (shim이 그 프로젝트의 `dispatch-gate.sh` source 줄을 템플릿에서 그대로 물려받았기 때문이다). */
export async function borrowPoolWorker(root: string, name: string): Promise<{ path: string }> {
  validPoolName(name);
  const file = path.join(root, "workers", `${name}.sh`);
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing !== null) {
    if (poolWorkerNameOf(existing) === name) return { path: file }; // 이미 빌렸다 — no-op
    throw new Error(
      `이미 같은 이름의 프로젝트 워커가 있습니다: ${name} — 공통 워커 이름은 이 프로젝트의 워커 이름과 겹칠 수 없습니다.`,
    );
  }
  const created = await createWorker(root, name);
  const text = await readFile(created.path, "utf8");
  const lines = text.split("\n");
  lines.splice(1, 0, poolMarkerLine(name));
  await writeFile(created.path, lines.join("\n"), "utf8"); // 있던 파일이라 mode는 유지된다
  return { path: created.path };
}

/** 반납. shim이 아닌 파일(프로젝트 자신의 워커)은 이 경로로 안 지운다 — `deleteWorker`가 그대로
 *  `running`(티켓을 물고 있다) 판정을 하므로 그 체크는 다시 짜지 않는다. */
export async function returnPoolWorker(root: string, name: string): Promise<void> {
  const file = path.join(root, "workers", `${name}.sh`);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return; // 이미 없다 — no-op
  if (poolWorkerNameOf(text) !== name) {
    throw new Error(`${name}은(는) 공통 워커 shim이 아닙니다 — 이 함수로 지우지 않습니다.`);
  }
  await deleteWorker(root, name);
}

// ── 빌리기 상한 (`<루트>/pool-limit`, §4-16 결정 3) ─────────────────────────

/** `limit`은 실효 상한(못 읽으면 0 = 안 빌린다). `warn`은 **파일이 있는데** 못 읽은 값(문자·
 *  음수·빈 파일)이었다는 뜻이다 — 파일이 아예 없는 것과 다른 사실이라 화면이 경고 한 줄을
 *  세울 근거로 따로 든다(결정 3 "못 읽는 값은 안 빌리는 것으로 읽고 화면에 경고 한 줄을
 *  세운다"). 파서는 안 만든다 — `readPersonaLimit`(skills.ts)과 같은 정규식 하나(`^\d+$`)다. */
export type PoolLimit = { limit: number; warn: boolean };

export async function readPoolLimit(root: string): Promise<PoolLimit> {
  const text = await readFile(path.join(root, "pool-limit"), "utf8").catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  });
  if (text === null) return { limit: 0, warn: false }; // 파일 없음 — 안 빌린다. 경고 아니다.
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? { limit: Number(trimmed), warn: false } : { limit: 0, warn: true };
}

/** 저장. `writePersonaLimit`과 같은 검증(정수·0 이상)이지만 `null` 삭제 규약은 없다 — 상한이
 *  없다는 상태 자체가 곧 `0`과 같은 효과라서(§4-16 결정 3), 값 하나만 받는다. */
export async function writePoolLimit(root: string, limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`정수(0 이상)만 됩니다: ${limit}`);
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "pool-limit"), `${limit}\n`, "utf8");
}
