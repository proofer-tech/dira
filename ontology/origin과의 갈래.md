# origin과의 갈래

**이 레포에는 `master`가 두 벌이고 세션의 push는 앞쪽에서 멈춘다.** 세션이 미는 것은
`~/Projects/dira`의 로컬 `master`이고(프로토콜 §git — `git push . HEAD:master`), 릴리스를
부르는 것은 origin의 `master` push다. 둘을 잇는 자리가 어느 절에도 안 적혀 있던 동안
「릴리즈 해주세요」가 세션에게 오면 할 일이 안 보였다. 값과 계약의 정본은
`docs/DESIGN.md` §릴리스 **R4-2**다 — 여기 값을 다시 적지 않는다.

## 갈래는 릴리스 1건당 정확히 한 커밋씩 자란다 — 로컬이 앞선 수백은 원인이 아니다

릴리스가 나면 러너가 `release v<x.y.z>` bump 커밋을 만들어 **origin에만** 민다. 세션은 origin을
안 만지고 `fetch`도 안 돌아서 로컬은 그것을 받을 길이 없다. 그래서 다음 릴리스를 낼 때 로컬은
origin의 조상이 아니고 `git push origin master`가 non-fast-forward로 거부된다. **일회성 사고가
아니라 릴리스마다 다시 나는 모양이라 규약이 됐다.**

```
git fetch origin master && git rev-list --left-right --count master...origin/master
```

**오른쪽 수 하나가 판정이다.** 실측 `57527e00`에서 병합 전이 `384	1`이었다 — 왼쪽 384는
갈래가 아니라 로컬이 그냥 앞선 것이고 막는 것은 오른쪽 `1`이다. 왼쪽을 원인으로 읽으면
있지도 않은 큰 병합을 준비하게 된다.

## 들이는 것은 병합이고 **rebase는 안 된다** — 로컬 master를 조상으로 쥔 트리가 여럿이다

`git worktree list`가 그 목록이다. 워커 트리 전부와 받는 트리가 로컬 `master`를 조상으로
쥐고 있어서, rebase로 해시를 갈면 그 트리들이 한꺼번에 갈래를 만든다. 미리 재는 것은
**워크트리를 안 건드리는 한 줄**이다.

```
git merge-tree --write-tree master origin/master    # exit 0 = 충돌 0
```

릴리스 커밋이 만지는 파일은 `apps/desktop/package.json` 하나뿐이라(버전 정본이 그 파일
하나다) 로컬이 그 사이 버전을 손으로 안 만졌으면 0이 나온다. **0이 아니면 사람이 정한다** —
원격에 태그가 이미 서 있어서 잘못 고르면 되돌리는 데 사람이 그 태그를 지워야 한다.

## 세션은 그 병합을 **자기 워커 브랜치 위에서** 돈다 — R4-2가 안 적은 자리다

규약은 `git merge origin/master` → `git push . HEAD:master`까지만 적고 **어느 트리에서 도는지를
안 말한다.** 로컬 `master`를 체크아웃한 트리는 `~/Projects/dira` 하나뿐인데 거기는 세션이 손대면
안 되는 받는 트리다 — 더러워지는 순간 `updateInstead`가 워커 전부의 push를 막는다.

**그래서 순서가 이렇게 된다.** 워커 브랜치(`wt/<워커>`) 위에서 `git merge --no-edit
origin/master`를 하고 `git push . HEAD:master`로 넘긴다. 그 push가 fast-forward라 로컬
`master`에 앉는 것은 같은 병합 커밋이고(`57527e00`의 `b3100ed`), 받는 트리는 한 글자도
안 더러워진다. **병합을 받는 트리에서 하려는 손을 여기서 끊는다.**

## 마지막 한 줄은 사람이라 이 요구는 절반이 티켓이고 절반이 사람이다

원격 push는 프로토콜 §git이 세션에게 금지한 자리이고 `release.sh`도 *「세션은 이걸 스스로
돌리지 않는다」*를 못박아 뒀다. 세션 몫(갈래 없애기 · 검증)을 다 내고 나면 남는 것이
`git push origin master`(→ patch) 또는 `gh workflow run release.yml -f bump=<minor|major>`
**한 줄**이고, 어느 쪽이든 러너가 사람 맥과 같은 `release.sh`를 돈다.

**이 모양의 요구는 답을 기다리며 멈추지 않는다.** 세션 몫을 먼저 다 내고, 사람이 고를 것
(어느 bump냐)을 표로 남기고 끝낸다 — 답이 무엇으로 와도 세션 몫의 코드는 안 갈리기 때문이다.

병합이 릴리스를 안 깼다를 **어느 명령으로 재나**는 → [[안 갈렸다는 증명]].

관련: [[안 갈렸다는 증명]] · [[DIRA]]
출처: `57527e00` `db7b5b49`
