# 설치

받는 것이 갈래마다 다르다. 먼저 고른다.

| 갈래 | 받는 것 |
|---|---|
| 맥 앱 + 엔진 | [최신 릴리스](https://github.com/proofer-tech/dira/releases/latest)에서 `.dmg`. 앱이 엔진을 같이 들고 있다 |
| 엔진만 | `git clone` 하나. 화면 없이 cron으로만 돈다 |
| 둘 다 손으로 | 개발자용 |

## 맥 앱 + 엔진

[최신 릴리스](https://github.com/proofer-tech/dira/releases/latest)에서 `.dmg`를
받아 연다. 엔진이 앱 안에 같이 들어 있으므로 따로 `git clone`할 일이 없다.
macOS(Apple Silicon)에서만 돈다.

## 엔진만

화면이 필요 없거나 Linux에서 돌릴 경우다. 요구사항부터 확인한다.

- macOS 또는 Linux
- `python3`(표준 라이브러리만 쓴다 — 추가로 설치할 패키지가 없다)
- `bash`
- 에이전트 CLI 1종 — 기본값은 [`claude`](https://claude.com/claude-code)

```bash
git clone https://github.com/proofer-tech/dira.git ~/Projects/dira
```

조직명은 하이픈이 있는 `proofer-tech`다. 하이픈을 빼면 존재하지 않는 계정이라
clone이 그 자리에서 죽는다.

`tick.sh`는 엔진 코드일 뿐이고 직접 실행하지 않는다 — 여기까지 받았다고 뭔가
돌아가는 건 아니다. 진입점은 워커다. 워커를 만드는 법은 다음 장
[첫 티켓 굴리기](/docs/first-ticket)에서 손으로 해 본다.

## 둘 다 손으로

앱도 쓰고 엔진 레포도 직접 만지고 싶은 경우다. 위 두 갈래를 그대로 순서대로
따라간다 — 앱을 먼저 설치하고, 그와 별개로 `git clone`으로 엔진 레포도 받는다.
앱은 자기 몫의 엔진을 번들 안에 따로 들고 있어(위 표 참조) 당신이 받은 레포와는
별개의 사본이고, 앱이 아는 건 당신이 등록한 큐 경로뿐이다. 그래서 둘 다 같은
티켓 루트(`<프로젝트>/.dira`)만 보고 있으면 서로의 존재를 몰라도 같은 큐를 돌본다.

다음은 [첫 티켓 굴리기](/docs/first-ticket)다.
