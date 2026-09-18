/** CDP 브라우저 풀 슬롯 목록 (`~/.config/dira/browser-pool`, §CDP 브라우저를 풀에서 빌린다 ·
 *  §11-11 결정 1 · §11-13 결정 1 - 2 - 4). `.dira/browser.sh acquire`가 슬롯 디렉터리마다
 *  `hash` - `pid` - `pgid` 세 파일을 쓰고, `.dira/browse.sh`가 그 위에 `owner`(주인 토큰) -
 *  `busy`(도는 명령의 pid) 두 파일을 더 얹는다. 화면은 이 여섯 파일만 읽는다 — **여기서
 *  브라우저를 띄우거나 `release`하지 않는다**(§11-11 결정 7 §안 하는 것 — 슬롯의 주인은
 *  티켓을 도는 세션이다).
 *
 *  `localDir()`이 `TICKET_LOCAL` 존중을 이미 하므로(`lib/paths.ts`) 여기서 다시 안 쓴다 —
 *  `session-cap.ts`와 같은 자리다. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";
import { isValidCdpHash } from "./cdp-relay.ts";
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
};

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
    const pid = parsePid(await readTrimmed(path.join(slotDir, "pid")));
    if (pid !== null && !alive(pid)) {
      hasDeadSlot = true;
      continue;
    }
    const busyPid = parsePid(await readTrimmed(path.join(slotDir, "busy")));
    const owner = (await readTrimmed(path.join(slotDir, "owner"))) || null;
    slots.push({ hash, owner, busy: busyPid !== null && alive(busyPid) });
  }
  return { slots, hasDeadSlot };
}
