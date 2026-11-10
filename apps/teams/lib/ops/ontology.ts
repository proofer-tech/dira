/** 온톨로지 쓰기 op 본체(P559-8). `app/(app)/p/[project]/ontology/actions.ts`의 서버 액션이 여기를 부르고
 *  `revalidatePath`와 프로젝트 id 해석만 더한다. `next/*` import 금지 - `cli.ts`가 화면 서버 없이 돌린다. */
import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { track } from "../analytics.ts";
import { kickIdleWorker } from "../kick.ts";
import { loadMetrics } from "../ontology-load.ts";
import { isDiraFormat, type OntologyMetrics } from "../ontology.ts";
import { buildOntologySeedFiles, type OntologySurveyAnswers } from "../ontology-seed.ts";
import { DEFAULT_LOCALE, t, type Locale } from "../i18n.ts";
import { isRealDirectory } from "../paths.ts";
import { createFile, listTree, saveFile } from "../protocols.ts";
import type { Project, ProjectConfig } from "../projects.ts";
import {
  ONTOLOGY_FIX_MARKER,
  ONTOLOGY_MIGRATION_MARKER,
  ontologyImportMarker,
  openFixTicket,
  listTickets,
  stemOf,
  type Suffixes,
} from "../queue.ts";

export type PublishTicketResult = { ok: true; stem: string } | { ok: false; message: string };
export type FixTicketResult = PublishTicketResult;
export type OntologyCtx = { project: Project; config: ProjectConfig; locale: Locale };

export async function writeSeed(base: string, answers: OntologySurveyAnswers): Promise<void> {
  for (const file of buildOntologySeedFiles(answers)) {
    const rel = await createFile(base, file.rel);
    await saveFile(base, rel, file.text);
  }
}

// ── 위반 카드 `문제해결` (§P230) ─────────────────────────────────────────────

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
  locale: Locale = DEFAULT_LOCALE,
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
  throw new Error(t(locale, "ontology.action.hashExhausted"));
}

function writeFixTicket(root: string, sfx: Suffixes, violations: string[], locale: Locale): Promise<string> {
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
    locale,
  );
}

/** 위반 카드의 `문제해결`(§P230). 판정(`openFixTicket`)은 카드가 버튼/링크를 고를 때 부르는
 *  것과 같은 함수다 — 발행 직전에 큐를 다시 훑어 이미 열려있거나 도는 정리 티켓이 있으면
 *  새로 만들지 않고 그 stem을 돌려준다(실패가 아니다 — 사람이 원한 상태가 이미 떠 있다).
 *  탭이 둘이거나 요청을 손으로 만들어도 이 재확인을 지날 수 없다. */
export async function fixOntologySchemaOp(c: OntologyCtx): Promise<FixTicketResult> {
  try {
    const { project, config, locale } = c;

    const tickets = await listTickets(project.root, config);
    const existing = openFixTicket(tickets, ONTOLOGY_FIX_MARKER);
    if (existing) return { ok: true, stem: existing.stem };

    const base = config.ontology;
    const tree = await listTree(base);
    // 위반 문장은 화면이 아니라 정리 티켓 본문(§P230)에 박힌다 — 산출물은 로케일 무관 한국어
    // 고정이다(§0-16 §장치 §사전의 범위, `ontology-seed.ts`와 같은 판단, `2ef7a4e9`).
    const metrics = tree.length > 0 ? await loadMetrics(base, tree, DEFAULT_LOCALE) : null;

    const stem = await writeFixTicket(project.root, config, metrics?.schemaViolations ?? [], locale);
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
    return { ok: true, stem };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ── 온톨로지 세션 셋이 큐 티켓으로 돈다 (§5-3) ───────────────────────────────

/** 설정 다이얼로그의 `마이그레이션 시작`이 보내던 고정 질문 — 옛 `home/actions.ts`의
 *  `MIGRATION_QUESTION` 그대로다(§5-3: "질문 문자열을 새로 안 짓는다"). **규칙은 여기 없다** —
 *  `protocols/ontology.md` §마이그레이션 절차·§판정 5단계·§기록이 정본이고, 이 문장은 그
 *  문서를 펴서 그 절차로 돌라고 시키는 것뿐이다. */
const MIGRATION_GOAL = `온톨로지 마이그레이션을 시작하세요. \`protocols/ontology.md\` §마이그레이션 절차를 그대로
따르고, 그 문서의 판정 5단계로 사실과 교훈을 가르세요 — 여기서 규칙을 다시 적지 않습니다.

- 이 프로젝트의 온톨로지 루트에 dira 층이 없으면 새로 세우고, 있으면 지금 규약으로 다시 올리세요. 재실행은 정상 사용입니다.
- 사람이 손으로 고친 객체는 덮어쓰지 않고, 이미 규약에 맞는 파일은 건드리지 않습니다.
- 온톨로지 루트 밖에 쌓인 옛 방식 산출물이 있으면 판정 5단계로 걸러 사실만 객체로 옮기고,
  판단·교훈은 해당 페르소나의 \`memory/\`로 이관하세요. 원본은 지우지 않습니다.
- 루트에 dira 층 없이 노트만 있으면 제자리 변환입니다. 원본을 옮기거나 고치거나 지우지 않고, 방법은
  그 절의 제자리 변환 항목을 따르세요.
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
/** 실패하면 §0-25의 A/S가 화면 쪽(`projects-ui.tsx`)에서 한 번 돈다(결정 7-8) — 이 액션은
 *  자기 조작 한 번만 하고 결과를 그대로 돌려준다. */
export async function publishOntologyMigrationOp(c: OntologyCtx): Promise<PublishTicketResult> {
  try {
    const { project, config, locale } = c;

    const tickets = await listTickets(project.root, config);
    const existing = openFixTicket(tickets, ONTOLOGY_MIGRATION_MARKER);
    if (existing) return { ok: true, stem: existing.stem };

    const stem = await writeQueueTicket(
      project.root,
      config,
      (h) => markerTicketFm(h, ONTOLOGY_MIGRATION_MARKER, "온톨로지 마이그레이션"),
      publishBody(MIGRATION_GOAL),
      locale,
    );
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
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
/** 실패하면 §0-25의 A/S가 화면 쪽(`ontology-ui.tsx`)에서 한 번 돈다(결정 7-8) — 이 액션은
 *  자기 조작 한 번만 하고 결과를 그대로 돌려준다. */
export async function publishOntologyImportOp(c: OntologyCtx, folder: string): Promise<PublishTicketResult> {
  try {
    const { locale } = c;
    if (!(await isRealDirectory(folder))) {
      // 같은 문장을 온톨로지 자리 편집 폼도 던진다 — 새 키를 안 만들고 그대로 재사용한다
      // (§0-16, `2ef7a4e9`).
      return { ok: false, message: `${t(locale, "ontology.location.notDirectory")} ${folder}` };
    }
    const { project, config } = c;

    const tickets = await listTickets(project.root, config);
    const marker = ontologyImportMarker(folder);
    const existing = openFixTicket(tickets, marker);
    if (existing) return { ok: true, stem: existing.stem };

    const stem = await writeQueueTicket(
      project.root,
      config,
      (h) => markerTicketFm(h, marker, `온톨로지 import - ${path.basename(folder)}`),
      publishBody(importGoal(folder)),
      locale,
    );
    void track("ticket_create", { kind: "work" });
    await kickIdleWorker(project.root);
    return { ok: true, stem };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function ontologyMetricsOp(c: OntologyCtx): Promise<{ ok: true; metrics: OntologyMetrics | null } | { ok: false; message: string }> {
  try {
    const base = c.config.ontology;
    const tree = await listTree(base);
    if (tree.length === 0 || !isDiraFormat(tree)) return { ok: true, metrics: null };
    return { ok: true, metrics: await loadMetrics(base, tree, c.locale) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 설문 제출: 시드를 쓰고 첫 채움 티켓을 발행한다. 화면 액션은 이 약속을 기다리지 않는다(폼이 LLM을 안 기다린다). */
export async function submitSurveyOp(c: OntologyCtx, answers: OntologySurveyAnswers): Promise<void> {
  await writeSeed(c.config.ontology, answers);
  await publishOntologyMigrationOp(c);
}
