/** 스쿼드 설계-점검 티켓 발행 (DESIGN.md P469 §값 - 화면 입구 둘).
 *
 *  화면이 하는 일은 티켓 한 장을 쓰는 것뿐이다. 스쿼드 디렉터리는 만들지 않는다 - 받는 세션이
 *  절차 문서(`protocols/스쿼드-설계.md`)대로 만든다. 절차 파일이 큐에 없으면 템플릿에서 복사하고,
 *  있으면 덮지 않는다. */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";

export const DESIGN_PROCEDURE = "protocols/스쿼드-설계.md";
export const REVIEW_PROCEDURE = "protocols/스쿼드-점검.md";

/** 큐에 절차 파일이 없을 때만 템플릿에서 복사한다. `COPYFILE_EXCL`이라 있으면 건드리지 않는다. */
export async function ensureProcedure(queueRoot: string, templatesDir: string, rel: string): Promise<void> {
  const dest = path.join(queueRoot, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await copyFile(path.join(templatesDir, rel), dest, 1 /* COPYFILE_EXCL */);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

const checks = (lines: string[]) => lines.map((l) => `- [ ] ${l}`).join("\n");

export function designTicket(name: string, description: string): { title: string; body: string } {
  const quoted = description
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return {
    title: `스쿼드 설계 - ${name}`,
    body: [
      "## Goal",
      `스쿼드 \`${name}\`를 아래 설명대로 설계한다. 절차는 \`${DESIGN_PROCEDURE}\`를 따른다.`,
      "",
      quoted,
      "",
      "## Done when",
      checks([
        `\`squads/${name}/members\`가 있다`,
        "멤버마다 `PROFILE.md`가 있다",
        `\`squads/${name}/rules\`가 있고 패턴 이름이 든다`,
        "새로 만든 페르소나마다 `PROFILE.md`+`skills.md`가 5,000 B 이하다",
        "`## 결과`에 고른 패턴과 재사용한 기존 페르소나가 적혔다",
      ]),
      "",
    ].join("\n"),
  };
}

export function reviewTicket(name: string): { title: string; body: string } {
  return {
    title: `스쿼드 점검 - ${name}`,
    body: [
      "## Goal",
      `스쿼드 \`${name}\`를 쓴 기록으로 점검한다. 절차는 \`${REVIEW_PROCEDURE}\`를 따른다.`,
      "",
      "## Done when",
      checks([
        "`## 결과`에 신호 표가 있다",
        "바꾼 파일마다 이유 한 줄이 있다",
        "멤버마다 예산 안이다",
      ]),
      "",
    ].join("\n"),
  };
}

/** 새 티켓 파일을 `O_EXCL`로 만든다. 해시는 상태 접미사 붙은 이름까지 피한다. */
export async function writeTicket(
  queueRoot: string,
  fm: { title: string; persona?: string; squad?: string },
  body: string,
): Promise<string> {
  const dir = path.join(queueRoot, "tickets");
  const taken = new Set((await readdir(dir)).map((n) => n.split(".")[0]));
  for (let i = 0; i < 10; i++) {
    const h = randomUUID().slice(0, 8);
    if (taken.has(h)) continue;
    const text = [
      "---",
      `ticket: ${h}`,
      `title: ${fm.title}`,
      "kind: work",
      ...(fm.persona ? [`persona: ${fm.persona}`] : []),
      ...(fm.squad ? [`squad: ${fm.squad}`] : []),
      "priority: 3",
      "---",
      "",
      body,
    ].join("\n");
    const fh = await open(path.join(dir, `${h}.md`), "wx").catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw e;
    });
    if (!fh) continue;
    try {
      await fh.writeFile(text, "utf8");
    } finally {
      await fh.close();
    }
    return h;
  }
  throw new Error("hash exhausted");
}

/** 두 입구가 같이 부르는 발행 한 번: 절차 파일 보장 -> 티켓 쓰기. */
export async function issueSquadTicket(
  queueRoot: string,
  templatesDir: string,
  kind: "design" | "review",
  name: string,
  opts: { description?: string; persona?: string; squad?: string },
): Promise<string> {
  const t = kind === "design" ? designTicket(name, opts.description ?? "") : reviewTicket(name);
  await ensureProcedure(queueRoot, templatesDir, kind === "design" ? DESIGN_PROCEDURE : REVIEW_PROCEDURE);
  return writeTicket(queueRoot, { title: t.title, persona: opts.persona, squad: opts.squad }, t.body);
}
