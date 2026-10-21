/** 오류 제보 본문 조립 (DESIGN.md §P513 결정 3 - 4). **`node:*`를 하나도 안 가져온다** - 데스크톱
 *  메인(P513-3)이 이 파일을 그대로 쓴다. 파일을 읽는 전송부는 `error-report-send.ts`다. */

export type ReportSource = "server" | "renderer" | "main";
export type ReportKind =
  | "uncaught"
  | "unhandled_rejection"
  | "request_error"
  | "boundary"
  | "child_exit"
  | "renderer_gone"
  | "ready_timeout";

export type ErrorReport = {
  v: 1;
  install_id: string;
  session_id: string;
  app_version: string;
  shell: "desktop" | "browser";
  source: ReportSource;
  kind: ReportKind;
  message: string;
  stack: string;
  raw: string;
  route?: string;
  at: string;
};

export const RAW_MAX_BYTES = 64 * 1024;
export const DEDUPE_MS = 10 * 60 * 1000;
export const HOURLY_CAP = 20;
const HOUR_MS = 60 * 60 * 1000;

/** 모든 문자열에서 홈 디렉터리 절대 경로를 `~`로 바꾼다(결정 3의 유일한 가공). */
export function scrubHome(s: string, home: string): string {
  if (!home || home === "/") return s;
  return s.split(home).join("~");
}

/** 64 KB를 넘으면 **앞을 자른다**(꼬리가 원인에 가깝다). UTF-8 바이트 기준이고 글자 중간에서 안 끊는다. */
export function tailBytes(s: string, max = RAW_MAX_BYTES): string {
  const buf = new TextEncoder().encode(s);
  if (buf.length <= max) return s;
  let start = buf.length - max;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++; // 연속 바이트에서 시작하지 않는다
  return new TextDecoder().decode(buf.subarray(start));
}

export type ReportInput = {
  source: ReportSource;
  kind: ReportKind;
  message: string;
  stack?: string;
  raw?: string;
  route?: string;
};
export type ReportContext = {
  installId: string;
  sessionId: string;
  appVersion: string;
  shell: "desktop" | "browser";
  home: string;
  now?: Date;
};

export function buildReport(i: ReportInput, c: ReportContext): ErrorReport {
  const s = (x: string) => scrubHome(x, c.home);
  const r: ErrorReport = {
    v: 1,
    install_id: c.installId,
    session_id: c.sessionId,
    app_version: c.appVersion,
    shell: c.shell,
    source: i.source,
    kind: i.kind,
    message: s(i.message),
    stack: s(i.stack ?? ""),
    raw: tailBytes(s(i.raw ?? "")),
    at: (c.now ?? new Date()).toISOString(),
  };
  if (i.route) r.route = s(i.route);
  return r;
}

/** 같은 지문은 10분에 한 번, 전체는 한 시간 20건. 메모리만 쓴다(프로세스가 죽으면 초기화).
 *  ponytail: 설치 단위가 아니라 프로세스 단위 상한이다. 재시작 폭주가 보이면 파일로 내린다. */
export function createLimiter(dedupeMs = DEDUPE_MS, cap = HOURLY_CAP) {
  const seen = new Map<string, number>();
  let sent: number[] = [];
  return (r: Pick<ErrorReport, "source" | "kind" | "message" | "stack">, now = Date.now()): boolean => {
    const key = [r.source, r.kind, r.message, r.stack.split("\n").find((l) => /^\s*at\s/.test(l)) ?? ""].join("\0");
    const last = seen.get(key);
    if (last !== undefined && now - last < dedupeMs) return false;
    sent = sent.filter((t) => now - t < HOUR_MS);
    if (sent.length >= cap) return false;
    seen.set(key, now);
    sent.push(now);
    return true;
  };
}
