"use server";

/** 티켓 발행 — 새 큐 파일을 만드는 서버 액션 (DESIGN.md §3).
 *
 *  이 폼의 존재 이유는 **엔진이 실제로 디스패치할 수 있는 파일**을 만드는 것이다. 닫는 `---`이
 *  하나 없으면 티켓은 조용히 큐에서 사라지고, deps 해시가 한 글자 틀리면 영원히 대기한다
 *  (엔진 레포 `protocols/CORE-TICKETS.md` §함정). 그래서 사람이 칠 수 있는 자리를 title·본문으로
 *  줄이고 나머지는 선택지로만 받는다 — 그리고 **서버에서 전부 다시 본다**. 폼이 `<select>`여도
 *  요청은 손으로 만들 수 있으므로 클라이언트 제약은 검증이 아니다.
 *
 *  `[hash]/actions.ts`와 따로 두는 이유는 화면이 다르기 때문이다(그쪽은 있는 파일을 고친다).
 *  `"use server"` 파일은 모든 export가 async 함수여야 해서 헬퍼를 서로 import하지 못한다 —
 *  `fmValue` 네 줄이 양쪽에 있는 건 그 대가다. */
import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { track } from "@/lib/analytics";
import { verifyAttachments, withAttachments } from "@/lib/attachments";
import { kickIdleWorker } from "@/lib/kick";
import { isHash, parseAssignment } from "@/lib/paths";
import { PRIORITY_DEFAULT, PRIORITY_MAX, PRIORITY_MIN, reqTitle, stemOf } from "@/lib/queue";
import { epicTitle } from "@/lib/epics";
import { getProject, resolveConfig } from "@/lib/projects";

/** `ok`·`hash`·`message`는 **요구 접수 경로에서만** 온다 — 발행은 종전대로 `redirect`라 값을
 *  돌려주지 않는다. */
export type NewTicketState = { error?: string; ok?: true; hash?: string; message?: string };

/** `protocols/CORE-TICKETS.md` §frontmatter 표의 `kind`. 폼의 select와 서버 판정이 같은 목록을 쓴다. */
const KINDS = ["work", "request", "feedback"];

/** frontmatter 값으로 들어갈 한 줄. 개행이 섞이면 frontmatter가 깨져 티켓이 큐에서 사라진다. */
function fmValue(name: string, raw: string): string {
  const v = raw.trim();
  if (/[\r\n]/.test(v)) throw new Error(`${name}에 줄바꿈을 넣을 수 없습니다.`);
  return v;
}

/** 발행하면 상세로 이동한다(그 경로는 값을 돌려주지 않는다 — `redirect`는 던진다).
 *  **요구 접수(`mode=req`)만 `{ ok, hash }`를 돌려준다** — 다이얼로그가 그 자리에서 접수 확인을
 *  그린다(DESIGN.md §3 요구 접수 모드).
 *
 *  `session_id`·`owner`·`assigned_at`은 **쓰지 않는다**: 디스패처가 쓰는 키고, 새 티켓에 넣으면
 *  이미 할당된 것으로 보여 영원히 디스패치되지 않는다(`protocols/CORE-TICKETS.md` §frontmatter). */
export async function createTicket(
  _prev: NewTicketState,
  form: FormData,
): Promise<NewTicketState> {
  const projectId = String(form.get("project") ?? "");
  let hash = "";
  let req = false; // 끝의 `redirect` 여부가 이 값으로 갈린다 — try 밖에서 봐야 한다
  // 접수 확인 문장(§에픽 §결정 10) — 활성 에픽이 없으면 종전 문장 그대로다.
  let message = "요구사항이 접수되었습니다. 곧 PM이 검토할 예정입니다.";
  try {
    const project = await getProject(projectId);
    if (!project) throw new Error(`등록되지 않은 프로젝트입니다: ${projectId}`);
    const config = await resolveConfig(project);

    // textarea는 CRLF로 온다(HTML 폼 규격). 그대로 쓰면 파일 줄끝이 갈린다.
    const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");

    // 요구 접수 모드(`?mode=req`)는 자연어 한 칸만 받고 나머지를 **서버가 고정한다**
    // (DESIGN.md §3 요구 접수 모드). 폼이 안 보내도 여기서 정해지므로 요청을 손으로 만들어도 같다.
    req = String(form.get("mode") ?? "") === "req";

    const title = req ? reqTitle(body) : fmValue("제목", String(form.get("title") ?? ""));
    if (!title) throw new Error(req ? "요구 내용을 입력하세요." : "제목을 입력하세요.");

    const kind = req ? "request" : fmValue("kind", String(form.get("kind") ?? ""));
    if (kind && !KINDS.includes(kind)) {
      throw new Error(`kind는 ${KINDS.join(" · ")} 중 하나입니다: ${kind}`);
    }

    // §5-5 §할당 입구 둘 — select 값은 `persona:<이름>`/`squad:<이름>` 접두사고 서버가 정확히
    // 하나만 frontmatter에 쓴다. 요구 접수는 안 갈린다(§요구사항 레이어 결정 8, `persona: pm` 고정).
    const { persona, squad } = req ? { persona: "pm", squad: "" } : parseAssignment(String(form.get("persona") ?? ""));

    // 요구 접수가 화면의 활성 에픽을 물려받는다(DESIGN.md §에픽 §결정 10) — 발행 다이얼로그는
    // 이 필드를 안 보내므로 항상 빈 값이라 저절로 안 걸린다. 값 검증-정규화는 안 한다(§안 하는
    // 것) — 문자열 그대로가 키다. `fmValue`가 막는 것은 개행 하나뿐이다.
    const epic = fmValue("epic", String(form.get("epic") ?? ""));

    // 우선순위(§1-3 §값을 넣는 자리 셋). 요구 접수는 select가 없으므로 **키 자체를 안 쓴다** —
    // 엔진이 없는 키를 3으로 읽어 같은 결과다. 발행은 select라 항상 1~5가 오지만, 요청은 손으로도
    // 만들 수 있으므로(§3) 범위 밖·정수 아님은 조용히 기본값으로 내린다 — 그래도 엔진이 같은
    // 값(3)으로 읽을 뿐이라 신뢰 경계 위반이 아니다(`priority_of`가 이미 하는 일).
    const priorityNum = Number(form.get("priority"));
    const priority =
      !req &&
      Number.isInteger(priorityNum) &&
      priorityNum >= PRIORITY_MIN &&
      priorityNum <= PRIORITY_MAX
        ? priorityNum
        : PRIORITY_DEFAULT;

    // 마감(§1-4 §값). 요구 접수에는 이 입력이 안 붙지만(§3) 폼이 보내도 버린다 — priority와
    // 같은 이유(서버가 고정한 것과 다른 값이 섞이지 않는다). 빈 값은 마감 없음(줄 자체를 안 쓴다).
    const duedate = req ? "" : String(form.get("duedate") ?? "").trim();

    // 큐 디렉터리의 **파일명**을 직접 본다. `listTickets`가 아닌 이유 둘: 해시 충돌 검사는
    // frontmatter가 깨져 엔진에 안 보이는 파일까지 포함해야 하고(그 파일도 이름을 점유한다),
    // deps가 가리키는 이름이 `ticket:` 값이 아니라 **상태 접미사를 뗀 파일명**이기 때문이다
    // (tickets.py `_find_stem`).
    const dir = path.join(project.root, "tickets");
    const names = (await readdir(dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
    const stems = new Set(names.map((n) => stemOf(n, config)));

    // deps는 선택만 받는다 — 오타 해시로 인한 영구 대기를 구조적으로 없앤다(DESIGN.md §3).
    // 요구 접수 모드는 `deps` 없음이 계약이라 폼이 보내도 버린다.
    const deps = req
      ? []
      : [...new Set(form.getAll("deps").map((d) => String(d).normalize("NFC")))];
    for (const d of deps) {
      if (!isHash(d) || !stems.has(d)) throw new Error(`큐에 없는 deps 해시입니다: ${d}`);
    }

    // 첨부(§8). 화면이 `saveAttachment`로 이미 올려 둔 **경로**만 온다 — 바이트는 이 액션을
    // 지나지 않는다. 돌아온 경로가 `attachments/` 아래인지는 서버가 다시 본다(신뢰 경계).
    // **title 뒤에 붙이는 이유**: 표기가 본문의 마지막 문단이라(§8) 본문이 비고 첨부만 있으면
    // `reqTitle`이 안내 한 줄을 제목으로 삼는다.
    const attached = await verifyAttachments(
      project,
      form.getAll("attachment").map((a) => String(a)),
    );
    let content = withAttachments(body, attached);
    if (content && !content.endsWith("\n")) content += "\n";

    const text = (h: string) =>
      [
        "---",
        `ticket: ${h}`,
        `title: ${title}`,
        ...(kind ? [`kind: ${kind}`] : []),
        ...(persona ? [`persona: ${persona}`] : []),
        ...(squad ? [`squad: ${squad}`] : []),
        ...(epic ? [`epic: ${epic}`] : []),
        // 요구 접수는 안 쓴다 — 키가 없으면 엔진이 3으로 읽어 서버가 고정한 것과 같은 결과다.
        ...(req ? [] : [`priority: ${priority}`]),
        ...(duedate ? [`duedate: ${duedate}`] : []),
        ...(deps.length ? [`deps: [${deps.join(", ")}]`] : []),
        "---",
        "",
        content,
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

    // 라벨은 서버가 만든다 — `epicTitle()`과 결정 5의 `제목 없음 (P273)` 갈래가 여기 한 자리에만
    // 있고, 화면은 이 문장을 그대로 띄운다(P번호가 라벨 옆에서 단독으로 안 뜬다).
    if (req && epic) {
      const label = (await epicTitle(project.root, epic)) ?? "제목 없음";
      message = `요구사항이 ${label} (${epic}) 에픽으로 접수되었습니다.`;
    }

    // §0-11 — 파일이 실제로 태어난 뒤다. `kind`가 비어 있으면(선택 항목이다) 엔진에서 일반
    // 작업으로 도는 티켓이라 표의 `work`로 센다. 제목·본문·해시는 안 간다(익명 규칙).
    void track("ticket_create", { kind: (kind || "work") as "work" | "request" | "feedback" });

    // 즉시 디스패치(§4-5). 열린 티켓이 방금 태어났다 — cron을 60초 기다리지 않는다.
    // 결과를 안 본다: 실패해도 cron이 ≤60초 뒤에 같은 일을 하고, 화면에 보고할 자리도 없다.
    await kickIdleWorker(project.root);
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath(`/p/${projectId}`); // 보드에 새 티켓이 뜬다 — 두 경로 공통이다
  // 요구 접수는 **이동하지 않는다**: 상세는 frontmatter 표·deps·세션 스트림이 있는 운영 화면이라
  // "당신이 티켓을 만들었다"고 알려 준다. 실제로 일어난 일은 큐가 요구를 접수했고 해석은 PM이
  // 한다는 것이다 — 접수 확인은 다이얼로그 안에 남고 상세는 링크가 된다(사람 지적 `fb0d309c`).
  // 발행은 종전대로 상세로 간다: 그쪽은 kind·persona·deps를 직접 고른 운영자의 동작이다.
  if (req) return { ok: true, hash, message };
  redirect(`/p/${projectId}/tickets/${hash}`);
}
