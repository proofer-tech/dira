/** 첨부 바이트 — 다섯째 API 라우트 (DESIGN.md §8 §개정 · §비주얼 §27 §개정).
 *
 *  데이터 URL로 본문에 인라인하지 않는다 - 20MB 하나가 HTML에 그대로 들어가고 티켓 한 장에 열
 *  개가 붙을 수 있다. 그래서 미리보기(`<img>`·칩 링크)는 이 라우트를 가리키고 브라우저가 따로
 *  받는다.
 *
 *  **신뢰 경계다.** 쿼리로 온 `path`는 `lib/attachments.ts verifyAttachments`와 **같은
 *  `resolveWithin`**으로 다시 판정한다(밖을 가리키면 404) - 규칙이 둘이면 한쪽이 낡는다.
 *  프로젝트 인증은 `/api/revision`과 같은 값 - `project` 쿼리로 `getProject`를 부른다. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyAttachments } from "@/lib/attachments";
import { getProject } from "@/lib/projects";

/** §비주얼 §27 §개정 표의 이미지 6종만 그 MIME으로 준다 - 그 밖(`svg` 포함)은 브라우저가
 *  다운로드/새 문서로 열도록 일반 바이너리로 준다(칩이 새 탭으로 여는 자리라 실행 위험을
 *  거기서 이미 갈랐다 - §비주얼 §27 §개정 `svg`가 이미지 갈래에서 빠지는 이유). */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("project") ?? "";
  const target = url.searchParams.get("path") ?? "";
  const project = await getProject(id);
  if (!project || !target) return new Response(null, { status: 404 });

  let real: string;
  try {
    [real] = await verifyAttachments(project, [target]);
  } catch {
    return new Response(null, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(real);
  } catch {
    return new Response(null, { status: 404 });
  }

  const ext = path.extname(real).slice(1).toLowerCase();
  const contentType = IMAGE_MIME[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
}
