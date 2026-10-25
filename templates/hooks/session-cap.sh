#!/bin/bash
# 머신 전체 동시 세션 상한 — 이 큐(도그푸딩)의 워커가 dispatch-gate.sh 다음, self-heal.sh
# 앞에서 source한다. 엔진이 아니다.
#
# 왜 있나(§세션이 120초 안에 못 뜬다 결정 5). `pool-limit`은 프로젝트 하나가 빌리는 상한이라
# 큐 셋을 합친 수를 아무도 안 센다(§4-16 결정 3). 코어 10개 위에 큐 일곱이 각자 자기 상한만
# 지키면 동시 10벌이 되고, 실측(디스패치 753건을 동시 세션 수로 가른 표)은 그 자리의 `STALL`을
# 22.6%로 쟀다. 같은 표에서 6은 4.0%, 7은 6.6%이고 수용조건의 판정선이 5%라 상한값 6은 그
# 표에서 읽은 값이다.
#
# 이 파일은 워커가 **source**한다. 중단이 `return`이 아니라 `exit`인 이유는 dispatch-gate.sh
# 머리 주석과 같다 — return은 source한 자리로 돌아가고, 워커는 그대로 디스패치로 넘어간다.
#
# 세는 것은 산 세션 수 하나다. 로드 평균이나 메모리 여유는 안 읽는다 — 그 수는 사람이 켠
# Chrome과 VS Code가 정하고 있어서(실측), 큐가 아무리 조용해도 안 내려간다.
#
# list·unassign·reap은 GUI가 부른다. 통합과 무관하므로 막지 않는다(dispatch-gate.sh와 같은 판정).
#
# 개정(§세션이 120초 안에 못 뜬다 §개정, 요구 `b0fc86da`) — 상한값과 세는 법은 결정 5 그대로다.
# 더한 것은 큐마다 몫을 세고, 몫을 이미 넘긴 큐가 굶는 큐를 위해 이번 tick을 양보하는 것(결정
# 4)뿐이다. 자리를 놀리지 않도록 어느 갈래로 끝나든 맨 앞에서 `run/cap-seen-<자기 큐 id>`를
# touch한다 — 이 파일의 mtime이 다른 큐가 나를 활성으로 보는 유일한 신호다.
if [ "${1:-tick}" = tick ] || [ "${1:-tick}" = dryrun ]; then
  _sc_local="${TICKET_LOCAL:-$HOME/.config/dira}"
  _sc_limit_file="$_sc_local/session-limit"
  _sc_registry="$_sc_local/gui-projects.json"
  # 이름은 $0에서 얻는다 — dispatch-gate.sh보다 뒤에서 source되지만 tick.sh보다는 앞이라
  # $TICKET_NAME은 아직 없다.
  _sc_me=$(basename "$0" .sh)
  _sc_runlog="$(dirname "$0")/runner.log"
  # 훅이 도는 자리가 <루트>/workers/<w>.sh이므로 큐 루트는 그 조부모다(결정 4).
  _sc_root="$(dirname "$(dirname "$0")")"

  # 자기 큐 id를 registry에서 찾아 cap-seen을 맨 앞에서 touch한다. 못 찾으면(등록 안 된 큐)
  # 아무것도 안 하고 뒤에서 몫 판정을 건너뛴다.
  _sc_id=$(python3 - "$_sc_registry" "$_sc_root" <<'PYEOF'
import json, sys

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        registry = json.load(f)
except (OSError, ValueError):
    sys.exit(0)

for project in registry.get("projects", []):
    if project.get("root") == sys.argv[2]:
        print(project.get("id") or "")
        break
PYEOF
)
  if [ -n "$_sc_id" ]; then
    mkdir -p "$_sc_local/run" 2>/dev/null
    touch "$_sc_local/run/cap-seen-$_sc_id" 2>/dev/null
  fi

  # --- 고아 세션: 없어진 MAXRUN 감시를 여기서 다시 세운다 ---
  # 부모 워커 셸이 중간에 죽으면(fork 실패·강제종료·사람의 kill) 그 셸이 띄운 MAXRUN 감시
  # (`tick.sh` §start_watchdog)도 같이 사라진다. 남은 엔진 세션은 PPID=1이 되고 아무도 안
  # 죽이므로 `.wip`을 영영 쥔다. 그 pid가 살아 있으니 아래 상한 계산이 그 자리를 계속 산
  # 세션으로 세고, 자리가 다 차면 이 큐만이 아니라 형제 큐까지 통째로 선다.
  # 2026-09-05 실측 - 고아 여섯이 상한 6/6을 채워 7시간 30분 동안 한 건도 안 나갔고, 그동안
  # 상한 로그 한 줄만 반복돼서 겉으로는 정상과 구별이 안 됐다.
  #
  # 자리가 여기인 이유 하나 - **상한에 걸려도 도는 유일한 자리**다. 아래 CAP 갈래는 tick.sh를
  # 부르기 전에 `exit 0`이라, 상한이 차 있는 동안은 tick.sh 안의 reap이 아예 안 돈다. 고아를
  # 상한 계산 **앞에서** 끊어야 그 다음 tick이 reap까지 갈 수 있다 - 끊고 나면 pid가 죽으므로
  # 아래 계산이 그 자리를 안 세고, 다음 tick의 reap이 `.wip`을 백로그로 돌린다.
  #
  # 판정 셋을 다 만족해야 끊는다 - 이 큐의 `.wip`이 적은 pid · PPID가 1(부모가 없다) ·
  # 경과가 MAXRUN(5,400초, tick.sh 기본값과 같은 수) 초과. 부모가 살아 있으면 손대지 않는다 -
  # 그건 정상 세션이고 그 부모의 감시가 제 시각에 끊는다.
  _sc_orphans=$(python3 - "$_sc_root" 5400 <<'ORPHANEOF'
import os, re, subprocess, sys

root, maxrun = sys.argv[1], int(sys.argv[2])
pid_re = re.compile(r"^pid:\s*['\"]?(\d+)", re.MULTILINE)


def elapsed(text):
    # ps의 etime은 [[dd-]hh:]mm:ss다.
    days = 0
    if "-" in text:
        d, text = text.split("-", 1)
        days = int(d)
    parts = [int(x) for x in text.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


try:
    names = os.listdir(os.path.join(root, "tickets"))
except OSError:
    sys.exit(0)

for name in sorted(names):
    if not name.endswith(".wip.md"):
        continue
    try:
        with open(os.path.join(root, "tickets", name), encoding="utf-8") as f:
            body = f.read()
    except OSError:
        continue
    m = pid_re.search(body)
    if not m:
        continue
    pid = int(m.group(1))
    out = subprocess.run(["ps", "-o", "ppid=,etime=", "-p", str(pid)],
                         capture_output=True, text=True).stdout.split()
    if len(out) != 2 or out[0] != "1":
        continue
    try:
        secs = elapsed(out[1])
    except ValueError:
        continue
    if secs < maxrun:
        continue
    # 먼저 TERM으로 끊어 세션이 쓰던 것을 접을 틈을 준다. 한 번 더 와서도 살아 있으면
    # (MAXRUN + 600초) KILL이다 - tick.sh의 감시가 TERM 뒤 20초를 주는 것과 같은 뜻이다.
    try:
        os.kill(pid, 9 if secs > maxrun + 600 else 15)
    except OSError:
        continue
    print("%s %s %s" % (name[:-7], pid, secs))
ORPHANEOF
)
  if [ -n "$_sc_orphans" ]; then
    printf '%s\n' "$_sc_orphans" | while read -r _sc_oh _sc_op _sc_os; do
      [ -n "$_sc_oh" ] || continue
      printf '%s [%s] ORPHAN-KILL %s pid=%s 경과 %ss - 부모 없는 세션이 MAXRUN을 넘겼다\n' \
        "$(date '+%F %T')" "$_sc_me" "$_sc_oh" "$_sc_op" "$_sc_os" >> "$_sc_runlog"
    done
  fi
  unset _sc_orphans _sc_oh _sc_op _sc_os

  # 상한값 — <자리>는 정수 한 줄이다(pool-limit과 같은 모양, §4-16 결정 3). 없거나 정수가
  # 아니면 상한 없음으로 읽는다.
  _sc_limit=$(sed -n '1p' "$_sc_limit_file" 2>/dev/null | tr -d ' \t\r\n')
  case "$_sc_limit" in
    ''|*[!0-9]*) _sc_limit="" ;;
  esac

  if [ -n "$_sc_limit" ]; then
    # --- 검사-디스패치 직렬화 락 (요구 ae6ccb48) ---
    # 산 세션 수는 `.wip`에 pid가 적힐 때야 오른다. 검사 뒤 pid가 적히기 전까지 다른 워커가
    # 같은 수를 읽으면 전원이 통과한다(2026-10-25 16:38 실측 - 산 2에서 넷이 통과해 5/3).
    # 그래서 검사부터 pid 등록까지 머신 전체에서 하나만 지나가게 한다. 형식은 tick-lock.sh와
    # 같다 - mkdir 락 + pid 파일 + 스테일 회수, 의존성 0. 락을 못 잡으면 이번 tick을 건너뛴다
    # (cron이 30초 뒤 다시 온다).
    #
    # 놓는 쪽 - 이 셸은 tick.sh가 끝까지 차지해서 직접 뗄 지점이 없다(tick-lock.sh와 같은
    # 사정). 분리된 감시 서브셸이 (1) 이 큐의 pid 적힌 `.wip` 수가 검사 때보다 늘었거나(=
    # 디스패치가 등록됨) (2) 워커 셸이 죽었거나(=디스패치할 것이 없어 tick이 끝남) (3) 상한
    # 시간이 지나면 뗀다. 상한 시간을 넘긴 락은 다음 tick이 스테일로 회수한다.
    _sc_lock="$_sc_local/run/session-cap.lock"
    _sc_lock_max="${TICKET_SESSION_CAP_LOCK_MAX:-120}"
    mkdir -p "$_sc_local/run" 2>/dev/null
    _sc_got=
    if mkdir "$_sc_lock" 2>/dev/null; then
      _sc_got=1
    else
      # 스테일 회수는 `.reclaim` 락을 쥔 하나만 한다. 판정 뒤 락이 다른 워커 것으로 바뀌는
      # 틈에 둘이 지우고 다시 잡으면 겹치므로, 락 안에서 스테일을 한 번 더 판정한다.
      # 회수 락 자신도 상한 시간이 지나면 걷는다(회수자가 죽은 경우).
      _sc_rl="$_sc_lock.reclaim"
      _sc_age=$(( $(date +%s) - $(stat -f %m "$_sc_rl" 2>/dev/null || echo 0) ))
      [ -d "$_sc_rl" ] && [ "$_sc_age" -ge "$_sc_lock_max" ] && rm -rf "$_sc_rl" 2>/dev/null
      if mkdir "$_sc_rl" 2>/dev/null; then
        _sc_pid=
        read -r _sc_pid < "$_sc_lock/pid" 2>/dev/null
        _sc_age=$(( $(date +%s) - $(stat -f %m "$_sc_lock" 2>/dev/null || echo 0) ))
        _sc_stale=
        if [ ! -d "$_sc_lock" ]; then
          _sc_stale=1   # 그새 풀렸다
        elif [ "$_sc_age" -ge "$_sc_lock_max" ]; then
          _sc_stale=1
        elif [ -n "$_sc_pid" ]; then
          kill -0 "$_sc_pid" 2>/dev/null || _sc_stale=1
        elif [ "$_sc_age" -ge 5 ]; then
          _sc_stale=1   # pid 파일을 쓰기 전에 죽은 락
        fi
        if [ -n "$_sc_stale" ]; then
          rm -rf "$_sc_lock" 2>/dev/null
          mkdir "$_sc_lock" 2>/dev/null && _sc_got=1
        fi
        rmdir "$_sc_rl" 2>/dev/null
      fi
    fi
    if [ -z "$_sc_got" ]; then
      printf '%s [%s] 상한 - 다른 워커가 상한 검사 중이라 이번 tick을 건너뜀\n' \
        "$(date '+%F %T')" "$_sc_me" >> "$_sc_runlog"
      exit 0
    fi
    echo "$$" > "$_sc_lock/pid" 2>/dev/null
    _sc_base=$(grep -l '^pid:' "$_sc_root"/tickets/*.wip.md 2>/dev/null | wc -l)
    (
      _w_end=$(( $(date +%s) + _sc_lock_max ))
      while [ "$(date +%s)" -lt "$_w_end" ]; do
        sleep 1
        kill -0 "$$" 2>/dev/null || break
        [ "$(grep -l '^pid:' "$_sc_root"/tickets/*.wip.md 2>/dev/null | wc -l)" -gt "$_sc_base" ] && break
      done
      # 내 락일 때만 뗀다 - 그 사이 스테일로 회수돼 남의 락이 됐으면 건드리지 않는다.
      read -r _w_owner < "$_sc_lock/pid" 2>/dev/null
      [ "$_w_owner" = "$$" ] && rm -rf "$_sc_lock" 2>/dev/null
    ) </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null
    # 큐 목록의 단일 출처는 gui-projects.json의 projects[].root다(결정 5). 큐마다 그 아래
    # tickets/*.wip.md에서 pid:가 살아 있는 것을 센다 — tick.sh의 unassign이 쓰는 판정과
    # 같다(pid 존재 + kill -0). registry가 없거나 깨졌으면 0으로 본다(막다른 잠금을 피한다).
    # 자기 큐 id가 있으면(위에서 찾았으면) 결정 4의 몫 판정까지 같은 스캔에서 낸다.
    _sc_verdict=$(python3 - "$_sc_registry" "$_sc_local" "$_sc_id" "$_sc_limit" <<'PYEOF'
import json, os, re, sys, time

registry_path, local_dir, self_id, limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

try:
    with open(registry_path, encoding="utf-8") as f:
        registry = json.load(f)
except (OSError, ValueError):
    print("OK")
    sys.exit(0)

pid_re = re.compile(r"^pid:\s*['\"]?(\d+)", re.MULTILINE)

def live_count(root):
    tickets_dir = os.path.join(root, "tickets")
    try:
        names = os.listdir(tickets_dir)
    except OSError:
        return 0
    n = 0
    for name in names:
        if not name.endswith(".wip.md"):
            continue
        try:
            with open(os.path.join(tickets_dir, name), encoding="utf-8") as tf:
                body = tf.read()
        except OSError:
            continue
        m = pid_re.search(body)
        if not m:
            continue
        try:
            os.kill(int(m.group(1)), 0)
        except ProcessLookupError:
            continue
        except PermissionError:
            pass  # 권한 없이도 존재는 확인된 것 — 산 세션으로 센다
        n += 1
    return n

def open_ticket_count(root):
    try:
        names = os.listdir(os.path.join(root, "tickets"))
    except OSError:
        return 0
    return sum(
        1 for n in names
        if n.endswith(".md") and not n.endswith(".wip.md") and not n.endswith(".done.md")
    )

def has_stale_wip(root):
    # 풀 디스패처의 후보 판정과 같은 식이다(§4-16 개정 1 결정 5).
    try:
        names = os.listdir(os.path.join(root, "tickets"))
    except OSError:
        return False
    for n in names:
        if not n.endswith(".wip.md"):
            continue
        try:
            text = open(os.path.join(root, "tickets", n), encoding="utf-8").read()
        except OSError:
            continue
        m = pid_re.search(text)
        if not m:
            continue
        try:
            os.kill(int(m.group(1)), 0)
        except OSError:
            return True  # 죽었다
    return False

rows = []  # (id, root)
live = {}
total = 0
for project in registry.get("projects", []):
    root, pid = project.get("root"), project.get("id")
    if not root or not pid:
        continue
    n = live_count(root)
    live[pid] = n
    total += n
    rows.append((pid, root))

if total >= limit:
    print(f"CAP {total}")
    sys.exit(0)

if not self_id or self_id not in live:
    print("OK")
    sys.exit(0)

now = time.time()

def cap_seen_fresh(pid):
    try:
        mtime = os.path.getmtime(os.path.join(local_dir, "run", f"cap-seen-{pid}"))
    except OSError:
        return False
    return (now - mtime) <= 120

active_ids = [
    pid for pid, root in rows
    if (open_ticket_count(root) > 0 or has_stale_wip(root)) and cap_seen_fresh(pid)
]
active_n = max(1, len(active_ids))
share = max(1, limit // active_n)
self_live = live[self_id]
starving = any(live.get(pid, 0) < share for pid in active_ids)

if self_live >= share and starving:
    print(f"QUOTA {self_live} {share}")
else:
    print("OK")
PYEOF
)
    case "$_sc_verdict" in
      CAP\ *)
        _sc_count="${_sc_verdict#CAP }"
        printf '%s [%s] 상한 - 머신 전체 산 세션 %s/%s, 이번 tick을 건너뜀\n' \
          "$(date '+%F %T')" "$_sc_me" "$_sc_count" "$_sc_limit" >> "$_sc_runlog"
        rm -rf "$_sc_lock" 2>/dev/null
        exit 0
        ;;
      QUOTA\ *)
        _sc_n="$(printf '%s' "$_sc_verdict" | awk '{print $2}')"
        _sc_k="$(printf '%s' "$_sc_verdict" | awk '{print $3}')"
        printf '%s [%s] 몫 - 이 큐가 %s벌로 몫 %s를 채웠고 굶는 큐가 있어 이번 tick을 양보함\n' \
          "$(date '+%F %T')" "$_sc_me" "$_sc_n" "$_sc_k" >> "$_sc_runlog"
        rm -rf "$_sc_lock" 2>/dev/null
        exit 0
        ;;
    esac
  fi
  unset _sc_local _sc_limit_file _sc_registry _sc_me _sc_runlog _sc_root _sc_id _sc_limit _sc_verdict _sc_count _sc_n _sc_k _sc_lock _sc_lock_max _sc_got _sc_pid _sc_age _sc_stale _sc_base _sc_rl
fi
