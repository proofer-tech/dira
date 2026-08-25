"use server";

/** 첨부 업로드 (DESIGN.md §8) — 프로젝트 스코프의 서버 액션 하나.
 *
 *  **화면 폴더가 아니라 여기 있는 이유**: 붙는 칸이 넷이고(§8 — 발행·요구 접수는 보드,
 *  참견·이어받기는 티켓 상세와 워커 다이얼로그, 홈 질의는 홈) 넷이 서로 다른 화면 폴더에 있다.
 *  어느 한 화면의 `actions.ts`에 얹으면 나머지 셋이 그 폴더를 import한다. `app/actions.ts`도
 *  아니다 — 그 파일의 계약은 "큐 파일을 하나도 건드리지 않는다"이고 이건 큐 루트에 쓴다.
 *
 *  **새 API 라우트를 만들지 않는다**(§8 §거동). 이 앱의 쓰기는 전부 서버 액션이고 `app/api/`에
 *  있는 것은 폴링용 `awaiting` 하나다.
 *
 *  얇다 — 저장·정규화·경로 방어는 전부 `lib/attachments.ts`가 한다. 여기가 하는 일은
 *  프로젝트 id를 실물로 바꾸고 `File`이 실제로 왔는지 보는 것뿐이다. */
import { revalidatePath } from "next/cache";
import { saveAttachment } from "@/lib/attachments";
import { createEpic as writeEpic, type CreateEpicResult } from "@/lib/epics";
import { getProject } from "@/lib/projects";
import type { SaveResult } from "@/lib/attachments";
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";

export async function uploadAttachment(
  projectId: string,
  form: FormData,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SaveResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: `${t(locale, "projectActions.unknownProjectPrefix")} ${projectId}` };
  const file = form.get("file");
  // 폼은 손으로 만들 수 있다 — 문자열이 와도 `saveAttachment`에 넘기지 않는다.
  if (!(file instanceof File)) {
    return { ok: false, error: t(locale, "projectActions.fileMissing") };
  }
  return saveAttachment(project, file, locale);
}

/** 사이드바 그룹 머리의 새 에픽 입구 (DESIGN.md §에픽 결정 17) — 판정·쓰기는 전부
 *  `lib/epics.ts`의 `createEpic`이 한다(`setTicketEpic`이 `lib/epic.ts`에 위임하는 것과 같은 짝).
 *  여기가 하는 일은 프로젝트 id를 실물로 바꾸고 성공 시 보드·에픽 화면을 다시 그리는 것뿐이다. */
export async function createEpic(
  projectId: string,
  key: string,
  title: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<CreateEpicResult> {
  const project = await getProject(projectId);
  if (!project)
    return {
      ok: false,
      reason: "other",
      error: `${t(locale, "projectActions.unknownProjectPrefix")} ${projectId}`,
    };
  const r = await writeEpic(project.root, key, title);
  if (r.ok) {
    revalidatePath(`/p/${projectId}`);
    revalidatePath(`/p/${projectId}/epics`);
  }
  return r;
}
