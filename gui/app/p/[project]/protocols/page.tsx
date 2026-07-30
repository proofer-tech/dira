/** 프로토콜 `/p/<project>/protocols` — 파일트리 + 원문 에디터 (DESIGN.md §6).
 *
 *  **`<루트>/protocols`를 가정하지 않는다.** 엔진이 `TICKET_PROTOCOLS`로 재정의를 열어뒀고
 *  (README 용례: 여러 큐가 같은 규약을 쓰면 공유 경로로 준다), 그러면 이 디렉터리는 루트 밖이다.
 *  기준은 `resolveConfig(project).protocols` 하나뿐이고, 경로 방어의 접두도 그 디렉터리다.
 *
 *  선택 파일은 URL `?file=`이 담는다 — 새로고침·공유가 공짜고 클라이언트 상태가 필요 없다. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Folder, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InlineBadge, NewFileButton, ProtocolEditor } from "@/components/protocols-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listTree, readTextFile, type ProtocolFile } from "@/lib/protocols";
import { getProject, resolveConfig, usingDefault } from "@/lib/projects";
import { cn } from "@/lib/utils";

// 프로토콜 파일은 세션이 GUI 밖에서 고친다 — 프리렌더하면 빌드 시점 내용이 굳는다.
export const dynamic = "force-dynamic";

export default async function Protocols({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { project: id } = await params;
  const { file } = await searchParams;
  const project = await getProject(id);
  if (!project) notFound();

  const config = await resolveConfig(project);
  const tree = await listTree(config.protocols);

  // `file`은 사용자 입력이다 — 서버에서 기준 디렉터리 안인지 확인한다. 밖이면 404가 아니라
  // 거부 사유를 그대로 보여준다(§6 에러 3요소: 무엇이 왜 거부됐는지 삼키지 않는다).
  let selected: ProtocolFile | null = null;
  let rejected: string | null = null;
  if (file) {
    try {
      selected = await readTextFile(config.protocols, file);
    } catch (e) {
      rejected = (e as Error).message;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">프로토콜</h1>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {config.protocols}
            {usingDefault(config, "protocols") && (
              <span className="ml-2 font-sans">기본값 가정</span>
            )}
          </p>
        </div>
        {tree.length > 0 && <NewFileButton projectId={id} />}
      </div>

      {usingDefault(config, "protocols") && (
        // 워커에서 TICKET_PROTOCOLS를 못 얻었다(없거나 해석 실패) = 엔진의
        // `${TICKET_PROTOCOLS:-$TICKET_ROOT/protocols}` 기본값을 쓴다는 뜻이다.
        // 둘을 가르는 화면은 §7 해석 결과 표 하나다 — 여기는 "기본값을 본다"는 사실만 필요하다.
        <p className="max-w-3xl text-sm text-muted-foreground">
          워커 파일에서 <span className="font-mono text-xs">TICKET_PROTOCOLS</span>를 읽지 못해 엔진 기본값
          (<span className="font-mono text-xs">&lt;루트&gt;/protocols</span>)으로 봅니다. 워커에서
          다른 경로로 재정의하면 이 화면도 그 경로를 따라갑니다.
        </p>
      )}

      {tree.length === 0 ? (
        <div className="max-w-3xl space-y-3">
          <EmptyState text="파일 없음" action={<NewFileButton projectId={id} variant="outline" />} />
          <p className="text-sm text-muted-foreground">
            프로토콜이 없어도 큐는 돕니다 — <span className="font-mono text-xs">tick.sh</span>는{" "}
            <span className="font-mono text-xs">AGENTS.md</span>가 없으면 그냥 넘어갑니다. 세션이
            협업 규약(티켓 성격별 처리·핸드오프·보고)을 모른 채 시작할 뿐입니다.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* 트리 — 서버 렌더 링크. 들여쓰기가 중첩을 그린다(트리 컴포넌트를 만들지 않는다) */}
          <nav aria-label="프로토콜 파일" className="w-full shrink-0 space-y-0.5 lg:w-80">
            {tree.map((e) =>
              e.isDir ? (
                <div
                  key={e.rel}
                  className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${e.depth * 0.75 + 0.5}rem` }}
                >
                  <Folder aria-hidden className="size-3.5 shrink-0" />
                  <span className="font-mono break-all">{e.name}</span>
                </div>
              ) : (
                <Link
                  key={e.rel}
                  href={`/p/${id}/protocols?file=${encodeURIComponent(e.rel)}`}
                  className={cn(
                    "flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted",
                    e.rel === selected?.rel && "bg-muted font-medium",
                  )}
                  style={{ paddingLeft: `${e.depth * 0.75 + 0.5}rem` }}
                >
                  <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono break-all">{e.name}</span>
                  {e.inlineChars !== undefined && <InlineBadge chars={e.inlineChars} />}
                </Link>
              ),
            )}
          </nav>

          <div className="min-w-0 grow">
            {rejected ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>이 경로는 열 수 없습니다</AlertTitle>
                <AlertDescription>
                  <span className="font-mono text-xs break-all">{rejected}</span>
                </AlertDescription>
              </Alert>
            ) : !selected ? (
              <p className="text-sm text-muted-foreground">왼쪽에서 파일을 고르세요.</p>
            ) : selected.text === null ? (
              // 트리에는 보이지만 편집기로는 안 여는 것들(§6 `.md` 아닌 파일)
              <Alert>
                <TriangleAlert aria-hidden className="text-status-stale" />
                <AlertTitle>
                  <span className="font-mono break-all">{selected.rel}</span>
                </AlertTitle>
                <AlertDescription>{selected.reason}</AlertDescription>
              </Alert>
            ) : (
              <ProtocolEditor
                key={selected.rel} // 파일을 바꿔도 앞 파일 내용이 textarea에 남지 않게 한다
                projectId={id}
                rel={selected.rel}
                initial={selected.text}
                inlined={selected.rel === "AGENTS.md"}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
