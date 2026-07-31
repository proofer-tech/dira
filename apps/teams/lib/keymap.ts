/** 키맵 — 기본값 · 조합 매칭 · 충돌 검증 (DESIGN.md §0-6).
 *
 *  **기본값은 코드에 살고 파일은 바꾼 것만 담는다.** 그래서 기본키를 나중에 옮기면 손대지 않은
 *  사람의 키가 같이 따라온다 — 파일이 전부를 담으면 첫 저장 시점의 기본값이 영원히 굳는다.
 *
 *  **이 파일에는 `node:*`가 없다.** 키를 듣는 것도 그리는 것도 클라이언트 컴포넌트라
 *  (전환기 · 참견 칸 · 설정 다이얼로그) 여기가 번들로 간다 — `lib/urls.ts`가 순수한 것과 같은
 *  이유다(AGENTS.md). 그래서 **파일 읽기/쓰기(`keymapPath`·`readKeymap`·`writeKeymap`)는
 *  `lib/projects.ts`에 있다**: `registryPath()` 옆이고, 그 파일은 이미 `$LOCAL`의 주인이다.
 *  실측 — 여기서 `registryPath()`를 import하면(정적이든 `await import`든) 빌드가
 *  `chunking context does not support external modules (request: node:fs/promises)`로 깨진다. */

export type ActionId =
  | "project.search"
  | "settings.open"
  | "board.search"
  | "board.new"
  | "board.request"
  | "nav.board"
  | "nav.workers"
  | "interject.send";

export type KeyAction = {
  id: ActionId;
  /** 목록 화면이 그리는 이름. 액션 id는 사람에게 보이지 않는다 */
  name: string;
  /** 어디서 듣는 키인가 — 같은 조합이 화면마다 다른 일을 한다는 오해를 막는 열 */
  scope: string;
  combo: string;
};

/** §0-6 액션 표. **순서가 목록의 순서다**(전역 → 보드 → 이동 → 입력칸). */
export const DEFAULT_KEYMAP: KeyAction[] = [
  { id: "project.search", name: "프로젝트 검색", scope: "전역", combo: "Mod+k" },
  { id: "settings.open", name: "설정 열기", scope: "전역", combo: "?" },
  { id: "board.search", name: "보드 검색", scope: "보드", combo: "/" },
  { id: "board.new", name: "티켓 발행", scope: "보드", combo: "n" },
  { id: "board.request", name: "요구 접수", scope: "보드", combo: "r" },
  { id: "nav.board", name: "보드로 이동", scope: "프로젝트", combo: "b" },
  { id: "nav.workers", name: "워커로 이동", scope: "프로젝트", combo: "w" },
  { id: "interject.send", name: "참견 보내기", scope: "참견 입력칸", combo: "Mod+Enter" },
];

export type Bindings = Record<ActionId, string>;

export type Keymap = {
  /** **8개 액션 전부.** 파일이 없어도 깨져도 완전하다 — 화면이 빈 칸을 그릴 일이 없다 */
  bindings: Bindings;
  /** 파일이 있는데 못 읽었다. 값으로 돌려주는 이유는 **화면이 말해야** 하기 때문이다 —
   *  조용히 기본값으로 돌아가면 사람은 자기가 바꾼 키가 왜 안 듣는지 알 길이 없다 */
  broken: boolean;
};

/** 기본값만으로 만든 완전한 바인딩. `readKeymap()`이 이 위에 파일을 얹는다. */
export function defaultBindings(): Bindings {
  return Object.fromEntries(DEFAULT_KEYMAP.map((a) => [a.id, a.combo])) as Bindings;
}

// ── ① 조합 ──────────────────────────────────────────────────────────────────

/** 조합 표기: `Mod+Alt+Shift+<키>`. 조합자는 **이 순서**로만 적는다(우리가 만드는 값이다).
 *  `<키>`는 `e.key` 그대로고 글자만 소문자다 — 그래서 `+` 자체도 키가 될 수 있다. */
type Combo = { mod: boolean; alt: boolean; shift: boolean; key: string };

function parseCombo(combo: string): Combo {
  let rest = combo;
  const take = (m: string) => {
    const has = rest.startsWith(m + "+");
    if (has) rest = rest.slice(m.length + 1);
    return has;
  };
  return { mod: take("Mod"), alt: take("Alt"), shift: take("Shift"), key: normalizeKey(rest) };
}

/** `e.key` → 조합에 적는 키. 글자는 대소문자를 지운다(Shift로 갈리지 않는다),
 *  공백은 이름으로 적는다(JSON에 `" "`가 들어가면 사람이 못 읽는다). */
export function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

/** DOM `KeyboardEvent`가 그대로 들어맞는 최소 모양. React 합성 이벤트는 `isComposing`이
 *  없으므로 `e.nativeEvent`를 넘긴다. */
export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

/** **`isComposing`이면 무조건 false.** 한글 조합 중의 `Enter`는 글자를 확정하는 키지
 *  우리 키가 아니다 — 이 한 줄이 없으면 참견 칸에서 받침을 칠 때마다 글이 날아간다.
 *
 *  ponytail: `Shift`는 **있으라고 할 때만** 본다(없음은 안 따진다). `?`는 `Shift+/`로 치지만
 *  `e.key`가 이미 `?`라 아래를 뒤집으면 §0-6 기본키 하나가 영영 안 듣는다. */
export function matchCombo(e: KeyLike, combo: string): boolean {
  if (e.isComposing) return false;
  const c = parseCombo(combo);
  if (!c.key) return false;
  if (c.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (c.alt !== e.altKey) return false;
  if (c.shift && !e.shiftKey) return false;
  return normalizeKey(e.key) === c.key;
}

const KEY_GLYPH: Record<string, string> = {
  Enter: "↵",
  Space: "␣",
  Escape: "Esc",
  Tab: "⇥",
  Backspace: "⌫",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** **화면에 키를 적는 코드는 이 함수만 쓴다.** 맥이 아닌 데서도 `Mod`는 `⌘`으로 적는다 —
 *  `matchCombo`가 `ctrlKey`를 같이 받는 것과 짝이고, 지금 박혀 있는 `⌘K`·`⌘↵`가 그 선례다
 *  (`session-stream.tsx:313`). 조합자 순서는 맥 관례(`⌥⇧⌘`)다. */
export function formatCombo(combo: string): string {
  const c = parseCombo(combo);
  const key = KEY_GLYPH[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  return `${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${key}`;
}

// ── ② 검증 ──────────────────────────────────────────────────────────────────

export type BindingError = {
  /** 화면에 그대로 뜨는 사유 (§비주얼 §22 ③) */
  reason: string;
  /** 충돌일 때 **상대 액션의 id**. 화면이 이 값으로 이름·줄을 찾는다 */
  conflict?: ActionId;
};

const MODIFIERS = new Set(["Meta", "Control", "Shift", "Alt", ""]);

/** 받침이 있으면 `과`. 이름은 우리가 정한 한글이라(§0-6 액션 표) 이 판정으로 충분하다. */
const wa = (s: string) => ((s.charCodeAt(s.length - 1) - 0xac00) % 28 ? "과" : "와");

/** 못 쓰는 키를 거르고 겹치는 액션을 찾는다. `null`이면 지정해도 된다.
 *
 *  범위(`scope`)를 보지 않는 것은 의도다 — 보드에서만 듣는 키라도 같은 조합이 둘이면
 *  목록에서 어느 쪽이 이기는지 사람이 읽을 수 없다. 큐 하나에 액션 8개다. */
export function validateBinding(
  bindings: Bindings,
  actionId: ActionId,
  combo: string,
): BindingError | null {
  const c = parseCombo(combo);
  if (MODIFIERS.has(c.key)) return { reason: "조합키만으로는 지정할 수 없습니다." };
  if (c.key === "Escape") return { reason: "`Esc`는 닫기·취소에 쓰입니다." };
  if (c.key === "Tab") return { reason: "`Tab`은 초점 이동에 쓰입니다." };
  if (!c.mod && (c.key === "Enter" || c.key === "Space")) {
    return { reason: "`↵`·`Space`는 `⌘`과 같이 눌러야 합니다. 버튼을 누르는 키입니다." };
  }
  for (const a of DEFAULT_KEYMAP) {
    if (a.id !== actionId && bindings[a.id] === combo) {
      return { conflict: a.id, reason: `${a.name}${wa(a.name)} 겹칩니다.` };
    }
  }
  return null;
}
