#!/usr/bin/env python3
"""PICK CAST 추천 규칙 (MVP, 컨시어지용).

시트의 '태그 기록'·'회차 캐스팅'·'배역' 탭과 같은 모양의 TSV를 읽어서
날짜 범위 안의 회차를 취향 일치 수로 줄 세우고, 근거와 함께 카드 글을 출력한다.

사용 예:
  python3 recommend.py --work 겨울왕국 --from 2026-10-30 --to 2026-11-01 --prefs 성량 "코믹 연기"
  python3 recommend.py --work 엘리자벳 --from 2026-10-04 --to 2026-10-31 --actor 김준수 --prefs 가창
  python3 recommend.py --selftest

규칙(의도적으로 단순하다. 앱 V.when 의 점수와 같다):
  회차 점수 = 서로 다른 (배우, 고른 취향) 쌍의 수 + 서로 다른 (조합, 고른 취향) 쌍의 수
    한 배우가 같은 취향 태그를 리뷰 여러 곳에서 받아도 취향 하나당 1점이다. 태그 수는 실력이 아니라 리뷰 양이라서,
    태그가 많이 쌓인 배우가 이기지 않게 한다. 취향이 축 이름이면 그 축의 태그 아무거나, 태그 이름이면 그 태그가 맞는 것이다.
  반대 근거 = 고른 취향의 반대쪽 태그(맑은 음색을 골랐는데 허스키). 점수는 깎지 않고 동점일 때 순서와 카드 표시(△)에만 쓴다.
    가창↔연기는 반대가 아니라서 뺀다. 한 배우가 같은 축의 양쪽 태그를 다 가졌으면(성량도 섬세함도) 그 취향엔 맞는 배우라서
    그 축의 반대 근거는 쓰지 않는다.
  순서 = 점수 높은 순 → 반대 근거가 적은 순 → 이른 날짜. (태그가 더 많이 쌓인 캐스트를 먼저 두지 않는다)
  점수 0인 회차는 순위를 매기지 않고 '비교 불가'로만 보여 준다. 데이터 없음 ≠ 취향과 안 맞음.
"""
import argparse
import base64
import csv
import difflib
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

DATA = Path(__file__).parent / "data"
TAGS = DATA / "tag_records_2026-10-06.tsv"       # 태그 기록 탭 (헤더 있어도 되고 없어도 됨)
DICT = DATA / "tag_dict_2026-10-06.tsv"          # 태그 사전 탭 (헤더 있음). 취향 버튼 연결·태그 설명·다른 작품 대체 범위를 여기서 읽는다
SCHED = DATA / "casting_schedule_2026-10-02.tsv"  # 회차 캐스팅 탭 (헤더 있음)
ROLES = DATA / "roles_2026-10-02.tsv"             # 배역 탭 (헤더 있음)

# 설문 양극 척도 5개 = 앱 취향 버튼 5쌍: (사전 '연결 취향축' 문구, 왼쪽 키, 오른쪽 키, 왼쪽 버튼, 오른쪽 버튼, 묶음 제목)
AXES = [
    ("가창 중심 ↔ 연기 중심", "가창", "연기", "노래", "연기", "노래와 연기 중에는"),
    ("맑고 부드러운 음색 ↔ 허스키하고 묵직한 음색", "맑은 음색", "묵직한 음색", "맑고 부드러운 음색", "허스키하고 묵직한 음색", "목소리는"),
    ("강한 성량 ↔ 섬세한 표현", "강한 성량", "섬세한 표현", "강한 성량", "섬세한 표현", "노래 표현은"),
    ("감정을 크게 표현하는 연기 ↔ 절제된 연기", "감정 크게", "절제", "감정을 크게", "절제된", "감정 표현은"),
    ("강렬한 캐릭터 해석 ↔ 자연스럽고 현실적인 해석", "강렬한 해석", "자연스러운 해석", "강렬한 해석", "자연스러운 해석", "캐릭터 해석은"),
]
# 사전에는 '어느 축'만 있고 '어느 쪽'은 없다. 첫 축은 대분류(배우 · 가창 = 노래 쪽), 나머지는 LEFT에 있으면 왼쪽, 없으면 오른쪽.
# ponytail: 축에 새 태그가 생기면 기본이 오른쪽이다. 사전에 '쪽' 칸이 생기면 그걸 읽게 바꿀 것.
LEFT = {"맑음", "부드러움", "성량", "감정 크게 표현", "감정 몰입형", "강한 캐릭터성", "상징적·초월적", "철학적·해석 여지"}
CARRY_AREAS = {"음색", "파워·기술"}  # 사전 하위 영역. 목소리는 배우 자체의 특성이라 다른 작품 리뷰도 쓴다(연기·해석·조합은 그 작품에서만)


def load_dict():
    """태그 사전 탭 → (취향 키별 태그, 다른 작품에서 가져올 태그, 배우 태그 설명, 조합 태그 설명, 대분류별 배우 태그, 표현, 목소리 축, 작품 태그 대분류). 사전이 바뀌면 코드는 그대로 둔다."""
    rows = [r for r in csv.DictReader(open(DICT, encoding="utf-8"), delimiter="\t")
            if (r.get("태그") or "").strip() and (r.get("태그 상태") or "").strip() in ("", "확정")]  # '확정'(또는 빈 값)인 태그만 쓴다. 후보·검수 필요·그 밖의 값은 사전에서 확정될 때까지 앱에 안 나간다
    axis = defaultdict(list)
    for r in rows:
        tag, big = r["태그"].strip(), r["대분류"].strip()
        for text in (a.strip() for a in (r.get("연결 취향축") or "").split("/") if a.strip()):
            ax = next((a for a in AXES if a[0] == text), None)
            if not ax:
                print(f"경고: 사전에 모르는 취향축 {text!r} ({tag})", file=sys.stderr)
                continue
            left = big == "배우 · 가창" if ax is AXES[0] else tag in LEFT
            axis[ax[1] if left else ax[2]].append(tag)
        if big == "배우 조합":
            axis["케미"].append(tag)
    voice = {r["태그"].strip() for r in rows if r["대분류"].strip() == "배우 · 가창" and r["하위 영역"].strip() in CARRY_AREAS}
    actor_labels = {r["태그"].strip(): r["뜻"].strip() for r in rows if r["대분류"].strip().startswith("배우 ·")}
    combo_labels = {r["태그"].strip(): r["뜻"].strip() for r in rows if r["대분류"].strip() == "배우 조합"}
    work_labels = {r["태그"].strip(): r["대분류"].strip() for r in rows if r["대분류"].strip().startswith("작품 ·")}
    groups = defaultdict(list)  # 관람 후 화면에서 태그 칩을 대분류별로 묶는다(사전 순서 그대로)
    for t in actor_labels:
        groups[next(r["대분류"].strip() for r in rows if r["태그"].strip() == t)].append(t)
    # 사전 '이런 표현이면 이 태그' 열: {태그: [표현...]}(쉼표로 나눔). 앱의 '좋아하는 배우' 설문이 자유 글에서 태그 후보를 키워드로 찾을 때 쓴다. 확정이 아닌 태그는 rows에서 이미 빠져 있다
    phrases = {r["태그"].strip(): [p.strip() for p in (r.get("이런 표현이면 이 태그") or "").split(",") if p.strip()] for r in rows}
    # 목소리 축: 음색 태그 넷은 한 축, 성량·고음·딕션은 태그마다 한 축. 다른 작품 목소리는 그 작품에 같은 축 태그가 없을 때만 가져온다
    voice_axis = {r["태그"].strip(): ("음색" if r["하위 영역"].strip() == "음색" else r["태그"].strip()) for r in rows
                  if r["대분류"].strip() == "배우 · 가창" and r["하위 영역"].strip() in CARRY_AREAS}
    return dict(axis), voice, actor_labels, combo_labels, list(groups.items()), {t: ps for t, ps in phrases.items() if ps}, voice_axis, work_labels


AXIS, VOICE, ACTOR_TAG_LABELS, COMBO_TAG_LABELS, ACTOR_TAG_GROUPS, TAG_PHRASES, VOICE_AXIS, WORK_TAG_LABELS = load_dict()
# 태그 기록 열 위치. 헤더 있는 시트 내보내기는 tag_rows()가 열 이름(앞부분 일치)으로 이 순서에 맞춘다.
TAG_COLS = ["기록일", "기록자", "작품", "시즌", "공연장", "회차", "대상 유형", "배역", "배우", "상대 배우", "태그", "근거(", "출처 종류", "출처 링크", "상태", "근거 수준", "대분류"]  # "근거("까지 써야 "근거 수준" 칸과 안 헷갈린다
C_WORK, C_SEASON, C_TYPE, C_ROLE, C_ACTOR, C_PARTNER, C_TAG, C_WHY, C_SRC, C_LINK, C_STATE, C_LEVEL, C_GROUP = 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
# 근거 수준(시트 허용 목록): 전문매체·언론 / 일반 관객 후기 / 설문 / 직접 관람 / 배우 본인·공식 / 제작진·공식 / 기타.
# 배우 본인·제작진의 말은 확정이어도 점수·반대 근거·내 기록에는 안 쓰고 따로 보여 준다('배우가 밝힌 해석', 제작진은 '공식 소개').
# 예전 값(관객 후기·배우 인터뷰)도 알아본다.
OFFICIAL = {"배우 본인·공식", "제작진·공식", "배우 인터뷰"}
ACTOR_SELF = {"배우 본인·공식", "배우 인터뷰"}  # 배우가 직접 밝힌 해석. 연기·해석 태그(목소리 태그 아님)에 한해 앱의 '비슷한 배우' 계산에 근거 0.5개로만 쓴다(점수·근거 표시·조합 추천엔 안 씀). 제작진·공식은 어디에도 안 씀
LEVEL_SHORT = {"전문매체·언론": "전문매체", "일반 관객 후기": "관객", "설문": "관객", "직접 관람": "관객", "관객 후기": "관객",
               "배우 본인·공식": "배우 본인", "배우 인터뷰": "배우 본인", "제작진·공식": "공식", "기타": "기타"}
LEVEL_ORDER = ["전문매체", "관객", "배우 본인", "공식", "기타"]  # 근거 구성 표시 순서


CURTAIN = re.compile(r"(?<!이호광의 )커튼콜")  # 제목에 커튼콜(스페셜 커튼콜 포함). 방송 프로그램 이름 '이호광의 커튼콜'은 넘버 영상이라 뺀다


def is_curtain(title):
    """커튼콜 영상인가. 넘버 영상보다 뒤에 둔다(대표 영상이 커튼콜이 되지 않게)."""
    return bool(CURTAIN.search(title))


def lvl(r):
    """근거 수준(열이 없는 오래된 행은 빈 문자열)."""
    return r[C_LEVEL] if len(r) > C_LEVEL else ""


def is_official(r):
    """배우 본인·제작진·공식 출처 행. 점수·반대 근거에 안 쓴다."""
    return lvl(r) in OFFICIAL


def is_self(r):
    """배우 본인이 밝힌 해석 행(배우 본인·공식 / 배우 인터뷰)."""
    return lvl(r) in ACTOR_SELF


def group(r):
    """태그 사전 대분류(열이 없는 오래된 행은 빈 문자열)."""
    return r[C_GROUP] if len(r) > C_GROUP else ""


def carries(r):
    return r[C_TAG] in VOICE
SEASON = "2026"  # 이 시즌이 아닌 리뷰(예: 김준수 2022 토드)는 카드 근거에 시즌을 같이 적는다


def tag_rows():
    """태그 기록 행을 C_* 열 순서로. 시트 내보내기(헤더 있음)는 열 이름으로 맞춰서 '적용 범위'·'상태' 같은 새 열이 끼어도 된다."""
    rows = [r for r in csv.reader(open(TAGS, encoding="utf-8"), delimiter="\t") if r]
    if rows and rows[0][0] == "기록일":
        head = rows.pop(0)
        idx = [next((i for i, h in enumerate(head) if h.startswith(name)), -1) for name in TAG_COLS]
        rows = [[r[i] if 0 <= i < len(r) else "" for i in idx] for r in rows]
    return rows


def load_tags():
    actor, combo, all_tags, carry = defaultdict(list), defaultdict(list), set(), defaultdict(list)
    for r in tag_rows():
        if not r[C_TAG].strip() or r[C_STATE] not in ("확정", ""):  # '검수 필요'·'보류' 등 확정 아닌 줄은 추천·카드에서 뺀다
            continue
        all_tags.add(r[C_TAG])
        if r[C_TYPE] == "배우" and r[C_ACTOR]:
            actor[(r[C_WORK], r[C_ACTOR])].append(r)
            if carries(r) and not is_official(r):  # 배우 본인의 말은 목소리 특성으로 다른 작품에 옮기지 않는다
                carry[r[C_ACTOR]].append(r)
        elif r[C_TYPE] == "조합" and r[C_ACTOR] and r[C_PARTNER]:
            combo[(r[C_WORK], frozenset([r[C_ACTOR], r[C_PARTNER]]))].append(r)
    cast = [(r["작품"], [x.strip() for x in r["캐스트 배우"].split(",")]) for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t")]
    borrow(actor, carry, cast)
    return actor, combo, all_tags


def load_work_tags():
    """작품 태그(대상 유형 '작품', 확정) {작품: [행...]}. 배우 추천 점수에는 안 쓰고 앱 홈의 '이런 공연 좋아하면'에만 쓴다."""
    out = defaultdict(list)
    for r in tag_rows():
        if r[C_TYPE] == "작품" and r[C_WORK] and r[C_TAG].strip() and r[C_STATE] in ("확정", ""):
            out[r[C_WORK]].append(r)
    return out


def source_key(r):
    """같은 출처인지만 알아보는 짧은 열쇠(링크, 없으면 출처 이름의 해시 8자리). 근거 링크·출처 이름을 공개 data.js 에 싣지 않고도 앱이 '서로 다른 출처 수'(의견 분포)를 셀 수 있게 한다."""
    return hashlib.sha1((r[C_LINK] or r[C_SRC] or "").strip().encode("utf-8")).hexdigest()[:8]


def load_actor_profiles():
    """배우 프로필 {배우: {voice: [...], role: [...]}}. 확정 행 전부(시드 작품이 아닌 데스노트·팬텀 등과 이번 캐스트에 없는 배우도 포함).
    제작진 공식 행은 늘 빼고, 배우 본인이 밝힌 해석 행은 연기·해석(role) 태그만 넣는다(level 로 구분, 앱이 근거 0.5개로 센다). 배우 본인의 목소리 태그 행은 뺀다.
    voice = 목소리 태그(사전 하위 영역 음색·파워·기술), 나머지(연기·해석·몸)는 role. 앱 홈의 '좋아하는 배우와 닮은 배우' 찾기가 쓴다(점수 아님)."""
    out = {}
    for r in tag_rows():
        if r[C_TYPE] != "배우" or not r[C_ACTOR] or not r[C_TAG].strip() or r[C_STATE] not in ("확정", ""):
            continue
        if is_official(r) and not (is_self(r) and not carries(r)):
            continue
        item = {"tag": r[C_TAG], "work": r[C_WORK], "season": r[C_SEASON], "level": lvl(r), "sk": source_key(r)}
        kind = "voice" if carries(r) else "role"
        if kind == "role":
            item = {"tag": item["tag"], "work": item["work"], "role": r[C_ROLE], **{k: item[k] for k in ("season", "level", "sk")}}
        lst = out.setdefault(r[C_ACTOR], {"voice": [], "role": []})[kind]
        if item not in lst:
            lst.append(item)
    return out


def borrow(actor, carry, cast):
    """목소리는 배우 자체의 특성이라 모든 작품의 확정 리뷰에서 합친다(연기·해석·몸·조합은 그 작품 것만). 이 작품에 리뷰가 있어도, 이 작품 태그가 덮지 않는 축의
    다른 작품 목소리 태그를 더한다. 같은 축(음색 4개, 성량·고음·딕션 각각)에 이 작품 태그가 이미 있으면 그 축은 안 가져온다. 행의 작품 칸이 원래 작품이라 'OO 리뷰 기준'으로 표시된다."""
    done = set()
    for work, names in cast:
        for a in names:
            if not a or (work, a) in done:
                continue
            done.add((work, a))
            own = actor.get((work, a), [])
            covered = {VOICE_AXIS[x[C_TAG]] for x in own if x[C_TAG] in VOICE_AXIS and not is_official(x)}
            other = [x for x in carry.get(a, []) if x[C_WORK] != work and not is_official(x) and VOICE_AXIS.get(x[C_TAG]) not in covered]
            if other:
                actor[(work, a)] = own + other


def load_schedule():
    perfs = {}
    for r in csv.DictReader(open(SCHED, encoding="utf-8"), delimiter="\t"):
        p = perfs.setdefault((r["작품"], r["날짜"], r["시간"]), {"cast": {}, "notes": [], "요일": r["요일"]})
        p["cast"][r["배역"]] = r["배우"]
        if r["비고"] and r["비고"] not in p["notes"]:
            p["notes"].append(r["비고"])
    return perfs


def load_weights():
    return {(r["작품"], r["배역"]): r["비중"] for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t")}


def pref_tags(prefs, all_tags):
    """취향마다 맞는 태그 집합 {취향: {태그}}. 축 이름이면 그 축의 태그들, 태그 이름이면 그 태그 하나."""
    out = {}
    for p in prefs:
        if p in AXIS:
            out[p] = set(AXIS[p])
        elif p in all_tags or any(p in v for v in AXIS.values()):
            out[p] = {p}
        else:
            sys.exit(f"모르는 취향: {p!r}. 축 이름 {list(AXIS)} 또는 태그 사전의 태그 이름을 쓰세요.")
    return out


def opposite_tags(prefs, want):
    """취향별 반대쪽 태그 {취향: {태그}}(맑은 음색을 골랐는데 허스키). 가창↔연기는 반대가 아니라서 뺀다. 점수에는 안 쓰고 동점 순서·표시에만 쓴다."""
    return {p: set(AXIS.get(right if p == left else left, [])) - want
            for _, left, right, *_ in AXES if left != "가창" for p in prefs if p in (left, right)}


def score(cast, work, prefs, actor_tags, combo_tags):
    """prefs = pref_tags() 결과. 점수 = 서로 다른 (배우, 취향) 쌍 + (조합, 취향) 쌍의 수. 같은 태그가 여러 번 나와도 취향 하나당 1점."""
    want = set().union(*prefs.values())
    opp = opposite_tags(prefs, want)
    hits, evidence, unknown, bad = set(), [], [], []
    for role, a in cast.items():
        rows = [r for r in actor_tags.get((work, a), []) if not is_official(r)]  # 배우 본인·제작진 공식 출처는 확정이어도 점수·반대 근거에 안 쓴다
        if not rows:
            unknown.append(f"{a}({role})")
            continue
        mine = {r[C_TAG] for r in rows}
        # 한 배우가 같은 축의 양쪽 태그를 다 가졌으면(성량도 섬세함도) 그 취향엔 맞는 배우다. 그 축의 반대 근거는 쓰지 않는다
        against = set().union(*(o for p, o in opp.items() if not mine & prefs[p]))
        for r in rows:
            src = r[C_SRC] + (f", {r[C_WORK]} 리뷰 기준" if r[C_WORK] != work else "") + (f", {r[C_SEASON]} 시즌" if r[C_SEASON] != SEASON else "")
            item = (f"{a}({role})", r[C_TAG], r[C_WHY], src, r[C_LINK], lvl(r))
            if r[C_TAG] in want:
                hits.update((a, p) for p, tags in prefs.items() if r[C_TAG] in tags)
                evidence.append(item)
            elif r[C_TAG] in against:
                bad.append(item)
    names = list(cast.values())
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            for r in combo_tags.get((work, frozenset([a, b])), []):
                if r[C_TAG] in want and not is_official(r):
                    hits.update((frozenset([a, b]), p) for p, tags in prefs.items() if r[C_TAG] in tags)
                    evidence.append((f"{a}×{b}(조합)", r[C_TAG], r[C_WHY], r[C_SRC], r[C_LINK], lvl(r)))
    known = sum(len(actor_tags.get((work, a), [])) for a in names)  # 순서에는 안 쓴다(태그가 많다 = 리뷰가 많다일 뿐). 참고용으로만 남긴다
    return len(hits), known, evidence, unknown, bad


def level_mix(evidence):
    """근거를 출처 종류별로 센다(같은 링크는 한 번). 예: {'전문매체': 1, '관객': 2}. 근거 수준이 비어 있는 행은 세지 않는다."""
    by = defaultdict(set)
    for e in evidence:
        if e[5] in LEVEL_SHORT:
            by[LEVEL_SHORT[e[5]]].add(e[4] or e[3])
    return {k: len(by[k]) for k in LEVEL_ORDER if k in by}


def pins_by_role(work, actors):
    """고정 배우들을 배역별로 묶는다. 같은 배역 안에서는 '또는', 배역끼리는 '그리고'로 본다."""
    pins = defaultdict(set)
    for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t"):
        if r["작품"] != work:
            continue
        for a in (x.strip() for x in r["캐스트 배우"].split(",")):
            if a in actors:
                pins[r["배역"]].add(a)
    return pins


def recommend(work, lo, hi, prefs, pin=None, top=2):
    actor_tags, combo_tags, all_tags = load_tags()
    perfs, weights = load_schedule(), load_weights()
    pm = pref_tags(prefs, all_tags)
    want = set().union(*pm.values())
    pins = pins_by_role(work, set([pin] if isinstance(pin, str) else (pin or [])))
    groups = {}
    for (w, d, t), p in perfs.items():
        if w != work or not (lo <= date.fromisoformat(d) <= hi):
            continue
        if any(p["cast"].get(role) not in actors for role, actors in pins.items()):
            continue
        g = groups.setdefault(tuple(sorted(p["cast"].items())), {"cast": p["cast"], "shows": []})
        g["shows"].append((d, p["요일"], t, p["notes"]))
    for g in groups.values():
        g["pts"], g["known"], g["evidence"], g["unknown"], g["bad"] = score(g["cast"], work, pm, actor_tags, combo_tags)
        g["shows"].sort()
    return sorted(groups.values(), key=rank_key), want, weights


def rank_key(g):
    """점수 높은 순 → 반대 근거 적은 순 → 이른 날짜. 태그가 많이 쌓인 캐스트가 이기지 않는다."""
    return (-g["pts"], len(g["bad"]), g["shows"][0][0] + g["shows"][0][2])


def fmt_show(s):
    d, wd, t, notes = s
    m, dd = int(d[5:7]), int(d[8:10])
    return f"{m}/{dd}({wd}) {t}" + (f" [{' · '.join(notes)}]" if notes else "")


def fmt_cast(cast, work, weights):
    lead = [f"{r} {a}" for r, a in cast.items() if weights.get((work, r)) == "주연"]
    rest = [f"{r} {a}" for r, a in cast.items() if weights.get((work, r)) != "주연"]
    return " · ".join(lead), " · ".join(rest)


def card(work, lo, hi, prefs, ranked, weights, pin=None, top=2):
    L = [f"🎭 PICK CAST — {work} · {lo.month}/{lo.day}~{hi.month}/{hi.day}", f"취향: {' + '.join(prefs)}"]
    if pin:
        L.append(f"고정: {', '.join([pin] if isinstance(pin, str) else pin)} 출연 회차만")
    if not ranked:
        return "\n".join(L + ["", "이 기간에 조건에 맞는 회차가 없어요."])
    picks = [g for g in ranked if g["pts"] > 0][:top]
    for i, g in enumerate(picks, 1):
        lead, rest = fmt_cast(g["cast"], work, weights)
        L += ["", f"{i}순위{' ⭐' if i == 1 else ''}  {lead}", f"   회차: {' / '.join(fmt_show(s) for s in g['shows'])}"]
        if rest:
            L.append(f"   그 외: {rest}")
        mix = level_mix(g["evidence"])
        L.append(f"   근거 {len(g['evidence'])}건{' (' + ' · '.join(f'{k} {v}' for k, v in mix.items()) + ')' if mix else ''}:")
        for who, tag, why, src, link, *_ in g["evidence"]:
            L.append(f"   - {who} · {tag}: \"{why}\" — {src} {link}")
        if g["bad"]:  # 고른 취향의 반대쪽 태그. 점수는 깎지 않고 알려만 준다(앱의 '△ 고른 취향과 반대'와 같은 줄)
            by = {}
            for who, tag, *_ in g["bad"]:
                tags = by.setdefault(who.split("(", 1)[0], [])
                if tag not in tags:
                    tags.append(tag)
            L.append("   △ 고른 취향과 반대: " + ", ".join(f"{a} {'·'.join(ts)}" for a, ts in by.items()))
        if g["unknown"]:
            L.append(f"   아직 태그 없음: {', '.join(g['unknown'])}")
    others = [g for g in ranked if g not in picks]
    if others:
        L += ["", f"그 밖의 회차 (상위 {top}개 밖 · 취향 근거가 없으면 비교 불가):"]  # 점수가 있어도 top 밖이면 여기로 온다
        for g in others:
            lead, _ = fmt_cast(g["cast"], work, weights)
            L.append(f"   - {lead}: {' / '.join(fmt_show(s) for s in g['shows'])}")
    no_data = sorted({u for g in ranked for u in g["unknown"]})
    leads = [u for u in no_data if weights.get((work, u[u.index("(") + 1:-1])) == "주연"]
    if no_data:
        tail = f" 외 {len(no_data) - len(leads)}명" if len(no_data) > len(leads) else ""
        L += ["", f"참고: 아직 데이터가 없는 배우 — {', '.join(leads) or '조연'}{tail}. 순위에서 밀린 건 데이터가 없어서지, 취향과 안 맞는다는 뜻이 아니에요."]
    L.append(f"스케줄은 변경될 수 있어요 · 데이터 기준 {date.today().isoformat()}")
    return "\n".join(L)


# 가안 앱(app/index.html)에 넣을 데이터. 시드 작품 메타는 여기에만 있다.
# 한 작품이 서울·지방처럼 여러 '공연(run)'으로 돌 수 있어서 공연 단위로 적는다. 회차는 날짜가 어느 공연 기간에 들어가는지로 묶인다.
RUNS = [  # (작품, 공연 이름, 공연장, 시작, 끝, 예매 링크, 강조색, 등급별 정가(원, 할인 전))
    ("엘리자벳", "서울", "블루스퀘어 우리은행홀", "2026-08-16", "2026-11-15", "https://nol.yanolja.com/ticket/products/26009314", "#5A2A85",
     [("VIP석", 180000), ("R석", 150000), ("S석", 120000), ("A석", 90000)]),
    ("겨울왕국", "서울", "샤롯데씨어터", "2026-08-13", "2027-03-01", "https://nol.yanolja.com/ticket/products/26007416", "#1F6DB5",
     [("VIP석", 190000), ("R석", 160000), ("S석", 130000), ("A석", 90000)]),
    ("디어 에반 핸슨", "서울", "충무아트센터 대극장", "2026-08-01", "2026-11-01", "https://nol.yanolja.com/ticket/products/26007442", "#2F7FC1",
     [("VIP석", 160000), ("R석", 130000), ("S석", 100000), ("A석", 70000)]),
    ("렛미플라이", "서울", "두산아트센터 연강홀", "2026-10-06", "2027-01-03", "https://www.doosanartcenter.com/ko/performance/1686", "#C96A1F",
     [("R석", 88000), ("S석", 66000)]),
    ("광화문연가", "서울", "디큐브 링크아트센터", "2026-09-06", "2026-11-15", "https://nol.yanolja.com/ticket/products/26009625", "#B3432C",
     [("VIP석", 160000), ("R석", 140000), ("S석", 110000), ("A석", 80000)]),
    ("드라큘라", "서울", "LG아트센터 서울", "2026-07-10", "2026-10-18", "https://nol.yanolja.com/ticket/products/L0000142", "#8E1B2A",
     [("OP석", 180000), ("VIP석", 180000), ("R석", 150000), ("S석", 110000), ("A석", 80000)]),
    ("드라큘라", "대구", "계명아트센터", "2026-10-27", "2026-11-01", "", "#8E1B2A",
     [("VIP석", 180000), ("R석", 150000), ("S석", 110000), ("A석", 80000)]),
    ("사의찬미", "서울 · 2ND STAGE", "링크아트센터 페이코홀", "2026-09-08", "2026-10-25", "", "#2B3F6E",
     [("R석", 77000), ("S석", 66000), ("A석", 55000)]),
    ("빨래", "서울", "유니플렉스 2관", "2026-06-11", "2027-02-21", "", "#3F8FB5",
     [("R석", 77000), ("S석", 55000), ("시야제한석", 20000)]),
    ("시카고", "서울", "LG아트센터 서울", "2026-12-05", "2027-03-14", "https://www.ticketlink.co.kr/product/49613", "#9A7A1F",
     [("OP석", 170000), ("VIP석", 170000), ("시카고석", 160000), ("R석", 150000), ("S석", 110000), ("A석", 80000)]),
    ("팬레터", "인천", "인천문화예술회관 대공연장", "2026-11-21", "2026-11-22", "https://nol.yanolja.com/ticket/products/26011840", "#6B4F3A",
     [("R석", 110000), ("S석", 99000), ("A석", 77000), ("B석", 66000)]),
]
# 공연장 좌석 배치도 링크(2026-10-03 확인). 공식 페이지가 우선이고, 없으면 더뮤지컬 공연장 정보로 대신한다.
SEATMAPS = {
    "블루스퀘어 우리은행홀": ("https://www.bluesquare.kr/pages/intro/fac.php", "공연장 공식"),
    "샤롯데씨어터": ("https://www.charlottetheater.co.kr/stage/seat_guide.asp", "공연장 공식"),
    "충무아트센터 대극장": ("https://www.caci.or.kr/home/display/region/content/JSVFRmpiM1IrckZCdE81blFpeWF6bFBKV1MvOFBsKzRoczRlNy9nOVhtRVA1bz0=", "공연장 공식 (VR 시야 포함)"),
    "두산아트센터 연강홀": ("https://www.doosanartcenter.com/images/content/img-seats.jpg", "공연장 공식"),
    "디큐브 링크아트센터": ("http://www.d3art.co.kr/oart/OAFRDcube.droafr?goTo=acting2", "공연장 공식 (좌석별 무대 사진)"),
    "LG아트센터 서울": ("https://www.lgart.com/home/display/region/content/JSVFVEttNlczRTZZaGZIYUs5ckNNM0hHTDBQRVcrak5adTFTcFE2YkVYRTBGVT0=", "공연장 공식 (좌석별 시야 사진)"),
    "계명아트센터": ("https://kmuartcenter.kmu.ac.kr/kmuartcenter/13483/subview.do", "공연장 공식"),
    "링크아트센터 페이코홀": ("https://www.linkartcenter.co.kr/intro", "공연장 공식"),
    "유니플렉스 2관": ("https://www.themusical.co.kr/Theater/Detail?num=1008", "더뮤지컬 (공식 사이트에 배치도 없음)"),
    "인천문화예술회관 대공연장": ("https://www.incheon.go.kr/art/ART010301", "공연장 공식 (좌석별 시야 미리보기)"),
}



def parse_cast(s):
    """KOPIS prfcast '이지연, 이지혜 외 3명 등' → ['이지연', '이지혜']. 끝의 등·외 N명, 괄호 설명, '역:' 표기를 걷어 낸다."""
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", s or "")
    s = re.sub(r"(외\s*\d*\s*명?|등)\s*$", "", s.strip())
    out = []
    for t in re.split(r"[,/、·ㆍ]", s):
        t = re.sub(r"(외\s*\d*\s*명?|등)\s*$", "", t.split(":")[-1].strip()).strip()
        if t and t not in out:
            out.append(t)
    return out


def min_age(age):
    """관람 연령 문구의 최소 나이 '만 19세 이상' → 19, '전체 관람가'·'12개월 이상' → 0."""
    m = re.search(r"만\s*(\d+)\s*세", age or "")
    return int(m.group(1)) if m else 0


def https_url(u):
    """http → https. KOPIS 포스터(http://www.kopis.or.kr/…)는 https://kopis.or.kr/… 로 열리고(2026-10-10 확인), https 사이트에서 http 이미지는 막히기 때문. 스킴이 없는 도메인 링크에는 https:// 를 붙이고, 그 밖의 값은 버린다."""
    u = (u or "").strip()
    u = re.sub(r"^http://(www\.)?kopis\.or\.kr/", "https://kopis.or.kr/", u)
    if re.match(r"https?://", u):
        return u
    return "https://" + u if re.match(r"[\w-]+(\.[\w-]+)+(/|$)", u) else ""


ALIASES = DATA / "actor_aliases.tsv"  # 활동명 | KOPIS/본명 표기 | 근거 링크 | 확인 방법 | 적용 공연


def load_aliases(path=None):
    """KOPIS 출연진의 본명 표기 → 활동명 대조표를 {공연 작품명: {KOPIS 표기: 활동명}} 로. '적용 공연'(kopis_current 의 '작품' 칸 그대로, 쉼표로 구분)이 비어 있는 행은 안 쓴다 —
    김태훈·이정훈 같은 흔한 이름은 다른 사람일 수 있어서 그 공연에서 같은 사람이라고 확인한 공연에만 적용한다(작품명에 쉼표가 있으면 못 쓴다). 대조표·본명은 data.js 로 나가지 않는다."""
    path = Path(path) if path else ALIASES
    out = defaultdict(dict)
    if not path.exists():
        return out
    for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        for title in (t.strip() for t in (r.get("적용 공연") or "").split(",")):
            if title and r["KOPIS/본명 표기"].strip():
                out[title][r["KOPIS/본명 표기"].strip()] = r["활동명"].strip()
    return out


def alias_unmatched(path=None, aliases=None):
    """대조표의 '적용 공연' 중 현재 공연 목록(kopis_current_*.tsv 최신)에 그 작품명이 없는 것(오타·끝난 공연). 내보낼 때 경고용."""
    files = sorted(f for f in DATA.glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))
    path = path or (files[-1] if files else None)
    titles = {r["작품"] for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t")} if path else set()
    return sorted(t for t in (load_aliases() if aliases is None else aliases) if t not in titles)


def kopis_price(show_id, cache=None):
    """상세 캐시(data/kopis_cache/<id>.xml, kopis_sync.py --current 가 저장)의 가격 안내 글. 없으면 ''. 앞 160자까지."""
    f = Path(cache or DATA / "kopis_cache") / f"{show_id}.xml"
    if not f.exists():
        return ""
    m = re.search(r"<pcseguidance>(.*?)</pcseguidance>", f.read_text(encoding="utf-8"), re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>|&amp;", lambda t: "&" if t.group(0) == "&amp;" else "", m.group(1))).strip()[:160] if m else ""


def load_seed_info(path=None):
    """시드 작품(제목·공연장이 RUNS와 맞는 KOPIS 행)의 관람 연령·러닝타임·공연 시간 {작품: {age, runtime, times}}. 앱의 극 요약 화면용(회차는 우리 캐스팅 표에서 오니 공연 시간은 참고)."""
    if path is None:
        files = sorted(f for f in DATA.glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))
        if not files:
            return {}
        path = files[-1]
    return {r["시드작품"]: {"age": r["관람연령"], "runtime": r["러닝타임"], "times": r["공연시간"]}
            for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t") if r["시드작품"] and r["시드공연일치"] == "Y"}


def load_current_shows(today=None, path=None, aliases=None):
    """data/kopis_current_*.tsv(kopis_sync.py --current 산출물, 최신)에서 앱 홈 '지금 하는 공연 전체'에 쓸 공연. 시드 작품(RUNS와 제목이 맞는 공연)은 RUNS를 쓰니 빼고,
    관람 연령 만 18세 이상(미성년 사용자 보호)·이미 끝난 공연도 뺀다. 출연진은 KOPIS가 주는 대표 7명까지.
    출연진 정보가 없는 공연은 빼지 않고 cast 가 빈 채 noCast: true 를 붙여 내보낸다(전체 목록에만 나오고, 앱은 추천 줄·비슷한 배우 계산에 안 쓴다).
    KOPIS가 본명으로 적은 출연진은 대조표(load_aliases)의 '적용 공연'에 든 공연에서만 활동명으로 바꾼다(그 밖의 이름·공연은 KOPIS 표기 그대로)."""
    today = (today or date.today()).isoformat()
    aliases = load_aliases() if aliases is None else aliases
    if path is None:
        files = sorted(f for f in DATA.glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))
        if not files:
            return {"asOf": "", "shows": []}
        path = files[-1]
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"):
        amap = aliases.get(r["작품"], {})
        cast = list(dict.fromkeys(amap.get(n, n) for n in parse_cast(r["출연진"])))[:7]  # 본명 → 활동명(적용 공연만), 바뀐 이름이 이미 있으면 한 번만
        if r["시드작품"] or min_age(r["관람연령"]) >= 18 or r["끝"] < today:
            continue
        tickets = []
        for t in filter(None, (x.strip() for x in r["예매처링크"].split(" | "))):
            name, _, url = t.partition("=")
            if https_url(url):
                tickets.append({"name": name.strip(), "url": https_url(url)})
        out.append({"id": r["mt20id"], "title": r["작품"], "venue": r["공연장"], "start": r["시작"], "end": r["끝"], "status": r["상태"], "cast": cast, "poster": https_url(r["포스터URL"]),
                    "age": r["관람연령"], "runtime": r["러닝타임"], "times": r["공연시간"], "tickets": tickets, "price": kopis_price(r["mt20id"]), **({} if cast else {"noCast": True})})
    return {"asOf": Path(path).stem.removeprefix("kopis_current_"), "shows": sorted(out, key=lambda x: (x["title"], x["start"]))}


def voice_tags():
    """사전 순서대로 본 목소리 태그(VOICE = 하위 영역 음색·파워·기술)."""
    return [t for t in ACTOR_TAG_LABELS if t in VOICE]


def _env_value(name):
    """환경변수, 없으면 프로젝트 루트 .env 의 값(kopis_sync.env_key 와 같은 방식). 값은 어디에도 출력하지 않는다."""
    import os
    v = os.environ.get(name)
    f = Path(__file__).parent / ".env"
    if not v and f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            k, _, val = line.partition("=")
            if k.strip().removeprefix("export ").strip() == name:
                v = val.strip().strip("\"'")
    return v


def track_config(get=None):
    """앱 기록 전송 설정. .env 의 SUPABASE_URL·SUPABASE_ANON_KEY(공개 키)를 앱에 넣는다(docs/data_spec_combo_fit). 둘 다 없거나 모양이 틀리면 (None, 이유) → 앱은 연습 모드(서버로 안 보냄).
    비밀 키는 앱에 못 들어가게 막는다: JWT 의 role 이 anon 이 아니거나 sb_secret_ 로 시작하면 거절. 키 값은 반환하는 이유 글에 넣지 않는다."""
    get = get or _env_value
    url, key = (get("SUPABASE_URL") or "").strip().rstrip("/"), (get("SUPABASE_ANON_KEY") or "").strip()
    if not url and not key:
        return None, "기록 전송: 연습 모드 (.env 에 SUPABASE_URL·SUPABASE_ANON_KEY 없음)"
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url):
        return None, "기록 전송: 연습 모드 (SUPABASE_URL 모양이 https://<프로젝트>.supabase.co 가 아님)"
    if key.startswith("sb_publishable_"):
        pass
    elif re.fullmatch(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", key):
        try:
            seg = key.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))).get("role")
        except Exception:
            role = None
        if role != "anon":
            return None, "기록 전송: 연습 모드 (SUPABASE_ANON_KEY 가 공개(anon) 키가 아님 — 비밀 키는 앱에 넣지 않아요)"
    else:
        return None, "기록 전송: 연습 모드 (SUPABASE_ANON_KEY 가 공개 키 모양이 아님 — sb_secret_ 같은 비밀 키는 앱에 넣지 않아요)"
    return {"mode": "live", "url": url, "key": key, "table": "events"}, f"기록 전송: 켜짐 ({url})"


def _venue_key(s):
    return re.sub(r"[^0-9a-z가-힣]", "", str(s).lower())


def load_venue_areas(path=None):
    """공연장 → 구분. data/venue_area_*.tsv 중 최신(열: 공연장 | 구분(대학로/대학로 외/확인 필요) | 주소 | 근거). 파일이 없으면 ({}, '')."""
    files = [Path(path)] if path else sorted(DATA.glob("venue_area_*.tsv"))[-1:]
    areas = {}
    for f in files:
        if not f.exists():
            continue
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            v, a = _venue_key(r.get("공연장", "")), (r.get("구분") or "").strip()
            if v and a:
                areas[v] = a
    return areas, (files[0].name if files and files[0].exists() else "")


def load_venue_regions(path=None):
    """공연장 → 지역 이름(홈의 지역 칩). 구분 표(data/venue_area_*.tsv)의 구분이 '대학로'면 '대학로', 아니면 주소의 서울 '○○구'(예: 용산구·종로구). 서울 주소가 아니거나 구를 못 읽으면 ''(앱이 '그 외 지역'으로 묶는다)."""
    files = [Path(path)] if path else sorted(DATA.glob("venue_area_*.tsv"))[-1:]
    out = {}
    for f in files:
        if not f.exists():
            continue
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            v = _venue_key(r.get("공연장", ""))
            m = re.match(r"서울(?:특별시)?\s+(\S+구)(?:\s|$)", (r.get("주소") or "").strip())
            if v:
                out[v] = "대학로" if (r.get("구분") or "").strip() == "대학로" else (m.group(1) if m else "")
    return out


def region_for(venue, regions):
    return (regions or {}).get(_venue_key(venue), "")


def load_boxoffice(path=None):
    """KOPIS 예매상황판(kopis_sync.py --boxoffice 산출물 data/kopis_boxoffice_*.tsv 중 최신) → ({mt20id: 가장 좋은 순위(주간·월간 중 작은 값)}, 기준일). 파일이 없으면 ({}, '')."""
    files = [Path(path)] if path else sorted(DATA.glob("kopis_boxoffice_2*.tsv"))[-1:]
    ranks, asof = {}, ""
    for f in files:
        if not f.exists():
            continue
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            best = min((int(r[c]) for c in ("주간순위", "월간순위") if (r.get(c) or "").strip().isdigit()), default=None)
            if best:
                ranks[r["mt20id"]] = best
                asof = r.get("기준일") or asof
    return ranks, asof


def load_seed_ids(path=None):
    """시드 작품 → KOPIS 공연 ID 목록(kopis_current 의 시드작품 열, 제목·공연장이 RUNS 와 맞는 행만). 시드 작품의 인기 순위를 ID 로 찾을 때 쓴다."""
    if path is None:
        files = sorted(f for f in DATA.glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))[-1:]
        path = files[0] if files else None
    out = defaultdict(list)
    if path and Path(path).exists():
        for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"):
            if r["시드작품"] and r["시드공연일치"] == "Y":
                out[r["시드작품"]].append(r["mt20id"])
    return dict(out)


def area_lookup(venue, areas):
    """구분 표에서 공연장을 찾는다(data.js 표기 그대로 = 공백·기호만 무시하고 정확히 같아야 한다). 없으면 None."""
    return (areas or {}).get(_venue_key(venue))


def area_for(venue, title="", areas=None):
    """앱 홈의 구분 버튼 값: '대학로' 또는 '대학로 외'.
    구분 표(areas)가 있으면 표가 기준이다: 표의 값, '확인 필요'나 표에 없는 공연장은 '대학로 외'(없는 공연장은 export 가 경고를 찍는다).
    표 자체가 없을 때만 임시 규칙: 공연장이나 공연명에 '대학로'가 있으면 대학로, 아니면 대학로 외."""
    if areas:
        return "대학로" if area_lookup(venue, areas) == "대학로" else "대학로 외"
    return "대학로" if "대학로" in f"{venue or ''}{title or ''}" else "대학로 외"


def load_known_titles(data_dir=None):
    """KOPIS 현재 공연 파일(data/kopis_current_*.tsv)과 제외 목록(*_excluded.tsv)에 한 번이라도 나온 공연 이름. 지금은 끝난 공연의 작품 태그를 경고 없이 넘길 때 쓴다(공연 이름이 KOPIS 표기 그대로라는 뜻이라 오타와 구분된다)."""
    out = set()
    for f in sorted(Path(data_dir or DATA).glob("kopis_current_2*.tsv")):
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            out |= {(r.get("작품") or "").strip(), (r.get("시드작품") or "").strip()}
    return out - {""}


def link_work_tags(work_tags, seed, titles, known=()):
    """작품 태그를 앱이 읽는 workTags 로 잇는다: 작품 이름이 시드 작품명이거나 KOPIS 현재 공연 제목(currentShows 의 title 그대로 — 공백·대괄호까지)과 정확히 같은 것만.
    known = 최근 KOPIS 파일에 나온 공연 이름(load_known_titles): 지금 공연 목록엔 없는 끝난 공연이라 앱엔 안 붙이고 경고도 안 한다.
    → (이어진 {작품: 행들}, 연결 안 된 작품 이름 [(이름, 비슷한 제목 또는 '')]) — 어디에도 없는 이름은 앱에서 태그 없는 공연으로 보이므로 export 가 경고한다."""
    names = set(seed) | set(titles)
    linked = {w: rows for w, rows in work_tags.items() if w in names}
    key = lambda x: re.sub(r"[^0-9a-z가-힣]", "", str(x).lower())
    near = lambda w: next((t for t in sorted(names) if key(w) and (key(w) in key(t) or key(t) in key(w))), "") or next(iter(difflib.get_close_matches(w, names, n=1, cutoff=0.6)), "")  # 경고용 힌트: 이름이 서로 포함되면 그것, 아니면 비슷한 것
    return linked, [(w, near(w)) for w in sorted(set(work_tags) - names - set(known))]


def export_js(path, track=True, env_get=None):
    actor_tags, combo_tags, _ = load_tags()
    perfs = load_schedule()
    roles = defaultdict(list)
    for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t"):
        roles[r["작품"]].append({"role": r["배역"], "weight": r["비중"], "cast": [a.strip() for a in r["캐스트 배우"].split(",")]})
    # 태그 행: 근거 문장(why)·출처 이름(src)·링크·회차는 data.js 에 싣지 않는다(공개 파일, 2026-10-13 사용자 지시 '근거를 사용자들이 못 보게'). 추천 계산에 쓰는 level 과 같은 출처를 세는 sk 만 남긴다
    row = lambda r: {"role": r[C_ROLE], "tag": r[C_TAG], "season": r[C_SEASON], "level": lvl(r), "sk": source_key(r)}
    at = defaultdict(dict)
    seed = {x[0] for x in RUNS}
    for (w, a), rows in actor_tags.items():
        if w in seed:  # 다른 작품 리뷰 행은 시드 작품 배우 칸에 'from'을 달고 들어간다
            at[w][a] = [{**row(r), **({"from": r[C_WORK]} if r[C_WORK] != w else {})} for r in rows]
    ct = defaultdict(list)
    for (w, pair), rows in combo_tags.items():
        for r in rows:
            ct[w].append({"a": r[C_ACTOR], "b": r[C_PARTNER], **row(r)})
    works = {}
    for w, label, venue, start, end, ticket, accent, prices in RUNS:
        entry = works.setdefault(w, {"name": w, "accent": accent, "runs": [],
                                     "poster": next((f"posters/{f.name}" for f in (Path(path).parent / "posters").glob(f"{w}.*")), "")})
        sm = SEATMAPS.get(venue)
        entry["runs"].append({"label": label, "venue": venue, "start": start, "end": end, "ticket": ticket, "prices": prices,
                              "seatmap": {"url": sm[0], "src": sm[1]} if sm else None,
                              "hasSchedule": any(k[0] == w and start <= k[1] <= end for k in perfs)})
    for e in works.values():
        e["hasSchedule"] = any(r["hasSchedule"] for r in e["runs"])
    # 배우별 공식 영상(youtube_clips.py 산출물 중 최신). 비교 카드의 '정보 없음' 칸을 메운다. API 데이터라 30일 안에 다시 받는다.
    # videos_manual.tsv(사람이 고른 링크, 항상 포함·먼저) + 최신 videos_YYYY-MM-DD.tsv(API 산출물)
    videos = defaultdict(lambda: defaultdict(list))
    vfiles = sorted(f for f in DATA.glob("videos_2*.tsv")) [-1:]
    nman = {}  # (작품, 배우) → 수동 영상 수. 수동 링크는 사람이 고른 거라 늘 맨 앞에 두고, 그 뒤의 API 영상만 커튼콜을 뒤로 민다
    for f in [DATA / "videos_manual.tsv"] + vfiles:
        if not f.exists():
            continue
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            lst = videos[r["작품"]][r["배우"]]
            if any(v["url"] == r["URL"] for v in lst):
                continue
            lst.append({"title": r["영상 제목"], "channel": r["채널"], "url": r["URL"],
                        "views": int(r["조회수"] or 0), "official": r["공식채널(추정)"] == "Y"})
        if f.name == "videos_manual.tsv":
            nman = {(w, a): len(l) for w, d in videos.items() for a, l in d.items()}
    for w, d in videos.items():
        for a, lst in d.items():
            k = nman.get((w, a), 0)
            lst[k:] = sorted(lst[k:], key=lambda v: is_curtain(v["title"]))  # 안정 정렬: 넘버 영상이 먼저, 커튼콜은 뒤(파일 순서는 그대로). 파일이 아직 다시 정렬되기 전이어도 대표 영상은 넘버
    cur = load_current_shows()
    # 작품 태그: 시드 작품 + KOPIS 현재 공연(작품 이름 = currentShows title). group = 태그 사전 대분류('작품 · 소재' 등)
    linked, lost = link_work_tags(load_work_tags(), seed, [sh["title"] for sh in cur["shows"]], load_known_titles())
    wt = {w: [{"tag": r[C_TAG], "group": group(r)} for r in rows] for w, rows in linked.items()}
    for w, near in lost:
        print(f"경고: 작품 태그의 작품 '{w}' 가 시드 작품·KOPIS 현재 공연 제목과 달라 앱에 안 붙어요" + (f" (혹시 '{near}'?)" if near else " (끝난 공연이거나 이름이 다름)"))
    areas, area_src = load_venue_areas()  # 홈의 '대학로 / 대학로 외' 구분. 표(7c)가 오기 전엔 임시 규칙
    regions, seed_ids = load_venue_regions(), load_seed_ids()
    ranks, pop_asof = load_boxoffice()  # 홈 '지금 하는 공연 전체'의 인기순(순위 숫자는 화면에 안 보임). 순위가 없으면 None
    for sh in cur["shows"]:
        sh["area"] = area_for(sh["venue"], sh["title"], areas)
        sh["region"] = region_for(sh["venue"], regions)
        sh["popularity"] = ranks.get(sh["id"])
    today_s = date.today().isoformat()
    for e in works.values():
        e["area"] = "대학로" if any(area_for(r["venue"], e["name"], areas) == "대학로" for r in e["runs"]) else "대학로 외"
        live = [r for r in e["runs"] if r["end"] >= today_s] or e["runs"]  # 지금 하는 회차의 공연장이 우선
        e["region"] = next((g for g in (region_for(r["venue"], regions) for r in live) if g), "")
        e["popularity"] = min((ranks[i] for i in seed_ids.get(e["name"], []) if i in ranks), default=None)
    if areas:
        unknown = sorted({v for v in [sh["venue"] for sh in cur["shows"]] + [r["venue"] for e in works.values() for r in e["runs"]] if v and area_lookup(v, areas) is None})
        if unknown:
            print(f"경고: 공연장 구분 표({area_src})에 없는 공연장 {len(unknown)}곳을 '대학로 외'로 보냈어요: " + ", ".join(unknown))
    for t in alias_unmatched():
        print(f"경고: 대조표 '적용 공연'의 '{t}'가 현재 공연 목록에 없어요(오타이거나 끝난 공연)")
    data = {
        "generated": date.today().isoformat(),
        "videos": videos,
        "works": list(works.values()),
        "roles": roles,
        "perfs": [{"work": w, "date": d, "dow": p["요일"], "time": t, "cast": p["cast"], "notes": p["notes"]} for (w, d, t), p in sorted(perfs.items())],
        "actorTags": at, "comboTags": ct, "workTags": wt, "axis": AXIS,
        "axes": [{"left": l, "right": r, "l": ll, "r": rl, "title": t} for _, l, r, ll, rl, t in AXES],
        "actorProfiles": load_actor_profiles(),  # {배우: {voice: [{tag, work, season, level, sk}], role: [{tag, work, role, season, level, sk}]}} 제작진 공식 행과 배우 본인의 목소리 행은 빠짐(배우 본인의 연기·해석 행은 level 로 구분해 들어감). 시드 밖 작품·캐스트에 없는 배우도 있다
        "seedInfo": load_seed_info(),  # {작품: {age, runtime, times}} KOPIS 에서(시드 작품 극 요약용)
        "areaSource": area_src or "임시 규칙(공연장·공연명에 '대학로')",  # 구분 값의 출처(currentShows·works 의 area)
        "popularityAsOf": pop_asof,  # currentShows·works 의 popularity(예매상황판 주간·월간 중 가장 좋은 순위, 없으면 null) 기준일. 앱은 이 순서로만 정렬하고 숫자는 안 보인다
        "currentShows": cur["shows"], "currentAsOf": cur["asOf"],  # KOPIS 현재 공연(시드 밖). 앱 홈 '지금 하는 다른 공연'·'○○를 좋아하면'의 후보. 19세 이상·출연진 없음·끝난 공연·시드는 뺌
        "voiceAxis": VOICE_AXIS,  # {목소리 태그: 축} 음색 네 태그는 '음색' 한 축, 성량·고음·딕션은 각자 한 축(앱이 같은 축을 찾을 때)
        "workTagLabels": WORK_TAG_LABELS,  # {태그: 대분류} 사전의 작품 태그. 앱 첫 화면 카드가 쓰는 태그 이름이 사전에 있는지 테스트가 확인한다
        "actorTagLabels": ACTOR_TAG_LABELS, "comboTagLabels": COMBO_TAG_LABELS, "actorTagGroups": ACTOR_TAG_GROUPS,
        "tagPhrases": TAG_PHRASES,  # {태그: [사전 '이런 표현이면 이 태그' 표현...]} — 앱 설문의 태그 후보 키워드 매칭용(없으면 앱은 태그 이름만 쓴다)
        "voiceTags": voice_tags(),  # 사전 하위 영역 음색·파워·기술 태그(배우 특성이라 작품이 바뀌어도 이어지는 것). 앱 설문의 '배우 단위 태그'는 이것만 반영한다(없으면 앱 안의 기본 목록)
    }
    out = "window.PICKLE_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n"
    cfg, why = track_config(env_get) if track else (None, "기록 전송: 끔 (--no-track — .env 에 Supabase 키가 있어도 앱에 안 넣었어요)")
    if cfg:
        out += "window.PICKLE_TRACK = " + json.dumps(cfg, ensure_ascii=False) + ";\n"
    print(why)
    Path(path).write_text(out, encoding="utf-8")
    print(f"wrote {path}: {len(data['perfs'])} perfs, {sum(len(v) for w in at.values() for v in w.values())} actor tags")


def build_schedule():
    """data/schedules/*.tsv(공연별 가로 표) → data/casting_schedule_*.tsv(1행 = 회차 1개의 배역 1개). 시트 '회차 캐스팅' 탭과 같은 모양."""
    import glob
    W = "월화수목금토일"
    runs = [(w, label, start, end) for w, label, _, start, end, *_ in RUNS]
    roles = {(r["작품"], r["배역"]): {a.strip() for a in r["캐스트 배우"].split(",")} for r in csv.DictReader(open(ROLES, encoding="utf-8"), delimiter="\t")}
    swing = {"디어 에반 핸슨": {"김영훈", "새봄", "박건우", "손설빈"}}
    out, bad = [], []
    for f in sorted(glob.glob(str(DATA / "schedules" / "*.tsv"))):
        work = Path(f).name.rsplit("_", 1)[0]
        src, header = "", None
        for line in open(f, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith("# 출처:"):
                src = line.split("출처:")[1].strip().split(" ")[0]
                continue
            cols = line.split("\t")
            if cols[0] == "날짜":
                header = cols
                continue
            d, t = cols[0], cols[1]
            wd = W[date.fromisoformat(d).weekday()]
            run = next((label for w, label, s, e in runs if w == work and s <= d <= e), "")
            has_note = header[-1] == "비고"
            role_cols = header[2:-1] if has_note else header[2:]
            note = cols[len(header) - 1] if has_note and len(cols) == len(header) else ""
            for i, role in enumerate(role_cols):
                actor = cols[2 + i]
                if actor not in roles.get((work, role), set()) and actor not in swing.get(work, set()):
                    bad.append((work, d, t, role, actor))
                out.append([work, "2026", run, d, wd, t, role, actor, note, src])
    hdr = ["작품", "시즌", "공연", "날짜", "요일", "시간", "배역", "배우", "비고", "출처 링크"]
    SCHED.write_text("\n".join("\t".join(r) for r in [hdr] + out) + "\n", encoding="utf-8")
    perfs = len({(r[0], r[3], r[5]) for r in out})
    print(f"wrote {SCHED.name}: {perfs} perfs, {len(out)} rows")
    if bad:
        print("배역 탭 명단에 없는 이름:", bad)


def selftest():
    global tag_rows, DICT  # 작품 태그 읽기·사전 '후보' 테스트에서 잠깐 바꿔 끼운다
    r, _, _ = recommend("겨울왕국", date(2026, 10, 30), date(2026, 11, 1), ["성량", "코믹 연기"])
    assert r[0]["pts"] > 0 and "최지혜" in r[0]["cast"].values(), r[0]["cast"]
    assert all(r[i]["pts"] >= r[i + 1]["pts"] for i in range(len(r) - 1))
    r, _, _ = recommend("엘리자벳", date(2026, 10, 4), date(2026, 10, 31), ["가창"], pin="김준수")
    assert all("김준수" in g["cast"].values() for g in r)
    assert r[0]["pts"] > 0 and all(r[i]["pts"] >= r[i + 1]["pts"] for i in range(len(r) - 1))
    row = lambda tag: ["", "", "W", "", "", "", "배우", "", "A", "", tag, "", "", "", "확정"]
    assert carries(row("맑음")) and carries(row("성량")) and not carries(row("코믹 연기")) and not carries(row("감정 전달형"))
    assert "맑음" in AXIS["맑은 음색"] and "허스키" in AXIS["묵직한 음색"] and "섬세한 가창 표현" in AXIS["섬세한 표현"]
    assert "현실적·생활감" in AXIS["자연스러운 해석"] and "강한 캐릭터성" in AXIS["강렬한 해석"] and "맑음" in AXIS["가창"]
    assert not any(r[C_STATE] not in ("확정", "") for rows in load_tags()[0].values() for r in rows)
    assert not any(r[C_WHY] in ("전문매체·언론", "개인 후기(블로그)") for r in tag_rows()), "근거 칸 대신 근거 수준 칸을 읽고 있어요"
    actor, _, _ = load_tags()  # 다른 작품에서 온 행은 목소리 태그만, 그 작품 태그가 이미 덮은 축(음색 4개·성량·고음·딕션 각각)에는 없다. 인터뷰 행은 옮기지 않는다
    for (w, a), rows in actor.items():
        own = {VOICE_AXIS[x[C_TAG]] for x in rows if x[C_WORK] == w and x[C_TAG] in VOICE_AXIS and not is_official(x)}
        for x in rows:
            if x[C_WORK] != w:
                assert carries(x) and not is_official(x) and VOICE_AXIS[x[C_TAG]] not in own, (w, a, x[C_TAG])
    # 두 겹 배우 특성(borrow): 이 작품에 리뷰가 있어도 이 작품 태그가 덮지 않는 축의 다른 작품 목소리를 더한다
    brow = lambda w, a, tag, level="전문매체·언론", typ="배우": ["", "", w, "2026", "", "", typ, "역", a, "", tag, "", "src", "link", "확정", level]
    act = {("W1", "A"): [brow("W1", "A", "맑음")], ("W1", "B"): [brow("W1", "B", "고음")]}
    car = {"A": [brow("W2", "A", "허스키"), brow("W2", "A", "성량"), brow("W2", "A", "딕션")], "B": [brow("W2", "B", "성량")], "C": [brow("W2", "C", "맑음"), brow("W2", "C", "부드러움")]}
    borrow(act, car, [("W1", ["A", "B", "C"]), ("W1", ["A"])])
    tg = lambda k: [x[C_TAG] for x in act.get(k, [])]
    assert tg(("W1", "A")) == ["맑음", "성량", "딕션"], tg(("W1", "A"))  # 음색 축은 이미 맑음이 덮어서 허스키는 안 옴, 성량·딕션은 옴(같은 배우가 두 번 처리돼도 한 번만)
    assert tg(("W1", "B")) == ["고음", "성량"], tg(("W1", "B"))  # 고음은 자기 축, 성량은 다른 축이라 온다
    assert tg(("W1", "C")) == ["맑음", "부드러움"], tg(("W1", "C"))  # 이 작품 리뷰가 없으면 예전처럼 통째로
    assert all(x[C_WORK] == "W2" for k in (("W1", "A"), ("W1", "B")) for x in act[k][1:]), "빌려 온 행은 원래 작품 칸을 그대로 둔다(from 표시용)"
    act2 = {("W1", "A"): [brow("W1", "A", "성량")]}
    borrow(act2, {"A": [brow("W2", "A", "고음", "배우 인터뷰"), brow("W2", "A", "고음")]}, [("W1", ["A"])])
    got2 = [(x[C_WORK], lvl(x)) for x in act2[("W1", "A")]]
    assert got2 == [("W1", "전문매체·언론"), ("W2", "전문매체·언론")], got2  # 인터뷰 행은 안 옮긴다
    # 근거 수준: 열에서 읽고, 인터뷰는 점수·반대 근거에서 빠진다. 근거 구성은 출처(링크)별로 센다
    assert lvl(["x"] * 3) == "" and lvl(brow("W", "A", "맑음", "관객 후기")) == "관객 후기"
    ia = {("W", "A"): [brow("W", "A", "맑음", "배우 인터뷰")]}
    assert score({"R": "A"}, "W", pref_tags(["맑은 음색"], set()), ia, {})[:1] == (0,) and score({"R": "A"}, "W", pref_tags(["맑은 음색"], set()), ia, {})[2] == [], "인터뷰는 점수에 안 쓴다"
    ev = [("A(R)", "맑음", "w", "s", "l1", "전문매체·언론"), ("A(R)", "성량", "w", "s", "l1", "전문매체·언론"), ("B(R)", "맑음", "w", "s", "l2", "관객 후기"), ("B(R)", "고음", "w", "s", "l3", "관객 후기")]
    assert level_mix(ev) == {"전문매체": 1, "관객": 2}, level_mix(ev)
    # 근거 수준 새 값(시트 허용 목록): 배우 본인·제작진 공식은 점수·반대 근거·목소리 빌려오기에서 빠지고, 관객 3종은 '관객'으로 묶인다. 예전 값도 알아본다
    off = lambda level: [x for x in [brow("W", "A", "맑음", level)]]
    for lv in ("배우 본인·공식", "제작진·공식", "배우 인터뷰"):
        assert is_official(brow("W", "A", "맑음", lv)), lv
        assert score({"R": "A"}, "W", pref_tags(["맑은 음색"], set()), {("W", "A"): off(lv)}, {})[0] == 0, f"{lv}는 점수에 안 쓴다"
    for lv in ("전문매체·언론", "일반 관객 후기", "설문", "직접 관람", "관객 후기", "기타", ""):
        assert not is_official(brow("W", "A", "맑음", lv)), lv
    act3 = {("W1", "A"): []}
    borrow(act3, {"A": [brow("W2", "A", "성량", "제작진·공식"), brow("W2", "A", "고음", "배우 본인·공식"), brow("W2", "A", "딕션", "설문")]}, [("W1", ["A"])])
    assert [x[C_TAG] for x in act3[("W1", "A")]] == ["딕션"], "배우 본인·제작진 공식은 다른 작품 목소리로 안 옮기고, 설문은 옮긴다"
    ev2 = [("A(R)", "맑음", "w", "s", "l1", "전문매체·언론"), ("B(R)", "맑음", "w", "s", "l2", "일반 관객 후기"), ("B(R)", "고음", "w", "s", "l3", "설문"),
           ("C(R)", "성량", "w", "s", "l4", "직접 관람"), ("C(R)", "고음", "w", "s", "l4", "직접 관람"), ("D(R)", "맑음", "w", "s", "l5", "기타")]
    assert level_mix(ev2) == {"전문매체": 1, "관객": 3, "기타": 1}, level_mix(ev2)  # 관객 = 일반 관객 후기 + 설문 + 직접 관람, 같은 링크(l4)는 한 번
    assert is_curtain("뮤지컬 팬레터 스페셜 커튼콜 신인탄생") and is_curtain("260506 뮤지컬 팬레터 커튼콜 focus") and not is_curtain("[LIVE] 정유지 - Let it go | 이호광의 커튼콜") and not is_curtain("[뮤지컬 빨래] M3. 안녕"), "커튼콜 판정: 스페셜 커튼콜 포함, 방송 이름은 제외"
    # 배우 프로필: 목소리/나머지로 나뉘고, 공식 행·확정 아닌 행·작품·조합 행은 빠지고, 시드 밖 작품과 이번 캐스트에 없는 배우도 들어간다
    real_rows = tag_rows
    pr = lambda typ, a, tag, state="확정", level="전문매체·언론", work="W": ["", "", work, "2026", "", "", typ, "역", a, "", tag, "why", "src", "link", state, level, ""]
    try:
        tag_rows = lambda: [pr("배우", "최", "성량", work="시카고"), pr("배우", "최", "코믹 연기", work="데스노트"), pr("배우", "최", "성량", work="시카고"), pr("배우", "최", "맑음", level="배우 본인·공식"),
                            pr("배우", "최", "고음", level="제작진·공식"), pr("배우", "최", "절제된 연기", level="배우 본인·공식", work="멸화군"), pr("배우", "최", "감정 몰입형", level="배우 인터뷰", work="멸화군"), pr("배우", "최", "관계 중심", level="제작진·공식", work="멸화군"), pr("배우", "최", "허스키", state="검수 필요"), pr("작품", "", "군무"), pr("조합", "최", "연기합·티키타카"), pr("배우", "", "맑음"), pr("배우", "민", "부드러움", level="")]
        prof = load_actor_profiles()
        assert set(prof) == {"최", "민"}, prof
        assert [x["tag"] for x in prof["최"]["voice"]] == ["성량"] and [(x["tag"], x["work"], x["role"], x["level"]) for x in prof["최"]["role"]] == [("코믹 연기", "데스노트", "역", "전문매체·언론"), ("절제된 연기", "멸화군", "역", "배우 본인·공식"), ("감정 몰입형", "멸화군", "역", "배우 인터뷰")], prof["최"]  # 본인 해석은 연기·해석만(level 로 구분), 본인 목소리·제작진 공식은 빠진다
        assert set(prof["최"]["voice"][0]) == {"tag", "work", "season", "level", "sk"} and set(prof["최"]["role"][0]) == {"tag", "work", "role", "season", "level", "sk"}
        assert prof["민"] == {"voice": [{"tag": "부드러움", "work": "W", "season": "2026", "level": "", "sk": hashlib.sha1(b"link").hexdigest()[:8]}], "role": []}, prof["민"]  # 링크 대신 출처 해시
    finally:
        tag_rows = real_rows
    real_prof = load_actor_profiles()
    assert "성량" in [x["tag"] for x in real_prof["최재림"]["voice"]] and not any(r["level"] == "제작진·공식" for p in real_prof.values() for k in ("voice", "role") for r in p[k]) and not any(r["level"] in OFFICIAL for p in real_prof.values() for r in p["voice"]), "최재림 시카고 성량이 있고, 제작진 공식 행과 배우 본인의 목소리 행은 프로필에 없다"
    assert all(x["tag"] in VOICE for p in real_prof.values() for x in p["voice"]) and not any(x["tag"] in VOICE for p in real_prof.values() for x in p["role"]), "목소리/나머지 구분이 사전 하위 영역과 같다"
    assert VOICE_AXIS["맑음"] == VOICE_AXIS["허스키"] == "음색" and VOICE_AXIS["성량"] == "성량", VOICE_AXIS
    # 작품 태그: 대상 유형 '작품'·확정만, 대분류(열)가 같이 나간다. 배우 점수에는 안 섞인다
    real_rows = tag_rows
    wr = lambda typ, tag, state, g="작품 · 소재", work="W": ["", "", work, "2026", "", "", typ, "", "", "", tag, "why", "src", "link", state, "전문매체·언론", g]
    try:
        tag_rows = lambda: [wr("작품", "로맨스", "확정"), wr("작품", "가족", "검수 필요"), wr("배우", "맑음", "확정", ""), wr("작품", "성장", ""), wr("작품", "", "확정"), wr("작품", "판타지·초자연", "확정", work="")]
        got = load_work_tags()
        assert {w: [r[C_TAG] for r in rows] for w, rows in got.items()} == {"W": ["로맨스", "성장"]}, got
        assert group(got["W"][0]) == "작품 · 소재" and group(["x"] * 5) == "", "대분류 열이 없는 예전 행은 빈 문자열"
    finally:
        tag_rows = real_rows
    real = load_work_tags()
    assert real and all(group(r).startswith("작품 ·") and r[C_TYPE] == "작품" for rows in real.values() for r in rows), "작품 태그 행의 대분류가 작품 ·으로 시작한다"
    assert WORK_TAG_LABELS and all(g.startswith("작품 ·") for g in WORK_TAG_LABELS.values()) and "파멸" in WORK_TAG_LABELS and not any(t in WORK_TAG_LABELS for t in ("맑음", "성량"))
    # 작품 태그 → 앱: 작품 이름이 시드 작품명이거나 KOPIS 현재 공연 제목과 '정확히' 같은 것만 붙고, 이름이 다른 것은 버리지 않고 비슷한 제목과 함께 경고 목록으로 나온다
    lr = lambda name: wr("작품", "로맨스", "확정", work=name)
    linked, lost = link_work_tags({"시드극": [lr("시드극")], "공연 A [대학로]": [lr("공연 A [대학로]")], "공연 A": [lr("공연 A")], "끝난극": [lr("끝난극")]}, {"시드극"}, ["공연 A [대학로]", "공연 B"])
    assert set(linked) == {"시드극", "공연 A [대학로]"} and lost == [("공연 A", "공연 A [대학로]"), ("끝난극", "")], (linked, lost)
    # 최근 KOPIS 파일(현재·제외 목록)에 나온 이름은 끝난 공연이라 앱엔 안 붙이고 경고 목록에서도 빠진다 — 어디에도 없는 이름만 남는다
    linked2, lost2 = link_work_tags({"시드극": [lr("시드극")], "끝난극": [lr("끝난극")], "오타극": [lr("오타극")]}, {"시드극"}, ["공연 B"], {"끝난극", "다른 끝난 공연"})
    assert set(linked2) == {"시드극"} and lost2 == [("오타극", "")], (linked2, lost2)
    import tempfile
    with tempfile.TemporaryDirectory() as kd:
        head_k = "mt20id\t작품\t공연장\t시작\t끝\t상태\t출연진\t포스터URL\t관람연령\t러닝타임\t공연시간\t예매처링크\t시드작품\t시드공연일치\n"
        (Path(kd) / "kopis_current_2026-10-10.tsv").write_text(head_k + "P1\t동아줄\t홀\t\t\t\t\t\t\t\t\t\t\t\nP2\tKOPIS 제목\t홀\t\t\t\t\t\t\t\t\t\t시드극\tY\n", encoding="utf-8")
        (Path(kd) / "kopis_current_2026-10-10_excluded.tsv").write_text("mt20id\t작품\t공연장\t시작\t끝\t상태\t제외사유\nP3\t제외된 공연\t홀\t\t\t\t아동\n", encoding="utf-8")
        (Path(kd) / "venue_area_x.tsv").write_text("공연장\t구분\n우리 홀\t대학로\n", encoding="utf-8")
        assert load_known_titles(kd) == {"동아줄", "KOPIS 제목", "시드극", "제외된 공연"}, load_known_titles(kd)
        assert load_known_titles(Path(kd) / "none") == set()
    # 내보내기(export_js)까지: 현재 공연 제목으로 된 작품 태그가 data.js 의 workTags 에 실린다(가짜 태그 행, 임시 폴더에 쓴다)
    import contextlib, io, tempfile
    first = load_current_shows()["shows"][0]["title"]
    real_rows = tag_rows
    fake_tag = next(t for t in WORK_TAG_LABELS if t not in {r[C_TAG] for r in real.get(first, [])})  # 이 공연의 실제 태그와 안 겹치는 태그로 가짜 행을 만든다(실제 태그가 늘어도 안 깨지게)
    try:
        tag_rows = lambda: real_rows() + [wr("작품", fake_tag, "확정", g=WORK_TAG_LABELS[fake_tag], work=first), wr("작품", "파멸", "확정", work=first + "?")]
        with tempfile.TemporaryDirectory() as td, contextlib.redirect_stdout(io.StringIO()) as out:
            export_js(str(Path(td) / "data.js"))
            js_text = (Path(td) / "data.js").read_text(encoding="utf-8")
            exp = json.loads(js_text.split("window.PICKLE_DATA = ", 1)[1].split(";\nwindow.PICKLE_TRACK", 1)[0].rstrip().rstrip(";"))
    finally:
        tag_rows = real_rows
    assert fake_tag in [r["tag"] for r in exp["workTags"][first]] and all(set(r) == {"tag", "group"} for rows in exp["workTags"].values() for r in rows) and first + "?" not in exp["workTags"], "KOPIS 현재 공연에 작품 태그가 붙는다(끼워 넣은 가짜 행을 이 공연에 없던 태그로 찾는다) · 작품 태그 행은 tag·group 만"
    # data.js 는 공개 파일: 태그 근거 문장(why)·출처 이름(src)·링크(link)·회차(show)가 없다. 같은 출처인지만 알아보는 sk(해시 8자리)와 계산용 level 만 있다
    def keys_in(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from keys_in(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys_in(v)
    assert "why" not in set(keys_in(exp)), "data.js 어디에도 why 키가 없다"
    for name in ("actorTags", "comboTags", "workTags", "actorProfiles"):
        assert not set(keys_in(exp[name])) & {"why", "link", "src", "show"}, f"{name} 에 근거 필드가 없다"
    tag_cells = [r for w in exp["actorTags"].values() for rows in w.values() for r in rows] + [r for rows in exp["comboTags"].values() for r in rows]
    assert tag_cells and all(re.fullmatch(r"[0-9a-f]{8}", r["sk"]) and set(r) <= {"role", "tag", "season", "level", "sk", "from", "a", "b"} for r in tag_cells), "배우·조합 태그 행은 role·tag·season·level·sk(·from·a·b)만"
    evid = [x[C_WHY].strip() for x in real_rows() if len(x[C_WHY].strip()) > 12][:40] + [x[C_LINK].strip() for x in real_rows() if x[C_LINK].strip().startswith("http")][:40]
    assert evid and not any(e in js_text for e in evid), "실제 시트의 근거 문장·근거 링크가 data.js 글자 안에 하나도 없다"
    known = load_known_titles()
    assert "경고: 작품 태그의 작품 '" + first + "?'" in out.getvalue() and {w for w in real if w in {x[0] for x in RUNS}} <= set(exp["workTags"]), "이름이 다른 작품 태그는 경고, 시드 작품 태그는 그대로"
    assert not any(f"작품 '{w}'" in out.getvalue() for w in real if w in known), "최근 KOPIS 파일에 나온(끝난 공연 포함) 이름의 작품 태그는 경고하지 않는다(실제 시트의 끝난 공연 포함)"
    assert any(w == "사의찬미" and "2ND STAGE" in label for w, label, *_ in RUNS), "지금 하는 사의찬미는 2ND STAGE(9/8~10/25), 끝난 1ST STAGE(6/16~9/6)와 헷갈리지 않게 공연 이름에 적는다"
    # KOPIS 현재 공연 → 앱 데이터: 시드(제목이 RUNS와 맞는 공연)·관람 연령 만 18세 이상·이미 끝난 공연은 빠지고, 출연진 없는 공연은 noCast 로 남고, 출연진은 7명까지, 포스터·링크는 https
    import tempfile
    head = ["mt20id", "작품", "공연장", "시작", "끝", "상태", "출연진", "포스터URL", "관람연령", "러닝타임", "공연시간", "예매처링크", "시드작품", "시드공연일치"]
    mk = lambda i, title, cast="가, 나, 다 등", age="만 7세 이상", end="2026-12-31", seed="", poster="http://www.kopis.or.kr/upload/pfmPoster/a.jpg", tick="A=http://x.com/1 | B=www.tmon.co.kr/deal/2 | C=": \
        [i, title, "홀", "2026-09-01", end, "공연중", cast, poster, age, "100분", "화요일(19:30)", tick, seed, "Y" if seed else ""]
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "kopis_current_2026-10-10.tsv"
        f.write_text("\n".join("\t".join(r) for r in [head, mk("OK1", "일반 공연", cast="a1, a2, a3, a4, a5, a6, a7, a8, a9 등"), mk("SEED", "엘리자벳", seed="엘리자벳"), mk("ADULT", "성인극", age="만 19세 이상"), mk("A18", "열여덟", age="만 18세 이상"),
                                                      mk("NOCAST", "배우없음", cast=""), mk("ENDED", "끝난 공연", end="2026-10-01"), mk("OK2", "아동 아닌 가족극", age="전체 관람가"), mk("OK3", "열일곱", age="만 17세 이상")]) + "\n", encoding="utf-8")
        cur = load_current_shows(date(2026, 10, 10), f)
    assert [x["id"] for x in cur["shows"]] == ["NOCAST", "OK2", "OK3", "OK1"], [x["id"] for x in cur["shows"]]  # 제목순(출연진 없는 공연 · 아동 아닌 가족극 · 열일곱 · 일반 공연)
    assert cur["asOf"] == "2026-10-10" and all(x["id"] not in ("SEED", "ADULT", "A18", "ENDED") for x in cur["shows"]), "시드·성인·끝난 공연은 빠진다"
    nc = next(x for x in cur["shows"] if x["id"] == "NOCAST")
    assert nc.get("noCast") is True and nc["cast"] == [] and all("noCast" not in x for x in cur["shows"] if x["id"] != "NOCAST"), "출연진 없는 공연은 빼지 않고 cast 가 빈 채 noCast: true (다른 공연엔 이 키가 없다)"
    ok1 = next(x for x in cur["shows"] if x["id"] == "OK1")
    assert ok1["cast"] == ["a1", "a2", "a3", "a4", "a5", "a6", "a7"] and ok1["poster"] == "https://kopis.or.kr/upload/pfmPoster/a.jpg" and ok1["tickets"] == [{"name": "A", "url": "http://x.com/1"}, {"name": "B", "url": "https://www.tmon.co.kr/deal/2"}], ok1
    # 본명 → 활동명: '적용 공연'에 든 공연에서만 바뀐다(같은 이름도 다른 공연에서는 그대로, 적용 공연이 빈 행은 아무것도 안 바꿈), 대조표에 없는 이름은 KOPIS 표기 그대로
    with tempfile.TemporaryDirectory() as td:
        f2 = Path(td) / "kopis_current_2026-10-10.tsv"
        f2.write_text("\n".join("\t".join(r) for r in [head, mk("CH", "시카고 [서울]", cast="이지연, 최정원, 박은혜, 김수민 등"), mk("AN", "아나키스트 [대학로]", cast="이지연, 김도빈 등"), mk("OT", "오셀로와 이아고", cast="김수민, 정민 등"),
                                                      mk("TW", "두 도시 이야기", cast="정기열, 린아, 이지연, 고은성 등")]) + "\n", encoding="utf-8")
        af = Path(td) / "aliases.tsv"
        af.write_text("활동명\tKOPIS/본명 표기\t근거 링크\t확인 방법\t적용 공연\n린아\t이지연\turl\tm\t엘리자벳, 시카고 [서울]\n카이\t정기열\turl\tm\t엘리자벳, 두 도시 이야기\n아이비\t박은혜\turl\tm\t시카고 [서울]\n"
                      "김지온\t김수민\turl\tm\t\n윤나무\t김태훈\turl\tm\t\n", encoding="utf-8")
        al = load_aliases(af)
        assert al == {"엘리자벳": {"이지연": "린아", "정기열": "카이"}, "시카고 [서울]": {"이지연": "린아", "박은혜": "아이비"}, "두 도시 이야기": {"정기열": "카이"}}, dict(al)
        cs = {x["id"]: x for x in load_current_shows(date(2026, 10, 10), f2, al)["shows"]}
        assert cs["CH"]["cast"] == ["린아", "최정원", "아이비", "김수민"], cs["CH"]["cast"]  # 시카고 [서울]: 이지연→린아, 박은혜→아이비, 적용 공연이 빈 김지온 행(김수민)은 그대로
        assert cs["AN"]["cast"] == ["이지연", "김도빈"], "아나키스트 [대학로]의 이지연은 같은 사람인지 모르니 그대로"
        assert cs["OT"]["cast"] == ["김수민", "정민"], "적용 공연이 빈 행은 아무것도 바꾸지 않는다"
        assert cs["TW"]["cast"] == ["카이", "린아", "이지연", "고은성"], "두 도시 이야기: 정기열→카이만, 린아는 이미 있고 이지연은 이 공연에 적용 안 됨"
        assert load_current_shows(date(2026, 10, 10), f2, {})["shows"][0]["cast"] and {x["id"]: x["cast"] for x in load_current_shows(date(2026, 10, 10), f2, {})["shows"]}["CH"][0] == "이지연", "대조표가 비면 그대로"
        assert set(cs["CH"]) == {"id", "title", "venue", "start", "end", "status", "cast", "poster", "age", "runtime", "times", "tickets", "price"}, "대조표·본명은 data.js 로 나가는 필드에 없다"
        assert alias_unmatched(f2, al) == ["엘리자벳"], "현재 공연 목록에 없는 적용 공연(엘리자벳은 이 가짜 목록에 없음)을 알려 준다"
    assert load_aliases(Path("/nonexistent/aliases.tsv")) == {} and all(len(v) >= 1 for v in load_aliases().values()), "실제 대조표를 읽는다"
    real_al = load_aliases()
    assert real_al["시카고 [서울]"]["이지연"] == "린아" and "이지연" not in real_al.get("아나키스트 [대학로]", {}) and real_al["두 도시 이야기"]["정기열"] == "카이" and not any("김수민" in m or "이승원" in m or "김다혜" in m for m in real_al.values()), "7c 확인 안 된 이름은 적용 안 함"
    # 가격 안내(상세 캐시 XML)와 시드 작품 정보(KOPIS 시드 행)
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "PX.xml").write_text("<dbs><db><mt20id>PX</mt20id><pcseguidance>R석 120,000원, S석 90,000원\n전석 &amp; 할인</pcseguidance></db></dbs>", encoding="utf-8")
        assert kopis_price("PX", td) == "R석 120,000원, S석 90,000원 전석 & 할인" and kopis_price("없는id", td) == "" and kopis_price("PX", Path(td) / "nodir") == ""
        sf = Path(td) / "kopis_current_2026-10-10.tsv"
        sf.write_text("\n".join("\t".join(r) for r in [head, mk("S1", "시카고 [서울]", seed="시카고", age="만 14세 이상"), mk("S2", "빨래방", seed="빨래")[:-1] + ["N"], mk("OK", "일반")]) + "\n", encoding="utf-8")
        assert load_seed_info(sf) == {"시카고": {"age": "만 14세 이상", "runtime": "100분", "times": "화요일(19:30)"}}, load_seed_info(sf)
    real_seed = load_seed_info()
    assert real_seed and all(v["age"] and v["runtime"] for v in real_seed.values()) and "시카고" in real_seed, "실제 시드 작품 정보"
    assert min_age("만 19세 이상") == 19 and min_age("전체 관람가") == 0 and min_age("12개월 이상") == 0 and min_age("") == 0 and https_url("") == "" and https_url("javascript:alert(1)") == ""
    assert load_current_shows(date(2026, 10, 10), None)["asOf"], "실제 data/kopis_current_*.tsv 최신을 읽는다"
    real_cur = load_current_shows()["shows"]
    assert real_cur and all((s["cast"] or s.get("noCast")) and len(s["cast"]) <= 7 and bool(s["cast"]) != bool(s.get("noCast")) and min_age(s["age"]) < 18 and (not s["poster"] or s["poster"].startswith("https://")) and s["end"] >= date.today().isoformat() for s in real_cur) and not any(s["title"].replace(" ", "").find(r[0].replace(" ", "")) >= 0 for s in real_cur for r in RUNS), "실제 데이터에도 같은 규칙(시드 제목 포함 공연 없음)"
    # 앱 첫 화면의 취향 카드(app/index.html <taste-first>)가 쓰는 작품 태그 이름·배우 취향 키가 태그 사전과 같은지(콤마가 든 '클래식, 오페라' 같은 이름이 어긋나도 조용히 안 맞는다)
    blk = re.search(r"// <taste-first>(.*?)// </taste-first>", (Path(__file__).parent / "app" / "index.html").read_text(encoding="utf-8"), re.S).group(1)
    card_tags = [t for lst in re.findall(r"tags: \[([^\]]*)\]", blk) for t in re.findall(r'"([^"]+)"', lst)]
    assert len(card_tags) >= 20 and all(t in WORK_TAG_LABELS for t in card_tags), [t for t in card_tags if t not in WORK_TAG_LABELS]
    assert set(re.findall(r'\["([^"]+)", "([^"]+)", "[^"]+", "[^"]+", "[^"]+"\]', blk)) == {(l, r) for _, l, r, *_ in AXES}, "앱 취향 5축 키가 AXES와 다르다"
    # 점수 = 서로 다른 (배우, 취향) 쌍의 수. 같은 태그가 여러 번 나와도 1점(리뷰 양이 점수가 되지 않게)
    srow = lambda a, tag: ["", "", "W", "", "", "", "배우", "", a, "", tag, "", "", "", "확정"]
    sc = lambda tags, prefs: score({"R": "A"}, "W", pref_tags(prefs, set()), {("W", a): [srow(a, t) for t in ts] for a, ts in tags.items()}, {})
    assert sc({"A": ["맑음"] * 3}, ["맑은 음색"])[0] == 1, "같은 태그 3번 = 1점"
    assert sc({"A": ["맑음", "부드러움"]}, ["맑은 음색"])[0] == 1, "같은 취향 안의 다른 태그도 1점"
    assert sc({"A": ["맑음", "성량"]}, ["맑은 음색", "성량"])[0] == 2, "취향이 둘이면 각각 1점"
    crow = ["", "", "W", "", "", "", "조합", "", "A", "B", "연기합·티키타카", "", "", "", "확정"]
    assert score({"R1": "A", "R2": "B"}, "W", pref_tags(["케미"], set()), {}, {("W", frozenset(["A", "B"])): [crow] * 3})[0] == 1, "조합 태그도 (조합, 취향)당 1점"
    # 반대 근거: 점수는 안 깎고, 동점 순서와 표시에만 쓴다. 가창↔연기는 반대가 아니다
    sc2 = lambda tags, prefs: score({"R1": "A", "R2": "B"}, "W", pref_tags(prefs, set()), {("W", a): [srow(a, t) for t in ts] for a, ts in tags.items()}, {})
    pts, _, _, _, bad = sc2({"A": ["맑음"], "B": ["허스키", "허스키"]}, ["맑은 음색"])  # A는 맞고 B는 반대쪽 태그만 있다
    assert pts == 1 and len(bad) == 2 and {b[1] for b in bad} == {"허스키"} and all(b[0].startswith("B(") for b in bad), (pts, bad)
    # 한 배우가 같은 축의 맞는 태그와 반대 태그를 다 가졌으면(성량도 섬세함도 있는 배우) 그 축의 반대 근거는 없다. 점수는 그대로 1점
    pts, _, _, _, bad = sc({"A": ["성량", "섬세한 가창 표현"]}, ["강한 성량"])
    assert pts == 1 and bad == [], (pts, bad)
    pts, _, _, _, bad = sc({"A": ["맑음", "허스키"]}, ["맑은 음색"])
    assert pts == 1 and bad == [], (pts, bad)
    want = lambda ps: set().union(*pref_tags(ps, set()).values())
    assert opposite_tags(pref_tags(["가창"], set()), want(["가창"])) == {} and opposite_tags(pref_tags(["연기"], set()), want(["연기"])) == {}, "가창 취향엔 반대 근거가 없다"
    opp = opposite_tags(pref_tags(["맑은 음색"], set()), want(["맑은 음색"]))["맑은 음색"]
    assert "허스키" in opp and "맑음" not in opp, opp
    # 순서: 점수 → 반대 근거 적은 순 → 이른 날짜. 태그 수(known)는 안 본다
    g = lambda pts, nbad, d, known=0: {"pts": pts, "bad": [None] * nbad, "shows": [(d, "월", "19:30", [])], "known": known}
    got = sorted([g(1, 2, "2026-10-01"), g(1, 0, "2026-10-09"), g(2, 5, "2026-10-20")], key=rank_key)
    assert [(x["pts"], len(x["bad"])) for x in got] == [(2, 5), (1, 0), (1, 2)], "동점이면 반대 근거가 적은 쪽이 먼저"
    assert sorted([g(1, 0, "2026-10-09", 0), g(1, 0, "2026-10-01", 0)], key=rank_key)[0]["shows"][0][0] == "2026-10-01", "다 같으면 이른 날짜"
    assert sorted([g(1, 0, "2026-10-09", 99), g(1, 0, "2026-10-01", 0)], key=rank_key)[0]["shows"][0][0] == "2026-10-01", "태그가 많이 쌓인 캐스트가 먼저 오지 않는다"
    r, _, _ = recommend("엘리자벳", date(2026, 10, 4), date(2026, 10, 31), ["맑은 음색", "가창"])
    assert all(rank_key(r[i]) <= rank_key(r[i + 1]) for i in range(len(r) - 1))
    # 사전 '이런 표현이면 이 태그' → TAG_PHRASES. 쉼표로 나뉘고, 확정이 아닌 태그(후보·검수 필요 등)는 안 들어간다
    assert "성량이 압도적" in TAG_PHRASES["성량"] and "파워풀하다" in TAG_PHRASES["성량"] and "맑다" in TAG_PHRASES["맑음"], TAG_PHRASES.get("성량")
    # 사전에서 '확정'(또는 빈 값)이 아닌 태그(후보·검수 필요 등)는 표현·설명·취향축 어디에도 안 나간다(특정 태그 이름에 기대지 않는다). 확정 태그는 표현이 있으면 나간다
    drows = list(csv.DictReader(open(DICT, encoding="utf-8"), delimiter="\t"))
    state = lambda r: (r.get("태그 상태") or "").strip()
    cand = {r["태그"].strip() for r in drows if (r.get("태그") or "").strip() and state(r) not in ("", "확정")}
    sure = {r["태그"].strip() for r in drows if (r.get("태그") or "").strip() and state(r) in ("", "확정") and (r.get("이런 표현이면 이 태그") or "").strip()}
    assert not cand & set(TAG_PHRASES) and not cand & set(ACTOR_TAG_LABELS) and not cand & set(WORK_TAG_LABELS) and sure == set(TAG_PHRASES), (cand & set(TAG_PHRASES), sure ^ set(TAG_PHRASES))
    import tempfile  # 확정 규칙 자체는 가짜 사전으로: 확정·빈 값만 들어오고 후보·검수 필요·그 밖의 값은 빠진다
    with tempfile.TemporaryDirectory() as td:
        fake = Path(td) / "dict.tsv"
        fake.write_text("대분류\t태그\t하위 영역\t뜻\t이런 표현이면 이 태그\t연결 취향축\t태그 상태\n"
                        "배우 · 신체 표현\t가짜후보\t표정\t뜻1\t후보표현\t\t후보\n배우 · 신체 표현\t가짜확정\t표정\t뜻2\t확정표현, 또다른표현\t\t확정\n"
                        "작품 · 소재\t가짜후보작품\t소재\t뜻3\t\t\t후보\n"
                        "배우 · 신체 표현\t가짜검수\t표정\t뜻4\t검수표현\t\t검수 필요\n작품 · 소재\t가짜검수작품\t소재\t뜻5\t\t\t검수 필요\n"
                        "배우 · 신체 표현\t가짜보류\t표정\t뜻6\t보류표현\t\t보류\n배우 · 신체 표현\t가짜빈값\t표정\t뜻7\t빈값표현\t\t\n", encoding="utf-8")
        real_dict, DICT = DICT, fake
        try:
            loaded = load_dict()
        finally:
            DICT = real_dict
    fphr, flab, fwork = loaded[5], loaded[2], loaded[7]
    assert "가짜후보" not in fphr and "가짜후보" not in flab and "가짜후보작품" not in fwork and fphr["가짜확정"] == ["확정표현", "또다른표현"] and flab["가짜확정"] == "뜻2", (fphr, flab, fwork)
    assert not {"가짜검수", "가짜보류"} & (set(fphr) | set(flab)) and "가짜검수작품" not in fwork and not any(t in sum(loaded[0].values(), []) for t in ("가짜검수", "가짜보류", "가짜후보")), "'검수 필요'·그 밖의 상태 태그는 표현·설명·작품 태그·취향축 어디에도 안 나간다"
    assert fphr["가짜빈값"] == ["빈값표현"] and flab["가짜빈값"] == "뜻7", "상태 칸이 비어 있으면 확정으로 본다(예전 사전과 호환)"
    assert all(isinstance(ps, list) and ps and all(p == p.strip() and "," not in p for p in ps) for ps in TAG_PHRASES.values())
    vt = voice_tags()  # 하위 영역 음색·파워·기술 = 목소리 태그. 연기·해석·표현(감정 전달형 등)은 들어가지 않는다
    assert {"맑음", "성량", "고음", "딕션"} <= set(vt) and "감정 전달형" not in vt and "섬세한 가창 표현" not in vt and "코믹 연기" not in vt, vt
    assert set(vt) == VOICE and len(vt) == len(set(vt)), vt
    # 기록 전송 설정: 공개 키만 앱에 들어간다. 비밀 키·이상한 주소·빈 값은 연습 모드, 키는 이유 글에 안 나온다
    jwt = lambda role: "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=") + ".c2ln"
    U = "https://abcdefgh.supabase.co"
    cfg, why = track_config({"SUPABASE_URL": U + "/", "SUPABASE_ANON_KEY": jwt("anon")}.get)
    assert cfg == {"mode": "live", "url": U, "key": jwt("anon"), "table": "events"} and "켜짐" in why, (cfg, why)
    cfg, why = track_config({"SUPABASE_URL": U, "SUPABASE_ANON_KEY": "sb_publishable_abc123"}.get)
    assert cfg and cfg["key"] == "sb_publishable_abc123"
    for env in ({}, {"SUPABASE_URL": U}, {"SUPABASE_URL": "http://x.supabase.co", "SUPABASE_ANON_KEY": jwt("anon")}, {"SUPABASE_URL": "https://evil.example.com", "SUPABASE_ANON_KEY": jwt("anon")},
                {"SUPABASE_URL": U, "SUPABASE_ANON_KEY": jwt("service_role")}, {"SUPABASE_URL": U, "SUPABASE_ANON_KEY": "sb_secret_abc"}, {"SUPABASE_URL": U, "SUPABASE_ANON_KEY": "아무거나"}):
        cfg, why = track_config(env.get)
        assert cfg is None and "연습 모드" in why and all(v not in why for v in env.values() if len(v) > 12 and v != U), (env, why)
    # 공연장 구분(대학로 / 대학로 외)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "venue_area_test.tsv"
        f.write_text("공연장\t구분\t주소\t근거\n링크아트센터 드림1관\t대학로\t서울\t표\n블루스퀘어 우리은행홀\t대학로 외\t서울\t표\n이상한극장\t확인 필요\t\t\n", encoding="utf-8")
        ar, src = load_venue_areas(f)
    assert src == "venue_area_test.tsv" and len(ar) == 3, (ar, src)
    assert area_for("링크아트센터 드림1관", "x", ar) == "대학로" and area_lookup("링크아트센터  드림1관", ar) == "대학로", "공백·기호만 달라도 같은 공연장"
    assert area_for("링크아트센터 드림2관", "대학로극", ar) == "대학로 외" and area_lookup("링크아트센터 드림2관", ar) is None, "표에 없는 공연장은 대학로 외(공연명의 '대학로'도 안 본다) · 찾으면 None"
    assert area_for("블루스퀘어 우리은행홀", "FATED [대학로]", ar) == "대학로 외", "표가 있으면 공연명의 '대학로'보다 표가 먼저"
    assert area_for("이상한극장", "", ar) == "대학로 외", "확인 필요는 대학로 외"
    assert area_for("모르는 홀", "A [대학로]", ar) == "대학로 외" and area_for("대학로예술극장", "", ar) == "대학로 외", "표가 있으면 표에 없는 공연장은 모두 대학로 외"
    assert area_for("대학로예술극장", "", {}) == "대학로" and area_for("", "", None) == "대학로 외" and area_for("모르는 홀", "A [대학로]", None) == "대학로" and load_venue_areas(Path("/nonexistent/x.tsv")) == ({}, ""), "표가 없어도 동작"
    # 지역(홈의 지역 칩): 대학로 구분이면 '대학로', 아니면 주소의 서울 ○○구(종로구 대학로 밖 포함), 서울 주소가 아니거나 주소가 없으면 ''
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "venue_area_test.tsv"
        f.write_text("공연장\t구분\t주소\t근거\n대학로홀\t대학로\t서울 종로구 이화동\t표\n세종홀\t대학로 외\t서울 종로구 세종로\t표\n블루홀\t대학로 외\t서울 용산구 한남동\t표\n"
                     "서울특별시홀\t대학로 외\t서울특별시 송파구 잠실동\t표\n대구홀\t대학로 외\t대구 달서구\t표\n주소없는홀\t확인 필요\t\t\n", encoding="utf-8")
        rg = load_venue_regions(f)
    assert [region_for(v, rg) for v in ("대학로 홀", "세종홀", "블루홀", "서울특별시홀", "대구홀", "주소없는홀", "모르는 홀")] == ["대학로", "종로구", "용산구", "송파구", "", "", ""], rg
    assert region_for("x", None) == "" and load_venue_regions(Path("/nonexistent/x.tsv")) == {}
    real_rg = load_venue_regions()
    assert real_rg and all(v == "" or v == "대학로" or v.endswith("구") for v in real_rg.values()) and "종로구" in real_rg.values() and "대학로" in real_rg.values(), "실제 구분 표에서 지역 이름이 나온다"
    # 인기 순위: 주간·월간 중 가장 좋은 순위, 순위 없는 칸만 있으면 제외, 시드 작품은 kopis_current 의 시드작품(제목·공연장 일치 Y) ID 로 찾는다
    with tempfile.TemporaryDirectory() as td:
        b = Path(td) / "kopis_boxoffice_test.tsv"
        b.write_text("mt20id\t공연명\t주간순위\t월간순위\t기준일\nPA\t가\t3\t1\t2026-10-11\nPB\t나\t\t7\t2026-10-11\nPC\t다\t5\t\t2026-10-11\nPD\t라\t\t\t2026-10-11\n", encoding="utf-8")
        assert load_boxoffice(b) == ({"PA": 1, "PB": 7, "PC": 5}, "2026-10-11") and load_boxoffice(Path("/nonexistent/x.tsv")) == ({}, "")
        c = Path(td) / "kopis_current_test.tsv"
        c.write_text("\t".join(["mt20id", "작품", "공연장", "시작", "끝", "상태", "출연진", "포스터URL", "관람연령", "러닝타임", "공연시간", "예매처링크", "시드작품", "시드공연일치"]) + "\n"
                     + "\n".join("\t".join([i, "t", "v", "", "", "", "", "", "", "", "", "", w, y]) for i, w, y in [("PA", "시드가", "Y"), ("PB", "시드가", "Y"), ("PX", "시드나", "N"), ("PY", "", "")]) + "\n", encoding="utf-8")
        assert load_seed_ids(c) == {"시드가": ["PA", "PB"]}, "공연장이 안 맞는(N) 행·시드가 아닌 행은 빠진다"
    real_ranks, real_asof = load_boxoffice()
    assert real_ranks and real_asof and all(isinstance(v, int) and v > 0 for v in real_ranks.values()), "실제 예매상황판 순위 파일"
    # 내보내기: currentShows·works 에 region·popularity 가 모두 있다(순위 없으면 null)
    import contextlib, io
    with tempfile.TemporaryDirectory() as td, contextlib.redirect_stdout(io.StringIO()):
        export_js(str(Path(td) / "data.js"))
        exp = json.loads((Path(td) / "data.js").read_text(encoding="utf-8").split("window.PICKLE_DATA = ", 1)[1].split(";\nwindow.PICKLE_TRACK", 1)[0].rstrip().rstrip(";"))
    # 기록 전송 설정: 키가 있으면 기본은 켜짐(PICKLE_TRACK 이 들어간다), --no-track 이면 키가 있어도 안 들어간다(데이터만 갱신해서 배포할 때). 진짜 키 대신 가짜 공개 키로 확인한다
    fake_env = {"SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_ANON_KEY": "sb_publishable_selftest"}.get
    with tempfile.TemporaryDirectory() as td, contextlib.redirect_stdout(io.StringIO()) as tout:
        on, off = Path(td) / "on.js", Path(td) / "off.js"
        export_js(str(on), env_get=fake_env)
        export_js(str(off), track=False, env_get=fake_env)
        t_on, t_off = on.read_text(encoding="utf-8"), off.read_text(encoding="utf-8")
    assert "window.PICKLE_TRACK = " in t_on and '"mode": "live"' in t_on and "https://abc.supabase.co" in t_on, "키가 있으면 기본은 기록 켜짐"
    assert "PICKLE_TRACK" not in t_off and "sb_publishable_selftest" not in t_off and "abc.supabase.co" not in t_off and "--no-track" in tout.getvalue(), "--no-track 이면 키가 있어도 PICKLE_TRACK 이 없다(데이터는 그대로)"
    assert t_off.split("window.PICKLE_DATA = ", 1)[1].split(";\n", 1)[0] == t_on.split("window.PICKLE_DATA = ", 1)[1].split(";\n", 1)[0], "기록 설정만 다르고 데이터 부분은 같다"
    items = exp["currentShows"] + exp["works"]
    assert all("region" in x and isinstance(x["region"], str) and "popularity" in x and (x["popularity"] is None or isinstance(x["popularity"], int)) for x in items), "region·popularity 키"
    assert any(x["popularity"] for x in exp["currentShows"]) and any(x["popularity"] for x in exp["works"]) and exp["popularityAsOf"] == real_asof, "KOPIS 공연과 시드 작품 모두에 순위가 붙는다"
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work")
    ap.add_argument("--from", dest="lo")
    ap.add_argument("--to", dest="hi")
    ap.add_argument("--prefs", nargs="+", default=[])
    ap.add_argument("--actor", nargs="*", help="이 배우들이 나오는 회차만. 같은 배역이면 '또는', 다른 배역이면 '그리고'")
    ap.add_argument("--top", type=int, default=2)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--export", metavar="PATH", help="가안 앱용 데이터(JS)를 이 경로에 쓴다. 예: app/data.js")
    ap.add_argument("--no-track", action="store_true", help="--export 와 같이: .env 에 Supabase 키가 있어도 PICKLE_TRACK(기록 전송 설정)을 data.js 에 안 넣는다(기록을 켜기 전에 데이터만 갱신할 때). 기본은 키가 있으면 켜짐")
    ap.add_argument("--build", action="store_true", help="data/schedules/*.tsv에서 회차 캐스팅 TSV를 다시 만든다 (시트에 붙여 넣는 원본)")
    a = ap.parse_args()
    if a.build:
        build_schedule()
        sys.exit()
    if a.selftest:
        selftest()
        sys.exit()
    if a.export:
        export_js(a.export, track=not a.no_track)
        sys.exit()
    if not (a.work and a.lo and a.hi and a.prefs):
        ap.error("--work, --from, --to, --prefs 가 필요해요")
    lo, hi = date.fromisoformat(a.lo), date.fromisoformat(a.hi)
    ranked, _, weights = recommend(a.work, lo, hi, a.prefs, a.actor, a.top)
    print(card(a.work, lo, hi, a.prefs, ranked, weights, a.actor, a.top))
