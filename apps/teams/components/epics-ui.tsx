"use client";

/** 에픽 화면(`/p/<project>/epics`) 오른쪽 칸의 메모리 절 — 읽기 · 삭제뿐이다(§결정 6, §5-2 ·
 *  §32 ②③④와 같은 규칙: 쓰는 쪽은 세션이다). `personas-ui.tsx`의 `MemorySection`과 같은
 *  골격이지만 그 파일은 페르소나 편집 상태(`edits`)에 깊이 얽혀 있어 그대로 재사용할 수 없다 —
 *  여기는 훨씬 얇다(추가·편집이 아예 없다). */
import { useRef, useState, useTransition } from "react";
import { ChevronRight, Trash2, TriangleAlert } from "lucide-react";
import { deleteEpicMemoryAction, saveEpicReadmeAction } from "@/app/(app)/p/[project]/epics/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { MarkdownEditor } from "@/components/markdown-editor";
import { Markdown } from "@/components/markdown";
import type { EpicMemory } from "@/lib/epics";
import { t, type Locale } from "@/lib/i18n";
import type { Vault } from "@/lib/markdown-wikilinks";

/** §6 에러 3요소 중 1·2번 — `personas-ui.tsx`의 `Failure`와 같은 값이다. 화면마다 각자 든다
 *  (공유 부품으로 뽑을 만큼 무겁지 않다). */
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

/** 에픽 화면 오른쪽 머리의 편집 입구 + 다이얼로그 (§에픽 결정 19-2 · §비주얼 §52 ⑪) — 그릇은
 *  발행 다이얼로그(§3), 칸 둘은 사이드바 만들기 입구(`epic-sidebar-create.tsx`)와 같은 라벨을
 *  다시 쓴다. **닫아도 초안을 안 버린다** — `onOpenChange`에서 값을 되돌리지 않는다(§닫기 확인). */
export function EpicReadmeEditButton({
  projectId,
  epic,
  locale,
  initialTitle,
  initialBody,
}: {
  projectId: string;
  epic: string;
  locale: Locale;
  initialTitle: string;
  initialBody: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = title !== initialTitle || body !== initialBody;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>{t(locale, "epics.readme.edit")}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(locale, "epics.readme.edit")} — epics/{epic}/README.md
          </DialogTitle>
          <DialogDescription>{t(locale, "epics.readme.editDesc")}</DialogDescription>
        </DialogHeader>
        {/* `min-w-0` — `DialogContent`가 `grid`라 안쪽 아이템의 min-width가 min-content로 굳는다
            (같은 함정·같은 처방이 `ticket-ui.tsx`의 답변·발행 다이얼로그에 이미 있다). */}
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="epic-readme-title">{t(locale, "board.epic.createTitleLabel")}</Label>
            <Input
              id="epic-readme-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <MarkdownEditor
            name="body"
            value={body}
            onValueChange={setBody}
            label={<Label>{t(locale, "epics.readme.bodyLabel")}</Label>}
            rows={12}
            className="font-mono"
          />
          {error && <Failure title={t(locale, "epics.readme.saveFailed")} message={error} />}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t(locale, "common.cancel")}</DialogClose>
          <Button
            disabled={pending || !title.trim() || !body.trim() || !dirty}
            onClick={() =>
              start(async () => {
                const r = await saveEpicReadmeAction(projectId, epic, title, body);
                if (r.ok) {
                  setOpen(false);
                  setError(null);
                } else {
                  setError(r.error);
                }
              })
            }
          >
            {pending ? t(locale, "common.saving") : t(locale, "common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EpicMemorySection({
  projectId,
  epic,
  memories,
}: {
  projectId: string;
  epic: string;
  memories: EpicMemory[];
}) {
  const [items, setItems] = useState(memories);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // §10 §위키링크 §자리 표 — vault는 이 에픽의 memory/뿐이다. 클릭 처리는
  // `personas-ui.tsx`의 `MemorySection`과 같은 판정(URL 안 바꾸는 수동 `open`) — 근거는 그 주석 참고.
  const vault: Vault = {};
  for (const m of items) {
    const name = m.file.replace(/\.md$/, "");
    vault[name] = `#${encodeURIComponent(name)}`;
  }

  function openWikilink(e: React.MouseEvent<HTMLUListElement>) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-wikilink]");
    if (!a) return;
    e.preventDefault();
    const name = a.dataset.wikilink ?? "";
    const target = listRef.current?.querySelector<HTMLDetailsElement>(
      `[data-mem-name="${CSS.escape(name)}"]`,
    );
    if (!target) return;
    target.open = true;
    // `start`다 — 전문이 길면 `center`는 방금 편 요약줄을 화면 밖 위로 밀어낸다(`personas-ui.tsx`
    // `MemorySection`과 같은 실측 근거).
    target.scrollIntoView({ block: "start" });
  }

  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">메모리</h3>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          메모리가 없습니다 — 세션이 회고에서 남기면 여기에 쌓입니다.
        </p>
      ) : (
        <ul ref={listRef} onClick={openWikilink} className="space-y-1">
          {items.map((m) => (
            <li key={m.file}>
              <details className="group/mem" data-mem-name={m.file.replace(/\.md$/, "")}>
                <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-open/mem:rotate-90"
                  />
                  <code className="shrink-0 font-mono text-xs">{m.file.replace(/\.md$/, "")}</code>
                  <span className="min-w-0 grow truncate text-xs text-muted-foreground">
                    {m.excerpt}
                  </span>
                  <span className="ml-auto self-center" onClick={(e) => e.preventDefault()}>
                    <DeleteMemoryButton
                      projectId={projectId}
                      epic={epic}
                      memory={m}
                      onDone={(message) => {
                        setError(message);
                        if (!message) setItems((prev) => prev.filter((x) => x.file !== m.file));
                      }}
                    />
                  </span>
                </summary>
                <div className="max-w-3xl pt-1 pb-3 pl-6">
                  <Markdown text={m.text} vault={vault} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {error && <Failure title="메모리를 지우지 못했습니다" message={error} />}
    </section>
  );
}

function DeleteMemoryButton({
  projectId,
  epic,
  memory,
  onDone,
}: {
  projectId: string;
  epic: string;
  memory: EpicMemory;
  /** 성공하면 `null`, 실패하면 사유 — 자리는 호출자(절 맨 아래)다 */
  onDone: (message: string | null) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={pending}>
            <Trash2 aria-hidden />
            {pending ? "삭제 중…" : "삭제"}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>메모리 삭제 — {memory.file.replace(/\.md$/, "")}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">{`epics/${epic}/memory/${memory.file}`}</span>{" "}
            파일을 지웁니다. 되돌릴 수 없습니다 — 이 화면에 편집도 추가도 없습니다.
            다음 디스패치부터 세션이 이 개념을 못 찾습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteEpicMemoryAction(projectId, epic, memory.file);
                onDone(r.ok ? null : (r.message ?? "메모리를 지우지 못했습니다."));
              })
            }
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
