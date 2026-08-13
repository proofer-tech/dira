#!/usr/bin/env python3
"""마크다운 코퍼스(티켓-스펙-온톨로지-메모리-프로토콜)에 이미 적힌 간선을 읽어
<큐>/graph.json 인덱스를 만든다. graphify(설치본 0.9.41)의 nodes/links 형식이 원형이나
파서는 없다 - 우리 간선은 전부 마크다운에 이미 텍스트로 적혀 있어 정규식으로 충분하다.

query/path/explain은 다음 티켓(70fbff1c)이다. 여기는 build 하나뿐이다.

호출: python3 graph.py build <큐> [--force]
  <큐>는 tickets/ personas/ ontology/ protocols/를 담은 루트(예: .dira).
  레포(스펙) 쪽은 <큐>/../docs/DESIGN.md 하나만 읽는다 - 큐의 부모 체크아웃이 master라
  워크트리마다 갈리는 사본이 인덱스에 안 섞인다(DESIGN.md §그래프 탐색 §자리).

docs/DESIGN.md §그래프 탐색 (계약).
"""
import json
import os
import re
import sys
import time
import unicodedata

IN_PROGRESS = os.environ.get("TICKET_INPROGRESS") or ".wip"
DONE = os.environ.get("TICKET_DONE") or ".done"
CLOSED_SUFFIXES = (IN_PROGRESS, DONE)

HASH_RE = r"[0-9a-f]{8}"
CITE_RE = re.compile(r"`(" + HASH_RE + r")`")
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
SECTION_RE = re.compile(r"§([가-힣A-Za-z0-9][가-힣A-Za-z0-9 \-]{0,39})")
FENCE_RE = re.compile(r"^\s*```")
HEADING_RE = re.compile(r"^(#{2,5})\s+(.*)$")


def nfc(s):
    return unicodedata.normalize("NFC", s)


def strip_quotes(s):
    return (s or "").strip().strip("\"'")


# ---------- frontmatter (tickets.py의 read_fm과 같은 모양 -- 그래프는 남의 모듈을
# import하지 않는다(검증 ① - graph.py 자기 import 줄만 표준 라이브러리인지 잰다).
# 온톨로지 frontmatter는 한글 키(이름-구현-근거-값)도 쓰므로 tickets.py보다 키 문자를 넓힌다. ----------

def read_fm(text):
    """(fm dict, 원문줄들, frontmatter 끝 인덱스). frontmatter 없으면 end=-1."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, lines, -1
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        return {}, lines, -1
    fm = {}
    for i in range(1, end):
        m = re.match(r"^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*):\s*(.*)$", lines[i])
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm, lines, end


def block_list(lines, end, key):
    """frontmatter의 `<key>: [a, b]` 인라인 또는 `<key>:\\n  - a\\n  - b` 블록 리스트.
    tickets.py deps_of와 같은 두 문법(deps 두 문법 - CORE §엔진 의미 복제 대상은 아니지만
    같은 파일들이 같은 규약을 쓰므로 읽는 규칙도 맞춘다)."""
    out = []
    for i in range(1, end):
        m = re.match(r"^" + re.escape(key) + r":\s*(.*)$", lines[i])
        if not m:
            continue
        inline = m.group(1).strip().strip("[]")
        if inline:
            out += [strip_quotes(h) for h in inline.split(",")]
        for j in range(i + 1, end):
            m2 = re.match(r"^\s{2,}-\s*(.+?)\s*:?\s*$", lines[j])
            if not m2:
                break
            out.append(strip_quotes(m2.group(1)))
        break
    return [h for h in out if h]


def excerpt_of(s, limit=100):
    s = " ".join((s or "").split())
    return s[:limit]


def first_body_line(lines, end):
    for l in lines[end + 1 if end >= 0 else 0:]:
        l = l.strip().lstrip("#").lstrip("-").strip()
        if l:
            return excerpt_of(l)
    return ""


# ---------- 일반 간선(인용-위키링크-절참조) - 어느 노드 본문에나 적용한다 ----------

def generic_edges(node_id, text, title_index):
    edges = []
    for m in CITE_RE.finditer(text):
        edges.append((node_id, m.group(1), "인용"))
    for m in WIKILINK_RE.finditer(text):
        target = nfc(m.group(1).strip())
        if target:
            edges.append((node_id, target, "위키링크"))
    for m in SECTION_RE.finditer(text):
        target = resolve_section(m.group(1), title_index)
        if target:
            edges.append((node_id, target, "절참조"))
    return edges


def resolve_section(mention, title_index):
    """§멘션 -> DESIGN.md 절 id. 실제 본문은 조사-어미가 제목 뒤에 그대로 붙는다
    (`§그래프 탐색이고` - 공백 없이 `이고`가 붙는다), 그래서 낱말 단위가 아니라 글자
    하나씩 오른쪽에서 잘라가며 짧은 제목 사전에 있는지 본다(dict 조회라 O(멘션 길이)다,
    title_index 전체를 훑지 않는다). ponytail: 전역 첫 일치다 - 같은 짧은 제목이 문서에
    여러 번 나오면(중복 54건 실측) 가장 가까운 절이 아니라 처음 나온 절로 붙는다.
    검증②에 절참조 하한이 없어 여기서 멈춘다 - 질의 티켓(70fbff1c)이 근접도가 필요하다고
    밝히면 그때 절 단위 지역 색인으로 올린다."""
    m = mention.strip()
    while m:
        if m in title_index:
            return title_index[m]
        m = m[:-1]
    return None


# ---------- DESIGN.md - 스펙 절 노드 (노드 하나가 아니라 파일 하나에서 여럿) ----------

def parse_headings(text):
    """(펜스 밖) `##`~`#####` 제목 목록 -> [(level, title, start_line, end_line)]."""
    lines = text.split("\n")
    heads = []
    in_fence = False
    for i, l in enumerate(lines):
        if FENCE_RE.match(l):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(l)
        if m:
            heads.append([len(m.group(1)), m.group(2).strip(), i, len(lines)])
    for i in range(len(heads) - 1):
        heads[i][3] = heads[i + 1][2]
    return heads, lines


def spec_ids(heads):
    """제목 -> id. 중복 제목은 순서대로 #2 #3...을 붙인다(같은 제목 54쌍 실측)."""
    seen = {}
    ids = []
    for _level, title, _s, _e in heads:
        seen[title] = seen.get(title, 0) + 1
        ids.append("DESIGN#" + title if seen[title] == 1 else "DESIGN#{}#{}".format(title, seen[title]))
    return ids


def short_title(title):
    for sep in (" - ", " ("):
        i = title.find(sep)
        if i >= 0:
            return title[:i].strip()
    return title.strip()


def spec_title_index(text):
    """제목 사전만 - 헤딩 목록 훑기 하나뿐이고(펜스 추적 포함) 절 본문의 인용-위키링크-절참조
    정규식 스캔은 안 한다. 이 값은 매 build 호출마다 DESIGN.md 변경 여부와 무관하게
    §절참조 해석에 필요해서(다른 파일의 멘션을 풀려면 있어야 한다), 비싼 generic_edges
    스캔까지 매번 반복하지 않도록 extract_spec에서 떼어냈다(무변경 재빌드 예산 1초를
    지키는 자리 - 안 떼면 4.7MB 본문을 매번 두 번 훑는다)."""
    heads, _lines = parse_headings(text)
    ids = spec_ids(heads)
    title_index = {}
    for (_level, title, _s, _e), sid in zip(heads, ids):
        key = short_title(title)
        if key not in title_index:
            title_index[key] = sid
        if title not in title_index:
            title_index[title] = sid
    return title_index


def extract_spec(path, text, title_index):
    heads, lines = parse_headings(text)
    ids = spec_ids(heads)
    nodes, links = [], []
    for (_level, title, s, e), sid in zip(heads, ids):
        body = "\n".join(lines[s + 1:e])
        nodes.append({"id": sid, "type": "스펙 절", "path": path, "excerpt": excerpt_of(body.split("\n", 1)[0] if body else title)})
        links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(sid, body, title_index)]
    return nodes, links


# ---------- 티켓 ----------

def ticket_stem(basename):
    stem = nfc(basename)
    if stem.endswith(".md"):
        stem = stem[:-3]
    for sfx in CLOSED_SUFFIXES:
        if stem.endswith(nfc(sfx)):
            return stem[: -len(nfc(sfx))]
    return stem


def extract_ticket(path, text, title_index):
    fm, lines, end = read_fm(text)
    tid = strip_quotes(fm.get("ticket")) or ticket_stem(os.path.basename(path))
    tid = nfc(tid)
    node = {"id": tid, "type": "티켓", "path": path, "excerpt": first_body_line(lines, end)}
    links = []
    for h in block_list(lines, end, "deps"):
        links.append({"source": tid, "target": nfc(h), "rel": "deps"})
    for key in ("req", "archives", "awaiting"):
        v = strip_quotes(fm.get(key))
        if v:
            links.append({"source": tid, "target": nfc(v), "rel": key})
    links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(tid, text, title_index)]
    return [node], links


# ---------- 온톨로지 객체 ----------

def extract_ontology(path, text, title_index):
    fm, lines, end = read_fm(text)
    name = nfc(strip_quotes(fm.get("name")) or os.path.splitext(os.path.basename(path))[0])
    node = {"id": name, "type": "온톨로지 객체", "path": path,
            "excerpt": excerpt_of(strip_quotes(fm.get("description")) or first_body_line(lines, end))}
    nodes = [node]
    links = []
    for h in block_list(lines, end, "근거"):
        links.append({"source": name, "target": nfc(h), "rel": "근거"})
    for item in block_list(lines, end, "구현"):
        src_path, _, desc = item.partition(" ")
        src_path = nfc(src_path)
        nodes.append({"id": src_path, "type": "소스 파일", "path": src_path, "excerpt": excerpt_of(desc)})
        links.append({"source": name, "target": src_path, "rel": "구현"})
    for rel, target in ontology_links(lines, end):
        links.append({"source": name, "target": target, "rel": rel})
    links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(name, text, title_index)]
    return nodes, links


def ontology_links(lines, end):
    """`links:\\n  <관계>:\\n    - <표시명>: "[[<대상>]]"` 블록 -> [(관계, 대상), ...].
    관계 이름은 고정 목록이 아니라 파일마다 자유(돌린다-불러온다-검증한다... 실측 5종+).
    """
    out = []
    i = 1
    while i < end and not re.match(r"^links:\s*$", lines[i]):
        i += 1
    i += 1
    while i < end:
        m = re.match(r"^  (\S[^\n:]*):\s*$", lines[i])
        if not m:
            if re.match(r"^\S", lines[i]):
                break
            i += 1
            continue
        rel = m.group(1).strip()
        i += 1
        while i < end and re.match(r"^\s{4,}-\s", lines[i]):
            wm = WIKILINK_RE.search(lines[i])
            if wm:
                out.append((rel, nfc(wm.group(1).strip())))
            i += 1
    return out


# ---------- 메모리 ----------

def extract_memory(path, persona, text, title_index):
    fname = os.path.splitext(os.path.basename(path))[0]
    mid = nfc("{}/{}".format(persona, fname))
    node = {"id": mid, "type": "메모리", "path": path, "excerpt": first_body_line(text.split("\n"), -1)}
    links = [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(mid, text, title_index)]
    return [node], links


# ---------- 프로토콜 문서 ----------

def extract_protocol(path, text, title_index):
    pid = nfc(os.path.basename(path))
    node = {"id": pid, "type": "프로토콜 문서", "path": path, "excerpt": first_body_line(text.split("\n"), -1)}
    links = [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(pid, text, title_index)]
    return [node], links


# ---------- 파일 열거 ----------

def list_md(d):
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, f) for f in os.listdir(d)
                  if f.endswith(".md") and not f.startswith("."))


def source_files(troot):
    """(경로, 종류, 부가정보) - 종류는 extract_* 디스패치 키. 없는 디렉터리는 건너뛴다
    (못 5 - 없으면 그냥 없다, 온톨로지 없는 프로젝트와 같은 선)."""
    out = [(p, "ticket", None) for p in list_md(os.path.join(troot, "tickets"))]
    obj_root = os.path.join(troot, "ontology", "objects")
    if os.path.isdir(obj_root):
        for typ in sorted(os.listdir(obj_root)):
            out += [(p, "ontology", None) for p in list_md(os.path.join(obj_root, typ))]
    personas_root = os.path.join(troot, "personas")
    if os.path.isdir(personas_root):
        for persona in sorted(os.listdir(personas_root)):
            out += [(p, "memory", persona) for p in list_md(os.path.join(personas_root, persona, "memory"))]
    out += [(p, "protocol", None) for p in list_md(os.path.join(troot, "protocols"))]
    return out


# ---------- build ----------

def _group_by_src(entries):
    out = {}
    for e in entries:
        out.setdefault(e.get("_src"), []).append(e)
    return out


def build(troot, force=False):
    """증분 - 파일마다 `_src`(원본 경로) 태그를 달아 nodes/links 자체를 캐시 열쇠로 쓴다.
    이전 graph.json 하나만 읽으면 되고(기존 노드/간선을 `_src`로 되묶어 그대로 재사용),
    mtime 따로 + 노드-간선 따로인 `_cache` 사본을 안 둔다 - 파일 크기가 거의 절반이 되고
    (그래프 하나가 아니라 둘을 매번 읽고 쓰던 자리), 무변경 재빌드 예산 1초가 그 절반에서 온다."""
    t0 = time.time()
    graph_path = os.path.join(troot, "graph.json")
    old_mtimes, old_nodes_by_src, old_links_by_src = {}, {}, {}
    if not force and os.path.isfile(graph_path):
        try:
            old = json.load(open(graph_path, encoding="utf-8"))
            old_mtimes = old.get("_mtimes", {})
            old_nodes_by_src = _group_by_src(old.get("nodes", []))
            old_links_by_src = _group_by_src(old.get("links", []))
        except (OSError, ValueError):
            pass

    design_path = os.path.join(troot, "..", "docs", "DESIGN.md")
    title_index = {}
    if os.path.isfile(design_path):
        try:
            title_index = spec_title_index(open(design_path, encoding="utf-8").read())
        except OSError:
            title_index = {}

    new_mtimes = {}
    nodes_by_id, links = {}, []
    changed = reused = 0
    files = source_files(troot)
    if os.path.isfile(design_path):
        files.append((design_path, "spec", None))

    for path, kind, extra in files:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        new_mtimes[path] = mtime
        if not force and old_mtimes.get(path) == mtime:
            nodes = old_nodes_by_src.get(path, [])
            file_links = old_links_by_src.get(path, [])
            reused += 1
        else:
            try:
                text = open(path, encoding="utf-8").read()
            except OSError:
                continue
            if kind == "ticket":
                nodes, file_links = extract_ticket(path, text, title_index)
            elif kind == "ontology":
                nodes, file_links = extract_ontology(path, text, title_index)
            elif kind == "memory":
                nodes, file_links = extract_memory(path, extra, text, title_index)
            elif kind == "protocol":
                nodes, file_links = extract_protocol(path, text, title_index)
            else:  # spec
                nodes, file_links = extract_spec(path, text, title_index)
            for e in nodes:
                e["_src"] = path
            for e in file_links:
                e["_src"] = path
            changed += 1
        for n in nodes:
            nodes_by_id.setdefault(n["id"], n)
        links += file_links

    removed = sum(1 for p in old_mtimes if p not in new_mtimes)

    out = {
        "version": 1,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "nodes": list(nodes_by_id.values()),
        "links": links,
        "_mtimes": new_mtimes,
    }
    tmp = graph_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, graph_path)

    print("OK build nodes={} links={} changed={} reused={} removed={} {:.2f}s".format(
        len(out["nodes"]), len(links), changed, reused, removed, time.time() - t0))


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "build":
        raise SystemExit(__doc__)
    build(sys.argv[2], force="--force" in sys.argv[3:])


if __name__ == "__main__":
    main()
