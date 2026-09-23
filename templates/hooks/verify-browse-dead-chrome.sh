#!/bin/bash
# ef3c728b 회귀 검증 - 세션(빌린 프로세스)은 살아 있는데 크롬 자신이 먼저 죽는 경우
# (OOM-킬 - 크래시)를 흉내낸다. 세션 pid만 보던 옛 `_reclaim`은 이 경우를 놓쳐 죽은
# `DevToolsActivePort`를 계속 돌려줬고, 그게 CDP 호출이 응답 없는 포트에 매번
# `Page.navigate 응답 시간초과`로 막힌 실제 원인이었다(티켓 ef3c728b, 열세 번 재현).
#
# 정본은 여기(templates/hooks/), 큐 사본은 .dira/에 그대로 복사해 쓴다(browse.sh와 같은 자리).
set -u

_src_root="$(cd "$(dirname "$0")" && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$_src_root/browse.sh" "$_src_root/browser.sh" "$TMP/"
mkdir -p "$TMP/workers"

# 더미 chrome - DevToolsActivePort를 쓰자마자 죽는다(크래시 흉내). 세션은 안 죽는다 -
# 이 스크립트($$) 프로세스가 그대로 "빌린 세션" 역할을 계속한다.
cat > "$TMP/fake-chrome" <<'EOF'
#!/bin/bash
dir=""
for a in "$@"; do
  case "$a" in
    --user-data-dir=*) dir="${a#--user-data-dir=}" ;;
  esac
done
mkdir -p "$dir"
echo "9999" > "$dir/DevToolsActivePort"
exit 0
EOF
chmod +x "$TMP/fake-chrome"

export TICKET_LOCAL="$TMP/local"
export DIRA_CHROME_HEADLESS="$TMP/fake-chrome"
mkdir -p "$TICKET_LOCAL"
echo 1 > "$TICKET_LOCAL/browser-limit"

HASH="$(printf '%08x' "$$")"

# 첫 acquire - 더미 크롬이 포트를 쓰고 바로 죽는다. 슬롯엔 죽은 pgid가 남는다.
bash -c "bash '$TMP/browse.sh' '$HASH' url; :" >/dev/null 2>&1
sleep 0.3

# 두 번째 acquire - 같은(살아있는) 세션이 다시 부른다. 옛 `_reclaim`은 세션 pid만 보고
# "살아 있다"며 죽은 크롬의 포트를 그대로 돌려줬다 - 이 케이스가 그 회귀다.
bash -c "bash '$TMP/browse.sh' '$HASH' url; :" >/dev/null 2>&1

log="$TMP/workers/runner.log"
[ -f "$log" ] || : > "$log"
acquires=$(grep -c "BROWSER acquire $HASH" "$log")
reclaims=$(grep -c "BROWSER reclaim $HASH" "$log")

bash "$TMP/browser.sh" release "$HASH" >/dev/null 2>&1

echo "acquire=$acquires reclaim=$reclaims"
if [ "$reclaims" -ge 1 ]; then
  echo "PASS - 죽은 크롬을 세션 pid와 무관하게 회수했다"
  exit 0
else
  echo "FAIL - 죽은 크롬의 포트를 그대로 돌려줬다(reclaim=$reclaims) - _reclaim이 pgid를 안 본다"
  exit 1
fi
