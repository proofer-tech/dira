/** 앱이 띄우는 자식 프로세스(터미널 셸 - 홈 대화 claude - tick)에 넘길 환경변수 (스펙 P482).
 *  데스크톱 앱과 standalone `server.js`가 Next 서버에 얹은 값이 자식 셸로 새면 `next dev`가
 *  깨지고 비밀값이 `env`에 보인다. 허용 목록이 아니라 차단 목록이다 - 사람 셸의 값은 예측할 수 없다. */
const DROP = new Set([
  "NODE_ENV", "PORT", "HOSTNAME", "TURBOPACK", "ELECTRON_RUN_AS_NODE", "DIRA_ENV_BRIDGE_URL",
  "DIRA_ENV_BRIDGE_SECRET", "GA_MEASUREMENT_ID", "GA_API_SECRET", "DIRA_APP_VERSION",
]);
const DROP_PREFIX = ["__NEXT_", "NEXT_PRIVATE_", "TURBOPACK_"];

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) {
    if (DROP.has(k) || DROP_PREFIX.some((p) => k.startsWith(p))) continue;
    env[k] = v;
  }
  return Object.assign(env, extra);
}
