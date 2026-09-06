#!/bin/bash
# CDP 브라우저 풀 - DESIGN.md §CDP 브라우저를 풀에서 빌린다 (요구 1c20a9ea).
# 세션이 chrome-headless-shell을 직접 안 띄우고 이 파일을 부른다. 값(상한 파일 자리·기본값·
# 대기 상한·로그 문구)은 전부 그 절에서 읽었다 - 여기서 새로 고르지 않는다.
#
# 정본은 여기(templates/hooks/browser.sh)다. .dira는 gitignore라 추적이 안 되므로 큐마다
# .dira/browser.sh로 복사해 쓴다(push.sh - dispatch-gate.sh - cold-boot.sh와 같은 자리).
# `.dira/protocols/cdp.md`가 옮겨 오는 명령줄의 정본이고 이 파일은 그 명령줄을 그대로 옮긴다.
#
# 서브커맨드:
#   acquire <해시> - 슬롯을 빌리고(없으면 새로 띄우고) 포트 한 줄을 stdout에 낸다.
#                    이미 이 해시가 쥔 슬롯이 있으면 새로 안 띄우고 그 포트를 그대로 낸다.
#   release <해시> - 그 슬롯의 브라우저를 죽이고 /tmp/qa-<해시>를 지우고 슬롯을 비운다.
set -u
# job control을 켠다 - 이게 없으면 백그라운드로 띄운 브라우저가 이 스크립트를 부른 셸과 같은
# 프로세스 그룹에 남아서, release/reclaim의 `kill -TERM -- -$pgid`가 그 그룹 전체(=부른 세션
# 자신)를 죽인다. macOS에는 setsid가 없어 `set -m`으로 대신한다 - 이러면 배경 잡마다 새 그룹의
# 리더가 되고, 그 그룹만 안전하게 죽일 수 있다.
set -m

_local="${TICKET_LOCAL:-$HOME/.config/dira}"
_limit_file="$_local/browser-limit"
_pool="$_local/browser-pool"
# 이 스크립트는 <큐 루트>/browser.sh로 복사돼 돈다(push.sh와 같은 자리) - dirname이 곧 루트.
_root="$(cd "$(dirname "$0")" && pwd -P)"
_runlog="$_root/workers/runner.log"
_chrome="${DIRA_CHROME_HEADLESS:-$HOME/.cache/dira/chrome-headless-shell/mac_arm-152.0.7977.64/chrome-headless-shell-mac-arm64/chrome-headless-shell}"

mkdir -p "$_pool" 2>/dev/null

# 상한값 - browser-limit이 없거나 정수가 아니면 결정 2의 기본값 3(session-limit과 같은 모양).
_limit() {
  local n
  n=$(sed -n '1p' "$_limit_file" 2>/dev/null | tr -d ' \t\r\n')
  case "$n" in ''|*[!0-9]*) n=3 ;; esac
  echo "$n"
}

_used() {
  find "$_pool" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
}

# 로그 문구는 결정 5의 모양 그대로 - 앞에 타임스탬프/워커 이름을 안 붙인다(수용조건 (6)이
# `^BROWSER `로 센다).
_log() {
  printf 'BROWSER %s\n' "$1" >> "$_runlog"
}

# 맨 앞에서 죽은 슬롯을 회수한다(결정 4) - pid(빌린 세션)가 죽었으면 브라우저 그룹을 죽이고
# 프로필을 지우고 슬롯을 비운다. cold boot의 수거(§실측 3)와 겹쳐도 안전 - 죽은 pgid에 kill은
# 무해하다.
_reclaim() {
  local slot pid pgid hash waited
  for slot in "$_pool"/*/; do
    [ -d "$slot" ] || continue
    slot=${slot%/}
    pid=$(cat "$slot/pid" 2>/dev/null)
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null && continue
    pgid=$(cat "$slot/pgid" 2>/dev/null)
    hash=$(cat "$slot/hash" 2>/dev/null)
    if [ -n "$pgid" ]; then
      kill -TERM -- "-$pgid" 2>/dev/null
      waited=0
      while kill -0 -- "-$pgid" 2>/dev/null; do
        waited=$((waited + 1))
        [ "$waited" -ge 50 ] && { kill -KILL -- "-$pgid" 2>/dev/null; break; }
        sleep 0.1
      done
    fi
    [ -n "$hash" ] && rm -rf "/tmp/qa-$hash"
    _log "reclaim $hash slot=$(basename "$slot") pid=$pid"
    rm -rf "$slot"
  done
}

# 이미 이 해시가 쥔 슬롯이 있으면 그 포트를 낸다. 없으면 빈 문자열 + 실패 종료.
_existing_port() {
  local slot
  for slot in "$_pool"/*/; do
    [ -d "$slot" ] || continue
    [ "$(cat "${slot}hash" 2>/dev/null)" = "$1" ] || continue
    head -1 "/tmp/qa-$1/chrome-profile/DevToolsActivePort" 2>/dev/null
    return 0
  done
  return 1
}

# cdp.md의 그 명령줄을 그대로 띄운다(플래그 단위로 동일) - 포트는 커널이 고르고
# DevToolsActivePort 첫 줄에서 읽는다. 결과는 전역 _launch_pgid/_launch_port에 남긴다.
_launch() {
  local hash="$1" waited=0
  mkdir -p "/tmp/qa-$hash/chrome-profile/crashpad"
  "$_chrome" --remote-debugging-port=0 \
    --user-data-dir="/tmp/qa-$hash/chrome-profile" \
    --crash-dumps-dir="/tmp/qa-$hash/chrome-profile/crashpad" \
    --disable-breakpad --disable-component-update --disable-background-networking \
    --no-first-run --no-default-browser-check --window-size=1440,900 about:blank \
    </dev/null >/dev/null 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null
  _launch_pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  while [ ! -s "/tmp/qa-$hash/chrome-profile/DevToolsActivePort" ]; do
    sleep 0.2
    waited=$((waited + 1))
    [ "$waited" -ge 50 ] && break
  done
  _launch_port=$(head -1 "/tmp/qa-$hash/chrome-profile/DevToolsActivePort" 2>/dev/null)
}

# "빌린 세션"의 pid를 낸다. $PPID는 이 스크립트를 부른 셸인데, 그 셸이 도구 호출 하나짜리
# 임시 프로세스면(실측 - Bash 도구가 명령마다 새 자식을 낳고 명령이 끝나면 그 자식이 죽는다)
# 스크립트가 끝나자마자 죽어서 다음 회수 스캔이 세션을 죽은 것으로 오판한다. 그 임시 셸의
# 부모(조부모)가 진짜 오래 사는 세션이므로(실측 - 이 값이 티켓 frontmatter의 pid:와 같다)
# 한 단 더 올라간다. 조부모를 못 읽으면(0 또는 조회 실패) $PPID로 물러선다.
_session_pid() {
  local gp
  gp=$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')
  if [ -n "$gp" ] && [ "$gp" != 0 ]; then
    echo "$gp"
  else
    echo "$PPID"
  fi
}

do_acquire() {
  local hash="$1" limit waited=0 logged_wait=0 got_slot n slot used
  [ -n "$hash" ] || { echo "browser.sh: 사용법 - acquire <해시>" >&2; exit 2; }

  _reclaim
  if port=$(_existing_port "$hash") && [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  limit=$(_limit)
  while :; do
    got_slot=""
    # `seq 1 "$limit"`은 안 쓴다 - macOS(BSD) seq는 limit=0일 때 GNU와 달리 빈 목록이 아니라
    # 1과 0을 센다(내림 실측), 그러면 상한 0에서도 slot=0을 빌려 상한이 안 걸린다.
    n=1
    while [ "$n" -le "$limit" ]; do
      slot="$_pool/$n"
      if mkdir "$slot" 2>/dev/null; then
        got_slot="$n"
        break
      fi
      n=$((n + 1))
    done
    [ -n "$got_slot" ] && break

    if [ "$logged_wait" -eq 0 ]; then
      _log "wait $hash used=$(_used)/$limit"
      logged_wait=1
    fi
    if [ "$waited" -ge 300 ]; then
      _log "timeout $hash 300s"
      echo "browser.sh: 상한($limit) 초과 - 300초를 기다려도 슬롯을 못 빌렸다 - $hash" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
    _reclaim
  done

  # pid는 "빌린 세션"이다(위 _session_pid) - 이 스크립트 자신($$)이 아니라, 이 스크립트를
  # 부른 임시 셸도 아니라, 그 임시 셸을 부른 오래 사는 세션이다.
  _session_pid > "$slot/pid"
  echo "$hash" > "$slot/hash"
  _launch "$hash"
  echo "$_launch_pgid" > "$slot/pgid"
  used=$(_used)
  _log "acquire $hash slot=$got_slot used=$used/$limit port=$_launch_port"
  echo "$_launch_port"
}

do_release() {
  local hash="$1" slot pgid n waited=0
  [ -n "$hash" ] || { echo "browser.sh: 사용법 - release <해시>" >&2; exit 2; }
  for slot in "$_pool"/*/; do
    [ -d "$slot" ] || continue
    [ "$(cat "${slot}hash" 2>/dev/null)" = "$hash" ] || continue
    slot=${slot%/}
    pgid=$(cat "$slot/pgid" 2>/dev/null)
    if [ -n "$pgid" ]; then
      kill -TERM -- "-$pgid" 2>/dev/null
      # 죽는 동안 프로필에 쓰던 파일이 남아 rm -rf가 "Directory not empty"로 진다 - 그룹이
      # 실제로 죽을 때까지 짧게 기다리고, 5초를 넘기면 KILL로 마무리한다.
      while kill -0 -- "-$pgid" 2>/dev/null; do
        waited=$((waited + 1))
        [ "$waited" -ge 50 ] && { kill -KILL -- "-$pgid" 2>/dev/null; break; }
        sleep 0.1
      done
    fi
    rm -rf "/tmp/qa-$hash"
    n=$(basename "$slot")
    rm -rf "$slot"
    _log "release $hash slot=$n"
    return 0
  done
}

case "${1:-}" in
  acquire)
    do_acquire "${2:-}"
    ;;
  release)
    do_release "${2:-}"
    ;;
  *)
    echo "browser.sh: 알 수 없는 서브커맨드 '${1:-}' (acquire <해시> | release <해시>)" >&2
    exit 2
    ;;
esac
