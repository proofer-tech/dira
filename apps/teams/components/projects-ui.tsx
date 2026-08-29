"use client";

/** 프로젝트 목록·생성의 클라이언트 조각 — 생성 폼·다이얼로그(`CreateForm`·`CreateDialog`) ·
 *  해석 결과 표(`ConfigTable`) · 목록 표(`ProjectRows`) · 행 액션(설정 다이얼로그).
 *
 *  헤더·등록 폼·레지스트리 오류 배너는 여기 없다 — 홈(`app/(site)/landing.tsx`)이 랜딩 헤더의
 *  그 자리에 직접 조립한다(§한 코드베이스 §홈 · §비주얼 §46). `CreateForm`·`CreateDialog`·
 *  `CREATE_BLURB`를 export하는 이유가 그 재사용이다.
 *
 *  한 파일에 있는 이유: 해석 결과 표를 생성 직후와 행 액션의 설정 다이얼로그가 **같은 표**로
 *  쓴다(DESIGN.md §7). 파일을 쪼개면 두 자리가 갈린다. fs 접근은 전부 서버 액션 뒤에 있다. */
import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import Link from "@/components/link";
import { useTrackedRouter } from "@/lib/route-pending";
import { ChevronDown, ChevronUp, Settings2, TriangleAlert, Unlink } from "lucide-react";
import {
  createProject,
  moveProjectAction,
  renameProjectAction,
  resolveProjectAction,
  unregisterProjectAction,
  type CreateState,
  type ResolvedView,
} from "@/app/actions";
import { publishOntologyMigrationAction } from "@/app/(app)/p/[project]/ontology/actions";
import { useT } from "@/components/language-provider";
import { OntologyImport } from "@/components/ontology-ui";
import { PickPath } from "@/components/path-picker";
import { PersonaBadge } from "@/components/persona-badge";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

// ── 해석 결과 표 ────────────────────────────────────────────────────────────

export function ConfigTable({ view }: { view: ResolvedView }) {
  const t = useT();
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
                        {t("resolve.conflictBadge")}
                      </Badge>
                    </>
                  ) : (
                    <span className={row.mono ? "font-mono text-xs break-all" : "text-sm"}>
                      {row.value}
                    </span>
                  )}
                  {row.badges.map((b) => (
                    <Hint key={b} text={t(`resolve.badgeHint.${b}`)}>
                      {/* `resolveFailed`만 색+아이콘이다 — 나머지는 경고가 아니라 사실이다(§0) */}
                      <Badge
                        variant="outline"
                        className={
                          b === "resolveFailed"
                            ? "text-status-stale bg-status-stale/10 border-status-stale/30"
                            : undefined
                        }
                      >
                        {b === "resolveFailed" && <TriangleAlert aria-hidden className="size-3.5" />}
                        {t(`resolve.badge.${b}`)}
                      </Badge>
                    </Hint>
                  ))}
                  {/* 무엇을 못 읽었는지는 원문 라인만이 알려 준다(§7 해석 실패).
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
          <AlertTitle>{t("resolve.conflictAlert.title")}</AlertTitle>
          <AlertDescription>{t("resolve.conflictAlert.body")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── 생성 폼 (DESIGN.md §0-3) ────────────────────────────────────────────────

/** 생성이 무엇을 하는지 한 줄. 다이얼로그에서는 `DialogDescription`, 0건 인라인 카드에서는
 *  `h2` 아래 `text-xs text-muted-foreground`다 — 같은 문장이 두 그릇에서 같아야 한다(§비주얼 §7).
 *  홈(`landing.tsx`)의 0건 온보딩도 같은 자리에 같은 문장을 쓴다 — export해 재타이핑하지 않는다. */
export const CREATE_BLURB =
  ".dira를 만들고 워커 하나를 crontab에 올립니다 — 30초 뒤부터 티켓을 물어갑니다.";

/** 없는 큐를 만든다. **새 컴포넌트·새 색 토큰 0개** — 필드 사양은 §0-3 표 그대로고
 *  결과는 등록과 같은 해석 결과 표다(§비주얼 §7 생성 다이얼로그 항).
 *
 *  **그릇이 둘이다**: 목록이 있으면 `<CreateDialog>`, 프로젝트 0개면 온보딩의 인라인
 *  `Card`다 — 생성이 정문이라 0건의 1차 콘텐츠가 이 폼이다(§0 · §비주얼 §7 온보딩 항).
 *  둘이 동시에 서지 않으므로 필드 `id`가 겹치지 않는다.
 *
 *  **상태가 여기 있는 이유**: 다이얼로그가 닫히면 이 컴포넌트가 언마운트돼 값이 저절로
 *  비워진다(부모가 손으로 되돌리지 않는다).
 *
 *  성공하면 결과는 **목록 아래 결과 슬롯**으로 올라간다(`onCreated`) — 뜨는 자리가 둘이라
 *  결과를 여기 두면 어느 그릇으로 만들었느냐에 따라 결과가 다른 자리에 뜬다(§0 마지막 항). */
export function CreateForm({
  dialog,
  onCreated,
  onRegister,
  home,
}: {
  /** 다이얼로그 안이면 푸터에 `취소`가 같이 뜬다. 인라인 카드는 제출 하나다(§비주얼 §7 온보딩) */
  dialog?: boolean;
  onCreated: (s: CreateState) => void;
  /** `.dira`가 이미 있는 **큐**였다 — 만들지 않고 등록으로 보낸다(§0-3 답변 4(b)).
   *  경로만 채우고 등록 다이얼로그를 여는 것은 부모다 */
  onRegister: (root: string) => void;
  /** 피커가 고른 절대경로를 `프로젝트 폴더`(사람이 `~`로 칠 수 있다) 상대로 환산할 때 쓴다 */
  home: string;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [state, setState] = useState<CreateState>({});
  const [name, setName] = useState("");
  // 피커가 값을 넣으려면 제어 입력이어야 한다.
  const [dir, setDir] = useState("");
  const [spec, setSpec] = useState("");
  const [ontology, setOntology] = useState("");
  const slug = slugify(name);
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  const submit = (
    <Button type="submit" disabled={pending}>
      {pending ? t("project.create.submitPending") : t("project.create.submit")}
    </Button>
  );

  return (
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
            get("ontology"),
            get("id") || undefined,
          );
          setState(r);
          if (r.done) onCreated(r);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="create-name">{t("project.create.nameLabel")}</Label>
        <Input
          id="create-name"
          placeholder={t("project.create.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {slug && <p className="font-mono text-xs text-muted-foreground">URL: /p/{slug}</p>}
        {err?.code === "name" && <p className="text-xs text-destructive">{err.message}</p>}
      </div>

      {showId && (
        <div className="space-y-2">
          <Label htmlFor="create-id">{t("project.create.idLabel")}</Label>
          <Input id="create-id" name="id" className="font-mono" placeholder="dira" />
          <p className="text-xs text-muted-foreground">
            {err && (err.code === "needId" || err.code === "badId" || err.code === "dupId")
              ? err.message
              : t("project.create.idHint")}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="create-dir">{t("project.create.dirLabel")}</Label>
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
          <PickPath mode="directory" label={t("project.create.dirLabel")} onPick={setDir} />
        </div>
        {/* `.dira`가 아니라 그 부모다 — 등록 폼과 갈리는 지점이라 도움말로 고정한다 */}
        <p className="text-xs text-muted-foreground">{t("project.create.dirHelp")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-branch">{t("project.create.branchLabel")}</Label>
        <Input id="create-branch" name="branch" defaultValue="main" />
        {err?.code === "branch" && <p className="text-xs text-destructive">{err.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-spec">{t("project.create.specLabel")}</Label>
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
            label={t("project.create.specLabel")}
            onPick={(p) => setSpec(relativeUnder(p, expandTilde(dir, home)))}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("project.create.specHelp")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-ontology">{t("project.create.ontologyLabel")}</Label>
        {/* 고른 절대경로를 그대로 채운다 — 스펙 문서 칸과 달리 상대경로 환산이 없다
            (§0-3 §온톨로지 자리를 만들 때 정한다). 비우면 아무것도 안 쓴다(선택) */}
        <div className="flex items-center gap-2">
          <Input
            id="create-ontology"
            name="ontology"
            className="font-mono"
            placeholder={t("project.create.ontologyPlaceholder")}
            value={ontology}
            onChange={(e) => setOntology(e.target.value)}
          />
          <PickPath mode="directory" label={t("project.create.ontologyLabel")} onPick={setOntology} />
        </div>
        <p className="text-xs text-muted-foreground">{t("project.create.ontologyHelp")}</p>
      </div>

      {/* `.dira`가 이미 있다 — 만들지 않았다. 큐면 등록으로 보낸다(§0-3 표) */}
      {state.exists && (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("project.create.existsTitle")}</AlertTitle>
          <AlertDescription className="grid gap-2">
            <span className="break-all">{state.exists.message}</span>
            {state.exists.queue && (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => onRegister(state.exists!.root)}
              >
                {t("project.create.existsRegisterButton")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {err && err.code !== "name" && err.code !== "branch" && !showId && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("project.create.failedTitle")}</AlertTitle>
          <AlertDescription>
            <span className="break-all">{err.message}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* 첫 등록은 macOS `앱 관리` 승인 창을 지난다(§제약 4) — 그동안 crontab이 블록되고
          여기는 `만드는 중…`으로 떠 있다. 창을 못 알아보면 3분 뒤 등록만 실패한다. */}
      {pending && <p className="text-xs text-muted-foreground">{t("project.create.permissionHint")}</p>}

      {dialog ? (
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("project.create.cancel")}</DialogClose>
          {submit}
        </DialogFooter>
      ) : (
        <div className="flex justify-end">{submit}</div>
      )}
    </form>
  );
}

/** 생성 폼의 다이얼로그 그릇. 트리거는 여기 없다 — 부모가 연다(0건에서는 폼 자신이 인라인으로
 *  서므로 트리거가 없다. §비주얼 §7). 홈 헤더의 `새로 만들기`도 이 그릇을 그대로 쓴다. */
export function CreateDialog({
  open,
  onOpenChange,
  onCreated,
  onRegister,
  home,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (s: CreateState) => void;
  onRegister: (root: string) => void;
  home: string;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("project.create.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("project.create.blurb")}</DialogDescription>
        </DialogHeader>
        <CreateForm
          dialog
          home={home}
          onCreated={(s) => {
            onCreated(s);
            onOpenChange(false);
          }}
          onRegister={(r) => {
            onRegister(r);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
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
 *  `leading-5`가 있어야 12px 글자가 `h-5` 배지와 같은 중심에 뜬다(§비주얼 §7). */
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
  const t = useT();
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-9">
          <TableHead className="h-9 px-3 text-xs">{t("project.list.nameHeader")}</TableHead>
          <TableHead className="h-9 px-3 text-xs">{t("project.list.pathHeader")}</TableHead>
          {/* 칸반 레인 3개(§1)와 수가 안 맞는 이유는 이 한 문장뿐이다 */}
          <TableHead className="h-9 px-3 text-right text-xs" title={t("project.list.openHeaderTitle")}>
            {t("project.list.openHeader")}
          </TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">{t("project.list.inProgressHeader")}</TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">{t("project.list.doneHeader")}</TableHead>
          <TableHead className="h-9 px-3 text-xs">{t("project.list.connectedHeader")}</TableHead>
          <TableHead className="h-9 px-3 text-right text-xs">{t("project.list.actionsHeader")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          // 한 프로젝트가 `TableRow` 2개다(§비주얼 §7). hover를 끄는 이유: 두 줄 중 한 줄만
          // 밝아지면 블록이 반으로 갈려 보이고, 이 행에는 행 단위 클릭 대상이 없다.
          // 블록의 경계는 hover가 아니라 **마지막 줄의 `border-b`**가 짓는다.
          <Fragment key={row.id}>
            <TableRow className={`h-9 hover:bg-transparent ${row.connected ? "border-b-0" : ""}`}>
              {/* 이 셀만 링크다 — 행 전체를 링크로 만들면 액션 버튼과 겹친다 */}
              <TableCell className="px-3 py-0 text-sm">
                <span className="flex items-center gap-2">
                  <Link href={`/p/${row.id}`} className="hover:underline">
                    {row.name}
                  </Link>
                  {/* 프로젝트에 들어가기 전에 정체를 알린다(§0). 배너는 여기 두지 않는다 —
                      이 화면은 프로젝트 스코프가 아니고 이 배지가 목적지를 이미 가리킨다.
                      건수는 배지 밖 숫자다: 라벨(`할당됨`)은 <StatusBadge> 하나가 정하고
                      건수는 상태가 아니라 이 행의 사실이다. 0건인 행에는 아무것도 없다 */}
                  {row.assigned > 0 && (
                    <span className="flex items-center gap-1">
                      <StatusBadge status="assigned" />
                      <span className="text-xs tabular-nums text-status-stale">{row.assigned}</span>
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
                title={row.root}
              >
                <span className="block max-w-[16rem] truncate">{row.shortRoot}</span>
              </TableCell>
              {/* 연결 안 됨이면 세 자리를 전부 비운다. 0이 아니다 — 못 읽은 것과 0건은
                  다른 사실이다(§0). 세 수를 서로 다르게 칠하지 않는다(§비주얼 §7) */}
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {row.connected ? row.open : ""}
              </TableCell>
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {row.connected ? row.wip : ""}
              </TableCell>
              <TableCell className="px-3 py-0 text-right text-xs tabular-nums">
                {row.connected ? row.done : ""}
              </TableCell>
              <TableCell className="px-3 py-0">
                <StatusBadge status={row.connected ? "connected" : "disconnected"} />
              </TableCell>
              <TableCell className="px-3 py-0">
                <ProjectRowActions
                  id={row.id}
                  name={row.name}
                  shortRoot={row.shortRoot}
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
            {row.connected && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="space-y-1 px-3 pt-0 pb-2 whitespace-normal">
                  <div className="flex items-start gap-2">
                    <span className={LABEL}>{t("project.list.personasLabel")}</span>
                    {row.personas.length > 0 ? (
                      // 자르지 않는다 — `외 3개`로 접으면 무엇을 갖고 있는지를 못 본다(§0).
                      // 점만 쓰지 않는다: 프로젝트마다 페르소나 집합이 달라 같은 색이
                      // 행마다 다른 사람을 뜻한다(§12).
                      <span className="flex flex-wrap gap-1">
                        {row.personas.map((p) => (
                          <PersonaBadge key={p.name} name={p.name} color={p.color} />
                        ))}
                      </span>
                    ) : (
                      <span className={EMPTY}>{t("project.list.personasEmpty")}</span>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <span className={LABEL}>{t("project.list.workersLabel")}</span>
                    {row.workers.length > 0 ? (
                      // 워커 수만큼 배지를 만들지 않는다 — 라벨이 대부분 같은 글자라
                      // 반복이 이 줄에서 제일 넓은 요소가 된다. 상태별로 묶고 이름을 뒤에.
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {row.workers.map((g) => (
                          <span key={g.status} className="flex items-center gap-1 whitespace-nowrap">
                            <StatusBadge status={g.status} />
                            <span className="font-mono text-xs">{g.names.join(" ")}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      // 해석 결과 표가 쓰는 문구 그대로 — 같은 사실을 두 자리에서 다른
                      // 말로 하지 않는다(app/actions.ts 워커 행)
                      <span className={EMPTY}>{t("resolve.workers.empty")}</span>
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
  const t = useT();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const move = (dir: -1 | 1) => start(async () => void (await moveProjectAction(id, dir)));

  return (
    <div className="flex items-center justify-end gap-1">
      <Hint text={t("project.row.up")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} ${t("project.row.up")}`}
          disabled={first || pending}
          onClick={() => move(-1)}
        >
          <ChevronUp aria-hidden />
        </Button>
      </Hint>
      <Hint text={t("project.row.down")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} ${t("project.row.down")}`}
          disabled={last || pending}
          onClick={() => move(1)}
        >
          <ChevronDown aria-hidden />
        </Button>
      </Hint>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${name} ${t("project.row.settings")}`}
        onClick={() => setOpen(true)}
      >
        <Settings2 aria-hidden />
      </Button>
      <ProjectSettingsDialog
        id={id}
        name={name}
        shortRoot={shortRoot}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

// ── 설정 다이얼로그 (한 벌 — `/`의 행 액션과 전환기 항목의 레일이 같이 연다) ──────────

/** 이름 변경 · 온톨로지 마이그레이션 · 레지스트리에서 빼기. **여는 손잡이를 안 든다** — `open`·
 *  `onOpenChange`는 호출부가 쥔다. 전환기 레일은 팔레트(Popover)를 먼저 닫고 이 다이얼로그를
 *  띄워야 해서(DESIGN.md §비주얼 §4-1 §액션 레일 — 닫히는 Popover가 안의 다이얼로그를 같이
 *  걷어 간다) `DialogTrigger`로 여는 벌을 못 쓴다 — `/`도 같은 벌을 쓰려고 여기서 맞춘다. */
export function ProjectSettingsDialog({
  id,
  name,
  shortRoot,
  open,
  onOpenChange,
  onUnregistered,
}: {
  id: string;
  name: string;
  shortRoot: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 레지스트리에서 뺀 뒤 호출된다 — 지금 보던 화면이 그 프로젝트였으면 어디로 보낼지는
   *  호출부(전환기)가 안다. 이 컴포넌트는 "지금 어디 있나"를 모른다. */
  onUnregistered?: () => void;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [view, setView] = useState<ResolvedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState(name);

  const load = useCallback(() => {
    start(async () => {
      setError(null);
      const r = await resolveProjectAction(id);
      if ("rows" in r) setView(r);
      else setError(r.message);
    });
  }, [id]);

  // `open`은 부모가 쥔 controlled prop이다 — 톱니 클릭처럼 밖에서 바로 `true`로 바뀌면
  // Dialog의 `onOpenChange`는 안 불린다(사용자 상호작용 전용 콜백이라 prop 변화 자체엔 안 걸린다).
  // 그래서 열림은 `open` 자체를 보고 여기서 잡는다(`5e7d0faf`).
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        setConfirming(false);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("project.settings.confirmTitle")}</DialogTitle>
              <DialogDescription>
                &quot;{name}&quot;{t("project.settings.confirmDescSuffix")}
              </DialogDescription>
            </DialogHeader>
            <p className="font-mono text-xs break-all">{shortRoot}</p>
            <p className="text-sm text-muted-foreground">{t("project.settings.confirmNote")}</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" autoFocus />}>
                {t("project.settings.cancel")}
              </DialogClose>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await unregisterProjectAction(id);
                    if (r.ok) {
                      onOpenChange(false);
                      onUnregistered?.();
                    } else setError(r.message ?? t("project.settings.unregisterFailed"));
                  })
                }
              >
                {t("project.settings.unregisterButton")}
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
                <AlertTitle>{t("project.settings.readFailedTitle")}</AlertTitle>
                <AlertDescription>
                  <span className="font-mono text-xs break-all">{error}</span>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-medium">{t("project.settings.resolveResultsHeading")}</h3>
              <Button variant="outline" size="sm" disabled={pending} onClick={load}>
                {pending ? t("project.settings.loading") : t("project.settings.reload")}
              </Button>
            </div>
            {view ? (
              <>
                <ConfigTable view={view} />
                <OntologyMigration projectId={id} ticket={view.ontologyMigrationTicket} />
                <div className="space-y-2 border-t pt-4">
                  <OntologyImport projectId={id} tickets={view.ontologyImportTickets} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("project.settings.loading")}</p>
            )}

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor={`rename-${id}`}>{t("project.settings.renameLabel")}</Label>
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
                      if (r.ok) onOpenChange(false);
                      else setError(r.message ?? t("project.settings.renameFailed"));
                    })
                  }
                >
                  {t("project.settings.save")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("project.settings.slugNotePrefix")} <span className="font-mono">{id}</span>
                {t("project.settings.slugNoteSuffix")}
              </p>
            </div>

            <div className="border-t pt-4">
              {/* 빨강을 쓰지 않는다: 파일을 지우지 않고 다시 등록하면 돌아온다(§8). */}
              <Button variant="outline" onClick={() => setConfirming(true)}>
                <Unlink aria-hidden />
                {t("project.settings.unregisterButton")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── 설정 다이얼로그: 온톨로지 마이그레이션 (DESIGN.md §5-3 §마이그레이션) ──────────

/** 설정 다이얼로그의 마이그레이션 섹션. 실행층은 `publishOntologyMigrationAction` 하나고
 *  발행은 큐 파일 한 장 쓰는 왕복이다 — 진행·결과 그릇은 개정(`08d26cec`)으로 없어졌다.
 *  성공하면 그 티켓 상세로 이동한다(§56 ⑤ — 포커스가 손 밑에서 사라지는 창을 안 만든다).
 *
 *  `ticket`은 이 마커(`ontology-migration`)를 든 열린 티켓 — 프로젝트당 한 장이라 부르는
 *  쪽(서버)이 첫 그림에서 판정해 내려준다. 있으면 버튼 대신 그 줄이 뜬다(§56 §세 상태 ③).
 *  `status`는 서버가 이미 `statusLabel(statusOf(t))`로 옮긴 문자열이다 — `statusOf`는
 *  `lib/queue.ts` runtime이라 클라이언트 번들에 못 들어간다(`node:fs/promises` 의존). */
function OntologyMigration({
  projectId,
  ticket,
}: {
  projectId: string;
  ticket: { stem: string; hash: string; status: string } | null;
}) {
  const t = useT();
  const router = useTrackedRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setError(null);
    setPending(true);
    void publishOntologyMigrationAction(projectId).then((r) => {
      if (r.ok) router.push(`/p/${projectId}/tickets/${r.stem}`);
      else {
        setPending(false);
        setError(r.message);
      }
    });
  };

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">{t("project.ontologyMigration.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("project.ontologyMigration.description")}</p>
        </div>
        {ticket ? (
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/p/${projectId}/tickets/${encodeURIComponent(ticket.stem)}`}
              className="rounded-sm underline hover:text-foreground"
            >
              {t("project.ontologyMigration.linkPrefix")} <span className="font-mono">{ticket.hash}</span>{" "}
              {ticket.status}
            </Link>
          </p>
        ) : (
          <Button variant="outline" size="sm" disabled={pending} onClick={start}>
            {pending ? t("project.ontologyMigration.startPending") : t("project.ontologyMigration.start")}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("project.ontologyMigration.failedTitle")}</AlertTitle>
          <AlertDescription>
            <span className="font-mono text-xs break-all">{error}</span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
