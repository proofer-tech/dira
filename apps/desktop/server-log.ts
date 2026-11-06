// 자식 서버 크래시 기록(P550 결정 1-2). 순수 판정은 여기, 파일 입출력은 얇게 감싸 main이 쓴다.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXIT_TAIL_BYTES = 64 * 1024;
export const EXIT_LOG_MAX = 1024 * 1024;
export const EXIT_LOG_KEEP = 512 * 1024;
export const REPORTS_KEEP = 10;

/** 지워야 할 보고서 이름. 이름은 `report.<날짜>...json`이라 mtime이 오래된 순으로 지운다. */
export function reportsToDelete(files: { name: string; mtimeMs: number }[], keep = REPORTS_KEEP): string[] {
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(keep).map((f) => f.name);
}

/** 뒤쪽 `keep` 바이트만 남긴다. 한도 이하면 그대로다. 잘린 첫 줄은 깨졌을 수 있어 줄 경계로 맞춘다. */
export function trimLog(buf: Buffer, max = EXIT_LOG_MAX, keep = EXIT_LOG_KEEP): Buffer {
  if (buf.length <= max) return buf;
  const tail = buf.subarray(buf.length - keep);
  const nl = tail.indexOf(0x0a);
  return nl >= 0 ? tail.subarray(nl + 1) : tail;
}

/** 보고서 디렉터리를 만들고 최신 10개만 남긴다. */
export function prepareReportDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir)
    .filter((n) => n.startsWith("report.") && n.endsWith(".json"))
    .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
  for (const n of reportsToDelete(files)) rmSync(join(dir, n), { force: true });
}

/** `<ISO 시각> code=<..>` 한 줄과 stderr 꼬리를 덧붙이고, 1 MB를 넘으면 뒤쪽 512 KB만 남긴다. */
export function appendExitLog(file: string, code: string, raw: string, now = new Date()): void {
  const tail = Buffer.from(raw).subarray(-EXIT_TAIL_BYTES).toString();
  appendFileSync(file, `${now.toISOString()} code=${code}\n${tail}\n`);
  const buf = readFileSync(file);
  const t = trimLog(buf);
  if (t !== buf) writeFileSync(file, t);
}
