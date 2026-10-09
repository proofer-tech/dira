/** 프로젝트 환경변수 관리 브리지 클라이언트 (DESIGN.md §프로젝트 환경변수 요구 04daa929).
 *
 *  서버에서만 쓴다. 연결 정보(`DIRA_ENV_BRIDGE_URL` · `DIRA_ENV_BRIDGE_TOKEN`)는 데스크톱이 서버
 *  프로세스 env로 넣는 값이고 렌더러로 나가지 않는다. 응답에서 `{name, updatedAt, revision}`만
 *  골라 내고 오류는 고정 코드로만 돌려주므로, 브리지가 무엇을 실어 보내도 값이 화면에 닿지 않는다.
 *  `node:*` import는 없다 — 이름 검증은 클라이언트도 부른다(서버 검증이 정본이다). */

export type EnvItem = { name: string; updatedAt: string; revision: string };

export type EnvErrorCode =
  | "invalid-name"
  | "reserved"
  | "invalid-value"
  | "duplicate"
  | "conflict"
  | "not-found"
  | "locked"
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

const CODES: ReadonlySet<string> = new Set([
  "invalid-name", "reserved", "invalid-value", "duplicate", "conflict", "not-found", "locked", "unavailable",
]);

function pickItem(x: unknown): EnvItem | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.name !== "string" || typeof o.updatedAt !== "string" || typeof o.revision !== "string") return null;
  return { name: o.name, updatedAt: o.updatedAt, revision: o.revision };
}

type Op =
  | { op: "list" }
  | { op: "create"; name: string; value: string }
  | { op: "replace"; name: string; value: string; expectedRevision: string }
  | { op: "delete"; name: string; expectedRevision: string };

/** 한 번의 브리지 호출. 연결 설정이 없거나 응답이 계약을 어기면 `unavailable`이다 —
 *  목록이 빈 것으로 오인되지 않는다. `fetchImpl`은 시험이 주입한다. */
export async function callEnvBridge(
  root: string,
  op: Op,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<EnvResult<EnvItem[] | EnvItem>> {
  const url = env.DIRA_ENV_BRIDGE_URL;
  const token = env.DIRA_ENV_BRIDGE_TOKEN;
  if (!url || !token) return { ok: false, code: "unavailable" };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...op, root }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json()) as { ok?: boolean; code?: string; items?: unknown; item?: unknown };
    if (body.ok === false) {
      return { ok: false, code: CODES.has(body.code ?? "") ? (body.code as EnvErrorCode) : "unavailable" };
    }
    if (body.ok !== true) return { ok: false, code: "unavailable" };
    if (op.op === "list") {
      if (!Array.isArray(body.items)) return { ok: false, code: "unavailable" };
      const items = body.items.map(pickItem);
      if (items.some((i) => !i)) return { ok: false, code: "unavailable" };
      return { ok: true, data: items as EnvItem[] };
    }
    if (op.op === "delete") return { ok: true, data: pickItem(body.item) ?? { name: op.name, updatedAt: "", revision: "" } };
    const item = pickItem(body.item);
    return item ? { ok: true, data: item } : { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
