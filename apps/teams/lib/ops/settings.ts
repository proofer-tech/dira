/** 프로젝트 설정 op 본체(P559-4, 결정 7 앞 셋): 온톨로지 자리, 컨텍스트, 통합 브랜치와 슬림.
 *  화면 서버 액션(`workers/actions.ts` `app/actions.ts`)이 같은 함수를 부르는 껍데기다. `next/*` import 금지. */
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import { resolveConfig, validateOntologyInput } from "../projects.ts";
import { setSlim, type SlimView } from "../slim.ts";
import {
  copyContext,
  listWorkers,
  readCommonContext,
  writeCommonContext,
  writeContext,
  writeIntegrationBranch,
  writeOntology,
  type WorkerContext,
} from "../workers.ts";

/** `TICKET_ONTOLOGY` 저장: 워커 전부에 같은 값을 쓴다. 빈 값은 기본값 가정으로 되돌린다(그 줄을 지운다).
 *  검증이 던지면 어느 파일도 안 건드린다. */
export async function setOntology(root: string, value: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const trimmed = value.trim();
  const resolved = trimmed ? await validateOntologyInput(root, trimmed, locale) : null;
  await writeOntology(root, resolved);
}

export async function getOntology(root: string): Promise<{ value: string }> {
  return { value: (await resolveConfig({ root })).ontology };
}

export async function getContext(root: string, locale: Locale = DEFAULT_LOCALE) {
  const workers = await listWorkers(root);
  return {
    common: await readCommonContext(root, locale),
    workers: workers.map((w) => ({ name: w.name, context: w.context })),
  };
}

/** `worker`가 있으면 그 워커 `.sh`의 `TICKET_CONTEXT` 블록, 없으면 공통 `context.sh`. */
export function setContext(
  root: string,
  worker: string | undefined,
  items: { path: string; desc: string }[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerContext> {
  return worker ? writeContext(root, worker, items, locale) : writeCommonContext(root, items, locale);
}

export { copyContext };

/** 통합 브랜치(쓰인 자리 다섯을 다시 쓴다). 빈 값 - 정규식 밖 글자는 파일을 건드리기 전에 던진다. */
export async function setIntegrationBranch(root: string, value: string, locale: Locale = DEFAULT_LOCALE) {
  const branch = value.trim();
  const changed = await writeIntegrationBranch(root, branch, locale);
  return { branch, changed };
}

/** 준 키만 바꾼다. */
export async function setProjectSettings(
  root: string,
  a: { integration_branch?: string; slim?: boolean },
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ integration_branch?: { branch: string; changed: string[] }; slim?: SlimView }> {
  const out: { integration_branch?: { branch: string; changed: string[] }; slim?: SlimView } = {};
  if (a.integration_branch !== undefined) out.integration_branch = await setIntegrationBranch(root, a.integration_branch, locale);
  if (a.slim !== undefined) out.slim = await setSlim(root, a.slim);
  return out;
}
