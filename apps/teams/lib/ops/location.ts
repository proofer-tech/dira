/** 실행기 위치 파일 `$TICKET_LOCAL/ops.json`(P559 결정 4). 나중에 기동한 쪽이 덮는다.
 *  개발 서버는 `instrumentation.ts`가, 설치본은 `apps/desktop/main.ts`가 부른다. */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDir } from "../paths.ts";

export async function writeOpsJson(argv: string[], env: Record<string, string> = {}): Promise<string> {
  const dir = localDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "ops.json");
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, argv, env }) + "\n");
  await rename(tmp, file); // 읽는 쪽이 반쯤 쓴 파일을 보지 않는다
  return file;
}
