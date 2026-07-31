"use client";

/** 프로젝트 목록·등록 화면(`/`)의 클라이언트 조각 — 등록 폼 · 해석 결과 표 · 행 액션(설정 다이얼로그).
 *
 *  세 개가 한 파일에 있는 이유: 해석 결과 표를 등록 직후와 설정 다이얼로그가 **같은 표**로 쓴다
 *  (DESIGN.md §7). 파일을 쪼개면 두 자리가 갈린다. fs 접근은 전부 서버 액션 뒤에 있다. */
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Settings2, TriangleAlert, Unlink } from "lucide-react";
import {
  createProject,
  moveProjectAction,
  registerProject,
  renameProjectAction,
  resolveProjectAction,
  unregisterProjectAction,
  type CreateState,
  type RegisterState,
  type ResolvedView,
} from "@/app/actions";
import { CopyCommand } from "@/components/copy-command";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { slugify } from "@/lib/urls";

/** 잘린 값·배지 설명을 붙인다. 트리거는 넘긴 요소 그대로 쓴다(base-ui `render`). */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

const BADGE_HINT: Record<string, string> = {
  "기본값 가정": "워커 파일에서 이 값을 찾지 못해 기본값을 씁니다",
  "해석 실패": "$HOME 외 변수가 남아 값을 읽지 못했습니다 — 화면은 기본값을 씁니다",
  "루트 밖": "프로젝트 루트 밖을 가리킵니다",
};

// ── 해석 결과 표 ────────────────────────────────────────────────────────────

export function ConfigTable({ view }: { view: ResolvedView }) {
  return (
    <div className="space-y-2">
      <Table>
        <TableBody>
          {view.rows.map((row) => (
            <TableRow key={row.key} className="h-9">
              <TableCell className="w-40 px-3 py-0 text-sm text-muted-foreground">
                {row.key}
              </TableCell>
              <TableCell className="px-3 py-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.perWorker ? (
                    // 워커별 나열. 경고가 아니라 사실이므로 색도 아이콘도 쓰지 않는다 —
                    // 한 워커만 엉뚱한 경로면 이 목록에서 그 줄이 튄다(DESIGN.md §0-0).
                    <div className="min-w-0 space-y-0.5">
                      {row.perWorker.map(({ worker, value }) => (
                        <div key={worker} className="flex gap-2 font-mono text-xs">
                          <span className="w-10 shrink-0 text-muted-foreground">{worker}</span>
                          {/* min-w-0 래퍼가 있어야 flex 항목이 줄어들고 truncate가 먹는다 */}
                          <div className="min-w-0">
                            <Hint text={value}>
                              <span className="block truncate">{value}</span>
                            </Hint>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : row.byWorker ? (
                    // 워커마다 다르면 값을 하나로 적을 수 없다 — 양쪽을 다 적고 경고한다.
                    <>
                      {Object.entries(row.byWorker).map(([w, v]) => (
                        <span key={w} className="font-mono text-xs">
                          {w}: {v}
                        </span>
                      ))}
                      <Badge
                        variant="outline"
                        className="text-status-stale bg-status-stale/10 border-status-stale/30"
                      >
                        <TriangleAlert aria-hidden className="size-3.5" />
                        워커마다 다름
                      </Badge>
                    </>
                  ) : (
                    <span className={row.mono ? "font-mono text-xs break-all" : "text-sm"}>
                      {row.value}
                    </span>
                  )}
                  {row.badges.map((b) => (
                    <Hint key={b} text={BADGE_HINT[b]}>
                      {/* `해석 실패`만 색+아이콘이다 — 나머지는 경고가 아니라 사실이다(§0) */}
                      <Badge
                        variant="outline"
                        className={
                          b === "해석 실패"
                            ? "text-status-stale bg-status-stale/10 border-status-stale/30"
                            : undefined
                        }
                      >
                        {b === "해석 실패" && <TriangleAlert aria-hidden className="size-3.5" />}
                        {b}
                      </Badge>
                    </Hint>
                  ))}
                  {/* 무엇을 못 읽었는지는 원문 라인만이 말해준다(§7 해석 실패).
                      `basis-full`이면 wrap 컨테이너가 알아서 값 아래 줄로 내린다 */}
                  {row.unresolved?.map(({ worker, raw }) => (
                    <div
                      key={worker + raw}
                      className="flex basis-full gap-2 font-mono text-xs text-muted-foreground"
                    >
                      <span className="w-10 shrink-0">{worker}</span>
                      <span className="min-w-0 break-all">{raw}</span>
                    </div>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {view.hasConflict && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>워커 간 설정이 다릅니다</AlertTitle>
          <AlertDescription>
            티켓이 어느 워커에 물리느냐에 따라 결과가 달라집니다.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── 생성 다이얼로그 (DESIGN.md §0-3) ────────────────────────────────────────

/** 없는 큐를 만든다. **새 컴포넌트·새 색 토큰 0개** — 필드 사양은 등록 카드 표 그대로고
 *  결과는 등록과 같은 해석 결과 표다(§비주얼 §7 생성 다이얼로그 항).
 *
 *  성공하면 다이얼로그가 닫히고 결과는 **등록 카드 자리**로 올라간다(`onCreated`) — 여는 자리가
 *  둘이라 결과를 여기 두면 어느 트리거로 열었느냐에 따라 결과가 다른 자리에 뜬다. */
function CreateDialog({
  open,
  onOpenChange,
  onCreated,
  onRegister,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (s: CreateState) => void;
  /** `.dira`가 이미 있는 **큐**였다 — 만들지 않고 등록 카드로 보낸다(§0-3 답변 4(b)) */
  onRegister: (root: string) => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<CreateState>({});
  const [name, setName] = useState("");
  const slug = slugify(name);
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setState({});
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            새로 만들기
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
          <DialogDescription>
            .dira를 만들고 워커 하나를 crontab에 올립니다 — 1분 뒤부터 티켓을 물어갑니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            start(async () => {
              const r = await createProject(
                name,
                get("dir"),
                get("branch"),
                get("spec"),
                get("id") || undefined,
              );
              setState(r);
              if (r.done) {
                onCreated(r);
                onOpenChange(false);
                setState({});
                setName("");
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="create-name">이름</Label>
            <Input
              id="create-name"
              placeholder="dira 자체"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {slug && <p className="font-mono text-xs text-muted-foreground">URL: /p/{slug}</p>}
            {err?.code === "name" && <p className="text-xs text-destructive">{err.message}</p>}
          </div>

          {showId && (
            <div className="space-y-2">
              <Label htmlFor="create-id">URL 조각</Label>
              <Input id="create-id" name="id" className="font-mono" placeholder="dira" />
              <p className="text-xs text-muted-foreground">
                {err && (err.code === "needId" || err.code === "badId" || err.code === "dupId")
                  ? err.message
                  : "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈)."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="create-dir">프로젝트 폴더</Label>
            <Input
              id="create-dir"
              name="dir"
              className="font-mono"
              placeholder="~/Projects/myproject"
            />
            {/* `.dira`가 아니라 그 부모다 — 등록 폼과 갈리는 지점이라 도움말로 못박는다 */}
            <p className="text-xs text-muted-foreground">여기에 .dira를 만듭니다. ~는 확장됩니다</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-branch">통합 브랜치</Label>
            <Input id="create-branch" name="branch" defaultValue="main" />
            {err?.code === "branch" && <p className="text-xs text-destructive">{err.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-spec">스펙 문서</Label>
            <Input id="create-spec" name="spec" className="font-mono" placeholder="docs/DESIGN.md" />
            <p className="text-xs text-muted-foreground">
              선택. 비우면 그 줄(AGENTS.md 지도 표 한 행)을 자리표시자 그대로 둡니다
            </p>
          </div>

          {/* `.dira`가 이미 있다 — 만들지 않았다. 큐면 등록으로 보낸다(§0-3 표) */}
          {state.exists && (
            <Alert>
              <TriangleAlert aria-hidden />
              <AlertTitle>만들지 않았습니다</AlertTitle>
              <AlertDescription className="grid gap-2">
                <span className="break-all">{state.exists.message}</span>
                {state.exists.queue && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => {
                      onRegister(state.exists!.root);
                      onOpenChange(false);
                      setState({});
                    }}
                  >
                    등록 카드로
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {err && err.code !== "name" && err.code !== "branch" && !showId && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>만들지 못했습니다</AlertTitle>
              <AlertDescription>
                <span className="break-all">{err.message}</span>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "만드는 중…" : "프로젝트 만들기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── 등록 카드 ───────────────────────────────────────────────────────────────

export function RegisterCard({ empty }: { empty?: boolean }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerProject, {});
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [made, setMade] = useState<CreateState | null>(null);
  const [creating, setCreating] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const slug = slugify(name);
  // 슬러그가 비면(한글 이름) 그때만 `URL 조각`을 받는다. 서버가 중복·형식으로 거부한 경우도 같다.
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  const dialog = (
    <CreateDialog
      open={creating}
      onOpenChange={setCreating}
      onCreated={(s) => {
        setMade(s);
        setDismissed(false);
      }}
      onRegister={setRoot}
    />
  );

  // 생성 결과 = 등록과 **같은 표** + 그 위 세 줄(만든 파일 수 · 유도한 엔진 레포 · crontab 등록).
  const view = made?.done ?? state.done;
  if (view && !dismissed) {
    const c = made?.created;
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">
            {c ? "만들었습니다" : "등록됨"} — {view.project.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">{view.project.shortRoot}</span>
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" nativeButton={false} render={<Link href={`/p/${view.project.id}`} />}>
              보드 열기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              닫기
            </Button>
          </div>
        </div>
        {c && (
          <div className="space-y-1 text-sm">
            <p>
              파일 {c.written}개를 만들었습니다.
              {c.skipped.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  이미 있어 건너뜀: <span className="font-mono text-xs">{c.skipped.join(" ")}</span>
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              엔진 레포 <span className="font-mono text-xs">{c.repo}</span>
            </p>
            {c.cron ? (
              <p>crontab에 등록됨 — 1분 뒤부터 티켓을 물어갑니다</p>
            ) : (
              // 등록 실패는 성공 보고를 막지 않는다(§0-3). 파일은 그대로 두고 명령을 준다.
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>crontab에 등록하지 못했습니다</AlertTitle>
                <AlertDescription className="grid gap-2">
                  <span className="break-all">{c.cronError}</span>
                  <CopyCommand cmd={c.registerCmd} />
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <ConfigTable view={view} />
      </Card>
    );
  }

  return (
    <>
      {/* 프로젝트 0개 빈 상태에도 같은 버튼이 하나 더 선다(§0-3 트리거 두 자리) */}
      {empty && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">아직 큐가 없다면 새로 만듭니다.</p>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            새로 만들기
          </Button>
        </div>
      )}
      <Card className="gap-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">프로젝트 등록</h2>
          {dialog}
        </div>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">이름</Label>
            <Input
              id="project-name"
              name="name"
              placeholder="dira 자체"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {slug && (
              <p className="font-mono text-xs text-muted-foreground">URL: /p/{slug}</p>
            )}
            {err?.code === "name" && <p className="text-xs text-destructive">{err.message}</p>}
          </div>

          {showId && (
            <div className="space-y-2">
              <Label htmlFor="project-id">URL 조각</Label>
              <Input id="project-id" name="id" className="font-mono" placeholder="dira" />
              <p className="text-xs text-muted-foreground">
                {err && (err.code === "needId" || err.code === "badId" || err.code === "dupId")
                  ? err.message
                  : "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈)."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="project-root">경로</Label>
            <Input
              id="project-root"
              name="root"
              className="font-mono"
              placeholder="~/Projects/myproject/.dira"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">절대경로. ~는 확장됩니다</p>
          </div>

          {err && (err.code === "root" || err.code === "dupRoot" || err.code === "unknown") && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>등록하지 못했습니다</AlertTitle>
              <AlertDescription>
                <span className="break-all">{err.message}</span>
                {err.dup && <Link href={`/p/${err.dup.id}`}>{err.dup.name} 열기</Link>}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "등록 확인 중…" : "프로젝트 등록"}
          </Button>
        </form>
      </Card>
    </>
  );
}

// ── 행 액션: 순서 변경 · 설정 다이얼로그 ────────────────────────────────────

export function ProjectRowActions({
  id,
  name,
  shortRoot,
  first,
  last,
}: {
  id: string;
  name: string;
  shortRoot: string;
  first: boolean;
  last: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ResolvedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState(name);

  const load = () =>
    start(async () => {
      setError(null);
      const r = await resolveProjectAction(id);
      if ("rows" in r) setView(r);
      else setError(r.message);
    });

  const move = (dir: -1 | 1) =>
    start(async () => {
      const r = await moveProjectAction(id, dir);
      if (!r.ok) setError(r.message ?? "순서를 바꾸지 못했습니다.");
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <Hint text="위로">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 위로`}
          disabled={first || pending}
          onClick={() => move(-1)}
        >
          <ChevronUp aria-hidden />
        </Button>
      </Hint>
      <Hint text="아래로">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 아래로`}
          disabled={last || pending}
          onClick={() => move(1)}
        >
          <ChevronDown aria-hidden />
        </Button>
      </Hint>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setConfirming(false);
          if (o) load();
        }}
      >
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`${name} 설정`}>
              <Settings2 aria-hidden />
            </Button>
          }
        />
        <DialogContent className="sm:max-w-2xl">
          {confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>프로젝트 등록 해제</DialogTitle>
                <DialogDescription>
                  &quot;{name}&quot;을 목록에서 제거합니다. 이 프로젝트의 티켓은 삭제되지 않습니다 —
                  레지스트리에서만 빠집니다.
                </DialogDescription>
              </DialogHeader>
              <p className="font-mono text-xs break-all">{shortRoot}</p>
              <p className="text-sm text-muted-foreground">
                같은 경로로 다시 등록하면 그대로 돌아옵니다.
              </p>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" autoFocus />}>취소</DialogClose>
                <Button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await unregisterProjectAction(id);
                      if (r.ok) setOpen(false);
                      else setError(r.message ?? "등록 해제에 실패했습니다.");
                    })
                  }
                >
                  등록 해제
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{name}</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">
                  {shortRoot}
                </DialogDescription>
              </DialogHeader>

              {error && (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>설정을 읽지 못했습니다</AlertTitle>
                  <AlertDescription>
                    <span className="font-mono text-xs break-all">{error}</span>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-medium">해석 결과</h3>
                <Button variant="outline" size="sm" disabled={pending} onClick={load}>
                  {pending ? "읽는 중…" : "다시 읽기"}
                </Button>
              </div>
              {view ? (
                <ConfigTable view={view} />
              ) : (
                <p className="text-sm text-muted-foreground">읽는 중…</p>
              )}

              <div className="space-y-2 border-t pt-4">
                <Label htmlFor={`rename-${id}`}>이름</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`rename-${id}`}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await renameProjectAction(id, newName);
                        if (r.ok) setOpen(false);
                        else setError(r.message ?? "이름을 바꾸지 못했습니다.");
                      })
                    }
                  >
                    저장
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  URL 조각 <span className="font-mono">{id}</span>는 바뀌지 않습니다 — 열어 둔 링크와
                  북마크가 깨집니다.
                </p>
              </div>

              <div className="border-t pt-4">
                {/* 빨강을 쓰지 않는다: 파일을 지우지 않고 다시 등록하면 돌아온다(§8). */}
                <Button variant="outline" onClick={() => setConfirming(true)}>
                  <Unlink aria-hidden />
                  등록 해제
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
