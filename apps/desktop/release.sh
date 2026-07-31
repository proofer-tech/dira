#!/bin/sh
# pnpm release <patch|minor|major> — bump · 태그 · 빌드 · 업로드 한 방 (DESIGN.md §릴리스 R4).
#
# 순서가 계약이다: **선행 확인이 bump보다 앞이다.** 뒤집으면 서명 없는 맥에서 버전만 올라간
# 커밋과 태그가 남고, 자산이 없는 그 태그가 다음 릴리즈 노트의 경계 노릇을 한다 — 되돌리려면
# 사람이 원격 태그를 지워야 한다. 준비물이 없으면 조용히 떨어지지 않고 무엇이 없는지 말한다.
#
# **부르는 자리가 둘이고 스크립트는 하나다.** 사람이 자기 맥에서 손으로 치거나, `master`에
# 앱이 들어왔을 때 `.github/workflows/release.yml`이 macOS 러너에서 부른다(§CI C3). 두 벌로
# 갈라지면 사람 맥에서만 맞는 릴리스가 생긴다. 세션은 여전히 이걸 스스로 돌리지 않는다
# (프로토콜 §git — 4번이 이 레포에서 원격에 push하는 유일한 자리다).
set -u

case "${1:-}" in
  patch|minor|major) bump="$1" ;;
  *) echo "사용법: pnpm release <patch|minor|major>" >&2; exit 1 ;;
esac

cd "$(dirname "$0")" || exit 1

missing=""
add() { missing="$missing
  - $1"; }

# 1. 선행 확인. 하나라도 없으면 여기서 멈춘다 — bump는 이 뒤에 있다.
[ -z "$(git status --porcelain)" ] || add "워킹 트리가 깨끗하지 않다 — 커밋하거나 되돌린 뒤에 친다."

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
[ "$branch" = master ] || add "브랜치가 master가 아니다 (지금 $branch)."

# preflight는 절대 실패하지 않는다(§배포 — 서명 없는 빌드도 그냥 간다). 릴리스는 그 규칙이
# 아니다: 남의 맥으로 나가는 자산이라 건너뛴 항목이 하나라도 있으면 올리지 않는다.
pf=$(./sign-preflight.sh 2>&1)
case "$pf" in
  *건너뜀*) add "서명·공증 준비물이 없다 — 서명 안 된 자산은 릴리스하지 않는다:
$(printf '%s\n' "$pf" | sed 's/^/      /')" ;;
esac

[ -n "${GH_TOKEN:-}" ] || add "GH_TOKEN이 비어 있다 — GitHub Releases에 올릴 수 없다."

command -v gh >/dev/null 2>&1 || add "gh가 없다 — 5번이 자산을 올리는 명령이다 (brew install gh)."

for f in owner repo; do
  v=$(node -p "require('./package.json').build.publish.$f" 2>/dev/null)
  case "$v" in
    ''|undefined|'<'*) add "package.json의 build.publish.$f가 안 채워졌다 (지금 '${v:-}') — 레포를 만들고 사람이 채운다." ;;
  esac
done

if [ -n "$missing" ]; then
  echo "릴리스를 멈춘다. 없는 것:$missing" >&2
  exit 1
fi

# 2~3. version bump + 커밋 + 태그 v<x.y.z>. 정본은 이 package.json 하나다(R2).
#
# **커밋·태그는 npm에 맡기지 않는다.** `npm version`은 패키지 디렉터리에 `.git`이 있을 때만
# 커밋·태그를 만든다. 여기 `.git`은 레포 루트에 있고 `apps/desktop`에는 없어서, npm은 조용히
# bump만 하고 0으로 끝난다 — 커밋 0 · 태그 0 · 4번의 push가 `Everything up-to-date`.
# 그러면 5번은 돌아서 자산이 나오고 `gh release create`가 **버전 커밋이 없는 원격 HEAD에**
# `v<x.y.z>` 태그를 박는다: 받는 사람의 앱 버전과 태그가 가리키는 소스가 갈린다(실측 2026-08-01).
npm version "$bump" --no-git-tag-version || exit 1
ver=$(node -p "require('./package.json').version")
git commit -q -m "release v$ver" package.json || exit 1
# `-a`가 빠지면 lightweight 태그가 되고 **4번의 `--follow-tags`가 그걸 안 민다.** 커밋만
# 올라가고 태그는 로컬에 남아서, 5번의 `gh release create`가 원격 기본 브랜치 HEAD에 같은
# 이름의 태그를 새로 만든다 — 로컬 태그와 원격 태그가 다른 객체가 된다(실측 2026-08-01).
git tag -a "v$ver" -m "release v$ver" || exit 1

# 4. 원격에 나가는 유일한 자리.
git push origin master --follow-tags || exit 1

# 5. **한 번만 굽는다.** 두 번 구우면 두 번째 electron-builder가 `sign-dmg.sh`의 서명·스테이플을
# 덮어서, 올라가는 `.dmg`는 sign-dmg가 막으려던 상태 그대로다 — 받는 맥의 첫 더블클릭이
# Gatekeeper에 막히고 올린 사람은 모른다 (§릴리스 R4-5). 그래서 publish는 electron-builder가
# 아니라 gh가 한다. `build.publish`는 그대로다 — latest-mac.yml을 굽는 것이 그 설정이다.
pnpm run dist || exit 1

# 올리기 전에 세 자산이 실제로 있는지 본다. 특히 latest-mac.yml이 빠지면 자동 업데이트는
# 에러가 아니라 **아무 일도 안 일어남**으로 죽는다(R1 첫 줄). 없는 채로 올리는 대신 멈춘다.
dmg=$(ls dist/*.dmg 2>/dev/null | head -1)
zip=$(ls dist/*.zip 2>/dev/null | head -1)
[ -n "$dmg" ] || add "dist/*.dmg — 사람이 건네는 첫 설치본."
[ -n "$zip" ] || add "dist/*.zip — 자동 업데이트가 실제로 내려받는 자산."
[ -f dist/latest-mac.yml ] || add "dist/latest-mac.yml — 이게 없으면 앱이 새 버전을 못 찾는다(조용히)."

# **자산이 있는 것과 받는 맥에서 열리는 것은 다르다.** 실측 2026-08-01: electron-builder가
# 공증까지 마치고 그 뒤에 죽으면 `pnpm dist`의 `&&` 사슬이 끊겨 `sign-dmg.sh`가 안 돈다 —
# 파일은 셋 다 나와 있고 `.dmg`만 공증이 안 된 채다. 위 세 줄은 그걸 못 잡는다.
# 여기서 안 잡으면 잡는 것은 받는 사람의 첫 더블클릭이고, 올린 사람은 모른다.
[ -z "$dmg" ] || spctl -a -t open --context context:primary-signature "$dmg" >/dev/null 2>&1 \
  || add "$dmg가 Gatekeeper에 막힌다 — 공증·스테이플이 안 됐다 (./sign-dmg.sh 로그를 보라)."
xcrun stapler validate dist/mac-arm64/dira.app >/dev/null 2>&1 \
  || add ".app에 공증 티켓이 스테이플되지 않았다 — .zip으로 나가는 자동 업데이트가 이걸 받는다."

if [ -n "$missing" ]; then
  echo "v$ver를 굽긴 했는데 올릴 자산이 모자란다. 없는 것:$missing" >&2
  exit 1
fi

# --generate-notes가 없으면 사람 터미널에서 에디터가 열려 멈춘다. 본문은 무엇이든 상관없다 —
# 사람이 읽는 릴리즈 노트는 앱이 받은 시점에 스스로 만든다(R7).
gh release create "v$ver" "$dmg" "$zip" dist/latest-mac.yml --title "v$ver" --generate-notes || exit 1

echo "v$ver 릴리스 완료 — GitHub Releases에 .dmg · .zip · latest-mac.yml이 올라갔다."
