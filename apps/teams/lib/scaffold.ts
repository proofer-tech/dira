/** 새 프로젝트 스캐폴딩 코어 (DESIGN.md §0-3). **화면은 여기 없다** — 파일을 놓는 일만 한다.
 *
 *  이 모듈은 **등록되지 않은 경로에 GUI가 파일을 쓰는 유일한 곳**이다(§경로 방어는 "등록된 root
 *  밖은 못 읽는다"였다). 그래서 경계가 목록 자체다: 쓰는 곳은 사람이 준 `<프로젝트>/.dira` 아래
 *  뿐이고, 파일 목록은 아래 상수로 고정이며, 있는 파일은 `wx`로 절대 덮지 않는다.
 *  실패해도 되돌리지 않는다 — 그 경로에 사람의 파일이 있을 수 있고, 덮지 않기로 한 것이 이
 *  기능의 유일한 방어다. */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./paths.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";
import {
  DISPATCH_GATE_FILE,
  SELF_HEAL_FILE,
  SELF_HEAL_SH,
  dispatchGateSh,
  dispatchGateSourceLine,
  renderContextBlock,
  selfHealSourceLine,
  sourceTick,
  tickSourceLine,
} from "./workers.ts";

/** `templates/` 아래 경로가 곧 `.dira/` 아래 경로다(1:1). §0-3 스캐폴딩 집합 중 복사본들. */
const TEMPLATE_FILES = [
  "protocols/AGENTS.md",
  "protocols/tickets.md",
  "protocols/ontology.md",
  "protocols/워크트리.md",
  "protocols/재디스패치-복구.md",
  "protocols/push-거부.md",
  "protocols/세션-종료.md",
  "protocols/한도.md",
  "protocols/질문-형식.md",
  "protocols/회고-예산.md",
  "protocols/완료-트리거.md",
  "protocols/cdp.md",
  "protocols/epics.md",
  "personas/pm/PROFILE.md",
  "personas/developer/PROFILE.md",
  "personas/qa/PROFILE.md",
  "personas/designer/PROFILE.md",
  "personas/archive-manager/PROFILE.md",
  "squads/default/members",
];

/** 엔진 레포 경로. **`DIRA_ENGINE`이 있으면 그것이고**(패키징된 `.app`이 번들의 엔진을 userData로
 *  꺼내 넘긴다 — §데스크톱 앱 고정하는 것 8), 없으면 **GUI 자기 위치에서 유도한다**(§0-3 답변 2(a)).
 *  GUI는 `<엔진 레포>/apps/teams/`에 있다 — 상위 2단계가 레포다. `.app`에서는 서버가
 *  `Contents/Resources/server/`에서 돌아 그 유도가 `Contents`를 가리키므로 env가 먼저다.
 *
 *  **`tick.sh` 존재 확인은 어느 쪽이든 그대로다.** 없으면 **거부한다. 폼 필드로 되묻지 않는다** —
 *  GUI가 엔진 레포 밖에 있다는 건 설치가 깨진 것이고 폼 하나로 고칠 문제가 아니다. 본 경로를
 *  사유에 그대로 담아 사람이 무엇을 봐야 하는지 알게 한다(어느 쪽에서 나온 값인지도 같이). */
export function engineRepo(locale: Locale = DEFAULT_LOCALE): { path: string } | { error: string } {
  const env = process.env.DIRA_ENGINE?.trim();
  const repo = env ? path.resolve(env) : path.resolve(process.cwd(), "..", "..");
  if (existsSync(path.join(repo, "tick.sh"))) return { path: repo };
  return {
    error: `${t(locale, "scaffold.engineNotFoundPrefix")} ${repo}${t(locale, "scaffold.engineNotFoundMid")} ${
      env ? t(locale, "scaffold.engineNotFoundEnvHint") : t(locale, "scaffold.engineNotFoundDefaultHint")
    }`,
  };
}

/** 자리표시자 3종 치환(§0-3 표). **문자열을 그대로 바꾼다** — 정규식도 템플릿 엔진도 안 쓴다.
 *  `specDoc`이 비면 `<프로젝트 스펙 문서>`는 **손대지 않는다**(선택 필드다. 프로젝트 시작 시점에
 *  아직 정해지지 않은 값이라 빈 문자열로 치환하면 지도 표의 그 행이 의미를 잃는다).
 *
 *  치환값은 **함수로 준다**. `replaceAll`은 찾는 쪽이 문자열이어도 바꾸는 쪽의 `$&`·`$1`을
 *  해석한다 — 값이 사람이 친 경로라서 그대로 두면 `/p/$&a`가 `/p/<프로젝트>a`가 된다(테스트). */
export function fillPlaceholders(
  text: string,
  { project, branch, specDoc }: { project: string; branch: string; specDoc?: string },
): string {
  const out = text.replaceAll("<프로젝트>", () => project).replaceAll("<통합 브랜치>", () => branch);
  return specDoc ? out.replaceAll("<프로젝트 스펙 문서>", () => specDoc) : out;
}

/** 사람이 손으로 친 경로가 fs 경로가 되는 지점 — 서버에서 편다. 상대경로는 서버 cwd
 *  (`apps/teams/`) 기준으로 풀려서 엉뚱한 자리에 `.dira`를 만든다. */
function queueRoot(projectDir: string, locale: Locale = DEFAULT_LOCALE): { project: string; root: string } {
  const project = expandHome(projectDir.trim());
  if (!path.isAbsolute(project)) {
    throw new Error(
      `${t(locale, "scaffold.notAbsolutePrefix")} ${projectDir.trim() || t(locale, "scaffold.emptyPlaceholder")}`,
    );
  }
  return { project, root: path.join(project, ".dira") };
}

/** 줄 단위 완전일치 넷 중 하나면 "있다"다(§0-19). 파서를 쓰지 않는다 — 못 읽어서 생기는 최악은
 *  중복 한 줄이고, 파서를 지어 틀리는 최악은 커밋된 큐다. */
const DIRA_LINE_RE = /^\/?\.dira\/?$/;

/** `<프로젝트>/.gitignore`에 `.dira` 한 줄을 단다(DESIGN.md §0-19) — 큐 불변식 3(단일 사본)이
 *  깨지는 사고(`git add -A`로 큐가 레포에 들어감)를 막는다. 등록(`addProject`)·생성(`scaffold`)
 *  두 경로가 부른다 — 어느 쪽이 먼저 불러도 나중 호출은 skipped로 끝난다(멱등).
 *  **쓰기가 실패해도 던지지 않는다** — 이 한 줄이 등록·생성을 막는 사유가 되지 않는다(네 갈래 넷째). */
export async function ensureGitignoreLine(project: string): Promise<"written" | "skipped" | "failed"> {
  const file = path.join(project, ".gitignore");
  const text = await readFile(file, "utf8").catch(() => null);
  if (text !== null && text.split("\n").some((line) => DIRA_LINE_RE.test(line.trim()))) {
    return "skipped";
  }
  const prefix = text ? (text.endsWith("\n") ? text : text + "\n") : "";
  return writeFile(file, prefix + ".dira\n").then(() => "written" as const, () => "failed" as const);
}

export type Preflight =
  | { ok: true }
  | { ok: false; queue: boolean; root: string; message: string };

/** `.dira`가 이미 있으면 **만들지 않는다**(§0-3 답변 4(b)). 안의 상태로 문구만 갈린다 —
 *  큐면 등록으로 보내고, 큐가 아니면 고치거나 지우라고 알려 준다. 빈 `.dira`를 스캐폴딩으로
 *  채우지 않는 이유는 사람이 무엇을 지우는지 알고 지우는 편이 낫기 때문이다. */
export async function preflight(projectDir: string, locale: Locale = DEFAULT_LOCALE): Promise<Preflight> {
  const { root } = queueRoot(projectDir, locale);
  const st = await stat(root).catch(() => null);
  if (st === null) return { ok: true };
  // 큐 판정은 등록(`addProject`)과 같은 규칙이다 — 규칙이 갈리면 여기를 통과한 경로가 등록에서
  // 막힌다. `.dira`가 디렉터리가 아니면(파일·깨진 링크) 읽을 것이 없으니 "큐가 아니다"다.
  const inside = st.isDirectory() ? await readdir(root).catch(() => [] as string[]) : [];
  const queue = inside.includes("tickets") || inside.includes("workers");
  return {
    ok: false,
    queue,
    // 화면이 이 값을 등록 카드의 `경로`에 그대로 넣는다(큐면 "만들지 말고 등록하세요"의 다음 행동).
    root,
    message: queue
      ? `${root}${t(locale, "scaffold.alreadyQueueSuffix")}`
      : `${root}${t(locale, "scaffold.notQueueSuffix")}`,
  };
}

/** §0-3 스캐폴딩 집합을 만든다. 돌려주는 경로는 `<프로젝트>` 기준 상대경로다(결과 패널이
 *  그대로 보여준다). `preflight`는 **부르는 쪽이** 먼저 돌린다 — 이 함수는 이미 있는 파일을
 *  건너뛸 뿐 `.dira` 전체의 성격을 판정하지 않는다.
 *
 *  `root`·`repo`도 같이 돌려준다: 다음 단계(`registerCron`·`addProject`)가 큐 경로를 알아야 하고,
 *  유도한 엔진 레포는 결과 패널에 그대로 뜬다(§0-3 — 틀린 값을 나중에 발견하는 자리가 없으면
 *  증상이 "워커가 도는데 아무것도 안 한다"가 된다). 부르는 쪽이 경로를 다시 조립하지 않는다. */
export async function scaffold(
  projectDir: string,
  opts: { branch: string; specDoc?: string },
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ root: string; repo: string; written: string[]; skipped: string[] }> {
  const repo = engineRepo(locale);
  if ("error" in repo) throw new Error(repo.error);
  const { project, root: given } = queueRoot(projectDir, locale);

  // **realpath를 여기서 한 번 태운다**(751e3004). 레지스트리는 root를 realpath로 저장하는데
  // (`addProject` · DESIGN.md:272) 이 함수가 사람이 친 경로를 그대로 돌려주면, 같은 큐가
  // 경로 두 벌로 갈린다: crontab에는 raw 줄이 들어가고 워커 화면은 realpath된 registry root로
  // 대조하니 **방금 만든 w1이 `crontab 미등록`으로 뜬다.** 심링크 구간이 하나만 있어도 그렇다
  // (맥의 `/tmp`·`/var`, 심링크된 홈·마운트). 만들기 전에는 realpath가 ENOENT라 `mkdir` 뒤다.
  await mkdir(given, { recursive: true });
  const root = await realpath(given);

  const written: string[] = [];
  const skipped: string[] = [];
  const put = async (rel: string, text: string, mode?: number) => {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      // O_EXCL. 있는 파일을 덮지 않는 것이 이 기능의 유일한 방어다.
      await writeFile(file, text, { flag: "wx" });
      if (mode !== undefined) await chmod(file, mode);
      written.push(path.join(".dira", rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      skipped.push(path.join(".dira", rel));
    }
  };

  // `tickets/`는 빈 디렉터리다. `mkdir recursive`는 **처음 만든 경로**를 돌려주고 이미 있었으면
  // undefined다 — 그 반환값이 곧 written/skipped 판정이라 stat을 따로 하지 않는다.
  const made = await mkdir(path.join(root, "tickets"), { recursive: true });
  (made === undefined ? skipped : written).push(path.join(".dira", "tickets/"));

  for (const rel of TEMPLATE_FILES) {
    const text = await readFile(path.join(repo.path, "templates", rel), "utf8");
    // ponytail: 자리표시자가 실제로 있는 건 AGENTS.md뿐이지만 전부에 돌린다 — 없는 파일에는
    // no-op이고, 파일마다 "치환 대상인가" 플래그를 다는 쪽이 나중에 조용히 틀린다.
    await put(rel, fillPlaceholders(text, { project, branch: opts.branch, specDoc: opts.specDoc }));
  }

  // 코어(§프롬프트 층 결정 8-a) — 원본은 `<엔진>/protocols/`다. `templates/`에 사본을 두지 않는다
  // (정본 1벌). 자리표시자 치환 없음, `TEMPLATE_FILES`는 손대지 않는다(그 1:1 매핑은 templates/ 전용).
  const coreNames = (await readdir(path.join(repo.path, "protocols"))).filter((n) => n.startsWith("CORE"));
  for (const name of coreNames) {
    const text = await readFile(path.join(repo.path, "protocols", name), "utf8");
    await put(path.join("protocols", name), text);
  }

  // 첫 워커. 필수는 마지막 source 한 줄뿐이고, 그 줄이 없으면 워커는 아무것도 아니다.
  // **`TICKET_CWD`는 넣지 않는다**(§0-3): 엔진 기본값(= 큐 루트의 부모 = `<프로젝트>`)이 새
  // 프로젝트에서 유일하게 실제로 도는 값이다. `<루트>/worktrees/<이름>`은 워커를 **추가할** 때의
  // 규칙이고 그 트리는 사람이 만든다 — 첫 워커에 쓰면 없는 디렉터리를 가리켜 매 tick마다
  // `ERROR cwd 없음`이 난다. worker.sh.example의 `# TICKET_CWD=...`는 주석이라 그대로 둔다.
  // **실효 `TICKET_CONTEXT=()` 한 줄을 `source` 줄 위에 넣는다**(§0-3, 요구 `b2bdfab6`):
  // example은 모든 값이 주석이라 복사만 하면 살아 있는 `TICKET_CONTEXT=(`가 없고,
  // `parseContextBlock`은 주석 블록에 안 걸리게 줄 처음에 앵커하므로(의도된 동작) 새 프로젝트의
  // 워커 화면에서 컨텍스트 카드가 "블록이 없습니다"로 닫힌다. 문자열은 GUI가 0항목을 쓸 때 내는
  // 것과 **같다**(`renderContextBlock([])`) — 새 모양을 만들지 않는다. 주석 예시 블록은 그대로다.
  // **자가 정리도 여기서 태어난다**(§4-4): `<루트>/self-heal.sh` + 워커의 `source` 한 줄.
  // **통합 게이트도 같이 태어난다**(§4-14): `<루트>/dispatch-gate.sh` + 워커의 `source` 한 줄.
  // 2번째 워커부터는 기존 워커 복사(`createWorker`)라 줄이 저절로 승계된다 — 첫 워커에만 쓴다.
  // 실행 파일이 아니라 source되는 파일이라 모드는 기본값이다(`context.sh`·`dispatch-gate.sh`와 같다).
  await put(SELF_HEAL_FILE, SELF_HEAL_SH);
  await put(DISPATCH_GATE_FILE, dispatchGateSh(opts.branch));
  const example = await readFile(path.join(repo.path, "worker.sh.example"), "utf8");
  // 치환값은 함수로 준다 — 경로에 `$&`·`$1`이 들어 있으면 문자열 치환은 그걸 해석한다.
  const w1 = example.replace(
    sourceTick,
    // 한 줄 설명을 붙인다 — 이 자리가 `# --- 필수: …` 제목 아래라서, 없으면 빈 블록이
    // 엔진의 요구로 읽힌다(아니다. 엔진은 미정의 배열을 그대로 받는다 — tick.sh 147행).
    () =>
      `# 컨텍스트(선택). GUI 워커 화면이 이 블록을 고친다 — 항목 문법은 위 주석 예시.\n` +
      `${renderContextBlock([])}\n\n` +
      // `. tick.sh` **바로 위**다. 아래면 엔진이 없을 때 이 줄에 닿기 전에 워커가 죽는다(§4-4·§4-14).
      `${dispatchGateSourceLine(root)}\n${selfHealSourceLine(root, repo.path)}\n${tickSourceLine(repo.path)}`,
  );
  await put("workers/w1.sh", w1, 0o755);

  // §0-19 — `.dira`의 형제 `.gitignore`에 `.dira` 한 줄. 실패해도 스캐폴딩 성공을 막지 않는다.
  const gitignore = await ensureGitignoreLine(project);
  if (gitignore !== "failed") (gitignore === "written" ? written : skipped).push(".gitignore");

  return { root, repo: repo.path, written, skipped };
}
