#!/bin/bash
# 재현 검증 - 티켓 29096a45(DESIGN.md §통합 push의 벽, 결정 1~5) - templates/hooks/push.sh.
#
# 정본(push.sh) 옆에 둔다 - 이 파일의 대상이 .dira/가 아니라 여기 있는 정본이라 그렇다
# (verify-token-rotate.sh - verify-multiplay.sh는 대상이 .dira/에만 있는 스크립트라 거기 있다 -
# 같은 규칙, 다른 위치). 전부 mktemp 합성 레포에서 돈다 - 도그푸딩 큐(~/Projects/dira)는 안 만진다
# (제약 1).
#
# 사용법: bash templates/hooks/verify-push.sh   (그린이면 맨 끝에 "전부 PASS")
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PUSH="$DIR/push.sh"
FAIL=0

pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAIL=1; }

# 합성 레포 하나를 만든다 - master 체크아웃 + updateInstead + 워크트리 $2개.
# 결과: $1/main(받는 트리), $1/wt1.. (세션 워크트리).
new_fixture() {
  local d="$1" n="$2" i
  git init -q "$d/main"
  git -C "$d/main" config receive.denyCurrentBranch updateInstead
  git -C "$d/main" config user.email t@t.com
  git -C "$d/main" config user.name t
  echo base > "$d/main/shared.txt"
  git -C "$d/main" add shared.txt
  git -C "$d/main" commit -q -m init
  git -C "$d/main" branch -M master
  i=1
  while [ "$i" -le "$n" ]; do
    git -C "$d/main" worktree add -q "$d/wt$i" -b "wt$i" master
    i=$((i + 1))
  done
}

common_dir() {
  local c
  c=$(git -C "$1" rev-parse --git-common-dir)
  case "$c" in /*) echo "$c" ;; *) echo "$1/$c" ;; esac
}

echo "== ① 직렬화 - 워크트리 둘이 같은 순간에 push.sh를 불러도 트리가 깨끗하고 결국 둘 다 성공한다 =="
T=$(mktemp -d)
new_fixture "$T" 2
echo A1 > "$T/wt1/a.txt"; git -C "$T/wt1" add a.txt; git -C "$T/wt1" commit -qm c1
echo B1 > "$T/wt2/b.txt"; git -C "$T/wt2" add b.txt; git -C "$T/wt2" commit -qm c2
( cd "$T/wt1" && bash "$PUSH" >/tmp/dira_verify_p1.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_p1.$$ ) &
( cd "$T/wt2" && bash "$PUSH" >/tmp/dira_verify_p2.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_p2.$$ ) &
wait
echo "-- wt1 1차 --"; cat /tmp/dira_verify_p1.$$
echo "-- wt2 1차 --"; cat /tmp/dira_verify_p2.$$
DIRTY_MID=$(git -C "$T/main" status --porcelain -uno)
if [ -z "$DIRTY_MID" ]; then pass "1차 직후 트리 깨끗"; else fail "1차 직후 트리 더러움: $DIRTY_MID"; fi
R1=$(tail -1 /tmp/dira_verify_p1.$$); R2=$(tail -1 /tmp/dira_verify_p2.$$)
[ "$R1" = "rc=1" ] && { git -C "$T/wt1" rebase -q master; ( cd "$T/wt1" && bash "$PUSH" >/tmp/dira_verify_p1b.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_p1b.$$ ); echo "-- wt1 재시도(session의 rebase 후 재push) --"; cat /tmp/dira_verify_p1b.$$; }
[ "$R2" = "rc=1" ] && { git -C "$T/wt2" rebase -q master; ( cd "$T/wt2" && bash "$PUSH" >/tmp/dira_verify_p2b.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_p2b.$$ ); echo "-- wt2 재시도(session의 rebase 후 재push) --"; cat /tmp/dira_verify_p2b.$$; }
LOG=$(git -C "$T/main" log --format=%s --all)
if printf '%s\n' "$LOG" | grep -qx c1 && printf '%s\n' "$LOG" | grep -qx c2; then
  pass "결국 c1-c2 둘 다 master에 실렸다"
else
  fail "커밋이 둘 다 안 실렸다: $LOG"
fi
DIRTY_END=$(git -C "$T/main" status --porcelain -uno)
if [ -z "$DIRTY_END" ]; then pass "최종 트리 깨끗"; else fail "최종 트리 더러움: $DIRTY_END"; fi
rm -f /tmp/dira_verify_p1.$$ /tmp/dira_verify_p2.$$ /tmp/dira_verify_p1b.$$ /tmp/dira_verify_p2b.$$
rm -rf "$T"

echo
echo "== ① 대조군 - 락 없이(raw git push) 동시에 겹치면 실제로 잔해가 남는다 =="
T=$(mktemp -d)
new_fixture "$T" 2
seq 1 20000 > "$T/main/shared.txt"
git -C "$T/main" add shared.txt; git -C "$T/main" commit -q --amend -m init
cat > "$(common_dir "$T/main")/hooks/pre-receive" <<'EOF'
#!/bin/bash
sleep 0.3
EOF
chmod +x "$(common_dir "$T/main")/hooks/pre-receive"
git -C "$T/wt1" fetch -q .
git -C "$T/wt2" fetch -q .
git -C "$T/wt1" reset -q --hard master
git -C "$T/wt2" reset -q --hard master
seq 1 20000 | sed '1s/.*/one/' > "$T/wt1/shared.txt"; git -C "$T/wt1" commit -qam c1
seq 1 20000 | sed '1s/.*/two/' > "$T/wt2/shared.txt"; git -C "$T/wt2" commit -qam c2
( cd "$T/wt1" && git push . HEAD:master >/tmp/dira_verify_r1.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_r1.$$ ) &
( cd "$T/wt2" && git push . HEAD:master >/tmp/dira_verify_r2.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_r2.$$ ) &
wait
echo "-- wt1 --"; tail -3 /tmp/dira_verify_r1.$$
echo "-- wt2 --"; tail -3 /tmp/dira_verify_r2.$$
RACE_STATUS=$(git -C "$T/main" status --porcelain -uno)
echo "-- 받는 트리 status --"; echo "${RACE_STATUS:-(깨끗)}"
if [ -n "$RACE_STATUS" ]; then
  pass "락 없이 실제로 잔해가 남는다(이 실행에서 재현됨) - push.sh가 막는 것이 바로 이 모양"
else
  echo "INFO 이번 실행은 재현 안 됨(타이밍 의존 - 실측 e9e27e60/3eccd765처럼 확률적) - push.sh 자체 결함이 아니라 대조군 성격이라 FAIL로 세지 않는다"
fi
rm -f /tmp/dira_verify_r1.$$ /tmp/dira_verify_r2.$$
rm -rf "$T"

echo
echo "== ② 잔해 - 옛 커밋 내용으로 되돌아간 파일은 push가 통과하며 사라진다 =="
T=$(mktemp -d)
new_fixture "$T" 1
echo v2 > "$T/main/shared.txt"; git -C "$T/main" add shared.txt; git -C "$T/main" commit -qm c2
git -C "$T/wt1" fetch -q .; git -C "$T/wt1" reset -q --hard master   # wt1을 c2로 동기화 - 안 하면 push가 잔해와 무관하게 non-fast-forward로 진다
echo base > "$T/main/shared.txt"; git -C "$T/main" add shared.txt   # 옛 커밋(init)의 내용으로 되돌림 = 잔해
( cd "$T/wt1" && bash "$PUSH" >/tmp/dira_verify_2.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_2.$$ )
cat /tmp/dira_verify_2.$$
if grep -q "^rc=0$" /tmp/dira_verify_2.$$; then pass "push 통과"; else fail "push 실패"; fi
if [ "$(cat "$T/main/shared.txt")" = v2 ] && [ -z "$(git -C "$T/main" status --porcelain -uno)" ]; then
  pass "잔해가 버려지고 트리가 깨끗하다"
else
  fail "잔해가 안 지워졌다: $(cat "$T/main/shared.txt")"
fi
rm -f /tmp/dira_verify_2.$$
rm -rf "$T"

echo
echo "== ③ 사람 편집 - 이력에 없는 줄은 push 뒤에도 그대로 있다 =="
T=$(mktemp -d)
new_fixture "$T" 1
echo "이력에 없는 사람 줄" > "$T/main/shared.txt"
( cd "$T/wt1" && echo other > g.txt; git -C "$T/wt1" add g.txt; git -C "$T/wt1" commit -qm c1
  bash "$PUSH" >/tmp/dira_verify_3.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_3.$$ )
cat /tmp/dira_verify_3.$$
if grep -q "^rc=0$" /tmp/dira_verify_3.$$; then pass "push 통과"; else fail "push 실패"; fi
if [ "$(cat "$T/main/shared.txt")" = "이력에 없는 사람 줄" ] && [ -z "$(git -C "$T/main" stash list)" ]; then
  pass "사람 편집이 push 뒤에도 그대로 있고 stash가 안 남았다"
else
  fail "사람 편집이 사라지거나 stash가 남았다: $(cat "$T/main/shared.txt") / $(git -C "$T/main" stash list)"
fi
rm -f /tmp/dira_verify_3.$$
rm -rf "$T"

echo
echo "== ④ 겹침 - 사람이 고친 파일을 push가 갱신하면 트리가 깨끗하고 충돌 마커 0, 내용은 dira-autostash에 있다 =="
T=$(mktemp -d)
new_fixture "$T" 1
printf 'line1\nline2\n' > "$T/main/shared.txt"; git -C "$T/main" add shared.txt; git -C "$T/main" commit -qm c0
git -C "$T/wt1" fetch -q .; git -C "$T/wt1" reset -q --hard master   # wt1을 c0로 동기화 - 안 하면 push가 겹침과 무관하게 non-fast-forward로 진다
printf 'HUMAN\nline2\n' > "$T/main/shared.txt"
printf 'SESSION\nline2\n' > "$T/wt1/shared.txt"; git -C "$T/wt1" commit -qam c1
( cd "$T/wt1" && bash "$PUSH" >/tmp/dira_verify_4.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_4.$$ )
cat /tmp/dira_verify_4.$$
if grep -q "^rc=0$" /tmp/dira_verify_4.$$; then pass "push 통과"; else fail "push 실패"; fi
CONFLICT=$(grep -c '<<<<<<<' "$T/main/shared.txt" 2>/dev/null)   # grep -c는 매치 0건에서도 "0"을 찍고 rc=1을 낸다 - `|| echo 0`을 걸면 rc=1에 걸려 "0" 두 줄이 된다
CONFLICT=${CONFLICT:-0}
CLEAN=$(git -C "$T/main" status --porcelain -uno)
STASHED=$(git -C "$T/main" stash list | grep -c "dira-autostash ")
if [ "$CONFLICT" = 0 ] && [ -z "$CLEAN" ] && [ "$STASHED" = 1 ]; then
  pass "충돌 마커 0, 트리 깨끗, dira-autostash 1건 보존"
else
  fail "conflict=$CONFLICT clean=[$CLEAN] stashed=$STASHED"
fi
if git -C "$T/main" stash show -p "stash@{0}" | grep -q HUMAN; then
  pass "사람 편집 내용이 stash에서 복구 가능"
else
  fail "stash에 사람 편집 내용이 없다"
fi
rm -f /tmp/dira_verify_4.$$
rm -rf "$T"

echo
echo "== ⑤ 죽은 세션 - stash push 뒤 pop 전에 죽어도 다음 실행이 되돌린다 =="
T=$(mktemp -d)
new_fixture "$T" 1
echo "사람이 치던 중" > "$T/main/shared.txt"
git -C "$T/main" stash push -qm "dira-autostash 2026-01-01T00:00:00 w9" -- shared.txt
( cd "$T/wt1" && echo other > g.txt; git -C "$T/wt1" add g.txt; git -C "$T/wt1" commit -qm c1
  bash "$PUSH" >/tmp/dira_verify_5.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_5.$$ )
cat /tmp/dira_verify_5.$$
if grep -q "앞 실행이 남긴 dira-autostash를 되돌렸다" /tmp/dira_verify_5.$$ &&
   [ "$(cat "$T/main/shared.txt")" = "사람이 치던 중" ]; then
  pass "죽은 세션이 남긴 stash를 되돌리고 내용을 보존했다"
else
  fail "되돌리기 실패: $(cat "$T/main/shared.txt")"
fi
rm -f /tmp/dira_verify_5.$$
rm -rf "$T"

echo
echo "== ⑥ 락 상한 - 120초 뒤 push 없이 비0, 락 경로가 문구에 있다(느림 - 약 2분 소요) =="
T=$(mktemp -d)
new_fixture "$T" 1
CD=$(common_dir "$T/main")
mkdir "$CD/dira-push.lock"
echo $$ > "$CD/dira-push.lock/pid"
( cd "$T/wt1" && echo other > g.txt; git -C "$T/wt1" add g.txt; git -C "$T/wt1" commit -qm c1
  START=$(date +%s)
  bash "$PUSH" >/tmp/dira_verify_6.$$ 2>&1
  echo "rc=$?" >>/tmp/dira_verify_6.$$
  echo "elapsed=$(($(date +%s) - START))s" >>/tmp/dira_verify_6.$$ )
cat /tmp/dira_verify_6.$$
if grep -q "^rc=1$" /tmp/dira_verify_6.$$ && grep -q "dira-push.lock" /tmp/dira_verify_6.$$; then
  pass "120초 상한 뒤 비0 + 락 경로 문구"
else
  fail "상한 처리 실패"
fi
rm -f /tmp/dira_verify_6.$$
rm -rf "$T"

echo
echo "== ⑦ 스테일 락 - 죽은 pid가 든 락은 회수된다 =="
T=$(mktemp -d)
new_fixture "$T" 1
CD=$(common_dir "$T/main")
mkdir "$CD/dira-push.lock"
( exit 0 ) & DEADPID=$!; wait "$DEADPID"
echo "$DEADPID" > "$CD/dira-push.lock/pid"
( cd "$T/wt1" && echo other > g.txt; git -C "$T/wt1" add g.txt; git -C "$T/wt1" commit -qm c1
  bash "$PUSH" >/tmp/dira_verify_7.$$ 2>&1; echo "rc=$?" >>/tmp/dira_verify_7.$$ )
cat /tmp/dira_verify_7.$$
if grep -q "스테일 락 회수" /tmp/dira_verify_7.$$ && grep -q "^rc=0$" /tmp/dira_verify_7.$$ &&
   [ ! -d "$CD/dira-push.lock" ]; then
  pass "스테일 락 회수 후 push 성공, 락 해제"
else
  fail "스테일 락 회수 실패"
fi
rm -f /tmp/dira_verify_7.$$
rm -rf "$T"

echo
echo "== ⑧ classify 서브커맨드가 잔해/사람편집을 한 낱말로 답한다 =="
T=$(mktemp -d)
new_fixture "$T" 0
echo v1 > "$T/main/f1.txt"; echo v1 > "$T/main/f2.txt"
git -C "$T/main" add f1.txt f2.txt; git -C "$T/main" commit -qm c1
echo v2 > "$T/main/f1.txt"; git -C "$T/main" add f1.txt; git -C "$T/main" commit -qm c2
echo v1 > "$T/main/f1.txt"           # 잔해(c1 시절 내용)
echo "새 사람 내용" > "$T/main/f2.txt"   # 사람 편집
OUT=$(cd "$T/main" && bash "$PUSH" classify f1.txt f2.txt 2>&1)
echo "$OUT"
if [ "$OUT" = "$(printf '잔해\n사람편집')" ]; then
  pass "classify가 잔해/사람편집을 정확히 한 낱말씩 답했다"
else
  fail "classify 출력이 다르다: $OUT"
fi
rm -rf "$T"

echo
echo "== 엔진 무수정 - tick.sh/tickets.py는 0줄 =="
cd "$DIR/../.."
STAT=$(git diff --stat master -- tick.sh tickets.py)
if [ -z "$STAT" ]; then pass "엔진 diff 0줄"; else fail "엔진이 바뀌었다: $STAT"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "전부 PASS"; else echo "FAIL 있음"; fi
exit "$FAIL"
