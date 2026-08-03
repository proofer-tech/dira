"use client";

/** 페르소나 화면(`/p/<project>/personas`)의 클라이언트 조각 — 생성 · 편집 · 삭제.
 *
 *  fs를 만지는 건 서버 액션뿐이다(`app/p/[project]/personas/actions.ts`). 파일 하나에 모은 이유는
 *  `workers-ui.tsx`와 같다 — 같은 화면의 세 액션이 같은 문구(엔진이 WARN만 남긴다 · 이름 규칙)를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useState, useTransition } from "react";
import { Check, ChevronRight, Trash2, TriangleAlert } from "lucide-react";
import {
  createPersonaAction,
  deletePersonaAction,
  deletePersonaMemoryAction,
  savePersonaAction,
  savePersonaSkillsAction,
  setPersonaColorAction,
  type PersonaResult,
} from "@/app/p/[project]/personas/actions";
import { Markdown } from "@/components/markdown";
// 왼쪽 목록 줄의 점도 보드·칸반·필터와 **같은 컴포넌트**다(§5) — 색 조회의 출처는 하나다
import { PersonaDot } from "@/components/persona-badge";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
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
import { Textarea } from "@/components/ui/textarea";
import type { Memory, Skill } from "@/lib/skills";
import { PERSONA_COLORS, personaDotClass } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** 서버가 읽어 넘긴 한 항목. `body: null` = PROFILE.md가 없다(엔진의 WARN 케이스). */
export type PersonaRow = {
  name: string;
  file: string;
  body: string | null;
  refs: { open: number; wip: number; total: number };
  /** `skills.md`의 목록 줄(§5-1). 문법에 안 맞는 줄은 여기 없고 파일에는 그대로 있다 */
  skills: Skill[];
  /** `skills.md` **파일 전체** 자수 — 왼쪽 목록 줄의 자수가 이걸 더한다(§비주얼 §25 ①) */
  skillsChars: number;
  /** `memory/*.md` 한 단계 글롭. 세션이 쓰고 사람이 지운다(§5-2). **`text`가 파일 전체라
   *  자수는 화면이 더한다** — `skillsChars`처럼 따로 받지 않는다(목록 밖 글자가 없다) */
  memories: Memory[];
};

/** §6 에러 3요소 중 1·2번. 사유는 원문 그대로 — 삼키지 않는다. */
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

/** `열린 2 · 진행중 1` — 0인 종류는 뺀다. 참조가 없으면 null(호출자가 자리를 비운다). */
function refsLabel(refs: PersonaRow["refs"]): string | null {
  const parts = [
    refs.open > 0 && `열린 ${refs.open}`,
    refs.wip > 0 && `진행중 ${refs.wip}`,
    refs.total - refs.open - refs.wip > 0 && `완료 ${refs.total - refs.open - refs.wip}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// ── 색 (DESIGN.md §5 · §비주얼 §12) ─────────────────────────────────────────

/** **오른쪽 칸 머리**의 점이 곧 트리거다(§5 · §12). 왼쪽 목록 줄의 점은 읽기 전용이고, 이 자리는
 *  `<summary>`도 선택 버튼도 아니라 `preventDefault` 처방이 아예 없다 — 2단이 그걸 없앴다.
 *  `command`도 `select`도 아니다: 9개는 검색할 양이 아니고 항목의 내용이 글자가 아니라 색이다. */
function ColorPicker({
  projectId,
  name,
  color,
  onError,
}: {
  projectId: string;
  name: string;
  color?: string;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(color);
  const [, start] = useTransition();

  const pick = (next: string | null) =>
    start(async () => {
      setCurrent(next ?? undefined);
      setOpen(false);
      const r = await setPersonaColorAction(projectId, name, next);
      onError(r.ok ? null : (r.message ?? "색을 저장하지 못했습니다."));
      if (!r.ok) setCurrent(color);
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center rounded-full p-1 hover:bg-accent"
          />
        }
      >
        <PersonaDot color={current} />
        {/* 색만으로 뜻을 전하지 않는다(§0) — 점은 aria-hidden이고 값은 여기서 말한다 */}
        <span className="sr-only">{current ? `색: ${current}` : "색 없음"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-3 gap-2">
          {PERSONA_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => pick(c)}
              className={cn(
                "size-6 cursor-pointer rounded-full",
                personaDotClass(c),
                c === current && "ring-2 ring-ring ring-offset-2",
              )}
            />
          ))}
          {/* 9번째 칸이 `색 없음`이다 — 3×3이 정확히 차서 빈 칸이 없다(§12) */}
          <button
            type="button"
            aria-label="색 없음"
            onClick={() => pick(null)}
            className={cn(
              "size-6 cursor-pointer rounded-full border border-muted-foreground",
              !current && "ring-2 ring-ring ring-offset-2",
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── 생성 ────────────────────────────────────────────────────────────────────

/** 이름 규칙은 **서버가** 판정한다(`tickets.py PERSONA_RE`와 같은 규칙). 여기서 미리 막지 않는
 *  이유: 클라이언트 검증은 검증이 아니고, 규칙이 두 군데 있으면 갈린다. 대신 사유를 그 자리에 띄운다. */
export function CreatePersonaButton({
  projectId,
  variant,
}: {
  projectId: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [result, setResult] = useState<PersonaResult | null>(null);
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
      <DialogTrigger render={<Button size="sm" variant={variant} />}>페르소나 생성</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>페르소나 생성</DialogTitle>
          <DialogDescription>
            티켓의 <span className="font-mono text-xs">persona:</span> 값이 곧 디렉터리 이름입니다.
            프로필 본문은 세션 프롬프트 머리에 인라인됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="persona-name">이름</Label>
          <Input
            id="persona-name"
            className="font-mono"
            placeholder="developer"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            영문·숫자·_·-. 파일은 &lt;personas&gt;/&lt;이름&gt;/PROFILE.md 가 됩니다
          </p>
          {result?.message && (
            <Failure title="페르소나를 만들지 못했습니다" message={result.message} />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r = await createPersonaAction(projectId, name);
                setResult(r);
                if (r.ok) setOpen(false);
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

// ── 편집 · 삭제 ─────────────────────────────────────────────────────────────

/** 화면이 들고 있는 한 페르소나의 편집 상태. **오른쪽 칸이 아니라 `PersonasPane`이 든다** —
 *  고른 페르소나만 오른쪽에 서므로 이 상태가 오른쪽에 살면 다른 줄을 고르는 순간 언마운트돼
 *  저장 안 한 편집이 사라진다(§5 "다른 페르소나의 편집도 살아 있다"). 왼쪽 줄의 `저장 안 됨` ·
 *  `스킬 n` · `메모리 n` · 자수도 이 값을 읽으므로 어차피 한 자리에 있어야 한다. */
type PersonaEdit = {
  /** 파일에 저장된 원문. `null` = PROFILE.md가 없다 */
  saved: string | null;
  /** textarea의 현재 값 */
  body: string;
  skills: Skill[];
  /** **서버가 쓴 뒤 되읽어 준 값**이다 — 파일에는 사람이 덧붙인 산문도 있어서 목록만으로는
   *  계산이 안 된다(§비주얼 §25) */
  skillsChars: number;
  memories: Memory[];
};

/** 서버가 방금 준 값 그대로. 아직 손대지 않은 페르소나는 이걸 읽으므로 **다른 세션이 파일을
 *  고치면 목록이 따라간다** — 오버레이에 들어가는 것은 사람이 만진 이름뿐이다. */
const initialEdit = (row: PersonaRow): PersonaEdit => ({
  saved: row.body,
  body: row.body ?? "",
  skills: row.skills,
  skillsChars: row.skillsChars,
  memories: row.memories,
});

const editChars = (e: PersonaEdit) =>
  e.body.length + e.skillsChars + e.memories.reduce((n, m) => n + m.text.length, 0);

/** 2단 — 왼쪽이 목록, 오른쪽이 고른 페르소나(§5). 조립은 §6 프로토콜 화면과 같다
 *  (왼쪽 고정폭 + 오른쪽 `grow`, 좁으면 세로로 쌓인다).
 *
 *  **선택을 URL에 담지 않는다**(§5). 담으면 서버가 다시 렌더하면서 앞 페르소나의 textarea가
 *  언마운트돼 저장 안 한 편집이 사라진다 — §6이 `?file=`을 쓰는 것은 그 화면에 열려 있는
 *  편집기가 하나뿐이기 때문이다. `// ponytail: 딥링크가 생기면 그때 `?persona=`로 초기 선택만`. */
export function PersonasPane({
  projectId,
  rows,
  colors,
  installed,
  configDir,
}: {
  projectId: string;
  /** 1개 이상이다 — 0개는 호출부가 `<EmptyState>`로 갈라 2단을 안 그린다 */
  rows: PersonaRow[];
  /** 레지스트리의 팔레트 키 맵. 없거나 팔레트 밖이면 빈 점이다(§12) */
  colors: Record<string, string>;
  /** 이 머신에 설치된 스킬(§5-1). 페르소나 수와 무관하게 서버가 한 번 읽어 내렸다 */
  installed: Skill[];
  /** 해석된 `<config>` — 후보가 0개일 때 "어디를 봤는지"를 적는다(§비주얼 §25 다섯 상태) */
  configDir: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // 손댄 이름만 들어간다. 고른 줄이 지워지면 `find`가 비고 첫 줄로 떨어진다(기본 선택과 같은 값).
  const [edits, setEdits] = useState<Record<string, PersonaEdit>>({});
  const current = rows.find((r) => r.name === selected) ?? rows[0];
  const editOf = (row: PersonaRow) => edits[row.name] ?? initialEdit(row);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* 왼쪽 목록 — 줄 자체가 선택을 받는다. **안에 버튼이 없다**(§5): 색·삭제가 오른쪽 머리로
          갔으므로 버튼 안의 버튼도 `preventDefault` 처방도 없다 */}
      <nav aria-label="페르소나" className="w-full shrink-0 space-y-0.5 lg:w-80">
        {rows.map((row) => {
          const e = editOf(row);
          const refs = refsLabel(row.refs);
          return (
            <button
              key={row.name}
              type="button"
              // 색 말고도 표식이 있다(§비주얼 §0) — §6 프로토콜 트리의 선택 줄과 같은 값이다
              aria-current={row.name === current.name ? "true" : undefined}
              onClick={() => setSelected(row.name)}
              className={cn(
                "block w-full cursor-pointer space-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                row.name === current.name && "bg-muted font-medium",
              )}
            >
              {/* 값이 여덟이고 칸이 좁다 — 이름 줄과 메타 줄로 세운다(§5). 값을 빼지 않는다.
                  글자는 밑선이고(§5 정렬 표) 껍데기(점 · 배지 2종)는 행의 세로 중앙이다 */}
              <span className="flex items-baseline gap-2">
                {/* 왼쪽 줄의 점은 **읽기 전용**이다 — 고르는 자리는 오른쪽 머리다(§5) */}
                <PersonaDot color={colors[row.name]} />
                <span className="min-w-0 truncate font-mono text-sm">{row.name}</span>
                {e.saved === null && (
                  <Badge variant="outline" className="self-center">
                    프로필 없음
                  </Badge>
                )}
                {/* 저장 버튼이 오른쪽에 있다 — 다른 줄을 고른 채 잊으면 이게 유일한 표시다(§5) */}
                {e.body !== (e.saved ?? "") && (
                  <Badge variant="outline" className="ml-auto self-center">
                    저장 안 됨
                  </Badge>
                )}
              </span>
              <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate" title={row.file}>
                  {refs ? `티켓 ${refs}` : "참조하는 티켓 없음"}
                </span>
                {/* `티켓 n` 뒤 · 자수 앞 — "무엇을 참조하나 → 무엇을 쓰나 → 얼마나 먹나"다
                    (§비주얼 §25 ①). 0개면 안 그린다: 고정폭 메타라 빠져도 줄이 안 흔들린다 */}
                {e.skills.length > 0 && <span className="whitespace-nowrap">스킬 {e.skills.length}</span>}
                {/* `스킬 n` 뒤 · `자수` 앞이다(§비주얼 §32 ①) — "무엇을 참조하나 → 무엇을 쓰나 →
                    **무엇을 배웠나** → 얼마나 먹나". `장`을 안 붙인다: 앞 둘과 같은 종류의 값이다 */}
                {e.memories.length > 0 && (
                  <span className="whitespace-nowrap">메모리 {e.memories.length}</span>
                )}
                {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§5).
                    목록에 둬야 "누가 프롬프트를 얼마나 먹는가"를 비교할 수 있다. `skills.md` ·
                    `memory/*.md`도 매 디스패치에 인라인되므로 **셋의 합**이다(§비주얼 §32 ①) */}
                <span className="ml-auto font-mono whitespace-nowrap">{editChars(e)}자</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 grow">
        <PersonaDetail
          // 이름이 바뀌면 절 안의 지역 상태(저장 결과 · 실패 사유 · 제거 중)를 새로 시작한다.
          // **편집 상태는 여기 없다** — 위 `edits`에 있어서 이 재마운트가 아무것도 안 버린다
          key={current.name}
          projectId={projectId}
          row={current}
          edit={editOf(current)}
          onEdit={(next) => setEdits((prev) => ({ ...prev, [current.name]: next }))}
          color={colors[current.name]}
          installed={installed}
          configDir={configDir}
        />
      </div>
    </div>
  );
}

/** 오른쪽 칸 하나. `body: null`(프로필 없음)이면 빈 textarea가 열리고 **저장이 곧 생성**이다 —
 *  티켓이 부르는데 프로필이 없는 이름을 그 자리에서 채우게 하려고 경로를 하나로 둔다. */
function PersonaDetail({
  projectId,
  row,
  edit,
  onEdit,
  color,
  installed,
  configDir,
}: {
  projectId: string;
  row: PersonaRow;
  edit: PersonaEdit;
  onEdit: (next: PersonaEdit) => void;
  color?: string;
  installed: Skill[];
  configDir: string;
}) {
  const [result, setResult] = useState<PersonaResult | null>(null);
  // 삭제·색은 둘 다 이 칸 머리에서 누르므로 사유도 머리 아래다 — 실패는 **누른 곳**이다(§5).
  const [headError, setHeadError] = useState<{ title: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = edit.body !== (edit.saved ?? "");

  return (
    <div className="space-y-3">
      {/* 머리 — 색 점(팔레트 팝오버 트리거) · 이름 · `삭제`(§5). 전부 껍데기라 세로 중앙이다 */}
      <div className="flex items-center gap-2">
        {/* 색을 고르는 자리는 이 화면 하나뿐이고, 그 자리가 여기다(§5) */}
        <ColorPicker
          projectId={projectId}
          name={row.name}
          color={color}
          onError={(message) =>
            setHeadError(message ? { title: "색을 저장하지 못했습니다", message } : null)
          }
        />
        <span className="font-mono text-sm break-all">{row.name}</span>
        {edit.saved !== null && (
          <span className="ml-auto">
            <DeleteButton
              projectId={projectId}
              row={row}
              onError={(message) => setHeadError({ title: "삭제하지 못했습니다", message })}
            />
          </span>
        )}
      </div>

      {headError && <Failure title={headError.title} message={headError.message} />}

      {/* 원문 편집이다 — 마크다운 렌더는 넣지 않는다(§6 프로토콜 에디터와 같은 결정) */}
      <Textarea
        aria-label={`${row.name} PROFILE.md`}
        className="font-mono"
        rows={16}
        value={edit.body}
        onChange={(e) => onEdit({ ...edit, body: e.target.value })}
      />
      {result && !result.ok && <Failure title="저장하지 못했습니다" message={result.message ?? ""} />}
      {/* 오른쪽 정렬, 1차 액션이 가장 오른쪽 — 결과 문구는 버튼 왼쪽이다(§비주얼 §4-3) */}
      <div className="flex items-center justify-end gap-4">
        {result?.ok && !dirty && <span className="text-sm text-muted-foreground">저장됐습니다.</span>}
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const body = edit.body;
              const r = await savePersonaAction(projectId, row.name, body);
              setResult(r);
              if (r.ok) onEdit({ ...edit, saved: body, body });
            })
          }
        >
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>

      {/* 스킬 절(§비주얼 §25 ②). 값이 한 줄도 안 바뀐다 — 카드에서 오른쪽 칸으로 따라왔을 뿐이다 */}
      <SkillsSection
        projectId={projectId}
        name={row.name}
        skills={edit.skills}
        chars={edit.skillsChars}
        installed={installed}
        configDir={configDir}
        onSaved={(skills, skillsChars) => onEdit({ ...edit, skills, skillsChars })}
      />

      {/* 메모리 절(§비주얼 §32 ②) — 스킬 절 **바로 뒤**다. 화면이 주입 순서를 그대로 보인다
          (PROFILE → 스킬 → 메모리). 0장이어도 그린다: `삭제`가 사는 자리를 사람이 배우는
          화면이 여기뿐이고, 오늘 이 큐의 카드가 전부 0장이다 */}
      <MemorySection
        projectId={projectId}
        name={row.name}
        dir={row.file.replace(/\/PROFILE\.md$/, "")}
        memories={edit.memories}
        chars={edit.memories.reduce((n, m) => n + m.text.length, 0)}
        onDeleted={(file) =>
          onEdit({ ...edit, memories: edit.memories.filter((m) => m.file !== file) })
        }
      />
    </div>
  );
}

// ── 스킬 (DESIGN.md §5-1 · §비주얼 §25) ─────────────────────────────────────

/** 오른쪽 칸 본문의 두 번째 블록. 저장은 **한 경로**다 — `제거`도 다이얼로그의 `저장`도
 *  `savePersonaSkillsAction`(=`writePersonaSkills`)에 목록 전체를 넘긴다. 0개가 되면 파일이 사라진다.
 *
 *  실패 자리가 둘로 갈리는 이유는 §비주얼 §25 다섯 상태다 — **누른 곳**에 뜬다.
 *  `제거`는 여기 절 아래, 다이얼로그의 `저장`은 그 `DialogFooter` 위다. */
function SkillsSection({
  projectId,
  name,
  skills,
  chars,
  installed,
  configDir,
  onSaved,
}: {
  projectId: string;
  name: string;
  skills: Skill[];
  chars: number;
  installed: Skill[];
  configDir: string;
  onSaved: (skills: Skill[], chars: number) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  /** 쓰기의 유일한 창구. **고른 이름만** 보낸다(설명은 서버가 채운다) — 성공하면 서버가
   *  되읽은 목록·자수로 화면을 맞춘다. */
  const save = async (picked: string[]) => {
    const r = await savePersonaSkillsAction(projectId, name, picked);
    if (r.ok) onSaved(r.skills ?? [], r.chars ?? 0);
    return r;
  };

  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">스킬</h3>
        {/* 0개일 때 `0자`는 참이지만 아무것도 안 말한다 — 바로 아래 한 줄이 이미 말했다 */}
        {skills.length > 0 && <span className="text-xs text-muted-foreground">{chars}자</span>}
        <AddSkillsDialog current={skills} installed={installed} configDir={configDir} save={save} />
      </div>

      {skills.length === 0 ? (
        // `<EmptyState>`가 아니다 — 화면의 1차 콘텐츠가 아니고 다음 행동은 절 머리에 있다(§25 ②)
        <p className="text-xs text-muted-foreground">
          고른 스킬이 없습니다 — 디스패치 프롬프트에 스킬 절이 실리지 않습니다.
        </p>
      ) : (
        <>
          {/* 어휘는 §비주얼 §23 ⑤의 문형 그대로다(`<무엇>은 claude 엔진에서만 …`). 이건 경고가
              아니라 상시 참인 사실이라 `Alert`가 아니다 — 이 화면에는 엔진 값이 아예 없다 */}
          <p className="text-xs text-muted-foreground">
            스킬은 claude 엔진에서만 실립니다 — codex 워커가 물면 이 절은 프롬프트에 안 갑니다.
          </p>
          <ul className="space-y-1">
            {skills.map((s) => (
              <li key={s.name} className="flex items-baseline gap-2">
                {/* 이름은 프롬프트에 그대로 실려 지목이 되는 토큰이다 — 안 자른다(§6 식별자) */}
                <code className="shrink-0 font-mono text-xs">{s.name}</code>
                <span
                  className="min-w-0 grow truncate text-xs text-muted-foreground"
                  title={s.description}
                >
                  {s.description}
                </span>
                {/* 확인 다이얼로그를 안 붙인다 — 되돌리는 비용이 `스킬 추가`를 한 번 여는 것이다.
                    어휘도 가른다: 디렉터리는 `삭제`, 목록 한 줄은 `제거`(§25 ②) */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center"
                  disabled={removing !== null}
                  onClick={() =>
                    start(async () => {
                      setRemoving(s.name);
                      setError(null);
                      const r = await save(
                        skills.filter((x) => x.name !== s.name).map((x) => x.name),
                      );
                      setRemoving(null);
                      if (!r.ok) setError(r.message ?? "스킬을 저장하지 못했습니다.");
                    })
                  }
                >
                  {removing === s.name ? "제거 중…" : "제거"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <Failure title="스킬을 저장하지 못했습니다" message={error} />}
    </section>
  );
}

// ── 메모리 (DESIGN.md §5-2 · §비주얼 §32) ───────────────────────────────────

/** 오른쪽 칸 본문의 세 번째 블록. **읽기와 삭제뿐이다** — 쓰는 쪽이 세션이라 절 머리에 버튼이 없고
 *  편집 textarea도 없다(§5-2 §화면).
 *
 *  스킬 절과 껍데기·머리·목록이 같은 값인 것은 의도다(§32 ⓪) — 두 절이 한 칸에 위아래로 서므로
 *  값이 갈리면 그 자체가 "다른 성격"이라는 거짓말이 된다. 갈리는 것은 다섯뿐이고 전부 §32에 있다. */
function MemorySection({
  projectId,
  name,
  dir,
  memories,
  chars,
  onDeleted,
}: {
  projectId: string;
  name: string;
  /** `<personas>/<이름>` — 확인 다이얼로그가 지울 파일의 전체 경로를 적는다(§32 ④) */
  dir: string;
  memories: Memory[];
  chars: number;
  onDeleted: (file: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">메모리</h3>
        {/* 0장일 때 `0자`는 참이지만 아무것도 안 말한다(§25 ②와 같은 판정) */}
        {memories.length > 0 && <span className="text-xs text-muted-foreground">{chars}자</span>}
      </div>

      {memories.length === 0 ? (
        // 스킬 절의 빈 상태와 방향이 다르다 — 여기는 다음 행동이 사람에게 없어서 이 한 줄이
        // **누가 채우는가**를 말한다. 없으면 버튼 없는 빈 절이 고장으로 읽힌다(§32 ②)
        <p className="text-xs text-muted-foreground">
          메모리가 없습니다 — 세션이 회고에서 남기면 여기에 쌓입니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {memories.map((m) => (
            <li key={m.file}>
              {/* 이 화면에 남은 유일한 `<details>`다 — 2단이 되면서 바깥 카드의 `<details>`는
                  없어졌다. **그래도 그룹 이름은 그대로 둔다**: 이름 없는 `group-open:`은 조상의
                  `group`을 물어서 바깥에 `group`이 다시 생기는 날 chevron이 조용히 틀린다.
                  `accordion`·`collapsible`은 안 깐다 — 이 자리도 같은 값이다(§32 ③) */}
              <details className="group/mem">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-open/mem:rotate-90"
                  />
                  {/* 파일명이 곧 개념 이름이고 `[[링크]]`가 가리키는 값이다 — 안 자른다(§6 식별자).
                      `.md`를 떼는 것은 계약이다(§5-2). 확장자가 붙는 자리는 삭제 확인 하나다 */}
                  <code className="shrink-0 font-mono text-xs">{m.file.replace(/\.md$/, "")}</code>
                  {/* `title`을 안 붙인다 — 전문을 보는 자리가 이 줄을 누르는 것이다(§32 ③).
                      발췌가 비는 파일(빈 파일·공백뿐)도 파일명으로 목록에 선다(§5-2) */}
                  <span className="min-w-0 grow truncate text-xs text-muted-foreground">
                    {m.excerpt}
                  </span>
                  {/* 줄 자신이 `<summary>`라 클릭이 곧 펼침 토글이다 — **여기만 `preventDefault`가
                      남는다**(§32 ③). 왼쪽 목록 줄과 오른쪽 머리는 `<summary>`가 아니라 없앴다.
                      `stopPropagation`은 activationTarget이 이미 정해져 안 통한다 */}
                  <span className="ml-auto self-center" onClick={(e) => e.preventDefault()}>
                    <DeleteMemoryButton
                      projectId={projectId}
                      name={name}
                      dir={dir}
                      memory={m}
                      onDone={(message) => {
                        setError(message);
                        if (!message) onDeleted(m.file);
                      }}
                    />
                  </span>
                </summary>
                {/* 상한이 없으면 한 줄이 116자다(§32 §폭 실측). `pl-6` = chevron 16 + gap 8이라
                    전문이 파일명 왼쪽 끝에 맞는다. `<Markdown>` 값은 한 클래스도 안 덮는다(§10) */}
                <div className="max-w-3xl pt-1 pb-3 pl-6">
                  <Markdown text={m.text} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {/* 실패는 **누른 곳**이다 — 이건 펼쳐야 만질 수 있어서 절 맨 아래다(§32 다섯 상태) */}
      {error && <Failure title="메모리를 지우지 못했습니다" message={error} />}
    </section>
  );
}

/** 되돌리는 경로가 화면에 없다(추가도 편집도 이 절에 없고 쓰는 쪽이 세션이다) — 그래서
 *  스킬의 `제거`와 달리 `Trash2` + `alert-dialog`다(§32 ④ · §5 인벤토리의 다섯 번째 자리).
 *
 *  **본문을 다이얼로그에 다시 그리지 않는다** — 읽는 자리는 펼친 전문이고 순서가 그렇게 되어
 *  있다(펴서 읽고 → 지운다). `[[링크]]` 참조 경고도 없다: 화면은 링크를 파싱하지 않는다. */
function DeleteMemoryButton({
  projectId,
  name,
  dir,
  memory,
  onDone,
}: {
  projectId: string;
  name: string;
  dir: string;
  memory: Memory;
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
            <span className="font-mono text-xs break-all">{`${dir}/memory/${memory.file}`}</span>{" "}
            파일을 지웁니다. 되돌릴 수 없습니다 — 이 화면에 편집도 추가도 없습니다. 다음
            디스패치부터 이 개념은 프롬프트에서 빠집니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deletePersonaMemoryAction(projectId, name, memory.file);
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

/** `스킬 추가` — `Dialog` + `Command`(§비주얼 §25 ③). `CommandDialog`가 아니다: 그 껍데기는
 *  제목이 `sr-only`이고 액션 행이 없는 명령 팔레트다.
 *
 *  **체크를 끌 수 있다.** 이 그릇이 드는 것은 선택 상태 하나고, 이미 든 스킬을 체크된 채로
 *  보여주기로 한 순간(§5-1) 그 체크를 못 끄게 만들 정직한 방법이 없다. `저장`이 파일을 한 번 쓴다. */
function AddSkillsDialog({
  current,
  installed,
  configDir,
  save,
}: {
  current: Skill[];
  installed: Skill[];
  configDir: string;
  save: (picked: string[]) => Promise<PersonaResult>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 후보에 없는데 이미 든 스킬. 안 그리면 `저장` 한 번에 조용히 사라진다(§25 ③)
  const orphans = current.filter((c) => !installed.some((i) => i.name === c.name));
  const toggle = (name: string) =>
    setPicked(picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name]);

  const item = (s: Skill, note?: string) => (
    <CommandItem
      key={s.name}
      value={`${s.name} ${s.description}`}
      className="items-start gap-2 px-2 py-2"
      onSelect={() => toggle(s.name)}
    >
      {/* 앞자리 체크 — deps 팝오버·필터 팝오버와 같은 조립이다. 안 고른 항목도 같은 폭이다 */}
      <span className="w-4 shrink-0 pt-0.5">
        {picked.includes(s.name) && <Check aria-hidden className="size-4" />}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="font-mono text-xs">{s.name}</span>
        {/* 선택(hover·키보드 커서)에서 밑면이 `bg-muted`가 되고 그 위 `--muted-foreground`는
            라이트 4.34로 AA 미달이다 — 항목의 `data-selected:text-foreground`를 자식이 덮으므로
            자식이 같은 변종을 한 번 더 든다(§비주얼 §25 대비 검증) */}
        <span className="line-clamp-2 text-xs text-muted-foreground group-data-selected/command-item:text-foreground">
          {note ?? s.description}
        </span>
      </span>
    </CommandItem>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // 열 때마다 파일의 현재 목록에서 시작한다 — 닫고 다시 열면 화면이 파일과 같다
        if (o) {
          setPicked(current.map((s) => s.name));
          setQuery("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" className="ml-auto self-center" />}>
        스킬 추가
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>스킬 추가</DialogTitle>
          <DialogDescription>
            이 머신에 설치된 스킬입니다. 고른 것이 이 페르소나의 디스패치 프롬프트에 실립니다.
          </DialogDescription>
        </DialogHeader>

        <Command>
          <CommandInput
            placeholder="스킬 검색 — 이름 또는 설명"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {installed.length + orphans.length > 0 && (
              <CommandEmpty>{`"${query}"와 일치하는 스킬 0건`}</CommandEmpty>
            )}
            {orphans.length > 0 ? (
              <>
                <CommandGroup heading="이 머신에 없음">
                  {orphans.map((s) =>
                    item(s, "설치된 스킬 목록에 없습니다 — 다른 머신에서 고른 것일 수 있습니다"),
                  )}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="설치된 스킬">{installed.map((s) => item(s))}</CommandGroup>
              </>
            ) : (
              // 전부 후보 안에 있으면(정상) 머리 없는 평평한 목록이다 — 항상 켜진 머리는
              // 한 줄을 먹고 아무것도 안 가른다(§25 ③)
              installed.map((s) => item(s))
            )}
            {/* 후보 0개는 필터 결과가 아니라 이 머신의 사실이라 **어디를 봤는지** 적는다.
                에러가 아니다 — 스킬을 하나도 안 깐 머신은 정상이다(§25 다섯 상태) */}
            {installed.length === 0 && (
              <div className="space-y-1 px-2 py-6 text-center">
                <p className="text-sm">이 머신에서 스킬을 찾지 못했습니다</p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {configDir}/skills/*/SKILL.md
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {configDir}/plugins/marketplaces/*/skills/*/SKILL.md
                </p>
                <p className="text-xs text-muted-foreground">
                  CLAUDE_CONFIG_DIR이 없으면 &lt;config&gt;는 ~/.claude입니다
                </p>
              </div>
            )}
          </CommandList>
        </Command>

        {/* 실패하면 다이얼로그가 열린 채로 남고 체크도 남는다 — 사유를 읽고 다시 누른다 */}
        {error && <Failure title="스킬을 저장하지 못했습니다" message={error} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await save(picked);
                if (r.ok) setOpen(false);
                else setError(r.message ?? "스킬을 저장하지 못했습니다.");
              })
            }
          >
            {pending ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 삭제 확인. 뽑은 이유는 재사용이 아니라 자리다 — 60줄짜리 다이얼로그가 오른쪽 칸 머리에
 *  그대로 들어가면 그 머리가 뭘 담는지가 안 보인다. 호출부는 하나다. */
function DeleteButton({
  projectId,
  row,
  onError,
}: {
  projectId: string;
  row: PersonaRow;
  onError: (message: string) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Trash2 aria-hidden />
            삭제
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>페르소나 삭제 — {row.name}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">
              {row.file.replace(/\/PROFILE\.md$/, "")}
            </span>{" "}
            디렉터리를 안의 파일까지 지웁니다. 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* 티켓은 지우지 않는다 — 남은 티켓은 페르소나 없이 디스패치된다(tick.sh 188행) */}
        {row.refs.open + row.refs.wip > 0 && (
          <Alert>
            <TriangleAlert aria-hidden className="text-status-stale" />
            <AlertTitle>
              이 페르소나를 참조하는 티켓이 {row.refs.open + row.refs.wip}건 있습니다
              {row.refs.wip > 0 && ` (진행중 ${row.refs.wip}건)`}
            </AlertTitle>
            <AlertDescription>
              티켓은 지워지지 않습니다. 프로필이 없어지면 엔진은{" "}
              <span className="font-mono text-xs">WARN</span>만 남기고{" "}
              <strong className="font-medium">페르소나 없이</strong> 디스패치합니다 — 세션이
              역할·권한을 모르는 채로 시작합니다.
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deletePersonaAction(projectId, row.name);
                if (!r.ok) onError(r.message ?? "삭제하지 못했습니다.");
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
