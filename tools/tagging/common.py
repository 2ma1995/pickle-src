"""LLM 태깅 파이프라인 공통: 스키마 이름, 사전 읽기, 금지어, 문장 검사. 표준 라이브러리만 쓴다(API 키·외부 호출 없음).
규칙의 원본은 docs/llm_tagging_spec_2026-10-11.md(7c). 여기 값이 문서와 다르면 문서가 맞다 — 바꾸면 이 파일 상수나 banned_words.tsv 만 고친다."""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

SCHEMA = "pickle-tagging/1"
KIND_OF = {"work": "work_theme", "actor": "actor_trait"}  # make_jobs/run_llm 의 --kind 값 → 스키마 kind
OUT_DIR = ROOT / "data" / "tagging"
# 시트 '태그 기록' 탭 열 순서(앱 recommend.py 의 tag_rows 가 읽는 그대로). 붙여 넣는 TSV 도 이 순서다
SHEET_COLS = ["기록일", "기록자", "작품", "시즌", "공연장", "회차(선택)", "대상 유형", "배역", "배우", "상대 배우(조합일 때)", "태그", "대분류", "하위 영역", "연결 취향축",
              "해석 차별성", "적용 범위", "상태", "근거 수준", "근거(원문 말고 내 말로 한 줄)", "출처 종류", "출처 링크", "평가 방향"]
SHEET_LEVELS = ["전문매체·언론", "일반 관객 후기", "설문", "직접 관람", "배우 본인·공식", "제작진·공식", "기타"]  # 시트 허용 목록(근거 수준)
WORK_LEVELS = ["제작진·공식", "전문매체·언론"]  # 작품 테마 근거 수준(7c 규칙 v1)
STATUS_OF = {"높음": "확정", "보통": "검수 필요", "낮음": "보류"}  # confidence → status 짝(어긋나면 오류)
SOURCE_URL = "https://kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00020&mt20Id={}"  # KOPIS 공연 상세 페이지(규칙 문서 예시와 같은 주소 형식)
MAX_EVIDENCE = 100  # 근거 한 줄 길이 한도(글자, 규칙 문서 1-3). 넘으면 오류
SKIP_REASONS = ["본인 취향", "성별 선호", "외모", "나이", "친분", "우열 표현", "부정 서술", "사전에 없음", "근거 불충분", "다른 사람 이야기", "중복", "판단 불가"]  # skipped.reason 코드(문서 1-2)


def read_jsonl(path):
    """[(줄 번호, 객체 또는 Exception)]. 빈 줄은 건너뛴다. 깨진 줄도 멈추지 않고 Exception 으로 돌려준다."""
    out = []
    for i, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            out.append((i, json.loads(line)))
        except ValueError as e:
            out.append((i, e))
    return out


def write_jsonl(path, objs):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("".join(json.dumps(o, ensure_ascii=False) + "\n" for o in objs), encoding="utf-8")


def dict_rows(dict_path=None):
    """태그 사전에서 '확정'(또는 상태 칸이 빈) 태그만: [{tag, group, sub, meaning, phrases[], axis}]. 후보·검수 필요·그 밖의 상태는 안 나온다(recommend.py 와 같은 규칙)."""
    if dict_path is None:
        import recommend
        dict_path = recommend.DICT
    rows = []
    for r in csv.DictReader(open(dict_path, encoding="utf-8"), delimiter="\t"):
        tag = (r.get("태그") or "").strip()
        if not tag or (r.get("태그 상태") or "").strip() not in ("", "확정"):
            continue
        rows.append({"tag": tag, "group": (r.get("대분류") or "").strip(), "sub": (r.get("하위 영역") or "").strip(), "meaning": (r.get("뜻") or "").strip(),
                     "phrases": [p.strip() for p in (r.get("이런 표현이면 이 태그") or "").split(",") if p.strip()], "axis": (r.get("연결 취향축") or "").strip()})
    return rows


def group_ok(kind, group):
    """kind 에 맞는 사전 대분류인가: 작품 테마는 '작품 · …', 배우 특징은 '배우 · …' 또는 '배우 조합'."""
    return group.startswith("작품 ·") if kind == "work_theme" else (group.startswith("배우 ·") or group == "배우 조합")


def allowed_tags(kind, rows):
    """입력에 넣는 allowed_tags: [{tag, group, meaning, phrases[]}]"""
    return [{"tag": r["tag"], "group": r["group"], "meaning": r["meaning"], "phrases": r["phrases"]} for r in rows if group_ok(kind, r["group"])]


def load_banned(path=None):
    """금지어 표(banned_words.tsv: 분류, 단어 또는 /정규식/ — 탭으로 나눔) → [(분류, 컴파일된 정규식)]. 외모·나이·친분·우열 말은 근거 문장에 못 쓴다."""
    out = []
    for line in Path(path or HERE / "banned_words.tsv").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cat, _, word = line.partition("\t")
        word = word.strip()
        if cat.strip() and word:
            out.append((cat.strip(), re.compile(word[1:-1] if len(word) > 2 and word[0] == word[-1] == "/" else re.escape(word))))
    return out


def find_banned(text, banned):
    return [(cat, m.group(0)) for cat, rx in banned for m in [rx.search(text or "")] if m]


def eojeol(text):
    """어절(공백 기준) 목록. 문장부호·따옴표는 떼고 비교한다."""
    return [w for w in (re.sub(r"[^\w가-힣]", "", x) for x in str(text or "").split()) if w]


def overlap(evidence, source, n=3):
    """근거 문장이 원문과 연속 n어절 이상 같으면 그 어절들을, 아니면 None. 원문을 그대로 옮긴 근거를 잡는다."""
    e, s = eojeol(evidence), eojeol(source)
    if len(e) < n or len(s) < n:
        return None
    grams = {tuple(s[i:i + n]) for i in range(len(s) - n + 1)}
    for i in range(len(e) - n + 1):
        if tuple(e[i:i + n]) in grams:
            return " ".join(e[i:i + n])
    return None


def strip_tag(text, tag):
    """근거 끝의 출처 표시(source.tag)를 뗀 본문. '… (2차 설문 #ab12)' 와 '… 2차 설문 #ab12' 모두."""
    t = (text or "").strip()
    if tag:
        for end in (f"({tag})", f"（{tag}）", tag):
            if t.endswith(end):
                return t[:-len(end)].rstrip()
    return t


def one_sentence(text):
    """한 문장인가: 마침표·물음표·느낌표 합쳐 1개 이하(문서 1-3). 출처 표시(도메인에 점이 있다)는 떼고 센다."""
    return sum(str(text or "").count(c) for c in ".?!。") <= 1


def title_key(s):
    return re.sub(r"[^0-9a-z가-힣]", "", str(s).lower())
