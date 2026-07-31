# apps/desktop — dira 데스크톱 셸 (Electron)

`apps/teams`를 담는 껍데기. 안에 든 것은 지금 그대로의 GUI다 — 화면은 여기서 만들지 않는다.
스펙은 `../../docs/DESIGN.md` §데스크톱 앱이 단일 출처다.

```
Electron main ──spawn──> node server.js        (Next standalone 빌드, 127.0.0.1:<빈 포트>)
      │                       ↑
      ├─ BrowserWindow ───load┘   빨간 버튼은 숨기기다. 파괴하지 않는다
      └─ Tray ─ 열기 · 종료         창이 없어도 앱은 산다
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

## 패키징 — `.app` · `.dmg`

```sh
pnpm dist        # teams 빌드 + 조립 + electron-builder
```

| 산출물 | 어디 |
|---|---|
| `.app` | `dist/mac-arm64/dira.app` — `/Applications`에 옮겨도 돈다 |
| `.dmg` | `dist/dira-<버전>-arm64.dmg` — 사람이 이걸 건넨다 |

`dist/`는 gitignore돼 있다. **서명·공증은 여기 없다**(`5aa9486d`) — `identity: null`이라
electron-builder가 "skipped macOS code signing"을 찍고 지나간다. 링커가 붙이는 ad-hoc 서명만
있어서 **이 맥에서는 돌지만 다른 맥에서는 Gatekeeper가 막는다.**

패키징에서 갈리는 것 셋:

- **`asar: false`.** `main.ts`는 Electron이 타입 스트리핑으로 그대로 읽고 `server.js`는
  `spawn`으로 도는 별개 프로세스다. 둘 다 asar 안에서 성립하는지가 불확실한데, 끄면
  그 질문 자체가 없어진다. 대가는 `Contents/Resources/app/`이 소스 그대로 보이는 것뿐이다.
- **standalone은 `extraResources`로 `Contents/Resources/server/`에 들어간다.** `main.ts`가
  `app.isPackaged`로 갈라 그 경로를 본다.
- **`node_modules`가 별도 항목이다.** electron-builder는 `extraResources` 복사에서
  `node_modules`를 이름으로 걸러낸다(`filter`로 되돌려지지 않는다 — 실측). `from`을
  그 디렉터리 자체로 잡은 두 번째 항목이 필터를 비껴간다. 이게 빠지면 36MB가 조용히
  사라지고 앱은 창 대신 실패 화면을 띄운다.

## 아이콘

```sh
pnpm icns        # icon.svg -> icon.icns. 형상을 고쳤을 때만 돌린다
```

`icon.icns`는 **커밋돼 있다** — `pnpm dist`는 이 스크립트도 크롬도 필요로 하지 않는다.
사양은 `../../docs/DESIGN.md` §비주얼 §16이고, 각 크기를 1024 마스터에서 축소하지 않고
SVG에서 직접 래스터하는 것이 그 절이 넘긴 실측이다.

**`apps/teams`는 브라우저에서 그대로 돈다.** `pnpm dev` → `localhost:7331`은 이 앱과 무관하다.
`teams`는 `electron`을 의존성으로 갖지 않는다 — 껍데기가 알맹이의 실행 조건이 되면 안 된다.

## 못박은 것 (DESIGN.md §데스크톱 앱)

1. **포트는 0으로 잡아 OS가 준 것을 쓴다.** 7331 고정은 브라우저의 계약이고, 고정하면
   `pnpm dev`가 떠 있는 흔한 상황에서 앱이 안 뜬다.
2. **준비 판정은 HTTP다.** `GET http://127.0.0.1:<port>/`를 200ms 간격으로 30초까지 친다.
   stdout의 `Ready` 문자열은 안 본다.
3. **자식 서버는 앱보다 오래 살지 않는다.** `before-quit`·`process exit`·`SIGINT/SIGTERM`
   전부에서 죽인다. 반대로 **창보다는 오래 산다**(N1) — 빨간 버튼은 `close`를 가로채 `hide()`이고,
   `before-quit`이 세운 `quitting` 플래그만 그 가로채기를 푼다. ⌘Q·트레이 `종료`가 같은 문으로 간다.
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

## 트레이 아이콘 (메뉴바)

독 아이콘(`icon.svg`, 위 `## 아이콘`)과 **다른 자산이다.** 메뉴바 아이콘은 타일도 색도 갖지 않는다.

| 파일 | 무엇 |
|---|---|
| `tray.svg` | **원본.** 32 뷰박스. §비주얼 §14 마크의 `d`를 문자 단위로 그대로 쓰고, 타일이 없다 |
| `trayTemplate.png` · `trayTemplate@2x.png` | 위를 16·32로 래스터한 것. **순검정 + 알파**뿐이라 라이트/다크는 macOS가 칠한다. `@2x`는 파일명 규약으로 `nativeImage`가 알아서 집는다 |

두 PNG는 **커밋돼 있다** — `icon.icns`와 같은 이유로 빌드가 크롬을 필요로 하지 않는다.
형상을 고쳤을 때만 다시 뽑고, 그때도 `.icns`와 같은 규약이다 — 큰 것을 줄이지 말고
`tray.svg`에서 크기별로 직접 래스터한다:

```sh
"…/Google Chrome" --headless --screenshot=trayTemplate.png --window-size=16,16 \
  --default-background-color=00000000 --force-device-scale-factor=1 --user-data-dir=/tmp/… wrap.html
```

**`trayTemplate.png`가 현재 메뉴바에 그려지지 않는다** — 티켓 `abce61c9` `## 블록`을 읽어라.
트레이 자체(항목·클릭·메뉴)는 동작한다.

## 여기 아직 없는 것

로그인 시 자동 실행 `00fc34ba`(트레이 메뉴의 구분선 자리) · 코드사이닝/공증 `5aa9486d`.
각각 자기 티켓이 있다.
