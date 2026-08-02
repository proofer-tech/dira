import { test } from "node:test";
import assert from "node:assert";
import { issueTitle, issueUrl, type FeedbackMeta } from "./feedback.ts";

const META: FeedbackMeta = {
  version: "0.1.4 (desktop)",
  session: "3f9a1c22-0000-4000-8000-000000000001/1722500000000",
};

/** URL을 다시 뜯어 본다 — 조립한 문자열을 눈으로 비교하면 인코딩이 깨진 것을 못 잡는다. */
function parts(url: string) {
  const u = new URL(url);
  return { path: u.origin + u.pathname, title: u.searchParams.get("title")!, body: u.searchParams.get("body")! };
}

test("제목은 첫 줄 40자다", () => {
  assert.equal(issueTitle("보드가 느립니다\n두 번째 줄"), "의견 — 보드가 느립니다");
  // 41자를 넣으면 40자에서 끊긴다
  assert.equal(issueTitle("가".repeat(41)), `의견 — ${"가".repeat(40)}`);
  // 코드포인트로 센다 — 이모지가 반쪽 나지 않는다(반쪽은 encodeURIComponent가 던진다)
  const t = issueTitle("🙂".repeat(41));
  assert.equal(Array.from(t.slice("의견 — ".length)).length, 40);
  assert.doesNotThrow(() => encodeURIComponent(t));
});

test("한글·개행·#·&가 왕복해도 그대로다", () => {
  const text = "제목 & 본문 #1\n둘째 줄에 % 와 +도 있다\n\n셋째";
  const { path, title, body } = parts(issueUrl(text, META).url);
  assert.equal(path, "https://github.com/proofer-tech/dira/issues/new");
  assert.equal(title, "의견 — 제목 & 본문 #1");
  assert.ok(body.startsWith(text), body.slice(0, 60));
});

test("본문은 내용 + 구분선 + 두 줄이고 그 외엔 없다", () => {
  const { body } = parts(issueUrl("한 줄 의견", META).url);
  assert.equal(body, `한 줄 의견\n\n---\n- 버전: 0.1.4 (desktop)\n- 세션: ${META.session}`);
});

test("긴 본문은 잘리고 URL이 상한 아래다", () => {
  const short = issueUrl("짧다", META);
  assert.equal(short.truncated, false);

  const long = issueUrl("가".repeat(5000), META);
  assert.equal(long.truncated, true);
  assert.ok(long.url.length <= 6000, `길이 ${long.url.length}`);
  // 자른 뒤에도 두 줄은 남는다 — 잘리는 것은 사람이 쓴 내용뿐이다
  const { body } = parts(long.url);
  assert.ok(body.endsWith(`- 세션: ${META.session}`), body.slice(-40));
  assert.ok(body.startsWith("가".repeat(600)), `본문 ${Array.from(body).length}자`);
});
