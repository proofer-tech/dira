/** `/market` 로딩(§비주얼 §79 ⑥). 머리 묶음 세 층은 상수라 스켈레톤 없이 그대로 뜨고,
 *  격자 자리에만 카드와 같은 모양의 스켈레톤 여덟 장이 선다(격자와 같은 `grid-cols`·`gap-3`).
 *  스피너는 안 쓴다(DESIGN.md §6). */
import { readLanguage } from "@/lib/projects";
import { t } from "@/lib/i18n";
import { BrandMark, ShellHeader, ShellMain } from "@/components/project-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Search } from "lucide-react";

export default async function MarketLoading() {
  const locale = await readLanguage();
  return (
    <>
      <ShellHeader>
        <BrandMark href="/" />
      </ShellHeader>
      <ShellMain>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="text-lg font-semibold">{t(locale, "market.title")}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex h-8 items-center gap-4 text-sm text-muted-foreground">
              <span>{t(locale, "market.tab.persona")}</span>
              <span>{t(locale, "market.tab.squad")}</span>
            </div>
            <InputGroup className="h-8 max-w-xs">
              <InputGroupAddon>
                <Search aria-hidden className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput disabled placeholder={t(locale, "market.search.placeholder")} />
            </InputGroup>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      </ShellMain>
    </>
  );
}
