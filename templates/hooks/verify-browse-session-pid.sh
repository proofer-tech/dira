#!/bin/bash
# efa22ca0 회귀 검증 - browse.sh가 browser.sh acquire를 한 겹 더 감싸는 호출 경로에서도,
# 서로 다른 Bash 호출(매번 새 임시 셸) 사이에 같은 해시로 연속 acquire를 하면 슬롯이
# 재사용되는지 확인한다(reclaim이 안 찍혀야 한다). 실 chrome 대신 더미로 DevToolsActivePort만
# 흉내 낸다 - CDP 핸드셰이크 자체는 검증 대상이 아니다.
#
# 정본은 여기(templates/hooks/), 큐 사본은 .dira/에 그대로 복사해 쓴다(browse.sh와 같은 자리).
set -u

_src_root="$(cd "$(dirname "$0")" && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$_src_root/browse.sh" "$_src_root/browser.sh" "$TMP/"
mkdir -p "$TMP/workers"

# 더미 chrome - --user-data-dir을 받아 DevToolsActivePort를 즉시 쓰고 오래 대기한다(release가
# 죽일 진짜 프로세스 그룹이 있어야 한다).
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
exec sleep 300
EOF
chmod +x "$TMP/fake-chrome"

export TICKET_LOCAL="$TMP/local"
export DIRA_CHROME_HEADLESS="$TMP/fake-chrome"
mkdir -p "$TICKET_LOCAL"
echo 1 > "$TICKET_LOCAL/browser-limit"

HASH="simtest$$"

# 실제 Bash 도구 호출을 흉내낸다 - 매번 `bash -c`로 새 임시 셸(S)을 낳고, 그 안에서
# browse.sh(B) -> browser.sh acquire(C)로 두 겹 래핑한다. 이 스크립트 프로세스($$) 자신이
# "티켓을 쥔 오래 사는 프로세스" 역할이다 - 그 자식인 임시 셸은 매번 죽는다.
for i in 1 2; do
  # 끝에 `; :`를 붙여 bash -c의 "마지막 단순 명령이면 자신을 exec로 대체한다" 최적화를
  # 막는다 - 안 막으면 이 임시 셸(S)이 browse.sh(B)로 그대로 exec돼 겹이 하나 사라져서,
  # 실제 Bash 도구 호출 경로(S가 살아 남아 B를 fork로 낳는다)를 재현하지 못한다.
  bash -c "bash '$TMP/browse.sh' '$HASH' url; :" >/dev/null 2>&1
done

log="$TMP/workers/runner.log"
[ -f "$log" ] || : > "$log"
acquires=$(grep -c "BROWSER acquire $HASH" "$log")
reclaims=$(grep -c "BROWSER reclaim $HASH" "$log")

# 뒷정리 - 더미 chrome(sleep 300) 프로세스 그룹을 남기지 않는다.
bash "$TMP/browser.sh" release "$HASH" >/dev/null 2>&1

echo "acquire=$acquires reclaim=$reclaims"
if [ "$acquires" = 1 ] && [ "$reclaims" = 0 ]; then
  echo "PASS - 두 번째 호출이 같은 슬롯을 재사용했다(reclaim 없음)"
  exit 0
else
  echo "FAIL - 두 번째 호출이 슬롯을 새로 만들었다(acquire=$acquires reclaim=$reclaims) - _session_pid가 오래 사는 세션을 못 가리킨다"
  exit 1
fi
