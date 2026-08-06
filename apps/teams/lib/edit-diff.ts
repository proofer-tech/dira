/** Edit `tool_use`의 펼친 diff — 순수 함수(§2-1 §펼친 Edit · §비주얼 §9 diff 블록, 요구 `ad8f4424`).
 *
 *  LCS(최장 공통 부분열) 기반 줄 단위 diff. **새 의존성을 안 들인다** — 표준 DP 30줄 안이고,
 *  §9가 헝크(`@@`)도 문맥 접기도 없다고 이미 판정해서(문맥 3줄 유니파이드와 전문 diff의 줄 수가
 *  거의 같다는 실측) `diff`/`jsdiff` 같은 라이브러리가 주는 것(유니파이드 포맷·헝크·word diff)을
 *  하나도 안 쓴다.
 *
 *  **꼬리 빈 칸을 버린다**(§9): `\n`으로 나눈 뒤 마지막 칸이 빈 문자열이면 버린다. 안 버리면
 *  꼬리 개행이 한쪽에만 있을 때 내용 없는 `-`/`+` 한 쌍이 뜨고, 빈 문자열 쪽에서 빈 `+`/`-` 줄이 선다. */

export type DiffLine = { kind: "-" | "+" | " "; text: string };

function splitLines(s: string): string[] {
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `old`→`new` 줄 단위 diff. `dp[i][j]` = `a[i..]`·`b[j..]`의 LCS 길이. 그 표를 앞에서부터
 *  따라가며 공통 줄은 그대로, 아니면 더 긴 쪽으로 가는 변을 골라 `-`/`+`를 낸다. */
export function lineDiff(oldStr: string, newStr: string): DiffLine[] {
  const a = splitLines(oldStr);
  const b = splitLines(newStr);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "-", text: a[i] });
      i++;
    } else {
      out.push({ kind: "+", text: b[j] });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: "-", text: a[i++] });
  while (j < b.length) out.push({ kind: "+", text: b[j++] });
  return out;
}
