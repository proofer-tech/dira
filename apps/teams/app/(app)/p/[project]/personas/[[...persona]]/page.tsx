/** 페르소나 `/p/<project>/personas[/<이름>]` — `<해석된 TICKET_PERSONAS>/<이름>/PROFILE.md` 편집
 *  (DESIGN.md §5 · §선택이 경로에 담긴다).
 *
 *  **디렉터리는 `resolveConfig(project).personas`에서 받는다.** `<루트>/personas`라고 가정하면
 *  `TICKET_PERSONAS`를 재정의한 큐에서 엉뚱한 디렉터리를 편집한다(README §워커 레퍼런스가
 *  재정의를 열어뒀다). 경로 방어의 기준 디렉터리도 프로젝트 root가 아니라 그 값이다.
 *
 *  **optional catch-all 하나다** — `/personas`와 `/personas/<이름>`이 같은 이 파일이고
 *  세그먼트 없는 자리에서 리다이렉트하지 않는다(기본 선택은 목록 첫 줄, 서버가 고른다 —
 *  §6의 `?file=` 없는 자리와 같은 규약).
 *
 *  **이 값으로 경로를 조립하지 않는다.** 나열해 나온 이름과 맞춰만 보고(§6 `?core=`와 같다)
 *  안 맞으면 오른쪽 칸에 사유가 뜬다 — 그 판정은 `PersonasPane`이 든다(선택이 클라이언트
 *  상태라 서버에서 한 번 더 갈라 봐야 두 벌이 된다). */
import path from "node:path";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CreatePersonaButton, PersonasPane } from "@/components/personas-ui";
import { TitleRefs } from "@/components/queue-ref";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { listEpics, resolveMarkdownRefs } from "@/lib/epics";
import { t } from "@/lib/i18n";
import { personaActivity } from "@/lib/persona-activity";
import { listTickets } from "@/lib/queue";
import { decodeHash } from "@/lib/urls";
import {
  getProject,
  listPersonas,
  listSquads,
  readLanguage,
  resolveConfig,
  squadsDir,
  usingDefault,
} from "@/lib/projects";
import {
  claudeConfigDir,
  listInstalledSkills,
  readPersonaEngine,
  readPersonaLimit,
  readPersonaMemory,
  readPersonaOffSkillsFile,
  readPersonaSkillsFile,
} from "@/lib/skills";
import {
  ENGINES,
  lastLogByWorker,
  listWorkers,
  MODEL_RE,
  personaEngineHint,
  type PersonaRun,
} from "@/lib/workers";

// 프로필 파일은 GUI 밖에서도 바뀌고(에디터) 참조 건수는 디스패처가 바꾼다 — 굳히지 않는다.
export const dynamic = "force-dynamic";

/** 머리 2행 "마지막 활동"(§5-6 §머리, §비주얼 §66 ③) — 이 persona의 `personaRuns` 중 가장
 *  늦게 끝난 실행 하나. `4ea1147a`(활동 데이터 자리)가 서면 그 자리가 이 계산을 흡수한다 —
 *  그때까지 새 파서 없이 `lastLogByWorker`가 이미 페어링해 둔 값에서 최댓값만 뽑는다. */
function lastActivityFor(
  name: string,
  personaRuns: Record<string, PersonaRun[]>,
): { minutesAgo: number; hash: string } | null {
  let best: PersonaRun | null = null;
  for (const r of personaRuns[name] ?? []) {
    if (!best || r.endAt > best.endAt) best = r;
  }
  if (!best) return null;
  const ms = Date.now() - Date.parse(best.endAt.replace(" ", "T"));
  return { minutesAgo: Math.max(0, Math.floor(ms / 60_000)), hash: best.hash };
}

/** 이 렌더 전체가 같이 쓰는 "지금"(§비주얼 §66 ⑦ "경과" · "닫힌 상대 시각") — 컴포넌트 본문에서
 *  직접 `Date.now()`를 안 부르는 이유는 위 `lastActivityFor`와 같다(순수성 린트 —
 *  `react-hooks/purity`가 컴포넌트 본문의 impure 호출을 막는다. 평범한 함수 하나로 감싼다). */
function currentMs(): number {
  return Date.now();
}

export default async function Personas({
  params,
}: {
  params: Promise<{ project: string; persona?: string[] }>;
}) {
  const { project: id, persona } = await params;
  const locale = await readLanguage();
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  const nowMs = currentMs();
  // 티켓을 같이 읽는 이유: 프로필 없는 페르소나 경고와 삭제 경고가 둘 다 참조 건수를 쓴다.
  const tickets = await listTickets(project.root, config);
  // 스킬·메모리는 `listPersonas`와 **같은 렌더**에 실린다(§비주얼 §25 · §32 로딩 — 카드를 펼칠 때
  // 값이 이미 손에 있어 스켈레톤이 없고, 항목을 펼칠 때 요청이 없다).
  // 후보 목록(이 머신)은 페르소나 수와 무관하게 한 번이다.
  // 워커 목록도 같은 렌더에 실린다 — 엔진 미지정 힌트(§23 §개정)가 그 실효값을 여기서 읽는다.
  // `holding`은 이 힌트에 안 쓰이므로 티켓을 안 넘긴다(listWorkers 기본값 그대로).
  // 스쿼드(§5-5)는 같은 렌더에 실린다 — 페르소나 목록과 같은 왕복이어야 "프로필 없는 멤버"
  // 표식이 그 자리에서 바로 갈린다(스쿼드 후보 수와 무관하게 이 화면 렌더 한 번에 한다).
  const [personas, installed, workers, squadList] = await Promise.all([
    listPersonas(config.personas, tickets),
    listInstalledSkills(),
    listWorkers(project.root),
    listSquads(squadsDir(project)),
  ]);
  const squads = squadList.map((s) => ({
    ...s,
    // §5-5 §프로필-스쿼드가 없는 것은 경고다 — 이름이 personas 디렉터리에 없거나 PROFILE.md가
    // 없으면(body === null) "프로필 없다"는 하나의 사실이다.
    missingProfile: s.members.some((m) => !personas.some((p) => p.name === m.name && p.body !== null)),
  }));
  const engineHint = personaEngineHint(
    workers.map((w) => w.engine),
    locale,
  );
  // 머리 2행 "마지막 활동"의 출처(§5-6 §머리) — `listWorkers`가 같은 경로로 이미 읽어 뒀으니
  // `cache()`가 이 호출을 새 파일 읽기 없이 되돌린다(워커 목록과 같은 이유, workers.ts 참고).
  const { personaRuns } = await lastLogByWorker(path.join(project.root, "workers"));
  const rows = await Promise.all(
    personas.map(async (p) => {
      // 상한·엔진도 같은 렌더에 실린다(§5-4 §화면 · §제약 1 §결정 기록 §열한 번째) — 오른쪽 칸
      // 머리가 그리는 값이라 스킬·메모리와 같은 벌이다. `personaActivity`(4ea1147a)도 여기 —
      // `활동` 탭 절 넷의 출처다(§비주얼 §66, 티켓 `46d7ef1e`). `runner.log`는 `cache()`로
      // 요청당 1회다(위 `lastLogByWorker` 호출과 같은 경로 — 새 파일 읽기가 안 늘어난다).
      const [{ skills, chars }, { skills: rawOff }, { memories }, limit, engine, activity] = await Promise.all([
        readPersonaSkillsFile(config.personas, p.name),
        readPersonaOffSkillsFile(config.personas, p.name),
        readPersonaMemory(config.personas, p.name),
        readPersonaLimit(config.personas, p.name),
        readPersonaEngine(config.personas, p.name),
        personaActivity(p.name, tickets, project.root, config),
      ]);
      // 손으로 두 파일에 같은 이름을 넣어 두면 활성이 이긴다(§5-1 §충돌) — 화면은 그 이름을
      // 활성으로 한 번만 그린다. 파일 자체는 다음 저장이 고친다(savePersonaSkillsAction).
      const offSkills = rawOff.filter((o) => !skills.some((a) => a.name === o.name));
      // 머리 2행 "스쿼드 <이름>"(§5-5) — 이 이름을 멤버로 든 스쿼드들.
      const memberSquads = squads.filter((s) => s.members.some((m) => m.name === p.name)).map((s) => s.name);
      return {
        ...p,
        skills,
        skillsChars: chars,
        offSkills,
        memories,
        limit,
        engine,
        lastActivity: lastActivityFor(p.name, personaRuns),
        squads: memberSquads,
        activity,
      };
    }),
  );
  const missing = personas.filter((p) => p.body === null);
  // §5-5 §프로필-스쿼드가 없는 것은 경고다 첫 갈래 — 티켓이 `squad:`로 드는 이름의
  // `squads/<이름>/`가 없다. 둘째 갈래(멤버 중 프로필 없는 이름)는 위 `missingProfile`이
  // 왼쪽 스쿼드 줄에서 이미 표식으로 든다(dc3a2fa4) — 그릇이 갈릴 뿐 같은 경고다.
  const squadNames = new Set(squads.map((s) => s.name));
  const ticketsWithMissingSquad = tickets.filter((tk) => tk.squad && !squadNames.has(tk.squad));

  // 산문 속 해시-P번호 표식(§9) — 이 화면은 카드마다 메모리 전문을 이미 같은 렌더에 들고
  // 있다(위 `rows` 주석) - 그 전문 전부를 한 번에 훑는다. 페르소나 수와 무관하게 왕복 하나다.
  // §9 뒤쪽 절반 — 스쿼드 티켓 경고 줄의 **제목**도 같은 왕복에 얹는다(새 fs 읽기 0).
  const epics = await listEpics(project.root, tickets);
  const refs = await resolveMarkdownRefs(
    project.root,
    id,
    [...rows.flatMap((r) => r.memories.map((m) => m.text)), ...ticketsWithMissingSquad.map((tk) => tk.title)],
    tickets,
    epics,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{t(locale, "persona.word.squad")}</h1>
        {personas.length > 0 && <CreatePersonaButton projectId={id} />}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t(locale, "persona.dir.label")}</span>
        <span className="font-mono break-all">{config.personas}</span>
        {/* 색을 쓰지 않는다 — 경고가 아니라 사실이다(§8 해석 결과 표와 같은 배지) */}
        {usingDefault(config, "personas") && (
          <Badge variant="outline" title={t(locale, "persona.dir.defaultTitle")}>
            {t(locale, "persona.dir.defaultBadge")}
          </Badge>
        )}
      </div>

      {missing.length > 0 && (
        <Alert className="max-w-3xl">
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>{t(locale, "persona.missing.title")}</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <p>
                {t(locale, "persona.missing.enginePrefix")} <span className="font-mono text-xs">WARN</span>
                {t(locale, "persona.warn.engineSuffix")}{" "}
                <strong className="font-medium">{t(locale, "persona.wording.withoutPersona")}</strong>{" "}
                {t(locale, "persona.missing.dispatchDetail")}
              </p>
              {/* §5-1 · §비주얼 §25 ④ — 새 경고 UI를 만들지 않고 이 Alert에 한 절을 덧붙인다.
                  §32 ⑤가 그 문장을 메모리까지 넓혔다: 사실이 하나고 근거가 하나라(둘 다 페르소나
                  프롬프트 안에 있다) 문장을 하나 더 붙이지 않는다 */}
              <p>{t(locale, "persona.missing.noSkillsMemory")}</p>
              {missing.map((p) => (
                <p key={p.name} className="font-mono text-xs break-all">
                  {p.name} {t(locale, "persona.missing.refsMiddle")} {p.refs.total}
                  {t(locale, "persona.missing.refsSuffix")} {p.file}
                </p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* §5-5 §프로필-스쿼드가 없는 것은 경고다 — 같은 Alert 그릇, 새 컴포넌트 0 · 새 문구
          규칙 0(위 `missing` 블록과 같은 조립: WARN 한 줄 안내 + 해시별 목록). */}
      {ticketsWithMissingSquad.length > 0 && (
        <Alert className="max-w-3xl">
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>{t(locale, "persona.squadWarn.title")}</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <p>
                {t(locale, "persona.squadWarn.enginePrefix")} <span className="font-mono text-xs">WARN</span>
                {t(locale, "persona.warn.engineSuffix")}{" "}
                <strong className="font-medium">{t(locale, "persona.squadWarn.strongLabel")}</strong>
                {t(locale, "persona.squadWarn.parenPrefix")} {t(locale, "persona.wording.withoutPersona")}
                {t(locale, "persona.squadWarn.parenSuffix")}
              </p>
              {ticketsWithMissingSquad.map((tk) => (
                <p key={tk.hash} className="font-mono text-xs break-all">
                  {tk.hash} — squad: {tk.squad} ·{" "}
                  {tk.title ? <TitleRefs title={tk.title} refs={refs} locale={locale} /> : tk.title}
                </p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {personas.length === 0 && squads.length === 0 ? (
        // 둘 다 0개면 2단을 안 그린다(§5, §비주얼 §61 (8)) — 페르소나 0 + 스쿼드 n>0에서
        // 걷으면 방금 만든 스쿼드가 화면에서 사라지고 지울 길이 없어진다(이름이 한
        // 이름공간이라 그 이름의 페르소나도 못 만든다)
        <EmptyState text={t(locale, "persona.empty.title")} action={<CreatePersonaButton projectId={id} />} />
      ) : (
        // ponytail: 폭 제한 없음 — §5의 §4 예외. 2단만 전체 폭이고 경고 Alert는 문단 폭이다.
        // 색은 큐가 아니라 레지스트리에 있다(§5) — 같은 서버 렌더에 실려서 점 스켈레톤이 없다
        <PersonasPane
          projectId={id}
          // 세그먼트는 퍼센트 인코딩된 원문으로 온다(`lib/urls.ts` `decodeHash` 주석). 여럿이면
          // 이어 붙여 넘긴다 — 이름 규칙이 `^[A-Za-z0-9_-]+$`라 슬래시가 든 이름은 없고,
          // 안 맞는 값 하나로 같은 사유가 뜬다(§5 §선택이 경로에 담긴다).
          initial={persona?.map(decodeHash).join("/") ?? null}
          rows={rows}
          squads={squads}
          colors={project.personaColors ?? {}}
          installed={installed}
          configDir={claudeConfigDir()}
          engines={ENGINES}
          modelPattern={MODEL_RE.source}
          engineHint={engineHint}
          refs={refs}
          nowMs={nowMs}
        />
      )}
    </div>
  );
}
