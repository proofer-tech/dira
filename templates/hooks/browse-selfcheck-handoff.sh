#!/bin/bash
# browse.sh 핸드오프 자기 검사 - 진짜 chrome-headless-shell 슬롯 하나로 D 묶음 전부를 한 번씩 민다.
#   (1) handoff가 pending을 남기고 (2) 그동안 쓰기 명령은 종료 코드 4, 읽기 명령은 통과
#   (3) 빌린 세션이 죽어도 reclaim이 넘긴 슬롯을 안 거둔다 (4) handback이 handoff-status --wait를 깨운다
#   (5) 돌려받은 뒤 첫 쓰기 명령이 제어를 되찾고 죽은 pid를 지금 세션으로 갈아 적는다(입양)
#   (6) handoff-ttl을 넘긴 넘김은 면제가 끝나 reclaim이 거둔다
# 진짜 ~/.config/dira 풀과 저장소의 workers/를 안 밟는다 - TICKET_LOCAL과 스크립트 사본을 임시 경로에 둔다.
set -u
_src="$(cd "$(dirname "$0")" && pwd -P)"
_tmp="$(mktemp -d)"
mkdir -p "$_tmp/root/workers" "$_tmp/local" "$_tmp/page"
cp "$_src/browse.sh" "$_src/browser.sh" "$_tmp/root/"
export TICKET_LOCAL="$_tmp/local"
_b="$_tmp/root/browse.sh"
_hash="$(printf '%08x' "$$")"
_fail=0

cat > "$_tmp/page/index.html" <<'HTML'
<html><body><h1 id="t">selfcheck-ok</h1>
<button id="b" onclick="document.getElementById('t').textContent='clicked'">눌러줘</button>
</body></html>
HTML
_srv_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
python3 -m http.server "$_srv_port" --bind 127.0.0.1 --directory "$_tmp/page" >/dev/null 2>&1 &
_srv=$!
sleep 600 &
_sess=$!
trap 'kill "$_srv" "$_sess" 2>/dev/null; bash "$_b" "$_hash" release >/dev/null 2>&1; rm -rf "$_tmp"' EXIT

ok() { echo "ok   $1"; }
ng() { echo "FAIL $1"; _fail=1; }
slot_dir() { for s in "$TICKET_LOCAL/browser-pool"/*/; do [ "$(cat "${s}hash" 2>/dev/null)" = "$_hash" ] && { echo "${s%/}"; return 0; }; done; return 1; }

until curl -s -o /dev/null "http://127.0.0.1:$_srv_port/index.html"; do sleep 0.1; done

# 세션 대역 - 오래 사는 sleep을 빌린 세션으로 적고 슬롯을 띄운다.
BROWSER_SESSION_PID="$_sess" bash "$_tmp/root/browser.sh" acquire "$_hash" >/dev/null || { echo "FAIL acquire"; exit 1; }
bash "$_b" "$_hash" goto "http://127.0.0.1:$_srv_port/index.html" >/dev/null || ng "goto"

bash "$_b" "$_hash" hover '#b' --label "단추 위로" >/dev/null || ng "hover"
_cur="$(cat "$(slot_dir)/cursor" 2>/dev/null)"
case "$_cur" in *'"label": "단추 위로"'*'"x":'*|*'"x":'*'"label": "단추 위로"'*) ok "--label이 에이전트 커서(좌표+라벨)를 남긴다" ;; *) ng "에이전트 커서 ($_cur)" ;; esac
[ "$(bash "$_b" "$_hash" handoff-status)" = none ] && ok "넘기기 전 handoff-status = none" || ng "handoff-status none"
bash "$_b" "$_hash" handoff >/dev/null 2>&1; [ $? -eq 2 ] && ok "사유 없는 handoff는 종료 코드 2" || ng "handoff 사용법"
bash "$_b" "$_hash" handoff "구글 로그인을 해 주세요" >/dev/null && ok "handoff 종료 코드 0" || ng "handoff"
_s="$(slot_dir)"
grep -q '^state=pending$' "$_s/handoff" && grep -q "^url=http://127.0.0.1:$_srv_port/index.html$" "$_s/handoff" \
  && ok "handoff 파일 - state=pending, 넘길 때 주소" || ng "handoff 파일 내용"

bash "$_b" "$_hash" click '#b' >/dev/null 2>&1; [ $? -eq 4 ] && ok "넘긴 동안 click은 종료 코드 4" || ng "click 차단"
bash "$_b" "$_hash" text | grep -q selfcheck-ok && ok "넘긴 동안 text는 통과하고 화면은 그대로" || ng "text 통과"
case "$(bash "$_b" "$_hash" handoff-status)" in pending*"구글 로그인"*) ok "handoff-status = pending + 사유" ;; *) ng "handoff-status pending" ;; esac

# 세션이 끝난다 - 넘긴 슬롯은 reclaim이 안 거둔다.
kill "$_sess" 2>/dev/null; wait "$_sess" 2>/dev/null
bash "$_tmp/root/browser.sh" reclaim
_port="$(head -1 "/tmp/qa-$_hash/chrome-profile/DevToolsActivePort" 2>/dev/null)"
[ -d "$_s" ] && curl -s -o /dev/null "http://127.0.0.1:$_port/json/version" && ok "세션이 죽어도 넘긴 슬롯과 크롬이 산다" || ng "회수 면제"

# 사람이 돌려준다 - 기다리던 쪽이 깨어난다.
( sleep 3; bash "$_b" "$_hash" handback "로그인 끝" >/dev/null ) &
_out="$(bash "$_b" "$_hash" handoff-status --wait 30)"; _rc=$?
[ $_rc -eq 0 ] && case "$_out" in returned*"로그인 끝"*) true ;; *) false ;; esac && ok "handback이 --wait를 깨운다 (returned + 메모)" || ng "handback/--wait ($_rc $_out)"

# 다음 세션이 이어받는다 - 첫 쓰기 명령이 제어를 되찾고 pid를 갈아 적는다.
bash "$_b" "$_hash" click '#b' >/dev/null && ok "돌려받은 뒤 click 통과" || ng "click 재개"
[ ! -f "$_s/handoff" ] && ok "첫 쓰기 명령이 handoff 파일을 거둔다" || ng "handoff 회수"
bash "$_b" "$_hash" text | grep -q clicked && ok "같은 브라우저에서 이어진다 (clicked)" || ng "같은 브라우저"
[ "$(cat "$_s/pid")" != "$_sess" ] && grep -q "^BROWSER adopt $_hash" "$_tmp/root/workers/runner.log" && ok "죽은 pid를 새 세션으로 입양" || ng "입양"

bash "$_b" "$_hash" handoff --wait 2 "기다림 상한 검사" >/dev/null 2>&1; [ $? -eq 3 ] && ok "--wait 상한이면 종료 코드 3" || ng "--wait 상한"

# 면제 상한 - since를 아주 옛날로 돌리고 pid를 죽은 값으로 두면 reclaim이 거둔다.
sed -i '' 's/^since=.*/since=1/' "$_s/handoff"
echo 999999 > "$_s/pid"
bash "$_tmp/root/browser.sh" reclaim
[ ! -d "$_s" ] && ok "handoff-ttl을 넘긴 슬롯은 회수된다" || ng "TTL 회수"

[ $_fail -eq 0 ] && echo "browse-selfcheck-handoff: 전부 통과" || echo "browse-selfcheck-handoff: 실패 있음"
exit $_fail
