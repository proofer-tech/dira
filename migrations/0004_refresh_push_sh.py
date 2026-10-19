"""큐 사본 .dira/push.sh 를 정본 templates/hooks/push.sh 로 다시 굽는다 (항목 0004).

스캐폴딩은 push.sh 가 이미 있으면 건너뛰어서(O_EXCL), 693e8cb9 가 정본에 더한 lint 관문
(`.dira-verify-changed.sh`)이 기존 큐에는 한 번도 안 들어갔다. 그 사이 CI 가 같은 lint 오류로
사흘 동안 빨갰다(2026-10-17~19). 표준 라이브러리만 쓴다.
"""
import os

ID = "0004-refresh-push-sh"
DESC = "큐의 push.sh를 엔진 정본으로 다시 굽는다"
DESC_EN = "Re-render the queue push.sh from the engine template"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

# ponytail: 정본이 다시 바뀌면 같은 모양의 항목을 새 ID로 하나 더 낸다. 매번 굽는 장치는
# 사본을 손으로 고친 큐가 생기면 그때 만든다.


def _branch(ctx):
    try:
        with open(os.path.join(ctx.root, "integration-branch"), encoding="utf-8") as f:
            return f.readline().strip() or None
    except OSError:
        return None


def _want(ctx):
    with open(os.path.join(ctx.engine, "templates", "hooks", "push.sh"), encoding="utf-8") as f:
        return f.read().replace("<통합 브랜치>", _branch(ctx))


def targets(ctx):
    return [os.path.join(ctx.root, "push.sh")]


def apply(ctx):
    p = targets(ctx)[0]
    # 사본이 없거나 통합 브랜치를 모르면 스캐폴딩 몫이다 - 만들지 않는다.
    if not os.path.exists(p) or _branch(ctx) is None:
        return
    want = _want(ctx)
    with open(p, encoding="utf-8") as f:
        if f.read() == want:
            return
    with open(p, "w", encoding="utf-8") as f:
        f.write(want)
    os.chmod(p, 0o755)


def verify(ctx):
    p = targets(ctx)[0]
    if not os.path.exists(p) or _branch(ctx) is None:
        return
    with open(p, encoding="utf-8") as f:
        assert f.read() == _want(ctx), "push.sh가 정본과 다르다"
