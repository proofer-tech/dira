/** 의견 → GitHub 프리필 URL (DESIGN.md §0-12 §이슈로 가는 길 · §이슈 내용).
 *
 *  **순수 함수뿐이다.** 여는 것은 `window.open`이고(§0-12 — `setWindowOpenHandler`가 이미
 *  `shell.openExternal`로 보낸다. 새 IPC 0개) 그것을 부르는 것은 클라이언트라
 *  `urls.ts`와 같은 축이다: **`node:*`를 import하지 않는다.**
 *
 *  `urls.ts`에 안 얹은 이유는 저기가 앱 안 경로를 만드는 파일이고 여기는 앱 밖으로 나가는
 *  URL 하나이기 때문이다 — 상한·자르기가 같이 살 자리가 없다. */

import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

/** 레포는 하나다(§0-12). 값이 바뀔 일이 없으므로 config로 빼지 않는다. */
const NEW_ISSUE = "https://github.com/proofer-tech/dira/issues/new";

/** **URL 상한 — 실측값이다**(2026-08-02, `curl -o /dev/null -w '%{http_code}'`로 GitHub에 직접).
 *  전체 URL 6,955바이트까지는 302(정상 응답)고 **7,009바이트부터 500**, 8,260바이트부터 414다.
 *  스펙이 값을 안 정해 developer가 6,000으로 잡았다 — 절벽에서 14% 아래이고 한글 약 660자다
 *  (한글 한 자 = `%EA%B0%80` 9바이트). GitHub가 문턱을 조금 내려도 안 깨진다.
 *  ponytail: 상수 하나. 상한이 자주 바뀌면 그때 실측을 다시 한다. */
const MAX_URL = 6000;

/** 이슈에 같이 실리는 두 줄. **폼이 이 값을 그대로 보여 준 뒤에 보낸다**(§0-12).
 *  값을 만드는 곳은 서버(`app/actions.ts`의 `feedbackMetaAction`)다 — 둘 다 `process.env`와
 *  `$TICKET_LOCAL` 파일에서 온다. */
export type FeedbackMeta = {
  /** `0.1.4 (desktop)` */
  version: string;
  /** `<install_id>/<session_id>` (§0-11) */
  session: string;
};

/** `의견 — <첫 줄 40자>`. 코드포인트로 센다 — `slice`로 자르면 이모지가 반쪽 나고
 *  그 반쪽은 `encodeURIComponent`가 던진다. */
export function issueTitle(text: string, locale: Locale = DEFAULT_LOCALE): string {
  const first = text.trim().split("\n", 1)[0].trim();
  return `${t(locale, "feedback.titlePrefix")}${Array.from(first).slice(0, 40).join("")}`;
}

/** 본문 = 사람이 쓴 내용 + 구분선 + 두 줄. **그 외에 아무것도 안 넣는다**(§0-12).
 *  자른 사실도 여기 안 적는다 — 그건 폼이 알려 준다(`truncated`). */
function tailOf(meta: FeedbackMeta, locale: Locale): string {
  return `\n\n---\n- ${t(locale, "feedback.versionLabel")}: ${meta.version}\n- ${t(locale, "feedback.sessionLabel")}: ${meta.session}`;
}

/** 프리필 URL 하나. `truncated`면 본문 뒤가 잘렸고 **폼이 그 사실을 말해야 한다**(§0-12).
 *
 *  자르는 단위는 코드포인트다. `encodeURIComponent`는 코드포인트마다 독립이라
 *  (앞뒤 문맥을 안 본다) 한 자씩 인코딩 길이를 더해 예산을 세면 전체 길이와 정확히 같다. */
export function issueUrl(
  text: string,
  meta: FeedbackMeta,
  locale: Locale = DEFAULT_LOCALE,
): { url: string; truncated: boolean } {
  const tail = tailOf(meta, locale);
  const head = `${NEW_ISSUE}?title=${encodeURIComponent(issueTitle(text, locale))}&body=`;
  const budget = MAX_URL - head.length - encodeURIComponent(tail).length;

  let used = 0;
  let kept = "";
  let truncated = false;
  for (const ch of text.trim()) {
    const n = encodeURIComponent(ch).length;
    if (used + n > budget) {
      truncated = true;
      break;
    }
    used += n;
    kept += ch;
  }
  return { url: head + encodeURIComponent(kept + tail), truncated };
}
