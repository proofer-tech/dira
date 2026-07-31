# apps/desktop — dira 데스크톱 셸 (Electron)

`apps/teams`를 담는 껍데기. 안에 든 것은 지금 그대로의 GUI다 — 화면은 여기서 만들지 않는다.
스펙은 `../../docs/DESIGN.md` §데스크톱 앱이 단일 출처다.

```
Electron main ──spawn──> node server.js        (Next standalone 빌드, 127.0.0.1:<빈 포트>)
      │                       ↑
      ├─ BrowserWindow ───load┘   빨간 버튼은 숨기기다. 파괴하지 않는다
      └─ Tray ─ 열기 · 로그인 시 자동 실행 · 종료   창이 없어도 앱은 산다
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

## 받는 맥에서 사람이 눌러야 하는 것 — `앱 관리` 승인 (`0f2c9453`·`79d9b659`·`ea4aded5`)

**`새로 만들기`가 crontab에 워커 한 줄을 쓸 때 macOS가 창을 띄운다.** 그 대답을 받기 전까지
등록은 멈춰 있다. 받는 맥의 **등록은 매번 이 창을 지난다**(`.dmg`를 건넨 사람도, 앱을
`/Applications`에 옮긴 뒤에도, 공증된 빌드에서도 마찬가지다 — 아래 실측).

> **‘dira’에서 사용자의 컴퓨터를 관리하려고 합니다.**
> 관리 범위에는 네트워크 연결, 시스템 설정 및 암호 변경이 포함될 수 있습니다.
> `[허용 안 함]`  `[허용]`

| 누른 것 | 화면 |
|---|---|
| **`허용`** | 누른 그 시도가 **그대로 이어져** `crontab에 등록됨`으로 끝난다(실측: 창이 뜬 지 104초 뒤에 눌렀는데 그 시도가 성공했다) |
| `허용 안 함` | 기다리지 않고 바로 실패한다. 사유(`앱 관리` 권한 없음)와 셸에 붙여 넣을 등록 명령이 그 자리에 뜬다 |
| 아무것도 안 누름 | 3분까지 기다렸다가 등록만 실패로 끝난다(큐·워커 파일은 만들어진 채로 남는다) |

미리 켜거나 되돌리는 자리는 **시스템 설정 → 개인정보 보호 및 보안 → 앱 관리**다.

**승인은 다음 등록까지 안 남는다. 워커를 만들 때마다 누른다.** 빌드 탓이 아니다 —
공증·스테이플된 `.app`(`spctl: accepted / Notarized Developer ID`)으로 `새로 만들기`를
연속 2회 해 봤더니 **두 번 다 창이 떴다**(`ea4aded5`, 같은 프로세스 pid 32945):

```
22:59:34.954  AUTHREQ_PROMPTING  msgID=38700.165           ← 1회차
22:59:36.596  AUTHREQ_RESULT     authValue=2 (허용)        → crontab REPLACE 성공
23:01:41.536  Handling access request … Auth Right: Unknown (None)   ← 2회차, 2분 뒤
23:01:41.541  AUTHREQ_PROMPTING  msgID=38700.177           → 창이 또 떴다
```

2회차가 `Unknown (None)`이라는 건 tccd에 1회차 승인이 **남아 있지 않다**는 뜻이다.
(`DB Action:None`은 허용으로 끝난 줄에도 똑같이 붙는다 — "DB에 안 썼다"의 근거가 못 된다.)

성가심이지 실패는 아니다 — 상한이 사람의 클릭 뒤에 있어 `허용`만 누르면 그 시도가 끝까지 간다.
`허용`을 눌러도 다음 워커에서 또 뜬다고 미리 알려 두는 편이 낫다.

- 승인은 **앱(책임 프로세스)별**이다. `pnpm dev`로 브라우저에서 쓰면 그 창은 앱이 아니라
  **터미널** 앞으로 뜬다(이미 승인해 둔 터미널이면 안 뜬다).
- **읽기는 승인이 필요 없다.** 보드가 5초마다 도는 `crontab -l`은 창 없이 통과한다 —
  승인 전에도 워커 목록·상태는 정상으로 보인다. 갈리는 것은 쓰기(등록·중단·삭제) 하나다.
- 상한과 문구는 `../teams/lib/workers.ts`의 `CRONTAB_WRITE_TIMEOUT`에 있다(3분).
  근거는 `../../docs/DESIGN.md` §제약 4.

## 패키징 — `.app` · `.dmg`

```sh
pnpm dist        # teams 빌드 + 조립 + electron-builder
```

| 산출물 | 어디 |
|---|---|
| `.app` | `dist/mac-arm64/dira.app` — `/Applications`에 옮겨도 돈다 |
| `.dmg` | `dist/dira-<버전>-arm64.dmg` — 사람이 이걸 건넨다 |

`dist/`는 gitignore돼 있다.

패키징에서 갈리는 것 넷:

- **`asar: false`.** `main.ts`는 Electron이 타입 스트리핑으로 그대로 읽고 `server.js`는
  `spawn`으로 도는 별개 프로세스다. 둘 다 asar 안에서 성립하는지가 불확실한데, 끄면
  그 질문 자체가 없어진다. 대가는 `Contents/Resources/app/`이 소스 그대로 보이는 것뿐이다.
- **standalone은 `extraResources`로 `Contents/Resources/server/`에 들어간다.** `main.ts`가
  `app.isPackaged`로 갈라 그 경로를 본다.
- **`node_modules`가 별도 항목이다.** electron-builder는 `extraResources` 복사에서
  `node_modules`를 이름으로 걸러낸다(`filter`로 되돌려지지 않는다 — 실측). `from`을
  그 디렉터리 자체로 잡은 두 번째 항목이 필터를 비껴간다. 이게 빠지면 36MB가 조용히
  사라지고 앱은 창 대신 실패 화면을 띄운다.
- **`pnpm build`가 끊어진 심링크를 지운다.** Next의 standalone 트레이서가
  `node_modules/.pnpm/node_modules/semver -> ../semver@6.3.1/...`을 넣는데 정작 트레이싱된
  것은 `semver@7.8.5`라 링크가 끊겨 있다. 서명 없는 빌드는 트리를 안 걸어서 몰랐지만,
  **서명은 번들 전체를 `stat`으로 걷다가 그 링크에서 죽는다**(`ENOENT ... /.pnpm/node_modules/semver`,
  실측). 이미 끊긴 링크라 지워도 잃는 게 없다 — `find … -type l ! -exec test -e {} \; -print -delete`가
  무엇을 지웠는지 이름까지 찍는다.

**Finder·Dock에서 띄운 `.app`에는 PATH가 없다**(`bcf66f01`). LaunchServices가 준 환경에 그 값이
아예 없어 launchd 기본값(`/usr/bin:/bin:/usr/sbin:/sbin`)이 되고, 서버가 부르는 `claude`
(`~/.local/bin`)가 안 보여 §0-4 층 ②가 종료 코드 127로 죽었다. 터미널의 `pnpm dev`는 셸 PATH를
물려받아 멀쩡했기 때문에 여기서만 나는 결함이다. `main.ts`의 `userPath()`가 **로그인 셸에게
PATH를 물어** 서버에 물려 준다 — `.app`에서만 되는·안 되는 것을 볼 때 이 경계를 먼저 의심한다.
재현은 `env -i HOME=$HOME open -g -na dist/mac-arm64/dira.app`이다(셸 환경을 지우고 띄운다).

## 서명 · 공증 (`5aa9486d`)

서명 없는 `.app`은 **이 맥에서는 돌지만 다른 맥에서는 Gatekeeper가 막는다.** 나눠주려면
`Developer ID` 서명 + 공증 + 스테이플까지 가야 한다(`../../docs/DESIGN.md` §배포).

**사람이 준비할 것 셋.** 세션이 구할 수 없다.

1. **Apple Developer Program 계정** (연 $99). 개인 무료 계정으로는 `Developer ID`가 안 나온다.
2. **`Developer ID Application` 인증서를 로그인 키체인에 설치.** developer.apple.com →
   Certificates → `Developer ID Application` 발급 → 받은 `.cer`을 더블클릭.
3. **notarytool용 App-specific password.** appleid.apple.com → 로그인 및 보안 →
   앱 암호 → 생성. (API 키를 쓰면 `APPLE_API_KEY`·`APPLE_API_KEY_ID`·`APPLE_API_ISSUER`로
   대신할 수 있다 — electron-builder가 둘 다 받는다.)

**시크릿은 이 레포에 없다.** 값은 환경변수로만 들어온다:

| 환경변수 | 무엇 |
|---|---|
| `APPLE_ID` | Apple 계정 이메일 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 위 3번에서 만든 앱 암호 (`abcd-efgh-ijkl-mnop`) |
| `APPLE_TEAM_ID` | 10자 팀 ID. developer.apple.com → Membership |

인증서는 환경변수가 아니라 **키체인**에서 온다 — electron-builder가 `Developer ID Application`을
직접 찾는다. 키체인에 없으면 못 찾는다.

> **에이전트 세션의 셸에서는 키체인이 안 보인다.** GUI 로그인 세션이 아니라서 키체인 검색목록이
> `System.keychain`만 남고 로그인 키체인이 빠진다. 인증서가 설치돼 있어도
> `security find-identity -v -p codesigning`이 `0 valid identities found`을 찍고,
> `codesign -s <이름>`은 `no identity found`으로 죽는다. `list-keychains -s`로도 안 되돌아간다
> (검색목록은 보안 세션에 묶여 있다). `pnpm signcheck`가 이 경우를 인증서 없는 경우와
> 구분해서 찍어주니 둘을 헷갈리지 마라.
>
> **막힌 건 셸이지 맥이 아니다.** 같은 맥의 **GUI launchd 도메인**에는 검색목록이 멀쩡하다.
> 임시 LaunchAgent 하나를 `launchctl bootstrap gui/$(id -u) <plist>`로 올려 그 안에서 빌드를
> 돌리면 서명이 그대로 잡힌다(`5aa9486d` 3회차에서 실측 — `find-identity`가 1건, 개인키 접근도
> 프롬프트 없이 통과). 사람이 자기 터미널에서 `pnpm dist`를 돌리는 것이 제일 간단하지만,
> 세션이 끝까지 가야 할 때 쓸 수 있는 문이 하나 있다는 뜻이다. **끝나면 `bootout`하고 plist를
> 지운다.**

```sh
pnpm signcheck     # 준비물이 다 있는지만 본다. 빌드는 안 한다

APPLE_ID=you@example.com \
APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop \
APPLE_TEAM_ID=XXXXXXXXXX \
pnpm dist          # 서명 → 공증(notarytool) → 스테이플 → .dmg

codesign -dv --verbose=4 dist/mac-arm64/dira.app   # Authority=Developer ID Application: ...
spctl -a -vvv -t install dist/mac-arm64/dira.app   # accepted 가 나와야 통과다
xcrun stapler validate dist/*.dmg                  # dmg에도 티켓이 붙어야 한다
```

**준비물이 없으면 서명 없는 빌드로 떨어지되 조용히 떨어지지 않는다.** `pnpm dist`가
`sign-preflight.sh`를 먼저 부르고, 무엇이 없어서 건너뛰는지 이름을 찍는다:

```
서명 건너뜀 — 키체인에 'Developer ID Application' 인증서가 없다.
공증 건너뜀 — 비어 있는 환경변수: APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
→ 서명 없는 .app이 나온다. 이 맥에서는 돌지만 다른 맥에서는 Gatekeeper가 막는다.
```

여기서 갈리는 것:

- **`identity`를 안 쓴다.** `null`이면 서명을 끄는 스위치가 되고, 이름을 박으면 그 맥의
  인증서 이름에 빌드가 묶인다. 비워두면 electron-builder가 키체인에서 알아서 찾고
  못 찾으면 이유를 찍고 지나간다 — 우리가 원하는 두 갈래가 그대로다.
- **`entitlements.mac.plist`는 3줄이지만 셋 다 필요하다.** JIT 둘이 없으면 서명된 앱이
  창을 못 띄우고, `disable-library-validation`이 없으면 `Resources/server/`의 sharp
  네이티브 모듈 로드가 막혀 서버가 죽는다. 파일 안에 각각 왜인지 적혀 있다.
- **`.app`과 `.dmg`가 따로 공증된다.** electron-builder는 `.app`만 서명·공증·스테이플하고
  그것으로 `.dmg`를 굽는다. **거기서 멈추면 dmg는 서명조차 안 된 채로 나간다** —
  `spctl -a -t open`이 `rejected / no usable signature`다(실측). 안의 앱이 스테이플돼 있어도
  디스크 이미지는 따로 심사되므로, 받는 맥의 첫 더블클릭이 막힌다. `sign-dmg.sh`가
  `pnpm dist` 끝에서 dmg를 서명 → 공증 → 스테이플한다. **두 산출물 다 스테이플돼 있어야
  받는 맥이 오프라인이어도 통과한다.**
- **자동 업데이트·릴리스 서버는 없다.** 산출물 `.dmg`를 사람이 건넨다(§비목표).

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
7. **자식 서버는 독에 타일을 갖지 않는다.** 서버를 `process.execPath`(`Contents/MacOS/dira`)로
   띄우면 LaunchServices가 자식을 같은 번들의 앱 인스턴스로 등록해 **창을 안 만드는 빈 타일**이
   하나 더 생긴다. `Contents/Frameworks/dira Helper.app`의 실행파일로 띄운다 — 같은 바이너리인데
   그 번들의 `Info.plist`에 `LSUIElement`가 서 있어 타일을 안 만든다(`ELECTRON_RUN_AS_NODE`는
   그대로다). **Helper 번들 이름은 `productName`에서 나온다** — `package.json`의 그 값을 바꾸면
   `main.ts`의 `nodeBin()`이 못 찾고 타일이 조용히 돌아온다(못 찾으면 `execPath`로 떨어진다).

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

**아이콘이 메뉴바에 안 보이면 자산도 코드도 아니다 — 노치다.** 노치 있는 맥에서 메뉴바가 꽉
차면 macOS가 새 상태 항목을 **카메라 하우징 아래 슬롯**에 놓고, 거기서는 이미지도 `setTitle`
텍스트도 그리지 않는다. 항목·메뉴·`열기`·`종료`는 전부 그대로 동작한다.

확인하는 법 — 항목의 x범위가 노치 안이면 이것이다(`abce61c9`에서 실측: 항목 `894–928`,
노치 `771–956`):

```sh
osascript -e 'tell application "System Events" to tell process "Electron" \
  to get {position, size} of menu bar item 1 of menu bar 2'          # 894, 4, 34, 24
osascript -l JavaScript -e 'ObjC.import("AppKit");var s=$.NSScreen.mainScreen; \
  [s.auxiliaryTopLeftArea.size.width, s.auxiliaryTopRightArea.origin.x]+""'   # 771,956
```

**푸는 법은 자리를 만드는 것뿐이다** — 메뉴바 항목 하나를 ⌘-드래그해 치우거나, 디스플레이를
`더 넓은 공간`으로 바꾼다. 앱이 자기 슬롯을 고르는 API는 없다(Electron에도 AppKit에도).

## 트레이 메뉴는 열 때마다 새로 만든다

`로그인 시 자동 실행`(N4)의 상태는 **OS가 갖는다**(`app.getLoginItemSettings()` → macOS 13+는
`SMAppService`). 앱은 그 값을 어디에도 캐시하지 않는다 — 사람이 시스템 설정 → 로그인 항목에서
빼버려도 다음에 연 메뉴가 맞는 상태를 그린다. 그래서 `tray.setContextMenu`(메뉴를 한 번 박고
끝)를 안 쓰고 `click`·`right-click`에서 `popUpContextMenu(trayMenu())`로 매번 만들어 띄운다.

`getLoginItemSettings().status`가 실제 진단값이다: `not-found`(등록된 적 없음) ·
`enabled`(등록됨) · `not-registered`(해제됨). **앱 번들에 손대고 재서명하면 등록이 `not-found`로
사라진다** — 서명이 바뀌면 macOS가 그 등록을 다른 앱의 것으로 본다. 개발 중 껐다 켜도 체크가
풀려 있으면 그 사이에 재빌드·재서명한 것이 원인이다(`00fc34ba`에서 실측).

## 여기 아직 없는 것

자동 업데이트도 릴리스 서버도 없다(§비목표). 산출물 `.dmg`를 사람이 건넨다.

서명·공증은 **끝났다**(`5aa9486d`) — `.app`·`.dmg` 둘 다 `Developer ID Application: Hansol Lim
(L9E4Y653DY)`으로 서명·공증·스테이플되고 `spctl`이 둘 다 `accepted`다.
