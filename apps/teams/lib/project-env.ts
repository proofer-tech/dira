/** 프로젝트 환경변수 관리 브리지 클라이언트 (DESIGN.md §프로젝트 환경변수 요구 04daa929).
 *
 *  서버에서만 쓴다. 연결 정보(`DIRA_ENV_BRIDGE_URL` · `DIRA_ENV_BRIDGE_SECRET`)는 데스크톱이 서버
 *  프로세스 env로 넣는 값이고 렌더러로 나가지 않는다. 응답에서 `{name, updatedAt, revision}`만
 *  골라 내고 오류는 고정 코드로만 돌려주므로, 브리지가 무엇을 실어 보내도 값이 화면에 닿지 않는다.
 *  `node:*` import는 없다 — 이름 검증은 클라이언트도 부른다(서버 검증이 정본이다). */

export type SyncKind = "synced" | "pending" | "conflict" | "reenter";
export type EnvItem = { name: string; updatedAt: string; revision: string; sync?: { kind: SyncKind; side?: "dira" | "vercel" } };
/** Vercel에만 있거나 가져오지 않는 이름. 값은 없다. */
export type VercelOnlyItem = { name: string; kind: "vercel_only" | "skipped"; reason?: string };
export type VercelMeta = { lastSyncAt: string | null; deployPending: boolean };

export type EnvErrorCode =
  | "invalid-name"
  | "reserved"
  | "invalid-value"
  | "duplicate"
  | "conflict"
  | "not-found"
  | "locked"
  | "corrupt"
  | "unavailable";

export type EnvResult<T> = { ok: true; data: T } | { ok: false; code: EnvErrorCode };

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ENV_VALUE_MAX = 64 * 1024;
const RESERVED_RE = /^(PATH|HOME|SHELL|ENV|BASH_ENV|NODE_OPTIONS|PYTHONPATH|LD_.*|DYLD_.*|TICKET_.*|DIRA_.*)$/;

/** ENV-3 순서의 앞 두 검증 — 이름 형식, 예약 이름. */
export function validateEnvName(name: string): "invalid-name" | "reserved" | null {
  if (!ENV_NAME_RE.test(name)) return "invalid-name";
  return RESERVED_RE.test(name) ? "reserved" : null;
}

/** 값은 빈 문자열과 줄바꿈을 보존한다. NUL 거부, 항목당 64 KiB(UTF-8 바이트). */
export function validateEnvValue(value: string): "invalid-value" | null {
  if (value.includes("\0")) return "invalid-value";
  return new TextEncoder().encode(value).length > ENV_VALUE_MAX ? "invalid-value" : null;
}

/** 브리지가 보내는 밑줄 코드 -> 화면 코드. 표에 없는 코드(`bad_project` `io` 등)는 `unavailable`이다. */
const BRIDGE_CODES: Record<string, EnvErrorCode> = {
  invalid_name: "invalid-name",
  reserved_name: "reserved",
  invalid_value: "invalid-value",
  too_large: "invalid-value",
  duplicate: "duplicate",
  conflict: "conflict",
  not_found: "not-found",
  locked: "locked",
  corrupt: "corrupt",
};

function pickItem(x: unknown): EnvItem | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.name !== "string" || typeof o.updatedAt !== "string" || typeof o.revision !== "string") return null;
  const k = (o.sync as { kind?: unknown; side?: unknown } | undefined)?.kind;
  const side = (o.sync as { side?: unknown } | undefined)?.side;
  const sync: EnvItem["sync"] = typeof k === "string" && ["synced", "pending", "conflict", "reenter"].includes(k)
    ? { kind: k as SyncKind, ...(side === "dira" ? { side: "dira" as const } : side === "vercel" ? { side: "vercel" as const } : {}) }
    : undefined;
  return { name: o.name, updatedAt: o.updatedAt, revision: o.revision, ...(sync ? { sync } : {}) };
}

function pickOnly(x: unknown): VercelOnlyItem[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((e) => {
    const o = e as Record<string, unknown> | null;
    if (!o || typeof o.name !== "string" || (o.kind !== "vercel_only" && o.kind !== "skipped")) return [];
    return [{ name: o.name, kind: o.kind, ...(typeof o.reason === "string" ? { reason: o.reason } : {}) }];
  });
}

type Op =
  | { op: "list" }
  | { op: "create"; name: string; value: string }
  | { op: "replace"; name: string; value: string; expectedRevision: string }
  | { op: "delete"; name: string; expectedRevision: string };

/** 프로젝트 키 - `apps/desktop/env-store.ts`의 `resolveProject`와 같은 계산이다(패리티 시험이 고정한다). */
async function projectKey(root: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const real = (await realpath(root)).normalize("NFC");
  return createHash("sha256").update(real).digest("hex").slice(0, 32);
}

/** 한 번의 브리지 호출. 연결 설정이 없거나 응답이 계약을 어기면 `unavailable`이다 -
 *  목록이 빈 것으로 오인되지 않는다. 토큰은 secret에서 프로젝트마다 파생한다(HMAC-SHA256(secret, 키)).
 *  `fetchImpl`은 시험이 주입한다. */
export async function callEnvBridge(
  root: string,
  op: Op,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<EnvResult<EnvItem[] | EnvItem>> {
  const r = await callEnvBridgeFull(root, op, fetchImpl, env);
  return r.ok && op.op === "list" ? { ok: true, data: (r.data as { items: EnvItem[] }).items } : (r as EnvResult<EnvItem[] | EnvItem>);
}

/** list는 Vercel 연동 필드(`vercelOnly` `vercel`)까지 돌려준다. 그 밖의 연산은 `callEnvBridge`와 같다. */
export async function callEnvBridgeFull(
  root: string,
  op: Op,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<EnvResult<unknown>> {
  const base = env.DIRA_ENV_BRIDGE_URL;
  const secret = env.DIRA_ENV_BRIDGE_SECRET;
  if (!base || !secret) return { ok: false, code: "unavailable" };
  try {
    const { createHmac } = await import("node:crypto");
    const token = createHmac("sha256", secret).update(await projectKey(root)).digest("hex");
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const init: RequestInit = { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" };
    let target = `${base}/env/v1/${op.op}`;
    if (op.op === "list") target += `?project=${encodeURIComponent(root)}`;
    else {
      const { op: _op, ...rest } = op;
      init.method = "POST";
      headers["content-type"] = "application/json";
      init.body = JSON.stringify({ ...rest, project: root });
    }
    const res = await fetchImpl(target, init);
    const body = (await res.json()) as { error?: string; items?: unknown; vercelOnly?: unknown; vercel?: { lastSyncAt?: unknown; deployPending?: unknown } };
    if (!res.ok) return { ok: false, code: BRIDGE_CODES[body.error ?? ""] ?? "unavailable" };
    if (op.op === "list") {
      if (!Array.isArray(body.items)) return { ok: false, code: "unavailable" };
      const items = body.items.map(pickItem);
      if (items.some((i) => !i)) return { ok: false, code: "unavailable" };
      const v = body.vercel;
      const vercel: VercelMeta | null = v ? { lastSyncAt: typeof v.lastSyncAt === "string" ? v.lastSyncAt : null, deployPending: v.deployPending === true } : null;
      return { ok: true, data: { items: items as EnvItem[], vercelOnly: pickOnly(body.vercelOnly), vercel } };
    }
    const item = pickItem(body);
    return item ? { ok: true, data: item } : { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** 목록을 새로 읽는 데 성공한 뒤 화면에 남을 안내. 충돌 뒤 재읽기(`keep`)는 방금 낸 안내를 지키고,
 *  그 밖의 읽기는 지운다 - 안내는 다음 사용자 동작이나 닫힘에서 지워진다. */
export function codeAfterList(prev: EnvErrorCode | null, keep: boolean): EnvErrorCode | null {
  return keep ? prev : null;
}

// ── Vercel 연동 줄 (요구 6f610c77, DESIGN.md §Vercel 환경변수 연동 §화면) ──

export type VercelCandidate = { teamId: string | null; projectId: string; name: string };
/** 줄의 다섯 상태 중 서버가 정하는 넷 + 후보 선택. "연결 중"은 화면이 요청 중에만 갖는 상태다. */
export type VercelView =
  | { state: "unlinked" }
  | { state: "login_required" }
  | { state: "connected"; name: string; teamId: string | null }
  | { state: "choose"; candidates: VercelCandidate[] }
  | { state: "error"; code: "unavailable" | "locked" | "io" };
export type VercelTokenCode = "rejected" | "invalid" | "locked" | "unavailable";

/** 브리지 응답 -> 줄 상태. 토큰이나 값이 섞여 와도 고른 필드만 나간다. */
export function pickVercelView(b: unknown): VercelView {
  const o = b as Record<string, unknown> | null;
  const proj = o?.project as Record<string, unknown> | undefined;
  switch (o?.state) {
    case "login_required":
      return { state: "login_required" };
    case "unlinked":
      return { state: "unlinked" };
    case "connected":
      return typeof proj?.name === "string"
        ? { state: "connected", name: proj.name, teamId: typeof proj.teamId === "string" ? proj.teamId : null }
        : { state: "error", code: "unavailable" };
    case "choose": {
      const c = Array.isArray(o.candidates) ? o.candidates : [];
      return {
        state: "choose",
        candidates: c.flatMap((x: Record<string, unknown>) =>
          typeof x?.projectId === "string" && typeof x?.name === "string"
            ? [{ teamId: typeof x.teamId === "string" ? x.teamId : null, projectId: x.projectId, name: x.name }]
            : [],
        ),
      };
    }
    default:
      return { state: "error", code: "unavailable" };
  }
}

type VercelOp =
  | { op: "status" }
  | { op: "connect"; projectId?: string }
  | { op: "disconnect" }
  | { op: "sync" }
  | { op: "redeploy" }
  | { op: "token"; token: string | null };

/** 브리지의 `vercel/*` 한 번 호출. 상태 코드와 JSON 본문만 돌려주고, 연결 설정이 없거나 통신이 깨지면 null이다. */
export async function callVercelBridge(
  root: string,
  v: VercelOp,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<{ status: number; body: unknown } | null> {
  const base = env.DIRA_ENV_BRIDGE_URL;
  const secret = env.DIRA_ENV_BRIDGE_SECRET;
  if (!base || !secret) return null;
  try {
    const { createHmac } = await import("node:crypto");
    const token = createHmac("sha256", secret).update(await projectKey(root)).digest("hex");
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const init: RequestInit = { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" };
    let target = `${base}/env/v1/vercel/${v.op}`;
    if (v.op === "status") target += `?project=${encodeURIComponent(root)}`;
    else {
      const { op: _op, ...rest } = v;
      init.method = "POST";
      headers["content-type"] = "application/json";
      init.body = JSON.stringify({ ...rest, project: root });
    }
    const res = await fetchImpl(target, init);
    return { status: res.status, body: await res.json() };
  } catch {
    return null;
  }
}

/** 줄 상태 -> 화면 키. 다섯 상태: 연결 안 됨 / 연결 중 / 연결됨 / 로그인 필요 / 오류. */
export function vercelLineKey(view: VercelView | null, busy: boolean): "unlinked" | "connecting" | "connected" | "login" | "error" | "choose" {
  if (busy) return "connecting";
  if (!view) return "connecting";
  switch (view.state) {
    case "unlinked": return "unlinked";
    case "connected": return "connected";
    case "login_required": return "login";
    case "choose": return "choose";
    default: return "error";
  }
}

/** 변수 행의 동기화 표시 키(맞음 / 반영 대기 / 충돌 안내 / Vercel에만 있음 / 가져오지 않음). 연결 전이면 null이다. */
export function rowMarkKey(r: EnvItem | VercelOnlyItem): "synced" | "pending" | "conflict" | "reenter" | "vercelOnly" | "skipped" | null {
  if ("kind" in r) return r.kind === "skipped" ? "skipped" : "vercelOnly";
  return r.sync ? r.sync.kind : null;
}
