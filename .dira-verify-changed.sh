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
cd "$root/apps/teams" || exit 1
./node_modules/.bin/eslint "${paths[@]}" || exit 1

# 테스트 - CI가 P539(f8e38484)에서 깨진 원인은 lib/transcript.ts를 바꾸고 새 테스트 파일 하나만
# 돌린 것이었다. 같은 모듈을 import하는 옛 테스트(transcript.test.ts)가 그대로 깨진 채 push됐다.
# 바뀐 테스트 파일과, 바뀐 모듈 이름을 import 경로에 쓰는 테스트 파일을 `pnpm test`와 같은
# 범위(루트 *.test.ts, lib/**)에서 모아 돌린다.
# ponytail: 이름 grep이라 전이 import는 못 잡는다. 그래도 새면 전체 `pnpm test`로 올린다 - 다만
# scaffold.test.ts처럼 로컬 사본과 비교하는 테스트가 있어 전체 실행은 머신마다 결과가 다르다.
tests=()
for p in "${paths[@]}"; do
  case "$p" in
    *.test.ts | *.test.tsx) tests+=("$p"); continue ;;
  esac
  base=$(basename "$p"); base=${base%.tsx}; base=${base%.ts}
  # 정적 `from "..."`와 동적 `import("...")` 둘 다 따옴표 안 경로 끝이 모듈 이름이면 잡는다.
  while IFS= read -r t; do
    tests+=("${t#./}")
  done < <({ find . -maxdepth 1 -name '*.test.ts'; find lib -name '*.test.ts'; } |
    xargs grep -lE "[\"/]${base}(\\.tsx?)?\"")
done
# `pnpm test`가 안 돌리는 곳(components/ 등)은 여기서도 뺀다 - 루트 직하와 lib/**만 남긴다.
run=()
for t in $(printf '%s\n' "${tests[@]}" | sort -u); do
  case "$t" in
    lib/*) run+=("$t") ;;
    */*) ;;
    *) run+=("$t") ;;
  esac
done
[ ${#run[@]} -eq 0 ] && exit 0
echo "verify-changed: 테스트 ${#run[@]}개 - ${run[*]}" >&2
DIRA_MULTI_TOKEN=1 node --test "${run[@]}"
