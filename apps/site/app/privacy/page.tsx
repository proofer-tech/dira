import { readFileSync } from "node:fs";
import { join } from "node:path";
import Doc from "../doc";

// 루트 산문 2장은 매뉴얼 셸의 크롬을 안 받는다(§갈아 끼우는 것 — *매뉴얼 셸이 아니라 자기
// 라우트 둘*). 지금 산출물도 이 두 장에 사이드바 0 · 이전/다음 0이다(`sidebar`가 `/docs/`
// 스코프고 `prev`/`next`는 사이드바 순서에서 나온다). 그래서 세울 크롬이 0이다.
export default function Page() {
  return <Doc source={readFileSync(join(process.cwd(), "privacy.md"), "utf8")} />;
}
