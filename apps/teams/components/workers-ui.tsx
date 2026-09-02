"use client";

/** 워커 화면(`/p/<project>/workers`)의 클라이언트 조각 — 생성 · 중단 · 재등록 · 삭제 · reap.
 *
 *  **crontab의 그 워커 줄은 GUI가 쓴다**(제약 4, `44f876aa`로 뒤집힘). 생성·중단·삭제 세 자리가
 *  다 한 동작이고, 서버가 만들어 준 명령어를 `<CopyCommand>`로 복사시키는 건 **실패했을 때**다.
 *  fs를 만지는 건 서버 액션뿐이다.
 *  파일 하나에 모은 이유는 projects-ui.tsx와 같다 — 세 다이얼로그가 같은 문구·같은 명령어를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { createContext, Fragment, useContext, useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  applyCommonSourceAction,
  applyDispatchGateAction,
  applyExecBitAction,
  applySelfHealAction,
  copyContextAction,
  createWorkerAction,
  deleteWorkerAction,
  reapWorkerAction,
  registerWorkerAction,
  savePoolLimitAction,
  saveCommonContextAction,
  saveContextAction,
  stopWorkerAction,
  type ContextResult,
  type PoolLimitResult,
  type WorkerActionResult,
} from "@/app/(app)/p/[project]/workers/actions";
import { CopyCommand } from "@/components/copy-command";
import { PickPath } from "@/components/path-picker";
import { SessionStream } from "@/components/session-stream";
import { openWorkerSettingsNode } from "@/components/settings-dialog";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useLocale, useT } from "@/components/language-provider";
import { relativeUnderAny } from "@/lib/urls";
import { cn } from "@/lib/utils";
import type { PoolLimit } from "@/lib/pool";
import type { WorkersPanelSessionCap } from "@/lib/workers-panel";

/** 서버가 읽어 넘긴 컨텍스트 한 항목. `path`는 워커 파일에 든 셸 문자열이라 `$TICKET_CWD`가
 *  살아 있고, `resolved`·`exists`는 그걸 편 결과다(파일에는 안 들어간다). */
export type ContextRow = {
  path: string;
  desc: string;
  resolved?: string;
  /** true 있음 · false 없음(엔진이 건너뛴다) · null 변수를 못 펴 확인 불가 · undefined 저장 전 */
  exists?: boolean | null;
};

/** 서버가 읽어 넘긴 한 줄. cron 명령어는 서버에서 만든다 — 인용 규칙이 `lib/workers.ts`에 있다. */
export type WorkerRow = {
  name: string;
  path: string;
  status: "running" | "idle" | "stopped" | "stale";
  cron: boolean;
  lockPid: number | null;
  holding: string | null;
  /** 실행 중인 엔진의 첫 토큰 basename — §0-4 인증 배너와 **같은 `engineName`**이다. 서버가 계산해
   *  넘긴다: `lib/workers.ts`가 `node:fs`를 타서 이 파일이 그 함수를 못 import한다(§규약).
   *  세션 스트림·참견이 이 값 하나로 갈린다(§4-3 · §비주얼 §23 ⑤) */
  engineName: string;
  /** runner.log에서 이 워커의 최근 20줄(최신이 앞). `[0]`이 `마지막 활동` 셀이고 펼치면 전부 뜬다 */
  recentLog: string[];
  registerCmd: string;
  unregisterCmd: string;
  /** TICKET_CONTEXT 항목 또는 GUI가 못 고치는 사유 */
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string; missing?: true };
  /** 공통 컨텍스트 `source` 줄이 있는가. false면 이 워커는 공통을 못 받는다 (§4-1) */
  commonSource: boolean;
  /** 공통 워커 풀의 shim인가(§4-16 결정 2·6) — 참이면 이름 셀에 `공통` 배지가 붙고, 행의
   *  중단/재등록·삭제가 비활성이다 */
  commonWorker: boolean;
  /** 자가 정리 `source` 줄이 있는가. false면 dira를 지워도 이 워커의 cron 줄이 남는다 (§4-4) */
  selfHealSource: boolean;
  /** 통합 게이트 `source` 줄이 있는가. false면 받는 트리가 더러워도 그냥 디스패치돼 push에서만
   *  막힌다 (§4-14) */
  dispatchGateSource: boolean;
  /** `<루트>/dispatch-gate.sh`가 낡음인가(§4-14 §소급). `source` 줄이 있어도 이게 true면 경고한다 */
  dispatchGateStale: boolean;
  /** `TICKET_CWD`. null = 줄이 없다(엔진 기본값 = 루트의 부모) */
  cwd: string | null;
  /** 작업 디렉터리 결함 (§4, 넷째는 §0-21, 다섯째는 §977419d7). **0개가 정상**이고 그때 행은
   *  아무것도 늘지 않는다. `status`와 직교한다 — 결함이 있어도 락이 있으면 `running`이다 */
  defects: {
    kind: "missing-cwd" | "missing-link" | "shared-cwd" | "no-exec" | "no-ticket-cwd";
    detail: string;
  }[];
  /** 외부 요인으로 죽은 마지막 세션 (§0-5). **정상 상태에서는 항상 `null`이고** 그때 행은
   *  아무것도 늘지 않는다. `defects`와 같은 축이다 — 실패 직후의 워커는 `idle`이다 */
  lastFailure: { at: string; hash: string; reason: string; log: string } | null;
  /** `missing-cwd`·`missing-link`·`shared-cwd` 중 하나라도 있을 때만 온다. §4 생성의 준비
   *  3줄과 같은 문자열이다 */
  worktree?: string[];
  /** `no-exec`가 있을 때만 온다 — `chmod +x <절대경로>`. 복구 버튼은 이 판정의 몫이 아니다
   *  (§0-21 결정 3, 로드맵 P290-4가 붙인다) */
  execFix?: string;
  /** `no-ticket-cwd`가 있을 때만 온다 — 워커 파일에 `TICKET_CWD=` 한 줄만 더하는 명령(§977419d7
   *  결정 3). `worktree`(3단계)가 아니다 — 트리는 다음 tick에 게이트가 만든다 */
  cwdFix?: string;
  /** §4-19 결정 3 · §비주얼 §69 — 결함이 아니라 표기 한 줄. 있으면 경고 색·아이콘·조작 없이
   *  스택 마지막에 `<p>`로 뜬다. `undefined` = 뜰 자리가 아니다 */
  cwdPending?: string;
};

/** §6 에러 3요소 중 1·2번. 3번(다음 행동)은 부르는 쪽이 다이얼로그 안에 붙인다. */
function Failure({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span className="font-mono text-xs break-all">{message}</span>
      </AlertDescription>
    </Alert>
  );
}

/** `no-exec` 결함 `Alert` 안의 복구 버튼(§비주얼 §57 §1, §0-21 결정 3) — 형제 셋(`공통 적용` 등)과
 *  같은 벌·같은 전이 분리(워커마다 독립 `useTransition`)다. 성공하면 `revalidatePath`가 결함을
 *  0개로 만들어 이 `Alert` 자체가 사라진다 — 여기서 따로 세우는 성공 표시가 없다(§4-4 §빈 상태).
 *  실패하면 버튼 바로 아래 `<Failure>`, 그 아래 `cmd`(`CopyCommand`)가 그대로 남는다 — 순서가
 *  §6 에러 3요소(무엇을 하려다 실패했나 → 사유 → 다음 행동)다. */
export function ExecBitFix({
  projectId,
  name,
  cmd,
}: {
  projectId: string;
  name: string;
  cmd: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // §비주얼 §58 — 성공하면 그 순간 초점을 든 버튼일 때만 `이름` 셀로 낭독을 넘긴다.
  const [, , , announceSuccess] = useContext(ExpandCtx);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={btnRef}
        size="sm"
        variant="outline"
        aria-disabled={pending}
        className="aria-disabled:opacity-50"
        onClick={() => {
          if (pending) return; // §58 §못 누르는 실효 — aria-disabled에는 pointer-events-none이 없다
          start(async () => {
            const r = await applyExecBitAction(projectId, name, locale);
            setError(r.ok ? null : (r.message ?? t("workers.execFix.failedDefaultMessage")));
            if (r.ok && document.activeElement === btnRef.current) {
              announceSuccess(name, t("workers.execFix.successSentence"));
            }
          });
        }}
      >
        {pending ? t("workers.execFix.pending") : t("workers.execFix.button")}
      </Button>
      {error && <Failure title={t("workers.execFix.failedTitle")} message={error} />}
      <CopyCommand cmd={cmd} />
    </>
  );
}

/** 첫 등록은 macOS `앱 관리` 승인 창을 지난다(§제약 4) — 그동안 crontab이 블록되고 버튼은
 *  `…중`으로 떠 있다. 창을 못 알아보면 3분 뒤 등록만 실패한다.
 *  **생성과 재등록이 같은 `crontab -` 쓰기라 같은 벽에서 멈춘다** — 그래서 문구도 하나다(§4 재등록). */
function CrontabApproval() {
  const t = useT();
  return <p className="text-xs text-muted-foreground">{t("workers.crontabApprovalHint")}</p>;
}

// ── 생성 ────────────────────────────────────────────────────────────────────

/** §6 에러 3요소의 1번 — **어느 단계에서 멈췄나**. 인덱스는 `WorktreePrep.done`(= 끝난 단계 수)이다.
 *  성공(3)은 여기 없다 — 그 화면에는 에러가 없다. */
const WORKTREE_STEP_KEYS = [
  "workers.create.worktreeStep0",
  "workers.create.worktreeStep1",
  "workers.create.worktreeStep2",
];

/** 워커 생성. **한 동작으로 끝난다** — 파일을 만들고 crontab 두 줄까지 서버가 등록한다(제약 4).
 *  등록이 실패했을 때만 성공 화면이 종전의 등록 명령어로 되돌아간다. 워커 0개인 큐에서도 그대로
 *  연다 — `createWorker`가 §4-18 폴백으로 만든다(`engineRepo()`를 못 찾을 때만 실패한다). */
export function CreateWorkerButton({
  projectId,
  firstCmd,
  variant,
  defaultName = "",
  sessionCap,
}: {
  projectId: string;
  /** 손으로 첫 워커를 만드는 명령 — `engineRepo()` 실패로 생성이 막혔을 때만 뜬다(§4-18 결정 2) */
  firstCmd: string;
  variant?: "default" | "outline";
  /** `이름` 칸의 기본값 — `nextWorkerName`이 계산한 값(DESIGN.md §4-13). 제안이지 예약이 아니라
   *  읽기 전용이 아니다 — 지우고 다시 쓸 수 있고, 닫으면 이 값으로 돌아간다. */
  defaultName?: string;
  /** 머신 전체 세션 상한(P357-3 `sessionCapOf`가 낸 값 그대로 — 새 셈을 안 만든다, P357-4
   *  정본 절 결정 1). 만들기를 막지 않는다 — 워커 수와 동시 세션 수는 다른 값이다. */
  sessionCap: WorkersPanelSessionCap;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [result, setResult] = useState<WorkerActionResult | null>(null);
  const [pending, start] = useTransition();
  const created = result?.created;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setName(defaultName);
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={variant} />}>{t("workers.create.trigger")}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("workers.create.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("workers.create.dialogDescription")}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-mono text-xs">{created.template}</span>
              {t("workers.create.templateCopiedMiddle")}{" "}
              <span className="font-mono text-xs break-all">{created.path}</span>
              {t("workers.create.templateCopiedSuffix")}
            </p>
            {created.cron ? (
              <p className="text-sm font-medium">{t("workers.create.cronRegisteredMessage")}</p>
            ) : (
              // 파일은 있고 등록만 실패했다. 되돌리지 않고 사람이 셸에서 마무리하게 한다.
              <div className="space-y-2">
                <Failure title={t("workers.cronRegisterFailedTitle")} message={created.cronError ?? ""} />
                <p className="text-sm font-medium">{t("workers.notRunningYetHint")}</p>
                <CopyCommand cmd={created.registerCmd} />
              </div>
            )}
            {/* 워크트리 3단계도 서버가 실행했다(§4 생성 4항 — 요청 `5f55577a`가 §4-2를 뒤집었다).
                성공하면 `CopyCommand`가 없다. 사람이 셸로 넘어가는 것은 실패했을 때뿐이고, 그때도
                **남은 명령만** 준다 — 이미 된 단계를 다시 돌리면 `ln -s` 함정을 직접 밟는다. */}
            <div className="space-y-2 border-t pt-3">
              {created.worktree.skipped ? (
                // 레포가 아니다 = 실패가 아니라 정상 종료다. 파일도 crontab도 그대로다.
                <p className="text-sm text-muted-foreground">
                  {t("workers.create.worktreeSkippedPrefix")} {created.worktree.reason}{" "}
                  {t("workers.create.worktreeSkippedSuffix")}
                </p>
              ) : created.worktree.done === 3 ? (
                <p className="text-sm font-medium">
                  {t("workers.create.worktreeDoneLabel")}{" "}
                  <span className="font-mono text-xs break-all">{created.worktree.dir}</span>
                  {t("workers.create.worktreeDoneMiddle")}{" "}
                  <span className="font-mono text-xs">.dira</span>
                  {t("workers.create.worktreeDoneSuffix")}
                </p>
              ) : (
                <>
                  <Failure
                    title={t(WORKTREE_STEP_KEYS[created.worktree.done])}
                    message={created.worktree.reason ?? ""}
                  />
                  <p className="text-sm font-medium">{t("workers.create.worktreeFailedHint")}</p>
                  {created.worktree.rest.map((cmd) => (
                    <CopyCommand key={cmd} cmd={cmd} />
                  ))}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="worker-name">{t("workers.create.nameLabel")}</Label>
              <Input
                id="worker-name"
                className="font-mono"
                placeholder={defaultName}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("workers.create.nameHint")}</p>
            </div>
            {/* 정본 절 결정 1 — 워커 만들기는 세션 만들기가 아니라서 상한을 안 막지만, 그 상한이
                뭘 재는지는 여기서 처음 보는 사람도 알아야 한다. 수 한 줄 + 뜻 한 줄, `nameHint`와
                같은 보조 줄 자리(`text-xs text-muted-foreground`). */}
            <div className="space-y-1">
              <p className="text-xs tabular-nums text-muted-foreground">
                {sessionCap.limit === null
                  ? t("workers.create.sessionCapNoLimit")
                  : `${t("settings.workers.sessionCapTotalPrefix")}${sessionCap.total}${t("settings.workers.sessionCapTotalSep")}${sessionCap.limit}`}
              </p>
              <p className="text-xs text-muted-foreground">{t("workers.create.sessionCapHint")}</p>
            </div>
            {result?.message && (
              <div className="space-y-2">
                <Failure title={t("workers.create.failedTitle")} message={result.message} />
                {/* §4-18 결정 2 — 손으로 첫 워커를 만드는 명령이 사는 자리가 여기 하나로 줄었다.
                    `engineRepo()`가 실패했을 때만 사람에게 남은 유일한 길이라 그대로 둔다. */}
                <CopyCommand cmd={firstCmd} />
              </div>
            )}
          </div>
        )}

        {pending && <CrontabApproval />}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {created ? t("common.close") : t("common.cancel")}
          </DialogClose>
          {!created && (
            <Button
              disabled={pending || !name.trim()}
              onClick={() =>
                start(async () => setResult(await createWorkerAction(projectId, name, undefined, undefined, locale)))
              }
            >
              {pending ? t("common.creating") : t("common.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 행 액션: 스트림 · 중단/재등록 · 삭제 ──────────────────────────────────────
// reap은 §4-17(요구 ac7ba0e2)로 이 행에서 빠져 `워커 설정` 다이얼로그 넷째 섹션으로 옮겨갔다.

export function WorkerRowActions({ projectId, row }: { projectId: string; row: WorkerRow }) {
  const t = useT();
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState<WorkerActionResult | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState<WorkerActionResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<WorkerActionResult | null>(null);
  const [streaming, setStreaming] = useState(false);
  // 스트림을 열 수 있는 유일한 조건(§4 · §2-1 Q2=(a)): 지금 돌고 있고, 물고 있는 티켓을 안다.
  // `running`인데 `holding`이 null이면(owner 역추적 실패) 버튼이 **비활성**이다 — 자리는 남고
  // 다이얼로그는 안 뜬다(빈 스트림을 그리지 않는다는 §4 판정은 그대로다).
  const holding = row.status === "running" ? row.holding : null;

  return (
    <div className="flex items-center justify-end gap-1">
      {/* 못 여는 행에서도 **지우지 않고 비활성으로 남긴다**(§4 세션 스트림 · §비주얼 §4-3 —
          요구 `3d717e8b`). 지우면 오른쪽 정렬이라 그 행만 나머지 버튼이 옆으로 옮겨 놓인다.
          사유 문구·툴팁은 안 붙인다 — 같은 행 `물고 있는 티켓` 열이 `—`인 것이 이미 알려 준다.
          `aria-disabled`가 아니라 `disabled`다: 이 행에는 해당이 없는 조작이라 탭 순서에
          죽은 정거장을 만들지 않는다(선례 = 아래 컨텍스트 항목 행 `▲▼`) */}
      <Button
        variant="ghost"
        size="sm"
        disabled={!holding}
        onClick={() => setStreaming(true)}
      >
        {t("workers.row.streamButton")}
      </Button>
      {/* 같은 줄에 대한 반대 동작이라 둘이 동시에 뜨는 상태가 없다 — 판정은 `status`가 아니라
          `cron`이다(§4 재등록): 뺄 줄이 있으면 `중단`, 없으면 `재등록`이다. `running`인데
          미등록인 워커에도 `재등록`이 뜬다(락과 crontab은 직교한다 — §워커 상태 판정).
          배타 토글은 한 슬롯이고 **넓은 쪽(`재등록` 55.2px) 폭으로 고정**한다(§비주얼 §4-3) —
          안 하면 자수가 갈리는 만큼 왼쪽 버튼들이 행마다 다른 x에 뜬다(실측 11.1px) */}
      {/* 공통 워커 shim 행은 이 토글과 삭제가 비활성이다(§4-16 결정 6 · §비주얼 §68 §거짓 한 칸) —
          중단·재등록·삭제는 풀의 조작이고 설정 화면의 몫이다. 지우지 않고 비활성으로 남기는
          것은 §4-3 §행 액션의 슬롯 규칙 그대로다. 사유 툴팁은 안 붙인다 — 같은 행의 `공통`
          배지가 이미 알려 준다. */}
      {row.cron ? (
        <Button
          variant="ghost"
          size="sm"
          className="min-w-14"
          disabled={row.commonWorker}
          onClick={() => setStopping(true)}
        >
          {t("workers.row.stopButton")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="min-w-14"
          disabled={row.commonWorker}
          onClick={() => setRegistering(true)}
        >
          {t("workers.row.registerButton")}
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={row.commonWorker} onClick={() => setDeleting(true)}>
        {t("workers.row.deleteButton")}
      </Button>

      {/* 세션 스트림 — **진입점 하나다**(§4 · §2-1 Q2=(a)). 대상만 `holding`이고 컴포넌트도
          Server Action(`tailSession`)도 티켓 상세가 쓰는 것 그대로다. 그래서 두 화면이 같은
          티켓에서 같은 내용을 그린다. 다이얼로그가 닫히면 포털이 언마운트되고 폴링도 같이 끊긴다
          — 워커 표에 `running` 여러 줄이 있어도 도는 폴링은 열어 둔 하나뿐이다. */}
      {holding && (
        <Dialog open={streaming} onOpenChange={setStreaming}>
          {/* **폭·`max-h`·`overflow`는 이 호출부에만 더한다**(§비주얼 §64 ①②). `DialogContent`
              등록은 `grid`고 이 다이얼로그만 `flex flex-col`로 간다 — 세로 배분을 flex에 넘겨
              머리·칩 줄·툴바를 고정하고 목록·상세가 각자 스크롤하게 한다(§2-15 ⑧ 규칙 2). 폭은
              종전 `sm:max-w-3xl`(768)에서 `75rem`(1200)으로 넓어진다(§비주얼 §64 ① — 목록 640
              + 상세 512의 유도값). 컴포넌트를 고치지 않는 이유는 스트림을 담은 이 다이얼로그만
              키가 커서다. */}
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-[75rem]">
            <DialogHeader>
              <DialogTitle>
                {t("workers.row.streamDialogTitlePrefix")} {row.name}
              </DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {holding}
              </DialogDescription>
            </DialogHeader>
            {/* `live`는 초기값일 뿐이고 매 폴링마다 서버가 티켓 상태로 다시 판정한다 —
                여는 순간 티켓이 끝났으면 첫 응답에서 폴링이 멈춘다. */}
            {/* 엔진 이름을 같이 넘긴다 — codex면 상자 대신 사유가, 참견 폼엔 비활성 + 사유가
                뜬다(§4-3 · §비주얼 §23 ⑤). 여기서는 화면이 그 값을 직접 쓰고 있는 행이다. */}
            <SessionStream project={projectId} stem={holding} live engine={row.engineName} variant="worker" />
          </DialogContent>
        </Dialog>
      )}

      {/* 중단 — 파일은 남기고 crontab 줄만 GUI가 뺀다. 실패했을 때만 복사 명령으로 돌아간다 */}
      <Dialog
        open={stopping}
        onOpenChange={(o) => {
          setStopping(o);
          if (!o) setStopped(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("workers.row.stopDialogTitlePrefix")} {row.name}
            </DialogTitle>
            <DialogDescription>{t("workers.row.stopDialogDescription")}</DialogDescription>
          </DialogHeader>
          {stopped?.ok ? (
            // 이미 미등록이었으면 no-op이라고 알려 준다 — 에러가 아니다
            <p className="text-sm font-medium">{stopped.message}</p>
          ) : (
            // 여는 버튼이 `row.cron`으로 갈리므로 "이미 미등록입니다"를 여기서 미리 말하지
            // 않는다 — 그 상태의 행에는 `중단`이 아니라 `재등록`이 있다(§4 재등록).
            stopped && (
              <div className="space-y-2">
                <Failure title={t("workers.row.stopFailedTitle")} message={stopped.message ?? ""} />
                <p className="text-sm font-medium">{t("workers.row.runInShellHint")}</p>
                <CopyCommand cmd={row.unregisterCmd} />
              </div>
            )
          )}
          {row.status === "running" && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("workers.row.stopRunningAlertTitle")}</AlertTitle>
              <AlertDescription>{t("workers.row.stopRunningAlertBody")}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>{t("common.close")}</DialogClose>
            {!stopped?.ok && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => setStopped(await stopWorkerAction(projectId, row.name, locale)))
                }
              >
                {pending ? t("workers.row.stoppingPending") : t("workers.row.stopButton")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 재등록 — `중단`의 역방향이고 crontab 두 줄이 전부다(§4 재등록). 파일은 이미 있으니
          만들 것도 지울 것도 없고, 실패했을 때만 복사 명령으로 돌아간다(= 생성의 등록 실패
          화면과 같은 모양이고 명령도 서버가 만든 그 값이다) */}
      <Dialog
        open={registering}
        onOpenChange={(o) => {
          setRegistering(o);
          if (!o) setRegistered(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("workers.row.registerDialogTitlePrefix")} {row.name}
            </DialogTitle>
            <DialogDescription>{t("workers.row.registerDialogDescription")}</DialogDescription>
          </DialogHeader>
          {registered?.ok ? (
            // 이미 등록돼 있었으면 no-op이라고 알려 준다 — `중단`이 미등록에 대해 가리키는 것과 대칭이다
            <p className="text-sm font-medium">{registered.message}</p>
          ) : (
            registered && (
              <div className="space-y-2">
                <Failure title={t("workers.cronRegisterFailedTitle")} message={registered.message ?? ""} />
                <p className="text-sm font-medium">{t("workers.notRunningYetHint")}</p>
                <CopyCommand cmd={row.registerCmd} />
              </div>
            )
          )}
          {pending && <CrontabApproval />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>{t("common.close")}</DialogClose>
            {!registered?.ok && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => setRegistered(await registerWorkerAction(projectId, row.name, locale)))
                }
              >
                {pending ? t("workers.row.registeringPending") : t("workers.row.registerButton")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 — running이면 막는다. 락과 세션이 붕 뜬다 */}
      <Dialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("workers.row.deleteDialogTitlePrefix")} {row.name}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{row.path}</DialogDescription>
          </DialogHeader>

          {row.status === "running" ? (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("workers.row.deleteBlockedTitle")}</AlertTitle>
              <AlertDescription>
                {t("workers.row.deleteBlockedPidPrefix")} {row.lockPid ?? "?"}
                {t("workers.row.deleteBlockedPidSuffix")}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("workers.row.deleteBodyText")}</p>
              {row.cron && (
                <p className="text-sm">
                  {t("workers.row.deleteCronPrefix")}{" "}
                  <span className="font-medium">{t("workers.row.deleteCronBold")}</span>
                  {t("workers.row.deleteCronSuffix")}
                </p>
              )}
              {error && (
                <div className="space-y-2">
                  <Failure
                    title={`${t("workers.row.deleteFailedTitlePrefix")} ${row.name} ${t("workers.row.deleteFailedTitleSuffix")}`}
                    message={error.message ?? ""}
                  />
                  {error.cronFailed && (
                    <>
                      <p className="text-sm font-medium">{t("workers.row.deleteCronFailedHint")}</p>
                      <CopyCommand cmd={row.unregisterCmd} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>{t("common.close")}</DialogClose>
            {row.status !== "running" && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteWorkerAction(projectId, row.name, locale);
                    if (r.ok) setDeleting(false);
                    else setError({ ...r, message: r.message ?? t("workers.row.deleteFailedDefaultMessage") });
                  })
                }
              >
                {pending ? t("workers.row.deletingPending") : t("workers.row.deleteButton")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 컨텍스트 경로 (TICKET_CONTEXT) ──────────────────────────────────────────

/** 존재 여부 표시. **없는 건 에러가 아니다** — 엔진이 건너뛰고 WARN만 남긴다(tick.sh 148행).
 *  그래서 없음은 destructive가 아니라 중립색이고, 문구가 그 사실을 알려 준다. */
function ExistsMark({ row }: { row: ContextRow }) {
  const t = useT();
  const [Icon, tint, label] =
    row.exists === true
      ? [Check, "text-status-done", t("workers.context.existsYes")]
      : row.exists === false
        ? [X, "text-muted-foreground", t("workers.context.existsNo")]
        : row.exists === null
          ? // 원인 중립. `null`은 못 편 변수가 남았을 때도, 워커에 따라 갈릴 때도 온다 —
            // 후자는 변수가 **펴졌는데** 결과가 갈린 것이라 "못 펴서"는 거짓이다(§4-1).
            // 경로는 아래 `title`이 한 번만 붙인다.
            [CircleQuestionMark, "text-muted-foreground", t("workers.context.existsAmbiguous")]
          : [CircleQuestionMark, "text-muted-foreground", t("workers.context.existsUnsaved")];
  return (
    <span className="flex items-center gap-1" title={row.resolved ? `${row.resolved} — ${label}` : label}>
      <Icon aria-hidden className={cn("size-4 shrink-0", tint)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** 블록 모양이 예상과 달라 GUI가 못 고칠 때의 사유 패널. **편집기 밖에 있는 이유**(§비주얼 §35
 *  §다섯째 경고): 이것은 워커 하나짜리 경고 다섯 중 하나라 접힌 행에서도 떠야 한다 — 편집기
 *  안에 두면 펼쳐야 보이는 경고가 된다. 공통 카드는 종전대로 편집기가 이걸 부른다. */
function ContextRejection({
  file,
  arr,
  filePath,
  reason,
  missing,
}: {
  file: string;
  arr: string;
  filePath: string;
  reason: string;
  missing?: true;
}) {
  const t = useT();
  return (
    <>
      <Failure
        title={`${file}${t("workers.context.rejectionTitleMiddle")} ${arr} ${t("workers.context.rejectionTitleSuffix")}`}
        message={reason}
      />
      <p className="text-sm text-muted-foreground">
        {t("workers.context.rejectionBodyPrefix")}
        <span className="font-mono text-xs break-all"> {filePath}</span>
        {t("workers.context.rejectionBodySuffix")}
      </p>
      {missing && (
        <>
          <p className="text-sm text-muted-foreground">
            {t("workers.context.missingLinePrefix")} <code className="font-mono text-xs">. …/tick.sh</code>{" "}
            {t("workers.context.missingLineMiddle")}{" "}
            <strong className="font-medium text-foreground">{t("workers.context.missingLineBold")}</strong>{" "}
            {t("workers.context.missingLineSuffix")}
          </p>
          {/* ponytail: `renderContextBlock([], arr)`과 같은 문자열을 손으로 적는다 — 서버
              전용 모듈(fs)이라 클라이언트에서 import할 수 없다. 0항목 모양이 바뀌면 여기도. */}
          <CopyCommand cmd={`${arr}=()`} />
        </>
      )}
    </>
  );
}

/** 항목 목록 편집 + 저장. **워커 카드와 공통 카드가 같은 이 컴포넌트를 쓴다**(§4-1: "편집기는
 *  워커별 것과 같은 컴포넌트다"). 파일 이름·블록 이름·저장 액션만 갈린다. */
function ContextEditor({
  file,
  arr,
  filePath,
  context,
  common,
  cwds,
  emptyText,
  addLabel,
  save,
}: {
  /** 저장이 바꾸는 파일(표시용) — `w1.sh` · `context.sh` */
  file: string;
  /** 통째로 치환되는 블록 이름 — `TICKET_CONTEXT` · `TICKET_CONTEXT_COMMON` */
  arr: string;
  /** 손으로 고치라고 알릴 때 보여줄 절대경로 */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string; missing?: true };
  /** 목록 **최상단**에 `공통` 배지 + 읽기 전용으로 붙는 항목(워커 카드에서만).
   *  **저장에 들어가지 않는다** — 이 항목은 워커 파일에 실제로 없다(§4-1) */
  common?: ContextRow[];
  /** 접두를 되살릴 기준 목록(§데스크톱 앱 N3 §공통 컨텍스트의 기준) — 경로 피커가 고른 파일이
   *  이 중 하나 아래면 `$TICKET_CWD/` 접두를 되살린다. 워커 카드는 자기 `TICKET_CWD` 하나짜리
   *  배열을 넘기고, 공통 카드는 프로젝트 워커 전부의 값을 넘긴다 — 둘 이상에 걸리면 가장 깊은
   *  기준을 쓴다(`relativeUnderAny`). **비어 있으면 피커 버튼이 안 뜬다.** */
  cwds?: string[];
  emptyText: string;
  addLabel: string;
  save: (items: { path: string; desc: string }[]) => Promise<ContextResult>;
}) {
  const t = useT();
  const saved = context.ok ? context.items : [];
  const [rows, setRows] = useState<ContextRow[]>(saved);
  const [result, setResult] = useState<ContextResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(rows.map((r) => [r.path, r.desc])) !== JSON.stringify(saved.map((r) => [r.path, r.desc]));

  const edit = (i: number, patch: Partial<ContextRow>) =>
    // 경로가 바뀌면 존재 여부는 더 이상 그 경로의 사실이 아니다 — 저장 후에 다시 받는다.
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch, exists: undefined, resolved: undefined } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };

  if (!context.ok) {
    return (
      <ContextRejection file={file} arr={arr} filePath={filePath} reason={context.reason} missing={context.missing} />
    );
  }

  return (
    <>
      <div className="space-y-1">
        {/* 공통 항목: 편집 입력·삭제·순서 컨트롤이 **없다.** 이 화면에서 지울 수 없다는 것이
            요청(f3254035)의 핵심이고, 파일에도 실제로 없으므로 UI가 거짓말하지 않는다.
            ponytail: 존재 표시는 공통 카드에서만 한다 — `$TICKET_CWD`가 워커마다 갈려서 여기
            같은 판정을 붙이면 워커에 따라 거짓이 된다. 워커별로 필요해지면 그때 cwd를 넘긴다. */}
        {common?.map((r, i) => (
          // 편집 행과 열이 맞지 않는다(입력·순서·삭제 컨트롤이 없으니 그게 맞다) — 띠로 묶어
          // 편집 행이 아님을 먼저 읽히게 한다.
          <div key={`common-${i}`} className="flex min-h-9 items-center gap-2 rounded-md bg-muted/50 px-2">
            <Badge variant="outline" className="shrink-0">
              {t("workers.pool.badge")}
            </Badge>
            <span className="flex-[2] truncate font-mono text-xs" title={r.path}>
              {r.path}
            </span>
            <span className="flex-1 truncate text-xs text-muted-foreground" title={r.desc}>
              {r.desc}
            </span>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <ExistsMark row={r} />
              <Input
                aria-label={t("workers.context.pathAriaLabel")}
                className="flex-[2] font-mono text-xs"
                placeholder="$TICKET_CWD/docs/DESIGN.md"
                value={r.path}
                onChange={(e) => edit(i, { path: e.target.value })}
              />
              <Input
                aria-label={t("workers.context.descAriaLabel")}
                className="flex-1 text-xs"
                placeholder={t("workers.context.descPlaceholder")}
                value={r.desc}
                onChange={(e) => edit(i, { desc: e.target.value })}
              />
              {/* 고른 파일이 `cwds` 중 하나 아래면 `$TICKET_CWD/`로 되돌린다(가장 깊은 기준을
                  쓴다 — `relativeUnderAny`) — 절대경로로 굳히면 그 항목이 이 컴퓨터 것이 되고
                  워커 간 복사도 뜻을 잃는다(§4-1 복사 다이얼로그).
                  **기준이 0개면 버튼 자체가 없다**: `TICKET_CWD` 줄이 없는 워커가 그렇고,
                  거기서 고르면 남는 건 이 컴퓨터의 절대경로뿐이다 */}
              {cwds && cwds.length > 0 && (
                <PickPath
                  mode="file"
                  label={`${i + 1}${t("workers.context.pickPathLabelSuffix")}`}
                  onPick={(p) => {
                    const rel = relativeUnderAny(p, cwds);
                    edit(i, { path: rel === p ? p : `$TICKET_CWD/${rel}` });
                  }}
                />
              )}
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
                <span className="sr-only">{t("workers.context.moveUp")}</span>
              </Button>
              <Button variant="ghost" size="sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
                <span className="sr-only">{t("workers.context.moveDown")}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X aria-hidden />
                <span className="sr-only">{t("workers.context.removeRow")}</span>
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 저장 거부(블록 모양이 예상과 다름)는 §6 에러 3요소 — 파일은 쓰이지 않았다 */}
      {result && !result.ok && (
        <Failure title={`${file}${t("workers.context.saveFailedTitleSuffix")}`} message={result.message ?? ""} />
      )}

      {/* 안내 문구 → 되돌리기 → 추가 → 저장, 오른쪽 정렬(§비주얼 §4-3).
          위 경로 행의 `▲▼×`는 조작 대상 옆이라 예외다 */}
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <>
            <span className="text-xs text-muted-foreground">
              {t("workers.context.overwriteHintPrefix")} {file}
              {t("workers.context.overwriteHintMiddle")} {arr} {t("workers.context.overwriteHintSuffix")}
            </span>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRows(saved)}>
              {t("workers.context.revertButton")}
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { path: "", desc: "" }])}>
          {addLabel}
        </Button>
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              // 워커 자기 항목만 보낸다 — 공통은 `common`이고 이 배열에 없다.
              const r = await save(rows.map(({ path, desc }) => ({ path, desc })));
              setResult(r);
              if (r.ok && r.context?.ok) setRows(r.context.items);
            })
          }
        >
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </>
  );
}

// ── 표 안의 컨텍스트 (§비주얼 §35) ──────────────────────────────────────────

/** 지금 펼쳐진 워커 **하나와 그 워커의 어느 패널인가**. **한 번에 한 패널만 펼친다**(§35 #2가
 *  §4-7에서 한 칸 넓어진다 — 한 행에 토글이 둘이라 워커 이름만으로는 어느 쪽인지 못 가른다.
 *  컨텍스트를 펼친 채 활동을 누르면 컨텍스트가 닫힌다). URL에 안 담는다: 이 화면은 5초마다 다시
 *  그리므로(§4-4) 담으면 매번 서버 렌더가 돌아 편집 중이던 항목 입력이 언마운트된다.
 *  `// ponytail: 딥링크가 생기면 그때`. */
type Expanded = { name: string; panel: "context" | "activity" } | null;

/** 복구 버튼 넷이 성공했을 때 든 문장 — 워커 하나 · 문장 하나(§비주얼 §58). 그 워커의 `이름`
 *  셀의 `blur`가 지운다. */
type Success = { name: string; sentence: string } | null;

/** 같은 `ExpandScope`가 나눠 주는 상태 하나를 튜플로 넓힌 것 — **새 provider 0**(§58 §증감).
 *  뒤 세 자리는 §58이 더한 것: 지금 문장 · 세우고 초점을 옮기는 함수 · 지우는 함수. */
type ExpandApi = [
  Expanded,
  (v: Expanded) => void,
  Success,
  /** 성공한 버튼이 **그 순간 초점을 들고 있을 때만** 부른다(§58 §옮기는 조건) — 부르는 쪽이
   *  `document.activeElement`를 확인한 뒤에만 이 함수를 부르고, 아니면 아무것도 안 한다. */
  (name: string, sentence: string) => void,
  /** `이름` 셀의 `blur`가 부른다 — 그 셀의 문장만 지운다(다른 워커가 그새 성공했으면 안 지운다). */
  (name: string) => void,
];
const ExpandCtx = createContext<ExpandApi>([null, () => {}, null, () => {}, () => {}]);

/** 표 본문이 드는 펼침 상태 하나. **DOM을 한 조각도 안 그리므로** `<TableBody>` 안에 그대로
 *  뜬다 — 서버가 그린 행들을 children으로 받는다(행 마크업은 페이지에 그대로 있다). */
export function ExpandScope({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [success, setSuccess] = useState<Success>(null);
  const announceSuccess = (name: string, sentence: string) => setSuccess({ name, sentence });
  const clearSuccess = (name: string) =>
    setSuccess((s) => (s?.name === name ? null : s));
  return (
    <ExpandCtx.Provider value={[expanded, setExpanded, success, announceSuccess, clearSuccess]}>
      {children}
    </ExpandCtx.Provider>
  );
}

/** `이름` 셀(§비주얼 §58) — 표의 첫 열, 복구 버튼 넷이 성공하면 초점이 오는 자리(그 버튼이
 *  성공 순간 초점을 들고 있었을 때만). `tabIndex={-1}`이라 **탭 순서에 새 정거장이 없다** —
 *  프로그램 `focus()`만 받는다. 문장은 `sr-only`로 셀의 접근 이름에 붙어(§58 §문장은 이름에
 *  둔다) 초점 이동 한 번이 그것을 읽는다 — **새 라이브 리전 0**. `blur`에 지운다 — 남겨 두면
 *  5초 폴링 재렌더 뒤 다음 Tab에서 지난 성공이 다시 읽힌다. */
export function WorkerNameCell({ row }: { row: WorkerRow }) {
  const t = useT();
  const [, , success, , clearSuccess] = useContext(ExpandCtx);
  const ref = useRef<HTMLTableCellElement>(null);
  const sentence = success?.name === row.name ? success.sentence : null;
  useEffect(() => {
    if (success?.name === row.name) ref.current?.focus();
  }, [success, row.name]);
  return (
    <TableCell
      ref={ref}
      tabIndex={-1}
      title={row.path}
      onBlur={() => clearSuccess(row.name)}
      className="px-3 py-0 text-xs outline-none focus-visible:inset-ring-3 focus-visible:inset-ring-ring/50"
    >
      {/* §비주얼 §68 ⑤ — font-mono를 셀에서 떼어 이름 span으로 내린다(배지 글자가 mono를
          물려받지 않게). 이 배지가 설정 다이얼로그 `워커` 노드를 여는 문이다(§4-16 결정 6) */}
      <div className="flex items-center gap-2">
        <span className="font-mono">{row.name}</span>
        {row.commonWorker && (
          <Badge
            variant="outline"
            className="shrink-0 font-sans"
            title={t("workers.pool.badgeTitle")}
            render={<button type="button" onClick={openWorkerSettingsNode} />}
          >
            {t("workers.pool.badge")}
          </Badge>
        )}
      </div>
      {sentence && <span className="sr-only">{sentence}</span>}
    </TableCell>
  );
}

/** `컨텍스트` 열 — **셀이 곧 토글이다**(§35 #3). 모양은 `엔진` 열 그대로다(§23 ②): `size="sm"`이
 *  `h-7`이라 `h-9` 행 높이가 안 변하고, `aria-expanded`를 달면 `TableRow`의
 *  `has-aria-expanded:bg-muted/50`이 펼친 행을 저절로 tint한다(새 클래스 0).
 *
 *  값은 이 워커의 `TICKET_CONTEXT` 항목 수다. **0개는 `—`가 아니라 `0`**이고(안 갖고 있다는 것은
 *  확인된 사실이다 — 토큰 열과 같은 이유), 못 읽는 워커는 `—` + `disabled`다(사유는 같은 행의
 *  둘째 행이 항상 알려 준다). 버튼을 지우지 않는 것은 §4 §세션 스트림과 같은 규칙이다. */
export function WorkerContextCell({ row }: { row: WorkerRow }) {
  const [open, setOpen] = useContext(ExpandCtx);
  const expanded = open?.name === row.name && open.panel === "context";
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!row.context.ok}
      aria-expanded={expanded}
      // `엔진` 열과 같은 이유로 `text-foreground`다 — 행 hover·펼침이 둘 다 `bg-muted/50`이고
      // 거기서 `--muted-foreground`는 라이트 4.54라 §9가 금지한 조합이다(§23 대비 검증).
      className="-ml-2.5 font-mono text-xs font-normal text-foreground"
      onClick={() => setOpen(expanded ? null : { name: row.name, panel: "context" })}
    >
      {row.context.ok ? row.context.items.length : "—"}
      {expanded ? (
        <ChevronDown aria-hidden className="size-3" />
      ) : (
        <ChevronRight aria-hidden className="size-3" />
      )}
    </Button>
  );
}

/** `마지막 활동` 열 — **이 표의 셋째 컨트롤 셀**(§4-7). 조립은 위 `컨텍스트` 셀 그대로이고 셀에
 *  뜨는 값은 **무수정**이다: 여전히 마지막 한 줄 · `max-w-[20rem] truncate` · `title` 전문.
 *  달라지는 것은 그 값이 이제 토글이라는 것뿐이고, 펼치면 둘째 행이 최근 20줄을 잘림 없이 받는다.
 *  줄이 0개면 종전대로 `—` + `disabled`다(사유를 안 붙인다 — 그 `—`가 이미 알려 준다). */
export function WorkerActivityCell({ row }: { row: WorkerRow }) {
  const [open, setOpen] = useContext(ExpandCtx);
  const expanded = open?.name === row.name && open.panel === "activity";
  const last = row.recentLog[0];
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!last}
      aria-expanded={expanded}
      title={last ?? ""}
      className="-ml-2.5 font-mono text-xs font-normal text-foreground"
      onClick={() => setOpen(expanded ? null : { name: row.name, panel: "activity" })}
    >
      <span className="block max-w-[20rem] truncate">{last ?? "—"}</span>
      {expanded ? (
        <ChevronDown aria-hidden className="size-3" />
      ) : (
        <ChevronRight aria-hidden className="size-3" />
      )}
    </Button>
  );
}

/** 펼친 활동 패널의 동사 색 — §비주얼 §37 §다섯 묶음. 동사 열넷이 **색 넷**으로 접힌다
 *  (축은 *그 줄 뒤에 티켓이 어디 있나*라 §2가 티켓 상태에 이미 준 축이고 새 색이 0개다).
 *  **여기 없는 동사는 색이 없다** — 다른 프로젝트의 `runner.log`엔 다른 동사가 있어서
 *  (실측: `stream`의 `AUTH`) 아무 묶음에나 넣지 않는다. `SKIP`은 62%라 색이 아니라
 *  줄을 통째로 물린다(아래). */
const ACTIVITY_VERB_COLOR: Record<string, string> = {
  DISPATCH: "text-status-active",
  DONE: "text-status-done",
  HOLD: "text-status-blocked",
  REAP: "text-status-blocked",
  UNASSIGN: "text-status-blocked",
  WARN: "text-status-blocked",
  ASK: "text-status-blocked",
  FAIL: "text-status-stale",
  TIMEOUT: "text-status-stale",
  STALL: "text-status-stale",
  ERROR: "text-status-stale",
  "REAP-FAIL": "text-status-stale",
  "UNASSIGN-DENY": "text-status-stale",
};

/** `runner.log` 한 줄을 `<span>` 셋으로 쪼갠다 — 시각 접두어(흐리게) · 동사(색) · 나머지.
 *  **쪼개는 것은 표시까지고 글자는 한 자도 안 바뀐다**(§4-8 §검증 — 패널 `textContent`가
 *  `recentLog.join("\n")}`과 같아야 한다). 모양이 안 맞는 줄은 통째로 기본 글자색이다 —
 *  `SKIP`처럼 물리면 못 읽는 줄이 조용히 숨는다(§37). 컴포넌트가 아니라 표시 헬퍼다. */
function activityLine(line: string) {
  const m = /^(\S+ \S+ \[[^\]]+\] )(\S+)(.*)$/.exec(line);
  if (!m) return line;
  // `SKIP` 62%: 접두어·동사·본문이 전부 `--muted-foreground`라 나머지 넷이 앞으로 나온다.
  if (m[2] === "SKIP") return <span className="text-muted-foreground">{line}</span>;
  return (
    <>
      <span className="text-muted-foreground">{m[1]}</span>
      <span className={ACTIVITY_VERB_COLOR[m[2]]}>{m[2]}</span>
      {m[3]}
    </>
  );
}

/** 공통 컨텍스트 카드 — 워커 표 **바로 아래**(§4-1 · §35 #1). 편집기는 워커별 것과 같은 컴포넌트다.
 *  `context.sh`가 없으면 항목 0개이고 **오류가 아니다** — 빈 상태 + `공통 항목 추가`다. */
export function CommonContextCard({
  projectId,
  filePath,
  context,
  cwds,
}: {
  projectId: string;
  /** `<루트>/context.sh` */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string; missing?: true };
  /** 이 프로젝트 워커들의 `TICKET_CWD` 전부(값이 있는 것만) — 워커 하나가 아니라 전부가 기준이다
   *  (§데스크톱 앱 N3 §공통 컨텍스트의 기준). 화면이 이미 워커 행마다 들고 있는 값이라 새 서버
   *  액션·새 필드가 0개다. */
  cwds: string[];
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{t("workers.pool.badge")}</Badge>
        <span className="font-mono text-sm">context.sh</span>
        <span className="text-xs text-muted-foreground">
          {context.ok
            ? `${context.items.length}${t("workers.context.countSuffix")}`
            : t("workers.context.commonReadFailed")}
        </span>
      </div>
      <ContextEditor
        file="context.sh"
        arr="TICKET_CONTEXT_COMMON"
        filePath={filePath}
        context={context}
        cwds={cwds}
        emptyText={t("workers.commonCard.emptyText")}
        addLabel={t("workers.commonCard.addLabel")}
        save={(items) => saveCommonContextAction(projectId, items, locale)}
      />
    </div>
  );
}

/** 머리(`h1 워커` 행)의 트리거가 여는 다이얼로그(§4-15 결정 1-2 · §비주얼 §35 개정, 티켓
 *  `ec2791db`) — `공통 컨텍스트` 카드와 `나머지 워커 설정` 표가 페이지에서 이 다이얼로그 한 장의
 *  섹션 둘로 옮겨왔다. 문구는 종전 두 섹션 글자 그대로고(§4-15 결정 3), 새로 나는 것은 트리거
 *  라벨 하나뿐이다. 렌더 조건(`rows.length > 0`)은 부르는 쪽(`page.tsx`)이 쥔다. */
export function WorkerSettingsDialog({
  projectId,
  filePath,
  context,
  cwds,
  poolLimit,
  poolWorkerCount,
  settings,
  divergent,
  firstWorkerName,
}: {
  projectId: string;
  /** `<루트>/context.sh` */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string; missing?: true };
  cwds: string[];
  /** `<루트>/pool-limit`의 지금 값(§4-16 결정 3). `limit: null` = 파일 없음(`없음`), `warn: true` =
   *  파일은 있는데 못 읽었다(안 빌리는 것으로 읽고 경고를 낸다) */
  poolLimit: PoolLimit;
  /** 지금 이 프로젝트에 들어와 있는 공통 워커 수(shim 개수) — 표의 `공통` 배지 행 수와 같다 */
  poolWorkerCount: number;
  /** 표시 전용 다섯 행. `key`는 이미 사람이 읽을 라벨이다(`page.tsx`의 `LABEL`이 붙여 넘긴다) */
  settings: { key: string; value: string; assumed: boolean }[];
  /** 갈린 설정. `key`도 라벨이 붙어서 온다 — `LABEL`은 페이지 쪽 상수라 여기서 다시 안 찾는다 */
  divergent: { key: string; text: string }[];
  /** 워커 표 첫 행 이름 — 넷째 섹션의 `reap`이 부르는 스크립트다(§4-17 결정 2). `reap`은 큐
   *  전체를 훑어서 어느 워커로 불러도 결과가 같다 — 고르는 규칙을 새로 만들지 않는다 */
  firstWorkerName: string;
}) {
  const t = useT();
  const locale = useLocale();
  const label = t("workers.settingsDialog.trigger");
  // §35 ③의 그 관용구 — 저장 직후 서버 재검증(`revalidatePath`)이 오기 전에도 트리거 값과
  // 현황 문구가 즉시 맞아야 한다(`LimitField`의 `onSaved`와 같은 자리, `personas-ui.tsx`).
  const [limit, setLimit] = useState(poolLimit);
  const [count, setCount] = useState(poolWorkerCount);
  const [reapPending, startReap] = useTransition();
  const [reap, setReap] = useState<WorkerActionResult | null>(null);
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{label}</DialogTrigger>
      <DialogContent className="sm:max-w-[75rem] max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle>{label}</DialogTitle>
        {/* 첫 섹션 — 편집 가능. 산문 195자 그대로(§4-15 §산문) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t("workers.settingsDialog.commonContextHeading")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("workers.settingsDialog.commonContextIntro1")} <span className="font-mono text-xs">source</span>
              {t("workers.settingsDialog.commonContextIntro2")}
              <span className="font-mono text-xs break-all"> {filePath}</span>
              {t("workers.settingsDialog.commonContextIntro3")}{" "}
              <strong className="font-medium">{t("workers.settingsDialog.commonContextTopLabel")}</strong>
              {t("workers.settingsDialog.commonContextIntro4")}
              <span className="font-mono text-xs">$TICKET_CWD</span>
              {t("workers.settingsDialog.commonContextIntro5")}{" "}
              <strong className="font-medium">{t("workers.settingsDialog.commonContextEveryoneLabel")}</strong>{" "}
              {t("workers.settingsDialog.commonContextIntro6")}
            </p>
          </div>
          <CommonContextCard projectId={projectId} filePath={filePath} context={context} cwds={cwds} />
        </section>
        {/* 셋째 섹션 — 공통 워커 빌리기(§4-16 결정 6 · §비주얼 §68 ④). 편집할 수 있는 것 뒤,
            표시 전용(다음 섹션) 앞이다 — 순서는 공통 컨텍스트 -> 공통 워커 빌리기 -> 나머지
            워커 설정. 껍데기는 둘째 섹션과 글자 하나까지 같은 벌이다. */}
        <section className="space-y-2 border-t pt-4">
          <h2 className="text-sm font-semibold">{t("workers.pool.sectionTitle")}</h2>
          <PoolLimitField
            projectId={projectId}
            limit={limit}
            count={count}
            onSaved={(nextLimit, nextCount) => {
              setLimit(nextLimit);
              setCount(nextCount);
            }}
          />
        </section>
        {/* 셋째 섹션 — 표시 전용. 경계는 여기만(§비주얼 §35 개정 ③ "첫 섹션에는 경계가 없다") */}
        <section className="space-y-2 border-t pt-4">
          <div>
            <h2 className="text-sm font-semibold">{t("workers.settingsDialog.readonlyHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("workers.settingsDialog.readonlyDescription")}</p>
          </div>
          <Table>
            <TableBody>
              {settings.map((s) => (
                <TableRow key={s.key} className="h-9">
                  <TableCell className="w-48 px-3 py-0 text-xs text-muted-foreground">{s.key}</TableCell>
                  <TableCell className="px-3 py-0 font-mono text-xs break-all">
                    {s.value}
                    {s.assumed && (
                      <span className="ml-2 font-sans text-muted-foreground">
                        {t("resolve.badge.assumedDefault")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* TICKET_CWD는 워커마다 다른 게 정상이라 여기 없다 — page.tsx의 종전 주석과 같은 근거 */}
          {divergent.length > 0 && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("workers.settingsDialog.divergentTitle")}</AlertTitle>
              <AlertDescription>
                <div className="space-y-1">
                  <p>{t("workers.settingsDialog.divergentBody")}</p>
                  {divergent.map((c) => (
                    <p key={c.key} className="font-mono text-xs break-all">
                      {c.key}: {c.text}
                    </p>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </section>
        {/* 넷째(마지막) 섹션 — 스테일 수거(§4-17 결정 1, 티켓 642dd26f). 종전에는 행마다
            `reap` 버튼과 출력 다이얼로그였다 — `reap`은 그 워커만이 아니라 큐 전체를 훑으므로
            워커별 사본이 성립하지 않는다(§4-17 사실 3). 프로젝트에 버튼 하나만 남기고 표의
            첫 행 스크립트로 부른다(결정 2). 다이얼로그 안에서 다이얼로그를 새로 열지 않고
            출력은 이 섹션 안에 뜬다(결정 3) — 알맹이(`Failure`·`pre`)와 산문은 종전 reap 출력
            다이얼로그 글자 그대로다. 앞의 셋은 값이고 이것은 실행이라 맨 뒤다. */}
        <section className="space-y-2 border-t pt-4">
          <div>
            <h2 className="text-sm font-semibold">{t("workers.reap.sectionTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("workers.settingsDialog.reapDescription")}</p>
          </div>
          {/* `min-w-16`(64px)은 §비주얼 §4-3 슬롯 고정을 그대로 따라온다 — `reap…`가 `reap`보다
              넓어서 누른 자리가 커지면 안 된다 */}
          <Button
            variant="ghost"
            size="sm"
            className="min-w-16"
            disabled={reapPending}
            onClick={() =>
              startReap(async () => setReap(await reapWorkerAction(projectId, firstWorkerName, locale)))
            }
          >
            {reapPending ? "reap…" : "reap"}
          </Button>
          {reap && !reap.ok && (
            <Failure
              title={`${firstWorkerName}${t("workers.settingsDialog.reapFailedTitleSuffix")}`}
              message={reap.message ?? reap.output ?? ""}
            />
          )}
          {reap?.output && (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {reap.output}
            </pre>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** 값이 곧 트리거인 팝오버 — `personas-ui.tsx`의 `LimitField`와 같은 관용구(§35 ③). 저장은
 *  `savePoolLimitAction` 하나뿐이고, 빈 값은 `0`과 같은 효과다(§4-16 결정 3 — `PoolLimit.limit`이
 *  `null`인 것은 파일이 아예 없는 최초 상태뿐, 한 번 저장하면 그 뒤로는 항상 숫자다).
 *  `blocked`(0으로 되돌릴 때 티켓을 물고 있어 못 뺀 shim)는 저장 성공 위에 얹는 경고 한 줄이다 —
 *  저장 자체는 그래도 성공이다(`pool-limit`은 `0`으로 쓰인다). */
function PoolLimitField({
  projectId,
  limit,
  count,
  onSaved,
}: {
  projectId: string;
  limit: PoolLimit;
  count: number;
  onSaved: (limit: PoolLimit, count: number) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const saved = limit.limit === null ? "" : String(limit.limit);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; reason: string }[]>([]);
  const [pending, start] = useTransition();
  const ready = !pending && value.trim() !== saved;

  const save = () =>
    start(async () => {
      const r = await savePoolLimitAction(projectId, value, locale);
      if (r.ok) {
        const nextLimit = { limit: r.limit ?? 0, warn: false };
        onSaved(nextLimit, r.count ?? 0);
        setValue(String(r.limit ?? 0));
        setError(null);
        setBlocked(r.blocked ?? []);
        setOpen(false);
      } else {
        setError(r.message ?? t("workers.pool.saveFailed"));
      }
    });

  return (
    <div className="space-y-1">
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("workers.pool.limitLabel")}</span>
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setValue(saved);
              setError(null);
            }
          }}
        >
          <PopoverTrigger render={<Button variant="ghost" size="sm" className="font-normal" />}>
            <span className={limit.limit !== null ? "font-mono text-xs" : undefined}>
              {limit.limit === null ? t("workers.pool.limitNone") : limit.limit}
            </span>
            <ChevronDown aria-hidden className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="start">
            <div className="space-y-2">
              <Label htmlFor="pool-limit-input">{t("workers.pool.limitPopoverLabel")}</Label>
              <Input
                id="pool-limit-input"
                type="number"
                min={0}
                step={1}
                placeholder={t("workers.pool.limitNone")}
                className="w-full font-mono"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("workers.pool.limitPopoverHint")}</p>
            {error && <Failure title={t("workers.pool.saveFailedTitle")} message={error} />}
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                className="ml-auto"
                aria-disabled={!ready}
                onClick={() => {
                  if (ready) save();
                }}
              >
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </span>
      <p className="text-xs text-muted-foreground">
        {count === 0
          ? t("workers.pool.countZero")
          : `${t("workers.pool.countPrefix")}${count}${t("workers.pool.countSuffix")}`}
      </p>
      {limit.warn && <p className="text-xs text-status-stale">{t("workers.pool.warnUnreadable")}</p>}
      {blocked.length > 0 && (
        <p className="text-xs text-status-stale">
          {t("workers.pool.blockedPrefix")}
          {blocked.map((b) => b.name).join(", ")}
        </p>
      )}
    </div>
  );
}

/** 워커 하나의 **둘째 행**(§비주얼 §35 #2·#4) — 경고 여섯과 펼친 컨텍스트 편집이 여기 있다.
 *  종전 `WorkerContextCard`가 표 아래에 N장 서던 것을 그 워커의 행 안으로 접은 것이고, 카드가
 *  들고 있던 것은 그대로다(편집기 · `→ <워커>` 복사 · 다이얼로그. 항목 수는 `컨텍스트` 열로 올라갔다).
 *
 *  **경고는 접힘과 무관하게 항상 보인다** — 펼쳐야 보이는 경고를 만들지 않는다(§35 #4).
 *  순서는 `결함 → 실패 → 공통 미수신 → 자가 정리 미적용 → 통합 게이트 미적용 → 컨텍스트 거부
 *  사유`이고 앞의 둘은 서버가 그려 `warnings`로 넘긴다(그 마크업은 페이지에 그대로 있다).
 *
 *  저장은 `TICKET_CONTEXT=( … )` **블록 전체 치환**이고, 블록 모양이 예상과 다르면 서버가
 *  거부한다 — 그때는 편집 UI를 아예 열지 않고 손으로 고치라고 알린다. */
export function WorkerContextRow({
  projectId,
  row,
  others,
  common,
  warnings,
}: {
  projectId: string;
  row: WorkerRow;
  /** 복사 대상 후보(자기 자신 제외) */
  others: string[];
  /** 공통 항목. `row.commonSource`가 false면 이 워커는 못 받으므로 그리지 않는다 (§4-1) */
  common: ContextRow[];
  /** 작업 디렉터리 결함(§4) · 외부 요인 실패(§0-5). 둘 다 없으면 `null`이다 */
  warnings?: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, , , announceSuccess] = useContext(ExpandCtx);
  const expanded = open?.name === row.name && open.panel === "context";
  const activity = open?.name === row.name && open.panel === "activity";
  const saved = row.context.ok ? row.context.items : [];
  const [copyTo, setCopyTo] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [healError, setHealError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // 자가 정리는 **다른 파일에 다른 줄을 쓴다**(§4-4) — 전이를 나눠야 한쪽이 도는 동안
  // 나머지 버튼이 남의 라벨(`적용 중…`)로 서지 않는다.
  const [healing, startHeal] = useTransition();
  // 통합 게이트도 마찬가지로 다른 파일이라 전이를 또 나눈다(§4-14 §소급).
  const [gating, startGate] = useTransition();
  // §비주얼 §58 — 성공하면 그 순간 초점을 든 버튼일 때만 `이름` 셀로 낭독을 넘긴다(넷 중 셋, 넷째는 `ExecBitFix`).
  const applyBtnRef = useRef<HTMLButtonElement>(null);
  const healBtnRef = useRef<HTMLButtonElement>(null);
  const gateBtnRef = useRef<HTMLButtonElement>(null);
  const gets = row.commonSource ? common : [];
  // 통합 게이트 경고는 `source` 줄이 없거나(§4-14) 있어도 파일 내용이 낡았으면 뜬다(§4-14 §소급).
  const gateWarn = !row.dispatchGateSource || row.dispatchGateStale;
  // 접혀 있어도 이 행이 뜨는 조건 — 경고 여섯 중 하나라도 있으면이다(§35 #4).
  const warned =
    !!warnings || !row.commonSource || !row.selfHealSource || gateWarn || !row.context.ok || !!row.cwdPending;
  // 활동 펼침도 이 행이 받는다(§4-7) — 조건을 안 넓히면 셀을 눌러도 받을 행이 없다.
  if (!warned && !expanded && !activity) return null;

  return (
    <TableRow className="hover:bg-transparent">
      {/* 셀에 줄바꿈을 허용한다 — `TableCell` 기본값이 `nowrap`이라 패널 산문이 한 줄로 뜨고
          auto table layout이 그 max-content를 컬럼 폭 배분에 넣는다(§비주얼 §6 텍스트 잘림). */}
      <TableCell colSpan={9} className="px-3 py-2 whitespace-normal">
        <div className="space-y-2">
          {warnings}

          {/* `source` 줄이 없으면 이 워커만 공통에서 빠진다. 조용히 넘기면 "전원이 본다"는 전제가
              화면에서 거짓이 된다(§4-1) — 사실을 말하고 그 자리에서 줄을 넣게 한다. */}
          {!row.commonSource && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("workers.contextRow.noCommonSourceTitle")}</AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    {row.name}
                    {t("workers.contextRow.fileSuffixPrefix")} <span className="font-mono text-xs">context.sh</span>
                    {t("workers.contextRow.fileSuffixGlue")}{" "}
                    <span className="font-mono text-xs">.</span> {t("workers.contextRow.noCommonSourceBodyMiddle")}{" "}
                    {common.length}
                    {t("workers.contextRow.noCommonSourceBodySuffix")}
                  </p>
                  <Button
                    ref={applyBtnRef}
                    size="sm"
                    variant="outline"
                    aria-disabled={pending}
                    className="aria-disabled:opacity-50"
                    onClick={() => {
                      if (pending) return; // §58 §못 누르는 실효 — aria-disabled에는 pointer-events-none이 없다
                      start(async () => {
                        const r = await applyCommonSourceAction(projectId, row.name, locale);
                        setApplyError(r.ok ? null : (r.message ?? t("workers.contextRow.lineNotAddedDefault")));
                        if (r.ok && document.activeElement === applyBtnRef.current) {
                          announceSuccess(row.name, t("workers.contextRow.commonAppliedSentence"));
                        }
                      });
                    }}
                  >
                    {pending ? t("workers.contextRow.applyingPending") : t("workers.contextRow.applyCommonButton")}
                  </Button>
                  {applyError && (
                    <Failure title={t("workers.contextRow.applyCommonFailedTitle")} message={applyError} />
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* 이 줄이 없으면 그 워커는 자기 cron 줄을 뺄 코드를 못 만난다 — dira를 지워도 줄이 남아
              cron이 1분마다 없는 파일을 부른다(§4-4 §소급). 모양은 위 `공통 적용`과 같다. */}
          {!row.selfHealSource && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("workers.contextRow.noSelfHealTitle")}</AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    {row.name}
                    {t("workers.contextRow.fileSuffixPrefix")} <span className="font-mono text-xs">self-heal.sh</span>
                    {t("workers.contextRow.fileSuffixGlue")}{" "}
                    <span className="font-mono text-xs">.</span> {t("workers.contextRow.selfHealMissingMiddle")}{" "}
                    <span className="font-mono text-xs">. tick.sh</span>{" "}
                    {t("workers.contextRow.selfHealMissingSuffix")}
                  </p>
                  <Button
                    ref={healBtnRef}
                    size="sm"
                    variant="outline"
                    aria-disabled={healing}
                    className="aria-disabled:opacity-50"
                    onClick={() => {
                      if (healing) return; // §58 §못 누르는 실효
                      startHeal(async () => {
                        const r = await applySelfHealAction(projectId, row.name, locale);
                        setHealError(r.ok ? null : (r.message ?? t("workers.contextRow.lineNotAddedDefault")));
                        if (r.ok && document.activeElement === healBtnRef.current) {
                          announceSuccess(row.name, t("workers.contextRow.selfHealAppliedSentence"));
                        }
                      });
                    }}
                  >
                    {healing ? t("workers.contextRow.applyingPending") : t("workers.contextRow.applySelfHealButton")}
                  </Button>
                  {healError && (
                    <Failure title={t("workers.contextRow.applySelfHealFailedTitle")} message={healError} />
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* 이 줄이 없으면 받는 트리가 더러워도 이 워커는 그냥 디스패치되고, 세션이 일을 다 끝낸
              뒤 push에서만 막힌다(§4-14 §소급). 줄이 있어도 `dispatch-gate.sh` 내용이 낡았으면
              이 워커가 옛 판을 그대로 돈다 — 판정만 늘고 모양은 위 둘과 같다. */}
          {gateWarn && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>
                {row.dispatchGateSource
                  ? t("workers.contextRow.gateStaleTitle")
                  : t("workers.contextRow.gateMissingTitle")}
              </AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    {row.dispatchGateSource ? (
                      <>
                        <span className="font-mono text-xs">dispatch-gate.sh</span>
                        {t("workers.contextRow.gateStaleBody")}
                      </>
                    ) : (
                      <>
                        {row.name}
                        {t("workers.contextRow.fileSuffixPrefix")}{" "}
                        <span className="font-mono text-xs">dispatch-gate.sh</span>
                        {t("workers.contextRow.fileSuffixGlue")}{" "}
                        <span className="font-mono text-xs">.</span> {t("workers.contextRow.gateMissingMiddle")}{" "}
                        <span className="font-mono text-xs">. tick.sh</span>{" "}
                        {t("workers.contextRow.gateMissingSuffix")}
                      </>
                    )}
                  </p>
                  <Button
                    ref={gateBtnRef}
                    size="sm"
                    variant="outline"
                    aria-disabled={gating}
                    className="aria-disabled:opacity-50"
                    onClick={() => {
                      if (gating) return; // §58 §못 누르는 실효
                      startGate(async () => {
                        const r = await applyDispatchGateAction(projectId, row.name, locale);
                        setGateError(r.ok ? null : (r.message ?? t("workers.contextRow.lineNotAddedDefault")));
                        if (r.ok && document.activeElement === gateBtnRef.current) {
                          announceSuccess(row.name, t("workers.contextRow.gateAppliedSentence"));
                        }
                      });
                    }}
                  >
                    {gating ? t("workers.contextRow.applyingPending") : t("workers.contextRow.applyGateButton")}
                  </Button>
                  {gateError && (
                    <Failure title={t("workers.contextRow.applyGateFailedTitle")} message={gateError} />
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* 다섯째 경고 — 블록을 못 읽는 워커의 사유(§35 §다섯째 경고). 편집기 안이 아니라 여기
              있는 이유는 접힌 행에서도 떠야 해서다. 이 워커는 펼침이 없다(`컨텍스트` 열이 `disabled`). */}
          {!row.context.ok && (
            <ContextRejection
              file={`${row.name}.sh`}
              arr="TICKET_CONTEXT"
              filePath={row.path}
              reason={row.context.reason}
              missing={row.context.missing}
            />
          )}

          {/* 일곱째 — 결함이 아니라 표기 한 줄(§4-19 결정 3, §비주얼 §69). 그릇·아이콘·색·조작
              0개. 경고 여섯의 아래, 스택의 마지막이다 — 사람이 할 일이 있는 쪽이 위라는 축을
              그대로 따른다(위 여섯은 전부 조작을 하나씩 갖고 있고 이 줄은 0개다). */}
          {row.cwdPending && <p className="text-xs text-muted-foreground">{row.cwdPending}</p>}

          {/* 펼친 자리 — 산문 한 덩이(화면에 최대 한 번이다. 한 번에 한 행이라) + 복사 + 편집기.
              ponytail: 접으면 편집기가 언마운트돼 저장 안 한 편집이 사라진다. 한 번에 한 행이
              §35의 규칙이라 이 대가를 받는다 — 되돌리기가 그 자리에 이미 있다. */}
          {expanded && row.context.ok && (
            <div className="space-y-3 pt-1">
              <p className="text-sm text-muted-foreground">
                {t("workers.contextRow.expandedIntroPrefix")}{" "}
                <span className="font-mono text-xs">TICKET_CONTEXT</span>{" "}
                {t("workers.contextRow.expandedIntroMid1")}{" "}
                <strong className="font-medium">{t("workers.contextRow.expandedIntroBold")}</strong>{" "}
                {t("workers.contextRow.expandedIntroMid2")} <span className="font-mono text-xs">WARN</span>
                {t("workers.contextRow.expandedIntroMid3")}{" "}
                <span className="font-mono text-xs">{t("workers.pool.badge")}</span>{" "}
                {t("workers.contextRow.expandedIntroSuffix")}
              </p>
              {others.length > 0 && (
                <div className="flex items-center justify-end gap-1">
                  <span className="text-xs text-muted-foreground">{t("workers.contextRow.copyThisLabel")}</span>
                  {others.map((o) => (
                    <Button key={o} variant="ghost" size="sm" className="font-mono" onClick={() => setCopyTo(o)}>
                      → {o}
                    </Button>
                  ))}
                </div>
              )}
              <ContextEditor
                file={`${row.name}.sh`}
                arr="TICKET_CONTEXT"
                filePath={row.path}
                context={row.context}
                common={gets}
                // ponytail: `TICKET_CWD` 줄이 없는 워커(엔진 기본값 = 루트의 부모)는 기준이 없어 피커가
                // 안 뜬다 — 타이핑은 종전대로다.
                cwds={row.cwd ? [row.cwd] : []}
                emptyText={
                  gets.length > 0
                    ? t("workers.contextRow.emptyWithCommon")
                    : t("workers.contextRow.emptyNoCommon")
                }
                addLabel={t("workers.contextRow.addItemLabel")}
                save={(items) => saveContextAction(projectId, row.name, items, locale)}
              />
            </div>
          )}

          {/* 펼친 활동 — `runner.log`의 이 워커 최근 20줄, **최신이 위**(셀에 뜬 그 줄이 첫 줄이라
              이 줄을 눌러 폈다가 자명하다). 필터·아이콘·링크는 여전히 0이고 시각 접두어까지 줄
              그대로다(§4-7). 이 패널이 있는 이유가 잘린 것을 보는 것이라 잘림도 0이다.

              **패널이 자기 모드를 든다** — `dark` 한 클래스가 라이트에서 페이지에서 떨어진 검은
              몸(17.91)을, 다크에서 카드 층 한 단 위(1.10 + 테두리 1.46)를 만든다. 값은 전부
              §비주얼 §37 §값 표의 `클래스` 칸이고 새 색 토큰 0 · `globals.css` 0줄이다.
              `mt-1`이 `pt-1`을 대신하는 이유: 그 4px이 **면 밖**이어야 한다.
              `tabIndex={0}` — `overflow-y-auto` 상자는 크롬에서 기본으로 포커스를 못 받아
              키보드만 쓰는 사람이 감긴 줄에 못 닿는다(WCAG 2.1.1 · §37 §접근성).
              `whitespace-pre-wrap break-all` 무수정 — `pre`로 바꾸면 표가 1869.5px로 벌어진다.
              ponytail: 연속으로 같은 본문이 뜨면 `× n`으로 접는 것이 다음 단계다. 지금은 안 만든다. */}
          {activity && (
            <div
              data-activity-panel
              tabIndex={0}
              className="dark mt-1 max-h-96 overflow-y-auto rounded-md border bg-card p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground"
            >
              {row.recentLog.map((line, i) => (
                // 줄 사이의 `"\n"`이 `textContent`를 `join("\n")`과 같게 만든다(§4-8 §검증).
                <Fragment key={i}>
                  {i > 0 && "\n"}
                  {activityLine(line)}
                </Fragment>
              ))}
            </div>
          )}

          {/* 워커 간 복사 — 받는 쪽 블록이 통째로 없어진다. 되돌리기가 없으므로 먼저 알린다 */}
          <Dialog open={!!copyTo} onOpenChange={(o) => !o && setCopyTo(null)}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {t("workers.contextRow.copyDialogTitlePrefix")} {row.name} → {copyTo}
                </DialogTitle>
                <DialogDescription>
                  {copyTo}
                  {t("workers.contextRow.copyDescMid1")} {row.name}
                  {t("workers.contextRow.copyDescMid2")} {saved.length}
                  {t("workers.contextRow.copyDescMid3")} {copyTo}
                  {t("workers.contextRow.copyDescSuffix")}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono text-xs">$TICKET_CWD</span>
                {t("workers.contextRow.copyBodySuffix")}
              </p>
              {copyError && <Failure title={t("workers.contextRow.copyFailedTitle")} message={copyError} />}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
                <Button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await copyContextAction(projectId, row.name, copyTo!, locale);
                      setCopyError(r.ok ? null : (r.message ?? t("workers.contextRow.copyFailedDefaultMessage")));
                      if (r.ok) setCopyTo(null);
                    })
                  }
                >
                  {pending ? t("workers.contextRow.copyingPending") : t("workers.contextRow.copyButton")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </TableCell>
    </TableRow>
  );
}
