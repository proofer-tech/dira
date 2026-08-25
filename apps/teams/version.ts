/** 랜딩·푸터의 버전 표기는 전부 여기서 온다. **본문에 숫자를 적지 않는다** —
 *  `release.yml`이 master 커밋마다 bump하므로 손으로 적는 한 반드시 어긋난다. */
// 종전(이사 `6a24257d` 전의 옛 site 패키지)에는 정적 JSON import(`import pkg from
// "../desktop/package.json" with { type: "json" }`)였다. `apps/teams`는 `next.config.ts`가
// `turbopack.root`를 `apps/teams`로 고정해서(§한 코드베이스 §부딪히는 것 ④ — Next가 홈
// 디렉터리를 안 훑는 계약이다) 그 root 밖인 `apps/desktop/package.json`을 정적 import로
// 못 부른다("server relative imports are not implemented yet" — turbopack 실측).
//
// 패키징된 데스크톱 앱에서는 **파일 read가 아예 안 통한다** — `Resources/server/`는
// `.next/standalone`을 통째로 복사한 것뿐이고 `apps/desktop/package.json`이 그 옆에 없다
// (`apps/desktop/main.ts`의 `startServer`가 `extraResources`로 나르는 것은 엔진 셋뿐이다).
// 대신 그 main이 `DIRA_APP_VERSION: app.getVersion()`을 자식 서버에 이미 넘긴다(§0-11 —
// `lib/analytics.ts`가 셸 판정에 쓰는 그 값과 같다) — `app.getVersion()`이 읽는 값 자체가
// `package.json`의 `version`이라 정본이 같다. 그래서 그 값을 **먼저** 본다.
//
// 그 값이 없으면(브라우저 배포·`pnpm dev`/`start`) `process.cwd()` + `path.join`의 순수
// 문자열 경로로 읽는다(`app/(site)/docs/**`·`privacy`·`terms`가 이미 쓰는 관용구) — 이건
// 모듈 해석이 아니라 fs 호출이라 위 root 제약을 안 탄다. `import.meta.dirname`은 "페이지
// 데이터 수집" 단계의 turbopack 실행 컨텍스트에서 `undefined`라 실측으로 버렸다 —
// `process.cwd()`는 그 단계에서도(그리고 desktop standalone 실행에서도) 계약대로
// `apps/teams`다(옛 `readFileSync(new URL(…, import.meta.url))` 두 인자 형태는 다른
// 이유로 깨졌었다 — turbopack이 그 형태를 자기 asset URL로 바꿔치기해서
// `ERR_INVALID_ARG_TYPE`).
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readDesktopVersion(): string {
  if (process.env.DIRA_APP_VERSION) return process.env.DIRA_APP_VERSION;
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "..", "desktop", "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export const diraVersion: string = readDesktopVersion();
