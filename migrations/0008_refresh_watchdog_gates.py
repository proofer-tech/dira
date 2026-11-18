"""큐 사본 .dira/watchdog_gates.py 를 정본 templates/watchdog_gates.py 로 다시 굽는다 (항목 0008).

스캐폴딩은 사본을 등록할 때 한 번만 복사해서, G6이 sweep 표지 줄을 등록으로 세게 고친 정본(티켓 5eb4a444)이
기존 큐에는 안 들어간다. 표준 라이브러리만 쓴다.
"""
import os

ID = "0008-refresh-watchdog-gates"
DESC = "큐의 watchdog_gates.py를 엔진 정본으로 다시 굽는다"
DESC_EN = "Re-render the queue watchdog_gates.py from the engine template"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

# ponytail: 정본이 다시 바뀌면 같은 모양의 항목을 새 ID로 하나 더 낸다(0006과 같다).


def _want(ctx):
    with open(os.path.join(ctx.engine, "templates", "watchdog_gates.py"), encoding="utf-8") as f:
        return f.read()


def targets(ctx):
    return [os.path.join(ctx.root, "watchdog_gates.py")]


def apply(ctx):
    p = targets(ctx)[0]
    # 사본이 없으면 스캐폴딩 몫이다 - 만들지 않는다.
    if not os.path.exists(p):
        return
    want = _want(ctx)
    with open(p, encoding="utf-8") as f:
        if f.read() == want:
            return
    with open(p, "w", encoding="utf-8") as f:
        f.write(want)


def verify(ctx):
    p = targets(ctx)[0]
    if not os.path.exists(p):
        return
    with open(p, encoding="utf-8") as f:
        assert f.read() == _want(ctx), "watchdog_gates.py가 정본과 다르다"
