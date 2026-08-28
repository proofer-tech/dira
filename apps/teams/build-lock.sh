#!/bin/bash
# 빌드 락 헬퍼 - DESIGN.md §세션이 120초 안에 못 뜬다 결정 1 (요구 361d973e).
# `pnpm build`가 이 스크립트를 거쳐 `next build`를 부른다. `next build`는 코어를 다 쓰므로
# 레포 하나로 직렬화한다 - 락 자리는 `git-common-dir` 아래 `dira-build.lock`이라 레포 하나의
# 워크트리 전부가 같은 락을 본다. 모양은 `.dira/push.sh`의 `acquire_lock`과 같다(mkdir이
# 원자적이라 그 자체가 잠금). 상한은 900초 - push의 120초보다 크다(기다리는 대상이 빌드 한 벌).
set -u

_common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || {
  echo "build-lock.sh: git 레포가 아니다" >&2
  exit 1
}
case "$_common_dir" in
  /*) ;;
  *) _common_dir="$PWD/$_common_dir" ;;
esac
_lock="$_common_dir/dira-build.lock"

acquire_lock() {
  local waited=0 lock_pid
  while ! mkdir "$_lock" 2>/dev/null; do
    lock_pid=$(cat "$_lock/pid" 2>/dev/null)
    if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
      echo "build-lock.sh: 스테일 락 회수 - $_lock (죽은 pid $lock_pid)" >&2
      rm -rf "$_lock"
      continue
    fi
    if [ "$waited" -ge 900 ]; then
      echo "build-lock.sh: 락 상한(900초) 초과 - $_lock (쥔 pid ${lock_pid:-?})" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ > "$_lock/pid"
  trap 'rm -rf "$_lock"' EXIT
}

acquire_lock
"$@"
