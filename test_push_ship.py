#!/usr/bin/env python3
"""`templates/hooks/push.sh`의 `ship` 서브커맨드 자체검증 (§마무리 의례를 헬퍼가 감싼다).

임시 git 트리 한 벌(받는 트리 + 그 워크트리)을 매 케이스마다 새로 만든다 - 이 큐를
도그푸딩으로 쓰지 않는다(수용조건 5). 정상 경로 - non-ff 1회 재시도 - 두 번째 거부 - 커밋할
것 없음 넷과, 인자 없는 기존 경로 - `classify`가 안 갈렸다는 것까지 잰다(수용조건 1-4).
"""
import atexit
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_ORIG_PUSH_SH = os.path.join(HERE, "templates", "hooks", "push.sh")

# 정본엔 `<통합 브랜치>` 자리표시자가 그대로 남는다(GUI가 큐 사본을 만들 때 채운다) - 이 검증은
# verify-push.sh와 같은 방식으로 `master`를 채운 사본을 만들어 쓴다(각 케이스가 이미 master를 씀).
with open(_ORIG_PUSH_SH, encoding="utf-8") as _f:
    _filled = _f.read().replace("<통합 브랜치>", "master")
_tmp_fd, PUSH_SH = tempfile.mkstemp(prefix="dira-push-sh-", suffix=".sh")
with os.fdopen(_tmp_fd, "w", encoding="utf-8") as _f:
    _f.write(_filled)
atexit.register(lambda: os.path.exists(PUSH_SH) and os.remove(PUSH_SH))


def run(cwd, *args, env=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env)


def git(cwd, *args):
    r = run(cwd, "git", *args)
    assert r.returncode == 0, "git {} 실패: {}".format(" ".join(args), r.stderr)
    return r.stdout


def make_pair():
    """받는 트리(master 체크아웃, updateInstead) + 그 워크트리(wt/x)를 임시 디렉터리에 만든다."""
    recv = tempfile.mkdtemp(prefix="dira-push-recv-")
    git(recv, "init", "-q", "-b", "master")
    git(recv, "config", "user.email", "t@t.t")
    git(recv, "config", "user.name", "t")
    git(recv, "config", "receive.denyCurrentBranch", "updateInstead")
    with open(os.path.join(recv, "f.txt"), "w", encoding="utf-8") as f:
        f.write("base\n")
    git(recv, "add", "-A")
    git(recv, "commit", "-q", "-m", "base")
    wt = tempfile.mkdtemp(prefix="dira-push-wt-")
    shutil.rmtree(wt)
    git(recv, "worktree", "add", "-q", "-b", "wt/x", wt)
    return recv, wt


def cleanup(recv, wt):
    run(recv, "git", "worktree", "remove", "--force", wt)
    shutil.rmtree(recv, ignore_errors=True)
    shutil.rmtree(wt, ignore_errors=True)


def last_commit_lines(cwd):
    return git(cwd, "log", "-1", "--format=%B").rstrip("\n").split("\n")


# ── 1. 정상 경로 - 커밋 + push 한 번 ─────────────────────────────────────────
recv, wt = make_pair()
try:
    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("changed\n")
    r = run(wt, "bash", PUSH_SH, "ship", "abcd1234", "제목입니다", "본문 한 줄")
    assert r.returncode == 0, "ship 정상 경로 실패: {}".format(r.stderr)
    lines = last_commit_lines(wt)
    assert lines[0] == "제목입니다", lines
    assert "본문 한 줄" in lines, lines
    assert lines[-1] == "Ticket: abcd1234", lines
    assert git(recv, "log", "-1", "--format=%H") == git(wt, "log", "-1", "--format=%H"), "받는 트리가 안 갱신됐다"
    print("PASS 정상 경로 - 커밋 1회 + push 1회로 끝남, Ticket 줄 확인")
finally:
    cleanup(recv, wt)

# ── 2. non-ff 거부 -> rebase 1회 재시도 -> 성공 ──────────────────────────────
recv, wt = make_pair()
try:
    # 받는 트리를 wt 몰래 앞서 나가게 한다(다른 세션의 push를 흉내).
    with open(os.path.join(recv, "g.txt"), "w", encoding="utf-8") as f:
        f.write("other session\n")
    git(recv, "add", "-A")
    git(recv, "commit", "-q", "-m", "other session advanced master")

    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("mine\n")
    r = run(wt, "bash", PUSH_SH, "ship", "ff00ff00", "non-ff 재시도")
    assert r.returncode == 0, "1회 재시도 뒤에도 실패: {}".format(r.stderr)
    with open(os.path.join(recv, "g.txt"), encoding="utf-8") as f:
        assert f.read() == "other session\n", "받는 트리의 다른 세션 커밋이 사라졌다"
    with open(os.path.join(recv, "f.txt"), encoding="utf-8") as f:
        assert f.read() == "mine\n", "내 변경이 안 실렸다"
    print("PASS non-ff 거부 - rebase 1회 재시도로 성공")
finally:
    cleanup(recv, wt)

# ── 3. 두 번째 거부 - git push 종료 코드를 그대로 낸다 ───────────────────────
recv, wt = make_pair()
try:
    # pre-receive 훅이 뭐가 오든 항상 거부한다 - rebase가 성공해도 재시도가 다시 막힌다.
    hooks = os.path.join(recv, ".git", "hooks")
    hook_path = os.path.join(hooks, "pre-receive")
    with open(hook_path, "w", encoding="utf-8") as f:
        f.write("#!/bin/sh\necho 'always rejected' >&2\nexit 1\n")
    os.chmod(hook_path, 0o755)

    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("mine\n")
    r = run(wt, "bash", PUSH_SH, "ship", "dead0000", "두 번째도 거부")
    assert r.returncode != 0, "훅이 항상 거부하는데 성공으로 끝났다"
    # 커밋 자체는 됐다 - ship이 커밋 뒤에 push만 실패한 것이다.
    assert last_commit_lines(wt)[-1] == "Ticket: dead0000", "실패해도 커밋은 남아야 한다"
    print("PASS 두 번째 거부 - git push 종료 코드를 그대로 내고 멈춤(exit {})".format(r.returncode))
finally:
    cleanup(recv, wt)

# ── 4. 커밋할 것이 없으면 커밋을 건너뛰고 push만 한다(재디스패치) ────────────
recv, wt = make_pair()
try:
    # 앞 세션이 이미 커밋해 둔 상태를 흉내: wt에서 직접 커밋만 하고 push는 안 한다.
    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("already committed\n")
    git(wt, "add", "-A")
    git(wt, "commit", "-q", "-m", "이미 커밋됨", "-m", "Ticket: pre0000")
    before = git(wt, "log", "--oneline").count("\n") + 1

    r = run(wt, "bash", PUSH_SH, "ship", "pre0000", "이 제목은 안 쓰인다")
    assert r.returncode == 0, "ship 실패: {}".format(r.stderr)
    after = git(wt, "log", "--oneline").count("\n") + 1
    assert after == before, "커밋할 게 없는데 새 커밋이 생겼다({} -> {})".format(before, after)
    assert last_commit_lines(wt)[0] == "이미 커밋됨", "엉뚱한 제목으로 새 커밋을 만들었다"
    with open(os.path.join(recv, "f.txt"), encoding="utf-8") as f:
        assert f.read() == "already committed\n", "push가 안 됐다"
    print("PASS 커밋할 것 없음 - 커밋 건너뛰고 push만 함")
finally:
    cleanup(recv, wt)

# ── 5. 인자 없는 기존 경로와 classify가 그대로다(ship 추가로 안 갈림) ────────
recv, wt = make_pair()
try:
    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("plain path\n")
    git(wt, "add", "-A")
    git(wt, "commit", "-q", "-m", "plain")
    r = run(wt, "bash", PUSH_SH)
    assert r.returncode == 0, "인자 없는 경로 실패: {}".format(r.stderr)
    with open(os.path.join(recv, "f.txt"), encoding="utf-8") as f:
        assert f.read() == "plain path\n", "인자 없는 push가 실제로는 안 갔다"

    # classify: 이력에 있는 blob 그대로 되돌린 파일 = 잔해. 이력에 없는 내용으로 손댄 파일과
    # 이력에 없는 새 파일 = 사람 편집.
    git(recv, "checkout", "HEAD~1", "--", "f.txt")  # base 시절 blob으로 되돌림 - 잔해
    with open(os.path.join(recv, "human.txt"), "w", encoding="utf-8") as f:
        f.write("사람이 여기서 직접 고침\n")  # 이력에 없는 새 파일 - 사람 편집
    out = run(recv, "bash", PUSH_SH, "classify", "f.txt", "human.txt").stdout.strip().split("\n")
    assert out == ["잔해", "사람편집"], out
    print("PASS 인자 없는 경로 + classify - ship 추가로 안 갈림")
finally:
    cleanup(recv, wt)
