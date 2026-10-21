# LLM 태깅 도구 (작품 테마 · 배우 특징)

API 키 없이, 일하는 쪽(LLM 자리)만 바꿔 끼우는 구조다. 규칙의 원본은 `docs/llm_tagging_spec_2026-10-11.md`(7c) — 필드 이름·검사 규칙이 바뀌면 문서가 맞고, 여기서는 `common.py` 상수와 `banned_words.tsv`만 고친다.

```
make_jobs.py  →  (LLM 자리: 지금은 사람/7c, 나중에 로컬 모델)  →  validate.py  →  시트에 붙이기
 입력 JSONL            결과 JSONL (run_llm.py 가 자리 관리)         통과 행 TSV
```

| 파일 | 하는 일 |
|---|---|
| `make_jobs.py --kind work` | 현재 KOPIS 공연 + 시드 작품 → `data/tagging/jobs_work_<날짜>.jsonl`. 소개 글(`synopsis`, KOPIS `sty`)이 비어 있으면 `""`로 두고 `intro_images`(소개 이미지 주소)를 같이 준다. 글도 이미지도 없는 공연은 빼고 이름만 보고한다 |
| `make_jobs.py --kind actor` | 배우 한 명 = 입력 한 건. 지금 시트의 확정 근거 + 출연 이력(위키)으로 형식만 맞춘다. 새 근거(설문·후기)는 같은 모양으로 `segments`/`source`만 바꿔 넣는다 |
| `run_llm.py --backend manual` | 입력 id 와 결과 파일을 대조해 남은 입력만 `<jobs>.todo.jsonl`로 뽑는다. 처리는 사람이 한다 |
| `run_llm.py --backend local --cmd "ollama run <모델>"` | 입력마다 프롬프트를 셸 명령 표준입력에 넣고 출력 JSON 을 결과로 받는다. 이어하기 가능 |
| `prompts/*.md` | 규칙 문서 3-2·4-2 프롬프트 초안을 그대로 옮긴 것(문서가 바뀌면 다시 옮김) |
| `validate.py --results R --jobs J --out-tsv T` | 결과 검사(문서 1-3 표). 오류 행은 빼고 통과 행을 시트 22열 TSV 로 내보낸다. 오류가 있으면 종료 코드 1 |
| `validate.py --tsv 파일` | 시트 형식 TSV 를 같은 기준으로 검사 |

검사 요약: 태그는 사전 '확정'만(작품 `작품 ·`, 배우 `배우 ·`/`배우 조합`) · `confidence`↔`status` 짝 · 근거 한 문장(`. ? !` 합쳐 1개 이하)·100자 이하 · 금지어(`banned_words.tsv`; 배우 근거는 오류, 작품 근거는 줄거리 설명일 수 있어 경고) · 작품명 = 입력 `title` = KOPIS 공연 제목(지금 공연 + 최근 `kopis_current_*` 파일에 나온 끝난 공연 포함) · `source_url` https · 근거 수준 = `synopsis_source.level`(이미지 판단은 제작진·공식) · 배우 근거는 `source.tag`로 끝남 · 조합 규칙 · 원문과 연속 3어절 같으면 경고 · 시트·입력 `existing_tags`와 (링크·대상·태그) 중복은 경고하고 내보내기에서 뺌.

## 쓰는 순서

```
python3 tools/tagging/make_jobs.py --kind work
python3 tools/tagging/run_llm.py --backend manual --jobs data/tagging/jobs_work_<날짜>.jsonl      # 남은 입력 확인
# … 결과를 data/tagging/results_work_<날짜>.jsonl 에 모은다(입력 한 건당 한 줄)
python3 tools/tagging/validate.py --results data/tagging/results_work_<날짜>.jsonl --jobs data/tagging/jobs_work_<날짜>.jsonl --out-tsv data/tagging/pass_work_<날짜>.tsv
```

통과 TSV 를 시트 '태그 기록 (Claude)' 탭 맨 아래에 붙이고 사람이 상태(확정/검수 필요/보류)를 확인한 뒤, 데이터를 내보내면(`recommend.py --export app/data.js`) 작품 이름이 현재 공연 제목과 **정확히** 같은 확정 '작품' 행이 그 공연에 붙는다. 이름이 다른 행은 export 가 경고한다.

## 아직 안 한 것 (TODO)

- **로컬 LLM**: KOPIS 소개가 이미지뿐이라 글자만 받는 로컬 모델은 근거가 없다. 로컬 LLM을 정할 때 같이 고른다 — ① macOS Vision 같은 로컬 OCR 로 `intro_images` 글자를 뽑아 `synopsis_ocr` 필드에 넣는 전처리(후기·평점·수상 말풍선은 걸러야 함) ② 이미지를 읽는 로컬 모델 ③ 다른 공식 출처의 소개 글. 그때까지 `local` 백엔드는 글이 없는 입력을 건너뛴다.
- `kopis_url` 의 KOPIS 상세 주소 형식은 규칙 문서 예시를 따랐다(직접 열어 확인하지는 않음).
