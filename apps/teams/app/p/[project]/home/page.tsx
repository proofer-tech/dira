/** 프로젝트 홈 `/p/<project>/home` — 질의 에이전트 (DESIGN.md §7 · §비주얼 §24).
 *
 *  이 티켓이 세우는 것은 **그릇과 진입점**이다: 라우트 · 헤더 로고 · 내비 `홈` · 대화 0건 온보딩.
 *  **답하는 에이전트는 다음 티켓이다** — 그래서 `보내기`가 `aria-disabled` + 사유 한 줄이고,
 *  눌러도 아무 일이 없는 버튼은 이 화면에 없다. 예시 질문 4개는 지금도 진짜로 동작한다
 *  (입력칸에 채우고 포커스만 준다 — §24가 정한 그 동작이 전부다).
 *
 *  **요약 대시보드가 없는 것이 §7의 판단이다.** 티켓 3수·워커 상태는 보드와 §0-2 배너가 이미
 *  그리고, 같은 값을 여기서 다시 그리면 폴링 주기가 달라 두 화면이 다른 수를 말한다.
 *
 *  **`"use client"`인 페이지가 이 앱에 여기 하나다.** 지금 이 화면이 읽는 서버 데이터가 0이라서다
 *  (프로젝트 존재 판정은 셸 `layout.tsx`가 이미 `notFound()`로 한다).
 *  // ponytail: 다음 티켓이 트랜스크립트를 서버에서 읽는 순간 이 파일은 서버 페이지 +
 *  //           `components/home-ui.tsx`로 갈린다 — 그때 나머지 화면들과 같은 배치가 된다. */
"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

/** 화면이 답할 수 있다고 약속하는 범위가 곧 이 넷이다(§비주얼 §24 — 요구 원문의 예시 +
 *  §7이 스냅샷에 넣기로 한 것). 늘리려면 스냅샷이 먼저 늘어야 한다. */
const EXAMPLES = [
  "w2가 지금 무슨 일을 하고 있나",
  "w4는 어떤 엔진으로 도나",
  "답변 대기 티켓이 왜 안 도나",
  "이 큐의 프로토콜을 요약해 달라",
];

export default function Home() {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  return (
    // 폭은 `max-w-3xl`이다(§24) — 읽는 산문 + 폼이고 테이블이 아니라서 §4 폼 규칙 그대로다.
    <div className="max-w-3xl space-y-6">
      {/* `새 대화`가 없다 — 0건이면 비울 것이 없다(§24). 대화가 생기는 티켓이 같이 세운다 */}
      <h1 className="text-lg font-semibold">홈</h1>

      {/* 대화 0건 = 이 화면의 온보딩이다. `<EmptyState>`를 쓰지 않는다(§6 빈 상태 규칙의
          셋째 예외 — 한 줄로는 이 에이전트에게 무엇을 물어볼 수 있는지를 못 알려준다).
          스레드 상자는 아예 안 그린다 — 빈 상자가 서는 순간이 없다(§13). */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">이 큐에 대해 묻는다</h2>
        <p className="text-sm text-muted-foreground">
          티켓 · 워커 · 프로토콜 · repo를 읽고 답합니다. 큐를 고치지는 않습니다.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {EXAMPLES.map((q) => (
            // **제출하지 않는다**(§24): ① 한 질문이 프로세스 하나고 상한이 5분이다 — 클릭 한 번에
            // 5분짜리를 시작시키지 않는다. ② 예시는 문장을 고쳐 쓰라고 있다(`w2`가 그 큐에 없을 수
            // 있다). 채워진 뒤 손잡이의 `보내기`가 곧 두 번째 클릭이다.
            <Button
              key={q}
              variant="outline"
              size="sm"
              onClick={() => {
                setText(q);
                input.current?.focus();
              }}
            >
              {q}
            </Button>
          ))}
        </div>
      </div>

      {/* §21의 세 번째 모드다(§24) — 그릇 · 자람 · 서체는 그 절 그대로고 이름 둘만 갈린다.
          `⌘↵` 표기가 없는 것은 **보내는 키가 아직 없어서**다(§0-6: 표기를 하드코딩하지 않는다).
          // ponytail: 보내기가 붙는 티켓이 `formatCombo(useKeymap()...)`와 함께 세운다 */}
      <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
        <InputGroup>
          <InputGroupTextarea
            ref={input}
            aria-label="질문"
            aria-describedby="home-off"
            placeholder="이 큐에 대해 묻기"
            className="max-h-32"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <InputGroupAddon align="block-end">
            {/* **`disabled`가 아니라 `aria-disabled`다**(§21 실측): `InputGroup`의 흐림은
                `:has(:disabled)`라 버튼 하나만 잠가도 그릇이 통째로 흐려지고, 그러면 지금은
                멀쩡히 쓰는 입력칸의 placeholder가 §21이 금지한 1.85 대비로 떨어진다.
                여기서 입력칸은 정말로 살아 있다 — 예시 질문이 그 칸을 채운다. */}
            <InputGroupButton
              type="submit"
              variant="default"
              size="xs"
              aria-disabled
              className="ml-auto aria-disabled:opacity-50"
            >
              <Send aria-hidden />
              보내기
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        {/* 사유는 그룹 **밖**이다 — 안에 넣으면 대비가 겹쳐 떨어진다(§21). 비활성 컨트롤은
            WCAG 예외지만 왜 못 쓰는지 설명하는 문장은 예외가 아니다. */}
        <p id="home-off" className="text-xs text-muted-foreground">
          아직 보낼 수 없습니다 — 답하는 에이전트가 아직 붙지 않았습니다
        </p>
      </form>
    </div>
  );
}
