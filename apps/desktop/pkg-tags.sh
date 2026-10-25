#!/bin/sh
# 릴리스 단계 2: 공용 패키지 태그 준비 (DESIGN.md P520 결정 2). 저장소 루트에서 부른다.
# 태그가 없으면 지금 version 그대로, 태그 뒤에 내용이 바뀌었으면 patch를 1 올려(apm.yml 수정)
# 달아야 할 태그 이름을 한 줄씩 stdout에 낸다. 커밋과 태그는 부르는 쪽이 한다.
set -u
for dir in packages/*/; do
  pkg=$(basename "$dir")
  yml="packages/$pkg/apm.yml"
  [ -f "$yml" ] || continue
  ver=$(sed -n 's/^version:[[:space:]]*\([0-9][0-9.]*\)[[:space:]]*$/\1/p' "$yml" | head -1)
  [ -n "$ver" ] || { echo "$yml에 version이 없다" >&2; exit 1; }
  if ! git rev-parse -q --verify "refs/tags/$pkg-v$ver" >/dev/null; then
    echo "$pkg-v$ver"
    continue
  fi
  git diff --quiet "$pkg-v$ver" HEAD -- "packages/$pkg" ":!packages/$pkg/apm.yml" && continue
  new=$ver
  while git rev-parse -q --verify "refs/tags/$pkg-v$new" >/dev/null; do
    new=$(printf '%s' "$new" | awk -F. -v OFS=. '{$NF=$NF+1; print}')
  done
  sed -i.bak "s/^version:.*/version: $new/" "$yml" && rm -f "$yml.bak"
  echo "$pkg-v$new"
done
