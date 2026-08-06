/** 서버 기동 1회 훅(Next.js `register()`). 전 등록 프로젝트의 vendored 큐 코어를 엔진
 *  `protocols/CORE*.md` 집합에 맞춘다(DESIGN.md §프롬프트 층 결정 8-c). 프로젝트 등록 시의
 *  같은 미러링은 `addProject`(lib/projects.ts) 안에 있다 — 여긴 기동 시점만 담당한다. */
import { readProjects, resolveConfig } from "@/lib/projects";
import { mirrorCore } from "@/lib/protocols";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return; // fs 없음 — node 런타임에서만 돈다
  const projects = await readProjects().catch(() => []);
  for (const project of projects) {
    const config = await resolveConfig(project);
    await mirrorCore(config.protocols).catch(() => {});
  }
}
