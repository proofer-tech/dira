import type { NextConfig } from "next";

// 정적 산출만 낸다 — `vercel.json`의 `framework: null`이 그대로 서고, 지금 vitepress가 굽는
// 26장과 URL이 한 자도 안 갈린다(§사이트 기반 §갈아 끼우는 것).
// 산출 자리는 `out/`이라 vitepress의 `.vitepress/dist`와 안 겹친다 — 두 빌드가 한 디렉터리에서
// 공존하는 동안 서로를 안 밟는다. 뒤집는 것은 전환 티켓이다(§순서 ⑧).
export default { output: "export" } satisfies NextConfig;
