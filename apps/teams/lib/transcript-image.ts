/** 진행 기록 이미지 바이트 (DESIGN.md §P539 결정 2) - `/api/transcript-image` 라우트의 본체.
 *
 *  `StreamEvent.images`의 참조(`rec` 레코드 key의 uuid · `block` 블록 순번 · `sub`)로 그 세션의 jsonl을
 *  다시 열어 base64 블록을 디코드해 준다. 경로를 쿼리로 받지 않는다 - `session`은 UUID 정규식을
 *  통과해 `findTranscript`가 찾은 파일 하나만 읽는다. 프로젝트 인증은 `/api/attachment`와 같다.
 *  라우트 파일이 `@/` 별칭을 써서 테스트가 못 부르므로 본체가 여기 있다. */
import { readFile } from "node:fs/promises";
import { getProject } from "./projects.ts";
import { findTranscript, imageBytes } from "./transcript.ts";

const notFound = () => new Response(null, { status: 404 });
const int = (v: string | null) => (v !== null && /^\d{1,6}$/.test(v) ? Number(v) : null);

export async function serveTranscriptImage(q: URLSearchParams, root?: string): Promise<Response> {
  const rec = q.get("rec") ?? "";
  const block = int(q.get("block"));
  const sub = q.has("sub") ? int(q.get("sub")) : undefined;
  if (!(await getProject(q.get("project") ?? "")) || !rec || block === null || sub === null) return notFound();

  const file = await findTranscript(q.get("session") ?? "", root);
  if (!file) return notFound();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return notFound();
  }
  // ponytail: 파일 전체를 읽고 uuid가 든 줄만 파싱한다. 세션이 수십 MB가 되면 오프셋 색인
  for (const line of text.split("\n")) {
    if (!line.includes(rec)) continue;
    let r: { uuid?: unknown; timestamp?: unknown };
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if ((r.uuid ?? r.timestamp) !== rec) continue;
    const img = imageBytes(r, block, sub);
    return img ? new Response(new Uint8Array(img.bytes), { headers: { "Content-Type": img.mime } }) : notFound();
  }
  return notFound();
}
