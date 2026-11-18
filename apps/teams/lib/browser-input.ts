/** 홈 `browser` 탭의 랩 레이어가 걷힌 동안 DOM 이벤트를 `cdp/[hash]` POST 본문으로 바꾸는
 *  순수 함수 (§11-11 결정 2 §POST가 입력이다). 라우트가 아는 타입은
 *  `toCdpInputCommand`(`lib/cdp-relay.ts`)의 화이트리스트뿐이라, 여기서 만드는 `type` 값도
 *  그 집합 안에서만 고른다.
 *
 *  ponytail: `button`은 CDP 값(`left`·`middle`·`right`·`none`)으로 직접 매핑한다 — 터치·펜
 *  포인터는 다루지 않는다(마우스 하나로 충분한 수용조건). 늘리면 `pointerType` 분기를 더한다. */

export type MouseCdpBody = {
  type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
  x: number;
  y: number;
  button: "left" | "middle" | "right" | "none";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
};

export type KeyCdpBody = {
  type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
  key: string;
  code: string;
  text?: string;
  /** Chromium은 이 값이 없으면 Backspace-화살표-Enter 같은 기능키를 무시한다. */
  windowsVirtualKeyCode?: number;
  /** CDP 비트마스크 - Alt 1, Ctrl 2, Meta(Cmd) 4, Shift 8. */
  modifiers?: number;
  /** 편집 명령(`selectAll` 등). 원격 브라우저는 macOS 키 바인딩을 모르니 Cmd 조합을 이걸로 옮긴다. */
  commands?: string[];
};

/** 붙여넣기 - 원격 브라우저의 클립보드는 사람 것과 다르다. 사람 쪽 `paste` 사건의 글자를 그대로 넣는다. */
export type InsertTextCdpBody = { type: "insertText"; text: string };

export type KeyMods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
const BUTTONS = ["left", "middle", "right"] as const;

/** DOM `MouseEvent.button`(0·1·2) -> CDP 버튼 이름. 안 눌린 상태(`mouseMoved`)에 쓰는 `none`은
 *  여기서 안 낸다 — 그 값이 필요한 자리(`mouseMovedBody`)가 직접 채운다. */
function cdpButton(domButton: number): "left" | "middle" | "right" | "none" {
  return BUTTONS[domButton] ?? "none";
}

/** 화면에 그려진 `<img>`의 사각형(`rect`) 안에서 클라이언트 좌표를 이미지 원본 해상도
 *  (`naturalWidth`/`naturalHeight`) 좌표로 스케일한다 — CDP `Input.dispatchMouseEvent`의
 *  `x`/`y`는 스크린캐스트 프레임 자신의 픽셀 공간이다(§11-11 결정 2 `maxWidth: 1280`).
 *
 *  ponytail: `devicePixelRatio`·페이지 스크롤을 뺀 뷰포트 오프셋(CDP `screencastFrame`의
 *  메타데이터)은 안 잰다 — 그 메타데이터는 라우트가 프레임에 안 실어 보낸다(결정 2 "`data:`의
 *  값은 CDP가 준 base64 JPEG 그대로다"). 화면에 보이는 이미지와 실제 프레임이 같은 비율로
 *  줄어든다는 전제만으로 충분한 근사다 — 어긋나면 메타데이터를 릴레이에 태우는 것이 다음 자리. */
export function scaleToFrame(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const rx = (clientX - rect.left) / rect.width;
  const ry = (clientY - rect.top) / rect.height;
  return { x: Math.round(rx * natural.width), y: Math.round(ry * natural.height) };
}

/** `object-contain`으로 그려진 `<img>` 상자(`box`) 안에서 실제 그림이 차지하는 내용 사각형과, 그
 *  안의 클릭 한 점을 프레임 픽셀 좌표로 옮긴다(§P466 값 표 §좌표). 위아래 또는 좌우 띠 위의
 *  클릭이나 프레임이 없는 경우(`natural` 0)는 `null`이다. `px`·`py`는 상자 왼쪽 위 기준의 CSS
 *  px(표식을 놓는 자리)이다. `scaleToFrame`에 상자를 그대로 넘기면 띠 만큼 어긋나서 따로 둔다. */
export function commentPoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number; px: number; py: number } | null {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const w = natural.width * scale;
  const h = natural.height * scale;
  const left = box.left + (box.width - w) / 2;
  const top = box.top + (box.height - h) / 2;
  const dx = clientX - left;
  const dy = clientY - top;
  if (dx < 0 || dy < 0 || dx >= w || dy >= h) return null;
  return {
    x: Math.min(natural.width - 1, Math.floor(dx / scale)),
    y: Math.min(natural.height - 1, Math.floor(dy / scale)),
    px: clientX - box.left,
    py: clientY - box.top,
  };
}

/** 마우스 입력 좌표 - 클릭-휠-이동용(P490). `commentPoint`와 같은 내용 사각형 계산으로 띠를
 *  빼고(띠 위는 `null`, POST 안 함), 프레임 픽셀을 뷰포트 CSS px(`viewport`, 스크린캐스트
 *  `metadata.deviceWidth` `deviceHeight`)로 비례 환산한다. `viewport`가 아직 없으면 프레임 픽셀
 *  그대로다. */
export function inputPoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
  viewport: { width: number; height: number } | null,
): { x: number; y: number } | null {
  const hit = commentPoint(clientX, clientY, box, natural);
  if (!hit) return null;
  if (!viewport) return { x: hit.x, y: hit.y };
  return {
    x: Math.round((hit.x * viewport.width) / natural.width),
    y: Math.round((hit.y * viewport.height) / natural.height),
  };
}

export function mouseButtonBody(
  domType: "mousedown" | "mouseup" | "mousemove",
  domButton: number,
  x: number,
  y: number,
): MouseCdpBody {
  const type = domType === "mousedown" ? "mousePressed" : domType === "mouseup" ? "mouseReleased" : "mouseMoved";
  const button = domType === "mousemove" ? "none" : cdpButton(domButton);
  return { type, x, y, button, clickCount: domType === "mousemove" ? undefined : 1 };
}

export function wheelBody(x: number, y: number, deltaX: number, deltaY: number): MouseCdpBody {
  return { type: "mouseWheel", x, y, button: "none", deltaX, deltaY };
}

const NAMED_VK: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20,
  Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46, Meta: 91,
};
const CODE_VK: Record<string, number> = {
  Space: 32, Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191,
  Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
  MetaLeft: 91, MetaRight: 93, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
  AltLeft: 18, AltRight: 18, NumpadEnter: 13,
};
/** 물리 키(`code`)의 US 배열 글자 - [보통, Shift]. 한/영이 한글일 때 `key`로 오는 자모를 되돌린다. */
const CODE_US: Record<string, [string, string]> = {
  Backquote: ["`", "~"], Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"], Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'],
  Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Space: [" ", " "],
};
const DIGIT_SHIFT = ")!@#$%^&*(";

function virtualKeyCode(key: string, code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 96 + Number(code.slice(6));
  if (/^F([1-9]|1[0-2])$/.test(key)) return 111 + Number(key.slice(1));
  return NAMED_VK[key] ?? CODE_VK[code];
}

/** 한글 자모(U+3131-318E)나 조합 중(`Process`)으로 온 키는 원격에 IME가 없어 그대로 넣으면 자모가
 *  찍힌다(실측 a4d2d471 - `hsol`이 `ㅗㄴㅐㅣ`로 들어갔다). 물리 키의 US 글자로 되돌린다. */
export function latinKey(key: string, code: string, shift: boolean): string {
  const hangul = key.length === 1 && key.charCodeAt(0) >= 0x3131 && key.charCodeAt(0) <= 0x318e;
  if (!hangul && key !== "Process") return key;
  if (/^Key[A-Z]$/.test(code)) return shift ? code.slice(3) : code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return shift ? DIGIT_SHIFT[Number(code.slice(5))] : code.slice(5);
  const us = CODE_US[code];
  return us ? us[shift ? 1 : 0] : key;
}

/** Cmd(macOS)-Alt 조합 -> Chromium 편집 명령. 원격 헤드리스는 macOS 키 바인딩이 없어 Cmd+A 같은
 *  조합이 아무 일도 안 하거나 글자로 찍힌다 - Puppeteer가 macOS에서 쓰는 명령 이름과 같다. */
function editCommands(key: string, m: KeyMods): string[] | undefined {
  const sel = m.shiftKey ? "AndModifySelection" : "";
  if (m.metaKey && !m.ctrlKey) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === "a") return ["selectAll"];
    if (k === "z") return [m.shiftKey ? "redo" : "undo"];
    if (k === "x") return ["cut"];
    if (key === "Backspace") return ["deleteToBeginningOfLine"];
    if (key === "Delete") return ["deleteToEndOfLine"];
    if (key === "ArrowLeft") return [`moveToBeginningOfLine${sel}`];
    if (key === "ArrowRight") return [`moveToEndOfLine${sel}`];
    if (key === "ArrowUp") return [`moveToBeginningOfDocument${sel}`];
    if (key === "ArrowDown") return [`moveToEndOfDocument${sel}`];
  }
  if (m.altKey && !m.metaKey && !m.ctrlKey) {
    if (key === "Backspace") return ["deleteWordBackward"];
    if (key === "Delete") return ["deleteWordForward"];
    if (key === "ArrowLeft") return [`moveWordLeft${sel}`];
    if (key === "ArrowRight") return [`moveWordRight${sel}`];
  }
  return undefined;
}

const NO_MODS: KeyMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

/** 사람이 자기 쪽에서 처리해야 하는 조합 - Cmd/Ctrl+V는 `paste` 사건으로, Cmd/Ctrl+C는 원격
 *  클립보드라 의미가 없다. 이 둘은 원격에 안 보내고 기본 동작(붙여넣기 사건)을 막지 않는다. */
export function isLocalClipboardChord(key: string, m: KeyMods): boolean {
  const k = key.toLowerCase();
  return (m.metaKey || m.ctrlKey) && (k === "v" || k === "c");
}

export function keyBody(domType: "keydown" | "keyup", rawKey: string, code: string, mods: KeyMods = NO_MODS): KeyCdpBody {
  const key = latinKey(rawKey, code, mods.shiftKey);
  const modifiers = (mods.altKey ? 1 : 0) | (mods.ctrlKey ? 2 : 0) | (mods.metaKey ? 4 : 0) | (mods.shiftKey ? 8 : 0);
  const windowsVirtualKeyCode = virtualKeyCode(key, code);
  const base = { key, code, modifiers, ...(windowsVirtualKeyCode !== undefined ? { windowsVirtualKeyCode } : {}) };
  if (domType === "keyup") return { type: "keyUp", ...base };
  const commands = editCommands(key, mods);
  if (commands) return { type: "rawKeyDown", ...base, commands };
  // 글자를 내는 키 - Cmd/Ctrl이 같이 눌렸으면 단축키라 글자를 안 싣는다(Alt는 macOS에서 특수문자다).
  // Enter는 `\r`을 실어야 폼 제출-줄바꿈이 된다(CDP 계약, Puppeteer와 같다).
  const text = key === "Enter" ? "\r" : key.length === 1 && !mods.metaKey && !mods.ctrlKey ? key : undefined;
  return text !== undefined ? { type: "keyDown", ...base, text } : { type: "rawKeyDown", ...base };
}
