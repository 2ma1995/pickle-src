"""LLM 태깅 입력 만들기: 줄마다 JSON 한 건(JSONL). 사람(7c)이든 로컬 LLM이든 이 파일을 받아 결과 JSONL 을 만든다.
  python3 tools/tagging/make_jobs.py --kind work  [--date 2026-10-11] [--out 경로]   # 현재 공연 + 시드 작품 → data/tagging/jobs_work_<날짜>.jsonl
  python3 tools/tagging/make_jobs.py --kind actor [--actor 이름] [--limit N]         # 기존 배우 근거(+출연 이력) → data/tagging/jobs_actor_<날짜>.jsonl
  python3 tools/tagging/make_jobs.py --selftest
KOPIS 상세의 소개 글(sty)이 비어 있는 공연이 대부분이라 synopsis 는 있으면 넣고 없으면 ""(빈 값). intro_images(소개 이미지 주소)·kopis_url·existing_tags 는 선택 필드.
글(synopsis)도 이미지(intro_images)도 없는 공연은 작업 목록에서 빼고 이름만 보고한다(근거 글이 없으니 태그를 달 수 없다)."""
import argparse
import csv
import html
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common
import recommend

CACHE = common.ROOT / "data" / "kopis_cache"
HISTORY = sorted((common.ROOT / "data").glob("actor_history_wiki_2*.tsv"))[-1:]


def detail(mt20id, cache=CACHE):
    """KOPIS 상세 캐시에서 {genre, synopsis, images}. 캐시가 없거나 깨져 있으면 빈 값."""
    f = Path(cache) / f"{mt20id}.xml"
    if not f.exists():
        return {"genre": "", "synopsis": "", "images": []}
    try:
        db = ET.parse(f).getroot().find("db")
    except ET.ParseError:
        return {"genre": "", "synopsis": "", "images": []}
    if db is None:
        return {"genre": "", "synopsis": "", "images": []}
    clean = lambda t: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t or ""))).strip()
    text = lambda tag: "".join(db.find(tag).itertext()) if db.find(tag) is not None else ""
    imgs = [recommend.https_url(x.text) for x in db.iter("styurl") if (x.text or "").strip()]
    return {"genre": clean(text("genrenm")), "synopsis": clean(text("sty")), "images": [i for i in imgs if i]}


def work_targets(today, cur=None, cur_path=None):
    """[(title, 공연 정보 dict)] — KOPIS 현재 공연(시드 제외) + 시드 작품(제목은 시드 작품명). 끝난 공연은 뺀다."""
    cur = recommend.load_current_shows(date.fromisoformat(today)) if cur is None else cur
    out = [(s["title"], {"id": s["id"], "venue": s["venue"], "start": s["start"], "end": s["end"], "age": s["age"], "runtime": s["runtime"]}) for s in cur["shows"]]
    files = [Path(cur_path)] if cur_path else sorted(f for f in (common.ROOT / "data").glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))[-1:]
    for f in (f for f in files if f.exists()):
        for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
            if r["시드작품"] and r["시드공연일치"] == "Y" and r["끝"] >= today:
                out.append((r["시드작품"], {"id": r["mt20id"], "venue": r["공연장"], "start": r["시작"], "end": r["끝"], "age": r["관람연령"], "runtime": r["러닝타임"]}))
    return out


def existing_work_tags():
    """{작품: [{work, actor, tag, source}]} 지금 시트 확정 작품 태그(규칙 문서 1-1 existing_tags 형식 — 같은 (대상, 태그, 출처)는 다시 내지 않게 입력에 같이 준다)."""
    return {w: [{"work": w, "actor": "", "tag": r[recommend.C_TAG], "source": r[recommend.C_LINK]} for r in rows] for w, rows in recommend.load_work_tags().items()}


def work_jobs(today, dict_path=None, cur=None, cur_path=None, cache=CACHE, areas=None, existing=None):
    """→ (jobs, skipped_titles). 한 공연 = 입력 한 건(id 'work:<mt20id>')."""
    areas = recommend.load_venue_areas()[0] if areas is None else areas
    allowed = common.allowed_tags("work_theme", common.dict_rows(dict_path))
    existing = existing_work_tags() if existing is None else existing
    jobs, skipped, seen = [], [], set()
    for title, s in work_targets(today, cur, cur_path):
        if s["id"] in seen:
            continue
        seen.add(s["id"])
        d = detail(s["id"], cache)
        if not d["synopsis"] and not d["images"]:
            skipped.append(title)
            continue
        url = common.SOURCE_URL.format(s["id"])
        job = {"schema": common.SCHEMA, "kind": "work_theme", "id": f"work:{s['id']}", "title": title, "venue": s["venue"], "area": recommend.area_for(s["venue"], title, areas),
               "genre": d["genre"], "age": s["age"], "runtime": s["runtime"], "period": f"{s['start']} ~ {s['end']}",
               "synopsis": d["synopsis"], "kopis_url": url, "intro_images": d["images"], "allowed_tags": allowed}
        if d["synopsis"]:
            job["synopsis_source"] = {"level": "제작진·공식", "url": url}  # KOPIS 공연 소개는 제작사가 올린 공식 정보. 글이 없고 이미지로 판단하면 근거 수준은 '제작진·공식', 링크는 kopis_url(문서 1-2)
        if existing.get(title):
            job["existing_tags"] = existing[title]
        jobs.append(job)
    return jobs, skipped


def actor_jobs(dict_path=None, actor=None, limit=None, tags=None, history=None):
    """배우 한 명 = 입력 한 건. 지금 시트 확정 배우 행의 근거 글을 segments 로, 출연 이력(위키)을 history 로 붙인다.
    새 근거(설문·후기)가 생기면 같은 모양으로 segments/source 만 바꿔서 쓴다 — 여기서는 형식을 맞추는 것까지만."""
    allowed = common.allowed_tags("actor_trait", common.dict_rows(dict_path))
    if history is None:
        history = defaultdict(list)
        for f in HISTORY:
            for r in csv.DictReader(open(f, encoding="utf-8"), delimiter="\t"):
                history[r["배우"]].append({"year": r["연도"], "work": r["작품"], "role": r["배역"]})
    by = defaultdict(list)
    for r in (recommend.tag_rows() if tags is None else tags):
        if r[recommend.C_TYPE] in ("배우", "조합") and r[recommend.C_ACTOR] and r[recommend.C_STATE] in ("확정", "") and r[recommend.C_WHY].strip():
            by[r[recommend.C_ACTOR]].append(r)
    jobs = []
    for name in sorted(by):
        if actor and name != actor:
            continue
        rows = by[name]
        jobs.append({"schema": common.SCHEMA, "kind": "actor_trait", "id": f"actor:{name}", "context": {"actor": name, "work": "", "season": "", "role": "", "partner": ""},
                     "source": {"type": "기존 태그 기록", "level": "일반 관객 후기", "url": "", "tag": ""},
                     "segments": [{"label": "기존 근거", "text": r[recommend.C_WHY]} for r in rows], "history": history.get(name, [])[-12:], "allowed_tags": allowed,
                     "existing_tags": [{"work": r[recommend.C_WORK], "actor": name, "tag": r[recommend.C_TAG], "source": r[recommend.C_LINK]} for r in rows]})
        if limit and len(jobs) >= limit:
            break
    return jobs


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--kind", choices=["work", "actor"])
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--out")
    ap.add_argument("--actor")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.kind:
        ap.error("--kind work|actor")
    out = Path(a.out) if a.out else common.OUT_DIR / f"jobs_{a.kind}_{a.date}.jsonl"
    if a.kind == "work":
        jobs, skipped = work_jobs(a.date)
        print(f"작품 입력 {len(jobs)}건 → {out}")
        print(f"  소개 글·이미지 모두 없어 뺀 공연 {len(skipped)}건" + (": " + ", ".join(skipped) if skipped else ""))
        print(f"  글(synopsis) 있음 {sum(1 for j in jobs if j['synopsis'])}건 · 이미지만 {sum(1 for j in jobs if not j['synopsis'])}건")
    else:
        jobs = actor_jobs(actor=a.actor, limit=a.limit)
        print(f"배우 입력 {len(jobs)}건 → {out}")
    common.write_jsonl(out, jobs)


def selftest():
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    (tmp / "dict.tsv").write_text("대분류\t태그\t하위 영역\t뜻\t이런 표현이면 이 태그\t연결 취향축\t태그 상태\n"
                                  "작품 · 소재\t로맨스\t소재\t사랑\t사랑, 연애\t\t확정\n작품 · 소재\t후보태그\t소재\t뜻\t\t\t후보\n배우 · 음색\t맑음\t음색\t뜻\t맑다\t\t확정\n", encoding="utf-8")
    cache = tmp / "cache"
    cache.mkdir()
    xml = '<dbs><db><genrenm>뮤지컬</genrenm><sty>{}</sty><styurls>{}</styurls></db></dbs>'
    (cache / "PF1.xml").write_text(xml.format("  두 사람의 <b>사랑</b>&amp;이별  ", "<styurl>http://www.kopis.or.kr/upload/a.jpg</styurl>"), encoding="utf-8")
    (cache / "PF2.xml").write_text(xml.format(" ", "<styurl>http://www.kopis.or.kr/upload/b.jpg</styurl>"), encoding="utf-8")
    (cache / "PF3.xml").write_text(xml.format("", ""), encoding="utf-8")
    cur = {"shows": [{"id": f"PF{i}", "title": f"공연{i}", "venue": "대학로 극장", "start": "2026-10-01", "end": "2026-12-01", "age": "만 7세 이상", "runtime": "1시간"} for i in (1, 2, 3, 4)]}
    jobs, skipped = work_jobs("2026-10-11", tmp / "dict.tsv", cur, tmp / "none.tsv", cache, {"대학로극장": "대학로"}, {"공연1": [{"work": "공연1", "actor": "", "tag": "로맨스", "source": "https://x"}]})
    assert [j["id"] for j in jobs] == ["work:PF1", "work:PF2"] and skipped == ["공연3", "공연4"], (jobs, skipped)  # 글·이미지 없으면 제외, 캐시 없는 공연도
    j1, j2 = jobs
    assert j1["synopsis"] == "두 사람의 사랑&이별" and j1["intro_images"] == ["https://kopis.or.kr/upload/a.jpg"], j1
    assert j2["synopsis"] == "" and j2["intro_images"] == ["https://kopis.or.kr/upload/b.jpg"] and "existing_tags" not in j2
    assert j1["existing_tags"] == [{"work": "공연1", "actor": "", "tag": "로맨스", "source": "https://x"}] and j1["area"] == "대학로" and j1["genre"] == "뮤지컬"
    assert [t["tag"] for t in j1["allowed_tags"]] == ["로맨스"], j1["allowed_tags"]  # 후보 상태·배우 태그는 안 들어간다
    assert j1["synopsis_source"] == {"level": "제작진·공식", "url": common.SOURCE_URL.format("PF1")} and j1["kopis_url"] == j1["synopsis_source"]["url"]
    assert "synopsis_source" not in j2 and j2["kopis_url"]  # 글이 없으면 synopsis_source 도 없다(문서 1-1: 글이 있을 때만 필수)
    # 시드 작품: 제목은 시드 작품명, 끝난 것은 제외
    seed = tmp / "cur.tsv"
    seed.write_text("mt20id\t작품\t공연장\t시작\t끝\t상태\t출연진\t포스터URL\t관람연령\t러닝타임\t공연시간\t예매처링크\t시드작품\t시드공연일치\n"
                    "PF1\tKOPIS 제목\t극장\t2026-10-01\t2026-12-01\t공연중\t\t\t\t\t\t\t시드극\tY\nPF2\tx\t극장\t2026-01-01\t2026-02-01\t공연종료\t\t\t\t\t\t\t끝난극\tY\n", encoding="utf-8")
    t = work_targets("2026-10-11", {"shows": []}, seed)
    assert [x[0] for x in t] == ["시드극"], t
    # 배우 입력
    def row(actor, ev, typ="배우"):  # tag_rows() 가 주는 C_* 열 순서
        r = [""] * len(recommend.TAG_COLS)
        r[recommend.C_TYPE], r[recommend.C_ACTOR], r[recommend.C_TAG], r[recommend.C_STATE], r[recommend.C_WHY] = typ, actor, "맑음", "확정", ev
        return r
    aj = actor_jobs(tmp / "dict.tsv", tags=[row("가나", "목소리가 맑다"), row("가나", "고음이 시원하다"), row("다라", "")], history={"가나": [{"year": "2020", "work": "극", "role": "역"}]})
    assert [j["id"] for j in aj] == ["actor:가나"] and len(aj[0]["segments"]) == 2 and aj[0]["history"][0]["work"] == "극", aj  # 근거 없는 배우는 입력이 안 된다
    assert [t["tag"] for t in aj[0]["allowed_tags"]] == ["맑음"]
    print("make_jobs selftest OK")


if __name__ == "__main__":
    main()
