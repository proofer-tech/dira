/** 메인 프로세스 오류 제보 (DESIGN.md §P513 결정 1 - 3 - 4). 본문 조립 - `~` 치환 - 지문 묶기는
 *  `apps/teams/lib/error-report.ts`를 그대로 쓰고(`lib`로 받는다 - 패키징 때 위치가 달라서 main이 로드한다),
 *  여기는 켜는 조건과 전송만 한다. 던지지 않고, 실패는 버리고, 재시도하지 않는다. */
import { readFile } from "node:fs/promises";

type Lib = typeof import("../teams/lib/error-report.ts");

export type MainReportInput = {
  kind: "child_exit" | "renderer_gone" | "ready_timeout";
  message: string;
  stack?: string;
  /** 자식 서버 `stderr` 전체 + `stdoutTail`. */
  raw: string;
};

export type MainReporterDeps = {
  lib: Lib;
  home: string;
  /** `~/.config/dira/analytics.json` - `enabled`와 `install_id`를 읽는다. */
  analyticsFile: string;
  /** 자격값이 짝으로 있는지(ga.json). 없으면 아무것도 안 나간다. */
  configured: () => boolean;
  appVersion: string;
  sessionId: string;
  url: string;
  fetchFn?: typeof fetch;
};

export function createMainReporter(d: MainReporterDeps) {
  const limiter = d.lib.createLimiter();
  let inReport = false;
  return async function report(i: MainReportInput): Promise<void> {
    if (inReport) return; // 재귀 금지
    inReport = true;
    try {
      if (!d.configured()) return;
      let s: { enabled?: boolean; install_id?: string } = {};
      try {
        s = JSON.parse(await readFile(d.analyticsFile, "utf8")) ?? {};
      } catch {}
      if (s.enabled === false) return;
      const body = d.lib.buildReport(
        { source: "main", ...i },
        {
          installId: typeof s.install_id === "string" && s.install_id ? s.install_id : "unknown",
          sessionId: d.sessionId,
          appVersion: d.appVersion,
          shell: "desktop",
          home: d.home,
        },
      );
      if (!limiter(body)) return;
      await (d.fetchFn ?? fetch)(d.url, {
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
  };
}
