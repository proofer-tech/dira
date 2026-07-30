"use server";

/** 티켓 발행 — 새 큐 파일을 만드는 서버 액션 (DESIGN.md §3).
 *
 *  이 폼의 존재 이유는 **엔진이 실제로 디스패치할 수 있는 파일**을 만드는 것이다. 닫는 `---`이
 *  하나 없으면 티켓은 조용히 큐에서 사라지고, deps 해시가 한 글자 틀리면 영원히 대기한다
 *  (`protocols/tickets.md` §함정). 그래서 사람이 칠 수 있는 자리를 title·본문으로 줄이고
 *  나머지는 선택지로만 받는다 — 그리고 **서버에서 전부 다시 본다**. 폼이 `<select>`여도 요청은
 *  손으로 만들 수 있으므로 클라이언트 제약은 검증이 아니다.
 *
 *  `[hash]/actions.ts`와 따로 두는 이유는 화면이 다르기 때문이다(그쪽은 있는 파일을 고친다).
 *  `"use server"` 파일은 모든 export가 async 함수여야 해서 헬퍼를 서로 import하지 못한다 —
 *  `fmValue` 네 줄이 양쪽에 있는 건 그 대가다. */
import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NAME_RE, isHash } from "@/lib/paths";
import { stemOf } from "@/lib/queue";
import { getProject, resolveConfig } from "@/lib/projects";

export type NewTicketState = { error?: string };

/** `protocols/tickets.md` frontmatter 표의 `kind`. 폼의 select와 서버 판정이 같은 목록을 쓴다. */
const KINDS = ["work", "request", "feedback"];

/** frontmatter 값으로 들어갈 한 줄. 개행이 섞이면 frontmatter가 깨져 티켓이 큐에서 사라진다. */
function fmValue(name: string, raw: string): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(`${name}에 줄바꿈을 넣을 수 없습니다.`);
  return v;
}

/** 발행. 성공하면 상세로 이동한다(액션이 값을 돌려주지 않는다 — `redirect`는 던진다).
 *
 *  `session_id`·`owner`·`assigned_at`은 **쓰지 않는다**: 디스패처가 쓰는 키고, 새 티켓에 넣으면
 *  이미 할당된 것으로 보여 영원히 디스패치되지 않는다(`protocols/tickets.md`). */
export async function createTicket(
  _prev: NewTicketState,
  form: FormData,
): Promise<NewTicketState> {
  const projectId = String(form.get("project") ?? "");
  let hash = "";
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);

    const title = fmValue("제목", String(form.get("title") ?? ""));
    if (!title) throw new Error("제목을 입력하세요.");

    const kind = fmValue("kind", String(form.get("kind") ?? ""));
    if (kind && !KINDS.includes(kind)) {
      throw new Error(`kind는 ${KINDS.join(" · ")} 중 하나입니다: ${kind}`);
    }

    const persona = fmValue("persona", String(form.get("persona") ?? ""));
    // 엔진이 이 값으로 `<personas>/<이름>/PROFILE.md` 경로를 만든다(tick.sh). 규칙 밖이면
    // 조용히 무시돼 프로필 없이 세션이 돈다.
    if (persona && !NAME_RE.test(persona)) {
      throw new Error(`persona는 영문·숫자·_·- 만 됩니다(엔진이 경로로 씁니다): ${persona}`);
    }

    // 큐 디렉터리의 **파일명**을 직접 본다. `listTickets`가 아닌 이유 둘: 해시 충돌 검사는
    // frontmatter가 깨져 엔진에 안 보이는 파일까지 포함해야 하고(그 파일도 이름을 점유한다),
    // deps가 가리키는 이름이 `ticket:` 값이 아니라 **상태 접미사를 뗀 파일명**이기 때문이다
    // (tickets.py `_find_stem`).
    const dir = path.join(project.root, "tickets");
    const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
    const stems = new Set(names.map((n) => stemOf(n, config)));

    // deps는 선택만 받는다 — 오타 해시로 인한 영구 대기를 구조적으로 없앤다(DESIGN.md §3).
    const deps = [...new Set(form.getAll("deps").map((d) => String(d).normalize("NFC")))];
    for (const d of deps) {
      if (!isHash(d) || !stems.has(d)) throw new Error(`큐에 없는 deps 해시입니다: ${d}`);
    }

    // textarea는 CRLF로 온다(HTML 폼 규격). 그대로 쓰면 파일 줄끝이 갈린다.
    let body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");
    if (body && !body.endsWith("\n")) body += "\n";

    const text = (h: string) =>
      [
        "---",
        `ticket: ${h}`,
        `title: ${title}`,
        ...(kind ? [`kind: ${kind}`] : []),
        ...(persona ? [`persona: ${persona}`] : []),
        ...(deps.length ? [`deps: [${deps.join(", ")}]`] : []),
        "---",
        "",
        body,
      ].join("\n");

    // 해시는 서버가 만든다(`randomUUID` 8 hex). `stems` 검사로 접미사 붙은 이름까지 걸러도
    // 검사와 생성 사이에 다른 세션이 끼어들 수 있으므로 **여는 것 자체가 검사**여야 한다 — `wx`.
    for (let i = 0; i < 10 && !hash; i++) {
      const h = randomUUID().slice(0, 8);
      if (stems.has(h)) continue;
      const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; // 졌다 — 다시 뽑는다
        throw e;
      });
      if (!fh) continue;
      try {
        await fh.writeFile(text(h), "utf8");
      } finally {
        await fh.close();
      }
      hash = h;
    }
    if (!hash) {
      throw new Error("해시를 10번 뽑았는데 전부 이미 쓰이고 있습니다 — 큐 디렉터리를 확인하세요.");
    }
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath(`/p/${projectId}`); // 보드에 새 티켓이 뜬다
  redirect(`/p/${projectId}/tickets/${hash}`);
}
