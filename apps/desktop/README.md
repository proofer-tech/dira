# apps/desktop — dira 데스크톱 셸 (Electron)

`apps/teams`를 담는 껍데기. 안에 든 것은 지금 그대로의 GUI다 — 화면은 여기서 만들지 않는다.
스펙은 `../../docs/DESIGN.md` §데스크톱 앱이 단일 출처다.

```
Electron main ──spawn──> node server.js        (Next standalone 빌드, 127.0.0.1:<빈 포트>)
      │                       ↑
      └─ BrowserWindow ───load┘
```

## 실행

```sh
pnpm install     # 처음 한 번
pnpm dev         # teams 빌드 + 조립 + 앱 실행
```

| | |
|---|---|
| `pnpm build` | `apps/teams`를 `output: "standalone"`으로 빌드하고 `.next/static`·`public`을 standalone 안에 넣는다 (standalone 산출물은 그 둘을 스스로 담지 않는다) |
| `pnpm start` | 빌드 산출물이 이미 있을 때 앱만 띄운다 |
| `DIRA_SERVER_JS=…/NOPE.js pnpm start` | 실패 화면 확인용. 서버를 못 띄우면 창 대신 사유 + 서버 stderr가 뜬다 |

**`apps/teams`는 브라우저에서 그대로 돈다.** `pnpm dev` → `localhost:7331`은 이 앱과 무관하다.
`teams`는 `electron`을 의존성으로 갖지 않는다 — 껍데기가 알맹이의 실행 조건이 되면 안 된다.

## 못박은 것 (DESIGN.md §데스크톱 앱)

1. **포트는 0으로 잡아 OS가 준 것을 쓴다.** 7331 고정은 브라우저의 계약이고, 고정하면
   `pnpm dev`가 떠 있는 흔한 상황에서 앱이 안 뜬다.
2. **준비 판정은 HTTP다.** `GET http://127.0.0.1:<port>/`를 200ms 간격으로 30초까지 친다.
   stdout의 `Ready` 문자열은 안 본다.
3. **자식 서버는 앱보다 오래 살지 않는다.** `before-quit`·`process exit`·`SIGINT/SIGTERM`
   전부에서 죽인다.
4. **창은 자기가 띄운 오리진만 연다.** `contextIsolation: true`·`nodeIntegration: false`,
   `will-navigate`·`setWindowOpenHandler`가 밖을 전부 거부하고 http(s)만 `shell.openExternal`로
   내보낸다.
5. **판정을 main에서 다시 구현하지 않는다.** 알림이 쓰는 `답변 대기`는 서버가 `lib/queue.ts`로
   판정한다 — main은 `GET /api/awaiting`을 물어본다.

## N2 답변 대기 알림

30초마다 `GET /api/awaiting`을 물어보고 **직전 집합과의 차집합만** 알린다(배경 폴링이라 보드의
5초와 다른 값인 것이 맞다). **앱을 켠 직후 첫 응답은 조용히 씨를 뿌린다** — 켤 때마다 밀린
알림이 쏟아지면 그 알림은 다음 주에 꺼진다. 알림을 누르면 창이 그 티켓 상세로 간다.
폴링 실패(서버가 죽음 · 응답이 배열이 아님)는 로그만 남기고 앱은 계속 산다.

`main.ts`는 Electron이 그대로 실행한다(Node 24 타입 스트리핑). 빌드 단계도 번들러도 없다.

## 여기 아직 없는 것

트레이 상주 `abce61c9` · 경로 피커 `c01e2678` · 로그인 시 자동 실행 `00fc34ba` ·
`.app` 패키징 `9e0ec1af`. 각각 자기 티켓이 있다.
