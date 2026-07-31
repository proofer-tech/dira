// 릴리즈 노트(R7) — 다 받은 시점에 **앱이 스스로** 만든다. 사람도 빌드도 이 글을 쓰지 않는다.
// 스펙: ../../docs/DESIGN.md §릴리스 · 자동 업데이트 R7 (본문 첫 줄은 R6).
//
// **원본이 원격 API인 이유는 받는 맥에 이 레포가 없어서다.** 번들에 들어가는 것은 엔진 파일
// 넷뿐이고 `.git`은 안 들어간다(§못박는 것 8) — `git log`가 아예 불가능하다.
//
// 이 파일은 네트워크도 프로세스도 직접 만지지 않는다. 둘 다 인자(`Io`)로 받는다. 그래서
// 아래 세 경로를 `release-notes.test.ts`가 electron도 GitHub도 `claude`도 없이 다 밟는다.

/** R6의 사실. **이것이 본문 첫 줄이고 나머지는 전부 장식이다** — 요약이 실패해도, compare가
 *  실패해도 이 줄은 남는다. "업데이트를 받았다"가 요약 실패에 가려지면 안 된다. */
const received = (version: string) => `${version}을 받아뒀습니다. 앱을 다시 켤 때 적용됩니다.`;

/** 커밋 제목이 아무리 많아도 다이얼로그는 스크롤이 없다. 250건(compare API 상한)을 그대로
 *  붙이면 사람이 읽을 수 없고 `claude`에 물릴 프롬프트도 커진다.
 *  ponytail: 앞 20건 + `…외 N건`. 릴리스 간격이 이보다 커지면 그때 구간을 쪼갠다. */
const MAX_TITLES = 20;

export type Io = {
  /** compare API 응답 본문. 네트워크·404·타임아웃 어느 쪽이든 **던진다**. */
  fetchText(url: string): Promise<string>;
  /** `claude -p`의 stdout. 부재·비정상 종료·타임아웃이면 **던진다**. */
  summarize(prompt: string): Promise<string>;
};

/** compare 응답에서 커밋 제목만. 커밋 메시지는 `한 줄 요약 + 본문 + Ticket: <해시>`라 첫 줄이 제목이다. */
function titles(body: string): string[] {
  const commits = JSON.parse(body).commits;
  if (!Array.isArray(commits)) throw new Error("compare 응답에 commits 배열이 없습니다");
  return commits
    .map((c: { commit?: { message?: string } }) => (c.commit?.message ?? "").split("\n")[0].trim())
    .filter(Boolean);
}

function prompt(from: string, to: string, list: string[]): string {
  return [
    `dira ${from} → ${to} 사이의 커밋 제목 목록이다.`,
    "앱 사용자에게 보여줄 변경 요약을 한국어 불릿 3~5줄로 써라. 불릿 말고 다른 말은 쓰지 마라.",
    "제목 형식은 `타입(범위): 한 줄 요약`이고, 본문과 `Ticket: <해시>` 줄은 이미 빠져 있다.",
    "",
    ...list,
  ].join("\n");
}

/** 세 경로 전부 **문자열을 돌려준다**. 절대 던지지 않는다 — 이 함수가 던지면 다이얼로그가 안 뜨고,
 *  그러면 사람은 업데이트를 받았다는 사실 자체를 모른다.
 *
 *  ① 요약 성공 → R6 문장 + 요약문
 *  ② `claude` 부재·비정상 종료·타임아웃 → R6 문장 + **커밋 제목 목록 그대로**
 *  ③ compare 실패(네트워크·404·자리표시자 owner) → **R6 문장만** */
export async function releaseNotes(from: string, to: string, slug: { owner: string; repo: string }, io: Io): Promise<string> {
  let list: string[];
  try {
    const url = `https://api.github.com/repos/${slug.owner}/${slug.repo}/compare/v${from}...v${to}`;
    // 인증 헤더를 붙이지 않는다 — 공개 레포인 것이 R1의 결론이고, 인증 없이 되는 것이 그 값이다.
    list = titles(await io.fetchText(url));
  } catch (e) {
    console.error(`[dira] 릴리즈 노트: compare 실패 — ${(e as Error).message}`);
    return received(to); // ③
  }
  if (!list.length) return received(to);

  const shown = list.slice(0, MAX_TITLES);
  if (list.length > shown.length) shown.push(`…외 ${list.length - shown.length}건`);

  try {
    const summary = (await io.summarize(prompt(from, to, shown))).trim();
    if (summary) return `${received(to)}\n\n${summary}`; // ①
    console.error("[dira] 릴리즈 노트: claude가 빈 출력을 줬습니다");
  } catch (e) {
    console.error(`[dira] 릴리즈 노트: 요약 실패 — ${(e as Error).message}`);
  }
  return `${received(to)}\n\n${shown.map((t) => `• ${t}`).join("\n")}`; // ②
}
