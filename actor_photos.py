#!/usr/bin/env python3
"""배우 프로필 사진(앱 추천 조합 카드·피하고 싶은 배우의 동그란 사진) → data/actor_photos.tsv

출처는 위키미디어 공용(Wikimedia Commons)의 자유 이용 사진만 쓴다(2026-10-29). 네이버·NOL(인터파크) 프로필 사진은
저작권·초상권과 각 사이트 약관 때문에 가져오지 않는다. 공용 사진도 대부분 저작자 표시가 필요한 라이선스(CC BY·CC BY-SA)라
앱의 '사진 출처' 화면(#photos)에 저작자·라이선스·원본 링크를 함께 보인다.

같은 이름의 다른 사람(예: 그룹 EXO 카이, 조선 정치인 민영기)을 막으려고 이름으로 자동 매칭하지 않는다. 아래 APPROVED 에
사람이 확인한 위키데이터 ID 만 적는다. 기준: 위키데이터 설명에 '뮤지컬'이 있거나 직업이 뮤지컬 배우·무대 배우이고, 같은 이름이 하나뿐.
사진을 더할 때는 위키데이터에서 그 배우 항목(Q…)을 찾아 사진(P18)이 그 배우인지 눈으로 확인한 뒤 APPROVED 에 넣고 다시 돌린다.

사용:  python3 actor_photos.py            # 네트워크 필요(위키데이터·공용 API, 키 없음)
       python3 actor_photos.py --selftest
"""
import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "data" / "actor_photos.tsv"
COLS = ["배우", "위키데이터", "사진URL", "원본", "라이선스", "저작자"]
UA = {"User-Agent": "pickle-actor-photos/1.0 (https://github.com/2ma1995/pickle-src)"}
APPROVED = {  # 배우 이름(앱 배역표 그대로) → 위키데이터 ID. 2026-10-29 설명·직업으로 확인
    "김소현": "Q17486965", "김주택": "Q55728358", "김준수": "Q482783", "린아": "Q541255", "민우혁": "Q20444587", "박지연": "Q16180859",
    "서경수": "Q105705712", "아이비": "Q6099788", "옥주현": "Q490056", "전미도": "Q55733965", "정선아": "Q105706456", "강홍석": "Q28700269",
    "박건형": "Q625304", "조승우": "Q483011",
}
THUMB = 240  # 동그란 사진은 화면에서 72px 이하. 2~3배 화면도 선명하게


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def commons_file(qid):
    """위키데이터 항목의 사진(P18) 파일 이름. 없으면 ''."""
    d = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    claims = d["entities"][qid]["claims"].get("P18", [])
    return claims[0]["mainsnak"]["datavalue"]["value"] if claims else ""


def commons_info(fname):
    """공용 파일 → (썸네일 URL, 파일 페이지, 라이선스 약칭, 저작자)."""
    q = urllib.parse.urlencode({"action": "query", "titles": "File:" + fname, "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": THUMB, "format": "json"})
    page = next(iter(get_json("https://commons.wikimedia.org/w/api.php?" + q)["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    return ii.get("thumburl") or ii["url"], ii["descriptionurl"], strip_tags(meta.get("LicenseShortName", {}).get("value")), strip_tags(meta.get("Artist", {}).get("value"))


def row_line(r):
    return "\t".join(re.sub(r"[\t\n]", " ", str(r[c])) for c in COLS)


def main():
    rows = []
    for actor, qid in sorted(APPROVED.items()):
        fname = commons_file(qid)
        if not fname:
            print(f"! {actor} {qid}: 사진(P18) 없음", file=sys.stderr)
            continue
        thumb, page, lic, artist = commons_info(fname)
        if not lic:
            print(f"! {actor}: 라이선스를 못 읽어서 뺐어요 ({page})", file=sys.stderr)
            continue
        rows.append({"배우": actor, "위키데이터": qid, "사진URL": thumb, "원본": page, "라이선스": lic, "저작자": artist or "(저작자 표기 없음)"})
    OUT.write_text("\n".join(["\t".join(COLS)] + [row_line(r) for r in rows]) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(Path(__file__).parent)}: {len(rows)}명 / 확인한 배우 {len(APPROVED)}명")


def selftest():
    assert strip_tags('<a href="x">Kim &amp; Lee</a>\n photo') == "Kim & Lee photo"
    assert row_line({"배우": "가", "위키데이터": "Q1", "사진URL": "u", "원본": "p", "라이선스": "CC BY 4.0", "저작자": "a\tb"}) == "가\tQ1\tu\tp\tCC BY 4.0\ta b"
    assert all(re.fullmatch(r"Q\d+", q) for q in APPROVED.values())
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    selftest() if a.selftest else main()
