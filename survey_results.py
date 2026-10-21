#!/usr/bin/env python3
"""탐색 설문 응답을 문항별 숫자로 정리한다: 문항별 집계 · 교차 분석 · 주관식 요약 · 가설 판정 · 표본 한계 → 시트에 붙이는 TSV 한 장.

사용:
  python3 survey_results.py                                    # 기본 경로(data/survey/*_2026-10-06.tsv)
  python3 survey_results.py --responses R.tsv --tagged T.tsv --summary S.tsv [--out OUT.tsv]
  python3 survey_results.py --selftest

입력: 연락처·X 아이디를 뺀 응답 TSV(번호 + 31문항, 복수 선택은 ';'로 구분), survey_tags.py가 만든 tagged_·tag_summary_ TSV(번호로 연결).
문항 번호(Q)는 응답 파일의 열 순서다(번호 열은 0). 표준 라이브러리만 쓴다. 판정 기준치는 docs/survey_v2.md의 것을 그대로 쓴다(결과를 보고 바꾸지 않는다).
ponytail: 검정은 카이제곱(근사)만 쓴다. 칸이 작거나(기대빈도<5) 비교가 많아지면 정확검정·다중비교 보정이 필요하다.
"""
import argparse
import csv
import math
import sys
from collections import Counter
from pathlib import Path

from survey_tags import unscorable  # '리뷰 점수로 못 거르는 이유' 파생 규칙은 한 곳(survey_tags.py)에만 둔다

ROOT = Path(__file__).parent
SURVEY = ROOT / "data" / "survey"
HEAD = ["구분", "문항", "보기", "응답 수", "비율", "분모", "비고"]
OTHER = "기타(직접 입력)"
COL = dict(  # 응답 파일의 열 제목(폼 문구 그대로)
    age="연령대를 선택해 주세요.", sex="성별을 선택해 주세요.", prev="이전에 이 설문에 응답한 적이 있나요?",
    views="최근 1년간 뮤지컬을 몇 편 보셨나요?", rewatch="같은 작품을 최대 몇 번까지 다시 보셨나요?",
    cast_effect="뮤지컬을 예매할 때 캐스팅이 관람 결정에 얼마나 영향을 미치나요?", cast_style="평소 캐스트를 고를 때 어느 쪽에 가장 가깝나요?",
    order="뮤지컬 예매 시, 관람 날짜와 캐스트는 보통 어떤 순서로 정하나요?", slot="관람한 공연의 시간대를 알려 주세요.",
    top_cause="그 회차를 고르는 데 가장 영향을 준 것은 무엇이었나요?", factors="캐스트를 고를 때 중요했던 요소를 최대 3개 골라 주세요.",
    avoid="보고 싶은 배우가 있었지만, 다른 배역의 캐스팅 때문에 그 회차를 고르지 않은 경험이 있나요?",
    fav_pass="좋아하는 배우가 출연하면, 평소 취향과 조금 맞지 않아도 그 배우가 나오는 회차를 고르는 편인가요?",
    ax_sing="가창 중심 ↔ 연기 중심", ax_vol="강한 성량 ↔ 섬세한 표현", ax_tone="맑고 부드러운 음색 ↔ 허스키하고 묵직한 음색",
    ax_read="강렬한 캐릭터 해석 ↔ 자연스럽고 현실적인 해석", ax_emo="감정을 크게 표현하는 연기 ↔ 절제된 연기",
    no_fav="특별히 좋아하는 배우가 없는 작품이라면 캐스트를 어떻게 고르나요?", want_info="추천 결과에서 가장 알고 싶은 정보는 무엇인가요? 최대 3개 골라 주세요.",
    help_one="다음과 같은 '배우 1명 추천'이 실제 예매 결정에 얼마나 도움이 될 것 같나요?", help_combo="다음과 같은 '캐스트 조합 추천'이 실제 예매 결정에 얼마나 도움이 될 것 같나요?",
    first="둘 중 하나만 먼저 제공된다면 어떤 기능을 더 사용해 보고 싶나요?", wish="앞으로 추가되었으면 하는 기능은 무엇인가요? 최대 3개 골라 주세요.")
ONE, COMBO = "내 취향에 맞는 배우 1명 추천", "내 취향에 맞는 전체 캐스트 조합 추천"
# (열, 문항 이름, 보기 순서(폼 순서)) — 보기에 없는 답은 '기타(직접 입력)'로 묶는다. 폼 2026-10-05 기준.
SINGLE = [
    ("age", "연령대", ["만 14세 이상~19세", "20~24세", "25~29세", "30~34세", "35~39세", "40대", "50대 이상"]),
    ("sex", "성별", ["여성", "남성", "기타", "응답하지 않음"]),
    ("prev", "이전 응답 여부", ["처음 응답합니다", "다른 관람 경험으로 추가 응답합니다"]),
    ("views", "최근 1년 뮤지컬 관람 편수", ["0편 (최근 1년 관람 없음)", "1~2편", "3~6편", "7~12편", "13편 이상"]),
    ("rewatch", "같은 작품 최대 재관람 횟수", ["1번(다시 보지 않았다)", "2~4번", "5~9번", "10번 이상"]),
    ("cast_style", "평소 캐스트를 고르는 방식", ["주로 보고 싶은 배우 한 명을 기준으로 고른다", "보고 싶은 배우를 우선하되 다른 배역의 캐스트도 고려한다", "여러 주요 배역의 배우 조합을 중요하게 고려한다", "캐스트를 크게 고려하지 않는다"]),
    ("order", "날짜와 캐스트를 정하는 순서", ["관람 가능한 날짜를 먼저 정한 뒤, 그날의 캐스트 중에서 고른다", "날짜와 캐스트를 비슷한 정도로 함께 고려한다", "보고 싶은 캐스트를 먼저 정한 뒤, 그 캐스트가 출연하는 날짜를 찾는다"]),
    ("slot", "최근 관람 시간대", ["낮 공연", "저녁 공연", "정확히 기억나지 않음"]),
    ("top_cause", "최근 회차 선택에 가장 영향 준 것", ["특정 배우 한 명", "보고 싶은 배우를 우선했지만 다른 배역의 캐스트도 고려", "특정 배우 한 명보다 전체 배우 조합", "캐스트보다 날짜·시간", "캐스트보다 좌석", "캐스트보다 가격·할인"]),
    ("avoid", "다른 배역 캐스팅 때문에 회차를 고르지 않은 경험", ["예", "아니오"]),
    ("first", "하나만 먼저 쓴다면(배우 1명 vs 조합)", [ONE, COMBO, "둘 다 비슷하다", "둘 다 크게 필요하지 않다"]),
]
# (열, 문항 이름, 1점 뜻, 5점 뜻, 양극 척도 여부, 결정 C 대상 여부)
SCALE = [
    ("cast_effect", "캐스팅이 예매 결정에 미치는 영향", "전혀 아니다", "매우 그렇다", False, False),
    ("fav_pass", "좋아하는 배우면 취향이 안 맞아도 그 회차를 고름", "전혀 그렇지 않다", "매우 그렇다", False, False),
    ("ax_sing", "취향 축: 가창 ↔ 연기", "가창 중심", "연기 중심", True, True),
    ("ax_vol", "취향 축: 성량 ↔ 섬세한 표현", "강한 성량", "섬세한 표현", True, False),
    ("ax_tone", "취향 축: 맑은 음색 ↔ 허스키·묵직한 음색", "맑고 부드러운 음색", "허스키하고 묵직한 음색", True, True),
    ("ax_read", "취향 축: 강렬한 해석 ↔ 자연스러운 해석", "강렬한 캐릭터 해석", "자연스럽고 현실적인 해석", True, False),
    ("ax_emo", "취향 축: 감정을 크게 ↔ 절제", "감정을 크게 표현하는 연기", "절제된 연기", True, True),
    ("help_one", "'배우 1명 추천'이 예매 결정에 도움 될까", "전혀 도움되지 않는다", "매우 도움된다", False, False),
    ("help_combo", "'캐스트 조합 추천'이 예매 결정에 도움 될까", "전혀 도움되지 않는다", "매우 도움된다", False, False),
]
MULTI = [  # (열, 문항 이름, 보기(폼 순서))
    ("factors", "캐스트를 고를 때 중요했던 요소(최대 3개)", ["가창력", "성량", "음색", "연기력", "감정 표현", "캐릭터 해석", "춤·움직임", "배역과 어울리는 이미지", "다른 배우와의 조합·케미", "기존 관람 후기·평판", "배우에 대한 기존 호감", "방송·드라마 등에서 이미 알고 있던 배우인지"]),
    ("no_fav", "좋아하는 배우가 없는 작품에서 캐스트 고르는 법", ["노래 영상을 찾아본다", "연기·공연 영상을 찾아본다", "SNS·커뮤니티 후기를 찾아본다", "배우의 이전 작품을 찾아본다", "지인에게 추천받는다", "유명하거나 익숙한 배우를 고른다", "시간·날짜가 맞는 회차를 우선한다", "좋은 좌석이 남은 회차를 고른다", "가격·할인 조건을 우선한다", "크게 고민하지 않는다"]),
    ("want_info", "추천 결과에서 가장 알고 싶은 정보(최대 3개)", ["나와 배우의 취향 적합도", "이 배우를 추천하는 이유", "배우의 가창 스타일", "배우의 연기 스타일", "캐릭터 해석 특징", "해당 배우의 공연 영상", "다른 관객들의 평가", "함께 출연하는 배우와의 조합"]),
    ("wish", "앞으로 추가되었으면 하는 기능(최대 3개)", ["내 취향에 맞는 뮤지컬 작품 추천", "내 취향에 맞는 새로운 배우 추천", "원하는 배우·배역을 잘 볼 수 있는 좌석 추천", "관심 작품의 할인·타임세일 알림", "배우별 공식 공연 영상·넘버·인터뷰 모아보기"]),
]
# 결정 기준치(docs/survey_v2.md §1). 결과를 보고 바꾸지 않는다. 보류 구간은 기준치 ±5%p(같은 문서 '판정 규칙').
A_MIN, B_MIN, C_MAX, HOLD = 30.0, 40.0, 60.0, 5.0


def clean(s):  # TSV 한 칸에 안전하게: 탭·줄바꿈 제거
    return " ".join(str(s).split())


def pct(n, d):
    return f"{n / d * 100:.1f}%" if d else ""


def wilson(n, d, z=1.96):  # 비율의 95% 신뢰구간
    p = n / d
    c = (p + z * z / (2 * d)) / (1 + z * z / d)
    h = z * math.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / (1 + z * z / d)
    return (c - h) * 100, (c + h) * 100


def chi2_p(x, df):  # 카이제곱 상측 확률: 1 - P(df/2, x/2) (정규화 하위 불완전 감마, 급수)
    a, z = df / 2, x / 2
    if z <= 0:
        return 1.0
    term = s = 1.0 / a
    for k in range(1, 500):
        term *= z / (a + k)
        s += term
        if term < 1e-13 * s:
            break
    return max(0.0, 1.0 - s * math.exp(-z + a * math.log(z) - math.lgamma(a)))


def chi2_test(table):  # 행=집단, 열=답. 반환 (p, 자유도, 최소 기대빈도)
    table = [r for r in table if sum(r)]
    keep = [j for j, c in enumerate(zip(*table)) if sum(c)]
    table = [[r[j] for j in keep] for r in table]
    rs, cs, n = [sum(r) for r in table], [sum(c) for c in zip(*table)], sum(map(sum, table))
    x, mn = 0, float("inf")
    for i, r in enumerate(table):
        for j, o in enumerate(r):
            e = rs[i] * cs[j] / n
            mn = min(mn, e)
            x += (o - e) ** 2 / e
    df = (len(rs) - 1) * (len(cs) - 1)
    return chi2_p(x, df), df, mn


def pstr(p):
    return "p<0.001" if p < 0.001 else f"p={p:.3f}"


def load(path):
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter="\t"))
    return rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]


class Sheet:
    def __init__(self):
        self.rows = [HEAD]

    def add(self, kind, q, opt, n=None, d=None, note=""):
        self.rows.append([clean(x) for x in (kind, q, opt, "" if n is None else n, pct(n, d) if n is not None and d else "", "" if d is None else d, note)])


def build(resp_path, tagged_path, summary_path):
    head, R = load(resp_path)
    miss = [v for v in COL.values() if v not in head]
    if miss:
        sys.exit(f"응답 파일에 없는 열: {miss}")
    qn = {k: head.index(v) for k, v in COL.items()}   # 문항 번호 = 열 순서
    Q = lambda k, name: f"Q{qn[k]} {name}"
    g = lambda r, k: r[COL[k]].strip()
    N, sh = len(R), Sheet()

    # ---- 1. 문항별 집계 ----
    K1 = "1.문항별 집계"
    for k, name, opts in SINGLE:
        vals = [g(r, k) for r in R]
        answered = [v for v in vals if v]
        d, c = len(answered), Counter(answered)
        blank = N - d
        for o in opts:
            sh.add(K1, Q(k, name), o, c[o], d, f"무응답 {blank}건 제외" if blank and o == opts[0] else "")
        extra = sum(n for v, n in c.items() if v not in opts)
        if extra:
            sh.add(K1, Q(k, name), OTHER, extra, d, f"서로 다른 답 {len([v for v in c if v not in opts])}가지를 한 줄로 묶음")
    for k, name, lo, hi, bipolar, in_c in SCALE:
        vals = [g(r, k) for r in R if g(r, k)]
        d, c = len(vals), Counter(vals)
        for s in "12345":
            note = {"1": f"1점 = {lo}", "5": f"5점 = {hi}"}.get(s, "")
            if s == "3" and in_c:
                note = "결정 C 기준: 중간(3점)이 60% 초과면 폐기"
            elif s == "3" and bipolar:
                note = "결정 C 대상 아님(참고)"
            sh.add(K1, Q(k, name), f"{s}점", c[s], d, note + (f" · 무응답 {N - d}건 제외" if N - d and s == "1" else ""))
        if bipolar:
            sh.add(K1, Q(k, name), "1~2점 합계", c["1"] + c["2"], d, "왼쪽 끝 쪽")
        sh.add(K1, Q(k, name), "4~5점 합계", c["4"] + c["5"], d, "오른쪽 끝 쪽" if bipolar else "")
    for k, name, opts in MULTI:
        cells = [[x.strip() for x in g(r, k).split(";") if x.strip()] for r in R]
        d = sum(1 for x in cells if x)
        c = Counter(o for x in cells for o in set(x))
        for o in opts:
            sh.add(K1, Q(k, name), o, c[o], d, "복수 선택: 비율은 응답자 기준이라 합이 100%를 넘음" if o == opts[0] else "")
        free = sum(1 for x in cells if any(o not in opts for o in x))
        sh.add(K1, Q(k, name), OTHER, free, d, "보기에 없는 답을 쓴 응답자 수")

    # ---- 2. 교차 분석 ----
    K2 = "2.교차 분석"
    young = lambda r: g(r, "age").startswith("만 14")
    heavy = lambda r: g(r, "views") == "13편 이상"
    rew = lambda r: g(r, "rewatch")

    def cross(title, groups, outs, test_outs=None, diff_of=None):
        table = []
        for gl, gf in groups:
            sub = [r for r in R if gf(r)]
            d = len(sub)
            for ol, of in outs:
                sh.add(K2, title, f"{gl} → {ol}", sum(1 for r in sub if of(r)), d, "n<30: 참고용" if d < 30 else "")
            table.append([sum(1 for r in sub if of(r)) for ol, of in (test_outs or outs)])
        p, df, mn = chi2_test(table)
        note = f"카이제곱 검정 {pstr(p)}(자유도 {df})" + (" · 기대빈도 5 미만 칸 있음: 참고용" if mn < 5 else "")
        if diff_of:
            ol, of = diff_of
            rate = [sum(1 for r in R if gf(r) and of(r)) / max(1, sum(1 for r in R if gf(r))) * 100 for gl, gf in groups]
            note += f" · '{ol}' 비율 차이 {abs(rate[0] - rate[1]):.1f}%p"
        sh.add(K2, title, "(검정) 집단 간 차이", None, N, note + (f" · 검정에 쓴 답: {', '.join(o for o, _ in test_outs)}" if test_outs else ""))

    eq = lambda k, v: (lambda r: g(r, k) == v)
    cross("교차1 관람 편수 × 회피 경험", [("13편 이상", heavy), ("13편 미만", lambda r: not heavy(r))], [("예", eq("avoid", "예")), ("아니오", eq("avoid", "아니오"))], diff_of=("예", eq("avoid", "예")))
    o_labels = [("날짜 먼저", SINGLE[6][2][0]), ("함께 고려", SINGLE[6][2][1]), ("캐스트 먼저", SINGLE[6][2][2])]
    cross("교차2 관람 편수 × 날짜·캐스트 정하는 순서", [("13편 이상", heavy), ("13편 미만", lambda r: not heavy(r))], [(a, eq("order", b)) for a, b in o_labels], diff_of=("캐스트 먼저", eq("order", o_labels[2][1])))
    f_outs = [("배우 1명 추천", eq("first", ONE)), ("조합 추천", eq("first", COMBO)), ("둘 다 비슷", eq("first", "둘 다 비슷하다")), ("둘 다 필요 없음", eq("first", "둘 다 크게 필요하지 않다"))]
    cross("교차3 재관람 횟수 × 먼저 쓴다면(배우 1명 vs 조합)", [(o, (lambda o: lambda r: rew(r) == o)(o)) for o in SINGLE[4][2]], f_outs, test_outs=f_outs[:2])
    cross("교차4 연령 × 먼저 쓴다면(배우 1명 vs 조합)", [("만 14~19세", young), ("20세 이상", lambda r: not young(r))], f_outs, test_outs=f_outs[:2], diff_of=("조합 추천", eq("first", COMBO)))
    tg = {r["번호"]: r for r in load(tagged_path)[1]}
    if {r["번호"] for r in R} != set(tg) or any(tg[r["번호"]]["회피 경험"] != g(r, "avoid") for r in R):
        sys.exit("응답 파일과 tagged 파일의 번호·회피 경험이 맞지 않아요. 같은 날짜의 파일끼리 쓰세요.")
    yes = [t for t in tg.values() if t["회피 경험"] == "예"]
    tags_of = lambda t: [x.strip() for x in t["피한 이유 태그"].split(",") if x.strip()]
    unsc = [t for t in yes if unscorable(tags_of(t))]
    c_ctrov = [t for t in unsc if "논란·사생활" in tags_of(t)]
    k5 = "교차5 회피 경험 '예' 중 리뷰 점수로 못 거르는 이유"
    lo5, hi5 = wilson(len(unsc), len(yes))
    sh.add(K2, k5, "해당(논란·사생활이거나, 스타일 언급 없이 개인 불호만)", len(unsc), len(yes), f"95% 신뢰구간 {lo5:.1f}~{hi5:.1f}% · 규칙은 survey_tags.py의 unscorable")
    sh.add(K2, k5, "└ 논란·사생활이 들어간 답", len(c_ctrov), len(yes), "위 해당에 포함")
    sh.add(K2, k5, "└ 개인 불호만 있고 가창·연기 등 스타일 언급 없는 답", len(unsc) - len(c_ctrov), len(yes), "위 해당에 포함")
    sh.add(K2, k5, "해당 안 함", len(yes) - len(unsc), len(yes), "")

    # ---- 3. 주관식 요약 (tag_summary 상위 5개) ----
    K3 = "3.주관식 요약"
    srows = load(summary_path)[1]
    base = {"고른 이유": sum(1 for t in tg.values() if t["고른 이유 태그"].strip()), "피한 이유": len(yes), "우려·요청": sum(1 for t in tg.values() if t["우려·요청 태그"].strip())}
    asked = sum(1 for r in R if r[head[-1]].strip())
    for q in base:
        rows_q = [s for s in srows if s["문항"] == q]
        for s in [s for s in rows_q if not s["태그"].startswith("(파생)")][:5] + [s for s in rows_q if s["태그"].startswith("(파생)")]:
            n = int(s["응답 수"])
            ok = abs(n / base[q] * 100 - float(s["비율(태그 붙은 답 기준)"].rstrip("%"))) < 0.11
            sh.add(K3, q, s["태그"], n, base[q], "키워드 규칙으로 붙인 태그라 한 답에 여러 개 가능(상위 5개)" + ("" if ok else " · 분모가 tag_summary와 다름: 확인 필요") + (" · survey_tags.py가 따로 계산한 파생 지표(상위 5개에 안 셈)" if s["태그"].startswith("(파생)") else ""))
    sh.add(K3, "우려·요청", "(참고) 이 칸을 쓴 사람", asked, N, "나머지는 빈칸 — 주관식 비율은 쓴 사람 기준이라 전체 의견이 아님")

    # ---- 4. 가설 판정 (docs/survey_v2.md §1의 결정 A~E) ----
    K4 = "4.가설 판정"
    tgt = [r for r in R if g(r, "views") == "3~6편" and not g(r, "rewatch").startswith("1번")]
    a_n, b_yes = len(tgt), sum(1 for r in tgt if g(r, "avoid") == "예")
    a_pct, b_pct = a_n / N * 100, b_yes / a_n * 100 if a_n else 0
    wide = sum(1 for r in R if g(r, "views") in ("3~6편", "7~12편") and not g(r, "rewatch").startswith("1번"))
    sh.add(K4, "A 1차 타겟(연 3~6회 관람 + 재관람) 비율 ≥ 30%", "미달" if a_pct < A_MIN else "통과", a_n, N,
           f"대응 Q{qn['views']}(편수=3~6편)·Q{qn['rewatch']}(재관람 1번 초과) 근사. 폼은 '편'(작품 수)·'같은 작품'(캐스트 무관)이라 정의가 다름. 보류 구간 {A_MIN - HOLD:.0f}~{A_MIN + HOLD:.0f}%{'에 해당' if abs(a_pct - A_MIN) <= HOLD else ' 밖'}. 7~12편까지 넓혀도 {pct(wide, N)}")
    lo, hi = wilson(b_yes, a_n)
    small = " · 타겟이 30명 안팎이라 오차가 큼" if a_n < 50 else ""
    b_band = abs(b_pct - B_MIN) <= HOLD
    sh.add(K4, "B 조합 문제가 진짜 있나: 타겟 중 회피 경험 '예' ≥ 40%", ("통과" if b_pct >= B_MIN else "미달") + ("(경계)" if b_band else ""), b_yes, a_n,
           f"대응 Q{qn['avoid']}. 분모는 A의 타겟({a_n}명{', n<30' if a_n < 30 else ''}){small}. 95% 신뢰구간 {lo:.1f}~{hi:.1f}%. 보류 구간 {B_MIN - HOLD:.0f}~{B_MIN + HOLD:.0f}%{'에 해당 → 모집 연장 대상' if b_band else ' 밖'}. 전체 응답자 기준은 {pct(sum(1 for r in R if g(r, 'avoid') == '예'), N)}")
    for k, name, *_ in [s for s in SCALE if s[5]]:
        mid_t = sum(1 for r in tgt if g(r, k) == "3")
        mid_a = sum(1 for r in R if g(r, k) == "3")
        mp = mid_t / a_n * 100 if a_n else 0
        sh.add(K4, f"C {name}: 중간(3점) ≤ 60%", "통과" if mp <= C_MAX else "미달", mid_t, a_n,
               f"대응 Q{qn[k]}. 분모는 타겟 {a_n}명{small}. 전체 응답자 기준 {pct(mid_a, N)}. 보류 구간 {C_MAX - HOLD:.0f}~{C_MAX + HOLD:.0f}%{'에 해당' if abs(mp - C_MAX) <= HOLD else ' 밖'}")
    sh.add(K4, "D 관람 후 태그·투표를 남길 의향 4~5점 ≥ 30%", "판정 불가", None, None, "대응 문항 없음: 이 폼에는 관람 후 태그·투표 참여 의향을 묻는 문항이 없다(Q27·Q28은 추천 결과의 도움 정도라 대체할 수 없음)")
    sh.add(K4, "E 캐스팅 확인 경로·예매처 → 배포 채널", "판정 불가", None, None, "대응 문항 없음: 이 폼에는 캐스팅 확인 경로·예매처를 묻는 문항이 없다")
    one, combo = sum(1 for r in R if g(r, "first") == ONE), sum(1 for r in R if g(r, "first") == COMBO)
    sh.add(K4, "(참고, 기준치 없음) 하나만 먼저 쓴다면 조합 추천", "참고", combo, N, f"배우 1명 추천 {one}명({pct(one, N)})보다 {combo - one}명 많음. 결정 B의 보조 지표(Q{qn['first']})")
    for k in ("help_combo", "help_one"):
        up = sum(1 for r in R if g(r, k) in ("4", "5"))
        sh.add(K4, f"(참고, 기준치 없음) Q{qn[k]} 도움 정도 4~5점", "참고", up, N, "배우 1명 추천 쪽" if k == "help_one" else "조합 추천 쪽")

    # ---- 5. 표본 한계 ----
    K5 = "5.표본 한계"
    cnt = lambda k, vs: sum(1 for r in R if g(r, k) in vs)
    sh.add(K5, "성별", "여성", cnt("sex", ["여성"]), N, f"남성 {cnt('sex', ['남성'])}명 · 기타 {cnt('sex', ['기타'])}명 · 응답하지 않음 {cnt('sex', ['응답하지 않음'])}명: 남성·그 밖의 의견은 사실상 읽을 수 없음")
    sh.add(K5, "연령", "만 14~19세", cnt("age", SINGLE[0][2][:1]), N, "미성년 비중")
    sh.add(K5, "연령", "29세 이하(만 14~29세)", cnt("age", SINGLE[0][2][:3]), N, "20대 이하에 쏠림")
    sh.add(K5, "연령", "35세 이상", cnt("age", SINGLE[0][2][4:]), N, "30대 후반 이상은 소수")
    sh.add(K5, "관람 빈도", "13편 이상", cnt("views", ["13편 이상"]), N, "최근 1년 기준. 열성 관객 쪽에 쏠렸을 가능성")
    sh.add(K5, "관람 빈도", "7편 이상", cnt("views", ["7~12편", "13편 이상"]), N, "")
    sh.add(K5, "관람 빈도", "2편 이하(0~2편)", cnt("views", ["0편 (최근 1년 관람 없음)", "1~2편"]), N, "입문·라이트 관객은 소수")
    sh.add(K5, "재관람", "같은 작품 10번 이상", cnt("rewatch", ["10번 이상"]), N, "")
    sh.add(K5, "중복 응답", "'다른 관람 경험으로 추가 응답'", cnt("prev", ["다른 관람 경험으로 추가 응답합니다"]), N, f"한 사람이 여러 번 응답할 수 있었고 이전 응답 여부를 비운 응답이 {sum(1 for r in R if not g(r, 'prev'))}건 있음. 식별 정보가 없어 중복 제거는 못 함")
    sh.add(K5, "모집", "응답 경로·참여 동기", None, None, "응답 경로(채널) 정보가 없다. 폼 안내문 기준 추첨 경품이 걸려 있었음 → 경품 목적 응답이 섞였을 수 있음")
    return sh.rows


def selftest():
    assert abs(chi2_p(3.841, 1) - 0.05) < 0.001 and abs(chi2_p(5.991, 2) - 0.05) < 0.001 and abs(chi2_p(16.919, 9) - 0.05) < 0.001
    lo, hi = wilson(13, 31)
    assert 25 < lo < 27 and 58 < hi < 60, (lo, hi)
    p, df, mn = chi2_test([[30, 10], [10, 30]])
    assert df == 1 and p < 0.001 and mn == 20
    assert clean("a\tb\nc") == "a b c" and pct(1, 3) == "33.3%" and pstr(0.0004) == "p<0.001"
    r, t, s = (SURVEY / f"{n}_2026-10-06.tsv" for n in ("responses_full", "tagged", "tag_summary"))
    if r.exists():   # 실제 파일이 있으면 불변식까지 점검
        rows = build(r, t, s)
        assert all(len(x) == len(HEAD) for x in rows)
        assert all("\t" not in c and "\n" not in c and not c.startswith(("=", "+", "-", "@")) for x in rows for c in x), "시트에 붙일 수 없는 칸"
        body = [x for x in rows[1:] if x[0] == "1.문항별 집계"]
        for _, name, *_ in SINGLE:   # 단일 선택은 보기 건수 합 = 분모
            part = [x for x in body if x[1].endswith(" " + name)]
            assert part and sum(int(x[3]) for x in part) == int(part[0][5]), name
        for _, name, *_ in SCALE:    # 척도는 1~5점 건수 합 = 분모
            part = [x for x in body if x[1].endswith(" " + name) and x[2] in tuple(f"{i}점" for i in range(1, 6))]
            assert len(part) == 5 and sum(int(x[3]) for x in part) == int(part[0][5]), name
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--responses", default=str(SURVEY / "responses_full_2026-10-06.tsv"))
    ap.add_argument("--tagged", default=str(SURVEY / "tagged_2026-10-06.tsv"))
    ap.add_argument("--summary", default=str(SURVEY / "tag_summary_2026-10-06.tsv"))
    ap.add_argument("--out", help="기본: --responses 와 같은 폴더의 survey_results_<날짜>.tsv")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        sys.exit()
    rows = build(a.responses, a.tagged, a.summary)
    out = Path(a.out) if a.out else Path(a.responses).with_name(Path(a.responses).name.replace("responses_full", "survey_results"))
    out.write_text("\n".join("\t".join(r) for r in rows) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(rows) - 1}줄")
