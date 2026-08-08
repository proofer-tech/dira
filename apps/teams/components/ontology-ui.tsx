"use client";

/** 온톨로지 화면(`/p/<project>/ontology`)의 클라이언트 조각 — 편집 · 새 파일 · 이름변경 · 삭제.
 *
 *  `protocols-ui.tsx`의 판박이다(트리는 서버가 `<Link href="?file=…">`으로 그리고 선택 상태는
 *  URL이 담는다는 규약도 같다). 온톨로지에는 인라인 프롬프트 배지·`AGENTS.md` 특수 케이스가
 *  없다 — 세션 프롬프트에는 목차만 실리고(§5-2) 이 화면이 여는 것은 그 목차가 가리키는 본문이다. */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, PencilLine, Trash2, TriangleAlert } from "lucide-react";
import {
  createOntologyAction,
  deleteOntologyAction,
  renameOntologyAction,
  saveOntologyAction,
  submitOntologySurveyAction,
  type OntologyResult,
} from "@/app/(app)/p/[project]/ontology/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Q1_OPTIONS,
  Q2_CHIPS,
  Q3_OPTIONS,
  Q4_OPTIONS,
  QUESTIONS,
  type OntologySurveyAnswers,
} from "@/lib/ontology-seed";

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

const fileHref = (projectId: string, rel: string) =>
  `/p/${projectId}/ontology?file=${encodeURIComponent(rel)}`;

// ── 새 파일 ─────────────────────────────────────────────────────────────────

export function NewOntologyFileButton({
  projectId,
  variant,
}: {
  projectId: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [result, setResult] = useState<OntologyResult | null>(null);
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
            온톨로지 디렉터리 기준 상대경로입니다. <span className="font-mono text-xs">/</span>를
            넣으면 하위 디렉터리도 같이 만듭니다. 빈 파일로 만들고 바로 편집기가 열립니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-ontology">경로</Label>
          <Input
            id="new-ontology"
            className="font-mono"
            placeholder="SCHEMA.md"
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
                const r = await createOntologyAction(projectId, name);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel));
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
export function OntologyEditor({
  projectId,
  rel,
  initial,
}: {
  projectId: string;
  rel: string;
  initial: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<OntologyResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = text !== initial;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm break-all">{rel}</span>
        <div className="flex items-center gap-1">
          <RenameOntologyButton projectId={projectId} rel={rel} />
          <DeleteOntologyButton projectId={projectId} rel={rel} />
        </div>
      </div>

      <Textarea
        aria-label={`${rel} 원문`}
        className="font-mono"
        rows={28}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {result && !result.ok && <Failure title="저장하지 못했습니다" message={result.message ?? ""} />}

      {/* 부가 정보 → 보조 → 1차 순으로 오른쪽 정렬(§비주얼 §4-3) */}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {[...text].length.toLocaleString()}자
        </span>
        {dirty ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setText(initial)}>
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
              const r = await saveOntologyAction(projectId, rel, text);
              setResult(r);
              if (r.ok) router.refresh();
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

function RenameOntologyButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(rel);
  const [result, setResult] = useState<OntologyResult | null>(null);
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
          <Label htmlFor="rename-ontology">새 경로</Label>
          <Input
            id="rename-ontology"
            className="font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
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
                const r = await renameOntologyAction(projectId, rel, to);
                setResult(r);
                if (r.ok && r.rel) {
                  setOpen(false);
                  router.replace(fileHref(projectId, r.rel));
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

function DeleteOntologyButton({ projectId, rel }: { projectId: string; rel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<OntologyResult | null>(null);
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
        {result && !result.ok && <Failure title="지우지 못했습니다" message={result.message ?? ""} />}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" autoFocus />}>취소</DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteOntologyAction(projectId, rel);
                setResult(r);
                if (r.ok) {
                  setOpen(false);
                  router.replace(`/p/${projectId}/ontology`);
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

// ── 생성 — 설문 4문항 (§5-3 §생성) ───────────────────────────────────────────

/** 체크박스 한 줄 — 네 문항 다 같은 모양이라 여기 하나로 묶는다. */
function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/** 생성 직후 온보딩 화면의 본문(§5-3 §생성 — 설문 4문항). **폼은 LLM을 안 기다린다** —
 *  제출은 `submitOntologySurveyAction`을 한 번 부르고 끝나고(그 액션 자체가 응답을 즉시
 *  돌려준다), 실제 `_ontology/SCHEMA.md` 등 시드 파일 전부가 서는 것은 그 뒤다. 제출 후에는 파일이 나타날 때까지 잠깐
 *  새로고침한다 — 파일이 생기면 부모(`page.tsx`)가 이 컴포넌트 대신 파일트리를 그려서
 *  폴링이 스스로 끝난다(언마운트). **문항 4개에 «객체»·«타입»·«관계»·«온톨로지»가 없다** —
 *  값은 `lib/ontology-seed.ts`의 상수 그대로다. */
export function OntologySurveyForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [q1, setQ1] = useState("");
  const [q2Checked, setQ2Checked] = useState<string[]>([]);
  const [q2Custom, setQ2Custom] = useState("");
  const [q3, setQ3] = useState<string[]>([]);
  const [q4, setQ4] = useState<string[]>([Q4_OPTIONS[0]]);
  const [pending, start] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<OntologyResult | null>(null);

  useEffect(() => {
    if (!submitted) return;
    const id = setInterval(() => router.refresh(), 600);
    const stop = setTimeout(() => clearInterval(id), 8000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [submitted, router]);

  if (submitted) {
    return <p className="text-sm text-muted-foreground">답을 바탕으로 만드는 중입니다…</p>;
  }

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <Label>{QUESTIONS.q1}</Label>
        <div className="space-y-1">
          {Q1_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input type="radio" name="q1" className="size-4" checked={q1 === opt} onChange={() => setQ1(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <Label>{QUESTIONS.q2}</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {Q2_CHIPS.map((chip) => (
            <CheckRow
              key={chip}
              label={chip}
              checked={q2Checked.includes(chip)}
              onChange={() => toggle(q2Checked, setQ2Checked, chip)}
            />
          ))}
        </div>
        <Input
          placeholder="직접 입력 (쉼표로 여러 개)"
          value={q2Custom}
          onChange={(e) => setQ2Custom(e.target.value)}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <Label>{QUESTIONS.q3}</Label>
        <div className="space-y-1">
          {Q3_OPTIONS.map((opt) => (
            <CheckRow
              key={opt.relation}
              label={opt.label}
              checked={q3.includes(opt.relation)}
              onChange={() => toggle(q3, setQ3, opt.relation)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <Label>{QUESTIONS.q4}</Label>
        <div className="space-y-1">
          {Q4_OPTIONS.map((opt) => (
            <CheckRow key={opt} label={opt} checked={q4.includes(opt)} onChange={() => toggle(q4, setQ4, opt)} />
          ))}
        </div>
      </fieldset>

      {result && !result.ok && <Failure title="만들지 못했습니다" message={result.message ?? ""} />}

      <Button
        disabled={pending || !q1}
        onClick={() => {
          const answers: OntologySurveyAnswers = {
            q1,
            q2: [...q2Custom.split(",").map((s) => s.trim()).filter(Boolean), ...q2Checked],
            q3,
            q4,
          };
          start(async () => {
            const r = await submitOntologySurveyAction(projectId, answers);
            setResult(r);
            if (r.ok) setSubmitted(true);
          });
        }}
      >
        {pending ? "만드는 중…" : "만들기"}
      </Button>
    </div>
  );
}
