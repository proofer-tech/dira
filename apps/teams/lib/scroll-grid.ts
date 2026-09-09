/** 편집기 두 층(`<pre>`·`textarea`)의 `scrollTop`을 줄 격자로 올리는 순수 함수
 *  (§비주얼 §72 ② §개정 몫 ③, 요구 `05092d96`).
 *
 *  12(`p-3`)와 24(`leading-6`)는 두 층에 이미 같이 적힌 값이라 여기서 새로 안 만든다.
 *  `scrollTop <= 12`는 패딩 안이라 걸치는 줄이 0개라 격자 밖이어도 된다. 그보다 크면
 *  `12 + 24 * ceil((scrollTop - 12) / 24)`로 **올린다**(내리면 캐럿이 드러난 자리에서
 *  캐럿 줄이 잘린다). 올린 값이 두 층이 함께 갈 수 있는 최대(`maxScrollTop`)를 넘으면
 *  한 칸(24) 내린다. */
export function snapScrollTopToLineGrid(scrollTop: number, maxScrollTop: number): number {
  const PAD = 12;
  const LINE = 24;
  if (scrollTop <= PAD) return scrollTop;
  const snapped = PAD + LINE * Math.ceil((scrollTop - PAD) / LINE);
  return snapped > maxScrollTop ? snapped - LINE : snapped;
}
