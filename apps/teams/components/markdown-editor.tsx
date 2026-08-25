"use client";

/** 위지윅·원문 두 면과 토글 손잡이 (DESIGN.md §비주얼 §50 · 로드맵 §P236-3). 자리 일곱에 한 벌이
 *  서야 하는 컴포넌트라(§5 커스텀 표 10번째) **손잡이의 자리 · `breaks` 분배를 호출부가 안 정한다**
 *  — 호출부는 `label`(있는 칸만) · `breaks`(그 글이 렌더되는 자리의 값) · `defaultValue`만 준다.
 *
 *  **직렬화 방식은 `98052584`의 판정 그대로다** — mdast `position`으로 최상위 블록의 원문 구간만
 *  잘라 쓴다(`lib/markdown-editor-blocks.ts`). 안 고친 블록은 슬라이스 그대로 다시 이어붙이므로
 *  항등이 유지되고(못 ①), 고친 블록만 그 파일의 `domToMarkdown`이 편집된 DOM을 되읽어 갈아 끼운다.
 *
 *  **위지윅 면은 읽기 전용 렌더(`<Markdown>`, §10)를 블록별로 그대로 재사용한다** — 값을 두 벌로
 *  베끼지 않는다. 블록마다 감싼 `contentEditable`이 편집 표면이고, 포커스가 있는 동안 그 블록의
 *  `text`가 안 바뀌므로(오직 `blur`에서만 갱신) React가 그 DOM을 다시 안 건드려 캐럿이 안 죽는다.
 *
 *  `domToMarkdown`은 `unified`가 아니라 **직접 DOM을 걷는 손수 변환기다.** `hast-util-to-mdast`류의
 *  역방향 변환 패키지가 이 레포에 없고(정방향 `mdast-util-to-hast`만 `react-markdown`이 물고 있다),
 *  대상 태그가 `components/markdown.tsx`의 고정된 컴포넌트 열 하나뿐이라(h1~6·p·ul/ol/li·표·pre·
 *  blockquote·hr·strong/em/code/a) 새 의존성 없이 그 역방향만 손으로 짜는 쪽이 더 작다.
 *  // ponytail: 중첩 표·표 열 변경(행·열 추가)·각주는 다루지 않는다 — §50 §도구 모음이 그 편집을
 *  // 원문 면으로 넘긴 것과 같은 경계다. 필요해지면 표는 열 수를 셀 DOM에서 다시 세는 코드를 더한다.
 *
 *  **제출은 `blur`를 안 지날 수 있다** — `⌘↵`가 `requestSubmit()`으로 폼을 곧장 제출하면 마지막
 *  블록의 `blur` 커밋이 안 일어난 채로 hidden input이 읽힌다(사고 `33b7cb27` — 위지윅으로 친
 *  요구 접수 본문이 앞부분만 남았다). 그래서 이 컴포넌트는 자기 폼의 `submit`을 캡처 단계에서
 *  가로채(`useEffect`) 그 순간 포커스가 있던 편집 표면을 `commitEditable`로 강제 되읽고, hidden
 *  input의 DOM 값을 **`setText`(React state) 전에 직접** 써 넣는다 — React 19의 `<form action>`은
 *  같은 `submit` 이벤트의 뒤쪽(버블) 단계에서 폼 값을 읽으므로, state가 실제로 리렌더에 반영되는
 *  시점을 기다리면 늦는다. 호출부는 아무것도 안 해도 된다: 자리가 이 컴포넌트 안이라 칸 일곱이
 *  같이 닫힌다. */
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { Code, Pilcrow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/markdown";
import { useKeymap } from "@/components/keymap-provider";
import { useT } from "@/components/language-provider";
import { matchCombo } from "@/lib/keymap";
import type { Vault } from "@/lib/markdown-wikilinks";
import { cn } from "@/lib/utils";
import { blockBreaks, commitEditable, resolveSplit } from "@/lib/markdown-editor-blocks";

/** 앱 하나짜리 값(못 ② — 칸마다 안 갈린다). §0-11 `dira-manual-theme`와 같은 자리의 키다. */
const MODE_KEY = "dira-markdown-editor-mode";
type Mode = "wysiwyg" | "raw";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "raw" ? "raw" : "wysiwyg";
  } catch {
    return "wysiwyg"; // 사파리 프라이빗 등 — §0-11과 같은 관용
  }
}

/** `useEffect` 안에서 곧바로 `setMode(...)`를 부르면 이 앱의 lint(`react-hooks/set-state-in-effect`)가
 *  에러로 잡는다(`use-mobile.ts`와 같은 사유). 값이 앱 하나짜리라(못 ②) 모든 칸이 같은 값을 보게
 *  `useSyncExternalStore`로 옮긴다 — `writeMode`가 이 리스너들을 불러 다른 칸도 같이 갈아 낀다. */
const modeListeners = new Set<() => void>();
function subscribeMode(onChange: () => void) {
  modeListeners.add(onChange);
  return () => {
    modeListeners.delete(onChange);
  };
}
const SERVER_MODE: Mode = "wysiwyg"; // 서버·첫 페인트는 항상 위지윅(하이드레이션 불일치를 피한다)

function writeMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* 이번 세션만 안 남을 뿐이라 삼킨다 */
  }
  modeListeners.forEach((onChange) => onChange());
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────

export function MarkdownEditor({
  name,
  defaultValue,
  value: controlledValue,
  onValueChange,
  label,
  placeholder,
  breaks,
  rows = 12,
  className,
  onChange,
  required,
  ariaLabel,
  onPaste,
  onKeyDown,
  autoFocus,
  vault,
}: {
  name: string;
  /** 비제어 초기값 — 부모가 dirty 판정·리셋을 안 하는 자리(①)만 쓴다 */
  defaultValue?: string;
  /** 제어값 — 부모가 값을 들고 있어야 하는 자리(②③④, 닫기 확인·`⌘↵` 제출이 현재 글을 봐야 한다)가
   *  쓴다. 주면 `onValueChange` 없이는 못 고친다 */
  value?: string;
  onValueChange?: (text: string) => void;
  /** 칸 위 라벨(①②만 준다) — 손잡이가 칸 안으로 들어가(§50 개정) 이 줄에 라벨만 남는다.
   *  없으면 그 줄 자체가 없다(③④⑤⑥⑦) */
  label?: ReactNode;
  placeholder?: string;
  /** 그 글이 렌더되는 자리의 값(§10 표) — 이 컴포넌트가 스스로 정하지 않는다(못 ⑤) */
  breaks?: "all" | "untilHeading";
  rows?: number;
  className?: string;
  /** 폼 제출(hidden input)이 아니라 부모가 글자 수·되돌리기·저장 버튼을 직접 드는 자리(⑤⑥⑦)를
   *  위한 거울 콜백이다 — `value`를 안 주면 이 컴포넌트가 여전히 자기 `text`를 스스로 들고
   *  (uncontrolled), 매 갱신을 부모에도 알린다. 되돌리기는 부모가 `key`를 바꿔 이 컴포넌트를
   *  다시 마운트하는 방식으로 앞선다. */
  onChange?: (text: string) => void;
  /** 원문 면(`Textarea`)에는 네이티브 `required`로 걸린다. 위지윅 면은 제출값이 hidden input이라
   *  브라우저 제약 검증에서 제외되므로(barred) 실제 차단은 호출부가 제어값을 보고 제출을 막는다 —
   *  여기서는 편집 표면에 `aria-required` 힌트만 얹는다. */
  required?: boolean;
  ariaLabel?: string;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** 열릴 때 캐럿을 이 편집 표면에 둔다(§3 §열리면 첫 포커스) — 원문 면은 `Textarea`가 네이티브
   *  `autoFocus`를 그대로 받고(React가 form 요소에 폴리필한다), 위지윅 면은 `div`라 그 폴리필이
   *  안 먹어 아래 마운트 effect가 직접 `.focus()`한다. 호출부가 안 주면 종전대로다(못 ⑤ 같은 원칙 —
   *  이 컴포넌트가 스스로 켜지 않는다). */
  autoFocus?: boolean;
  /** 이름 -> href 벌(§비주얼 §10 §위키링크) — 위지윅 면이 읽기 전용 렌더를 그대로 재사용하므로
   *  (위 top 주석) 호출부가 이 표를 안 주면 종전대로 `[[이름]]`이 글자다. 이 컴포넌트가 스스로
   *  읽지 않는다 — 못 ⑤와 같은 원칙, 서버가 한 번 읽어 내려준 값을 그대로 흘린다. */
  vault?: Vault;
}) {
  const t = useT();
  const mode = useSyncExternalStore(subscribeMode, readMode, () => SERVER_MODE);
  const [innerText, setInnerText] = useState(defaultValue ?? "");
  const text = controlledValue ?? innerText;
  // 제어(`value` 있음)면 부모(`onValueChange`)가 유일한 값의 주인이다. 아니면 이 컴포넌트가
  // `text`를 스스로 들고, 갱신마다 `onChange` 거울만 부모에 알린다(⑤⑥⑦ — 글자 수·되돌리기용).
  function setText(next: string | ((prev: string) => string)) {
    const resolved = typeof next === "function" ? (next as (prev: string) => string)(text) : next;
    if (controlledValue !== undefined) onValueChange?.(resolved);
    else {
      setInnerText(resolved);
      onChange?.(resolved);
    }
  }

  const split = useMemo(() => resolveSplit(mode, text), [text, mode]);

  function commitActiveEditable(el: Element) {
    const next = commitEditable(el, split);
    if (next !== null) setText(next);
  }

  // 폼의 `submit`을 캡처 단계에서 가로챈다(위 파일 top 주석 §제출은 blur를 안 지날 수 있다).
  // `split`·`mode`·`setText`가 리렌더마다 새로 잡히므로, 리스너는 마운트에 한 번만 달고(붙였다
  // 뗐다를 매 렌더 반복 안 하려고) 실제 로직은 이 ref로 최신 값을 받는다.
  const rootRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const commitOnSubmitRef = useRef<() => void>(() => {});

  // §50 §`⌘↵`는 커밋을 지나서 전파된다. `onKeyDown`을 그냥 부르면 지금 렌더가 쥔 옛 함수라
  // 그 안의 `body`가 여전히 커밋 전 값이다(호출부는 안 고친다는 계약이라 그 함수 자체를
  // 새로 못 만든다) — `commitOnSubmitRef`와 같은 이유로 매 렌더 최신 함수를 ref에 갈아 끼우고,
  // `flushSync`로 커밋을 동기 반영해 그 갈아 끼움이 우리가 부르기 전에 끝나게 한다.
  const sendCombo = useKeymap().bindings["interject.send"];
  const onKeyDownRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    onKeyDownRef.current = onKeyDown;
  });
  function handleEditableKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    // 다른 `Mod+*`(붙여넣기·되돌리기 등)에는 커밋을 안 건다(§50 판정 4) — 타이핑 중 캐럿이
    // 죽는 것과 같은 문제라 이 키 하나로 좁힌다.
    if (matchCombo(e.nativeEvent, sendCombo)) {
      flushSync(() => commitActiveEditable(e.currentTarget));
      // 빈 칸(블록 0개)에서 처음 커밋하면 splitBlocks가 그 텍스트를 블록으로 다시 쪼개
      // placeholder 표면이 blocks.map 표면으로 갈아 끼워진다(§P236-1 영역) — 그 remount로
      // e.currentTarget이 트리에서 빠진 옛 노드가 되면 호출부의 `e.currentTarget.closest("form")`이
      // null을 짚는다. 폼 탐색은 그릇 안 어느 후손에서 시작해도 같은 값이라, 절대 안 갈리는
      // 루트로 옮겨 둔다(React가 이 이벤트 처리 끝에 null로 되돌리므로 우리 호출 안에만 있다).
      e.currentTarget = rootRef.current ?? e.currentTarget;
    }
    onKeyDownRef.current?.(e); // 면이 키를 먹지 않는다 — 커밋 뒤 그대로 호출부로 넘긴다(못 ③)
  }

  // 사라진 라벨 문장을 그대로 접근명 + 툴팁으로 옮긴다(§50 §접근명) — 화면 글자는 아이콘 하나뿐이다.
  const toggleLabel = mode === "wysiwyg" ? t("markdownEditor.toggle.toRaw") : t("markdownEditor.toggle.toWysiwyg");

  // 위지윅 면의 첫 편집 표면 — 마운트 때 한 번 초점을 준다(원문 면은 `Textarea`의 네이티브
  // `autoFocus`가 대신한다). 다이얼로그가 열릴 때마다 이 컴포넌트가 새로 마운트되므로 재열 때도
  // 다시 잡힌다.
  const firstEditableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus && mode === "wysiwyg") firstEditableRef.current?.focus();
    // 마운트 한 번만 — 이후 면 전환은 사람이 손잡이를 눌러 하는 것이라 재초점 대상이 아니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // render 중 ref 대입은 react-hooks/refs가 막는다 — 매 렌더 뒤 effect에서 최신 클로저로 갈아 낀다.
  useEffect(() => {
    commitOnSubmitRef.current = () => {
      if (mode !== "wysiwyg") return; // 원문 면은 Textarea가 매 타이핑마다 이미 값을 물고 있다
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || !(active instanceof HTMLElement) || !active.isContentEditable || !root.contains(active)) return;
      const next = commitEditable(active, split);
      if (next === null) return;
      if (hiddenInputRef.current) hiddenInputRef.current.value = next; // state 리렌더 전에 값을 넣는다
      setText(next);
    };
  });
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onSubmit = () => commitOnSubmitRef.current();
    form.addEventListener("submit", onSubmit, { capture: true });
    return () => form.removeEventListener("submit", onSubmit, { capture: true });
  }, []);

  const toggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={toggleLabel}
            tabIndex={-1}
            onClick={() => writeMode(mode === "wysiwyg" ? "raw" : "wysiwyg")}
            className="absolute top-2 right-2 opacity-60 hover:opacity-100 focus-visible:opacity-100"
          >
            {mode === "wysiwyg" ? <Code aria-hidden /> : <Pilcrow aria-hidden />}
          </Button>
        }
      />
      <TooltipContent>{toggleLabel}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="space-y-2" ref={rootRef}>
      {label}
      {/* 칸만 감싸는 래퍼(§50 §어디에 서나) — 손잡이는 이 안의 `absolute`고, 테두리·반경·포커스
          링은 옮기지 않고 `Textarea`/위지윅 그릇에 그대로 둔다. 손잡이가 칸보다 DOM에서
          앞이어야 하므로(§50 §탭 순서, 무수정) 이 블록 안에서 toggle을 먼저 그린다. */}
      <div className="relative">
        {toggle}
        {mode === "raw" ? (
          <Textarea
            name={name}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            rows={rows}
            placeholder={placeholder}
            className={cn("pr-11", className)}
            required={required}
            aria-label={ariaLabel}
            autoFocus={autoFocus}
          />
        ) : (
          <div className="rounded-lg border border-input bg-transparent py-2 pl-2.5 pr-11 dark:bg-input/30">
            {/* 칸 바닥(§50 §갈리는 칸) — 84px(세 줄)의 최소 높이는 이 그릇 하나에 걸고 블록마다
                안 건다. 안의 `min-h-7`(빈 문단·placeholder)은 무수정이다. */}
            <div className="min-h-[84px]">
              {split.head && (
                <div
                  data-head=""
                  contentEditable
                  suppressContentEditableWarning
                  aria-label="frontmatter"
                  className="rounded-md bg-muted p-3 overflow-x-auto font-mono text-sm whitespace-pre-wrap mb-3"
                  onBlur={(e) => commitActiveEditable(e.currentTarget)}
                  onPaste={onPaste}
                  onKeyDown={handleEditableKeyDown}
                >
                  {split.head}
                </div>
              )}
              {split.blocks.length === 0 ? (
                <div
                  ref={firstEditableRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder={placeholder ?? ""}
                  aria-label={ariaLabel}
                  aria-required={required || undefined}
                  className="min-h-7 text-base leading-7 outline-none empty:before:whitespace-pre-line empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
                  onBlur={(e) => commitActiveEditable(e.currentTarget)}
                  onPaste={onPaste}
                  onKeyDown={handleEditableKeyDown}
                />
              ) : (
                split.blocks.map((block, i) => (
                  <div
                    // 인덱스+내용 키(DESIGN.md §비주얼 §50 §커밋 뒤의 블록은 원문의 렌더 그대로다) —
                    // `key={i}`만 쓰면 커밋으로 그 블록의 `text`가 갈려도 React는 같은 DOM 노드에
                    // 새 `<Markdown>` 트리를 겹쳐 그린다(diff 기준이 사람이 `contentEditable`로
                    // 직접 고친 DOM이 아니라 앞 커밋의 렌더라서). 내용을 키에 실으면 그 블록만
                    // 키가 바뀌어 React가 노드를 통째로 새로 만든다 — 사람이 만든 노드가 하나도
                    // 안 남는다. 안 갈린 블록은 키가 그대로라 재마운트가 없다.
                    // `data-block-index`는 제출 가로채기가 `document.activeElement`에서 이 `i`를
                    // 되찾는 자리다(`lib/markdown-editor-blocks.ts`의 `commitEditable`).
                    key={`${i}:${block}`}
                    ref={i === 0 ? firstEditableRef : undefined}
                    data-block-index={i}
                    contentEditable
                    suppressContentEditableWarning
                    aria-label={ariaLabel}
                    aria-required={required || undefined}
                    className="outline-none [&_p:empty]:min-h-7"
                    onBlur={(e) => commitActiveEditable(e.currentTarget)}
                    onPaste={onPaste}
                    onKeyDown={handleEditableKeyDown}
                  >
                    <Markdown
                      text={block}
                      breaks={blockBreaks(i, breaks, split.firstHeadingIndex)}
                      vault={vault}
                    />
                  </div>
                ))
              )}
            </div>
            <input ref={hiddenInputRef} type="hidden" name={name} value={text} />
          </div>
        )}
      </div>
    </div>
  );
}
