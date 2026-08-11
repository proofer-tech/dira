/** §5-1 §상한 둘 — 스킬 import 파일 수 · 총 바이트. `attachment-limit.ts`와 같은 이유로 이
 *  파일에는 import가 없다: `node:fs`를 쓰는 `lib/skills.ts`는 클라이언트 번들에 못 들어간다.
 *  화면(사전 거절)과 서버(`installSkill`)가 같은 이 함수를 불러 같은 문장을 쓴다
 *  (DESIGN.md §비주얼 §25 ⑤ — "화면이 먼저 거절하는 둘이 서버와 같은 문장을 쓴다"). */
import { MAX_BYTES } from "./attachment-limit.ts";

/** 실측 최대(§5-1)의 위 여유. 벽이지 여유가 아니다 — 넘으면 거절하고 사유에 수를 적는다. */
export const MAX_SKILL_FILES = 200;

/** 넘으면 §비주얼 §25 ⑤ 표의 갈래 3·4(문장 둘), 아니면 `null`. */
export function skillUploadError(
  fileCount: number,
  totalBytes: number,
): { title: string; message: string } | null {
  if (fileCount > MAX_SKILL_FILES) {
    return {
      title: `설치할 파일이 상한 ${MAX_SKILL_FILES}개를 넘습니다`,
      message: `${fileCount}개`,
    };
  }
  if (totalBytes > MAX_BYTES) {
    return {
      title: `설치할 파일의 합계가 상한 ${MAX_BYTES / 1024 / 1024}MB를 넘습니다`,
      message: `${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
    };
  }
  return null;
}
