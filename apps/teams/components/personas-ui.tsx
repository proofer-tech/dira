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
// 접힌 줄의 점도 보드·칸반·필터와 **같은 컴포넌트**다(§5) — 색 조회의 출처는 하나다
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
  /** `skills.md` **파일 전체** 자수 — 접힌 줄의 자수가 이걸 더한다(§비주얼 §25 ①) */
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

/** 접힌 줄의 점이 곧 트리거다(§12). `<summary>` 안이라 클릭이 곧 펼침 토글인데 — 삭제 버튼과
 *  같은 처방으로 `preventDefault`다(호출부에서 감싼다. `stopPropagation`은 안 통한다).
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

/** 페르소나 하나. `body: null`(프로필 없음)이면 빈 textarea가 열리고 **저장이 곧 생성**이다 —
 *  티켓이 부르는데 프로필이 없는 이름을 그 자리에서 채우게 하려고 경로를 하나로 둔다. */
export function PersonaCard({
  projectId,
  row,
  color,
  installed,
  configDir,
}: {
  projectId: string;
  row: PersonaRow;
  /** 레지스트리의 팔레트 키. 없거나 팔레트 밖이면 빈 점이다(§12) */
  color?: string;
  /** 이 머신에 설치된 스킬(§5-1). 페르소나 수와 무관하게 서버가 한 번 읽어 내렸다 */
  installed: Skill[];
  /** 해석된 `<config>` — 후보가 0개일 때 "어디를 봤는지"를 적는다(§비주얼 §25 다섯 상태) */
  configDir: string;
}) {
  // 저장된 원문을 state로 들고 있는다 — 서버가 다시 렌더해 주기를 기다리지 않고 저장 직후에
  // `프로필 없음` 배지와 삭제 버튼이 바로 맞는다(workers-ui의 컨텍스트 카드와 같은 이유).
  const [saved, setSaved] = useState(row.body);
  const [body, setBody] = useState(row.body ?? "");
  // 스킬도 같은 이유로 state다. **자수는 서버가 쓴 뒤 되읽어 준 값**이다 — 파일에는 사람이
  // 덧붙인 산문도 있어서 목록만으로는 계산이 안 된다(§비주얼 §25).
  const [skills, setSkills] = useState(row.skills);
  const [skillsChars, setSkillsChars] = useState(row.skillsChars);
  // 메모리는 지우는 것뿐이라 되읽기가 없다 — 자수가 파일 전체의 합이고 그 파일을 화면이 들고
  // 있어서, 지운 파일의 길이를 빼면 참인 수다(§비주얼 §32 ①).
  const [memories, setMemories] = useState(row.memories);
  const [result, setResult] = useState<PersonaResult | null>(null);
  // 삭제·색은 둘 다 접힌 줄에서 누르므로 사유도 접힌 채 보여야 한다 — 자리가 하나다.
  const [rowError, setRowError] = useState<{ title: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const refs = refsLabel(row.refs);
  const dirty = body !== (saved ?? "");
  const memoryChars = memories.reduce((n, m) => n + m.text.length, 0);

  return (
    // 네이티브 `<details>`다 — shadcn accordion을 설치하지 않는다(§비주얼 컴포넌트 인벤토리).
    // 접힘은 표시 상태일 뿐이라 본문이 언마운트되지 않는다 = 편집 중인 textarea가 살아 있다.
    // ponytail: 펼침 상태를 URL에 담지 않는다. 딥링크(`?open=<이름>`)가 실제로 생기면 그때.
    // 바깥 div는 삭제 실패 사유 때문이다 — 삭제를 접힌 줄에서 누르므로 사유도 접힌 채 보여야 한다.
    <div className="rounded-md border">
      <details className="group">
        {/* 글자는 밑선(§5) — 이 줄은 mono `text-sm` 이름과 `text-xs` 메타가 섞여 줄상자 높이가
            20px/16px로 다르다. `items-center`는 상자를 맞추므로 글자 밑선이 어긋난다.
            껍데기(chevron · 색 점 · 배지 2종 · 삭제)는 글자가 아니라 행의 세로 중앙이라
            `self-center`로 뺀다. 밑선에 서는 것은 글자 세 자리(이름 · 티켓 참조 · 자수)뿐이다. */}
        <summary className="flex cursor-pointer list-none items-baseline gap-2 p-3 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90"
          />
          {/* 색을 고르는 자리는 이 화면 하나뿐이다(§5). 삭제와 같은 이유로 preventDefault다 */}
          <span className="self-center" onClick={(e) => e.preventDefault()}>
            <ColorPicker
              projectId={projectId}
              name={row.name}
              color={color}
              onError={(message) =>
                setRowError(message ? { title: "색을 저장하지 못했습니다", message } : null)
              }
            />
          </span>
          <span className="font-mono text-sm">{row.name}</span>
          {saved === null && (
            <Badge variant="outline" className="self-center">
              프로필 없음
            </Badge>
          )}
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={row.file}>
            {refs ? `티켓 ${refs}` : "참조하는 티켓 없음"}
          </span>
          {/* `티켓 n` 뒤 · 자수 앞 — "무엇을 참조하나 → 무엇을 쓰나 → 얼마나 먹나"다(§비주얼 §25 ①).
              0개면 안 그린다: 뒤에 붙는 고정폭 메타라 빠져도 줄이 안 흔들린다 */}
          {skills.length > 0 && (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              스킬 {skills.length}
            </span>
          )}
          {/* `스킬 n` 뒤 · `자수` 앞이다(§비주얼 §32 ①) — "무엇을 참조하나 → 무엇을 쓰나 →
              **무엇을 배웠나** → 얼마나 먹나". `장`을 안 붙인다: 앞 둘과 같은 종류의 값이다 */}
          {memories.length > 0 && (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              메모리 {memories.length}
            </span>
          )}
          {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§5).
              접힌 줄에 둬야 "누가 프롬프트를 얼마나 먹는가"를 목록에서 비교할 수 있다.
              `skills.md`·`memory/*.md`도 매 디스패치에 인라인되므로 **셋의 합**이다
              (§비주얼 §32 ① — 세 수로 분해하지 않는다. 사람 손 없이 자라는 몫이 메모리다) */}
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
            {body.length + skillsChars + memoryChars}자
          </span>
          {/* 저장 버튼은 펼쳐야 보인다 — 접은 채 잊으면 이게 유일한 표시다(§5) */}
          {dirty && (
            <Badge variant="outline" className="self-center">
              저장 안 됨
            </Badge>
          )}
          {saved !== null && (
            // 삭제는 접힌 줄에 있고 펼침을 토글하지 않는다. summary의 활성화 동작을 막는 건
            // preventDefault다 — stopPropagation은 activationTarget이 이미 정해져 안 통한다.
            <span className="ml-auto self-center" onClick={(e) => e.preventDefault()}>
              <DeleteButton
                projectId={projectId}
                row={row}
                onError={(message) => setRowError({ title: "삭제하지 못했습니다", message })}
              />
            </span>
          )}
        </summary>

        <div className="space-y-3 border-t p-3">
          {/* 원문 편집이다 — 마크다운 렌더는 넣지 않는다(§6 프로토콜 에디터와 같은 결정) */}
          <Textarea
            aria-label={`${row.name} PROFILE.md`}
            className="font-mono"
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {result && !result.ok && (
            <Failure title="저장하지 못했습니다" message={result.message ?? ""} />
          )}
          {/* 오른쪽 정렬, 1차 액션이 가장 오른쪽 — 결과 문구는 버튼 왼쪽이다(§비주얼 §4-3) */}
          <div className="flex items-center justify-end gap-4">
            {result?.ok && !dirty && (
              <span className="text-sm text-muted-foreground">저장됐습니다.</span>
            )}
            <Button
              size="sm"
              disabled={pending || !dirty}
              onClick={() =>
                start(async () => {
                  const r = await savePersonaAction(projectId, row.name, body);
                  setResult(r);
                  if (r.ok) setSaved(body);
                })
              }
            >
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>

          {/* 스킬 절(§비주얼 §25 ②). `<summary>` 밖이라 `preventDefault`가 없다 —
              반사적으로 붙이면 다이얼로그가 안 열린다 */}
          <SkillsSection
            projectId={projectId}
            name={row.name}
            skills={skills}
            chars={skillsChars}
            installed={installed}
            configDir={configDir}
            onSaved={(next, chars) => {
              setSkills(next);
              setSkillsChars(chars);
            }}
          />

          {/* 메모리 절(§비주얼 §32 ②) — 스킬 절 **바로 뒤**다. 화면이 주입 순서를 그대로 보인다
              (PROFILE → 스킬 → 메모리). 0장이어도 그린다: `삭제`가 사는 자리를 사람이 배우는
              화면이 여기뿐이고, 오늘 이 큐의 카드가 전부 0장이다 */}
          <MemorySection
            projectId={projectId}
            name={row.name}
            dir={row.file.replace(/\/PROFILE\.md$/, "")}
            memories={memories}
            chars={memoryChars}
            onDeleted={(file) => setMemories(memories.filter((m) => m.file !== file))}
          />
        </div>
      </details>

      {rowError && (
        <div className="p-3 pt-0">
          <Failure title={rowError.title} message={rowError.message} />
        </div>
      )}
    </div>
  );
}

// ── 스킬 (DESIGN.md §5-1 · §비주얼 §25) ─────────────────────────────────────

/** 카드 본문의 두 번째 블록. 저장은 **한 경로**다 — `제거`도 다이얼로그의 `저장`도
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

/** 카드 본문의 세 번째 블록. **읽기와 삭제뿐이다** — 쓰는 쪽이 세션이라 절 머리에 버튼이 없고
 *  편집 textarea도 없다(§5-2 §화면).
 *
 *  스킬 절과 껍데기·머리·목록이 같은 값인 것은 의도다(§32 ⓪) — 두 절이 한 카드에 위아래로 서므로
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
              {/* 중첩 `<details>`다 — 카드 자신이 바깥 `<details>`고 이건 그 안이다.
                  **그래서 그룹에 이름을 준다**: 이름 없는 `group-open:`은 조상인 카드의 `group`을
                  물어서 카드가 펼쳐진 동안 chevron이 항상 돌아 있다(항목은 접혀 있는데도).
                  `accordion`·`collapsible`은 안 깐다 — 세 번째 자리도 같은 값이다(§32 ③) */}
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
                  {/* 줄 자신이 `<summary>`라 클릭이 곧 펼침 토글이다 — 여기서는 `preventDefault`가
                      다시 필요하다(§32 ③ · 접힌 줄의 삭제·색 점과 같은 처방) */}
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

/** 삭제 확인. `PersonaCard`에서 뽑은 이유는 재사용이 아니라 자리다 — 60줄짜리 다이얼로그가
 *  `<summary>` 안에 들어가면 접힌 줄이 뭘 담는지가 안 보인다. 호출부는 하나다. */
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
