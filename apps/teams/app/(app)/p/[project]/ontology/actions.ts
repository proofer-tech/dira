"use server";

/** 온톨로지 화면의 서버 액션 — 저장 · 새 파일 · 삭제 · 이름변경.
 *
 *  `protocols/actions.ts`와 같은 분담: fs는 `lib/protocols.ts`가, 여기는 프로젝트 id → 기준
 *  디렉터리 해석과 Error 직렬화만 한다. 기준은 `ontologyDir()` 하나뿐이다(재정의를 안 연다). */
import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { loadMetrics } from "@/app/(app)/p/[project]/ontology/page";
import { track } from "@/lib/analytics";
import { kickIdleWorker } from "@/lib/kick";
import { buildOntologySeedFiles, type OntologySurveyAnswers } from "@/lib/ontology-seed";
import { isRealDirectory } from "@/lib/paths";
import { createFile, deleteFile, listTree, renameFile, saveFile } from "@/lib/protocols";
import { getProject, ontologyDir, resolveConfig } from "@/lib/projects";
import {
  ONTOLOGY_FIX_MARKER,
  ONTOLOGY_MIGRATION_MARKER,
  ontologyImportMarker,
  openFixTicket,
  listTickets,
  stemOf,
  type Suffixes,
} from "@/lib/queue";

export type OntologyResult = {
  ok: boolean;
  message?: string;
  /** 생성·이름변경 후 선택할 상대경로. 화면이 `?file=`을 여기로 옮긴다 */
  rel?: string;
};

async function baseOf(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
  return ontologyDir(project);
}

function fail(e: unknown): OntologyResult {
  return { ok: false, message: (e as Error).message };
}

export async function saveOntologyAction(
  projectId: string,
  rel: string,
  text: string,
): Promise<OntologyResult> {
  try {
    await saveFile(await baseOf(projectId), rel, text);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel };
  } catch (e) {
    return fail(e);
  }
}

export async function createOntologyAction(projectId: string, rel: string): Promise<OntologyResult> {
  try {
    const created = await createFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel: created };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteOntologyAction(projectId: string, rel: string): Promise<OntologyResult> {
  try {
    await deleteFile(await baseOf(projectId), rel);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameOntologyAction(
  projectId: string,
  from: string,
  to: string,
): Promise<OntologyResult> {
  try {
    const moved = await renameFile(await baseOf(projectId), from, to);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, rel: moved };
  } catch (e) {
    return fail(e);
  }
}

/** 생성 — 설문 4문항 응답 → `SCHEMA.md` 시드(§5-3 §생성 — 설문 4문항). **폼은 여기서 바로
 *  끝난다.** 실제 쓰기(`writeSeed`)를 기다리지 않고 반환한다 — 지금은 결정적 빌더
 *  (`buildOntologySeed`)라 사실상 즉시 끝나지만, 응답 수집과 시드 생성을 구조적으로 가르는
 *  것 자체가 계약이다("폼이 LLM을 안 기다린다"). `home-agent.ts`의 `startAsk`가 같은 결로
 *  "띄우고 바로 돌아온다"를 쓴다.
 *
 *  시드가 서면 첫 채움(§5-3 §첫 채움)을 잇는다 — `publishOntologyMigrationAction`이 마이그레이션
 *  티켓 한 장을 큐에 발행한다(§5-3: "제출이 마이그레이션 티켓을 자동 발행"). 시드 쓰기와 같은
 *  자리에서 `void`로 띄우므로 이 액션도 첫 채움을 안 기다린다. 발행 액션은 실패해도 던지지 않고
 *  `PublishTicketResult`로 물러난다(자기 안의 try/catch) — 시드는 이미 남은 뒤이므로 이 제출
 *  액션은 그 결과와 상관없이 끝나 있다. */
export async function submitOntologySurveyAction(
  projectId: string,
  answers: OntologySurveyAnswers,
): Promise<OntologyResult> {
  try {
    const base = await baseOf(projectId);
    void writeSeed(base, answers)
      .then(() => publishOntologyMigrationAction(projectId))
      .catch((e: unknown) => {
        console.error("온톨로지 시드 생성 실패:", e);
      });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `_ontology/SCHEMA.md`(지도) + 타입·관계마다 정의 파일 + `templates/<타입>.md`까지 한 번에
 *  쓴다(§5-3 §생성·§형식이 vault 레퍼런스로 간다 §①②). 파일마다 `createFile`(O_EXCL) 다음
 *  `saveFile`이다 — 순서를 지키는 이유는 `createFile`이 중간 디렉터리를 만들어 주기 때문이다. */
async function writeSeed(base: string, answers: OntologySurveyAnswers): Promise<void> {
  for (const file of buildOntologySeedFiles(answers)) {
    const rel = await createFile(base, file.rel);
    await saveFile(base, rel, file.text);
  }
}

// ── 위반 카드 `문제해결` (§P230) ─────────────────────────────────────────────

export type FixTicketResult = { ok: true; stem: string } | { ok: false; message: string };

const VIOLATION_LINES_MAX = 50;

/** `## 위반 목록` 절 본문 — 측정 시각 + 위반 줄. 상한 50줄, 넘치면 `외 N건`(§P230 — 위반이
 *  수백 건인 프로젝트에서 큐 파일을 안 터뜨린다. 남은 것은 다음 회차가 받는다). */
function violationSection(now: string, violations: string[]): string {
  const shown = violations.slice(0, VIOLATION_LINES_MAX);
  const rest = violations.length - shown.length;
  const lines = shown.map((v) => `- ${v}`);
  if (rest > 0) lines.push(`- 외 ${rest}건`);
  return [`측정 시각: ${now}`, "", ...lines].join("\n");
}

/** 큐 디렉터리에 티켓 한 장을 쓴다 — `(board)/actions.ts` `createTicket`과 같은 해시 뽑기
 *  (`wx`로 여는 것 자체가 검사)다. 그 파일에서 가져오지 못한다(`"use server"`는 헬퍼를 못
 *  내보낸다, 그 파일 머리 주석의 `fmValue`와 같은 대가) — 이 파일의 발행 액션들이 공유한다.
 *  `frontmatter`는 뽑힌 해시를 받아 `---`로 감싼 블록(마지막 줄 포함, 다음 줄이 비어야 한다)을
 *  돌려준다. */
async function writeQueueTicket(
  root: string,
  sfx: Suffixes,
  frontmatter: (hash: string) => string,
  body: string,
): Promise<string> {
  const dir = path.join(root, "tickets");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
  const stems = new Set(names.map((n) => stemOf(n, sfx)));

  for (let i = 0; i < 10; i++) {
    const h = randomUUID().slice(0, 8);
    if (stems.has(h)) continue;
    const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; // 졌다 — 다시 뽑는다
      throw e;
    });
    if (!fh) continue;
    try {
      await fh.writeFile(`${frontmatter(h)}\n\n${body}\n`, "utf8");
    } finally {
      await fh.close();
    }
    return h;
  }
  throw new Error("해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.");
}

function writeFixTicket(root: string, sfx: Suffixes, violations: string[]): Promise<string> {
  const n = violations.length;
  const body = [
    "## Goal",
    "",
    `온톨로지 스키마 위반 ${n}건을 정리한다.`,
    "",
    "## 위반 목록",
    "",
    violationSection(new Date().toISOString(), violations),
    "",
    "## Done when",
    "",
    "- [ ] 위 목록의 줄마다 무엇을 고쳤는지(또는 왜 위반이 아닌지) `## 결과`에 적는다",
    "- [ ] 반영을 `ontology/action-log/`에 한 줄 남긴다",
  ].join("\n");

  return writeQueueTicket(
    root,
    sfx,
    (h) =>
      [
        "---",
        `ticket: ${h}`,
        `title: 온톨로지 스키마 위반 ${n}건 정리`,
        "kind: work",
        "persona: archive-manager",
        `fixes: ${ONTOLOGY_FIX_MARKER}`,
        "---",
      ].join("\n"),
    body,
  );
}

/** 위반 카드의 `문제해결`(§P230). 판정(`openFixTicket`)은 카드가 버튼/링크를 고를 때 부르는
 *  것과 같은 함수다 — 발행 직전에 큐를 다시 훑어 이미 열려있거나 도는 정리 티켓이 있으면
 *  새로 만들지 않고 그 stem을 돌려준다(실패가 아니다 — 사람이 원한 상태가 이미 서 있다).
 *  탭이 둘이거나 요청을 손으로 만들어도 이 재확인을 지날 수 없다. */
export async function fixOntologySchemaAction(projectId: string): Promise<FixTicketResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);

    const tickets = await listTickets(project.root, config);
    const existing = openFixTicket(tickets, ONTOLOGY_FIX_MARKER);
    if (existing) return { ok: true, stem: existing.stem };

    const base = ontologyDir(project);
    const tree = await listTree(base);
    const metrics = tree.length > 0 ? await loadMetrics(base, tree) : null;

    const stem = await writeFixTicket(project.root, config, metrics?.schemaViolations ?? []);
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, stem };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ── 온톨로지 세션 셋이 큐 티켓으로 돈다 (§5-3) ───────────────────────────────

export type PublishTicketResult = { ok: true; stem: string } | { ok: false; message: string };

/** 설정 다이얼로그의 `마이그레이션 시작`이 보내던 고정 질문 — 옛 `home/actions.ts`의
 *  `MIGRATION_QUESTION` 그대로다(§5-3: "질문 문자열을 새로 안 짓는다"). **규칙은 여기 없다** —
 *  `protocols/ontology.md` §마이그레이션 절차·§판정 5단계·§기록이 정본이고, 이 문장은 그
 *  문서를 펴서 그 절차로 돌라고 시키는 것뿐이다. */
const MIGRATION_GOAL = `온톨로지 마이그레이션을 시작하세요. \`protocols/ontology.md\` §마이그레이션 절차를 그대로
따르고, 그 문서의 판정 5단계로 사실과 교훈을 가르세요 — 여기서 규칙을 다시 적지 않습니다.

- \`ontology/\`가 없으면 새로 세우고, 있으면 지금 규약으로 다시 올리세요. 재실행은 정상 사용입니다.
- 사람이 손으로 고친 객체는 덮어쓰지 않고, 이미 규약에 맞는 파일은 건드리지 않습니다.
- \`ontology/\` 밖에 쌓인 옛 방식 산출물이 있으면 판정 5단계로 걸러 사실만 객체로 옮기고,
  판단·교훈은 해당 페르소나의 \`memory/\`로 이관하세요. 원본은 지우지 않습니다.
- 끝나면 이번 회차에 한 일을 §기록의 액션 종류(새객체·값갱신·관계추가·관계삭제·스키마개정·빈손)로
  나눠 답 마지막에 요약하세요. 해당 없는 종류는 적지 않아도 됩니다.`;

/** `가져오기`가 보내던 질문 — 옛 `home/actions.ts`의 `importQuestion(folder)` 그대로다.
 *  규칙은 `protocols/ontology.md` §import(§마이그레이션 절차를 물려받는다)가 정본이다. */
function importGoal(folder: string): string {
  return `\`${folder}\` 폴더를 import하세요. \`protocols/ontology.md\` §import 절을 펴서 그
절차를 그대로 따르세요 — 판정 5단계, 재실행 안전, 사실 뽑은 원본만 datasources/로 떠 오기,
\`<출처>\` 이름 규칙까지 그 절이 정한 그대로입니다. 여기서 규칙을 다시 적지 않습니다.`;
}

/** 발행 티켓의 `## Goal` + `## Done when` 본문 — 스펙의 두 항 그대로다(§5-3 §티켓 한 장). */
function publishBody(goal: string): string {
  return [
    "## Goal",
    "",
    goal,
    "",
    "## Done when",
    "",
    "- [ ] 이번 회차에 한 일을 §기록의 액션 종류(새객체 - 값갱신 - 관계추가 - 관계삭제 - 스키마개정 - 빈손)로 나눠 `## 결과`에 적는다",
    "- [ ] 반영을 `ontology/action-log/`에 한 줄 남긴다",
  ].join("\n");
}

/** 발행 티켓 frontmatter — 스펙 표 그대로다(§5-3 §티켓 한 장): `kind: work` · `persona:
 *  archive-manager` · `priority` 키 없음 · `deps` 없음 · `fixes:` 마커 · `title`. 아카이브
 *  티켓을 안 낸다(persona가 이미 `archive-manager`라 완료 트리거의 예외가 그대로 걸린다). */
const markerTicketFm = (h: string, marker: string, title: string) =>
  ["---", `ticket: ${h}`, `title: ${title}`, "kind: work", "persona: archive-manager", `fixes: ${marker}`, "---"].join(
    "\n",
  );

/** 설정 다이얼로그의 `마이그레이션 시작` + 설문 제출 직후 첫 채움이 부르는 발행(§5-3 표).
 *  판정은 `fixOntologySchemaAction`과 같은 함수(`openFixTicket`) — 발행 직전에 큐를 다시
 *  훑어 이미 열려있는 마이그레이션 티켓이 있으면 새로 만들지 않고 그 stem을 돌려준다(실패가
 *  아니다). 마커는 프로젝트당 한 장이라 `마이그레이션 시작`과 첫 채움이 같은 티켓을 가리킨다. */
export async function publishOntologyMigrationAction(projectId: string): Promise<PublishTicketResult> {
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);

    const tickets = await listTickets(project.root, config);
    const existing = openFixTicket(tickets, ONTOLOGY_MIGRATION_MARKER);
    if (existing) return { ok: true, stem: existing.stem };

    const stem = await writeQueueTicket(
      project.root,
      config,
      (h) => markerTicketFm(h, ONTOLOGY_MIGRATION_MARKER, "온톨로지 마이그레이션"),
      publishBody(MIGRATION_GOAL),
    );
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, stem };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 온톨로지 화면 설정 다이얼로그·`/p/<project>/ontology`의 `가져오기`가 부르는 발행(§5-3 표).
 *  `folder`는 신뢰 경계 밖이다(클라이언트가 고른 값) — 마커가 되기 전에 절대경로·실재하는
 *  디렉터리인지 서버가 본다(옛 `startImport`가 하던 검사 그대로, §import §실행층). 같은
 *  폴더로 다시 부르면 열린 티켓을 그대로 돌려준다 — 마커가 폴더 절대경로를 그대로 담기 때문에
 *  다른 폴더는 서로를 안 막는다. */
export async function publishOntologyImportAction(
  projectId: string,
  folder: string,
): Promise<PublishTicketResult> {
  try {
    if (!(await isRealDirectory(folder))) {
      return { ok: false, message: `실재하는 디렉터리가 아닙니다: ${folder}` };
    }
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);

    const tickets = await listTickets(project.root, config);
    const marker = ontologyImportMarker(folder);
    const existing = openFixTicket(tickets, marker);
    if (existing) return { ok: true, stem: existing.stem };

    const stem = await writeQueueTicket(
      project.root,
      config,
      (h) => markerTicketFm(h, marker, `온톨로지 import - ${path.basename(folder)}`),
      publishBody(importGoal(folder)),
    );
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
    revalidatePath(`/p/${projectId}/ontology`);
    return { ok: true, stem };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
