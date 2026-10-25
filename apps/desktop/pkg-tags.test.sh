#!/bin/sh
# pkg-tags.sh 검증: 임시 저장소에서 바뀐 패키지만 patch가 오르고, 태그 없던 패키지는 현재 version으로 태그된다.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
cd "$t"
git init -q; git config user.email t@t; git config user.name t
for p in changed same fresh; do mkdir -p packages/$p; printf 'name: %s\nversion: 1.0.0\n' $p > packages/$p/apm.yml; echo a > packages/$p/doc.md; done
git add -A; git commit -qm base
git tag -a changed-v1.0.0 -m x; git tag -a same-v1.0.0 -m x
echo b >> packages/changed/doc.md
git commit -qam edit
out=$(sh "$here/pkg-tags.sh")
git commit -qam release
for tg in $out; do git tag -a "$tg" -m x; done
want="changed-v1.0.1
fresh-v1.0.0"
[ "$out" = "$want" ] || { echo "FAIL tags: $out"; exit 1; }
grep -q '^version: 1.0.1$' packages/changed/apm.yml || { echo "FAIL changed version"; exit 1; }
grep -q '^version: 1.0.0$' packages/same/apm.yml || { echo "FAIL same version"; exit 1; }
[ "$(git cat-file -t changed-v1.0.1)" = tag ] || { echo "FAIL not annotated"; exit 1; }
[ "$(git rev-parse changed-v1.0.1^{commit})" = "$(git rev-parse HEAD)" ] || { echo "FAIL tag target"; exit 1; }
git tag | grep -q '^same-v1.0.1$' && { echo "FAIL same tagged"; exit 1; }
# 다시 돌리면 아무것도 안 낸다(멱등)
[ -z "$(sh "$here/pkg-tags.sh")" ] || { echo "FAIL rerun"; exit 1; }
echo "pkg-tags OK"
