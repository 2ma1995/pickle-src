"""탐색 설문 주관식 3문항 키워드 태깅.

  python3 survey_tags.py data/survey/responses_2026-10-06.tsv   # 태깅 결과·집계를 data/survey/ 에 쓴다
  python3 survey_tags.py --selftest

입력은 연락처·X 아이디를 뺀 응답 TSV(번호, 응답 구분, 작품, 고려한 배우, 회차 영향, 고른 이유, 회피 경험, 피한 이유, 우려·요청).
태그는 키워드 규칙이라 한 답에 여러 개 붙을 수 있다. 규칙에 안 걸린 답은 '기타'로 남겨 사람이 본다.
ponytail: 키워드 매칭이라 반어·부정문("본 적 없는")은 규칙으로만 막는다. 응답이 수천 건이 되면 사람 검수 표본을 따로 뽑을 것.
"""
import csv, re, sys
from collections import Counter, defaultdict
from pathlib import Path

# 그 배우·조합을 고른 이유
PICK = {
    "최애·호감 배우": r"본진|최애|애배|좋아하|좋아한|좋아해|좋아했|좋아요|애정|덕질|입덕|빠져|매료|매력|호감|보고 ?싶었던 배우",
    "실력 신뢰": r"믿보배|믿고 ?보|믿고 볼 수|실력|잘하|잘함|잘해|잘 소화|소화력|레전드|안정|훌륭|뛰어|잘한다|잘 한다|잘봄",
    "가창": r"노래|가창|넘버|발성|창법|고음|성량",
    "연기·표현": r"연기|표현|디테일|코믹|애드립|웃김|춤|동작",
    "음색": r"음색|목소리",
    "해석·노선": r"해석|캐해|노선",
    "케미·페어": r"케미|페어|조합|(?<![적종])합(?!니)",
    "이미지·외모": r"이미지|외모|얼굴|잘생|외형|닮|어울리|어울릴|어울림|어울린|어울려|비주얼|인물 그 자체|귀여",
    "이전 관람 경험": r"전에|전작|이전|지난|저번|자첫(?!자막)|봤었|봤던|봤어서|본 적이 있|다른 ?(극|작품|공연|뮤지컬)|타극|초연|중계|재밌게 봐|좋게 봤|잘 봤|만났던|회전|첫 관람|연작",
    "호기심·새 조합": r"궁금|처음|못 ?봤|본 ?적 ?없|안겹치|보지 않았던|해보고 싶|전캐",
    "평판·인지도": r"추천|소문|호평|유명|들었|인기|SNS|트위터|탐라|떠들|후기|인지도|들은|고 들어서|익숙|아는 배우|잘 알던",
    "작품 자체": r"재미|재밌",
    "특별 회차": r"첫공|막공|페어막|마지막|이벤트|스콜|크로스|여배|여여|젠더프리|여성배우",
    "일정·좌석·가격": r"날짜|시간|일정|가능한|주말|낮공|좌석|자리|1열|할인|타임세일|교환권|매진|되는 날|갈 수 있|폴데",
    "동행": r"친구|같이 보자",
    "기피 배우 회피": r"피합|거르|기피|논란|보고 싶지 않|지움",
}
# 보고 싶은 배우가 있었지만 다른 배역 때문에 그 회차를 피한 이유
AVOID = {
    "논란·사생활": r"논란|사생활|병크|범죄|인성|물의|구설|공론화|문제가 된|문제되|문제가 되|문제가 있|소비하|학폭|극우|불매|경솔|소셜|발언|이슈가 있|추문",
    "개인 불호": r"불호|싫|좋아하지 않|선호하지 않|원하지 않|거르|거름|비호감|거배|믿거|절대 안|지뢰|불매|불쾌",
    "취향에 안 맞음": r"취향이 아|취향과는|취향여부|취향 노선이 아|안맞|안 맞|맞지 ?않|별로|마음에 ?들지 않|거부감",
    "가창": r"노래|가창|넘버|발성|창법|고음|성량|음정",
    "연기": r"연기(?! ?결|의 결)|대사|딕션|발음|디테일",
    "실력 부족(일반)": r"실력|못해|못함|못하|자질|부족|딸려|역량|떨어|안되|안 되|기량|기준에 안",
    "음색": r"음색|목소리|톤",
    "해석·노선": r"해석|캐해|노선|결이|연기 ?결|연기의 결",
    "케미·조합": r"케미|페어|조합|합이|(?<![적종])합(?!니)|듀엣|밸런스|어울리지 않을 것|같이 나오는|조핮",
    "이미지·외모": r"이미지|외모|얼굴|못생|비주얼|어울리지|인상",
    "몰입 방해": r"몰입|망치|망침|흐름을 깨|집중|튕겨|기분 망|기억으로 남",
    "이전 관람 실망": r"실망|지난번|이전 ?(관람|관극|회차)|예전|전에 봤|봤을 ?때|관람했을 때|기존 관람|관극경험",
    "평판·후기": r"후기|소문|불호평|지적",
    "이미 본 조합 피하기": r"겹치|이미 본|다양한 배우",
    "비용 대비 만족": r"비용|돈|공연비|아까|지불",
    "아이돌 출신": r"아이돌|가수 출신",
    "더 보고 싶은 배우": r"더 보고 ?싶은|더 마음에 드는|보고 싶은 배우가 있었|보고 싶었던 배우조합|가장 선호하는 페어|보고싶은 배우들로|만족도가 높",
    "상황 제약": r"학교|같은 날 같은 시간|컨디션|지방러|스케줄",
}
# 우려되는 점·있었으면 하는 기능
ASK = {
    "우려-평가의 주관성": r"배우 평가|굳어지|분류|큐레이션|주관|객관|사바사|씨왓|호불호|반감|다툼|논란이 될|대립|추상적|모호|편협|고착",
    "우려-인기 쏠림·편향": r"편향|인기|인지도|비중|단일|한 방향|뜬다|배제|휘둘|몰리|팬층|특정배우만",
    "우려-데이터 양·정확도": r"데이터|정확|노선가챠",
    "우려-업데이트 속도": r"업데이트|최신|밀리지",
    "우려-광고": r"광고",
    "우려-저작권": r"저작권",
    "요청-원치 않는 배우 제외": r"제외|원치 않는 배우|원하지 않는 배우",
    "요청-불호 정보": r"불호 ?(정보|후기)",
    "요청-할인·좌석 알림": r"할인|세일|가격|싼 값|알려주는",
    "요청-좌석 추천": r"좌석",
    "요청-구체적인 추천 이유": r"상세한 이유|추천 ?사유|섬세한 추천",
    "요청-케미 추천": r"케미",
    "요청-배우·관극 정보 모아보기": r"모아보|정보 다|관극 포인트|가장 많이 본|영상|인터뷰",
    "요청-실관객 평가": r"실관객",
    "요청-입문자 안내": r"뉴비|고인물|입문",
    "요청-연극 확장": r"연극",
    "요청-AI 맞춤": r"(?i)ai|개인맞춤",
    "없음": r"^없|편리하기만|^:-\)$",
}
NONE = re.compile(r"^(딱히 )?없(음|습니다)?\.?$|^[-×xX.ㆍ·\s]*$")
SPLIT = re.compile(r"[,/·&+\s()]+")


def tag(text, rules, names=()):
    t = (text or "").strip()
    if NONE.match(t):
        return []
    hits = [k for k, rx in rules.items() if re.search(rx, t)]
    if not hits and any(n in t for n in names):
        hits = ["특정 배우(이름만)"]
    return hits or ["기타"]


STYLE = {"가창", "연기", "실력 부족(일반)", "음색", "해석·노선", "케미·조합", "이미지·외모", "취향에 안 맞음"}


def unscorable(tags):  # 제외 배우 근거: 논란이거나, 실력·스타일 언급 없이 불호만 적은 회피. 리뷰 태그 점수로는 못 거른다
    return "논란·사생활" in tags or ("개인 불호" in tags and not STYLE & set(tags))


HONOR = re.compile(r"(배우님|배우|밴님|님|씨)$")
NOT_NAME = {"본진", "애배", "최애", "페어", "조합", "캐스트", "캐슷", "특정", "주연", "조연", "전원", "모두", "딱히", "기억", "고정", "전캐"}


def names_of(cell):  # '고려한 배우' 칸에서 배우 이름만. '배우님' 같은 꼬리는 떼고, 한글 2~4자만 남긴다
    out = []
    for w in SPLIT.split(cell or ""):
        w = HONOR.sub("", w.strip())
        if re.fullmatch(r"[가-힣]{2,4}", w) and "없" not in w and w not in NOT_NAME and w not in out:
            out.append(w)
    return out


def main(path):
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter="\t"))
    head, body = rows[0], rows[1:]
    out, cnt = [], {"고른 이유": Counter(), "피한 이유": Counter(), "우려·요청": Counter()}
    answered = Counter()
    known = {n for r in body for n in names_of(r[3])}  # 누군가 '고려한 배우'에 적은 이름. 고른 이유 글에만 쓴 이름도 이걸로 찾는다
    mention = Counter()
    mention_why = defaultdict(Counter)
    for r in body:
        no, kind, work, actors, _, why, avoided, avoid_why, ask = r[:9]
        names = names_of(actors) + [n for n in sorted(known) if n in why and n not in names_of(actors)]
        pt = tag(why, PICK, names_of(actors))
        mention.update(names)
        for n in names:
            mention_why[n].update(t for t in pt if t not in ("기타", "특정 배우(이름만)"))
        at = tag(avoid_why, AVOID) if avoided == "예" else []
        if avoided == "예" and not at:
            at = ["이유 미기재"]
        kt = tag(ask, ASK)
        for name, tags in (("고른 이유", pt), ("피한 이유", at), ("우려·요청", kt)):
            if tags:
                answered[name] += 1
                cnt[name].update(tags)
        if unscorable(at):
            cnt["피한 이유"]["(파생) 리뷰 점수로 못 거르는 이유"] += 1
        out.append([no, kind, work, why, ", ".join(pt), avoided, avoid_why if avoided == "예" else "", ", ".join(at), ask, ", ".join(kt), ", ".join(names)])
    base = Path(path).with_name(Path(path).name.replace("responses", "tagged"))
    with open(base, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["번호", "응답 구분", "최근 관람 작품", "고른 이유", "고른 이유 태그", "회피 경험", "피한 이유", "피한 이유 태그", "우려·요청", "우려·요청 태그", "언급 배우"])
        w.writerows(out)
    summary = Path(path).with_name(Path(path).name.replace("responses", "tag_summary"))
    with open(summary, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["문항", "태그", "응답 수", "비율(태그 붙은 답 기준)", "주로 고른 이유"])
        for q, c in cnt.items():
            for t, n in c.most_common():
                w.writerow([q, t, n, f"{n / answered[q] * 100:.1f}%", ""])
        # 배우별: 몇 명이 그 배우를 고려했다고 적었고, 그 사람들이 고른 이유는 주로 뭐였나(배우 특징이 아니라 관객이 고른 이유)
        for a, n in mention.most_common():
            if n >= 2:
                w.writerow(["언급 배우", a, n, f"{n / len(body) * 100:.1f}%", ", ".join(f"{t} {k}" for t, k in mention_why[a].most_common(3))])
    print(f"응답 {len(body)}건 → {base.name}, {summary.name}")
    for q, c in cnt.items():
        print(f"\n[{q}] 태그 붙은 답 {answered[q]}건")
        for t, n in c.most_common():
            print(f"  {n:4d}  {t}")


def selftest():
    assert tag("본진이라서", PICK) == ["최애·호감 배우"]
    assert "최애·호감 배우" in tag("해당 배우를 좋아한다.", PICK)
    assert tag(".", AVOID) == []
    assert unscorable(["개인 불호"]) and unscorable(["논란·사생활", "가창"]) and not unscorable(["개인 불호", "가창"])
    assert "논란·사생활" in tag("사생활 논란.", AVOID)
    assert tag("홍광호여서", PICK, names_of("홍광호")) == ["특정 배우(이름만)"]
    assert "케미·페어" not in tag("적합한 날짜였음", PICK)
    assert "연기" not in tag("연기결이 맞지 않음", AVOID) and "해석·노선" in tag("연기결이 맞지 않음", AVOID)
    assert tag("없습니다", ASK) == []
    assert "평판·인지도" not in tag("그 배우의 음색이 맘에 들어서", PICK)
    assert names_of("황순종 황건우") == ["황순종", "황건우"] and names_of("김수하 ,박혜나") == ["김수하", "박혜나"]
    assert names_of("홍광호 배우님, 없습니다") == ["홍광호"] and names_of("본진") == []
    print("selftest ok")


if __name__ == "__main__":
    selftest() if sys.argv[1:] == ["--selftest"] else main(sys.argv[1])
