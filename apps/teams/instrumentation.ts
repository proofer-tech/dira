/** 서버 기동 1회 훅(Next.js `register()`). 전 등록 프로젝트의 vendored 큐 코어를 엔진
 *  `protocols/CORE*.md` 집합에 맞춘다(DESIGN.md §프롬프트 층 결정 8-c). 프로젝트 등록 시의
 *  코어 미러링은 `addProject`(lib/projects.ts) 안에 있다 — 여긴 기동 시점만 담당한다. */
import { isLandingOnly } from "./lib/flags.ts";

// `node:fs/promises`·`node:path`를 쓰는 두 모듈은 **동적 import**로 미룬다 — 위 두 early return
// 뒤에 두면 Next가 edge 빌드에서 `NEXT_RUNTIME`을 리터럴로 치환해 이 가지째 제거한다. 정적
// import였을 때는 가드가 함수 안에 있어도 edge 번들에 그대로 실려 "Node.js module in Edge
// Runtime" 경고가 났다(실측 — proxy.ts 11행과 같은 부류의 문제).
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return; // fs 없음 — node 런타임에서만 돈다
  const { registerShutdownHandlers } = await import("./lib/pty.ts");
  // process.on은 이 파일에 직접 두면 edge 번들 검사가 빌드를 깬다(실측) - 핸들러 등록은 동적 import한 쪽에 둔다.
  const { tapProcessOutput, installProcessHandlers } = await import("./lib/error-report-send.ts");
  tapProcessOutput();
  installProcessHandlers();
  registerShutdownHandlers(); // §11-1 §개정 — SIGTERM·SIGINT·정상 exit에서 열린 pty를 전부 죽인다
  if (isLandingOnly()) return; // 공개 배포는 등록된 프로젝트가 없다 — 레지스트리 읽기 0회
  // P505: 미적용 마이그레이션이 있으면 러너를 분리 프로세스로 띄운다(기다리지 않는다 - 차단은 게이트, 화면은 오버레이).
  // mirrorCore보다 먼저다.
  const { ensureRunner } = await import("./lib/migrations.ts");
  await ensureRunner(true).catch(() => {});
  const { readProjects, resolveConfig } = await import("./lib/projects.ts");
  const { mirrorCore } = await import("./lib/protocols.ts");
  const projects = await readProjects().catch(() => []);
  for (const project of projects) {
    const config = await resolveConfig(project);
    await mirrorCore(config.protocols).catch(() => {});
  }
  // P489-2: 옛 crontab 워커 줄을 dispatch.py 형식으로 한 번 바꾼다. 실패하면 옛 줄이 그대로 돈다.
  const { migrateCron } = await import("./lib/workers.ts");
  await migrateCron(projects.map((p) => p.root)).catch(() => {});
}

function errParts(e: unknown): { message: string; stack: string } {
  return e instanceof Error ? { message: e.message, stack: e.stack ?? "" } : { message: String(e), stack: "" };
}

/** 라우트 - 서버 액션 - 렌더 중 난 요청 오류(Next 훅). `route`는 패턴만 보낸다(실제 URL 아님). */
export async function onRequestError(
  err: unknown,
  _request: unknown,
  context: { routePath?: string },
) {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { reportError } = await import("./lib/error-report-send.ts");
  await reportError({ source: "server", kind: "request_error", route: context.routePath, ...errParts(err) });
}
