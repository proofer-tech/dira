#!/bin/bash
# browse.sh 자기 검사 - text와 screenshot까지 가는 가장 작은 검사.
# 명령마다 한 벌씩 만들지 않는다(9e30296f §Done when) - A 묶음 중 이 둘이 나머지(goto -
# url - js - click - fill - press - wait - console - release)의 전제고 CDP 왕복이 실제로
# 되는지를 가장 값싸게 증명한다. 로컬 정적 서버를 띄워 고정된 화면을 연다 - 기동 중인 다른
# 앱에 기대면 그 앱이 없을 때 이 검사가 거짓으로 실패한다.
set -eu
_root="$(cd "$(dirname "$0")" && pwd -P)"
_hash="browse-selfcheck-$$"
_page_dir="$(mktemp -d)"
cat > "$_page_dir/index.html" <<'HTML'
<html><body><h1 id="t">selfcheck-ok</h1></body></html>
HTML

# 포트 0(커널이 고름)은 표준 출력 문구를 버전마다 다르게 찍어 못 믿는다 - 먼저 빈 포트를
# 하나 골라 그 번호로 직접 띄운다.
_srv_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
python3 -m http.server "$_srv_port" --bind 127.0.0.1 --directory "$_page_dir" >/tmp/browse-selfcheck-http.log 2>&1 &
_srv=$!
trap 'kill "$_srv" 2>/dev/null; bash "$_root/browse.sh" "$_hash" release >/dev/null 2>&1; rm -rf "$_page_dir"' EXIT
_waited=0
until curl -s -o /dev/null "http://127.0.0.1:$_srv_port/index.html"; do
  sleep 0.1
  _waited=$((_waited + 1))
  [ "$_waited" -ge 30 ] && { echo "browse-selfcheck: 정적 서버가 안 떴다" >&2; exit 1; }
done

bash "$_root/browse.sh" "$_hash" goto "http://127.0.0.1:$_srv_port/index.html"
got_text="$(bash "$_root/browse.sh" "$_hash" text)"
[ "$got_text" = "selfcheck-ok" ] || { echo "browse-selfcheck: text 불일치 - '$got_text'" >&2; exit 1; }

_shot="$(mktemp -u /tmp/browse-selfcheck-XXXXXX.png)"
bash "$_root/browse.sh" "$_hash" screenshot "$_shot" >/dev/null
[ -s "$_shot" ] || { echo "browse-selfcheck: 스크린샷이 비었다" >&2; exit 1; }
rm -f "$_shot"

echo "browse-selfcheck: OK (text + screenshot 왕복 성공)"
