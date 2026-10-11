"""엔진 MCP 덮기 테스트 (P476-2). 엔진 소스에서 서브커맨드를 긁어 MCP가 전부 덮는지 본다."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mcp_tools


def src(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def scrape_cmd(name):
    """`if cmd == "x"` / `elif cmd == "x"` / `cmd in ("a", "b")`의 이름들."""
    s = src(name)
    out = set(re.findall(r'\bcmd == "([A-Za-z_][\w-]*)"', s))
    for grp in re.findall(r'\bcmd in \(([^)]*)\)', s):
        out |= set(re.findall(r'"([A-Za-z_][\w-]*)"', grp))
    return out


def scrape_worker_branches():
    """tick.sh의 워커 갈래: 줄머리 `  name)` / `  a|b)` 중 다섯 갈래와 dryrun|tick."""
    names = set()
    for m in re.finditer(r'^  (list|unassign|reap|poll|preempt|dryrun\|tick)\)', src("tick.sh"), re.M):
        names |= set(m.group(1).split("|"))
    return names


found = {"tickets.py": scrape_cmd("tickets.py"), "graph.py": scrape_cmd("graph.py"),
         "dira_env.py": scrape_cmd("dira_env.py"), "tick.sh": scrape_worker_branches()}
missing = []
for prog, names in found.items():
    assert names, "소스에서 서브커맨드를 한 개도 못 긁었다: " + prog
    for n in sorted(names):
        tool = mcp_tools.COVERS.get(prog, {}).get(n)
        if tool is None or (tool != "engine_exec" and tool not in mcp_tools.TOOLS):
            missing.append("%s %s" % (prog, n))
assert len(found["tick.sh"]) == 7, found["tick.sh"]
if missing:
    print("MCP가 덮지 못한 서브커맨드:\n  " + "\n  ".join(missing))
    sys.exit(1)
print("OK")
