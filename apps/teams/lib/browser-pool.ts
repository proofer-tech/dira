/** CDP 브라우저 풀 슬롯 목록 (`~/.config/dira/browser-pool`, §CDP 브라우저를 풀에서 빌린다 ·
 *  §11-11 결정 1 · §11-13 결정 1 - 2 - 4). `.dira/browser.sh acquire`가 슬롯 디렉터리마다
 *  `hash` - `pid` - `pgid` 세 파일을 쓰고, `.dira/browse.sh`가 그 위에 `owner`(주인 토큰) -
 *  `busy`(도는 명령의 pid) 두 파일을 더 얹는다. 화면은 이 여섯 파일만 읽는다 — **여기서
 *  브라우저를 띄우거나 `release`하지 않는다**(§11-11 결정 7 §안 하는 것 — 슬롯의 주인은
 *  티켓을 도는 세션이다).
 *
 *  `localDir()`이 `TICKET_LOCAL` 존중을 이미 하므로(`lib/paths.ts`) 여기서 다시 안 쓴다 —
 *  `session-cap.ts`와 같은 자리다. */
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";
import { LINK_SLOT_HASH, isValidCdpHash } from "./cdp-relay.ts";
import { alive } from "./workers.ts";

function poolDir(): string {
  return path.join(localDir(), "browser-pool");
}

async function readTrimmed(file: string): Promise<string> {
  const raw = await readFile(file, "utf8").catch(() => null);
  return raw?.trim() ?? "";
}

function parsePid(raw: string): number | null {
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** 슬롯 하나 — `hash`는 관문을 통과한 값만, `owner`는 `browse.sh`가 적은 원문 토큰 그대로다
 *  (`worker:<이름>` - `home` - `external`). 사람이 읽는 이름으로 바꾸는 일은 안 한다 —
 *  워커 토큰을 티켓 - 페르소나로 잇는 조회는 큐를 아는 호출자(`home/actions.ts`) 몫이고,
 *  `home` - `external` 문구는 i18n으로 화면이 옮긴다(§11-13 결정 1). `owner` 파일이 없는
 *  옛 슬롯은 `null`이다. */
export type BrowserPoolSlot = {
  hash: string;
  owner: string | null;
  /** `busy` 파일이 있고 그 pid가 살아 있을 때만 참이다(§11-13 결정 2) — 파일 존재 하나로
   *  판정하면 `kill -9`로 남은 찌꺼기가 점을 영원히 켜 둔다. */
  busy: boolean;
  /** 세션이 사람에게 넘긴 상태(`browse.sh handoff`). 슬롯의 `handoff` 파일이 없으면 `null`이다. */
  handoff: BrowserHandoff | null;
};

/** 슬롯의 `handoff` 파일(key=value 줄) — 형식의 정본은 `templates/hooks/browse.sh` §핸드오프다.
 *  `pending`은 사람이 쥔 상태, `returned`는 사람이 돌려줬고 세션이 아직 안 거둔 상태다. */
export type BrowserHandoff = {
  state: "pending" | "returned";
  /** 누가 넘겼나 - `agent`는 세션의 `browse.sh handoff`, `user`는 사람이 화면에서 `직접 하기`로 가져간 것. */
  by: "agent" | "user";
  reason: string;
  url: string;
  since: number;
};

/** 핸드오프 면제 상한(초) — `browser.sh`의 `_handoff_ttl()`과 같은 판정(`handoff-ttl` 첫 줄, 기본 7200). */
export async function handoffTtl(): Promise<number> {
  const raw = await readTrimmed(path.join(localDir(), "handoff-ttl"));
  const n = Number.parseInt(raw, 10);
  return /^\d+$/.test(raw) && Number.isInteger(n) ? n : 7200;
}

export function parseHandoff(raw: string | null): BrowserHandoff | null {
  if (raw === null) return null;
  const kv: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !(line.slice(0, i) in kv)) kv[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  const since = Number.parseInt(kv.since ?? "", 10);
  return {
    state: kv.state === "returned" ? "returned" : "pending",
    by: kv.by === "user" ? "user" : "agent",
    reason: kv.reason ?? "",
    url: kv.url ?? "",
    since: Number.isInteger(since) ? since : 0,
  };
}

export async function findSlotDir(hash: string): Promise<string | null> {
  const dir = poolDir();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slotDir = path.join(dir, entry.name);
    if ((await readTrimmed(path.join(slotDir, "hash"))) === hash) return slotDir;
  }
  return null;
}

/** 사람이 `다 했어요`를 눌렀다 — `browse.sh <해시> handback`과 같은 일을 셸 없이 한다(셸을 부르면
 *  그 안의 판정이 화면 프로세스를 슬롯 주인으로 오인할 길이 생겨서 파일만 고친다). 넘긴 것이 없으면 `false`. */
export async function handBackBrowser(hash: string, note = ""): Promise<boolean> {
  if (!isValidCdpHash(hash)) return false;
  const slotDir = await findSlotDir(hash);
  if (!slotDir) return false;
  const file = path.join(slotDir, "handoff");
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) return false;
  const kept = raw.split("\n").filter((l) => l && !/^(state|returned_at|note)=/.test(l));
  const oneLine = note.replace(/[\r\n\t]+/g, " ").slice(0, 500);
  kept.push("state=returned", `returned_at=${Math.floor(Date.now() / 1000)}`, `note=${oneLine}`);
  const tmp = path.join(slotDir, `.handoff.${process.pid}`);
  await writeFile(tmp, kept.join("\n") + "\n");
  await rename(tmp, file);
  return true;
}

/** 사람이 화면에서 `직접 하기`를 눌렀다 — 세션이 넘긴 것과 같은 `handoff` 파일을 `by=user`로 쓴다.
 *  셸의 관문이 같은 파일을 보므로 그 순간부터 세션의 쓰기 명령은 종료 코드 4로 멈춘다(ego-browser의
 *  `Take over`와 같은 계약 - 사람이 쥐면 에이전트는 손을 뗀다). 이미 넘겨진 슬롯이면 덮지 않는다. */
export async function takeOverBrowser(hash: string, reason: string): Promise<boolean> {
  if (!isValidCdpHash(hash)) return false;
  const slotDir = await findSlotDir(hash);
  if (!slotDir) return false;
  const file = path.join(slotDir, "handoff");
  const existing = parseHandoff(await readFile(file, "utf8").catch(() => null));
  if (existing?.state === "pending") return true;
  const lines = [
    "state=pending",
    "by=user",
    `reason=${reason.replace(/[\r\n\t]+/g, " ").slice(0, 500)}`,
    "url=",
    `since=${Math.floor(Date.now() / 1000)}`,
  ];
  const tmp = path.join(slotDir, `.handoff.${process.pid}`);
  await writeFile(tmp, lines.join("\n") + "\n");
  await rename(tmp, file);
  return true;
}

/** 슬롯 목록 하나 — `slots`는 산 슬롯만 담고, `hasDeadSlot`은 이번 호출에서 죽은 주인을 하나라도
 *  봤다는 신호다(§11-13 결정 4). 회수(`browser.sh reclaim`)를 부를지는 이 신호를 본 호출자가
 *  정한다 — 여기서는 셸을 안 띄운다. */
export type BrowserPoolSlots = {
  slots: BrowserPoolSlot[];
  hasDeadSlot: boolean;
};

/** 풀 슬롯 전부를 읽는다(§11-11 수용조건 §`ls ~/.config/dira/browser-pool | wc -l`의 값과
 *  같다 · §11-13 결정 4 §회수된 슬롯은 목록에서도 빠진다). 풀 디렉터리가 없으면(브라우저를
 *  한 번도 안 띄운 머신) 빈 목록이다. `hash` 파일이 없거나 관문(`isValidCdpHash`) 밖이면 그
 *  슬롯은 건너뛴다 — 손상된 슬롯을 목록에 안 올린다. `pid`가 죽은 슬롯도 건너뛰고
 *  `hasDeadSlot`을 세운다 — 회수가 끝나기 전에 도는 폴링이 그 줄을 안 그리게 하는 것이 이
 *  판정의 목적이다. */
export async function listBrowserPoolSlots(): Promise<BrowserPoolSlots> {
  const dir = poolDir();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const slots: BrowserPoolSlot[] = [];
  let hasDeadSlot = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slotDir = path.join(dir, entry.name);
    const hash = await readTrimmed(path.join(slotDir, "hash"));
    if (!isValidCdpHash(hash)) continue;
    const handoff = parseHandoff(await readFile(path.join(slotDir, "handoff"), "utf8").catch(() => null));
    const pid = parsePid(await readTrimmed(path.join(slotDir, "pid")));
    if (pid !== null && !alive(pid)) {
      // 넘긴 슬롯은 세션이 끝나도 `browser.sh`가 면제 상한까지 안 거둔다 — 화면도 그동안 목록에 남긴다.
      const now = Math.floor(Date.now() / 1000);
      if (!handoff || now - handoff.since >= (await handoffTtl())) {
        hasDeadSlot = true;
        continue;
      }
    }
    const busyPid = parsePid(await readTrimmed(path.join(slotDir, "busy")));
    const owner = (await readTrimmed(path.join(slotDir, "owner"))) || null;
    slots.push({ hash, owner, busy: busyPid !== null && alive(busyPid), handoff });
  }
  return { slots, hasDeadSlot };
}

/** 풀 상한(§11-15 결정 4) — `browser.sh`의 `_limit()`과 같은 판정이다: `browser-limit`
 *  첫 줄이 정수가 아니거나 파일이 없으면 기본값 6(2026-09-16 재조정, 요구 `cc2e4f22`). 두 벌로
 *  판정하면 셸과 화면이 다른 상한을 볼 수 있다 — 여기서는 셸이 이미 쓴 파일을 그대로 읽는다. */
export async function poolLimit(): Promise<number> {
  const raw = await readTrimmed(path.join(localDir(), "browser-limit"));
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 6;
}

/** 링크가 열릴 슬롯이 막혔는지(§11-15 결정 4). `c0ffee00` 슬롯이 이미 있으면 상한과 무관하게
 *  안 막힌다 — 도는 것이 `goto` 하나라 새 슬롯을 안 빌린다(결정 4 첫 줄). 그 슬롯이 없을 때만
 *  상한을 잰다. `used`·`limit`은 토스트 문구가 쓴다. */
export async function linkOpenBlocked(): Promise<{ blocked: boolean; used: number; limit: number }> {
  const { slots } = await listBrowserPoolSlots();
  const limit = await poolLimit();
  if (slots.some((s) => s.hash === LINK_SLOT_HASH)) return { blocked: false, used: slots.length, limit };
  return { blocked: slots.length >= limit, used: slots.length, limit };
}
