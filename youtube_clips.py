#!/usr/bin/env python3
"""배우마다 '그 작품 넘버를 부르는 영상'을 붙인다. YouTube Data API v3 search.list 로 영상 후보를 찾는다.

사용:
  python3 youtube_clips.py --sample            # 키 없이 고정 샘플 응답으로 전체 흐름 (data/videos_sample.tsv)
  python3 youtube_clips.py --max-calls 95      # 이번 실행 검색 호출 상한(기본 95, 하루 한도 100). 주연 먼저. 키는 .env 의 YOUTUBE_API_KEY
  python3 youtube_clips.py --channels             # 제작사 공식 채널 업로드 목록을 훑어 전원 매칭 (채널 5개 ≈ 110유닛, 검색 안 씀). 월 1회 이걸 기본으로
  python3 youtube_clips.py --selftest

검색어: "(배우) (작품) 뮤지컬". 배우·배역은 data/roles_*.tsv 최신본에서 읽고, 주연 → 조연 순으로 상한까지만 부른다. videos_manual.tsv 에 있는 배우는 건너뛴다.
통과 조건(good): 제목에 배우 이름 + (제목·설명에 작품명 또는 제목에 그 작품 넘버) + 노래 표시(넘버·MV·LIVE·하이라이트 등) + 포스터·인터뷰·티저·리뷰 같은 비노래 영상 아님.
  2026-10-07 전에는 공식 채널이면 작품명 없이도 통과시켜서 다른 작품 영상(물랑루즈·킹키부츠)과 무빙 포스터·인터뷰가 대표 영상으로 붙었다.
정렬: 제목에 넘버 → 공식 채널 → 조회수. 이번에 검색 안 한 배우는 지난 파일 영상 중 good 을 통과한 것만 이어 쓴다.
댓글은 수집하지 않는다(commentThreads 호출 없음). 출력: data/videos_YYYY-MM-DD.tsv

API 근거 (2026-10-03 확인):
  search.list   https://developers.google.com/youtube/v3/docs/search/list   q의 OR(|), maxResults 0~50, type=video, regionCode, relevanceLanguage
  videos.list   https://developers.google.com/youtube/v3/docs/videos/list   part=snippet,statistics 로 조회수·좋아요
  쿼터          https://developers.google.com/youtube/v3/determine_quota_cost
                문서 요약상 search.list 는 하루 100회 별도 한도, 나머지는 하루 10,000 units(videos.list 1 unit). 예전 문서의 "search 1회 = 100 units" 표기와 달라
                어느 쪽이든 하루 검색 약 100회가 상한 → 작품당 6회 × 10작품 = 60회로 맞췄다. 한도 초과(403 quotaExceeded)면 거기서 멈추고 지금까지 것만 저장한다.
  저장 기간     https://developers.google.com/youtube/terms/developer-policies   III.E.4.d: 비인증 API 데이터는 최대 30일 보관 → videos_*.tsv 는 30일 안에 다시 받거나 지운다.
"""
import argparse
import csv
import html
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

from recommend import RUNS, load_tags, is_curtain  # 공연장 이름(공식 채널 힌트)·이미 태그가 있는 배우·커튼콜 판정

ROOT = Path(__file__).parent
API = "https://www.googleapis.com/youtube/v3/"
KEYWORDS = ["프레스콜", "쇼케이스", "하이라이트"]
SONG = re.compile(r"넘버|MV|M/V|LIVE|라이브|CLIP|Lyric|하이라이트|프레스콜|쇼케이스|커튼콜|OST|콘서트|갈라|축하공연|(?<![A-Za-z0-9])M\d{1,2}\.", re.I)  # M11. = 넘버 번호. \b 는 'ㅣM3.'처럼 한글 바로 뒤에서 안 걸려서 영문·숫자 뒤만 막는다
NOT_SONG = re.compile(r"포스터|인터뷰|interview|편지|티저|teaser|트레일러|trailer|연습실|비하인드|behind|메이킹|making|브이로그|vlog|리뷰|돈값|100th|미리보기|"
                      r"커튼콜데이|토크|예고|story film|character video|캐스트 영상", re.I)
QUOTED = re.compile(r"['‘\"“「『]([^'’\"”」』]{2,40})['’\"”」』]")
# 확실한 넘버만(공식 클립 제목에 나온 것 포함). 빠진 건 제목 속 따옴표 넘버를 그때그때 모아서(harvest) 쓴다.
# 5글자 미만 넘버('소녀'·'여행'·'고백')는 노래 표시로만 쓰고, 작품명 대신으로는 안 쓴다(다른 작품 영상에도 흔한 단어라서)
NUMBERS = {
    "엘리자벳": ["나는 나만의 것", "내가 춤추고 싶을 때", "마지막 춤", "그림자는 길어지고", "밀크", "Milch", "키치", "Kitsch"],
    "겨울왕국": ["Let It Go", "For the First Time in Forever", "Love Is an Open Door", "사랑은 열린 문", "Do You Want to Build a Snowman",
             "I Can't Lose You", "Dangerous to Dream", "Monster", "Hygge", "Fixer Upper", "In Summer"],
    "디어 에반 핸슨": ["Waving Through a Window", "For Forever", "You Will Be Found", "Requiem", "So Big/So Small", "Only Us", "Sincerely Me"],
    "드라큘라": ["Fresh Blood", "Loving You Keeps Me Alive", "It's Over", "The Master's Song", "Life After Life", "If I Had Wings",
             "Please Don't Make Me Love You", "Before The Summer Ends", "Whitby Bay", "The Mist", "Last Man Standing"],
    "시카고": ["All That Jazz", "Cell Block Tango", "Roxie", "Razzle Dazzle", "Nowadays", "All I Care About", "Mister Cellophane",
           "We Both Reached for the Gun", "When You're Good to Mama", "My Own Best Friend", "Funny Honey"],
    "광화문연가": ["광화문 연가", "옛사랑", "붉은 노을", "사랑이 지나가면", "가로수 그늘 아래 서면", "애수", "휘파람",
              "소녀", "깊은 밤을 날아서", "사랑은 한줄기 햇살처럼", "빗속에서", "그녀의 웃음소리뿐", "이 세상 살아가다 보면"],
    "사의찬미": ["도쿄찬가", "이 세상에 없는 곳", "난 그런 사랑을 원해", "날개가 찢긴 한 마리 물새"],
    "빨래": ["서울살이 몇핸가요", "참 예뻐요", "슬플 땐 빨래를 해", "한 걸음 두 걸음"],
    "팬레터": ["섬세한 팬레터", "내가 죽었을 때", "별이 반짝이는 시간", "그녀를 만나면", "고백"],
    "렛미플라이": ["세상은 변해가", "미래 탐사", "컵케이크", "돌멩이", "여행"],
}
# 공식 채널 추정용 이름 조각(공백·대소문자 무시). 공연장은 RUNS에서 가져오고, 제작사는 확실한 것만 둔다. 모자라면 --official 로 추가.
PRODUCERS = ["EMK", "쇼노트", "신시컴퍼니", "CJ ENM", "세종문화회관", "예술의전당", "더뮤지컬", "뮤지컬해븐",
             "OD COMPANY", "오디컴퍼니", "에스앤코", "네오컴퍼니", "명랑씨어터", "라이브컴퍼니", "LIVE Corp",
             "SEENSEE", "콘텐츠제작사라이브", "뮤지컬 빨래"]  # 시드 작품 제작사. 'S&CO'는 n()을 거치면 'sco'라 'KBS CoolFM'에도 걸려서 뺌(한글 '에스앤코'로 잡힘)
# 전문 제작 채널(방송·매체·라이브 스튜디오) 이름 조각. 공식 다음, 관객 직캠보다 먼저 나온다. 여기 없는 채널은 직캠으로 본다(모자라면 추가)
STUDIO = ["KBS", "MBC", "SBS", "tvN", "JTBC", "Mnet", "VOGUE", "it's Live", "이호광의 커튼콜", "부를텐데", "NOL", "THE MUSICAL",
          "예스24", "K-Culture NOW", "UPstage", "PlayDB", "플레이디비", "dingo", "딩고"]
COLS = ["작품", "배우", "배역", "영상 제목", "채널", "URL", "조회수", "좋아요", "게시일", "공식채널(추정)"]


def env_key(name):
    v = os.environ.get(name)
    f = ROOT / ".env"
    if not v and f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            k, _, val = line.partition("=")
            if k.strip().removeprefix("export ").strip() == name:
                v = val.strip().strip("\"'")
    return v


def n(s):
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def ssl_ctx():
    """python.org 파이썬은 CA 번들이 없어 HTTPS 검증이 실패한다 → macOS 시스템 번들로 대신한다(검증을 끄지는 않음)."""
    ok = ssl.get_default_verify_paths().cafile or not os.path.exists("/etc/ssl/cert.pem")
    return None if ok else ssl.create_default_context(cafile="/etc/ssl/cert.pem")


class Quota(Exception):
    pass


def call(key, path, params):
    url = API + path + "?" + urllib.parse.urlencode({"key": key, **params})
    try:
        with urllib.request.urlopen(url, timeout=20, context=ssl_ctx()) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace").replace(key, "***")
        if e.code in (403, 429) and "quota" in body.lower():  # 검색 일일 한도는 429로 온다(2026-10-07 확인)
            raise Quota from None
        raise RuntimeError(f"YouTube API {e.code}: {re.sub(r'\s+', ' ', body)[:160]}") from None
    except Exception as e:  # 키가 URL에 있으니 메시지에서 지운다
        raise RuntimeError(str(e).replace(key, "***")) from None


def search_real(key, work, actor):
    """search.list 1회 + videos.list 1회 → [{id,title,desc,channel,published,views,likes}]"""
    q = f"{actor} {work} 뮤지컬"
    hits = call(key, "search", {"part": "snippet", "q": q, "type": "video", "maxResults": 25, "regionCode": "KR", "relevanceLanguage": "ko"})["items"]
    ids = [h["id"]["videoId"] for h in hits if h.get("id", {}).get("videoId")]
    stats = {v["id"]: v.get("statistics", {}) for v in call(key, "videos", {"part": "statistics", "id": ",".join(ids)})["items"]} if ids else {}
    return [{"id": h["id"]["videoId"], "title": html.unescape(h["snippet"]["title"]), "desc": html.unescape(h["snippet"].get("description", "")), "channel": h["snippet"]["channelTitle"],
             "published": h["snippet"]["publishedAt"][:10], "views": stats.get(h["id"]["videoId"], {}).get("viewCount", ""),
             "likes": stats.get(h["id"]["videoId"], {}).get("likeCount", "")} for h in hits if h["id"]["videoId"] in stats]  # likeCount 숨김이면 ''


# ---- 샘플 (키 없이 돌리는 고정 응답: 공식 채널 1 · 일반 채널 1 · 배우 이름 없는 무관 영상 1. 영상 ID·조회수는 가짜) ----
def search_sample(key, work, actor):
    v = lambda i, title, ch, views: {"id": f"SAMPLE{i:04d}", "title": title, "desc": "", "channel": ch, "published": "2026-09-01", "views": views, "likes": "10"}
    return [v(1, f"[{work}] {actor} 하이라이트 영상", "샘플 공연장 공식", "120000"),
            v(2, f"{actor} 프레스콜 직캠", "샘플 개인 채널", "900000"),
            v(3, "다른 공연 쇼케이스", "샘플 개인 채널", "50000")]


def load_actors(all_tags):
    """roles_*.tsv 최신본 → 작품별 [(배우, 배역, 비중)]. 태그 없는 배우 먼저, 그 안에서 주연 먼저. all_tags=False 면 태그 있는 배우는 뺀다."""
    path = sorted((ROOT / "data").glob("roles_*.tsv"))[-1]
    tagged = set(load_tags()[0])  # {(작품, 배우)}
    per = defaultdict(dict)
    for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"):
        for a in (x.strip() for x in r["캐스트 배우"].split(",")):
            if a and (all_tags or (r["작품"], a) not in tagged):
                per[r["작품"]].setdefault(a, (r["배역"], r["비중"]))  # 한 배우가 여러 배역이면 먼저 나온 배역
    return {w: sorted(((a, *v) for a, v in d.items()), key=lambda x: ((w, x[0]) in tagged, x[2] != "주연")) for w, d in per.items()}, path.name


def actor_names():
    """roles_*.tsv 최신본의 모든 배우 이름(n()을 거쳐 공백·기호를 뺀 형태). 따옴표 안 글이 이 중 하나면 넘버가 아니라 사람 이름이다."""
    path = sorted((ROOT / "data").glob("roles_*.tsv"))[-1]
    return {n(x) for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t") for x in r["캐스트 배우"].split(",") if n(x)}


def harvest(videos, work, names=None):
    """작품명이 든 제목의 따옴표 안 글('나는 나만의 것')을 그 작품 넘버로 모은다 + NUMBERS.
    서로 다른 영상 2개 이상에 나온 것만 넘버로 본다(한 번만 나온 따옴표는 '마마한테 잘 하면…' 같은 대사거나 뮤지컬 '시카고' 같은 작품명).
    따옴표 안 글이 배우 이름이면 넘버가 아니다('정형석'이 넘버가 되어 노래 아닌 영상이 대표 영상으로 붙었다). names=None 이면 roles 파일의 전체 배우."""
    names = actor_names() if names is None else {n(x) for x in names}
    ids, raw = defaultdict(set), {}
    for v in videos:
        if n(work) in n(v["title"]):
            for m in QUOTED.findall(v["title"]):
                ids[n(m)].add(v.get("id") or v["title"]); raw.setdefault(n(m), m)
    got = {raw[k] for k, vs in ids.items() if len(vs) >= 2 and k not in names}
    return [x for x in [*NUMBERS.get(work, []), *got] if len(n(x)) >= 2 and n(x) != n(work)]


def has_num(title, nums, min_len=2):
    return any(len(n(x)) >= min_len and n(x) in n(title) for x in nums)


def good(v, work, actor, nums, carry=False):
    """그 배우가 그 작품 넘버를 부르는 영상인가. 배우 이름은 제목에서만 본다(설명엔 출연진 전원이 적혀 트레일러가 붙었다).
    carry: 지난 파일에서 이어 쓰는 행. 받을 때 작품(설명까지)·노래 확인을 이미 통과했고, 노래인지는 이번 실행이 무엇을 검색했느냐(넘버 모으기)에 달려 있어서
    다시 판단하지 않는다. 고정 규칙(제목에 배우 이름 · NOT_SONG)만 본다."""
    t = v["title"]
    if carry:
        return actor in t and not NOT_SONG.search(t)
    num = has_num(t, nums)
    return (actor in t and (has_num(t, nums, 5) or n(work) in n(t + " " + v.get("desc", "")))
            and not NOT_SONG.search(t) and bool(num or SONG.search(t)))


def official_set(extra=()):
    return {n(x) for x in [*PRODUCERS, *extra, *(r[2].split()[0] for r in RUNS)]}


def own_channel(channel, actor):
    """채널 이름에 그 배우 이름이 들어 있으면 배우 본인(소속) 채널로 본다. 세 글자 이상은 부분 일치, 두 글자 이름('카이')은 낱말로 있을 때만('카이스트 TV'는 아님)."""
    if not actor:
        return False
    return n(actor) in n(channel) if len(n(actor)) >= 3 else n(actor) in [n(w) for w in re.split(r"[^0-9A-Za-z가-힣]+", channel)]


def tier(channel, official, is_official=False, actor=""):
    """0 공식(제작사·공연장) · 1 전문 제작(방송·매체·라이브 스튜디오·배우 본인 채널) · 2 그 밖(관객 직캠 등). 앱은 같은 배우 영상 중 낮은 숫자를 먼저 보여 준다."""
    c = n(channel)
    return 0 if is_official or any(h in c for h in official) else 1 if any(n(x) in c for x in STUDIO) or own_channel(channel, actor) else 2


def pick(videos, work, actor, official, top, nums=()):
    """good 통과한 것만, 넘버 영상 먼저(커튼콜은 그 뒤) → 공식 → 전문 제작 → 직캠, 그 안에서 제목에 넘버 → 조회수 순으로 top 개."""
    for v in videos:
        v["official"] = any(h in n(v["channel"]) for h in official)
    ok = [v for v in videos if good(v, work, actor, nums)]
    return sorted(ok, key=lambda v: (is_curtain(v["title"]), tier(v["channel"], official, v["official"], actor), not has_num(v["title"], nums), -int(v["views"] or 0)))[:top]


def carry_over(prev_rows, done):
    """이번에 새 영상을 못 얻은 배우(done 에 없는 배우)의 지난 파일 행을 이어 쓸 (작품, 배우, 배역, 영상)으로. 다시 찾다 빈손이면 있던 영상이 사라지지 않게.
    검색한 배우가 적어도(--max-calls 9) 검색 안 한 작품의 영상이 넘버를 못 모았다고 떨어지지 않도록 고정 규칙만 다시 본다(good 의 carry)."""
    out = []
    for r in prev_rows:
        v = {"id": r["URL"].split("v=")[-1], "title": r["영상 제목"], "channel": r["채널"], "views": r["조회수"], "likes": r["좋아요"],
             "published": r["게시일"], "official": r["공식채널(추정)"] == "Y"}
        if (r["작품"], r["배우"]) not in done and good(v, r["작품"], r["배우"], (), carry=True):
            out.append((r["작품"], r["배우"], r["배역"], v))
    return out


def sort_rows(rows, official):
    """파일에 쓰기 전 정렬(COLS 순서 문자열 행). 이어 쓴 행·채널 훑기 행이 섞여도 배우마다 넘버 영상 먼저(커튼콜은 그 뒤), 그 안에서 공식 → 전문 제작 → 직캠 순이 되게."""
    for r in rows:
        if tier(r[4], official) == 0:
            r[9] = "Y"
    return sorted(rows, key=lambda r: (is_curtain(r[3]), tier(r[4], official, r[9] == "Y", r[1]), not has_num(r[3], NUMBERS.get(r[0], [])), -int(r[6] or 0)))


def main(a):
    official = official_set(a.official + (['샘플 공연장'] if a.sample else []))
    actors, src = load_actors(True)
    search = search_sample if a.sample else search_real
    key = None if a.sample else env_key("YOUTUBE_API_KEY")
    if not a.sample and not key:
        sys.exit("YOUTUBE_API_KEY 가 없어요. 프로젝트 루트 .env 에 YOUTUBE_API_KEY=... 를 넣거나 --sample 로 돌려 보세요.")
    mf = ROOT / "data" / "videos_manual.tsv"
    manual = {(r["작품"], r["배우"]) for r in csv.DictReader(open(mf, encoding="utf-8"), delimiter="\t")} if mf.exists() and not a.sample else set()
    prev = sorted((ROOT / "data").glob("videos_2*.tsv")) if not a.sample else []
    prev_rows = list(csv.DictReader(open(prev[-1], encoding="utf-8"), delimiter="\t")) if prev else []
    best = {}  # (작품, 배우) → 지난 파일에서 가장 좋은 출처 단계(0 공식 · 1 전문 · 2 직캠)
    for r in prev_rows:
        k = (r["작품"], r["배우"]); best[k] = min(best.get(k, 9), tier(r["채널"], official, r["공식채널(추정)"] == "Y", r["배우"]))
    # 공식·전문 영상이 없는 배우(영상 없음 → 직캠뿐) 먼저, 그 안에서 주연 먼저. 한도가 남으면 나머지도 다시 찾는다
    todo = sorted(((w, act, role, lead) for w, lst in actors.items() for act, role, lead in lst if (w, act) not in manual),
                  key=lambda x: (best.get((x[0], x[1]), 9) < 2, x[3] != "주연", -best.get((x[0], x[1]), 9)))[:a.max_calls]
    raw, calls = {}, 0
    try:
        for work, actor, role, _ in todo:
            calls += 1
            raw[(work, actor, role)] = search(key, work, actor)
    except Quota:
        print("! 쿼터 초과 — 지금까지 받은 것만 저장해요. 내일 다시 돌리거나 --max-calls 를 줄이세요.", file=sys.stderr)
    except RuntimeError as e:
        print(f"! 호출 중단 (받은 건 저장): {e}", file=sys.stderr)
    nums = {w: harvest([v for (ww, *_), vs in raw.items() if ww == w for v in vs], w) for w in actors}
    rows = [(w, act, role, v) for (w, act, role), vs in raw.items() for v in pick(vs, w, act, official, a.top, nums[w])]
    # 이번에 새 영상을 못 얻은 배우(검색 안 함·결과 없음)는 지난 파일 영상을 이어 쓴다. 다시 찾다 빈손이면 있던 영상이 사라지지 않게
    done = {(w, act) for w, act, *_ in rows}
    rows += carry_over(prev_rows, done)
    if not rows:
        sys.exit("영상이 한 건도 없어서 파일은 쓰지 않았어요(같은 날짜 파일을 덮어쓰지 않으려고).")
    out = ROOT / "data" / ("videos_sample.tsv" if a.sample else f"videos_{date.today()}.tsv")
    clean = lambda s: re.sub(r"\s+", " ", str(s)).strip()
    out.write_text("\n".join("\t".join(r) for r in [COLS] + sort_rows([
        [clean(x) for x in (w, act, role, v["title"], v["channel"], f"https://www.youtube.com/watch?v={v['id']}", v["views"], v["likes"], v["published"], "Y" if v["official"] else "N")]
        for w, act, role, v in rows], official)) + "\n", encoding="utf-8")
    covered = len({(w, act) for w, act, *_ in rows})
    print(f"{'[SAMPLE — 가짜 영상] ' if a.sample else ''}roles={src} · 검색 {calls}회(상한 {a.max_calls}) · 영상 {len(rows)}건 · "
          f"영상이 붙은 배우 {covered}/{sum(map(len, actors.values()))}명(수동 {len(manual)}명 별도) · wrote {out.relative_to(ROOT)}")
    for w in actors:
        got = {act for ww, act, *_ in rows if ww == w}
        print(f"  {w}: {len(got)}/{len(actors[w])}명")


# ---- 채널 훑기: 제작사 공식 채널의 업로드 목록을 통째로 받아 제목·설명에서 (작품, 배우)를 매칭한다.
# search.list(100유닛)와 달리 playlistItems.list는 50개당 1유닛이라 채널 4개 ≈ 100유닛. 공식 채널만 보니 '공식' 판정도 필요 없다.
def channel_ids(key, explicit):
    """채널 ID 목록. 명시 안 하면 지금까지 받은 videos_*.tsv의 '공식 Y' 영상에서 videos.list 1회로 뽑는다."""
    if explicit:
        return {c: c for c in explicit}
    files = sorted(f for f in (ROOT / "data").glob("videos_2*.tsv"))
    ids = {}
    for f in files[-1:]:
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            if r["공식채널(추정)"] == "Y":
                ids.setdefault(r["채널"], r["URL"].split("v=")[-1])
    if not ids:
        sys.exit("공식 채널 영상이 든 videos_*.tsv 가 없어요. --channel-ids UC... 로 직접 주세요.")
    out = {}
    for v in call(key, "videos", {"part": "snippet", "id": ",".join(ids.values())})["items"]:
        out[v["snippet"]["channelTitle"]] = v["snippet"]["channelId"]
    return out


def uploads(key, cid, max_pages):
    """채널 업로드 재생목록(UU + 채널ID 뒷부분) 전체. 페이지당 50개·1유닛."""
    pl, token, out = "UU" + cid[2:], None, []
    for _ in range(max_pages):
        res = call(key, "playlistItems", {"part": "snippet", "playlistId": pl, "maxResults": 50, **({"pageToken": token} if token else {})})
        for it in res.get("items", []):
            s = it["snippet"]
            out.append({"id": s["resourceId"]["videoId"], "title": html.unescape(s["title"]), "desc": html.unescape(s.get("description", "")),
                        "channel": s["channelTitle"], "published": s["publishedAt"][:10]})
        token = res.get("nextPageToken")
        if not token:
            break
    return out


def run_channels(a):
    key = env_key("YOUTUBE_API_KEY")
    if not key:
        sys.exit("YOUTUBE_API_KEY 가 없어요. 프로젝트 루트 .env 에 넣어 주세요.")
    actors, src = load_actors(True)  # 태그 유무와 상관없이 전원
    chans = channel_ids(key, a.channel_ids)
    vids, pages = [], 0
    try:
        for name, cid in chans.items():
            got = uploads(key, cid, a.max_pages)
            pages += (len(got) + 49) // 50
            vids += got
            print(f"  채널 {name}: 영상 {len(got)}개", file=sys.stderr)
    except (Quota, RuntimeError) as e:
        print(f"! 채널 훑기 중단 (받은 것까지 진행): {e}", file=sys.stderr)
    # 매칭: 제목+설명에 배우 이름과 작품명이 둘 다 있어야 한다(한 채널이 여러 작품을 올리므로)
    hits = defaultdict(list)
    for work, lst in actors.items():
        nums = harvest(vids, work)
        for actor, role, _ in lst:
            for v in vids:
                if good(v, work, actor, nums):
                    hits[(work, actor, role)].append(v)
    ids = sorted({v["id"] for vs in hits.values() for v in vs})
    stats = {}
    try:
        for i in range(0, len(ids), 50):
            for v in call(key, "videos", {"part": "statistics", "id": ",".join(ids[i:i + 50])})["items"]:
                stats[v["id"]] = v.get("statistics", {})
    except (Quota, RuntimeError) as e:
        print(f"! 조회수 조회 중단: {e}", file=sys.stderr)
    rows = []
    for (work, actor, role), vs in hits.items():
        for v in vs:
            v["views"], v["likes"], v["official"] = stats.get(v["id"], {}).get("viewCount", ""), stats.get(v["id"], {}).get("likeCount", ""), True
        key_ = lambda v: (actor not in v["title"], not any(k in v["title"] for k in KEYWORDS + ["MV", "하이라이트", "프레스콜"]), -int(v["views"] or 0))
        rows += [(work, actor, role, v) for v in sorted(vs, key=key_)[:a.top]]
    if not rows:
        sys.exit("매칭된 영상이 없어요.")
    # 같은 날 검색 모드 결과가 있으면 합친다(URL 기준 중복 제거)
    out = ROOT / "data" / f"videos_{date.today()}.tsv"
    clean = lambda s: re.sub(r"\s+", " ", str(s)).strip()
    new = [[clean(x) for x in (w, act, role, v["title"], v["channel"], f"https://www.youtube.com/watch?v={v['id']}", v["views"], v["likes"], v["published"], "Y")] for w, act, role, v in rows]
    old = list(csv.reader(open(out, encoding="utf-8"), delimiter="\t"))[1:] if out.exists() else []
    seen, merged = set(), []
    for r in new + old:  # 듀엣·인터뷰 영상은 배우 여럿에 붙으니 (배우, URL)로 중복을 본다
        if (r[1], r[5]) not in seen:
            seen.add((r[1], r[5])); merged.append(r)
    out.write_text("\n".join("\t".join(r) for r in [COLS] + sort_rows(merged, official_set())) + "\n", encoding="utf-8")
    covered = len({(w, act) for w, act, *_ in rows})
    total = sum(len(l) for l in actors.values())
    print(f"roles={src} · 채널 {len(chans)}개 · 페이지 {pages}(≈{pages + 1 + (len(ids) + 49) // 50}유닛) · 훑은 영상 {len(vids)}개 · 매칭 {len(rows)}건 · 배우 {covered}/{total}명 · 합쳐서 {len(merged)}행 → {out.relative_to(ROOT)}")
    for w in actors:
        got = {act for ww, act, *_ in rows if ww == w}
        print(f"  {w}: {len(got)}/{len(actors[w])}명")


def selftest():
    official = {n("샘플 공연장 공식")}
    vs = search_sample(None, "작품X", "배우Y")
    got = pick(vs, "작품X", "배우Y", official, 3)
    assert [v["id"] for v in got] == ["SAMPLE0001"], got   # 무관 영상(배우 이름 없음)과 작품명 없는 일반 채널 직캠은 탈락, 공식 채널만 남음
    assert got[0]["official"]
    assert pick(vs, "작품X", "배우Y", official, 1)[0]["id"] == "SAMPLE0001"
    v = lambda t, d="": {"title": t, "desc": d}
    nums = harvest([v("정선아의 뮤지컬 겨울왕국 엘사, ‘Let It Go’")], "겨울왕국")
    assert good(v("[LIVE] 정유지 - Let it go | 이호광의 커튼콜"), "겨울왕국", "정유지", nums)            # 작품명 없어도 넘버가 있으면 통과
    assert not good(v("[뮤지컬물랑루즈!] YOUR SONG X 차윤해 크리스티안"), "겨울왕국", "차윤해", nums)      # 다른 작품 영상
    assert not good(v("2026 뮤지컬 엘리자벳 무빙 포스터 ⚜️ 죽음 │ 서경수"), "엘리자벳", "서경수", NUMBERS["엘리자벳"])  # 노래 아님
    assert not good(v("2026 뮤지컬 엘리자벳 Official Trailer", "서지영 주아"), "엘리자벳", "서지영", NUMBERS["엘리자벳"])  # 이름이 설명에만
    assert good(v("[디어에반핸슨] Waving Through a Window #박강현"), "디어 에반 핸슨", "박강현", NUMBERS["디어 에반 핸슨"])
    assert "나는 나만의 것" in harvest([v("이지수 - '나는 나만의 것' MV [뮤지컬 엘리자벳]")], "엘리자벳")
    two = [v("A - '거짓말이 아니야' [뮤지컬 팬레터]"), v("B 「거짓말이 아니야」 뮤지컬 팬레터 커튼콜")]
    assert "거짓말이 아니야" in harvest(two, "팬레터") and "거짓말이 아니야" not in harvest(two[:1], "팬레터")  # 2개 이상 영상에 나와야 넘버
    assert not good(v("티파니영 목소리 ㄷㄷ? - 뮤지컬 '시카고' #최정원"), "시카고", "최정원", harvest([], "시카고"))  # 작품명 따옴표는 노래 표시 아님
    assert not good(v("[#시카고] “마마한테 잘 하면 마마도 잘 해준다!”｜#김영주 마마"), "시카고", "김영주", NUMBERS["시카고"])  # 대사 클립
    assert not good(v("윤공주 - 여행 [다른 콘서트]"), "렛미플라이", "윤공주", NUMBERS["렛미플라이"])  # 짧은 넘버는 작품명 대신이 못 됨
    assert good(v("[STAGE ON&OFF] 팬레터 편 - 내가 죽었을 때 (문태유)"), "팬레터", "문태유", NUMBERS["팬레터"])
    off = official_set()
    assert [tier(c, off) for c in ["EMK MUSICAL", "it's Live", "이호광의 커튼콜", "SBS Radio 에라오", "또픽또픽"]] == [0, 1, 1, 1, 2]
    # 버그 1: 따옴표 안 글이 배우 이름이면 넘버가 아니다('정형석'이 넘버가 되어 노래 아닌 영상이 대표 영상으로 붙었었다)
    q = [v("[#뮤지컬빨래] '난 누가 울면 울어요' | '정형석'"), v("[#뮤지컬빨래] D-5 ‘난 누가 울면 울어요’ ‘정 형석’")]
    assert "정형석" in harvest(q, "빨래", names=set()), "이름 제외 전에는 넘버로 모였다"
    assert not any(n(x) == "정형석" for x in harvest(q, "빨래")) and "난 누가 울면 울어요" in harvest(q, "빨래"), "배우 이름만 빠지고 진짜 넘버는 남는다(공백 무시)"
    promo = v("[#뮤지컬빨래] 32nd production D-6💌 | #정형석 #황윤중")
    assert good(promo, "빨래", "정형석", harvest(q, "빨래", names=set())) and not good(promo, "빨래", "정형석", harvest(q, "빨래")), "이름이 넘버면 홍보 영상이 통과하고, 아니면 탈락"
    assert good(v("[#뮤지컬빨래] 32nd 마이크테스트 영상 공개ㅣM3.안녕ㅣ#류찬열"), "빨래", "류찬열", harvest(q, "빨래")), "넘버 번호(M3.)가 한글 바로 뒤여도 노래로 본다"
    assert not good(v("[#뮤지컬빨래] ROOM3.안녕 #류찬열 모음"), "빨래", "류찬열", harvest(q, "빨래")), "영문·숫자 뒤의 m3.은 넘버 번호가 아니다"
    # 버그 4: 커튼콜 영상이 대표 영상(맨 앞)이 되면 안 된다. 넘버 영상이 먼저, 커튼콜은 그 뒤(스페셜 커튼콜 포함). 넘버 영상끼리는 예전처럼 공식 > 전문 > 직캠
    nv = lambda i, t, ch, views="10": {"id": i, "title": t, "channel": ch, "desc": "", "views": views}
    cc = [nv("studioCC", "[팬레터] 스페셜 커튼콜 #김태인", "THE MUSICAL", "999999"), nv("fanNUM", "[팬레터] M10. Muse #김태인", "또픽또픽", "5"), nv("offNUM", "[팬레터] M3. 거울 #김태인", "EMK MUSICAL", "1")]
    assert [x["id"] for x in pick(cc, "팬레터", "김태인", off, 3)] == ["offNUM", "fanNUM", "studioCC"], "공식 넘버 > 직캠 넘버 > (조회수 많은 전문 채널) 커튼콜"
    assert [x["id"] for x in pick(cc, "팬레터", "김태인", off, 1)] == ["offNUM"] and [x["id"] for x in pick(cc[:2], "팬레터", "김태인", off, 1)] == ["fanNUM"], "직캠 넘버가 전문 채널 커튼콜을 이긴다(top=1에서도)"
    cr = lambda t, ch, views: ["팬레터", "김태인", "r", t, ch, "u" + t[:6], views, "", "", "N"]
    assert sort_rows([cr("260506 팬레터 커튼콜 focus", "THE MUSICAL", "900000"), cr("팬레터 M10. Muse #김태인", "또픽또픽", "5"), cr("팬레터 스페셜 커튼콜 신인", "EMK MUSICAL", "800000")], off)[0][3] == "팬레터 M10. Muse #김태인", "정렬에서도 직캠 넘버가 공식 커튼콜 앞"
    assert [is_curtain(r[3]) for r in sort_rows([cr("팬레터 커튼콜 A", "또픽또픽", "9"), cr("팬레터 M10. Muse #김태인", "또픽또픽", "1"), cr("팬레터 스페셜 커튼콜 B", "EMK MUSICAL", "9")], off)] == [False, True, True], "커튼콜은 전부 넘버 뒤"
    assert [x["id"] for x in pick([nv("a", "[LIVE] 정유지 - Let it go | 이호광의 커튼콜", "이호광의 커튼콜", "1"), nv("b", "겨울왕국 정유지 커튼콜", "또픽또픽", "99")], "겨울왕국", "정유지", off, 2, harvest([], "겨울왕국"))][0] == "a", "방송 프로그램 이름 '이호광의 커튼콜'은 커튼콜 영상이 아니다"
    # 버그 3: 이어 쓰기가 이번 검색의 넘버 모으기(harvest)에 기대면, 검색 안 한 작품(--max-calls 9에서 팬레터)의 기존 영상이 노래 아님으로 떨어진다. 이어 쓰는 행은 고정 규칙만 본다
    prev = lambda w, a, t, ch="c": {"작품": w, "배우": a, "배역": "r", "영상 제목": t, "채널": ch, "URL": "https://www.youtube.com/watch?v=" + t[:3], "조회수": "1", "좋아요": "0", "게시일": "2026-01-01", "공식채널(추정)": "N"}
    keep = carry_over([prev("팬레터", "김태인", "260201 뮤지컬 팬레터 - MUSE | 이규형 원태민(F) 김지철 이한밀 김태인 송상훈"),      # MUSE: 넘버 목록도 SONG 단어도 없던 제목
                       prev("팬레터", "이한밀", "뮤지컬 팬레터 앵콜 시츠프로브 '생의 반려' 이규형, 이한밀, 김보현"),
                       prev("팬레터", "김태인", "뮤지컬 팬레터 인터뷰 김태인"),                 # NOT_SONG
                       prev("팬레터", "김리현", "뮤지컬 팬레터 로비음악회 김태인"),             # 제목에 그 배우 이름이 없다
                       prev("시카고", "린아", "시카고 린아 Cell Block Tango LIVE")], set())       # 검색한 배우가 없어도(done 비어 있음)
    assert [(w, a) for w, a, *_ in keep] == [("팬레터", "김태인"), ("팬레터", "이한밀"), ("시카고", "린아")], keep   # 검색 0회에도 MUSE·시츠프로브 행이 남고, 인터뷰·이름 없는 제목만 떨어진다
    assert harvest([], "팬레터") == NUMBERS.get("팬레터", []), "검색이 없으면 넘버 목록이 비어 있는 게 정상(예전엔 이래서 이어 쓰기가 떨어졌다)"
    assert carry_over([prev("팬레터", "김태인", "260201 뮤지컬 팬레터 - MUSE | 김태인")], {("팬레터", "김태인")}) == [], "이번에 새로 얻은 배우는 이어 쓰지 않는다"
    assert not good(v("260201 뮤지컬 팬레터 - MUSE | 김태인"), "팬레터", "김태인", []), "새로 찾은 영상은 예전처럼 노래인지 본다(carry 아님)"
    # 버그 2: 채널 이름에 배우 이름이 있으면 배우 본인 채널이라 직캠(2)이 아니라 전문 제작(1)
    assert tier("김준수 XIA", off) == 2 and tier("김준수 XIA", off, False, "김준수") == 1, "배우 본인 채널"
    assert tier("EMK MUSICAL", off, False, "김준수") == 0 and tier("또픽또픽", off, False, "김준수") == 2, "공식은 그대로 0, 남의 채널은 그대로 2"
    assert tier("카이스트 TV", off, False, "카이") == 2 and tier("카이(KAI)", off, False, "카이") == 1, "두 글자 이름은 낱말로 있을 때만"
    mv = lambda a, ch, views: ["엘리자벳", a, "토드", f"{a} - 마지막 춤", ch, "u" + ch, views, "", "", "N"]
    assert [r[4] for r in sort_rows([mv("김준수", "또픽또픽", "900000"), mv("김준수", "김준수 XIA", "10"), mv("서경수", "김준수 XIA", "10")], off)] == ["김준수 XIA", "또픽또픽", "김준수 XIA"], "정렬에도 배우를 알고 있어야 한다"
    row = lambda ch, views: ["겨울왕국", "A", "엘사", "A - Let It Go", ch, "u" + ch, views, "", "", "N"]
    assert [r[4] for r in sort_rows([row("또픽또픽", "900000"), row("VOGUE KOREA", "10"), row("에스앤코 S&Co", "1")], off)] == ["에스앤코 S&Co", "VOGUE KOREA", "또픽또픽"]  # 조회수보다 출처가 먼저
    two = [{"id": "a", "title": "카이스트 하이라이트", "desc": "", "channel": "c", "views": "1"}, {"id": "b", "title": "[작품X] 카이 하이라이트", "desc": "", "channel": "c", "views": "1"}]
    assert [v["id"] for v in pick(two, "작품X", "카이", official, 3)] == ["b"]  # 2글자 이름 오탐 차단
    all_, _ = load_actors(True)
    untagged, _ = load_actors(False)
    assert all_ and sum(map(len, untagged.values())) <= sum(map(len, all_.values()))
    assert all(lst[0][2] == "주연" for lst in untagged.values() if any(x[2] == "주연" for x in lst)), "태그 없는 배우끼리는 주연이 먼저여야 한다"
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", action="store_true", help="키 없이 샘플 응답으로 실행")
    ap.add_argument("--max-calls", type=int, default=95, help="이번 실행 검색(search.list) 호출 상한 (기본 95, 주연 먼저)")
    ap.add_argument("--top", type=int, default=2, help="배우당 남길 영상 수 (기본 2)")
    ap.add_argument("--official", nargs="*", default=[], help="공식 채널로 볼 채널 이름 조각 추가 (예: --official 쇼노트 신시)")
    ap.add_argument("--channels", action="store_true", help="검색 대신 제작사 공식 채널 업로드 목록을 훑는다 (채널당 ≈ 영상 수/50 유닛)")
    ap.add_argument("--channel-ids", nargs="*", default=[], help="--channels 에서 훑을 채널 ID(UC...). 없으면 받아 둔 공식 영상에서 자동으로 뽑는다")
    ap.add_argument("--max-pages", type=int, default=40, help="--channels 에서 채널당 최대 페이지(50개씩, 기본 40 = 2,000개)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    selftest() if a.selftest else run_channels(a) if a.channels else main(a)
