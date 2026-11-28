// 테스트 전용 로더 - .tsx/.ts를 typescript로 변환하고 "@/"를 풀며, next에 묶인 모듈은 스텁으로 바꾼다.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const STUBS = {
  "@/components/ui/button": "stub-ui.mjs",
  "@/components/ui/input-group": "stub-ui.mjs",
  "@/components/language-provider": "stub-ui.mjs",
  "@/lib/route-pending": "stub-ui.mjs",
};

export async function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: new URL(`./test-stubs/${STUBS[spec]}`, import.meta.url).href, shortCircuit: true };
  if (spec.startsWith("@/")) {
    const base = root + spec.slice(2);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext) && !base.endsWith("/") && (ext || /\.\w+$/.test(base))) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL) {
    const base = fileURLToPath(new URL(spec, ctx.parentURL));
    for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.endsWith(".tsx")) {
    const src = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return { format: "module", source: src, shortCircuit: true };
  }
  return next(url, ctx);
}
