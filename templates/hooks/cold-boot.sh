#!/bin/bash
# cold boot - 노는 워크트리의 빌드 산출물만 지운다.
# 계약은 이 파일이다(스펙 문서에 사본이 없다) - 지우는 조건은 아래 판정 1~3 전부다.
#
# 정본은 여기(templates/hooks/cold-boot.sh)다. .dira는 gitignore라 추적이 안 되므로 큐마다
# .dira/cold-boot.sh로 복사해 쓴다(dispatch-gate.sh, self-heal.sh, token-rotate.sh와 같은 자리).
# 배선(워커 .sh가 이 파일을 source하게 만드는 것)은 이 티켓의 범위가 아니다 - ffd7f858, aea42dab.
#
# 워커가 dispatch-gate.sh보다 앞에서 source한다. 게이트가 더러운 트리에서 디스패치를 막아도
# 청소는 계속 돌아야 한다 - 디스크가 제일 급한 때가 통합이 막혀 있을 때다.
#
# list/unassign/reap에서는 아무것도 안 한다 - dispatch-gate.sh와 같은 판정, 화면을 여는 것만으로
# 파일이 지워지면 안 된다.
if [ "${1:-tick}" = tick ] || [ "${1:-tick}" = dryrun ]; then
  _cb_dryrun=0
  [ "${1:-tick}" = dryrun ] && _cb_dryrun=1

  # WORKERS = 이 파일을 source한 워커 .sh가 있는 디렉터리(tick.sh:24와 같은 산식 - 심볼릭
  # 링크를 실체 경로로 바꿔야 tick.sh가 만드는 락 경로의 sha1 입력과 일치한다).
  # ROOT = 그 위 - tickets/ workers/ worktrees/가 나란히 있는 이 큐의 자리.
  _cb_workers=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
  _cb_root=$(dirname "$_cb_workers")
  _cb_local="${TICKET_LOCAL:-$HOME/.config/dira}"

  # 자기 트리만 보지 않는다 - 크론에 없는 고아 워커의 트리가 회수 대상의 절반 넘게 물고 있다
  # (결정 3). <루트>/worktrees/ 아래 전부를 훑는다.
  for _cb_wt in "$_cb_root"/worktrees/*/; do
    [ -d "$_cb_wt" ] || continue
    _cb_wt=${_cb_wt%/}
    _cb_w=$(basename "$_cb_wt")

    # 판정 1 - 산 세션이 없다: 락 디렉터리가 없거나 안의 pid가 죽었다.
    _cb_hash=$(python3 -c \
      'import hashlib,sys;print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:8])' \
      "$_cb_workers/$_cb_w")
    _cb_lock="$_cb_local/run/$_cb_w-$_cb_hash.lock"
    _cb_alive=0
    if [ -d "$_cb_lock" ]; then
      _cb_pid=$(cat "$_cb_lock/pid" 2>/dev/null)
      [ -n "$_cb_pid" ] && kill -0 "$_cb_pid" 2>/dev/null && _cb_alive=1
    fi
    if [ "$_cb_alive" = 1 ]; then
      [ "$_cb_dryrun" = 1 ] && echo "SKIP $_cb_w - 산 세션 pid=$_cb_pid"
      continue
    fi

    # 판정 2 - 그 워커가 문 .wip이 없다: owner:가 "<페르소나> / <워커>-<세션>" 꼴이다.
    if grep -l "^owner: .*/ $_cb_w-" "$_cb_root"/tickets/*.wip.md >/dev/null 2>&1; then
      [ "$_cb_dryrun" = 1 ] && echo "SKIP $_cb_w - 문 .wip 있음"
      continue
    fi

    # 판정 3 - 마지막 디스패치로부터 1시간: 로그가 아예 없으면 이 조건은 충족으로 본다.
    if find "$_cb_root/workers/logs" -maxdepth 1 -name "*-$_cb_w-*.log" -mmin -60 \
         -print -quit 2>/dev/null | grep -q .; then
      [ "$_cb_dryrun" = 1 ] && echo "SKIP $_cb_w - 최근 1시간 안에 디스패치됨"
      continue
    fi

    # 셋 다 통과 - 이 트리는 논다. node_modules와 .dira를 prune한 뒤 이름이 .next/dist/out인
    # 디렉터리만 찾는다(결정 1). -L을 안 준다 - .dira 심링크가 자기 조상을 가리켜 무한 재귀한다.
    [ "$_cb_dryrun" = 1 ] && echo "OK $_cb_w - 논다, 산출물을 찾는다"
    find "$_cb_wt" \( -name node_modules -o -name .dira \) -prune -o \
         -type d \( -name .next -o -name dist -o -name out \) -print -prune |
    while IFS= read -r _cb_dir; do
      _cb_rel=${_cb_dir#"$_cb_wt"/}
      # 추적 파일이면 건너뛴다 - 지우면 트리가 더러워져 통합 게이트가 모든 디스패치를 막는다.
      if [ -n "$(git -C "$_cb_wt" ls-files -- "$_cb_rel")" ]; then
        echo "SKIP $_cb_w $_cb_rel - git이 추적하는 파일이 있다"
        continue
      fi
      _cb_size=$(du -sh "$_cb_dir" 2>/dev/null | cut -f1)
      if [ "$_cb_dryrun" = 1 ]; then
        echo "DRYRUN $_cb_w $_cb_dir ($_cb_size)"
      else
        rm -rf "$_cb_dir"
        echo "RM $_cb_w $_cb_dir ($_cb_size)"
      fi
    done
  done

  unset _cb_dryrun _cb_workers _cb_root _cb_local _cb_wt _cb_w _cb_hash _cb_lock \
        _cb_alive _cb_pid _cb_dir _cb_rel _cb_size
fi
