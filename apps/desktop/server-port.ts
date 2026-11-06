// 데스크톱 서버 포트를 실행 사이에 고정한다(P549 결정 1). 오리진이 같아야 HTTP 캐시와 localStorage가 산다.
// electron 없이 단위 테스트가 가능하도록 파일 경로를 인자로 받는다.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

/** port를 127.0.0.1에 열어 보고 닫는다. 0이면 OS가 준 빈 포트다. 쓰이고 있으면 reject. */
export function listenOnce(port: number): Promise<number> {
  // ponytail: listen -> close -> 번호를 자식에게 넘긴다. 닫고 넘기는 사이가 이론상 경쟁 구간이다.
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(port, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

/** 기억한 포트를 먼저 시도하고, 안 되면 빈 포트를 받아 파일을 덮는다. */
export async function pickPort(file: string, tryPort = listenOnce): Promise<number> {
  let remembered = NaN;
  try { remembered = Number(readFileSync(file, "utf8").trim()); } catch { /* 파일 없음 */ }
  if (Number.isInteger(remembered) && remembered > 0 && remembered < 65536) {
    try { return await tryPort(remembered); } catch { /* 점유 */ }
  }
  const port = await tryPort(0);
  try { writeFileSync(file, `${port}\n`); } catch (e) { console.error(`[dira] server-port를 못 적었습니다: ${(e as Error).message}`); }
  return port;
}
