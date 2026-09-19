/** 배포 다이얼로그(`DeployButton`, `components/personas-ui.tsx`)의 순수 판정 둘. `node:fs`를
 *  쓰는 `lib/market.ts`는 클라이언트 번들에 못 들어간다(`lib/skill-upload-limit.ts`와 같은
 *  이유) — 그래서 이 폼 판정만 따로 낸다. JSX는 `node --test`가 못 읽으므로 컴포넌트의 순수
 *  판정은 여기서 검증한다(`lib/urls.ts`와 같은 관용구). */

/** 노트가 비었을 때 "왜 배포 버튼이 막혔는지" 알리는 문구 번역 키(DESIGN.md §수용조건 3 뒷부분).
 *  값이 있으면 배포 가능이라 `null`, 없으면 이 키를 다이얼로그에 띄운다. */
export function deployNoteHintKey(note: string): string | null {
  return note.trim() === "" ? "market.deploy.noteRequiredHint" : null;
}

/** 배포 결과 뒤 폼(노트-태그)을 비워야 하는지. 성공했을 때만 비운다 - 실패한 값은 사람이 고쳐
 *  다시 누르도록 남겨 둔다. */
export function shouldResetDeployForm(result: { ok: boolean }): boolean {
  return result.ok;
}
