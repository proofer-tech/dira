"""migrations/0004_refresh_push_sh.py - 옛 사본을 정본으로 굽고, 없는 사본은 만들지 않는다."""
import importlib.util
import os
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("m4", os.path.join(HERE, "migrations", "0004_refresh_push_sh.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

with tempfile.TemporaryDirectory() as root:
    ctx = types.SimpleNamespace(root=root, engine=HERE)
    p = os.path.join(root, "push.sh")
    m.apply(ctx)
    assert not os.path.exists(p), "사본이 없는데 만들었다"
    m.verify(ctx)

    open(os.path.join(root, "integration-branch"), "w").write("main\n")
    open(p, "w").write("#!/bin/bash\n# 옛 사본\n")
    m.apply(ctx)
    body = open(p).read()
    assert "run_verify_changed_hook" in body and "<통합 브랜치>" not in body and '"main"' in body
    assert os.stat(p).st_mode & 0o111
    m.verify(ctx)
    m.apply(ctx)  # 두 번째는 그대로
    assert open(p).read() == body
print("ok")
