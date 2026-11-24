/** 삭제 정리(P570-1)가 `uninstalled.crontab`에 남긴 cron 줄을 재설치 때 되살리는 판정 (docs/DESIGN.md P570 결정 7).
 *  electron을 만지지 않는 순수 함수라 `cron-restore.test.ts`가 창 없이 분기를 밟는다. */

/** 지금 crontab 본문 + 기록 본문(없으면 `null`) -> 새 본문 또는 변경 없음(`next: null`).
 *  `archive`는 기록 파일을 `.restored-<시각>`으로 옮길지다: 기록이 있으면 항상 true다(덧붙일 줄이 없어도 다시 읽지 않게).
 *  남의 줄은 바이트 그대로다. ponytail: 줄 단위 완전 일치만 본다. 순서와 중복 기록은 첫 등장만 남긴다. */
export function restoreCron(tab: string, record: string | null): { next: string | null; archive: boolean } {
  if (record === null) return { next: null, archive: false };
  const have = new Set(tab === "" ? [] : tab.replace(/\n$/, "").split("\n"));
  const add: string[] = [];
  for (const l of record.split("\n")) {
    if (l === "" || have.has(l)) continue;
    have.add(l);
    add.push(l);
  }
  if (add.length === 0) return { next: null, archive: true };
  const base = tab === "" || tab.endsWith("\n") ? tab : tab + "\n";
  return { next: base + add.join("\n") + "\n", archive: true };
}

/** 옮길 파일 이름. 예: `uninstalled.crontab.restored-20261124T045500Z` */
export function restoredName(now: Date): string {
  return `uninstalled.crontab.restored-${now.toISOString().replace(/[-:]|\.\d+/g, "")}`;
}
