#!/bin/bash
# dira 엔진 MCP 감시 (docs/DESIGN.md P480 값 표) - cron이 매분 부른다. 인자: <엔진>/tick.sh [<앱 번들>]
#   살아 있음: mcp.json의 pid가 mcp_server.py면 아무것도 안 쓴다
#   띄우기:    서버를 떼어 띄우고 첫 줄 {"url"}을 받아 mcp.json(0600)을 쓴다
#   제거:      엔진이 없거나(즉시) 앱이 10분째 없으면(P570, 둘째 인자가 비면 판정 안 함) 서버-crontab 줄들-sweep 데몬-mcp/를 치운다
#              (첫째 인자가 비면 아무것도 안 뺀다). 뺀 줄은 run/uninstalled.crontab에 남긴다
# ponytail: 포트 점검 없이 47823을 먼저 띄워 보고 서버가 못 묶으면 0(빈 포트)으로 다시 띄운다.

engine=${1:-}
app=${2:-}
[ -n "$engine" ] || exit 0

local_dir=$HOME/.config/dira
run=$local_dir/run
json=$run/mcp.json
mdir=$local_dir/mcp
lock=$run/mcp.lock

pid_alive() { # mcp.json의 pid가 살아 있고 명령줄에 mcp_server.py가 있다
  local p
  p=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$json" 2>/dev/null | head -1)
  [ -n "$p" ] && ps -p "$p" -o command= 2>/dev/null | grep -q 'mcp_server\.py'
}

cleanup() { # 엔진이나 앱이 지워졌다 (P570 결정 5)
  local edir p c tab keep removed cut l w drop
  edir=$(dirname "$engine")
  p=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$json" 2>/dev/null | head -1)
  if [ -n "$p" ] && ps -p "$p" -o command= 2>/dev/null | grep -q 'mcp_server\.py'; then kill -TERM "$p" 2>/dev/null; fi
  rm -f "$json"
  tab=$(crontab -l 2>/dev/null) || tab=
  if [ -n "$tab" ]; then
    keep= removed= cut=0
    while IFS= read -r l; do
      drop=0
      case $l in
        '# dira-worker '*|'#dira-worker '*) drop=w ;;
        '#'*) ;;
        *mcp/keepalive.sh*) drop=1 ;;
        *"\"$edir/dispatch.py\" sweep"*|*"\"$edir/remote.py\" sync-all"*) drop=1 ;;
        *) drop=w ;;
      esac
      if [ "$drop" = w ]; then
        drop=0
        w=$(printf '%s' "$l" | sed -n 's/.*"\([^"]*\/workers\/[^"\/]*\.sh\)".*/\1/p' | head -1)
        if [ -n "$w" ] && { [ ! -f "$w" ] || grep -qF "$edir/tick.sh" "$w" 2>/dev/null; }; then drop=1; fi
      fi
      if [ "$drop" = 1 ]; then cut=1; removed="$removed$l
"; else keep="$keep$l
"; fi
    done <<EOT
$tab
EOT
    if [ "$cut" = 1 ]; then
      mkdir -p -m 700 "$run"
      printf '%s' "$removed" >> "$run/uninstalled.crontab"
      printf '%s' "$keep" | crontab -
    fi
  fi
  # sweep 데몬: 명령줄에 <엔진>/dispatch.py와 sweep이 함께 있는 프로세스 (돌고 있는 tick과 세션은 건드리지 않는다)
  ps -axo pid=,command= 2>/dev/null | while read -r p c; do
    case $c in *"$edir/dispatch.py"*" sweep"*) kill -TERM "$p" 2>/dev/null ;; esac
  done
  rm -rf "$mdir" "$lock" "$run/app-missing"
}

app_present() { # 앱 삭제 판정 (P570 결정 3) - 하나라도 있으면 0
  [ -d "$app" ] && return 0
  [ -d "${DIRA_APPS_DIR:-/Applications}/dira.app" ] && return 0
  [ -d "$HOME/Applications/dira.app" ] && return 0
  mdfind "kMDItemCFBundleIdentifier == 'dev.dira.desktop'" 2>/dev/null | grep -v '/\.Trash/' | grep -q .
}

if [ ! -f "$engine" ]; then cleanup; exit 0; fi

if [ -n "$app" ]; then
  if app_present; then
    rm -f "$run/app-missing"
  else
    now=$(date +%s)
    since=$(cat "$run/app-missing" 2>/dev/null)
    case $since in
      ''|*[!0-9]*) mkdir -p -m 700 "$run"; echo "$now" > "$run/app-missing" ;;
      *) [ $((now - since)) -ge 600 ] && { cleanup; exit 0; } ;;
    esac
  fi
fi

pid_alive && exit 0

mkdir -p -m 700 "$run" "$mdir"
if ! mkdir "$lock" 2>/dev/null; then
  # 120초보다 오래된 락은 치우고 이번 분은 넘긴다
  [ -n "$(find "$lock" -maxdepth 0 -mmin +2 2>/dev/null)" ] && rmdir "$lock" 2>/dev/null
  exit 0
fi
trap 'rm -f "$out"; rmdir "$lock" 2>/dev/null' EXIT
pid_alive && exit 0   # 락을 잡는 사이 다른 쪽이 띄웠을 수 있다

umask 077
tokfile=$mdir/token
if [ ! -s "$tokfile" ]; then
  LC_ALL=C od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$tokfile.$$" && mv "$tokfile.$$" "$tokfile"
fi
token=$(cat "$tokfile")
server=$(dirname "$engine")/mcp_server.py
out=$run/mcp.out.$$

start() { # $1 = 포트. 성공하면 url을 url 변수에, pid를 spid에 둔다
  : > "$out"
  DIRA_MCP_TOKEN=$token nohup python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' \
    python3 "$server" --http "127.0.0.1:$1" > "$out" 2>> "$run/mcp.log" < /dev/null &
  spid=$!
  local i
  for i in $(seq 1 50); do
    url=$(sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' "$out" | head -1)
    [ -n "$url" ] && return 0
    kill -0 "$spid" 2>/dev/null || return 1
    sleep 0.2
  done
  kill -TERM "$spid" 2>/dev/null
  return 1
}

start 47823 || start 0 || exit 1
tmp=$json.$$.tmp
printf '{"url": "%s", "token": "%s", "pid": %s, "started_at": "%s"}' "$url" "$token" "$spid" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
chmod 600 "$tmp" && mv "$tmp" "$json"
