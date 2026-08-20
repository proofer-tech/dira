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
  createSquadAction,
  deletePersonaAction,
  deletePersonaMemoryAction,
  deleteSquadAction,
  installSkillAction,
  savePersonaAction,
  savePersonaEngineAction,
  savePersonaLimitAction,
  savePersonaSkillsAction,
  saveSquadMembersAction,
  saveSquadRulesAction,
  setPersonaColorAction,
  type PersonaResult,
} from "@/app/(app)/p/[project]/personas/actions";
import type { SquadMember } from "@/lib/projects";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { Vault } from "@/lib/markdown-wikilinks";
import { useT } from "@/components/language-provider";
import { wrap } from "@/lib/i18n";
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
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { budgetLabel, byteLength, MEMORY_MAX_BYTES, PERSONA_MAX_BYTES } from "@/lib/budgets";
import { skillUploadError } from "@/lib/skill-upload-limit";
import type { Memory, Skill } from "@/lib/skills";
import { decodeHash, engineMissing, PERSONA_COLORS, personaDotClass } from "@/lib/urls";
import { cn } from "@/lib/utils";

/** `engine` 사이드카가 읽어 낸 값 3종(`readPersonaEngine`과 같은 모양). `{ raw }`는 카탈로그와
 *  안 맞는 커스텀 인자다 — 사람이 손으로 얹은 꼬리를 "지정 없음"으로 뭉개지 않는다(`77ca2128`). */
export type PersonaEngineValue = { engineId: string; model: string } | { raw: string } | null;

/** 서버가 읽어 넘긴 한 항목. `body: null` = PROFILE.md가 없다(엔진의 WARN 케이스). */
export type PersonaRow = {
  name: string;
  file: string;
  body: string | null;
  refs: { open: number; wip: number; total: number };
  /** `skills.md`의 목록 줄(§5-1). 문법에 안 맞는 줄은 여기 없고 파일에는 그대로 있다 */
  skills: Skill[];
  /** `skills.md` **파일 전체** 바이트 수 — 왼쪽 목록 줄의 예산 합이 이걸 더한다(§비주얼 §25 ①,
   *  §프롬프트 층 결정 11) */
  skillsChars: number;
  /** `skills-off.md`의 목록 줄(§5-1 §n:m 배정과 비활성). 서버가 이미 활성과 겹치는 이름을 뺀
   *  값이다(§5-1 §충돌 — 활성이 이긴다). 바이트 수를 안 든다 — 이 파일은 인라인되지 않는다 */
  offSkills: Skill[];
  /** `memory/*.md` 한 단계 글롭. 세션이 쓰고 사람이 지운다(§5-2). **`text`가 파일 전체라
   *  바이트 수는 화면이 더한다** — `skillsChars`와 달리 프로필+스킬 예산 합에는 안 든다
   *  (§프롬프트 층 결정 11 (4) — 자기 예산을 따로 든다) */
  memories: Memory[];
  /** `limit` 사이드카의 정수(§5-4). `null` = 파일 없음·빈 파일·정수 아님 = **상한 없음**.
   *  예산 합에 안 더한다 — 이 파일은 프롬프트에 안 실린다(엔진이 디스패치 앞에서 읽는 정책값이다) */
  limit: number | null;
  /** `engine` 사이드카의 값(§제약 1 §결정 기록 §열한 번째). `null` = 파일 없음·모양이 다름 =
   *  **지정 없음**(그 페르소나는 워커 자신의 엔진을 쓴다). `limit`과 같은 이유로 예산 합에 안 더한다 */
  engine: PersonaEngineValue;
};

/** 서버가 읽어 넘긴 스쿼드 한 항목(DESIGN.md §5-5). 색·자수·스킬·메모리·상한이 **없다** —
 *  스쿼드는 후보 풀이지 프로필을 든 신원이 아니다. */
export type SquadRow = {
  name: string;
  /** `squads/<이름>/members` 한 줄에 하나. 저장된 값 그대로다 — **첫 항목이 리더다**(§5-5 §개정) */
  members: SquadMember[];
  /** `squads/<이름>/rules` 전문. 없으면 `""`(§5-5 §개정 — 리더 세션에만 실린다) */
  rules: string;
  /** 멤버 중 `personas/`에 `PROFILE.md`가 없는 이름이 있다(§5-5 §경고) */
  missingProfile: boolean;
};

/** 스쿼드 블록(§5-5 §개정 §스쿼드 블록 - §블록의 틀)의 바이트 수. tick.sh:736-788이 실제로
 *  조립하는 문구와 문자 그대로 맞춘다 - 머리/꼬리 `=====` 줄 + 멤버 줄 `<이름>[ (리더)] - <역할>`,
 *  잰 범위는 머리 `=====`의 첫 글자부터 꼬리 `=====`의 마지막 글자까지(감싼 개행은 안 센다). */
function squadBlockBytes(
  name: string,
  members: { name: string; role: string }[],
  t: (key: string) => string,
): number {
  const lines = [
    `===== ${wrap(t("persona.squad.blockNamePrefix"), name, "")} =====`,
    ...members.map(
      (m, i) => `${m.name}${i === 0 ? ` ${t("persona.squad.blockLeaderSuffix")}` : ""} - ${m.role}`,
    ),
    `===== ${t("persona.squad.blockNamePrefix")} ${t("persona.squad.blockEndSuffix")} =====`,
  ];
  return new TextEncoder().encode(lines.join("\n")).length;
}

const SQUAD_BLOCK_MAX_BYTES = 1_500;

/** 역할이 빈 멤버 줄의 자리표시 — 프로필 첫 줄(§5-5 §개정 "역할이 없는 줄"). 값이 아니다. */
function profileTitle(body: string | null): string {
  return body ? body.split("\n")[0] : "";
}

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
function refsLabel(refs: PersonaRow["refs"], t: (key: string) => string): string | null {
  const parts = [
    refs.open > 0 && wrap(t("persona.refs.openPrefix"), String(refs.open), ""),
    refs.wip > 0 && wrap(t("status.label.wip"), String(refs.wip), ""),
    refs.total - refs.open - refs.wip > 0 &&
      wrap(t("status.label.done"), String(refs.total - refs.open - refs.wip), ""),
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(color);
  const [, start] = useTransition();

  const pick = (next: string | null) =>
    start(async () => {
      setCurrent(next ?? undefined);
      setOpen(false);
      const r = await setPersonaColorAction(projectId, name, next);
      onError(r.ok ? null : (r.message ?? t("persona.color.saveFailedMessage")));
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
        <span className="sr-only">
          {current ? wrap(t("persona.color.labelPrefix"), current, "") : t("persona.color.none")}
        </span>
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
            aria-label={t("persona.color.none")}
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

type CreateKind = "persona" | "squad";

/** 이름 규칙은 **서버가** 판정한다(`tickets.py PERSONA_RE`와 같은 규칙). 여기서 미리 막지 않는
 *  이유: 클라이언트 검증은 검증이 아니고, 규칙이 두 군데 있으면 갈린다. 대신 사유를 그 자리에 띄운다.
 *
 *  **만들기 입구는 하나다**(§5-5 §화면) — 종류 칸(`페르소나`/`스쿼드`) 하나가 늘었을 뿐, 다이얼로그도
 *  트리거도 이 하나뿐이다. 이름이 페르소나·스쿼드 한 이름공간이라 겹치면 서버가 거부한다. */
export function CreatePersonaButton({
  projectId,
  variant,
}: {
  projectId: string;
  variant?: "default" | "outline";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CreateKind>("persona");
  const [name, setName] = useState("");
  const [result, setResult] = useState<PersonaResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setKind("persona");
          setName("");
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={variant} />}>{t("common.create")}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {kind === "persona" ? t("persona.create.personaTitle") : t("persona.create.squadTitle")}
          </DialogTitle>
          <DialogDescription>
            {kind === "persona" ? (
              <>
                {t("persona.create.personaDescPrefix")} <span className="font-mono text-xs">persona:</span>{" "}
                {t("persona.create.personaDescSuffix")}
              </>
            ) : (
              <>
                {t("persona.create.squadDescPrefix")}{" "}
                <span className="font-mono text-xs">squad:</span> {t("persona.create.squadDescSuffix")}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="create-kind">{t("persona.create.kindLabel")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as CreateKind)}>
            <SelectTrigger id="create-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="persona">{t("shell.nav.personas")}</SelectItem>
              <SelectItem value="squad">{t("persona.word.squad")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="persona-name">{t("persona.create.nameLabel")}</Label>
          <Input
            id="persona-name"
            className="font-mono"
            placeholder={kind === "persona" ? "developer" : "frontend"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("persona.create.nameHintPrefix")}{" "}
            {kind === "persona"
              ? t("persona.create.nameHintPersonaFile")
              : t("persona.create.nameHintSquadFile")}
            {t("persona.create.nameHintSuffix")}
          </p>
          {result?.message && (
            <Failure
              title={kind === "persona" ? t("persona.create.personaFailTitle") : t("persona.create.squadFailTitle")}
              message={result.message}
            />
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const r =
                  kind === "persona"
                    ? await createPersonaAction(projectId, name)
                    : await createSquadAction(projectId, name);
                setResult(r);
                if (r.ok) setOpen(false);
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
  /** `skills-off.md` — 서버가 되읽어 준 값(§비주얼 §25 ⑥) */
  offSkills: Skill[];
  memories: Memory[];
  /** **저장된 값이다** — 입력칸의 초안이 아니다(초안은 오른쪽 머리가 든다). 왼쪽 줄의
   *  `상한 n`이 이걸 그리므로 저장 직후에 여기까지 올라와야 목록이 파일과 같아진다 */
  limit: number | null;
  /** **저장된 값이다** — 팝오버의 초안은 `EngineField`가 지역 상태로 든다(상한과 같은 벌) */
  engine: PersonaEngineValue;
};

/** 서버가 방금 준 값 그대로. 아직 손대지 않은 페르소나는 이걸 읽으므로 **다른 세션이 파일을
 *  고치면 목록이 따라간다** — 오버레이에 들어가는 것은 사람이 만진 이름뿐이다. */
const initialEdit = (row: PersonaRow): PersonaEdit => ({
  saved: row.body,
  body: row.body ?? "",
  skills: row.skills,
  skillsChars: row.skillsChars,
  offSkills: row.offSkills,
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

/** 프로필+스킬 합 바이트 — `PERSONA_MAX_BYTES`와 비교되는 값이다(§프롬프트 층 결정 11 (4)).
 *  메모리는 안 든다 — 프롬프트에 안 실려 이 상한과 무관하고, 자기 예산(`MEMORY_MAX_BYTES`)을
 *  `MemorySection` 머리가 따로 든다. */
const editBytes = (e: PersonaEdit) => byteLength(e.body) + e.skillsChars;

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
/** 스쿼드 오른쪽 칸의 편집 상태 — 페르소나의 `PersonaEdit`과 같은 이유로 `PersonasPane`이
 *  든다(§5-5 §화면 "미저장 멤버 변경도 다른 줄을 고르는 동안 살아 있다" = §5 그대로). */
type SquadEdit = {
  /** 파일에 저장된 값(서버가 되읽어 준 것) */
  saved: { members: SquadMember[]; rules: string };
  /** 체크한 이름들의 초안. 순서는 저장이 다시 정하므로(화면 목록 순서 = 리더를 정하는 순서,
   *  §5-5 §개정) 여기서는 뜻이 없다 */
  picked: string[];
  /** 이름별 역할 초안. 프로필이 없어진(orphan) 멤버의 역할도 여기 남아 있어야 저장 때 잃지
   *  않는다 — `initialSquadEdit`이 저장된 멤버 전원의 역할로 채운다 */
  roles: Record<string, string>;
  /** `rules` 초안 */
  rules: string;
};

const initialSquadEdit = (row: SquadRow): SquadEdit => ({
  saved: { members: row.members, rules: row.rules },
  picked: row.members.map((m) => m.name),
  roles: Object.fromEntries(row.members.map((m) => [m.name, m.role])),
  rules: row.rules,
});

/** 순서 없이 이름+역할 집합으로 비교한다 — 멤버 순서는 사람이 정하는 값이 아니다(§5-5 §안 하는 것,
 *  화면 목록 고정 순서가 정한다). */
const sameSquadMembers = (a: SquadMember[], b: SquadMember[]) => {
  if (a.length !== b.length) return false;
  const sb = new Map(b.map((m) => [m.name, m.role]));
  return a.every((m) => sb.get(m.name) === m.role);
};

/** 지금 칸에서 픽·역할 초안이 실제로 갈렸나(§5-5 §화면 "저장 안 됨") — 순서는 안 본다(위와 같은
 *  이유), `rules`는 따로 비교한다. */
const squadDirty = (edit: SquadEdit): boolean =>
  !sameSquadMembers(
    edit.picked.map((name) => ({ name, role: (edit.roles[name] ?? "").trim() })),
    edit.saved.members,
  ) || edit.rules !== edit.saved.rules;

export function PersonasPane({
  projectId,
  initial,
  rows,
  squads,
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
  /** `rows`와 `squads` 중 **하나는 1개 이상**이다 — 둘 다 0개면 호출부가 `<EmptyState>`로
   *  갈라 2단을 안 그린다(§비주얼 §61 (8)). `rows`만 0개면 스쿼드가 기본 선택으로 뜬다. */
  rows: PersonaRow[];
  /** 스쿼드 그룹(§5-5) — 0개면 그 그룹을 안 그린다. 페르소나와 이름공간을 공유하므로 선택은
   *  여전히 세그먼트 하나다 */
  squads: SquadRow[];
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
  const t = useT();
  const [selected, setSelected] = useState<string | null>(initial);
  const [edits, setEdits] = useState<Record<string, PersonaEdit>>({});
  const [squadEdits, setSquadEdits] = useState<Record<string, SquadEdit>>({});
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
  // 스쿼드는 페르소나와 한 이름공간이라(§5-5) `selected`가 겹치는 일이 없다 — `current`가
  // 없을 때만 스쿼드 목록에서 찾는다. §비주얼 §61 (8) — 기본 선택(`selected === null`)이
  // 페르소나 0개(= `current`가 애초에 없음)라도 스쿼드 첫 줄로 떨어진다(`rows[0] ?? squads[0]`와
  // 같은 값이다 — `current`가 `PersonaRow`뿐이라 나머지는 이 분기가 대신 진다).
  const currentSquad =
    current === undefined ? (selected === null ? squads[0] : squads.find((s) => s.name === selected)) : undefined;
  const squadEditOf = (row: SquadRow) => squadEdits[row.name] ?? initialSquadEdit(row);

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
            **그룹 둘이다**(§5-5) — `페르소나`와 `스쿼드`. `gap-4`가 그룹 사이 간격이다
            (`home-ui.tsx`의 두 그룹과 같은 조립). */}
        <SidebarContent className="gap-4 py-2">
          <SidebarGroup className="p-0">
            {/* 머리 낱말이 새로 생겼다(§5-5 — 그룹이 둘이 되면서). `h-6`은 `home-ui.tsx`의
                좌측 패널 그룹 머리와 같은 눈금이다. §비주얼 §61 (2) — 그룹이 둘일 때만 선다:
                스쿼드 0개면 이 머리도 안 그린다(24px 위 `<h1>페르소나`와 같은 낱말의 반복이라). */}
            {squads.length > 0 && (
              <SidebarGroupLabel className="h-6 text-muted-foreground">
                {t("shell.nav.personas")}
              </SidebarGroupLabel>
            )}
            {/* 줄 사이 간격이 0.5(2px)였던 자리를 `SidebarMenu`의 `gap-0.5`가 든다(§34 판정표) */}
            <SidebarMenu aria-label={t("shell.nav.personas")} className="gap-0.5">
              {rows.map((row) => {
                const e = editOf(row);
                const refs = refsLabel(row.refs, t);
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
                              {t("persona.badge.noProfile")}
                            </Badge>
                          )}
                          {/* 저장 버튼이 오른쪽에 있다 — 다른 줄을 고른 채 잊으면 이게 유일한 표시다(§5) */}
                          {e.body !== (e.saved ?? "") && (
                            <Badge variant="outline" className="ml-auto self-center">
                              {t("persona.badge.unsaved")}
                            </Badge>
                          )}
                        </span>
                        <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate" title={row.file}>
                            {refs ? wrap(t("persona.refs.ticketPrefix"), refs, "") : t("persona.refs.none")}
                          </span>
                          {/* `티켓 n` 뒤 · 자수 앞 — "무엇을 참조하나 → 무엇을 쓰나 → 얼마나 먹나"다
                              (§비주얼 §25 ①). 0개면 안 그린다: 고정폭 메타라 빠져도 줄이 안 흔들린다 */}
                          {e.skills.length > 0 && (
                            <span className="whitespace-nowrap">
                              {t("persona.word.skills")} {e.skills.length}
                            </span>
                          )}
                          {/* `스킬 n` 뒤 · `자수` 앞이다(§비주얼 §32 ①) — "무엇을 참조하나 → 무엇을 쓰나 →
                              **무엇을 배웠나** → 얼마나 먹나". `장`을 안 붙인다: 앞 둘과 같은 종류의 값이다 */}
                          {e.memories.length > 0 && (
                            <span className="whitespace-nowrap">
                              {t("persona.word.memory")} {e.memories.length}
                            </span>
                          )}
                          {/* `메모리 n` 뒤 · `자수` 앞이다(§5-4 §화면) — 앞의 셋이 *무엇이 실리나*고
                              이건 정책값이라 실리는 것들 뒤에 선다. **파일이 없으면 아무것도 안
                              그린다**: 빈 값이 기본이라 `상한 없음`을 쓸 자리가 아니다.
                              **`상한 n / 지금 m`을 안 그린다** — 지금 도는 수는 보드가 준다(§5-4) */}
                          {e.limit !== null && (
                            <span className="whitespace-nowrap">
                              {t("persona.word.limit")} {e.limit}
                            </span>
                          )}
                          {/* 프로필 본문은 **모든 디스패치 프롬프트에 인라인된다** — 길이가 곧 비용이다(§5).
                              목록에 둬야 "누가 프롬프트를 얼마나 먹는가"를 비교할 수 있다. `skills.md`도
                              디스패치마다 인라인되지만 `memory/*.md`는 `9d7ba932` 뒤로 프롬프트에 안
                              실린다 — 그래서 이 합에 메모리는 안 든다(§프롬프트 층 결정 11 (4)).
                              `PERSONA_MAX_BYTES`(5,000B)와 비교되는 것도 이 합뿐이다 */}
                          <span className="ml-auto font-mono whitespace-nowrap">
                            {budgetLabel(editBytes(e), PERSONA_MAX_BYTES)}
                          </span>
                        </span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>

          {/* 스쿼드 그룹(§5-5 §화면) — **0개면 그리지 않는다**. 색 점·자수·스킬·메모리·상한
              전부 스쿼드에 없는 값이라 줄이 한 줄로 끝난다(§5-5 §화면 표). */}
          {squads.length > 0 && (
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="h-6 text-muted-foreground">
                {t("persona.word.squad")}
              </SidebarGroupLabel>
              <SidebarMenu aria-label={t("persona.word.squad")} className="gap-0.5">
                {squads.map((squad) => {
                  const active = squad.name === currentSquad?.name;
                  // §5-5 §화면 "기본 선택 - 동시 선택 - 편집 보존 - 저장 안 됨: §5 그대로" —
                  // 스쿼드 칸의 미저장 멤버 변경도 페르소나와 같은 표식을 왼쪽 줄에 남긴다.
                  const dirty = squadDirty(squadEditOf(squad));
                  return (
                    <SidebarMenuItem key={squad.name}>
                      <SidebarMenuButton
                        type="button"
                        className="cursor-pointer"
                        isActive={active}
                        aria-current={active ? "true" : undefined}
                        onClick={() => select(squad.name)}
                      >
                        <span className="flex min-w-0 grow items-baseline gap-2">
                          <span className="min-w-0 truncate font-mono text-sm" title={squad.name}>
                            {squad.name}
                          </span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {t("persona.word.members")} {squad.members.length}
                          </span>
                          {/* §5-5 §프로필-스쿼드가 없는 것은 경고다 — 배지 문구는 designer 몫이다(§5-5
                              §모양-자리-라벨). 페르소나의 `프로필 없음`과 뜻이 갈리므로 같은 문구를
                              그대로 재사용하지 않는다. */}
                          {squad.missingProfile && (
                            <Badge variant="outline" className="self-center">
                              {t("persona.badge.squadNoProfile")}
                            </Badge>
                          )}
                          {dirty && (
                            <Badge variant="outline" className="ml-auto self-center">
                              {t("persona.badge.unsaved")}
                            </Badge>
                          )}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>

      <div className="min-w-0 grow">
        {currentSquad !== undefined ? (
          <SquadDetail
            key={currentSquad.name}
            projectId={projectId}
            row={currentSquad}
            personas={rows}
            edit={squadEditOf(currentSquad)}
            onEdit={(next) => setSquadEdits((prev) => ({ ...prev, [currentSquad.name]: next }))}
            onDeleted={() => select(null)}
          />
        ) : current === undefined ? (
          // **404가 아니다** — 왼쪽 목록은 계속 선다(§5). 그릇은 §6 프로토콜의 `?core=` 거부와
          // 같은 것 그대로다: 새 컴포넌트도 새 문구도 0이다.
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>{t("persona.route.notFound")}</AlertTitle>
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
  const t = useT();
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
            setHeadError(message ? { title: t("persona.color.saveFailedTitle"), message } : null)
          }
        />
        <span className="font-mono text-sm break-all">{row.name}</span>
        {edit.saved !== null && (
          <span className="ml-auto">
            <DeleteButton
              projectId={projectId}
              row={row}
              onDeleted={onDeleted}
              onError={(message) => setHeadError({ title: t("persona.action.deleteFailedTitle"), message })}
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
      {result && !result.ok && (
        <Failure title={t("persona.action.saveFailedTitle")} message={result.message ?? ""} />
      )}
      {/* 오른쪽 정렬, 1차 액션이 가장 오른쪽 — 결과 문구는 버튼 왼쪽이다(§비주얼 §4-3) */}
      <div className="flex items-center justify-end gap-4">
        {result?.ok && !dirty && (
          <span className="text-sm text-muted-foreground">{t("persona.action.savedNotice")}</span>
        )}
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
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>

      {/* 스킬 절(§비주얼 §25 ②). 값이 한 줄도 안 바뀐다 — 카드에서 오른쪽 칸으로 따라왔을 뿐이다 */}
      <SkillsSection
        projectId={projectId}
        name={row.name}
        skills={edit.skills}
        chars={edit.skillsChars}
        offSkills={edit.offSkills}
        installed={installed}
        onInstalled={onInstalled}
        configDir={configDir}
        onSaved={(skills, skillsChars, offSkills) =>
          onEdit({ ...edit, skills, skillsChars, offSkills })
        }
      />

      {/* 메모리 절(§비주얼 §32 ②) — 스킬 절 **바로 뒤**다. 화면이 주입 순서를 그대로 보인다
          (PROFILE → 스킬 → 메모리). 0장이어도 그린다: `삭제`가 사는 자리를 사람이 배우는
          화면이 여기뿐이고, 오늘 이 큐의 카드가 전부 0장이다 */}
      <MemorySection
        projectId={projectId}
        name={row.name}
        dir={row.file.replace(/\/PROFILE\.md$/, "")}
        memories={edit.memories}
        chars={edit.memories.reduce((n, m) => n + byteLength(m.text), 0)}
        onDeleted={(file) =>
          onEdit({ ...edit, memories: edit.memories.filter((m) => m.file !== file) })
        }
      />
    </div>
  );
}

// ── 스쿼드 상세 (DESIGN.md §5-5 §화면) ───────────────────────────────────────

/** 오른쪽 칸 — 스쿼드일 때는 `멤버` 절 하나 + `삭제`만 선다. textarea도 `디스패치 정책`도
 *  스킬·메모리 절도 없다(§5-5 §화면 표) — 스쿼드는 프로필을 든 신원이 아니라 후보 풀이다.
 *  머리에 색 점이 없는 이유도 같다: 색은 페르소나의 신원 표식이다(§12). */
function SquadDetail({
  projectId,
  row,
  personas,
  edit,
  onEdit,
  onDeleted,
}: {
  projectId: string;
  row: SquadRow;
  /** 체크리스트가 고르는 후보 — `body !== null`인 것만 선택 가능하다(§5-5 §화면 "PROFILE.md가
   *  있는 것") */
  personas: PersonaRow[];
  edit: SquadEdit;
  onEdit: (next: SquadEdit) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [membersResult, setMembersResult] = useState<PersonaResult | null>(null);
  const [rulesResult, setRulesResult] = useState<PersonaResult | null>(null);
  const [headError, setHeadError] = useState<string | null>(null);
  const [membersPending, startMembers] = useTransition();
  const [rulesPending, startRules] = useTransition();

  const eligible = personas.filter((p) => p.body !== null).map((p) => p.name);
  const profileOf = (name: string) => personas.find((p) => p.name === name)?.body ?? null;
  // 저장된 멤버 중 지금은 고를 수 없는 이름(프로필이 없어졌다) — 체크리스트에 없으니 잃지
  // 않으려면 따로 보여주고 `제거`로만 뗀다(스킬 절 orphans와 같은 처리, §비주얼 §25).
  const orphans = edit.picked.filter((m) => !eligible.includes(m));
  // 저장 순서 = 화면 목록 순서다(§5-5 §안 하는 것) — **첫 항목이 리더다**(§5-5 §개정). orphans는
  // 화면에 자리가 없어 뒤에 그대로 붙는다.
  const orderedMembers: SquadMember[] = [...eligible.filter((n) => edit.picked.includes(n)), ...orphans].map(
    (name) => ({ name, role: (edit.roles[name] ?? "").trim() }),
  );
  const leaderName = orderedMembers[0]?.name;
  const blockBytes = squadBlockBytes(
    row.name,
    orderedMembers.map((m) => ({ name: m.name, role: m.role || profileTitle(profileOf(m.name)) })),
    t,
  );
  const overBudget = blockBytes > SQUAD_BLOCK_MAX_BYTES;
  const rulesBytes = new TextEncoder().encode(edit.rules).length;
  // 절이 둘(멤버 - 규칙)이라 저장도 둘이다(§비주얼 §61 (15) 4행) — 왼쪽 줄의 `저장 안 됨`은
  // 여전히 `squadDirty` 하나로 합쳐 본다(그 배지는 절이 아니라 줄의 값이다).
  const membersDirty = !sameSquadMembers(
    edit.picked.map((name) => ({ name, role: (edit.roles[name] ?? "").trim() })),
    edit.saved.members,
  );
  const rulesDirty = edit.rules !== edit.saved.rules;

  const toggle = (name: string) =>
    onEdit({
      ...edit,
      picked: edit.picked.includes(name)
        ? edit.picked.filter((x) => x !== name)
        : [...edit.picked, name],
    });

  const setRole = (name: string, role: string) => onEdit({ ...edit, roles: { ...edit.roles, [name]: role } });

  return (
    <div className="space-y-3">
      {/* 머리 — 이름 · `삭제`(§5-5 §화면). 색 점이 없다: 스쿼드는 신원이 아니다 */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm break-all">{row.name}</span>
        <span className="ml-auto">
          <DeleteSquadButton
            projectId={projectId}
            row={row}
            onDeleted={onDeleted}
            onError={setHeadError}
          />
        </span>
      </div>

      {headError && <Failure title={t("persona.action.deleteFailedTitle")} message={headError} />}

      {/* `rules` — 사이드카 둘째(§5-5 §개정). 리더 세션 프롬프트에만 실린다, 없어도 된다.
          모양은 §비주얼 §61 (12)가 정한다 — `Textarea` 한 면이다: `rules`는 md가 아니고
          (파서 없음), 렌더되는 자리가 앱에 0개다(유일한 독자가 리더 세션의 프롬프트다). */}
      <section className="space-y-2 border-t pt-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {t("persona.squad.rulesHeading")}
          {/* 규칙 배지 — §61 (13). 상한이 없다: §5-5 §개정이 안 줬고 이 절이 발명하지 않는다 */}
          <Badge
            variant="secondary"
            className="ml-auto font-mono font-normal"
            title={t("persona.squad.rulesBadgeTitle")}
          >
            {t("persona.squad.rulesBadgePrefix")} {rulesBytes.toLocaleString()} B
          </Badge>
        </h3>
        <Textarea
          aria-label={t("persona.squad.rulesHeading")}
          className="font-mono"
          value={edit.rules}
          onChange={(e) => onEdit({ ...edit, rules: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t("persona.squad.rulesHint")}</p>
        {rulesResult && !rulesResult.ok && (
          <Failure title={t("persona.action.saveFailedTitle")} message={rulesResult.message ?? ""} />
        )}
        <div className="flex items-center justify-end gap-4">
          {rulesResult?.ok && !rulesDirty && (
            <span className="text-sm text-muted-foreground">{t("persona.action.savedNotice")}</span>
          )}
          <Button
            size="sm"
            disabled={rulesPending || !rulesDirty}
            onClick={() =>
              startRules(async () => {
                const r = await saveSquadRulesAction(projectId, row.name, edit.rules);
                setRulesResult(r);
                if (r.ok) onEdit({ ...edit, saved: { ...edit.saved, rules: edit.rules } });
              })
            }
          >
            {rulesPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </section>

      {/* 본문은 `멤버` 절이다(§5-5 §화면) — textarea·디스패치 정책·스킬·메모리 절이 없다 */}
      <section className="space-y-2 border-t pt-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {t("persona.squad.membersHeading")}
          {/* 스쿼드 블록 상한(§5-5 §개정 · §6 결정 7 넷째 자리) — 집행 자리는 이 화면이다.
              넘어도 색은 안 갈아 끼운다(§61 (13)) — 넘은 것 자체는 위반이 아니고, 저장 자체를
              막지도 않는다. 낱말 `초과`만 는다 */}
          <Badge
            variant="secondary"
            className="ml-auto font-mono font-normal"
            title={t("persona.squad.membersBadgeTitle")}
          >
            {t("persona.squad.membersBadgePrefix")} {blockBytes.toLocaleString()} /{" "}
            {SQUAD_BLOCK_MAX_BYTES.toLocaleString()} B
            {overBudget && ` ${t("persona.squad.overBudgetSuffix")}`}
          </Badge>
        </h3>
        {eligible.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("persona.squad.noEligible")}</p>
        ) : (
          <ul className="space-y-1">
            {eligible.map((name) => {
              const picked = edit.picked.includes(name);
              return (
                <li key={name} className="flex h-8 items-center gap-2">
                  {/* §비주얼 §61 (3) — 네이티브 체크박스. `<button>`+`Check` 아이콘은 체크
                      상태가 낭독에 안 실린다. `리더` 배지는 `label` 밖이라 접근명이 `<이름>`
                      하나로 남는다((14) §리더 §낭독). */}
                  <label className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={picked}
                      onChange={() => toggle(name)}
                    />
                    <span className="font-mono text-xs">{name}</span>
                  </label>
                  {/* 리더 표식 — §61 (14) §리더. 체크 묶음 밖: 색 0 · 아이콘 0, 낱말 하나뿐이다 */}
                  {picked && name === leaderName && (
                    <Badge variant="outline" className="h-5 shrink-0 px-2 text-xs">
                      {t("persona.squad.leaderBadge")}
                    </Badge>
                  )}
                  {/* 역할 칸(§5-5 §개정 · §61 (14)) — 체크된 줄만 편집한다. 빈 값은 프로필 첫 줄이
                      placeholder로 보일 뿐 저장되는 값이 아니다("역할이 없는 줄"). 이름은 식별자라
                      mono, 역할은 문장이라 sans */}
                  {picked && (
                    <Input
                      value={edit.roles[name] ?? ""}
                      onChange={(e) => setRole(name, e.target.value)}
                      placeholder={profileTitle(profileOf(name))}
                      className="min-w-0 grow text-xs md:text-xs"
                      aria-label={`${name}${t("persona.squad.roleAriaSuffix")}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("persona.squad.roleHint")}</p>

        {orphans.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("persona.squad.orphansHeading")}</p>
            <ul className="space-y-1">
              {orphans.map((name) => (
                <li key={name} className="flex items-center gap-2 px-2">
                  <code className="font-mono text-xs text-muted-foreground">{name}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => onEdit({ ...edit, picked: edit.picked.filter((x) => x !== name) })}
                  >
                    {t("persona.action.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {membersResult && !membersResult.ok && (
          <Failure title={t("persona.action.saveFailedTitle")} message={membersResult.message ?? ""} />
        )}
        <div className="flex items-center justify-end gap-4">
          {membersResult?.ok && !membersDirty && (
            <span className="text-sm text-muted-foreground">{t("persona.action.savedNotice")}</span>
          )}
          <Button
            size="sm"
            disabled={membersPending || !membersDirty}
            onClick={() =>
              startMembers(async () => {
                const r = await saveSquadMembersAction(projectId, row.name, orderedMembers);
                setMembersResult(r);
                if (r.ok) onEdit({ ...edit, saved: { ...edit.saved, members: orderedMembers } });
              })
            }
          >
            {membersPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** 되돌릴 수 없다. §5 페르소나 `삭제`와 같은 벌이지만 참조 티켓 경고가 없다 — `squad:`를 읽는
 *  엔진이 아직 없다(§5-5 §크기 — 엔진 승인 왕복은 별도 티켓이라 셀 값이 없다). */
function DeleteSquadButton({
  projectId,
  row,
  onDeleted,
  onError,
}: {
  projectId: string;
  row: SquadRow;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Trash2 aria-hidden />
            {t("persona.action.delete")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("persona.squadDelete.titlePrefix")} {row.name}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">squads/{row.name}</span>{" "}
            {t("persona.squadDelete.bodyMiddle")}{" "}
            <span className="font-mono text-xs">squad:</span> {t("persona.squadDelete.bodyAfter")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteSquadAction(projectId, row.name);
                if (r.ok) onDeleted();
                else onError(r.message ?? t("persona.action.deleteFailedMessage"));
              })
            }
          >
            {t("persona.action.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  engine: PersonaEngineValue;
  engines: EngineCatalog;
  modelPattern: string;
  /** §23 §개정 · §44 ④. 엔진이 지정 없음이고 워커가 1개 이상일 때만 그린다 — `engine`이 있으면
   *  트리거의 값이 곧 사실이라 힌트가 없다(§23 §개정 표). */
  engineHint: string | null;
  onLimitSaved: (limit: number | null) => void;
  onEngineSaved: (engine: { engineId: string; model: string } | null) => void;
}) {
  const t = useT();
  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">{t("persona.policy.heading")}</h3>
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
  const t = useT();
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
        setError(r.message ?? t("persona.limit.saveFailed"));
      }
    });

  return (
    <span className="flex items-center gap-2">
      <span id={labelId} className="text-xs text-muted-foreground">
        {t("persona.word.limit")}
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
            {limit === null ? t("persona.limit.none") : limit}
          </span>
          <ChevronDown aria-hidden className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start">
          <div className="space-y-2">
            <Label htmlFor={`limit-${name}`}>{t("persona.limit.popoverLabel")}</Label>
            <Input
              id={`limit-${name}`}
              type="number"
              min={0}
              step={1}
              placeholder={t("persona.limit.none")}
              className="w-full font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("persona.limit.popoverHint")}</p>
          <p className="text-xs text-muted-foreground">{t("persona.policy.nextTicketHint")}</p>
          {error && <Failure title={t("persona.limit.saveFailedTitle")} message={error} />}
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
              {pending ? t("common.saving") : t("common.save")}
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
  const t = useT();
  // 목록에 없는 **화면만의 항목**. 값이 곧 라벨이고 모델 이름과 겹칠 수 없다 — 서버의
  // `MODEL_RE`가 한글도 `…`도 안 받는다. 컴포넌트 안에 두는 이유: 로케일이 바뀌면 라벨도
  // 바뀌어야 하는데, 비교 판정(`String(v) === CUSTOM`)과 표시가 같은 렌더 안에서 같은 값을
  // 봐야 한다 — 저장되는 상태는 `custom: true` 플래그뿐이라 이 문자열 자체는 안 남는다.
  const CUSTOM = t("persona.engine.customOption");
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
        <Label htmlFor={`${idPrefix}-engine`}>{t("persona.engine.label")}</Label>
        {/* 엔진을 바꾸면 모델은 `모델 지정 안 함`으로 돌아간다 — 목록이 엔진에 딸려 있어서
            `opus`를 든 채 codex로 넘어가면 화면이 없는 조합을 보여준다(§23 ③). */}
        <Select value={value.engine} onValueChange={(v) => onChange({ engine: String(v), model: "" })}>
          <SelectTrigger id={`${idPrefix}-engine`} className="w-full font-mono">
            {/* 비는 자리는 **지정 없음**이다 — 그 페르소나는 워커 자신의 엔진을 쓴다 */}
            <SelectValue placeholder={t("persona.engine.unset")} />
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
        <Label htmlFor={`${idPrefix}-model`}>{t("persona.engine.modelLabel")}</Label>
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
            <SelectValue>{(v) => (v ? String(v) : t("persona.engine.noModel"))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m} className={m ? "font-mono" : undefined}>
                {m || t("persona.engine.noModel")}
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
              aria-label={t("persona.engine.customModelAriaLabel")}
              aria-describedby={hintId}
              className="font-mono"
              placeholder={t("persona.engine.modelNamePlaceholder")}
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
                {t("persona.engine.modelBadHint")}
              </p>
            ) : (
              <p id={hintId} className="text-xs text-muted-foreground">
                {t("persona.engine.modelPassthroughHint")}
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
          {value.engine} {t("persona.engine.missingMiddle")} {missing.join(t("persona.engine.missingJoiner"))}
          {t("persona.engine.missingSuffix")}
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
  /** 파일의 값. `null` = 지정 없음, `{ raw }` = 카탈로그와 안 맞는 커스텀 인자(`77ca2128`) */
  engine: PersonaEngineValue;
  engines: EngineCatalog;
  modelPattern: string;
  onSaved: (engine: { engineId: string; model: string } | null) => void;
}) {
  const t = useT();
  const catalog = engine && "engineId" in engine ? engine : null;
  const custom = engine && "raw" in engine ? engine.raw : null;
  const initial = (): EnginePick => ({ engine: catalog?.engineId ?? "", model: catalog?.model ?? "" });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<EnginePick>(initial);
  const [error, setError] = useState<string | null>(null);
  // `null` = 안 뜸. 커스텀 값을 `force` 없이 저장하려다 거절당하면 그 원문을 여기 담아 확인
  // 다이얼로그를 띄운다 — 팝오버 저장이 조용히 그 값을 지우지 않는다(`77ca2128`).
  const [confirmRaw, setConfirmRaw] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = pick.engine !== "" && enginePickOk(pick, modelPattern) && !pending;
  const labelId = `persona-engine-${name}-label`;
  const triggerId = `persona-engine-${name}-value`;
  const display = catalog
    ? catalog.model
      ? `${catalog.engineId} · ${catalog.model}`
      : catalog.engineId
    : (custom ?? t("persona.engine.unset"));

  const save = (id: string | null, model: string, force = false) =>
    start(async () => {
      const r = await savePersonaEngineAction(projectId, name, id, model, force);
      if (r.ok) {
        onSaved(r.engine ?? null);
        setError(null);
        setConfirmRaw(null);
        setOpen(false);
      } else if (r.custom) {
        setConfirmRaw(r.custom);
      } else {
        setError(r.message ?? t("persona.engine.saveFailed"));
      }
    });

  return (
    <span className="flex items-center gap-2">
      <span id={labelId} className="text-xs text-muted-foreground">
        {t("persona.engine.label")}
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
          {/* 카탈로그 밖 인자가 있다는 사실 자체가 신호다(§4-3 워커 행의 `custom` 배지와 같은 뜻) —
              팝오버를 열지 않아도 "지정 없음"이 아니라는 것이 보인다. */}
          {custom !== null && (
            <Badge variant="outline" className="self-center">
              custom
            </Badge>
          )}
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
          <p className="text-xs text-muted-foreground">{t("persona.policy.nextTicketHint")}</p>
          {error && <Failure title={t("persona.engine.saveFailedTitle")} message={error} />}
          <div className="flex items-center justify-between gap-2">
            {engine && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => save(null, "")}
              >
                {t("persona.engine.unsetAction")}
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
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmRaw !== null} onOpenChange={(o) => !o && setConfirmRaw(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("persona.engine.overwriteTitlePrefix")} {name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("persona.engine.overwriteBodyPrefix")}{" "}
              <span className="font-mono text-xs break-all">{confirmRaw}</span>{" "}
              {t("persona.engine.overwriteBodySuffix")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => save(pick.engine, pick.model, true)}>
              {t("persona.engine.overwriteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

// ── 스킬 (DESIGN.md §5-1 · §비주얼 §25) ─────────────────────────────────────

/** 오른쪽 칸 본문의 두 번째 블록. 저장은 **한 경로**다 — `제거`·`끄기`·`켜기`도 다이얼로그의
 *  `저장`도 `savePersonaSkillsAction`(=`writePersonaSkills` + `writePersonaOffSkills`)에 두
 *  목록을 함께 넘긴다. 각 목록이 0개가 되면 그 파일이 사라진다(§비주얼 §25 ⑥).
 *
 *  실패 자리가 둘로 갈리는 이유는 §비주얼 §25 다섯 상태다 — **누른 곳**에 뜬다.
 *  `제거`·`끄기`·`켜기`는 여기 절 아래, 다이얼로그의 `저장`은 그 `DialogFooter` 위다. */
function SkillsSection({
  projectId,
  name,
  skills,
  chars,
  offSkills,
  installed,
  onInstalled,
  configDir,
  onSaved,
}: {
  projectId: string;
  name: string;
  skills: Skill[];
  chars: number;
  offSkills: Skill[];
  installed: Skill[];
  onInstalled: (installed: Skill[]) => void;
  configDir: string;
  onSaved: (skills: Skill[], chars: number, offSkills: Skill[]) => void;
}) {
  const t = useT();
  const [removing, setRemoving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const busy = removing !== null || toggling !== null;

  /** 쓰기의 유일한 창구. **고른 이름만** 보낸다(설명은 서버가 채운다) — 성공하면 서버가
   *  되읽은 두 목록·자수로 화면을 맞춘다. */
  const save = async (picked: string[], offPicked: string[]) => {
    const r = await savePersonaSkillsAction(projectId, name, picked, offPicked);
    if (r.ok) onSaved(r.skills ?? [], r.chars ?? 0, r.offSkills ?? []);
    return r;
  };

  const removeFrom = (skillName: string, fromOff: boolean) =>
    start(async () => {
      setRemoving(skillName);
      setError(null);
      const r = fromOff
        ? await save(
            skills.map((s) => s.name),
            offSkills.filter((s) => s.name !== skillName).map((s) => s.name),
          )
        : await save(
            skills.filter((s) => s.name !== skillName).map((s) => s.name),
            offSkills.map((s) => s.name),
          );
      setRemoving(null);
      if (!r.ok) setError(r.message ?? t("persona.skill.saveFailed"));
    });

  /** `끄기`/`켜기` — 누른 그 순간 두 파일을 쓴다. `저장`을 기다리지 않는다(§비주얼 §25 ⑥). */
  const toggle = (skillName: string, turnOn: boolean) =>
    start(async () => {
      setToggling(skillName);
      setError(null);
      const picked = turnOn
        ? [...skills.map((s) => s.name), skillName]
        : skills.filter((s) => s.name !== skillName).map((s) => s.name);
      const offPicked = turnOn
        ? offSkills.filter((s) => s.name !== skillName).map((s) => s.name)
        : [...offSkills.map((s) => s.name), skillName];
      const r = await save(picked, offPicked);
      setToggling(null);
      if (!r.ok) setError(r.message ?? t("persona.skill.saveFailed"));
    });

  /** 활성·비활성 두 목록이 **같은 벌**이다(§비주얼 §25 ⑥ 껍데기) — 이름·설명·`제거`는 글자
   *  하나까지 같고, 갈리는 것은 `handle`(끄기/켜기) 하나뿐이다. */
  const row = (s: Skill, handle: React.ReactNode, onRemove: () => void) => (
    <li key={s.name} className="flex items-baseline gap-2">
      {/* 이름은 프롬프트에 그대로 실려 지목이 되는 토큰이다 — 안 자른다(§6 식별자) */}
      <code className="shrink-0 font-mono text-xs">{s.name}</code>
      <span className="min-w-0 grow truncate text-xs text-muted-foreground" title={s.description}>
        {s.description}
      </span>
      {handle}
      {/* 확인 다이얼로그를 안 붙인다 — 되돌리는 비용이 `스킬 추가`(활성 줄)나 `켜기`(비활성 줄)를
          한 번 더 누르는 것이다. 어휘도 가른다: 디렉터리는 `삭제`, 목록 한 줄은 `제거`(§25 ②).
          **`제거`는 여기서 안 바뀐다**(§비주얼 §25 ⑥ — `disabled` 그대로, `aria-disabled`가 아니다) */}
      <Button variant="ghost" size="sm" className="self-center" disabled={busy} onClick={onRemove}>
        {removing === s.name ? t("persona.skill.removingAction") : t("persona.action.remove")}
      </Button>
    </li>
  );

  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">{t("persona.word.skills")}</h3>
        {/* 0개일 때 `0 B`는 참이지만 아무것도 안 말한다 — 바로 아래 한 줄이 이미 말했다.
            상한이 없다 — `editBytes`의 합계 일부일 뿐이라 여기서 발명하지 않는다(결정 11 (3)) */}
        {skills.length > 0 && (
          <span className="text-xs text-muted-foreground">{budgetLabel(chars)}</span>
        )}
        <AddSkillsDialog
          current={skills}
          installed={installed}
          onInstalled={onInstalled}
          configDir={configDir}
          save={(picked) => save(picked, offSkills.map((s) => s.name))}
        />
      </div>

      {skills.length === 0 && offSkills.length === 0 ? (
        // `<EmptyState>`가 아니다 — 화면의 1차 콘텐츠가 아니고 다음 행동은 절 머리에 있다(§25 ②)
        <p className="text-xs text-muted-foreground">{t("persona.skill.emptyNone")}</p>
      ) : skills.length === 0 ? (
        // 활성 0 - 비활성 m(§비주얼 §25 ⑥) — 주어만 갈린다. 다음 행동은 아래 `켜기`다
        <p className="text-xs text-muted-foreground">{t("persona.skill.emptyAllOff")}</p>
      ) : (
        <>
          {/* 어휘는 §비주얼 §23 ⑤의 문형 그대로다(`<무엇>은 claude 엔진에서만 …`). 이건 경고가
              아니라 상시 참인 사실이라 `Alert`가 아니다 — 이 화면에는 엔진 값이 아예 없다 */}
          <p className="text-xs text-muted-foreground">{t("persona.skill.claudeOnlyHint")}</p>
          <ul className="space-y-1">
            {skills.map((s) =>
              row(
                s,
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center aria-disabled:opacity-50"
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return; // §58 처방 — 핸들러 첫 줄 가드
                    toggle(s.name, false);
                  }}
                >
                  {toggling === s.name ? t("persona.skill.turningOff") : t("persona.skill.turnOff")}
                </Button>,
                () => removeFrom(s.name, false),
              ),
            )}
          </ul>
        </>
      )}

      {/* 비활성 목록 — 활성 1개 이상일 때만 서는 것이 아니라 **비활성이 1개 이상일 때만** 선다
          (§비주얼 §25 ⑥). 0개면 머리도 목록도 안 그린다 */}
      {offSkills.length > 0 && (
        <>
          <h4 className="text-xs font-medium text-muted-foreground">{t("persona.skill.offHeading")}</h4>
          <ul className="space-y-1">
            {offSkills.map((s) =>
              row(
                s,
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center aria-disabled:opacity-50"
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    toggle(s.name, true);
                  }}
                >
                  {toggling === s.name ? t("persona.skill.turningOn") : t("persona.skill.turnOn")}
                </Button>,
                () => removeFrom(s.name, true),
              ),
            )}
          </ul>
        </>
      )}

      {error && <Failure title={t("persona.skill.saveFailedTitle")} message={error} />}
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
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // §10 §위키링크 §자리 표 — vault는 이 페르소나의 memory/뿐이다(다른 페르소나 이름은 안 섞인다).
  const vault: Vault = {};
  for (const m of memories) {
    const name = m.file.replace(/\.md$/, "");
    vault[name] = `#${encodeURIComponent(name)}`;
  }

  // 누르면 URL이 안 바뀐다(§10 §자리 표) — 그래서 실제 `#` 이동(브라우저가 스스로 details를
  // 여는 갈래)을 안 쓰고 클릭을 잡아 `open`을 손으로 민다. `data-wikilink`는 댕글링 `<span>`에도
  // 붙어 있지만 그 이름은 이 목록에 없으니 querySelector가 못 찾고 조용히 끝난다(요구한 값).
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
    // `start`다 — 전문이 길면(§32 실측 최장 2,348px) `center`는 방금 편 요약줄을 화면 밖
    // 위로 밀어낸다. `start`는 그 줄을 맨 위에 두고 전문을 위에서부터 읽게 한다.
    target.scrollIntoView({ block: "start" });
  }

  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium">{t("persona.word.memory")}</h3>
        {/* 0장일 때 `0 B`는 참이지만 아무것도 안 말한다(§25 ②와 같은 판정). 자기 예산
            (`MEMORY_MAX_BYTES` = `AGENTS.md` §회고 예산)과 비교된다 — 프로필+스킬 합과는
            별개다(§프롬프트 층 결정 11 (4)) */}
        {memories.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {budgetLabel(chars, MEMORY_MAX_BYTES)}
          </span>
        )}
      </div>

      {memories.length === 0 ? (
        // 스킬 절의 빈 상태와 방향이 다르다 — 여기는 다음 행동이 사람에게 없어서 이 한 줄이
        // **누가 채우는가**를 말한다. 없으면 버튼 없는 빈 절이 고장으로 읽힌다(§32 ②)
        <p className="text-xs text-muted-foreground">{t("persona.memory.empty")}</p>
      ) : (
        <ul ref={listRef} onClick={openWikilink} className="space-y-1">
          {memories.map((m) => (
            <li key={m.file}>
              {/* 이 화면에 남은 유일한 `<details>`다 — 2단이 되면서 바깥 카드의 `<details>`는
                  없어졌다. **그래도 그룹 이름은 그대로 둔다**: 이름 없는 `group-open:`은 조상의
                  `group`을 물어서 바깥에 `group`이 다시 생기는 날 chevron이 조용히 틀린다.
                  `accordion`·`collapsible`은 안 깐다 — 이 자리도 같은 값이다(§32 ③).
                  `data-mem-name`은 위키링크 클릭이 펼칠 대상을 찾는 자리다(§10 §자리 표) */}
              <details className="group/mem" data-mem-name={m.file.replace(/\.md$/, "")}>
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
                  <Markdown text={m.text} vault={vault} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {/* 실패는 **누른 곳**이다 — 이건 펼쳐야 만질 수 있어서 절 맨 아래다(§32 다섯 상태) */}
      {error && <Failure title={t("persona.memory.deleteFailedTitle")} message={error} />}
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
  const t = useT();
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={pending}>
            <Trash2 aria-hidden />
            {pending ? t("persona.memory.deletingAction") : t("persona.action.delete")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("persona.memory.deleteTitlePrefix")} {memory.file.replace(/\.md$/, "")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">{`${dir}/memory/${memory.file}`}</span>{" "}
            {t("persona.memory.deleteBodyAfterPath")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deletePersonaMemoryAction(projectId, name, memory.file);
                onDone(r.ok ? null : (r.message ?? t("persona.memory.deleteFailedMessage")));
              })
            }
          >
            {t("persona.action.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 드롭한 폴더를 재귀해 파일을 모은다(§비주얼 §25 ⑤ - §5-1 §입구 하나). `readEntries()`는 한
 *  번에 최대 100개만 주므로 빈 배열이 나올 때까지 반복한다. 반환하는 `path`는 **폴더 안** 기준
 *  이다(폴더 이름 자신은 없다) — 첫 성분을 애초에 안 붙이면 폴더 모드의 "첫 성분을 뗀다"가
 *  그대로 만족된다. */
async function collectDirectoryFiles(
  dir: FileSystemDirectoryEntry,
  prefix: string,
): Promise<{ file: File; path: string }[]> {
  const reader = dir.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const items: { file: File; path: string }[] = [];
  for (const entry of entries) {
    const path = `${prefix}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      items.push({ file, path });
    } else if (entry.isDirectory) {
      items.push(...(await collectDirectoryFiles(entry as FileSystemDirectoryEntry, `${path}/`)));
    }
  }
  return items;
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // `저장` 실패와 import 실패가 그릇 하나를 나눠 쓴다(§비주얼 §25 ⑤ — 마지막에 누른 것 하나만
  // 선다). title·message가 각각 `AlertTitle`(sans)·`AlertDescription`(mono)이다.
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  // 입구가 파일 하나 - 주소 하나로 갈리면서 "무엇이 도나"가 다시 값을 갖는다(§비주얼 §25 ⑦) —
  // 갈래(파일-폴더-.skill)가 아니라 **입구 둘의 이름**이다. `찾아보기`는 `"file"`일 때만 자기
  // 글자를 "설치 중…"으로 갈고, 둘 다 서로를 잠근다(통로가 하나라 두 벌이 동시에 안 간다).
  const [installing, setInstalling] = useState<"file" | "url" | null>(null);
  // 주소 칸의 값(§비주얼 §25 ⑦) — 실패하면 안 비우고(고칠 글이 거기 있다), 성공하면 비운다.
  const [address, setAddress] = useState("");
  // 드래그가 이 다이얼로그 위에 있는 동안만 참이다(§비주얼 §25 ⑤ §드래그 중 표시) — 새 상태 하나.
  const [dragging, setDragging] = useState(false);
  // `dragleave`가 자식 경계마다 뜨는 함정(⑤ §함정 셋 - 3번)의 처방 — 진입 카운터.
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // **함정 둘째**: 다이얼로그를 놓치면 브라우저가 그 파일로 이동해 화면과 체크 상태를 통째로
  // 잃는다(§비주얼 §25 ⑤). 열려 있는 동안 `window`의 기본 동작을 삼킨다 — 표시는 0이다.
  useEffect(() => {
    if (!open) return;
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, [open]);

  /** 파일 갈래·주소 갈래가 여기서 합류한다 — 서버가 보는 것은 `installSkillAction`의 결과
   *  하나뿐이다(§비주얼 §25 ⑦ - "그 뒤는 파일 갈래와 같은 `installSkill`로 들어간다"). `source`는
   *  화면이 잠글 손잡이를 가리키는 이름이고 갈래가 아니다(§25 ⑦ §읽는 법).
   *
   *  `installSkillAction`이 던질 수 있다(예: 본문 상한 관문이 먼저 자른 네트워크/파싱 예외) —
   *  `try` 없이 두면 throw가 `setInstalling(null)`을 건너뛰어 다이얼로그가 사유 없이
   *  "설치 중…"에 영구 고정된다(§비주얼 §25 ⑤ 위반, 실측 `ec687d52`). */
  const submitInstall = async (formData: FormData, source: "file" | "url") => {
    setFailure(null);
    setInstalling(source);
    try {
      const r = await installSkillAction(formData);
      if (r.ok) {
        onInstalled(r.installed ?? []);
        // §비주얼 §25 ⑦ §성공 — 주소 칸을 비운다(같은 주소를 두 번 깔 일이 없다).
        if (source === "url") setAddress("");
        // §비주얼 §25 ⑤ §성공 — 토스트가 없다. 검색칸에 방금 깐 이름을 채워 목록을 그 한 줄로 좁힌다.
        if (r.name) {
          const name = r.name;
          setPicked((prev) => (prev.includes(name) ? prev : [...prev, name]));
          setQuery(name);
        }
      } else {
        setFailure({ title: r.title ?? t("persona.skill.installFailedTitle"), message: r.message ?? "" });
      }
    } catch {
      setFailure({ title: t("persona.skill.installFailedTitle"), message: "" });
    } finally {
      setInstalling(null);
    }
  };

  /** 파일 갈래 — 서버가 받는 것은 `file` 여러 개 + 같은 순서의 `path` 여러 개다
   *  (§5-1 §import "입구 둘, 통로 하나" - §셋째 입구 - §입구 하나). `.skill`과 파일 한 장은
   *  화면이 보내는 모양이 같아(`path: "SKILL.md"`) 갈래가 필요 없다 — 판정은 서버가 파일 이름의
   *  끝을 보고 한다(`installSkillAction`). 상한 둘은 `installSkill` · `extractSkillArchive`와
   *  같은 함수(`skillUploadError`)를 불러 같은 문장을 쓴다. */
  const runInstall = async (items: { file: File; path: string }[]) => {
    const limitError = skillUploadError(
      items.length,
      items.reduce((n, it) => n + it.file.size, 0),
    );
    if (limitError) {
      setFailure(limitError);
      return;
    }
    const formData = new FormData();
    for (const it of items) {
      formData.append("file", it.file);
      formData.append("path", it.path);
    }
    await submitInstall(formData, "file");
  };

  /** 주소 갈래(§5-1 §넷째 입구 - §비주얼 §25 ⑦) — 클라이언트 상한 검사가 없다. 크기를 받기
   *  전에는 잴 수 없어서 §8 `MAX_BYTES` 판정은 받는 도중 서버가 한다(`fetchSkillFromAddress`). */
  const runInstallAddress = async (value: string) => {
    const formData = new FormData();
    formData.append("address", value);
    await submitInstall(formData, "url");
  };

  /** 드롭한 트리를 판정한다 — 그 다음은 폴더 모드와 한 글자도 안 갈린다(§5-1 §입구 하나).
   *  **함정 넷째(순서)**: `DataTransferItemList`는 이 핸들러가 도는 동안만 살아 있다 -
   *  `webkitGetAsEntry()`를 이 함수가 `await`을 만나기 **전에** 동기로 다 꺼내 둔다. */
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const entries = Array.from(e.dataTransfer.items)
      .filter((it) => it.kind === "file")
      .map((it) => it.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);
    if (entries.length === 0) return;
    // 한 번에 하나만 받는다(§비주얼 §25 ⑤ 표 9 - §5-1) — 서버에 아무것도 안 보낸다.
    if (entries.length > 1) {
      setFailure({
        title: t("persona.skill.multiDropRejected"),
        message: `${entries.length}${t("persona.skill.countSuffix")}`,
      });
      return;
    }
    const entry = entries[0];
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      void runInstall([{ file, path: "SKILL.md" }]);
      return;
    }
    if (entry.isDirectory) {
      const items = await collectDirectoryFiles(entry as FileSystemDirectoryEntry, "");
      // 떼고 나서 SKILL.md가 없으면 거절한다(폴더 바로 아래여야 한다) — 원래 폴더 이름은
      // 화면만 알아서 서버에 못 보낸다(§비주얼 §25 ⑤ 표 «+»).
      if (!items.some((it) => it.path === "SKILL.md")) {
        setFailure({
          title: t("persona.skill.installMissingSkillMd"),
          message: `${entry.name}/`,
        });
        return;
      }
      void runInstall(items);
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
          setAddress("");
          setFailure(null);
        } else {
          dragDepthRef.current = 0;
          setDragging(false);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" className="ml-auto self-center" />}>
        {t("persona.skill.addHeading")}
      </DialogTrigger>
      <DialogContent
        className={cn("sm:max-w-lg", dragging && "ring-2 ring-primary")}
        // 드롭을 받는 것은 이 상자 전체다(§비주얼 §25 ⑤ §드롭이 받는 영역) — 새 층·새 과녁이 없다.
        onDragEnter={(e) => {
          if (installing) return;
          e.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          // `dragover`도 삼켜야 `drop`이 뜬다 — 없으면 브라우저가 기본 동작(거절)을 한다.
          if (installing) return;
          e.preventDefault();
        }}
        onDragLeave={() => {
          // 함정 셋째: 자식 경계마다 뜬다 — 진입 카운터가 0으로 떨어져야 실제로 나간 것이다.
          if (installing) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (installing) return;
          e.preventDefault();
          dragDepthRef.current = 0;
          setDragging(false);
          void handleDrop(e);
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("persona.skill.addHeading")}</DialogTitle>
          <DialogDescription>{t("persona.skill.addDialogDesc")}</DialogDescription>
        </DialogHeader>

        <Command>
          <CommandInput
            placeholder={t("persona.skill.searchPlaceholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {installed.length + orphans.length > 0 && (
              <CommandEmpty>{`"${query}"${t("persona.skill.searchEmptySuffix")}`}</CommandEmpty>
            )}
            {orphans.length > 0 ? (
              <>
                <CommandGroup heading={t("persona.skill.notOnMachineHeading")}>
                  {orphans.map((s) => item(s, t("persona.skill.orphanNote")))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t("persona.skill.installedHeading")}>
                  {installed.map((s) => item(s))}
                </CommandGroup>
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
                <p className="text-sm">{t("persona.skill.noneOnMachine")}</p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {configDir}/skills/*/SKILL.md
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {configDir}/plugins/marketplaces/*/skills/*/SKILL.md
                </p>
                <p className="text-xs text-muted-foreground">{t("persona.skill.configDirHint")}</p>
                {/* §비주얼 §25 ⑤ — 후보 0개가 이 기능의 첫 독자다. 다음 행동은 바로 아래 44px의
                    `찾아보기` 하나와 드롭이다(경로를 다시 안 적는다 — 위 두 글롭이 이미 그 자리다) */}
                <p className="text-xs text-muted-foreground">{t("persona.skill.installFromBelow")}</p>
              </div>
            )}
          </CommandList>
        </Command>

        {/* import 입구 하나 — `Command`와 실패·`DialogFooter` 사이의 한 행(§비주얼 §25 ⑤ 개정
            `7acf0448`). 숨긴 `<input type="file">` 하나 + 버튼 하나, `AttachmentButton`과 같은
            조립(`display:none`은 focus가 안 먹지만 `.click()`은 먹는다 — `attachment-field.tsx`).
            폴더는 이 행이 안 받는다 — `DialogContent` 전체가 드롭으로 받는다(위). */}
        <div className="flex items-center gap-2">
          <span className="min-w-0 text-xs text-muted-foreground">
            {dragging
              ? t("persona.skill.dropToInstall")
              : installing === "url"
                ? t("persona.skill.fetchingAddress")
                : t("persona.skill.dropHint")}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.skill"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              // 같은 파일을 두 번 고르면 change가 안 뜬다 — 비워서 다음 선택이 항상 뜨게 한다.
              e.target.value = "";
              if (file) void runInstall([{ file, path: "SKILL.md" }]);
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
            {installing === "file" ? t("persona.skill.installing") : t("persona.skill.browse")}
          </Button>
        </div>

        {/* 넷째 입구 — 주소 한 줄(§5-1 §넷째 입구 - §비주얼 §25 ⑦). 위 행의 형제이고 그 행이
            담는 것은 안 늘린다. `<form>`이 `Enter`를 0줄로 준다(그릇 안에 `type="submit"`이
            이 버튼 하나뿐이고 `찾아보기`-`취소`-`저장`은 이 폼 밖이다). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!address.trim() || installing !== null) return;
            void runInstallAddress(address.trim());
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("persona.skill.addressAriaLabel")}
              className="min-w-0 grow font-mono"
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              aria-disabled={!address.trim() || installing !== null}
              className="aria-disabled:opacity-50"
            >
              {t("persona.skill.installAction")}
            </Button>
          </div>
        </form>

        {/* 실패하면 다이얼로그가 열린 채로 남고 체크도 남는다 — 사유를 읽고 다시 누른다.
            `저장` 실패와 import 실패가 이 그릇 하나를 나눠 쓴다(마지막에 누른 것 하나만 선다) */}
        {failure && <Failure title={failure.title} message={failure.message} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
          <Button
            disabled={pending || installing !== null}
            onClick={() =>
              start(async () => {
                setFailure(null);
                const r = await save(picked);
                if (r.ok) setOpen(false);
                else setFailure({ title: t("persona.skill.saveFailedTitle"), message: r.message ?? "" });
              })
            }
          >
            {pending ? t("common.saving") : t("common.save")}
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
  const t = useT();
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Trash2 aria-hidden />
            {t("persona.action.delete")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("persona.delete.titlePrefix")} {row.name}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-xs break-all">
              {row.file.replace(/\/PROFILE\.md$/, "")}
            </span>{" "}
            {t("persona.delete.bodyAfterPath")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* 티켓은 지우지 않는다 — 남은 티켓은 페르소나 없이 디스패치된다(tick.sh 188행) */}
        {row.refs.open + row.refs.wip > 0 && (
          <Alert>
            <TriangleAlert aria-hidden className="text-status-stale" />
            <AlertTitle>
              {t("persona.delete.refsWarnPrefix")} {row.refs.open + row.refs.wip}
              {t("persona.delete.refsWarnSuffix")}
              {row.refs.wip > 0 &&
                ` ${t("persona.delete.refsWipPrefix")} ${row.refs.wip}${t("persona.delete.refsWipSuffix")}`}
            </AlertTitle>
            <AlertDescription>
              {t("persona.delete.refsBody")}{" "}
              <span className="font-mono text-xs">WARN</span>
              {t("persona.warn.engineSuffix")}{" "}
              <strong className="font-medium">{t("persona.wording.withoutPersona")}</strong>{" "}
              {t("persona.delete.dispatchDetail")}
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deletePersonaAction(projectId, row.name);
                if (r.ok) onDeleted();
                else onError(r.message ?? t("persona.action.deleteFailedMessage"));
              })
            }
          >
            {t("persona.action.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
