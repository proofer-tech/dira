/** 서버 기동 1회 훅(Next.js `register()`). 전 등록 프로젝트의 vendored 큐 코어를 엔진
 *  `protocols/CORE*.md` 집합에 맞추고(DESIGN.md §프롬프트 층 결정 8-c), 배포된 풀 디스패처를
 *  `POOL_DISPATCHER_SH`에 맞춘다(§4-16 개정 1 결정 7). 프로젝트 등록 시의 코어 미러링은
 *  `addProject`(lib/projects.ts) 안에 있다 — 여긴 기동 시점만 담당한다. 풀 디스패처는 프로젝트가
 *  아니라 머신 하나의 값(`localDir()/pool`)이라 등록 루프 밖에서 한 번만 돈다. */
import { isLandingOnly } from "./lib/flags.ts";

// `node:fs/promises`·`node:path`를 쓰는 두 모듈은 **동적 import**로 미룬다 — 위 두 early return
// 뒤에 두면 Next가 edge 빌드에서 `NEXT_RUNTIME`을 리터럴로 치환해 이 가지째 제거한다. 정적
// import였을 때는 가드가 함수 안에 있어도 edge 번들에 그대로 실려 "Node.js module in Edge
// Runtime" 경고가 났다(실측 — proxy.ts 11행과 같은 부류의 문제).
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return; // fs 없음 — node 런타임에서만 돈다
  if (isLandingOnly()) return; // 공개 배포는 등록된 프로젝트가 없다 — 레지스트리 읽기 0회
  const { readProjects, resolveConfig } = await import("./lib/projects.ts");
  const { mirrorCore } = await import("./lib/protocols.ts");
  const { mirrorPoolWorkers } = await import("./lib/pool.ts");
  const projects = await readProjects().catch(() => []);
  for (const project of projects) {
    const config = await resolveConfig(project);
    await mirrorCore(config.protocols).catch(() => {});
  }
  await mirrorPoolWorkers().catch(() => {});
}
