#!/bin/bash
# 재현 검증 - 티켓 6ee58f81 - templates/hooks/push.sh의 `run_verify_changed_hook`(do_ship이
# 커밋 직후 push 직전에 부르는 자리). 이 스크립트가 보는 것은 **엔진이 아는 몫**뿐이다 - 훅이
# 있으면 부르고, 훅이 비0이면 push 전에 멈추고, 훅이 없으면 종전과 다르게 안 돈다. 훅 안에서
# pnpm/eslint/apps/teams를 무엇으로 쓰든(이 레포는 `.dira-verify-changed.sh`를 쓴다 -
# 6ee58f81 §결과) 이 검증의 범위가 아니다 - 가짜 훅으로만 플러밍을 잰다. 전부 mktemp 합성
# 레포에서 돈다(도그푸딩 큐는 안 만진다).
#
# 사용법: bash templates/hooks/verify-push-hook.sh   (그린이면 맨 끝에 "전부 PASS")
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PUSH="$(mktemp)"
sed 's/<통합 브랜치>/master/g' "$DIR/push.sh" > "$PUSH"
chmod +x "$PUSH"
trap 'rm -f "$PUSH"' EXIT
FAIL=0

pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAIL=1; }

new_fixture() {
  local d="$1"
  git init -q "$d/main"
  git -C "$d/main" config receive.denyCurrentBranch updateInstead
  git -C "$d/main" config user.email t@t.com
  git -C "$d/main" config user.name t
  echo base > "$d/main/shared.txt"
  git -C "$d/main" add shared.txt
  git -C "$d/main" commit -q -m init
  git -C "$d/main" branch -M master
  git -C "$d/main" worktree add -q "$d/wt1" -b wt1 master
}

echo "== ① 훅이 없으면 종전과 다르게 안 돈다(push 그대로 성공) =="
T=$(mktemp -d)
new_fixture "$T"
echo c1 > "$T/wt1/a.txt"
( cd "$T/wt1" && bash "$PUSH" ship h1 "제목" >/tmp/dira_vh_1.$$ 2>&1; echo "rc=$?" >>/tmp/dira_vh_1.$$ )
cat /tmp/dira_vh_1.$$
if grep -q "^rc=0$" /tmp/dira_vh_1.$$ && [ "$(cd "$T/main" && git log --format=%s -1)" = "제목" ]; then
  pass "훅 없이 ship이 그대로 성공"
else
  fail "훅 없을 때 동작이 달라졌다"
fi
rm -f /tmp/dira_vh_1.$$
rm -rf "$T"

echo
echo "== ② 훅이 비0이면 커밋은 워크트리에 남지만 master는 안 움직인다 =="
T=$(mktemp -d)
new_fixture "$T"
cat > "$T/wt1/.dira-verify-changed.sh" <<'EOF'
#!/bin/bash
grep -q BADFILE && { echo "FAKE_LINT_ERROR BADFILE.txt:1"; exit 1; }
exit 0
EOF
chmod +x "$T/wt1/.dira-verify-changed.sh"
git -C "$T/wt1" add .dira-verify-changed.sh
git -C "$T/wt1" commit -qm "훅 추가"
echo 내용 > "$T/wt1/BADFILE.txt"
BEFORE=$(git -C "$T/main" rev-parse master)
( cd "$T/wt1" && bash "$PUSH" ship h2 "제목2" >/tmp/dira_vh_2.$$ 2>&1; echo "rc=$?" >>/tmp/dira_vh_2.$$ )
cat /tmp/dira_vh_2.$$
AFTER=$(git -C "$T/main" rev-parse master)
if grep -q "^rc=0$" /tmp/dira_vh_2.$$; then
  fail "훅이 실패했는데 rc=0이다"
else
  pass "훅 실패 -> 0이 아닌 코드"
fi
if grep -q "FAKE_LINT_ERROR BADFILE.txt:1" /tmp/dira_vh_2.$$; then
  pass "훅의 file:line 출력이 그대로 보인다"
else
  fail "훅 출력이 안 보인다"
fi
if [ "$BEFORE" = "$AFTER" ]; then
  pass "master가 안 움직였다"
else
  fail "훅이 막았는데 master가 움직였다"
fi
if git -C "$T/wt1" log --format=%s -1 | grep -q "제목2"; then
  pass "로컬 커밋 자체는 남아 재시도 가능"
else
  fail "로컬 커밋이 안 만들어졌다"
fi
rm -f /tmp/dira_vh_2.$$
rm -rf "$T"

echo
echo "== ③ 훅이 0이면(이번 커밋에 BADFILE 없음) 지금처럼 push된다 =="
T=$(mktemp -d)
new_fixture "$T"
cat > "$T/wt1/.dira-verify-changed.sh" <<'EOF'
#!/bin/bash
grep -q BADFILE && exit 1
exit 0
EOF
chmod +x "$T/wt1/.dira-verify-changed.sh"
git -C "$T/wt1" add .dira-verify-changed.sh
git -C "$T/wt1" commit -qm "훅 추가"
echo 깨끗 > "$T/wt1/a.txt"
( cd "$T/wt1" && bash "$PUSH" ship h3 "제목3" >/tmp/dira_vh_3.$$ 2>&1; echo "rc=$?" >>/tmp/dira_vh_3.$$ )
cat /tmp/dira_vh_3.$$
if grep -q "^rc=0$" /tmp/dira_vh_3.$$ && [ "$(cd "$T/main" && git log --format=%s -1)" = "제목3" ]; then
  pass "훅 통과 -> 지금처럼 push"
else
  fail "훅이 통과했는데 push가 안 됐다"
fi
rm -f /tmp/dira_vh_3.$$
rm -rf "$T"

echo
if [ "$FAIL" = 0 ]; then
  echo "전부 PASS"
else
  echo "실패 있음"
  exit 1
fi
