"use client";

/** 프로토콜 화면(`/p/<project>/protocols`)의 클라이언트 조각 — 편집 · 새 파일 · 이름변경 · 삭제.
 *
 *  트리는 여기 없다: 서버 컴포넌트가 `<Link href="?file=…">`으로 그린다(선택 상태는 URL이 담고,
 *  클라이언트 상태 라이브러리를 쓰지 않는다는 규약 그대로다). 여기 있는 건 fs를 만지는 액션과,
 *  **타이핑하는 동안 살아 있어야 하는 문자 수**뿐이다 — AGENTS.md는 길이가 곧 세션 비용이라
 *  저장 후에 알려주면 늦다. */
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2, PencilLine, Trash2, TriangleAlert } from "lucide-react";
import {
  createProtocolAction,
  deleteProtocolAction,
  renameProtocolAction,
  saveProtocolAction,
  type ProtocolResult,
} from "@/app/(app)/p/[project]/protocols/actions";
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
 *  그 안에서 가리키면 세션이 필요할 때 직접 읽는다 — 배지가 그 차이를 말한다. */
export function InlineBadge({ chars }: { chars: number }) {
  return (
    <Badge variant="secondary" title="tick.sh가 이 파일 전문을 모든 세션 프롬프트 머리에 붙입니다">
      전원 프롬프트에 인라인 · {chars.toLocaleString()}자
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
  const router = useRouter();
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
        새 파일
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>새 파일</DialogTitle>
          <DialogDescription>
            프로토콜 디렉터리 기준 상대경로입니다. <span className="font-mono text-xs">/</span>를
            넣으면 하위 디렉터리도 같이 만듭니다. 빈 파일로 만들고 바로 편집기가 열립니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-protocol">경로</Label>
          <Input
            id="new-protocol"
            className="font-mono"
            placeholder="handoff.md"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            디렉터리 밖으로 나가는 경로(<span className="font-mono">../</span> · 절대경로)는 서버가
            거부합니다.
          </p>
          {result && !result.ok && (
            <Failure title="파일을 만들지 못했습니다" message={result.message ?? ""} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r = await createProtocolAction(projectId, name);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel, sidebarOff));
                }
              })
            }
          >
            {pending ? "만드는 중…" : "만들기"}
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
            <InlineBadge chars={[...text].length} />
          ) : (
            <span className="text-xs text-muted-foreground">세션이 필요할 때 읽음</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <RenameButton projectId={projectId} rel={rel} />
          <DeleteButton projectId={projectId} rel={rel} />
        </div>
      </div>

      {inlined && (
        <p className="text-sm text-muted-foreground">
          이 파일은 <span className="font-mono text-xs">tick.sh</span>가 전문을 모든 세션 프롬프트
          머리에 붙입니다 — 길이가 곧 매 세션의 비용입니다. 세부 규약은 같은 디렉터리의 다른
          문서로 빼고 여기서 가리키면, 세션이 필요할 때만 읽습니다.
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

      {result && !result.ok && <Failure title="저장하지 못했습니다" message={result.message ?? ""} />}

      {/* 부가 정보 → 보조 → 1차 순으로 오른쪽 정렬(§비주얼 §4-3) */}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {[...text].length.toLocaleString()}자
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
            되돌리기
          </Button>
        ) : (
          result?.ok && <span className="text-sm text-muted-foreground">저장됐습니다.</span>
        )}
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await saveProtocolAction(projectId, rel, text);
              setResult(r);
              if (r.ok) router.refresh(); // 트리의 AGENTS.md 문자 수도 다시 읽는다
            })
          }
        >
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}

// ── 이름변경 ────────────────────────────────────────────────────────────────

function RenameButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useRouter();
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
        이름변경
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>이름변경 — {rel}</DialogTitle>
          <DialogDescription>
            상대경로를 바꾸면 하위 디렉터리로 옮기는 것도 됩니다. 같은 이름의 파일이 이미 있으면
            거부합니다 — 조용히 덮어쓰지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-protocol">새 경로</Label>
          <Input
            id="rename-protocol"
            className="font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {rel === "AGENTS.md" && (
            <Alert>
              <TriangleAlert aria-hidden className="text-status-stale" />
              <AlertTitle>이름을 바꾸면 프롬프트에서 빠집니다</AlertTitle>
              <AlertDescription>
                tick.sh는 <span className="font-mono text-xs">AGENTS.md</span>라는 이름만 읽습니다.
                다른 이름이 되면 세션은 협업 프로토콜 없이 시작합니다(에러 없이 조용히).
              </AlertDescription>
            </Alert>
          )}
          {result && !result.ok && (
            <Failure title="이름을 바꾸지 못했습니다" message={result.message ?? ""} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending || !to.trim() || to.trim() === rel}
            onClick={() =>
              start(async () => {
                const r = await renameProtocolAction(projectId, rel, to);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel, sidebarOff));
                }
              })
            }
          >
            {pending ? "바꾸는 중…" : "이름변경"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 삭제 ────────────────────────────────────────────────────────────────────

function DeleteButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useRouter();
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
        삭제
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>파일 삭제</DialogTitle>
          <DialogDescription>
            <span className="font-mono break-all">{rel}</span>를 지웁니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        {rel === "AGENTS.md" && (
          <Alert>
            <TriangleAlert aria-hidden className="text-status-stale" />
            <AlertTitle>모든 세션이 협업 프로토콜 없이 시작합니다</AlertTitle>
            <AlertDescription>
              tick.sh는 이 파일이 없으면 그냥 넘어갑니다 — 에러도 경고도 없습니다. 이 프로젝트는 계속 돌고,
              세션만 규약을 모릅니다.
            </AlertDescription>
          </Alert>
        )}
        {result && !result.ok && <Failure title="지우지 못했습니다" message={result.message ?? ""} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" autoFocus />}>취소</DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteProtocolAction(projectId, rel);
                setResult(r);
                if (r.ok) {
                  setOpen(false);
                  router.replace(`/p/${projectId}/protocols${sidebarOff ? "?sidebar=off" : ""}`);
                }
              })
            }
          >
            {pending ? "삭제 중…" : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
