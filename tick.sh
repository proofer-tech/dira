#!/bin/bash
# 파일시스템 티켓 디스패처(프로젝트 무관). 진입점은 워커 스크립트다 - 이 파일을 직접 부르지 않는다.
# 워커 = <티켓루트>/workers/<이름>.sh, 이 파일을 `.`(source)하는 두 줄짜리 셸 스크립트.
# 크론잡 하나가 워커 하나고, 한 번 실행에 티켓 1건을 동기로 끝낸다. 더 돌리려면 워커를 더 둔다.
#   <루트>/workers/w1.sh              티켓 1건 디스패치 (cron 진입점)
#   <루트>/workers/w1.sh list         열린 티켓 큐 상태
#   <루트>/workers/w1.sh unassign H   티켓 H의 할당(session_id) 해제 -> 큐 복귀
#   <루트>/workers/w1.sh reap         스테일 수거만 1회
#   <루트>/workers/w1.sh dryrun       실행 없이 선정 결과만 출력
# 워커 계약(설정 가능한 값)은 worker.sh.example 참조.
set -uo pipefail

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 코드(이 레포)와 워커(티켓 루트 안)는 다른 곳에 산다.
#   BASH_SOURCE = 이 파일(source돼도 맞다)  |  $0 = 나를 source한 워커 스크립트
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
CODE="$(cd "$(dirname "$SELF")" && pwd -P)"
PY="$CODE/tickets.py"

# 워커 위치가 곧 티켓 루트다: <루트>/workers/<이름>.sh. 그래서 루트를 어디에도 적지 않는다.
WORKERS="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)"
if [ "$(basename "${WORKERS:-/}")" != "workers" ]; then
  echo "이 파일은 직접 실행하지 않는다. <티켓루트>/workers/<이름>.sh 를 만들어 source하세요 ($CODE/worker.sh.example 참조)" >&2
  exit 2
fi
TICKET_ROOT="$(dirname "$WORKERS")"
LOGDIR="$WORKERS/logs"
RUNLOG="$WORKERS/runner.log"
# 머신 로컬 상태(토큰·실행 락). 티켓 루트가 공유 드라이브여도 비밀과 pid는 여기 남는다.
LOCAL="${TICKET_LOCAL:-$HOME/.config/dira}"
mkdir -p "$LOGDIR" "$LOCAL/run" "$TICKET_ROOT/tickets"

log() { printf '%s [%s] %s\n' "$(date '+%F %T')" "${TICKET_NAME:-?}" "$*" >> "$RUNLOG"; }

TICKET_NAME="${TICKET_NAME:-$(basename "$0" .sh)}"
# 기본 작업 디렉터리 = 루트의 부모(<프로젝트>/.dira/workers/w1.sh -> <프로젝트>)
TICKET_CWD="${TICKET_CWD:-$(dirname "$TICKET_ROOT")}"
TICKET_MAXRUN="${TICKET_MAXRUN:-5400}"
# 최초 프롬프트가 FIFO를 다 통과할 때까지 기다리는 상한. 프롬프트는 FIFO 버퍼(macOS 16KB)보다
# 크므로 엔진이 stdin을 빨아야만 write가 끝난다 - 엔진이 기동 중 멎으면 영영 안 끝난다.
TICKET_FEED_TIMEOUT="${TICKET_FEED_TIMEOUT:-120}"
# 프롬프트 포맷의 %s = 티켓 해시 하나뿐이다(역할 호칭은 페르소나 프로필이 대신한다).
TICKET_PROMPT_FMT="${TICKET_PROMPT_FMT:-%s 티켓을 확인해 주세요. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)}"
# 실행 엔진. 워커가 TICKET_ENGINE 배열로 덮어쓴다. {prompt}/{sid}는 실행 직전 치환된다.
# ${arr[@]+"..."}는 set -u에서 미정의 배열을 안전하게 전개하는 관용구(bash 3.2 포함).
# 기본 엔진은 스트리밍 입력이다: 최초 프롬프트도 argv가 아니라 stdin(FIFO)으로 간다.
# 그래야 세션이 도는 동안 사람이 같은 입구로 말을 걸 수 있다(참견).
TICKET_ENGINE=(${TICKET_ENGINE[@]+"${TICKET_ENGINE[@]}"})
[ ${#TICKET_ENGINE[@]} -eq 0 ] && TICKET_ENGINE=(claude -p --session-id "{sid}" \
  --dangerously-skip-permissions \
  --input-format stream-json --output-format stream-json --verbose)
# 상태 접미사는 tickets.py가 환경변수로 읽는다(미설정이면 .wip/.done).
export TICKET_INPROGRESS="${TICKET_INPROGRESS:-}" TICKET_DONE="${TICKET_DONE:-}"

# Claude를 명시적으로 쓸 때만 헤드리스 OAuth 토큰을 읽는다. Codex의 인증은 자체 설정을 쓴다.
if [ "$(basename "${TICKET_ENGINE[0]}")" = "claude" ]; then
  # claude setup-token 으로 발급 후: printf %s '<토큰>' > ~/.config/dira/oauth-token
  [ -r "$LOCAL/oauth-token" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < "$LOCAL/oauth-token")"
fi

CMD="${1:-tick}"

# 비대화형 Claude만 장기 토큰이 없으면 디스패치하지 않는다. Codex 등 다른 엔진은 자체 인증을 쓴다.
if [ "$CMD" = "tick" ] && [ "$(basename "${TICKET_ENGINE[0]}")" = "claude" ] \
  && [ ! -r "$LOCAL/oauth-token" ] && [ ! -t 1 ]; then
  if [ ! -f "$LOCAL/.authwarn" ]; then
    log "AUTH 대기: claude setup-token 발급 후 $LOCAL/oauth-token 에 저장 필요"
    touch "$LOCAL/.authwarn"
  fi
  exit 0
fi

case "$CMD" in
  list)
    python3 "$PY" list "$TICKET_ROOT"; exit $? ;;
  unassign)
    H="${2:-}"; [ -z "$H" ] && { echo "사용법: $(basename "$0") unassign <티켓해시>"; exit 2; }
    P=$(python3 "$PY" find "$TICKET_ROOT" "$H") || exit 1
    # 산 세션을 두고 할당만 풀면 티켓이 다시 열려 두 워커가 같은 티켓을 문다
    # (2026-08-01 실사고: b7bacafb·a461c2f7이 각각 세션 2개를 달았다). 죽은 뒤에 풀어라.
    # reap과 같은 근거를 쓴다: pid 생존, 그리고 ps의 --session-id.
    UPID=$(sed -n 's/^pid:[[:space:]]*//p' "$P" | head -1 | tr -d "\"' ")
    USID=$(sed -n 's/^session_id:[[:space:]]*//p' "$P" | head -1 | tr -d "\"' ")
    ALIVE=""
    case "$UPID" in ''|*[!0-9]*) ;; *) ps -p "$UPID" -o pid= >/dev/null 2>&1 && ALIVE="pid=$UPID" ;; esac
    # ps를 변수에 먼저 담고 셸이 매칭한다. `ps -eo command= | grep -- "--session-id $USID"`는
    # **grep 자신을 문다** — grep의 명령줄에 그 문자열이 그대로 들어 있고 ps가 그걸 본다.
    # 그러면 세션이 죽어도 항상 살아 있다고 판정해 unassign이 영영 거부된다(CI 실측
    # 2026-08-01: `거부: ... (session=dead-sid)`). 파이프를 없애면 매칭 시점에 grep이 없다.
    if [ -z "$ALIVE" ] && [ -n "$USID" ]; then
      PSOUT=$(ps -eo command= 2>/dev/null)
      case "$PSOUT" in *"--session-id $USID"*) ALIVE="session=$USID" ;; esac
    fi
    # 주인 세션이 자기 손으로 푸는 것은 통과다. 왕복 절차(PM PROFILE §요구사항 왕복 3단계)가
    # 부르는 자리가 바로 여기이고, 거기서 산 pid는 **부르는 세션 자신**이다(티켓 828dc247).
    # 조상 사슬로 본다 - 남의 산 세션을 푸는 것은 사슬에 없으므로 그대로 막힌다.
    if [ -n "$ALIVE" ] && [ -n "$UPID" ]; then
      ANC=$$
      while [ "$ANC" != "0" ] && [ "$ANC" != "1" ] && [ -n "$ANC" ]; do
        [ "$ANC" = "$UPID" ] && { ALIVE=""; break; }
        ANC=$(ps -p "$ANC" -o ppid= 2>/dev/null | tr -d ' ')
      done
    fi
    if [ -n "$ALIVE" ]; then
      echo "거부: $H 의 세션이 아직 살아 있다($ALIVE). 먼저 끝내거나 죽인 뒤 다시 시도하세요." >&2
      log "UNASSIGN-DENY $H $ALIVE 생존"
      exit 1
    fi
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

# 참견 입구(FIFO). 스트리밍 입력 엔진일 때만 실제 경로가 들어간다.
INBOX=""

# --- 워커 락: 한 워커는 한 번에 티켓 1건 ---
# 워커는 동기 프로세스다. 앞 실행이 아직 세션을 물고 있으면 이번 tick은 그냥 넘긴다
# (cron은 1분마다 깨우지만 티켓 하나는 보통 5~25분 걸린다). 동시성은 워커 개수로 조절한다.
# 락은 머신 로컬에 둔다 - 안에 든 pid는 이 머신에서만 뜻이 있다.
# 서로 다른 티켓을 든 두 워커가 같은 파일·공유 DB를 만지는 건 여전히 사람이 조절할 몫이다
# (관측 사고: 동시 4세션이 같은 dev DB에서 컬럼 드롭, 2026-07-28 스트림).
if [ "$CMD" = "tick" ]; then
  LOCK="$LOCAL/run/$TICKET_NAME-$(python3 -c \
    'import hashlib,sys;print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:8])' "$WORKERS/$TICKET_NAME").lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    OWNER=$(cat "$LOCK/pid" 2>/dev/null)
    if [ -n "$OWNER" ] && kill -0 "$OWNER" 2>/dev/null; then
      log "SKIP 이 워커가 아직 티켓을 물고 있다 pid=$OWNER"
      exit 0
    fi
    log "WARN 스테일 락 회수 pid=${OWNER:-?}"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  fi
  printf %s "$$" > "$LOCK/pid"
  # 빈 값이면 rm -f ""가 되고 아무 일도 안 한다 -- 어떻게 죽든 FIFO가 남지 않게 여기 한 번만 건다.
  trap 'rm -rf "$LOCK"; rm -f "$INBOX"' EXIT
fi

# --- 스테일 수거: 세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌린다 ---
# 없으면 사람에게 질문하고 rc=0으로 종료한 세션의 티켓이 영구 유실된다(2026-07-28 스트림 실사고 3건).
if [ "$CMD" = "tick" ]; then
  python3 "$PY" reap "$TICKET_ROOT" 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] && log "$line"
  done
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

# --- 참조 컨텍스트: 워커의 TICKET_CONTEXT=("<경로>|<설명>" ...)를 프롬프트 꼬리에 붙인다 ---
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

# --- 협업 프로토콜: <protocols>/AGENTS.md 를 프롬프트에 인라인한다 ---
# 페르소나가 '누구'라면 이건 '어떻게 같이 일하는가'다 - 티켓 성격별 처리, 핸드오프, 보고 규약.
# 모든 세션이 같은 문서를 받는다(페르소나와 달리 티켓이 고르지 않는다). 없으면 그냥 넘어간다.
# AGENTS.md 안에서 같은 디렉터리의 다른 문서를 가리키면 세션이 필요할 때 직접 읽는다.
PROTOCOL="${TICKET_PROTOCOLS:-$TICKET_ROOT/protocols}/AGENTS.md"
if [ -r "$PROTOCOL" ]; then
  PROMPT="아래는 이 프로젝트의 협업 프로토콜입니다. 티켓 수행·핸드오프·보고는 이 규약을 따르세요.

===== AGENTS.md ($PROTOCOL) =====
$(cat "$PROTOCOL")
===== 프로토콜 끝 =====

$PROMPT"
fi

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
  echo "워커: $TICKET_NAME (루트 $TICKET_ROOT, cwd $TICKET_CWD)"
  echo "선정: $THASH (kind ${TKIND:--}, 페르소나 ${TPERSONA:-없음})"
  echo "경로: $TPATH"
  echo "엔진: ${TICKET_ENGINE[*]}"
  echo "프롬프트: $PROMPT"
  exit 0
fi

# 세션키 선발급 -> 즉시 frontmatter 기록(디스패치 순간부터 '할당됨'으로 큐에서 제외)
python3 "$PY" assign "$TPATH" "$SID" "${TPERSONA:-agent} / ${TICKET_NAME}-${SID:0:8}" || {
  log "ERROR assign 실패 $THASH"; python3 "$PY" release "$TPATH" >/dev/null; exit 1; }
LOGF="$LOGDIR/$(date '+%Y%m%d-%H%M%S')-${TICKET_NAME}-${THASH}.log"
log "DISPATCH $THASH kind=${TKIND:--} persona=${TPERSONA:-none} sid=$SID log=$(basename "$LOGF")"

cd "$TICKET_CWD" || { log "ERROR cwd 없음 $TICKET_CWD"; python3 "$PY" clear "$TPATH"; python3 "$PY" release "$TPATH" >/dev/null 2>&1; exit 1; }

# 실행 상한(기본 90분). 매달린 세션이 티켓을 무한정 쥐고 있는 걸 막는다.
# 관측치: 정상 티켓은 5~25분, 죽은 세션 하나가 2시간14분을 쥐고 있었다(2026-07-28 스트림 9b3e5c08).
OUTF="$LOGDIR/.out-${SID}"

# --- 참견 입구: 스트리밍 입력 엔진일 때만 FIFO를 판다 ---
# 갈림은 최종 argv에 `--input-format stream-json`이 인접해 있는가 하나다. 없으면 종전 그대로
# (프로세스가 스스로 끝나고 RC가 판정) - Codex와 가짜 엔진이 그 경로로 산다.
prev=""
for arg in "${ENGINE[@]}"; do
  if [ "$prev" = "--input-format" ] && [ "$arg" = "stream-json" ]; then
    INBOX="$LOCAL/run/inbox-$SID"; break
  fi
  prev="$arg"
done

if [ -n "$INBOX" ]; then
  rm -f "$INBOX"; mkfifo "$INBOX" || { log "ERROR mkfifo 실패 $INBOX"; INBOX=""; }
fi
if [ -n "$INBOX" ]; then
  # O_RDWR로 연다. 쓰기 전용으로 열면 읽는 쪽이 붙을 때까지 블록하고, 엔진이 못 뜨면 영영
  # 안 풀린다. 읽기도 같이 잡으면 open이 즉시 돌아오고 우리가 항상 writer라 엔진이 EOF를 안 본다
  # (최초 프롬프트를 쓴 직후 세션이 끝나는 걸 막는 것이 이 fd의 일이다). 우리는 읽지 않는다.
  exec 9<>"$INBOX"
  # 9>&-로 엔진의 fd 9 사본을 닫는다. 물려주면 엔진이 자기 쓰기 끝을 쥐고 있어, 아래에서
  # 우리가 fd 9를 닫아도 EOF를 영영 못 본다(FIFO의 writer가 0이 되어야 EOF다).
  "${ENGINE[@]}" <"$INBOX" >"$OUTF" 2>>"$LOGF" 9>&- &
  CPID=$!
else
  # </dev/null: 비스트리밍 엔진에는 참견 채널이 없으니 stdin을 물려줄 이유가 없다. 그런데
  # `codex exec`는 프롬프트를 argv로 받고도 stdin을 EOF까지 읽는다("Reading additional input
  # from stdin..."). 터미널에서 워커를 손으로 돌리면 fd0이 tty라 EOF가 안 와 turn이 시작조차
  # 못 한다(실측 210초 정지, 상한은 TICKET_MAXRUN=5400s). cron은 이미 닫힌 fd0을 줘서 안 걸린다.
  "${ENGINE[@]}" </dev/null >"$OUTF" 2>>"$LOGF" &
  CPID=$!
fi
# Codex에는 Claude식 --session-id가 없으므로 실제 엔진 pid도 남겨 reap이 생존을 확인한다.
# 프롬프트 주입보다 **먼저** 적는다. 주입이 막히는 동안 pid가 비어 있으면 reap이 판정할 근거가
# 없어 티켓이 진행중에 영구 잔류한다(2026-08-01 실사고).
python3 "$PY" setpid "$TPATH" "$CPID"

if [ -n "$INBOX" ]; then
  # 최초 프롬프트 = FIFO에 JSON 한 줄. 사람이 나중에 미는 참견도 같은 모양이다.
  # 백그라운드로 쓴다. 프롬프트는 FIFO 버퍼보다 크므로 엔진이 stdin을 안 빨면 write가
  # 블록하는데, 전경에서 쓰면 아래 감시자·wait이 통째로 안 돌아 워커가 영구 정지한다
  # (2026-08-01 실사고: 워커 4개가 최대 2시간 멈췄고 reap도 손을 못 댔다).
  python3 -c 'import json,sys
sys.stdout.write(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}},
                            ensure_ascii=False, separators=(",", ":")) + "\n")' "$PROMPT" >&9 &
  FEEDER=$!
  FED=0
  while kill -0 "$FEEDER" 2>/dev/null && [ "$FED" -lt "$TICKET_FEED_TIMEOUT" ]; do
    sleep 1; FED=$((FED+1))
  done
  if kill -0 "$FEEDER" 2>/dev/null; then
    # 엔진이 프롬프트를 다 받지 못했다 -> 이 디스패치는 실패다. 세션을 죽여 아래 wait이
    # 평범한 FAIL 경로로 떨어지게 한다(clear + release + 백로그 복귀).
    kill -9 "$FEEDER" 2>/dev/null
    kill -KILL "$CPID" 2>/dev/null
    log "STALL $THASH 엔진이 ${TICKET_FEED_TIMEOUT}s 동안 stdin을 안 읽었다 - 프롬프트 주입 실패"
  else
    # 프롬프트를 넣은 뒤에 입구를 광고한다. 순서를 뒤집으면 화면이 먼저 밀어 넣은 참견이
    # 티켓 지시 줄 사이에 끼어들어 JSON 한 줄이 깨진다.
    python3 "$PY" setinbox "$TPATH" "$INBOX"
  fi
fi
# 감시자는 짧은 sleep으로 돈다. 한 방 `sleep $TICKET_MAXRUN`이면 세션이 끝난 뒤에도 그 sleep이
# 상속받은 stdout/stderr를 90분간 쥐고 남아, 호출자(cron·테스트)가 파이프에서 못 빠져나온다.
# 스트리밍 입력에서는 stdin이 열려 있는 한 세션이 스스로 안 끝난다(닫아도 60초는 안 죽는다).
# `result` 줄이 곧 끝이고, 끝내는 건 우리다. MAXRUN은 그 줄이 영영 안 오는 경우로 남는다.
POLL=5; [ -n "$INBOX" ] && POLL=1
# 마지막 줄이 `result`인가. 접두사로는 못 본다 - 실측된 키 순서는 `is_error`가 먼저다.
# 문자열 매치만으로 죽이는 것도 안 된다: 세션이 뱉는 본문에 이 프로토콜이 그대로 인용될 수 있고
# (이 레포가 그 문서를 갖고 있다) 그러면 남의 티켓을 중간에 잘라낸다. grep은 문지기고 판정은 파싱이다.
is_result() {
  tail -n 1 "$1" 2>/dev/null | grep -q '"type":"result"' || return 1
  tail -n 1 "$1" | python3 -c \
    'import json,sys
try: o = json.loads(sys.stdin.readline())
except Exception: sys.exit(1)
sys.exit(0 if isinstance(o, dict) and o.get("type") == "result" else 1)'
}
( SECONDS=0
  while [ "$SECONDS" -lt "$TICKET_MAXRUN" ]; do
    kill -0 "$CPID" 2>/dev/null || exit 0
    if [ -n "$INBOX" ] && is_result "$OUTF"; then
      kill -TERM "$CPID" 2>/dev/null; sleep 5; kill -KILL "$CPID" 2>/dev/null; exit 0
    fi
    sleep "$POLL"
  done
  kill -TERM "$CPID" 2>/dev/null; sleep 20; kill -KILL "$CPID" 2>/dev/null ) &
WPID=$!
wait "$CPID"; RC=$?
kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
[ -n "$INBOX" ] && { exec 9>&-; rm -f "$INBOX"; }
OUT=$(cat "$OUTF" 2>/dev/null); rm -f "$OUTF"
printf '%s\n' "$OUT" >> "$LOGF"

# 실제 세션키와 판정을 응답에서 읽는다. 옛 경로는 응답 전체가 JSON 하나이고,
# stream-json은 JSONL이라 `result` 줄이 판정이다(전체 json.load는 거기서 깨진다).
VERDICT=$(printf '%s' "$OUT" | python3 -c \
  'import json,sys
raw = sys.stdin.read(); sid = ""; ok = ""
for ln in raw.splitlines():
    try: o = json.loads(ln)
    except Exception: continue
    if isinstance(o, dict) and o.get("type") == "result":
        sid = o.get("session_id", "") or sid
        ok = "err" if o.get("is_error") else "ok"
if not sid:
    try: sid = json.loads(raw).get("session_id", "")
    except Exception: pass
print(sid + "|" + ok)' 2>/dev/null)
REAL="${VERDICT%%|*}"
VERDICT="${VERDICT#*|}"

# 스트리밍 입력에서는 우리가 죽여서 끝내므로 RC(143)는 판정이 아니다. `result` 줄이 판정이다.
if [ -n "$INBOX" ]; then
  [ "$VERDICT" = "ok" ] || FAILED=1
else
  [ $RC -ne 0 ] && FAILED=1
fi
if [ -n "${FAILED:-}" ]; then
  # 실행 실패(또는 상한 초과 강제종료) -> 할당 회수해서 다음 tick이 다시 집도록
  python3 "$PY" clear "$TPATH"
  python3 "$PY" release "$TPATH" >/dev/null 2>&1
  if [ "$VERDICT" = "err" ]; then
    log "FAIL $THASH 세션이 result is_error로 끝났다 -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")"
  else
    case $RC in
      143|137) log "TIMEOUT $THASH ${TICKET_MAXRUN}s 초과 강제종료 -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")" ;;
      *)       log "FAIL $THASH rc=$RC -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")" ;;
    esac
  fi
  [ $RC -eq 0 ] && RC=1
  exit $RC
fi

if [ -n "$REAL" ] && [ "$REAL" != "$SID" ]; then
  python3 "$PY" assign "$TPATH" "$REAL"
  log "NOTE $THASH 세션키 정정 $SID -> $REAL"
fi
log "DONE $THASH sid=${REAL:-$SID}"
exit 0
