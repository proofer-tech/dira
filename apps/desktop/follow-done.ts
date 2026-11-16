// P564 결정 3-4: 팔로우한 티켓의 완료 알림. 판정은 서버(`GET /api/follows/done`)가 하고
// main은 응답 검증과 알림 글 조립만 한다. 계약: ../../docs/DESIGN.md §P564.

export type FollowDone = {
  project: string;
  projectName: string;
  stem: string;
  hash: string;
  title: string;
  continued: string;
};

/** 응답이 배열이 아니면 던진다(신뢰 경계). 필수 문자열이 빠진 항목은 버린다. */
export function parseFollowDone(raw: unknown): FollowDone[] {
  if (!Array.isArray(raw)) throw new Error(`배열이 아닌 응답: ${JSON.stringify(raw)?.slice(0, 200)}`);
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const out: FollowDone[] = [];
  for (const i of raw) {
    if (!i || typeof i.project !== "string" || typeof i.stem !== "string" || !i.project || !i.stem) continue;
    out.push({
      project: i.project,
      projectName: s(i.projectName) || i.project,
      stem: i.stem,
      hash: s(i.hash),
      title: s(i.title),
      continued: s(i.continued),
    });
  }
  return out;
}

/** `<제목 또는 해시> - <프로젝트 이름>`, `continued`가 있으면 ` (이어받기 <해시>)`를 붙인다. */
export function followDoneBody(i: FollowDone): string {
  const base = `${i.title || i.hash || i.stem} - ${i.projectName}`;
  return i.continued ? `${base} (이어받기 ${i.continued})` : base;
}
