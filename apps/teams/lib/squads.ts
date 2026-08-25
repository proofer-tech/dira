/** 스쿼드 멤버 저장 순서(DESIGN.md §5-5 §개정 "저장 순서가 저장된 순서를 보존한다") — 클라이언트
 *  컴포넌트와 그 테스트 양쪽에서 쓰는 순수 함수라 `lib/projects.ts`(node:fs)가 아니라 여기 있다.
 *  `personas-ui.tsx`의 왼쪽 목록 배지와 `SquadDetail` 오른쪽 칸이 이 파일의 두 함수를 같이
 *  불러 판정이 갈리지 않는다. */
import type { SquadMember } from "./projects.ts";

/** 계약 표 순위 1-2-3을 이어 붙인다:
 *  1) 파일(`saved`)에 있던 순서 그대로인, 지금도 체크된(`picked`) 이름
 *  2) 이번에 새로 체크한 이름 — `eligibleNames`(화면 목록) 순서
 *  3) `eligibleNames` 밖(프로필 없는 멤버) — `picked`에 든 순서 그대로, 무수정 */
export function orderedSquadMembers(
  picked: string[],
  roles: Record<string, string>,
  saved: SquadMember[],
  eligibleNames: string[],
): SquadMember[] {
  const pickedEligible = eligibleNames.filter((n) => picked.includes(n));
  const savedNames = saved.map((m) => m.name);
  const kept = savedNames.filter((n) => pickedEligible.includes(n));
  const added = pickedEligible.filter((n) => !savedNames.includes(n));
  const orphans = picked.filter((n) => !eligibleNames.includes(n));
  return [...kept, ...added, ...orphans].map((name) => ({ name, role: (roles[name] ?? "").trim() }));
}

/** 순서까지 본다(§5-5 §개정) — 저장될 순서가 파일 순서와 다르면 다른 값이다. */
export function sameSquadMembers(a: SquadMember[], b: SquadMember[]): boolean {
  return a.length === b.length && a.every((m, i) => m.name === b[i].name && m.role === b[i].role);
}

/** §5-5 §개정("멤버 칸이 로스터가 된다") — `orderedSquadMembers`(위, P311-2 계약)의 출력 위에
 *  "첫 자리 하나를 사람이 옮기는 것"(리더 지정/해제) 하나만 얹는다. `orderedSquadMembers` 자신은
 *  다시 안 쓴다 — 이 함수는 그 결과를 후처리하는 새 함수다.
 *  `leader`가 `base`에 없으면(로스터에서 빠졌다) 원본 그대로다 — 지정한 이름이 사라지면 지정이
 *  조용히 무효가 된다(엔진의 `members` 첫 줄은 여전히 정확히 한 이름이다). */
export function applyLeaderOverride(base: SquadMember[], leader: string | null): SquadMember[] {
  const idx = leader ? base.findIndex((m) => m.name === leader) : -1;
  if (idx <= 0) return base;
  return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
}
