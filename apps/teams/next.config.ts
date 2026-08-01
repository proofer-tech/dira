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
  // 첨부의 통로가 Server Action(`FormData`)인데(DESIGN.md §8) Next의 기본 한도가 **1MB**다 —
  // 안 얹으면 §8이 정한 20MB 상한이 `saveAttachment`에 닿기도 전에 Next가 거절한다.
  // 수를 여기 적지 않는다: §8 상한에서 유도된 값이다(`MAX_BYTES` + 여유. 같게 뒀던 것이 `6dab7cc8`).
  experimental: { serverActions: { bodySizeLimit: BODY_SIZE_LIMIT } },
};

export default nextConfig;
