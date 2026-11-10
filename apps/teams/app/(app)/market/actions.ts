"use server";

/** 마켓 가져오기의 서버 액션 - 껍데기다(P559-6). 본체는 `lib/ops/market.ts`에 있고 MCP op가 같은 함수를 부른다.
 *  이 파일은 성공했을 때 `revalidatePath`만 더한다. */
import { revalidatePath } from "next/cache";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { toggleFavorite, type FileDiff, type MarketItemDetail, type MarketKind } from "@/lib/market";
import * as op from "@/lib/ops/market";

export type ImportResult = op.ImportResult;
export type MarketCardItem = op.MarketCardItem;

export async function loadMarketPaneData(locale: Locale) {
  return op.marketPaneData(locale);
}

async function imported(projectId: string, r: Promise<op.ImportResult>): Promise<op.ImportResult> {
  const res = await r;
  if (res.ok) {
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
  }
  return res;
}

/** 페르소나 가져오기. `asName`이 비면 원본 이름을 쓴다. */
export async function importPersonaAction(
  owner: string,
  name: string,
  projectId: string,
  asName: string,
  overwrite = false,
  locale: Locale = DEFAULT_LOCALE,
  version?: string,
): Promise<ImportResult> {
  return imported(projectId, op.marketImport("persona", owner, name, projectId, asName, overwrite, locale, version));
}

export async function importSquadAction(
  owner: string,
  name: string,
  projectId: string,
  asName: string,
  overwrite = false,
  locale: Locale = DEFAULT_LOCALE,
  version?: string,
): Promise<ImportResult> {
  return imported(projectId, op.marketImport("squad", owner, name, projectId, asName, overwrite, locale, version));
}

export async function previewMarketUpdateAction(
  kind: MarketKind,
  owner: string,
  name: string,
  projectId: string,
): Promise<{ version: string; files: FileDiff[] } | null> {
  return op.marketUpdatePreview(kind, owner, name, projectId);
}

/** 즐겨찾기 켜기/끄기(§화면, 티켓 `0aac85ef`) — `favorites.json` 읽고 쓰는 유일한 서버 액션.
 *  갱신된 배열을 그대로 돌려준다 — 클라이언트가 목록을 다시 안 읽어도 켜짐 상태를 안다. */
export async function toggleFavoriteAction(id: string): Promise<string[]> {
  return toggleFavorite(id);
}

export async function getMarketItemDetailAction(
  kind: MarketKind,
  owner: string,
  name: string,
): Promise<MarketItemDetail | null> {
  return op.marketItemDetail(kind, owner, name);
}
