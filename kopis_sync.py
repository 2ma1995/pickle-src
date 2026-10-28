#!/usr/bin/env python3
"""KOPIS 공연 API로 뮤지컬(공연중/예정) 목록을 받아 recommend.RUNS와 비교한다. 주 1회 배치용.

사용:
  python3 kopis_sync.py --sample     # 키 없이 고정 샘플 XML로 전체 흐름 (data/kopis_runs_sample.tsv)
  python3 kopis_sync.py              # 프로젝트 루트 .env 의 KOPIS_API_KEY 필요 (data/kopis_runs_YYYY-MM-DD.tsv)
  python3 kopis_sync.py --selftest
  python3 kopis_sync.py --current    # 지금 서울에서 하는(+60일 안에 시작하는) 뮤지컬 목록·출연진 → data/kopis_current_YYYY-MM-DD.tsv + 배우 프로필 커버리지 (--max-calls 로 호출 상한, 상세는 data/kopis_cache/ 에 저장)
  python3 kopis_sync.py --past       # 최근 1년 안에 끝난 서울 뮤지컬 목록·출연진 → data/kopis_past.tsv (본 공연 기록하기용, 새로 끝난 공연만 상세를 받음)
  python3 kopis_sync.py --boxoffice  # 서울 뮤지컬 예매상황판 주간·월간 순위 → data/kopis_boxoffice_YYYY-MM-DD.tsv (호출 2번, 응답은 data/kopis_cache/boxoffice/ 에 저장). 앱 홈 '지금 하는 공연 전체'의 인기순 정렬용

출력: TSV(작품 공연장 시작 끝 포스터URL 예매처링크 가격안내 출연진 mt20id + RUNS·비교) + "신규 N / 종료 N / 기간 변경 N".

API 근거 (2026-10-03 확인. 공식 문서 페이지는 JS로 그려져 본문을 직접 못 읽고, 검색 요약과 GitHub 사용 사례로 교차 확인함 → 키 받은 뒤 첫 실행에서 재확인):
  공식 문서  https://kopis.or.kr/por/cs/openapi/openApiList.do?menuId=MNU_00074
  요청/응답 예  https://github.com/softy20/260923_ideathon/issues/1   (목록·상세 URL, 필드명, "초당 10회 이상 호출 시 서비스 중지")
  장르·상태 코드  https://github.com/coldsurfers/kopis-cli   (shcate GGGA=뮤지컬 / prfstate 01 예정·02 공연중·03 완료)
  목록  GET /openApi/restful/pblprfr?service=KEY&stdate=YYYYMMDD&eddate=YYYYMMDD&cpage=1&rows=100&shcate=GGGA
        stdate~eddate 최대 31일(초과 시 returncode 05), rows 최대 100(초과 시 06). 응답 필드: mt20id prfnm prfpdfrom prfpdto fcltynm poster prfstate
  상세  GET /openApi/restful/pblprfr/{mt20id}?service=KEY
        응답 필드: prfcast pcseguidance relates/relate/relatenm·relateurl
  예매상황판  GET /openApi/restful/boxoffice?service=KEY&stdate=YYYYMMDD&eddate=YYYYMMDD&catecode=GGGA&area=11  (2026-10-12 실제 호출로 확인: 서울 뮤지컬 50위까지 한 번에. ststype/date 방식은 returncode 01 로 거절됨)
        응답 <boxofs><boxof> 필드: rnum(순위) prfnm mt20id prfpd prfplcnm seatcnt cate area prfdtcnt poster. 아직 시작 안 한 공연·끝난 공연도 예매가 있으면 순위에 든다
  오류  <dbs><db><returncode>02</returncode><errmsg>SERVICE KEY IS NOT REGISTERED ERROR</errmsg>  (더미 키로 직접 확인, 정상 응답엔 returncode 없음)
  https 로 동작함(키가 URL에 실리므로 http 쓰지 않는다). 응답은 XML 뿐.
"""
import argparse
import os
import re
import ssl
import tempfile
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

from collections import Counter

from recommend import RUNS, load_actor_profiles, parse_cast  # RUNS: (작품, 공연 이름, 공연장, 시작, 끝, 예매 링크, 색, 가격)

ROOT = Path(__file__).parent
BASE = "https://kopis.or.kr/openApi/restful/"
WIN = 30        # 조회 창(일). 문서상 최대 31일이라 하루 여유
SHOW = 40       # 표준출력에 목록으로 보여 줄 최대 줄 수 (전체는 TSV)
COLS = ["작품", "공연장", "시작", "끝", "포스터URL", "예매처링크", "가격안내", "출연진", "mt20id", "RUNS", "비교"]


def env_key(name):
    v = os.environ.get(name)
    f = ROOT / ".env"
    if not v and f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            k, _, val = line.partition("=")
            if k.strip().removeprefix("export ").strip() == name:
                v = val.strip().strip("\"'")
    return v


def norm(s):
    """공백·특수문자 제거 + 소문자. 작품명·공연장 비교용."""
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def iso(d):  # KOPIS '2026.08.16' → '2026-08-16'
    return d.strip().replace(".", "-")


def clean(s):  # TSV 한 칸에 안전하게
    return re.sub(r"\s+", " ", s or "").strip()


def txt(el, tag):
    return clean(el.findtext(tag))


def parse(xml_text):
    root = ET.fromstring(xml_text)
    err = root.find(".//returncode")
    if err is not None:
        raise RuntimeError(f"KOPIS 오류 returncode={err.text} {txt(root.find('.//db'), 'errmsg')}")
    return root.findall("db")


def parse_list(xml_text):
    return [{"id": txt(d, "mt20id"), "title": txt(d, "prfnm"), "start": iso(txt(d, "prfpdfrom")), "end": iso(txt(d, "prfpdto")),
             "venue": txt(d, "fcltynm"), "poster": txt(d, "poster"), "state": txt(d, "prfstate")} for d in parse(xml_text)]


def parse_detail(xml_text):
    d = parse(xml_text)[0]
    links = [f"{txt(r, 'relatenm')}={txt(r, 'relateurl')}" for r in d.findall("relates/relate")]
    return {"tickets": " | ".join(links), "price": txt(d, "pcseguidance"), "cast": txt(d, "prfcast"), "age": txt(d, "prfage"), "runtime": txt(d, "prfruntime"),
            "times": txt(d, "dtguidance"), "child": txt(d, "child"), "poster2": txt(d, "poster")}


def ssl_ctx():
    """python.org 파이썬은 CA 번들이 없어 HTTPS 검증이 실패한다 → macOS 시스템 번들로 대신한다(검증을 끄지는 않음). 근본 해결: '/Applications/Python 3.13/Install Certificates.command'"""
    ok = ssl.get_default_verify_paths().cafile or not os.path.exists("/etc/ssl/cert.pem")
    return None if ok else ssl.create_default_context(cafile="/etc/ssl/cert.pem")


RETRY = (400, 429, 500, 502, 503, 504)  # 2026-10-10 상세 100여 건을 잇달아 받다가 일부가 400 으로 오고, 같은 요청을 다시 보내면 200 이었다(일시적) → 잠깐 쉬고 다시


def retry_call(fn, tries=3, wait=lambda i: 2 + 3 * i, sleep=time.sleep):
    """fn() 이 HTTP RETRY 코드로 실패하면 wait(i)초 쉬고 다시(최대 tries번). 다른 오류·마지막 실패는 그대로 올린다."""
    for i in range(tries):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            if e.code not in RETRY or i == tries - 1:
                raise
            sleep(wait(i))


def http_get(key, path, params):
    url = BASE + path + "?" + urllib.parse.urlencode({"service": key, **params})

    def once():
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "pickle-kopis-sync"}), timeout=20, context=ssl_ctx()) as r:
            return r.read().decode("utf-8")
    try:
        body = retry_call(once)
    except Exception as e:  # 키가 URL에 있으니 메시지에서 지운다
        raise RuntimeError(str(e).replace(key, "***")) from None
    time.sleep(0.5)  # 초당 10회 이상이면 서비스 중지 (위 GitHub 이슈). 상세를 이어 받다 400 이 나서 0.3 → 0.5초
    return body


def fetch(get, days, today):
    """get(path, params) → XML 텍스트. 오늘~+days일을 WIN일 창으로 나눠 받고 mt20id로 중복 제거, 상세는 공연마다 1회."""
    seen = {}
    for off in range(0, days, WIN):
        lo, hi = today + timedelta(off), today + timedelta(min(off + WIN, days) - 1)
        page = 1
        while True:
            rows = parse_list(get("pblprfr", {"stdate": lo.strftime("%Y%m%d"), "eddate": hi.strftime("%Y%m%d"),
                                              "cpage": page, "rows": 100, "shcate": "GGGA"}))
            for r in rows:
                if r["state"] in ("공연중", "공연예정"):  # prfstate 01/02. 03 완료는 거른다
                    seen.setdefault(r["id"], r)
            if len(rows) < 100:
                break
            page += 1
    for r in seen.values():  # ponytail: 상세는 전부 받는다(주 1회). 호출 수가 부담되면 신규·변경 건만 받게 줄이기
        try:
            r.update(parse_detail(get(f"pblprfr/{r['id']}", {})))
        except Exception as e:
            print(f"! 상세 실패 {r['id']}: {e}", file=sys.stderr)
            r.update(tickets="", price="", cast="")
    return sorted(seen.values(), key=lambda r: (norm(r["title"]), r["start"]))


# ---- --current: 지금 서울에서 하는 뮤지컬 전체 + 우리 배우 데이터가 얼마나 덮는지 ----
CUR_COLS = ["mt20id", "작품", "공연장", "시작", "끝", "상태", "출연진", "포스터URL", "관람연령", "러닝타임", "공연시간", "예매처링크", "시드작품", "시드공연일치"]
AHEAD = 60  # 지금 하는 공연 + 오늘부터 이 일수 안에 시작하는 공연
# 제외 휴리스틱(제목·공연장 글자). RUNS의 시드 작품(제목과 공연장이 둘 다 맞는 것)은 늘 남긴다. 제외한 건 사유와 함께 *_excluded.tsv 에 남겨 눈으로 확인한다
EVENT = re.compile(r"콘서트|concert|갈라|gala|토크|talk|파티|party|쇼케이스|디너|팬미팅|페스티벌|festival|낭독|오디션|워크숍|특강|강연", re.I)
TOUR = re.compile(r"전국 ?투어|순회|지방 ?공연|투어|tour", re.I)
PUB = re.compile(r"펍|\bpub\b|카페|클럽|라운지|\bbar\b", re.I)
SHORT = 3  # 이 일수 이하(시작~끝 포함)로 끝나는 공연은 일회성 행사로 본다


class Cap(Exception):
    pass


def days_of(k):
    return (date.fromisoformat(k["end"]) - date.fromisoformat(k["start"])).days + 1


def seed_of(k, runs=RUNS):
    """(시드 작품 이름 또는 '', 공연장까지 맞는지). 작품명 부분일치라 '빨래방' 같은 오탐은 공연장이 안 맞아 N 으로 드러난다."""
    nt = norm(k["title"])
    w = next((r[0] for r in runs if norm(r[0]) in nt), "")
    return w, bool(w) and any(r[0] == w and venue_eq(r[2], k["venue"]) for r in runs)


def exclusion(k, kids=(), runs=RUNS):
    """제외 사유(없으면 ''). 시드 작품(제목·공연장 일치)은 사유가 있어도 남긴다."""
    if seed_of(k, runs)[1]:
        return ""
    if k["id"] in kids:
        return "아동(kidstate=Y)"
    if EVENT.search(k["title"]):
        return "콘서트·행사 제목"
    if TOUR.search(k["title"]):
        return "투어 제목"
    if PUB.search(k["venue"]) or PUB.search(k["title"]):
        return "펍·카페 공연장"
    if days_of(k) <= SHORT:
        return f"단기 공연({SHORT}일 이하)"
    return ""


def fetch_current(get, today, max_calls=300, cache=None, refresh=False, runs=RUNS):
    """get(path, params) → XML 텍스트. 서울(signgucode=11) 뮤지컬(GGGA)의 공연중(02) + 오늘부터 AHEAD일 안에 시작하는 공연예정(01).
    아동 공연은 kidstate=Y 목록으로 id 를 모아 거른다(kidstate=N 은 실제로는 거르지 않는 걸 2026-10-10 확인). 상세는 남은 공연마다 1회, cache 폴더(XML)에 저장.
    반환 {kept, excluded[(공연, 사유)], used{list,detail,cache}, capped}"""
    used = {"list": 0, "detail": 0, "cache": 0}

    def call(kind, path, params):
        if used["list"] + used["detail"] >= max_calls:
            raise Cap()
        used[kind] += 1
        return get(path, params)

    wins = [("02", today, today + timedelta(WIN - 1))] + [("01", today + timedelta(o), today + timedelta(min(o + WIN, AHEAD + 1) - 1)) for o in range(0, AHEAD + 1, WIN)]
    seen, kids, capped = {}, set(), False
    try:
        for st, lo, hi in wins:
            for kid in ("", "Y"):
                page = 1
                while True:
                    q = {"stdate": lo.strftime("%Y%m%d"), "eddate": hi.strftime("%Y%m%d"), "cpage": page, "rows": 100, "shcate": "GGGA", "prfstate": st, "signgucode": "11"}
                    rows = parse_list(call("list", "pblprfr", {**q, **({"kidstate": kid} if kid else {})}))
                    for r in rows:
                        if kid:
                            kids.add(r["id"])
                        elif r["state"] in ("공연중", "공연예정"):
                            seen.setdefault(r["id"], r)
                    if len(rows) < 100:
                        break
                    page += 1
    except Cap:
        capped = True
    kept, excluded = [], []
    for r in sorted(seen.values(), key=lambda r: (norm(r["title"]), r["start"])):
        if st_late(r, today):
            excluded.append((r, f"시작이 {AHEAD}일 뒤보다 늦음"))
            continue
        why = exclusion(r, kids, runs)
        (excluded.append((r, why)) if why else kept.append(r))
    order = sorted(kept, key=lambda r: (not seed_of(r, runs)[1], norm(r["title"])))  # 시드 먼저: 한도가 모자라면 시드 상세부터 받는다
    for r in order:
        f = cache / f"{r['id']}.xml" if cache else None
        try:
            if f and f.exists() and not refresh:
                xml = f.read_text(encoding="utf-8")
                used["cache"] += 1
            else:
                xml = call("detail", f"pblprfr/{r['id']}", {})
                if f:
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(xml, encoding="utf-8")
            r.update(parse_detail(xml))
        except Cap:
            capped = True
            r.update(tickets="", price="", cast="", age="", runtime="", times="", child="", poster2="", nodetail=True)
        except Exception as e:
            print(f"! 상세 실패 {r['id']}: {e}", file=sys.stderr)
            r.update(tickets="", price="", cast="", age="", runtime="", times="", child="", poster2="", nodetail=True)
    final = []
    for r in kept:
        if r.get("child") == "Y" and not seed_of(r, runs)[1]:
            excluded.append((r, "아동(child=Y)"))
        else:
            final.append(r)
    return {"kept": final, "excluded": excluded, "used": used, "capped": capped}


def st_late(r, today):
    return r["state"] == "공연예정" and r["start"] > (today + timedelta(AHEAD)).isoformat()


def write_current(path, rows, runs=RUNS):
    lines = ["\t".join(CUR_COLS)]
    for k in rows:
        w, same = seed_of(k, runs)
        lines.append("\t".join(clean(x) for x in [k["id"], k["title"], k["venue"], k["start"], k["end"], k["state"], k.get("cast", ""), k.get("poster2") or k["poster"],
                                                   k.get("age", ""), k.get("runtime", ""), k.get("times", ""), k.get("tickets", ""), w, ("Y" if same else "N") if w else ""]))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_excluded(path, items):
    path.write_text("\n".join(["\t".join(["mt20id", "작품", "공연장", "시작", "끝", "상태", "제외사유"])] + ["\t".join(clean(x) for x in [k["id"], k["title"], k["venue"], k["start"], k["end"], k["state"], why]) for k, why in items]) + "\n", encoding="utf-8")


def coverage(rows, profiles, runs=RUNS):
    """우리 배우 프로필(recommend.load_actor_profiles)이 이 공연들의 출연진을 얼마나 덮는지. 시드(공연장까지 맞는 10개 작품)와 그 밖을 나눠서도 센다."""
    cast = {k["id"]: parse_cast(k.get("cast", "")) for k in rows}
    seed = {k["id"] for k in rows if seed_of(k, runs)[1]}
    def stat(ids):
        names = Counter(n for i in ids for n in cast[i])
        prof = [n for n in names if n in profiles]
        return {"shows": len(ids), "no_cast": sum(not cast[i] for i in ids), "actors": len(names), "with_profile": len(prof),
                "with_voice": sum(bool(profiles[n]["voice"]) for n in prof), "shows_with_profile": sum(any(n in profiles for n in cast[i]) for i in ids), "names": names}
    ids = [k["id"] for k in rows]
    return {"all": stat(ids), "seed": stat([i for i in ids if i in seed]), "other": stat([i for i in ids if i not in seed])}


def print_coverage(cov, profiles, top=20):
    for key, label in (("all", "전체"), ("seed", "시드 작품"), ("other", "시드 밖")):
        c = cov[key]
        print(f"[{label}] 공연 {c['shows']}개(출연진 정보 없음 {c['no_cast']}) · 출연진 {c['actors']}명 중 프로필 있음 {c['with_profile']} · 목소리 태그 있음 {c['with_voice']} · 프로필 있는 배우가 한 명이라도 나오는 공연 {c['shows_with_profile']}/{c['shows']}")
    print(f"\n출연 공연 수 상위 {top}명:")
    for n, c in cov["all"]["names"].most_common(top):
        p = profiles.get(n)
        print(f"  {n}: {c}개 공연 · 프로필 {'있음(목소리 ' + str(len(p['voice'])) + '·연기 ' + str(len(p['role'])) + ')' if p else '없음'}")


def venue_eq(a, b):
    a, b = norm(a), norm(b)
    return a in b or b in a


def diff(kopis, runs, today, days):
    """kopis 항목에 'match'(runs 인덱스|None)·'kind' 를 달고 (신규, 기간 변경, 종료) 를 돌려준다."""
    works = {norm(r[0]): r[0] for r in runs}
    hit, new, changed = set(), [], []
    for k in kopis:
        nt = norm(k["title"])
        # ponytail: 작품명 부분일치 — "빨래" ⊂ "빨래방" 같은 오탐은 목록에 제목이 같이 나오니 눈으로 거른다. 잦으면 <…>로 감싼 제목만 비교
        w = next((w for nw, w in works.items() if nw in nt), None)
        cand = [i for i, r in enumerate(runs) if r[0] == w]
        i = next((i for i in cand if venue_eq(runs[i][2], k["venue"])), None)  # 같은 작품 + 같은 공연장 = 같은 공연(run)
        k["match"] = i
        if i is None:
            k["kind"] = "신규(새 공연)" if w else "신규(새 작품)"
            new.append(k)
            continue
        hit.add(i)
        if (runs[i][3], runs[i][4]) != (k["start"], k["end"]):
            k["kind"] = "기간 변경"
            changed.append(k)
        else:
            k["kind"] = "일치"
    horizon = (today + timedelta(days)).isoformat()
    gone = [i for i in range(len(runs)) if i not in hit and runs[i][3] <= horizon]  # 조회 범위 밖에서 시작하는 공연은 비교 제외
    return new, changed, gone


def write_tsv(path, kopis, runs):
    lines = ["\t".join(COLS)]
    for k in kopis:
        m = runs[k["match"]] if k["match"] is not None else None
        lines.append("\t".join(clean(x) for x in [k["title"], k["venue"], k["start"], k["end"], k["poster"], k["tickets"], k["price"],
                                                   k["cast"], k["id"], f"{m[0]}/{m[1]}" if m else "", k["kind"]]))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def hint(k, runs, gone):
    """신규인데 같은 작품·겹치는 기간의 종료 후보가 있으면 공연장 표기만 다른 같은 공연일 수 있다."""
    m = [runs[i][1] for i in gone if norm(runs[i][0]) in norm(k["title"]) and runs[i][3] <= k["end"] and k["start"] <= runs[i][4]]
    return f" ≈ 종료로 잡힌 {m[0]}과 같은 공연? 공연장 표기 확인" if m else ""


def report(kopis, runs, new, changed, gone, today, label):
    print(f"== KOPIS 동기화 {today} {label}: 뮤지컬 공연중/예정 {len(kopis)}건 ==")
    print(f"신규 {len(new)} / 종료 {len(gone)} / 기간 변경 {len(changed)}")
    for title, items in [("신규", [f"+ [{k['kind']}] {k['title']} | {k['venue']} | {k['start']}~{k['end']} | {k['id']}{hint(k, runs, gone)}" for k in new]),
                         ("종료", [f"- {runs[i][0]}/{runs[i][1]} ({runs[i][2]}, {runs[i][3]}~{runs[i][4]}) — "
                                 + ("기간 만료" if runs[i][4] < today.isoformat() else "KOPIS 목록에 없음: 취소·미등록·조회 범위 확인") for i in gone]),
                         ("기간 변경", [f"~ {runs[k['match']][0]}/{runs[k['match']][1]}: {runs[k['match']][3]}~{runs[k['match']][4]} → {k['start']}~{k['end']} ({k['title']})" for k in changed])]:
        if items:
            print(f"\n[{title}]")
            for x in items[:SHOW]:
                print(x)
            if len(items) > SHOW:
                print(f"... 외 {len(items) - SHOW}건 (신규는 TSV 전체 참고)")


# ---- 샘플 (키 없이 돌리는 고정 응답. 작품·공연장 이름은 RUNS와 맞췄지만 날짜·배우·링크는 가짜) ----
def _db(i, title, a, b, venue):
    return (f"<db><mt20id>{i}</mt20id><prfnm>{title}</prfnm><prfpdfrom>{a}</prfpdfrom><prfpdto>{b}</prfpdto><fcltynm>{venue}</fcltynm>"
            f"<poster>https://example.com/sample/{i}.png</poster><genrenm>뮤지컬</genrenm><area>서울특별시</area><prfstate>공연중</prfstate><openrun>N</openrun></db>")


SAMPLE_LIST = "<dbs>" + "".join([  # 엘리자벳: 종료일만 다름 → 기간 변경 / 겨울왕국: 그대로 → 일치 / 샘플 나이트: RUNS에 없음 → 신규
    _db("PFSAMPLE01", "뮤지컬 〈엘리자벳〉 - 서울", "2026.08.16", "2026.11.22", "블루스퀘어 (우리은행홀)"),
    _db("PFSAMPLE02", "뮤지컬 겨울왕국", "2026.08.13", "2027.03.01", "샤롯데씨어터 (샤롯데씨어터)"),
    _db("PFSAMPLE03", "뮤지컬 〈샘플 나이트〉", "2026.11.01", "2026.12.31", "샘플아트홀 (대극장)")]) + "</dbs>"
SAMPLE_DETAIL = {i: f"<dbs><db><mt20id>{i}</mt20id><prfcast>샘플배우A, 샘플배우B 외</prfcast><pcseguidance>VIP석 150,000원, R석 120,000원</pcseguidance>"
                    f"<relates><relate><relatenm>샘플예매처</relatenm><relateurl>https://example.com/sample/ticket/{i}</relateurl></relate></relates></db></dbs>"
                 for i in ("PFSAMPLE01", "PFSAMPLE02", "PFSAMPLE03")}


def sample_get(path, params):
    return SAMPLE_DETAIL[path.rsplit("/", 1)[1]] if "/" in path else SAMPLE_LIST  # 창마다 같은 목록 → mt20id 중복 제거도 같이 점검됨


# --current 샘플(2026-10-10 기준 고정). id → (제목, 시작, 끝, 공연장, 상태코드)
CUR_ITEMS = {"PFC01": ("뮤지컬 〈엘리자벳〉 - 서울", "2026.08.16", "2026.11.15", "블루스퀘어 (우리은행홀)", "02"), "PFC02": ("뮤지컬 〈엘리자벳〉 콘서트", "2026.10.20", "2026.12.20", "다른홀", "02"),
             "PFC03": ("토끼와 거북이", "2026.09.01", "2026.12.31", "어린이극장", "02"), "PFC04": ("샘플 나이트", "2026.09.01", "2026.12.31", "샘플아트홀", "02"),
             "PFC05": ("일일 특별 공연", "2026.10.11", "2026.10.12", "특별홀", "01"), "PFC06": ("샘플 신작", "2026.11.20", "2027.01.31", "신작홀", "01"),
             "PFC07": ("먼 미래 작품", "2027.03.01", "2027.05.01", "미래홀", "01"), "PFC08": ("월드 투어 샘플", "2026.09.01", "2026.12.31", "투어홀", "02"),
             "PFC09": ("아동극이 아닌 척", "2026.09.01", "2026.12.31", "그냥홀", "02"), "PFC10": ("술 한잔 뮤지컬", "2026.09.01", "2026.12.31", "홍대 펍", "02")}
CUR_KIDS = {"PFC03"}


def cur_sample_get(path, params):
    if "/" in path:
        i = path.rsplit("/", 1)[1]
        return (f"<dbs><db><mt20id>{i}</mt20id><prfcast>샘플배우A, 샘플배우B 등</prfcast><pcseguidance>R석 100,000원</pcseguidance><prfage>만 7세 이상</prfage><prfruntime>2시간 30분</prfruntime>"
                f"<dtguidance>화요일(19:30), 토요일(14:00,19:00)</dtguidance><child>{'Y' if i == 'PFC09' else 'N'}</child><poster>https://example.com/{i}.png</poster>"
                f"<relates><relate><relatenm>샘플예매처</relatenm><relateurl>https://example.com/t/{i}</relateurl></relate></relates></db></dbs>")
    state = {"02": "공연중", "01": "공연예정"}[params["prfstate"]]
    rows = [(i, v) for i, v in CUR_ITEMS.items() if v[4] == params["prfstate"] and (params.get("kidstate") != "Y" or i in CUR_KIDS)]
    return "<dbs>" + "".join(f"<db><mt20id>{i}</mt20id><prfnm>{v[0]}</prfnm><prfpdfrom>{v[1]}</prfpdfrom><prfpdto>{v[2]}</prfpdto><fcltynm>{v[3]}</fcltynm><poster>https://example.com/l/{i}.png</poster>"
                             f"<area>서울특별시</area><genrenm>뮤지컬</genrenm><openrun>N</openrun><prfstate>{state}</prfstate></db>" for i, v in rows) + "</dbs>"


def run_current(a):
    today = date.today()
    if a.sample:
        get, cache, label, name = cur_sample_get, None, "[SAMPLE — 가짜 데이터] ", "kopis_current_sample"
    else:
        key = env_key("KOPIS_API_KEY")
        if not key:
            sys.exit("KOPIS_API_KEY 가 없어요. 프로젝트 루트 .env 에 KOPIS_API_KEY=... 를 넣거나 --sample 로 돌려 보세요.")
        get, cache, label, name = (lambda p, q: http_get(key, p, q)), ROOT / "data" / "kopis_cache", "", f"kopis_current_{today}"
    try:
        res = fetch_current(get, today, a.max_calls, cache, a.refresh)
    except RuntimeError as e:  # 목록 호출 실패(키 오류·네트워크). 키는 http_get 이 메시지에서 지운다
        sys.exit(f"KOPIS 호출 실패: {e}")
    kept, ex, used = res["kept"], res["excluded"], res["used"]
    out = ROOT / "data" / f"{name}.tsv"
    write_current(out, kept)
    write_excluded(ROOT / "data" / f"{name}_excluded.tsv", ex)
    seed = [k for k in kept if seed_of(k)[1]]
    nod = [k for k in kept if k.get("nodetail")]
    print(f"{label}KOPIS 현재 뮤지컬(서울, 공연중 + {AHEAD}일 안 시작): 남김 {len(kept)}개(시드 작품 {len(seed)}개) · 제외 {len(ex)}개 · 호출 목록 {used['list']}+상세 {used['detail']}회(상한 {a.max_calls}), 캐시 {used['cache']}건"
          + (" · ! 호출 상한에 걸려 일부 상세를 못 받았어요(--max-calls 를 올리세요)" if res["capped"] else ""))
    print(f"상세를 못 받은 공연 {len(nod)}개" + (": " + ", ".join(k["title"] for k in nod[:10]) if nod else "") + " (다시 돌리면 캐시된 건 건너뛰고 이 공연만 받아요)")
    print("제외 사유:", ", ".join(f"{w} {n}" for w, n in Counter(w for _, w in ex).most_common()))
    for k, w in ex[:60]:
        print(f"  - [{w}] {k['title']} | {k['venue']} | {k['start']}~{k['end']}")
    print(f"시드 작품: {', '.join(sorted({seed_of(k)[0] for k in seed}))} / 시드 제목인데 공연장이 다른 것: {[k['title'] for k in kept if seed_of(k)[0] and not seed_of(k)[1]]}")
    profiles = load_actor_profiles()
    print()
    print_coverage(coverage(kept, profiles), profiles)
    print(f"\nwrote {out.relative_to(ROOT)} / {name}_excluded.tsv")


# ---- --past: 끝난 서울 뮤지컬(공연완료 03). 앱 '본 공연 기록하기'에서 예전에 본 공연을 고르게 한다(사용자 요청 2026-10-28) ----
# 끝난 공연은 다시 안 바뀌니 지난 파일(data/kopis_past.tsv, 저장소에 올라감)에 상세까지 있는 공연은 다시 받지 않는다. 주간 실행은 새로 끝난 공연만 받는다
PAST_DAYS = 365   # 끝난 지 이 일수 안의 공연
PAST_FILE = "kopis_past.tsv"
PAST_COLS = ["mt20id", "작품", "공연장", "시작", "끝", "출연진", "포스터URL", "관람연령", "아동", "상세"]  # 상세 Y = 상세(출연진·관람연령)까지 받음. N 이면 다음 실행에서 받는다


def read_past(path):
    """지난 --past 파일 → {id: 행 dict}. 없으면 {}."""
    if not path.exists():
        return {}
    lines = path.read_text(encoding="utf-8").splitlines()
    return {r["mt20id"]: r for r in (dict(zip(PAST_COLS, l.split("\t"))) for l in lines[1:] if l)}


def fetch_past(get, today, known=None, days=PAST_DAYS, max_calls=400):
    """get(path, params) → XML. 오늘-days ~ 어제를 WIN일 창으로 나눠 서울(11) 뮤지컬(GGGA) 공연완료(03) 목록을 받고, known(지난 파일)에 상세가 없는 공연만 상세를 1회 받는다.
    끝 날짜가 범위 밖인 공연(창과 기간만 겹친 것)은 뺀다. 반환 {rows(지난 파일의 범위 안 공연 + 새 공연), used{list,detail}, capped}"""
    known, used, capped = known or {}, {"list": 0, "detail": 0}, False
    lo_all, hi_all = (today - timedelta(days)).isoformat(), (today - timedelta(1)).isoformat()

    def call(kind, path, params):
        if used["list"] + used["detail"] >= max_calls:
            raise Cap()
        used[kind] += 1
        return get(path, params)

    seen = {}
    try:
        for o in range(days, 0, -WIN):
            lo, hi = today - timedelta(o), today - timedelta(max(o - WIN + 1, 1))
            page = 1
            while True:
                rows = parse_list(call("list", "pblprfr", {"stdate": lo.strftime("%Y%m%d"), "eddate": hi.strftime("%Y%m%d"), "cpage": page, "rows": 100, "shcate": "GGGA", "prfstate": "03", "signgucode": "11"}))
                for r in rows:
                    if r["state"] == "공연완료" and lo_all <= r["end"] <= hi_all:
                        seen.setdefault(r["id"], r)
                if len(rows) < 100:
                    break
                page += 1
    except Cap:
        capped = True
    out = {i: {"id": i, "title": k["작품"], "venue": k["공연장"], "start": k["시작"], "end": k["끝"], "cast": k["출연진"], "poster": k["포스터URL"], "age": k["관람연령"], "child": k["아동"], "detail": k["상세"] == "Y"}
           for i, k in known.items() if lo_all <= k["끝"] <= hi_all}  # 지난 파일의 공연(범위 안): 목록 호출이 상한에 걸려도 남는다
    for i, r in seen.items():
        out.setdefault(i, {**r, "cast": "", "age": "", "child": "", "detail": False})
    for r in sorted(out.values(), key=lambda r: r["end"], reverse=True):  # 최근에 끝난 공연부터 상세
        if r["detail"]:
            continue
        try:
            d = parse_detail(call("detail", f"pblprfr/{r['id']}", {}))
            r.update(cast=d["cast"], age=d["age"], child=d["child"], poster=d["poster2"] or r["poster"], detail=True)
        except Cap:
            capped = True
            break
        except Exception as e:
            print(f"! 상세 실패 {r['id']}: {e}", file=sys.stderr)
    return {"rows": sorted(out.values(), key=lambda r: (r["end"], r["id"]), reverse=True), "used": used, "capped": capped}


def write_past(path, rows):
    lines = ["\t".join(PAST_COLS)] + ["\t".join(clean(x) for x in [r["id"], r["title"], r["venue"], r["start"], r["end"], r["cast"], r["poster"], r["age"], r["child"], "Y" if r["detail"] else "N"]) for r in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_past(a):
    today = date.today()
    key = env_key("KOPIS_API_KEY")
    if not key:
        sys.exit("KOPIS_API_KEY 가 없어요. 프로젝트 루트 .env 에 KOPIS_API_KEY=... 를 넣어 주세요.")
    path = ROOT / "data" / PAST_FILE
    try:
        res = fetch_past(lambda p, q: http_get(key, p, q), today, read_past(path), max_calls=a.max_calls)
    except RuntimeError as e:
        sys.exit(f"KOPIS 호출 실패: {e}")
    write_past(path, res["rows"])
    nod = sum(not r["detail"] for r in res["rows"])
    print(f"KOPIS 끝난 뮤지컬(서울, 최근 {PAST_DAYS}일): {len(res['rows'])}개 · 호출 목록 {res['used']['list']}+상세 {res['used']['detail']}회(상한 {a.max_calls})"
          + (f" · 상세를 아직 못 받은 공연 {nod}개(다음 실행에서 이어 받아요)" if nod else "") + (" · ! 호출 상한에 걸렸어요" if res["capped"] else ""))
    print(f"wrote {path.relative_to(ROOT)}")


PAST_ITEMS = {"PFP01": ("지난 뮤지컬", "2026.03.01", "2026.06.30", "A홀"), "PFP02": ("아주 옛날 뮤지컬", "2024.01.01", "2024.02.01", "B홀"),
              "PFP03": ("어제 끝난 뮤지컬", "2026.09.01", "2026.10.10", "C홀")}


def past_sample_get(path, params):
    if "/" in path:
        i = path.rsplit("/", 1)[1]
        return f"<dbs><db><mt20id>{i}</mt20id><prfcast>배우{i}1, 배우{i}2 등</prfcast><prfage>만 7세 이상</prfage><child>N</child><poster>https://example.com/d/{i}.png</poster></db></dbs>"
    lo, hi = iso(params["stdate"][:4] + "." + params["stdate"][4:6] + "." + params["stdate"][6:]), iso(params["eddate"][:4] + "." + params["eddate"][4:6] + "." + params["eddate"][6:])
    rows = [(i, v) for i, v in PAST_ITEMS.items() if iso(v[1]) <= hi and iso(v[2]) >= lo]  # 기간이 창과 겹치는 공연(KOPIS 목록과 같은 방식으로 가정)
    return "<dbs>" + "".join(f"<db><mt20id>{i}</mt20id><prfnm>{v[0]}</prfnm><prfpdfrom>{v[1]}</prfpdfrom><prfpdto>{v[2]}</prfpdto><fcltynm>{v[3]}</fcltynm><poster>https://example.com/l/{i}.png</poster><prfstate>공연완료</prfstate></db>" for i, v in rows) + "</dbs>"


# ---- --boxoffice: 서울 뮤지컬 예매상황판(박스오피스) 주간·월간 순위. 호출은 주간 1 + 월간 1, 응답 XML 은 캐시 폴더에 저장해 같은 날 다시 돌리면 호출 0 ----
BOX_COLS = ["mt20id", "공연명", "주간순위", "월간순위", "기준일"]
BOX_SPANS = [("주간", "week", 7), ("월간", "month", 30)]  # (열 이름, 캐시 파일 접두, 기준일까지 며칠). 조회 창은 최대 31일


def parse_boxoffice(xml_text):
    """예매상황판 응답 → [{id, title, rank}]. 오류 응답(returncode)이면 RuntimeError."""
    root = ET.fromstring(xml_text)
    err = root.find(".//returncode")
    if err is not None:
        raise RuntimeError(f"KOPIS 오류 returncode={err.text} {txt(root.find('.//db'), 'errmsg')}")
    return [{"id": txt(d, "mt20id"), "title": txt(d, "prfnm"), "rank": int(txt(d, "rnum") or 0)} for d in root.findall("boxof") if txt(d, "mt20id") and txt(d, "rnum").isdigit()]


def fetch_boxoffice(get, today, cache=None, refresh=False):
    """get(path, params) → XML 텍스트. 기준일 = 어제(오늘은 집계 중). 주간 = 기준일까지 7일, 월간 = 30일의 서울(area 11) 뮤지컬(GGGA) 순위.
    → (기준일, {mt20id: {title, 주간, 월간}}, {calls, cache}). 순위가 없으면 None."""
    end, ranks, used = today - timedelta(1), {}, {"calls": 0, "cache": 0}
    for label, pre, days in BOX_SPANS:
        f = Path(cache) / f"{pre}_{end}.xml" if cache else None
        if f and f.exists() and not refresh:
            xml = f.read_text(encoding="utf-8")
            used["cache"] += 1
        else:
            xml = get("boxoffice", {"stdate": (end - timedelta(days - 1)).strftime("%Y%m%d"), "eddate": end.strftime("%Y%m%d"), "catecode": "GGGA", "area": "11"})
            used["calls"] += 1
            parse_boxoffice(xml)  # 오류 응답은 캐시에 남기지 않는다
            if f:
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(xml, encoding="utf-8")
        for r in parse_boxoffice(xml):
            e = ranks.setdefault(r["id"], {"title": r["title"], "주간": None, "월간": None})
            e[label] = min(r["rank"], e[label] or r["rank"])
    return end, ranks, used


def write_boxoffice(path, end, ranks):
    best = lambda e: min(x for x in (e["주간"], e["월간"]) if x)
    lines = ["\t".join(BOX_COLS)] + ["\t".join([i, clean(e["title"]), str(e["주간"] or ""), str(e["월간"] or ""), str(end)]) for i, e in sorted(ranks.items(), key=lambda kv: (best(kv[1]), kv[0]))]
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_boxoffice(a):
    key = env_key("KOPIS_API_KEY")
    if not key:
        sys.exit("KOPIS_API_KEY 가 없어요. 프로젝트 루트 .env 에 KOPIS_API_KEY=... 를 넣어 주세요.")
    today = date.today()
    try:
        end, ranks, used = fetch_boxoffice(lambda p, q: http_get(key, p, q), today, ROOT / "data" / "kopis_cache" / "boxoffice", a.refresh)  # 키는 http_get 이 오류 메시지에서 지운다
    except RuntimeError as e:
        sys.exit(f"KOPIS 호출 실패: {e}")
    out = ROOT / "data" / f"kopis_boxoffice_{today}.tsv"
    write_boxoffice(out, end, ranks)
    print(f"KOPIS 예매상황판(서울 뮤지컬, 기준일 {end}): 순위 있는 공연 {len(ranks)}개(주간 {sum(1 for e in ranks.values() if e['주간'])} · 월간 {sum(1 for e in ranks.values() if e['월간'])}) · 호출 {used['calls']}회, 캐시 {used['cache']}건")
    print(f"wrote {out.relative_to(ROOT)}")


def selftest():
    assert norm("뮤지컬 〈디어 에반 핸슨〉 - 서울!") == "뮤지컬디어에반핸슨서울" and iso("2026.08.16") == "2026-08-16"
    assert parse_detail(SAMPLE_DETAIL["PFSAMPLE01"])["tickets"] == "샘플예매처=https://example.com/sample/ticket/PFSAMPLE01"
    try:
        parse("<dbs><db><returncode>02</returncode><errmsg>SERVICE KEY IS NOT REGISTERED ERROR</errmsg></db></dbs>")
        raise SystemExit("오류 응답을 못 잡았다")
    except RuntimeError as e:
        assert "02" in str(e)
    # 가짜 RUNS 로 한 번에: 일치 / 기간 변경 / 신규(새 공연·새 작품) / 종료(기간 만료·목록에 없음) / 조회 범위 밖은 제외
    runs = [("가", "서울", "A극장", "2026-10-01", "2026-12-31", "", "", []), ("가", "대구", "B극장", "2027-01-05", "2027-01-10", "", "", []),
            ("나", "서울", "C홀", "2026-10-05", "2026-11-05", "", "", []), ("다", "서울", "D홀", "2026-09-01", "2026-09-30", "", "", []),
            ("라", "서울", "E홀", "2030-01-01", "2030-02-01", "", "", [])]
    k = lambda t, v, a, b: {"title": t, "venue": v, "start": a, "end": b}
    ks = [k("뮤지컬 가 (서울)", "A극장 (대극장)", "2026-10-01", "2026-12-31"), k("나", "C홀 (소극장)", "2026-10-05", "2026-11-12"),
          k("가 - 부산", "부산홀", "2026-11-01", "2026-11-30"), k("새작품", "X홀", "2026-10-10", "2026-10-20")]
    new, changed, gone = diff(ks, runs, date(2026, 10, 3), 120)
    assert [x["kind"] for x in ks] == ["일치", "기간 변경", "신규(새 공연)", "신규(새 작품)"], [x["kind"] for x in ks]
    assert len(new) == 2 and len(changed) == 1 and gone == [1, 3], gone  # 가/대구는 목록에 없음, 다/서울은 기간 만료, 라는 범위 밖이라 제외
    assert "가/서울" not in hint(ks[2], runs, gone) and "대구" not in hint(k("나", "x", "2026-10-06", "2026-10-07"), runs, gone)
    assert "서울" in hint(k("다", "x", "2026-09-10", "2026-09-20"), runs, gone)  # 같은 작품·겹치는 기간의 종료 후보가 있으면 힌트
    # 샘플 XML 전체 흐름 + TSV
    kopis = fetch(sample_get, 120, date(2026, 10, 3))
    assert len(kopis) == 3 and all(x["tickets"] and x["cast"] for x in kopis), kopis
    new, changed, gone = diff(kopis, RUNS, date(2026, 10, 3), 120)
    assert [x["id"] for x in new] == ["PFSAMPLE03"] and [x["id"] for x in changed] == ["PFSAMPLE01"], (new, changed)
    out = Path(__file__).parent / "data" / "kopis_runs_selftest.tsv"
    write_tsv(out, kopis, RUNS)
    rows = out.read_text(encoding="utf-8").splitlines()
    out.unlink()
    assert rows[0].split("\t") == COLS and len(rows) == 4 and all(len(r.split("\t")) == len(COLS) for r in rows), rows
    # 일시적 HTTP 오류(400 등)는 다시 시도, 그 밖의 코드·마지막 실패는 그대로
    flaky = {"n": 0}
    def flake(fail):
        def f():
            flaky["n"] += 1
            if flaky["n"] <= fail:
                raise urllib.error.HTTPError("u", 400, "Bad Request", {}, None)
            return "ok"
        return f
    waits = []
    assert retry_call(flake(2), sleep=waits.append) == "ok" and flaky["n"] == 3 and waits == [2, 5], waits
    flaky["n"] = 0
    try:
        retry_call(flake(5), sleep=lambda _: None)
        raise SystemExit("세 번 다 실패하면 오류가 나야 한다")
    except urllib.error.HTTPError:
        assert flaky["n"] == 3
    try:
        retry_call(lambda: (_ for _ in ()).throw(urllib.error.HTTPError("u", 404, "Not Found", {}, None)), sleep=lambda _: None)
        raise SystemExit("404 는 다시 시도하지 않고 바로 오류")
    except urllib.error.HTTPError as e:
        assert e.code == 404
    # --current: 샘플 XML 전체 흐름(제외 사유·캐시·상한·커버리지)
    t = date(2026, 10, 10)
    r1 = fetch_current(cur_sample_get, t, 300)
    assert sorted(k["id"] for k in r1["kept"]) == ["PFC01", "PFC04", "PFC06"], [k["id"] for k in r1["kept"]]
    why = {k["id"]: w for k, w in r1["excluded"]}
    assert why == {"PFC02": "콘서트·행사 제목", "PFC03": "아동(kidstate=Y)", "PFC05": "단기 공연(3일 이하)", "PFC07": f"시작이 {AHEAD}일 뒤보다 늦음", "PFC08": "투어 제목", "PFC09": "아동(child=Y)", "PFC10": "펍·카페 공연장"}, why
    assert r1["used"] == {"list": 8, "detail": 4, "cache": 0} and not r1["capped"], r1["used"]  # 목록 8회(02 한 창 + 01 세 창, 각각 전체·아동) + 상세 4회(아동 판정 전 남은 4개)
    assert seed_of({"title": "뮤지컬 〈엘리자벳〉 콘서트", "venue": "다른홀"}) == ("엘리자벳", False) and seed_of({"title": "뮤지컬 〈엘리자벳〉 - 서울", "venue": "블루스퀘어 (우리은행홀)"}) == ("엘리자벳", True), "제목만 맞고 공연장이 다르면 시드로 지키지 않는다"
    with tempfile.TemporaryDirectory() as td:
        c = Path(td) / "cache"
        a1 = fetch_current(cur_sample_get, t, 300, c)
        a2 = fetch_current(cur_sample_get, t, 300, c)
        assert a1["used"]["detail"] == 4 and a2["used"] == {"list": 8, "detail": 0, "cache": 4} and len(list(c.glob("*.xml"))) == 4, (a1["used"], a2["used"])  # 두 번째는 상세를 다시 안 받는다
        a3 = fetch_current(cur_sample_get, t, 300, c, refresh=True)
        assert a3["used"]["detail"] == 4, "--refresh 는 캐시를 무시"
        capped = fetch_current(cur_sample_get, t, 10)  # 목록 8 + 상세 2 → 시드부터 받고 나머지는 상세 없음
        assert capped["capped"] and sum(bool(k.get("nodetail")) for k in capped["kept"]) == 2 and next(k for k in capped["kept"] if k["id"] == "PFC01")["cast"], capped["used"]  # 상세 2회: 시드(PFC01) → 제목순 다음(PFC04), 나머지 둘은 상세 없음
        tiny = fetch_current(cur_sample_get, t, 3)  # 목록 3회에서 멈춤: 받은 공연만 남기고 전부 상세 없음으로 표시
        assert tiny["capped"] and tiny["kept"] and all(k.get("nodetail") for k in tiny["kept"]) and tiny["used"]["detail"] == 0, tiny["used"]
        out = Path(td) / "cur.tsv"
        write_current(out, r1["kept"])
        rows = out.read_text(encoding="utf-8").splitlines()
        assert rows[0].split("\t") == CUR_COLS and len(rows) == 4 and all(len(x.split("\t")) == len(CUR_COLS) for x in rows), rows
        e1 = next(x.split("\t") for x in rows[1:] if x.startswith("PFC01"))
        assert e1[CUR_COLS.index("시드작품")] == "엘리자벳" and e1[CUR_COLS.index("시드공연일치")] == "Y" and e1[CUR_COLS.index("관람연령")] == "만 7세 이상" and e1[CUR_COLS.index("예매처링크")] == "샘플예매처=https://example.com/t/PFC01", e1
        ex_out = Path(td) / "ex.tsv"
        write_excluded(ex_out, r1["excluded"])
        assert len(ex_out.read_text(encoding="utf-8").splitlines()) == 1 + len(r1["excluded"])
    assert parse_cast("이지연, 이지혜, 이지수 외 3명 등") == ["이지연", "이지혜", "이지수"] and parse_cast("홍길동(초연), 김철수 등") == ["홍길동", "김철수"] and parse_cast("") == [] and parse_cast("A역 : 박은태 / 카이 외") == ["박은태", "카이"] and parse_cast("가, 가, 나") == ["가", "나"]
    prof = {"샘플배우A": {"voice": [{"tag": "성량"}], "role": []}, "샘플배우B": {"voice": [], "role": [{"tag": "코믹 연기"}]}}
    cov = coverage([{**k, "cast": "샘플배우A, 샘플배우B 등"} for k in r1["kept"][:2]] + [{"id": "X", "title": "무명", "venue": "홀", "cast": "무명1, 샘플배우A"}, {"id": "Y", "title": "배우없음", "venue": "홀", "cast": ""}], prof)
    c = cov["all"]
    assert (c["shows"], c["no_cast"], c["actors"], c["with_profile"], c["with_voice"], c["shows_with_profile"]) == (4, 1, 3, 2, 1, 3), c  # 배우 샘플A·샘플B·무명1 / 프로필 둘 / 목소리 태그 하나 / 프로필 있는 배우가 나오는 공연 3
    assert c["names"].most_common(1) == [("샘플배우A", 3)] and cov["seed"]["shows"] + cov["other"]["shows"] == 4
    # 예매상황판: 주간·월간 두 번만 호출(조회 창 7일·30일, 서울·뮤지컬), 한쪽에만 있는 공연은 다른 쪽이 None, 같은 날 다시 돌리면 캐시(호출 0), 오류 응답은 캐시에 안 남는다
    box = lambda rows: "<boxofs>" + "".join(f"<boxof><rnum>{n}</rnum><prfnm>{t}</prfnm><mt20id>{i}</mt20id><poster>http://x/p.jpg</poster></boxof>" for n, i, t in rows) + "</boxofs>"
    seen = []

    def box_get(path, q):
        seen.append((path, q))
        return box([(1, "PA", "가"), (2, "PB", "나")] if q["stdate"] == "20261005" else [(1, "PB", "나"), (3, "PC", "다  공연")])
    with tempfile.TemporaryDirectory() as td:
        end, ranks, used = fetch_boxoffice(box_get, date(2026, 10, 12), Path(td) / "box")
        assert str(end) == "2026-10-11" and used == {"calls": 2, "cache": 0} and [q["stdate"] for _, q in seen] == ["20261005", "20260912"], (end, used, seen)
        assert all(q["eddate"] == "20261011" and q["catecode"] == "GGGA" and q["area"] == "11" and p == "boxoffice" for p, q in seen)
        assert ranks == {"PA": {"title": "가", "주간": 1, "월간": None}, "PB": {"title": "나", "주간": 2, "월간": 1}, "PC": {"title": "다 공연", "주간": None, "월간": 3}}, ranks
        n = len(seen)
        assert fetch_boxoffice(box_get, date(2026, 10, 12), Path(td) / "box")[2] == {"calls": 0, "cache": 2} and len(seen) == n, "같은 날 다시 돌리면 캐시"
        assert fetch_boxoffice(box_get, date(2026, 10, 12), Path(td) / "box", True)[2]["calls"] == 2, "--refresh 는 캐시를 무시"
        bad = lambda p, q: "<dbs><db><returncode>01</returncode><errmsg>INVALID REQUEST PARAMETER ERROR</errmsg></db></dbs>"
        try:
            fetch_boxoffice(bad, date(2026, 10, 13), Path(td) / "box")
            raise SystemExit("오류 응답을 못 잡았다")
        except RuntimeError as e:
            assert "01" in str(e) and not list((Path(td) / "box").glob("*2026-10-12.xml")), "오류 응답은 캐시에 남기지 않는다"
        out = Path(td) / "box.tsv"
        write_boxoffice(out, end, ranks)
        assert out.read_text(encoding="utf-8").splitlines() == ["\t".join(BOX_COLS), "PA\t가\t1\t\t2026-10-11", "PB\t나\t2\t1\t2026-10-11", "PC\t다 공연\t\t3\t2026-10-11"]  # 가장 좋은 순위 순(같으면 id 순), out.read_text(encoding="utf-8")
    # --past: 범위 안에서 끝난 공연만, 최근에 끝난 순. 지난 파일에 상세가 있으면 다시 안 받고, 호출 상한이면 상세 N 으로 남겨 다음에 받는다
    t0 = date(2026, 10, 11)
    res = fetch_past(past_sample_get, t0)
    assert [r["id"] for r in res["rows"]] == ["PFP03", "PFP01"] and all(r["detail"] and r["cast"].startswith("배우") and "/d/" in r["poster"] for r in res["rows"]) and res["used"]["detail"] == 2, res
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "past.tsv"
        write_past(p, res["rows"])
        kn = read_past(p)
        assert set(kn) == {"PFP01", "PFP03"} and kn["PFP01"]["상세"] == "Y" and kn["PFP01"]["출연진"] == "배우PFP011, 배우PFP012 등"
        res2 = fetch_past(past_sample_get, t0, kn)
        assert res2["used"]["detail"] == 0 and [r["id"] for r in res2["rows"]] == ["PFP03", "PFP01"], res2["used"]
    res3 = fetch_past(past_sample_get, t0, max_calls=13)
    assert res3["capped"] and res3["used"] == {"list": 13, "detail": 0} and not any(r["detail"] for r in res3["rows"]) and len(res3["rows"]) == 2
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", action="store_true", help="키 없이 샘플 XML로 실행")
    ap.add_argument("--days", type=int, default=120, help="오늘부터 며칠 앞까지 볼지(기본 120)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--current", action="store_true", help="지금 서울에서 하는(+60일 안 시작) 뮤지컬 전체와 출연진, 배우 프로필 커버리지 (data/kopis_current_YYYY-MM-DD.tsv)")
    ap.add_argument("--max-calls", type=int, default=300, help="--current 의 호출 상한(목록+상세, 캐시는 안 셈. 기본 300)")
    ap.add_argument("--refresh", action="store_true", help="--current·--boxoffice 에서 캐시를 무시하고 다시 받는다")
    ap.add_argument("--past", action="store_true", help=f"최근 {PAST_DAYS}일 안에 끝난 서울 뮤지컬과 출연진 (data/{PAST_FILE}, 지난 파일에 상세가 있는 공연은 다시 안 받는다. --max-calls 상한)")
    ap.add_argument("--boxoffice", action="store_true", help="서울 뮤지컬 예매상황판 주간·월간 순위 (data/kopis_boxoffice_YYYY-MM-DD.tsv, 호출 2번)")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        sys.exit()
    if a.current:
        run_current(a)
        sys.exit()
    if a.boxoffice:
        run_boxoffice(a)
        sys.exit()
    if a.past:
        run_past(a)
        sys.exit()
    today = date.today()
    if a.sample:
        get, label, name = sample_get, "[SAMPLE — 가짜 데이터, 3건뿐이라 '종료'는 의미 없음]", "kopis_runs_sample.tsv"
    else:
        key = env_key("KOPIS_API_KEY")
        if not key:
            sys.exit("KOPIS_API_KEY 가 없어요. 프로젝트 루트 .env 에 KOPIS_API_KEY=... 를 넣거나 --sample 로 돌려 보세요.")
        get, label, name = (lambda p, q: http_get(key, p, q)), "", f"kopis_runs_{today}.tsv"
    try:
        kopis = fetch(get, a.days, today)
    except RuntimeError as e:  # 목록 호출 실패(키 오류·네트워크). 상세 실패는 fetch 안에서 경고만 하고 계속
        sys.exit(f"KOPIS 호출 실패: {e}")
    new, changed, gone = diff(kopis, RUNS, today, a.days)
    out = ROOT / "data" / name
    write_tsv(out, kopis, RUNS)
    report(kopis, RUNS, new, changed, gone, today, label)
    print(f"\nwrote {out.relative_to(ROOT)}")
