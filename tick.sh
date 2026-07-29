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
# 프롬프트 포맷의 %s = 티켓 해시 하나뿐이다(역할 호칭은 페르소나 프로필이 대신한다).
TICKET_PROMPT_FMT="${TICKET_PROMPT_FMT:-%s 티켓을 확인해 주세요. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)}"
# 실행 엔진. config가 TICKET_ENGINE 배열로 덮어쓴다. {prompt}/{sid}는 실행 직전 치환된다.
# ${arr[@]+"..."}는 set -u에서 미정의 배열을 안전하게 전개하는 관용구(bash 3.2 포함).
TICKET_ENGINE=(${TICKET_ENGINE[@]+"${TICKET_ENGINE[@]}"})
[ ${#TICKET_ENGINE[@]} -eq 0 ] && TICKET_ENGINE=(claude -p "{prompt}" --session-id "{sid}" \
  --dangerously-skip-permissions --output-format json)
# 동시 실행 카운트용 ps 패턴. 엔진을 바꾸면 이것도 같이 바꿔야 상한이 실제로 걸린다.
TICKET_ENGINE_PS="${TICKET_ENGINE_PS:-[c]laude -p .*--session-id}"
# 상태 접미사는 tickets.py가 환경변수로 읽는다(미설정이면 .wip/.done).
export TICKET_INPROGRESS="${TICKET_INPROGRESS:-}" TICKET_DONE="${TICKET_DONE:-}"

# 티켓 루트: 기본은 프로젝트(=TICKET_CWD) 안의 .fs-tickets. 프로젝트마다 자기 큐를 갖는다.
# config가 값을 주거나(고정 경로), resolve_ticket_root 함수를 주면(동적 탐색) 그게 이긴다.
if [ -z "${TICKET_ROOT:-}" ] && declare -F resolve_ticket_root >/dev/null; then
  TICKET_ROOT="$(resolve_ticket_root)"
fi
if [ -z "${TICKET_ROOT:-}" ]; then
  TICKET_ROOT="$TICKET_CWD/.fs-tickets"
  # 기본 경로일 때만 만든다. config가 준 경로를 만들어주면 클라우드 마운트가 안 붙은 상태를
  # '빈 큐'로 착각해 조용히 돌아버린다 - 그건 아래 가드에서 에러로 남아야 한다.
  [ -d "$TICKET_CWD" ] && mkdir -p "$TICKET_ROOT/tickets" 2>/dev/null
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
RUNNING=$(ps -eo command | grep -c "$TICKET_ENGINE_PS" || true)
if [ "$CMD" = "tick" ] && [ "$RUNNING" -ge "$TICKET_MAXCONC" ]; then
  log "SKIP 동시 실행 상한 $RUNNING/$TICKET_MAXCONC - 이번 tick 디스패치 없음"
  exit 0
fi

# --- 티켓 선정: 상태접미사 없고 session_id 비어있는 것 중 생성일 최고참 1건 ---
CANDS=$(python3 "$PY" select "$TICKET_ROOT") || { log "ERROR select 실패"; exit 1; }
[ -z "$CANDS" ] && exit 0

SID=$(python3 -c 'import uuid;print(uuid.uuid4())')
TPATH=""; THASH=""; TKIND=""; TPERSONA=""
while IFS='|' read -r c_path c_hash c_kind c_persona; do
  [ -z "$c_path" ] && continue
  if [ "$CMD" = "dryrun" ]; then
    TPATH="$c_path"; THASH="$c_hash"; TKIND="$c_kind"; TPERSONA="$c_persona"; break
  fi
  # 잡기 = 원자적 rename. 이게 진짜 락 - 다른 세션·다른 tick도 이걸 보고 피한다.
  if CPATH=$(python3 "$PY" claim "$c_path" 2>/dev/null); then
    TPATH="$CPATH"; THASH="$c_hash"; TKIND="$c_kind"; TPERSONA="$c_persona"
    break
  fi
done <<EOF
$CANDS
EOF
[ -z "$TPATH" ] && exit 0

PROMPT=$(printf "$TICKET_PROMPT_FMT" "$THASH")

# --- 참조 컨텍스트: config의 TICKET_CONTEXT=("<경로>|<설명>" ...)를 프롬프트 꼬리에 붙인다 ---
# 없는 경로는 건너뛴다(클라우드 마운트가 안 붙은 상태에서 세션이 헛짚지 않게).
# ${arr[@]+"..."}는 set -u에서 미정의 배열을 안전하게 전개하는 관용구(bash 3.2 포함).
CTX=""
for entry in ${TICKET_CONTEXT[@]+"${TICKET_CONTEXT[@]}"}; do
  CPATH_="${entry%%|*}"; CDESC="${entry#*|}"
  [ "$CDESC" = "$entry" ] && CDESC=""          # `|` 없이 경로만 준 경우
  [ -e "$CPATH_" ] || { log "WARN 컨텍스트 경로 없음: $CPATH_"; continue; }
  CTX="$CTX
- $CPATH_${CDESC:+ — $CDESC}"
done
[ -n "$CTX" ] && PROMPT="$PROMPT

참조 컨텍스트(필요하면 읽어보세요):$CTX"

# --- 페르소나: 티켓 frontmatter `persona:` -> <personas>/<이름>/PROFILE.md ---
# 프로필 본문을 프롬프트 머리에 인라인한다(경로만 주면 세션이 안 읽고 시작할 수 있다).
# persona가 비어 있으면 페르소나 없는 평범한 에이전트가 그냥 처리한다(정상 경로, 경고 없음).
# 이름은 있는데 프로필 파일이 없으면 WARN만 남기고 돈다 - 수행 자체는 성립한다.
PROFILE="${TICKET_PERSONAS:-$TICKET_ROOT/personas}/$TPERSONA/PROFILE.md"
if [ -z "$TPERSONA" ]; then
  :
elif [ -r "$PROFILE" ]; then
  PROMPT="당신은 이 프로젝트의 '$TPERSONA'입니다. 아래 프로필이 당신의 역할·권한·판단 기준이고,
티켓을 수행하는 동안 이 페르소나로 일관되게 행동하세요. 프로필과 티켓 지시가 충돌하면 티켓을 따르되
충돌 사실을 티켓 본문에 남기세요.

===== $TPERSONA PROFILE ($PROFILE) =====
$(cat "$PROFILE")
===== PROFILE 끝 =====

$PROMPT"
else
  log "WARN 페르소나 프로필 없음: $PROFILE (페르소나 없이 디스패치)"
fi

# 엔진 argv 조립: 토큰 치환은 여기서만 한다(프롬프트에 공백·개행이 있어도 인자 1개로 유지).
ENGINE=()
for arg in "${TICKET_ENGINE[@]}"; do
  arg="${arg//\{prompt\}/$PROMPT}"
  ENGINE+=("${arg//\{sid\}/$SID}")
done

if [ "$CMD" = "dryrun" ]; then
  echo "프로젝트: $TICKET_NAME (루트 $TICKET_ROOT, cwd $TICKET_CWD)"
  echo "선정: $THASH (kind ${TKIND:--}, 페르소나 ${TPERSONA:-없음})"
  echo "경로: $TPATH"
  echo "엔진: ${TICKET_ENGINE[*]}"
  echo "프롬프트: $PROMPT"
  exit 0
fi

# 세션키 선발급 -> 즉시 frontmatter 기록(디스패치 순간부터 '할당됨'으로 큐에서 제외)
python3 "$PY" assign "$TPATH" "$SID" "${TPERSONA:-agent} / cron-${SID:0:8}" || {
  log "ERROR assign 실패 $THASH"; python3 "$PY" release "$TPATH" >/dev/null; exit 1; }
LOGF="$LOGDIR/$(date '+%Y%m%d-%H%M%S')-${TICKET_NAME}-${THASH}.log"
log "DISPATCH $THASH kind=${TKIND:--} persona=${TPERSONA:-none} sid=$SID log=$(basename "$LOGF")"

cd "$TICKET_CWD" || { log "ERROR cwd 없음 $TICKET_CWD"; python3 "$PY" clear "$TPATH"; python3 "$PY" release "$TPATH" >/dev/null 2>&1; exit 1; }

# 실행 상한(기본 90분). 매달린 세션이 티켓을 무한정 쥐고 있는 걸 막는다.
# 관측치: 정상 티켓은 5~25분, 죽은 세션 하나가 2시간14분을 쥐고 있었다(2026-07-28 스트림 9b3e5c08).
OUTF="$LOGDIR/.out-${SID}"
"${ENGINE[@]}" >"$OUTF" 2>>"$LOGF" &
CPID=$!
# 감시자는 짧은 sleep으로 돈다. 한 방 `sleep $TICKET_MAXRUN`이면 세션이 끝난 뒤에도 그 sleep이
# 상속받은 stdout/stderr를 90분간 쥐고 남아, 호출자(cron·테스트)가 파이프에서 못 빠져나온다.
( SECONDS=0
  while [ "$SECONDS" -lt "$TICKET_MAXRUN" ]; do
    kill -0 "$CPID" 2>/dev/null || exit 0
    sleep 5
  done
  kill -TERM "$CPID" 2>/dev/null; sleep 20; kill -KILL "$CPID" 2>/dev/null ) &
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
