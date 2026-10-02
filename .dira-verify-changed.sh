#!/bin/bash
# push.sh의 do_ship이 ship 직전에 부르는 프로젝트별 훅 - 티켓 6ee58f81(CI 실패 대부분이
# `pnpm lint` 단계였던 문제). push.sh(엔진 템플릿, templates/hooks/push.sh)는 이 파일의 존재
# 여부만 보고 내용을 모른다 - pnpm이나 apps/teams는 엔진 코드가 아니라 여기, 이 레포에만 있는
# 파일에 박는다. 이번 ship이 밀어 올릴 커밋들이 건드린 경로를 한 줄에 하나씩 표준입력으로 받는다.
#
# apps/teams의 ts/tsx만 보고, 그 파일이 하나도 없으면 eslint를 아예 안 부른다(문서만 고친
# 커밋을 그대로 push하기 위해 - Done when ②). error가 있으면 0이 아닌 코드로 끝나 push.sh가
# push 전에 멈춘다.
set -u
root="$(cd "$(dirname "$0")" && pwd)"
paths=()
while IFS= read -r p; do
  case "$p" in
    apps/teams/*)
      case "$p" in
        *.ts | *.tsx)
          [ -f "$root/$p" ] && paths+=("${p#apps/teams/}")
          ;;
      esac
      ;;
  esac
done
[ ${#paths[@]} -eq 0 ] && exit 0
( cd "$root/apps/teams" && ./node_modules/.bin/eslint "${paths[@]}" )
