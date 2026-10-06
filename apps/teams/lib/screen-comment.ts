/** 홈 브라우저 탭 댓글(DESIGN.md P466)이 보내는 `comment_*` 다섯 값의 서버 검증과 본문 블록 조립.
 *  `"use server"` 파일은 async export만 허용하고 테스트도 못 하므로 `board/actions.ts` 밖에 둔다. */
import { verifyAttachments } from "./attachments.ts";
import { t, type Locale } from "./i18n.ts";
import type { Project } from "./projects.ts";

export const COMMENT_KEYS = ["comment_url", "comment_shot", "comment_x", "comment_y", "comment_size"] as const;
const SCHEMES = ["http:", "https:", "about:", "file:"];

/** 다섯 값이 하나도 없으면 `null`(종전 요구 접수). 일부만 있거나 어긋나면 던진다 - 티켓은 아직 0장이다.
 *  돌려주는 `shot`은 `verifyAttachments`를 지난 절대경로다. */
export async function screenComment(
  project: Pick<Project, "root">,
  get: (key: string) => string,
  locale: Locale,
): Promise<{ block: string } | null> {
  const v = Object.fromEntries(COMMENT_KEYS.map((k) => [k, get(k).trim()])) as Record<(typeof COMMENT_KEYS)[number], string>;
  if (COMMENT_KEYS.every((k) => !v[k])) return null;
  const bad = (item: string) =>
    new Error(`${t(locale, "screenComment.invalidPrefix")} - ${item}`);
  for (const k of COMMENT_KEYS) if (!v[k]) throw bad(k);

  const m = /^([1-9]\d*)x([1-9]\d*)$/.exec(v.comment_size);
  if (!m) throw bad("comment_size");
  const [w, h] = [Number(m[1]), Number(m[2])];
  const coord = (k: "comment_x" | "comment_y", max: number) => {
    if (!/^\d+$/.test(v[k]) || Number(v[k]) >= max) throw bad(k);
    return Number(v[k]);
  };
  const x = coord("comment_x", w);
  const y = coord("comment_y", h);

  let scheme = "";
  try {
    scheme = new URL(v.comment_url).protocol;
  } catch {
    throw bad("comment_url");
  }
  if (!SCHEMES.includes(scheme) || /[\r\n]/.test(v.comment_url)) throw bad("comment_url");

  let shot: string;
  try {
    [shot] = await verifyAttachments(project, [v.comment_shot], locale);
  } catch {
    throw bad("comment_shot");
  }

  const block = [
    t(locale, "screenComment.heading"),
    "",
    `- ${t(locale, "screenComment.url")}: ${v.comment_url}`,
    `- ${t(locale, "screenComment.shot")}: ${shot}`,
    `- ${t(locale, "screenComment.click")}: (${x}, ${y}) - ${t(locale, "screenComment.shotSize")} ${w}x${h} ${t(locale, "screenComment.basis")}`,
  ].join("\n");
  return { block };
}
