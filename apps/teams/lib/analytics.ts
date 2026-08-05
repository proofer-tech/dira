/** 사용 통계 — GA4 Measurement Protocol 전송 층 (DESIGN.md §0-11).
 *
 *  **이 파일이 규칙의 유일한 자리다.** 세션 정의 · 자격값 읽기 · 끄기 판정 · 익명 규칙이 전부
 *  `track()` 안 한 곳에서 판정된다 — 트리거 자리 8곳에 `if (enabled)`를 흩뿌리면 하나가 조용히
 *  규칙 밖으로 나간다(§0-11 §끄는 자리).
 *
 *  **`gtag.js`를 쓰지 않는다.** 렌더러는 `window.dira.pickPath`가 노출된 신뢰 경계라 원격 JS를
 *  들이지 않는다(§데스크톱 앱 못박는 것 4) — 서버가 직접 POST한다.
 *
 *  **던지지 않고 기다리지 않는다.** `track()`은 절대 reject하지 않는 Promise를 주고 호출자는
 *  await하지 않는다(반환값을 준 이유는 하나 — 테스트가 전송을 관찰할 수 있어야 한다). */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registryPath } from "./projects.ts";
import type { Screen } from "./urls.ts";
// 타입만 가져온다(컴파일에 지워진다) — `workers.ts`의 `node:fs`가 여기 붙지 않는다.
import type { EngineId } from "./workers.ts";

/** 레지스트리·토큰·키맵과 **같은 디렉터리**다(엔진의 `$LOCAL`). `lib/auth.ts:16`과 같은 한 줄.
 *  **`.dira` 안이 아니다** — 머신당 하나이고 큐를 오염시키지 않는다(§0-11 사용자 세션 표). */
export function analyticsPath(): string {
  return path.join(path.dirname(registryPath()), "analytics.json");
}

// ── 이벤트 표 (§0-11 §이벤트 컨벤션) ────────────────────────────────────────
//
// **이 타입이 표를 닫는다.** 표 밖의 이름·파라미터는 컴파일이 거부한다. GA4는 모르는 이름도
// 받아 주므로 타입이 막지 않으면 화면에 조용히 쌓인다. 늘리려면 §0-11 표를 먼저 고친다.

// `Screen`과 경로 → enum 매핑(`screenOf`)은 `urls.ts`에 산다 — 그것을 부르는 쪽이 클라이언트다.

export type Events = {
  app_open: { app_version: string; shell: "desktop" | "browser" };
  screen_view: { screen: Screen };
  project_add: { method: "create" | "register" };
  /** `engine`은 **카탈로그의 `EngineId` 그대로**이고 `other`가 표 밖(손으로 쓴 값)을 받는다.
   *  이름을 여기 다시 적지 않는 이유가 §4-3 개정이다 — 셋째 엔진을 `기타`로 접으면 계측이
   *  그 회차를 못 본다. `ENGINES`에 한 벌이 늘면 이 유니온이 저절로 는다. */
  worker_create: { engine: EngineId | "other"; cron_ok: boolean };
  ticket_create: { kind: "work" | "request" | "feedback" };
  answer_submit: Record<string, never>;
  feedback_submit: Record<string, never>;
  analytics_off: Record<string, never>;
};

export type EventName = keyof Events;

// ── 자격값 (§0-11 §자격값) ──────────────────────────────────────────────────
//
// 읽기만 한다. env로 넣는 것은 `apps/desktop/main.ts`고(`252fd905`), **값이 없으면 아무것도 안
// 보낸다** — `pnpm dev`와 손으로 빌드한 `.app`의 정상 상태다(우리 세션이 통계를 오염시키지 않는다).
// 모듈 로드 시점에 굳히지 않는다: 서버가 켜진 뒤 env가 바뀌는 일은 없지만, 굳히면 테스트가
// import 순서에 매달린다.

function credentials(): { id: string; secret: string } | null {
  const id = process.env.GA_MEASUREMENT_ID;
  const secret = process.env.GA_API_SECRET;
  return id && secret ? { id, secret } : null;
}

/** `app_open`의 두 파라미터. 버전을 넘기는 것은 데스크톱 셸뿐이라 그 유무가 곧 셸 판정이다.
 *  **§0-12 의견 폼의 `버전` 줄도 이 함수를 쓴다** — 자리마다 `process.env`를 다시 읽으면
 *  이슈에 적히는 셸 이름과 GA의 셸 이름이 갈린다. */
export function shellParams(): Events["app_open"] {
  const v = process.env.DIRA_APP_VERSION;
  return { app_version: v || "dev", shell: v ? "desktop" : "browser" };
}

// ── 파일 — 사는 키는 `install_id`·`enabled` 둘뿐이다 ────────────────────────

type Settings = { install_id?: string; enabled?: boolean };

/** 던지지 않는다. 없음·깨짐·객체 아님 셋 다 `{}`다 — 통계 파일 하나가 화면을 못 막는다. */
async function readSettings(): Promise<Settings> {
  try {
    const o: unknown = JSON.parse(await readFile(analyticsPath(), "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Settings) : {};
  } catch {
    return {};
  }
}

/** `writeKeymap`과 같은 벌이다(읽은 것 위에 덮어쓰기 + `mkdir -p`).
 *  ponytail: 첫 이벤트 둘이 동시에 오면 `install_id`를 각자 만들어 뒤엣것이 이긴다 — 설치당
 *  한 번, 최악이 통계 한 건의 client_id가 갈리는 것이라 락을 두지 않는다. */
async function saveSettings(next: Settings): Promise<void> {
  const p = analyticsPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(next, null, 2) + "\n", "utf8");
}

async function installId(s: Settings): Promise<string> {
  if (typeof s.install_id === "string" && s.install_id) return s.install_id;
  const id = randomUUID();
  await saveSettings({ ...s, install_id: id });
  return id;
}

/** `설정` 다이얼로그 세 번째 섹션이 그리는 두 사실(§0-11 §끄는 자리 ①).
 *  `configured: false`면 켜짐/꺼짐과 무관하게 아무것도 안 나간다. */
export async function readAnalytics(): Promise<{ configured: boolean; enabled: boolean }> {
  return { configured: credentials() !== null, enabled: (await readSettings()).enabled !== false };
}

/** 기본이 켜짐이므로 **끈 사실만 파일에 남는다**(§0-6 키맵의 "바꾼 것만"과 같은 규칙).
 *  `analytics_off`를 여기서 보내지 않는다 — 끄기 **직전**에 보내는 것은 부르는 쪽의 순서다. */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  const s = await readSettings();
  if (enabled) delete s.enabled;
  else s.enabled = false;
  await saveSettings(s);
}

// ── 사용자 세션 — 파일에 안 쓴다 (§0-11 사용자 세션 표) ─────────────────────
//
// 서버 프로세스 메모리가 곧 "이 앱 실행"이다(자식 서버는 앱보다 오래 살지 않는다). 30분은
// GA4의 기본 세션 창 — 트레이 상주 앱에서 프로세스 수명을 그대로 세면 며칠짜리 세션 하나가 뜬다.

const SESSION_MS = 30 * 60 * 1000;
let sid = "";
let sidAt = 0;
let openPending = false;

/** 만료됐으면 새로 난다. **새로 난 세션의 첫 이벤트 앞에는 `app_open`이 붙는다**(아래 `track`).
 *  ponytail: `sessionIdentity()`(§0-12 폼)의 조회도 `sidAt`을 민다 — 그래야 폼을 다시 그릴 때
 *  id가 바뀌지 않는다. 이벤트만 도는 정상 경로에서는 "마지막 이벤트로부터 30분" 그대로다. */
function session(now: number): string {
  if (!sid || now - sidAt > SESSION_MS) {
    sid = String(now);
    openPending = true;
  }
  sidAt = now;
  return sid;
}

/** §0-12 의견 이슈에 실리는 두 값. **통계를 껐어도 준다** — 이 값은 GA로 나가는 게 아니라
 *  사람이 자기 손으로 여는 공개 이슈에 붙고, 폼이 그것을 보여 준 뒤다(§0-12). */
export async function sessionIdentity(): Promise<{ installId: string; sessionId: string }> {
  return { installId: await installId(await readSettings()), sessionId: session(Date.now()) };
}

// ── 전송 ────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://www.google-analytics.com/mp/collect";

/** GA4가 세션·활성 사용자를 세는 최소값. 화면 체류를 재지 않는다(익명 규칙과 무관한 상수다). */
const ENGAGEMENT_MS = 100;

async function post(
  cred: { id: string; secret: string },
  clientId: string,
  sessionId: string,
  name: EventName,
  params: Record<string, unknown>,
): Promise<void> {
  const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(cred.id)}&api_secret=${encodeURIComponent(cred.secret)}`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      events: [{ name, params: { ...params, session_id: sessionId, engagement_time_msec: ENGAGEMENT_MS } }],
    }),
    signal: AbortSignal.timeout(5_000),
  });
}

/** 이벤트 하나를 보낸다. **안 보내는 조건 셋이 전부 여기서 판정된다** — 자격값 없음 ·
 *  `enabled: false` · 전송 실패. 셋 다 조용하다: 던지지 않고, 재시도 큐도 없다
 *  (통계 한 건이 그만큼의 값이 없다).
 *
 *  호출자는 `await`하지 않는다 — 전송 실패·타임아웃·오프라인이 화면의 어떤 동작도 못 막는다.
 *  **서버 액션이 `void track(...)`로 먼저 반환해도 POST는 끝까지 나간다**(실측 `b808993d`:
 *  `feedbackSubmitAction`에서 새 세션 첫 이벤트 — `app_open` + `feedback_submit` 둘 다 관찰). */
export async function track<N extends EventName>(name: N, params: Events[N]): Promise<void> {
  try {
    const cred = credentials();
    if (!cred) return;
    const s = await readSettings();
    if (s.enabled === false) return;

    const now = Date.now();
    const sessionId = session(now);
    const clientId = await installId(s);

    // 세션의 시작은 언제나 `app_open`이다. 한 요청에 두 이벤트를 담지 않는다 —
    // timestamp가 같아지면 GA4 유입경로에서 둘의 선후가 흐려진다.
    if (openPending) {
      openPending = false;
      if (name !== "app_open") await post(cred, clientId, sessionId, "app_open", shellParams());
    }
    await post(cred, clientId, sessionId, name, params);
  } catch {
    // 실패는 조용히 버린다(§0-11 §어떻게 보내나).
  }
}

/** 테스트 전용 — 모듈 메모리인 세션을 초기 상태로 돌린다. 프로덕션 경로에서 부르지 않는다. */
export function resetSessionForTest(): void {
  sid = "";
  sidAt = 0;
  openPending = false;
}
