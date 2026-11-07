#!/usr/bin/env bash
# P556-1 - 참견(FIFO 한 줄)이 result 전후에 들어왔을 때 엔진이 읽는지 재현한다.
# tick.sh의 FIFO 배치만 떼어 낸다: exec 9<>FIFO, { cat prime; cat <&8; } 8<FIFO 9>&- | engine.
# 엔진은 stdin 한 줄마다 DELAY초 뒤 result 한 줄을 내는 가짜다(실제 claude는 쓰지 않는다).
# 사용: bash fixtures/interject-race.sh   (약 5초, 임시 디렉터리는 끝나면 지운다)
set -u
D=$(mktemp -d); trap 'rm -rf "$D"; kill $(jobs -p) 2>/dev/null' EXIT
ENGINE='import sys,json,time
n=0
for ln in sys.stdin:
    n+=1
    sys.stderr.write("READ %d %s\n" % (n, json.loads(ln)["message"]["content"])); sys.stderr.flush()
    time.sleep(0.4)
    print(json.dumps({"type":"result","turn":n,"answers":json.loads(ln)["message"]["content"]}), flush=True)'
jl() { python3 -c 'import json,sys;print(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}}))' "$1"; }
nres() { grep -c '"type": "result"' "$D/out" 2>/dev/null || true; }
wait_res() { while [ "$(nres)" -lt "$1" ]; do sleep 0.05; done; }   # result가 n개 될 때까지

start() {  # 세션 기동: 프롬프트 1을 먹이고 엔진을 띄운다
  rm -f "$D/in" "$D/out" "$D/err"; mkfifo "$D/in"; jl "TICKET-A 프롬프트" > "$D/prime"
  exec 9<>"$D/in"
  { cat "$D/prime"; cat <&8; } 8<"$D/in" 9>&- | python3 -c "$ENGINE" >"$D/out" 2>"$D/err" 9>&- &
  EPID=$(pgrep -f "python3 -c import sys,json,time" | tail -1)
}
stop() { exec 9>&-; kill $(pgrep -f "python3 -c import sys,json,time") 2>/dev/null; wait 2>/dev/null; }
report() {  # $1=라벨 $2=참견 문구
  if grep -q "READ [0-9]* $2" "$D/err"; then
    echo "$1: 읽음 - 턴 $(grep "READ [0-9]* $2" "$D/err" | awk '{print $2}')"
  else echo "$1: 안 읽음"; fi
}

# (가) result 전: 턴 1 처리 중에 쓴다
start; jl "HUMAN-가" >&9; wait_res 2; stop; report "(가) result 전" "HUMAN-가"

# (나) result 뒤, 세션 종료 전: result를 본 직후 쓰고 곧바로 죽인다(tick.sh는 REUSE 아니면 바로 TERM)
start; wait_res 1; jl "HUMAN-나" >&9; sleep 0.1; stop; report "(나) result 뒤 종료 전" "HUMAN-나"
echo "     응답: $(grep -c HUMAN-나 "$D/out") 건 (읽었어도 턴 도중 죽어 응답 result가 없다)"

# (나2) 엔진이 이미 죽은 뒤에 쓴다 - 쓰기는 성공하지만 읽을 프로세스가 없다
start; wait_res 1; stop; jl "HUMAN-나2" >/dev/null; report "(나2) 엔진 종료 뒤" "HUMAN-나2"

# (다) result 뒤 재활용 프롬프트 직전: 참견을 쓰고 TICKET-B 프롬프트를 쓴다. OFFSET은 주입 시점 줄 수
start; wait_res 1; jl "HUMAN-다" >&9; OFF=$(wc -l < "$D/out"); jl "TICKET-B 프롬프트" >&9
wait_res 2; stop
report "(다) 재활용 직전" "HUMAN-다"
echo "     TICKET-B 프롬프트는 턴 $(grep "TICKET-B" "$D/err" | awk '{print $2}'), 주입 뒤(offset=$OFF) 첫 result는 턴 $(tail -n +$((OFF+1)) "$D/out" | head -1 | python3 -c 'import json,sys;print(json.loads(sys.stdin.read())["turn"])') (답한 쪽: $(tail -n +$((OFF+1)) "$D/out" | head -1 | python3 -c 'import json,sys;print(json.loads(sys.stdin.read())["answers"])'))"
