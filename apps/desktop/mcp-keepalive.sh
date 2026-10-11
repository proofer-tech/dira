#!/bin/bash
# dira 엔진 MCP 감시 (docs/DESIGN.md P480 값 표) - cron이 매분 부른다. 인자: <엔진>/tick.sh
#   살아 있음: mcp.json의 pid가 mcp_server.py면 아무것도 안 쓴다
#   띄우기:    서버를 떼어 띄우고 첫 줄 {"url"}을 받아 mcp.json(0600)을 쓴다
#   제거:      엔진이 없으면 서버-mcp.json-crontab 줄-mcp/ 디렉터리를 치운다 (인자가 비면 아무것도 안 뺀다)
# ponytail: 포트 점검 없이 47823을 먼저 띄워 보고 서버가 못 묶으면 0(빈 포트)으로 다시 띄운다.

engine=${1:-}
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

if [ ! -f "$engine" ]; then
  p=$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$json" 2>/dev/null | head -1)
  if [ -n "$p" ] && ps -p "$p" -o command= 2>/dev/null | grep -q 'mcp_server\.py'; then kill -TERM "$p" 2>/dev/null; fi
  rm -f "$json"
  tab=$(crontab -l 2>/dev/null) || tab=
  if [ -n "$tab" ]; then
    keep= cut=0
    while IFS= read -r l; do
      case $l in
        '#'*) keep="$keep$l
" ;;
        *mcp/keepalive.sh*) cut=1 ;;
        *) keep="$keep$l
" ;;
      esac
    done <<EOT
$tab
EOT
    [ "$cut" = 1 ] && printf '%s' "$keep" | crontab -
  fi
  rm -rf "$mdir" "$lock"
  exit 0
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
