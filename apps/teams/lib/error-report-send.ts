/** 오류 제보 전송 (DESIGN.md §P513 결정 1 - 2 - 4). 켜는 조건은 사용 통계와 같다 - `readAnalytics()`가
 *  `configured && enabled`일 때만 `fetch`가 불린다. 던지지 않고, 실패는 버리고, 제보 코드 안의 예외는
 *  다시 제보하지 않는다. */
import os from "node:os";
import { readAnalytics, sessionIdentity, shellParams } from "./analytics.ts";
import { buildReport, createLimiter, type ReportInput } from "./error-report.ts";

const DEFAULT_URL = "https://dira.vercel.app/api/error-report"; // ponytail: 프로덕션 도메인 확정 전 자리. DIRA_ERROR_REPORT_URL로 바꾼다
const RAW_LINES = 200;

let limiter = createLimiter();
let inReport = false;

/** 서버 프로세스 stderr - stdout 최근 200줄(결정 3 `raw`). `instrumentation`이 한 번 켠다. */
const tail: string[] = [];
let tapped = false;
export function tapProcessOutput(): void {
  if (tapped) return;
  tapped = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      try {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
        for (const line of text.split("\n")) if (line) tail.push(line);
        if (tail.length > RAW_LINES) tail.splice(0, tail.length - RAW_LINES);
      } catch {}
      return write(chunk, ...rest);
    }) as typeof stream.write;
  }
}

export async function reportError(input: ReportInput): Promise<void> {
  if (inReport) return; // 재귀 금지
  inReport = true;
  try {
    const { configured, enabled } = await readAnalytics();
    if (!configured || !enabled) return;
    const { installId, sessionId } = await sessionIdentity();
    const { app_version, shell } = shellParams();
    const body = buildReport(
      { raw: input.source === "server" ? tail.join("\n") : "", ...input },
      { installId, sessionId, appVersion: app_version, shell, home: os.homedir() },
    );
    if (!limiter(body)) return;
    await fetch(process.env.DIRA_ERROR_REPORT_URL || DEFAULT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // 전송 실패는 조용히 버린다(결정 4).
  } finally {
    inReport = false;
  }
}

/** 브라우저가 서버 액션으로 보낸 오류다 - 입력은 신뢰하지 않으므로 모양을 본다. */
export async function reportRendererError(input: {
  kind: string;
  message: string;
  stack?: string;
  raw?: string;
}): Promise<void> {
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const kind = input?.kind === "unhandled_rejection" || input?.kind === "boundary" ? input.kind : "uncaught";
  await reportError({
    source: "renderer",
    kind,
    message: str(input?.message),
    stack: str(input?.stack),
    raw: str(input?.raw),
  });
}

/** 테스트 전용. */
export function resetReportForTest(): void {
  limiter = createLimiter();
  inReport = false;
  tail.length = 0;
}
export function pushTailForTest(line: string): void {
  tail.push(line);
}

function errParts(e: unknown): { message: string; stack: string } {
  return e instanceof Error ? { message: e.message, stack: e.stack ?? "" } : { message: String(e), stack: "" };
}

export function installProcessHandlers(): void {
  process.on("uncaughtException", (e) => void reportError({ source: "server", kind: "uncaught", ...errParts(e) }));
  process.on("unhandledRejection", (e) =>
    void reportError({ source: "server", kind: "unhandled_rejection", ...errParts(e) }));
}
