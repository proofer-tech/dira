"use client";

/** 프로토콜 화면(`/p/<project>/protocols`)의 클라이언트 조각 — 편집 · 새 파일 · 이름변경 · 삭제.
 *
 *  트리는 여기 없다: 서버 컴포넌트가 `<Link href="?file=…">`으로 그린다(선택 상태는 URL이 담고,
 *  클라이언트 상태 라이브러리를 쓰지 않는다는 규약 그대로다). 여기 있는 건 fs를 만지는 액션과,
 *  **타이핑하는 동안 살아 있어야 하는 바이트 수**뿐이다 — AGENTS.md는 길이가 곧 세션 비용이라
 *  저장 후에 알려주면 늦다. */
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTrackedRouter } from "@/lib/route-pending";
import { FilePlus2, PencilLine, Trash2, TriangleAlert } from "lucide-react";
import {
  createProtocolAction,
  deleteProtocolAction,
  renameProtocolAction,
  saveProtocolAction,
  type ProtocolResult,
} from "@/app/(app)/p/[project]/protocols/actions";
import { useLocale, useT } from "@/components/language-provider";
import { MarkdownEditor } from "@/components/markdown-editor";
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
import { budgetLabel, byteLength, QUEUE_AGENTS_MAX_BYTES } from "@/lib/budgets";

/** §6 에러 3요소 중 1·2번. 사유는 원문 그대로 — 서버가 거부한 이유가 여기 적혀 온다. */
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

/** 최상위 `AGENTS.md`는 tick.sh가 **모든 세션 프롬프트에 인라인**한다(155~168행). 나머지는
 *  그 안에서 가리키면 세션이 필요할 때 직접 읽는다 — 배지가 그 차이를 알려 준다.
 *
 *  `bytes`는 UTF-8 바이트 — `wc -c`와 같은 값이라야 예산과 비교된다(§프롬프트 층 결정 11).
 *  `max`가 있으면 서식이 `{n} / {max} B`(넘으면 뒤에 ` 초과`), 없으면 `{n} B` 하나뿐이다
 *  (§비주얼 §61 (13) 그대로 — 새 서식 0, 새 색 0). */
export function InlineBadge({ bytes, max }: { bytes: number; max?: number }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Badge variant="secondary" title={t("protocols.inline.tooltip")}>
      {t("protocols.inline.badge")} {budgetLabel(bytes, max, locale)}
    </Badge>
  );
}

// 접힌 상태가 파일 고르기를 지나 유지된다(§6 계약) — 저장·생성·삭제·이름변경 뒤 리다이렉트도
// 지금 `?sidebar=off`를 그대로 나른다.
const fileHref = (projectId: string, rel: string, sidebarOff: boolean) =>
  `/p/${projectId}/protocols?file=${encodeURIComponent(rel)}${sidebarOff ? "&sidebar=off" : ""}`;

// ── 새 파일 ─────────────────────────────────────────────────────────────────

export function NewFileButton({
  projectId,
  variant,
}: {
  projectId: string;
  variant?: "default" | "outline";
}) {
  const router = useTrackedRouter();
  const t = useT();
  const locale = useLocale();
  const sidebarOff = useSearchParams().get("sidebar") === "off";
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [result, setResult] = useState<ProtocolResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setName("");
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={variant} />}>
        <FilePlus2 aria-hidden />
        {t("protocols.new.title")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("protocols.new.title")}</DialogTitle>
          <DialogDescription>
            {t("protocols.new.descPrefix")} <span className="font-mono text-xs">/</span>
            {t("protocols.new.descSuffix")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-protocol">{t("protocols.new.pathLabel")}</Label>
          <Input
            id="new-protocol"
            className="font-mono"
            placeholder="handoff.md"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("protocols.new.pathHintPrefix")}
            <span className="font-mono">../</span> {t("protocols.new.pathHintSuffix")}
          </p>
          {result && !result.ok && (
            <Failure title={t("protocols.new.failTitle")} message={result.message ?? ""} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r = await createProtocolAction(projectId, name, locale);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel, sidebarOff));
                }
              })
            }
          >
            {pending ? t("common.creating") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 편집기 ──────────────────────────────────────────────────────────────────

/** 원문 편집만. `// ponytail: 마크다운 렌더는 넣지 않는다 — 렌더가 실제로 필요해지면 그때 의존성`.
 *  파일을 바꿔도 이 컴포넌트가 재사용되면 textarea에 앞 파일 내용이 남으므로 부모가 `key={rel}`을 준다. */
export function ProtocolEditor({
  projectId,
  rel,
  initial,
  inlined,
}: {
  projectId: string;
  rel: string;
  initial: string;
  /** 최상위 AGENTS.md인가 — 문자 수를 타이핑 중에도 보여준다 */
  inlined: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<ProtocolResult | null>(null);
  const [pending, start] = useTransition();
  // 아래 버튼은 값을 안 밀어 넣는다(`<MarkdownEditor>`는 uncontrolled다) — `key`를 바꿔 다시
  // 마운트시켜 `defaultValue`(=initial)로 돌아가게 한다.
  const [resetNonce, setResetNonce] = useState(0);
  const dirty = text !== initial;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm break-all">{rel}</span>
          {inlined ? (
            <InlineBadge bytes={byteLength(text)} max={QUEUE_AGENTS_MAX_BYTES} />
          ) : (
            <span className="text-xs text-muted-foreground">{t("protocols.readWhenNeeded")}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <RenameButton projectId={projectId} rel={rel} />
          <DeleteButton projectId={projectId} rel={rel} />
        </div>
      </div>

      {inlined && (
        <p className="text-sm text-muted-foreground">
          {t("protocols.editor.inlinedHintPrefix")} <span className="font-mono text-xs">tick.sh</span>
          {t("protocols.editor.inlinedHintSuffix")}
        </p>
      )}

      <MarkdownEditor
        key={resetNonce}
        name="body"
        defaultValue={initial}
        rows={28}
        className="font-mono"
        onChange={setText}
      />

      {result && !result.ok && (
        <Failure title={t("protocols.editor.saveFailTitle")} message={result.message ?? ""} />
      )}

      {/* 부가 정보 → 보조 → 1차 순으로 오른쪽 정렬(§비주얼 §4-3) */}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {[...text].length.toLocaleString()}
          {t("protocols.charSuffix")}
        </span>
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setText(initial);
              setResetNonce((n) => n + 1);
            }}
          >
            {t("protocols.editor.revert")}
          </Button>
        ) : (
          result?.ok && (
            <span className="text-sm text-muted-foreground">{t("protocols.editor.saved")}</span>
          )
        )}
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await saveProtocolAction(projectId, rel, text, locale);
              setResult(r);
              if (r.ok) router.refresh(); // 트리의 AGENTS.md 문자 수도 다시 읽는다
            })
          }
        >
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ── 이름변경 ────────────────────────────────────────────────────────────────

function RenameButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useTrackedRouter();
  const t = useT();
  const locale = useLocale();
  const sidebarOff = useSearchParams().get("sidebar") === "off";
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(rel);
  const [result, setResult] = useState<ProtocolResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setTo(rel);
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <PencilLine aria-hidden />
        {t("protocols.rename.trigger")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t("protocols.rename.dialogTitlePrefix")} {rel}
          </DialogTitle>
          <DialogDescription>{t("protocols.rename.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-protocol">{t("protocols.rename.pathLabel")}</Label>
          <Input
            id="rename-protocol"
            className="font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {rel === "AGENTS.md" && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>{t("protocols.rename.agentsWarnTitle")}</AlertTitle>
              <AlertDescription>
                {t("protocols.rename.agentsWarnPrefix")}{" "}
                <span className="font-mono text-xs">AGENTS.md</span>
                {t("protocols.rename.agentsWarnSuffix")}
              </AlertDescription>
            </Alert>
          )}
          {result && !result.ok && (
            <Failure title={t("protocols.rename.failTitle")} message={result.message ?? ""} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
          <Button
            disabled={pending || !to.trim() || to.trim() === rel}
            onClick={() =>
              start(async () => {
                const r = await renameProtocolAction(projectId, rel, to, locale);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel, sidebarOff));
                }
              })
            }
          >
            {pending ? t("protocols.rename.working") : t("protocols.rename.trigger")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 삭제 ────────────────────────────────────────────────────────────────────

function DeleteButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const sidebarOff = useSearchParams().get("sidebar") === "off";
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ProtocolResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setResult(null);
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Trash2 aria-hidden />
        {t("protocols.delete.trigger")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("protocols.delete.dialogTitle")}</DialogTitle>
          <DialogDescription>
            <span className="font-mono break-all">{rel}</span>
            {t("protocols.delete.descSuffix")}
          </DialogDescription>
        </DialogHeader>
        {rel === "AGENTS.md" && (
          <Alert>
            <TriangleAlert aria-hidden className="text-status-stale" />
            <AlertTitle>{t("protocols.delete.agentsWarnTitle")}</AlertTitle>
            <AlertDescription>{t("protocols.delete.agentsWarnBody")}</AlertDescription>
          </Alert>
        )}
        {result && !result.ok && (
          <Failure title={t("protocols.delete.failTitle")} message={result.message ?? ""} />
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" autoFocus />}>{t("common.cancel")}</DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteProtocolAction(projectId, rel, locale);
                setResult(r);
                if (r.ok) {
                  setOpen(false);
                  router.replace(`/p/${projectId}/protocols${sidebarOff ? "?sidebar=off" : ""}`);
                }
              })
            }
          >
            {pending ? t("protocols.delete.working") : t("protocols.delete.trigger")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
