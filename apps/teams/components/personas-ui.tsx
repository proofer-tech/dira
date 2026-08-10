"use client";

/** 페르소나 화면(`/p/<project>/personas`)의 클라이언트 조각 — 생성 · 편집 · 삭제.
 *
 *  fs를 만지는 건 서버 액션뿐이다(`app/p/[project]/personas/actions.ts`). 파일 하나에 모은 이유는
 *  `workers-ui.tsx`와 같다 — 같은 화면의 세 액션이 같은 문구(엔진이 WARN만 남긴다 · 이름 규칙)를
 *  쓰므로 쪼개면 자리가 갈린다. */
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, Trash2, TriangleAlert } from "lucide-react";
import {
  createPersonaAction,
  deletePersonaAction,
  deletePersonaMemoryAction,
  installSkillAction,
  savePersonaAction,
  savePersonaEngineAction,
  savePersonaLimitAction,
  savePersonaSkillsAction,
  setPersonaColorAction,
  type PersonaResult,
} from "@/app/(app)/p/[project]/personas/actions";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { skillUploadError } from "@/lib/skill-upload-limit";
import type { Memory, Skill } from "@/lib/skills";
import { decodeHash, engineMissing, PERSONA_COLORS, personaDotClass } from "@/lib/urls";
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
  /** `limit` 사이드카의 정수(§5-4). `null` = 파일 없음·빈 파일·정수 아님 = **상한 없음**.
   *  자수에 안 더한다 — 이 파일은 프롬프트에 안 실린다(엔진이 디스패치 앞에서 읽는 정책값이다) */
  limit: number | null;
  /** `engine` 사이드카의 값(§제약 1 §결정 기록 §열한 번째). `null` = 파일 없음·모양이 다름 =
   *  **지정 없음**(그 페르소나는 워커 자신의 엔진을 쓴다). `limit`과 같은 이유로 자수에 안 더한다 */
  engine: { engineId: string; model: string } | null;
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
  /** **저장된 값이다** — 입력칸의 초안이 아니다(초안은 오른쪽 머리가 든다). 왼쪽 줄의
   *  `상한 n`이 이걸 그리므로 저장 직후에 여기까지 올라와야 목록이 파일과 같아진다 */
  limit: number | null;
  /** **저장된 값이다** — 팝오버의 초안은 `EngineField`가 지역 상태로 든다(상한과 같은 벌) */
  engine: { engineId: string; model: string } | null;
};

/** 서버가 방금 준 값 그대로. 아직 손대지 않은 페르소나는 이걸 읽으므로 **다른 세션이 파일을
 *  고치면 목록이 따라간다** — 오버레이에 들어가는 것은 사람이 만진 이름뿐이다. */
const initialEdit = (row: PersonaRow): PersonaEdit => ({
  saved: row.body,
  body: row.body ?? "",
  skills: row.skills,
  skillsChars: row.skillsChars,
  memories: row.memories,
  limit: row.limit,
  engine: row.engine,
});

/** 주소 → 페르소나 세그먼트(없으면 `null`). **`popstate` 하나가 쓴다** — 서버가 `params`로
 *  받는 것과 같은 값을 만들어야 해서 디코드도 같은 `decodeHash`다(§5 §선택이 경로에 담긴다).
 *  `lib/urls.ts`에 안 두는 이유는 그 파일이 **서버와 클라이언트가 같이 쓰는 것**만 담아서다 —
 *  서버는 이 파싱을 안 한다(Next가 이미 세그먼트를 쪼개 준다). 검증은 `pnpm test`가 아니라
 *  CDP 뒤로가기 실측이다(JSX 파일이라 `node --test`가 못 읽는다 — AGENTS.md). */
const personaSegment = (pathname: string): string | null => {
  const rest = /\/personas\/(.+)$/.exec(pathname)?.[1];
  return rest === undefined ? null : rest.split("/").map(decodeHash).join("/");
};

const editChars = (e: PersonaEdit) =>
  e.body.length + e.skillsChars + e.memories.reduce((n, m) => n + m.text.length, 0);

/** 2단 — 왼쪽이 목록, 오른쪽이 고른 페르소나(§5). 조립은 §6 프로토콜 화면과 같다
 *  (왼쪽 고정폭 + 오른쪽 `grow`, 좁으면 세로로 쌓인다).
 *
 *  **왼쪽 그릇이 shadcn `sidebar`다**(`0740c4dc`, 요구 `14529463` — §비주얼 §34 판정표
 *  `페르소나 목록` 행). `2e303100`이 이 2단을 세울 때 적은 *새 shadcn 컴포넌트 0개다*를 그
 *  요구가 뒤집었다. **갈린 것은 그릇과 면 둘뿐**이고 §5의 값은 한 자도 안 갈렸다 —
 *  줄이 이는 값 여덟 · baseline 정렬 · 줄 안에 버튼 0개 · 오른쪽 칸 전부 · 0개면
 *  `<EmptyState>`(그 판정은 부르는 쪽에 있다: 2단도 사이드바도 안 그린다).
 *
 *  **선택은 경로가 담고 `pushState`로 담는다**(§5 §선택이 경로에 담긴다. 사람 요구 `8429c041`).
 *  `router.push`도 `<Link>`도 아니다 — 그러면 서버가 다시 렌더하면서 앞 페르소나의 textarea가
 *  언마운트돼 저장 안 한 편집이 사라진다(그 못은 그대로 선다. 뽑은 것은 *딥링크 경로가 없다*는
 *  근거뿐이다). native History API는 Next 16이 그대로 받아서 `usePathname()`은 따라오고 서버
 *  왕복은 없다. `?persona=` 쿼리는 안 만든다 — 값이 두 벌이 된다. */
export function PersonasPane({
  projectId,
  initial,
  rows,
  colors,
  installed: initialInstalled,
  configDir,
  engines,
  modelPattern,
  engineHint,
}: {
  projectId: string;
  /** 경로의 페르소나 세그먼트(없으면 `null` = 명시 선택 없음 → 목록 첫 줄). 서버가 준 것은
   *  **첫 값뿐**이다 — 그 뒤 선택은 이 컴포넌트와 `popstate`가 든다 */
  initial: string | null;
  /** 1개 이상이다 — 0개는 호출부가 `<EmptyState>`로 갈라 2단을 안 그린다 */
  rows: PersonaRow[];
  /** 레지스트리의 팔레트 키 맵. 없거나 팔레트 밖이면 빈 점이다(§12) */
  colors: Record<string, string>;
  /** 이 머신에 설치된 스킬(§5-1). 페르소나 수와 무관하게 서버가 한 번 읽어 내렸다 */
  installed: Skill[];
  /** 해석된 `<config>` — 후보가 0개일 때 "어디를 봤는지"를 적는다(§비주얼 §25 다섯 상태) */
  configDir: string;
  /** 엔진 카탈로그 — `lib/workers.ts`의 `ENGINES` 그대로(§23 재사용, `node:fs`라 클라이언트가
   *  직접 못 부른다) */
  engines: EngineCatalog;
  /** 서버 `MODEL_RE.source`. 화면이 정규식을 따로 적지 않는다(§23 재사용) */
  modelPattern: string;
  /** 엔진 `지정 없음`에 다는 실효값 힌트(§23 §개정 · 요구 `445ff9e1`). 워커가 0개거나 판정할
   *  것이 없으면 `null` — 페르소나 이름과 무관하게 워커 목록 하나에서 나온 값이라 모든 카드가
   *  같은 문자열을 받는다(engine 파일이 있는 카드는 어차피 안 그린다). */
  engineHint: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [edits, setEdits] = useState<Record<string, PersonaEdit>>({});
  // import(§5-1 §import)가 이 머신에 스킬을 하나 깔면 후보 목록이 는다 — 서버가 준 초기값이
  // 아니라 이 상태를 그린다. 위 `edits`와 같은 이유로 여기(페인 전체)에 산다: 다른 줄을 고르는
  // 순간 오른쪽 칸이 바뀌어도 방금 깐 스킬은 모든 페르소나의 다이얼로그에서 보여야 한다.
  const [installed, setInstalled] = useState<Skill[]>(initialInstalled);

  // **뒤로가기가 왼쪽 선택과 오른쪽 칸을 같이 되돌린다**(§5 표 ③ — 지금은 URL만 되돌아가고
  // 화면이 안 따라온다). `pushState`는 이 이벤트를 안 쏘므로 여기 오는 것은 사람의 뒤로/앞으로뿐이다.
  useEffect(() => {
    const sync = () => setSelected(personaSegment(location.pathname));
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  /** 선택을 바꾸는 유일한 자리 — 상태와 주소를 같이 옮긴다. `router.push`가 아닌 것이 계약이다
   *  (서버 왕복이 없어 편집 중 textarea가 안 죽는다 — 위 절 머리). */
  const select = (name: string | null) => {
    setSelected(name);
    const seg = name === null ? "" : `/${encodeURIComponent(name)}`;
    history.pushState(null, "", `/p/${projectId}/personas${seg}`);
  };

  // 명시 선택이 없으면 목록 첫 줄이다(§5 표 — 안 갈린다). 있는데 목록에 없으면 오른쪽 칸에
  // 사유가 뜬다: 세그먼트가 둘 이상인 경로도 같은 자리로 온다(이어 붙인 값이 이름과 안 맞는다).
  const current = selected === null ? rows[0] : rows.find((r) => r.name === selected);
  const editOf = (row: PersonaRow) => edits[row.name] ?? initialEdit(row);

  return (
    // **이 2단 행 자신이 `SidebarProvider`다**(§비주얼 §34 ①) — `Sidebar`가 `collapsible="none"`
    // 에서도 `useSidebar()`를 무조건 부르므로 Provider가 있어야 하는데, Provider가 내는 것도
    // `flex` `div` 하나라 **새 요소가 0개다.** `layout.tsx`에 세우지 않는 이유는 2단이 없는
    // 다섯 화면에도 그 `div`가 얹혀서다(§34 §범위).
    // **`min-h-0`이 Provider 기본 `min-h-svh`를 덮는다**(`cn`이 `min-h-*`를 병합한다) —
    // 안 덮으면 페르소나가 적은 큐에서 빈 화면 높이가 생긴다.
    <SidebarProvider className="min-h-0 flex-col gap-6 lg:flex-row">
      {/* 왼쪽 목록 — 줄 자체가 선택을 받는다. **안에 버튼이 없다**(§5): 색·삭제가 오른쪽 머리로
          갔으므로 버튼 안의 버튼도 `preventDefault` 처방도 없다.
          **그릇이 `nav` + `button` 목록에서 shadcn `sidebar`로 갈렸다**(요구 `14529463` ·
          §비주얼 §34 판정표 `페르소나 목록` 행). **랜드마크를 안 세운다** — 줄이 링크가 아니라
          버튼이라 내비가 아니다. 이름은 아래 `SidebarMenu`(ul)의 `aria-label`이 든다.
          **면이 선다**(§34 ④ — 이 자리는 종전에 면도 테두리도 없었다). 면을 내는 것은
          `bg-surface`이고 부품 기본 `bg-sidebar`를 덮는다(§34 ②): 그 토큰은 라이트에서
          `--surface`와 **같은 값**이지만 다크에서 `--card`(0.205)라, 그대로 두면 카드 대 면이
          1.00이 되고 칸반 레인(0.18)과 갈려 층이 셋이라는 §33의 계약이 화면마다 깨진다.
          폭은 종전 그대로 `w-full … lg:w-80`이다 — CSS 변수 `--sidebar-width`로는 브레이크포인트를
          못 주므로 `Sidebar`의 className이 든다(§34 ①). */}
      <Sidebar collapsible="none" className="w-full shrink-0 rounded-lg border bg-surface lg:w-80">
        {/* `py-2`가 면의 세로 패딩이고, 부품 기본 `min-h-0 flex-1 overflow-auto`가 스크롤을 든다.
            **가로 패딩은 0이다**(`SidebarGroup className="p-0"`) — 줄이 `p-2`로 그 8px을 이미
            들고 있어 면이 더하면 줄 안쪽이 16px 줄어 잘리는 자리가 옮겨 간다(§33 · §34 §값 여덟).
            그룹이 하나뿐이라 `SidebarContent`의 그룹 사이 `gap`도, `SidebarGroupLabel`도 없다 —
            이 목록은 머리 낱말이 원래 0개다(§5). */}
        <SidebarContent className="py-2">
          <SidebarGroup className="p-0">
            {/* 줄 사이 간격이 0.5(2px)였던 자리를 `SidebarMenu`의 `gap-0.5`가 든다(§34 판정표) */}
            <SidebarMenu aria-label="페르소나" className="gap-0.5">
              {rows.map((row) => {
                const e = editOf(row);
                const refs = refsLabel(row.refs);
                const active = row.name === current?.name;
                return (
                  <SidebarMenuItem key={row.name}>
                    {/* **선택 표식이 `isActive` 하나다**(§34 ③) — 겹이 둘이고(면
                        `bg-sidebar-accent` = `--muted` 값 + `font-medium`) 종전 `bg-muted
                        font-medium`과 **같은 값**이다. `aria-current`는 종전에도 있었다.
                        **`render`를 안 준다** — 기본 태그 `<button>`이고, 여기에
                        `render={<Link>}`를 쓰면 선택이 URL에 담겨 서버 재렌더가 편집 중
                        textarea를 언마운트한다(§34 서는 못 4 · 아래 절 머리 주석).
                        남는 클래스가 셋이다: 부품에 없는 `cursor-pointer` · 접기용 고정 높이
                        `h-8`을 덮는 `h-auto`(2행 줄이 눌린다) · 2행 묶음을 윗줄에 붙이는
                        `items-start`. */}
                    <SidebarMenuButton
                      type="button"
                      className="h-auto cursor-pointer items-start"
                      isActive={active}
                      aria-current={active ? "true" : undefined}
                      onClick={() => select(row.name)}
                    >
                      {/* 값이 여덟이고 칸이 좁다 — 이름 줄과 메타 줄로 세운다(§5). 값을 빼지 않는다.
                          글자는 밑선이고(§5 정렬 표) 껍데기(점 · 배지 2종)는 행의 세로 중앙이다.
                          **`span`이 아니라 `div`다** — 부품의 `[&>span:last-child]:truncate`가
                          직계 `span`을 물어서, 이 묶음이 `span`이면 두 줄짜리 상자에 `truncate`가
                          걸린다(홈의 2행 줄과 같은 처리) */}
                      <div className="flex min-w-0 grow flex-col gap-0.5">
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
                          {e.skills.length > 0 && (
                            <span className="whitespace-nowrap">스킬 {e.skills.length}</span>
                          )}
                          {/* `스킬 n` 뒤 · `자수` 앞이다(§비주얼 §32 ①) — "무엇을 참조하나 → 무엇을 쓰나 →
                              **무엇을 배웠나** → 얼마나 먹나". `장`을 안 붙인다: 앞 둘과 같은 종류의 값이다 */}
                          {e.memories.length > 0 && (
                            <span className="whitespace-nowrap">메모리 {e.memories.length}</span>
                          )}
                          {/* `메모리 n` 뒤 · `자수` 앞이다(§5-4 §화면) — 앞의 셋이 *무엇이 실리나*고
                              이건 정책값이라 실리는 것들 뒤에 선다. **파일이 없으면 아무것도 안
                              그린다**: 빈 값이 기본이라 `상한 없음`을 쓸 자리가 아니다.
                              **`상한 n / 지금 m`을 안 그린다** — 지금 도는 수는 보드가 준다(§5-4) */}
                          {e.limit !== null && (
                            <span className="whitespace-nowrap">상한 {e.limit}</span>
                          )}
                          {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§5).
                              목록에 둬야 "누가 프롬프트를 얼마나 먹는가"를 비교할 수 있다. `skills.md` ·
                              `memory/*.md`도 매 디스패치에 인라인되므로 **셋의 합**이다(§비주얼 §32 ①) */}
                          <span className="ml-auto font-mono whitespace-nowrap">{editChars(e)}자</span>
                        </span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <div className="min-w-0 grow">
        {current === undefined ? (
          // **404가 아니다** — 왼쪽 목록은 계속 선다(§5). 그릇은 §6 프로토콜의 `?core=` 거부와
          // 같은 것 그대로다: 새 컴포넌트도 새 문구도 0이다.
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>이 경로는 열 수 없습니다</AlertTitle>
            <AlertDescription>
              <span className="font-mono text-xs break-all">{selected}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <PersonaDetail
            // 이름이 바뀌면 절 안의 지역 상태(저장 결과 · 실패 사유 · 제거 중)를 새로 시작한다.
            // **편집 상태는 여기 없다** — 위 `edits`에 있어서 이 재마운트가 아무것도 안 버린다
            key={current.name}
            projectId={projectId}
            row={current}
            edit={editOf(current)}
            onEdit={(next) => setEdits((prev) => ({ ...prev, [current.name]: next }))}
            // 지운 뒤에도 그 이름이 주소에 남으면 다음 렌더가 `이 경로는 열 수 없습니다`가 된다 —
            // 기본 선택(목록 첫 줄)으로 돌리는 것이 §5의 값이다. 주소도 같이 돌아간다.
            onDeleted={() => select(null)}
            color={colors[current.name]}
            installed={installed}
            onInstalled={setInstalled}
            configDir={configDir}
            engines={engines}
            modelPattern={modelPattern}
            engineHint={engineHint}
          />
        )}
      </div>
    </SidebarProvider>
  );
}

/** 오른쪽 칸 하나. `body: null`(프로필 없음)이면 빈 textarea가 열리고 **저장이 곧 생성**이다 —
 *  티켓이 부르는데 프로필이 없는 이름을 그 자리에서 채우게 하려고 경로를 하나로 둔다. */
function PersonaDetail({
  projectId,
  row,
  edit,
  onEdit,
  onDeleted,
  color,
  installed,
  onInstalled,
  configDir,
  engines,
  modelPattern,
  engineHint,
}: {
  projectId: string;
  row: PersonaRow;
  edit: PersonaEdit;
  onEdit: (next: PersonaEdit) => void;
  onDeleted: () => void;
  color?: string;
  installed: Skill[];
  /** 방금 이 머신에 스킬을 깐 뒤 서버가 돌려준 후보 목록 전체(§5-1 §import) — `PersonasPane`의
   *  상태를 갈아끼운다. 현재 페르소나뿐 아니라 모든 다이얼로그가 같은 값을 봐야 해서 여기서
   *  끝내지 않고 그대로 위로 흘려보낸다. */
  onInstalled: (installed: Skill[]) => void;
  configDir: string;
  engines: EngineCatalog;
  modelPattern: string;
  engineHint: string | null;
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
              onDeleted={onDeleted}
              onError={(message) => setHeadError({ title: "삭제하지 못했습니다", message })}
            />
          </span>
        )}
      </div>

      {headError && <Failure title={headError.title} message={headError.message} />}

      {/* §비주얼 §44 ① — 정책값 둘(상한·엔진)은 신원(머리)도 프롬프트 3절(PROFILE·스킬·메모리)도
          아니라 그 사이에 낀 절 하나다. 프롬프트 3절은 디스패치에 실리는 순서를 그대로 보이는데
          정책값은 한 바이트도 안 실려서, 그 연속 **앞**에 선다(뒤에 두면 textarea 16행 아래로
          내려가 스크롤 없이 안 보인다) */}
      <DispatchPolicySection
        projectId={projectId}
        name={row.name}
        limit={edit.limit}
        engine={edit.engine}
        engines={engines}
        modelPattern={modelPattern}
        engineHint={engineHint}
        onLimitSaved={(limit) => onEdit({ ...edit, limit })}
        onEngineSaved={(engine) => onEdit({ ...edit, engine })}
      />

      <MarkdownEditor
        name="body"
        defaultValue={edit.body}
        rows={16}
        className="font-mono"
        onChange={(body) => onEdit({ ...edit, body })}
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
        onInstalled={onInstalled}
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

// ── 디스패치 정책 — 상한 · 엔진 (DESIGN.md §비주얼 §44) ─────────────────────

/** §44 ①이 신설한 절. 스킬·메모리 절과 껍데기(`space-y-2 border-t pt-3`)가 글자 하나까지
 *  같다 — 머리에 버튼·자수가 없는 것만 다르다(값 둘이 각자 자기 트리거를 든다, §44 ②). */
function DispatchPolicySection({
  projectId,
  name,
  limit,
  engine,
  engines,
  modelPattern,
  engineHint,
  onLimitSaved,
  onEngineSaved,
}: {
  projectId: string;
  name: string;
  limit: number | null;
  engine: { engineId: string; model: string } | null;
  engines: EngineCatalog;
  modelPattern: string;
  /** §23 §개정 · §44 ④. 엔진이 지정 없음이고 워커가 1개 이상일 때만 그린다 — `engine`이 있으면
   *  트리거의 값이 곧 사실이라 힌트가 없다(§23 §개정 표). */
  engineHint: string | null;
  onLimitSaved: (limit: number | null) => void;
  onEngineSaved: (engine: { engineId: string; model: string } | null) => void;
}) {
  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">디스패치 정책</h3>
      </div>
      {/* `flex-wrap`이 좁은 폭 대응 전부다 — 각 필드가 `라벨 트리거` 한 덩어리라 쌍 안에서는
          안 갈라진다(§44 §좁은 폭 줄바꿈) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <LimitField projectId={projectId} name={name} limit={limit} onSaved={onLimitSaved} />
        <EngineField
          projectId={projectId}
          name={name}
          engine={engine}
          engines={engines}
          modelPattern={modelPattern}
          onSaved={onEngineSaved}
        />
      </div>
      {/* 컨트롤 행 **아래**, 절 안의 전폭 한 줄이다(§44 ④) — 트리거에 매달지 않는다. 상한에는
          이런 줄이 없다: 상한 없음은 위임이 아니라 값이다(§44 ② 어휘 표). */}
      {engine === null && engineHint && (
        <p className="text-xs text-muted-foreground">{engineHint}</p>
      )}
    </section>
  );
}

/** 값이 곧 트리거인 팝오버(§44 ③ — 엔진과 같은 저장 관용구로 통일). **비우면 파일을 지운다**
 *  (= 상한 없음), 판정은 서버가 한다(`type="number"`는 힌트일 뿐).
 *
 *  초안이 이 컴포넌트의 지역 상태인 것은 종전과 같다 — 다른 줄을 고르면 `PersonaDetail`이
 *  `key`로 다시 서서 파일의 값으로 돌아간다. 팝오버를 닫는 것(`Esc`·바깥 클릭)이 곧 취소다 —
 *  `취소` 버튼을 따로 두지 않는다(§44 ③ 닫기 행). */
function LimitField({
  projectId,
  name,
  limit,
  onSaved,
}: {
  projectId: string;
  name: string;
  /** 파일의 값(`null` = 상한 없음). 입력칸의 빈 문자열이 이 `null`과 같은 뜻이다 */
  limit: number | null;
  onSaved: (limit: number | null) => void;
}) {
  const saved = limit === null ? "" : String(limit);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = !pending && value.trim() !== saved;
  const labelId = `persona-limit-${name}-label`;
  const triggerId = `persona-limit-${name}-value`;

  const save = () =>
    start(async () => {
      const r = await savePersonaLimitAction(projectId, name, value);
      if (r.ok) {
        onSaved(r.limit ?? null);
        setValue(r.limit === null || r.limit === undefined ? "" : String(r.limit));
        setError(null);
        setOpen(false);
      } else {
        setError(r.message ?? "상한을 저장하지 못했습니다.");
      }
    });

  return (
    <span className="flex items-center gap-2">
      <span id={labelId} className="text-xs text-muted-foreground">
        상한
      </span>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // 닫는 것이 곧 취소다 — 저장 전에는 아무것도 안 썼다. 다시 열면 파일 값이다.
          if (!o) {
            setValue(saved);
            setError(null);
          }
        }}
      >
        <PopoverTrigger
          id={triggerId}
          aria-labelledby={`${labelId} ${triggerId}`}
          render={<Button variant="ghost" size="sm" className="font-normal" />}
        >
          {/* 값이 있으면 argv 토큰이라 mono, `없음`은 문장이라 sans(§44 ② 값 서체) */}
          <span className={limit !== null ? "font-mono text-xs" : undefined}>
            {limit === null ? "없음" : limit}
          </span>
          <ChevronDown aria-hidden className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start">
          <div className="space-y-2">
            <Label htmlFor={`limit-${name}`}>동시 워커 상한</Label>
            <Input
              id={`limit-${name}`}
              type="number"
              min={0}
              step={1}
              placeholder="없음"
              className="w-full font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">비우면 상한 없음 · 0이면 디스패치 정지</p>
          <p className="text-xs text-muted-foreground">다음 티켓 선정부터 적용됩니다.</p>
          {error && <Failure title="상한을 저장하지 못했습니다" message={error} />}
          {/* 상한에는 왼쪽 보조 버튼이 없다(§44 ③) — `저장`만 `ml-auto`로 오른쪽 끝 */}
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              className="ml-auto"
              aria-disabled={!ready}
              onClick={() => {
                if (ready) save();
              }}
            >
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

// ── 실행 엔진 (§제약 1 §결정 기록 §열한 번째 · §비주얼 §23 컨트롤 재사용) ───────

/** 서버가 **값으로** 내려주는 카탈로그 = `lib/workers.ts`의 `ENGINES` 그대로다. 그 모듈은
 *  `node:fs`를 물어 클라이언트가 import할 수 없고, 목록을 여기 다시 적으면 화면이 파일에
 *  안 들어가는 이름을 그리게 된다(두 벌은 반드시 갈린다). §23 ①이 워커 행에 쓰던 것과 같은
 *  카탈로그를 이 화면이 옮겨 받는다(대상만 워커 파일 → `personas/<이름>/engine`으로 갈린다). */
export type EngineCatalog = readonly { id: string; models: readonly string[] }[];

/** 고른 값. `모델 지정 안 함`은 **빈 문자열**이고(`NO_MODEL`) 라벨은 화면이 붙인다(§23 ③).
 *  `custom`이면 `model`은 사람이 친 글자다 — 목록 값과 같은 자리를 쓴다. `engine`이 빈 문자열이면
 *  **지정 없음**이다(엔진 Select가 비어 있는 채로 열린다 — §23 ③ 손으로 쓴 값과 같은 표현). */
type EnginePick = { engine: string; model: string; custom?: boolean };

/** 목록에 없는 **화면만의 항목**. 값이 곧 라벨이고 모델 이름과 겹칠 수 없다 — 서버의
 *  `MODEL_RE`가 한글도 `…`도 안 받는다. */
const CUSTOM = "직접 입력…";

/** 지금 값으로 만들 수 있는가. 직접 입력만 걸린다 — 빈 값(`+`가 0글자를 안 받는다)과 셸
 *  메타문자가 여기서 막힌다. **즉시 거절일 뿐이고** 진짜 검증은 서버가 다시 한다(§23 ④). */
const enginePickOk = (pick: EnginePick, modelPattern: string) =>
  !pick.custom || new RegExp(modelPattern).test(pick.model);

/** §23 ③의 엔진·모델 필드 한 쌍 — 워커 행 팝오버·생성 폼이 쓰던 것을 그대로 옮겼다. */
function EngineFields({
  engines,
  modelPattern,
  value,
  onChange,
  idPrefix,
}: {
  engines: EngineCatalog;
  /** 서버 `MODEL_RE.source`. 화면이 정규식을 따로 적지 않는다 */
  modelPattern: string;
  value: EnginePick;
  onChange: (v: EnginePick) => void;
  idPrefix: string;
}) {
  const models = engines.find((e) => e.id === value.engine)?.models ?? [];
  // 고른 엔진에 **없는** 기능들(§4-3 · §23 ⑤ 예고 줄). 판정도 이름도 `lib/urls.ts` 한 자리다.
  const missing = engineMissing(value.engine);
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
            {/* 비는 자리는 **지정 없음**이다 — 그 페르소나는 워커 자신의 엔진을 쓴다 */}
            <SelectValue placeholder="지정 없음" />
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

      {/* 예고 — 고장이 아니라 기능 집합이 다르다(§23 ⑤). 새 그릇을 만들지 않는다.
          **없는 기능을 세어서 문장을 만든다**(§4-3 개정): codex는 둘 다 없고 grok은 참견만
          없다 — `=== "codex"`로 적으면 grok에서 이 줄이 통째로 안 뜬다. */}
      {engines.some((e) => e.id === value.engine) && missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {value.engine} 워커는 {missing.join("과 ")}이 없습니다 — 티켓 수행은 같습니다.
        </p>
      )}
    </>
  );
}

/** 상한 옆 자리(§44 ① 컨트롤 행)의 값이 곧 팝오버 트리거다(§23 ② 그대로 재사용).
 *  **파일이 없으면 "지정 없음"이다** — §23 표시 4종의 `[기본값 가정]`과 같은 원칙(색 없음)이되,
 *  뜻은 다르다: 워커 행은 "그래도 claude가 돈다"지만 여기는 **그 워커 자신의 엔진이 이긴다**. */
function EngineField({
  projectId,
  name,
  engine,
  engines,
  modelPattern,
  onSaved,
}: {
  projectId: string;
  name: string;
  /** 파일의 값. `null` = 지정 없음 */
  engine: { engineId: string; model: string } | null;
  engines: EngineCatalog;
  modelPattern: string;
  onSaved: (engine: { engineId: string; model: string } | null) => void;
}) {
  const initial = (): EnginePick => ({ engine: engine?.engineId ?? "", model: engine?.model ?? "" });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<EnginePick>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = pick.engine !== "" && enginePickOk(pick, modelPattern) && !pending;
  const labelId = `persona-engine-${name}-label`;
  const triggerId = `persona-engine-${name}-value`;
  const display = engine ? (engine.model ? `${engine.engineId} · ${engine.model}` : engine.engineId) : "지정 없음";

  const save = (id: string | null, model: string) =>
    start(async () => {
      const r = await savePersonaEngineAction(projectId, name, id, model);
      if (r.ok) {
        onSaved(r.engine ?? null);
        setError(null);
        setOpen(false);
      } else {
        setError(r.message ?? "엔진을 저장하지 못했습니다.");
      }
    });

  return (
    <span className="flex items-center gap-2">
      <span id={labelId} className="text-xs text-muted-foreground">
        엔진
      </span>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // 닫는 것이 곧 취소다 — 저장 전에는 아무것도 안 썼다(§23 ②). 다시 열면 파일 값이다.
          if (!o) {
            setPick(initial());
            setError(null);
          }
        }}
      >
        <PopoverTrigger
          id={triggerId}
          aria-labelledby={`${labelId} ${triggerId}`}
          render={<Button variant="ghost" size="sm" className="font-normal" />}
        >
          {/* 값이 있으면 argv 토큰이라 mono, `지정 없음`은 문장이라 sans(§44 ② 값 서체) ·
              `title`이 잘린 전문 자리다(§44 ⑤ 텍스트 잘림 — 지금까지 이 값이 없었다) */}
          <span className={cn("max-w-[14rem] truncate", engine && "font-mono text-xs")} title={display}>
            {display}
          </span>
          <ChevronDown aria-hidden className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start">
          <EngineFields
            engines={engines}
            modelPattern={modelPattern}
            value={pick}
            onChange={setPick}
            idPrefix={`persona-engine-${name}`}
          />
          <p className="text-xs text-muted-foreground">다음 티켓 선정부터 적용됩니다.</p>
          {error && <Failure title="엔진을 저장하지 못했습니다" message={error} />}
          <div className="flex items-center justify-between gap-2">
            {engine && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => save(null, "")}
              >
                지정 해제
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto aria-disabled:opacity-50"
              aria-disabled={!ready}
              onClick={() => {
                if (ready) save(pick.engine, pick.model);
              }}
            >
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
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
  onInstalled,
  configDir,
  onSaved,
}: {
  projectId: string;
  name: string;
  skills: Skill[];
  chars: number;
  installed: Skill[];
  onInstalled: (installed: Skill[]) => void;
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
        <AddSkillsDialog
          current={skills}
          installed={installed}
          onInstalled={onInstalled}
          configDir={configDir}
          save={save}
        />
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
  onInstalled,
  configDir,
  save,
}: {
  current: Skill[];
  installed: Skill[];
  /** 방금 이 머신에 깐 스킬을 반영한 **후보 목록 전체**(§5-1 §import — 서버가 되읽어 돌려준 값
   *  그대로). `PersonasPane`까지 올라가 모든 다이얼로그가 같은 값을 본다. */
  onInstalled: (installed: Skill[]) => void;
  configDir: string;
  save: (picked: string[]) => Promise<PersonaResult>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // `저장` 실패와 import 실패가 그릇 하나를 나눠 쓴다(§비주얼 §25 ⑤ — 마지막에 누른 것 하나만
  // 선다). title·message가 각각 `AlertTitle`(sans)·`AlertDescription`(mono)이다.
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  // 두 입구 중 **누른 것 하나만** `설치 중…`이 된다(§비주얼 §25 ⑤ §진행 중) — `pending`(저장)과
  // 갈리는 상태라 따로 든다.
  const [installing, setInstalling] = useState<"file" | "folder" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /** 입구 둘의 공통 통로 — 서버가 받는 것은 `file` 여러 개 + 같은 순서의 `path` 여러 개다
   *  (§5-1 §import "입구 둘, 통로 하나"). 상한 둘은 **바이트를 읽기 전에** 화면이 먼저 거절한다 —
   *  `installSkill`과 같은 함수(`skillUploadError`)를 불러 같은 문장을 쓴다. */
  const runInstall = async (mode: "file" | "folder", items: { file: File; path: string }[]) => {
    const limitError = skillUploadError(
      items.length,
      items.reduce((n, it) => n + it.file.size, 0),
    );
    if (limitError) {
      setFailure(limitError);
      return;
    }
    setFailure(null);
    setInstalling(mode);
    const formData = new FormData();
    for (const it of items) {
      formData.append("file", it.file);
      formData.append("path", it.path);
    }
    // `installSkillAction`이 던질 수 있다(예: 본문 상한 관문이 먼저 자른 네트워크/파싱 예외) —
    // `try` 없이 두면 throw가 `setInstalling(null)`을 건너뛰어 다이얼로그가 사유 없이
    // "설치 중…"에 영구 고정된다(§비주얼 §25 ⑤ 위반, 실측 `ec687d52`).
    try {
      const r = await installSkillAction(formData);
      if (r.ok) {
        onInstalled(r.installed ?? []);
        // §비주얼 §25 ⑤ §성공 — 토스트가 없다. 검색칸에 방금 깐 이름을 채워 목록을 그 한 줄로 좁힌다.
        if (r.name) {
          const name = r.name;
          setPicked((prev) => (prev.includes(name) ? prev : [...prev, name]));
          setQuery(name);
        }
      } else {
        setFailure({ title: r.title ?? "스킬을 설치하지 못했습니다", message: r.message ?? "" });
      }
    } catch {
      setFailure({ title: "스킬을 설치하지 못했습니다", message: "" });
    } finally {
      setInstalling(null);
    }
  };

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
          setFailure(null);
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
                {/* §비주얼 §25 ⑤ — 후보 0개가 이 기능의 첫 독자다. 다음 행동은 바로 아래 44px의
                    입구 둘이다(경로를 다시 안 적는다 — 위 두 글롭이 이미 그 자리다) */}
                <p className="text-xs text-muted-foreground">
                  아래에서 파일을 골라 지금 설치할 수 있습니다
                </p>
              </div>
            )}
          </CommandList>
        </Command>

        {/* import 입구 둘 — `Command`와 실패·`DialogFooter` 사이의 한 행(§비주얼 §25 ⑤).
            숨긴 `<input type="file">` 둘 + 버튼 둘, `AttachmentButton`과 같은 조립
            (`display:none`은 focus가 안 먹지만 `.click()`은 먹는다 — `attachment-field.tsx`). */}
        <div className="flex items-center gap-2">
          <span className="min-w-0 text-xs text-muted-foreground">
            목록에 없으면 파일에서 설치합니다
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              // 같은 파일을 두 번 고르면 change가 안 뜬다 — 비워서 다음 선택이 항상 뜨게 한다.
              e.target.value = "";
              if (file) void runInstall("file", [{ file, path: "SKILL.md" }]);
            }}
          />
          {/* `webkitdirectory`는 React JSX 타입에 없다 — DOM 프로퍼티로 직접 건다(ref 콜백) */}
          <input
            ref={(el) => {
              folderInputRef.current = el;
              if (el) el.webkitdirectory = true;
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length === 0) return;
              // 폴더 모드는 상대경로의 첫 성분을 뗀다(§5-1 §import) — 사람이 고른 폴더 이름이고
              // 디렉터리 이름을 정하는 것은 `name:`이다.
              const folderName = files[0].webkitRelativePath.split("/")[0] ?? "";
              const withPaths = files.map((file) => {
                const rel = file.webkitRelativePath;
                const slash = rel.indexOf("/");
                return { file, path: slash === -1 ? rel : rel.slice(slash + 1) };
              });
              // 떼고 나서 SKILL.md가 없으면 거절한다(폴더 바로 아래여야 한다) — 원래 폴더 이름은
              // 화면만 알아서 서버에 못 보낸다(§비주얼 §25 ⑤ 표 «+»).
              if (!withPaths.some((w) => w.path === "SKILL.md")) {
                setFailure({
                  title: "고른 폴더 바로 아래에 SKILL.md가 없습니다",
                  message: `${folderName}/`,
                });
                return;
              }
              void runInstall("folder", withPaths);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={installing !== null}
            onClick={() => fileInputRef.current?.click()}
          >
            {installing === "file" ? "설치 중…" : "SKILL.md 한 장"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={installing !== null}
            onClick={() => folderInputRef.current?.click()}
          >
            {installing === "folder" ? "설치 중…" : "스킬 폴더"}
          </Button>
        </div>

        {/* 실패하면 다이얼로그가 열린 채로 남고 체크도 남는다 — 사유를 읽고 다시 누른다.
            `저장` 실패와 import 실패가 이 그릇 하나를 나눠 쓴다(마지막에 누른 것 하나만 선다) */}
        {failure && <Failure title={failure.title} message={failure.message} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            disabled={pending || installing !== null}
            onClick={() =>
              start(async () => {
                setFailure(null);
                const r = await save(picked);
                if (r.ok) setOpen(false);
                else setFailure({ title: "스킬을 저장하지 못했습니다", message: r.message ?? "" });
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
  onDeleted,
  onError,
}: {
  projectId: string;
  row: PersonaRow;
  onDeleted: () => void;
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
                if (r.ok) onDeleted();
                else onError(r.message ?? "삭제하지 못했습니다.");
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
