"use client";

/** 워커 화면(`/p/<project>/workers`)의 클라이언트 조각 — 생성 · 중단 · 재등록 · 삭제 · reap.
 *
 *  **crontab의 그 워커 줄은 GUI가 쓴다**(제약 4, `44f876aa`로 뒤집힘). 생성·중단·삭제 세 자리가
 *  다 한 동작이고, 서버가 만들어 준 명령어를 `<CopyCommand>`로 복사시키는 건 **실패했을 때**다.
 *  fs를 만지는 건 서버 액션뿐이다.
 *  파일 하나에 모은 이유는 projects-ui.tsx와 같다 — 세 다이얼로그가 같은 문구·같은 명령어를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleQuestionMark,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  applyCommonSourceAction,
  applySelfHealAction,
  copyContextAction,
  createWorkerAction,
  deleteWorkerAction,
  reapWorkerAction,
  registerWorkerAction,
  saveCommonContextAction,
  saveContextAction,
  setEngineAction,
  stopWorkerAction,
  type ContextResult,
  type WorkerActionResult,
} from "@/app/p/[project]/workers/actions";
import { CopyCommand } from "@/components/copy-command";
import { PickPath } from "@/components/path-picker";
import { SessionStream } from "@/components/session-stream";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeUnder } from "@/lib/urls";
import { cn } from "@/lib/utils";

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
  /** `엔진` 열이 그리는 것 — 판정은 서버(`engineCell`)가 한다. 표시 4종의 출처가 하나여야
   *  화면 둘이 안 갈린다(§비주얼 §23 ①). `argv`는 셀 `title`의 전문이고 `value`는 팝오버
   *  초기값이다(`null` = 카탈로그 밖 = 손으로 쓴 값) */
  engine: {
    label: string;
    badge: "assumed" | "custom" | null;
    argv: string;
    value: { engineId: string; model: string } | null;
  };
  /** `engine`의 첫 토큰 basename — §0-4 인증 배너와 **같은 `engineName`**이다. 서버가 계산해
   *  넘긴다: `lib/workers.ts`가 `node:fs`를 타서 이 파일이 그 함수를 못 import한다(§규약).
   *  세션 스트림·참견이 이 값 하나로 갈린다(§4-3 · §비주얼 §23 ⑤) */
  engineName: string;
  lastLog: string | null;
  registerCmd: string;
  unregisterCmd: string;
  /** TICKET_CONTEXT 항목 또는 GUI가 못 고치는 사유 */
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
  /** 공통 컨텍스트 `source` 줄이 있는가. false면 이 워커는 공통을 못 받는다 (§4-1) */
  commonSource: boolean;
  /** 자가 정리 `source` 줄이 있는가. false면 dira를 지워도 이 워커의 cron 줄이 남는다 (§4-4) */
  selfHealSource: boolean;
  /** `TICKET_CWD`. null = 줄이 없다(엔진 기본값 = 루트의 부모) */
  cwd: string | null;
  /** 작업 디렉터리 결함 (§4). **0개가 정상**이고 그때 행은 아무것도 늘지 않는다.
   *  `status`와 직교한다 — 결함이 있어도 락이 있으면 `running`이다 */
  defects: { kind: "missing-cwd" | "missing-link" | "shared-cwd"; detail: string }[];
  /** 외부 요인으로 죽은 마지막 세션 (§0-5). **정상 상태에서는 항상 `null`이고** 그때 행은
   *  아무것도 늘지 않는다. `defects`와 같은 축이다 — 실패 직후의 워커는 `idle`이다 */
  lastFailure: { at: string; hash: string; reason: string; log: string } | null;
  /** 결함이 있을 때만 온다. §4 생성의 준비 3줄과 같은 문자열이다 */
  worktree?: string[];
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

/** 첫 등록은 macOS `앱 관리` 승인 창을 지난다(§제약 4) — 그동안 crontab이 블록되고 버튼은
 *  `…중`으로 서 있다. 창을 못 알아보면 3분 뒤 등록만 실패한다.
 *  **생성과 재등록이 같은 `crontab -` 쓰기라 같은 벽에서 멈춘다** — 그래서 문구도 하나다(§4 재등록). */
function CrontabApproval() {
  return (
    <p className="text-xs text-muted-foreground">
      권한 창이 뜨면 [허용]을 누르세요 — crontab 등록이 그 대답을 기다립니다.
    </p>
  );
}

// ── 엔진 · 모델 필드 한 쌍 (§4-3 · §비주얼 §23 ③) ───────────────────────────

/** 서버가 **값으로** 내려주는 카탈로그 = `lib/workers.ts`의 `ENGINES` 그대로다. 그 모듈은
 *  `node:fs`를 물어 클라이언트가 import할 수 없고, 목록을 여기 다시 적으면 화면이 파일에
 *  안 들어가는 이름을 그리게 된다(두 벌은 반드시 갈린다). */
export type EngineCatalog = readonly { id: string; models: readonly string[] }[];

/** 고른 값. `모델 지정 안 함`은 **빈 문자열**이고(`NO_MODEL`) 라벨은 화면이 붙인다(§23 ③).
 *  `custom`이면 `model`은 사람이 친 글자다 — 목록 값과 같은 자리를 쓴다. */
export type EnginePick = { engine: string; model: string; custom?: boolean };

/** 목록에 없는 **화면만의 항목**. 값이 곧 라벨이고 모델 이름과 겹칠 수 없다 — 서버의
 *  `MODEL_RE`가 한글도 `…`도 안 받는다. */
const CUSTOM = "직접 입력…";

/** 지금 값으로 만들 수 있는가. 직접 입력만 걸린다 — 빈 값(`+`가 0글자를 안 받는다)과 셸
 *  메타문자가 여기서 막힌다. **즉시 거절일 뿐이고** 진짜 검증은 서버가 다시 한다(§23 ④). */
export const enginePickOk = (pick: EnginePick, modelPattern: string) =>
  !pick.custom || new RegExp(modelPattern).test(pick.model);

/** 워커 행의 팝오버와 생성 폼이 **같은 것**을 그린다(§23 ③). 두 자리에서 라벨 id가 겹치지
 *  않게 `idPrefix`만 갈린다. */
export function EngineFields({
  engines,
  modelPattern,
  value,
  onChange,
  idPrefix = "worker",
}: {
  engines: EngineCatalog;
  /** 서버 `MODEL_RE.source`. 화면이 정규식을 따로 적지 않는다 */
  modelPattern: string;
  value: EnginePick;
  onChange: (v: EnginePick) => void;
  idPrefix?: string;
}) {
  const models = engines.find((e) => e.id === value.engine)?.models ?? [];
  // 빈 칸은 아직 거절이 아니다 — `직접 입력…`을 고르자마자 빨간 줄이 뜨면 사람이 무엇을
  // 잘못했는지 모른다. 못 만든다는 사실은 부르는 쪽의 1차 버튼이 말한다(`enginePickOk`).
  const bad = !!value.custom && value.model !== "" && !new RegExp(modelPattern).test(value.model);
  const hintId = `${idPrefix}-model-hint`;
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-engine`}>엔진</Label>
        {/* 엔진을 바꾸면 모델은 `모델 지정 안 함`으로 돌아간다 — 목록이 엔진에 딸려 있어서
            `opus`를 든 채 codex로 넘어가면 화면이 없는 조합을 보여준다(§23 ③). */}
        <Select value={value.engine} onValueChange={(v) => onChange({ engine: String(v), model: "" })}>
          <SelectTrigger id={`${idPrefix}-engine`} className="w-full font-mono">
            {/* 생성 폼은 항상 값이 있고(기본값 `claude`), 비는 자리는 워커 행에서 **손으로 쓴
                값**을 열었을 때 하나다 — 그때도 빈 줄이 아니라 말이 뜬다(§23 ③ 팝오버 초기값). */}
            <SelectValue placeholder="고르지 않음" />
          </SelectTrigger>
          <SelectContent>
            {engines.map((e) => (
              <SelectItem key={e.id} value={e.id} className="font-mono">
                {e.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-model`}>모델</Label>
        <Select
          value={value.custom ? CUSTOM : value.model}
          onValueChange={(v) =>
            onChange(
              String(v) === CUSTOM
                ? { engine: value.engine, model: "", custom: true }
                : { engine: value.engine, model: String(v) },
            )
          }
        >
          {/* 모델 이름은 argv에 들어가는 토큰이라 mono다. `모델 지정 안 함`·`직접 입력…`은
              문장이라 sans다(§23 ③). */}
          <SelectTrigger
            id={`${idPrefix}-model`}
            className={cn("w-full", value.model && !value.custom && "font-mono")}
          >
            {/* **라벨은 화면이 붙인다**(§23 ③). `모델 지정 안 함`의 값은 빈 문자열이라
                Select에 맡기면 트리거에 **빈 줄 하나**가 뜬다(실측 — 항목 라벨은 팝업이
                열린 뒤에야 등록된다). 이 절이 막는 빈칸이 되살아나는 자리다. */}
            <SelectValue>{(v) => (v ? String(v) : "모델 지정 안 함")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m} className={m ? "font-mono" : undefined}>
                {m || "모델 지정 안 함"}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>{CUSTOM}</SelectItem>
          </SelectContent>
        </Select>
        {value.custom && (
          <>
            {/* 받는 것은 **모델 이름 한 토큰**이다 — argv 전체가 아니다(§23 ④). 라벨은 위
                Select가 갖고 있어서 칸은 `aria-label`로 자기 이름을 댄다. */}
            <Input
              aria-label="모델 이름 직접 입력"
              aria-describedby={hintId}
              className="font-mono"
              placeholder="모델 이름"
              value={value.model}
              onChange={(e) =>
                onChange({ engine: value.engine, model: e.target.value, custom: true })
              }
            />
            {bad ? (
              // 원인이 값이 아니라 한 문장이고 다음 행동은 포커스가 놓인 그 칸이다 —
              // `Alert`가 아닌 이유가 이것이다(§22 ③ · §23 ④).
              <p id={hintId} role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
                <TriangleAlert className="size-3.5" aria-hidden />
                공백·따옴표는 쓸 수 없습니다 — 모델 이름 한 토큰만
              </p>
            ) : (
              <p id={hintId} className="text-xs text-muted-foreground">
                엔진에 그대로 넘어갑니다 — 공백·따옴표 없는 한 토큰
              </p>
            )}
          </>
        )}
      </div>

      {/* 예고 — codex는 고장이 아니라 기능 집합이 다르다(§23 ⑤). 새 그릇을 만들지 않는다 */}
      {value.engine === "codex" && (
        <p className="text-xs text-muted-foreground">
          codex 워커는 참견과 세션 스트림이 없습니다 — 티켓 수행은 같습니다.
        </p>
      )}
    </>
  );
}

// ── 워커 행의 `엔진` 셀 (§비주얼 §23 ① ②) ──────────────────────────────────

/** 잘린 값·배지 설명. `projects-ui.tsx`의 같은 이름과 같은 모양이다 — §0 해석 결과 표의
 *  배지를 그대로 빌린다(사실이 같아서 새 어휘를 만들지 않았다, §23 ①). */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

/** 둘 다 색이 없다 — 색은 예외를 표시하는데(§0) 넷 다 정상이다(§23 ①). */
const BADGE: Record<"assumed" | "custom", { label: string; hint: string }> = {
  assumed: {
    label: "기본값 가정",
    hint: "이 워커에는 TICKET_ENGINE 대입이 없습니다 — tick.sh 기본값(46행)을 쓰는 중입니다",
  },
  custom: {
    label: "손으로 쓴 값",
    hint: "카탈로그에 없는 명령입니다 — 아래 원문이 그대로 돕니다",
  },
};

/** `엔진` 열 — **값이 곧 트리거다**(§23 ②). `size="sm"`이 `h-7`이라 `h-9` 행 높이가 안 변하고,
 *  열려 있는 동안 `TableRow`의 `has-aria-expanded:bg-muted/50`가 그 행을 저절로 tint한다.
 *  팝오버 안은 생성 폼과 **같은 `<EngineFields>`**다 — 목록도 문구도 한 벌이다(§23 ③). */
export function EngineCell({
  projectId,
  row,
  engines,
  modelPattern,
}: {
  projectId: string;
  row: WorkerRow;
  engines: EngineCatalog;
  modelPattern: string;
}) {
  // 파일에서 읽은 값이 초기값이다. 손으로 쓴 값(`value === null`)이면 **고른 것이 없는 채로**
  // 연다 — 열어 본 것만으로 그 줄이 덮이는 길이 없다(§23 ③).
  const initial = (): EnginePick => ({
    engine: row.engine.value?.engineId ?? "",
    model: row.engine.value?.model ?? "",
  });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<EnginePick>(initial);
  const [result, setResult] = useState<WorkerActionResult | null>(null);
  const [pending, start] = useTransition();
  const ready = pick.engine !== "" && enginePickOk(pick, modelPattern) && !pending;

  return (
    <div className="flex items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // 닫는 것이 곧 취소다 — 저장 전에는 아무것도 안 썼다(§23 ②). 다시 열면 파일 값이다.
          if (!o) {
            setPick(initial());
            setResult(null);
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              // `text-foreground`다 — 행 hover와 팝오버 열림이 둘 다 `bg-muted/50`이고 거기서
              // `--muted-foreground`는 라이트 4.54로 §9가 금지한 조합이다(§23 대비 검증).
              className="-ml-2.5 font-mono text-xs font-normal text-foreground"
            />
          }
        >
          <span className="block max-w-[14rem] truncate">{row.engine.label}</span>
          <ChevronDown aria-hidden className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start">
          <EngineFields
            engines={engines}
            modelPattern={modelPattern}
            value={pick}
            onChange={setPick}
            idPrefix={`engine-${row.name}`}
          />
          {/* 손으로 쓴 값은 무엇을 덮는지 먼저 보여준다(§23 ③) */}
          {row.engine.badge === "custom" && (
            <div className="space-y-1">
              <p className="font-mono text-xs break-all">{row.engine.argv}</p>
              <p className="text-xs text-muted-foreground">저장하면 이 줄을 덮어씁니다</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {row.status === "running"
              ? "지금 도는 세션은 그대로입니다 — 다음 tick부터 적용됩니다."
              : "다음 tick부터 적용됩니다."}
          </p>
          {/* 거부(할당 2개·`+=`·주석·닫는 `)` 없음·`source` 줄 없음)는 파일을 안 쓴 것이다.
              팝오버는 열린 채로 남고 고른 값도 남는다 — 사람이 파일을 고치고 다시 누른다(§23) */}
          {result && !result.ok && (
            <Failure
              title={`${row.name}.sh의 TICKET_ENGINE 블록을 GUI가 고칠 수 없습니다`}
              message={result.message ?? ""}
            />
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              // `disabled`가 아니라 `aria-disabled`다(§23 로딩 항) — 못 누른다는 사실만 말한다.
              aria-disabled={!ready}
              className="aria-disabled:opacity-50"
              onClick={() => {
                if (!ready) return;
                start(async () => {
                  const r = await setEngineAction(projectId, row.name, pick.engine, pick.model);
                  setResult(r);
                  // 성공하면 닫는다. 새 값은 **서버가 파일을 다시 읽어** 그린다(낙관적 에코가
                  // 아니다) — 토스트를 띄우지 않는 이유도 그것이다(§23 ②).
                  if (r.ok) setOpen(false);
                });
              }}
            >
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {row.engine.badge && (
        <Hint text={BADGE[row.engine.badge].hint}>
          <Badge variant="outline">{BADGE[row.engine.badge].label}</Badge>
        </Hint>
      )}
    </div>
  );
}

// ── 생성 ────────────────────────────────────────────────────────────────────

/** §6 에러 3요소의 1번 — **어느 단계에서 멈췄나**. 인덱스는 `WorktreePrep.done`(= 끝난 단계 수)이다.
 *  성공(3)은 여기 없다 — 그 화면에는 에러가 없다. */
const WORKTREE_STEP = [
  "워크트리를 만들지 못했습니다",
  ".dira 심링크를 만들지 못했습니다",
  ".dira 심링크가 이 프로젝트를 가리키지 않습니다",
];

/** 워커 생성. **한 동작으로 끝난다** — 파일을 만들고 crontab 한 줄까지 서버가 등록한다(제약 4).
 *  등록이 실패했을 때만 성공 화면이 종전의 등록 명령어로 되돌아간다. */
export function CreateWorkerButton({
  projectId,
  canTemplate,
  firstCmd,
  engines,
  modelPattern,
  variant,
}: {
  projectId: string;
  /** 템플릿으로 쓸 기존 워커가 있는가. 없으면 GUI가 만들 수 없다(엔진 코드 위치를 모른다) */
  canTemplate: boolean;
  /** 워커 0개일 때 손으로 첫 워커를 만드는 명령 */
  firstCmd: string;
  engines: EngineCatalog;
  modelPattern: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // 기본값은 `claude` + `모델 지정 안 함` — **안 고른 사람이 지금과 똑같은 워커를 얻는다**(§4-3).
  const [pick, setPick] = useState<EnginePick>({ engine: "claude", model: "" });
  const [result, setResult] = useState<WorkerActionResult | null>(null);
  const [pending, start] = useTransition();
  const created = result?.created;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setName("");
          setPick({ engine: "claude", model: "" });
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={variant} />}>워커 생성</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>워커 생성</DialogTitle>
          <DialogDescription>
            워커 하나가 크론잡 하나고, 한 번 실행에 티켓 1건을 끝냅니다. 동시성 = 워커 개수입니다.
          </DialogDescription>
        </DialogHeader>

        {!canTemplate ? (
          // 마지막 `. <엔진레포>/tick.sh` 한 줄을 GUI가 알 방법이 없다 — 추측해서 만들면
          // 돌지 않는 워커 파일이 생기고, 사람은 왜 안 도는지 모른다.
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              이 프로젝트에는 템플릿으로 쓸 워커가 없습니다. GUI는 기존 워커를 복사해서만 만들 수
              있습니다 — 엔진 코드(tick.sh)가 어디 있는지는 워커 파일에만 적혀 있습니다.
              첫 워커는 손으로 만듭니다.
            </p>
            <CopyCommand cmd={firstCmd} />
            <p className="text-sm text-muted-foreground">
              만든 뒤 <span className="font-mono text-xs">TICKET_CWD</span> 등 값을 확인하고,
              이 화면을 새로고침하면 나머지는 GUI에서 만들 수 있습니다.
            </p>
          </div>
        ) : created ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-mono text-xs">{created.template}</span>을 복사해{" "}
              <span className="font-mono text-xs break-all">{created.path}</span>를 만들고 755로
              두었습니다. 내용을 확인하고 필요하면 손으로 고치세요.
            </p>
            {created.cron ? (
              <p className="text-sm font-medium">
                crontab에 등록했습니다 — 1분 뒤부터 티켓을 물어갑니다.
              </p>
            ) : (
              // 파일은 있고 등록만 실패했다. 되돌리지 않고 사람이 셸에서 마무리하게 한다.
              <div className="space-y-2">
                <Failure title="crontab에 등록하지 못했습니다" message={created.cronError ?? ""} />
                <p className="text-sm font-medium">
                  아직 돌지 않습니다 — 이 명령을 셸에서 실행하세요
                </p>
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
                  워크트리는 만들지 않았습니다 — {created.worktree.reason} 워커 파일과 crontab
                  등록은 그대로입니다.
                </p>
              ) : created.worktree.done === 3 ? (
                <p className="text-sm font-medium">
                  작업 디렉터리{" "}
                  <span className="font-mono text-xs break-all">{created.worktree.dir}</span>를
                  만들고, 그 안의 <span className="font-mono text-xs">.dira</span>가 이 프로젝트를
                  가리키는 것까지 확인했습니다.
                </p>
              ) : (
                <>
                  <Failure
                    title={WORKTREE_STEP[created.worktree.done]}
                    message={created.worktree.reason ?? ""}
                  />
                  <p className="text-sm font-medium">
                    작업 디렉터리가 없으면 이 워커는 티켓을 물었다 되돌립니다 — 남은 명령을 셸에서
                    실행하세요
                  </p>
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
              <Label htmlFor="worker-name">이름</Label>
              <Input
                id="worker-name"
                className="font-mono"
                placeholder="w4"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                영문·숫자·_·-. 파일은 workers/&lt;이름&gt;.sh 가 됩니다
              </p>
            </div>
            {/* 엔진은 템플릿에서 물려받지 않는다 — 고른 값이 `TICKET_ENGINE` 블록으로
                들어간다(§4-3). 안 고르면 `tick.sh`가 잡는 그 값 그대로다. */}
            <EngineFields
              engines={engines}
              modelPattern={modelPattern}
              value={pick}
              onChange={setPick}
            />
            {result?.message && <Failure title="워커를 만들지 못했습니다" message={result.message} />}
          </div>
        )}

        {pending && <CrontabApproval />}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {created || !canTemplate ? "닫기" : "취소"}
          </DialogClose>
          {canTemplate && !created && (
            <Button
              disabled={pending || !name.trim() || !enginePickOk(pick, modelPattern)}
              onClick={() =>
                start(async () =>
                  setResult(await createWorkerAction(projectId, name, pick.engine, pick.model)),
                )
              }
            >
              {pending ? "만드는 중…" : "만들기"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 행 액션: reap · 중단/재등록 · 삭제 ──────────────────────────────────────

export function WorkerRowActions({ projectId, row }: { projectId: string; row: WorkerRow }) {
  const [pending, start] = useTransition();
  const [reap, setReap] = useState<WorkerActionResult | null>(null);
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
      {/* 판정도 rename도 엔진이 한다 — GUI는 부르고 출력을 보여줄 뿐이다(제약 2).
          `min-w-16`(64px)은 §비주얼 §4-3 슬롯 고정 — `reap…`가 `reap`보다 넓어서 누른 자리가
          커지면 안 된다(실측 45.6 → 56.6px. 옆 토글과 달리 56px으로는 0.6px 넘친다) */}
      <Button
        variant="ghost"
        size="sm"
        className="min-w-16"
        disabled={pending}
        onClick={() => start(async () => setReap(await reapWorkerAction(projectId, row.name)))}
      >
        {pending ? "reap…" : "reap"}
      </Button>
      {/* 못 여는 행에서도 **지우지 않고 비활성으로 남긴다**(§4 세션 스트림 · §비주얼 §4-3 —
          요구 `3d717e8b`). 지우면 오른쪽 정렬이라 그 행만 `reap`이 옆으로 옮겨 앉는다.
          사유 문구·툴팁은 안 붙인다 — 같은 행 `물고 있는 티켓` 열이 `—`인 것이 이미 말한다.
          `aria-disabled`가 아니라 `disabled`다: 이 행에는 해당이 없는 조작이라 탭 순서에
          죽은 정거장을 만들지 않는다(선례 = 아래 컨텍스트 항목 행 `▲▼`) */}
      <Button
        variant="ghost"
        size="sm"
        disabled={!holding}
        onClick={() => setStreaming(true)}
      >
        스트림
      </Button>
      {/* 같은 줄에 대한 반대 동작이라 둘이 동시에 뜨는 상태가 없다 — 판정은 `status`가 아니라
          `cron`이다(§4 재등록): 뺄 줄이 있으면 `중단`, 없으면 `재등록`이다. `running`인데
          미등록인 워커에도 `재등록`이 뜬다(락과 crontab은 직교한다 — §워커 상태 판정).
          배타 토글은 한 슬롯이고 **넓은 쪽(`재등록` 55.2px) 폭으로 고정**한다(§비주얼 §4-3) —
          안 하면 자수가 갈리는 만큼 왼쪽 버튼들이 행마다 다른 x에 선다(실측 11.1px) */}
      {row.cron ? (
        <Button variant="ghost" size="sm" className="min-w-14" onClick={() => setStopping(true)}>
          중단
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="min-w-14" onClick={() => setRegistering(true)}>
          재등록
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
        삭제
      </Button>

      {/* reap 출력 */}
      <Dialog open={!!reap} onOpenChange={(o) => !o && setReap(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>reap — {row.name}</DialogTitle>
            <DialogDescription>
              세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌립니다.
            </DialogDescription>
          </DialogHeader>
          {reap && !reap.ok && (
            <Failure title={`${row.name}.sh reap 실패`} message={reap.message ?? reap.output ?? ""} />
          )}
          {reap?.output && (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {reap.output}
            </pre>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 세션 스트림 — **진입점 하나다**(§4 · §2-1 Q2=(a)). 대상만 `holding`이고 컴포넌트도
          Server Action(`tailSession`)도 티켓 상세가 쓰는 것 그대로다. 그래서 두 화면이 같은
          티켓에서 같은 내용을 그린다. 다이얼로그가 닫히면 포털이 언마운트되고 폴링도 같이 끊긴다
          — 워커 표에 `running` 여러 줄이 있어도 도는 폴링은 열어 둔 하나뿐이다. */}
      {holding && (
        <Dialog open={streaming} onOpenChange={setStreaming}>
          {/* **`max-h`·`overflow`는 이 호출부에만 더한다**(§비주얼 §21). `DialogContent`는 둘 다
              없고 `<html>`이 `overflow-hidden`이라, 참견 폼이 붙어 절이 692px이 되면 다이얼로그가
              780px이고 최악(입력 상한 + 실패 Alert) 928px에서 **스크롤도 없이 잘린다.**
              컴포넌트를 고치지 않는 이유는 스트림을 담은 이 다이얼로그만 키가 커서다. */}
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>세션 스트림 — {row.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {holding}
              </DialogDescription>
            </DialogHeader>
            {/* `live`는 초기값일 뿐이고 매 폴링마다 서버가 티켓 상태로 다시 판정한다 —
                여는 순간 티켓이 끝났으면 첫 응답에서 폴링이 멈춘다. */}
            {/* 엔진 이름을 같이 넘긴다 — codex면 상자 대신 사유가, 참견 폼엔 비활성 + 사유가
                뜬다(§4-3 · §비주얼 §23 ⑤). 여기서는 화면이 그 값을 직접 쓰고 있는 행이다. */}
            <SessionStream project={projectId} stem={holding} live engine={row.engineName} />
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
            <DialogTitle>워커 중단 — {row.name}</DialogTitle>
            <DialogDescription>
              crontab에서 이 워커 줄을 뺍니다. 파일은 지우지 않습니다 — 다시 등록하면 그대로
              돌아옵니다.
            </DialogDescription>
          </DialogHeader>
          {stopped?.ok ? (
            // 이미 미등록이었으면 no-op이라고 말한다 — 에러가 아니다
            <p className="text-sm font-medium">{stopped.message}</p>
          ) : (
            // 여는 버튼이 `row.cron`으로 갈리므로 "이미 미등록입니다"를 여기서 미리 말하지
            // 않는다 — 그 상태의 행에는 `중단`이 아니라 `재등록`이 있다(§4 재등록).
            stopped && (
              <div className="space-y-2">
                <Failure title="crontab에서 빼지 못했습니다" message={stopped.message ?? ""} />
                <p className="text-sm font-medium">이 명령을 셸에서 실행하세요</p>
                <CopyCommand cmd={row.unregisterCmd} />
              </div>
            )
          )}
          {row.status === "running" && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>지금 티켓을 물고 있습니다</AlertTitle>
              <AlertDescription>
                진행중인 세션은 죽이지 않습니다. crontab에서 빼도 지금 물고 있는 티켓이 끝난 뒤에
                멈춥니다.
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
            {!stopped?.ok && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => setStopped(await stopWorkerAction(projectId, row.name)))
                }
              >
                {pending ? "중단하는 중…" : "중단"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 재등록 — `중단`의 역방향이고 crontab 한 줄이 전부다(§4 재등록). 파일은 이미 있으니
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
            <DialogTitle>워커 재등록 — {row.name}</DialogTitle>
            <DialogDescription>
              crontab에 이 워커 줄을 다시 넣습니다. 파일은 이미 있으니 바뀌는 것은 그 한 줄뿐입니다.
            </DialogDescription>
          </DialogHeader>
          {registered?.ok ? (
            // 이미 등록돼 있었으면 no-op이라고 말한다 — `중단`이 미등록에 대해 말하는 것과 대칭이다
            <p className="text-sm font-medium">{registered.message}</p>
          ) : (
            registered && (
              <div className="space-y-2">
                <Failure title="crontab에 등록하지 못했습니다" message={registered.message ?? ""} />
                <p className="text-sm font-medium">
                  아직 돌지 않습니다 — 이 명령을 셸에서 실행하세요
                </p>
                <CopyCommand cmd={row.registerCmd} />
              </div>
            )
          )}
          {pending && <CrontabApproval />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
            {!registered?.ok && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => setRegistered(await registerWorkerAction(projectId, row.name)))
                }
              >
                {pending ? "등록하는 중…" : "재등록"}
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
            <DialogTitle>워커 삭제 — {row.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{row.path}</DialogDescription>
          </DialogHeader>

          {row.status === "running" ? (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>지금은 삭제할 수 없습니다</AlertTitle>
              <AlertDescription>
                이 워커가 티켓을 물고 있습니다(pid {row.lockPid ?? "?"}). 지금 지우면 락과 돌고 있는
                세션이 붕 뜹니다. 먼저 중단하고, 물고 있는 티켓이 끝난 뒤 지우세요.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                파일을 지웁니다. 이 프로젝트의 티켓은 삭제되지 않습니다.
              </p>
              {row.cron && (
                <p className="text-sm">
                  crontab 줄도 같이 뺍니다 — <span className="font-medium">crontab 먼저, 파일
                  나중</span>입니다. 남겨 두면 cron이 1분마다 없는 파일을 실행하고 cron.log에
                  에러가 쌓입니다.
                </p>
              )}
              {error && (
                <div className="space-y-2">
                  <Failure title={`워커 ${row.name} 삭제 실패`} message={error.message ?? ""} />
                  {error.cronFailed && (
                    <>
                      <p className="text-sm font-medium">
                        파일은 그대로입니다 — 이 명령으로 crontab 줄을 뺀 뒤 다시 시도하세요
                      </p>
                      <CopyCommand cmd={row.unregisterCmd} />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" autoFocus />}>닫기</DialogClose>
            {row.status !== "running" && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteWorkerAction(projectId, row.name);
                    if (r.ok) setDeleting(false);
                    else setError({ ...r, message: r.message ?? "삭제하지 못했습니다." });
                  })
                }
              >
                {pending ? "삭제 중…" : "삭제"}
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
 *  그래서 없음은 destructive가 아니라 중립색이고, 문구가 그 사실을 말한다. */
function ExistsMark({ row }: { row: ContextRow }) {
  const [Icon, tint, label] =
    row.exists === true
      ? [Check, "text-status-done", "있음"]
      : row.exists === false
        ? [X, "text-muted-foreground", "없음 — 엔진이 건너뛰고 WARN만 남깁니다"]
        : row.exists === null
          ? // 원인 중립. `null`은 못 편 변수가 남았을 때도, 워커에 따라 갈릴 때도 온다 —
            // 후자는 변수가 **펴졌는데** 결과가 갈린 것이라 "못 펴서"는 거짓이다(§4-1).
            // 경로는 아래 `title`이 한 번만 붙인다.
            [CircleQuestionMark, "text-muted-foreground", "경로를 한 값으로 확정하지 못했습니다"]
          : [CircleQuestionMark, "text-muted-foreground", "저장하면 확인합니다"];
  return (
    <span className="flex items-center gap-1" title={row.resolved ? `${row.resolved} — ${label}` : label}>
      <Icon aria-hidden className={cn("size-4 shrink-0", tint)} />
      <span className="sr-only">{label}</span>
    </span>
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
  cwd,
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
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
  /** 목록 **최상단**에 `공통` 배지 + 읽기 전용으로 붙는 항목(워커 카드에서만).
   *  **저장에 들어가지 않는다** — 이 항목은 워커 파일에 실제로 없다(§4-1) */
  common?: ContextRow[];
  /** 이 워커의 `TICKET_CWD`. 경로 피커가 고른 파일이 이 아래면 `$TICKET_CWD/` 접두를 되살린다
   *  (§데스크톱 앱 N3 — 접두 보존). **없으면 피커 버튼이 안 뜬다.** 공통 카드가 그렇다:
   *  이 값은 워커마다 갈려서 한 기준으로 줄이면 남의 워커에게 거짓이 된다(존재 표시를
   *  공통에서만 하는 것과 같은 이유). N3이 정한 자리는 워커 컨텍스트 하나다. */
  cwd?: string;
  emptyText: string;
  addLabel: string;
  save: (items: { path: string; desc: string }[]) => Promise<ContextResult>;
}) {
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
    // 사유가 `블록이 없습니다`일 때**만** 넣을 줄까지 준다(§4) — 나머지 사유는 파일에 이미
    // 있는 것을 사람이 보고 정할 일이지만 이건 답이 한 줄로 정해져 있다. 문자열은
    // `parseContextBlock`이 내는 그 사유와 글자로 맞춘다(lib/workers.ts 199행).
    const missing = context.reason === `${arr}=( … ) 블록이 없습니다`;
    return (
      <>
        <Failure title={`${file}의 ${arr} 블록을 GUI가 고칠 수 없습니다`} message={context.reason} />
        <p className="text-sm text-muted-foreground">
          추측해서 쓰지 않습니다 — 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히 실패합니다.
          <span className="font-mono text-xs break-all"> {filePath}</span>를 손으로 편집한 뒤 이
          화면을 새로고침하세요.
        </p>
        {missing && (
          <>
            <p className="text-sm text-muted-foreground">
              넣을 줄은 이것 하나입니다 — 필수 <code className="font-mono text-xs">. …/tick.sh</code>{" "}
              줄 <strong className="font-medium text-foreground">위</strong> 아무 곳에 붙이면
              열립니다. GUI가 대신 넣지는 않습니다(삽입 자리를 짚을 앵커가 없습니다).
            </p>
            {/* ponytail: `renderContextBlock([], arr)`과 같은 문자열을 손으로 적는다 — 서버
                전용 모듈(fs)이라 클라이언트에서 import할 수 없다. 0항목 모양이 바뀌면 여기도. */}
            <CopyCommand cmd={`${arr}=()`} />
          </>
        )}
      </>
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
              공통
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
                aria-label="경로"
                className="flex-[2] font-mono text-xs"
                placeholder="$TICKET_CWD/docs/DESIGN.md"
                value={r.path}
                onChange={(e) => edit(i, { path: e.target.value })}
              />
              <Input
                aria-label="설명"
                className="flex-1 text-xs"
                placeholder="설명(선택) — 세션이 읽을 이유"
                value={r.desc}
                onChange={(e) => edit(i, { desc: e.target.value })}
              />
              {/* 고른 파일이 `cwd` 아래면 `$TICKET_CWD/`로 되돌린다 — 절대경로로 굳히면 그
                  항목이 이 컴퓨터 것이 되고 워커 간 복사도 뜻을 잃는다(§4-1 복사 다이얼로그).
                  **기준이 없으면 버튼 자체가 없다**: 공통 카드와 `TICKET_CWD` 줄이 없는 워커가
                  그렇고, 거기서 고르면 남는 건 이 컴퓨터의 절대경로뿐이다 */}
              {cwd && (
                <PickPath
                  mode="file"
                  label={`${i + 1}번째 경로`}
                  onPick={(p) => {
                    const rel = relativeUnder(p, cwd);
                    edit(i, { path: rel === p ? p : `$TICKET_CWD/${rel}` });
                  }}
                />
              )}
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
                <span className="sr-only">위로</span>
              </Button>
              <Button variant="ghost" size="sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
                <span className="sr-only">아래로</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <X aria-hidden />
                <span className="sr-only">삭제</span>
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 저장 거부(블록 모양이 예상과 다름)는 §6 에러 3요소 — 파일은 쓰이지 않았다 */}
      {result && !result.ok && (
        <Failure title={`${file}를 저장하지 못했습니다`} message={result.message ?? ""} />
      )}

      {/* 안내 문구 → 되돌리기 → 추가 → 저장, 오른쪽 정렬(§비주얼 §4-3).
          위 경로 행의 `▲▼×`는 조작 대상 옆이라 예외다 */}
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <>
            <span className="text-xs text-muted-foreground">
              저장하면 {file}의 {arr} 블록을 통째로 바꿉니다
            </span>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRows(saved)}>
              되돌리기
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
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </>
  );
}

/** 공통 컨텍스트 카드 — 워커 화면 **최상단**(§4-1). 편집기는 워커별 것과 같은 컴포넌트다.
 *  `context.sh`가 없으면 항목 0개이고 **오류가 아니다** — 빈 상태 + `공통 항목 추가`다. */
export function CommonContextCard({
  projectId,
  filePath,
  context,
}: {
  projectId: string;
  /** `<루트>/context.sh` */
  filePath: string;
  context: { ok: true; items: ContextRow[] } | { ok: false; reason: string };
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">공통</Badge>
        <span className="font-mono text-sm">context.sh</span>
        <span className="text-xs text-muted-foreground">
          {context.ok ? `${context.items.length}개` : "읽지 못했습니다"}
        </span>
      </div>
      <ContextEditor
        file="context.sh"
        arr="TICKET_CONTEXT_COMMON"
        filePath={filePath}
        context={context}
        emptyText="공통 항목이 없습니다 — 워커는 각자 자기 항목만 읽습니다."
        addLabel="공통 항목 추가"
        save={(items) => saveCommonContextAction(projectId, items)}
      />
    </div>
  );
}

/** 워커 하나의 컨텍스트 편집. 저장은 `TICKET_CONTEXT=( … )` **블록 전체 치환**이고, 블록 모양이
 *  예상과 다르면 서버가 거부한다 — 그때는 편집 UI를 아예 열지 않고 손으로 고치라고 알린다. */
export function WorkerContextCard({
  projectId,
  row,
  others,
  common,
}: {
  projectId: string;
  row: WorkerRow;
  /** 복사 대상 후보(자기 자신 제외) */
  others: string[];
  /** 공통 항목. `row.commonSource`가 false면 이 워커는 못 받으므로 그리지 않는다 (§4-1) */
  common: ContextRow[];
}) {
  const saved = row.context.ok ? row.context.items : [];
  const [copyTo, setCopyTo] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [healError, setHealError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // 자가 정리는 **다른 파일에 다른 줄을 쓴다**(§4-4) — 전이를 나눠야 한쪽이 도는 동안
  // 나머지 버튼이 남의 라벨(`적용 중…`)로 서지 않는다.
  const [healing, startHeal] = useTransition();
  const gets = row.commonSource ? common : [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{row.name}</span>
          <span className="text-xs text-muted-foreground">
            {row.context.ok ? `${saved.length}개` : "읽지 못했습니다"}
          </span>
        </div>
        {row.context.ok && others.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">이 설정을 복사:</span>
            {others.map((o) => (
              <Button key={o} variant="ghost" size="sm" className="font-mono" onClick={() => setCopyTo(o)}>
                → {o}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* `source` 줄이 없으면 이 워커만 공통에서 빠진다. 조용히 넘기면 "전원이 본다"는 전제가
          화면에서 거짓이 된다(§4-1) — 사실을 말하고 그 자리에서 줄을 넣게 한다. */}
      {!row.commonSource && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>이 워커는 공통 컨텍스트를 받지 않습니다</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {row.name}.sh에 <span className="font-mono text-xs">context.sh</span>를{" "}
                <span className="font-mono text-xs">.</span> 하는 줄이 없습니다 — 위 공통 항목{" "}
                {common.length}개가 이 워커의 세션에는 붙지 않습니다.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await applyCommonSourceAction(projectId, row.name);
                    setApplyError(r.ok ? null : (r.message ?? "줄을 넣지 못했습니다."));
                  })
                }
              >
                {pending ? "적용 중…" : "공통 적용"}
              </Button>
              {applyError && <Failure title="공통을 적용하지 못했습니다" message={applyError} />}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 이 줄이 없으면 그 워커는 자기 cron 줄을 뺄 코드를 못 만난다 — dira를 지워도 줄이 남아
          cron이 1분마다 없는 파일을 부른다(§4-4 §소급). 모양은 위 `공통 적용`과 같다. */}
      {!row.selfHealSource && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>이 워커는 지워도 cron 줄이 남습니다</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {row.name}.sh에 <span className="font-mono text-xs">self-heal.sh</span>를{" "}
                <span className="font-mono text-xs">.</span> 하는 줄이 없습니다 — dira를 지우면 이
                워커의 crontab 2줄을 뺄 코드가 돌지 않고, cron이 1분마다 없는 파일을 부릅니다.
                적용하면 <span className="font-mono text-xs">. tick.sh</span> 바로 위에 한 줄이
                들어갑니다(엔진 경로는 이 파일의 그 줄에서 읽습니다).
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={healing}
                onClick={() =>
                  startHeal(async () => {
                    const r = await applySelfHealAction(projectId, row.name);
                    setHealError(r.ok ? null : (r.message ?? "줄을 넣지 못했습니다."));
                  })
                }
              >
                {healing ? "적용 중…" : "자가 정리 적용"}
              </Button>
              {healError && <Failure title="자가 정리를 적용하지 못했습니다" message={healError} />}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <ContextEditor
        file={`${row.name}.sh`}
        arr="TICKET_CONTEXT"
        filePath={row.path}
        context={row.context}
        common={gets}
        // ponytail: `TICKET_CWD` 줄이 없는 워커(엔진 기본값 = 루트의 부모)는 기준이 없어 피커가
        // 안 뜬다 — 타이핑은 종전대로다. 필요해지면 페이지가 root를 같이 넘긴다
        cwd={row.cwd ?? undefined}
        emptyText={
          gets.length > 0
            ? "이 워커의 자기 항목은 없습니다 — 위 공통 항목만 받습니다."
            : "항목이 없습니다 — 이 워커의 세션은 참조 컨텍스트 없이 시작합니다."
        }
        addLabel="항목 추가"
        save={(items) => saveContextAction(projectId, row.name, items)}
      />

      {/* 워커 간 복사 — 받는 쪽 블록이 통째로 없어진다. 되돌리기가 없으므로 먼저 알린다 */}
      <Dialog open={!!copyTo} onOpenChange={(o) => !o && setCopyTo(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              컨텍스트 복사 — {row.name} → {copyTo}
            </DialogTitle>
            <DialogDescription>
              {copyTo}.sh의 TICKET_CONTEXT 블록을 {row.name}의 항목 {saved.length}개로 바꿉니다.
              {copyTo}의 기존 항목은 남지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">$TICKET_CWD</span>는 펴지 않고 문자열째로 옮깁니다 —
            받는 워커는 자기 작업 디렉터리를 가리킵니다. 컨텍스트가 워커마다 갈라져 있으면 같은
            티켓이 어느 워커에 물리느냐로 결과가 달라집니다.
          </p>
          {copyError && <Failure title="복사하지 못했습니다" message={copyError} />}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await copyContextAction(projectId, row.name, copyTo!);
                  setCopyError(r.ok ? null : (r.message ?? "복사하지 못했습니다."));
                  if (r.ok) setCopyTo(null);
                })
              }
            >
              {pending ? "복사 중…" : "복사"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
