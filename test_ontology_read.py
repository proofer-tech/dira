#!/usr/bin/env python3
"""ontology_read.py 여섯 조회 자체검증 (docs/DESIGN.md P496). 실패하면 assert로 죽는다."""
import hashlib
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.pop("TICKET_ONTOLOGY", None)
import ontology_read as R  # noqa: E402


def write(root, rel, body, mode="w"):
    p = os.path.join(root, "ontology", rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        f.write(body)
    return p


def run(root, op, args=None):
    return R.run(root, op, args or {})


tmp = tempfile.mkdtemp()
try:
    # 구조: 이름 목록 links / 빈 속성 / id만 있는 객체
    write(tmp, "objects/사람/갑.md", '---\ntype: 사람\nname: 갑\nrole:\ntags: [a, b]\nteam:\n  - x\n  - y\n'
          'links:\n  - "[[을]]"\n---\n\n본문 갑\n')
    write(tmp, "objects/사람/을.md", "---\ntype: 사람\nname: 을\nrole:\ntitle: 을 제목\n"
          "links:\n  인용한다:\n    - 갑: \"[[갑]]\"\n      property: affil\n---\n\n본문 을 needle\n")
    write(tmp, "objects/문서/병.md", "---\nid: p-1\n---\n\n병 본문\n")
    objs = {o["name"]: o for o in run(tmp, "objects")["result"]["objects"]}
    assert set(objs) == {"갑", "을", "병"}, objs
    assert {"type": "links", "to": "을", "props": {}} in objs["갑"]["links"], objs["갑"]
    assert objs["갑"]["props"]["role"] is None and objs["갑"]["props"]["tags"] == ["a", "b"]
    assert objs["갑"]["props"]["team"] == ["x", "y"] and "links" not in objs["갑"]["props"]
    assert objs["병"]["props"]["id"] == "p-1" and objs["병"]["type"] == "문서" and objs["병"]["path"] == "objects/문서/병.md"
    assert objs["을"]["title"] == "을 제목" and objs["갑"]["title"] == "갑"
    assert objs["을"]["links"] == [{"type": "인용한다", "to": "갑", "props": {"property": "affil"}}]
    print("PASS 이름 목록 links - 빈 속성 null - id만 있는 객체")

    # errors
    write(tmp, "objects/사람/가.md", "그냥 글\n")
    write(tmp, "objects/사람/나.md", "---\nname: 닫힘없음\n")
    write(tmp, "objects/사람/다.md", b"---\nname: \xff\n---\n", "wb")
    write(tmp, "objects/사람/중복.md", "---\ntype: 사람\nname: 갑\n---\n")
    r = run(tmp, "objects")
    reasons = {e["path"]: e["reason"] for e in r["errors"]}
    assert reasons == {"objects/사람/가.md": "no-frontmatter", "objects/사람/나.md": "unclosed-frontmatter",
                       "objects/사람/다.md": "not-utf8", "objects/사람/중복.md": "duplicate-name"}, reasons
    assert len(r["result"]["objects"]) == 3
    print("PASS errors 다섯 중 넷 (read-failed는 읽기 권한이 필요해 제외)")

    # 쪽 나누기
    shutil.rmtree(os.path.join(tmp, "ontology"))
    for i in range(250):
        write(tmp, "objects/t/o%03d.md" % i, "---\nname: o%03d\n---\n" % i)
    p1 = run(tmp, "objects")["result"]
    assert len(p1["objects"]) == 200 and p1["cursor"] == "objects/t/o199.md"
    p2 = run(tmp, "objects", {"cursor": p1["cursor"]})["result"]
    assert len(p2["objects"]) == 50 and "cursor" not in p2
    assert len(run(tmp, "objects", {"limit": 5000})["result"]["objects"]) == 250
    assert run(tmp, "objects", {"types": ["없음"]})["result"]["objects"] == []
    print("PASS 250개 쪽 나누기 200 + 50")

    # object
    shutil.rmtree(os.path.join(tmp, "ontology"))
    pa = write(tmp, "objects/사람/갑.md", "---\nname: 갑\ntype: 사람\n---\n\n본문 갑\n")
    write(tmp, "objects/사람/을.md", "---\nname: 을\ntype: 사람\nlinks:\n  인용한다:\n    - 갑: \"[[갑]]\"\n---\n")
    o = run(tmp, "object", {"name": "갑", "backlinks": True})["result"]
    raw = open(pa, "rb").read()
    assert o["object"]["sha256"] == hashlib.sha256(raw).hexdigest() and o["object"]["content"] == raw.decode()
    assert o["object"]["body"] == "본문 갑\n"
    assert o["backlinks"] == [{"from": "을", "type": "인용한다", "props": {}}], o
    assert run(tmp, "object", {"name": "없음"})["result"] == {"object": None}
    assert "backlinks" not in run(tmp, "object", {"name": "갑"})["result"]
    print("PASS object sha256 - content - backlinks - 없는 이름")

    # search: 이름 맞은 것이 먼저
    write(tmp, "objects/문서/z.md", "---\nname: Zeta\n---\n\nalpha 본문 NEEDLE 끝\n")
    write(tmp, "objects/문서/a.md", "---\nname: needle-name\n---\n\n무관\n")
    s = run(tmp, "search", {"q": "Needle"})["result"]["objects"]
    assert [x["name"] for x in s] == ["needle-name", "Zeta"], s
    assert "NEEDLE" in s[1]["excerpt"] and len(s[1]["excerpt"]) <= 100
    assert len(run(tmp, "search", {"q": "needle", "limit": 1})["result"]["objects"]) == 1
    for bad in ({}, {"q": "  "}):
        try:
            run(tmp, "search", bad)
            raise AssertionError("빈 q가 통과했다")
        except ValueError:
            pass
    print("PASS search 순서 - 발췌 - 빈 q ValueError")

    # versions / version
    write(tmp, "versions/사람/갑/v2.md", "두번째")
    write(tmp, "versions/사람/갑/v1.md", "첫번째")
    v = run(tmp, "versions", {"name": "갑"})["result"]["versions"]
    assert [x["version"] for x in v] == ["v1", "v2"] and v[0]["path"] == "versions/사람/갑/v1.md"
    assert v[0]["sha256"] == hashlib.sha256("첫번째".encode()).hexdigest() and v[0]["at"][-6] in "+-"
    assert run(tmp, "version", {"name": "갑", "version": "v2"})["result"]["content"] == "두번째"
    assert run(tmp, "version", {"name": "갑", "version": "v9"})["result"] == {"content": None}
    assert run(tmp, "versions", {"name": "없음"})["result"]["versions"] == []
    try:
        run(tmp, "versions", {"name": "../x"})
        raise AssertionError("경로 탈출 이름이 통과했다")
    except ValueError:
        pass
    print("PASS versions - version - 이름 경로 검증")

    # schema
    write(tmp, "_ontology/o.md", "---\ntype: ObjectType\nname: 사람\nproperties:\n  - role\n  - team\nbody: 본문값\n---\n")
    write(tmp, "_ontology/l.md", "---\ntype: LinkType\nname: 인용한다\nfrom: 사람 - 팀\nto: 문서, 사람\n---\n")
    sc = run(tmp, "schema")["result"]
    assert sc["object_types"] == [{"name": "사람", "props": ["role", "team"], "body": "본문값"}], sc
    assert sc["link_types"] == [{"name": "인용한다", "from": ["사람", "팀"], "to": ["문서", "사람"]}], sc
    print("PASS schema")

    for op, a in (("nope", {}), ("object", [])):
        try:
            run(tmp, op, a)
            raise AssertionError("잘못된 입력이 통과했다")
        except ValueError:
            pass
    print("PASS 모르는 op - 잘못된 args ValueError")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
