/** 설치본이 쓰는 실행기 위치 파일 `$TICKET_LOCAL/ops.json`(P559 결정 4). 형식은 teams `lib/ops/location.ts`와 같다. */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 설치본의 위치 파일 내용. Electron 실행 파일을 Node로 쓰려면 `ELECTRON_RUN_AS_NODE`가 필요하다. */
export function packagedOps(execPath: string, resourcesPath: string) {
  return { version: 1, argv: [execPath, join(resourcesPath, "server", "lib", "ops", "cli.ts")], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** 임시 파일에 쓰고 rename한다. 읽는 쪽이 반쯤 쓴 파일을 보지 않는다. */
export function writePackagedOps(local: string, execPath: string, resourcesPath: string): string {
  mkdirSync(local, { recursive: true });
  const file = join(local, "ops.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(packagedOps(execPath, resourcesPath)) + "\n");
  renameSync(tmp, file);
  return file;
}
