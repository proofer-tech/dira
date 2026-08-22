/** `next.config.test.ts`(28f72b69)가 `?locked-...` 같은 쿼리 붙은 지정자로 매 호출마다
 *  새 모듈 인스턴스를 강제해서 임포트한다 — Node 로더는 그대로 실행하지만 tsc의 모듈 해석은
 *  쿼리 문자열을 모른다. 실제 파일과 같은 default export 모양만 와일드카드로 선언한다. */
declare module "./next.config.ts?*" {
  import config from "./next.config.ts";
  export default config;
}
