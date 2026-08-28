// R7이 요구하는 것은 **세 경로 전부에서 다이얼로그가 뜬다**이고, 그 판정은 "본문 문자열이
// 돌아온다 + 첫 줄이 R6의 사실이다"다. `releaseNotes()`가 네트워크·프로세스를 인자로 받으므로
// electron도 GitHub도 `claude`도 없이 셋을 다 밟는다 — 스텁은 그냥 던지는 함수다.
//
// $ cd apps/desktop && pnpm test
import assert from "node:assert/strict";
import test from "node:test";
import { cachedNotes, cacheNotes, newNotesCache, releaseNotes } from "./release-notes.ts";

// **여기서 삼키는 이유는 이 파일의 본체가 실패 경로라서다.** `releaseNotes()`는 세 경로를
// 밟을 때마다 `[dira] 릴리즈 노트: …`를 찍는데, 초록으로 끝난 릴리스 로그에 그 아홉 줄이
// 그대로 남으면 읽는 사람이 진짜 사고로 읽는다(실측 2026-08-10 — 두 번 물어봤다).
// 판정은 어차피 아래 assert들이 한다.
console.error = () => {};

const SLUG = { owner: "hsol", repo: "dira" };
const R6 = "0.2.0을 받아뒀습니다. 앱을 종료하면 몇 초 뒤 적용됩니다.";
const compare = (...msgs: string[]) => JSON.stringify({ commits: msgs.map((message) => ({ commit: { message } })) });
const boom = (why: string) => async () => {
  throw new Error(why);
};

test("① 요약 성공 — R6 문장 다음에 요약문", async () => {
  let asked = "";
  const body = await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText(url) {
      assert.equal(url, "https://api.github.com/repos/hsol/dira/compare/v0.1.0...v0.2.0");
      return compare("feat(트레이): 자동 업데이트 토글\n\n본문\n\nTicket: 4f418619");
    },
    async summarize(p) {
      asked = p;
      return "• 트레이에서 자동 업데이트를 켜고 끌 수 있습니다\n";
    },
  });
  assert.equal(body.split("\n")[0], R6);
  assert.match(body, /트레이에서 자동 업데이트를 켜고 끌 수 있습니다/);
  // 프롬프트에 간 것은 **제목 한 줄**이다 — 본문도 `Ticket:` 줄도 아니다
  assert.match(asked, /^feat\(트레이\): 자동 업데이트 토글$/m);
  assert.ok(!asked.includes("Ticket: 4f418619"), asked);
});

test("프롬프트 — 분류 순서와 내부 커밋 제외 규칙을 지시한다", async () => {
  let asked = "";
  await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText() {
      return compare("feat(트레이): 자동 업데이트 토글");
    },
    async summarize(p) {
      asked = p;
      return "• 요약";
    },
  });
  assert.match(asked, /기능 추가, 개선, 버그 고침, 깨지는 변경\/보안 순으로/);
  assert.match(asked, /리팩터링.*테스트.*문서.*큐 작업.*불릿에서 뺀다/);
  assert.match(asked, /카테고리 헤딩이나 이모지는 쓰지 마라/);
});

test("② claude 부재·비정상 종료·타임아웃 — 커밋 제목 목록 그대로", async () => {
  for (const why of ["PATH에서 claude를 찾지 못했습니다", "Command failed: exit 1", "timeout"]) {
    const body = await releaseNotes("0.1.0", "0.2.0", SLUG, {
      async fetchText() {
        return compare("fix(디스패치): 산 세션 가드", "feat(§2 왕복): 스레드가 유일한 출처다");
      },
      summarize: boom(why),
    });
    assert.equal(body, `${R6}\n\n• fix(디스패치): 산 세션 가드\n• feat(§2 왕복): 스레드가 유일한 출처다`, why);
  }
});

test("③ compare 실패 — 노트 없이 R6 문장만", async () => {
  const claudeMustNotRun = async () => assert.fail("compare가 죽었으면 요약할 것이 없다");
  for (const why of ["404 (owner가 자리표시자다)", "fetch failed", "The operation was aborted"]) {
    const body = await releaseNotes("0.1.0", "0.2.0", SLUG, { fetchText: boom(why), summarize: claudeMustNotRun });
    assert.equal(body, R6, why);
  }
  // 200인데 본문이 compare 응답이 아닌 경우도 ③이다 — 파싱이 던져도 다이얼로그는 뜬다
  const body = await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText() {
      return '{"message":"Not Found"}';
    },
    summarize: claudeMustNotRun,
  });
  assert.equal(body, R6);
});

test("커밋 0건 · 빈 요약 — 그래도 본문은 R6 문장이다", async () => {
  const empty = await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText() {
      return compare();
    },
    summarize: async () => assert.fail("요약할 제목이 없다"),
  });
  assert.equal(empty, R6);

  const blank = await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText() {
      return compare("chore: 한 건");
    },
    summarize: async () => "   \n",
  });
  assert.equal(blank, `${R6}\n\n• chore: 한 건`);
});

// main.ts의 두 리스너가 하는 것과 같다 — 캐시에 먼저 물어보고, 없으면 releaseNotes()를
// 불러 채운다.
const getOrMake = (cache: ReturnType<typeof newNotesCache>, from: string, to: string, io: Parameters<typeof releaseNotes>[3]) =>
  cachedNotes(cache, to) ?? cacheNotes(cache, to, releaseNotes(from, to, SLUG, io));

test("캐시 — 같은 버전을 두 번 요청해도 fetchText는 한 번만 불린다", async () => {
  const cache = newNotesCache();
  let fetchCount = 0;
  const io = {
    async fetchText() {
      fetchCount++;
      return compare("feat(트레이): 자동 업데이트 토글");
    },
    async summarize() {
      return "• 요약";
    },
  };
  const first = await getOrMake(cache, "0.1.0", "0.2.0", io);
  const second = await getOrMake(cache, "0.1.0", "0.2.0", io);
  assert.equal(fetchCount, 1);
  assert.equal(first, second);
});

test("캐시 — 버전이 다르면 새로 만든다", async () => {
  const cache = newNotesCache();
  let fetchCount = 0;
  const io = {
    async fetchText() {
      fetchCount++;
      return compare("feat(트레이): 자동 업데이트 토글");
    },
    async summarize() {
      return "• 요약";
    },
  };
  await getOrMake(cache, "0.1.0", "0.2.0", io);
  await getOrMake(cache, "0.1.0", "0.3.0", io);
  assert.equal(fetchCount, 2);
});

test("제목 21건 — 20건 + `…외 N건`으로 잘린다(다이얼로그에 스크롤이 없다)", async () => {
  const body = await releaseNotes("0.1.0", "0.2.0", SLUG, {
    async fetchText() {
      return compare(...Array.from({ length: 21 }, (_, i) => `fix: ${i}`));
    },
    summarize: boom("claude 없음"),
  });
  const lines = body.split("\n").slice(2);
  assert.equal(lines.length, 21);
  assert.equal(lines[19], "• fix: 19");
  assert.equal(lines[20], "• …외 1건");
});
