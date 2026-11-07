#!/usr/bin/env bash
# P556-2 - 실제 claude가 턴 도중에 받은 stdin 줄을 그 턴에 섞는지 다음 턴으로 미루는지 확인한다.
# tick.sh와 같은 인자(-p --input-format stream-json --output-format stream-json --verbose)로 띄운다.
# 사용: bash fixtures/interject-real.sh [모델]   (약 20-60초, 실제 모델 호출 비용이 든다)
set -u
MODEL=${1:-haiku}
# tick.sh와 같이 큐의 oauth-token을 쓴다(없으면 로그인된 세션을 쓴다)
[ -r "$HOME/.config/dira/oauth-token" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d "\r\n" < "$HOME/.config/dira/oauth-token")"
D=$(mktemp -d); trap 'rm -rf "$D"; kill $(jobs -p) 2>/dev/null' EXIT
jl() { python3 -c 'import json,sys;print(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}}))' "$1"; }
mkfifo "$D/in"; exec 9<>"$D/in"
jl "Bash 도구로 sleep 8 을 실행한 뒤 'FIRST-DONE' 이라고만 답해라." > "$D/prime"
{ cat "$D/prime"; cat <&8; } 8<"$D/in" 9>&- | timeout 120 claude -p --model "$MODEL" --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions >"$D/out" 2>"$D/err" 9>&- &
sleep 4   # 첫 턴이 sleep 8을 도는 동안
jl "방금 지시와 별개로, 'SECOND-DONE' 이라고만 답해라." >&9
for _ in $(seq 1 60); do [ "$(grep -c '"type":"result"' "$D/out")" -ge 2 ] && break; sleep 1; done
sleep 3
N=$(grep -c '"type":"result"' "$D/out")
echo "claude $(claude --version) model=$MODEL result=${N}개"
if [ "$N" -ge 2 ]; then echo "턴 도중 줄: 다음 턴(result 2개)"; else echo "턴 도중 줄: 같은 턴(result 1개)"; fi
grep '"type":"result"' "$D/out" | python3 -c 'import sys,json
for l in sys.stdin: print("  result:", json.loads(l).get("result","")[:80].replace("\n"," "))'
