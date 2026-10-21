#!/bin/bash
# 소개 페이지와 앱만 GitHub Pages(2ma1995/pickle)로 올린다. 주소: https://2ma1995.github.io/pickle/
# 올리는 것: index.html, app/index.html, app/data.js(배포 때 새로 만듦, 기록 설정 포함), app/theme.css, app/app.css, app/posters/  ← 이 목록 밖은 절대 안 올림(data/에 설문 원문, .env에 API 키, 예전 앱 백업 app/index_legacy_*.html, 옛 주소 app/proto.html)
# 데이터를 바꾼 뒤(로컬 확인용은 recommend.py --export app/data.js --no-track) 이걸 다시 돌리면 된다. 유튜브 데이터 30일 규칙 때문에 최소 월 1회.
# 소스 전체는 비공개 저장소(2ma1995/pickle-src)에 있다. 배포 전에 그 최신을 받고, 배포한 뒤 바뀐 소스를 같이 올린다.
# 매주 월요일 06시(한국)에 GitHub Actions(.github/workflows/weekly.yml)가 KOPIS 목록을 새로 받아 이 스크립트로 배포한다.
set -euo pipefail
cd "$(dirname "$0")"
SITE=_site
REPO=2ma1995/pickle

# 주간 자동 갱신이 올린 KOPIS 파일을 먼저 받는다. 안 받고 배포하면 공연 목록이 예전 것으로 되돌아간다
if git rev-parse -q --verify '@{u}' >/dev/null 2>&1; then
  git pull -q --ff-only || { echo "소스 저장소를 못 받았어요(git pull). 맞춘 뒤 다시 돌려 주세요"; exit 1; }
fi

if [ ! -d "$SITE/.git" ]; then
  gh repo view "$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "PICKLE — 뮤지컬 캐스팅 조합 추천 (가안)"
  mkdir -p "$SITE" && git -C "$SITE" init -q -b main
  git -C "$SITE" remote add origin "https://github.com/$REPO.git"
else
  git -C "$SITE" fetch -q origin main && git -C "$SITE" reset -q --hard origin/main  # 주간 자동 갱신이 먼저 배포했어도 그 위에 올린다
fi

find "$SITE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
mkdir -p "$SITE/app"
cp index.html "$SITE/"
cp app/index.html app/theme.css app/app.css "$SITE/app/"
# 기록 전송 설정(.env 의 Supabase 공개 키)은 배포본 data.js 에만 넣는다. 로컬 app/data.js 는 --no-track 으로 두어
# 8765·8766 같은 로컬·시험 서버에서 누른 것이 실제 DB 에 섞이지 않게 한다
cp -R app/posters "$SITE/app/"  # recommend.py 가 data.js 옆 posters/ 에서 시드 포스터를 찾으니 export 보다 먼저 복사한다
out=$(python3 recommend.py --export "$SITE/app/data.js")  # 실패하면 set -e 로 여기서 멈춘다
echo "$out" | grep "기록 전송" || true
[ -s "$SITE/app/data.js" ] || { echo "data.js 만들기 실패"; exit 1; }
n=$(grep -o '"poster": "posters/' "$SITE/app/data.js" | wc -l)
[ "$n" -ge "$(ls app/posters | wc -l)" ] || { echo "시드 포스터가 data.js 에 안 들어감($n개)"; exit 1; }
touch "$SITE/.nojekyll"

# data.js 주소에 버전을 붙여 브라우저가 예전 데이터를 들고 있지 않게 한다. sed -i.bak 는 macOS·리눅스(Actions) 둘 다 되는 꼴
v=$(date +%Y%m%d%H%M)
sed -i.bak "s|src=\"data.js\"|src=\"data.js?v=$v\"|" "$SITE/app/index.html"
sed -i.bak "s|src=\"app/data.js\"|src=\"app/data.js?v=$v\"|" "$SITE/index.html"
rm -f "$SITE/app/index.html.bak" "$SITE/index.html.bak"
grep -q "data.js?v=$v" "$SITE/app/index.html" && grep -q "data.js?v=$v" "$SITE/index.html" || { echo "data.js 버전 붙이기 실패"; exit 1; }

cd "$SITE"
git add -A
if git diff --cached --quiet; then
  echo "사이트는 바뀐 게 없어요"
else
  git commit -qm "deploy $v

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git push -q -u origin main
  echo "올림 → https://2ma1995.github.io/pickle/ (반영까지 1~2분)"
fi
cd ..

# 배포한 그대로 소스 저장소에도 올린다(주간 자동 갱신이 받은 KOPIS 파일 포함). 소스 저장소가 없으면 건너뛴다
if git rev-parse -q --verify '@{u}' >/dev/null 2>&1; then
  git add -A
  git diff --cached --quiet || { git commit -qm "deploy $v

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; git push -q; echo "소스 올림 → https://github.com/2ma1995/pickle-src"; }
fi
