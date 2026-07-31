#!/bin/sh
# pnpm release <patch|minor|major> — bump · 태그 · 빌드 · 업로드 한 방 (DESIGN.md §릴리스 R4).
#
# 순서가 계약이다: **선행 확인이 bump보다 앞이다.** 뒤집으면 서명 없는 맥에서 버전만 올라간
# 커밋과 태그가 남고, 자산이 없는 그 태그가 다음 릴리즈 노트의 경계 노릇을 한다 — 되돌리려면
# 사람이 원격 태그를 지워야 한다. 준비물이 없으면 조용히 떨어지지 않고 무엇이 없는지 말한다.
#
# **세션이 돌리는 스크립트가 아니다.** 사람이 자기 맥에서 손으로 친다 (프로토콜 §git —
# 원격 push는 사람 몫이고, 4번이 이 레포에서 원격에 push하는 유일한 자리다).
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
npm version "$bump" -m 'release v%s' || exit 1
ver=$(node -p "require('./package.json').version")

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

if [ -n "$missing" ]; then
  echo "v$ver를 굽긴 했는데 올릴 자산이 모자란다. 없는 것:$missing" >&2
  exit 1
fi

# --generate-notes가 없으면 사람 터미널에서 에디터가 열려 멈춘다. 본문은 무엇이든 상관없다 —
# 사람이 읽는 릴리즈 노트는 앱이 받은 시점에 스스로 만든다(R7).
gh release create "v$ver" "$dmg" "$zip" dist/latest-mac.yml --title "v$ver" --generate-notes || exit 1

echo "v$ver 릴리스 완료 — GitHub Releases에 .dmg · .zip · latest-mac.yml이 올라갔다."
