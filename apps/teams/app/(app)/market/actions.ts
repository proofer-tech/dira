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
  getMarketItem,
  importPersona,
  importSquad,
  type ImportReason,
} from "@/lib/market";
import { getProject, resolveConfig, setMarketInstall, squadsDir } from "@/lib/projects";

export type ImportResult =
  | { ok: true; missingInMarket?: string[] }
  | { ok: false; conflict?: true; message: string };

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
    return { ok: true };
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
    return { ok: true, missingInMarket: r.missingInMarket };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
