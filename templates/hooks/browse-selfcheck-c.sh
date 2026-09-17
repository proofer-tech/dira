#!/bin/bash
# browse.sh C 묶음 자기 검사 - 갈래마다 하나씩(92d19ded §Done when). 열아홉 전부가 아니라
# 조회(links) - 조작(select) - 판정(is)까지만 가면 CDP 왕복과 셀렉터 해석이 실제로 되는지
# 가장 값싸게 증명한다. browse-selfcheck.sh(A 묶음)와 같은 모양이다.
set -eu
_root="$(cd "$(dirname "$0")" && pwd -P)"
_hash="browse-selfcheck-c-$$"
_page_dir="$(mktemp -d)"
cat > "$_page_dir/index.html" <<'HTML'
<html><body>
<a href="/index.html">selfcheck-link</a>
<select id="sel"><option value="a">A</option><option value="b">B</option></select>
<div id="hidden" style="display:none">hidden</div>
</body></html>
HTML

_srv_port=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
python3 -m http.server "$_srv_port" --bind 127.0.0.1 --directory "$_page_dir" >/tmp/browse-selfcheck-c-http.log 2>&1 &
_srv=$!
trap 'kill "$_srv" 2>/dev/null; bash "$_root/browse.sh" "$_hash" release >/dev/null 2>&1; rm -rf "$_page_dir"' EXIT
_waited=0
until curl -s -o /dev/null "http://127.0.0.1:$_srv_port/index.html"; do
  sleep 0.1
  _waited=$((_waited + 1))
  [ "$_waited" -ge 30 ] && { echo "browse-selfcheck-c: 정적 서버가 안 떴다" >&2; exit 1; }
done

bash "$_root/browse.sh" "$_hash" goto "http://127.0.0.1:$_srv_port/index.html"

# 조회 - links
got_links="$(bash "$_root/browse.sh" "$_hash" links)"
case "$got_links" in
  *selfcheck-link*index.html*) ;;
  *) echo "browse-selfcheck-c: links 불일치 - '$got_links'" >&2; exit 1 ;;
esac

# 조작 - select
bash "$_root/browse.sh" "$_hash" select '#sel' b >/dev/null
got_val="$(bash "$_root/browse.sh" "$_hash" js "document.getElementById('sel').value")"
[ "$got_val" = "b" ] || { echo "browse-selfcheck-c: select가 안 먹었다 - '$got_val'" >&2; exit 1; }

# 판정 - is
if bash "$_root/browse.sh" "$_hash" is hidden '#hidden' >/dev/null; then
  :
else
  echo "browse-selfcheck-c: is hidden이 거짓을 냈다" >&2
  exit 1
fi

echo "browse-selfcheck-c: OK (links + select + is 왕복 성공)"
