/** 워커 파일·락·crontab 판정 (DESIGN.md §워커 상태 판정 · §4).
 *
 *  crontab은 **그 프로젝트의 워커 줄만** 쓴다(제약 4, `44f876aa`로 뒤집힘): 변경은 순수 함수
 *  `cronRegister`/`cronUnregister`가 텍스트로 계산하고 `registerCron`/`unregisterCron`이
 *  `crontab -`의 stdin으로 준다. 실패하면 `cronRegisterCmd`/`cronUnregisterCmd`의 복사 명령으로
 *  되돌아간다 — 그래서 그 둘은 남아 있다.
 *  상태 전이(reap·unassign)는 여기서 다시 구현하지 않는다 — `lib/engine.ts`가 워커를 부른다. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cache } from "react";
import { NAME_RE, expandHome, localDir, resolveWithin, shellPath, shellValue } from "./paths.ts";
import type { Ticket } from "./queue.ts";
import { isEligible, tokensPath, type TokenEntry, type TokensFile } from "./auth.ts";
import { DEFAULT_LOCALE, t, type Locale } from "./i18n.ts";

export type WorkerStatus = "running" | "idle" | "stopped" | "stale";

/** 워커 결함 5종 (DESIGN.md §4 표, 넷째는 §0-21 결정 2, 다섯째는 §977419d7 결정 1·3). **`status`에
 *  5번째 값을 만들지 않는다** — 결함은 락·crontab의 사실과 직교한 축이다(사람이 도중에 트리를
 *  지우면 `running` + 결함이다). 넷째(`no-exec`)는 디렉터리가 아니라 워커 파일 자신에 대한
 *  사실이고, 다섯째(`no-ticket-cwd`)는 워커가 둘 이상일 때만 재는 판정이지만, 표현은 다 같다
 *  (경고 배지 + 사유 + CopyCommand) — 타입 이름을 넓히는 리네임은 하지 않는다(§0-21 결정 2). */
export type WorkerDefectKind =
  | "missing-cwd"
  | "missing-link"
  | "shared-cwd"
  | "no-exec"
  | "no-ticket-cwd";

/** `detail`은 판정에 **실제로 쓴 경로·워커 이름**이다. 결함 이름과 "그래서 무슨 일이
 *  일어나나"는 화면이 붙인다(§4 표와 같은 단어를 쓰게 한 자리에 둔다). */
export type WorkerDefect = { kind: WorkerDefectKind; detail: string };

/** 외부 요인으로 세션이 태어나자마자 죽었다 (DESIGN.md §0-5): 한도 소진 · API 과부하 ·
 *  연결 끊김. **큐도 워커도 멀쩡한 상태다** — 그래서 `status`에 5번째 값을 만들지 않는다
 *  (`WorkerDefect`와 같은 축의 판단이고, 실패 직후의 워커는 `idle`이다). */
export type WorkerFailure = {
  /** 그 `FAIL` 줄의 시각. runner.log가 쓴 문자열 그대로다(`2026-07-31 18:09:49`, 이 머신 로컬).
   *  ISO로 갈아 끼우지 않는다 — 사람이 로그 원본에서 이 줄을 찾을 때 쓰는 값이다 */
  at: string;
  /** 실패한 티켓 해시 */
  hash: string;
  /** **엔진이 준 문자열 그대로.** 번역도 분류도 하지 않는다 — `resets 7:40pm (Asia/Seoul)`처럼
   *  사람이 다음에 할 일이 이 문장 안에 이미 있다 */
  reason: string;
  /** `workers/logs/` 안의 파일명. 사람이 원본을 열 유일한 단서다 */
  log: string;
};

export type Worker = {
  /** 파일 stem. 액션(생성·삭제·reap)이 가리키는 이름이다 */
  name: string;
  /** 실효 `TICKET_NAME` (`tick.sh:37` — 대입이 없으면 파일 stem이다). **락·runner.log 줄·세션
   *  로그 파일명(`tick.sh:264`)·`owner:`가 전부 이 이름이지 `name`이 아니다.** 밖으로 내는 이유는
   *  §0-8 소비 토큰이 그 로그 파일명에서 워커를 읽기 때문이다 — `name`으로 붙이면 `TICKET_NAME`을
   *  대입한 워커만 조용히 `0`으로 뜬다(`recentLog`가 이미 이 키로 붙는다) */
  effName: string;
  path: string;
  status: WorkerStatus;
  /** crontab에 이 파일 경로가 있는가 */
  cron: boolean;
  lockPid: number | null;
  /** 지금 물고 있는 티켓 해시 (`.wip` 티켓의 `owner:` 역추적) */
  holding: string | null;
  /** TICKET_ENGINE 대입. **`null` = 대입이 아예 없다**(= tick.sh 기본값으로 돈다).
   *  기본값으로 덮어쓰지 않는 이유는 화면이 그 둘을 갈라야 해서다 — 대입 없음은
   *  `[기본값 가정]` 배지가 붙고 claude 기본 블록은 안 붙는다(§비주얼 §23 ① 표시 4종).
   *  실효 값이 필요한 자리는 `engineName`·`engineCell`이 `null`을 받아 기본값을 편다 */
  engine: string | null;
  /** runner.log에서 이 워커의 **최근 20줄**(최신이 앞). 셀은 `[0]`을 쓰고 펼치면 전부 뜬다
   *  (§4-7). 마지막 한 줄을 따로 들지 않는 것은 두 필드가 갈릴 자리를 안 만드는 것이다 */
  recentLog: string[];
  /** 외부 요인으로 죽은 마지막 세션 (§0-5). **정상 상태에서는 항상 `null`이다** */
  lastFailure: WorkerFailure | null;
  /** TICKET_CONTEXT 항목(경로·설명·존재 여부) 또는 못 읽은 사유 */
  context: WorkerContext;
  /** 공통 컨텍스트 `source` 줄이 있는가. false면 이 워커는 공통을 못 받는다 (§4-1) */
  commonSource: boolean;
  /** 공통 워커 풀의 shim인가 — 둘째 줄 표식 `# dira-pool: <이름>`이 있으면 참이다(§4-16 결정 2·6).
   *  판정을 두 벌로 안 적는다: `lib/pool.ts`의 `poolWorkerNameOf`와 같은 정규식이다(순환 import를
   *  피하려고 여기서 다시 적는다 — `pool.ts`가 이미 `createWorker`·`deleteWorker`를 이 파일에서
   *  가져간다). */
  commonWorker: boolean;
  /** 자가 정리 `source` 줄이 있는가. false면 dira를 지워도 이 워커의 cron 줄이 남는다 (§4-4) */
  selfHealSource: boolean;
  /** 통합 게이트 `source` 줄이 있는가. false면 받는 트리가 더러워도 그냥 디스패치돼 push에서만
   *  막힌다 (§4-14) */
  dispatchGateSource: boolean;
  /** `<루트>/dispatch-gate.sh`가 **낡음**(내용이 다르고 관리 표식은 있다)인가 — 프로젝트당 한
   *  판정이라 워커마다 같은 값이다. `source` 줄이 있어도 이게 true면 화면이 경고한다(§4-14 §소급) */
  dispatchGateStale: boolean;
  /** `TICKET_CWD` (셸 없이 읽은 절대경로). null = 줄이 없다 → 엔진 기본값은 루트의 부모다 */
  cwd: string | null;
  /** 작업 디렉터리 결함 (§4). **0개가 정상이고 그때 화면은 아무것도 늘지 않는다** */
  defects: WorkerDefect[];
  /** §4-19 결정 1·3 — 표준 자리(조건 a)를 §4-14 게이트(조건 b·c)가 지키고 있어 `missing-cwd`를
   *  안 낸 자리. 결함이 아니라 표기 한 줄이라 `defects`에 안 넣는다(§비주얼 §69) — 화면이 이
   *  값이 있을 때만 경고 없는 `<p>`를 스택 마지막에 그린다. `undefined` = 뜰 자리가 아니다 */
  cwdPending?: string;
  /** 사람이 결함을 고치는 준비 명령. `missing-cwd`·`missing-link`·`shared-cwd` 중 하나라도 있을
   *  때만 채운다 — §4 생성의 3줄과 같은 함수다 */
  worktree?: string[];
  /** `no-exec` 결함의 CopyCommand(`chmod +x <절대경로>`, §0-21 결정 2) — `no-exec`가 없으면
   *  없다. 복구 버튼은 이 판정의 몫이 아니다(§0-21 결정 3, 로드맵 P290-4가 붙인다) */
  execFix?: string;
  /** `no-ticket-cwd` 결함의 CopyCommand(§977419d7 결정 3) — 워커 파일에 `TICKET_CWD=` 한 줄만
   *  더한다. `worktree`(3단계)가 아니다: 트리는 다음 tick에 게이트가 만든다. `no-ticket-cwd`가
   *  없으면 없다 */
  cwdFix?: string;
  /** 공통 워커 풀의 shim인가(§4-16 결정 2 — 둘째 줄 `# dira-pool: <이름>` 표식, `poolShimNameOf`로
   *  판정한다). shim도 이 파일 목록에 그대로 섞여 있어서(`createWorker`가 만든 같은 모양의 파일이라)
   *  `listWorkers`가 굳이 걸러내지 않고 이 필드 하나로 알려 준다 — 설정 `워커` 패널의 `공통` 배지·
   *  종류 필터가 이 값을 읽는다(§비주얼 §68) */
  pool: boolean;
};

/** 엔진 이름 = **첫 토큰의 basename**. `tick.sh:52`의 `basename "${TICKET_ENGINE[0]}"`와 같은
 *  식이다 — 인증 판정(§0-4)이 이 값 하나에 걸리므로 식을 두 벌로 적지 않고 화면이 이걸 부른다.
 *  ponytail: 셸을 실행하지 않으니 따옴표만 벗긴다 — `$VAR` 전개는 `parseWorkerFile`의 다른
 *  값들과 같은 선이다(전개해야 하면 `shellValue`가 이미 있는 자리로 옮긴다). */
export function engineName(engine: string | null): string {
  // `null` = 대입이 없다 = tick.sh 기본값이 실제로 돈다. 인증 배너(§0-4)가 그 워커에도 떠야 한다.
  const first = (engine ?? DEFAULT_ENGINE).trim().split(/\s+/)[0] ?? "";
  const name = path.basename(first.replace(/^(['"])(.*)\1$/, "$2"));
  // 엔진 수정 27번째 계약 3(tick.sh:550-554와 같은 판정, 한 자리뿐이다):
  // dira -> claude(24번째 그대로), dira-<x> -> <x>, 그 외는 basename 그대로.
  if (name === "dira") return "claude";
  return name.startsWith("dira-") ? name.slice("dira-".length) : name;
}

/** tick.sh와 **같이** 조립한다:
 *  `${TICKET_LOCAL:-~/.config/dira}/run/<이름>-<sha1(<workers 절대경로>/<이름>)[:8]>.lock`
 *
 *  `TICKET_LOCAL`은 프로젝트별이 아니라 머신 전역이라 모든 프로젝트의 락이 한 디렉터리에 섞인다.
 *  해시에 workers 절대경로가 들어 있어 이름이 같은 `w1`끼리도 충돌하지 않는다. 그래서 반대로
 *  **락 디렉터리에서 워커를 역추적하지 않고** 워커 파일 목록에서 락을 찾는다.
 *
 *  여기 들어가는 `<이름>`은 파일 stem이 아니라 **실효 `TICKET_NAME`**이다(tick.sh 37·87행). */
export function lockPath(workersDir: string, name: string): string {
  const h = createHash("sha1").update(path.join(workersDir, name)).digest("hex").slice(0, 8);
  return path.join(localDir(), "run", `${name}-${h}.lock`);
}

/** 락은 디렉터리다(`mkdir`가 원자적 획득). 안의 `pid` 파일이 소유 프로세스다.
 *  **`export`다** — `pool.ts`의 `poolWorkerFullStatus`가 같은 판정을 슬롯 잠금(`pool-<이름>.lock`)에
 *  다시 쓴다(§4-16 티켓 열째 노드). 락 디렉터리 이름 규칙만 다르고 판정은 한 벌이어야 한다. */
export async function lockOf(dir: string): Promise<{ held: boolean; pid: number | null }> {
  const held = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!held) return { held: false, pid: null };
  const raw = await readFile(path.join(dir, "pid"), "utf8").catch(() => "");
  const pid = Number.parseInt(raw.trim(), 10);
  return { held: true, pid: Number.isInteger(pid) && pid > 0 ? pid : null };
}

/** `kill -0`. EPERM은 남의 프로세스지만 **살아 있다**는 뜻이다. `export`는 위 `lockOf`와 같은 이유
 *  (`pool.ts`의 `poolWorkerFullStatus`가 재사용한다). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 한글 경로 비교는 **반드시** 양쪽을 맞춰야 한다(`queue.ts`와 같은 이유):
 *  macOS `crontab -l`은 사람이 넣은 줄을 NFC로 그대로 주는데 `realpath()`는 같은 경로를
 *  NFD(자모 분해)로 돌려주는 파일시스템이 있다(구글 드라이브 마운트). 정규화 없이 비교하면
 *  cron에 등록돼 도는 워커가 `stopped` + `미등록`으로 뜨고, 화면이 권하는 등록 명령을 실행하면
 *  **중복 cron 줄**이 생긴다. `export`는 `pool.ts`가 풀 파일의 crontab 부분일치를 같은 함수로 재는
 *  이유다(판정이 두 벌로 갈리면 화면이 거짓말을 한다). */
export const nfc = (s: string) => s.normalize("NFC");

/** **요청당 1회**. 셸이 전환기 카운트를 위해 등록된 프로젝트 전부에 `listWorkers`를 돌리므로
 *  이게 없으면 한 화면에 `crontab -l` 프로세스가 프로젝트 수만큼 뜬다(§성능 예산: 요청당
 *  서브프로세스 0~1회).
 *
 *  `cache()`의 수명은 **요청 하나**다 — 프로세스 전역이 아니다. 그래서 사람이 crontab을 고치면
 *  다음 요청(보드 5초 폴링·`revalidatePath`·새로고침)이 다시 읽는다. 프로세스 전역 캐시였다면
 *  워커 화면이 계속 거짓말을 한다 — 그게 원래 캐시를 안 넣었던 이유고, 그 조건이 여기서 지켜진다.
 *
 *  쓰기 경로는 `crontabForWrite`가 따로 읽는다(캐시 대상이 아니다) — 렌더 때 읽은 값 위에 쓰면
 *  그 사이 남의 변경을 되돌린다.
 *
 *  `export`는 `pool.ts`의 `poolWorkerFullStatus`가 같은 요청 안에서 재사용하는 이유다 — 풀 줄도
 *  crontab 진입점이라(§4-16 결정 2) 같은 캐시를 한 번 더 쓰지 두 번째 `crontab -l`을 안 띄운다. */
export const crontabText = cache(async (): Promise<string> => {
  try {
    const { stdout } = await promisify(execFile)("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // crontab 없음·비어 있음 = 등록된 워커 없음
  }
});

// ── 워커 파일 읽기 ──────────────────────────────────────────────────────────

/** 주석 줄(`# TICKET_ENGINE=…`)에 걸리지 않게 줄 처음에 앵커한다. worker.sh.example이 전부
 *  주석 처리된 할당문이라 이 앵커가 없으면 예시 값이 실제 설정으로 보인다. */
const nameAssign = /^[ \t]*(?:export[ \t]+)?TICKET_NAME=(.*)$/gm;
const engineAssign = /^[ \t]*(?:export[ \t]+)?TICKET_ENGINE=\(/m;
const cwdAssign = /^[ \t]*(?:export[ \t]+)?TICKET_CWD=(.*)$/gm;

/** 워커 파일에서 읽는 값. **셸을 실행하지 않는다** — 등록된 경로의 임의 코드가 GUI 권한으로
 *  도는 걸 막는 게 이 함수의 존재 이유다(`shellValue`와 같은 결정). */
function parseWorkerFile(text: string): {
  name: string | null;
  engine: string | null;
  /** 컨텍스트 경로의 `$TICKET_CWD`를 펴는 데만 쓴다(표시·존재 확인용) */
  cwd: string | null;
} {
  let name: string | null = null;
  for (const m of text.matchAll(nameAssign)) name = shellValue(m[1]) ?? name; // 뒤 할당이 이긴다
  let cwd: string | null = null;
  // cwd는 기준 디렉터리다 — 절대경로가 아니면 못 읽은 것으로 본다(`shellPath`, ce40243f).
  for (const m of text.matchAll(cwdAssign)) cwd = shellPath(m[1]) ?? cwd;

  let engine: string | null = null;
  const m = engineAssign.exec(text);
  if (m) {
    const open = m.index + m[0].length;
    const close = text.indexOf(")", open);
    // 닫는 괄호가 없으면 파일이 깨진 것이다 — 추측해서 반쪽을 보여주지 않는다.
    if (close > open) engine = text.slice(open, close).replace(/\\?\s+/g, " ").trim() || null;
  }
  return { name, engine, cwd };
}

// ── TICKET_CONTEXT 블록 (tick.sh 141~153행) ────────────────────────────────
//
// 셸 스크립트를 프로그램이 고치는 자리다. 엉뚱한 라인을 밟으면 워커가 죽고 cron이 조용히
// 실패한다 — 그래서 **아는 모양만 고치고, 나머지는 거부한다**(DESIGN.md §4 컨텍스트 경로 관리).

/** 워커 파일에 그대로 들어가는 한 항목. `path`는 **셸 문자열**이라 `$TICKET_CWD`가 살아 있다 —
 *  덕분에 w1의 설정을 w2로 복사해도 각자 자기 워크트리를 가리킨다. */
export type ContextItem = {
  path: string;
  desc: string;
  /** `$HOME`·`$TICKET_CWD`를 편 결과. 표시·존재 확인용이고 파일에는 안 들어간다 */
  resolved: string;
  /** 엔진의 `[ -e ]`와 같은 판정. null = 못 편 변수가 남아 확인 불가 */
  exists: boolean | null;
};

/** 못 읽으면 편집 UI를 열지 않는다 — 사람이 손으로 고쳐야 한다는 사실과 이유를 넘긴다.
 *  `missing`은 블록 자체가 없는 경우만 `true`다(§4) — 화면이 "넣을 줄" 안내를 이 플래그로 켠다. */
export type WorkerContext =
  | { ok: true; items: ContextItem[] }
  | { ok: false; reason: string; missing?: true };

/** 주석 처리된 블록(`# TICKET_CONTEXT=(`)에 걸리지 않게 줄 처음에 앵커한다.
 *
 *  배열 이름이 인자인 이유는 공통 컨텍스트 파일이다(§4-1): 그 파일의 파싱 대상은
 *  `TICKET_CONTEXT_COMMON`이고 같은 파일에 `TICKET_CONTEXT` 대입이 하나 더 있다(병합 2줄) —
 *  이름을 나누지 않으면 "할당이 2개입니다"로 자기 파일을 거부한다. 문법·거부 규칙은 하나다. */
const contextOpen = (arr: string) =>
  new RegExp(`^[ \\t]*(?:export[ \\t]+)?${arr}(\\+?)=\\(`, "gm");

/** 항목 하나 = 큰따옴표 문자열 · 작은따옴표 문자열 · 맨 낱말. **이 셋 말고는 거부한다.**
 *  `\`·백틱은 아예 안 받는다(다시 쓸 때 이스케이프 의미가 갈린다). 맨 낱말에 글로브 문자를
 *  넣지 않는 이유도 같다 — 셸은 인용 없는 `*`를 펴는데 GUI는 큰따옴표로 다시 쓴다. */
const contextEntry = /^(?:"([^"\\`]*)"|'([^'\\`]*)'|([A-Za-z0-9_/.$:@=+,%{}-]+))/;

function splitEntry(entry: string): { path: string; desc: string } {
  // 엔진과 같이 **첫 `|`**로 가른다(tick.sh 146행 `${entry%%|*}` · `${entry#*|}`).
  const i = entry.indexOf("|");
  return i < 0 ? { path: entry, desc: "" } : { path: entry.slice(0, i), desc: entry.slice(i + 1) };
}

export type ContextBlock =
  | { ok: true; items: { path: string; desc: string }[]; start: number; end: number }
  | { ok: false; reason: string; missing?: true };

type ArrayBlock =
  | { ok: true; entries: string[]; start: number; end: number }
  | { ok: false; reason: string; missing?: true };

/** bash 배열 블록의 **경계와 원시 항목**. 거부 규칙(`할당이 2개`·`+=`·`블록 안에 주석`·
 *  `닫는 )가 없다`·인용 의미가 갈리는 항목)의 **유일한 출처**다.
 *
 *  뜻은 부르는 쪽이 붙인다: 컨텍스트는 `경로|설명`으로 가르고(`splitEntry`), 엔진(§4-3)은
 *  argv 토큰이라 가르지 않는다. 같은 규약을 두 벌 적지 않으려고 여기서 갈렸다. */
function parseArrayBlock(text: string, arr: string, locale: Locale = DEFAULT_LOCALE): ArrayBlock {
  const opens = [...text.matchAll(contextOpen(arr))];
  // `missing`은 **없음**만 표시한다 — 모양이 다른 블록과 갈려야 엔진(§4-3)이 없을 때만 삽입한다.
  if (opens.length === 0) {
    return { ok: false, reason: `${arr}${t(locale, "workers.context.blockMissingSuffix")}`, missing: true };
  }
  if (opens.length > 1) {
    return {
      ok: false,
      reason: `${arr} ${t(locale, "workers.context.multiAssignMid")}${opens.length}${t(locale, "workers.context.multiAssignSuffix")}`,
    };
  }
  const m = opens[0];
  if (m[1]) return { ok: false, reason: t(locale, "workers.context.appendAssign") };

  const start = m.index;
  const entries: string[] = [];
  let i = start + m[0].length;
  for (;;) {
    while (i < text.length && " \t\r\n".includes(text[i])) i++;
    if (i >= text.length) return { ok: false, reason: t(locale, "workers.context.noClosingParen") };
    if (text[i] === ")") return { ok: true, entries, start, end: i + 1 };
    if (text[i] === "#") {
      // 블록 전체를 치환하므로 안의 주석은 사라진다. 지우는 대신 거부한다.
      return { ok: false, reason: t(locale, "workers.context.commentInBlock") };
    }
    const e = contextEntry.exec(text.slice(i));
    const after = e ? text[i + e[0].length] : undefined;
    // 이어붙이기(`"$X"/y`)도 예상 밖이다 — 항목 하나는 공백이나 `)`로 끝나야 한다.
    if (!e || (after !== undefined && !" \t\r\n)".includes(after))) {
      const snippet = text.slice(i, i + 30).split("\n")[0];
      return {
        ok: false,
        reason: `${t(locale, "workers.context.unreadableEntryPrefix")} ${snippet}`,
      };
    }
    // 큰따옴표 안에서도 `$( )`는 셸이 실행한다. 실행되는 것을 GUI가 다시 쓰지 않는다.
    if (e[0].includes("$(")) {
      return {
        ok: false,
        reason: `${t(locale, "workers.context.commandSubInEntryPrefix")} ${e[0]}`,
      };
    }
    // 작은따옴표 안의 `$`는 셸이 펴지 않는데 GUI는 큰따옴표로 다시 쓴다 = 의미가 바뀐다.
    if (e[2] !== undefined && e[2].includes("$")) {
      return {
        ok: false,
        reason: `${t(locale, "workers.context.dollarInSingleQuotePrefix")} ${e[0]}`,
      };
    }
    entries.push(e[1] ?? e[2] ?? e[3]);
    i += e[0].length;
  }
}

/** 워커 파일 텍스트에서 `TICKET_CONTEXT=( … )` 블록을 찾아 항목과 **치환 구간**을 돌려준다.
 *  모양이 조금이라도 예상과 다르면 `ok: false` — 반쪽만 고치는 것보다 거부가 낫다. */
export function parseContextBlock(
  text: string,
  arr = "TICKET_CONTEXT",
  locale: Locale = DEFAULT_LOCALE,
): ContextBlock {
  const b = parseArrayBlock(text, arr, locale);
  return b.ok ? { ok: true, items: b.entries.map(splitEntry), start: b.start, end: b.end } : b;
}

/** 파일에 들어갈 블록 텍스트. 항상 큰따옴표로 쓴다 — `$TICKET_CWD`는 살리고 공백은 죽인다. */
export function renderContextBlock(
  items: { path: string; desc: string }[],
  arr = "TICKET_CONTEXT",
): string {
  if (items.length === 0) return `${arr}=()`;
  const lines = items.map((it) => `  "${it.path}${it.desc ? `|${it.desc}` : ""}"`);
  return `${arr}=(\n${lines.join("\n")}\n)`;
}

/** 사용자 입력이 **셸 스크립트 안의 큰따옴표 문자열**이 된다. 여기가 그 신뢰 경계다:
 *  큰따옴표 안에서 특별한 건 `"`·`` ` ``·`\`·`$`뿐이고, `$`만 살려 두고(그게 용도다)
 *  명령 치환 `$( )`는 막는다. 클라이언트 검증은 검증이 아니다 — 이 함수가 서버에서 돈다. */
function cleanItem(
  raw: { path: string; desc: string },
  locale: Locale = DEFAULT_LOCALE,
): { path: string; desc: string } {
  const path = raw.path.trim();
  const desc = raw.desc.trim();
  if (!path) throw new Error(t(locale, "workers.context.emptyPath"));
  if (path.includes("|")) {
    throw new Error(`${t(locale, "workers.context.pipeInPathPrefix")} ${path}`);
  }
  for (const [whatKey, s] of [
    ["workers.context.pathLabel", path],
    ["workers.context.descLabel", desc],
  ] as const) {
    const what = t(locale, whatKey);
    if (/["`\\\r\n]/.test(s)) throw new Error(`${what}${t(locale, "workers.context.forbiddenCharsSuffix")} ${s}`);
    if (s.includes("$(")) throw new Error(`${what}${t(locale, "workers.context.commandSubFieldSuffix")} ${s}`);
  }
  return { path, desc };
}

/** 존재 확인용 변수 전개. 셸을 실행하지 않으므로 아는 변수는 이 둘뿐이다. */
function expandVars(v: string, cwd: string): string {
  return v
    .replace(/\$\{TICKET_CWD\}|\$TICKET_CWD(?![A-Za-z0-9_])/g, cwd)
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, homedir());
}

/** 컨텍스트 경로는 **루트 밖을 허용한다**(그게 용도다). 쓰기 대상이 아니라 워커 파일에 들어갈
 *  문자열일 뿐이므로 `resolveWithin`을 걸지 않고 `stat`으로 존재만 본다 — 엔진의 `[ -e ]`와 같다.
 *
 *  `cwds`가 **여럿**인 자리는 공통 컨텍스트다(§4-1: 항목 하나를 워커 N개가 각자 자기
 *  `TICKET_CWD`로 편다). 그때는 전원 일치일 때만 단정한다 — 갈리면 `null`(`확인 못 했습니다`)이고
 *  `resolved`도 `$TICKET_CWD`를 편 척하지 않는다. 한 워커의 사실을 전원의 사실로 그리면
 *  같은 화면의 워커 카드와 반대 판정이 나온다(`6e3dcd79`). */
async function withExistence(
  items: { path: string; desc: string }[],
  cwds: string[],
): Promise<ContextItem[]> {
  return Promise.all(
    items.map(async (it) => {
      const paths = [...new Set(cwds.map((c) => expandVars(it.path, c)))];
      // 후보가 갈리면 한 값으로 못 보여준다 — `$TICKET_CWD`는 그대로 두고 `$HOME`만 편다.
      const resolved = paths.length === 1 ? paths[0] : expandVars(it.path, "$TICKET_CWD");
      if (/\$[A-Za-z_{]/.test(paths[0])) {
        return { ...it, resolved, exists: null }; // 못 편 변수가 남았다 — 없다고 단정하지 않는다
      }
      const found = await Promise.all(
        paths.map((p) =>
          stat(p).then(
            () => true,
            () => false,
          ),
        ),
      );
      return {
        ...it,
        resolved,
        exists: found.every(Boolean) ? true : found.some(Boolean) ? null : false,
      };
    }),
  );
}

/** 워커 하나의 컨텍스트. `text`를 이미 읽었으면 넘겨서 재읽기를 아낀다. */
async function contextOf(root: string, text: string, cwd: string | null): Promise<WorkerContext> {
  const b = parseContextBlock(text);
  if (!b.ok) return b;
  // tick.sh 39행: TICKET_CWD 기본값은 루트의 부모다.
  return { ok: true, items: await withExistence(b.items, [cwd ?? path.dirname(root)]) };
}

/** **원자적 교체.** cron이 1분마다 워커 파일을 실행하고 bash는 스크립트를 조금씩 읽는다 —
 *  제자리 덮어쓰기 중에 tick이 걸리면 반쪽 스크립트가 실행된다. rename은 원자적이라
 *  그 순간의 tick은 이전 파일이나 새 파일 중 하나를 온전히 본다.
 *  `mode`를 받는 이유: 워커 파일의 755를 잃지 않고, 새로 만드는 파일은 호출자가 정한다. */
async function atomicWrite(file: string, text: string, mode: number): Promise<void> {
  const tmp = `${file}.gui-${process.pid}.tmp`;
  await writeFile(tmp, text, { flag: "wx", mode });
  await rename(tmp, file).catch(async (e) => {
    await unlink(tmp).catch(() => {});
    throw e;
  });
}

/** 블록 구간을 새 항목으로 갈고 → 다시 읽어 같은지 확인하고 → 원자적으로 쓴다.
 *  워커 파일과 공통 파일이 **같은 경로를 쓴다**(§4-1: 자기검증·rename을 복붙하지 않는다). */
async function writeBlock(
  file: string,
  text: string,
  span: { start: number; end: number },
  clean: { path: string; desc: string }[],
  arr: string,
  mode: number,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  const next = text.slice(0, span.start) + renderContextBlock(clean, arr) + text.slice(span.end);
  // 자기 검증: 쓴 것을 다시 읽어 같은 항목이 나오는지 본다. 이스케이프가 틀리면 여기서 멈춘다.
  const back = parseContextBlock(next, arr, locale);
  if (!back.ok || JSON.stringify(back.items) !== JSON.stringify(clean)) {
    const reason = back.ok ? t(locale, "workers.context.rewriteMismatchContentDiff") : back.reason;
    throw new Error(
      `${t(locale, "workers.context.rewriteMismatchPrefix")}${reason}${t(locale, "workers.context.rewriteMismatchSuffix")}`,
    );
  }
  await atomicWrite(file, next, mode);
  return next;
}

/** 블록 전체 치환. 모양이 예상과 다르면 **쓰지 않고** 손으로 고치라고 알린다. */
export async function writeContext(
  root: string,
  name: string,
  items: { path: string; desc: string }[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerContext> {
  const file = await workerFile(root, name, locale);
  const text = await readFile(file, "utf8");
  const b = parseContextBlock(text, "TICKET_CONTEXT", locale);
  if (!b.ok) {
    throw new Error(
      `${name}.sh${t(locale, "workers.context.cantSafelyEditMid")} ${b.reason}${t(locale, "workers.context.editByHandSuffix")}`,
    );
  }
  const clean = items.map((it) => cleanItem(it, locale));
  const next = await writeBlock(
    file,
    text,
    b,
    clean,
    "TICKET_CONTEXT",
    (await stat(file)).mode & 0o777,
    locale,
  );
  const { cwd } = parseWorkerFile(next);
  return { ok: true, items: await withExistence(clean, [cwd ?? path.dirname(root)]) };
}

/** 워커 간 복사. 갈라진 컨텍스트는 티켓 결과를 워커에 따라 달라지게 만든다.
 *  `$TICKET_CWD`를 펴지 않고 문자열째로 옮기므로 받는 워커는 자기 워크트리를 가리킨다. */
export async function copyContext(
  root: string,
  from: string,
  to: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerContext> {
  if (from === to) throw new Error(t(locale, "workers.context.sameWorker"));
  const src = await readFile(await workerFile(root, from, locale), "utf8");
  const b = parseContextBlock(src, "TICKET_CONTEXT", locale);
  if (!b.ok) {
    throw new Error(`${from}.sh${t(locale, "workers.context.copyReadFailMid")} ${b.reason}`);
  }
  return writeContext(root, to, b.items, locale);
}

// ── 공통 컨텍스트 `<루트>/context.sh` (DESIGN.md §4-1) ──────────────────────
//
// 워커 5개가 같은 3항목을 각자 복사해 들고 있던 것을 사본 하나로 만든다. 엔진은 무수정이다 —
// 셸 파일 하나 + 워커 파일의 `source` 한 줄이고, 새 엔진 변수도 새 프로토콜도 없다.

const COMMON_FILE = "context.sh";
/** 엔진 변수가 아니다. 이 파일 안에서만 쓴다 — 그래서 `TICKET_CONTEXT`와 이름이 갈려야 한다. */
const COMMON_ARR = "TICKET_CONTEXT_COMMON";

/** §4-1의 고정 문구. 처음 쓸 때만 들어가고 그 뒤로는 위 블록만 치환된다.
 *  병합 2줄이 **공통을 워커 자기 항목 앞에** 놓는다(`${arr[@]+"…"}` = set -u에서 미정의 배열을
 *  안전하게 전개하는 tick.sh 44·147행의 관용구. bash 3.2에서 빈 배열도 통한다 — 테스트가 확인). */
const COMMON_TEMPLATE = `# 공통 참조 컨텍스트 — 워커 전원이 source한다. GUI 워커 화면(§4-1)이 위 블록을 치환한다.
# ${COMMON_ARR}은 엔진 변수가 아니다(이 파일 안에서만 쓴다).
${COMMON_ARR}=()
# 공통을 워커 자기 항목 **앞에** 끼운다. \${arr[@]+"…"}는 set -u에서 미정의 배열을 안전하게
# 전개하는 관용구다(bash 3.2 포함 — tick.sh 44·147행과 같은 idiom).
TICKET_CONTEXT=(
  \${${COMMON_ARR}[@]+"\${${COMMON_ARR}[@]}"}
  \${TICKET_CONTEXT[@]+"\${TICKET_CONTEXT[@]}"}
)
`;

/** 워커 파일이 공통 파일을 `.` 하는 한 줄 (§4-1). 블록 **아래**에 들어간다 —
 *  위에 두면 워커의 `TICKET_CONTEXT=(`가 공통을 덮어쓴다(`=`는 대입이다). */
export function commonSourceLine(root: string): string {
  return `. ${dq(path.join(root, COMMON_FILE))}   # 공통 컨텍스트를 최상단에 끼운다`;
}

/** ponytail: `context.sh`를 `.` 하는 줄이면 무엇이든 있는 것으로 본다(경로 비교를 안 한다).
 *  다른 큐의 `context.sh`를 가리키는 줄까지 통과시키는 것이 천장이다 — 그런 워커가 생기면
 *  경로까지 비교한다(그때는 NFC 정규화와 `$HOME` 전개가 같이 필요하다). */
const commonSourceRe = /^[ \t]*(?:\.|source)[ \t]+[^\n]*context\.sh/m;

/** 공통 항목의 `$TICKET_CWD`를 펼 후보들. **공통을 실제로 `source`하는 워커의 값만** 본다 —
 *  못 받는 워커의 cwd로 판정하면 카드가 남의 사실을 알려 준다. 하나도 없으면 tick.sh 39행 기본값.
 *  ponytail: 워커 파일을 여기서 한 번 더 읽는다(프로젝트당 한 자릿수 파일). `listWorkers`와
 *  합치려면 `Worker`에 cwd를 싣고 호출자 셋을 다 고쳐야 한다 — 느려지면 그때 한다. */
async function commonCwds(root: string): Promise<string[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh"));
  const out = new Set<string>();
  for (const n of names) {
    const text = await readFile(path.join(dir, n), "utf8").catch(() => "");
    if (commonSourceRe.test(text)) out.add(parseWorkerFile(text).cwd ?? path.dirname(root));
  }
  return out.size ? [...out] : [path.dirname(root)];
}

/** 워커 중 하나라도 공통 파일을 `source`하는 줄을 이미 갖고 있는가 — `commonCwds`와 같은
 *  스캔이지만 존재 여부만 본다(§개정 2026-08-31, 요구 `421f440d` §소급). */
async function anyWorkerSourcesCommon(root: string): Promise<boolean> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh"));
  for (const n of names) {
    const text = await readFile(path.join(dir, n), "utf8").catch(() => "");
    if (commonSourceRe.test(text)) return true;
  }
  return false;
}

/** 공통 파일이 없는데 이미 어느 워커가 그 줄을 `source`하고 있으면(옛 `공통 적용` — 공통 항목을
 *  한 번도 안 넣은 큐에서도 줄만 먼저 심을 수 있었다) 빈 고정 문구로 채워 낫게 한다 — 아무도 안
 *  불렀으면(그런 워커가 없으면) 만들 이유가 없다.
 *
 *  §복(2026-08-31, 티켓 `bcac177c`): `readCommonContext`(워커 화면이 열릴 때) 하나에서만 부르면
 *  그 화면을 거치지 않는 `unassign`-`reap`(티켓 상세의 `할당 해제`-`수거` 버튼, `lib/engine.ts`
 *  `runWorker`가 워커 셸을 직접 부르는 경로)은 낫지 않는다 — 그래서 `runWorker`도 이 함수를
 *  부른다. 이미 있으면 `stat` 한 번으로 끝난다. */
export async function healCommonContextFile(root: string): Promise<void> {
  const file = path.join(root, COMMON_FILE);
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  if (!exists && (await anyWorkerSourcesCommon(root))) {
    await atomicWrite(file, COMMON_TEMPLATE, 0o644);
  }
}

/** `<루트>/context.sh`의 공통 항목. **파일이 없으면 0개다 — 오류가 아니다**(§4-1). */
export async function readCommonContext(
  root: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerContext> {
  const file = path.join(root, COMMON_FILE);
  let text: string | null = null;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // 없음 = 공통 0개(빈 상태 카드). 권한·EISDIR은 사유를 넘긴다 — 0개라고 우기지 않는다.
    if (err.code !== "ENOENT") {
      return {
        ok: false,
        reason: `${COMMON_FILE}${t(locale, "workers.context.commonReadFailMid")} ${err.message}`,
      };
    }
    await healCommonContextFile(root);
    text = await readFile(file, "utf8").catch(() => null);
  }
  if (text === null) return { ok: true, items: [] };
  const b = parseContextBlock(text, COMMON_ARR, locale);
  if (!b.ok) return b;
  // 기준 cwd는 **공통을 받는 워커 전원의 `TICKET_CWD`**다. 루트의 부모(tick.sh 39행 기본값)로
  // 단정하면 워커가 그 값을 덮어쓴 큐에서 있는 파일을 `없음`으로 그린다(`6e3dcd79`).
  return { ok: true, items: await withExistence(b.items, await commonCwds(root)) };
}

/** 공통 항목 치환. 파일이 없으면 §4-1 고정 문구(주석 + 병합 2줄)까지 새로 만든다.
 *  자기검증·원자적 rename은 `writeContext`와 같은 `writeBlock`을 쓴다. */
export async function writeCommonContext(
  root: string,
  items: { path: string; desc: string }[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorkerContext> {
  const file = path.join(root, COMMON_FILE);
  let text: string | null = null;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // 있는 파일은 블록만 갈린다 — 병합 2줄은 처음 쓸 때 넣은 뒤 다시 만지지 않는 고정 문구다.
  const base = text ?? COMMON_TEMPLATE;
  const b = parseContextBlock(base, COMMON_ARR, locale);
  if (!b.ok) {
    throw new Error(
      `${COMMON_FILE}${t(locale, "workers.context.commonEditMid1")}${COMMON_ARR}${t(locale, "workers.context.commonEditMid2")} ${b.reason}${t(locale, "workers.context.editByHandSuffix")}`,
    );
  }
  const clean = items.map((it) => cleanItem(it, locale));
  // 실행 파일이 아니다(워커가 `.` 한다). 있던 파일의 mode는 사람이 정한 것이니 잃지 않는다.
  const mode = text === null ? 0o644 : (await stat(file)).mode & 0o777;
  await writeBlock(file, base, b, clean, COMMON_ARR, mode, locale);
  return { ok: true, items: await withExistence(clean, await commonCwds(root)) };
}

/** `source` 줄을 워커 파일에 넣는다. 삽입 위치는 추측하지 않는다 —
 *  `parseContextBlock`이 주는 `end`(닫는 `)`) **바로 다음 줄**이다.
 *  이미 있으면 `false`(no-op), 넣었으면 `true`.
 *
 *  §개정(2026-08-31, 요구 `421f440d`): 공통 파일이 없으면 **여기서 먼저 만든다** —
 *  `applySelfHeal`이 `self-heal.sh`를 없으면 만드는 것과 같은 자리다. 이 삽입이 §4-1에서 그
 *  줄이 생기는 유일한 경로라, 여기서 안 만들면 방금 심은 줄이 가리키는 파일이 없어 이 워커의
 *  `list`-`unassign`-`reap`이 매 호출마다 stderr에 `No such file`을 낸다. 있으면 안 덮는다. */
export async function applyCommonSource(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const file = await workerFile(root, name, locale);
  const text = await readFile(file, "utf8");
  const common = path.join(root, COMMON_FILE);
  const commonExists = await stat(common).then(
    () => true,
    () => false,
  );
  if (!commonExists) await atomicWrite(common, COMMON_TEMPLATE, 0o644);
  if (commonSourceRe.test(text)) return false;
  const b = parseContextBlock(text, "TICKET_CONTEXT", locale);
  if (!b.ok) {
    throw new Error(
      `${name}.sh${t(locale, "workers.context.sourceLineCantPlaceMid")} ${b.reason}${t(locale, "workers.context.editByHandSuffix")}`,
    );
  }
  const rest = text.slice(b.end);
  const next =
    text.slice(0, b.end) +
    "\n" +
    commonSourceLine(root) +
    (rest.startsWith("\n") ? rest : "\n" + rest);
  // 자기 검증: 줄을 넣었는데 블록 항목이 달라지면 엉뚱한 라인을 밟은 것이다.
  const back = parseContextBlock(next, "TICKET_CONTEXT", locale);
  if (
    !back.ok ||
    JSON.stringify(back.items) !== JSON.stringify(b.items) ||
    !commonSourceRe.test(next)
  ) {
    throw new Error(t(locale, "workers.context.lineChangedAfterInsert"));
  }
  await atomicWrite(file, next, (await stat(file)).mode & 0o777); // 755를 잃지 않는다
  return true;
}

// ── 엔진 · 모델 선택 (DESIGN.md §4-3) ───────────────────────────────────────
//
// 고르는 단위는 **엔진 × 모델 한 쌍**이고, 커맨드는 **엔진마다 고정 문자열 한 벌**이다.
// 부품에서 합성하지 않는다 — 네 템플릿이 서로 바꿔 쓸 수 없는 자리가 일곱이라서다(§4-3 표):
// `--input-format stream-json` 인접(tick.sh:263-270 FIFO 판정) · claude에 `{prompt}` 없음 ·
// codex·grok·agy에 `{prompt}` 있음 · claude·grok의 `--session-id "{sid}"`(tick.sh:94 reap ·
// §2-1 스트림 파일명) · grok에 `--input-format`이 **없음**(그 플래그가 CLI에 아예 없다 —
// 없는 것이 곧 FIFO를 안 파는 근거라서, 넣으면 grok 워커가 뜨지도 못한다) · agy의
// `-p "{prompt}"`가 **맨 뒤**(앞으로 옮기면 `-p`가 다음 토큰을 프롬프트로 먹는다) · agy의
// `--print-timeout 5400s`(기본 5분이라 없으면 긴 티켓이 통째로 잘린다).

export type EngineId = "claude" | "codex" | "grok" | "agy";

/** `모델 지정 안 함` = 모델 플래그를 아예 안 붙인다(엔진 CLI 자기 기본값). 목록 맨 앞이고
 *  새 워커의 기본값이다 — 가장 안 낡는 선택지다(§4-3). */
export const NO_MODEL = "";

/** 고정 템플릿 안에서 `[flag, model]`로 펴지는 자리. `NO_MODEL`이면 통째로 사라진다. */
const MODEL_SLOT = " model";

export const ENGINE_ARR = "TICKET_ENGINE";

/** 화면이 그리는 목록의 유일한 출처. **모델 이름은 실측으로만 오른다** — 확인 못 한 이름을
 *  올리는 것이 §4-3이 말하는 "화면이 거짓알려 준다"이다. 갱신 명령은 `f6dd8478` §결과에 있다. */
export const ENGINES: readonly {
  id: EngineId;
  /** 모델 플래그. `claude --model` · `codex -m` · `grok -m` · `agy --model` (넷 다 실재한다 — §4-3) */
  flag: string;
  /** 목록. 맨 앞은 항상 `NO_MODEL`이고, 여기 없는 이름은 화면의 `직접 입력`이 받는다 */
  models: readonly string[];
  /** argv 토큰 **고정 문자열**. `{prompt}`·`{sid}`는 글자 그대로다(tick.sh:236이 치환한다) */
  argv: readonly string[];
}[] = [
  {
    id: "claude",
    flag: "--model",
    // 별칭은 정의상 최신을 가리키는 고정 포인터라 풀네임과 달리 안 낡는다(§4-3 근거 2).
    models: [NO_MODEL, "opus", "sonnet", "fable", "haiku"],
    // 엔진 수정 27번째 계약 2·5: PATH의 이름이 아니라 고정 경로다 — 사람이 화면에서 한 번
    // 고르면 §24가 구운 하드링크를 되돌리던 회귀(GUI가 §24를 매번 되돌리고 있었다)를 막는다.
    argv: [
      '"$HOME/.config/dira/bin/dira"',
      "-p",
      "--session-id",
      '"{sid}"',
      "--dangerously-skip-permissions",
      MODEL_SLOT,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
  },
  {
    id: "codex",
    flag: "-m",
    // `codex debug models`의 `visibility: "list"` 5종 중 숨김(`codex-auto-review`)을 뺀 넷.
    models: [NO_MODEL, "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini"],
    // 뒤 두 플래그는 장식이 아니다(실측 — 티켓 §결과):
    // `-s danger-full-access` 없으면 기본 샌드박스가 read-only라 **자기 워크트리에도 못 쓴다**.
    // `workspace-write`로도 부족하다 — `.dira`가 워크트리 밖(큐)을 가리켜 티켓 rename이 막힌다.
    // `--skip-git-repo-check` 없으면 레포가 아닌 TICKET_CWD에서 매 tick 즉시 거부된다.
    argv: [
      '"$HOME/.config/dira/bin/dira-codex"',
      "exec",
      "--json",
      "-s",
      "danger-full-access",
      "--skip-git-repo-check",
      MODEL_SLOT,
      '"{prompt}"',
    ],
  },
  {
    id: "grok",
    flag: "-m",
    // `grok models`가 오늘 내는 이름 하나(실측 2026-08-05, `grok 0.2.118`). **별칭이 아니라
    // 풀네임이라 반드시 낡는다** — claude의 근거 2가 grok에는 안 뜬다. 갱신은 `grok models`.
    models: [NO_MODEL, "grok-4.5"],
    // `--sandbox`가 없는 것은 누락이 아니다 — grok 기본 sandbox 프로파일이 이미 `off`이고
    // `--permission-mode bypassPermissions` 하나로 파일 쓰기까지 지난다(실측 §4-3 §grok).
    // codex가 `-s danger-full-access`를 **필요로 했던 것**과 갈리는 자리다.
    argv: [
      '"$HOME/.config/dira/bin/dira-grok"',
      "-p",
      '"{prompt}"',
      "--session-id",
      '"{sid}"',
      "--permission-mode",
      "bypassPermissions",
      MODEL_SLOT,
      "--output-format",
      "streaming-messages-json",
    ],
  },
  {
    id: "agy",
    flag: "--model",
    // `agy models` 11종(실측 2026-08-05, GUI 도메인 — §4-3 §agy ⑤). **별칭이 아니라 풀네임이라
    // 반드시 낡는다** — claude의 근거 2가 agy에는 안 뜬다. 갱신은 사람이 `agy models`로 한다.
    // `--effort`가 따로 있는데 단위를 안 넓힌다 — 강도가 이미 이름 접미사(-high/-medium/-low)다.
    models: [
      NO_MODEL,
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.5-flash-high",
      "gemini-3.5-flash-medium",
      "gemini-3.5-flash-low",
      "gemini-3.1-pro-high",
      "gemini-3.1-pro-low",
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium",
    ],
    // `-p "{prompt}"`가 맨 뒤인 이유와 `--print-timeout 5400s`가 있는 이유는 위 헤더 주석과
    // §4-3 표(agy 행 둘)에 있다. `<T>`가 아니라 고정값인 것은 §4-3 §agy ⑥ 천장 1과 같은 자리다.
    argv: [
      '"$HOME/.config/dira/bin/dira-agy"',
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--print-timeout",
      "5400s",
      MODEL_SLOT,
      "-p",
      '"{prompt}"',
    ],
  },
];

/** 모델 문자열은 **사람이 직접 입력**할 수 있고 그대로 셸 배열의 맨 낱말이 된다. 여기가 그
 *  신뢰 경계다 — 인용 없는 토큰이므로 셸 메타문자가 하나라도 있으면 거부한다(클라이언트 검증은
 *  검증이 아니다. 이 함수가 서버에서 돈다). 실재하는 모델 이름은 전부 이 문자 집합 안이다.
 *
 *  **화면도 같은 정규식을 쓴다**(§23 ④의 즉시 거절 한 줄). 클라이언트 컴포넌트는 이 모듈을
 *  import할 수 없어서(`node:fs`) 서버 페이지가 `MODEL_RE.source`를 prop으로 내린다 — 두 벌로
 *  적으면 화면이 받는 값과 서버가 받는 값이 갈린다. */
export const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

/** 고른 값 → argv 토큰. 템플릿은 고정이고 모델 자리만 끼운다. */
export function engineArgv(
  id: EngineId,
  model: string = NO_MODEL,
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  const e = ENGINES.find((x) => x.id === id);
  if (!e) throw new Error(`${t(locale, "workers.engine.unknownEnginePrefix")} ${id}`);
  if (model !== NO_MODEL && !MODEL_RE.test(model)) {
    throw new Error(`${t(locale, "workers.engine.invalidModelCharsPrefix")} ${model}`);
  }
  return e.argv.flatMap((tok) => (tok === MODEL_SLOT ? (model ? [e.flag, model] : []) : [tok]));
}

/** `tick.sh:51-53`. 워커가 덮어쓰지 않으면 실제로 이게 돈다 — "기본값"이라고 얼버무리지 않는다.
 *  **카탈로그에서 유도한다**: 손으로 적었더니 엔진이 스트리밍 입력으로 바뀐 뒤에도 옛 argv
 *  (`-p "{prompt}" … --output-format json`)로 남아, 대입 없는 워커의 `엔진` 열이 안 도는 커맨드를
 *  말하고 §4-3 역파싱이 그 워커 전부를 `커스텀`으로 읽었다. 두 벌이면 반드시 갈린다. */
const DEFAULT_ENGINE = engineArgv("claude").join(" ");

/** 파일에 들어갈 블록 텍스트. 한 줄이다 — 사람이 고칠 자리가 아니라 GUI가 소유하는 대입이다. */
export function renderEngineBlock(id: EngineId, model: string = NO_MODEL): string {
  return `${ENGINE_ARR}=(${engineArgv(id, model).join(" ")})`;
}

/** 역파싱: 워커 파일에서 읽은 `engine` 문자열 → 고른 값. 카탈로그 템플릿과 **글자로** 안 맞으면
 *  `null`(= 손으로 쓴 커스텀 엔진)이다. 행이 지금 값을 표시하려면 이게 필요하다(§4-3). */
export function parseEngineValue(engine: string): { engineId: EngineId; model: string } | null {
  const toks = engine.trim().split(/\s+/);
  for (const e of ENGINES) {
    const i = toks.indexOf(e.flag);
    const model = i >= 0 && i + 1 < toks.length ? toks[i + 1] : NO_MODEL;
    // 모델을 뽑아 템플릿을 다시 그려 통째로 대조한다 — 토큰 하나라도 다르면 커스텀이다.
    if (MODEL_RE.test(model) || model === NO_MODEL) {
      if (engineArgv(e.id, model).join(" ") === toks.join(" ")) return { engineId: e.id, model };
    }
  }
  return null;
}

/** `엔진` 열이 그리는 것 — **표시 4종의 유일한 출처**(§비주얼 §23 ①). 빈칸이 되는 경우가 없다.
 *
 *  | 파일의 대입 | label | badge |
 *  |---|---|---|
 *  | 카탈로그와 맞음 · 모델 있음 | `claude · opus` | 없음 |
 *  | 〃 · 모델 없음 | `codex` | 없음 |
 *  | **없음**(`engine === null`) | `claude` | `assumed` — 실제로 도는 값을 그리고 배지가 사실을 알려 준다 |
 *  | 카탈로그와 안 맞음 | `mock-engine`(첫 토큰 basename) | `custom` |
 *
 *  판정이 서버에 있는 이유: 클라이언트가 카탈로그를 다시 대조하면 같은 4종이 두 벌이 된다. */
export function engineCell(engine: string | null): {
  label: string;
  badge: "assumed" | "custom" | null;
  /** 셀 `title`에 붙는 argv 전문. 대입이 없으면 **실제로 도는** tick.sh 기본값이다 */
  argv: string;
  /** 팝오버의 초기값. `null`이면 고른 것이 없는 채로 열린다(손으로 쓴 값을 덮어쓰지 않는다) */
  value: { engineId: EngineId; model: string } | null;
} {
  // `??`가 아니라 `||`다: 빈 블록(`TICKET_ENGINE=()`)도 tick.sh 51~53행이 기본값으로 되돌린다 —
  // 그 워커도 "기본값을 쓰는 중"이 사실이고, 빈 label로 셀이 비는 길이 여기서 닫힌다.
  const argv = engine || DEFAULT_ENGINE;
  const value = parseEngineValue(argv);
  if (!value) return { label: engineName(argv), badge: "custom", argv, value: null };
  return {
    label: value.model ? `${value.engineId} · ${value.model}` : value.engineId,
    badge: engine ? null : "assumed",
    argv,
    value,
  };
}

/** 페르소나 엔진 `지정 없음`에 다는 실효값 힌트(§비주얼 §23 §개정 · 요구 `445ff9e1`). 입력은
 *  `listWorkers`가 준 각 워커의 `engine` 필드 그대로다(대입 없으면 `null`) — 판정은 이 함수
 *  하나뿐이고 클라이언트는 그리기만 한다(§44 ④). 워커가 0개면 돌 것이 없어 기본값도 없다. */
export function personaEngineHint(
  engines: (string | null)[],
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (engines.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of engines) {
    const label = engineCell(e).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const prefix = t(locale, "workers.engineHint.prefix");
  if (counts.size === 1) {
    const [label] = counts.keys();
    return `${prefix} (${t(locale, "workers.engineHint.allPrefix")}${label})`;
  }
  // 수 내림차순, 구분자 ` / `(라벨 안의 `·`와 안 섞이게). `Map`이 삽입 순서를 지켜 동률은
  // 먼저 나온 라벨이 앞에 온다 — `sort`가 안정 정렬이라 그 순서가 그대로다.
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} ×${n}`)
    .join(" / ");
  return `${prefix} (${t(locale, "workers.engineHint.nowPrefix")}${parts})`;
}

/** 블록 치환, 없으면 **삽입**. 파일을 안 건드리는 순수 함수다.
 *
 *  §4는 컨텍스트에 대해 "없으면 GUI가 넣지 않는다(삽입 자리를 짚을 앵커가 없다)"고 정했는데
 *  엔진은 그 논리가 안 뜬다: 지금 이 큐의 워커 전부에 `TICKET_ENGINE` 대입이 없어서 거부하면
 *  기능이 **모든 기존 워커에서 안 열린다**(§4-3). 대입 하나뿐이라 `source` 줄 위 어디에 놓든
 *  결과가 같으므로 고를 것이 없다 — 추측이 아니다. */
function applyEngineBlock(
  text: string,
  id: EngineId,
  model: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const block = renderEngineBlock(id, model);
  const b = parseArrayBlock(text, ENGINE_ARR, locale);
  if (b.ok) return text.slice(0, b.start) + block + text.slice(b.end);
  // 모양이 다른 블록(`+=`·2개·주석·안 닫힘)은 종전대로 거부다. 없는 것만 삽입이다.
  if (!b.missing) throw new Error(`${b.reason}${t(locale, "workers.context.editByHandSuffix")}`);
  const m = text.match(sourceTick); // `/m` 앵커라 index가 그 줄 처음이다
  if (!m || m.index === undefined) {
    throw new Error(t(locale, "workers.engine.noWorkerFileLine"));
  }
  return text.slice(0, m.index) + block + "\n" + text.slice(m.index);
}

/** tick 하나의 **결과**인 동사는 이 넷뿐이다(DESIGN.md §0-5 판정 1단계). 나머지는 건너뛴다:
 *  - `DISPATCH` — 아직 안 끝났다. 이걸 결과로 세면 **배너가 깜빡인다**(실측에서 FAIL은 DISPATCH
 *    6~13초 뒤에 오는데 보드 폴링이 5초라 매분 그 창에 걸린다).
 *  - `SKIP`·`HOLD` — "지금 물 티켓이 없다"이지 환경이 나았다는 증거가 아니다.
 *  - `WARN`·`REAP`·`UNASSIGN`·`ERROR`·`NOTE` — tick 결과가 아니다. `ERROR cwd 없음`은 §4
 *    작업 디렉터리 결함이 이미 자기 자리에서 알려 준다 — 같은 사실을 두 자리에 쓰지 않는다.
 *
 *  `KILLED`는 §2-5가 더한다 — 상한을 안 넘고 신호로 죽은 세션(`강제 할당 해제`가 만든다).
 *  안 더하면 강제 중단한 워커의 배너가 **그 앞의 오래된 결과 줄**을 읽는다. */
const RESULT_VERBS = new Set(["DONE", "FAIL", "TIMEOUT", "KILLED"]);

/** `마지막 활동` 셀을 펼치면 뜨는 줄 수 (§4-7). tick 한 바퀴가 6~8줄이라 20줄이면 최근 티켓
 *  두어 개가 통째로 보인다. */
const RECENT_LINES = 20;

/** DISPATCH가 여는 실행 하나를 닫는 넷(§5-6 §실측) — `RESULT_VERBS`와 다른 집합이다.
 *  `KILLED` 대신 `STALL`이다: `STALL`이 이미 실패 시각이고 뒤따르는 `KILLED`는 그 실패를
 *  강제 종료하는 부수 효과 줄이다(같은 해시가 `STALL` 직후 `KILLED`를 또 낸다 — 실측). */
const PERSONA_RUN_VERBS = new Set(["DONE", "FAIL", "TIMEOUT", "STALL"]);

/** `DISPATCH` → 종료 페어링 하나(§5-6 §실측 — `persona-activity.ts`가 페르소나별로 되짚는다).
 *  `verb`는 `PERSONA_RUN_VERBS` 중 하나, `dispatchAt`·`endAt`은 로그 줄의 시각 원문
 *  (`2026-08-23 05:12:42`, 이 머신 로컬)이다. */
export type PersonaRun = { hash: string; verb: string; dispatchAt: string; endAt: string };

/** runner.log는 워커 전체가 한 파일에 섞여 쌓인다: `2026-07-30 13:19:01 [w3] SKIP …`.
 *  실효 `TICKET_NAME` → **최근 20줄**(최신이 앞) + **마지막 결과 줄**(§0-5 판정 1단계) +
 *  **해시별 `DISPATCH` 집계**(§2-14 (2) — 티켓 상세 재시도 줄의 원본) + **페르소나별 실행 페어링**
 *  (§5-6 §실측 — `persona-activity.ts`의 소요·되돌아옴·마지막 활동·30일 막대의 원본) +
 *  **로그가 닿는 가장 이른 시각**(§5-6 §66 "로그가 닿는 날 수").
 *
 *  ponytail: 파일 전체를 읽고 뒤에서 훑는다(실측 1.5MB · 15,858줄 · 13.5ms). **꼬리만 읽으면
 *  오래 멈춘 워커의 마지막 줄을 잃는다** — 그 줄이 파일 앞쪽에 있어서 `stopped` 워커의 마지막
 *  활동이 `—`가 된다(§4-7). 상한이 문제면 로테이션이 먼저다(`tick.sh`의 일이다).
 *
 *  **`cache()`로 요청당 1회다**(`crontabText`와 같은 이유) — `listWorkers`·`reassignCount`·
 *  `personaActivity`가 같은 `workersDir`로 이 함수를 각자 부르는데, 캐시가 없으면 상세 화면
 *  한 번에 이 5.7MB 파일을 여러 번 연다(§2-14 (7) §성능 예산 "새 파일 읽기가 0회"). 페르소나
 *  페어링을 별도 파서로 새로 두지 않고 이 한 벌의 backward 루프에 얹은 이유도 같다 — 파일을
 *  두 번 훑지 않는다. */
export const lastLogByWorker = cache(
  async (
    workersDir: string,
  ): Promise<{
    byWorker: Record<string, { recent: string[]; result: string | null }>;
    dispatchByHash: Record<string, number>;
    personaRuns: Record<string, PersonaRun[]>;
    logStart: string | null;
    // §2-3 개정(요구 `22fd4fda`) — 재활용 세션에서 진행 기록이 자기 회차만 흘리는 재료 둘.
    // **해시별 마지막(최신) `DISPATCH` 줄의 `sid=`**. `session_id`가 회수로 빈 티켓의 폴백이다
    // (§2-1 Q2=(a) — 세션 하나 - 구간 하나. 옛 라운드는 끌어오지 않는다).
    sidByHash: Record<string, string>;
    // **sid별 `DISPATCH` 해시 순서(시간순, 해시 무관)**. 이 sid의 `DISPATCH` 줄들 중 어느 해시가
    // 몇 번째인지가 §2-3 개정의 "회차 번호 n"이다.
    dispatchesBySid: Record<string, string[]>;
  }> => {
    const text = await readFile(path.join(workersDir, "runner.log"), "utf8").catch(() => "");
    const byWorker: Record<string, { recent: string[]; result: string | null }> = {};
    const dispatchByHash: Record<string, number> = {};
    const personaRuns: Record<string, PersonaRun[]> = {};
    const sidByHash: Record<string, string> = {};
    // sid별 해시 순서를 **뒤에서부터** 쌓는다(이 루프가 backward라서다) — 반환 직전에 뒤집어
    // 시간순으로 되돌린다.
    const dispatchSeqBySidRev: Record<string, string[]> = {};
    // 해시별 "아직 안 닫힌" 종료 줄 — backward라 종료가 자기 DISPATCH보다 먼저 걸린다(재시도의
    // 안쪽 페어링이 우선이라 이미 걸려 있으면 안 덮는다 — 더 이른 종료는 그 앞의 DISPATCH 몫이다).
    const pendingEnd: Record<string, { verb: string; at: string }> = {};
    let logStart: string | null = null;
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      // 네 번째 캡처(해시)는 `DISPATCH`류 줄에만 있다 — 다른 동사 줄은 `undefined`라 아래에서 안 센다.
      const m = /^(\S+ \S+) \[([^\]]+)\] (\S+)(?: (\S+))?/.exec(lines[i]);
      if (!m) continue;
      const [, at, worker, verb, tok] = m;
      logStart = at; // 뒤에서 앞으로 훑으니 루프 끝에 남는 값이 가장 이른 줄이다
      const e = (byWorker[worker] ??= { recent: [], result: null });
      if (e.recent.length < RECENT_LINES) e.recent.push(lines[i]); // 뒤에서 왔으니 최신이 앞이다
      if (e.result === null && RESULT_VERBS.has(verb)) e.result = lines[i];
      if (verb === "DISPATCH" && tok) {
        dispatchByHash[tok] = (dispatchByHash[tok] ?? 0) + 1;
        const sid = /(?:^| )sid=(\S+)/.exec(lines[i])?.[1];
        if (sid) {
          if (!(tok in sidByHash)) sidByHash[tok] = sid; // backward라 첫 히트가 가장 최신이다
          (dispatchSeqBySidRev[sid] ??= []).push(tok);
        }
        const pending = pendingEnd[tok];
        if (pending) {
          const persona = /(?:^| )persona=(\S+)/.exec(lines[i])?.[1];
          if (persona && persona !== "none") {
            (personaRuns[persona] ??= []).push({ hash: tok, verb: pending.verb, dispatchAt: at, endAt: pending.at });
          }
          delete pendingEnd[tok];
        }
      } else if (PERSONA_RUN_VERBS.has(verb) && tok && !pendingEnd[tok]) {
        pendingEnd[tok] = { verb, at };
      }
    }
    const dispatchesBySid: Record<string, string[]> = {};
    for (const [sid, seq] of Object.entries(dispatchSeqBySidRev)) dispatchesBySid[sid] = seq.slice().reverse();
    return { byWorker, dispatchByHash, personaRuns, logStart, sidByHash, dispatchesBySid };
  },
);

/** fm `session_id`가 비었을 때(회수된 티켓)의 폴백 — `runner.log`에서 이 해시의 마지막 `DISPATCH`
 *  줄의 `sid=`(§2-3 개정, 요구 `22fd4fda`). 로그에도 없으면 `null` — 정말로 디스패치된 적이 없거나
 *  로테이션으로 빠진 것이다. */
export async function lastDispatchSid(root: string, hash: string): Promise<string | null> {
  const { sidByHash } = await lastLogByWorker(path.join(root, "workers"));
  return sidByHash[hash] ?? null;
}

/** 이 sid에서 이 해시가 몇 번째 회차인가(1부터) — `DISPATCH` 줄들 중 **이 해시인 마지막 줄의
 *  순번**(해시 무관, §2-3 개정 표). 진행 기록이 `system init` 레코드 몇 번째부터 자를지의 근거다.
 *  이 sid의 로그에서 해시를 못 찾으면(로테이션으로 빠졌다) `1`로 물러난다 — 오프셋 0, 종전 그대로. */
export async function dispatchRound(root: string, hash: string, sid: string): Promise<number> {
  const { dispatchesBySid } = await lastLogByWorker(path.join(root, "workers"));
  const seq = dispatchesBySid[sid] ?? [];
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i] === hash) return i + 1;
  }
  return 1;
}

/** 이 티켓이 되돌아온 횟수 — `runner.log`의 `DISPATCH <해시>` 줄 수 빼기 1(DESIGN.md §2-14 (2)).
 *  첫 디스패치는 재시도가 아니라서 뺀다. 줄이 0개(한 번도 안 디스패치)여도 음수로 안 내려간다.
 *  `attempts` frontmatter는 안 읽는다 — 그 값이 세는 사건이 다르다(§2-14 (1)). */
export async function reassignCount(root: string, hash: string): Promise<number> {
  const { dispatchByHash } = await lastLogByWorker(path.join(root, "workers"));
  return Math.max(0, (dispatchByHash[hash] ?? 0) - 1);
}

/** 실패 사유가 **아직 유효한가**의 창 (§0-5 신선도). cron이 1분 주기라 환경이 깨져 있고 물
 *  티켓이 있으면 매분 새 `FAIL`이 온다. 이 창이 없으면 **배너가 거짓말을 한다**: 한도가 풀렸는데
 *  큐가 비어 `SKIP`만 도는 큐에서 사흘 전 `FAIL`이 영원히 걸린다. §0-2 인증 배너에 만료가 없는
 *  것과 갈리는 지점이고 이유는 상태의 성격이다 — 저건 사람이 손대야 꺼지지만 이건 저절로 복구된다.
 *  // ponytail: 고정 10분. 폴링(5초)·cron(1분)보다 한참 크고 사유의 수명보다 짧으면 된다 */
const FRESH_MS = 10 * 60 * 1000;

/** 살아 있는 엔진 쿨다운의 만료 시각(ms epoch). 없거나 못 읽으면 `0`(= 늘 과거)이라 판정이
 *  조용히 종전 10분으로 떨어진다.
 *
 *  자리는 **`tick.sh:62`가 정본**이다(`$LOCAL/run/cooldown-<engineName>`) — 새 경로 규약을
 *  만들지 않는다. 파일은 두 줄이고 **1줄째 epoch만 읽는다**(2줄째 엔진 지문은 엔진의 것이다). */
async function cooldownUntil(engine: string): Promise<number> {
  const p = path.join(localDir(), "run", `cooldown-${engine}`);
  const head = (await readFile(p, "utf8").catch(() => "")).split("\n", 1)[0].trim();
  const sec = Number(head); // 빈 문자열·숫자 아님 → 0/NaN → 만료된 것과 같은 칸이다
  return Number.isFinite(sec) ? sec * 1000 : 0;
}

/** 세션 로그는 **마지막 한 줄이 JSON**이고 그 앞은 세션 stderr다(`tick.sh:222`가 `2>>"$LOGF"`).
 *  실측 파일은 1.4KB지만 상한이 없어서 꼬리 64KB만 읽는다 — `tickets.py:transcript_state`의
 *  선례 그대로고 `readFile` 전체 읽기가 아니다. 파일이 64KB 미만이면 전체다.
 *
 *  **`lib/usage.ts`가 같은 함수를 쓴다**(§0-8 판정 1: 세션 토큰도 이 마지막 줄에 있다).
 *  두 벌 적으면 한쪽만 꼬리 크기를 바꿔도 두 화면의 판정이 갈린다. */
const TAIL_BYTES = 64 * 1024;
export async function lastJsonLine(file: string): Promise<Record<string, unknown> | null> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(file, "r");
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString("utf8").trimEnd().split("\n");
    const rec: unknown = JSON.parse(lines[lines.length - 1]);
    return rec && typeof rec === "object" ? (rec as Record<string, unknown>) : null;
  } catch {
    return null; // 없다·못 읽는다·JSON이 아니다 — 사유를 지어내지 않는다
  } finally {
    await fh?.close();
  }
}

/** `tick.sh:245`가 쓰는 줄: `FAIL <해시> rc=<n> -> 할당 회수 + 백로그 복귀. 로그 <basename>`.
 *  파일명은 **꼬리에서 집는다 — 조립하지 않는다**(엔진이 이미 적어 준다). */
const failLine = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[[^\]]*\] FAIL (\S+) .* 로그 (\S+)$/;

/** `tokens.json`을 **마이그레이션 없이** 원본 그대로 읽는다 — `readTokens()`(`lib/auth.ts`)를
 *  부르면 파일이 없을 때 `oauth-token`을 항목 하나로 들여와 **새로 쓴다**, 이 판정 경로가 그
 *  부작용을 내면 "파일 없으면 종전 그대로"가 깨진다. 없음·깨짐·모양 다름 = 빈 배열이다 —
 *  `anyTokenEligible`·`limitWaitUntil` 둘 다 이 하나를 통해서만 `tokens.json`을 본다. */
async function readTokenList(): Promise<TokenEntry[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(tokensPath(), "utf8"));
    const tokens = (raw as TokensFile)?.claude?.tokens;
    return Array.isArray(tokens) ? tokens : [];
  } catch {
    return [];
  }
}

/** §0-13 §`모두 소진`은 새 알림이 아니다. 없음·깨짐·모양 다름 = 목록을 안 쓰는 판(오늘 전부) =
 *  `false`, 종전 판정 그대로 간다. */
async function anyTokenEligible(): Promise<boolean> {
  return (await readTokenList()).some((t) => isEligible(t));
}

/** §0-21 결정 4 — 워커 행이 말하는 `리밋 대기`의 복귀 시각(epoch 초, `exhaustedUntil`과 같은
 *  단위). 판정은 `isEligible`(`lib/auth.ts`) 그 함수 하나다(제약 3, 두 벌로 안 적는다) — 이
 *  함수는 그 결과를 모아 가장 이른 값을 고르기만 한다.
 *
 *  eligible이 1장이라도 있으면 `null`이다(리밋 대기가 아니다). eligible이 0장인데
 *  `exhaustedUntil`이 하나도 없으면(토큰 0개 · 전부 비활성) 그릴 시각이 없다 — 그때도 `null`이다
 *  (§0-21 §다섯 상태의 에러 갈래, "그릴 값이 없으면 안 그린다"). */
export async function limitWaitUntil(): Promise<number | null> {
  const tokens = await readTokenList();
  if (tokens.length === 0 || tokens.some((t) => isEligible(t))) return null;
  const untils = tokens.map((t) => t.exhaustedUntil).filter((v): v is number => v != null);
  return untils.length > 0 ? Math.min(...untils) : null;
}

/** §0-5 판정 2·3단계. 마지막 **결과** 줄 하나 → 외부 요인 실패이거나 `null`.
 *  `DONE`이면 `null`이다 — 이게 "다음 성공 tick에 저절로 꺼진다"다. **`TIMEOUT`도 `null`**:
 *  rc 143/137은 90분 상한에 걸린 매달린 세션이고 환경 탓이 아니다(그래서 이 정규식이 `FAIL`만 문다).
 *  **`KILLED`도 같은 칸이다**(§2-5) — 사람이 끊은 것이라 배너가 말할 것이 없다. */
async function failureOf(
  logsDir: string,
  line: string | null,
  coolUntil: () => Promise<number>,
): Promise<WorkerFailure | null> {
  const m = line && failLine.exec(line);
  if (!m) return null;
  const [, at, hash, log] = m;
  // `2026-07-31 18:09:49`는 `Date`가 엔진마다 다르게 무는 모양이다. `T`를 넣으면 오프셋 없는
  // ISO = 로컬 시각으로 규격이 정해져 있고, tick.sh의 `date '+%F %T'`도 이 머신의 로컬이다.
  const ts = Date.parse(at.replace(" ", "T"));
  if (!Number.isFinite(ts)) return null;
  // §4-9 §배너가 꺼지는 구멍. 창이 지났어도 **살아 있는 쿨다운이 10분보다 정확한 증거다** — 그
  // 파일은 *지금 엔진이 불능이고 언제까지다*를 직접 알려 준다. 그동안은 새 `FAIL`이 구조적으로 안
  // 생기므로(게이트가 `select` 앞에서 `exit 0`) 창만 보면 큐가 멈춘 채로 배너가 꺼진다.
  // 값은 10분 그대로이고 조건이 하나 는다 — 쿨다운이 없거나 만료면 위 문장 그대로다.
  if (Date.now() - ts > FRESH_MS && Date.now() >= (await coolUntil())) return null;
  // 파일명은 엔진이 준 값이지만 그대로 이어 붙이지 않는다 — logs/ 밖으로 나가는 이름은 이름이 아니다.
  const rec = await lastJsonLine(path.join(logsDir, path.basename(log)));
  if (!rec || rec.is_error !== true) return null; // 파싱 실패·`is_error` 아님 → 사유가 없다
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // 실측 6건이 `result: null`이고 그때 사유는 `terminal_reason`("aborted_streaming")뿐이다.
  const reason = str(rec.result) || str(rec.terminal_reason);
  if (!reason) return null; // 사유가 비면 화면에 그릴 것이 없다
  // §0-13 §`모두 소진`은 새 알림이 아니다. 회전이 아직 지문을 못 푼 cron 한 칸(최대 60초) 동안
  // 쿨다운은 살아 있어도 **쓸 토큰이 남아 있으면** 이 배너는 거짓말이다 — 요구는 *모두* 걸렸을
  // 때만 보내라고 정했다. 읽는 것은 여기까지 온 살아 있는 실패뿐이라 정상 상태의 I/O는 0이다.
  if (await anyTokenEligible()) return null;
  return { at, hash, reason, log };
}

// ── 받은 편지함 (DESIGN.md §0-10 §받은 편지함 §저장) ─────────────────────────
//
// `~/.config/dira/alerts.json`이 편지함이다 — 최상위 `queues`(② 사건, 큐 루트별) ·
// `machine`(⑥ 사건, 머신 전체) 두 칸. 판정 **뒤에** 걷는 필터라서 큐 파일은 한 바이트도 안
// 바뀌고, 적히는 사실은 *큐가 나았다*가 아니라 *이 머신이 이 사건을 봤다*이다.

/** 레지스트리·토큰·키맵·`analytics.json`과 **같은 디렉터리**다(`lib/analytics.ts:20`의 그 한 줄).
 *  **`.dira` 안이 아니다** — 머신당 하나이고 큐를 오염시키지 않는다. */
export function alertsPath(): string {
  return path.join(localDir(), "alerts.json");
}

/** ② 사건 하나 — 로그 파일명이 키라 여기 안 든다(`WorkerFailure`의 나머지 세 칸 + 보관 시각). */
export type MailboxFailure = { at: string; hash: string; reason: string; archived: string | null };
/** ⑥ 사건 하나 — `to`가 키라 여기 안 든다. `kind`를 `machine-state.ts`의 `ResumeKind`로 좁히지
 *  않는다 — 그 타입을 들여오면 `machine-state → workers`의 기존 임포트 방향과 겹친 순환이 하나
 *  더 는다. 저장 모양만 아는 이 파일은 문자열로 충분하다. */
export type MailboxResume = { from: number; kind: string; archived: string | null };
export type Mailbox = {
  queues: Record<string, Record<string, MailboxFailure>>;
  machine: Record<string, MailboxResume>;
};
const EMPTY_MAILBOX: Mailbox = { queues: {}, machine: {} };
const QUEUE_CAP = 200;
const MACHINE_CAP = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** ⑥ 조각의 병합 창 — `machine-state.ts`의 `MERGE_WINDOW_MS`와 같은 값(10분, §0-14 §값)이다.
 *  그 상수를 그대로 import하면 `machine-state.ts → workers.ts`의 기존 방향과 겹쳐 순환이 하나
 *  생기므로, 값을 여기 다시 적는다(요구 `f830e318` — 이 값을 두는 자리는 구현이 정한다). */
const RESUME_MERGE_WINDOW_MS = 10 * 60_000;

/** ⑥ 조각을 구간 단위로 합친다(요구 `f830e318`) — 어떤 줄의 `from`이 다른 줄의 `to`에서 10분
 *  안이면 `min(from) - max(to)` 한 줄로 묶는다. `kind`는 `poweredOff`가 하나라도 있으면
 *  이기고, `archived`는 하나라도 `null`이면 구간 전체가 안 보관이다(§0-14 §읽음 처리 — 새
 *  사실은 다시 봐야 한다). `readAlerts`가 부르는 한 곳뿐이다 — ⑥의 나열 · 보관함 · `보관` 버튼이
 *  받는 `to` 목록이 전부 이 결과를 그대로 물려받는다. */
function mergeMachineRows(machine: Mailbox["machine"]): Mailbox["machine"] {
  const rows = Object.entries(machine)
    .map(([to, e]) => ({ to: Number(to), from: e.from, kind: e.kind, archived: e.archived }))
    .sort((a, b) => a.from - b.from);
  const merged: (typeof rows)[number][] = [];
  for (const row of rows) {
    const last = merged[merged.length - 1];
    if (last && row.from - last.to <= RESUME_MERGE_WINDOW_MS) {
      last.to = Math.max(last.to, row.to);
      if (row.kind === "poweredOff") last.kind = "poweredOff";
      last.archived = last.archived && row.archived
        ? (row.archived > last.archived ? row.archived : last.archived)
        : null;
    } else {
      merged.push({ ...row });
    }
  }
  return Object.fromEntries(
    merged.map(({ to, from, kind, archived }) => [String(to), { from, kind, archived }]),
  );
}

/** 없음·못 읽음·JSON 아님·**옛 모양**(최상위에 `queues`가 없다) = 빈 편지함이다. 마이그레이션
 *  0줄 — 그 순간 살아 있던 마크만 잃고 다음 쓰기에서 파일이 새 모양이 된다(§0-10 §저장). */
export async function readAlerts(): Promise<Mailbox> {
  let obj: unknown;
  try {
    obj = JSON.parse(await readFile(alertsPath(), "utf8"));
  } catch {
    return EMPTY_MAILBOX;
  }
  if (!isRecord(obj) || !("queues" in obj)) return EMPTY_MAILBOX;
  const queues: Mailbox["queues"] = {};
  if (isRecord(obj.queues)) {
    for (const [root, events] of Object.entries(obj.queues)) {
      if (!isRecord(events)) continue;
      const kept: Record<string, MailboxFailure> = {};
      for (const [log, ev] of Object.entries(events)) {
        if (!isRecord(ev) || typeof ev.at !== "string" || typeof ev.hash !== "string" || typeof ev.reason !== "string") {
          continue;
        }
        kept[log] = { at: ev.at, hash: ev.hash, reason: ev.reason, archived: typeof ev.archived === "string" ? ev.archived : null };
      }
      if (Object.keys(kept).length > 0) queues[root] = kept;
    }
  }
  const machine: Mailbox["machine"] = {};
  if (isRecord(obj.machine)) {
    for (const [to, ev] of Object.entries(obj.machine)) {
      if (!isRecord(ev) || typeof ev.from !== "number" || typeof ev.kind !== "string") continue;
      machine[to] = { from: ev.from, kind: ev.kind, archived: typeof ev.archived === "string" ? ev.archived : null };
    }
  }
  return { queues, machine: mergeMachineRows(machine) };
}

/** 넘치면 이른 것부터 버린다(`at`/키 기준) — **보관 여부를 안 본다**(§0-10 §무한히 쌓이는 것,
 *  안 그러면 안 보관한 것만으로 파일이 자라 상한이 상한이 아니게 된다). */
function capByAge<V>(
  events: Record<string, V>,
  limit: number,
  tsOf: (key: string, v: V) => number,
): Record<string, V> {
  const entries = Object.entries(events);
  if (entries.length <= limit) return events;
  entries.sort((a, b) => tsOf(a[0], a[1]) - tsOf(b[0], b[1]));
  return Object.fromEntries(entries.slice(entries.length - limit));
}

/** 큐 루트당 ② 200건 + 머신 전체 ⑥ 200건(§0-10 §무한히 쌓이는 것). 파일을 통째로 다시 쓴다.
 *
 *  ponytail: 락을 두지 않는다(옛 `markAlertsRead`의 그 벌 그대로) — 두 창이 동시에 써도 최악이
 *  방금 쓴 사건 하나가 날아가는 것이고, 그 사건은 판정 원본(`workers/logs/`·하트비트)에 아직
 *  살아 있어 다음 호출에서 다시 적힌다. */
export async function writeAlerts(mailbox: Mailbox): Promise<void> {
  const queues: Mailbox["queues"] = {};
  for (const [root, events] of Object.entries(mailbox.queues)) {
    if (Object.keys(events).length === 0) continue;
    queues[root] = capByAge(events, QUEUE_CAP, (_k, v) => Date.parse(v.at.replace(" ", "T")));
  }
  const machine = capByAge(mailbox.machine, MACHINE_CAP, (key) => Number(key));
  const p = alertsPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ queues, machine }, null, 2) + "\n", "utf8");
}

/** ②의 `보관`(§0-10 §보관 = 읽음이다) — 그 실패들의 `archived`에 시각을 적는다. 단위가
 *  워커가 아니라 그 실패의 로그 파일명이라(`tick.sh:264`가 디스패치마다 새로 만든다) 보관한
 *  뒤 새 `FAIL`이 오면 파일명이 달라 항목이 다시 켜진다 — 워커로 잡으면 다음 사고까지 같이
 *  묻힌다. 큐 파일은 한 바이트도 안 바뀐다 — 적히는 사실은 *이 머신이 이 실패를 봤다*이다.
 *
 *  ponytail: 읽은 것 위에 덮어쓴다(`saveSettings`와 같은 벌) — 두 창이 동시에 누르면 뒤엣것이
 *  이겨 앞의 보관이 날아갈 수 있고 최악이 항목이 다시 보이는 것이라 락을 두지 않는다. */
export async function markAlertsRead(
  root: string,
  failures: readonly Pick<WorkerFailure, "log">[],
): Promise<void> {
  const alerts = await readAlerts();
  const events = { ...alerts.queues[root] };
  const now = new Date().toISOString();
  for (const f of failures) if (events[f.log]) events[f.log] = { ...events[f.log], archived: now };
  await writeAlerts({ ...alerts, queues: { ...alerts.queues, [root]: events } });
}

// ── 받은 편지함 §화면 배선 (§0-10 §항목의 켜짐 조건이 갈린다 · §비주얼 §28 ⑨) ────────────
//
// 판정은 여기서 다시 안 돈다 — 편지함이 이미 든 값을 세고 거르고 정렬할 뿐이다. `failureOf`도
// `machine-state.ts`도 한 줄도 안 건드린다(§4 워커 행은 여전히 그 함수들만 본다).

/** ②의 켜짐 조건 + 나열 — 신선도 창(10분)이 아니라 **안 보관한 사건**이 기준이다. 워커 이름은
 *  로그 파일명에서 뽑는데 그 파서(`parseLogName`)가 `lib/usage.ts`에 있어 여기서 안 부른다 —
 *  부르면 `usage.ts → workers.ts`의 기존 임포트 방향과 겹친 순환이 하나 는다. 화면이 이름을 뽑는다. */
export type UnarchivedFailure = { log: string; at: string; reason: string };
export function unarchivedFailures(mailbox: Mailbox, root: string): UnarchivedFailure[] {
  return Object.entries(mailbox.queues[root] ?? {})
    .filter(([, e]) => !e.archived)
    .map(([log, e]) => ({ log, at: e.at, reason: e.reason }));
}

/** ⑥의 켜짐 조건 + 안 보관한 사건 — `machineState()`의 신선도 창에 낀 "지금" 하나가 아니라
 *  편지함이 든 전부를 낸다(개정 `4ea7e8d9` — §비주얼 §28: ⑥이 나열을 받아 상위 N건으로
 *  안 자른다). 정렬은 `to` 내림차순 — 화면이 다시 정렬하지 않는다. */
export type UnarchivedResume = { to: number; from: number; kind: string };
export function unarchivedResumes(mailbox: Mailbox): UnarchivedResume[] {
  return Object.entries(mailbox.machine)
    .filter(([, e]) => !e.archived)
    .map(([to, e]) => ({ to: Number(to), from: e.from, kind: e.kind }))
    .sort((a, b) => b.to - a.to);
}

/** 보관함 목록(§비주얼 §28 ⑨) — ②⑥의 보관된 사건을 시각 내림차순 한 벌로 섞는다. **판정을
 *  다시 안 돌린다** — 원본이 이미 죽은 사건이라 편지함이 든 값 그대로 그린다. */
export type ArchivedRow =
  | { type: "failure"; log: string; at: number; reason: string }
  | { type: "resume"; to: number; from: number; kind: string };
export function archivedRows(mailbox: Mailbox, root: string): ArchivedRow[] {
  const failures: ArchivedRow[] = Object.entries(mailbox.queues[root] ?? {})
    .filter(([, e]) => e.archived)
    .map(([log, e]) => ({
      type: "failure",
      log,
      at: Date.parse(e.at.replace(" ", "T")),
      reason: e.reason,
    }));
  const resumes: ArchivedRow[] = Object.entries(mailbox.machine)
    .filter(([, e]) => e.archived)
    .map(([to, e]) => ({ type: "resume", to: Number(to), from: e.from, kind: e.kind }));
  const sortKey = (r: ArchivedRow) => (r.type === "failure" ? r.at : r.to);
  return [...failures, ...resumes].sort((a, b) => sortKey(b) - sortKey(a));
}

/** `owner:` → 워커 이름. tick.sh 207행이 `<페르소나> / <TICKET_NAME>-<sid[:8]>`를 쓰므로
 *  그 형식일 때만 뒤쪽 이름을 돌려주고, 아니면 `null`이다 — **모르는 것을 `?`로 그리지 않는다**
 *  (DESIGN.md §1 보드). 판정 방향이 둘(워커→티켓 `holdingOf` · 티켓→워커 칸반 카드)이라
 *  규칙은 이 함수 하나다.
 *
 *  정규식을 짓지 않는다 — 워커 이름이 파일시스템에서 오므로 메타문자가 섞일 수 있다.
 *  이름에 `-`가 들어가도 sid 8자라는 **길이**로 갈린다. */
export function workerOf(owner: string): string | null {
  const i = owner.lastIndexOf(" / ");
  if (i < 0) return null;
  const tail = owner.slice(i + 3);
  return tail.length > 9 && tail[tail.length - 9] === "-" ? tail.slice(0, -9) : null;
}

/** 워커가 물고 있는 티켓. `.wip` 티켓만 본다 — 끝난 티켓의 owner는 기록이다.
 *
 *  **stem이다** (표시값 `hash`가 아니다): 이 값은 워커 화면이 티켓 상세로 거는 링크가 된다
 *  (DESIGN.md §식별자). 물고 있는 티켓은 항상 `.wip`이라 표시값에 접미사가 붙어 있어
 *  (`<이름>.wip`) 그대로 보여주면 파일 이름도 아니고 URL도 아닌 값이 화면에 남는다. */
function holdingOf(tickets: Ticket[], effName: string): string | null {
  for (const t of tickets) {
    if (t.state !== "wip") continue;
    if (workerOf(t.fm.owner ?? "") === effName) return t.stem;
  }
  return null;
}

/** 이 티켓을 물고 있는 워커의 **엔진 이름**. 아무도 안 물고 있으면 `null`
 *  (DESIGN.md §4-3 `codex를 고르면 GUI 기능 둘이 죽는다` · §비주얼 §23 ⑤).
 *
 *  **새 판정식이 아니다.** 짝은 `holding`이 이미 만들었고(`.wip` 티켓의 `owner:` 역추적),
 *  이름은 §0-4 인증 배너와 **같은 `engineName`**이다. 모델은 안 본다 — 참견·스트림이 죽는
 *  이유가 CLI의 입출력 규약이지 모델이 아니다(§4-3).
 *
 *  `null`이 되는 자리는 **완료 티켓**이다: 아무도 안 물고 있어 되짚을 워커가 없다. 그때 화면은
 *  종전 빈 상태 그대로다 — 없는 값을 추측해 문구를 고르지 않는다(§비주얼 §23 ⑤ 마지막 항).
 *  `holding`은 `listWorkers(root, tickets)`로 부른 목록에만 차 있다(티켓을 안 넘기면 전부 null). */
export function holderEngine(workers: Worker[], stem: string): string | null {
  const w = workers.find((x) => x.holding === stem);
  return w ? engineName(w.engine) : null;
}

// ── 작업 디렉터리 결함 (§4) ─────────────────────────────────────────────────
//
// 셋 다 **락을 만들지 않는다** — 그래서 이 판정이 없으면 깨진 워커가 `idle`로 뜨고, 사람이 보는
// 것은 "멀쩡한데 일을 안 가져간다"이며 단서는 runner.log 마지막 줄뿐이다(실사고 §4-2).

/** 워커별 결함 배열(입력과 같은 순서). `realpath`가 판정의 근거다:
 *  - 심링크 판정은 `<cwd>/.dira`가 **큐 루트로 풀리는가**다. `ln -s` 함정이 만드는
 *    `.dira/.dira`는 존재하는 디렉터리라서 존재 확인만으로는 통과한다(실사고 `bf4d8878`).
 *  - 공유 판정도 `realpath` 키로 본다 — 표기·심링크가 달라도 같은 트리면 같은 트리다.
 *  - 실행 비트 판정(§0-21 결정 2)은 워커 `.sh` 자신의 `mode & 0o111`이다 — `cwd`가 아니라
 *    `path`를 본다. 앞의 셋과 별개 축이라 함께 있어도 서로 가리지 않는다.
 *  - `TICKET_CWD` 줄 누락 판정(§977419d7 결정 1, P349-2가 워커 수 예외를 걷었다)은 `rawCwd`가
 *    `null`이면 워커 파일 수와 무관하게 선다 — 실효 cwd가 실재하는지, `.dira`가 큐 루트로
 *    풀리는지는 안 본다(둘 다 통과하는 것이 이 결함의 모양이다).
 *  - `missing-cwd` 판정(§4-19 결정 1)은 디렉터리가 없어도 조건 (a)(b)(c)가 다 참이면 안 선다 —
 *    (a) `rawCwd`가 `worktreePath(root, name)`과 **문자열로** 같다(정규화 없음, 게이트의
 *    `_gate_standard` 비교와 같은 선). (b) 워커 파일이 `dispatch-gate.sh`를 `source`한다.
 *    (c) 그 게이트 본문에 `_gate_standard`가 있다(§4-14 블록의 표식). 셋 다 참이면 `missing-cwd`
 *    대신 `cwdPending`을 세우고, **`missing-link` 검사로 안 내려간다**(결정 2) — `else` 갈래
 *    자체를 안 타므로 없는 트리 안 `.dira`를 realpath로 못 풀어 딴 이름으로 되살아나는 함정을
 *    피한다.
 *
 *  ponytail: 워커 수만큼 stat·realpath 3번 + 조건이 걸리는 워커만 readFile 2번 추가. 목록이
 *  커지면 요청 단위 캐시. */
async function cwdDefects(
  root: string,
  ws: { name: string; cwd: string; rawCwd: string | null; path: string }[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ defects: WorkerDefect[]; cwdPending: boolean }[]> {
  const queue = nfc(await realpath(root).catch(() => root));
  // 못 풀리는 경로(없는 디렉터리)는 문자열로 비교한다 — 없는 트리를 둘이 공유하는 것도 공유다.
  const keys = await Promise.all(ws.map((w) => realpath(w.cwd).then(nfc, () => nfc(w.cwd))));
  const byKey = new Map<string, string[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), ws[i].name]));
  // 조건 (c) — 게이트 하나를 프로젝트당 한 번만 읽는다(워커마다 같은 값).
  const gateHasStandardBlock = await readFile(path.join(root, DISPATCH_GATE_FILE), "utf8").then(
    (text) => text.includes("_gate_standard"),
    () => false,
  );

  return Promise.all(
    ws.map(async ({ name, cwd, rawCwd, path: file }, i) => {
      const out: WorkerDefect[] = [];
      let cwdPending = false;
      if (rawCwd === null) {
        out.push({
          kind: "no-ticket-cwd",
          detail: `${t(locale, "workers.defect.noTicketCwd.detailPrefix")} ${cwd} ${t(locale, "workers.defect.noTicketCwd.detailSuffix")}`,
        });
      }
      const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false);
      if (!isDir) {
        // 조건 (a) — 문자열 비교, realpath 정규화 없음(게이트의 `_gate_standard` 비교와 같은 선).
        const standard = rawCwd === worktreePath(root, name);
        const sourced =
          standard &&
          gateHasStandardBlock &&
          dispatchGateSourceRe.test(await readFile(file, "utf8").catch(() => ""));
        if (sourced) {
          cwdPending = true;
        } else {
          out.push({
            kind: "missing-cwd",
            detail: `${cwd} ${t(locale, "workers.defect.missingCwd.detailSuffix")}`,
          });
        }
      } else {
        // 트리 자체가 없으면 심링크를 따로 말하지 않는다 — 원인은 하나고 명령도 같다.
        const link = path.join(cwd, ".dira");
        const to = await realpath(link).then(nfc, () => null);
        if (to === null) {
          out.push({
            kind: "missing-link",
            detail: `${link} ${t(locale, "workers.defect.missingLink.detailMissingSuffix")}`,
          });
        } else if (to !== queue) {
          out.push({
            kind: "missing-link",
            detail: `${link} ${t(locale, "workers.defect.missingLink.detailWrongMid")} ${to} ${t(locale, "workers.defect.missingLink.detailWrongSuffix")}`,
          });
        }
      }
      const others = (byKey.get(keys[i]) ?? []).filter((n) => n !== name);
      if (others.length > 0) {
        out.push({
          kind: "shared-cwd",
          detail: `${others.join("·")}${t(locale, "workers.defect.sharedCwd.detailMid")} ${cwd}`,
        });
      }
      const mode = await stat(file).then((s) => s.mode, () => 0);
      if ((mode & 0o111) === 0) {
        out.push({
          kind: "no-exec",
          detail: `${file} ${t(locale, "worker.defect.noExec.detailSuffix")}`,
        });
      }
      return { defects: out, cwdPending };
    }),
  );
}

/** 공통 워커 shim 여부(§4-16 결정 2). 표식은 **파일의 둘째 줄**이어야 한다 — 아무 데나 있는 주석과
 *  가르기 위해서다. `pool.ts`(`borrowPoolWorker`)가 쓰는 것과 같은 정규식을 여기로 옮겼다 —
 *  `listWorkers`가 `Worker.pool`을 채우려면 이 판정이 있어야 하는데, 두 파일에 각자 있으면 갈릴
 *  위험이 있다(제약: shim은 프로젝트 워커와 파일 목록을 공유하므로 `listWorkers`가 먼저 안다). */
export function poolShimNameOf(text: string): string | null {
  const line = text.split("\n")[1] ?? "";
  const m = /^# dira-pool: (\S+)$/.exec(line);
  return m ? m[1] : null;
}

// ── 목록 ────────────────────────────────────────────────────────────────────

/** 프로젝트의 워커 전부. 이름 순.
 *
 *  | status | 판정 |
 *  |---|---|
 *  | running | 락 있음 + pid 생존 |
 *  | stale | 락 있음 + pid 죽음(또는 pid 파일이 없다 — tick.sh도 이걸 회수 대상으로 본다) |
 *  | idle | 락 없음 + crontab 등록됨 |
 *  | stopped | 락 없음 + crontab 미등록 |
 *
 *  ponytail: `holding`은 **호출자가 이미 읽은 티켓 목록**에서 찾는다 — 큐를 두 번 읽지 않으려고.
 *  프로젝트 목록·전환기 요약은 holding을 안 쓰므로 안 넘긴다(그때는 항상 null이다). */
export async function listWorkers(
  root: string,
  tickets: Ticket[] = [],
  locale: Locale = DEFAULT_LOCALE,
): Promise<Worker[]> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".sh"))
    .sort();
  if (names.length === 0) return [];

  const [cronRaw, logs] = await Promise.all([crontabText(), lastLogByWorker(dir)]);
  const cron = nfc(cronRaw);
  // 게이트 낡음은 프로젝트 하나에 한 판정이다(§4-14 §소급) — 워커마다 다시 읽지 않는다. 통합
  // 브랜치를 못 읽으면(스캐폴딩 이전 큐) 낡음을 잴 수 없어 조용히 false로 둔다 — 그 프로젝트는
  // 종전대로 `source` 줄 경고만 그대로다.
  const gateBranch = await readIntegrationBranch(root);
  const gateStale = gateBranch !== null && (await dispatchGateState(root, gateBranch)) === "stale";
  // 쿨다운은 **엔진마다** 하나이고 머신 전역이다(`tick.sh:62`). 워커마다 열지 않도록 이 패스
  // 안에서 엔진 이름으로 한 번만 읽는다 — 오늘 엔진 종류는 1개다. 실패가 없는 워커는 아예 안
  // 부르므로(§0-5 §비용) 정상 상태에서는 이 읽기도 0회다.
  const cooldowns = new Map<string, Promise<number>>();
  const coolUntil = (engine: string | null) => () => {
    const n = engineName(engine);
    const hit = cooldowns.get(n) ?? cooldownUntil(n);
    cooldowns.set(n, hit);
    return hit;
  };
  const out: Worker[] = [];
  for (const file of names) {
    const name = file.slice(0, -3);
    const full = path.join(dir, file);
    const text = await readFile(full, "utf8").catch(() => "");
    const parsed = parseWorkerFile(text);
    // tick.sh 37행: TICKET_NAME 기본값이 파일명이다. 락·로그·owner가 전부 이 값으로 간다.
    const eff = parsed.name ?? name;
    const { held, pid } = await lockOf(lockPath(dir, eff));
    // crontab 한 줄은 인용부호가 붙기도 하므로 절대경로 부분일치로 본다(제약 4: 읽기 전용).
    // `full`은 정규화하지 **않고** 저장한다 — cron 줄에 들어가 셸이 실제로 실행하는 문자열이라
    // 파일시스템이 준 바이트 그대로여야 한다. 정규화는 비교에만 쓴다.
    const inCron = cron.includes(nfc(full));
    out.push({
      name,
      effName: eff,
      path: full,
      status: held ? (pid && alive(pid) ? "running" : "stale") : inCron ? "idle" : "stopped",
      cron: inCron,
      lockPid: pid,
      holding: holdingOf(tickets, eff),
      engine: parsed.engine, // null = 대입 없음. 여기서 기본값으로 덮으면 화면이 둘을 못 가른다
      recentLog: logs.byWorker[eff]?.recent ?? [],
      // 파일을 여는 것은 **마지막 결과가 `FAIL`인 워커뿐**이다 — 정상 상태에서는 0회다(§0-5 비용).
      lastFailure: await failureOf(
        path.join(dir, "logs"),
        logs.byWorker[eff]?.result ?? null,
        coolUntil(parsed.engine),
      ),
      context: await contextOf(root, text, parsed.cwd),
      // 이 줄이 없는 워커는 공통을 못 받는다 — 화면이 경고 + `공통 적용`을 띄운다(§4-1).
      commonSource: commonSourceRe.test(text),
      // 표식은 파일의 **둘째 줄**이어야 한다(`pool.ts`의 `poolWorkerNameOf`와 같은 기준) — 아무
      // 데나 있는 주석과 가르기 위해서다.
      commonWorker: /^# dira-pool: \S+$/.test(text.split("\n")[1] ?? ""),
      // 이 줄이 없는 워커는 자기 cron 줄을 못 뺀다 — 화면이 경고 + `자가 정리 적용`(§4-4 §소급).
      selfHealSource: selfHealSourceRe.test(text),
      // 이 줄이 없는 워커는 받는 트리가 더러워도 디스패치된다 — 화면이 경고 + `통합 게이트 적용`
      // (§4-14 §소급).
      dispatchGateSource: dispatchGateSourceRe.test(text),
      dispatchGateStale: gateStale,
      cwd: parsed.cwd,
      defects: [], // 공유 판정이 목록 전체를 봐야 하므로 행을 다 만든 뒤에 채운다
      // 표식의 이름이 이 파일의 stem과 같아야 한다 — 안 맞으면 손으로 붙인 낯선 주석이지 shim이 아니다.
      pool: poolShimNameOf(text) === name,
    });
  }

  // 판정 4단계 (§0-10 §받은 편지함 §쓰는 자리). **살아 있는 실패가 0개면 `alerts.json`을
  // 열지 않는다** — 정상 상태에서 이 파일을 여는 횟수가 0이다(§0-5 §비용의 그 셈 그대로).
  // 처음 보는 사건만 편지함에 적고(그 로그 파일명이 없을 때), 이미 보관된 사건은 화면에서 걷는다.
  if (out.some((w) => w.lastFailure)) {
    const alerts = await readAlerts();
    const events = { ...alerts.queues[root] };
    let added = false;
    for (const w of out) {
      if (!w.lastFailure) continue;
      const existing = events[w.lastFailure.log];
      if (existing) {
        if (existing.archived) w.lastFailure = null;
      } else {
        const { at, hash, reason } = w.lastFailure;
        events[w.lastFailure.log] = { at, hash, reason, archived: null };
        added = true;
      }
    }
    if (added) await writeAlerts({ ...alerts, queues: { ...alerts.queues, [root]: events } });
  }

  // tick.sh 39행: TICKET_CWD 줄이 없는 워커의 실효 cwd는 루트의 부모다(contextOf와 같은 기준).
  const eff = out.map((w) => ({ name: w.name, cwd: w.cwd ?? path.dirname(root), rawCwd: w.cwd, path: w.path }));
  const cwdResults = await cwdDefects(root, eff, locale);
  cwdResults.forEach(({ defects: d, cwdPending }, i) => {
    // §4-19 결정 3 — 결함 0개라도 표기 한 줄은 뜰 수 있다(defects와 다른 축).
    if (cwdPending) out[i].cwdPending = t(locale, "workers.defect.cwdPending");
    if (d.length === 0) return; // 결함 0개인 워커는 아무것도 늘지 않는다
    out[i].defects = d;
    // 명령 문자열은 §4 생성과 **같은 함수**에서 나온다 — 두 자리가 다른 걸 보여주면 안 된다.
    // `no-exec`·`no-ticket-cwd`뿐인 워커에는 안 붙인다 — 그 셋은 각자 다른 준비 명령을 쓴다
    // (§0-21 결정 2·3, §977419d7 결정 3 — 세 축은 함께 있어도 서로 가리지 않는다).
    if (d.some((x) => x.kind !== "no-exec" && x.kind !== "no-ticket-cwd")) {
      out[i].worktree = worktreeCmds(root, out[i].name, locale);
    }
    if (d.some((x) => x.kind === "no-exec")) out[i].execFix = execBitCmd(out[i].path);
    if (d.some((x) => x.kind === "no-ticket-cwd")) out[i].cwdFix = ticketCwdLineCmd(root, out[i].name, out[i].path);
  });
  return out;
}

/** 홈 온보딩 예시 앞의 둘이 부를 워커 이름 (DESIGN.md §비주얼 §24 §앞의 둘은 이 큐에 실제로
 *  등록된 워커 이름) — `[<활성>, <다른>]` 또는 워커가 0개면 `[]`다(그 두 버튼이 안 그려진다).
 *
 *  `<활성>`은 `running`인 첫 워커, 없으면 목록의 첫 워커다(`쉬는 중`이라는 답도 이 화면이
 *  약속하는 범위 안이다). `<다른>`은 이름이 다른 첫 워커고, 워커가 하나뿐이면 `<활성>`과
 *  같은 이름이다 — 같은 이름 두 번이 없는 이름 한 번보다 낫다.
 *
 *  **순수 함수다.** 부르는 곳은 `home/page.tsx`의 서버 렌더 한 번이고 폴링(`HomeChunk`)에는
 *  안 싣는다(§24 — `listWorkers`가 `crontab -l`을 물어서 500ms마다 프로세스가 뜬다). */
export function exampleWorkers(workers: Pick<Worker, "name" | "status">[]): string[] {
  const active = workers.find((w) => w.status === "running") ?? workers[0];
  if (!active) return [];
  return [active.name, (workers.find((w) => w.name !== active.name) ?? active).name];
}

const W_NUM_RE = /^w(\d+)$/;

/** 워커 생성 다이얼로그 `이름` 칸의 기본값 (DESIGN.md §4-13, 요구 `a5046a44`) — `w<N>`,
 *  `N`은 목록의 `w<숫자>` 이름 중 가장 큰 수 + 1. 그런 이름이 없으면 `w1`. 빈 번호는 안
 *  메운다(`w1 w2 w4` → `w5`) — 방금 지운 워커의 자리라 되쓰면 남의 워크트리를 물려받는다. */
export function nextWorkerName(names: string[]): string {
  const max = names.reduce((m, name) => {
    const hit = W_NUM_RE.exec(name);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `w${max + 1}`;
}

/** 목록 행의 워커 줄 — 상태별 묶음(DESIGN.md §비주얼 §7). `running 1 / idle 1` 요약을 대체한다:
 *  같은 모양에 이름을 채워 넣은 것이다.
 *
 *  순서는 §2 워커 4상태 표 순서로 **고정**이고 심각도 순으로 재정렬하지 않는다 — `stale`을 앞으로
 *  당기면 상태 구성이 다른 행끼리 자리가 어긋나 세로로 훑을 수 없다. 없는 상태는 묶음이 없다. */
export function workerGroups(workers: Worker[]): { status: WorkerStatus; names: string[] }[] {
  const order: WorkerStatus[] = ["running", "idle", "stopped", "stale"];
  return order
    .map((status) => ({
      status,
      names: workers.filter((w) => w.status === status).map((w) => w.name),
    }))
    .filter((g) => g.names.length > 0);
}

// ── crontab 명령어 (등록·해제가 실패했을 때 사람이 실행한다, 제약 4) ────────

/** 사람이 셸에 붙여 넣을 문자열이다. 경로에 공백·한글·따옴표가 들어 있는 큐가 실제로 있어서
 *  (구글 드라이브 공유 드라이브) 인용을 대충 하면 복사한 명령이 엉뚱한 줄을 만든다. */
const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const dq = (s: string) => `"${s.replace(/(["$`\\])/g, "\\$1")}"`;

/** README §워커와 같은 모양의 cron **2줄**(개행으로 이어져 있다 — 등록 단위가 2줄이다, 제약 4).
 *  cron의 제일 잔 필드가 분이라(`man 5 crontab`) 30초 폴링은 `sleep 30` 줄을 하나 더 두어 낸다.
 *  **한 줄에 `;`로 붙이지 않는다** — 워커는 동기 프로세스라 앞 호출이 세션을 물면 뒷반쪽이
 *  30초 뒤가 아니라 그 세션이 끝난 뒤에 뜬다(`tick.sh:129`). 두 줄이어야 :00·:30이 결정적이다. */
export function cronLine(worker: Pick<Worker, "path">): string {
  const log = path.join(path.dirname(worker.path), "cron.log");
  const run = `${dq(worker.path)} >> ${dq(log)} 2>&1`;
  return `* * * * * ${run}\n* * * * * sleep 30; ${run}`;
}

/** `grep -F`는 **바이트로** 비교한다. crontab 줄은 사람이 넣은 NFC인데 `readdir`가 준 경로는
 *  NFD라서(macOS 한글 큐) 한 형태만 주면 한 줄도 못 걸러낸다 — 사람이 해제 명령을 복사해
 *  실행해도 아무 일이 안 일어나는 조용한 실패다. 두 형태를 **둘 다** 패턴으로 준다.
 *  (a622f9e4는 판정만 고쳤다. `worker.path` 자체는 셸이 실행할 문자열이라 정규화하지 않는다.) */
const grepBothForms = (p: string) =>
  [...new Set([p.normalize("NFC"), p.normalize("NFD")])].map((v) => `-e ${sq(v)}`).join(" ");

/** 먼저 지우고 넣는다 — 사람이 두 번 복사해 실행해도 중복 줄이 안 생긴다(미등록일 땐 no-op).
 *  `echo`가 아니라 `printf '%s\n'`인 건 등록 단위가 2줄이라서다: 인자마다 형식이 한 번씩 도니까
 *  줄을 따로 인용해 넘길 수 있고, 사람이 복사한 명령은 여전히 **한 줄**이다. */
export function cronRegisterCmd(worker: Pick<Worker, "path">): string {
  const keep = `crontab -l 2>/dev/null | grep -Fv ${grepBothForms(worker.path)}`;
  const lines = cronLine(worker).split("\n").map(sq).join(" ");
  return `(${keep}; printf '%s\\n' ${lines}) | crontab -`;
}

/** 이 파일 경로가 들어간 줄을 지운다(`-F` = 경로를 정규식으로 해석하지 않는다). */
export function cronUnregisterCmd(worker: Pick<Worker, "path">): string {
  return `crontab -l | grep -Fv ${grepBothForms(worker.path)} | crontab -`;
}

// ── crontab 쓰기 (제약 4 — 그 프로젝트의 워커 줄만) ─────────────────────────
//
// crontab은 **머신 전역**이다: 남의 프로젝트 큐와 사람의 무관한 잡이 같은 파일에 있다.
// 그래서 변경을 텍스트 순수 함수로 계산한다 — 보존을 진짜 crontab 없이 테스트할 수 있어야 한다.

/** 이 워커 파일 경로가 들어간 줄인가. **비교만 NFC로** 한다(`nfc` 주석 · a622f9e4·38eec0d4):
 *  macOS crontab 줄은 사람이 넣은 NFC인데 `readdir`가 준 경로는 NFD인 큐가 있다.
 *  판정은 `listWorkers`의 `cron`(부분일치)·`grep -Fv`와 같아야 한다 — 갈리면 화면이 거짓말을 한다. */
const isWorkerLine = (line: string, workerPath: string) => nfc(line).includes(nfc(workerPath));

/** 줄 단위 필터. `split("\n")`의 마지막 빈 원소가 후행 개행을 들고 있어서 그대로 join하면
 *  남는 줄은 **바이트 그대로**다(재정렬·재인용·주석 삭제·빈 줄 정리 없음). */
export function cronUnregister(text: string, workerPath: string): string {
  return text
    .split("\n")
    .filter((l) => !isWorkerLine(l, workerPath))
    .join("\n");
}

/** 먼저 그 경로의 줄을 다 지우고 2줄(`cronLine`)을 넣는다 — 두 번 등록해도 중복 줄이 안 생긴다
 *  (`cronRegisterCmd`와 같은 의미). 줄에 들어가는 경로는 정규화하지 **않는다** — 셸이 실제로
 *  실행할 문자열이라 파일시스템이 준 바이트 그대로여야 한다. */
export function cronRegister(text: string, workerPath: string): string {
  const kept = cronUnregister(text, workerPath);
  // 마지막 줄에 개행이 없으면 넣는다 — 안 그러면 남의 줄에 우리 줄이 이어 붙는다.
  const base = kept === "" || kept.endsWith("\n") ? kept : `${kept}\n`;
  return `${base}${cronLine({ path: workerPath })}\n`;
}

/** 쓰기 직전의 읽기. `crontabText()`와 달리 **모든 실패를 빈 crontab으로 보지 않는다** —
 *  읽기 실패를 "비었다"로 오해하고 그 위에 쓰면 남의 줄이 전부 사라진다. 진짜로 비어 있는
 *  경우(`crontab: no crontab for <user>`)만 빈 문자열이다. */
async function crontabForWrite(locale: Locale = DEFAULT_LOCALE): Promise<string> {
  try {
    return (await promisify(execFile)("crontab", ["-l"], { timeout: CRONTAB_READ_TIMEOUT })).stdout;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string; killed?: boolean };
    if (err.killed) throw new Error(readTimedOut(locale));
    if (!err.stdout && /no crontab for/i.test(err.stderr ?? "")) return "";
    throw new Error(`${t(locale, "workers.crontab.readFailPrefix")} ${(err.stderr || err.message).trim()}`);
  }
}

/** **읽기와 쓰기의 상한이 다르다 — 기다리는 대상이 다르기 때문이다**(DESIGN.md §제약 4).
 *
 *  읽기(`crontab -l`)는 TCC 조회 자체가 없다(실측 `0f2c9453`: 5초 폴링이 프롬프트 없이 통과).
 *  여기서 10초를 넘기면 그건 진짜 고장이다.
 *
 *  쓰기(`crontab -`)는 **사람을 기다린다.** macOS TCC `앱 관리`
 *  (`kTCCServiceSystemPolicySysAdminFiles`) 승인을 요구하고, 승인 이력이 없는 프로세스에서는
 *  tccd가 창을 띄운 채 crontab을 블록한다. 옛 10초는 그 창을 알아보고 `허용`을 누르기보다
 *  짧아서 **받는 맥의 첫 등록이 항상 실패했다**(실측 `0f2c9453` — 서명·공증된 `.app`에서도
 *  `crontab에 등록하지 못했습니다`). 그러니 이 상한의 단위는 crontab의 응답 시간이 아니라
 *  **사람의 반응 시간**이다.
 *
 *  그래도 상한은 있다. 아무도 창을 안 누르면 화면이 `만드는 중…`에 영원히 갇히고, "등록 실패는
 *  성공 보고를 막지 않는다"(§0-3 · §4)가 성립하지 않는다. 끊어서 **실패로 만들어야** 그 규약이
 *  남는다 — 화면은 사유와 `cronRegisterCmd`를 보여주고 사람이 셸에서 마무리한다.
 *  (거부는 이 상한을 안 쓴다. 사람이 `허용 안 함`을 누르면 crontab이 즉시 EPERM으로 죽는다.)
 *  // ponytail: 고정 3분. 짧으면 사람의 클릭을 앞지르고 길면 화면이 갇힌다 — 문제가 되면 설정으로 */
const CRONTAB_READ_TIMEOUT = 10_000;
const CRONTAB_WRITE_TIMEOUT = 180_000;

const readTimedOut = (locale: Locale = DEFAULT_LOCALE) => t(locale, "workers.crontab.readTimedOut");
const writeTimedOut = (locale: Locale = DEFAULT_LOCALE) => t(locale, "workers.crontab.writeTimedOut");

/** 승인 거부는 **기다림이 아니라 사유**다. TCC가 거부하면 crontab은 블록되지 않고 바로 죽는데,
 *  그 stderr만으로는 무엇을 켜야 하는지 사람이 알 수 없다(`Operation not permitted`). 사유를 붙인다. */
export const cronWriteError = (stderr: string, locale: Locale = DEFAULT_LOCALE) =>
  /not permitted|permission denied|not allowed/i.test(stderr)
    ? `${t(locale, "workers.crontab.permissionDenied")} (crontab -: ${stderr})`
    : `${t(locale, "workers.crontab.otherFailPrefix")} ${stderr}`;

/** **읽기는 쓰기 직전에 한다.** 렌더 때 읽은 값을 재사용하면 그 사이 남의 변경을 되돌린다
 *  (§결정 기록 실측 — 스펙 쓰는 20분 사이에 남의 줄이 하나 줄었다). 창은 좁힐 수 있을 뿐
 *  없앨 수 없다(crontab에 잠금이 없다).
 *
 *  쓰기는 `crontab -`의 **stdin**이다 — `sh -c`도 임시 파일도 아니다(경로에 공백·한글·따옴표가
 *  들어 있는 큐가 실제로 있다). 그리고 **다시 읽어 확인한다**: 종료코드만 보지 않는다.
 *
 *  돌려주는 값은 **crontab이 실제로 바뀌었는가**다. false = 이미 그 상태였다(no-op) — 중단이
 *  "이미 미등록입니다"를 에러가 아니라 사실로 말할 수 있는 근거가 이것뿐이다. */
async function applyCrontab(
  workerPath: string,
  want: boolean,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const before = await crontabForWrite(locale);
  const next = want ? cronRegister(before, workerPath) : cronUnregister(before, workerPath);
  const changed = next !== before;
  if (changed) {
    await new Promise<void>((resolve, reject) => {
      const child = execFile("crontab", ["-"], { timeout: CRONTAB_WRITE_TIMEOUT }, (err, _out, stderr) => {
        const killed = (err as { killed?: boolean } | null)?.killed;
        if (err) {
          reject(new Error(killed ? writeTimedOut(locale) : cronWriteError((stderr || err.message).trim(), locale)));
        } else resolve();
      });
      child.stdin!.end(next);
    });
  }
  const after = await crontabForWrite(locale);
  if (after.split("\n").some((l) => isWorkerLine(l, workerPath)) !== want) {
    throw new Error(
      want
        ? t(locale, "workers.crontab.registerMismatch")
        : t(locale, "workers.crontab.unregisterMismatch"),
    );
  }
  return changed;
}

/** 이 워커 줄 하나를 crontab에 넣는다(이미 있으면 그 줄을 새로 쓴다). */
export const registerCron = (workerPath: string, locale: Locale = DEFAULT_LOCALE) =>
  applyCrontab(workerPath, true, locale);
/** 이 워커 줄을 뺀다. 없으면 아무것도 쓰지 않는다. */
export const unregisterCron = (workerPath: string, locale: Locale = DEFAULT_LOCALE) =>
  applyCrontab(workerPath, false, locale);

/** 워커가 0개인 큐의 **첫 워커**를 손으로 만드는 명령. `<dira 레포>`는 채워지지 않는다 —
 *  엔진 코드 위치는 워커 파일에만 적혀 있고, 워커가 없으면 GUI가 알 방법이 없다(→ createWorker). */
export function firstWorkerCmd(root: string, name = "w1", locale: Locale = DEFAULT_LOCALE): string {
  const dir = sq(path.join(root, "workers"));
  const file = sq(path.join(root, "workers", `${name}.sh`));
  return `mkdir -p ${dir} && cp <${t(locale, "workers.firstWorkerCmd.repoPlaceholder")}>/worker.sh.example ${file} && chmod 755 ${file}`;
}

// ── 워크트리 (§4-2) ─────────────────────────────────────────────────────────

/** 워커의 작업 디렉터리는 **이름에서 유도한다**(템플릿에서 복사하지 않는다). 두 워커가 같은
 *  트리를 가리키는 값을 GUI가 쓸 수 없어야 한다 — 실사고: `w4`·`w5`가 `w1`의 트리를 물려받아
 *  세 세션이 브랜치 `wt/w1`에 커밋했다(§4-2). */
const worktreePath = (root: string, name: string) => path.join(root, "worktrees", name);

/** `TICKET_CWD` 줄 **하나만** 새 워커 값으로 다시 쓴다. 들여쓰기·`export` 접두는 있던 그대로 —
 *  바뀌는 건 `=` 오른쪽뿐이다. 줄이 아예 없으면(엔진 기본값 = 루트의 부모를 쓰는 워커) 넣는데,
 *  위치는 추측하지 않는다: `#!` 다음 줄, 아니면 맨 앞. */
export function rewriteCwd(text: string, root: string, name: string): string {
  const val = dq(worktreePath(root, name));
  // `.match`는 `/g` 정규식의 lastIndex를 남기지 않는다(`.test`와 다르다 — cwdAssign은 공유다).
  if (text.match(cwdAssign)) {
    return text.replace(cwdAssign, (m, v: string) => m.slice(0, m.length - v.length) + val);
  }
  const lines = text.split("\n");
  lines.splice(lines[0].startsWith("#!") ? 1 : 0, 0, `TICKET_CWD=${val}`);
  return lines.join("\n");
}

// ── 온톨로지 자리 (§5-3 §온톨로지 자리를 워커가 재정의한다, 티켓 cd662a73) ────────

/** `TICKET_ONTOLOGY=` 줄. `cwdAssign`과 같은 모양이고 공유하지 않는다(이 값은 한 함수에서만 쓴다). */
const ontologyAssign = /^[ \t]*(?:export[ \t]+)?TICKET_ONTOLOGY=(.*)$/gm;
/** 그 줄 전체(개행 포함) — 지울 때만 쓴다. */
const ontologyLine = /^[ \t]*(?:export[ \t]+)?TICKET_ONTOLOGY=.*\n?/gm;

/** `TICKET_ONTOLOGY` 줄 하나만 다시 쓴다 — `rewriteCwd`와 같은 관용구(들여쓰기·`export` 접두는
 *  그대로, 바뀌는 건 `=` 오른쪽뿐). `value`가 `null`이면 그 줄을 **지운다** — 기본값 가정으로
 *  되돌리는 길(Done when 5)이 이 한 줄이다. 줄이 없는데 값을 넣을 땐 위치를 추측하지 않는다 —
 *  `#!` 다음 줄, 아니면 맨 앞(`rewriteCwd`와 같다). 절대경로·존재·워크트리 경계 검증은 호출자의
 *  몫이다(`projects.ts`의 `validateOntologyInput` — 여기서 그 파일을 import하면 순환이다,
 *  `projects.ts`가 이미 `workers.ts`를 쓴다). */
export function rewriteOntology(text: string, value: string | null): string {
  if (value === null) return text.match(ontologyLine) ? text.replace(ontologyLine, "") : text;
  const val = dq(value);
  // `.match`는 `/g` 정규식의 lastIndex를 남기지 않는다(`rewriteCwd`와 같은 이유).
  if (text.match(ontologyAssign)) {
    return text.replace(ontologyAssign, (m, v: string) => m.slice(0, m.length - v.length) + val);
  }
  const lines = text.split("\n");
  lines.splice(lines[0].startsWith("#!") ? 1 : 0, 0, `TICKET_ONTOLOGY=${val}`);
  return lines.join("\n");
}

/** 워커 **전부**의 `TICKET_ONTOLOGY` 줄을 같은 값으로 바꾼다 — 온톨로지는 큐 전체의 것이라
 *  워커마다 갈리면 세션이 서로 다른 폴더를 본다(Done when 2). `value`가 검증된 값(또는 기본값
 *  복귀의 `null`)이라고 믿는다 — 이 함수는 이미 검증된 값을 쓰기만 한다.
 *
 *  자기 검증은 `writeContext`와 같은 관용구다: **쓰기 전에** 계산한 `next`를 다시 파싱해 원하는
 *  값이 나오는지 확인하고, 워커 하나라도 다르면 **어느 파일도 쓰지 않는다** — 절반만 바뀐 큐를
 *  만들지 않는다. */
export async function writeOntology(
  root: string,
  value: string | null,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const dir = path.join(root, "workers");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh"));
  const writes: { file: string; next: string; mode: number }[] = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const text = await readFile(file, "utf8");
    const next = rewriteOntology(text, value);
    const m = [...next.matchAll(ontologyAssign)][0];
    const got = m ? shellPath(m[1]) : null;
    if (got !== value) {
      throw new Error(`${n}${t(locale, "workers.ontology.mismatchMid")}`);
    }
    writes.push({ file, next, mode: (await stat(file)).mode & 0o777 });
  }
  for (const w of writes) await atomicWrite(w.file, w.next, w.mode);
}

/** 워커 파일의 `. "<레포>/tick.sh"` 줄. 엔진 코드 위치는 **워커 파일에만** 적혀 있다. */
export const sourceTick = /^[ \t]*(?:\.|source)[ \t]+(.*tick\.sh["']?)[ \t]*$/m;

/** 그 줄을 **쓰는** 쪽(`lib/scaffold.ts`의 첫 워커). 읽기(`sourceTick`)와 같은 파일에 둬야
 *  두 모양이 갈리지 않는다. */
export const tickSourceLine = (repo: string) => `. ${dq(path.join(repo, "tick.sh"))}`;

// ── 자가 정리 (DESIGN.md §4-4) ───────────────────────────────────────────────
//
// 앱을 지우면 `<레포>/tick.sh`가 사라져 **엔진 안의 코드는 그때 실행될 수 없다.** 그 순간에도
// 도는 것은 cron이 부르는 워커 `.sh` 하나뿐이라 판정이 `. tick.sh` **위**에 있다.
// 파일을 **쓰는** 쪽(`SELF_HEAL_SH`)과 워커에 넣는 **줄**(`selfHealSourceLine`)이 한 자리에
// 있어야 두 모양이 안 갈린다 — `sourceTick`/`tickSourceLine`과 같은 이유다.

export const SELF_HEAL_FILE = "self-heal.sh";

/** 워커 파일이 자가 정리를 부르는 한 줄 (§4-4). `. tick.sh` **바로 위**에 들어간다 —
 *  아래에 두면 엔진이 없을 때 이 줄에 닿기 전에 워커가 죽는다. */
export function selfHealSourceLine(root: string, repo: string): string {
  return `. ${dq(path.join(root, SELF_HEAL_FILE))} ${dq(path.join(repo, "tick.sh"))}   # 제거 자기치유(§4-4)`;
}

/** ponytail: `self-heal.sh`를 `.` 하는 줄이면 무엇이든 있는 것으로 본다(경로 비교를 안 한다) —
 *  `commonSourceRe`와 같은 천장이고 같은 이유다(경로 비교엔 NFC 정규화 + `$HOME` 전개가 같이
 *  필요하다). 다른 큐의 `self-heal.sh`를 가리키는 줄까지 통과시키는 것이 대가다. */
const selfHealSourceRe = /^[ \t]*(?:\.|source)[ \t]+[^\n]*self-heal\.sh/m;

/** `<루트>/self-heal.sh`의 전문. GUI가 만들고 관리한다(선례: `context.sh`·`dispatch-gate.sh`).
 *  **엔진이 아니다** — `tick.sh`·`tickets.py`는 이 기능으로 한 줄도 안 바뀐다(불변식 1).
 *
 *  §4-4 표 3줄이 이 문자열의 계약이고, `workers.test.ts`가 진짜 bash로 실행해 확인한다. */
export const SELF_HEAL_SH = `# dira 자가 정리 (DESIGN.md §4-4) — GUI가 만들고 관리한다. 손으로 고치지 않는다.
#
# 워커가 \`. tick.sh\` 바로 위에서 **엔진 경로를 인자로 주며** source한다:
#   . "<루트>/self-heal.sh" "<레포>/tick.sh"
# source에 인자를 주면 그 동안만 위치 인자가 갈리고 돌아오면 복구된다 — 실측(bash 3.2 · /bin/sh):
#   $ bash -c 'set -- tick; . /tmp/s.sh xyz; echo "after: \$1"'   # in: xyz / after: tick
# 그래서 뒤에 오는 \`. tick.sh\`의 \$1(list·dryrun·tick)이 이 줄 때문에 갈리지 않는다.
#
# \$0은 cron이 부른 워커 .sh 그대로다 = crontab 줄에 적힌 **같은 바이트**라 NFC/NFD 정규화가
# 필요 없다(§4의 grepBothForms가 여기엔 없는 이유).
#
# 지우는 대상이 머신 전역 파일이라 **못 읽거나 애매하면 아무것도 안 뺀다**: crontab -l이
# 실패하거나 비었으면 no-op이고, 바뀐 게 없으면 crontab을 아예 쓰지 않는다.
# ponytail: 줄을 실제로 뺄 때 후행 빈 줄은 \$( )가 먹는다(cron 의미는 같다). 남는 줄 자체는
#           재인용·재정렬 없이 바이트 그대로다 — 테스트가 남의 잡·주석·빈 줄로 고정한다.

_dira_engine=\${1:-}
# 인자가 비었으면(줄이 잘못 심겼다) 엔진이 있는지 **알 수 없다.** 그때 ①을 돌리면 살아 있는
# 워커가 자기 줄을 지운다 — 애매하면 안 뺀다. ②는 인자와 무관하므로 그대로 돈다.
if [ -n "$_dira_engine" ] && [ ! -f "$_dira_engine" ]; then _dira_gone=1; else _dira_gone=0; fi
_dira_tab=$(crontab -l 2>/dev/null) || _dira_tab=

if [ -n "$_dira_tab" ]; then
  _dira_keep=
  _dira_live=0
  _dira_cut=0

  while IFS= read -r _dira_l; do
    # dira 줄인가 = \`<…>/workers/<이름>.sh\`를 실행하는가. cronLine이 쓰는 모양이 그것 하나다.
    # ponytail: 큰따옴표 인용만 본다 — 경로에 \`"\`가 든 워커는 안 걸리고 그 줄은 그대로 남는다
    #           (보수적인 쪽으로 틀린다). 그런 큐가 생기면 그때 인용 해제를 붙인다.
    _dira_p=
    case $_dira_l in
      '#'*) ;;   # 주석은 cron이 실행하지 않는다 = dira 줄이 아니다
      *) _dira_p=$(printf '%s\\n' "$_dira_l" | sed -n 's|.*"\\(/[^"]*/workers/[^"/]*\\.sh\\)".*|\\1|p') ;;
    esac

    _dira_drop=0
    if [ "$_dira_gone" = 1 ]; then
      # ① 엔진이 없다 = 앱·레포를 지웠다. 내 줄(등록 단위 2줄)을 빼고 이 tick은 여기서 끝낸다.
      case $_dira_l in *"$0"*) _dira_drop=1 ;; esac
    elif [ -n "$_dira_p" ] && [ ! -f "$_dira_p" ]; then
      # ② 죽은 줄은 자기를 못 뺀다(부를 .sh가 없다). 살아 있는 워커가 대신 뺀다 — 남의 줄이어도.
      _dira_drop=1
    fi

    if [ "$_dira_drop" = 1 ]; then
      _dira_cut=1
    else
      _dira_keep="$_dira_keep$_dira_l
"
      [ -n "$_dira_p" ] && _dira_live=$((_dira_live + 1))
    fi
  done <<_DIRA_SELF_HEAL
$_dira_tab
_DIRA_SELF_HEAL

  if [ "$_dira_cut" = 1 ]; then
    printf '%s' "$_dira_keep" | crontab -
    # ③ 마지막 dira 줄이 빠졌다 = 이 머신에 dira가 없다. 지우는 것은 **키맵 하나**다 —
    #    .dira 아래(큐·워크트리·cron.log)는 사람의 작업물이라 남긴다(요구 51a03986 답 1-2).
    [ "$_dira_live" = 0 ] && rm -f "\${TICKET_LOCAL:-$HOME/.config/dira}/keymap.json"
  fi

  unset _dira_keep _dira_live _dira_l _dira_p _dira_drop
fi

# ①은 여기서 끝낸다. source된 파일이라 중단이 return이 아니라 exit다 — return이면 워커가
# 없는 tick.sh로 그냥 넘어가 cron.log에 No such file을 1분마다 쌓는다(dispatch-gate.sh와 같은 이유).
[ "$_dira_gone" = 1 ] && exit 0
unset _dira_engine _dira_gone _dira_tab _dira_cut
`;

/** 소급 (§4-4 §소급): `<루트>/self-heal.sh`를 **없으면 만들고**, 워커 파일의 `. tick.sh`
 *  **바로 위**에 `source` 줄을 끼운다. 줄이 이미 있으면 `false`(no-op) — 두 번 넣지 않는다.
 *
 *  **엔진 경로는 그 워커의 `. tick.sh` 줄에서 읽는다.** 엔진 코드가 어디 있는지는 워커 파일에만
 *  적혀 있어 GUI가 다른 데서 알 수 없다(`createWorker`가 템플릿을 요구하는 것과 같은 이유).
 *  셸 없이 못 펴면(`$DIRA_REPO/tick.sh` 같은 값) **쓰지 않고** 사유를 준다 — 이 줄이 틀리면
 *  자가 정리가 멀쩡한 엔진을 없다고 보고 산 워커의 cron 줄을 뺀다.
 *
 *  ponytail: 줄이 있는데 `self-heal.sh`가 없는 상태(사람이 파일만 지웠다)는 카드가 경고하지
 *  않는다 — 판정이 §4-1 `commonSource`와 같은 축(줄 하나)이다. 그 상태가 생기면 그때 잰다. */
export async function applySelfHeal(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const file = await workerFile(root, name, locale);
  const text = await readFile(file, "utf8");

  // 실행 파일이 아니다(워커가 `.` 한다) — `context.sh`·`dispatch-gate.sh`와 같은 644.
  // **있으면 안 덮는다**: 파일이 두 번 늘지 않는다는 것이 이 액션의 계약이다.
  const heal = path.join(root, SELF_HEAL_FILE);
  const exists = await stat(heal).then(
    () => true,
    () => false,
  );
  if (!exists) await atomicWrite(heal, SELF_HEAL_SH, 0o644);
  if (selfHealSourceRe.test(text)) return false;

  const m = text.match(sourceTick); // `/m` 앵커라 index가 그 줄 처음이다
  if (!m || m.index === undefined) {
    throw new Error(`${name}.sh${t(locale, "workers.selfHeal.noSourceLineMid")}`);
  }
  const tick = shellValue(m[1]);
  if (tick === null || !path.isAbsolute(expandHome(tick))) {
    throw new Error(
      `${name}.sh${t(locale, "workers.selfHeal.enginePathMid")} ${m[1].trim()}${t(locale, "workers.context.editByHandSuffix")}`,
    );
  }
  const line = selfHealSourceLine(root, path.dirname(expandHome(tick)));
  const next = text.slice(0, m.index) + line + "\n" + text.slice(m.index);
  // 자기 검증 둘: ① 그 줄만 늘었다(다른 바이트를 안 밟았다) ② `. tick.sh`가 **바로 다음 줄**이다.
  const back = next.match(sourceTick);
  if (
    next.replace(line + "\n", "") !== text ||
    !back ||
    back.index !== m.index + line.length + 1 ||
    !selfHealSourceRe.test(next)
  ) {
    throw new Error(t(locale, "workers.context.lineChangedAfterInsert"));
  }
  await atomicWrite(file, next, (await stat(file)).mode & 0o777); // 755를 잃지 않는다
  return true;
}

// ── 통합 게이트 (DESIGN.md §4-14, 요구 21d172fa) ──────────────────────────────
//
// 이 큐(도그푸딩) 하나에만 손으로 있던 `.dira/dispatch-gate.sh`(§4-1 훅 자리)를 다른 프로젝트도
// 갖게 한다. 옮기는 것은 그 파일의 선행조건 둘 중 **받는 트리가 깨끗한가** 하나뿐이다 — 전용
// 워크트리 확인(선행조건 1)은 새 프로젝트의 첫 워커가 TICKET_CWD를 안 받아 그대로 옮기면 첫
// tick부터 영구 정지한다. 자리는 §4-4 자기치유와 같은 짝(파일 상수 · 전문 · source 줄 함수).

export const DISPATCH_GATE_FILE = "dispatch-gate.sh";

/** `<루트>/dispatch-gate.sh`의 전문. `<통합 브랜치>`는 `dispatchGateSh`가 채운다 — scaffold(새
 *  프로젝트)와 `applyDispatchGate`(소급) 둘 다 그 함수를 거쳐야 두 경로가 같은 문자열을 만든다.
 *
 *  이 큐의 손으로 깐 판(`.dira/dispatch-gate.sh`)과 갈리는 것 둘 — ① 선행조건 1(전용 워크트리)이
 *  없다 ② 받는 트리가 **통합 브랜치를 체크아웃 중일 때만** 잰다. 그 조건이 없으면 다른 브랜치가
 *  체크아웃된 받는 트리를 더럽다는 이유로 막는다 — 그 push는 원래 통과한다(§4-14 §검증 실측:
 *  통합 브랜치 main · 받는 트리는 dev 체크아웃 + 미커밋 17건). */
export const DISPATCH_GATE_SH = `#!/bin/bash
# 통합 게이트 (DESIGN.md §4-14, 요구 21d172fa) — 이 프로젝트의 워커가 . tick.sh 앞에서 source한다.
# 엔진이 아니다. GUI가 만들고 관리한다 — 손으로 고치지 않는다.
#
# 세션은 워크트리에서 일하고 git push . HEAD:<통합 브랜치>로 통합한다. 받는 트리가 <통합
# 브랜치>를 체크아웃 중이면 그 작업 트리가 깨끗할 때만 push가 들어간다
# (receive.denyCurrentBranch=updateInstead). 사람이 거기서 편집하다 커밋을 안 하면 모든 세션이
# 일을 다 끝낸 뒤 push에서만 막히고 .wip → reap → 재디스패치를 반복한다(이 큐의 실사고 —
# e903b86b 4회 · f14432b5 11회).
#
# 그래서 막힐 것을 알면서 디스패치하지 않는다. 5~25분짜리 세션을 태우지 않고 한 줄 남긴다.
#
# 이 파일은 워커가 source한다. 중단이 return이 아니라 exit인 이유다 — return은 source한 자리로
# 돌아가고, 워커는 그대로 디스패치로 넘어간다.
#
# ponytail: 받는 트리가 <통합 브랜치>를 체크아웃 중일 때만 잰다. updateInstead가 거부하는 것은
# 체크아웃된 브랜치로 push할 때뿐이라, 다른 브랜치·detached HEAD면 더러워도 막지 않는다. 전용
# 워크트리 확인(도그푸딩 큐의 선행조건 1 — 남과 공유하나)은 여기 없다 — 이 프로젝트의 첫 워커는
# TICKET_CWD를 안 받아서, 그 조건을 그대로 옮기면 갓 만든 프로젝트가 첫 tick부터 영구 정지한다.
# 다만 §4-14 §없는 워크트리를 게이트가 만든다는 옮긴다 — TICKET_CWD가 빈 워커는 워커 수와
# 무관하게 잡는다(P349-2가 §0-3의 "워커가 하나면 워크트리가 필요 없다" 예외를 걷었다).

# list·unassign·reap은 GUI가 부른다. 통합과 무관하므로 막지 않는다
if [ "\${1:-tick}" = tick ] || [ "\${1:-tick}" = dryrun ]; then
  # 첫 워커도 통합 체크아웃에서 일하지 않는다 — TICKET_CWD가 없으면 워커가 하나뿐이어도 잡는다
  # (DESIGN.md 결정 2, P349-2). §4-14 §없는 워크트리를 게이트가 만든다보다 앞이다 — 그 블록은
  # TICKET_CWD가 비면 안 닿으므로, 뒤에 두면 이 판정에 닿지 않는다.
  if [ -z "\${TICKET_CWD:-}" ]; then
    _gate_me=$(basename "$0" .sh)
    _gate_dir=$(dirname "$0")
    _gate_notree="$_gate_dir/.gate-notree-$_gate_me"

    if [ ! -f "$_gate_notree" ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') GATE 디스패치 보류 — $_gate_me 에 TICKET_CWD가 없다."
      echo "  TICKET_CWD 없는 워커는 받는 트리에서 일해 큐를 더럽힌다."
      echo "  워커 파일에 TICKET_CWD=\\"$(dirname "$_gate_dir")/worktrees/$_gate_me\\" 한 줄을 넣는다."
      echo "  넣으면 다음 tick에 게이트가 그 트리를 만들고 디스패치가 재개된다. 이 줄은 상태가 바뀔 때만 뜬다."
      touch "$_gate_notree" 2>/dev/null
    fi
    unset _gate_me _gate_dir _gate_notree
    exit 0
  fi

  # §4-14 §없는 워크트리를 게이트가 만든다 — TICKET_CWD가 표준 자리(<루트>/worktrees/<이름>)인데
  # 그 디렉터리가 없으면 worktreeCmds의 3단계를 셸로 친다. 하나라도 어긋나면 아무것도 안 하고
  # 지나간다(종전 동작 그대로 — 이 블록이 서기 전엔 이 게이트에 그런 조건이 아예 없었다).
  if [ -n "\${TICKET_CWD:-}" ]; then
    _gate_me=$(basename "$0" .sh)
    _gate_dir=$(dirname "$0")
    # pwd -P로 미리 정규화하지 않는다 — 맥 /tmp -> /private/tmp 별칭이 TICKET_CWD(정규화 전
    # 문자열)와 어긋난다. dirname은 심링크를 안 편다(TICKET_CWD가 쓰는 그 표기 그대로)
    _gate_root=$(dirname "$_gate_dir")
    _gate_notree="$_gate_dir/.gate-notree-$_gate_me"
    _gate_standard=0
    [ "$TICKET_CWD" = "$_gate_root/worktrees/$_gate_me" ] && _gate_standard=1

    if [ "$_gate_standard" = 1 ] && [ ! -d "$TICKET_CWD" ]; then
      _gate_project=$(dirname "$_gate_root")
      _gate_made=0
      if git -C "$_gate_project" rev-parse --show-toplevel >/dev/null 2>&1; then
        _gate_made=1
        # 등록만 남은 자리를 먼저 걷는다 — 안 걷으면 add가 missing but already registered로
        # 멈춘다(§4 생성 4항 갈래표). 살아 있는 트리는 안 건드린다
        git -C "$_gate_project" worktree prune >/dev/null 2>&1
        if git -C "$_gate_project" show-ref --verify --quiet "refs/heads/wt/$_gate_me"; then
          git -C "$_gate_project" worktree add "$TICKET_CWD" "wt/$_gate_me" >/dev/null 2>&1 || _gate_made=0
        else
          git -C "$_gate_project" worktree add "$TICKET_CWD" -b "wt/$_gate_me" >/dev/null 2>&1 || _gate_made=0
        fi
        # ln -s 함정(실사고 bf4d8878) — 대상이 이미 있으면 절대 안 친다. 있는 채로 치면 실패하는
        # 대신 그 안쪽에 .dira/.dira를 만든다
        if [ "$_gate_made" = 1 ] && [ ! -e "$TICKET_CWD/.dira" ]; then
          ln -s ../.. "$TICKET_CWD/.dira" 2>/dev/null || _gate_made=0
        fi
        # ls -ld로는 심링크라는 것까지만 보인다 — 이 큐를 가리키는지는 pwd -P로 확인한다.
        # 둘 다 지금 존재하니 여기서만 양쪽을 pwd -P로 정규화해 비교한다(/private 별칭 상쇄)
        if [ "$_gate_made" = 1 ]; then
          _gate_root_real=$(cd "$_gate_root" 2>/dev/null && pwd -P)
          [ "$(cd "$TICKET_CWD/.dira" 2>/dev/null && pwd -P)" = "$_gate_root_real" ] || _gate_made=0
          unset _gate_root_real
        fi
      fi
      unset _gate_project

      if [ "$_gate_made" != 1 ]; then
        if [ ! -f "$_gate_notree" ]; then
          echo "$(date '+%Y-%m-%d %H:%M:%S') GATE 디스패치 보류 — $_gate_me 에 전용 워크트리가 없다."
          echo "  TICKET_CWD=$TICKET_CWD — 자동 생성을 시도했지만 실패했다."
          echo "  만들면 다음 tick부터 저절로 풀린다:"
          echo "    git -C $(dirname "$_gate_root") worktree add $TICKET_CWD -b wt/$_gate_me"
          echo "    ln -s $_gate_root $TICKET_CWD/.dira"
          echo "  이 줄은 상태가 바뀔 때만 뜬다."
          touch "$_gate_notree" 2>/dev/null
        fi
        unset _gate_made _gate_me _gate_dir _gate_root _gate_notree _gate_standard
        exit 0
      fi
      unset _gate_made
    fi

    if [ -f "$_gate_notree" ] && [ -d "$TICKET_CWD" ]; then
      rm -f "$_gate_notree"
      echo "$(date '+%Y-%m-%d %H:%M:%S') GATE 해제 — $_gate_me 워크트리 $TICKET_CWD 확인. 디스패치 재개."
    fi
    unset _gate_me _gate_dir _gate_root _gate_notree _gate_standard
  fi

  _gate_branch="<통합 브랜치>"
  _gate_main=$(git -C "\${TICKET_CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
    _gate_main=$(dirname "$_gate_main")
  # <루트>/push.sh가 있으면 그 큐의 세션은 push를 헬퍼로 통합하고, 헬퍼가 push 직전에 받는
  # 트리를 스스로 치운다(잔해는 버리고 사람 편집은 stash로 옮겼다 되돌린다) — 이 판정이 막을
  # 실패가 없다(P349-2, DESIGN.md §워커는 언제나 자기 워크트리에서 일한다 결정 3).
  _gate_root=$(dirname "$(dirname "$0")")

  if [ -n "$_gate_main" ] && [ -d "$_gate_main" ] && [ ! -f "$_gate_root/push.sh" ]; then
    # detached HEAD면 빈 문자열이라 아래 비교가 항상 거짓이다 — rebase 중인 받는 트리를 막지 않는다
    _gate_current=$(git -C "$_gate_main" symbolic-ref --short -q HEAD 2>/dev/null)

    if [ "$_gate_current" = "$_gate_branch" ]; then
      # 화면이 읽는 표식 자리(§4-14 §표식 파일, 요구 90b7d019) — <루트>/workers/. 이 파일은 늘
      # <루트>/workers/<워커>.sh가 source하므로 $0이 그 워커 파일이다. 옛 자리(<받는
      # 트리>/.git/dira-dirty-warned)는 안 지운다 — 아무도 안 읽는다
      _gate_dir=$(dirname "$0")
      _gate_flag="$_gate_dir/.gate-dirty"
      # -uno: 추적 안 되는 파일은 push를 막지 않는다. 스크래치 파일로 큐를 세우지 않는다
      _gate_status=$(git -C "$_gate_main" status --porcelain -uno 2>/dev/null)

      if [ -n "$_gate_status" ]; then
        if [ ! -f "$_gate_flag" ]; then
          _gate_dirty=$(wc -l <<< "$_gate_status" | tr -d ' ')
          echo "$(date '+%Y-%m-%d %H:%M:%S') GATE 디스패치 보류 — $_gate_main 에 커밋 안 된 변경 \${_gate_dirty}건."
          echo "  받는 트리가 $_gate_branch를 체크아웃 중이고 더러우면 push가 전부 거부된다(updateInstead)."
          echo "  당신 것이면 커밋하거나 워크트리로 옮긴다. 다음 tick부터 저절로 풀린다. 이 줄은 상태가 바뀔 때만 뜬다."

          # 화면이 읽을 사실 한 덩이 — 첫 줄 머리(ISO 8601 + 오프셋 공백 받는 트리 절대경로),
          # 둘째 줄부터 git status --porcelain -uno의 그 줄 그대로(상한 없음)
          _gate_ts=$(date +%Y-%m-%dT%H:%M:%S%z); _gate_ts="\${_gate_ts:0:22}:\${_gate_ts:22}"
          { printf '%s %s\\n' "$_gate_ts" "$_gate_main"; printf '%s\\n' "$_gate_status"; } > "$_gate_flag" 2>/dev/null
        fi
        exit 0
      fi

      if [ -f "$_gate_flag" ]; then
        rm -f "$_gate_flag"
        echo "$(date '+%Y-%m-%d %H:%M:%S') GATE 해제 — $_gate_main 깨끗함. 디스패치 재개."
      fi
    fi
  fi
fi
unset _gate_branch _gate_main _gate_current _gate_dir _gate_flag _gate_status _gate_dirty _gate_ts _gate_root
`;

/** `<통합 브랜치>` 하나만 채운다 — `fillPlaceholders`(scaffold.ts)와 같은 치환 방식이지만 이
 *  파일엔 그 자리표시자 하나뿐이라 함수도 하나만 받는다. scaffold와 `applyDispatchGate` 둘 다 이
 *  함수를 거쳐야 두 경로가 같은 문자열을 만든다. */
export function dispatchGateSh(branch: string): string {
  return DISPATCH_GATE_SH.replaceAll("<통합 브랜치>", () => branch);
}

// ── 통합 push 헬퍼 (DESIGN.md §통합 브랜치가 설정이 된다 결정 4-5) ─────────────
//
// 정본 텍스트는 여기 없다 — `templates/hooks/push.sh` 한 벌(§통합 push의 벽 결정 1)이고, 그 파일이
// `_branch="<통합 브랜치>"` 한 줄을 머리에 든다. scaffold가 그 텍스트를 읽어 이 함수에 넘긴다 —
// `dispatchGateSh`와 같은 치환 방식(`replaceAll`에 함수 인자, 값이 사람이 친 브랜치 이름이라
// `$&`·`$1` 해석을 막는다)이라 두 경로가 같은 문자열을 만든다.

export const PUSH_SH_FILE = "push.sh";

export function pushSh(text: string, branch: string): string {
  return text.replaceAll("<통합 브랜치>", () => branch);
}

/** 워커 파일이 통합 게이트를 부르는 한 줄 (§4-14). `. tick.sh` **바로 위**에 들어간다. */
export function dispatchGateSourceLine(root: string): string {
  return `. ${dq(path.join(root, DISPATCH_GATE_FILE))}   # 통합 게이트(§4-14)`;
}

/** ponytail: `dispatch-gate.sh`를 `.` 하는 줄이면 무엇이든 있는 것으로 본다(경로 비교를 안
 *  한다) — `selfHealSourceRe`와 같은 천장이고 같은 이유다. */
const dispatchGateSourceRe = /^[ \t]*(?:\.|source)[ \t]+[^\n]*dispatch-gate\.sh/m;

/** 템플릿 셋째 줄 — 관리 표식(§4-14 §소급). 새로 만들지 않는다, 이미 있는 문장을 그대로 쓴다. */
const DISPATCH_GATE_MARKER = "GUI가 만들고 관리한다";

export type DispatchGateState = "none" | "latest" | "stale" | "handEdited";

/** `<루트>/dispatch-gate.sh`의 지금 상태를 넷으로 가른다 (§4-14 §소급). 판정은 **내용 비교
 *  하나** — 새 버전 번호도 새 표식 파일도 안 만든다. */
export async function dispatchGateState(root: string, branch: string): Promise<DispatchGateState> {
  const text = await readFile(path.join(root, DISPATCH_GATE_FILE), "utf8").catch(() => null);
  if (text === null) return "none";
  if (text === dispatchGateSh(branch)) return "latest";
  return text.includes(DISPATCH_GATE_MARKER) ? "stale" : "handEdited";
}

// ── 통합 브랜치 (`<루트>/integration-branch`, DESIGN.md §통합 브랜치가 설정이 된다 결정 1-2) ──

/** `readPoolLimit`과 같은 모양 — 파일 하나, 값 한 줄, 파서 없이 정규식 하나로 받는다. */
const INTEGRATION_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

function integrationBranchFile(root: string): string {
  return path.join(root, "integration-branch");
}

/** 정본을 읽는다. 읽기 순서는 셋이다(결정 2) - ① `<루트>/integration-branch` ② 종전 경로
 *  (`protocols/AGENTS.md`의 `git rebase <브랜치>` 문장) ③ 받는 트리(`dirname(root)`)가 지금
 *  체크아웃한 브랜치. ②나 ③으로 구하면 그 값을 ①에 한 번 적어 다음부터는 ①만 읽는다(멱등).
 *  셋 다 실패하면 `null`이다 - 없는 값을 추측해서 쓰지 않는다. */
export async function readIntegrationBranch(root: string): Promise<string | null> {
  const text = await readFile(integrationBranchFile(root), "utf8").catch(() => null);
  if (text !== null) {
    const trimmed = text.trim();
    if (INTEGRATION_BRANCH_RE.test(trimmed)) return trimmed;
  }

  const agents = await readFile(path.join(root, "protocols/AGENTS.md"), "utf8").catch(() => null);
  const legacy = agents?.match(/git rebase ([^\s`]+)/)?.[1];
  if (legacy && INTEGRATION_BRANCH_RE.test(legacy)) {
    await writeIntegrationBranch(root, legacy);
    return legacy;
  }

  const current = await promisify(execFile)("git", [
    "-C",
    path.dirname(root),
    "symbolic-ref",
    "--short",
    "-q",
    "HEAD",
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  );
  if (current && INTEGRATION_BRANCH_RE.test(current)) {
    await writeIntegrationBranch(root, current);
    return current;
  }

  return null;
}

/** 검증 + 파일 본문. `writePoolLimit`과 같은 검증 모양 — scaffold의 `put`(O_EXCL) 쪽도 이 문자열을
 *  그대로 쓴다. */
export function integrationBranchText(branch: string, locale: Locale = DEFAULT_LOCALE): string {
  if (!INTEGRATION_BRANCH_RE.test(branch)) {
    throw new Error(`${t(locale, "workers.integrationBranch.invalidPrefix")} ${branch}`);
  }
  return `${branch}\n`;
}

/** 문서 셋에서만 치환하는 문장 모양 넷(§통합 브랜치가 설정이 된다 결정 3) - `git rebase <값>`,
 *  `git push . HEAD:<값>`, `git log --oneline <값>`, `` `<값>` 체크아웃``. **낱말만 보고 바꾸지
 *  않는다** - `main`-`master`는 산문에도 나오는 낱말이라, 이 문장 모양 안쪽에서만 옛 브랜치
 *  이름을 찾는다. 앞뒤로 브랜치에 쓰이는 글자(`INTEGRATION_BRANCH_RE`)가 더 안 붙는 자리에서만
 *  문다 - `master`를 찾을 때 `master-v2`의 앞부분을 집지 않는다. */
function rewriteIntegrationBranchSentences(text: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = "(?![A-Za-z0-9._/-])";
  return text
    .replace(new RegExp(`(git rebase )${esc}${boundary}`, "g"), `$1${to}`)
    .replace(new RegExp(`(git push \\. HEAD:)${esc}${boundary}`, "g"), `$1${to}`)
    .replace(new RegExp(`(git log --oneline )${esc}${boundary}`, "g"), `$1${to}`)
    .replace(new RegExp("(`)" + esc + boundary + "(` 체크아웃)", "g"), `$1${to}$2`);
}

/** 문서 셋 목록(§결정 3 표) - 문장 모양 넷에서만 치환한다. */
const INTEGRATION_BRANCH_DOCS = ["protocols/AGENTS.md", "protocols/push-거부.md", "protocols/재디스패치-복구.md"];

/** 값이 갈리면 쓰인 자리 다섯을 다시 쓴다(§통합 브랜치가 설정이 된다 결정 3, 답 `1-1.(a)`).
 *  **낱말이 아니라 파일별로 두 방법이 갈린다.**
 *
 *  - 생성 둘(`dispatch-gate.sh`-`push.sh`)은 문자열을 기워 넣지 않고 템플릿에서 통째로 다시
 *    만든다. `dispatch-gate.sh`의 손으로 고친 판(`dispatchGateState`가 `handEdited`)은 그 종전
 *    판정을 그대로 따라 건드리지 않는다(`applyDispatchGate`와 같은 계약) - `push.sh`는 그런
 *    판정 장치가 없으니 있으면 항상 다시 만든다.
 *  - 문서 셋은 `rewriteIntegrationBranchSentences`가 문장 모양 넷에서만 치환한다.
 *
 *  실제로 갈린 파일의 `<루트>` 기준 상대경로만 돌려준다 - 안 갈린 파일은 안 든다. */
export async function rewriteIntegrationBranch(
  root: string,
  from: string,
  to: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string[]> {
  const changed: string[] = [];

  const gateFile = path.join(root, DISPATCH_GATE_FILE);
  const gateState = await dispatchGateState(root, from);
  if (gateState === "latest" || gateState === "stale") {
    const before = await readFile(gateFile, "utf8");
    const next = dispatchGateSh(to);
    if (next !== before) {
      await atomicWrite(gateFile, next, 0o644);
      changed.push(DISPATCH_GATE_FILE);
    }
  }

  const pushShFile = path.join(root, PUSH_SH_FILE);
  const pushShBefore = await readFile(pushShFile, "utf8").catch(() => null);
  if (pushShBefore !== null) {
    const repo = engineRepo(locale);
    if ("error" in repo) throw new Error(repo.error);
    const template = await readFile(path.join(repo.path, "templates/hooks/push.sh"), "utf8");
    const next = pushSh(template, to);
    if (next !== pushShBefore) {
      await atomicWrite(pushShFile, next, (await stat(pushShFile)).mode & 0o777);
      changed.push(PUSH_SH_FILE);
    }
  }

  for (const rel of INTEGRATION_BRANCH_DOCS) {
    const file = path.join(root, rel);
    const before = await readFile(file, "utf8").catch(() => null);
    if (before === null) continue;
    const next = rewriteIntegrationBranchSentences(before, from, to);
    if (next !== before) {
      await atomicWrite(file, next, (await stat(file)).mode & 0o777);
      changed.push(rel);
    }
  }

  return changed;
}

/** 저장. 값이 문장 모양에 매여 있던 것이 `integrationBranchOf`의 결함 원인이었다 - 이 함수는
 *  그 결합을 끊고 파일 하나에 값 한 줄만 쓴다. **덮어쓴다** — 결정 2의 멱등 이관과 결정 3의
 *  "값을 바꾸면 다시 쓴다"가 이 함수를 부른다(스캐폴딩은 O_EXCL `put`을 대신 쓴다).
 *
 *  **이전 값이 있고 새 값과 다르면 `rewriteIntegrationBranch`를 같이 부른다** - 이 함수를 부르는
 *  자리가 그 호출을 따로 기억할 필요가 없도록, 값이 갈리는 순간과 쓰인 자리를 다시 쓰는 순간을
 *  한 함수 안에서 묶는다(§결정 3이 막으려는 "값만 갈리고 파일이 안 갈리는 상태"). 이전 값이
 *  없으면(파일이 처음 생기는 이관 자리, 결정 2) 다시 쓸 옛 값이 없으니 건너뛴다 - 그 자리의
 *  문서·스크립트는 이미 그 값으로 태어나 있다. */
export async function writeIntegrationBranch(
  root: string,
  branch: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string[]> {
  const text = integrationBranchText(branch, locale);
  await mkdir(root, { recursive: true });
  const previous = await readFile(integrationBranchFile(root), "utf8")
    .then((t) => t.trim())
    .catch(() => null);
  await writeFile(integrationBranchFile(root), text, "utf8");
  if (previous !== null && previous !== branch && INTEGRATION_BRANCH_RE.test(previous)) {
    return rewriteIntegrationBranch(root, previous, branch, locale);
  }
  return [];
}

/** 소급 (§4-14 §소급): `<루트>/dispatch-gate.sh`를 **없으면 만들고**, 워커 파일의 `. tick.sh`
 *  **바로 위**에 `source` 줄을 끼운다. 줄이 이미 있으면 `false`(no-op) — 자가 정리와 같은 계약. */
export async function applyDispatchGate(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const file = await workerFile(root, name, locale);
  const text = await readFile(file, "utf8");

  const branch = await readIntegrationBranch(root);
  if (branch === null) {
    throw new Error(t(locale, "workers.dispatchGate.branchUnreadable"));
  }

  const gate = path.join(root, DISPATCH_GATE_FILE);
  // 없음·낡음만 (덮어)쓴다 — 최신은 쓸 이유가 없고, 손으로 깐 판은 그 사실이 곧 사유라 안 건드린다.
  const state = await dispatchGateState(root, branch);
  if (state === "none" || state === "stale") await atomicWrite(gate, dispatchGateSh(branch), 0o644);
  if (dispatchGateSourceRe.test(text)) return false;

  const m = text.match(sourceTick); // `/m` 앵커라 index가 그 줄 처음이다
  if (!m || m.index === undefined) {
    throw new Error(`${name}.sh${t(locale, "workers.dispatchGate.noSourceLineMid")}`);
  }
  const line = dispatchGateSourceLine(root);
  const next = text.slice(0, m.index) + line + "\n" + text.slice(m.index);
  // 자기 검증 둘: ① 그 줄만 늘었다(다른 바이트를 안 밟았다) ② `. tick.sh`가 **바로 다음 줄**이다.
  const back = next.match(sourceTick);
  if (
    next.replace(line + "\n", "") !== text ||
    !back ||
    back.index !== m.index + line.length + 1 ||
    !dispatchGateSourceRe.test(next)
  ) {
    throw new Error(t(locale, "workers.context.lineChangedAfterInsert"));
  }
  await atomicWrite(file, next, (await stat(file)).mode & 0o777); // 755를 잃지 않는다
  return true;
}

/** 워크트리 준비 명령 **2줄 + 검증 1줄**(§4 생성 4항). GUI가 실패했을 때 사람이 셸에서
 *  이어서 실행하는 문자열이다 — 성공하면 아무 데도 안 보인다.
 *
 *  **`git -C`의 대상은 `dirname(root)` = 그 프로젝트다.** 엔진 레포가 아니다(§4 생성 4항의 3번,
 *  `tick.sh:39` — `TICKET_CWD` 기본값이 `dirname(TICKET_ROOT)`). 종전엔 워커 파일의
 *  `. <레포>/tick.sh`에서 읽은 엔진 레포를 넣었는데, 그건 dira가 자기를 도그푸딩해서 우연히
 *  맞았을 뿐이다 — 프로젝트 `foo`의 워커가 `~/Projects/dira/tick.sh`를 source하면 그 명령은
 *  `foo/.dira/worktrees/w2`에 **dira를 체크아웃한다**.
 *
 *  검증 줄은 장식이 아니다: `.dira`가 이미 있으면 `ln -s`가 실패하는 대신 그 **안쪽에**
 *  링크를 만든다(실사고 `bf4d8878`) — 세션이 미끼 큐를 보고 자기 티켓을 못 찾는다.
 *  `prepareWorktree`는 그래서 셸이 아니라 `fs.symlink` + `fs.realpath`로 간다. */
export function worktreeCmds(root: string, name: string, locale: Locale = DEFAULT_LOCALE): string[] {
  const dir = worktreePath(root, name);
  return [
    `git -C ${sq(path.dirname(root))} worktree add ${sq(dir)} -b wt/${name}`,
    `ln -s ../.. ${sq(path.join(dir, ".dira"))}`,
    `ls -ld ${sq(path.join(dir, ".dira"))}    # \`l\`${t(locale, "workers.worktreeCmds.lsHintSuffix")}`,
  ];
}

/** `no-exec` 결함(§0-21 결정 2)의 CopyCommand — `chmod +x <절대경로>`, §4 결함 셋의 `worktreeCmds`와
 *  같은 자리·같은 인용 규칙(`sq`). 복구 버튼(§0-21 결정 3)은 로드맵 P290-4가 이 문자열 위에 붙인다 —
 *  이 판정 티켓의 몫은 문자열까지다. */
export function execBitCmd(file: string): string {
  return `chmod +x ${sq(file)}`;
}

/** `no-ticket-cwd` 결함(§977419d7 결정 3)의 CopyCommand — 워커 파일 끝에 `TICKET_CWD=` 한 줄만
 *  덧붙인다(`>>`라 기존 줄은 한 글자도 안 바뀌고 실행 비트도 그대로다). `worktreeCmds`의 3단계가
 *  아니다 — 트리 자체는 이 명령이 안 만들고, 다음 tick에 게이트가 만든다(§4-14 §없는 워크트리를
 *  게이트가 만든다). 값은 `rewriteCwd`와 같은 `dq` 인용 규칙을 쓴다 — 파일에 실제로 들어가는
 *  모양(`TICKET_CWD="…"`)과 갈리면 사람이 다시 파싱할 때 헷갈린다. */
export function ticketCwdLineCmd(root: string, name: string, file: string): string {
  const line = `TICKET_CWD=${dq(worktreePath(root, name))}`;
  return `printf '%s\\n' ${sq(line)} >> ${sq(file)}`;
}

/** `no-exec` 결함(§0-21 결정 3)의 복구 버튼이 부르는 액션 — `workerFile`이 그 워커 하나로
 *  경로를 좁혀서 다른 워커 파일은 안 건드린다. 값은 `createWorker`(1995행)가 생성 때 주는
 *  0o755로 고정한다 — 잃은 실행 비트 셋만 켜는 게 아니라 이 앱이 만드는 워커 파일의 정상
 *  모드로 되돌린다. 권한·소유자가 다르면 `chmod`가 던지고 화면이 `execBitCmd`로 되돌아간다. */
export async function applyExecBit(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const file = await workerFile(root, name, locale);
  await chmod(file, 0o755);
}

/** `prepareWorktree`의 결과. 화면이 **이것만으로** 성공·정상종료·실패 패널을 그린다(§6 에러 3요소). */
export type WorktreePrep = {
  /** 만든(또는 만들려던) 트리 경로. 성공 패널이 이 경로를 알려 준다 */
  dir: string;
  /** 끝난 단계 수 0~3 (트리 → 심링크 → 검증). 3이면 성공이다 */
  done: number;
  /** 멈춘 사유. `done === 3`이면 없다 */
  reason?: string;
  /** 사람이 셸에서 이어서 실행할 명령 = `worktreeCmds`의 꼬리. 성공이면 빈 배열 */
  rest: string[];
  /** 레포가 아니라 **아예 시작하지 않았다**. 실패가 아니라 정상 종료다(§4 생성 4항) —
   *  화면이 에러가 아니라 사실로 말하고, `rest`도 비어 있다(줄 게 없다) */
  skipped?: true;
};

/** `git worktree list --porcelain`을 파싱한다 — 트리·등록 선존재 판정(§4 생성 4항 갈래표)의
 *  입력. 블록은 빈 줄로 갈린다. `worktree` 줄이 없는 블록(트레일링 개행)은 버린다. */
async function listWorktreeEntries(
  repo: string,
): Promise<{ worktree: string; branch: string | null; prunable: boolean }[]> {
  const { stdout } = await promisify(execFile)("git", ["-C", repo, "worktree", "list", "--porcelain"]);
  return stdout
    .split("\n\n")
    .map((block) => block.split("\n").filter(Boolean))
    .filter((lines) => lines.some((l) => l.startsWith("worktree ")))
    .map((lines) => ({
      worktree: lines.find((l) => l.startsWith("worktree "))!.slice("worktree ".length),
      branch: lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null,
      prunable: lines.some((l) => l.startsWith("prunable")),
    }));
}

/** 워크트리 3단계를 **서버가 실행한다**(§4 생성 4항 — 사람 요청 `5f55577a`가 §4-2를 뒤집었다).
 *
 *  자동화의 근거는 셸 3줄이 못 잡는 함정 둘이다:
 *  - 심링크가 `fs.symlink`라 `.dira`가 이미 있으면 **`EEXIST`로 멈춘다.** `ln -s`는 대신
 *    대상 **안쪽에** `.dira/.dira`를 만든다(실사고 `bf4d8878`).
 *  - 검증이 `ls -ld`가 아니라 `realpath`다. `ls`는 심링크라는 것까지만 보이지 그게
 *    **이 큐를 가리키는지**는 안 본다.
 *
 *  **실패해도 되돌리지 않는다**(§0-3 스캐폴딩과 같은 규칙). `git worktree add`가 성공한 뒤라면
 *  그 디렉터리는 이미 사람의 작업이 들어갈 수 있는 자리다 — GUI가 지우는 쪽이 더 위험하다.
 *
 *  ponytail: 의존성 설치는 하지 않는다(§4 생성 4항 — 이게 이 기능의 천장이다). 필요해지면
 *  `<루트>/worktree-setup.sh`가 다음 단계고 `context.sh`와 같은 선례를 따른다. */
export async function prepareWorktree(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<WorktreePrep> {
  const cmds = worktreeCmds(root, name, locale);
  const dir = worktreePath(root, name);
  const stop = (done: number, reason: string): WorktreePrep => ({ dir, done, reason, rest: cmds.slice(done) });
  const why = (e: unknown) =>
    (String((e as { stderr?: string }).stderr ?? "").trim() || (e as Error).message).trim();

  const repo = path.dirname(root);
  const link = path.join(dir, ".dira");
  const git = (...args: string[]) => promisify(execFile)("git", ["-C", repo, ...args]);

  // 레포가 아니면 **아무것도 실행하지 않는다.** 워크트리를 안 쓰는 배치는 정상이다(§0-3) —
  // 그래서 남은 명령도 주지 않는다. 여기서 3줄을 주면 "안 해도 되는 일"을 지시로 읽는다.
  if (!(await git("rev-parse", "--git-dir").then(() => true, () => false))) {
    return {
      dir,
      done: 0,
      reason: `${repo} ${t(locale, "workers.worktree.notGitRepoSuffix")}`,
      rest: [],
      skipped: true,
    };
  }
  const branch = `wt/${name}`;
  // 큐 루트(`root`)는 항상 있다 — 워크트리가 없어도(재생성 전, 폴더만 지운 상태) 이 realpath는
  // 그대로다. git이 등록에 저장하는 경로도 `add` 성공 직후의 realpath라 이렇게 다시 지어야
  // 트리가 없어졌을 때도 같은 문자열이 된다(맥 `/private` 별칭 — `dir` 자체를 realpath하면
  // 없는 트리에서 실패해 이 별칭이 안 풀리고 아래 매칭이 늘 헛돈다).
  const queue = nfc(await realpath(root).catch(() => root));
  // 같은 이름의 워커를 지웠다 다시 만드는 경로 — `삭제`가 트리는 남기고 파일·crontab만
  // 지운다(§4 삭제). 브랜치와 같은 자리에서 같은 식으로 트리·등록을 **먼저 본다**: 치고 나서
  // 에러 문구를 읽지 않는다(로케일을 탄다). 입력은 `git worktree list --porcelain` 하나고
  // 갈래는 셋이다(§4 생성 4항 갈래표) — 경로 비교는 이 파일이 이미 쓰는 realpath+nfc다.
  const entries = await listWorktreeEntries(repo).catch(() => []);
  const dirKey = nfc(path.join(queue, "worktrees", name));
  let entry: (typeof entries)[number] | null = null;
  for (const e of entries) {
    if ((await realpath(e.worktree).then(nfc, () => nfc(e.worktree))) === dirKey) {
      entry = e;
      break;
    }
  }
  if (entry?.prunable) {
    // 등록은 있는데 디렉터리가 없다 — 그대로 두면 `add`가 `missing but already registered`로
    // 멈춘다. `prune` 한 번 뒤 통상 경로(브랜치 선존재 → add)로 이어간다.
    await git("worktree", "prune").catch(() => {});
    entry = null;
  }
  if (entry?.branch === `refs/heads/${branch}`) {
    // 그 트리가 이미 등록돼 있고 브랜치가 wt/<이름>이다 — 1단계를 건너뛴다. 이미 있는 것이
    // 만들려던 바로 그 트리다. **`add -f`는 쓰지 않는다** — 강제는 이 판정 자체를 건너뛰는
    // 것이라 셋째 갈래(디렉터리는 있는데 등록이 없다 / 등록이 다른 브랜치를 물었다)까지
    // 같이 삼킨다.
  } else {
    // 그 밖(위 둘이 아니다) — 종전대로 `git worktree add`를 치고 실패하면 그대로 실패한다.
    // 브랜치가 이미 있으면 `-b`가 실패하니 먼저 본다. `add <경로> <브랜치>`로 붙인다:
    // 브랜치를 빼면 git이 디렉터리 이름에서 dwim해서 `wt/<name>`이 아닌 다른 브랜치를 만든다.
    const has = await git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`).then(
      () => true,
      () => false,
    );
    try {
      await git("worktree", "add", dir, ...(has ? [branch] : ["-b", branch]));
    } catch (e) {
      return stop(0, `${t(locale, "workers.worktree.addFailedPrefix")} ${why(e)}`);
    }
  }
  try {
    await symlink("../..", link);
  } catch (e) {
    const eexist = (e as NodeJS.ErrnoException).code === "EEXIST";
    // `.dira`가 이미 이 큐로 풀리면 트리 선존재(위)와 같은 재생성 경로다 — 2단계도 끝난
    // 것으로 보고 검증(아래)으로 넘어간다. 안 풀리면 종전 문구 그대로 멈춘다 — 미끼 `.dira`
    // (실사고 `bf4d8878`)는 그대로 잡힌다.
    const already = eexist && (await realpath(link).then(nfc, () => null)) === queue;
    if (!already) {
      return stop(
        1,
        eexist
          ? `${link} ${t(locale, "workers.worktree.symlinkExistsSuffix")}`
          : `${t(locale, "workers.worktree.symlinkFailedPrefix")} ${why(e)}`,
      );
    }
  }
  const to = await realpath(link).then(nfc, () => null);
  if (to !== queue) {
    return stop(
      2,
      `${link} ${t(locale, "workers.worktree.wrongResolveMid1")}${queue}${t(locale, "workers.worktree.wrongResolveMid2")} ${to ?? t(locale, "workers.worktree.unresolved")} ${t(locale, "workers.worktree.wrongResolveSuffix")}`,
    );
  }
  return { dir, done: 3, rest: [] };
}

/** 엔진 레포 경로. **`DIRA_ENGINE`이 있으면 그것이고**(패키징된 `.app`이 번들의 엔진을 userData로
 *  꺼내 넘긴다 — §데스크톱 앱 고정하는 것 8), 없으면 **GUI 자기 위치에서 유도한다**(§0-3 답변 2(a)).
 *  GUI는 `<엔진 레포>/apps/teams/`에 있다 — 상위 2단계가 레포다. `.app`에서는 서버가
 *  `Contents/Resources/server/`에서 돌아 그 유도가 `Contents`를 가리키므로 env가 먼저다.
 *
 *  **`tick.sh` 존재 확인은 어느 쪽이든 그대로다.** 없으면 **거부한다. 폼 필드로 되묻지 않는다** —
 *  GUI가 엔진 레포 밖에 있다는 건 설치가 깨진 것이고 폼 하나로 고칠 문제가 아니다. 본 경로를
 *  사유에 그대로 담아 사람이 무엇을 봐야 하는지 알게 한다(어느 쪽에서 나온 값인지도 같이).
 *
 *  **§0-3 스캐폴딩과 §4-18 생성 버튼 폴백이 같이 부른다** — 두 벌로 갈리면 새 프로젝트와 워커
 *  0개인 큐의 첫 워커가 서로 다른 판정을 받는다. */
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

/** 첫 워커 몸통 조립 — `worker.sh.example`의 `. tick.sh` 줄을, 실효 컨텍스트 블록 + (게이트
 *  브랜치를 알면) 게이트 source 줄 + 자가 정리 source 줄 + 그 줄 자신으로 바꾼다. **§0-3
 *  스캐폴딩과 §4-18 생성 버튼 폴백이 이 함수 하나를 같이 부른다** — 조립이 두 벌로 갈리면
 *  스캐폴딩으로 태어난 큐와 버튼으로 태어난 큐의 첫 워커가 서로 다른 모양이 되고, 그 차이는 몇
 *  달 뒤 "이 워커만 왜 게이트가 없나"로 돌아온다(§4-18 결정 1). `gateBranch`가 `null`이면 게이트
 *  줄을 안 넣는다(§4-18 결정 4 — `protocols/AGENTS.md`를 못 읽는 큐).
 *
 *  `TICKET_CWD` 줄은 §워커는 언제나 자기 워크트리에서 일한다 결정 1이 넣으라고 한 값이다 —
 *  새 파서를 만들지 않고 §4 생성이 이미 쓰는 `rewriteCwd`에 그대로 태운다(같은 표준 자리
 *  `<루트>/worktrees/<이름>`, 없는 디렉터리는 §4-14 게이트가 첫 tick에 만든다). */
export function firstWorkerBody(
  example: string,
  root: string,
  repo: string,
  gateBranch: string | null,
  name: string,
): string {
  const body = example.replace(
    sourceTick,
    () =>
      `# 컨텍스트(선택). GUI 워커 화면이 이 블록을 고친다 — 항목 문법은 위 주석 예시.\n` +
      `${renderContextBlock([])}\n\n` +
      `${gateBranch !== null ? `${dispatchGateSourceLine(root)}\n` : ""}${selfHealSourceLine(root, repo)}\n${tickSourceLine(repo)}`,
  );
  return rewriteCwd(body, root, name);
}

// ── 생성 · 중단 · 삭제 ──────────────────────────────────────────────────────

/** 이름 검증 + 경로 조립은 **서버에서만** 한다(신뢰 경계). 이름이 규칙을 통과해도 경로를
 *  문자열로 믿지 않고 `resolveWithin`으로 workers/ 안인지 확인한다. */
async function workerFile(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${t(locale, "workers.create.invalidNamePrefix")} ${name || t(locale, "workers.create.emptyName")}`,
    );
  }
  return resolveWithin(path.join(root, "workers"), `${name}.sh`);
}

/** 기존 워커를 템플릿으로 새 워커를 만든다 (DESIGN.md §4 생성).
 *
 *  템플릿이 필요한 이유는 마지막 `. <엔진레포>/tick.sh` 한 줄이다 — 엔진 코드가 어디 있는지는
 *  워커 파일에만 적혀 있고 GUI가 알 방법이 없다. **워커 0개인 큐에서는 §4-18 폴백이 대신
 *  `<엔진 레포>/worker.sh.example`을 템플릿으로 쓴다**(§0-3이 첫 워커에 쓰는 그 조립과
 *  `firstWorkerBody` 하나를 같이 부른다) — 거부가 남는 자리는 `engineRepo()`가 실패할 때뿐이다
 *  (결정 2, 폼 필드로 되묻지 않고 그 사유를 그대로 던진다).
 *
 *  복사한 뒤 **`TICKET_CWD` 줄과 `TICKET_ENGINE` 블록만** 새 값으로 다시 쓴다(§4-2 · §4-3).
 *  나머지 줄은 손대지 않는다 — 엔진 경로·게이트·컨텍스트가 템플릿에서 와야 하는 이유는 그대로다.
 *
 *  엔진을 템플릿에서 **물려받지 않는 이유는 `TICKET_CWD`와 같다**(§4 생성 1항): 딸려 오면
 *  생성 폼에서 고른 값이 조용히 무시되고, 사람은 새 워커가 왜 다른 엔진으로 도는지 모른다.
 *  기본값 `claude` + `NO_MODEL`은 **`tick.sh`가 잡는 그 값**이라 안 고른 사람은 종전과 같은
 *  워커를 얻는다(§4-3) — 블록이 명시로 적힌다는 것만 다르다. */
export async function createWorker(
  root: string,
  name: string,
  engine: EngineId = "claude",
  model: string = NO_MODEL,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ path: string; template: string }> {
  // 템플릿 확인이 먼저다 — workers/가 아예 없는 큐에서 `resolveWithin`의 ENOENT를 먼저 만나면
  // 사용자가 받는 문장이 "경로 없음"이 되어 진짜 이유(템플릿 없음)를 가린다.
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${t(locale, "workers.create.invalidNamePrefix")} ${name || t(locale, "workers.create.emptyName")}`,
    );
  }
  const dir = path.join(root, "workers");
  const existing = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".sh")).sort();
  let template: string;
  let text: string;
  if (existing.length === 0) {
    // §4-18 폴백. `engineRepo()`가 error면 파일 하나 만들기 전에 멈춘다(결정 2).
    const repo = engineRepo(locale);
    if ("error" in repo) throw new Error(repo.error);
    template = "worker.sh.example";
    const example = await readFile(path.join(repo.path, "worker.sh.example"), "utf8");
    // 게이트는 `protocols/AGENTS.md`를 읽을 수 있을 때만 붙는다 — 못 읽어도 생성은 성공한다
    // (결정 4). 자가 정리는 언제나 붙는다(입력이 경로 둘뿐이라 — firstWorkerBody가 그 줄은
    // 무조건 넣는다).
    const branch = await readIntegrationBranch(root);
    text = firstWorkerBody(example, root, repo.path, branch, name);
    // 자가 정리·게이트 파일 자신도 §0-3과 같은 자리에 눕는다 — **있으면 덮지 않는다**
    // (`scaffold`의 `put`과 같은 O_EXCL 계약). 실행 파일이 아니라 source되는 파일이라 모드는
    // 기본값이다.
    const putShared = (rel: string, body: string) =>
      writeFile(path.join(root, rel), body, { flag: "wx" }).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      });
    await putShared(SELF_HEAL_FILE, SELF_HEAL_SH);
    if (branch !== null) await putShared(DISPATCH_GATE_FILE, dispatchGateSh(branch));
  } else {
    template = existing[0];
    text = await readFile(path.join(dir, template), "utf8");
  }
  const file = await workerFile(root, name, locale);
  // 값 검증(모르는 엔진 · 셸 메타문자가 든 모델)은 `engineArgv`가 한다 — 이 경로도 신뢰
  // 경계고, 던지면 **파일을 만들기 전에** 멈춘다.
  const next = applyEngineBlock(rewriteCwd(text, root, name), engine, model, locale);
  // O_EXCL. 있는 워커를 덮어쓰면 돌고 있는 cron 줄의 내용이 바뀐다.
  await writeFile(file, next, { flag: "wx" });
  await chmod(file, 0o755);
  // 워크트리 준비 명령은 여기서 안 준다 — 생성 액션이 `prepareWorktree`로 **직접 만들고**,
  // 명령은 그게 실패했을 때만(`WorktreePrep.rest`) 화면에 나온다(§4 생성 4항).
  return { path: file, template };
}

/** 중단 = **crontab 줄만 뺀다.** 파일도 락도 돌고 있는 세션도 건드리지 않는다 —
 *  물고 있는 티켓은 끝까지 가고 그 다음 tick이 없을 뿐이다(DESIGN.md §4 중단).
 *  false = 이미 미등록이었다(no-op이지 에러가 아니다).
 *
 *  이름은 경로로 조립하지 않는다 — `readdir`가 준 실제 워커 목록에서 찾는다. */
export async function stopWorker(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const w = (await listWorkers(root)).find((x) => x.name === name);
  if (!w) throw new Error(`${t(locale, "workers.manage.noSuchWorkerPrefix")} ${name}`);
  return unregisterCron(w.path, locale);
}

/** 재등록 = **crontab 줄만 다시 넣는다** (DESIGN.md §4 재등록). `중단`의 역방향이고 그것뿐이다 —
 *  파일은 이미 있고 락도 돌고 있는 세션도 안 건드린다. 등록은 생성이 쓰는 그 함수다.
 *  **파일이 없는 워커는 되살리지 않는다** — 목록에 없으면 그건 `생성`의 일이다.
 *
 *  true = 새로 넣었다 / false = 이미 등록돼 있었다(no-op). 판정이 `registerCron`의 반환값이
 *  아니라 **등록 전의 `cron`**인 이유: `cronRegister`는 있던 줄을 지우고 맨 뒤에 다시 넣으므로
 *  줄 뒤에 남의 잡이 있으면 텍스트는 바뀐다(`changed = true`). 그건 "등록돼 있지 않았다"가
 *  아니다 — 화면이 알려야 하는 사실은 `중단`과 대칭인 이쪽이다. */
export async function startWorker(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  const w = (await listWorkers(root)).find((x) => x.name === name);
  if (!w) throw new Error(`${t(locale, "workers.manage.noSuchWorkerPrefix")} ${name}`);
  await registerCron(w.path, locale);
  return !w.cron;
}

/** crontab 줄을 빼고 파일을 지운다 — **순서가 그렇다**(DESIGN.md §4 삭제). 뒤집으면 그 사이
 *  1분에 cron이 없는 파일을 실행한다. 해제가 실패하면 파일을 남기고 멈춘다: 절반 지워진
 *  상태(파일은 없는데 cron 줄은 남은)를 만들지 않는다. */
export async function deleteWorker(
  root: string,
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const file = await workerFile(root, name, locale);
  const w = (await listWorkers(root)).find((x) => x.name === name);
  if (!w) throw new Error(`${t(locale, "workers.manage.noSuchWorkerPrefix")} ${name}`);
  // running을 지우면 락과 돌고 있는 세션이 붕 뜬다 — 락은 남고 티켓은 .wip에 갇힌다.
  if (w.status === "running") {
    throw new Error(
      `${name}${t(locale, "workers.manage.busyMid1")}${w.lockPid ?? "?"}${t(locale, "workers.manage.busySuffix")}`,
    );
  }
  // `cronFailed`는 화면이 해제 명령어를 **이 실패에만** 보여주려고 본다. unlink가 실패한
  // 경우에 같은 명령을 권하면 이미 빠진 줄을 다시 빼라는 거짓 안내가 된다.
  await unregisterCron(w.path, locale).catch((e: Error) => {
    throw Object.assign(
      new Error(
        `${t(locale, "workers.manage.cronRemoveFailPrefix")} ${name} ${t(locale, "workers.manage.cronRemoveFailMid")} ${e.message} ${t(locale, "workers.manage.cronRemoveFailSuffix")}`,
      ),
      { cronFailed: true },
    );
  });
  await unlink(file);
}
