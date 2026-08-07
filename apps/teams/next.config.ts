import type { NextConfig } from "next";
import { BODY_SIZE_LIMIT } from "./lib/attachment-limit.ts";

const nextConfig: NextConfig = {
  // apps/teams/ 상위 홈 디렉터리에도 pnpm-workspace.yaml이 있어서, 못박지 않으면
  // Next가 ~/를 워크스페이스 루트로 잡고 홈 전체를 추적한다.
  turbopack: { root: import.meta.dirname },
  // 데스크톱 셸(`apps/desktop`)이 자식으로 띄우는 서버. 브라우저의 `pnpm dev`·`pnpm start`는
  // 이 값과 무관하게 그대로다 (DESIGN.md §데스크톱 앱).
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  // `app/(site)/meta.ts`의 `docPath("index")`가 `/docs/`(끝 슬래시 있음)를 정본 URL로 삼는다 —
  // 옛 정적 export(§사이트 기반)의 "디렉터리 URL = index" 관례다. `next start`/`standalone`
  // 서버는 기본으로 끝 슬래시를 **떼며 308**한다(`trailingSlash` 전역 설정 하나뿐이라 `/docs/`엔
  // 슬래시를 두고 `/docs/install`엔 안 두는 건 그 옵션으로 못 가른다). 그래서 정규화 자체를
  // 끄고 두 형태 다 라우팅이 직접 받게 한다 — `/docs/`·`/docs/install` 전부 200(§한 코드베이스
  // §검증 ②), URL이 한 자도 안 갈린다.
  skipTrailingSlashRedirect: true,
  // `/docs/**`·`/privacy`·`/terms`가 `readFileSync(process.cwd()/…)`로 **요청 시점에** 읽는
  // 마크다운이다(§한 코드베이스 §부딪히는 것 ⑤) — 정적 import가 아니라서 파일 트레이싱이
  // 못 보고, `output: "standalone"`은 트레이싱된 파일만 담으므로 안 얹으면 패키징된
  // `.app`에서 `/docs/**`가 500이다(빌드는 통과한다 — 그래서 눈으로 못 잡는다).
  outputFileTracingIncludes: { "/**": ["./docs/**/*.md", "./privacy.md", "./terms.md"] },
  // 첨부의 통로가 Server Action(`FormData`)인데(DESIGN.md §8) Next의 기본 한도가 **1MB**다 —
  // 안 얹으면 §8이 정한 20MB 상한이 `saveAttachment`에 닿기도 전에 Next가 거절한다.
  // 수를 여기 적지 않는다: §8 상한에서 유도된 값이다(`MAX_BYTES` + 여유. 같게 뒀던 것이 `6dab7cc8`).
  experimental: { serverActions: { bodySizeLimit: BODY_SIZE_LIMIT } },
  // 다중 토큰 잠금(DESIGN.md §0-13 §잠금) — `isMultiToken()`이 읽는 값을 빌드 시각에 상수로
  // 인라인한다. 런타임 env로 두면 배포한 dmg가 잠금 분기를 품은 채 나가 env 하나로 열린다.
  // 값을 항상 "0"/"1" 중 하나로 못박는다 — `next/dist/lib/static-env.js`의 `getNextConfigEnv`가
  // `value != null`일 때만 치환 규칙을 만들어서, 빌드 시각 값이 `undefined`(잠금 빌드)면 치환
  // 자체가 안 생기고 서버 청크에 `process.env.DIRA_MULTI_TOKEN` 표현식이 그대로 남아 런타임
  // 프로세스 env로 매 요청 재평가된다(28f72b69) — 잠금 방향이 정확히 안 굳는다.
  env: { DIRA_MULTI_TOKEN: process.env.DIRA_MULTI_TOKEN === "1" ? "1" : "0" },
};

export default nextConfig;
