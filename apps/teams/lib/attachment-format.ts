/** 첨부 표기의 조립 - 해체, 순수 문자열 함수만 (DESIGN.md §8 §개정). `node:fs`에 안 걸린다 -
 *  클라이언트 컴포넌트(세션 스트림 - 홈 - 답변 다이얼로그)가 `splitAttachments`를 직접 import한다.
 *  fs를 쓰는 `lib/attachments.ts`를 그 번들에 끌고 들어가면 브라우저 빌드가 깨진다.
 *
 *  `withAttachments`와 `splitAttachments`가 짝인 이유는 표기가 한 곳이어야 하기 때문이다 - 조립을
 *  한 곳에 두고 해체를 다른 곳에 두면 문자열이 바뀔 때 한쪽이 조용히 낡는다. */

/** 프롬프트에 붙는 안내 한 줄. 조립·해체 양쪽이 이 값 하나를 쓴다. */
export const NOTE = "첨부 파일 — 아래 경로를 Read로 읽어라:";

/** 본문 + 첨부 경로 → 프롬프트에 실릴 문자열(§8 §프롬프트에 붙는 모양).
 *
 *  **첨부가 없으면 `text` 그대로다** — 빈 줄 하나도 붙이지 않는다. */
export function withAttachments(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const body = text.trimEnd();
  return (body ? body + "\n\n" : "") + NOTE + "\n" + paths.join("\n");
}

/** `attachments/`를 지나는 절대경로 줄인가 — `splitAttachments`가 꼬리를 판정하는 유일한 기준.
 *  문자열만 본다(실재 확인은 안 한다) — 판정 대상이 아직 저장된 파일인지 여기서 알 수 없다. */
const isAttachmentPathLine = (line: string) => line.startsWith("/") && line.includes("/attachments/");

/** 원문 → `{ body, paths }`(§8 §개정). 판정 대상은 **원문의 마지막 블록 하나**다 - 안내 줄과
 *  글자까지 같은 줄 + 그 뒤로 `attachments/`를 지나는 절대경로 줄만 이어지는 꼬리. 하나라도
 *  어긋나면 `paths`는 빈 배열이고 `body`는 원문 그대로다 - 사람이 손으로 적은 비슷한 문단을
 *  삼키지 않는다. */
export function splitAttachments(text: string): { body: string; paths: string[] } {
  const lines = text.split("\n");
  const noteIdx = lines.lastIndexOf(NOTE);
  if (noteIdx === -1) return { body: text, paths: [] };
  const tail = lines.slice(noteIdx + 1);
  if (tail.length === 0 || !tail.every(isAttachmentPathLine)) return { body: text, paths: [] };
  if (noteIdx === 0) return { body: "", paths: tail }; // withAttachments("", paths)의 모양
  if (lines[noteIdx - 1] !== "") return { body: text, paths: [] }; // 안내 줄 앞 빈 줄이 없다
  return { body: lines.slice(0, noteIdx - 1).join("\n"), paths: tail };
}

/** 저장 파일명(`<8hex>-<정규화 이름>`, `lib/attachments.ts safeName`)에서 8hex 접두를 뗀 표시용
 *  이름(§비주얼 §27 §개정 표 - `alt`·칩 글자). 순수 문자열 연산이라 클라이언트에서 안전하다. */
export function attachmentDisplayName(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.replace(/^[0-9a-f]{8}-/, "");
}

/** `<img>` 축소판으로 그리는 확장자 6종(§비주얼 §27 §개정 표) - `svg`는 새 탭이 문서로 여는
 *  탓에 빠진다(같은 표의 근거). */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);

export function isImageAttachment(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
