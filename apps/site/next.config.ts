import { join } from "node:path";
import type { NextConfig } from "next";

// 정적 산출만 낸다 — `vercel.json`의 `framework: null`이 그대로 서고, 옛 빌드가 굽던 26장과
// URL이 한 자도 안 갈린다(§사이트 기반 §갈아 끼우는 것. `1ff5f751`이 앞뒤 목록을 대서 diff 0줄).
// 산출 자리는 `out/`이고 `vercel.json`의 `outputDirectory`가 그 자리다 — 나란히 돌던 옛 빌드는
// §순서 ⑧이 지웠다. `trailingSlash`는 안 켠다(§목차 한 장 — 갈리는 파일이 1에서 21로 늘고
// §검증 ①이 아무것도 못 잰다).
// `turbopack.root`를 레포 루트로 못박는다. 안 적으면 turbopack이 **lockfile을 보고 추론**하고,
// `apps/site/`가 자기 `pnpm-lock.yaml`을 갖고 있어서 깨끗한 체크아웃에서는 root가 이 디렉터리로
// 떨어진다 — 그러면 `version.ts:7`의 `../desktop/package.json`이 root 밖이라
// `Module not found`로 빌드가 죽는다. 워커 트리에서는 `~/pnpm-workspace.yaml`이 조상으로 있어
// root가 위로 올라가 **이 결함이 안 보인다**(실측 `1ff5f751`: 같은 커밋이 워크트리에서 exit 0,
// `git archive` 체크아웃에서 exit 1). CI가 보는 것은 뒤쪽이다.
export default {
  output: "export",
  turbopack: { root: join(import.meta.dirname, "../..") },
} satisfies NextConfig;
