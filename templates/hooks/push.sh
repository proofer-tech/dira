#!/bin/bash
# 통합 push 헬퍼 - DESIGN.md §통합 push의 벽 (요구 0146fd70, 답 a4b95659, 결정 1~5).
# 세션이 `git push . HEAD:<통합 브랜치>` 대신 이 파일을 부른다(인자 0개). 경쟁 push 잔해로 받는
# 트리가 더러워도 통합이 통과하고, 사람이 그 트리를 직접 고친 내용은 잃지 않는다.
#
# 정본은 여기(templates/hooks/push.sh)다. .dira는 gitignore라 추적이 안 되므로 큐마다
# .dira/push.sh로 복사해 쓴다(dispatch-gate.sh - self-heal.sh - token-rotate.sh - cold-boot.sh와
# 같은 자리). 큐 배선(세션이 이 파일을 부르게 만드는 것)은 이 티켓 범위가 아니다 - 06d2fc41.
# 게이트 로그가 같은 판정을 부르는 자리도 이 파일이 아니다 - a1babb18.
#
# `<통합 브랜치>`는 dispatch-gate.sh와 같은 방식으로 큐 사본을 만들 때 GUI가 채운다
# (DESIGN.md §통합 브랜치가 설정이 된다 결정 4) - 정본에는 자리표시자가 그대로 남는다.
#
# 서브커맨드:
#   (없음)   - 락 -> 죽은 실행이 남긴 stash 되돌리기 -> 받는 트리 정리(잔해 버림/사람 편집 옮김)
#              -> push -> 사람 편집 되돌리기. stdout과 종료 코드는 git push 것을 그대로 낸다.
#   classify <경로>... - 각 경로가 "잔해"인지 "사람 편집"인지 한 줄에 한 낱말로 답한다.
#              락을 안 쥔다 - 아무것도 안 고치는 조회다.
#   ship <해시> "<제목>" ["<본문>"] - 커밋(뺄 것 없으면 건너뜀) -> 위 (없음) 경로 -> 거부되면
#              rebase <통합 브랜치> 후 1회만 재시도. DESIGN.md §마무리 의례를 헬퍼가 감싼다.
#
# rebase는 기본적으로 안 한다 - non-fast-forward 거부는 종전대로 세션의 몫이다. 이 스크립트가
# 만지는 트리는 받는 트리(git-common-dir의 부모) 하나뿐이다 - **`ship`만 예외**로 자신이 도는
# 워크트리에 커밋하고 그 워크트리에서 rebase <통합 브랜치>를 1회 돌린다(§계약 "경계를 하나 넘는다").
set -u
_branch="<통합 브랜치>"

_common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || {
  echo "push.sh: git 레포가 아니다" >&2
  exit 1
}
case "$_common_dir" in
  /*) ;;
  *) _common_dir="$PWD/$_common_dir" ;;
esac
_recv=$(cd "$(dirname "$_common_dir")" && pwd -P)
_lock="$_common_dir/dira-push.lock"
_stashed=0

# 락을 쥔다(결정 2) - mkdir이 원자적이라 그 자체가 잠금이다. 상한 120초, 죽은 pid가 든 락은 회수.
acquire_lock() {
  local waited=0 lock_pid
  while ! mkdir "$_lock" 2>/dev/null; do
    lock_pid=$(cat "$_lock/pid" 2>/dev/null)
    if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
      echo "push.sh: 스테일 락 회수 - $_lock (죽은 pid $lock_pid)" >&2
      rm -rf "$_lock"
      continue
    fi
    if [ "$waited" -ge 120 ]; then
      echo "push.sh: 락 상한(120초) 초과 - $_lock (쥔 pid ${lock_pid:-?})" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ > "$_lock/pid"
  trap 'rm -rf "$_lock"' EXIT
}

# 모드만 바뀌었나(삭제-새 파일과 함께 결정 3이 "비교 불성립 -> 사람 편집"으로 못박은 셋째 모양).
# `git diff --raw`는 워크트리 쪽 blob 칸을 항상 0으로 채운다(실제로 안 돌려 본다) - 그래서 그
# 칸끼리 비교하지 않고, 지금 파일의 실제 blob을 옛 blob(HEAD)과 직접 비교한다.
mode_only_change() {
  local p="$1" line old_mode new_mode old_sha cur_blob
  line=$(git -C "$_recv" diff --raw --no-abbrev HEAD -- "$p" 2>/dev/null)
  [ -z "$line" ] && return 1
  set -- $line
  old_mode=${1#:}; new_mode=$2; old_sha=$3
  [ "$old_mode" = "$new_mode" ] && return 1
  cur_blob=$(git -C "$_recv" hash-object "$_recv/$p" 2>/dev/null) || return 1
  [ "$cur_blob" = "$old_sha" ]
}

# 경로 하나를 "잔해"/"사람편집"으로 답한다. $2는 그 경로를 포함한 여러 경로를 한 번에 넘겨 얻은
# `git log --all --raw` 출력(호출자가 한 번만 만들어 재사용 - 결정 3의 "한 번만 훑는다").
classify_one() {
  local p="$1" hist="$2" blob
  if [ ! -e "$_recv/$p" ]; then
    echo "사람편집"
    return
  fi
  if mode_only_change "$p"; then
    echo "사람편집"
    return
  fi
  blob=$(git -C "$_recv" hash-object "$_recv/$p" 2>/dev/null) || {
    echo "사람편집"
    return
  }
  if printf '%s\n' "$hist" | awk -v p="$p" '$0 ~ ("\t" p "$"){print $4}' | grep -qx "$blob"; then
    echo "잔해"
  else
    echo "사람편집"
  fi
}

do_classify() {
  local hist p
  [ $# -eq 0 ] && return 0
  hist=$(git -C "$_recv" log --all --raw --no-abbrev --format= -- "$@" 2>/dev/null)
  for p in "$@"; do
    classify_one "$p" "$hist"
  done
}

# 앞 실행이 stash push 뒤 pop 전에 죽어서 남긴 표식을 되돌린다(결정 4의 "다음 헬퍼 실행이 락을
# 쥔 직후 그 표식이 붙은 항목을 먼저 되돌린다"). pop이 충돌하면 그 항목은 스택에 남기고 멈춘다 -
# 사람이 볼 몫이지 이 스크립트가 추측할 몫이 아니다.
recover_stale_autostash() {
  local idx
  while :; do
    idx=$(git -C "$_recv" stash list 2>/dev/null | grep -n "dira-autostash " | tail -1 | cut -d: -f1)
    [ -z "$idx" ] && break
    idx=$((idx - 1))
    if git -C "$_recv" stash pop "stash@{$idx}" >/dev/null 2>&1; then
      echo "push.sh: 앞 실행이 남긴 dira-autostash를 되돌렸다 (stash@{$idx})" >&2
    else
      git -C "$_recv" reset --hard HEAD >/dev/null 2>&1
      echo "push.sh: dira-autostash pop이 충돌해 스택에 남겼다 - git -C $_recv stash list" >&2
      break
    fi
  done
}

# 받는 트리를 판정하고 치운다(결정 3) - 추적 파일(`-uno`)만 본다. 잔해는 버리고, 사람 편집은
# 이번 실행 몫으로 stash에 옮긴다(pop은 push 뒤 pop_own_autostash가 한다).
cleanup_dirty_tree() {
  local status_out line paths=() trash=() human=() hist p worker ts
  status_out=$(git -C "$_recv" status --porcelain -uno)
  [ -z "$status_out" ] && return 0
  while IFS= read -r line; do
    [ -n "$line" ] && paths+=("${line:3}")
  done <<EOF
$status_out
EOF
  hist=$(git -C "$_recv" log --all --raw --no-abbrev --format= -- "${paths[@]}" 2>/dev/null)
  for p in "${paths[@]}"; do
    case "$(classify_one "$p" "$hist")" in
      잔해) trash+=("$p") ;;
      *) human+=("$p") ;;
    esac
  done
  if [ ${#trash[@]} -gt 0 ]; then
    git -C "$_recv" restore --staged --worktree -- "${trash[@]}"
    echo "push.sh: 잔해 버림 - ${trash[*]}" >&2
  fi
  if [ ${#human[@]} -gt 0 ]; then
    worker=$(basename "$(pwd -P)")
    ts=$(date +%Y-%m-%dT%H:%M:%S)
    git -C "$_recv" stash push -m "dira-autostash $ts $worker" -- "${human[@]}"
    _stashed=1
    echo "push.sh: 사람 편집 옮김 - ${human[*]}" >&2
  fi
}

# push 뒤 이번 실행이 옮긴 사람 편집을 되돌린다(결정 4). 락을 쥔 채로 왔으므로 stash@{0}은
# 언제나 이번 실행이 방금 만든 그 항목이다(결정 5 - 스택을 만지는 것은 한 세션뿐).
pop_own_autostash() {
  [ "$_stashed" = 1 ] || return 0
  if git -C "$_recv" stash pop "stash@{0}" >/dev/null 2>&1; then
    return 0
  fi
  git -C "$_recv" reset --hard HEAD >/dev/null 2>&1
  echo "push.sh: pop이 충돌해 사람 편집을 stash@{0}에 남겼다 - git -C $_recv stash list" >&2
}

# 락 -> 정리 -> push -> 되돌리기 한 판. 락은 매번 새로 쥐고 반납한다(ship이 이걸 두 번 부를 수
# 있어서 - rebase 사이에는 안 쥐고 있어야 남의 push가 그 창을 쓴다).
push_once() {
  acquire_lock
  recover_stale_autostash
  cleanup_dirty_tree
  git push . HEAD:"$_branch"
  local rc=$?
  pop_own_autostash
  rm -rf "$_lock"
  return "$rc"
}

main_push() {
  push_once
  exit "$?"
}

# 커밋(뺄 것 없으면 건너뜀) -> push_once -> 거부되면 이 워크트리에서 rebase <통합 브랜치> 후
# 1회만 재시도.
do_ship() {
  local hash="$1" title="$2" body="${3:-}" rc
  [ -n "$hash" ] && [ -n "$title" ] || {
    echo 'push.sh: 사용법 - ship <해시> "<제목>" ["<본문>"]' >&2
    exit 2
  }
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
  fi
  if ! git diff --cached --quiet; then
    if [ -n "$body" ]; then
      git commit -q -m "$title" -m "$body" -m "Ticket: $hash" || exit $?
    else
      git commit -q -m "$title" -m "Ticket: $hash" || exit $?
    fi
  fi
  push_once
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if git rebase "$_branch"; then
      push_once
      rc=$?
    else
      rc=$?
    fi
  fi
  exit "$rc"
}

case "${1:-}" in
  classify)
    shift
    do_classify "$@"
    ;;
  ship)
    shift
    do_ship "$@"
    ;;
  "")
    main_push
    ;;
  *)
    echo "push.sh: 알 수 없는 서브커맨드 '$1' (classify | ship | 없음)" >&2
    exit 2
    ;;
esac
