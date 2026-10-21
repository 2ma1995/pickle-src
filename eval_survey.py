#!/usr/bin/env python3
"""1차 설문으로 추천 규칙 오프라인 점검 (과제 C).

응답자가 '가장 최근에 본 공연'에서 실제로 고른 배우를, 그 사람이 적은 취향 축으로 앱 규칙(V.when = recommend.py score())을
돌렸을 때 같은 배역 캐스트 안에서 1위로 올리는지 본다. 만족도가 아니라 '과거 선택과 얼마나 맞나'다.

사용:
  python3 eval_survey.py             # 요약 출력 + docs/eval_survey_2026-10-07.md 작성
  python3 eval_survey.py --selftest  # 이름 매칭 · 취향 변환 · 동점 크레딧 assert

기존 파일은 읽기만 한다. 표준 라이브러리만 쓰고 네트워크를 쓰지 않는다.
"""
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from itertools import combinations
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).parent
SURVEY = ROOT / "data" / "survey" / "responses_full_2026-10-06.tsv"
ROLES = ROOT / "data" / "roles_2026-10-02.tsv"
DATAJS = ROOT / "app" / "data.js"
OUT = ROOT / "docs" / "eval_survey_2026-10-07.md"

C_NO, C_VIEWS, C_WORK, C_ACTORS = 0, 4, 9, 12
# 설문 척도 열 → (1~2점이면 왼쪽 키, 4~5점이면 오른쪽 키). data.js axes와 축 순서가 달라서 열마다 직접 적는다
SCALES = {20: ("가창", "연기"), 21: ("강한 성량", "섬세한 표현"), 22: ("맑은 음색", "묵직한 음색"),
          23: ("강렬한 해석", "자연스러운 해석"), 24: ("감정 크게", "절제")}
SMALL = 30  # n이 이보다 작으면 '참고용'
FLIP = {k: v for l, r in SCALES.values() for k, v in ((l, r), (r, l))}


def norm(s):
    return "".join(s.split())


def names_in(text, cast):
    """자유 응답에서 캐스트 이름 찾기. 앞뒤가 한글이면 다른 이름의 일부로 본다(정민 ≠ 박존정민·정민아). 뒤에 배우·님·씨는 허용."""
    return [a for a in cast if re.search(rf"(?<![가-힣]){re.escape(a)}(?=$|[^가-힣]|배우|님|씨)", text)]


def prefs_of(row):
    """척도 1~2 → 왼쪽 키, 4~5 → 오른쪽 키, 3·빈칸 → 없음."""
    out = []
    for col, (left, right) in SCALES.items():
        v = row[col].strip()
        if v in ("1", "2"):
            out.append(left)
        elif v in ("4", "5"):
            out.append(right)
    return out


def actor_key(tags, prefs, axis, axes):
    """앱 V.when 과 같은 규칙으로 배우 한 명의 (hit, 반대 근거 수)."""
    of = lambda p: set(axis.get(p, [p]))
    want = set().union(*map(of, prefs))
    mine = {t["tag"] for t in tags}
    hit = sum(1 for p in prefs if mine & of(p))  # 취향 하나당 최대 1점
    opp = {p: set(axis.get(x["right"] if p == x["left"] else x["left"], [])) - want
           for x in axes if x["left"] != "가창" for p in prefs if p in (x["left"], x["right"])}
    against = set().union(*(o for p, o in opp.items() if not mine & of(p)))  # 같은 축에 맞는 태그가 있으면 반대로 안 본다
    return hit, sum(1 for t in tags if t["tag"] in against)


def rank_order(keys):
    return {a: (-h, b) for a, (h, b) in keys.items()}  # 작을수록 앞: hit 높은 순 → 반대 근거 적은 순


def credit(keys, named):
    """1위 크레딧 = 1위 동점 중 적은 배우 수 / 1위 동점 수."""
    k = rank_order(keys)
    top = [a for a in k if k[a] == min(k.values())]
    return Fraction(sum(a in named for a in top), len(top))


def avg_rank(keys, a):
    """동점은 평균 순위."""
    k = rank_order(keys)
    return sum(k[b] < k[a] for b in k) + (sum(k[b] == k[a] for b in k) + 1) / 2


def p_random(cases):
    """적은 배우를 캐스트에서 무작위로 뽑았다면 1위 크레딧 합이 지금 이상 나올 확률(규칙 순위는 그대로 둔 정확 계산)."""
    dist = {Fraction(0): Fraction(1)}
    for c in cases:
        picks = list(combinations(c["keys"], len(c["named"])))
        step = Counter(credit(c["keys"], set(p)) for p in picks)
        new = defaultdict(Fraction)
        for s, ps in dist.items():
            for v, n in step.items():
                new[s + v] += ps * Fraction(n, len(picks))
        dist = new
    obs = sum(c["credit"] for c in cases)
    return float(sum(p for s, p in dist.items() if s >= obs))


def p_paired(a, b):
    """같은 사례에서 a가 b보다 1위 크레딧이 높은 게 우연인지: 사례마다 차이의 부호를 무작위로 뒤집었을 때 합이 지금 이상 나올 확률(정확)."""
    dist = {Fraction(0): Fraction(1)}
    diffs = [x["credit"] - y["credit"] for x, y in zip(a, b)]
    for d in filter(None, diffs):
        new = defaultdict(Fraction)
        for s, ps in dist.items():
            new[s + d] += ps / 2
            new[s - d] += ps / 2
        dist = new
    return float(sum(p for s, p in dist.items() if s >= sum(diffs)))


def load_data():
    s = DATAJS.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"):].rstrip().rstrip(";"))


def load_roles():
    """(작품 → 배역 → {주연 여부, 캐스트}). 같은 배역이 공연별로 여러 줄이면(팬레터 서울·인천) 캐스트를 합친다."""
    roles = defaultdict(dict)
    for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t"):
        x = roles[r["작품"]].setdefault(r["배역"], {"lead": r["비중"] == "주연", "cast": []})
        x["cast"] += [a for a in (y.strip() for y in r["캐스트 배우"].split(",")) if a and a not in x["cast"]]
    return roles


def run(rows, roles, D, fallback=True, prefs_fn=prefs_of, key_fn=actor_key):
    """평가 사례 목록과 깔때기 숫자. fallback=False면 다른 작품 리뷰에서 빌린 태그(from)를 뺀다.
    prefs_fn·key_fn은 대조군용(취향 뒤집기, 취향 무시)이다. 순위·크레딧은 평가 가능 여부와 상관없이 다 계산해 둔다."""
    seeds = {norm(w): w for w in roles}
    f = Counter()
    cases = []
    for r in rows:
        w = seeds.get(norm(r[C_WORK]))
        if not w:
            continue
        f["seed"] += 1
        cast_all = [a for x in roles[w].values() for a in x["cast"]]
        if not names_in(r[C_ACTORS], cast_all):
            continue
        f["named"] += 1
        prefs = prefs_fn(r)
        if not prefs:
            f["no_pref"] += 1
            continue
        f["pref"] += 1
        mine = [(role, x) for role, x in roles[w].items() if x["lead"] and names_in(r[C_ACTORS], x["cast"])]
        if not mine:
            f["support_only"] += 1
            continue
        f["resp"] += 1
        f["heavy"] += r[C_VIEWS] == "13편 이상"
        for role, x in mine:
            tags = {a: [t for t in D["actorTags"].get(w, {}).get(a, []) if fallback or not t.get("from")] for a in x["cast"]}
            keys = {a: key_fn(tags[a], prefs, D["axis"], D["axes"]) for a in x["cast"]}
            named = set(names_in(r[C_ACTORS], x["cast"]))
            cases.append({"no": r[C_NO], "work": w, "role": role, "keys": keys, "named": named,
                          "ok": any(h > 0 for h, _ in keys.values()), "credit": credit(keys, named),
                          "rank": mean(avg_rank(keys, a) for a in named),
                          "base": len(named) / len(x["cast"]), "size": len(x["cast"]),
                          "borrowed": any(t.get("from") for a in x["cast"] for t in tags[a])})
    return cases, f


def score_on(ev):
    hit = float(sum(c["credit"] for c in ev))
    return dict(hit=hit, rate=hit / len(ev), base=mean(c["base"] for c in ev), rank=mean(c["rank"] for c in ev),
                rank0=mean((c["size"] + 1) / 2 for c in ev), p=p_random(ev))


def stats(cases):
    ev = [c for c in cases if c["ok"]]
    return {"n": len(cases), "ev": len(ev), **(score_on(ev) if ev else {})}


def same_cases(control, cases):
    """대조군을 규칙이 평가 가능했던 사례와 똑같은 사례·같은 순서로 맞춘다."""
    by = {(c["no"], c["role"]): c for c in control}
    return [by[(c["no"], c["role"])] for c in cases if c["ok"]]


def tag(n):
    return " (참고용)" if n < SMALL else ""


def pv(p):
    return "<0.01" if p < 0.01 else f"{p:.2f}"


def pt(p):  # 문장용: p<0.01 / p=0.06
    return "p" + pv(p) if p < 0.01 else "p=" + pv(p)


def fmt(s):
    if not s["ev"]:
        return f"{s['ev']}/{s['n']} | — | — | — |"
    return (f"{s['ev']}/{s['n']} ({s['ev'] / s['n'] * 100:.0f}%) | **{s['rate'] * 100:.0f}%** ({s['hit']:.1f}/{s['ev']}){tag(s['ev'])} | "
            f"{s['base'] * 100:.0f}% | {pv(s['p'])} |")


def report(rows, roles, D):
    cases, f = run(rows, roles, D)
    own, _ = run(rows, roles, D, fallback=False)
    A, O = stats(cases), stats(own)
    ev = [c for c in cases if c["ok"]]
    f_ev = same_cases(run(rows, roles, D, prefs_fn=lambda r: [FLIP[x] for x in prefs_of(r)])[0], cases)
    t_ev = same_cases(run(rows, roles, D, key_fn=lambda tags, *_: (int(bool(tags)), 0))[0], cases)
    F, T = (score_on(x) if x else {} for x in (f_ev, t_ev))
    p_vs_tag, p_vs_flip = (p_paired(ev, x) if ev else None for x in (t_ev, f_ev))
    F["vs"], T["vs"] = p_vs_flip, p_vs_tag
    sig = lambda p: "우연과 구별돼요" if p < 0.05 else "우연과 확실히 구별되지 않아요"
    typo = sum(1 for r in rows if norm(r[C_WORK]) not in {norm(w) for w in roles} and "에반" in r[C_WORK])
    pc = lambda x: f"{x * 100:.0f}%"
    L = ["# 1차 설문으로 본 추천 규칙 점검 (2026-10-07)", ""]
    if A["ev"]:
        lift, pop = A["rate"] - A["base"], T["rate"] - A["base"]
        L += [f"> **한 줄 결론:** 응답자가 실제로 고른 배우를 규칙이 1위로 올린 비율은 **{pc(A['rate'])}**({A['hit']:.1f}/{A['ev']})로 무작위 {pc(A['base'])}보다 "
              f"{lift * 100:.0f}%p 높지만, 그중 {pop * 100:.0f}%p는 취향과 상관없이 '리뷰 태그가 있는 배우를 앞에 두기만 해도' 나오는 몫이에요(인기 배우일수록 리뷰가 많아서).",
              ">",
              f"> - 취향을 반대로 넣으면 {pc(F['rate'])}로 떨어져요(규칙과 차이 {pt(p_vs_flip)}, {sig(p_vs_flip)}).{' 취향 방향이 순위에 영향을 주긴 해요.' if p_vs_flip < 0.05 else ''}",
              f"> - 취향이 인기 효과 위에 더 보탠 몫은 {(A['rate'] - T['rate']) * 100:.0f}%p이고, {sig(p_vs_tag)}({pt(p_vs_tag)}).",
              f"> - {A['n']}건 중 {A['n'] - A['ev']}건은 태그가 없어 판단도 못 했고, 판단한 사례도 {pc(1 - A['rate'])}는 1위로 못 올렸어요.", ""]
    L += ["다시 만들기: `python3 eval_survey.py` · 검산: `python3 eval_survey.py --selftest`", "",
          "## 1. 방법", "",
          "1. **평가할 응답자**: '가장 최근에 본 뮤지컬'(Q9)이 시드 10개 작품(`data/roles_2026-10-02.tsv`) 중 하나이고(띄어쓰기를 지우고 비교), "
          "'고려한 배우'(Q12)에 그 작품 캐스트가 1명 이상 있는 사람. 이름은 단어 경계로 찾아요: `(?<![가-힣])이름(?=$|[^가-힣]|배우|님|씨)`. "
          "그래서 '정민'이 '박존정민'이나 '정민아'에 걸리지 않아요. 대신 '카이랑'처럼 조사가 바로 붙으면 놓쳐요.",
          "2. **취향 변환**: 척도 5개(Q20~24)를 1~2점 → 왼쪽, 4~5점 → 오른쪽, 3점 → 없음으로 바꿔요. 취향이 하나도 없는 사람은 빼고 따로 셌어요.",
          "3. **평가 단위 = (응답자, 배역)**: 적은 배우가 들어 있는 **주연** 배역마다 하나. 그 배역 캐스트 전원을 앱 규칙으로 점수 매겨 줄 세워요.",
          "   - hit = 서로 다른 (배우, 고른 취향) 쌍의 수. 배우 태그 중 하나가 `axis[취향]`에 있으면 그 취향에 1점(취향당 최대 1점).",
          "   - 반대 근거 = 고른 취향 반대쪽 태그 수. 가창↔연기는 빼고, 같은 축에 맞는 태그가 있으면 반대로 안 봐요.",
          "   - 순서 = hit 높은 순 → 반대 근거 적은 순. 동점은 평균 순위.",
          "   - 앱은 주연 배역 조합(회차) 단위로 점수를 더하는데, 여기서는 배역 하나씩 떼어서 봐요. 조합 태그(케미)는 안 써요.",
          "4. **지표**",
          "   - 평가 가능 = 그 배역 캐스트 중 1명이라도 고른 취향에 근거(hit>0)가 있는 사례. 아무도 근거가 없으면 앱도 '비교 불가'라서 뺐어요.",
          "   - 1위 적중 = 적은 배우가 1위인 비율. 1위가 동점이면 1/동점 수만 줘요(2명 동점 중 1명이면 0.5).",
          "   - 무작위 기준 = 배역마다 1/캐스트 수의 평균. 한 배역에 2명을 적었으면 2/캐스트 수예요.",
          "   - p(무작위) = 규칙 순위는 그대로 두고 '적은 배우'만 캐스트에서 무작위로 뽑았을 때 1위 적중 합이 지금 이상 나올 확률(정확 계산).",
          "   - 같은 응답자가 두 배역을 적으면 사례가 2개라서 사례끼리 완전히 독립은 아니에요.",
          "   - 배역이 공연별로 여러 줄이면(팬레터 서울·인천) 캐스트를 합쳐 한 배역으로 봐요.", "",
          "## 2. 결과", "",
          "### 누가 평가에 들어갔나", "",
          "| 단계 | 사람 수 |", "|---|---|",
          f"| 전체 응답 | {len(rows)} |",
          f"| 최근 관람작이 시드 작품 | {f['seed']} |",
          f"| 그중 그 작품 캐스트를 1명 이상 적음 | {f['named']} |",
          f"| 그중 취향이 하나도 없음(전부 3점) → 제외 | {f['no_pref']} |",
          f"| 그중 조연 배우만 적음 → 제외 | {f['support_only']} |",
          f"| **평가 대상 응답자** | **{f['resp']}** (사례 {A['n']}건) |", ""]
    if typo:
        L += [f"작품명 오타 {typo}건('디어 에반 핸슨' 철자 다름)은 정한 규칙(띄어쓰기만 지움)대로 뺐어요.", ""]
    L += ["### 핵심 숫자", "",
          "| 태그 범위 | 평가 가능 / 전체 사례 | 1위 적중 | 무작위 기준 | p(무작위) |", "|---|---|---|---|---|",
          f"| 전체 태그(앱 그대로) | {fmt(A)}",
          f"| 다른 작품에서 빌린 태그(from) 제외 | {fmt(O)}", ""]
    if A["ev"]:
        L += [f"평균 순위(동점은 평균)는 {A['rank']:.2f}위이고, 무작위라면 {A['rank0']:.2f}위예요. 평가 가능 사례 중 빌린 태그가 섞인 배역은 "
              f"{sum(c['borrowed'] for c in ev)}건이에요.", ""]
        L += ["### 대조: 순위를 다르게 매기면 (규칙이 판단할 수 있던 같은 사례로)", "",
              "| 순위 매기는 방법 | 1위 적중 | p(무작위) | 규칙과 차이 p |", "|---|---|---|---|",
              f"| 규칙 그대로 | **{pc(A['rate'])}** ({A['hit']:.1f}/{A['ev']}) | {pv(A['p'])} | — |",
              f"| 취향을 반대로 뒤집어 넣기(1~2점 ↔ 4~5점) | {pc(F['rate'])} ({F['hit']:.1f}/{A['ev']}) | {pv(F['p'])} | {pv(p_vs_flip)} |",
              f"| 취향 무시, 리뷰 태그가 하나라도 있는 배우 우선 | {pc(T['rate'])} ({T['hit']:.1f}/{A['ev']}) | {pv(T['p'])} | {pv(p_vs_tag)} |",
              f"| 무작위 | {pc(A['base'])} | — | — |", "",
              "읽는 법: 뒤집은 취향이 무작위 근처로 떨어지면 '취향 방향'이 순위에 실제로 영향을 준다는 뜻이에요. "
              "'태그 있는 배우 우선'이 무작위보다 높은 만큼은 취향이 아니라 리뷰 양(인기) 때문에 생기는 몫이에요. "
              "규칙과 이 줄의 차이가 취향 규칙이 더 보탠 몫이에요. "
              "'규칙과 차이 p'는 같은 사례끼리 짝지어, 사례마다 두 방법의 크레딧 차이 부호를 무작위로 뒤집었을 때 지금 이상 차이가 날 확률(정확 계산)이에요.", ""]
    L += ["### 작품별", "", "| 작품 | 평가 가능 / 전체 사례 | 1위 적중 | 무작위 기준 | p(무작위) |", "|---|---|---|---|---|"]
    for w in sorted({c["work"] for c in cases}, key=lambda w: -sum(c["work"] == w for c in cases)):
        L.append(f"| {w} | {fmt(stats([c for c in cases if c['work'] == w]))}")
    L += ["", "작품별은 전부 n<30이라 참고용이에요.", "",
          "### 평가 가능 사례 (응답자 번호만)", "", "| 응답자 | 작품 | 배역 | 캐스트 수 | 적은 배우 평균 순위 | 1위 크레딧 |", "|---|---|---|---|---|---|"]
    for c in ev:
        L.append(f"| {c['no']} | {c['work']} | {c['role']} | {c['size']} | {c['rank']:g} | {float(c['credit']):.2f} |")
    heavy = f["heavy"] / f["resp"] * 100 if f["resp"] else 0
    L += ["", "## 3. 주의할 점", "",
          "- **사람들은 대부분 팬이라서 배우를 골라요.** 여기서 쓴 취향 축은 '평소 취향'이지 그 공연을 고를 때의 기준이 아니에요. 규칙이 못 맞혀도 규칙이 틀렸다기보다 질문이 다른 것일 수 있고, 맞혀도 취향 덕분이라고 단정할 수 없어요.",
          f"- **표본이 열성 관객 쪽이에요.** 전체 응답자의 66.8%가 1년에 13편 이상 봐요. 평가 대상 {f['resp']}명 중에서는 {heavy:.0f}%예요.",
          f"- **태그가 아직 적어요.** 사례 {A['n']}건 중 {A['n'] - A['ev']}건은 캐스트 누구에게도 고른 취향 근거가 없어 판단 자체를 못 했어요"
          f"(사의찬미는 {sum(c['work'] == '사의찬미' for c in cases)}건 전부). 판단한 {A['ev']}건 중에서도 적은 배우 본인에게 근거가 있던 건 "
          f"{sum(any(c['keys'][a][0] > 0 for a in c['named']) for c in ev)}건이고, '가창'·'연기'는 목소리·연기 태그 아무거나 맞으면 1점이라 판단 가능 기준이 너그러워요.",
          "- **p(무작위)는 '아무나 고른 것과 같나'만 봐요.** 취향이 맞아서인지 인기 배우라 리뷰가 많아서인지는 위 대조 표로만 나눠 볼 수 있어요. 같은 응답자의 두 배역을 따로 셌기 때문에 p는 실제보다 조금 작게 나왔을 수 있어요.",
          "- **'과거 선택과 얼마나 맞나'이지 만족도가 아니에요.** 추천대로 봤을 때 더 좋았는지는 이 데이터로 알 수 없어요.",
          "- 이름 매칭은 규칙 기반이라 조사가 붙은 이름은 놓치고, 동명이인은 구별 못 해요.", "",
          "## 4. 발표에서 이렇게 말하기", ""]
    if A["ev"]:
        L += [f"> \"1차 설문 응답자가 실제로 고른 배우를 우리 규칙에 넣어 보니, 판단할 수 있는 {A['ev']}건 중 {pc(A['rate'])}에서 그 배우가 1위였어요. "
              f"아무나 골랐다면 {pc(A['base'])}, 취향을 거꾸로 넣으면 {pc(F['rate'])}예요.\"",
              "",
              f"> \"다만 리뷰가 많은 인기 배우를 앞에 두기만 해도 {pc(T['rate'])}가 나오고, 이건 만족도가 아니라 과거 선택과의 일치예요. "
              f"{A['n'] - A['ev']}건은 태그가 없어 판단도 못 했어요. 다음은 태그를 늘리고 관람 후 기록으로 다시 재는 거예요.\""]
    return "\n".join(L) + "\n", A, O, F, T, f


def selftest():
    # 이름: 단어 경계, 배우·님·씨 허용, 2글자 이름이 긴 이름에 걸리지 않음
    cast = ["정민", "박존정민", "카이", "주민진", "신성록"]
    assert names_in("정민 배우", cast) == ["정민"]
    assert names_in("박존정민", cast) == ["박존정민"]
    assert names_in("정민아, 주민진님", cast) == ["주민진"]
    assert names_in("카이씨/신성록…", cast) == ["카이", "신성록"]
    assert names_in("카이랑", cast) == []  # 조사가 붙으면 놓친다(규칙 그대로)
    # 취향 변환: 1~2 왼쪽, 4~5 오른쪽, 3·빈칸 없음
    row = [""] * 25
    row[20:25] = ["1", "5", "3", "2", ""]
    assert prefs_of(row) == ["가창", "섬세한 표현", "강렬한 해석"]
    row[20:25] = ["3"] * 5
    assert prefs_of(row) == []
    # 동점 1위 크레딧과 평균 순위
    keys = {"A": (1, 0), "B": (1, 0), "C": (0, 0)}
    assert credit(keys, {"A"}) == Fraction(1, 2) and credit(keys, {"C"}) == 0 and credit(keys, {"A", "B"}) == 1
    assert avg_rank(keys, "A") == 1.5 and avg_rank(keys, "C") == 3
    assert credit({"A": (1, 0), "B": (1, 2)}, {"A"}) == 1  # hit 같으면 반대 근거 적은 쪽이 1위
    # 앱 규칙: 반대 근거, 같은 축에 맞는 태그가 있으면 반대 아님, 가창↔연기는 반대 없음
    axis = {"맑은 음색": ["맑음"], "묵직한 음색": ["허스키"], "가창": ["맑음", "허스키"], "연기": ["절제된 연기"]}
    axes = [{"left": "가창", "right": "연기"}, {"left": "맑은 음색", "right": "묵직한 음색"}]
    t = lambda *xs: [{"tag": x} for x in xs]
    assert actor_key(t("허스키", "허스키"), ["맑은 음색"], axis, axes) == (0, 2)
    assert actor_key(t("맑음", "허스키"), ["맑은 음색"], axis, axes) == (1, 0)
    assert actor_key(t("절제된 연기"), ["가창"], axis, axes) == (0, 0)
    assert actor_key(t("맑음"), ["가창", "맑은 음색"], axis, axes) == (2, 0)
    # 무작위 확률: 캐스트 2명 중 1명이 1위인 사례 하나에서 1위를 맞히면 p=0.5
    assert abs(p_random([{"keys": {"A": (1, 0), "B": (0, 0)}, "named": {"A"}, "credit": Fraction(1)}]) - 0.5) < 1e-9
    one = lambda c: {"credit": Fraction(c)}
    assert p_paired([one(1), one(1)], [one(0), one(0)]) == 0.25 and p_paired([one(1)], [one(1)]) == 1
    print("selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit()
    rows = list(csv.reader(open(SURVEY, encoding="utf-8"), delimiter="\t"))[1:]
    md, A, O, F, T, f = report(rows, load_roles(), load_data())
    OUT.write_text(md, encoding="utf-8")
    print(f"평가 대상 응답자 {f['resp']}명 · 사례 {A['n']}건 · 평가 가능 {A['ev']}건")
    for name, s in (("전체 태그", A), ("빌린 태그 제외", O)):
        if s["ev"]:
            print(f"  {name}: 1위 적중 {s['rate'] * 100:.0f}% ({s['hit']:.1f}/{s['ev']}) vs 무작위 {s['base'] * 100:.0f}% · {pt(s['p'])}")
    if A["ev"]:
        print(f"  대조(같은 {A['ev']}건): 취향 뒤집기 {F['rate'] * 100:.0f}% (규칙과 차이 {pt(F['vs'])}) · "
              f"태그 있는 배우 우선 {T['rate'] * 100:.0f}% (규칙과 차이 {pt(T['vs'])})")
    print(f"→ {OUT.relative_to(ROOT)}")
