/** 답변 대기 티켓 — 등록된 프로젝트 전부 (DESIGN.md §데스크톱 앱 N2 · 고정하는 것 5).
 *
 *  **판정을 여기서 다시 쓰지 않는다.** `lib/projects.ts`의 `listAwaiting`이 스캔과 판정을
 *  갖고, Electron main은 큐를 직접 읽지 않고 이걸 물어본다 — main이 판정을 복제하면 제약 3이
 *  GUI↔`tickets.py`에서 막은 거짓말이 main↔GUI에서 다시 난다. `lib/webhook.ts`(§0-10 §답변
 *  대기가 앱 밖으로 나간다)가 서버 프로세스 안에서 같은 함수를 부른다 — 둘이 스캔을 나눠 쓴다.
 *
 *  화면이 쓰지 않는 유일한 라우트다(앱의 나머지는 서버 컴포넌트가 직접 `lib/`를 부른다).
 *  깨진 레지스트리는 삼키지 않는다 — `readProjects`가 던지면 500이고, main이 그걸 로그로 남긴다.
 *  못 읽는 큐(경로가 사라진 프로젝트)는 `listTickets`가 이미 빈 목록으로 답한다. */
import { listAwaiting } from "@/lib/projects";

export async function GET() {
  return Response.json(await listAwaiting());
}
