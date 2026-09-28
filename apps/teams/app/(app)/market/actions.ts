"use server";

/** 마켓 가져오기의 서버 액션(DESIGN.md §페르소나 마켓 §가져오기, 티켓 `299a45d8`).
 *
 *  화면(`0aac85ef`, P426-5)이 이 두 액션을 부른다. 다시 받기(갱신 배지 클릭)도 같은 액션을
 *  `overwrite: true`로 다시 부르는 것뿐이다 — 첫 설치와 별도 경로를 안 만든다.
 *
 *  쓰기 자체(`PROFILE.md`·`skills.md`·`members` 파일, `installs.jsonl`, 레지스트리 한 칸)는
 *  전부 `lib/market.ts`·`lib/projects.ts`에 있다. 이 파일이 하는 일은 프로젝트 id → 해석된
 *  디렉터리로 바꾸는 것, 그리고 성공한 가져오기마다 설치 기록 두 곳(§저장 자리 §설치 기록)에
 *  쓰는 순서를 묶는 것뿐이다. */
import { revalidatePath } from "next/cache";
import { DEFAULT_LOCALE, t, wrap, type Locale } from "@/lib/i18n";
import {
  appendInstall,
  firstLine,
  getMarketItem,
  importPersona,
  importSquad,
  listMarketItems,
  projectsThatImported,
  toggleFavorite,
  type ImportReason,
  type MarketItem,
  type MarketItemDetail,
  type MarketKind,
} from "@/lib/market";
import { getProject, readProjects, resolveConfig, setMarketInstall, squadsDir } from "@/lib/projects";

export type ImportResult =
  | { ok: true; as: string; missingInMarket?: string[]; coImported?: string[] }
  | { ok: false; conflict?: true; message: string };

export type MarketCardItem = MarketItem & { profileFirstLine: string; installedIn: string[] };

/** 마켓 목록 조립 하나(§페르소나 마켓 §화면 - 다이얼로그로 연다 결정 3, 티켓 `71c41084`).
 *  `/market` 페이지와 `MarketDialog`가 이 액션 하나를 같이 부른다 — 조립 로직 두 벌을 안 둔다. */
export async function loadMarketPaneData(
  locale: Locale,
): Promise<{ items: MarketCardItem[]; projects: { id: string; name: string }[] }> {
  const [items, projects] = await Promise.all([listMarketItems(), readProjects(locale)]);
  const rows: MarketCardItem[] = await Promise.all(
    items.map(async (item) => {
      // 스쿼드는 `profile`이 항상 null이라 첫 줄도 항상 빈 문자열이다 — 별도 분기 없이
      // `getMarketItem`이 이미 그 규칙을 지킨다.
      const detail = item.kind === "persona" ? await getMarketItem("persona", item.owner, item.name) : null;
      return {
        ...item,
        profileFirstLine: detail?.profile ? firstLine(detail.profile) : "",
        installedIn: projectsThatImported(item.kind, item.owner, item.name, projects),
      };
    }),
  );
  return { items: rows, projects: projects.map((p) => ({ id: p.id, name: p.name })) };
}

function reasonMessage(reason: ImportReason, asName: string, locale: Locale): string {
  if (reason === "conflict") return t(locale, "market.import.conflict");
  if (reason === "invalidName") return wrap(t(locale, "projects.notAMarketEntryNamePrefix"), asName, "");
  return t(locale, "market.import.notFound");
}

/** 페르소나 가져오기. `asName`이 비면 원본 이름을 그대로 쓴다(화면의 기본값과 같은 규칙). */
export async function importPersonaAction(
  owner: string,
  name: string,
  projectId: string,
  asName: string,
  overwrite = false,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ImportResult> {
  try {
    const project = await getProject(projectId);
    if (!project) return { ok: false, message: `${t(locale, "projects.unknownProjectIdPrefix")} ${projectId}` };
    const to = asName.trim() || name;
    const dir = (await resolveConfig(project)).personas;
    const r = await importPersona(owner, name, dir, to, overwrite);
    if (!r.ok) {
      if (r.reason === "conflict") return { ok: false, conflict: true, message: t(locale, "market.import.conflict") };
      return { ok: false, message: reasonMessage(r.reason, to, locale) };
    }
    const item = await getMarketItem("persona", owner, name);
    const v = item!.latest; // r.ok가 참이면 방금 이 항목을 읽어 썼으므로 여기서 없을 수 없다
    await appendInstall({ at: new Date().toISOString(), kind: "persona", owner, name, v, project: projectId, as: to });
    await setMarketInstall(projectId, "personas", to, { owner, name, v }, locale);
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
    return { ok: true, as: to };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 스쿼드 가져오기. 대상에 없는 멤버 페르소나를 같이 끌어오고 마켓에도 없는 멤버는
 *  `missingInMarket`으로 돌려준다(가져오기 자체는 성공 — DESIGN.md §가져오기). */
export async function importSquadAction(
  owner: string,
  name: string,
  projectId: string,
  asName: string,
  overwrite = false,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ImportResult> {
  try {
    const project = await getProject(projectId);
    if (!project) return { ok: false, message: `${t(locale, "projects.unknownProjectIdPrefix")} ${projectId}` };
    const to = asName.trim() || name;
    const config = await resolveConfig(project);
    const r = await importSquad(owner, name, squadsDir(project), config.personas, to, overwrite);
    if (!r.ok) {
      if (r.reason === "conflict") return { ok: false, conflict: true, message: t(locale, "market.import.conflict") };
      return { ok: false, message: reasonMessage(r.reason, to, locale) };
    }
    const item = await getMarketItem("squad", owner, name);
    const v = item!.latest;
    await appendInstall({ at: new Date().toISOString(), kind: "squad", owner, name, v, project: projectId, as: to });
    await setMarketInstall(projectId, "squads", to, { owner, name, v }, locale);
    revalidatePath(`/p/${projectId}/personas`);
    revalidatePath("/market");
    return { ok: true, as: to, missingInMarket: r.missingInMarket, coImported: r.coImported };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 즐겨찾기 켜기/끄기(§화면, 티켓 `0aac85ef`) — `favorites.json` 읽고 쓰는 유일한 서버 액션.
 *  갱신된 배열을 그대로 돌려준다 — 클라이언트가 목록을 다시 안 읽어도 켜짐 상태를 안다. */
export async function toggleFavoriteAction(id: string): Promise<string[]> {
  return toggleFavorite(id);
}

/** 항목 상세(`PROFILE.md`/`members` 본문 · `skills.md`)를 다이얼로그가 열릴 때 지연 로드한다
 *  (§화면 §상세). 목록은 이미 메타(태그·버전·즐겨찾기)를 들고 있으므로 본문만 더 받는다. */
export async function getMarketItemDetailAction(
  kind: MarketKind,
  owner: string,
  name: string,
): Promise<MarketItemDetail | null> {
  return getMarketItem(kind, owner, name);
}
