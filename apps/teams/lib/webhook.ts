/** 답변 대기가 앱 밖으로 나간다 — 웹훅 한 방향 (DESIGN.md §0-10 §답변 대기가 앱 밖으로 나간다).
 *
 *  **새 판정은 0이다.** 무엇이 답변 대기인가는 `lib/projects.ts`의 `listAwaiting`(→ `isAwaiting`)
 *  하나다. 이 파일이 더하는 것은 셋뿐이다 — 주소가 사는 파일(`webhook.json`) · 그 주소로 보내는
 *  손(`postWebhook`) · 서버 쪽에서 델타를 한 번 더 세는 집합(`webhookTick`).
 *
 *  **화면은 0줄이다.** 설정 트리 노드는 별도 티켓(`5a437faa`)이 세운다 — 여기는 저장·전송 층. */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { t, type Locale } from "./i18n.ts";
import { listAwaiting, readLanguage, registryPath, type AwaitingItem } from "./projects.ts";

// ── 비밀값 — `~/.config/dira/webhook.json` 0600 (§비밀값) ──────────────────

/** 레지스트리·토큰·키맵과 **같은 디렉터리**다. `lib/auth.ts:16`과 같은 한 줄. */
export function webhookPath(): string {
  return path.join(path.dirname(registryPath()), "webhook.json");
}

type WebhookSettings = { url?: string };

/** 없음·깨짐·객체 아님 셋 다 `{}`다 — `analytics.ts`의 `readSettings`와 같은 관용구. */
async function readSettings(): Promise<WebhookSettings> {
  try {
    const o: unknown = JSON.parse(await readFile(webhookPath(), "utf8"));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as WebhookSettings) : {};
  } catch {
    return {};
  }
}

/** `lib/auth.ts`의 `saveToken`과 같은 벌 — `mode`는 새로 만들 때만 먹으므로 `chmod`를 같이 부른다. */
async function saveSettings(next: WebhookSettings): Promise<void> {
  const p = webhookPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await chmod(p, 0o600);
}

/** 없으면 `null` — **꺼진 상태가 기본이다**(§비용). */
export async function readWebhookUrl(): Promise<string | null> {
  const s = await readSettings();
  return typeof s.url === "string" && s.url ? s.url : null;
}

const MASK_ELLIPSIS = "…"; // `lib/auth.ts`의 `maskToken`과 같은 글리프 — 한 앱에 가림 표시가 하나다

/** §비주얼 §45 ⑪ (3) — 원문을 다시 안 그린다. 자르는 자리는 **자릿수가 아니라 구조**다: 스킴+
 *  호스트는 그대로, 경로-쿼리-프래그먼트는 한 조각으로 접고 **뒤 4자를 안 남긴다**(URL이
 *  하나라 구별할 상대가 없고 그 4자가 비밀의 끝이다). 경로가 없으면 접힘 표시를 안 붙인다. */
export function maskWebhookUrl(url: string): string {
  const m = /^(https:\/\/[^/?#]+)([/?#].*)?$/.exec(url);
  if (!m) return url; // `setWebhookUrl`이 `https://`만 통과시켜 방어적이다 — 실제로는 늘 매치한다
  const [, origin, rest] = m;
  return rest ? `${origin}/${MASK_ELLIPSIS}` : origin;
}

/** 빈 문자열은 끈다(키를 지운다) — 그 밖은 `https://`만 받는다. **거절되면 파일을 안 건드린다**
 *  (검증이 어떤 `fs` 호출보다 먼저다). 접두사 이후는 안 잰다(§주소와 형식 — SSRF 전제가 안 선다). */
export async function setWebhookUrl(raw: string): Promise<void> {
  const url = raw.trim();
  if (url && !/^https:\/\//i.test(url)) {
    throw new Error("https 주소만 저장할 수 있습니다.");
  }
  await saveSettings(url ? { url } : {});
}

// ── 주소와 형식 — 본문 한 벌, 키 다섯 (§주소와 형식) ─────────────────────────

export type WebhookPayload = { text: string; project: string; hash: string; title: string; at: string };

/** `text` 한 칸의 조립. `wrap`(자리표시자 하나)로는 셋을 못 담고, 여기 한 번뿐인 조합이라
 *  범용 치환기를 새로 만들지 않는다(`lib/i18n.ts`의 `wrap` 주석과 같은 판단) — 인라인 치환
 *  셋으로 끝낸다. */
export function webhookText(locale: Locale, item: Pick<AwaitingItem, "title" | "projectName" | "hash">): string {
  return t(locale, "webhook.text")
    .replace("{title}", item.title)
    .replace("{project}", item.projectName)
    .replace("{hash}", item.hash);
}

/** 순수 함수 — 하트비트 타이머 없이 판정 가능하다. 담지 않는 것(§주소와 형식 표): 티켓 본문 ·
 *  `## 질문` 절 · 큐 루트 · 페르소나·워커 이름 · `stem`. 이 다섯 칸이 전부다. */
export function webhookBody(locale: Locale, item: AwaitingItem, nowMs: number): WebhookPayload {
  return {
    text: webhookText(locale, item),
    project: item.project,
    hash: item.hash,
    title: item.title,
    at: new Date(nowMs).toISOString(),
  };
}

export async function postWebhook(url: string, payload: WebhookPayload): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── 델타 — 직전 집합과의 차집합만 (§델타는 이미 서 있다 · `apps/desktop/main.ts`의 `pollAwaiting`과 같은 관용구) ──

const keyOf = (i: Pick<AwaitingItem, "project" | "stem">): string => `${i.project}/${i.stem}`;

/** 순수 함수 — `seen === null`이면 아직 씨를 안 뿌린 것이라 **전부 조용히** 씹힌다(빈 `toSend`).
 *  `null`과 빈 `Set`(0건으로 이미 씨를 뿌렸다)을 섞지 않는다 — `main.ts`의 그 구분 그대로다. */
export function webhookDelta(
  items: AwaitingItem[],
  seen: Set<string> | null,
): { toSend: AwaitingItem[]; keys: Set<string> } {
  const keys = new Set(items.map(keyOf));
  const toSend = seen === null ? [] : items.filter((i) => !seen.has(keyOf(i)));
  return { toSend, keys };
}

// ── 하트비트 tick에 얹는 자리 — 새 타이머 0 (§누가 보내나) ───────────────────

type Globals = { __diraWebhookSeen?: Set<string> };
const g = globalThis as unknown as Globals;

/** 테스트 전용 — 모듈 메모리인 씨 뿌리기 상태를 초기화한다. */
export function resetWebhookSeenForTest(): void {
  delete g.__diraWebhookSeen;
}

/** `lib/machine-state.ts`의 `tickOnce`가 매 15초 부른다(§누가 보내나 — 새 타이머 0).
 *  **주소가 없으면 그 자리에서 돌아온다** — 큐를 안 훑는다(§비용). */
export async function webhookTick(nowMs: number = Date.now()): Promise<void> {
  const url = await readWebhookUrl();
  if (!url) return;

  const [items, locale] = await Promise.all([listAwaiting(), readLanguage()]);
  const { toSend, keys } = webhookDelta(items, g.__diraWebhookSeen ?? null);
  const first = g.__diraWebhookSeen === undefined;
  g.__diraWebhookSeen = keys;
  if (first) {
    console.log(`[dira] 웹훅 답변 대기 ${keys.size}건으로 씨를 뿌렸습니다 (전송 안 함)`);
    return;
  }

  for (const item of toSend) {
    // 한 사건에 한 번이다 — 실패해도 위에서 이미 `keys`에 들어갔으므로 재시도되지 않는다(§실패).
    await postWebhook(url, webhookBody(locale, item, nowMs)).catch((e: Error) => {
      const host = new URL(url).host;
      console.error(`[dira] 웹훅 실패: ${host} ${e.message}`);
    });
  }
}

// ── 테스트 보내기 — 델타 집합을 안 건드린다 (§0-10 §화면) ────────────────────

/** 답변 대기가 0건인 큐에서도 눌리는 것이 요건이다 — 자리표시 한 벌. */
const PLACEHOLDER_ITEM: AwaitingItem = { project: "-", projectName: "-", stem: "-", hash: "-", title: "-" };

export type WebhookTestResult = { ok: true } | { ok: false; host: string; reason: string };

/** `테스트 보내기` — 값은 그 순간의 답변 대기 첫 건, 0건이면 자리표시(위)다. **델타 집합
 *  (`g.__diraWebhookSeen`)을 안 건드린다** — 실제 사건을 봤다고 적으면 그 사건이 영영 안
 *  나간다(§0-10 §화면). 주소가 없으면 부르지 않는 것이 화면의 계약이라 여기서는 방어만 한다. */
export async function testSendWebhook(): Promise<WebhookTestResult> {
  const url = await readWebhookUrl();
  if (!url) return { ok: false, host: "", reason: "no address" };

  const [items, locale] = await Promise.all([listAwaiting(), readLanguage()]);
  const item = items[0] ?? PLACEHOLDER_ITEM;
  try {
    await postWebhook(url, webhookBody(locale, item, Date.now()));
    return { ok: true };
  } catch (e) {
    return { ok: false, host: new URL(url).host, reason: (e as Error).message };
  }
}
