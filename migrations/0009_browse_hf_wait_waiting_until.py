"""큐 사본 .dira/browse.sh 의 _hf_wait 부분만 정본과 같게 바꾼다 (항목 0009, P567-1).

사본은 정본에 없는 명령(throttle clickshot clickattrs)을 더 갖고 있어 통째로 덮지 않는다.
정본 templates/hooks/browse.sh 의 `# 대기 중 표지`부터 `_hf_parse_wait() {` 앞까지와 §핸드오프
형식 주석의 waiting_until 줄만 사본에 옮긴다. 표준 라이브러리만 쓴다.
"""
import os

ID = "0009-browse-hf-wait-waiting-until"
DESC = "큐의 browse.sh에서 _hf_wait만 waiting_until을 적는 정본으로 바꾼다"
DESC_EN = "Swap only _hf_wait in the queue browse.sh for the waiting_until-writing template"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

_START = "# 대기 중 표지"
_OLD_START = "_hf_wait() {"
_END = "_hf_parse_wait() {"
_DOC_KEY = "#   returned_at=<epoch>  note=<돌려줄 때 메모>\n"
# ponytail: 정본의 이 구간이 또 바뀌면 같은 모양의 항목을 새 ID로 하나 더 낸다.


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _block(s, start):
    i = s.index(start)
    return i, s.index(_END, i)


def _doc_line(s):
    i = s.index(_DOC_KEY) + len(_DOC_KEY)
    return s[i:s.index("\n", i) + 1]


def _want(ctx, cur):
    src = _read(os.path.join(ctx.engine, "templates", "hooks", "browse.sh"))
    a, b = _block(src, _START)
    new = src[a:b]
    i, j = _block(cur, _START if _START in cur else _OLD_START)
    out = cur[:i] + new + cur[j:]
    doc = _doc_line(src)
    if doc.startswith("#   waiting_until=") and doc not in out:
        out = out.replace(_DOC_KEY, _DOC_KEY + doc, 1)
    return out


def targets(ctx):
    return [os.path.join(ctx.root, "browse.sh")]


def apply(ctx):
    p = targets(ctx)[0]
    # 사본이 없거나 모양이 낯설면 건드리지 않는다.
    if not os.path.exists(p):
        return
    cur = _read(p)
    try:
        want = _want(ctx, cur)
    except ValueError:
        return
    if want != cur:
        with open(p, "w", encoding="utf-8") as f:
            f.write(want)


def verify(ctx):
    p = targets(ctx)[0]
    if not os.path.exists(p):
        return
    cur = _read(p)
    try:
        _want(ctx, cur)
    except ValueError:
        return  # apply가 건너뛴 낯선 사본은 통과
    assert "waiting_until" in cur, "browse.sh에 waiting_until이 없다"
    assert _want(ctx, cur) == cur, "browse.sh의 _hf_wait가 정본과 다르다"
