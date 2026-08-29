"use client";

/** 첨부 손잡이 · 칩 — 계약은 DESIGN.md §8, 모양은 §비주얼 §27.
 *
 *  붙는 칸이 넷인데(§8) 상태 기계를 자리마다 두면 그중 하나가 조용히 다르게 군다 — 10개 상한이
 *  한 곳에만 있거나, 붙여넣기가 세 자리에서만 먹거나, 실패 문장이 어느 폼에서만 사라진다.
 *  그래서 **상태와 그리기를 여기 한 벌만 둔다.** 밖으로 나가는 것은 경로 배열(`att.paths`)이고,
 *  폼에 실리는 것도 여기가 그리는 `<input type="hidden" name="attachment">`다 — 호출자는
 *  hidden input을 안 적는다.
 *
 *  **훅과 컴포넌트로 갈린 이유**: `onPaste`가 붙는 자리는 **입력칸**인데(§8 — 사람이 글을 쓰다가
 *  붙여넣는다) 칩 줄과 손잡이는 그 아래다(§27 세로 순서 `입력칸 → 칩 줄 → 손잡이 줄`).
 *  한 컴포넌트가 입력칸까지 삼키면 자리마다 다른 `<Textarea>`/`<InputGroupTextarea>`의 props를
 *  통째로 프록시해야 한다. 훅이 상태를 들고, 컴포넌트가 §27의 아래 두 줄을 든다.
 *
 *  **그릇이 둘이라 그리는 것도 둘이다**(§27 표의 두 열): 다이얼로그는 `<AttachmentField>` 한 벌이
 *  칩 줄·실패 줄·액션 행을 다 들고, `<InputGroup>`(참견·이어받기·홈)은 조각 셋을 호출자의
 *  그룹 안팎에 나눠 심는다 — 칩은 addon, 손잡이는 **호출자의 액션 addon 안**, 실패 줄은 그룹
 *  **밖**이라(§21 `has-disabled:opacity-50`) 한 컴포넌트로는 그 셋을 한 자리에 못 놓는다.
 *  갈리는 것은 래퍼뿐이고 칩 하나(`AttachmentChip`)·상태(`useAttachments`)·문구는 한 벌이다. */
import { useRef, useState, type ReactNode } from "react";
import { Paperclip, TriangleAlert, X } from "lucide-react";
import { uploadAttachment } from "@/app/(app)/p/[project]/actions";
import { useLocale, useT } from "@/components/language-provider";
import { oversizeError } from "@/lib/attachment-limit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** §8 상한. 한 칸에 10개. 서버는 이 수를 모른다 — 화면이 거절하는 값이다. */
export const MAX_FILES = 10;

/** 칩 하나. 셋 중 하나다 — **올리는 중**(`path`·`error` 둘 다 없음) · **붙었다**(`path`) ·
 *  **실패**(`error`). 실패 칩도 목록에 남는다: 자동으로 사라지면 "붙었다가 없어진 것"과
 *  구분이 안 된다(§27). */
type Chip = { id: number; name: string; path?: string; error?: string };

/** 첨부 상태 한 벌. 폼 하나가 이걸 하나 든다. */
export type Attachments = ReturnType<typeof useAttachments>;

export function useAttachments(project: string) {
  const locale = useLocale();
  const t = useT();
  const [chips, setChips] = useState<Chip[]>([]);
  /** 상한 초과로 **안 붙인** 개수. 그 파일들은 칩이 안 서므로(§27 실패 표) 이 수가 유일한 흔적이다. */
  const [dropped, setDropped] = useState(0);
  /** 칩 키. 이름은 중복될 수 있고(같은 파일을 두 번 붙일 수 있다) 경로는 아직 없다. */
  const seq = useRef(0);
  /** `pasted-<n>` 의 n. 칩을 지워도 안 되감는다 — 되감으면 한 폼 안에서 이름이 겹친다. */
  const pasted = useRef(0);

  /** 고른 순간 올린다 — 보낼 때가 아니다(§8 §거동). 20MB짜리가 `⌘↵` 뒤에 올라가면 "보내는 중"이
   *  수십 초가 되고, 실패해 사람이 다시 누르면 같은 파일이 두 번 올라간다. */
  const upload = async (id: number, name: string, file: File) => {
    const form = new FormData();
    // 세 번째 인자가 파일명이다 — `File.name`은 못 고치므로 `pasted-<n>.<ext>`가 서버에 닿는
    // 유일한 통로가 여기다.
    form.set("file", file, name);
    const r = await uploadAttachment(project, form).catch((e: unknown) => ({
      ok: false as const,
      // 서버 액션 자체가 던지는 경우(bodySizeLimit 초과 · 서버 재시작)에도 사유가 남아야 한다.
      error: `${t("attachmentField.uploadFailedPrefix")} ${e instanceof Error ? e.message : String(e)}`,
    }));
    // 올라가는 동안 사람이 칩을 지웠으면 이 map은 아무것도 안 바꾼다. 올라간 파일은 안 지운다(§8 수명).
    setChips((prev) =>
      prev.map((c) =>
        c.id !== id ? c : r.ok ? { ...c, path: r.path } : { ...c, error: r.error },
      ),
    );
  };

  /** 파일 고르기와 붙여넣기가 **같은 경로로** 들어온다(§8). 개수 상한은 여기서 거절한다. */
  const add = (files: File[]) => {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_FILES - chips.length);
    setDropped(Math.max(0, files.length - room));
    for (const file of files.slice(0, room)) {
      const id = ++seq.current;
      // 이름이 빈 파일만 `pasted-<n>.<ext>`(§8). 크롬은 클립보드 이미지에 `image.png`를 주므로
      // macOS 스크린샷은 이 폴백을 안 탄다 — 합성 `ClipboardEvent`에서만 탄다(`c29b5bdc` 실측).
      const ext = (file.type.split("/")[1] || "bin").replace(/[^A-Za-z0-9]/g, "");
      const name = file.name || `pasted-${++pasted.current}.${ext}`;
      // 1건 상한은 **올리기 전에** 본다. 넘긴 요청은 Next의 `bodySizeLimit`에 걸려 서버 액션에
      // 닿지 못하고, 그러면 사유가 §6 3요소가 아니라 Next의 영어 마스킹 문구가 된다(`6dab7cc8`).
      // 판정은 서버(`saveAttachment`)가 다시 한다 — 같은 `oversizeError`다.
      const oversize = oversizeError(file.size, locale);
      setChips((prev) => [...prev, { id, name, error: oversize ?? undefined }]);
      if (!oversize) void upload(id, name, file);
    }
  };

  /** §8 — 클립보드에 **파일이 있을 때만** 먹는다. 없으면 아무것도 하지 않는다: 이 칸의 주 용도가
   *  지시를 붙여넣는 것이라 텍스트 붙여넣기가 한 자라도 어긋나면 기능이 손해다. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    add(files);
  };

  /** §27 실패 — **같은 사유는 한 줄로 뭉치고 파일 이름을 나열한다.** 파일마다 한 줄이면
   *  10개 거절이 칩 줄보다 큰 실패 표시가 된다.
   *
   *  ponytail: 뭉치는 키가 사유 **문자열 전체**다. 상한 초과 문장은 크기(`21.0MB`)를 품고 있어서
   *  크기가 다른 두 파일은 안 뭉친다(§27이 셋으로 셌던 것과 갈리는 유일한 지점 — 최대 10줄이다).
   *  뭉치려면 사유에 코드가 붙어야 한다(`lib/attachment-limit.ts`). 눈에 걸리면 그때 붙인다. */
  const byReason = new Map<string, string[]>();
  for (const c of chips) {
    if (c.error) byReason.set(c.error, [...(byReason.get(c.error) ?? []), c.name]);
  }
  const problems = [...byReason].map(([error, names]) => `${names.join(" · ")} — ${error}`);
  if (dropped > 0) {
    problems.push(
      `${t("attachmentField.dropLimitPrefix")} ${MAX_FILES}${t("attachmentField.dropLimitMiddle")} ${dropped}${t("attachmentField.dropLimitSuffix")}`,
    );
  }

  return {
    chips,
    problems,
    add,
    onPaste,
    remove: (id: number) => setChips((prev) => prev.filter((c) => c.id !== id)),
    /** 닫기·제출 뒤 빈 칸으로. **올라간 파일은 안 지운다**(§8 수명 — 자동 삭제 없음). */
    reset: () => {
      setChips([]);
      setDropped(0);
    },
    /** 밖으로 나가는 값. 올라간 것만이다 — 올리는 중·실패 칩은 실릴 경로가 없다. */
    paths: chips.flatMap((c) => (c.path ? [c.path] : [])),
    /** §3 닫기 확인. **칩이 하나라도 있으면** 묻는다 — 올리는 중·실패도 사람이 만든 상태다. */
    dirty: chips.length > 0 || dropped > 0,
  };
}

/** 칩 줄 + 실패 사유 줄 + 손잡이가 놓인 액션 행(§27). `children`은 그 행의 오른쪽 —
 *  1차 액션(`발행`·`요구 접수`)이 여전히 행의 가장 오른쪽이다(§비주얼 §4-3). */
export function AttachmentField({ att, children }: { att: Attachments; children?: ReactNode }) {
  const picker = useRef<HTMLInputElement>(null);
  const t = useT();

  return (
    <>
      {/* 0개면 줄이 아예 없다 — `첨부 없음`을 안 그린다(§27 다섯 상태) */}
      {att.chips.length > 0 && (
        <div
          role="group"
          aria-label={`${t("attachmentField.attachWord")} ${att.chips.length}${t("attachmentField.countSuffix")}`}
          className="flex flex-wrap gap-2"
        >
          {att.chips.map((c) => (
            <AttachmentChip key={c.id} chip={c} onRemove={() => att.remove(c.id)} />
          ))}
        </div>
      )}
      <AttachmentProblems att={att} />

      {/* 폼에 실리는 값. 서버가 `attachments/` 아래인지 다시 판정한다(`verifyAttachments`) */}
      {att.paths.map((p) => (
        <input key={p} type="hidden" name="attachment" value={p} />
      ))}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            att.add(Array.from(e.target.files ?? []));
            // 비우지 않으면 같은 파일을 두 번 고를 때 change가 안 뜬다.
            e.target.value = "";
          }}
        />
        {/* §27 — 이미 있는 액션 행의 맨 왼쪽(`mr-auto`). 새 줄을 만들지 않는다 */}
        <Button
          type="button"
          variant="outline"
          className="mr-auto"
          disabled={att.chips.length >= MAX_FILES}
          onClick={() => picker.current?.click()}
        >
          <Paperclip aria-hidden />
          {t("attachmentField.attachWord")}
        </Button>
        {children}
      </div>
    </>
  );
}

/** 왜 + 다음 행동. 그룹 **밖**이고 `<Failure>` Alert가 아니다 — 제출 실패 Alert와 한 폼에
 *  겹쳐 설 수 있어서 한 줄로 둔다(§27 실패 항). `<InputGroup>` 쪽 호출자는 이걸 그룹 **뒤**에
 *  세운다: 안에 넣으면 `has-disabled:opacity-50`이 겹쳐 §21이 금지한 대비가 된다. */
export function AttachmentProblems({ att }: { att: Attachments }) {
  if (att.problems.length === 0) return null;
  return (
    <div className="space-y-1">
      {att.problems.map((p) => (
        <p key={p} className="text-xs text-destructive">
          {p}
        </p>
      ))}
    </div>
  );
}

/** 칩 줄 — `<InputGroup>` 배치(§27 표 오른쪽 열). 손잡이 addon **앞**에 두고 둘 다 `order-last`라
 *  DOM 순서가 그대로 뜬다. addon이 `role="group"`을 이미 갖고 있어 이름만 얹는다. 0개면 줄이 없다. */
export function AttachmentChips({ att }: { att: Attachments }) {
  const t = useT();
  if (att.chips.length === 0) return null;
  return (
    <InputGroupAddon
      align="block-end"
      className="flex-wrap"
      aria-label={`${t("attachmentField.attachWord")} ${att.chips.length}${t("attachmentField.countSuffix")}`}
    >
      {att.chips.map((c) => (
        <AttachmentChip key={c.id} chip={c} onRemove={() => att.remove(c.id)} />
      ))}
    </InputGroupAddon>
  );
}

/** 손잡이 — **호출자의 액션 addon 안 첫 자식**이다(§27: `첨부 → (문구) → ml-auto ⌘↵ → 보내기`).
 *  새 줄을 만들지 않으므로 줄 높이가 안 변한다(§21의 104 · §27 실측 38px).
 *
 *  **`disabled`가 아니라 `aria-disabled`다**(§21 · §27 표) — `InputGroup`의 흐림이
 *  `:has(:disabled)`라 버튼 하나만 잠가도 그릇이 통째로 흐려진다. 못 누른다는 실효는 `onClick`이
 *  지킨다. `locked`는 **못 보내는 칸**이다(입구 없음 · 끝난 세션): 그 칸에 파일만 올라가면 그
 *  파일은 아무 데도 안 간다 — 호출자가 `onPaste`도 같이 뗀다.
 *
 *  파일 입력은 `sr-only`가 아니라 `hidden`이다. `InputGroupAddon`의 onClick이 addon 여백을 누르면
 *  `parentElement.querySelector("input")`을 focus하는데(실측 — 그 그릇의 컨트롤은 `textarea`라
 *  지금까지 아무것도 못 찾았다), `sr-only`면 그 포커스가 **보이지 않는 요소**에 놓인다.
 *  `display:none`은 focus가 안 먹고 `.click()`은 그대로 먹는다. */
export function AttachmentButton({ att, locked }: { att: Attachments; locked?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const t = useT();
  const off = !!locked || att.chips.length >= MAX_FILES;
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          att.add(Array.from(e.target.files ?? []));
          // 비우지 않으면 같은 파일을 두 번 고를 때 change가 안 뜬다.
          e.target.value = "";
        }}
      />
      <InputGroupButton
        aria-disabled={off}
        className="aria-disabled:opacity-50"
        onClick={() => {
          if (!off) picker.current?.click();
        }}
      >
        <Paperclip aria-hidden />
        {t("attachmentField.attachWord")}
      </InputGroupButton>
    </>
  );
}

/** 칩 한 벌(§27). 붙었다 / 올리는 중 / 실패가 **아이콘과 꼬리로만** 갈린다 —
 *  `variant="destructive"`를 안 쓰는 이유는 §1이 이미 잰 3.99다(§27 대비 표). */
function AttachmentChip({ chip, onRemove }: { chip: Chip; onRemove: () => void }) {
  const t = useT();
  const uploading = !chip.path && !chip.error;
  return (
    <Badge variant="secondary" className="max-w-[14rem]" aria-busy={uploading || undefined}>
      {chip.error ? (
        <TriangleAlert aria-hidden className="text-destructive" />
      ) : (
        <Paperclip aria-hidden />
      )}
      {/* 이름만 자른다. 전문은 툴팁이고 **경로는 화면에 안 뜬다**(§27 텍스트 잘림) */}
      <Tooltip>
        <TooltipTrigger render={<span className="truncate" />}>{chip.name}</TooltipTrigger>
        <TooltipContent>{chip.name}</TooltipContent>
      </Tooltip>
      {uploading ? (
        // 스피너도 진행률도 없다 — 글자가 그 일을 한다(§27 · §비주얼 머리의 모션 두 자리)
        <span className="shrink-0">{t("attachmentField.uploading")}</span>
      ) : (
        // 실패 칩에도 제거 버튼이 그대로 있다 — 치울 수단이 있어야 한다(§27)
        <button
          type="button"
          data-icon="inline-end"
          aria-label={`${chip.name} ${t("attachmentField.removeSuffix")}`}
          className="shrink-0"
          onClick={onRemove}
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </Badge>
  );
}
