#!/bin/bash
# P460-1: Background launchd 세션(cron 워커)은 로그인 키체인을 못 봐서 agy CLI가 대화형 OAuth로
# 빠진다(docs/design/요구-절.md §다른 사용자도 agy CLI만 깔려 있으면 워커에서 agy가 돈다).
# 이 중계가 사람 GUI 세션(gui/<uid>)에 일회용 LaunchAgent를 띄워 "$@"를 대신 실행하고, 그
# stdin-stdout-stderr-종료 코드를 그대로 돌려준다. tick.sh가 TICKET_ENGINE 앞에 이 스크립트를
# 붙여서 부른다(엔진 argv 전체가 "$@"로 들어온다).
set -uo pipefail

UIDN="$(id -u)"

# 결정 2: 사람이 로그아웃한 상태면 60초 대기 없이 바로 사유를 낸다.
if ! launchctl print "gui/$UIDN" >/dev/null 2>&1; then
  echo "agy-gui: GUI 세션 없음 - 로그인한 상태에서만 agy 워커가 돈다" >&2
  exit 75
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/agy-gui.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

INF="$WORKDIR/in"
OUTF="$WORKDIR/out"
ERRF="$WORKDIR/err"
RCF="$WORKDIR/rc"
RUN="$WORKDIR/run.sh"
PLIST="$WORKDIR/job.plist"

cat >"$INF"

cat >"$RUN" <<'RUNEOF'
#!/bin/bash
"$@"
echo $? > "$AGY_GUI_RCF"
RUNEOF
chmod +x "$RUN"

# 결정 2: 잡 라벨에 이 중계 프로세스의 pid를 넣는다 - 죽은 워커가 남긴 잡을 뒤에서(P460-2)
# 이 pid의 생사로 가려 bootout한다.
LABEL="tech.proofer.dira.agy-gui.$$.${RANDOM}${RANDOM}"

PARGS="    <string>/bin/bash</string>
    <string>$RUN</string>
"
for a in "$@"; do
  esc="${a//&/&amp;}"
  esc="${esc//</&lt;}"
  esc="${esc//>/&gt;}"
  PARGS="$PARGS    <string>$esc</string>
"
done

cat >"$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
$PARGS  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGY_GUI_RCF</key><string>$RCF</string>
  </dict>
  <key>StandardInPath</key><string>$INF</string>
  <key>StandardOutPath</key><string>$OUTF</string>
  <key>StandardErrorPath</key><string>$ERRF</string>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLISTEOF

if ! launchctl bootstrap "gui/$UIDN" "$PLIST" >/dev/null 2>&1; then
  echo "agy-gui: launchctl bootstrap 실패 - 잡을 못 띄웠다" >&2
  exit 75
fi

# rc 파일이 생길 때까지 기다린다 - 상한은 없다(agy 작업 자체가 분 단위로 걸릴 수 있다).
while [ ! -f "$RCF" ]; do
  sleep 0.2
done
RC="$(cat "$RCF" 2>/dev/null || echo 1)"

launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1

cat "$OUTF" 2>/dev/null
cat "$ERRF" >&2 2>/dev/null
exit "$RC"
