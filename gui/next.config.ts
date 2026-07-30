import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // gui/ 상위 홈 디렉터리에도 pnpm-workspace.yaml이 있어서, 못박지 않으면
  // Next가 ~/를 워크스페이스 루트로 잡고 홈 전체를 추적한다.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
