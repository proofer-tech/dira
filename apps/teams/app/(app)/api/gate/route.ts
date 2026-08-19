/** 통합 게이트 보류 — 등록된 프로젝트 전부 (DESIGN.md §4-14 §표식 파일 · §데스크톱 앱 N2
 *  §N2의 둘째 사건).
 *
 *  **판정을 여기서 다시 재지 않는다** — `git`을 부르지도, 통합 브랜치를 어디서 읽지도 않는다.
 *  `lib/projects.ts`의 `readGateDirty`가 표식 파일 하나를 읽어 옮길 뿐이다(§판정을 두 벌로
 *  만들지 않는다). `/api/awaiting`은 한 자도 안 건드린다 — 못박는 것 5가 그 라우트 하나를
 *  계약으로 고정하므로 페이로드에 종류 칸을 끼우지 않는다. */
import { readGateDirty, readProjects } from "@/lib/projects";

export type GateItem = { project: string; tree: string; count: number; at: string };

export async function GET() {
  const projects = await readProjects();
  const found = await Promise.all(
    projects.map(async (p): Promise<GateItem[]> => {
      const gate = await readGateDirty(p.root);
      return gate ? [{ project: p.id, tree: gate.tree, count: gate.count, at: gate.at }] : [];
    }),
  );
  return Response.json(found.flat());
}
