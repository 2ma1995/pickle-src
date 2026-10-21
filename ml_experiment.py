#!/usr/bin/env python3
"""오프라인 ML 실험: '좋아하는 배우' 추천을 규칙 대신 데이터로 만들 수 있나? (앱·data.js는 안 건드린다)

설문 1차(data/survey/responses_full_2026-10-06.tsv)에서 쓰는 열은 두 가지뿐이다: 19번 '좋아하는 배우'(자유 글)와 21~25번 취향 5축.
나이·성별 같은 개인 정보 열은 읽지 않고, 결과는 합계·평균·신뢰구간 같은 집계만 낸다.

비교하는 모델(모두 같은 교차검증·같은 평가 사례):
  M0   인기순(훈련 응답자에서 많이 언급된 순)
  M1   지금 규칙: 배우 프로필(actorProfiles)의 특성 유사도(앱 similarTo 와 같은 논리). 나머지 좋아하는 배우들의 특성을 합쳐 후보와 견준다. 프로필 있는 배우만 점수가 있다
  M1v  M1 의 목소리 특성만(앱이 KOPIS 현재 공연 후보에 쓰는 방식)
  M2   아이템 협업 필터링: 같이 좋아하는 배우 동시 등장. 인기 편향은 cosine(M2c)과 PMI(M2p)로 보정
  M3   (응답자의 축 답 × 배우 태그) 로지스틱 회귀 → 좋아하는 배우인가. M3p 는 훈련 인기(log)를 더한 것
  M4a  M1+M2+M3 z점수 가중합, M4b 는 M0 도 포함. 가중치는 바깥 훈련 안쪽 교차검증으로 고른다

평가: 좋아하는 배우가 2명 이상인 응답자마다 한 명을 가리고(leave-one-out) 나머지로 가린 배우의 순위를 본다. 지표 hit@5, hit@10, MRR.
  풀 두 개: 3번 이상 언급된 배우 전체 / 그중 프로필 있는 배우만. 동점은 무작위 순서의 기대값으로 센다.
  응답자 단위 5겹 교차검증 × 3번 반복(훈련 응답자의 통계만 쓴다 — 가린 사람은 어떤 모델의 훈련에도 없다). 신뢰구간·p 는 응답자 단위 부트스트랩.

사용:
  python3 ml_experiment.py              # 실험을 돌리고 docs/ml_experiment_2026-10-10.md 를 쓴다
  python3 ml_experiment.py --selftest   # 가짜 설문(구조를 심어 둠)으로 파싱·지표·모델·교차검증 확인
표준 라이브러리 + numpy(이미 설치돼 있음)만 쓴다.
"""
import argparse
import csv
import math
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from recommend import AXES, AXIS, VOICE_AXIS, load_actor_profiles

ROOT = Path(__file__).parent
SURVEY = ROOT / "data" / "survey" / "responses_full_2026-10-06.tsv"
OUT = ROOT / "docs" / "ml_experiment_2026-10-10.md"
C_FAV = 18  # 19번 문항(0부터 18). 좋아하는 배우 자유 글
# 취향 5축 열(21~25번) → (왼쪽 키, 오른쪽 키). 1~2점이 왼쪽, 4~5점이 오른쪽(eval_survey.py 와 같은 해석). 값 = 점수 - 3 → -2..2(음수 = 왼쪽)
SCALES = [(20, "가창", "연기"), (21, "강한 성량", "섬세한 표현"), (22, "맑은 음색", "묵직한 음색"), (23, "강렬한 해석", "자연스러운 해석"), (24, "감정 크게", "절제")]
STOP = {"없습니다", "없음", "없어요", "없다", "없는데", "없네요", "딱히", "특별히", "모르겠습니다", "모름", "많아서", "생략", "모두", "다수", "너무", "여러명", "여러분"}


# ---------------- 파싱 ----------------
def parse_favs(text):
    """자유 글에서 배우 이름 목록. 쉼표·슬래시·점·공백으로 나누고 끝의 배우님·님·씨·등을 떼서 한글 2~4자만 남긴다. 괄호 설명은 지운다."""
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", text or "")
    out = []
    for t in re.split(r"[\s,/·;、.:?!~]+", text):
        t = re.sub(r"(배우님들|배우님|배우들|배우|님들|님|씨|등등|등)$", "", t.strip())
        if re.fullmatch(r"[가-힣]{2,4}", t) and t not in STOP and t not in out:
            out.append(t)
    return out


def load_survey(path=SURVEY):
    """(좋아하는 배우 목록들, 축 답 행렬 n×5). 개인 정보 열은 읽지 않는다."""
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter="\t"))[1:]
    favs = [parse_favs(r[C_FAV]) for r in rows]
    X = np.array([[(int(r[c]) - 3) if r[c].strip() in ("1", "2", "3", "4", "5") else 0 for c, *_ in SCALES] for r in rows], dtype=float)
    return favs, X


# ---------------- 출연 이력 (7c 위키백과 수집: data/actor_history_wiki_*.tsv) ----------------
HIST_COLS = ["배우", "연도", "작품", "배역", "구분", "위키 문서 제목", "비고"]
GENERIC_ROLES = {"", "역", "앙상블", "코러스", "단역", "조연", "주연", "출연", "출연진", "외", "합창", "배우"}


def strip_brackets(s):
    """괄호 속 글을 지운다. 위키 표에서 따라온 짝이 안 맞는 괄호도 처리: 닫는 괄호만 남으면 그 뒤(보통 ') - 배역')를, 여는 괄호만 남으면 그 앞을 남긴다('L(엘' → 'L', '에릭(팬텀' → '에릭')."""
    s = re.sub(r"\([^()]*\)|\[[^\[\]]*\]", " ", s or "")
    if re.search(r"[)\]]", s):
        s = re.split(r"[)\]]", s)[-1].lstrip(" -–:")
    return re.split(r"[(\[]", s)[0]


def norm_work(s):
    """작품명 비교용: 괄호 속 글(연도·영문)과 앞의 '뮤지컬', 따옴표·꺾쇠, 공백·기호를 없애고 소문자로."""
    s = strip_brackets(s)
    s = re.sub(r"[〈〉<>《》「」『』\"'“”‘’]", " ", s)
    s = re.sub(r"^\s*(뮤지컬|연극)\s*", "", s)
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def norm_roles(s):
    """배역 칸 → 정규화한 배역 이름 목록. 괄호 설명 제거, 쉼표·슬래시·가운뎃점·&·+로 나눔, 끝의 '역' 제거, 앙상블·단역 같은 일반 배역은 버린다."""
    out = []
    for r in re.split(r"[,/·&+、]", strip_brackets(s)):
        r = re.sub(r"\s+", "", r)
        if r in GENERIC_ROLES or re.search(r"\d{2,}|\.\.|…|~", r) or len(r) > 20:  # '단역'의 '역'을 떼기 전에 일반 배역부터 거른다. 날짜·장소 찌꺼기('.01.23 ~ …')·너무 긴 값도 버린다
            continue
        r = r[:-1] if len(r) > 1 and r.endswith("역") else r
        if r not in GENERIC_ROLES and r not in out:
            out.append(r)
    return out


SKIP_NOTE = "동명이인 미확인"  # 비고에 이 말이 있는 행은 같은 사람인지 확인이 안 돼서 쓰지 않는다(2026-10-10 f2 검수)


def load_history(path, kinds=("뮤지컬", "연극"), skip_note=SKIP_NOTE):
    """TSV(열: 배우 | 연도 | 작품 | 배역 | 구분(뮤지컬/연극) | 위키 문서 제목 | 비고, 헤더 있음) → {배우: {"roles": {(작품, 배역)}, "works": {작품}}}.
    구분이 kinds 에 없는 행, 비고에 skip_note 가 든 행은 뺀다. 이름은 공백을 없앤다."""
    out = defaultdict(lambda: {"roles": set(), "works": set()})
    rows = csv.reader(open(path, encoding="utf-8"), delimiter="\t")
    head = next(rows)
    ix = {name: next(i for i, h in enumerate(head) if h.startswith(name)) for name in ("배우", "작품", "배역", "구분", "비고")}
    for r in rows:
        if len(r) <= max(ix.values()) or (kinds and r[ix["구분"]].strip() not in kinds) or (skip_note and skip_note in r[ix["비고"]]):
            continue
        a, w = re.sub(r"\s+", "", r[ix["배우"]]), norm_work(r[ix["작품"]])
        if not a or not w:
            continue
        out[a]["works"].add(w)
        for role in norm_roles(r[ix["배역"]]):
            out[a]["roles"].add((w, role))
    return dict(out)


def idf_cosine(sets, names):
    """sets: {배우: 키 집합}(df·IDF 는 이 전체에서), names: 유사도 행렬을 낼 배우들(순서) → (len×len) IDF 가중 cosine, 대각선 0.
    키가 많은 배우가 유리하지 않도록 두 배우의 IDF² 합으로 정규화하고, 흔한 키(df 큼)는 가중이 낮다. 이력 없는 배우는 행·열이 0."""
    N = max(len(sets), 1)
    df = Counter(k for ks in sets.values() for k in ks)
    idf = {k: math.log((1 + N) / (1 + c)) + 1.0 for k, c in df.items()}
    norm = np.array([math.sqrt(sum(idf[k] ** 2 for k in sets.get(a, ()))) for a in names])
    held = Counter(k for a in names for k in sets.get(a, ()))
    keys = {k: i for i, k in enumerate(sorted(k for k, c in held.items() if c >= 2))}  # 두 사람 이상이 가진 키만 내적에 기여
    H = np.zeros((len(names), max(len(keys), 1)))
    for r, a in enumerate(names):
        for k in sets.get(a, ()):
            if k in keys:
                H[r, keys[k]] = idf[k]
    S = H @ H.T / np.maximum(np.outer(norm, norm), 1e-12)
    np.fill_diagonal(S, 0.0)
    return S


# ---------------- 배우 특성 (앱 traitsOf / similarTo 와 같은 논리) ----------------
def voice_key(tag):
    """목소리 태그의 (축, 쪽): 음색 넷은 한 축에서 맑은 쪽 L / 묵직한 쪽 R, 성량 같은 건 취향 축의 쪽, 반대쪽이 없는 태그(고음·딕션)는 쪽이 ''."""
    side = ""
    for _, left, right, *_ in AXES:
        if left == "가창":
            continue
        if tag in AXIS.get(left, []):
            side = "L"
        elif tag in AXIS.get(right, []):
            side = "R"
    return VOICE_AXIS.get(tag, tag), side


def traits_of(profile):
    """프로필 {voice: [{tag}], role: [{tag}]} → (목소리 {(축, 쪽)}, 연기·해석 태그 {태그})."""
    voice = {voice_key(r["tag"]) for r in profile.get("voice", [])}
    return frozenset(voice), frozenset(r["tag"] for r in profile.get("role", []))


def merge_traits(traits):
    return frozenset().union(*(v for v, _ in traits)), frozenset().union(*(r for _, r in traits))


def similar_to(fav, cand, voice_only=False):
    """앱 similarTo: 겹치는 특성 수, 같은 목소리 축에서 fav 쪽이 하나도 없고 반대쪽만 있으면 out(-1)."""
    fv, fr = fav
    cv, cr = cand
    for ax in {a for a, s in fv if s}:
        F = {s for a, s in fv if a == ax}
        C = {s for a, s in cv if a == ax and s}
        if C and not C & F:
            return -1
    return len(fv & cv) + (0 if voice_only else len(fr & cr))


# ---------------- 지표 ----------------
def _harm(n):
    return sum(1.0 / i for i in range(1, n + 1))


def tie_metrics(nb, nt, ks=(5, 10)):
    """정답보다 점수가 높은 후보 nb 개, 정답과 동점(정답 포함) nt 개. 동점은 무작위 순서의 기대값: hit@k, RR."""
    hits = [min(max((k - nb) / nt, 0.0), 1.0) for k in ks]
    rr = (_harm(nb + nt) - _harm(nb)) / nt
    return hits + [rr]


def rank_counts(scores, valid, target):
    """scores (사례×후보), valid 불리언 같은 모양, target (사례,) 후보 번호 → (nb, nt) 배열. 동점은 소수 8자리 반올림으로 본다."""
    s = np.where(valid, np.round(scores, 8), -np.inf)
    st = s[np.arange(len(s)), target][:, None]
    return (s > st).sum(1), (s == st).sum(1)


def metrics_matrix(scores, valid, target):
    nb, nt = rank_counts(scores, valid, target)
    return np.array([tie_metrics(int(a), int(b)) for a, b in zip(nb, nt)])  # (사례, 3) hit@5, hit@10, RR


def zscore(scores, valid):
    out = np.zeros_like(scores, dtype=float)
    for i in range(len(scores)):
        v = scores[i][valid[i]]
        sd = v.std()
        out[i][valid[i]] = (v - v.mean()) / sd if sd > 0 else 0.0
    return out


def boot_ci(per_person_sum, per_person_n, B=2000, seed=0):
    """응답자 단위 부트스트랩: (평균, 95% 구간). per_person_*: 응답자별 지표 합과 사례 수."""
    rng = np.random.default_rng(seed)
    n = len(per_person_sum)
    idx = rng.integers(0, n, size=(B, n))
    means = per_person_sum[idx].sum(1) / per_person_n[idx].sum(1)
    return per_person_sum.sum() / per_person_n.sum(), np.percentile(means, [2.5, 97.5])


def boot_diff(a_sum, b_sum, n, B=2000, seed=0):
    """두 모델의 응답자별 지표 합 차이(a-b) 평균, 95% 구간, 양쪽 부트스트랩 p."""
    rng = np.random.default_rng(seed)
    k = len(n)
    idx = rng.integers(0, k, size=(B, k))
    d = (a_sum[idx].sum(1) - b_sum[idx].sum(1)) / n[idx].sum(1)
    p = 2 * min((d <= 0).mean(), (d >= 0).mean())
    return (a_sum.sum() - b_sum.sum()) / n.sum(), np.percentile(d, [2.5, 97.5]), max(p, 1.0 / B)


# ---------------- 로지스틱 회귀 (L2, 뉴턴) ----------------
def fit_logreg(Xd, y, lam, pen, iters=15):
    """Xd (N×F), y (N,) 0/1, pen (F,) 1=규제 대상. 뉴턴-라프슨(IRLS)."""
    F = Xd.shape[1]
    w = np.zeros(F)
    m = y.mean()
    w[0] = math.log((m + 1e-9) / (1 - m + 1e-9))  # 첫 열은 절편
    R = lam * np.diag(pen)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Xd @ w)))
        g = Xd.T @ (y - p) - R @ w
        H = (Xd * (p * (1 - p))[:, None]).T @ Xd + R + 1e-8 * np.eye(F)
        step = np.linalg.solve(H, g)
        w += step
        if np.abs(step).max() < 1e-6:
            break
    return w


class Data:
    """설문 → 번호 붙인 배우·응답자 집합·풀·특성 행렬."""

    def __init__(self, favs, X, profiles, min_mention=3, hist=None):
        cnt = Counter(a for f in favs for a in f)
        self.actors = sorted(cnt, key=lambda a: (-cnt[a], a))
        self.ix = {a: i for i, a in enumerate(self.actors)}
        self.F = [sorted(self.ix[a] for a in f) for f in favs]
        self.X = X / 2.0  # -1..1
        self.count = np.array([cnt[a] for a in self.actors])
        self.pool1 = [i for i, a in enumerate(self.actors) if cnt[a] >= min_mention]
        self.pool2 = [i for i in self.pool1 if self.actors[i] in profiles]
        self.profiled = np.array([a in profiles for a in self.actors])
        self.traits = [traits_of(profiles.get(a, {})) for a in self.actors]
        self.tags = sorted({t for j in self.pool1 for t in self.tag_list(profiles.get(self.actors[j], {}))})
        self.T = np.zeros((len(self.pool1), len(self.tags)))
        for r, j in enumerate(self.pool1):
            for t in self.tag_list(profiles.get(self.actors[j], {})):
                self.T[r, self.tags.index(t)] = 1
        self.persons = [p for p in range(len(favs)) if self.F[p]]
        self.elig = [p for p in self.persons if len(self.F[p]) >= 2]
        self.cases = [(p, h) for p in self.elig for h in self.F[p] if h in set(self.pool1)]  # (응답자, 가릴 배우)
        self.has_hist = hist is not None
        if self.has_hist:  # 출연 이력: 있는 배우만 점수가 생긴다(없는 배우는 행·열 0). 이력은 설문과 별개 데이터라 교차검증 훈련·평가를 가르지 않는다
            self.hist = hist
            self.hasH = np.array([a in hist for a in self.actors])
            self.pool4 = [i for i in self.pool1 if self.hasH[i]]
            self.S5r = idf_cosine({a: h["roles"] for a, h in hist.items() if h["roles"]}, self.actors)
            self.S5w = idf_cosine({a: h["works"] for a, h in hist.items() if h["works"]}, self.actors)

    def tag_list_from(self, j):
        """풀 안 배우 j(전체 번호)의 서로 다른 프로필 태그."""
        return [t for t, on in zip(self.tags, self.T[self.pool1.index(j)]) if on]

    @staticmethod
    def tag_list(profile):
        return sorted({r["tag"] for r in profile.get("voice", [])} | {r["tag"] for r in profile.get("role", [])})

    def rest(self, p, h):
        return [i for i in self.F[p] if i != h]


# ---------------- 모델 ----------------
def interaction_features(X, T):
    """(응답자 P×5, 배우 J×G) → (P, J, 1+G+5G): 절편, 태그 주효과, 축 답×태그."""
    P, J, G = len(X), len(T), T.shape[1]
    out = np.ones((P, J, 1 + G + 5 * G))
    out[:, :, 1:1 + G] = T[None, :, :]
    out[:, :, 1 + G:] = (X[:, None, :, None] * T[None, :, None, :]).reshape(P, J, 5 * G)
    return out


class Models:
    """훈련 응답자만으로 M0·M2·M3 통계를 맞춘다. M1 은 훈련이 없다."""

    def __init__(self, d, train, lam=10.0, fit_m3=True, fit_pop=False):
        self.d = d
        A = len(d.actors)
        B = np.zeros((len(train), A))
        for r, p in enumerate(train):
            B[r, d.F[p]] = 1
        self.n0 = B.sum(0)  # M0: 한 번이라도 언급한 응답자 수
        B2 = B[B.sum(1) >= 2]  # M2: 좋아하는 배우가 2명 이상인 훈련 응답자
        n2, N2 = B2.sum(0), max(len(B2), 1)
        C = B2.T @ B2
        np.fill_diagonal(C, 0)
        self.cos = C / np.sqrt(np.outer(n2, n2) + 1e-12)
        self.pmi = np.log((C + 0.5) / (np.outer(n2, n2) / N2 + 0.5))
        np.fill_diagonal(self.cos, 0)
        np.fill_diagonal(self.pmi, 0)
        self.w3 = self.w3p = None
        if fit_m3:
            Xd, y = self._design(train, False)
            self.w3 = fit_logreg(Xd, y, lam, self._pen(Xd.shape[1]))
            if fit_pop:
                Xp, _ = self._design(train, True)
                self.w3p = fit_logreg(Xp, y, lam, self._pen(Xp.shape[1]))

    def _pen(self, F):
        pen = np.ones(F)
        pen[0] = 0
        return pen

    def _design(self, persons, pop):
        d = self.d
        Z = interaction_features(d.X[persons], d.T)
        if pop:
            lp = np.log1p(self.n0[d.pool1])
            Z = np.concatenate([Z, np.broadcast_to(lp[None, :, None], (len(persons), len(d.pool1), 1)).copy()], axis=2)
        y = np.zeros((len(persons), len(d.pool1)))
        pos = {j: r for r, j in enumerate(d.pool1)}
        for r, p in enumerate(persons):
            for a in d.F[p]:
                if a in pos:
                    y[r, pos[a]] = 1
        return Z.reshape(-1, Z.shape[2]), y.reshape(-1)

    def score_cases(self, cases):
        """사례 (p, h) 목록 → 모델별 점수 (사례 × pool1)."""
        d = self.d
        pool = np.array(d.pool1)
        out = defaultdict(list)
        for p, h in cases:
            R = d.rest(p, h)
            out["M0"].append(self.n0[pool])
            out["M2c"].append(self.cos[R][:, pool].sum(0) if R else np.zeros(len(pool)))
            out["M2p"].append(self.pmi[R][:, pool].sum(0) if R else np.zeros(len(pool)))
        if self.w3 is not None:
            ps = sorted({p for p, _ in cases})
            row = {p: r for r, p in enumerate(ps)}
            S = interaction_features(d.X[ps], d.T) @ self.w3
            out["M3"] = [S[row[p]] for p, _ in cases]
            if self.w3p is not None:
                lp = np.log1p(self.n0[pool])
                Zp = np.concatenate([interaction_features(d.X[ps], d.T), np.broadcast_to(lp[None, :, None], (len(ps), len(pool), 1))], axis=2)
                Sp = Zp @ self.w3p
                out["M3p"] = [Sp[row[p]] for p, _ in cases]
        return {k: np.array(v) for k, v in out.items()}


def m1_scores(d, cases):
    """M1(특성 유사도)·M1v(목소리만): 훈련이 없어서 한 번만 계산. out 후보는 가장 낮게(-1)."""
    pool = d.pool1
    s1 = np.zeros((len(cases), len(pool)))
    sv = np.zeros_like(s1)
    for r, (p, h) in enumerate(cases):
        fav = merge_traits([d.traits[i] for i in d.rest(p, h)])
        for c, j in enumerate(pool):
            s1[r, c] = similar_to(fav, d.traits[j])
            sv[r, c] = similar_to(fav, d.traits[j], True)
    return s1, sv


def m5_scores(d, cases):
    """M5r(같은 작품·배역)·M5w(같은 작품) 점수: 응답자가 고른 나머지 배우들과의 유사도 합. 이력 없는 후보는 0. 훈련이 없어 한 번만 계산."""
    pool = np.array(d.pool1)
    r5, w5 = np.zeros((len(cases), len(pool))), np.zeros((len(cases), len(pool)))
    for r, (p, h) in enumerate(cases):
        R = d.rest(p, h)
        if R:
            r5[r] = d.S5r[R][:, pool].sum(0)
            w5[r] = d.S5w[R][:, pool].sum(0)
    return r5, w5


def valid_masks(d, cases):
    """후보 마스크(풀 안 · 이미 좋아한 배우 제외)와 정답 위치. 풀2 는 정답도 풀2 안이어야 사례가 된다."""
    J = len(d.pool1)
    pos = {j: c for c, j in enumerate(d.pool1)}
    in2 = np.array([j in set(d.pool2) for j in d.pool1])
    v1 = np.ones((len(cases), J), dtype=bool)
    for r, (p, h) in enumerate(cases):
        for i in d.rest(p, h):
            if i in pos:
                v1[r, pos[i]] = False
    tgt = np.array([pos[h] for _, h in cases])
    v2 = v1 & in2[None, :]
    ok2 = in2[tgt]
    tail = np.array([c >= TOP for c in range(J)])  # pool1 은 언급 많은 순이라 앞 TOP 명이 인기 상위
    valid, ok = {"P1": v1, "P2": v2, "P3": v1 & tail[None, :]}, {"P1": np.ones(len(cases), bool), "P2": ok2, "P3": tail[tgt]}
    if d.has_hist:  # P4: 출연 이력이 있는 배우만 후보·정답(이력 없는 배우를 후보에서 빼는 처리)
        in4 = np.array([bool(d.hasH[j]) for j in d.pool1])
        valid["P4"], ok["P4"] = v1 & in4[None, :], in4[tgt]
    return valid, tgt, ok


def simplex(n, step=0.25):
    k = int(round(1 / step))
    def rec(left, parts):
        if parts == 1:
            yield (left,)
            return
        for i in range(left + 1):
            for rest in rec(left - i, parts - 1):
                yield (i,) + rest
    return [tuple(x * step for x in c) for c in rec(k, n)]


def combine(z, w):
    return sum(wi * zi for wi, zi in zip(w, z))


def tune_weights(zs, valid, tgt, ok, names):
    """zs[이름] (사례×후보) z점수. 가중치 격자에서 MRR 최고를 고른다(동률이면 첫 번째). 사례 없는 풀이면 균등."""
    idx = np.where(ok)[0]
    if len(idx) == 0:
        return tuple(1.0 / len(names) for _ in names)
    best, bw = -1, None
    for w in simplex(len(names)):
        s = combine([zs[n][idx] for n in names], w)
        m = metrics_matrix(s, valid[idx], tgt[idx])[:, 2].mean()
        if m > best + 1e-12:
            best, bw = m, w
    return bw


def kfold(persons, K, rng):
    ps = list(persons)
    rng.shuffle(ps)
    return [ps[i::K] for i in range(K)]


LAMS = (3.0, 30.0, 300.0)
POOLS = ("P1", "P2", "P3")
TOP = 10  # P3 = P1 에서 가장 많이 언급된 TOP 명을 후보·정답에서 뺀 풀(인기 배우 말고도 맞히나)
MODELS = ["M0", "M1", "M1v", "M2c", "M2p", "M3", "M3p", "M4a", "M4b"]
HIST_MODELS = ["M5r", "M5w", "M6"]  # 출연 이력을 줬을 때만


def run_experiment(d, K=5, repeats=3, seed=0, inner=4, lams=LAMS, log=None):
    """모든 사례의 모델별 점수를 교차검증으로 모아 풀별 지표 (사례, 3)을 돌려준다."""
    cases = d.cases
    ci = {c: r for r, c in enumerate(cases)}
    S1, SV = m1_scores(d, cases)
    valid, tgt, ok = valid_masks(d, cases)
    pools = list(valid)
    models = MODELS + (HIST_MODELS if d.has_hist else [])
    S5r, S5w = m5_scores(d, cases) if d.has_hist else (None, None)
    res = {pool: {m: np.zeros((len(cases), 3)) for m in models} for pool in pools}
    chosen = {"lam": [], "w4a": {p: [] for p in pools}, "w4b": {p: [] for p in pools}, "w6": {p: [] for p in pools}, "m2": []}
    for rep in range(repeats):
        rng = random.Random(seed * 100 + rep)
        folds = kfold(d.persons, K, rng)
        for fi, test in enumerate(folds):
            tset = set(test)
            train = [p for p in d.persons if p not in tset]
            tcases = [c for c in cases if c[0] in tset]
            rows = np.array([ci[c] for c in tcases], dtype=int)
            if len(rows) == 0:
                continue
            # ---- 안쪽 교차검증: 가중치·람다·M2 변형 고르기 ----
            icases = [c for c in cases if c[0] not in tset]
            irows = np.array([ci[c] for c in icases], dtype=int)
            ifolds = kfold(train, inner, random.Random(seed * 1000 + rep * 10 + fi))
            oof = {lam: defaultdict(lambda: np.zeros((len(icases), len(d.pool1)))) for lam in lams}
            pos_in = {c: r for r, c in enumerate(icases)}
            for lam in lams:
                for ifold in ifolds:
                    its = set(ifold)
                    m = Models(d, [p for p in train if p not in its], lam=lam)
                    cs = [c for c in icases if c[0] in its]
                    sc = m.score_cases(cs)
                    for k, arr in sc.items():
                        for c, row in zip(cs, arr):
                            oof[lam][k][pos_in[c]] = row
            iv = {p: valid[p][irows] for p in valid}
            it = tgt[irows]
            iok = {p: ok[p][irows] for p in ok}
            def mrr(s, pool):
                idx = np.where(iok[pool])[0]
                return metrics_matrix(s[idx], iv[pool][idx], it[idx])[:, 2].mean() if len(idx) else 0.0
            lam_best = max(lams, key=lambda l: mrr(oof[l]["M3"], "P1"))
            m2 = max(("M2c", "M2p"), key=lambda k: mrr(oof[lam_best][k], "P1"))
            chosen["lam"].append(lam_best)
            chosen["m2"].append(m2)
            o = oof[lam_best]
            iz = {}
            for name, sc in (("M0", o["M0"]), ("M1", S1[irows]), ("M2", o[m2]), ("M3", o["M3"])) + ((("M5r", S5r[irows]),) if d.has_hist else ()):
                iz[name] = {p: zscore(sc, iv[p]) for p in iv}
            weights = {}
            for pool in pools:
                za = {n: iz[n][pool] for n in iz}
                weights[(pool, "4a")] = tune_weights(za, iv[pool], it, iok[pool], ["M1", "M2", "M3"])
                weights[(pool, "4b")] = tune_weights(za, iv[pool], it, iok[pool], ["M0", "M1", "M2", "M3"])
                chosen["w4a"][pool].append(weights[(pool, "4a")])
                chosen["w4b"][pool].append(weights[(pool, "4b")])
                if d.has_hist:  # M6 = M5r + M2c(안쪽 선택 변형) 가중합, 가중치는 안쪽 교차검증 MRR 최고
                    weights[(pool, "6")] = tune_weights(za, iv[pool], it, iok[pool], ["M5r", "M2"])
                    chosen["w6"][pool].append(weights[(pool, "6")])
            # ---- 바깥 평가 ----
            m = Models(d, train, lam=lam_best, fit_pop=True)
            sc = m.score_cases(tcases)
            sc["M1"], sc["M1v"] = S1[rows], SV[rows]
            if d.has_hist:
                sc["M5r"], sc["M5w"] = S5r[rows], S5w[rows]
            for pool in pools:
                v, t = valid[pool][rows], tgt[rows]
                z = {n: zscore(sc[n if n != "M2" else m2], v) for n in ("M0", "M1", "M2", "M3") + (("M5r",) if d.has_hist else ())}
                scores = dict(sc)
                scores["M4a"] = combine([z[n] for n in ["M1", "M2", "M3"]], weights[(pool, "4a")])
                scores["M4b"] = combine([z[n] for n in ["M0", "M1", "M2", "M3"]], weights[(pool, "4b")])
                if d.has_hist:
                    scores["M6"] = combine([z["M5r"], z["M2"]], weights[(pool, "6")])
                for name in models:
                    res[pool][name][rows] += metrics_matrix(scores[name], v, t) / repeats
            if log:
                log(f"  반복 {rep + 1}/{repeats} 겹 {fi + 1}/{K}: 람다 {lam_best}, M2 {m2}, 가중치(P1) 4a {weights[('P1', '4a')]} 4b {weights[('P1', '4b')]}")
    return {"res": res, "ok": ok, "chosen": chosen, "cases": cases, "models": models, "pools": {"P1": len(d.pool1), "P2": len(d.pool2), "P3": max(len(d.pool1) - TOP, 0), **({"P4": len(d.pool4)} if d.has_hist else {})}}


# ---------------- 요약·통계 ----------------
def summarize(d, out, B=2000):
    """풀·모델별 지표와 M0 대비 차이(응답자 단위 부트스트랩)."""
    persons = sorted({p for p, _ in out["cases"]})
    pi = {p: i for i, p in enumerate(persons)}
    owner = np.array([pi[p] for p, _ in out["cases"]])
    table = {}
    for pool in out["ok"]:
        ok = out["ok"][pool]
        n = np.bincount(owner[ok], minlength=len(persons)).astype(float)
        keep = n > 0
        table[pool] = {"cases": int(ok.sum()), "persons": int(keep.sum()), "rows": {}, "vs_m2c": {}}
        base, allsums = None, {}
        for name in out["models"]:
            M = out["res"][pool][name]
            sums = [np.bincount(owner[ok], weights=M[ok, c], minlength=len(persons))[keep] for c in range(3)]
            row = {}
            for c, key in enumerate(("hit5", "hit10", "mrr")):
                mean, ci = boot_ci(sums[c], n[keep], B)
                row[key] = (mean, ci[0], ci[1])
            allsums[name] = sums
            if name == "M0":
                base = sums
            else:
                for c, key in enumerate(("hit5", "hit10", "mrr")):
                    diff, ci, p = boot_diff(sums[c], base[c], n[keep], B)
                    row["d_" + key] = (diff, ci[0], ci[1], p)
            table[pool]["rows"][name] = row
        for name in ("M4a", "M4b", "M2p", "M3p") + (("M5r", "M5w", "M6") if "M5r" in out["models"] else ()):  # M2c(협업 필터링) 단독 대비: 하이브리드·이력 모델이 더하는 게 있나
            diff, ci, p = boot_diff(allsums[name][2], allsums["M2c"][2], n[keep], B)
            table[pool]["vs_m2c"][name] = (diff, ci[0], ci[1], p)
    return table


def verdict(row, key="mrr"):
    d = row.get("d_" + key)
    if d is None:
        return "-"
    return "이김" if d[1] > 0 else "짐" if d[2] < 0 else "차이 없음"


def learned_weights(d, lam, boots=60, seed=0):
    """전체 응답자로 맞춘 M3 가중치와 응답자 부트스트랩 부호 안정성. 축 답: -1..1(음수 = 왼쪽 키)."""
    m = Models(d, d.persons, lam=lam)
    G = len(d.tags)
    w = m.w3
    rng = np.random.default_rng(seed)
    signs = np.zeros(len(w))
    for _ in range(boots):
        ps = [d.persons[i] for i in rng.integers(0, len(d.persons), len(d.persons))]
        wb = Models(d, ps, lam=lam).w3
        signs += np.sign(wb)
    stab = np.abs(signs) / boots
    inter = []
    for a, (_, left, right) in enumerate((s[0], s[1], s[2]) for s in SCALES):
        for g, tag in enumerate(d.tags):
            k = 1 + G + a * G + g
            inter.append((left, right, tag, w[k], stab[k], expected_sign(left, right, tag)))
    main = [(tag, w[1 + g], stab[1 + g]) for g, tag in enumerate(d.tags)]
    return w, inter, main


def expected_sign(left, right, tag):
    """앱 규칙이 말하는 방향: 오른쪽 키에 속한 태그면 +, 왼쪽 키면 -, 그 축과 관계없으면 0. (가창↔연기도 노래를 고르면 가창 태그, 연기를 고르면 그 밖의 연기 태그가 맞는 걸로 센다)"""
    if tag in AXIS.get(right, []):
        return 1
    if tag in AXIS.get(left, []):
        return -1
    return 0


# ---------------- 보고서 ----------------
def history_coverage(d):
    """출연 이력이 설문 배우를 얼마나 덮는지(집계). 사례는 (응답자, 가린 배우) 단위."""
    P1, top = d.pool1, d.pool1[:TOP]
    has = lambda js: int(sum(bool(d.hasH[j]) for j in js))
    tgt_has = sum(bool(d.hasH[h]) for _, h in d.cases)
    rest_has = sum(any(d.hasH[i] for i in d.rest(p, h)) for p, h in d.cases)
    both = sum(bool(d.hasH[h]) and any(d.hasH[i] for i in d.rest(p, h)) for p, h in d.cases)
    overlap = sum(bool(d.S5r[d.rest(p, h)][:, h].sum() > 0) for p, h in d.cases if d.hasH[h] and d.rest(p, h))  # 가린 배우가 나머지 중 누군가와 같은 (작품, 배역)을 가짐
    overlap_w = sum(bool(d.S5w[d.rest(p, h)][:, h].sum() > 0) for p, h in d.cases if d.hasH[h] and d.rest(p, h))
    with_role = [a for a, h in d.hist.items() if h["roles"]]
    return {"P1": (has(P1), len(P1)), "P2": (has(d.pool2), len(d.pool2)), "top": (has(top), len(top)),
            "mentions": (int(d.count[d.hasH].sum()), int(d.count.sum())), "cases": len(d.cases), "target": tgt_has, "rest": rest_has, "both": both,
            "overlap_r": overlap, "overlap_w": overlap_w, "actors": len(d.hist), "with_role": len(with_role),
            "roles_per": float(np.mean([len(d.hist[a]["roles"]) for a in with_role])) if with_role else 0.0,
            "works_per": float(np.mean([len(h["works"]) for h in d.hist.values()])) if d.hist else 0.0}


HIST_DOC = ROOT / "docs" / "ml_experiment_history_2026-10-10.md"
POOL_TITLES = {"P1": "풀 P1(이력 없는 배우는 점수 0으로 후보에 둠 = '0점' 처리)", "P2": "풀 P2(프로필 있는 배우만)", "P3": f"풀 P3(인기 상위 {TOP}명 제외)",
               "P4": "풀 P4(출연 이력이 있는 배우만 후보·정답 = '후보에서 뺌' 처리)"}


def write_history_report(d, out, table, path=HIST_DOC, src="data/actor_history_wiki_2026-10-10.tsv"):
    """같은 (작품, 배역)·같은 작품 경험 모델(M5r·M5w)과 하이브리드(M6) 보고서. 기존 모델(M0~M4)도 같은 표에 넣어 비교한다."""
    cv = history_coverage(d)
    pct = lambda a, b: f"{a}/{b}명({a / max(b, 1):.0%})"
    L = ["# 오프라인 ML 실험 2: 같은 작품·배역 경험으로 비슷한 배우를 고르면 맞히나 (2026-10-10)", "",
         "앱·data.js는 바꾸지 않은 오프라인 실험이다. 재현: `python3 ml_experiment.py --history " + src + "` (표준 라이브러리 + numpy). 설문 사용 열·평가 방식은 `ml_experiment_2026-10-10.md`와 같다(개인 정보 열은 읽지 않고 집계만).", "",
         "## 출연 이력 데이터와 커버리지", "",
         f"- 위키백과 출연 이력({src}): 설문 배우 중 이력이 있는 배우 {cv['actors']}명, 그중 (작품, 배역)이 하나라도 있는 배우 {cv['with_role']}명. 배우당 서로 다른 (작품, 배역) 평균 {cv['roles_per']:.1f}개, 작품 평균 {cv['works_per']:.1f}개(앙상블·단역 같은 일반 배역은 뺌).",
         f"- **P1 풀(3번 이상 언급) 중 이력 있는 배우 {pct(*cv['P1'])}**, P2(프로필 있는 배우) 중 {pct(*cv['P2'])}, 인기 상위 {TOP}명 중 {pct(*cv['top'])}. 설문 언급 전체 중 이력이 있는 배우의 비중 {cv['mentions'][0]}/{cv['mentions'][1]}건({cv['mentions'][0] / max(cv['mentions'][1], 1):.0%}).",
         f"- 평가 사례 {cv['cases']}건 중 가린 배우에게 이력이 있는 사례 {cv['target']}건({cv['target'] / max(cv['cases'], 1):.0%}), 나머지 배우 중 이력이 있는 사람이 있는 사례 {cv['rest']}건({cv['rest'] / max(cv['cases'], 1):.0%}), 둘 다 있는 사례 {cv['both']}건({cv['both'] / max(cv['cases'], 1):.0%}).",
         f"- 둘 다 있는 사례 중 가린 배우가 나머지 중 누군가와 같은 (작품, 배역)을 맡은 적이 있는 경우 {cv['overlap_r']}건, 같은 작품에 나온 적이 있는 경우 {cv['overlap_w']}건 → 이 겹침이 없으면 M5r·M5w 점수는 0이다.", "",
         "## 모델", "",
         "- **M5r** 같은 (작품, 배역) 경험: 두 배우의 (작품, 배역) 집합을 IDF 가중 cosine으로 견준다(흔한 배역은 가중이 낮고, 배역이 많은 배우가 유리하지 않게 정규화). 가린 배우가 아니라 응답자가 고른 *나머지 배우들*과의 유사도 합으로 후보를 줄 세운다.",
         "- **M5w** 같은 작품 출연(배역 무시): 같은 식, 키가 작품뿐.",
         "- **M6** M5r + M2c(협업 필터링): 안쪽 교차검증으로 고르는 z점수 가중합(지금 하이브리드와 같은 방식).",
         "- **이력 없는 배우 처리**: ①P1·P2·P3에서는 점수 0으로 후보에 남긴다(0점 처리). ②P4는 이력이 있는 배우만 후보·정답으로 둔다(후보에서 뺌). 두 처리 모두 같은 사례·같은 교차검증이고, 같은 풀에서 모든 모델(M0~M4 포함)을 견준다.", ""]
    for pool in table:
        t = table[pool]
        L += [f"## 결과 — {POOL_TITLES[pool]}", "", f"평가 사례 {t['cases']}건(응답자 {t['persons']}명). 값은 평균 [95% 구간].", "",
              "| 모델 | hit@5 | hit@10 | MRR | M0 대비 MRR 차이 | M2c 대비 MRR 차이 |", "|---|---|---|---|---|---|"]
        for n in out["models"]:
            row = t["rows"][n]
            vm = t["vs_m2c"].get(n)
            vs2 = f"{vm[0]:+.3f} [{vm[1]:+.3f}, {vm[2]:+.3f}] → **{'더 나음' if vm[1] > 0 else '더 못함' if vm[2] < 0 else '차이 없음'}**" if vm else "-"
            L.append(fmt_row(NAMES[n], row)[:-2] + f" | {vs2} |")
        L.append("")
    v = lambda pool, m: verdict(table[pool]["rows"][m])
    d2 = lambda pool, m: ("더 나음" if table[pool]["vs_m2c"][m][1] > 0 else "더 못함" if table[pool]["vs_m2c"][m][2] < 0 else "차이 없음") if m in table[pool]["vs_m2c"] else "-"
    pv = lambda m: " / ".join(f"{p} {v(p, m)}" for p in table)
    p2v = lambda m: " / ".join(f"{p} {d2(p, m)}" for p in table)
    ch = out["chosen"]
    avg = lambda ws: tuple(round(float(np.mean([w[i] for w in ws])), 2) for i in range(len(ws[0])))
    L += ["## 이력 없는 배우 처리 비교", "",
          "| 모델 | 0점 처리: P1 MRR (M0 대비) | 후보에서 뺌: P4 MRR (M0 대비) | 후보에서 뺌: P4 hit@5 | M0 P4 hit@5 |", "|---|---|---|---|---|"]
    for n in ("M0", "M2c", "M5r", "M5w", "M6"):
        r1, r4 = table["P1"]["rows"][n], table["P4"]["rows"][n]
        dm1 = f"{r1['d_mrr'][0]:+.3f}" if "d_mrr" in r1 else "-"
        dm4 = f"{r4['d_mrr'][0]:+.3f}" if "d_mrr" in r4 else "-"
        L.append(f"| {NAMES[n]} | {r1['mrr'][0]:.3f} ({dm1}) | {r4['mrr'][0]:.3f} ({dm4}) | {r4['hit5'][0]:.3f} | {table['P4']['rows']['M0']['hit5'][0]:.3f} |")
    L += ["", f"- M6 가중치 평균(M5r, M2c): " + " · ".join(f"{p} {avg(ch['w6'][p])}" for p in table), "",
          "## 해석", "",
          f"1. M0 인기순 대비(MRR 95% 구간, 풀 {'/'.join(table)}): M5r {pv('M5r')} · M5w {pv('M5w')} · M6 {pv('M6')} · (참고) M2c {pv('M2c')}.",
          f"2. M2c 협업 필터링 단독 대비: M5r {p2v('M5r')} · M5w {p2v('M5w')} · M6 {p2v('M6')}.",
          f"3. **신호 자체가 드물다**: P1 배우의 {cv['P1'][0] / max(cv['P1'][1], 1):.0%}만 이력이 있고, 사례의 {cv['both'] / max(cv['cases'], 1):.0%}만 가린 배우와 나머지 중 누군가가 모두 이력이 있다. 그중 같은 (작품, 배역)이 겹치는 사례는 전체의 {cv['overlap_r'] / max(cv['cases'], 1):.0%}({cv['overlap_r']}건), 같은 작품 겹침은 {cv['overlap_w'] / max(cv['cases'], 1):.0%}({cv['overlap_w']}건)뿐이라, 나머지 사례에서 M5r·M5w 점수는 0이다. 이력이 없는 배우는 0점 처리에서 점수가 0이라 순위가 인기와 무관하게 동점 처리된다(무작위 기대값).",
          f"4. **이력 없는 배우 처리**: M5r의 M0 대비 MRR 차이는 0점 처리(P1) {table['P1']['rows']['M5r']['d_mrr'][0]:+.3f}({v('P1', 'M5r')}) → 후보에서 뺌(P4) {table['P4']['rows']['M5r']['d_mrr'][0]:+.3f}({v('P4', 'M5r')}). " + (
              "후보에서 빼면 인기순을 이긴다 → 커버리지가 주된 한계다." if v("P4", "M5r") == "이김" else
              "후보에서 빼면 지는 것은 사라지지만 이기지는 못한다 → 커버리지 때문에 손해를 보는 부분은 있어도, 이력이 있는 배우끼리도 인기순보다 낫다고 말할 수 없다." if v("P1", "M5r") == "짐" and v("P4", "M5r") == "차이 없음" else
              "처리 방식을 바꿔도 결론이 같다 → 커버리지 때문만은 아니다."),
          f"5. **결론**: " + (
              "같은 작품·배역·작품 경험은 '같이 좋아한 배우'를 인기순보다 일관되게 맞히지 못하고(M5r/M5w가 M0을 이긴 풀: " + (", ".join(p for p in table if v(p, 'M5r') == '이김' or v(p, 'M5w') == '이김') or "없음") + "), 협업 필터링보다는 모든 풀에서 못하다. " if all(d2(p, "M5r") == "더 못함" for p in table) else
              "M5r이 일부 풀에서 협업 필터링과 견줄 만하다. ")
          + ("M6(M5r+M2c)은 M2c 단독보다 나은 풀이 없다(" + p2v("M6") + ") → 이력 신호는 협업 필터링 위에 보태지지 않는다. 앱에 순위·추천 신호로 넣을 근거는 이 데이터에는 없고, '같은 배역을 맡은 적 있는 배우' 같은 사실 정보 표시로만 쓰는 편이 안전하다." if not any(d2(p, "M6") == "더 나음" for p in table)
             else "M6이 M2c 단독보다 나은 풀이 있다(" + p2v("M6") + ") → 하이브리드로 쓸 여지가 있다."), "",
          "### 한계", "",
          "- 이력은 위키백과 기준이라 대극장·유명 배우에 편중되고, 같은 작품·배역을 맡았다는 사실이 '같이 좋아한다'를 만드는 것이 아니라 같은 제작에 노출된 사람이 같이 좋아하는 효과와 섞일 수 있다(M2c와 같은 한계).",
          "- 배우 이름이 설문 표기(활동명)와 같아야 매칭된다. 동명이인·본명 표기는 7c가 정리한 범위 밖이면 빠진다.",
          "- 표본(응답자 238명)·풀 정의·신뢰구간 방식은 첫 보고와 같다."]
    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    return "\n".join(L)


def history_compare_section(d, out, table, kinds):
    """본 실행(예: 뮤지컬만)에 덧붙이는 비교: 이력 구분을 바꿨을 때(예: 연극·콘서트 포함) 이력 모델 성적과 커버리지."""
    cv = history_coverage(d)
    L = ["", f"## 비교 실행: 이력 구분 {' + '.join(kinds)} 포함", "",
         f"- 커버리지: P1 중 이력 있는 배우 {cv['P1'][0]}/{cv['P1'][1]}명, P2 중 {cv['P2'][0]}/{cv['P2'][1]}명, 인기 상위 {TOP}명 중 {cv['top'][0]}/{cv['top'][1]}명. 둘 다 이력이 있는 사례 {cv['both']}건, 같은 (작품, 배역) 겹침 {cv['overlap_r']}건, 같은 작품 겹침 {cv['overlap_w']}건(사례 {cv['cases']}건 중).", "",
         "| 풀 | 모델 | MRR [95% 구간] | M0 대비 | M2c 대비 |", "|---|---|---|---|---|"]
    for pool in table:
        for n in ("M5r", "M5w", "M6"):
            r, vm = table[pool]["rows"][n], table[pool]["vs_m2c"][n]
            L.append(f"| {pool} | {NAMES[n]} | {r['mrr'][0]:.3f} [{r['mrr'][1]:.3f}, {r['mrr'][2]:.3f}] | {r['d_mrr'][0]:+.3f} [{r['d_mrr'][1]:+.3f}, {r['d_mrr'][2]:+.3f}] → **{verdict(r)}** | {vm[0]:+.3f} [{vm[1]:+.3f}, {vm[2]:+.3f}] → **{'더 나음' if vm[1] > 0 else '더 못함' if vm[2] < 0 else '차이 없음'}** |")
    return L


def dup_persons(d):
    """2명 이상 적은 응답자 중 완전히 같은 목록을 낸 응답자 수(교차검증에서 훈련·평가로 갈리면 CF가 부풀 수 있어 확인)."""
    c = Counter(tuple(d.F[p]) for p in d.elig)
    return sum(n for n in c.values() if n > 1)


def f3(x):
    return f"{x:.3f}"


def fmt_row(name, row):
    parts = []
    for key in ("hit5", "hit10", "mrr"):
        m, lo, hi = row[key]
        parts.append(f"{f3(m)} [{f3(lo)}, {f3(hi)}]")
    vs = "-"
    if "d_mrr" in row:
        dm = row["d_mrr"]
        vs = f"{dm[0]:+.3f} [{dm[1]:+.3f}, {dm[2]:+.3f}] p={dm[3]:.3f} → **{verdict(row)}**"
    return f"| {name} | " + " | ".join(parts) + f" | {vs} |"


NAMES = {"M0": "M0 인기순", "M1": "M1 지금 규칙(특성 유사도)", "M1v": "M1v 목소리 특성만", "M2c": "M2c 협업 필터링(cosine)", "M2p": "M2p 협업 필터링(PMI)",
         "M3": "M3 축 답×배우 태그 회귀", "M3p": "M3p M3 + 인기", "M4a": "M4a 하이브리드 M1+M2+M3", "M4b": "M4b 하이브리드 + 인기",
         "M5r": "M5r 같은 작품·배역 경험", "M5w": "M5w 같은 작품 출연", "M6": "M6 하이브리드 M5r+M2c"}


def write_report(d, out, table, lw, lam, path=OUT):
    prof_p1 = int(d.profiled[d.pool1].sum())
    L = ["# 오프라인 ML 실험: 좋아하는 배우 추천을 규칙 대신 데이터로? (2026-10-10)", "",
         "앱·data.js는 바꾸지 않은 오프라인 실험이다. 재현: `python3 ml_experiment.py` (표준 라이브러리 + numpy).", "",
         "## 데이터와 방법", "",
         f"- 설문 1차 응답자 {len(d.F)}명 중 좋아하는 배우를 적은 사람 {len(d.persons)}명, 2명 이상 {len(d.elig)}명, 언급 {int(d.count.sum())}건, 서로 다른 배우 {len(d.actors)}명.",
         f"- 완전히 같은 배우 목록을 낸 응답자는 {dup_persons(d)}명뿐이라 교차검증에서 같은 목록이 훈련·평가로 갈려 성능이 부풀 영향은 거의 없다.",
         "- 쓴 열: 19번(좋아하는 배우 자유 글)과 21~25번(취향 5축). 나이·성별 같은 개인 정보 열은 읽지 않았고, 아래는 전부 집계다.",
         f"- 이름 정리: 쉼표·슬래시·점·공백으로 나누고 끝의 배우님·님·씨·등을 떼서 한글 2~4자만 남김, '없습니다·없음' 등은 버림(띄어쓰기 없이 붙여 쓴 이름은 못 가른다).",
         f"- 풀: **P1** = 3번 이상 언급된 배우 {len(d.pool1)}명(그중 프로필 있는 배우 {prof_p1}명), **P2** = P1 중 프로필(actorProfiles) 있는 배우 {len(d.pool2)}명. 풀 크기가 작아서 무작위로 맞힐 확률도 높다: hit@5 무작위 ≈ {min(5 / max(len(d.pool1) - 3, 1), 1):.2f}(P1) / {min(5 / max(len(d.pool2) - 3, 1), 1):.2f}(P2), hit@10 ≈ {min(10 / max(len(d.pool1) - 3, 1), 1):.2f} / {min(10 / max(len(d.pool2) - 3, 1), 1):.2f}.",
         "- 평가: 좋아하는 배우가 2명 이상인 응답자마다 한 명을 가리고(leave-one-out) 나머지로 가린 배우의 순위를 본다. 이미 적은 나머지 배우는 후보에서 뺀다. 동점은 무작위 순서의 기대값.",
         "- 교차검증: 응답자 단위 5겹 × 3번 반복. 훈련 통계(인기·동시 등장·회귀)는 훈련 응답자만으로 만들어 가린 사람은 훈련에 없다. 하이브리드의 가중치·회귀 규제(람다)·M2 변형은 바깥 훈련 안쪽 4겹으로 고른다. (풀 정의는 전체 언급 수 기준이라 약간 낙관적이다.)",
         "- 신뢰구간·p: 응답자 단위 부트스트랩 2,000번(한 사람의 사례가 여럿이라 사례 단위로 재면 구간이 좁게 나온다). '이김'은 M0 대비 MRR 차이의 95% 구간이 0보다 큰 경우.", ""]
    for pool, title in (("P1", "풀 P1: 3번 이상 언급된 배우 전체"), ("P2", "풀 P2: 그중 프로필 있는 배우만"), ("P3", f"풀 P3(덧붙임): P1에서 가장 많이 언급된 {TOP}명을 후보·정답에서 뺀 풀 — 인기 배우 말고도 맞히나")):
        t = table[pool]
        L += [f"## 결과 — {title}", "", f"평가 사례 {t['cases']}건(응답자 {t['persons']}명). 값은 평균 [95% 구간].", "",
              "| 모델 | hit@5 | hit@10 | MRR | M0 대비 MRR 차이 |", "|---|---|---|---|---|"]
        L += [fmt_row(NAMES[n], t["rows"][n]) for n in MODELS]
        L.append("")
        for key, lab in (("hit5", "hit@5"), ("hit10", "hit@10")):
            win = [NAMES[n] for n in MODELS if n != "M0" and t["rows"][n]["d_" + key][1] > 0]
            L.append(f"- {lab}에서 M0을 이긴 모델(95% 구간이 0보다 위): {', '.join(win) or '없음'}")
        L.append("- M2c(협업 필터링 cosine) 단독 대비 MRR 차이: " + " · ".join(
            f"{n} {t['vs_m2c'][n][0]:+.3f} [{t['vs_m2c'][n][1]:+.3f}, {t['vs_m2c'][n][2]:+.3f}] {'(더 나음)' if t['vs_m2c'][n][1] > 0 else '(더 못함)' if t['vs_m2c'][n][2] < 0 else '(차이 없음)'}" for n in ("M4a", "M4b", "M2p", "M3p")))
        L.append("")
    ch = out["chosen"]
    avg = lambda ws: tuple(round(float(np.mean([w[i] for w in ws])), 2) for i in range(len(ws[0])))
    L += ["## 안쪽 교차검증이 고른 값", "",
          f"- M3 규제(람다): {dict(Counter(ch['lam']))} · M2 변형: {dict(Counter(ch['m2']))}",
          f"- 하이브리드 가중치 평균(P1) 4a (M1, M2, M3) = {avg(ch['w4a']['P1'])}, 4b (M0, M1, M2, M3) = {avg(ch['w4b']['P1'])}",
          f"- 하이브리드 가중치 평균(P2) 4a = {avg(ch['w4a']['P2'])}, 4b = {avg(ch['w4b']['P2'])}",
          f"- 하이브리드 가중치 평균(P3) 4a = {avg(ch['w4a']['P3'])}, 4b = {avg(ch['w4b']['P3'])}", ""]
    w, inter, main = lw
    L += ["## M3이 배운 가중치", "",
          f"전체 응답자 {len(d.persons)}명으로 맞춘 로지스틱 회귀(람다 {lam}). 축 답은 −1~+1(음수 = 왼쪽 키). 상호작용 가중치 > 0 은 '그 축에서 오른쪽을 고른 사람이 그 태그를 가진 배우를 더 좋아한다'. 안정 = 응답자 부트스트랩 60번에서 부호가 같은 비율. 규칙 = 앱 규칙이 기대하는 방향(+/−/0).", "",
          "| 축 (왼쪽 ↔ 오른쪽) | 태그 | 가중치 | 안정 | 규칙 |", "|---|---|---|---|---|"]
    top = sorted(inter, key=lambda r: -abs(r[3]))[:14]
    for left, right, tag, wt, st, ex in top:
        L.append(f"| {left} ↔ {right} | {tag} | {wt:+.2f} | {st:.2f} | {ex:+d} |")
    known = [r for r in inter if r[5] != 0]
    agree = sum(np.sign(r[3]) == r[5] for r in known)
    stable_known = [r for r in known if r[4] >= 0.9]
    agree_st = sum(np.sign(r[3]) == r[5] for r in stable_known)
    off = sorted([r for r in stable_known if np.sign(r[3]) != r[5]], key=lambda r: -abs(r[3]))
    L += ["", f"- 앱 규칙이 방향을 말하는 (축, 태그) {len(known)}칸 중 학습한 부호가 같은 칸 {int(agree)}개({agree / max(len(known), 1):.0%}). 부호가 안정적인(≥0.9) {len(stable_known)}칸만 보면 {int(agree_st)}개가 같다.",
          "- 부호가 안정적인데 규칙과 반대인 칸(규칙을 다시 볼 후보): " + (", ".join(f"{r[0]}↔{r[1]} × {r[2]} {r[3]:+.2f}(규칙 {r[5]:+d})" for r in off[:8]) or "없음"),
          f"- 가중치가 0이 아닌 상호작용 중 부호가 안정적(≥0.9)인 칸 {sum(r[4] >= 0.9 for r in inter)}/{len(inter)}개.", "",
          "태그 주효과(그 태그를 가진 배우가 응답과 무관하게 얼마나 더 좋아지나, 상위·하위):", ""]
    ms = sorted(main, key=lambda r: -r[1])
    L += ["| 태그 | 가중치 | 안정 |", "|---|---|---|"] + [f"| {t} | {wt:+.2f} | {s:.2f} |" for t, wt, s in ms[:5] + ms[-3:]]
    L += recommendation(table, lw, d)
    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    return "\n".join(L)


def recommendation(table, lw, d):
    """결과 표에서 읽은 해석과 앱 적용 권고. 판정 문구는 표에서 가져오고, 이유는 이 실험의 구조에서 나온 것이다(데이터가 바뀌면 다시 읽을 것)."""
    v = lambda pool, m: verdict(table[pool]["rows"][m])
    pv = lambda m: " / ".join(f"{p} {v(p, m)}" for p in ("P1", "P2", "P3"))
    inter = lw[1]
    known = [r for r in inter if r[5] != 0]
    agree = sum(np.sign(r[3]) == r[5] for r in known)
    st_known = [r for r in known if r[4] >= 0.9]
    st_off = sorted([r for r in st_known if np.sign(r[3]) != r[5]], key=lambda r: -abs(r[3]))
    m4a_better = [p for p in ("P1", "P2", "P3") if table[p]["vs_m2c"]["M4a"][1] > 0]
    m4_vs = lambda m: " / ".join(f"{p} {'더 나음' if table[p]['vs_m2c'][m][1] > 0 else '더 못함' if table[p]['vs_m2c'][m][2] < 0 else '차이 없음'}" for p in ("P1", "P2", "P3"))
    return ["", "## 해석과 앱 적용 권고", "",
            "**한 줄 결론: 규칙을 ML로 통째로 바꿀 이유는 없고, '같이 좋아하는 배우'(협업 필터링)를 별도 신호로 더하는 건 근거가 있다. 특성 신호(M1·M3)는 혼자서는 인기순을 못 이기지만 협업 필터링 위에 얹으면 조금 보탠다(M4a). 다만 설문이 작고 협업 필터링의 정체가 취향 유사성이 아니라 함께 본 작품(노출)일 수 있어서, 앱에 넣으려면 조건이 붙는다.**", "",
            f"1. **M0 인기순을 이긴 모델** (MRR 기준, 풀 P1 / P2 / P3): M2c {pv('M2c')} · M2p {pv('M2p')} · M4a {pv('M4a')} · M4b {pv('M4b')}. M1(지금 규칙) {pv('M1')}, M1v(목소리만) {pv('M1v')}, M3(축×태그 회귀) {pv('M3')}, M3p(+인기) {pv('M3p')}.",
            f"2. **협업 필터링(M2)이 핵심 신호다.** 인기 상위 {TOP}명을 뺀 풀 P3은 인기순이 거의 못 맞히는데(M0 hit@5 {table['P3']['rows']['M0']['hit5'][0]:.2f}) M2c는 hit@5 {table['P3']['rows']['M2c']['hit5'][0]:.2f}로 {v('P3', 'M2c')}이다 → " + ("단순 인기 때문만은 아니다." if v("P3", "M2c") == "이김" else "인기를 넘어서는지는 확인되지 않았다.")
            + f" 하이브리드가 M2c 단독보다 나은지(MRR 차이 구간, P1 / P2 / P3): M4a {m4_vs('M4a')}, M4b {m4_vs('M4b')}. " + (f"M4a가 {', '.join(m4a_better)}에서 더 나아서 특성 신호가 협업 필터링 위에 작게 보태진다(P3에서는 차이 없음 → 인기 밖 배우에게는 아직 못 보탠다). 다만 M4b(인기 포함)는 M2c와 구간 안에서 차이가 없다." if m4a_better else "더 나은 곳이 없으니 하이브리드는 복잡도만 늘린다."),
            f"3. **지금 규칙(M1: 프로필 특성 유사도)은 '같이 좋아할 배우'를 인기순보다 잘 맞히지 못한다**(M1 {pv('M1')}, 목소리만 M1v {pv('M1v')}). 이 실험은 '좋아하는 배우 목록이 서로 닮았나'를 보는 것이고, 앱의 '닮은 특성의 배우' 목록은 점수·순위를 안 매기는 후보 안내라서 곧바로 틀렸다는 뜻은 아니다. 다만 프로필이 있는 배우는 풀 P1 {len(d.pool1)}명 중 {len(d.pool2)}명뿐이고 배우당 서로 다른 태그가 평균 {sum(len(d.tag_list_from(j)) for j in d.pool2) / max(len(d.pool2), 1):.1f}개라 특성 유사도의 변별력이 약하다. '닮았다'를 예측력이 있는 것처럼 말하지 않는 게 안전하다.",
            f"4. **축 답→배우 태그 회귀(M3)가 인기 위에 더하는 것**: M3 {pv('M3')}, M3p(+인기) {pv('M3p')}. 학습한 부호는 앱 규칙이 방향을 말하는 {len(known)}칸 중 {int(agree)}칸({agree / max(len(known), 1):.0%})에서 규칙과 같고, 부호가 안정적인 {len(st_known)}칸만 보면 {len(st_known) - len(st_off)}칸이 같다. 규칙과 반대로 안정적인 칸: " + (", ".join(f"{r[0]}↔{r[1]} × {r[2]}({r[3]:+.2f})" for r in st_off) or "없음") + ". 대체로 규칙의 방향을 지지하지만 반대인 칸은 규칙의 태그 연결(특히 '연기 중심' 쪽에 묶은 태그)을 다시 볼 후보다. '축 취향→태그' 규칙을 ML로 대체할 근거는 이 데이터에 없다.",
            "5. **앱에 넣는다면 (권고)** — ①이름은 '이 배우를 좋아한 사람들이 같이 좋아한 배우'처럼 *공동 선호* 라벨로 따로 보여 주고, '닮은 특성'과 섞지 않는다. ②응답 원본은 data.js에 넣지 않고, 배우 쌍 집계(둘을 함께 적은 응답자가 최소 3명인 쌍만, 배우당 이웃 5명 이내)만 내보낸다. ③후보 풀이 3번 이상 언급된 배우 몇십~백여 명뿐이라 적용 범위가 좁다. ④설문(238명)이 늘거나 2차 설문(data/survey/survey2_*)으로 다시 평가한다. ⑤점수·순위·'%'는 쓰지 않는다(지금 앱 원칙 그대로).",
            "", "### 이 실험의 한계", "",
            "- 정답 = 설문에서 '좋아한다고 적은 배우'. 실제 관람 만족·재관람 같은 결과가 아니고, 취향이 맞아서 같이 적었는지 같은 작품을 봐서 같이 적었는지는 가를 수 없다(협업 필터링이 강한 이유일 수 있다).",
            "- 응답자 238명(2명 이상 197명) 표본이라 구간이 넓고, 풀 정의(3번 이상 언급)는 전체 응답 기준이라 약간 낙관적이다. 사례 하나하나가 독립이 아니라서 응답자 단위 부트스트랩으로 구간을 냈다.",
            "- 이름 파싱이 단순해서(띄어쓰기 없이 붙여 쓴 이름은 버림, 별명·성만 쓴 응답 못 잡음) 일부 응답이 빠졌다. 프로필(actorProfiles)은 배우당 태그가 적고 49명뿐이라 M1·M3에 불리하다.",
            "- 추천 목록의 후보는 '지금 하는 공연에 나오는 배우'로 제한되지만 이 평가는 풀 전체에서 순위를 본다. 실서비스 효과(클릭·예매)는 이 실험으로 알 수 없다."]


# ---------------- 가짜 설문(selftest) ----------------
def synth(n_persons=120, seed=1):
    """두 취향 군집: 군집 A(맑음 배우 0~9, 축 '맑은 음색 ↔ 묵직한 음색'에서 왼쪽), 군집 B(허스키 배우 10~19, 오른쪽). 사람마다 자기 군집에서 3~6명을 고른다."""
    rng = random.Random(seed)
    actors = [f"배우{chr(65 + i)}" for i in range(20)]
    favs, X = [], []
    for p in range(n_persons):
        grp = p % 2
        pool = actors[:10] if grp == 0 else actors[10:]
        w = [3 if i == 0 else 1 for i in range(10)]  # 군집 안에서 첫 배우가 더 인기
        pick = set()
        while len(pick) < rng.randint(3, 6):
            pick.add(rng.choices(pool, weights=w)[0])
        favs.append(sorted(pick))
        row = [0.0] * 5
        row[2] = -2.0 if grp == 0 else 2.0  # 맑은 음색(왼쪽) ↔ 허스키(오른쪽)
        X.append(row)
    profiles = {a: {"voice": [{"tag": "맑음" if i < 10 else "허스키"}], "role": []} for i, a in enumerate(actors)}
    return favs, np.array(X), profiles


def synth_history(actors):
    """가짜 출연 이력(synth 군집과 맞춤): 군집 A(0~9번 배우)는 같은 작품a·작품b 배역을 나눠 맡고, 군집 B(10~17)는 작품c·작품d. 18·19번은 이력 없음. 0번 배우는 잡작품 30개를 더 가진 '이력 많은 배우'."""
    h = {}
    for i, a in enumerate(actors[:10]):
        h[a] = {"roles": {("작품a", f"역{i % 5}"), ("작품b", "역x")}, "works": {"작품a", "작품b"}}
    for i, a in enumerate(actors[10:18], start=10):
        h[a] = {"roles": {("작품c", f"역{i % 4}"), ("작품d", "역y")}, "works": {"작품c", "작품d"}}
    h[actors[0]]["roles"] |= {(f"잡작품{k}", "역") for k in range(30)}
    h[actors[0]]["works"] |= {f"잡작품{k}" for k in range(30)}
    return h


def selftest_history():
    import tempfile
    # 정규화: 괄호·'뮤지컬'·꺾쇠·공백 제거, 배역은 괄호 설명·끝의 '역' 제거, 쉼표·슬래시로 나눔, 앙상블·단역은 버림
    assert norm_work("뮤지컬 〈엘리자벳〉 (2012)") == "엘리자벳" and norm_work(" 렛미플라이 (Let Me Fly) ") == "렛미플라이" and norm_work("DEAR EVAN HANSEN") == "dearevanhansen"
    # 괄호 짝이 안 맞는 위키 값: 여는 괄호만 있으면 앞부분만, 닫는 괄호만 있으면 ') - 배역' 뒤를, 슬래시 앞뒤 공백·날짜 찌꺼기 처리
    assert norm_roles("L(엘") == ["L"] and norm_roles("에릭(팬텀") == ["에릭"] and norm_roles("앙리 뒤프레/ 괴물") == ["앙리뒤프레", "괴물"] and norm_roles("앙리 뒤프레 /괴물 ") == ["앙리뒤프레", "괴물"]
    assert norm_roles(".01.23 ~ .02.23 예술마당 4관) - Randy, Chad") == ["Randy", "Chad"] and norm_roles("고양) - 한영범") == ["한영범"] and norm_roles("10주년 ... 그(리차드") == [] and norm_roles("몬테크리스토백작(에드몬드 단테스)") == ["몬테크리스토백작"]
    assert norm_work("레미제라블 (2012년 공연") == "레미제라블" and norm_work("오페라의 유령(The Phantom") == "오페라의유령"
    assert norm_roles("엘리자벳 역 (더블)") == ["엘리자벳"] and norm_roles("토드 / 루케니, 앙상블") == ["토드", "루케니"] and norm_roles("단역") == [] and norm_roles("") == [] and norm_roles("역") == []
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "hist.tsv"
        f.write_text("\n".join("\t".join(r) for r in [
            ["배우", "연도", "작품", "배역", "구분(뮤지컬/연극)", "위키 문서 제목", "비고"],
            ["김 가", "2012", "뮤지컬 〈엘리자벳〉", "엘리자벳 역", "뮤지컬", "문서1", ""], ["김가", "2015", "엘리자벳", "엘리자벳", "뮤지컬", "문서1", "재연"], ["김가", "2018", "햄릿", "오필리어/거트루드", "연극", "문서2", ""],
            ["나다", "2020", "시카고", "앙상블", "뮤지컬", "문서3", ""], ["나다", "2021", "", "토드", "뮤지컬", "문서3", ""], ["라마", "2019", "오페라", "역할", "오페라", "문서4", ""]]) + "\n", encoding="utf-8")
        h = load_history(f)
        flagged = Path(td) / "flag.tsv"  # 비고 '동명이인 미확인' 행은 빼고, 그 행만 있는 배우는 이력이 없다
        flagged.write_text("\n".join("\t".join(r) for r in [["배우", "연도", "작품", "배역", "구분", "위키 문서 제목", "비고"], ["다라", "2020", "시카고", "록시", "뮤지컬", "문서", "동명이인 미확인(확인 필요)"], ["다라", "2021", "렛미플라이", "미래", "뮤지컬", "문서", ""],
                                                              ["마바", "2020", "시카고", "벨마", "뮤지컬", "문서", "동명이인 미확인"]]) + "\n", encoding="utf-8")
        hf = load_history(flagged)
        assert hf == {"다라": {"roles": {("렛미플라이", "미래")}, "works": {"렛미플라이"}}} and set(load_history(flagged, skip_note=None)) == {"다라", "마바"}, hf
        assert h["김가"]["roles"] == {("엘리자벳", "엘리자벳"), ("햄릿", "오필리어"), ("햄릿", "거트루드")} and h["김가"]["works"] == {"엘리자벳", "햄릿"}, h["김가"]
        assert h["나다"] == {"roles": set(), "works": {"시카고"}}, "일반 배역만 있으면 작품만 센다, 작품명이 빈 행은 버린다"
        assert "라마" not in h and "라마" not in load_history(f, ("뮤지컬",)) and set(load_history(f, ("뮤지컬",))["김가"]["works"]) == {"엘리자벳"}, "구분 필터"
    # IDF cosine: 대칭·대각 0·같은 집합은 1, 키가 많은 배우가 유리하지 않고, 드문 키가 흔한 키보다 크게 기여, 이력 없는 배우는 0
    sets = {"A": {"k1", "k2"}, "B": {"k1"}, "C": {"k1", "k2"} | {f"x{i}" for i in range(8)}, "D": {"k1", "k2"}, "P": {"rare", "common"}, "Q": {"rare"}, "R": {"common"}, "S1": {"common"}, "S2": {"common"}, "S3": {"common"}}
    names = ["A", "B", "C", "D", "P", "Q", "R", "Z"]
    S = idf_cosine(sets, names)
    ix = {n: i for i, n in enumerate(names)}
    assert np.allclose(S, S.T) and np.allclose(np.diag(S), 0) and S[ix["Z"]].sum() == 0 and S[:, ix["Z"]].sum() == 0
    assert abs(S[ix["A"], ix["D"]] - 1.0) < 1e-9, "같은 집합이면 1"
    assert S[ix["A"], ix["B"]] > S[ix["C"], ix["B"]], "같은 키 하나를 공유해도 키가 훨씬 많은 배우는 덜 비슷하다(정규화)"
    assert S[ix["P"], ix["Q"]] > S[ix["P"], ix["R"]], "드문 키(rare)를 공유한 쪽이 흔한 키(common)를 공유한 쪽보다 비슷하다"
    # 가짜 설문 + 가짜 이력 전체 흐름
    favs, X, prof = synth()
    actors = sorted({a for f in favs for a in f})
    hist = synth_history(actors)
    d = Data(favs, X, prof, hist=hist)
    assert d.has_hist and len(d.pool4) == 18 and len(d.pool1) == 20 and np.allclose(d.S5r[d.ix[actors[18]]], 0) and d.S5r[d.ix[actors[0]], d.ix[actors[5]]] > 0, "이력 없는 배우 행은 0"
    # 이력이 많은 배우(0번, 잡작품 30개)는 유리하지 않다: 5번과 같은 (작품, 배역) 둘을 공유해도 정확히 같은 집합인 3번↔8번(=1)보다 낮다
    s05, s38 = d.S5r[d.ix[actors[0]], d.ix[actors[5]]], d.S5r[d.ix[actors[3]], d.ix[actors[8]]]
    assert 0 < s05 < 0.5 and abs(s38 - 1.0) < 1e-9, (s05, s38)
    cv = history_coverage(d)
    assert cv["P1"] == (18, 20) and cv["actors"] == 18 and cv["with_role"] == 18 and cv["cases"] == len(d.cases) and 0 < cv["both"] <= cv["cases"] and cv["overlap_w"] >= cv["overlap_r"] > 0, cv
    out = run_experiment(d, K=4, repeats=1, seed=0, inner=3, lams=(3.0, 30.0))
    assert set(out["ok"]) == {"P1", "P2", "P3", "P4"} and out["models"] == MODELS + HIST_MODELS
    table = summarize(d, out, B=300)
    mrr = {m: table["P1"]["rows"][m]["mrr"][0] for m in out["models"]}
    assert mrr["M5r"] > mrr["M0"] + 0.1 and mrr["M5w"] > mrr["M0"] + 0.1 and mrr["M6"] > mrr["M0"], mrr
    assert verdict(table["P1"]["rows"]["M5r"]) == "이김" and table["P4"]["cases"] < table["P1"]["cases"], "P4 는 이력 없는 배우가 정답인 사례를 뺀다"
    assert set(table["P4"]["vs_m2c"]) >= {"M5r", "M5w", "M6"}
    # 이력 없는 배우: 0점 처리(P1)에서 이력 없는 배우가 정답이면 M5r 점수가 전부 0이라 동점 처리(무작위 기대값), 후보에서 빼면(P4) 그런 사례가 없다
    nh = d.ix[actors[18]]
    cases_nh = [(p, h) for p, h in d.cases if h == nh]
    assert cases_nh and d.S5r[:, nh].sum() == 0 and d.S5w[:, nh].sum() == 0, "이력 없는 배우는 어떤 나머지 배우와도 유사도 0"
    assert all(h != nh for _, h in [(p, h) for p, h in d.cases if d.hasH[h]]), "P4 사례의 정답은 이력이 있다"
    # 보고서 작성
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "hist.md"
        txt = write_history_report(d, out, table, path=path, src="가짜.tsv")
        assert path.exists() and "M5r 같은 작품·배역 경험" in txt and "후보에서 뺌" in txt and "P4" in txt and "이력 없는 배우 처리 비교" in txt
    print("history selftest ok")


def selftest():
    # 파싱: 공백·쉼표·슬래시, 배우님·등, 괄호, 없음, 한글 2~4자만
    assert parse_favs("박강현 배우님, 전동석/카이 등") == ["박강현", "전동석", "카이"]
    assert parse_favs("없습니다") == [] and parse_favs("") == [] and parse_favs("홍광호(엘리자벳) 홍광호 린아님") == ["홍광호", "린아"]
    assert parse_favs("박은태박강현조성윤 김준수.") == ["김준수"], "붙여 쓴 긴 덩어리는 못 가르니 버린다"
    # 동점 지표: 정답이 단독 1등이면 1, 5명 동점이 전부 상위 5 안이면 hit@5=1, 10명 동점이면 hit@5=0.5
    assert tie_metrics(0, 1) == [1.0, 1.0, 1.0] and tie_metrics(0, 5)[0] == 1.0 and abs(tie_metrics(0, 10)[0] - 0.5) < 1e-9 and tie_metrics(20, 1)[:2] == [0.0, 0.0]
    assert abs(tie_metrics(1, 2)[2] - (1 / 2 + 1 / 3) / 2) < 1e-9
    s = np.array([[3.0, 2.0, 2.0, 1.0]]); v = np.array([[True] * 4])
    assert rank_counts(s, v, np.array([1]))[0][0] == 1 and rank_counts(s, v, np.array([1]))[1][0] == 2, "동점은 정답 포함 2개"
    assert rank_counts(s, np.array([[True, True, True, False]]), np.array([2]))[0][0] == 1, "마스크 밖 후보는 안 센다"
    # 부트스트랩: 구간이 평균을 품고, 같은 값이면 차이 0
    ps, pn = np.array([1.0, 0.0, 1.0, 1.0, 0.0, 1.0]), np.ones(6)
    m, ci = boot_ci(ps, pn, 500)
    assert abs(m - 4 / 6) < 1e-9 and ci[0] <= m <= ci[1]
    dd, dci, p = boot_diff(ps, ps, pn, 500)
    assert dd == 0 and dci[0] <= 0 <= dci[1]
    # 로지스틱: 심은 가중치 부호를 되찾는다
    rng = np.random.default_rng(0)
    Xd = np.c_[np.ones(4000), rng.normal(size=(4000, 3))]
    wt = np.array([-1.0, 1.5, -2.0, 0.0])
    y = (rng.random(4000) < 1 / (1 + np.exp(-(Xd @ wt)))).astype(float)
    w = fit_logreg(Xd, y, 1.0, np.array([0, 1, 1, 1.0]))
    assert np.sign(w[1]) == 1 and np.sign(w[2]) == -1 and abs(w[3]) < 0.3 and abs(w[1] - 1.5) < 0.3, w
    # 특성·유사도(앱 similarTo): 같은 쪽 목소리 겹침, 반대쪽만이면 out, 양쪽을 가지면 out 아님
    clear = traits_of({"voice": [{"tag": "맑음"}], "role": []}); husky = traits_of({"voice": [{"tag": "허스키"}], "role": []}); both = traits_of({"voice": [{"tag": "맑음"}, {"tag": "허스키"}], "role": []})
    soft = traits_of({"voice": [{"tag": "부드러움"}], "role": [{"tag": "코믹 연기"}]})
    assert similar_to(clear, soft) == 1 and similar_to(clear, husky) == -1 and similar_to(clear, both) == 1 and similar_to(both, husky) == 1
    assert similar_to(merge_traits([clear, traits_of({"voice": [], "role": [{"tag": "코믹 연기"}]})]), soft) == 2 and similar_to(merge_traits([clear, traits_of({"voice": [], "role": [{"tag": "코믹 연기"}]})]), soft, True) == 1
    assert len(simplex(3)) == 15 and all(abs(sum(w) - 1) < 1e-9 for w in simplex(4)) and len(simplex(4)) == 35
    # 가짜 설문 전체 흐름: 군집 구조가 있으니 M0 보다 M2·M3·M1·하이브리드가 나아야 하고, M3 가중치는 심은 방향
    favs, X, prof = synth()
    d = Data(favs, X, prof, min_mention=3)
    assert len(d.pool1) == 20 and len(d.pool2) == 20 and len(d.elig) == len(favs)
    out = run_experiment(d, K=4, repeats=1, seed=0, inner=3, lams=(3.0, 30.0))
    table = summarize(d, out, B=300)
    mrr = {m: table["P1"]["rows"][m]["mrr"][0] for m in MODELS}
    assert mrr["M2c"] > mrr["M0"] + 0.1 and mrr["M2p"] > mrr["M0"] + 0.1 and mrr["M1"] > mrr["M0"] and mrr["M3"] > mrr["M0"] and mrr["M4a"] > mrr["M0"], mrr
    assert verdict(table["P1"]["rows"]["M2c"]) == "이김" and verdict(table["P1"]["rows"]["M0"]) == "-", table["P1"]["rows"]["M2c"].get("d_mrr")
    assert table["P1"]["cases"] == len(d.cases) and table["P2"]["cases"] == len(d.cases) and 0 < table["P3"]["cases"] < len(d.cases), "P3 은 인기 상위 10명이 정답인 사례를 뺀다"
    assert all(set(table[p]["rows"]) == set(MODELS) for p in POOLS)
    w, inter, main = learned_weights(d, 30.0, boots=10)
    pick = {(left, tag): wt for left, right, tag, wt, st, ex in inter if left == "맑은 음색"}
    assert pick[("맑은 음색", "허스키")] > 0 > pick[("맑은 음색", "맑음")], "오른쪽(묵직·허스키)을 고른 사람이 허스키 배우를 더 좋아한다"
    assert expected_sign("맑은 음색", "묵직한 음색", "허스키") == 1 and expected_sign("맑은 음색", "묵직한 음색", "맑음") == -1 and expected_sign("가창", "연기", "성량") == -1 and expected_sign("가창", "연기", "코믹 연기") == 1 and expected_sign("맑은 음색", "묵직한 음색", "코믹 연기") == 0
    # 가린 사람은 훈련에 없다: 훈련 응답자 목록에서 가린 응답자를 뺀 모델의 인기 합은 전체보다 적다
    m_all = Models(d, d.persons, fit_m3=False); m_part = Models(d, d.persons[1:], fit_m3=False)
    assert m_all.n0.sum() - m_part.n0.sum() == len(d.F[d.persons[0]])
    selftest_history()
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--history", metavar="TSV", help="위키 출연 이력 TSV(열: 배우|연도|작품|배역|구분|위키 문서 제목|비고). 주면 M5r·M5w·M6·풀 P4 를 더해 docs/ml_experiment_history_2026-10-10.md 를 쓴다")
    ap.add_argument("--kinds", nargs="*", default=["뮤지컬"], help="이력에서 쓸 구분(기본: 뮤지컬만. 연극·콘서트까지 넣으면 비교용: --kinds 뮤지컬 연극 콘서트)")
    ap.add_argument("--compare-kinds", nargs="*", metavar="KIND", help="--history 본 실행 뒤에 이 구분들로 이력을 다시 만들어 한 번 더 돌리고, 결과를 같은 문서 끝에 비교 절로 덧붙인다(예: --compare-kinds 뮤지컬 연극 콘서트)")
    ap.add_argument("--out", metavar="PATH", help="보고서 경로(기본: 첫 보고 docs/ml_experiment_2026-10-10.md, --history 면 docs/ml_experiment_history_2026-10-10.md). 시험 실행이 문서를 덮어쓰지 않게")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        return
    favs, X = load_survey()
    profiles = load_actor_profiles()
    hist = load_history(a.history, tuple(a.kinds)) if a.history else None
    d = Data(favs, X, profiles, hist=hist)
    print(f"응답자 {len(favs)}명 · 배우 적은 사람 {len(d.persons)} · 2명 이상 {len(d.elig)} · 언급 {int(d.count.sum())} · 배우 {len(d.actors)}명 · 풀 P1 {len(d.pool1)}명 (프로필 {int(d.profiled[d.pool1].sum())}) · P2 {len(d.pool2)}명 · 사례 {len(d.cases)}건")
    out = run_experiment(d, K=a.folds, repeats=a.repeats, log=print)
    table = summarize(d, out, B=a.boot)
    target = Path(a.out) if a.out else (HIST_DOC if hist is not None else OUT)
    if hist is not None:
        write_history_report(d, out, table, path=target, src=a.history)
    else:
        lam = Counter(out["chosen"]["lam"]).most_common(1)[0][0]
        write_report(d, out, table, learned_weights(d, lam), lam, path=target)
    for pool in table:
        t = table[pool]
        print(f"\n[{pool}] 사례 {t['cases']}건(응답자 {t['persons']}명)")
        for n in out["models"]:
            r = t["rows"][n]
            print(f"  {NAMES[n]:<22} hit@5 {r['hit5'][0]:.3f}  hit@10 {r['hit10'][0]:.3f}  MRR {r['mrr'][0]:.3f}  vs M0 {verdict(r)}")
    if hist is not None and a.compare_kinds:
        d2 = Data(favs, X, profiles, hist=load_history(a.history, tuple(a.compare_kinds)))
        out2 = run_experiment(d2, K=a.folds, repeats=a.repeats, log=print)
        table2 = summarize(d2, out2, B=a.boot)
        with open(target, "a", encoding="utf-8") as fh:
            fh.write("\n".join(history_compare_section(d2, out2, table2, a.compare_kinds)) + "\n")
    print(f"\nwrote {target}")


if __name__ == "__main__":
    main()
