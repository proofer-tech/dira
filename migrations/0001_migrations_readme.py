"""예시 항목: 큐 루트에 migrations/README.md 를 둔다."""
import os

ID = "0001-migrations-readme"
DESC = "큐 루트에 migrations/README.md를 둔다"
DESC_EN = "Put migrations/README.md in the queue root"
SCOPE = "project"
ROLLOUT = "all"
REVERSIBLE = True

BODY = (
    "이 폴더는 dira 마이그레이션의 적용 기록 - 백업 - 로그다. 손으로 고치지 않는다.\n"
    "This folder holds the dira migration records, backups and logs. Do not edit it by hand.\n"
)


def targets(ctx):
    return [os.path.join(ctx.root, "migrations", "README.md")]


def apply(ctx):
    p = targets(ctx)[0]
    try:
        with open(p, encoding="utf-8") as f:
            if f.read() == BODY:
                return
    except OSError:
        pass
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(BODY)


def verify(ctx):
    with open(targets(ctx)[0], encoding="utf-8") as f:
        assert f.read() == BODY, "README.md 본문이 다르다"
