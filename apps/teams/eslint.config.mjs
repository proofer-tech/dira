import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // `app/(site)/**`는 `apps/site`(vitepress 이식, `6a24257d` §한 코드베이스)가 이사한
  // 자리다 — 이 프로젝트의 eslint 없이 쓰여서 규칙 셋이 다르다. 산문·마크업을 0자 안 고치는
  // 것이 계약이라(§옛 절의 경로 인용) 규칙을 맞추려 코드를 다시 쓰지 않고, 여기서 끈다.
  {
    files: ["app/(site)/**/*.{ts,tsx}"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
