import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // apps/teams/ 상위 홈 디렉터리에도 pnpm-workspace.yaml이 있어서, 못박지 않으면
  // Next가 ~/를 워크스페이스 루트로 잡고 홈 전체를 추적한다.
  turbopack: { root: import.meta.dirname },
  // 데스크톱 셸(`apps/desktop`)이 자식으로 띄우는 서버. 브라우저의 `pnpm dev`·`pnpm start`는
  // 이 값과 무관하게 그대로다 (DESIGN.md §데스크톱 앱).
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
