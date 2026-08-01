/** 페르소나 `/p/<project>/personas` — `<해석된 TICKET_PERSONAS>/<이름>/PROFILE.md` 편집 (DESIGN.md §5).
 *
 *  **디렉터리는 `resolveConfig(project).personas`에서 받는다.** `<루트>/personas`라고 가정하면
 *  `TICKET_PERSONAS`를 재정의한 큐에서 엉뚱한 디렉터리를 편집한다(README §워커 레퍼런스가
 *  재정의를 열어뒀다). 경로 방어의 기준 디렉터리도 프로젝트 root가 아니라 그 값이다. */
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CreatePersonaButton, PersonaCard } from "@/components/personas-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { listTickets } from "@/lib/queue";
import { getProject, listPersonas, resolveConfig, usingDefault } from "@/lib/projects";
import { claudeConfigDir, listInstalledSkills, readPersonaSkillsFile } from "@/lib/skills";

// 프로필 파일은 GUI 밖에서도 바뀌고(에디터) 참조 건수는 디스패처가 바꾼다 — 굳히지 않는다.
export const dynamic = "force-dynamic";

export default async function Personas({ params }: { params: Promise<{ project: string }> }) {
  const { project: id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  // 티켓을 같이 읽는 이유: 프로필 없는 페르소나 경고와 삭제 경고가 둘 다 참조 건수를 쓴다.
  const tickets = await listTickets(project.root, config);
  // 스킬은 `listPersonas`와 **같은 렌더**에 실린다(§비주얼 §25 로딩 — 카드를 펼칠 때 값이 이미
  // 손에 있어 스켈레톤이 없다). 후보 목록(이 머신)은 페르소나 수와 무관하게 한 번이다.
  const [personas, installed] = await Promise.all([
    listPersonas(config.personas, tickets),
    listInstalledSkills(),
  ]);
  const rows = await Promise.all(
    personas.map(async (p) => {
      const { skills, chars } = await readPersonaSkillsFile(config.personas, p.name);
      return { ...p, skills, skillsChars: chars };
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
                실패하는 게 아니라, 세션이 역할·권한을 모르는 채로 시작합니다. 아래 카드의 빈
                본문을 채워 저장하면 파일이 만들어집니다.
              </p>
              {/* §5-1 · §비주얼 §25 ④ — 새 경고 UI를 만들지 않고 이 Alert에 한 절을 덧붙인다 */}
              <p>
                프로필이 없으면 스킬도 실리지 않습니다 — 스킬 블록은 페르소나 프롬프트 안에 삽니다.
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
        <EmptyState text="페르소나 없음" action={<CreatePersonaButton projectId={id} />} />
      ) : (
        // ponytail: 폭 제한 없음 — §5의 §4 예외. 카드 목록만 전체 폭이고 경고 Alert는 문단 폭이다
        <div className="space-y-3">
          {rows.map((p) => (
            // 색은 큐가 아니라 레지스트리에 있다(§5) — 같은 서버 렌더에 실려서 점 스켈레톤이 없다
            <PersonaCard
              key={p.name}
              projectId={id}
              row={p}
              color={project.personaColors?.[p.name]}
              installed={installed}
              configDir={claudeConfigDir()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
