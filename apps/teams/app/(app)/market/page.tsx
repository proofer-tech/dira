/** `/market` — 전역 마켓 목록(DESIGN.md §페르소나 마켓 §화면, §비주얼 §79, 티켓 `0aac85ef`).
 *
 *  프로젝트 밖 화면이다 — 사이드바도 좌측 패널도 없다(§79 ①). 랜딩-only에서 404가 되는 것은
 *  `proxy.ts`가 진다(이 화면에 닿기 전에 끊는다 — fs 읽기 0회 요건이 그 자리에서 지켜진다).
 *
 *  검색이 `PROFILE.md` 첫 줄까지 훑으므로(§화면) 페르소나 항목마다 본문을 한 번 더 읽는다 —
 *  마켓이 머신 한 대짜리라 항목 수가 적다는 전제 위에서 하는 선택이다(§79 ② `auto-fill` 근거와
 *  같은 전제). "가져간 곳" 표식도 같은 렌더에서 레지스트리 한 번으로 계산한다(새 fs 읽기 없이
 *  프로젝트 수만큼). */
import { readLanguage } from "@/lib/projects";
import { BrandMark, ShellHeader, ShellMain } from "@/components/project-switcher";
import { MarketPane } from "@/components/market-ui";
import { loadMarketPaneData, type MarketCardItem } from "./actions";

export const dynamic = "force-dynamic";

export type { MarketCardItem };

export default async function MarketPage() {
  const locale = await readLanguage();
  const { items, projects } = await loadMarketPaneData(locale);

  return (
    <>
      <ShellHeader>
        <BrandMark href="/" />
      </ShellHeader>
      <ShellMain>
        <MarketPane locale={locale} items={items} projects={projects} />
      </ShellMain>
    </>
  );
}
