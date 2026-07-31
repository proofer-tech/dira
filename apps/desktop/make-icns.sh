#!/bin/sh
# icon.svg -> icon.icns. 각 크기를 1024 마스터에서 축소하지 않고 SVG에서 크기별로 직접
# 래스터한다 (DESIGN.md §비주얼 §16 "패키징 티켓에 넘기는 실측 하나" — 16px에서 티켓 노치가
# 축소본에서는 사라지고 직접 래스터에서는 남는다).
#
# 형상(icon.svg)을 고쳤을 때만 돌린다. 산출물 icon.icns는 커밋돼 있어서 `pnpm dist`는
# 이 스크립트도 크롬도 필요로 하지 않는다.
#
# ponytail: 래스터라이저가 헤드리스 크롬이다. rsvg-convert·resvg·ImageMagick 중 이 맥에
# 깔린 것이 하나도 없고 크롬은 이 레포가 QA에 이미 쓰는 것이라 새 의존성이 0이다
# (.dira/protocols/AGENTS.md §브라우저). 진짜 래스터라이저가 생기면 for 루프 한 줄이 바뀐다.
set -eu
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "크롬이 없습니다: $CHROME" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SET="$TMP/icon.iconset"
mkdir -p "$SET"

# SVG를 그 자체로 하나의 문서로 연다. HTML 래퍼(<img> 또는 인라인 <svg>)는 헤드리스
# --screenshot이 그리기 전에 찍어서 빈 판이 나온다 — 실측으로 갈렸다.
# 그래서 크기는 루트의 width/height 속성으로 준다(viewBox가 그만큼 스케일한다).
for px in 16 32 64 128 256 512 1024; do
  sed "s/width=\"1024\" height=\"1024\"/width=\"$px\" height=\"$px\"/" icon.svg > "$TMP/$px.svg"
  # --default-background-color=00000000: 알파를 남긴다. 기본은 흰 판이라 독에서 사각형이 된다.
  "$CHROME" --headless --no-first-run --no-default-browser-check \
    --default-background-color=00000000 --force-device-scale-factor=1 \
    --window-size="$px,$px" --screenshot="$TMP/$px.png" \
    --user-data-dir="$TMP/chrome-$px" "$TMP/$px.svg" >/dev/null 2>&1 &
  pid=$!
  # 크롬은 --screenshot을 쓰고도 스스로 끝나지 않는다. 파일이 나오면 죽인다.
  for _ in $(seq 1 30); do [ -s "$TMP/$px.png" ] && break; sleep 1; done
  sleep 1
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  [ -s "$TMP/$px.png" ] || { echo "${px}px 래스터 실패" >&2; exit 1; }
  got=$(sips -g pixelWidth "$TMP/$px.png" | tail -1 | tr -dc 0-9)
  [ "$got" = "$px" ] || { echo "${px}px 요청에 ${got}px가 나왔습니다" >&2; exit 1; }
done

# iconutil이 요구하는 10개 이름. 같은 픽셀 크기가 두 이름을 갖는 자리가 셋 있다(32·256·512).
cp "$TMP/16.png"   "$SET/icon_16x16.png"
cp "$TMP/32.png"   "$SET/icon_16x16@2x.png"
cp "$TMP/32.png"   "$SET/icon_32x32.png"
cp "$TMP/64.png"   "$SET/icon_32x32@2x.png"
cp "$TMP/128.png"  "$SET/icon_128x128.png"
cp "$TMP/256.png"  "$SET/icon_128x128@2x.png"
cp "$TMP/256.png"  "$SET/icon_256x256.png"
cp "$TMP/512.png"  "$SET/icon_256x256@2x.png"
cp "$TMP/512.png"  "$SET/icon_512x512.png"
cp "$TMP/1024.png" "$SET/icon_512x512@2x.png"

iconutil -c icns "$SET" -o icon.icns
echo "icon.icns — $(du -h icon.icns | cut -f1), 10 표현 / 7 래스터 (16 32 64 128 256 512 1024)"
