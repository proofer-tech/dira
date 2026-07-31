"use client";

/** 프로젝트 목록·등록 화면(`/`)의 클라이언트 조각 — 화면 헤더 · 등록 폼 · 해석 결과 표 ·
 *  행 액션(설정 다이얼로그).
 *
 *  한 파일에 있는 이유: 해석 결과 표를 등록 직후와 설정 다이얼로그가 **같은 표**로 쓴다
 *  (DESIGN.md §7). 파일을 쪼개면 두 자리가 갈린다. fs 접근은 전부 서버 액션 뒤에 있다. */
import { Fragment, useState, useTransition } from "react";
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
import { PickPath } from "@/components/path-picker";
import { PersonaBadge } from "@/components/persona-badge";
import { BrandMark } from "@/components/project-switcher";
import { SettingsDialog, type AuthView } from "@/components/settings-dialog";
import { StatusBadge, type Status } from "@/components/status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { expandTilde, relativeUnder, slugify } from "@/lib/urls";

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
 *  성공하면 다이얼로그가 닫히고 결과는 **목록 아래 결과 슬롯**으로 올라간다(`onCreated`) — 여는
 *  자리가 둘이라 결과를 여기 두면 어느 트리거로 열었느냐에 따라 결과가 다른 자리에 뜬다.
 *  트리거도 여기 없다: `h1` 우측과 0건 빈 상태 두 자리라 부모가 연다(§비주얼 §7). */
function CreateDialog({
  open,
  onOpenChange,
  onCreated,
  onRegister,
  home,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (s: CreateState) => void;
  /** `.dira`가 이미 있는 **큐**였다 — 만들지 않고 등록으로 보낸다(§0-3 답변 4(b)).
   *  경로만 채우고 그릇은 부모가 고른다: 0건이면 인라인 폼, 아니면 등록 다이얼로그다 */
  onRegister: (root: string) => void;
  /** 피커가 고른 절대경로를 `프로젝트 폴더`(사람이 `~`로 칠 수 있다) 상대로 환산할 때 쓴다 */
  home: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<CreateState>({});
  const [name, setName] = useState("");
  // 피커가 값을 넣으려면 제어 입력이어야 한다. 닫을 때 비우는 건 종전과 같다 —
  // 다이얼로그가 닫히면 그동안은 비제어 입력이 언마운트로 비워졌다.
  const [dir, setDir] = useState("");
  const [spec, setSpec] = useState("");
  const slug = slugify(name);
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setState({});
          setDir("");
          setSpec("");
        }
      }}
    >
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
                setDir("");
                setSpec("");
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
            {/* 데스크톱이 아니면 `<PickPath>`가 아무것도 안 그린다 — 그때 이 줄은 입력 하나다 */}
            <div className="flex items-center gap-2">
              <Input
                id="create-dir"
                name="dir"
                className="font-mono"
                placeholder="~/Projects/myproject"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
              />
              <PickPath mode="directory" label="프로젝트 폴더" onPick={setDir} />
            </div>
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
            <div className="flex items-center gap-2">
              <Input
                id="create-spec"
                name="spec"
                className="font-mono"
                placeholder="docs/DESIGN.md"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
              />
              {/* 이 칸은 **프로젝트 루트 상대**다(§데스크톱 앱 N3 표) — 위 칸 아래를 고르면
                  그만큼 줄이고, 밖을 고르면 절대경로 그대로 둔다. 위 칸이 비었으면 줄일
                  기준이 없어 역시 절대경로다 */}
              <PickPath
                mode="file"
                label="스펙 문서"
                onPick={(p) => setSpec(relativeUnder(p, expandTilde(dir, home)))}
              />
            </div>
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
                    등록으로
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

// ── 루트 셸(헤더 + main) + 등록 · 생성 · 결과 슬롯 ──────────────────────────

/** `/`의 클라이언트 조각. **`h1`·트리거·결과 슬롯이 한 컴포넌트인 이유**는 트리거가 `h1`
 *  우측인데 결과 카드는 목록 아래 슬롯에 떠야 하기 때문이다(§비주얼 §7). 목록(`children`)은
 *  서버가 그린 것을 그대로 통과시킨다.
 *
 *  그 `h1` 행이 헤더 바로 올라가면서(§비주얼 §4 루트 셸 항) **셸까지 이 조각이 그린다** —
 *  `<header>`를 서버에 남기고 버튼만 여기로 내리면 헤더 행과 결과 슬롯이 두 트리로 갈린다.
 *
 *  **0건에서 등록에 성공해도 이 컴포넌트는 자리를 안 옮긴다** — 같은 응답에서 화면이
 *  온보딩→목록으로 바뀌는데, 폼이 그때 다이얼로그로 옮겨 앉으면 결과 표가 remount로 사라진다
 *  (§0 마지막 항). 그래서 그릇을 바꾸는 시점은 결과가 아니라 `닫기`다. */
export function ProjectsSection({
  empty,
  auth,
  home,
  registryError,
  children,
}: {
  empty: boolean;
  /** 인증 상태 — 머신 스코프라 프로젝트 요약에 들어 있지 않다. 헤더 우측 끝
   *  `설정` 다이얼로그가 쓴다(§0-4). */
  auth: AuthView;
  /** 홈 디렉터리. 경로 피커가 `~`로 친 값을 펴는 데만 쓴다(§데스크톱 앱 N3) —
   *  클라이언트는 `node:os`를 못 부르므로 서버가 넘긴다(`tildePath`와 같은 규약) */
  home: string;
  /** 레지스트리를 못 읽었을 때. GUI가 고쳐 쓰려 들지 않는다 — 원문 + 여는 명령이다. */
  registryError?: { message: string; openCmd: string } | null;
  children?: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<RegisterState>({});
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [made, setMade] = useState<CreateState | null>(null);
  const [creating, setCreating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const slug = slugify(name);
  // 슬러그가 비면(한글 이름) 그때만 `URL 조각`을 받는다. 서버가 중복·형식으로 거부한 경우도 같다.
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  // 생성 결과 = 등록과 **같은 표** + 그 위 세 줄(만든 파일 수 · 유도한 엔진 레포 · crontab 등록).
  const view = made?.done ?? state.done;
  const c = made?.created;

  // `useActionState` 대신 직접 부른다 — 성공 시 다이얼로그를 닫고 결과 슬롯을 되살리는 일이
  // 렌더 결과가 아니라 이벤트라서다(생성 다이얼로그와 같은 방식).
  // ponytail: `<form action={서버액션}>`이 주던 JS-없이 제출이 사라진다. 이 화면의 등록은
  // 이제 다이얼로그(=JS)가 기본 자리라 값이 0건 인라인 폼에만 남는다 — 되살리려면
  // `useActionState` + `useEffect(닫기)`다.
  const form = (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await registerProject({}, f);
          setState(r);
          setDismissed(false); // 닫아 둔 뒤 다시 등록하면 새 결과가 다시 뜬다
          if (r.done) {
            setMade(null); // 앞선 생성 결과가 새 등록 결과를 가리지 않는다
            setRegistering(false);
            setName("");
            setRoot("");
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="project-name">이름</Label>
        <Input
          id="project-name"
          name="name"
          placeholder="dira 자체"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {slug && <p className="font-mono text-xs text-muted-foreground">URL: /p/{slug}</p>}
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
        <div className="flex items-center gap-2">
          <Input
            id="project-root"
            name="root"
            className="font-mono"
            placeholder="~/Projects/myproject/.dira"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
          {/* 고르는 것은 `.dira` 자신이다(디렉터리) — dotfile이라 main이 `showHiddenFiles`를 켠다 */}
          <PickPath mode="directory" label="큐 경로" onPick={setRoot} />
        </div>
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

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "등록 확인 중…" : "프로젝트 등록"}
        </Button>
      </div>
    </form>
  );

  return (
    <>
      {/* 루트 셸 — 마크만 있던 바에 이 화면의 `h1` 행이 **통째로** 올라온다(§비주얼 §4 루트 셸 항).
          내비·전환기는 넣지 않는다: 목적지가 아직 정해지지 않았다. href는 `/` = 자기 자신이다(§14).
          헤딩은 `프로젝트` 고정이다 — 0건이라고 `dira`로 바꾸면 마크 옆에 같은 말이 두 번 선다.
          0건이면 우측이 `설정` 하나다: 등록 폼이 이미 펼쳐져 있는데 그 폼을 여는 버튼을 같은
          화면에 세우지 않는다(§비주얼 §7). `설정`은 **우측 맨 끝**이고 0건에서도 선다 —
          두 셸이 같은 자리에 같은 것을 갖는다(§0-4 자리 표 · §비주얼 §4) */}
      <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b bg-background px-6">
        <BrandMark href="/" />
        <h1 className="text-lg font-semibold">프로젝트</h1>
        <div className="ml-auto flex items-center gap-2">
          {!empty && (
            <>
              <Button size="sm" onClick={() => setRegistering(true)}>
                프로젝트 등록
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                새로 만들기
              </Button>
            </>
          )}
          <SettingsDialog auth={auth} />
        </div>
      </header>

      {/* 스크롤하는 것은 이 `main`이다(§비주얼 §4). **본문에 폭 상한이 없다** — 목록이 화면
          전폭을 쓴다(요청 `27a7a13b`, 티켓 `9b288700`). 등록 폼이 다이얼로그로 내려가면서 이
          화면은 테이블 화면이 됐고, 폼 폭 규칙(3xl)은 폼이 서는 자리·읽는 산문만 문다
          (§비주얼 §7 폭 항). 상한이 다시 필요해지면 여기가 아니라 안쪽 상자에 건다 —
          `main`에 걸면 스크롤바가 화면 오른쪽이 아니라 상한 자리에 선다 */}
      <main className="min-h-0 w-full flex-1 overflow-y-auto">
        <div className="w-full space-y-6 px-6 py-6">
          {/* 읽는 산문이라 폭 상한을 스스로 든다 — 본문 상한이 풀리면서(§비주얼 §7 폭 항)
              페이지 폭이 대신 물어 주던 것이 없어졌다. 값은 셸 배너 넷과 같다(§4-4) */}
          {registryError && (
            <Alert variant="destructive" className="max-w-3xl">
              <TriangleAlert aria-hidden />
              <AlertTitle>프로젝트 레지스트리를 읽지 못했습니다</AlertTitle>
              <AlertDescription className="grid gap-2">
                <span className="font-mono text-xs break-all">{registryError.message}</span>
                <CopyCommand cmd={registryError.openCmd} />
              </AlertDescription>
            </Alert>
          )}

          {/* 0건 본문의 첫 줄. 두 글자 규칙(0건이면 `dira`)은 본문에 남지만 태그는 `h2`다 —
              헤더가 `h1`을 가져갔고 페이지의 `h1`은 하나다(§비주얼 §4 · §7) */}
          {empty && (
            <div className="max-w-3xl space-y-2">
              <h2 className="text-lg font-semibold">dira</h2>
              <p className="text-sm text-muted-foreground">
                등록된 프로젝트가 없습니다. 큐 디렉터리를 등록하면 시작합니다.
              </p>
            </div>
          )}

          {children}

          {/* 결과 슬롯 — 등록·생성 어느 쪽으로 성공해도 같은 자리다. 평소엔 아무것도 없다(§비주얼 §7) */}
          {view && !dismissed ? (
            <Card className="max-w-3xl gap-3 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-medium">
                  {c ? "만들었습니다" : "등록됨"} — {view.project.name}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {view.project.shortRoot}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/p/${view.project.id}`} />}
                  >
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
                        이미 있어 건너뜀:{" "}
                        <span className="font-mono text-xs">{c.skipped.join(" ")}</span>
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
          ) : (
            empty && (
              // 0건 온보딩 — 폼이 1차 콘텐츠다. `새로 만들기`는 설명 한 줄이 붙어야 등록과 갈린다
              // (§0-3 트리거 두 자리 중 하나. 헤더의 액션 자리와 동시에 서지 않는다)
              <>
                <div className="flex max-w-3xl items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground">아직 큐가 없다면 새로 만듭니다.</p>
                  <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                    새로 만들기
                  </Button>
                </div>
                <Card className="max-w-3xl gap-4 p-4">
                  <h2 className="text-sm font-medium">프로젝트 등록</h2>
                  {form}
                </Card>
              </>
            )
          )}

          {/* 프로젝트 0개일 때의 안내 산문. §6의 `<EmptyState>` 규칙(한 줄 + 버튼 1개)을 여기서만
              쓰지 않는다 — 한 줄로는 "무엇을 등록해야 하는지"를 못 알려준다(§8 충돌 기록).
              목록이 생기면 통째로 사라진다(§비주얼 §7) */}
          {empty && (
            <div className="max-w-3xl space-y-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  큐 디렉터리는 프로젝트 루트 아래 .dira 입니다. 안에 tickets/ 와 workers/ 가
                  있습니다.
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  ~/Projects/myproject/.dira
                </p>
                <p className="font-mono text-xs text-muted-foreground">~/Projects/dira/.dira</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">어디 있는지 모르겠다면:</p>
                {/* 스캔하는 건 GUI 프로세스가 아니라 사용자의 셸이다 — 경계는 여전히 명시적이다 */}
                <CopyCommand cmd="ls -d ~/Projects/*/.dira" />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 폼은 하나고 그릇만 둘이다 — 0건이면 위 인라인 카드, 아니면 이 다이얼로그다.
          둘이 동시에 서지 않으므로 필드 `id`가 겹치지 않는다 */}
      {!empty && (
        <Dialog open={registering} onOpenChange={setRegistering}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>프로젝트 등록</DialogTitle>
              <DialogDescription>
                이미 있는 .dira 큐를 목록에 올립니다. 파일은 만들지 않습니다.
              </DialogDescription>
            </DialogHeader>
            {form}
          </DialogContent>
        </Dialog>
      )}

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        home={home}
        onCreated={(s) => {
          setMade(s);
          setDismissed(false);
        }}
        onRegister={(r) => {
          setRoot(r);
          if (!empty) setRegistering(true); // 0건이면 폼이 이미 펼쳐져 있다
        }}
      />
    </>
  );
}

// ── 목록 표 (DESIGN.md §비주얼 §7) ──────────────────────────────────────────

/** 한 행이 그리는 것 전부. 서버(`(list)/page.tsx`)가 이 모양으로 만들어 넘긴다. */
export type ProjectRow = {
  id: string;
  name: string;
  root: string;
  shortRoot: string;
  connected: boolean;
  /** 연결 안 됨이면 셋 다 `null`이다 — 못 읽은 것과 0건은 다른 사실이다(§0) */
  open: number | null;
  wip: number | null;
  done: number | null;
  assigned: number;
  personas: { name: string; color?: string }[];
  /** `lib/workers.ts`의 `workerGroups` 결과. 순서는 §2 4상태 표 고정이다 */
  workers: { status: Status; names: string[] }[];
};

/** 자원 줄의 자리 라벨. `w-16`(64px)은 `페르소나` 4자가 12px에서 들어가는 폭이고,
 *  `leading-5`가 있어야 12px 글자가 `h-5` 배지와 같은 중심에 선다(§비주얼 §7). */
const LABEL = "w-16 shrink-0 text-xs leading-5 text-muted-foreground";
/** 값이 0개일 때. **문장이므로 `font-mono`가 아니다**(§비주얼 §3). */
const EMPTY = "text-xs leading-5 text-muted-foreground";

/** 목록 표. **클라이언트가 그린다** — 서버가 행 엘리먼트를 그려 보내면 `↑`/`↓`가 죽는다.
 *
 *  회귀 `955a8237`의 근거: 행이 두 줄(§비주얼 §7)이 되면서 `/`의 RSC 페이로드가 커지자
 *  Flight가 프로젝트 블록을 **`$L<id>` lazy 청크로 outline**하기 시작했다(실측: 액션 응답의
 *  `TableBody` children이 `[<dira 인라인>, "$L21", "$L22", "$L23"]`). 그 상태에서 순서가 바뀌면
 *  `revalidatePath`의 새 트리가 프로덕션 빌드에서 **커밋되지 않는다** — 화면은 옛 순서 그대로고
 *  그 행이 건 transition의 `pending`도 안 풀린다(dev 빌드는 재현 안 됨).
 *  `<Fragment>` → 평면 배열, `TableBody`에 remount `key`, `useTransition` 제거 —
 *  전부 안 통했다. **행을 값으로 넘기고 여기서 `map`하면** 페이로드에 행 엘리먼트가 없으므로
 *  outline 자체가 없고 재정렬은 평범한 클라이언트 렌더다.
 *  ponytail: 이 화면은 수십 행이다. 수천 행이 되면 그때 가상화를 고민한다. */
export function ProjectRows({ rows }: { rows: ProjectRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-9">
          <TableHead className="h-9 px-3 text-xs">이름</TableHead>
          <TableHead className="h-9 px-3 text-xs">경로</TableHead>
          {/* 칸반 레인 3개(§1)와 수가 안 맞는 이유는 이 한 문장뿐이다 */}
          <TableHead
            className="h-9 px-3 text-right text-xs"
            title="파일이 열려 있는 티켓 — 대기·deps 대기·할당됨을 포함합니다"
          >
            열림
          </TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">진행중</TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">완료</TableHead>
          <TableHead className="h-9 px-3 text-xs">연결</TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t, i) => (
          // 한 프로젝트가 `TableRow` 2개다(§비주얼 §7). hover를 끄는 이유: 두 줄 중 한 줄만
          // 밝아지면 블록이 반으로 갈려 보이고, 이 행에는 행 단위 클릭 대상이 없다.
          // 블록의 경계는 hover가 아니라 **마지막 줄의 `border-b`**가 짓는다.
          <Fragment key={t.id}>
            <TableRow className={`h-9 hover:bg-transparent ${t.connected ? "border-b-0" : ""}`}>
              {/* 이 셀만 링크다 — 행 전체를 링크로 만들면 액션 버튼과 겹친다 */}
              <TableCell className="px-3 py-0 text-sm">
                <span className="flex items-center gap-2">
                  <Link href={`/p/${t.id}`} className="hover:underline">
                    {t.name}
                  </Link>
                  {/* 프로젝트에 들어가기 전에 정체를 알린다(§0). 배너는 여기 두지 않는다 —
                      이 화면은 프로젝트 스코프가 아니고 이 배지가 목적지를 이미 가리킨다.
                      건수는 배지 밖 숫자다: 라벨(`할당됨`)은 <StatusBadge> 하나가 정하고
                      건수는 상태가 아니라 이 행의 사실이다. 0건인 행에는 아무것도 없다 */}
                  {t.assigned > 0 && (
                    <span className="flex items-center gap-1">
                      <StatusBadge status="assigned" />
                      <span className="text-xs tabular-nums text-status-stale">{t.assigned}</span>
                    </span>
                  )}
                </span>
              </TableCell>
              {/* 상한은 `td`가 아니라 안쪽 `span`에 건다 — auto table layout은 `td`의
                  max-width를 상한으로 지키지 않는다(§비주얼 §6). `title`은 셀에 둬서
                  여백을 hover해도 전문이 뜬다.
                  `w-px`가 같이 있어야 상한이 문다: 폭을 안 적은 컬럼은 남는 폭을 나눠 갖는
                  자리에 들어가고, 그 배분은 안쪽 max-width를 보지 않는다. 폭을 적으면 그
                  자리에서 빠져 컬럼이 내용 폭(상한까지)만 요구한다 — 늘어난 폭은 §7대로
                  이름·액션이 가져간다. 1px은 최소값이고 실제 폭은 내용이 정한다 */}
              <TableCell
                className="w-px px-3 py-0 font-mono text-xs text-muted-foreground"
                title={t.root}
              >
                <span className="block max-w-[16rem] truncate">{t.shortRoot}</span>
              </TableCell>
              {/* 연결 안 됨이면 세 자리를 전부 비운다. 0이 아니다 — 못 읽은 것과 0건은
                  다른 사실이다(§0). 세 수를 서로 다르게 칠하지 않는다(§비주얼 §7) */}
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {t.connected ? t.open : ""}
              </TableCell>
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {t.connected ? t.wip : ""}
              </TableCell>
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {t.connected ? t.done : ""}
              </TableCell>
              <TableCell className="px-3 py-0">
                <StatusBadge status={t.connected ? "connected" : "disconnected"} />
              </TableCell>
              <TableCell className="px-3 py-0">
                <ProjectRowActions
                  id={t.id}
                  name={t.name}
                  shortRoot={t.shortRoot}
                  first={i === 0}
                  last={i === rows.length - 1}
                />
              </TableCell>
            </TableRow>
            {/* 자원 줄 — 들어가기 전에 그 프로젝트가 무엇을 갖고 있는지 본다(§0).
                **연결 안 됨 행에는 이 줄이 아예 없다** — `페르소나 없음`은 "0명"이라는
                주장인데 큐를 못 읽었으므로 셀 수가 없다(첫 줄의 수 3칸과 같은 규칙).
                정렬이 필요한 것은 위 셀에 남기고 길이가 흔들리는 것만 여기로 내렸다.
                링크도 버튼도 없다 — 이 화면의 클릭 목적지는 이름 링크 하나다. */}
            {t.connected && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="space-y-1 px-3 pt-0 pb-2 whitespace-normal">
                  <div className="flex items-start gap-2">
                    <span className={LABEL}>페르소나</span>
                    {t.personas.length > 0 ? (
                      // 자르지 않는다 — `외 3개`로 접으면 무엇을 갖고 있는지를 못 본다(§0).
                      // 점만 쓰지 않는다: 프로젝트마다 페르소나 집합이 달라 같은 색이
                      // 행마다 다른 사람을 뜻한다(§12).
                      <span className="flex flex-wrap gap-1">
                        {t.personas.map((p) => (
                          <PersonaBadge key={p.name} name={p.name} color={p.color} />
                        ))}
                      </span>
                    ) : (
                      <span className={EMPTY}>없음</span>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <span className={LABEL}>워커</span>
                    {t.workers.length > 0 ? (
                      // 워커 수만큼 배지를 세우지 않는다 — 라벨이 대부분 같은 글자라
                      // 반복이 이 줄에서 제일 넓은 요소가 된다. 상태별로 묶고 이름을 뒤에.
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {t.workers.map((g) => (
                          <span key={g.status} className="flex items-center gap-1 whitespace-nowrap">
                            <StatusBadge status={g.status} />
                            <span className="font-mono text-xs">{g.names.join(" ")}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      // 해석 결과 표가 쓰는 문구 그대로 — 같은 사실을 두 자리에서 다른
                      // 말로 하지 않는다(app/actions.ts 워커 행)
                      <span className={EMPTY}>없음 — 이 큐는 돌지 않습니다</span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
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
