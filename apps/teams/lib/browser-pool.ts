/** CDP 브라우저 풀 슬롯 목록 (`~/.config/dira/browser-pool`, §CDP 브라우저를 풀에서 빌린다 ·
 *  §11-11 결정 1). `.dira/browser.sh acquire`가 슬롯 디렉터리마다 `hash` 파일 한 줄을 쓰고,
 *  화면은 그 값만 읽는다 — **여기서 브라우저를 띄우거나 `release`하지 않는다**(§11-11 결정 7
 *  §안 하는 것 — 슬롯의 주인은 티켓을 도는 세션이다).
 *
 *  `localDir()`이 `TICKET_LOCAL` 존중을 이미 하므로(`lib/paths.ts`) 여기서 다시 안 쓴다 —
 *  `session-cap.ts`와 같은 자리다. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "./paths.ts";
import { isValidCdpHash } from "./cdp-relay.ts";

function poolDir(): string {
  return path.join(localDir(), "browser-pool");
}

/** 슬롯이 쥔 티켓 해시 전부(§11-11 수용조건 §`ls ~/.config/dira/browser-pool | wc -l`의 값과
 *  같다) — 줄 하나가 슬롯 하나다. 풀 디렉터리가 없으면(브라우저를 한 번도 안 띄운 머신) 빈
 *  배열이다. `hash` 파일이 없거나 관문(`isValidCdpHash`) 밖이면 그 슬롯은 건너뛴다 — 회수
 *  중이거나(`browser.sh _reclaim`) 손상된 슬롯을 목록에 안 올린다. */
export async function listBrowserPoolHashes(): Promise<string[]> {
  const dir = poolDir();
  const slots = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const hashes: string[] = [];
  for (const slot of slots) {
    if (!slot.isDirectory()) continue;
    const raw = await readFile(path.join(dir, slot.name, "hash"), "utf8").catch(() => null);
    const hash = raw?.trim() ?? "";
    if (isValidCdpHash(hash)) hashes.push(hash);
  }
  return hashes;
}
