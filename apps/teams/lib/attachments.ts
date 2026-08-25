/** 파일 첨부 (DESIGN.md §8) — **바이트를 실어 보낼 통로가 없다.** 네 칸의 sink가 전부 문자열이라
 *  (티켓 마크다운 · FIFO 한 줄 · `claude`의 argv) 첨부는 **파일을 세션이 닿는 자리에 놓고 그
 *  절대경로를 프롬프트 끝에 적는 것**이다. 이 파일이 그 둘을 한다 — 저장(`saveAttachment`)과
 *  표기(`withAttachments`).
 *
 *  **자리는 `<큐 루트>/attachments/` 하나다**(§8 표). 홈 에이전트 cwd는 `dirname(root)`이고 워커
 *  cwd는 워크트리인데 거기 `.dira`가 이 큐를 가리킨다 — 양쪽 다 이 경로가 cwd 아래로 떨어진다.
 *  `tickets/` 아래가 아니므로 불변식 4(큐는 평면)를 건드리지 않고 **엔진은 이 디렉터리를 모른다.**
 *
 *  **표기가 한 곳인 것이 이 파일의 존재 이유다.** 붙는 자리가 넷(§3 발행·요구 접수 · §2-2 참견·
 *  이어받기 · §7 홈 질의)이라 자리마다 문자열을 조립하면 그중 하나가 조용히 옛 표기로 남고,
 *  그때 세션은 첨부를 못 본 채 답한다. */
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { oversizeError } from "./attachment-limit.ts";
import { DEFAULT_LOCALE, type Locale } from "./i18n.ts";
import { resolveWithin } from "./paths.ts";
import type { Project } from "./projects.ts";

/** 프롬프트에 붙는 안내 한 줄(§8 §프롬프트에 붙는 모양). 네 자리가 이 문자열을 같이 쓴다. */
const NOTE = "첨부 파일 — 아래 경로를 Read로 읽어라:";

export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

/** 표시용 이름 → 파일명(§8 표). **방어가 아니라 표기다** — 방어는 아래 `resolveWithin`이 한다.
 *
 *  NFC를 먼저 하는 이유: macOS가 주는 파일명은 자모가 분해된 NFD인 경우가 있고, 분해된 자모는
 *  `가-힣` 밖이라 `한글.png`가 통째로 `______.png`가 된다(`queue.ts`가 큐 이름에 쓰는 것과 같은
 *  정규화다). 순서는 §8 표 그대로 — 치환 → 80자 → 앞뒤 `.` 제거. 자르기가 뒤에 오면 잘린 끝에
 *  `.`이 다시 남는다. */
export function safeName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._가-힣-]/g, "_")
    .slice(0, 80)
    .replace(/^\.+|\.+$/g, "");
}

/** 파일 하나를 `<큐 루트>/attachments/<8hex>-<정규화 이름>`에 놓고 **절대경로**를 돌려준다.
 *
 *  8hex는 충돌 방지다 — 같은 이름을 두 번 붙여도 앞의 것을 덮지 않는다(§8 표). 그래도 여는 것은
 *  `wx`(= `O_EXCL`)다: 검사와 생성 사이는 항상 벌어진다.
 *
 *  실패는 **사유마다 다른 문장**이다(§6 3요소). 화면이 칩 자리에 그대로 적는다 — 상한 초과나
 *  쓰기 실패가 조용히 사라지면 사람은 붙였다고 믿고 보낸다(§8 §거동). */
export async function saveAttachment(
  project: Pick<Project, "root">,
  file: File,
  locale: Locale = DEFAULT_LOCALE,
): Promise<SaveResult> {
  // 신뢰 경계. 바이트를 읽기 **전에** 크기를 본다 — 20MB를 버퍼에 올린 뒤 거절하면 거절이 비싸다.
  // 화면도 같은 함수를 보내기 전에 부르지만(`attachment-field.tsx`) 판정은 여기가 한다.
  const oversize = oversizeError(file.size, locale);
  if (oversize) return { ok: false, error: oversize };
  const name = safeName(file.name ?? "");
  if (!name) {
    return {
      ok: false,
      error: "파일 이름이 없습니다 — 이름이 있는 파일로 다시 고르세요.",
    };
  }

  const dir = path.join(project.root, "attachments");
  try {
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    for (let i = 0; i < 10; i++) {
      const target = `${randomUUID().slice(0, 8)}-${name}`;
      // 정규화를 믿지 않는다. 조립한 **최종 경로**가 `attachments/` 아래인지 여기서 판정한다
      // (심링크 포함 — 문자열 비교로는 못 막는다). 밖이면 던지고 아래 catch가 받는다.
      const full = await resolveWithin(dir, target);
      const fh = await open(full, "wx").catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; // 졌다 — 다시 뽑는다
        throw e;
      });
      if (!fh) continue;
      try {
        await fh.writeFile(bytes);
      } finally {
        await fh.close();
      }
      return { ok: true, path: full };
    }
    return { ok: false, error: "이름을 10번 뽑았는데 전부 이미 쓰이고 있습니다." };
  } catch (e) {
    // 사유 원문을 삼키지 않는다(§6 2번). 권한·용량·경로 방어가 전부 이 문장으로 나온다.
    return { ok: false, error: `저장하지 못했습니다: ${(e as Error).message}` };
  }
}

/** 폼으로 **돌아온** 경로를 프롬프트에 싣기 전에 다시 판정한다. 신뢰 경계다.
 *
 *  경로를 만든 것은 위 `saveAttachment`지만 돌아오는 길은 브라우저다 — 화면이 그리는
 *  `<input type="hidden" name="attachment">`는 값의 **표기**이지 값이 아니고, 요청은 손으로
 *  만들 수 있다. 밖을 가리키는 경로가 그대로 본문에 실리면 그 티켓을 받은 세션이 `Read`로
 *  큐 밖 파일을 연다 — §8이 자리를 `attachments/` 하나로 고정한 것이 여기서 무너진다.
 *
 *  판정은 `saveAttachment`와 **같은 `resolveWithin`**이다(규칙이 둘이면 한쪽이 낡는다).
 *  빈 목록이면 fs를 안 만진다: `attachments/`는 첫 첨부에 생기므로 아직 없을 수 있다. */
export async function verifyAttachments(
  project: Pick<Project, "root">,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  const dir = path.join(project.root, "attachments");
  try {
    return await Promise.all(paths.map((p) => resolveWithin(dir, p)));
  } catch (e) {
    // §6 3요소 — 무엇이(원문에 경로가 들어 있다) · 왜 · 다음 행동.
    throw new Error(
      `첨부 경로가 attachments/ 밖입니다 — 붙인 파일을 지우고 다시 고르세요: ${(e as Error).message}`,
    );
  }
}

/** 본문 + 첨부 경로 → 프롬프트에 실릴 문자열(§8 §프롬프트에 붙는 모양).
 *
 *  **첨부가 없으면 `text` 그대로다** — 빈 줄 하나도 붙이지 않는다. 네 자리 중 셋이 이 결과를
 *  파일이나 argv에 그대로 싣는다. */
export function withAttachments(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const body = text.trimEnd();
  return (body ? body + "\n\n" : "") + NOTE + "\n" + paths.join("\n");
}
