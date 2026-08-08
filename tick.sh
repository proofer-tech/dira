#!/bin/bash
# 파일시스템 티켓 디스패처(프로젝트 무관). 진입점은 워커 스크립트다 - 이 파일을 직접 부르지 않는다.
# 워커 = <티켓루트>/workers/<이름>.sh, 이 파일을 `.`(source)하는 두 줄짜리 셸 스크립트.
# 크론잡 하나가 워커 하나고, 한 번 실행에 티켓 1건을 동기로 끝낸다. 더 돌리려면 워커를 더 둔다.
#   <루트>/workers/w1.sh              티켓 1건 디스패치 (cron 진입점)
#   <루트>/workers/w1.sh list         열린 티켓 큐 상태
#   <루트>/workers/w1.sh unassign H   티켓 H의 할당(session_id) 해제 -> 큐 복귀
#                        (산 세션이면 거부하고 exit 3. --force면 그 pid를 죽여서 푼다)
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
# 디스패치가 실제로 섰다고 볼 때까지 기다리는 상한(프롬프트 주입 완료 + 엔진 init).
# 프롬프트는 파이프 버퍼보다 크므로 엔진이 stdin을 빨아야만 주입이 끝난다 - 기동 중 멎으면 영영 안 끝난다.
TICKET_FEED_TIMEOUT="${TICKET_FEED_TIMEOUT:-120}"
# 프롬프트 포맷의 %s = 티켓 해시 하나뿐이다(역할 호칭은 페르소나 프로필이 대신한다).
TICKET_PROMPT_FMT="${TICKET_PROMPT_FMT:-%s 티켓을 확인해 주세요. (해당 티켓은 이미 진행중으로 잡아두었습니다. 수행을 마치면 완료 상태로 rename하고, 막히면 티켓 본문에 블록 이력을 남겨주세요.)}"
# 세션 재활용(§4-11, §제약 1 §결정 기록 §열셋째). 0이면 기능 전체를 끈다(기본 켜짐).
# CTX는 마지막 assistant 턴 컨텍스트(input+cache_creation+cache_read)의 재활용 상한이다.
TICKET_REUSE="${TICKET_REUSE:-1}"
TICKET_REUSE_CTX="${TICKET_REUSE_CTX:-100000}"
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
# 이 시점의 값이 "기본 엔진"이다(워커 대입 -> 없으면 위 기본값). `personas/<이름>/engine`이
# 있으면 티켓 선정 루프 안에서 후보의 persona가 확정된 뒤 이 배열을 덮어쓴다(§제약 1 §결정
# 기록 §열한 번째) - 그래서 ENGINE_NAME 계산·쿨다운·claude 인증 게이트도 전부 그 뒤로
# 옮겨졌다. 여기서 하던 계산은 이제 없다(아래 선정 루프 참조).
BASE_ENGINE=("${TICKET_ENGINE[@]}")

CDOWN_W=300   # 리밋이 복귀 시각을 안 줄 때(네트워크 실패 등)의 창 + 만료 직후 재무장 창

# 엔진 지문 = **인증 토큰만**. 사람이 계정을 바꾸면 값이 갈리고 그 순간 쿨다운이 풀린다 -
# 리밋이 준 복귀 시각을 그대로 기다리면 계정을 바꿔도 몇 시간을 놀기 때문이다(요구 15ceae18).
#
# 엔진 argv(모델 플래그)는 **일부러 안 넣는다**. 창은 이름이 엔진별일 뿐 머신에 하나인데
# argv는 큐마다 다르다 - 넣었더니 "지문이 갈리면 푼다"가 *남의 창을 지우는* 동작이 됐다
# (실측 2026-08-05: `--model sonnet`인 dira와 모델 플래그가 없는 stream이 서로의 창을
# 1분마다 풀어서, 16:30까지 닫혀 있어야 할 창에서 같은 티켓을 27번 태웠다).
# 모델을 갈아도 5시간 리밋은 계정에 걸린 채라 애초에 풀 근거가 아니다.
engine_fp() {
  python3 -c 'import hashlib,sys
try: tok = open(sys.argv[1], "rb").read()
except OSError: tok = b""
print(hashlib.sha1(tok).hexdigest()[:12])' \
    "$LOCAL/oauth-token"
}
arm_cdown() { printf '%s\n%s\n' "$1" "$(engine_fp)" > "$CDOWN"; }

# claude 인증 + 엔진 쿨다운 게이트. ENGINE_NAME·CDOWN이 이미 정해진 상태에서 부른다.
# 통과 못하면 SKIP을 로그하고 1을 반환한다 - 이 엔진을 쓰는 후보 전체를 건너뛰라는 뜻이라
# 선정 루프가 이 반환값으로 ENGOVER에 등록한다(§4-11 재활용 경로는 후보가 하나뿐이라 등록 없이
# 반환값만 쓴다 - 같은 게이트를 다시 지나는 것이 §4-11 §규칙 ⑤다).
engine_gate_ok() {
  if [ "$ENGINE_NAME" = "claude" ]; then
    # claude setup-token 으로 발급 후: printf %s '<토큰>' > ~/.config/dira/oauth-token
    [ -r "$LOCAL/oauth-token" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < "$LOCAL/oauth-token")"
    # 비대화형 claude만 장기 토큰이 없으면 이 엔진으로 못 뜬다. `.authwarn`으로 "최초 1회만
    # 남긴다"는 종전 계약 그대로 둔다.
    if [ ! -r "$LOCAL/oauth-token" ] && [ ! -t 1 ]; then
      if [ ! -f "$LOCAL/.authwarn" ]; then
        log "SKIP AUTH 대기 $ENGINE_NAME (claude setup-token 발급 후 $LOCAL/oauth-token 에 저장 필요)"
        touch "$LOCAL/.authwarn"
      fi
      return 1
    fi
  fi
  if [ -f "$CDOWN" ]; then
    local UNTIL WAS_FP NOW
    UNTIL=""; WAS_FP=""
    { read -r UNTIL; read -r WAS_FP; } < "$CDOWN"
    case "$UNTIL" in ''|*[!0-9]*) UNTIL=0 ;; esac
    NOW=$(date +%s)
    if [ "$WAS_FP" != "$(engine_fp)" ]; then
      rm -f "$CDOWN"
      log "NOTE 엔진 쿨다운 해제 - 토큰·모델이 바뀌었다(남은 창 $((UNTIL - NOW))초를 안 기다린다)"
    elif [ "$NOW" -lt "$UNTIL" ]; then
      log "SKIP 엔진 쿨다운 · $((UNTIL - NOW))초 남음"
      return 1
    fi
  fi
  return 0
}

# 선정 잠금 획득(§5-4 SLOCK). 실패하면 SLOCK=""로 남기고 1을 반환한다 - 트랩이 남의 잠금을
# 안 지우게 하는 값이자, §4-11 재활용 판정 ⑤가 실패로 떨어지는 신호로 두 호출부가 나눠 쓴다.
acquire_slock() {
  SLOCK="$LOCAL/run/select.lock"
  if ! mkdir "$SLOCK" 2>/dev/null; then
    local SOWNER
    SOWNER=$(cat "$SLOCK/pid" 2>/dev/null)
    if [ -n "$SOWNER" ] && kill -0 "$SOWNER" 2>/dev/null; then
      # 남의 잠금이다. 비워야 트랩이 주인의 잠금을 지우지 않는다.
      SLOCK=""
      log "SKIP 다른 워커가 선정 중이다 pid=$SOWNER"
      return 1
    fi
    log "WARN 스테일 선정 잠금 회수 pid=${SOWNER:-?}"
    rm -rf "$SLOCK"
    mkdir "$SLOCK" 2>/dev/null || { SLOCK=""; log "SKIP 선정 잠금 재획득 실패"; return 1; }
  fi
  printf %s "$$" > "$SLOCK/pid"
}

# `personas/<이름>/limit` -> 정수 하나, 또는 "" = 상한 없음. 파서를 만들지 않는다.
# 양끝 공백·후행 개행은 값이 아니다 - 화면이 쓰는 사이드카는 전부 끝에 `\n`이 붙어서
# `2\n`·` 2 `·`2\n\n`이 전부 정수 2여야 한다(`read`가 첫 줄만 읽고 양끝 공백을 떼는 것이
# 그 규약 그대로다). 정수가 아니면 **상한 없음 + WARN**이고 0으로 읽지 않는다 - 오타 하나가
# 페르소나를 영구히 굶기는 쪽으로 떨어지면 안 된다.
# (아래 §선점 판정이 이 함수를 워커 락 exit 경로에서 부르므로 CMD 분기보다 앞에 선다.)
persona_limit() {
  LIMF="${TICKET_PERSONAS:-$TICKET_ROOT/personas}/$1/limit"
  [ -f "$LIMF" ] || return 0
  PL=""; read -r PL < "$LIMF" 2>/dev/null
  case "$PL" in
    '') ;;                                             # 빈 파일 = 상한 없음(기본값)
    *[!0-9]*) log "WARN 페르소나 상한이 정수가 아니다: $LIMF ($PL) - 상한 없이 돈다" ;;
    *) printf %s "$PL" ;;
  esac
}

# 그 페르소나가 지금 물고 있는 수. 단위는 `.wip` 하나고 사본이 없다 - 보드가 세는 수와 같은
# 수이고, 손 claim(session_id 없이 진행중인 티켓)도 그래서 공짜로 같이 센다. 락 디렉터리 같은
# 두 번째 표현을 만들면 스테일이 그 페르소나를 영구히 0으로 굶긴다.
# 판정은 tickets.py를 그대로 불러 쓴다(NFC·상태 접미사·persona 문자 규칙이 한 벌이어야 한다).
persona_wip() {
  python3 -c 'import sys
sys.path.insert(0, sys.argv[1])
import tickets as T
n = 0
for p in T.in_progress(sys.argv[2]):
    try: fm, _, end = T.read_fm(p)
    except (OSError, UnicodeDecodeError): continue
    if end >= 0 and T.persona_of(fm) == sys.argv[3]: n += 1
print(n)' "$CODE" "$TICKET_ROOT" "$1"
}

# --- §1-3 §5 — 선점: 바쁜 워커의 즉시 exit 경로가 유일하게 도는 자리다 ---
# 중앙 스케줄러가 없다. 전원이 바쁘면 아무도 큐를 안 보므로, 워커 락에 막혀 나가는 이 순간이
# 유일하게 남은 "바쁜 워커가 도는 자리"다(새 프로세스·새 데몬 0개). 새 잠금도 0개다 - claim처럼
# 자원을 다투는 게 아니라 파일을 읽기만 하고, 각 워커는 **자기 자신이 물고 있는 티켓일 때만**
# 죽인다. 전원이 같은 파일을 보고 같은 계산을 해도 "내 티켓이 전역 최저다"는 결정적으로 한
# 워커에서만 참이라 정확히 하나만 죽는다 - 조율이 필요 없다.
maybe_preempt() {
  local WROWS VPATH VHASH VEFF VASSIGN VPID VOWNER
  local PUSH5 q_path q_hash q_kind q_persona q_prio q_base q_eff PLIM PWIP
  local WT COMMIT
  WROWS=$(python3 "$PY" wips "$TICKET_ROOT" 2>/dev/null) || return 0
  [ -z "$WROWS" ] && return 0

  # 조건 2·3 — 도는 `.wip` 전부 중 유효 우선순위가 최저인 것(동률이면 assigned_at이 가장
  # 늦은 것 = 가장 나중에 시작한 것). 정렬 키 하나로 둘 다 접는다.
  IFS='|' read -r VPATH VHASH VEFF VASSIGN VPID VOWNER <<< \
    "$(printf '%s\n' "$WROWS" | sort -t'|' -k3,3n -k4,4r | head -1)"
  [ -z "$VPATH" ] && return 0
  [ "$VEFF" -lt 5 ] || return 0                     # 5끼리는 안 끊는다
  case "$VOWNER" in *" / $TICKET_NAME-"*) ;; *) return 0 ;; esac   # 내 티켓이 아니면 손대지 않는다
  [ -f "$VPATH" ] || return 0
  case "$VPID" in ''|*[!0-9]*) return 0 ;; esac

  # 조건 1 — 유효 5 후보가 있고 자기 게이트(deps·페르소나 상한)를 다 지난다. `select`가 이미
  # deps 미충족·할당됨을 걸렀으니 여기서는 페르소나 상한만 본다(선정 루프와 같은 판정).
  PUSH5=""
  while IFS='|' read -r q_path q_hash q_kind q_persona q_prio q_base q_eff; do
    [ "$q_eff" = "5" ] || continue
    if [ -n "$q_persona" ]; then
      PLIM=$(persona_limit "$q_persona")
      if [ -n "$PLIM" ]; then
        PWIP=$(persona_wip "$q_persona")
        [ "$PWIP" -ge "$PLIM" ] && continue
      fi
    fi
    PUSH5="$q_hash"; break
  done < <(python3 "$PY" select "$TICKET_ROOT")
  [ -z "$PUSH5" ] && return 0

  # 끊긴 티켓 본문에 무슨 일이 있었는지 남긴다(§1-3 §5 §표) - git은 있으면 쓰고 없으면 그
  # 항목만 빈다(2>/dev/null, 의존성 0을 안 깬다).
  WT="$TICKET_ROOT/worktrees/$TICKET_NAME"
  COMMIT=$(git -C "$WT" rev-parse --short HEAD 2>/dev/null)
  {
    printf '\n## 선점\n\n'
    printf '| | |\n|---|---|\n'
    printf '| 시각 | %s |\n' "$(date '+%F %T')"
    printf '| 밀어낸 5 | %s |\n' "$PUSH5"
    printf '| 워커 · 브랜치 | %s · wt/%s |\n' "$TICKET_NAME" "$TICKET_NAME"
    printf '| 워크트리 | %s |\n' "$WT"
    printf '| 커밋 | %s |\n' "$COMMIT"
    printf '| 회수 | `.dira/protocols/재디스패치-복구.md`를 읽고 그대로 하세요. |\n'
  } >> "$VPATH"
  log "PREEMPT $VHASH -> $PUSH5 pid=$VPID"
  kill -TERM "$VPID" 2>/dev/null
}

CMD="${1:-tick}"

case "$CMD" in
  list)
    python3 "$PY" list "$TICKET_ROOT"; exit $? ;;
  unassign)
    USAGE="사용법: $(basename "$0") unassign <티켓해시> [--force]"
    H="${2:-}"; [ -z "$H" ] && { echo "$USAGE"; exit 2; }
    # --force = 산 세션을 죽여서 푼다. 그 밖의 인자는 사용법(exit 2).
    FORCE=""; shift 2
    for a in ${@+"$@"}; do
      [ "$a" = "--force" ] && { FORCE=1; continue; }
      echo "$USAGE" >&2; exit 2
    done
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
      # 죽일 수 있는 것은 pid 갈래뿐이다. session= 갈래(handclaim이 조상 pid를 못 찾은 티켓)는
      # 강제도 대상이 없다 - 종전 문구를 재사용하지 않는다. 이미 강제를 시도한 사람에게
      # "죽인 뒤 다시 시도하세요"는 할 말이 아니다.
      case "$ALIVE" in
        session=*)
          echo "거부: $H 의 세션이 살아 있는데 티켓에 pid가 없다($ALIVE). 강제로 끊을 대상이 없으니 그 세션을 직접 끝내야 한다." >&2
          log "UNASSIGN-DENY $H $ALIVE pid 없음"
          exit 1 ;;
      esac
      if [ -z "$FORCE" ]; then
        echo "거부: $H 의 세션이 아직 살아 있다($ALIVE). 먼저 끝내거나 죽인 뒤 다시 시도하세요." >&2
        log "UNASSIGN-DENY $H $ALIVE 생존"
        # 3 = 산 세션이라 거부했다(--force면 풀 수 있다). 화면이 이 코드로 확인을 띄운다 -
        # 문구를 정규식으로 읽으면 문구를 고치는 순간 확인이 조용히 사라진다.
        exit 3
      fi
      # 죽이기 **전에** 답변 대기로 잠근다(§2-5 §개정). 열림에는 잠금이 없어서 같은 워커가
      # 1~4초 뒤 다시 문다 - 중단이 중단이 아니게 된다. 여기가 세 가지가 동시에 성립하는
      # 유일한 구간이다: 창이 0이고(deps·awaiting은 clear+release를 지나 산다), 티켓 파일을
      # 쓰는 것이 나 혼자고(부모는 wait에 서 있다), 인용할 transcript가 아직 안 지워졌다.
      if ASK=$(python3 "$PY" askhuman "$P"); then log "$ASK"; else log "ASK-FAIL $H 답변 대기 잠금 실패"; fi
      # 강제: pid를 죽이면 그 세션의 부모 tick.sh가 wait에서 실패 판정으로 떨어져 이미
      # clear + release를 한다. 새 상태 전이가 아니라 그 경로를 밟게 하고 결과를 기다리는 것이다.
      kill -TERM "$UPID" 2>/dev/null
      log "UNASSIGN-FORCE $H $ALIVE 강제 중단"
      N=0
      while [ -e "$P" ] && [ "$N" -lt 15 ]; do sleep 1; N=$((N+1)); done
      if [ -e "$P" ]; then
        # 손 클레임 티켓(tickets.py handclaim)에는 풀어 줄 부모가 없다 - 여기서 우리가 푼다.
        # 단, pid가 아직 살아 있으면 풀지 않는다. 산 세션을 두고 할당만 푸는 것이 바로
        # 2026-08-01 실사고(b7bacafb·a461c2f7)의 원인이다.
        # ps는 좀비(부모가 아직 wait 안 한 죽은 자식)도 "있다"고 답한다. 그건 도는 세션이 아니다.
        case "$(ps -p "$UPID" -o state= 2>/dev/null | tr -d ' ')" in
          ''|Z*) ;;
          *) echo "실패: $H 의 pid $UPID 가 ${N}s 뒤에도 살아 있다. 할당은 그대로 둔다. 답변 대기 잠금은 걸려 있다 — 그 세션이 끝나면 백로그가 아니라 답변 대기로 선다." >&2
             log "UNASSIGN-FORCE $H pid=$UPID 안 죽음 - 해제 보류"
             exit 1 ;;
        esac
        python3 "$PY" clear "$P" || exit 1
        RP=$(python3 "$PY" release "$P") || exit 1
        [ "$RP" != "$P" ] && echo "백로그 복귀: $(basename "$RP")"
      fi
      log "UNASSIGN $H 강제(pid=$UPID ${N}s)"
      echo "강제 할당 해제: $H — 답변 대기로 잠갔다(답을 쓸 때까지 아무 워커도 안 가져간다)"
      exit 0
    fi
    # 결정 9 -- 세션이 `## 블록`을 남기고 스스로 unassign한 경로. clear+release **앞에서** 조건부로
    # 잠근다(신선한 블록 + 미충족 dep 0). 열리자마자 잠긴 채로 서야 하므로 순서가 계약이다.
    if ASK=$(python3 "$PY" askhuman "$P" --if-blocked); then [ -n "$ASK" ] && log "$ASK"; fi
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

# 참견 입구(FIFO)와 최초 프롬프트 파일. 스트리밍 입력 엔진일 때만 실제 경로가 들어간다.
INBOX=""; PRIMEF=""
# 선정·claim 임계구역 잠금(§5-4). 트랩보다 먼저 선언한다 - 잠금을 잡기 전에 종료하는 경로가
# 여럿이고(선정 잠금 획득 실패 등) set -u에서 미정의 변수를 트랩이 읽으면 그 자리에서 죽는다.
SLOCK=""

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
      maybe_preempt
      log "SKIP 이 워커가 아직 티켓을 물고 있다 pid=$OWNER"
      exit 0
    fi
    log "WARN 스테일 락 회수 pid=${OWNER:-?}"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  fi
  printf %s "$$" > "$LOCK/pid"
  # 빈 값이면 rm -f ""가 되고 아무 일도 안 한다 -- 어떻게 죽든 FIFO가 남지 않게 여기 한 번만 건다.
  trap 'rm -rf "$LOCK" "$SLOCK"; rm -f "$INBOX" "$PRIMEF" "${PRIMEF:+$PRIMEF.fed}"' EXIT
fi

# --- 스테일 수거: 세션이 죽었는데 진행중으로 남은 티켓을 백로그로 되돌린다 ---
# 없으면 사람에게 질문하고 rc=0으로 종료한 세션의 티켓이 영구 유실된다(2026-07-28 스트림 실사고 3건).
if [ "$CMD" = "tick" ]; then
  python3 "$PY" reap "$TICKET_ROOT" 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] && log "$line"
  done
fi

# 엔진 쿨다운 게이트·claude 인증 게이트는 여기 없다 - 페르소나가 엔진을 정하므로 어느
# 엔진인지가 어느 후보를 고르느냐에 달렸다(§제약 1 §결정 기록 §열한 번째). 둘 다 아래 선정
# 루프 안, 후보의 persona가 확정된 뒤로 옮겼다 - reap만 이 앞에 그대로 둔다(스테일 수거는
# 엔진 가용성과 무관하다).

# --- 티켓 선정: 상태접미사 없고 session_id 비어있는 것, 유효 우선순위 높은 순(§1-3) ---
# select가 이미 `(-effective, birth, path)`로 정렬해 준다(tickets.py scan()) - 여기는
# 그 순서를 그대로 훑을 뿐이다.
CANDS=$(python3 "$PY" select "$TICKET_ROOT") || { log "ERROR select 실패"; exit 1; }
[ -z "$CANDS" ] && exit 0

# --- 선정·claim 임계구역: 페르소나 상한·1 게이트는 여기 없으면 게이트가 아니다 ---
# 상한(§5-4)은 `personas/<이름>/limit` 한 줄이고 **세는 것과 잡는 것이 한 임계구역**이어야 한다.
# 지금 구조는 select가 후보를 전부 주고 각 워커가 위에서부터 claim하니 카운트가 claim보다 앞이다.
# 워커 8개는 cron 같은 분에 뜨고 같은 1초에 최대 5개가 DISPATCH된다(실측) - 상한 1의 티켓이
# 다섯 장 열려 있으면 다섯 워커가 모두 `0 < 1`을 읽고 각자 다른 티켓을 잡는다. 로그에는 아무
# 이상이 안 남아서 아무도 못 잡는다.
# 1 게이트(§1-3)도 같은 이유다 - "유효 1은 .wip 0건일 때만 후보"를 세고 나서 잡으면 게이트가
# 아니다. 그래서 같은 그릇(같은 SLOCK)을 쓴다 - 새 잠금은 0개다.
# 그릇은 위 워커 락과 같은 관용구다(mkdir + pid + kill -0 스테일 회수). 다른 점 하나 - 워커 락은
# 워커 이름별이고 이것은 **머신에 하나**다. reap은 이 앞에 그대로 둔다.
# **못 얻으면 기다리지 않고 종료한다**: 다음 cron이 60초 뒤에 오고, 죽은 워커가 물고 있어도
# 큐가 서지 않는다(스테일 회수가 그 위에 있다). 대가는 §5-4가 적은 `마지막 워커가 1초 늦게
# 뜬다`가 아니다 - 줄을 서지 않고 나가므로 **같은 순간에 깬 워커 중 한 명만 뜬다**
# (실측 3회: 워커 5개 동시 · 안 걸리는 상한 하나 -> 디스패치 1건. 상한 파일이 없으면 5건).
# 즉 상한을 한 번 쓰면 그 큐의 디스패치가 분당 1건으로 눌린다. 세션이 5~25분이라 정상 상태는
# 견디지만 냉시동이 워커 수만큼 느려진다 - 뒤집으려면 짧은 재시도가 필요하고 그건 스펙의 일이다.
#
# **상한 파일도 유효 1 후보도 없으면 잠금을 안 잡는다.** `상한 없음`이 기본값이고(스캐폴딩이
# 이 파일을 안 만든다) 그 판은 §5-4 표대로 **종전 그대로**여야 한다 - 지킬 게이트가 0개인데
# 직렬화하면 같은 분에 깬 워커 여덟 중 하나만 뜬다. 파일이 하나라도 생기거나 유효 1이 뜨면
# 그때부터 전원이 줄을 선다.
LIMITED=""
for lf in "${TICKET_PERSONAS:-$TICKET_ROOT/personas}"/*/limit; do
  [ -f "$lf" ] && { LIMITED=1; break; }
done
HASPRIO1=""
printf '%s\n' "$CANDS" | grep -q '|1$' && HASPRIO1=1
if [ "$CMD" = "tick" ] && { [ -n "$LIMITED" ] || [ -n "$HASPRIO1" ]; }; then
  acquire_slock || exit 0
fi

# 전체 큐의 진행중 수(페르소나 무관) - 1 게이트(§1-3)가 "모든 워커가 idle"을 판정하는 값.
# 워커 락을 세지 않는 이유는 위 persona_wip과 같다(락에서 프로젝트를 역추적할 수 없다).
total_wip() {
  python3 -c 'import sys
sys.path.insert(0, sys.argv[1])
import tickets as T
print(len(T.in_progress(sys.argv[2])))' "$CODE" "$TICKET_ROOT"
}

# §1-4 §로그: DISPATCH 줄의 prio= 괄호 출처. raw(원값) != baseline(기준값)이면 duedate가
# 기준값을 덮었다는 뜻이라 `마감` - baseline != effective(유효)면 §1-3의 상속이 그 위에
# 얹혔다는 뜻이라 `상속 <baseline>`(보여주는 값은 상속이 얹히기 전 값, 종전 표기와 같은 자리).
# 둘 다면 이어붙인다. 새 게이트가 아니다 - 이미 있는 세 수를 비교만 한다.
prio_log() {
  local raw="$1" base="$2" eff="$3"
  local out="prio=$eff"
  if [ "$raw" != "$base" ] && [ "$base" != "$eff" ]; then
    out="prio=$eff(마감·상속 $base)"
  elif [ "$raw" != "$base" ]; then
    out="prio=$eff(마감)"
  elif [ "$base" != "$eff" ]; then
    out="prio=$eff(상속 $base)"
  fi
  printf '%s' "$out"
}

SID=$(python3 -c 'import uuid;print(uuid.uuid4())')
TPATH=""; THASH=""; TKIND=""; TPERSONA=""; TPRIO=""; TBASE=""; TEFF=""
OVER=""    # 이 판에서 이미 상한이던 페르소나들. 후보가 여럿이어도 SKIP은 페르소나당 한 줄이다
ENGOVER="" # 이 판에서 이미 디스패치 불가이던 엔진들. 후보가 여럿이어도 SKIP은 엔진당 한 줄이다
while IFS='|' read -r c_path c_hash c_kind c_persona c_prio c_base c_eff; do
  [ -z "$c_path" ] && continue

  # 1 게이트(§1-3) — 유효 1은 진행중 티켓이 0건일 때만 후보다. "모든 워커가 idle"의 큐 쪽
  # 값이 그것이다. 걸려도 큐에서 안 빠진다 - 이번 tick의 후보가 아닐 뿐이고 다음 후보로
  # 넘어간다(페르소나 상한의 continue와 같은 모양 - 다른 우선순위 티켓을 안 굶긴다).
  if [ "$c_eff" = "1" ]; then
    WIPN=$(total_wip)
    if [ "$WIPN" -gt 0 ]; then
      log "SKIP 우선순위 1 $c_hash — 진행중 ${WIPN}건"
      continue
    fi
  fi

  # 상한에 걸려 안 뜨는 것은 SKIP이다(새 로그 낱말 0). 다른 페르소나 후보는 계속 본다 -
  # 한 페르소나가 상한이어도 나머지를 굶기지 않는 것이 이 요구의 절반이다.
  if [ -n "$c_persona" ]; then
    case " $OVER " in *" $c_persona "*) continue ;; esac
    PLIM=$(persona_limit "$c_persona")
    if [ -n "$PLIM" ]; then
      PWIP=$(persona_wip "$c_persona")
      if [ "$PWIP" -ge "$PLIM" ]; then
        OVER="$OVER $c_persona"
        log "SKIP 페르소나 상한 $c_persona $PWIP/$PLIM"
        continue
      fi
    fi
  fi

  # --- 엔진 재구성: 확정된 후보의 persona:가 personas/<이름>/engine을 가지면 그 값으로,
  # 없으면 종전 그대로(워커 대입 -> 기본값)다(§제약 1 §결정 기록 §열한 번째). 매 후보마다
  # 기본값으로 되돌린 뒤 다시 얹는다 - 안 그러면 앞 후보의 override가 다음 후보로 샌다.
  TICKET_ENGINE=("${BASE_ENGINE[@]}")
  if [ -n "$c_persona" ]; then
    PENGINE="${TICKET_PERSONAS:-$TICKET_ROOT/personas}/$c_persona/engine"
    [ -r "$PENGINE" ] && . "$PENGINE"
  fi
  ENGINE_NAME="$(basename "${TICKET_ENGINE[0]}")"
  CDOWN="$LOCAL/run/cooldown-$ENGINE_NAME"

  # 어느 엔진인지가 후보에 달렸으므로 ENGINE_NAME·claude 인증·쿨다운도 후보 확정 뒤에 판정한다
  # (dryrun은 미리보기라 건너뛴다 - 종전에도 이 게이트는 CMD=tick 전용이었다). 디스패치 불가면
  # 페르소나 상한과 같은 자리에서 skip-and-continue다(같은 로그 낱말 SKIP) - 이 엔진을 못
  # 쓴다고 다른 엔진 쓰는 후보까지 굶기지 않는다. 건너뛸 후보가 없으면 이번 tick은 그냥
  # 아무것도 안 고르고 끝난다(TPATH가 빈 채로 루프가 끝난다).
  if [ "$CMD" = "tick" ]; then
    case " $ENGOVER " in *" $ENGINE_NAME "*) continue ;; esac
    if ! engine_gate_ok; then
      ENGOVER="$ENGOVER $ENGINE_NAME"
      continue
    fi
  fi

  if [ "$CMD" = "dryrun" ]; then
    TPATH="$c_path"; THASH="$c_hash"; TKIND="$c_kind"; TPERSONA="$c_persona"; TPRIO="$c_prio"; TBASE="$c_base"; TEFF="$c_eff"; break
  fi
  # 잡기 = 원자적 rename. 이게 진짜 락 - 다른 세션·다른 tick도 이걸 보고 피한다.
  if CPATH=$(python3 "$PY" claim "$c_path" 2>/dev/null); then
    TPATH="$CPATH"; THASH="$c_hash"; TKIND="$c_kind"; TPERSONA="$c_persona"; TPRIO="$c_prio"; TBASE="$c_base"; TEFF="$c_eff"
    break
  fi
done <<EOF
$CANDS
EOF
# 임계구역 끝. 세션을 띄우기 **전에** 놓는다 - 잡은 뒤로는 상한 판정에 영향이 없고, 여기서 안
# 놓으면 워커 하나가 최대 MAXRUN(5,400초) 동안 나머지 전부의 선정을 막는다.
# 비워야 트랩이 다음 주인의 잠금을 지우지 않는다.
[ -n "$SLOCK" ] && { rm -rf "$SLOCK"; SLOCK=""; }
[ -z "$TPATH" ] && exit 0

# 재무장: 쿨다운이 만료돼서 여기까지 왔으면 나가면서 창을 다시 감는다. 그래야 한 창의 재시도가
# 이 워커 하나로 고정된다(안 감으면 8워커가 같은 창에서 한꺼번에 나가 헛디스패치가 8회 또 돈다).
# **파일이 있을 때만 쓴다** - 정상 상태에서 쓰면 워커 하나가 나갈 때마다 나머지가 막혀 큐가 직렬화된다.
# 여기 창은 복귀 시각이 아니라 짧은 300초다 - 다음 FAIL(실측 13초)까지만 나머지를 막으면 된다.
if [ "$CMD" = "tick" ] && [ -f "$CDOWN" ]; then
  arm_cdown "$(( $(date +%s) + CDOWN_W ))"
fi

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

# --- 언어 주입: $LOCAL/language.json의 locale이 무엇이든 프롬프트 맨 꼬리에 문장 두 짝
# (§0-16 §주입 §개정) -- ko면 한국어 문장, en이면 영어 문장. 무주입은 없다(안 고른 사람이
# 정확히 그 기본값이라 회귀가 그 사람에게 난다). 흡수 판정은 그대로다 -- 파일 없음·JSON
# 깨짐·객체 아님·모르는 값 넷 다 ko로 흡수한다(GUI의 readLanguage와 같은 판정,
# apps/teams/lib/projects.ts). 자리는 참조 컨텍스트 바로 뒤다 -- 조립이 prepend라 아래로
# 내려갈수록 프롬프트 앞쪽에 붙고, 여기가 append로 남는 마지막 자리다. persona if 밖이라
# `persona:` 없는 티켓에도 붙는다. 블록은 상수 -- 로케일이 늘면 case에 문장 한 줄만 는다.
# 문장 ①은 "사용자에게 하는 모든 말"로 긍정 좁힘이라 thinking·도구명·요약은 예외로 나열하지
# 않아도 애초에 안 걸린다 -- 였는데, 세션이 꼬리의 한국어/영어 문장을 보고 사고까지 그 언어로
# 돌리는 게 실전에서 관측됐다(§0-16 §주입 §개정 2, 요구 ef37b15e). 그래서 문장 ①에 예외 절을
# 하나 더한다 -- 생각·내부 추론은 이 지시의 대상이 아니라는 자유 허가(금지 아님). 이유는 안
# 적는다 -- 이유를 적으면 세션이 그 이유를 산출물·검증까지 넓혀 읽는다.
LOCALE=$(python3 -c 'import json, sys
try:
    o = json.load(open(sys.argv[1], encoding="utf-8"))
    print("en" if isinstance(o, dict) and o.get("locale") == "en" else "ko")
except Exception:
    print("ko")' "$LOCAL/language.json" 2>/dev/null)
case "$LOCALE" in
en)
  PROMPT="$PROMPT

Language note: say everything you say to the user in English for the rest of
this session -- not only replies when someone writes in, but also any prose
you leave in the progress stream even when no one does. Thinking or internal
reasoning is not covered by this instruction -- you may think in any language.
Keep every written deliverable in Korean regardless -- the ticket body,
\`## 결과\`, commit messages, and anything under \`docs/\`."
  ;;
*)
  PROMPT="$PROMPT

언어 안내: 이번 세션 동안 사용자에게 하는 모든 말을 한국어로 하세요 -- 참견에
답할 때만이 아니라 아무도 말을 안 걸어도 진행 기록 스트림에 남기는 산문까지입니다.
생각하거나 내부적으로 추론하는 구간은 이 지시의 대상이 아닙니다 -- 어느 언어로
생각해도 됩니다. 산출물은 그대로 한국어로 고정합니다 -- 티켓 본문, \`## 결과\`,
커밋 메시지, \`docs/\` 아래 전부입니다."
  ;;
esac

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

# --- 온톨로지 블록: 위치 + 검색 방법만 싣는다(나열 없음, 9d7ba932) ---
# 메모리는 페르소나의 것이고 온톨로지는 큐 전체의 것이라 블록을 가른다 - 그래서 페르소나 if 밖이고
# `persona:`가 없는 티켓에도 실린다. 목차 나열(파일명+`## ` 절)을 걷었다 - 블록이 상수라 파일 수·
# 절 수와 무관하게 크기가 고정된다. _ontology/SCHEMA.md가 타입 지도(객체·관계·액션)라 그게
# 진입점이고, 나머지 개념에 닿는 길은 세션의 grep이다. 없거나 비면 안 붙고 WARN도 없다(없는 것이
# 정상이다).
ONTDIR="$TICKET_ROOT/ontology"
if find "$ONTDIR" -type f -name '*.md' 2>/dev/null | grep -q .; then
  PROMPT="아래는 이 큐의 온톨로지가 사는 곳입니다.

===== 온톨로지 ($ONTDIR) =====
$ONTDIR 안의 _ontology/SCHEMA.md가 지도입니다(객체·관계·액션 타입의 진입점). 본문은 안 실립니다 -
필요한 개념은 티켓의 어휘로 $ONTDIR 를 grep해서 여세요.
===== 온톨로지 끝 =====

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
  # 스킬 사이드카(같은 디렉터리 skills.md)는 프로필 바로 뒤에 붙는다. 없는 것이 정상이라 WARN 없다.
  # Claude 엔진일 때만이다 - codex엔 스킬 개념이 없어서 "없는 도구를 쓰라"는 문장이 된다.
  SKILLS="${TICKET_PERSONAS:-$TICKET_ROOT/personas}/$TPERSONA/skills.md"
  SKILLBLOCK=""
  if [ -r "$SKILLS" ] && [ "$(basename "${TICKET_ENGINE[0]}")" = "claude" ]; then
    SKILLBLOCK="
===== $TPERSONA 스킬 ($SKILLS) =====
$(cat "$SKILLS")
===== 스킬 끝 =====
"
  fi
  # 메모리 사이드카(같은 디렉터리 memory/*.md)는 스킬 블록 뒤에 붙는다. 여기는 엔진을 안 가린다 -
  # 메모리는 이 큐에서 알아낸 사실이라 codex에도 참이다. 없는 것이 정상이라 WARN 없다.
  # 글롭은 한 단계다(memory/<하위>/x.md는 안 읽는다). 목차 나열(파일명+`## ` 절)을 걷었다(9d7ba932) -
  # 블록이 상수라 파일 수·절 수와 무관하게 크기가 고정된다. 본문·목차에 닿는 길은 세션의
  # grep이다(엔진이 만드는 색인은 0). 되돌리려면 이 if를 종전 for 루프로 바꾼다.
  MEMDIR="${TICKET_PERSONAS:-$TICKET_ROOT/personas}/$TPERSONA/memory"
  MEMBLOCK=""
  if find "$MEMDIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | grep -q .; then
    MEMBLOCK="
===== $TPERSONA 메모리 ($MEMDIR) =====
이 큐에서 알아낸 교훈이 파일별로 쌓인 곳입니다(CORE.md §회고가 쓰는 자리). 본문은 안 실립니다 -
필요한 개념은 티켓의 어휘로 $MEMDIR 를 grep해서 그 파일을 여세요. [[링크]]는
grep -rl '\[\[<이름>\]\]' $MEMDIR 로 1홉 따라갑니다.
===== 메모리 끝 =====
"
  fi
  PROMPT="당신은 이 프로젝트의 '$TPERSONA'입니다. 아래 프로필이 당신의 역할·권한·판단 기준이고,
티켓을 수행하는 동안 이 페르소나로 일관되게 행동하세요. 프로필과 티켓 지시가 충돌하면 티켓을 따르되
충돌 사실을 티켓 본문에 남기세요.

===== $TPERSONA PROFILE ($PROFILE) =====
$(cat "$PROFILE")
===== PROFILE 끝 =====
$SKILLBLOCK$MEMBLOCK
$PROMPT"
else
  log "WARN 페르소나 프로필 없음: $PROFILE (페르소나 없이 디스패치)"
fi

# --- 코어 프로토콜: <엔진 레포>/protocols/CORE.md 를 프롬프트 맨 앞에 인라인한다 ---
# 엔진이 읽는 계약(파일명 상태·claim·frontmatter 키·`## 블록`)이라 큐 밖에 살고 사본이 없다 -
# 큐에 없으니 사람이 지울 수 없다(§프롬프트 층 결정 1). 큐 AGENTS.md **앞**에 서므로 프로젝트
# 문서가 뒤에서 어긋난 규약을 적어도 세션이 어느 쪽을 따를지 안다(결정 3 - 코어 머리에 우선순위 한 줄).
# 조립은 prepend라 이 블록이 코드에서 마지막이어야 프롬프트에서 첫 번째다.
# 큐 쪽 vendored 사본이 있으면 그것부터 읽고, 없으면 엔진 사본으로 폴백한다(§프롬프트 층
# 결정 8-b) - dmg 배포에는 "엔진 레포"가 없어 새 프로젝트가 코어를 자기 큐에 품는다.
# 둘 다 없으면 WARN만 남기고 넘어간다 - 디스패치를 세우는 쪽이 더 나쁘다(프로토콜 인라인과 같다).
CORE="$TICKET_ROOT/protocols/CORE.md"
[ -r "$CORE" ] || CORE="$CODE/protocols/CORE.md"
if [ -r "$CORE" ]; then
  PROMPT="===== CORE.md ($CORE) =====
$(cat "$CORE")
===== 코어 프로토콜 끝 =====

$PROMPT"
else
  log "WARN 코어 프로토콜 없음: $CORE (코어 없이 디스패치)"
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
PRIOLOG=$(prio_log "$TPRIO" "$TBASE" "$TEFF")
log "DISPATCH $THASH kind=${TKIND:--} persona=${TPERSONA:-none} sid=$SID log=$(basename "$LOGF") $PRIOLOG"

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
  # 최초 프롬프트는 FIFO가 아니라 **파일**로 먹인다. FIFO로 밀면 엔진 기동이 겹칠 때 교착한다:
  # 프롬프트(실측 58KB)가 파이프 버퍼(64KB)를 넘으면 write가 블록하고, 그 상태의 엔진은
  # init조차 못 내고 멎는다. 2026-08-04 실측 - 동시 6개 FIFO 대형 프롬프트는 6/6 STALL,
  # 같은 프롬프트를 파일로 먹이면 6/6이 2초에 init. 1개만 띄우면 FIFO로도 되므로 한동안
  # 안 보이다가 워커가 늘면서 터졌다(7/30 실패 0% -> 8/3 22시 86%).
  # cat 두 방으로 이어 붙여 참견 입구는 그대로 산다: 프롬프트 다음 줄부터 FIFO가 stdin이다.
  # 그룹에도 9>&-를 건다. cat이 fd 9(쓰기 끝)를 물려받으면 우리가 닫아도 자기가 writer라
  # EOF를 못 봐서 세션이 죽은 뒤에도 영영 남는다.
  PRIMEF="$LOCAL/run/prime-$SID.json"
  python3 -c 'import json,sys
sys.stdout.write(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}},
                            ensure_ascii=False, separators=(",", ":")) + "\n")' "$PROMPT" > "$PRIMEF"
  # 9>&-로 엔진의 fd 9 사본을 닫는다. 물려주면 엔진이 자기 쓰기 끝을 쥐고 있어, 아래에서
  # 우리가 fd 9를 닫아도 EOF를 영영 못 본다(FIFO의 writer가 0이 되어야 EOF다).
  # `.fed` 표식이 곧 "프롬프트가 엔진 stdin으로 다 들어갔다"이다. 파이프 버퍼보다 큰 프롬프트를
  # 안 빠는 엔진에서는 첫 cat이 막혀 표식이 안 생긴다 - 옛 feeder 생존 판정과 같은 근거다.
  # FIFO는 그룹 진입 때 fd 8로 **미리** 연다. 두 번째 cat이 그때 가서 열면, 워커가 먼저 끝나
  # fd 9가 닫힌 뒤엔 writer 없는 FIFO를 여는 셈이라 open에서 영영 막힌다 - 그 cat이 워커의
  # stderr를 쥔 채 남아 호출자(capture_output·테스트)가 EOF를 못 본다. 여기서 열면 fd 9가
  # 아직 살아 있어 open이 즉시 돌아오고, 나중에 fd 9가 닫히면 EOF로 정상 종료한다.
  # 그룹의 stderr도 로그로 보낸다(워커 stderr를 물려주지 않는다). 9>&-는 위 fd 9와 같은 이유다.
  { cat "$PRIMEF" && : > "$PRIMEF.fed"; cat <&8; } 8<"$INBOX" 9>&- 2>>"$LOGF" | "${ENGINE[@]}" >"$OUTF" 2>>"$LOGF" 9>&- &
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
  # 디스패치가 섰는지는 둘을 같이 본다. 하나만으로는 새는 구멍이 있다:
  #   주입 완료(.fed)만: 프롬프트가 버퍼에 다 들어가도 엔진이 기동에서 멎으면 못 본다
  #                      - 2026-08-04의 실제 사고가 그 모양이었다(init도 없이 0% CPU).
  #   init만:            프롬프트를 한 글자도 안 빠는 엔진이 init만 뱉고 자면 통과한다.
  # 상한을 넘기면 세션을 죽여 아래 wait이 평범한 FAIL 경로로 떨어지게 한다(clear + release + 복귀).
  started() { [ -e "$PRIMEF.fed" ] && grep -q '"subtype":"init"' "$OUTF" 2>/dev/null; }
  FED=0
  while [ "$FED" -lt "$TICKET_FEED_TIMEOUT" ] && kill -0 "$CPID" 2>/dev/null; do
    started && break
    sleep 1; FED=$((FED+1))
  done
  if started; then
    # 프롬프트를 넣은 뒤에 입구를 광고한다. 순서를 뒤집으면 화면이 먼저 밀어 넣은 참견이
    # 티켓 지시 줄 사이에 끼어들어 JSON 한 줄이 깨진다.
    python3 "$PY" setinbox "$TPATH" "$INBOX"
  else
    kill -KILL "$CPID" 2>/dev/null
    log "STALL $THASH ${TICKET_FEED_TIMEOUT}s 안에 프롬프트 주입+init을 못 봤다 - 기동 실패 (fed=$([ -e "$PRIMEF.fed" ] && echo y || echo n))"
  fi
fi
# 감시자는 짧은 sleep으로 돈다. 한 방 `sleep $TICKET_MAXRUN`이면 세션이 끝난 뒤에도 그 sleep이
# 상속받은 stdout/stderr를 90분간 쥐고 남아, 호출자(cron·테스트)가 파이프에서 못 빠져나온다.
# 스트리밍 입력에서는 stdin이 열려 있는 한 세션이 스스로 안 끝난다(닫아도 60초는 안 죽는다).
# `result` 줄이 곧 끝이고, 끝내는 건 우리다. MAXRUN은 그 줄이 영영 안 오는 경우로 남는다.
POLL=5; [ -n "$INBOX" ] && POLL=1
# 마지막 줄이 아니라 offset(줄 수) 이후의 마지막 줄이 `result`인가. §4-11 재활용은 세션 하나에
# 티켓이 여러 장 쌓이므로 "파일 마지막 줄"로는 둘째 주입 직후 첫 티켓의 result를 다시 보고
# 즉시 죽인다(구현 함정 1호, §검증 ⑥) - offset이 그 경계다.
# 접두사로는 못 본다 - 실측된 키 순서는 `is_error`가 먼저다. 문자열 매치만으로 죽이는 것도
# 안 된다: 세션이 뱉는 본문에 이 프로토콜이 그대로 인용될 수 있고(이 레포가 그 문서를 갖고
# 있다) 그러면 남의 티켓을 중간에 잘라낸다. grep은 문지기고 판정은 파싱이다.
is_result() {
  local line
  line=$(tail -n +"$(( $2 + 1 ))" "$1" 2>/dev/null | tail -n 1)
  [ -n "$line" ] || return 1
  printf '%s' "$line" | grep -q '"type":"result"' || return 1
  printf '%s' "$line" | python3 -c \
    'import json,sys
try: o = json.loads(sys.stdin.readline())
except Exception: sys.exit(1)
sys.exit(0 if isinstance(o, dict) and o.get("type") == "result" else 1)'
}

# §4-11 조건 ②④: 이번 구간(offset 이후)만의 판정 + 마지막 assistant 턴 컨텍스트.
# "sid|ok|reason|reset|ctx" 한 줄 - 아래 최종 VERDICT 파서와 같은 필드 + ctx 하나뿐이다.
# 최종 파서는 안 건드린다 - 그건 전체 $OUT을 훑어 마지막 result로 자연히 떨어지므로(누적
# 스캔이 마지막 값으로 덮어써진다) 체인 전체가 끝난 뒤의 판정은 종전 그대로 맞는다.
segment_result() {
  tail -n +"$(( $2 + 1 ))" "$1" 2>/dev/null | python3 -c \
    'import json,sys
LIMIT_WORDS = ("usage limit", "rate limit", "quota")
sid = ""; ok = ""; reason = ""; reset = ""; ctx = ""
for ln in sys.stdin:
    ln = ln.strip()
    if not ln:
        continue
    try: o = json.loads(ln)
    except Exception: continue
    if not isinstance(o, dict): continue
    if o.get("type") == "assistant":
        u = ((o.get("message") or {}).get("usage")) or {}
        try:
            ctx = str(int(u.get("input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
                      + int(u.get("cache_read_input_tokens", 0)))
        except Exception:
            pass
    elif o.get("type") == "result":
        sid = o.get("session_id", "") or sid
        ok = "err" if o.get("is_error") else "ok"
        if "terminal_reason" in o:
            reason = o.get("terminal_reason", "") or ""
        elif o.get("is_error"):
            errs = " ".join(str(e) for e in (o.get("errors") or [])).lower()
            if any(k in errs for k in LIMIT_WORDS):
                reason = "api_error"
    elif o.get("type") == "rate_limit_event":
        info = o.get("rate_limit_info") or {}
        if info.get("status") == "rejected" and isinstance(info.get("resetsAt"), int):
            reset = str(info["resetsAt"])
    elif o.get("type") == "error":
        msg = str(o.get("message", "")).lower()
        if any(k in msg for k in LIMIT_WORDS):
            reason = "api_error"
print("|".join((sid, ok, reason, reset, ctx)))'
}

# §4-11 조건 ⑤: 같은 페르소나 후보를 종전 선정과 같은 임계구역·게이트에서 다시 claim한다.
# ENGINE_NAME·CDOWN은 이미 이 세션의 페르소나로 정해져 있다(위 선정 루프에서 세워졌고 그 뒤로
# 아무도 안 건드린다) - 재활용은 페르소나를 안 바꾸므로 다시 세우지 않고 같은 값으로 게이트를 본다.
select_reuse_candidate() {
  local persona="$1"
  RTPATH=""; RTHASH=""; RTKIND=""; RTPRIO=""; RTBASE=""; RTEFF=""
  local RCANDS
  RCANDS=$(python3 "$PY" select "$TICKET_ROOT") || return 1
  [ -z "$RCANDS" ] && return 1

  if [ -n "$LIMITED" ]; then
    local PLIM PWIP
    PLIM=$(persona_limit "$persona")
    if [ -n "$PLIM" ]; then
      PWIP=$(persona_wip "$persona")
      if [ "$PWIP" -ge "$PLIM" ]; then
        log "SKIP 페르소나 상한 $persona $PWIP/$PLIM"
        return 1
      fi
    fi
  fi

  engine_gate_ok || return 1

  if [ -n "$LIMITED" ]; then
    acquire_slock || return 1
  fi

  local rc_path rc_hash rc_kind rc_persona rc_prio rc_base rc_eff RCPATH
  while IFS='|' read -r rc_path rc_hash rc_kind rc_persona rc_prio rc_base rc_eff; do
    [ -z "$rc_path" ] && continue
    [ "$rc_persona" = "$persona" ] || continue
    if RCPATH=$(python3 "$PY" claim "$rc_path" 2>/dev/null); then
      RTPATH="$RCPATH"; RTHASH="$rc_hash"; RTKIND="$rc_kind"; RTPRIO="$rc_prio"; RTBASE="$rc_base"; RTEFF="$rc_eff"
      break
    fi
  done <<EOF
$RCANDS
EOF

  [ -n "$SLOCK" ] && { rm -rf "$SLOCK"; SLOCK=""; }
  [ -n "$RTPATH" ]
}

# MAXRUN 감시. 매달린 세션을 죽이는 것이 이 감시의 뜻이지 체인 길이를 재는 게 아니라서
# §4-11 재활용마다 죽이고 다시 세운다("티켓마다 새로 잰다"). is_result에 의한 종료는 이제
# 여기 없다 - main 루프가 먼저 봐야 재활용 여부를 결정할 수 있어서 그 판정을 main으로 옮겼다.
# TIMEOUT과 KILLED를 가르는 값은 경과다(§2-5 §로그) - T0가 그 시계다.
start_watchdog() {
  T0=$SECONDS
  ( SECONDS=0
    while [ "$SECONDS" -lt "$TICKET_MAXRUN" ]; do
      kill -0 "$CPID" 2>/dev/null || exit 0
      sleep "$POLL"
    done
    kill -TERM "$CPID" 2>/dev/null; sleep 20; kill -KILL "$CPID" 2>/dev/null ) &
  WPID=$!
}

OUTOFFSET=0
start_watchdog
# bash의 `wait PID`는 그 PID가 속한 **파이프라인 전체**를 기다린다. 프롬프트를 파일로 옮기면서
# 엔진 앞에 `{ cat "$PRIMEF"; cat <&8; }`가 붙었고, 그 cat은 우리가 fd 9를 닫아야 EOF를 본다.
# 먼저 wait하면 서로를 기다려 교착한다 - 세션이 result를 내고 죽어도 워커가 티켓을 안 놓는다
# (2026-08-04 실측: 6/6이 init까지 갔는데 DONE 0, 죽은 엔진 옆에 cat만 남아 MAXRUN까지 잡혔다).
# 그래서 엔진만 따로 지켜보고, fd 9를 닫아 cat을 빼낸 다음에 job을 회수한다.
if [ -n "$INBOX" ]; then
  while :; do
    while kill -0 "$CPID" 2>/dev/null && ! is_result "$OUTF" "$OUTOFFSET"; do
      sleep "$POLL"
    done
    kill -0 "$CPID" 2>/dev/null || break     # 스스로 끝났다(MAXRUN 강제종료 포함) - 재활용 없이 종료 경로

    # 새 구간의 result다. §4-11 재활용 판정 5개 - ①은 여기 도달한 것 자체가(스트리밍+INBOX)
    # 참이므로 TICKET_REUSE만 본다. 하나라도 거짓이면 종전 그대로 죽인다.
    REUSE=""
    if [ "$TICKET_REUSE" != "0" ]; then
      SEG=$(segment_result "$OUTF" "$OUTOFFSET")
      IFS='|' read -r _SEGSID SEGOK _SEGREASON _SEGRESET SEGCTX <<< "$SEG"
      if [ "$SEGOK" = "ok" ] && [ ! -f "$TPATH" ]; then          # ②③
        case "$SEGCTX" in
          [0-9]*) [ "$SEGCTX" -lt "$TICKET_REUSE_CTX" ] && REUSE=1 ;;   # ④(파싱 실패면 예산 초과로 본다)
        esac
        if [ -n "$REUSE" ] && ! select_reuse_candidate "$TPERSONA"; then  # ⑤
          REUSE=""
        fi
      fi
    fi

    if [ -n "$REUSE" ]; then
      # 이어 받는 절차는 최초 디스패치의 축소판이다: assign(같은 sid) -> setpid(같은 CPID) ->
      # 짧은 프롬프트 한 줄을 FIFO에 -> setinbox(주입 뒤에 광고 - tick.sh 최초 주입과 같은 이유).
      log "DONE $THASH sid=$SID"
      python3 "$PY" assign "$RTPATH" "$SID" "${TPERSONA:-agent} / ${TICKET_NAME}-${SID:0:8}"
      python3 "$PY" setpid "$RTPATH" "$CPID"
      RPROMPT=$(printf "$TICKET_PROMPT_FMT" "$RTHASH")
      python3 -c 'import json,sys
sys.stdout.write(json.dumps({"type":"user","message":{"role":"user","content":sys.argv[1]}},
                            ensure_ascii=False, separators=(",", ":")) + "\n")' "$RPROMPT" >&9
      INJOFFSET=$(wc -l < "$OUTF")
      python3 "$PY" setinbox "$RTPATH" "$INBOX"
      RPRIOLOG=$(prio_log "$RTPRIO" "$RTBASE" "$RTEFF")
      log "DISPATCH $RTHASH kind=${RTKIND:--} persona=${TPERSONA:-none} sid=$SID log=$(basename "$LOGF") $RPRIOLOG"

      # 주입 뒤 TICKET_FEED_TIMEOUT 안에 출력이 안 자라면 STALL과 같은 경로다(§4-11 §규칙) -
      # 최초 디스패치의 started() 자리와 같다. 여긴 init 판정이 없으니 "줄이 자랐나"가 그 신호고,
      # 죽었는데도 안 자란 경우까지 STALL로 뭉친다(started()도 kill -0가 죽어서 빠져나온
      # 경우를 갈라 보지 않는다 - 같은 관용구).
      FED=0
      while [ "$FED" -lt "$TICKET_FEED_TIMEOUT" ] && kill -0 "$CPID" 2>/dev/null; do
        [ "$(wc -l < "$OUTF")" -gt "$INJOFFSET" ] && break
        sleep 1; FED=$((FED+1))
      done
      if [ "$(wc -l < "$OUTF")" -le "$INJOFFSET" ]; then
        kill -KILL "$CPID" 2>/dev/null
        log "STALL $RTHASH ${TICKET_FEED_TIMEOUT}s 안에 이어받기 주입 뒤 출력이 안 자랐다 - 기동 실패"
        python3 "$PY" clear "$RTPATH"; python3 "$PY" release "$RTPATH" >/dev/null 2>&1
        kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
        exec 9>&-; wait "$CPID" 2>/dev/null
        OUT=$(cat "$OUTF" 2>/dev/null); rm -f "$OUTF"
        printf '%s\n' "$OUT" >> "$LOGF"
        exit 1
      fi

      OUTOFFSET="$INJOFFSET"
      TPATH="$RTPATH"; THASH="$RTHASH"; TKIND="$RTKIND"
      kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
      start_watchdog
      continue
    fi

    kill -TERM "$CPID" 2>/dev/null; sleep 5; kill -KILL "$CPID" 2>/dev/null
    break
  done
  exec 9>&-
fi
wait "$CPID"; RC=$?
kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
[ -n "$INBOX" ] && rm -f "$INBOX" "$PRIMEF" "${PRIMEF:+$PRIMEF.fed}"
OUT=$(cat "$OUTF" 2>/dev/null); rm -f "$OUTF"
printf '%s\n' "$OUT" >> "$LOGF"

# 실제 세션키와 판정을 응답에서 읽는다. 옛 경로는 응답 전체가 JSON 하나이고,
# stream-json은 JSONL이라 `result` 줄이 판정이다(전체 json.load는 거기서 깨진다).
# 셋째 칸 terminal_reason이 엔진 불능(api_error)과 진짜 세션 실패를 가른다. api_error_status로는
# 못 가른다 - 429가 아닌 네트워크 실패(ENOTFOUND)엔 그 키가 없는데 똑같이 불능이다.
# 넷째 칸은 리밋이 알려준 복귀 시각(epoch). `status: rejected`인 것만 센다 - 같은 이벤트가
# `allowed_warning`으로도 오고(실측 1,058건) 그건 아직 통과한 요청이라 기다릴 이유가 없다.
# reason 판정은 엔진 중립이다(§4-9 §개정 2026-08-05, 승인 04bd819d=(b)) - claude는 그대로
# result.terminal_reason을 읽고, codex(최상위 error 줄)·grok(result.errors, terminal_reason
# 키 없음)은 한도 낱말 셋(usage limit·rate limit·quota) 매치로 같은 api_error에 떨어진다.
# 값을 새로 안 만든다 - 셋 다 "api_error"라 [ "$REASON" = "api_error" ] 게이트는 무수정이다.
VERDICT=$(printf '%s' "$OUT" | python3 -c \
  'import json,sys
LIMIT_WORDS = ("usage limit", "rate limit", "quota")
raw = sys.stdin.read(); sid = ""; ok = ""; reason = ""; reset = ""
for ln in raw.splitlines():
    try: o = json.loads(ln)
    except Exception: continue
    if not isinstance(o, dict): continue
    if o.get("type") == "result":
        sid = o.get("session_id", "") or sid
        ok = "err" if o.get("is_error") else "ok"
        if "terminal_reason" in o:
            reason = o.get("terminal_reason", "") or ""
        elif o.get("is_error"):
            errs = " ".join(str(e) for e in (o.get("errors") or [])).lower()
            if any(k in errs for k in LIMIT_WORDS):
                reason = "api_error"
    elif o.get("type") == "rate_limit_event":
        info = o.get("rate_limit_info") or {}
        if info.get("status") == "rejected" and isinstance(info.get("resetsAt"), int):
            reset = str(info["resetsAt"])
    elif o.get("type") == "error":
        msg = str(o.get("message", "")).lower()
        if any(k in msg for k in LIMIT_WORDS):
            reason = "api_error"
if not sid:
    try: sid = json.loads(raw).get("session_id", "")
    except Exception: pass
print("|".join((sid, ok, reason, reset)))' 2>/dev/null)
IFS='|' read -r REAL VERDICT REASON RESET <<< "$VERDICT"

# 스트리밍 입력에서는 우리가 죽여서 끝내므로 RC(143)는 판정이 아니다. `result` 줄이 판정이다.
if [ -n "$INBOX" ]; then
  [ "$VERDICT" = "ok" ] || FAILED=1
else
  [ $RC -ne 0 ] && FAILED=1
fi
if [ -n "${FAILED:-}" ]; then
  # 실행 실패(또는 상한 초과 강제종료) -> 할당 회수해서 다음 tick이 다시 집도록. 단 세션이
  # 이미 .done으로 닫은 뒤 죽었으면 $TPATH가 없다 - 되돌릴 할당이 없으므로 안 부른다
  # (§4-10 §자리 표 ①, 승인 04bd819d=(b)). 안 부르면 clear의 FileNotFoundError traceback도 안 난다.
  # 존재 여부는 release() 호출 **전에** 한 번만 잰다 - release가 성공하면 그 자체가 파일을
  # 열림 이름으로 rename해 지워버려서, 나중에 다시 재면 정상 케이스도 항상 "없다"로 읽힌다.
  if [ -f "$TPATH" ]; then
    python3 "$PY" clear "$TPATH"
    python3 "$PY" release "$TPATH" >/dev/null 2>&1
  else
    CLOSED=1
  fi
  # 엔진 불능이면 창을 건다. 티켓은 종전대로 백로그로 돌아가고, 다음 tick들이 게이트에서 멈춘다.
  # 리밋이 복귀 시각을 줬으면(실측 api_error의 80%, 앞으로 최대 4.2시간) 임의의 5분이 아니라
  # 그 시각까지 기다린다. 안 줬거나 이미 지난 값이면 300초로 떨어진다(실측 min이 -355초다).
  # 티켓이 닫혔든 말든 엔진이 불능인지 여부와는 무관하다 - 위 가드 밖에 그대로 둔다.
  if [ "$REASON" = "api_error" ]; then
    NOW=$(date +%s); UNTIL=$(( NOW + CDOWN_W ))
    case "$RESET" in ''|*[!0-9]*) ;; *) [ "$RESET" -gt "$UNTIL" ] && UNTIL="$RESET" ;; esac
    arm_cdown "$UNTIL"
    log "NOTE 엔진 불능 - $((UNTIL - NOW))초 쿨다운(복귀 ${RESET:-미상})"
  fi
  if [ -n "${CLOSED:-}" ]; then
    # 세션이 끝까지 수행하고 .done rename까지 자기 손으로 마친 뒤 죽었다 - 큐의 사실은 완료다.
    # FAIL이 아니라 §0-5 판정 1 화이트리스트에 이미 있는 DONE을 재사용해 사유만 붙인다.
    log "DONE $THASH sid=${REAL:-$SID} (세션은 rc=${RC}로 죽었다)"
    exit 0
  fi
  if [ "$VERDICT" = "err" ]; then
    log "FAIL $THASH 세션이 result is_error로 끝났다 -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")"
  else
    case $RC in
      143|137)
        EL=$((SECONDS - T0))
        if [ "$EL" -lt "$TICKET_MAXRUN" ]; then
          log "KILLED $THASH ${EL}s 만에 밖에서 종료(rc=$RC) -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")"
        else
          log "TIMEOUT $THASH ${TICKET_MAXRUN}s 초과 강제종료 -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")"
        fi ;;
      *)       log "FAIL $THASH rc=$RC -> 할당 회수 + 백로그 복귀. 로그 $(basename "$LOGF")" ;;
    esac
  fi
  [ $RC -eq 0 ] && RC=1
  exit $RC
fi

# 같은 가정이다 - 정상 종료한 세션도 이미 티켓을 .done으로 닫았을 수 있다(§자리 표 ④).
if [ -n "$REAL" ] && [ "$REAL" != "$SID" ] && [ -f "$TPATH" ]; then
  python3 "$PY" assign "$TPATH" "$REAL"
  log "NOTE $THASH 세션키 정정 $SID -> $REAL"
fi
rm -f "$CDOWN"          # 세션이 끝까지 갔다 = 엔진이 산다. 창이 남아 있으면 여기서 푼다.
log "DONE $THASH sid=${REAL:-$SID}"
exit 0
