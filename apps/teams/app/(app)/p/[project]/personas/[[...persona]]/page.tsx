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
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CreatePersonaButton, PersonasPane } from "@/components/personas-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { listTickets } from "@/lib/queue";
import { decodeHash } from "@/lib/urls";
import { getProject, listPersonas, resolveConfig, usingDefault } from "@/lib/projects";
import {
  claudeConfigDir,
  listInstalledSkills,
  readPersonaEngine,
  readPersonaLimit,
  readPersonaMemory,
  readPersonaOffSkillsFile,
  readPersonaSkillsFile,
} from "@/lib/skills";
import { ENGINES, listWorkers, MODEL_RE, personaEngineHint } from "@/lib/workers";

// 프로필 파일은 GUI 밖에서도 바뀌고(에디터) 참조 건수는 디스패처가 바꾼다 — 굳히지 않는다.
export const dynamic = "force-dynamic";

export default async function Personas({
  params,
}: {
  params: Promise<{ project: string; persona?: string[] }>;
}) {
  const { project: id, persona } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  // 티켓을 같이 읽는 이유: 프로필 없는 페르소나 경고와 삭제 경고가 둘 다 참조 건수를 쓴다.
  const tickets = await listTickets(project.root, config);
  // 스킬·메모리는 `listPersonas`와 **같은 렌더**에 실린다(§비주얼 §25 · §32 로딩 — 카드를 펼칠 때
  // 값이 이미 손에 있어 스켈레톤이 없고, 항목을 펼칠 때 요청이 없다).
  // 후보 목록(이 머신)은 페르소나 수와 무관하게 한 번이다.
  // 워커 목록도 같은 렌더에 실린다 — 엔진 미지정 힌트(§23 §개정)가 그 실효값을 여기서 읽는다.
  // `holding`은 이 힌트에 안 쓰이므로 티켓을 안 넘긴다(listWorkers 기본값 그대로).
  const [personas, installed, workers] = await Promise.all([
    listPersonas(config.personas, tickets),
    listInstalledSkills(),
    listWorkers(project.root),
  ]);
  const engineHint = personaEngineHint(workers.map((w) => w.engine));
  const rows = await Promise.all(
    personas.map(async (p) => {
      // 상한·엔진도 같은 렌더에 실린다(§5-4 §화면 · §제약 1 §결정 기록 §열한 번째) — 오른쪽 칸
      // 머리가 그리는 값이라 스킬·메모리와 같은 벌이다
      const [{ skills, chars }, { skills: rawOff }, { memories }, limit, engine] = await Promise.all([
        readPersonaSkillsFile(config.personas, p.name),
        readPersonaOffSkillsFile(config.personas, p.name),
        readPersonaMemory(config.personas, p.name),
        readPersonaLimit(config.personas, p.name),
        readPersonaEngine(config.personas, p.name),
      ]);
      // 손으로 두 파일에 같은 이름을 넣어 두면 활성이 이긴다(§5-1 §충돌) — 화면은 그 이름을
      // 활성으로 한 번만 그린다. 파일 자체는 다음 저장이 고친다(savePersonaSkillsAction).
      const offSkills = rawOff.filter((o) => !skills.some((a) => a.name === o.name));
      return { ...p, skills, skillsChars: chars, offSkills, memories, limit, engine };
    }),
  );
  const missing = personas.filter((p) => p.body === null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">페르소나</h1>
        {personas.length > 0 && <CreatePersonaButton projectId={id} />}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">디렉터리</span>
        <span className="font-mono break-all">{config.personas}</span>
        {/* 색을 쓰지 않는다 — 경고가 아니라 사실이다(§8 해석 결과 표와 같은 배지) */}
        {usingDefault(config, "personas") && (
          <Badge variant="outline" title="워커 파일에서 TICKET_PERSONAS를 찾지 못해 기본값을 씁니다">
            기본값 가정
          </Badge>
        )}
      </div>

      {missing.length > 0 && (
        <Alert className="max-w-3xl">
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>프로필 파일이 없는 페르소나가 있습니다</AlertTitle>
          <AlertDescription>
            <div className="space-y-1">
              <p>
                엔진은 이 이름을 만나면 <span className="font-mono text-xs">WARN</span>만 남기고{" "}
                <strong className="font-medium">페르소나 없이</strong> 디스패치합니다 — 디스패치가
                실패하는 게 아니라, 세션이 역할·권한을 모르는 채로 시작합니다. 그 이름을 왼쪽에서
                고르고 오른쪽의 빈 본문을 채워 저장하면 파일이 만들어집니다.
              </p>
              {/* §5-1 · §비주얼 §25 ④ — 새 경고 UI를 만들지 않고 이 Alert에 한 절을 덧붙인다.
                  §32 ⑤가 그 문장을 메모리까지 넓혔다: 사실이 하나고 근거가 하나라(둘 다 페르소나
                  프롬프트 안에 산다) 문장을 하나 더 붙이지 않는다 */}
              <p>
                프로필이 없으면 스킬·메모리도 실리지 않습니다 — 두 블록 다 페르소나 프롬프트 안에
                삽니다.
              </p>
              {missing.map((p) => (
                <p key={p.name} className="font-mono text-xs break-all">
                  {p.name} — 티켓 {p.refs.total}건이 참조 · {p.file}
                </p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {personas.length === 0 ? (
        // 0개면 2단을 안 그린다(§5) — 고를 것도 그릴 것도 없는 빈 칸 두 개가 서면 고장으로 읽힌다
        <EmptyState text="페르소나 없음" action={<CreatePersonaButton projectId={id} />} />
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
          colors={project.personaColors ?? {}}
          installed={installed}
          configDir={claudeConfigDir()}
          engines={ENGINES}
          modelPattern={MODEL_RE.source}
          engineHint={engineHint}
        />
      )}
    </div>
  );
}
