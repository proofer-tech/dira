/** 랜딩·푸터의 버전 표기는 전부 여기서 온다. **본문에 숫자를 적지 않는다** —
 *  `release.yml`이 master 커밋마다 bump하므로 손으로 적는 한 반드시 어긋난다. */
// 종전에는 `readFileSync(new URL("…", import.meta.url))`이었다. 그 두 인자 형태를
// turbopack이 자기 asset URL로 바꿔치기해서, Next 빌드가 `node:fs`·`fileURLToPath` 어느
// 쪽으로 내려도 `ERR_INVALID_ARG_TYPE: Received an instance of URL`로 죽는다.
// JSON import는 번들러와 node가 같은 뜻으로 읽고 fs도 안 탄다(§순서 ⑥).
import pkg from "../desktop/package.json" with { type: "json" };

export const diraVersion: string = pkg.version;
