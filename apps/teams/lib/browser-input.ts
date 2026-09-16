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
};

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

const DOM_KEY_TYPE: Record<"keydown" | "keyup", "keyDown" | "keyUp"> = { keydown: "keyDown", keyup: "keyUp" };

export function keyBody(domType: "keydown" | "keyup", key: string, code: string): KeyCdpBody {
  const type = DOM_KEY_TYPE[domType];
  // 출력 가능한 단일 글자 keydown은 `text`도 실어 `Input.dispatchKeyEvent`가 문자 입력까지
  // 낸다(CDP 계약 — `char` 커맨드 없이 `keyDown`에 `text`를 실으면 그걸로 입력이 된다).
  return type === "keyDown" && key.length === 1 ? { type, key, code, text: key } : { type, key, code };
}
