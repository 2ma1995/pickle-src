# PICKLE 소스

뮤지컬 취향 추천 앱 PICKLE의 소스 저장소(비공개). 배포 주소: https://2ma1995.github.io/pickle/

## 로컬에서 보기
1. `python3 recommend.py --export app/data.js --no-track` — 앱 데이터를 만든다(기록 전송 끔)
2. `python3 -m http.server 8765` → http://localhost:8765/app/

KOPIS를 직접 받거나 배포하려면 프로젝트 루트에 `.env`(API 키)가 필요하다. 키는 저장소에 없다.

## 주요 파일
- `app/index.html` 앱 전체(화면·추천 규칙)
- `recommend.py` 태그 기록 → 앱 데이터 · `kopis_sync.py` KOPIS 공연 목록 · `deploy_pages.sh` 배포
- `data/tag_records_2026-10-06.tsv` 태그 기록(구글 시트 '태그 기록 (Claude)' 사본) · `data/tag_dict_2026-10-06.tsv` 태그 사전
- `docs/` 설계·실험 문서
- 테스트: `python3 recommend.py --selftest`, `node tests/proto_check.js`

## 자동으로 도는 것
매주 월요일 06시에 KOPIS 공연 목록과 예매 순위를 새로 받아 배포한다(`.github/workflows/weekly.yml`). 새 공연의 작품 테마 태그는 따로 붙여야 한다.

## 저장소에 없는 것
`.env`(API 키), 더뮤지컬 기사 원문, 파이썬 가상환경, 만들어지는 파일(`app/data.js`, `_site/`).
