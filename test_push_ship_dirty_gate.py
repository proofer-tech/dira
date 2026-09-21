#!/usr/bin/env python3
"""엔진 수정 마흔 번째 승인 §판정 1 자체검증(docs/DESIGN.md, 지적 `50ce9b91` - 답 `d4543693`
= `1.(a)`) - 수용조건 3~5. `templates/hooks/push.sh`의 `ship`이 `$LOCAL/run/dirty-<해시>`
기록과 현재 `git status --porcelain` 경로를 대조해, 여전히 더러운 경로가 남아 있으면 커밋 없이
거절하고, 그 경로를 치웠으면 종전대로 커밋-push하는지 잰다. 수용조건 5(기록 파일이 없으면
종전과 다르게 안 돈다)는 `test_push_ship.py` 무수정 통과가 이미 확인한다.
`test_push_ship.py`의 harness를 그대로 이식했다. 실패하면 assert로 죽는다."""
import atexit
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_ORIG_PUSH_SH = os.path.join(HERE, "templates", "hooks", "push.sh")

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


def local_env(local_dir):
    return dict(os.environ, TICKET_LOCAL=local_dir)


def dirty_fp(local_dir, h):
    return os.path.join(local_dir, "run", "dirty-" + h)


def write_dirty_fp(local_dir, h, *paths):
    fp = dirty_fp(local_dir, h)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w", encoding="utf-8") as f:
        f.write("\n".join(paths) + "\n")
    return fp


# ── 3. 기록이 있고 그 경로가 여전히 더러우면 커밋 없이 거절한다 ──────────────
recv, wt = make_pair()
local = tempfile.mkdtemp(prefix="dira-push-local-")
try:
    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("changed\n")
    write_dirty_fp(local, "dead3333", "f.txt")
    before = git(wt, "log", "--oneline").count("\n") + 1
    r = run(wt, "bash", PUSH_SH, "ship", "dead3333", "거절돼야 함", env=local_env(local))
    assert r.returncode != 0, "여전히 더러운데 성공으로 끝났다"
    assert "f.txt" in r.stderr, r.stderr
    assert "워크트리.md" in r.stderr, r.stderr
    after = git(wt, "log", "--oneline").count("\n") + 1
    assert after == before, "거절됐는데 커밋이 늘었다({} -> {})".format(before, after)
    print("PASS 수용조건 3 - dirty 기록 남은 경로가 여전히 더러우면 커밋 없이 거절")
finally:
    cleanup(recv, wt)
    shutil.rmtree(local, ignore_errors=True)

# ── 4. 같은 기록이 있어도 그 경로를 치운 뒤엔 종전대로 커밋-push가 간다 ──────
recv, wt = make_pair()
local = tempfile.mkdtemp(prefix="dira-push-local-")
try:
    with open(os.path.join(wt, "f.txt"), "w", encoding="utf-8") as f:
        f.write("changed\n")
    write_dirty_fp(local, "dead4444", "f.txt")
    git(wt, "restore", "f.txt")  # 세션이 워크트리.md대로 그 경로를 치웠다
    with open(os.path.join(wt, "g.txt"), "w", encoding="utf-8") as f:
        f.write("my real work\n")
    r = run(wt, "bash", PUSH_SH, "ship", "dead4444", "치운 뒤엔 통과", env=local_env(local))
    assert r.returncode == 0, "치운 뒤에도 거절됐다: {}".format(r.stderr)
    lines = last_commit_lines(wt)
    assert lines[0] == "치운 뒤엔 통과", lines
    with open(os.path.join(recv, "g.txt"), encoding="utf-8") as f:
        assert f.read() == "my real work\n", "push가 안 갔다"
    print("PASS 수용조건 4 - dirty 기록이 있어도 그 경로를 치우면 종전대로 통과")
finally:
    cleanup(recv, wt)
    shutil.rmtree(local, ignore_errors=True)
