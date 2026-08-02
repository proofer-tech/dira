/** 랜딩·푸터의 버전 표기는 전부 여기서 온다. **본문에 숫자를 적지 않는다** —
 *  `release.yml`이 master 커밋마다 bump하므로 손으로 적는 한 반드시 어긋난다. */
import { readFileSync } from "node:fs";

export const diraVersion: string = JSON.parse(
  readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"),
).version;
