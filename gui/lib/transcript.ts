/** 세션 스트림(DESIGN.md §2-1)의 읽기 코어 — 화면 없는 순수 레이어.
 *
 *  원본은 Claude Code가 실시간 append하는 자기 트랜스크립트
 *  (`~/.claude/projects/<디렉터리>/<session_id>.jsonl`)다. 엔진도 같은 파일을 본다
 *  (`tickets.py:299 newest_transcript` · `:319 transcript_state`).
 *
 *  **여기가 틀리면 사건이 조용히 사라진다.** 그래서 이 파일의 계약은 두 줄이다:
 *  모르는 것은 던지지 말고 건너뛴다, 그리고 **불완전한 마지막 줄은 버리고 offset을 되돌린다**. */
import { access, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** 사건 한 줄. `label`이 비면 접지 않고 `body`를 그대로 보여준다(assistant text · 사용자 프롬프트).
 *  비지 않으면 접힌 줄이 `HH:MM:SS <label> <summary>`이고 펼치면 `body`다(§2-1 표). */
export type StreamEvent = {
  key: string; // 렌더 키. `<레코드 uuid>:<블록 index>`
  ts: string; // 레코드의 timestamp (UTC ISO). **로컬 시간 렌더는 화면이 한다**
  kind: "prompt" | "text" | "thinking" | "tool_use" | "tool_result";
  label: string;
  summary: string;
  // §9: 요약이 리터럴이면 mono, 읽는 문장이면 sans. 판정이 도구 이름에 달렸으므로(파일 도구의
  // 상대경로는 리터럴, `Bash`의 `description`은 문장) 화면이 도구 목록을 다시 갖지 않게 여기서 준다
  summaryMono: boolean;
  body: string;
  sidechain: boolean; // isSidechain — 화면이 `서브` 표시를 붙인다
};

/** §경로 방어. `session_id`는 사람 입력이 아니라 티켓 fm에서만 오고, 경로가 되기 전에 이걸 통과한다.
 *  트랜스크립트는 등록된 root 밖이라 이 정규식이 그 예외의 유일한 방어다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `~/.claude/projects/*​/<session_id>.jsonl` 글롭. 매치가 **정확히 1개**일 때만 경로다.
 *  0개·2개 이상이면 빈 상태(null) — 디렉터리 이름을 유도하지 않는다(§2-1).
 *  `root`는 테스트가 픽스처 디렉터리를 주기 위한 것이다. 사용자 입력이 들어오는 자리가 아니다. */
export async function findTranscript(
  sessionId: string,
  root = path.join(homedir(), ".claude", "projects"),
): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null;
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return null; // projects 디렉터리 자체가 없는 머신(Codex 큐 등)도 빈 상태다
  }
  // ponytail: 디렉터리 수만큼 access(실측 이 머신 864개). `fs.glob`이 하는 일과 같고
  // @types/node@20에 없는 API를 안 쓴다. 느려지면 <session_id> → 경로를 프로세스 캐시에 둔다.
  const hits = (
    await Promise.all(
      dirs.map(async (d) => {
        if (!d.isDirectory()) return null;
        const p = path.join(root, d.name, `${sessionId}.jsonl`);
        return access(p).then(
          () => p,
          () => null,
        );
      }),
    )
  ).filter((p) => p !== null);
  return hits.length === 1 ? hits[0] : null; // 0개·2개 이상은 빈 상태
}

/** `offset` 뒤에 붙은 바이트만 읽어 사건 + 새 offset. 2MB를 매번 다시 읽지 않는다.
 *
 *  - **불완전한 마지막 줄을 버린다.** 새 offset은 마지막 `\n`까지로 되돌리고 다음 폴링이
 *    그 줄을 처음부터 다시 읽는다. 잘린 줄을 파싱해 건너뛰면 그 사건이 영구히 사라진다.
 *  - `offset`이 파일 크기보다 크면 `0`부터 다시 읽는다(있을 수 없는 상태지만 무한 빈 응답보다 낫다). */
export async function tailEvents(
  file: string,
  offset: number,
): Promise<{ events: StreamEvent[]; offset: number }> {
  let fh;
  try {
    fh = await open(file, "r");
  } catch {
    return { events: [], offset }; // 아직 없는 트랜스크립트 = 빈 상태
  }
  try {
    const { size } = await fh.stat();
    const start = offset >= 0 && offset <= size ? offset : 0;
    if (start === size) return { events: [], offset: start };

    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    const chunk = buf.subarray(0, bytesRead);
    // `\n`은 UTF-8 멀티바이트 시퀀스 안에 나타나지 않으므로 바이트로 잘라도 글자가 깨지지 않는다
    const cut = chunk.lastIndexOf(0x0a);
    if (cut < 0) return { events: [], offset: start }; // 온전한 줄이 하나도 없다

    const events: StreamEvent[] = [];
    let promptSeen = start > 0; // offset>0이면 세션 프롬프트는 이미 지나갔다
    for (const line of chunk.subarray(0, cut).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 파싱 불가능한 줄은 조용히 건너뛴다. 스트림이 멈추는 것이 최악이다
      }
      const evs = recordToEvents(rec, !promptSeen);
      if (evs.some((e) => e.kind === "prompt")) promptSeen = true;
      events.push(...evs);
    }
    return { events, offset: start + cut + 1 };
  } finally {
    await fh.close();
  }
}

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  tool_name?: string;
  input?: unknown;
  content?: unknown;
};

/** 레코드 하나 → 사건 0..n개 (§2-1 표). assistant 한 레코드가 thinking+text+tool_use를 함께 담는다.
 *  `message`가 없거나(`queue-operation`·`attachment`·`last-prompt`) `timestamp`가 없으면 빈 배열이다.
 *  `collapseFirstPrompt`가 참이면 이 레코드의 첫 사용자 프롬프트를 `세션 프롬프트 n자`로 접는다. */
export function recordToEvents(rec: unknown, collapseFirstPrompt = false): StreamEvent[] {
  if (!rec || typeof rec !== "object") return [];
  const r = rec as {
    timestamp?: unknown;
    uuid?: unknown;
    cwd?: unknown;
    isSidechain?: unknown;
    message?: unknown;
  };
  const ts = typeof r.timestamp === "string" ? r.timestamp : "";
  const msg = r.message;
  if (!ts || !msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  const role = (msg as { role?: unknown }).role;
  const cwd = typeof r.cwd === "string" ? r.cwd : undefined;

  const uid = typeof r.uuid === "string" ? r.uuid : ts;
  const events: StreamEvent[] = [];
  let promptDone = !collapseFirstPrompt;
  type Push = Omit<StreamEvent, "key" | "ts" | "sidechain" | "summaryMono"> & {
    summaryMono?: boolean;
  };
  const push = (i: number, e: Push) =>
    events.push({
      key: `${uid}:${i}`,
      ts,
      sidechain: r.isSidechain === true,
      ...e,
      summaryMono: e.summaryMono ?? false,
    });
  const prompt = (i: number, text: string) => {
    const collapse = !promptDone;
    promptDone = true;
    // 첫 프롬프트는 페르소나 + 프로토콜 전문이고 세션마다 같다(실측 8.6KB)
    push(i, {
      kind: "prompt",
      label: collapse ? "세션 프롬프트" : "",
      summary: collapse ? `${chars(text)}자` : "",
      body: text,
    });
  };

  if (typeof content === "string") {
    prompt(0, content);
    return events;
  }
  if (!Array.isArray(content)) return [];

  content.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const b = raw as Block;
    switch (b.type) {
      case "text":
        if (role === "user") prompt(i, b.text ?? "");
        else push(i, { kind: "text", label: "", summary: "", body: b.text ?? "" });
        break;
      case "thinking": {
        // 본문이 암호화돼 `thinking: ""`로 오는 레코드가 대부분이다(실측 91개 중 86개).
        // 그래도 **줄은 흘린다** — 빼면 생각하는 동안 화면이 조용해져서 "멈춘 것"과
        // 구별되지 않는다(§2-1이 서브에이전트 줄을 빼지 않는 것과 같은 이유). 크기만 감춘다.
        const t = b.thinking ?? "";
        push(i, { kind: "thinking", label: "생각", summary: t ? `${chars(t)}자` : "", body: t });
        break;
      }
      case "tool_use": {
        const name = typeof b.name === "string" ? b.name : "도구";
        const s = toolSummary(name, b.input, cwd);
        push(i, {
          kind: "tool_use",
          label: name,
          summary: s.text,
          summaryMono: s.mono,
          body: b.input === undefined ? "" : JSON.stringify(b.input, null, 2),
        });
        break;
      }
      case "tool_result": {
        const body = resultText(b.content);
        push(i, { kind: "tool_result", label: "결과", summary: `${lines(body)}줄`, body });
        break;
      }
      // 모르는 블록(`image` 등)은 조용히 건너뛴다
    }
  });
  return events;
}

/** 코드포인트 수. 한글·이모지에서 UTF-16 길이와 갈린다 */
const chars = (s: string) => [...s].length;
const lines = (s: string) => (s.trimEnd() === "" ? 0 : s.trimEnd().split("\n").length);

/** `<요약>`은 도구마다 다르다. **모르는 도구에 인자를 추측해 넣지 않는다**(§2-1).
 *  `mono`는 §9의 서체 판정이다 — 경로는 리터럴, `description`은 읽는 문장이다. */
function toolSummary(name: string, input: unknown, cwd?: string): { text: string; mono: boolean } {
  const none = { text: "", mono: false };
  if (!input || typeof input !== "object") return none;
  const inp = input as { description?: unknown; file_path?: unknown };
  if (name === "Bash") {
    return typeof inp.description === "string" ? { text: inp.description, mono: false } : none;
  }
  if (name === "Read" || name === "Edit" || name === "Write") {
    if (typeof inp.file_path !== "string") return none;
    const rel = cwd && path.isAbsolute(inp.file_path) ? path.relative(cwd, inp.file_path) : "";
    // cwd 밖(`..`)은 전체 경로가 정보다 — 상대경로로 접어 놓으면 어디를 만졌는지가 사라진다
    return { text: rel && !rel.startsWith("..") ? rel : inp.file_path, mono: true };
  }
  return none;
}

/** tool_result의 `content`는 문자열이거나 블록 배열이다(실측: text · image · tool_reference). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((raw) => {
      if (!raw || typeof raw !== "object") return "";
      const b = raw as Block;
      if (typeof b.text === "string") return b.text;
      if (b.type === "tool_reference") return `[${b.tool_name ?? "tool_reference"}]`;
      return `[${b.type ?? "?"}]`; // image 등 — 원문 대신 종류만
    })
    .join("\n");
}
