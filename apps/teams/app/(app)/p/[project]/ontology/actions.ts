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
import { startMigration } from "@/app/(app)/p/[project]/home/actions";
import { track } from "@/lib/analytics";
import { kickIdleWorker } from "@/lib/kick";
import { buildOntologySeedFiles, type OntologySurveyAnswers } from "@/lib/ontology-seed";
import { createFile, deleteFile, listTree, renameFile, saveFile } from "@/lib/protocols";
import { getProject, ontologyDir, resolveConfig } from "@/lib/projects";
import { ONTOLOGY_FIX_MARKER, openFixTicket, listTickets, stemOf, type Suffixes } from "@/lib/queue";

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
 *  시드가 서면 첫 채움(§5-3 §첫 채움)을 잇는다 — `startMigration`이 홈 대화에 마이그레이션
 *  세션을 띄운다. 시드 쓰기와 같은 자리에서 `void`로 띄우므로 이 액션도 첫 채움을 안 기다린다.
 *  `startMigration`은 실패해도 던지지 않고 `Answer`로 물러난다(자기 안의 try/catch) — 시드는
 *  이미 남은 뒤이므로 이 제출 액션은 그 결과와 상관없이 끝나 있다. */
export async function submitOntologySurveyAction(
  projectId: string,
  answers: OntologySurveyAnswers,
): Promise<OntologyResult> {
  try {
    const base = await baseOf(projectId);
    void writeSeed(base, answers)
      .then(() => startMigration(projectId))
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

/** 큐 디렉터리에 정리 티켓 한 장을 쓴다 — `(board)/actions.ts` `createTicket`과 같은 해시 뽑기
 *  (`wx`로 여는 것 자체가 검사)다. 그 파일에서 가져오지 못한다(`"use server"`는 헬퍼를 못
 *  내보낸다, 그 파일 머리 주석의 `fmValue`와 같은 대가) — 이 헬퍼는 이 액션 하나만 쓴다. */
async function writeFixTicket(root: string, sfx: Suffixes, violations: string[]): Promise<string> {
  const dir = path.join(root, "tickets");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
  const stems = new Set(names.map((n) => stemOf(n, sfx)));

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

  const text = (h: string) =>
    [
      "---",
      `ticket: ${h}`,
      `title: 온톨로지 스키마 위반 ${n}건 정리`,
      "kind: work",
      "persona: archive-manager",
      `fixes: ${ONTOLOGY_FIX_MARKER}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

  for (let i = 0; i < 10; i++) {
    const h = randomUUID().slice(0, 8);
    if (stems.has(h)) continue;
    const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; // 졌다 — 다시 뽑는다
      throw e;
    });
    if (!fh) continue;
    try {
      await fh.writeFile(text(h), "utf8");
    } finally {
      await fh.close();
    }
    return h;
  }
  throw new Error("해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.");
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
