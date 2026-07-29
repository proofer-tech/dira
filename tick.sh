#!/bin/bash
# 파일시스템 티켓 디스패처(프로젝트 무관). 프로젝트별 값은 config 파일 하나에만 있다.
#   TICKET_CONFIG=<config> tick.sh              가장 오래된 미할당 열린 티켓 1건을 claude -p 로 실행 (cron 진입점)
#   TICKET_CONFIG=<config> tick.sh list         열린 티켓 큐 상태
#   TICKET_CONFIG=<config> tick.sh unassign H   티켓 H의 할당(session_id) 해제 -> 큐 복귀
#   TICKET_CONFIG=<config> tick.sh reap         스테일 수거만 1회
#   TICKET_CONFIG=<config> tick.sh dryrun       실행 없이 선정 결과만 출력
# TICKET_CONFIG 미지정이면 <상태디렉터리>/config.sh. 계약은 config.sh.example 참조.
set -uo pipefail

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 코드(이 레포)와 상태(로그·토큰·config)를 분리한다. 심링크로 설치돼도 코드 위치를 맞게 찾는다.
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
CODE="$(cd "$(dirname "$SELF")" && pwd -P)"
STATE="${TICKET_STATE:-$HOME/.ticket-cron}"
LOGDIR="$STATE/logs"
RUNLOG="$STATE/runner.log"
PY="$CODE/tickets.py"
mkdir -p "$LOGDIR"

log() { printf '%s [%s] %s\n' "$(date '+%F %T')" "${TICKET_NAME:-?}" "$*" >> "$RUNLOG"; }

# --- 프로젝트 설정 로드 ---
# 엔진은 프로젝트를 모른다. 티켓 루트가 클라우드 마운트에 있어도 config는 로컬이어야 한다
# (마운트가 안 붙은 상태에서도 부트스트랩이 되려면 탐색 로직 자체가 로컬에 있어야 한다).
CONF="${TICKET_CONFIG:-$STATE/config.sh}"
if [ ! -r "$CONF" ]; then
  log "ERROR config 없음: $CONF ($CODE/config.sh.example 참조)"
  echo "config 없음: $CONF ($CODE/config.sh.example 참조)" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$CONF"

TICKET_NAME="${TICKET_NAME:-$(basename "$CONF" .config.sh)}"
TICKET_CWD="${TICKET_CWD:-$HOME}"
TICKET_MAXCONC="${TICKET_MAXCONC:-3}"
TICKET_MAXRUN="${TICKET_MAXRUN:-5400}"
TICKET_PROMPT_FMT="${TICKET_PROMPT_FMT:-%s님 %s티켓 확인 부탁드립니다. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)}"
# 역할·상태 접미사는 tickets.py가 환경변수로 읽는다(미설정이면 pm/designer/developer + -진행중/-완료).
export TICKET_ROLES="${TICKET_ROLES:-}" TICKET_INPROGRESS="${TICKET_INPROGRESS:-}" TICKET_DONE="${TICKET_DONE:-}"

# 티켓 루트: config가 값을 주거나(고정 경로), resolve_ticket_root 함수를 주거나(동적 탐색).
if [ -z "${TICKET_ROOT:-}" ] && declare -F resolve_ticket_root >/dev/null; then
  TICKET_ROOT="$(resolve_ticket_root)"
fi
if [ -z "${TICKET_ROOT:-}" ] || [ ! -d "$TICKET_ROOT" ]; then
  log "ERROR 티켓 루트 없음: '${TICKET_ROOT:-}' (미마운트 또는 권한)"
  echo "티켓 루트 없음: '${TICKET_ROOT:-}'" >&2
  exit 1
fi

# 헤드리스 인증: cron은 로그인 키체인에 접근 못 하므로 장기 토큰을 파일에서 읽는다
#   claude setup-token 으로 발급 후: printf %s '<토큰>' > <상태디렉터리>/oauth-token
[ -r "$STATE/oauth-token" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < "$STATE/oauth-token")"

# cron 실행인데 장기 토큰이 없으면 무의미한 디스패치를 돌지 않는다(키체인 접근 불가)
if [ "${TICKET_CRON:-0}" = "1" ] && [ ! -r "$STATE/oauth-token" ]; then
  if [ ! -f "$STATE/.authwarn" ]; then
    log "AUTH 대기: claude setup-token 발급 후 $STATE/oauth-token 에 저장 필요"
    touch "$STATE/.authwarn"
  fi
  exit 0
fi

CMD="${1:-tick}"

case "$CMD" in
  list)
    python3 "$PY" list "$TICKET_ROOT"; exit $? ;;
  unassign)
    H="${2:-}"; [ -z "$H" ] && { echo "사용법: tick.sh unassign <티켓해시>"; exit 2; }
    P=$(python3 "$PY" find "$TICKET_ROOT" "$H") || exit 1
    python3 "$PY" clear "$P" || exit 1
    RP=$(python3 "$PY" release "$P") || exit 1
    [ "$RP" != "$P" ] && echo "백로그 복귀: $(basename "$RP")"
    log "UNASSIGN $H"; echo "할당 해제: $H"
    exit 0 ;;
  reap)
    python3 "$PY" reap "$TICKET_ROOT" | while IFS= read -r line; do
      [ -n "$line" ] && { log "$line"; echo "$line"; }
    done
    exit 0 ;;
  dryrun|tick) ;;
  *) echo "알 수 없는 명령: $CMD"; exit 2 ;;
esac

# 중복 방지(같은 티켓을 둘이 잡는 것)는 티켓 자체의 원자적 rename(claim)이 담당한다.
# 아래 상한은 그것과 별개 문제 - 서로 다른 티켓을 든 세션이 같은 파일·같은 공유 DB를 동시에 만지는 것.

# --- 스테일 수거: 세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌린다 ---
# 없으면 사람에게 질문하고 rc=0으로 종료한 세션의 티켓이 영구 유실된다(2026-07-28 스트림 실사고 3건).
if [ "$CMD" = "tick" ]; then
  python3 "$PY" reap "$TICKET_ROOT" 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] && log "$line"
  done
fi

# --- 동시 실행 상한 ---
# 살아있는 디스패치 세션 수로 센다(진행중 파일 수로 세지 않는다: reap의 HOLD 티켓이 영구히
# 슬롯을 먹어 루프가 굶는다). 근거는 동시 4세션이 같은 소스·공유 dev DB를 만져 컬럼 드롭이
# 관측된 사고(2026-07-28 스트림). 상한은 config의 TICKET_MAXCONC로 덮어쓴다.
# ponytail: 이 카운트는 머신 전역이다(프로젝트별 아님) - CPU·API·공유자원 경합이 프로젝트를
# 안 가리므로 전역이 맞다. 프로젝트별 상한이 필요해지면 ps 패턴에 프로젝트 표식을 넣어 쪼갠다.
RUNNING=$(ps -eo command | grep -c '[c]laude -p .*--session-id' || true)
if [ "$CMD" = "tick" ] && [ "$RUNNING" -ge "$TICKET_MAXCONC" ]; then
  log "SKIP 동시 실행 상한 $RUNNING/$TICKET_MAXCONC - 이번 tick 디스패치 없음"
  exit 0
fi

# --- 티켓 선정: 상태접미사 없고 session_id 비어있는 것 중 생성일 최고참 1건 ---
CANDS=$(python3 "$PY" select "$TICKET_ROOT") || { log "ERROR select 실패"; exit 1; }
[ -z "$CANDS" ] && exit 0

SID=$(python3 -c 'import uuid;print(uuid.uuid4())')
TPATH=""; THASH=""; TROLE=""
while IFS='|' read -r c_path c_hash c_role; do
  [ -z "$c_path" ] && continue
  if [ "$CMD" = "dryrun" ]; then
    TPATH="$c_path"; THASH="$c_hash"; TROLE="$c_role"; break
  fi
  # 잡기 = 원자적 rename. 이게 진짜 락 - 다른 세션·다른 tick도 이걸 보고 피한다.
  if CPATH=$(python3 "$PY" claim "$c_path" 2>/dev/null); then
    TPATH="$CPATH"; THASH="$c_hash"; TROLE="$c_role"
    break
  fi
done <<EOF
$CANDS
EOF
[ -z "$TPATH" ] && exit 0

# 역할 표시명: config가 TICKET_LABEL_<역할>을 주면 그걸, 없으면 역할 이름 그대로.
LVAR="TICKET_LABEL_$TROLE"
LABEL="${!LVAR:-$TROLE}"
PROMPT=$(printf "$TICKET_PROMPT_FMT" "$LABEL" "$THASH")

if [ "$CMD" = "dryrun" ]; then
  echo "프로젝트: $TICKET_NAME (루트 $TICKET_ROOT, cwd $TICKET_CWD)"
  echo "선정: $THASH ($TROLE)"
  echo "경로: $TPATH"
  echo "프롬프트: $PROMPT"
  exit 0
fi

# 세션키 선발급 -> 즉시 frontmatter 기록(디스패치 순간부터 '할당됨'으로 큐에서 제외)
python3 "$PY" assign "$TPATH" "$SID" "$TROLE / cron-${SID:0:8}" || {
  log "ERROR assign 실패 $THASH"; python3 "$PY" release "$TPATH" >/dev/null; exit 1; }
LOGF="$LOGDIR/$(date '+%Y%m%d-%H%M%S')-${TICKET_NAME}-${THASH}.log"
log "DISPATCH $THASH role=$TROLE sid=$SID log=$(basename "$LOGF")"

cd "$TICKET_CWD" || { log "ERROR cwd 없음 $TICKET_CWD"; python3 "$PY" clear "$TPATH"; python3 "$PY" release "$TPATH" >/dev/null 2>&1; exit 1; }

# 실행 상한(기본 90분). 매달린 세션이 티켓을 무한정 쥐고 있는 걸 막는다.
# 관측치: 정상 티켓은 5~25분, 죽은 세션 하나가 2시간14분을 쥐고 있었다(2026-07-28 스트림 9b3e5c08).
OUTF="$LOGDIR/.out-${SID}"
claude -p "$PROMPT" \
  --session-id "$SID" \
  --dangerously-skip-permissions \
  --output-format json >"$OUTF" 2>>"$LOGF" &
CPID=$!
( sleep "$TICKET_MAXRUN"; kill -TERM "$CPID" 2>/dev/null; sleep 20; kill -KILL "$CPID" 2>/dev/null ) &
WPID=$!
wait "$CPID"; RC=$?
kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
OUT=$(cat "$OUTF" 2>/dev/null); rm -f "$OUTF"
printf '%s\n' "$OUT" >> "$LOGF"

if [ $RC -ne 0 ]; then
  # 실행 실패(또는 상한 초과 강제종료) -> 할당 회수해서 다음 tick이 다시 집도록
  python3 "$PY" clear "$TPATH"
  python3 "$PY" release "$TPATH" >/dev/null 2>&1
  case $RC in
    143|137) log "TIMEOUT $THASH ${TICKET_MAXRUN}s 초과 강제종료 -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")" ;;
    *)       log "FAIL $THASH rc=$RC -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")" ;;
  esac
  exit $RC
fi

# 실제 세션키를 응답에서 확인해 frontmatter와 일치시킨다
REAL=$(printf '%s' "$OUT" | python3 -c \
  'import json,sys
try: print(json.load(sys.stdin).get("session_id",""))
except Exception: print("")' 2>/dev/null)
if [ -n "$REAL" ] && [ "$REAL" != "$SID" ]; then
  python3 "$PY" assign "$TPATH" "$REAL"
  log "NOTE $THASH 세션키 정정 $SID -> $REAL"
fi
log "DONE $THASH sid=${REAL:-$SID}"
exit 0
