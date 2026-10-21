"""LLM 태깅 결과 검사기. 결과 JSONL(7c 규칙 pickle-tagging/1 출력, 줄마다 한 건) 또는 태그 기록 형식 TSV(시트 22열)를 읽어 문제 목록을 찍고, 통과한 행을 시트에 붙일 TSV 로 내보낸다.
  python3 tools/tagging/validate.py --results data/tagging/results_work_2026-10-11.jsonl --jobs data/tagging/jobs_work_2026-10-11.jsonl --out-tsv data/tagging/pass_work_2026-10-11.tsv
  python3 tools/tagging/validate.py --tsv 붙여넣기전.tsv
  python3 tools/tagging/validate.py --selftest
ERROR = 시트에 못 붙임(내보내기에서 빠짐), WARN = 붙이기 전에 사람이 볼 것(내보내기엔 들어감). 오류가 하나라도 있으면 종료 코드 1.
기준: 규칙 문서 docs/llm_tagging_spec_2026-10-11.md 1-3(검사기 규칙 표) — 태그는 사전 '확정'만(작품은 '작품 ·', 배우는 '배우 ·'/'배우 조합') · 금지어(배우 근거는 오류, 작품 근거는 경고) · 필수 칸 · 작품명 = KOPIS 공연 제목 · 근거 100자 이하·한 문장·원문 복사."""
import argparse
import difflib
import re
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common
import make_jobs
import recommend

REQUIRED = {"work_theme": ["work", "tag", "confidence", "status", "evidence", "evidence_level", "source_url"],
            "actor_trait": ["target", "work", "tag", "scope", "interpretation_diff", "confidence", "status", "evidence"]}
CONF = {"work_theme": ("높음", "보통"), "actor_trait": ("높음", "보통", "낮음")}
SHEET_STATUS = ("확정", "검수 필요", "보류")
NO_LINK_LEVELS = ("설문", "직접 관람")  # 공개 주소가 없는 근거 수준(시트 출처 링크 비어도 됨)


HEX_ID = re.compile(r"#[0-9a-f]{8}")


def source_keys(*vals):
    """같은 출처인지 보는 열쇠들: 링크 그대로, 근거 끝 표시의 '#8자리' 설문 번호. 링크가 없는 설문 행끼리도 같은 응답을 알아보게 한다."""
    keys = set()
    for v in vals:
        v = str(v or "").strip()
        if v:
            keys.add(v)
            keys.update(HEX_ID.findall(v))
    return keys


def is_dup(keys, name, tag, existing):
    return any((k, name, tag) in existing for k in keys)


def make_ctx(dict_path=None, titles=None, existing=None, recorder="LLM 태깅", today=None, banned_path=None):
    """existing = {(출처 키, 작품 또는 배우, 태그)} — 시트에 이미 있는 행(문서 5-2: 링크+배우+태그 대조). 출처가 같을 때만 중복이다."""
    today = today or date.today().isoformat()
    if titles is None:
        titles = {t for t, _ in make_jobs.work_targets(today)} | recommend.load_known_titles()  # 지금 공연 + 최근 KOPIS 파일에 나온 이름(이미 끝난 공연의 작품 태그도 시트에 둔다)
    if existing is None:
        existing = set()
        for r in recommend.tag_rows():
            if r[recommend.C_STATE] in ("확정", "") and r[recommend.C_TYPE] in ("작품", "배우", "조합"):
                name = r[recommend.C_WORK] if r[recommend.C_TYPE] == "작품" else r[recommend.C_ACTOR]
                existing |= {(k, name, r[recommend.C_TAG]) for k in source_keys(r[recommend.C_LINK], r[recommend.C_WHY])}
    return SimpleNamespace(dmap={r["tag"]: r for r in common.dict_rows(dict_path)}, titles=set(titles), existing=existing, recorder=recorder, today=today, banned=common.load_banned(banned_path))


REF_WORDS = re.compile(r"같은 (글|리뷰|후기|응답|기사)|위와 같|앞 행")  # 앞 행을 가리키는 말(근거는 행마다 단독으로 읽혀야 한다, 문서 2-4)


def evidence_problems(ev, kind, sources, ctx, src_tag=None, phrases=()):
    """근거 문장 검사 → [(수준, 메시지)]. sources = 원문 글 목록(연속 3어절 복사·사전 예시 표현 확인용), src_tag = 근거 끝에 붙는 출처 표시."""
    ev = (ev or "").strip()
    if not ev:
        return [("ERROR", "근거가 비어 있음")]
    out = []
    body = common.strip_tag(ev, src_tag) if src_tag else re.sub(r"\s*\([^()]*\)\s*$", "", ev)  # 출처 표시(도메인에 점이 있다)는 떼고 문장을 센다
    if not common.one_sentence(body):
        out.append(("ERROR", "근거가 한 문장이 아님(마침표·물음표 합쳐 1개 이하)"))
    if len(ev) > common.MAX_EVIDENCE:
        out.append(("ERROR", f"근거가 너무 김({len(ev)}자 > {common.MAX_EVIDENCE}자)"))
    lv = "ERROR" if kind == "actor_trait" else "WARN"  # 작품 근거는 줄거리라 등장인물 설명으로 나올 수 있다(문서 1-5)
    out += [(lv, f"금지어({cat}): '{w}'" + ("" if lv == "ERROR" else " — 등장인물 설명이 아니라 배우 이야기면 안 됨")) for cat, w in common.find_banned(body, ctx.banned)]
    if REF_WORDS.search(body):
        out.append(("WARN", "앞 행을 가리키는 말('같은 글' 등) — 근거는 행마다 단독으로 읽혀야 함"))
    texts = [t for t in sources if t]
    for t in texts:
        ov = common.overlap(body, t)
        if ov:
            out.append(("WARN", f"원문과 연속 3어절 같음(복사 의심): '{ov}'"))
            break
    if texts:
        extra = [ph for ph in phrases if ph and ph in body and not any(ph in t for t in texts)]
        if extra:
            out.append(("WARN", f"사전 예시 표현이 근거에 있는데 입력 글에는 없음: {', '.join(extra[:3])}"))
    return out


def tag_problems(tag, kind, allowed, ctx):
    """태그 검사 → ([(수준, 메시지)], 사전 행 또는 None). allowed = 입력의 allowed_tags 의 tag 집합(없으면 None)."""
    d = ctx.dmap.get(tag)
    if not d:
        return [("ERROR", f"태그 '{tag}' 가 사전에 없거나 '확정'이 아님")], None
    out = []
    if not common.group_ok(kind, d["group"]):
        out.append(("ERROR", f"태그 '{tag}' 의 대분류 '{d['group']}' 가 {kind} 에 안 맞음"))
    if allowed is not None and tag not in allowed:
        out.append(("ERROR", f"태그 '{tag}' 가 이 입력의 allowed_tags 밖"))
    return out, d


def title_problem(work, ctx):
    if work in ctx.titles:
        return []
    near = difflib.get_close_matches(work, ctx.titles, n=1, cutoff=0.6)
    return [("ERROR", f"작품명 '{work}' 가 KOPIS 공연 제목(최근 파일)·시드 작품명과 다름" + (f" (혹시 '{near[0]}'?)" if near else ""))]


def pair_problems(conf, status, kind):
    if conf not in CONF[kind]:
        return [("ERROR", f"confidence '{conf}' 는 {kind} 에서 쓸 수 없음({'/'.join(CONF[kind])})")]
    return [] if status == common.STATUS_OF[conf] else [("ERROR", f"confidence '{conf}' 에는 status '{common.STATUS_OF[conf]}' 이어야 함(받은 값 '{status}')")]


def source_kind(url, image=False):
    """시트 '출처 종류' 칸(7c 정답지와 같은 표기): KOPIS 주소면 'KOPIS 공연 상세'(글 없이 소개 이미지로 판단했으면 '(소개 이미지)'를 붙임), 그 밖엔 사이트 도메인."""
    host = urlparse(url).netloc.removeprefix("www.")
    return ("KOPIS 공연 상세(소개 이미지)" if image else "KOPIS 공연 상세") if host.endswith("kopis.or.kr") else host


def check_work_row(row, job, ctx):
    """작품 테마 한 행 → (문제 목록, 시트 행 또는 None)."""
    P = [("ERROR", f"빈 필드: {k}") for k in REQUIRED["work_theme"] if not str(row.get(k) or "").strip()]
    work, tag = str(row.get("work") or "").strip(), str(row.get("tag") or "").strip()
    if work:
        if job:
            P += [] if work == job.get("title") else [("ERROR", f"work '{work}' 가 입력 title '{job.get('title')}' 와 다름")]
        else:
            P += title_problem(work, ctx)
    p, d = tag_problems(tag, "work_theme", {a["tag"] for a in job.get("allowed_tags", [])} if job else None, ctx) if tag else ([], None)
    P += p
    P += pair_problems(row.get("confidence"), row.get("status"), "work_theme") if row.get("confidence") and row.get("status") else []
    lvl, url = str(row.get("evidence_level") or "").strip(), str(row.get("source_url") or "").strip()
    if lvl:
        want = (job.get("synopsis_source") or {}).get("level", "제작진·공식") if job else None  # 글이 없고 이미지로 판단했으면 KOPIS 소개 이미지 = 제작진·공식(문서 1-2)
        if lvl not in common.WORK_LEVELS:
            P.append(("ERROR", f"evidence_level '{lvl}' 는 작품 테마에서 쓸 수 없음({' / '.join(common.WORK_LEVELS)})"))
        elif want and lvl != want:
            P.append(("ERROR", f"evidence_level '{lvl}' 가 입력 synopsis_source.level '{want}' 와 다름"))
    if url and not url.startswith("https://"):
        P.append(("ERROR", f"source_url 이 https:// 로 시작하지 않음: {url[:60]}"))
    if row.get("evidence"):
        P += evidence_problems(row["evidence"], "work_theme", [job.get("synopsis", ""), job.get("synopsis_ocr", "")] if job else [], ctx, None, [x for a in job.get("allowed_tags", []) if a["tag"] == tag for x in a.get("phrases", [])] if job else ())
    if any(lv == "ERROR" for lv, _ in P) or not d:
        return P, None
    return P, [ctx.today, ctx.recorder, work, recommend.SEASON, (job or {}).get("venue", ""), "", "작품", "", "", "", tag, d["group"], d["sub"], d["axis"], "해당 없음", "작품 전체",
               row["status"], lvl, row["evidence"].strip(), source_kind(url, bool(job) and not job.get("synopsis")), url, ""]


def check_actor_row(row, job, ctx):
    """배우 특징 한 행 → (문제 목록, 시트 행 또는 None). 입력(job)이 있으면 배우·시즌·배역·상대 배우 빈 칸은 context 로 채운다."""
    cx, src = (job or {}).get("context", {}), (job or {}).get("source", {})
    g = lambda k: str(row.get(k) or cx.get(k) or "").strip()
    P = [("ERROR", f"빈 필드: {k}") for k in REQUIRED["actor_trait"] if not str(row.get(k) or "").strip()]
    target, tag = str(row.get("target") or "").strip(), str(row.get("tag") or "").strip()
    if target and target not in ("배우", "조합"):
        P.append(("ERROR", f"target '{target}' 은 배우/조합 중 하나여야 함"))
    if not g("actor"):
        P.append(("ERROR", "배우 이름이 없음(행 actor 도 입력 context.actor 도 비어 있음)"))
    if target == "조합":
        P += [] if g("partner") else [("ERROR", "조합인데 partner 가 비어 있음")]
        if row.get("interpretation_diff") and row["interpretation_diff"] != "해당 없음":
            P.append(("ERROR", f"조합 행의 interpretation_diff 는 '해당 없음' 이어야 함(받은 값 '{row['interpretation_diff']}')"))
    elif target == "배우" and str(row.get("partner") or "").strip():
        P.append(("ERROR", "배우 행인데 partner 가 있음(조합이면 target 을 조합으로)"))
    if str(row.get("work") or "").strip() == "배우 전반" and (str(row.get("role") or "").strip() or str(row.get("season") or "").strip()):
        P.append(("WARN", "work 가 '배우 전반'인데 role·season 이 비어 있지 않음"))
    if row.get("scope") and row["scope"] not in ("작품 전체", "특정 넘버", "특정 회차"):
        P.append(("ERROR", f"scope '{row['scope']}' 는 작품 전체/특정 넘버/특정 회차 중 하나여야 함"))
    if row.get("interpretation_diff") and row["interpretation_diff"] not in ("없음", "있음", "해당 없음"):
        P.append(("ERROR", f"interpretation_diff '{row['interpretation_diff']}' 는 없음/있음/해당 없음 중 하나여야 함"))
    p, d = tag_problems(tag, "actor_trait", {a["tag"] for a in job.get("allowed_tags", [])} if job else None, ctx) if tag else ([], None)
    P += p
    P += pair_problems(row.get("confidence"), row.get("status"), "actor_trait") if row.get("confidence") and row.get("status") else []
    if src and src.get("level") not in common.SHEET_LEVELS:
        P.append(("ERROR", f"입력 source.level '{src.get('level')}' 이 시트 허용 목록에 없음"))
    ev = str(row.get("evidence") or "").strip()
    if ev:
        P += evidence_problems(ev, "actor_trait", [s.get("text", "") for s in (job or {}).get("segments", [])], ctx, src.get("tag"),
                               [x for a in (job or {}).get("allowed_tags", []) if a["tag"] == tag for x in a.get("phrases", [])])
        if src.get("tag") and common.strip_tag(ev, src["tag"]) == ev:
            P.append(("ERROR", f"근거가 입력의 source.tag '{src['tag']}' 로 끝나야 함"))
    if any(lv == "ERROR" for lv, _ in P) or not d:
        return P, None
    return P, [ctx.today, ctx.recorder, g("work"), g("season"), "", "", target, g("role"), g("actor"), g("partner") if target == "조합" else "", tag, d["group"], d["sub"], d["axis"],
               row["interpretation_diff"], row["scope"], row["status"], src.get("level", ""), ev, src.get("type", ""), src.get("url", ""), ""]


def dup_problem(kind, row, out, job, ctx, seen):
    """한 출력 안의 같은 행(문서: 경고)·시트나 입력 existing_tags 에 이미 있는 (대상, 태그, 출처)(경고, 중복) → 메시지 또는 None. 걸리면 내보내기에서 뺀다."""
    work = kind == "work_theme"
    name = out[2] if work else out[8]
    own = (kind, out[6], out[2], out[7], out[8], out[9], out[10])  # 대상 유형·작품·배역·배우·상대·태그가 같으면 같은 행
    if own in seen:
        return "같은 출력 안에 같은 (작품·배우·배역·태그) 행이 또 있음 — 뒤의 행은 내보내기에서 뺌"
    seen.add(own)
    keys = source_keys(out[20]) if work else source_keys((job or {}).get("source", {}).get("url"), (job or {}).get("source", {}).get("tag"), out[18])
    for e in (job or {}).get("existing_tags", []):
        if e.get("tag") == out[10] and (e.get("actor") or e.get("work")) == name and keys & source_keys(e.get("source")):
            return "입력 existing_tags 에 이미 있는 (대상·태그·출처) — 내보내기에서 뺌"
    if is_dup(keys, name, out[10], ctx.existing):
        return "시트에 이미 있는 (링크·대상·태그) — 내보내기에서 뺌"
    return None


def check_json(items, jobs, ctx):
    """items = common.read_jsonl 결과. → (문제 [(수준, 위치, 메시지)], 시트 행 목록, 통계)."""
    jobs = {j["id"]: j for j in jobs}
    probs, rows, st = [], [], {"rows": 0, "dup": 0, "answered": set(), "proposals": []}
    seen = set()
    for ln, env in items:
        at = f"줄 {ln}"
        if isinstance(env, Exception):
            probs.append(("ERROR", at, f"JSON 을 읽지 못함: {env}"))
            continue
        iid = env.get("input_id", "")
        job = jobs.get(iid)
        at += f" · {iid or '입력 id 없음'}"
        if env.get("schema") != common.SCHEMA:
            probs.append(("ERROR", at, f"schema 가 '{common.SCHEMA}' 가 아님(받은 값 '{env.get('schema')}')"))
        if jobs and not job:
            probs.append(("ERROR", at, "입력 파일에 없는 input_id"))
        kind = env.get("kind")
        if kind not in common.KIND_OF.values():
            probs.append(("ERROR", at, f"kind 가 work_theme/actor_trait 이 아님('{kind}')"))
            continue
        if job and job.get("kind") != kind:
            probs.append(("ERROR", at, f"kind '{kind}' 가 입력의 kind '{job.get('kind')}' 와 다름"))
            continue
        if not isinstance(env.get("rows"), list):
            probs.append(("ERROR", at, "rows 가 목록이 아님"))
            continue
        st["answered"].add(iid)
        skipped = env.get("skipped") if isinstance(env.get("skipped"), list) else []
        if not env["rows"] and not skipped:
            probs.append(("WARN", at, "rows 도 skipped 도 비어 있음(비울 때는 skipped 에 이유를 남겨야 함)"))
        for sk in skipped:
            if not isinstance(sk, dict) or sk.get("reason") not in common.SKIP_REASONS:
                probs.append(("WARN", at, f"skipped.reason 이 규칙 문서의 코드가 아님: {sk.get('reason') if isinstance(sk, dict) else sk}"))
        st["proposals"] += [(at, d.get("theme", ""), d.get("reason", "")) for d in env.get("dict_proposals") or [] if isinstance(d, dict)]
        if len(env["rows"]) > 8:
            probs.append(("WARN", at, f"한 입력에서 태그가 {len(env['rows'])}개(8개 초과 — 억지로 채운 흔적)"))
        for i, row in enumerate(env["rows"], 1):
            st["rows"] += 1
            where = f"{at} · 행 {i}" + (f" · {row.get('tag')}" if isinstance(row, dict) and row.get("tag") else "")
            if not isinstance(row, dict):
                probs.append(("ERROR", where, "행이 객체가 아님"))
                continue
            P, out = (check_work_row if kind == "work_theme" else check_actor_row)(row, job, ctx)
            if out:
                msg = dup_problem(kind, row, out, job, ctx, seen)
                if msg:
                    P.append(("WARN", msg))
                    st["dup"] += 1
                    out = None
            probs += [(lv, where, m) for lv, m in P]
            if out:
                rows.append(out)
    return probs, rows, st


def check_tsv(table, ctx):
    """시트 22열 형식 행(헤더 있어도 됨) → (문제, 통과 행, 통계). 열 순서는 common.SHEET_COLS 와 같다."""
    probs, rows, seen = [], [], set()
    n = 0
    for ln, r in table:
        if not r or r[0] == "기록일":
            continue
        n += 1
        r = (r + [""] * len(common.SHEET_COLS))[:len(common.SHEET_COLS)]
        g = dict(zip(common.SHEET_COLS, (x.strip() for x in r)))
        kind = "work_theme" if g["대상 유형"] == "작품" else "actor_trait" if g["대상 유형"] in ("배우", "조합") else None
        at = f"줄 {ln} · {g['작품']} · {g['태그']}"
        if not kind:
            probs.append(("ERROR", at, f"대상 유형 '{g['대상 유형']}' 은 작품/배우/조합 중 하나여야 함"))
            continue
        P = [("ERROR", f"빈 칸: {k}") for k in ("작품", "태그", "근거(원문 말고 내 말로 한 줄)", "근거 수준", "상태") if not g[k]]
        if g["작품"] and kind == "work_theme":
            P += title_problem(g["작품"], ctx)
        if g["태그"]:
            P += tag_problems(g["태그"], kind, None, ctx)[0]
        if g["근거 수준"] and g["근거 수준"] not in common.SHEET_LEVELS:
            P.append(("ERROR", f"근거 수준 '{g['근거 수준']}' 이 시트 허용 목록에 없음"))
        if g["상태"] and g["상태"] not in SHEET_STATUS:
            P.append(("ERROR", f"상태 '{g['상태']}' 는 {'/'.join(SHEET_STATUS)} 중 하나여야 함"))
        if not g["출처 링크"] and g["근거 수준"] not in NO_LINK_LEVELS:
            P.append(("ERROR", "출처 링크가 비어 있음"))
        elif g["출처 링크"] and not g["출처 링크"].startswith("https://"):
            P.append(("ERROR", f"출처 링크가 https:// 로 시작하지 않음: {g['출처 링크'][:60]}"))
        if kind == "actor_trait" and not g["배우"]:
            P.append(("ERROR", "빈 칸: 배우"))
        if g["대상 유형"] == "조합" and not g["상대 배우(조합일 때)"]:
            P.append(("ERROR", "조합인데 상대 배우가 비어 있음"))
        P += evidence_problems(g["근거(원문 말고 내 말로 한 줄)"], kind, [], ctx) if g["근거(원문 말고 내 말로 한 줄)"] else []
        probs += [(lv, at, m) for lv, m in P]
        if not any(lv == "ERROR" for lv, _ in P):
            k = (g["대상 유형"], g["작품"], g["배우"], g["상대 배우(조합일 때)"], g["태그"], g["출처 링크"], g["근거(원문 말고 내 말로 한 줄)"])  # 출처·근거까지 같은 행만 중복(같은 태그의 다른 출처는 정상)
            if k in seen:
                probs.append(("WARN", at, "같은 파일 안에 똑같은 행이 또 있음 — 내보내기에서 뺌"))
            else:
                seen.add(k)
                rows.append(r)
    return probs, rows, {"rows": n, "dup": 0, "answered": set(), "proposals": []}


def read_tsv(path):
    import csv
    return [(i, r) for i, r in enumerate(csv.reader(open(path, encoding="utf-8"), delimiter="\t"), 1)]


def report(probs, rows, st, jobs=None, log=print):
    errs, warns = sum(1 for p in probs if p[0] == "ERROR"), sum(1 for p in probs if p[0] == "WARN")
    for lv, where, msg in sorted(probs, key=lambda p: p[0] != "ERROR"):  # 오류 먼저
        log(f"[{lv}] {where} — {msg}")
    log(f"검사 {st['rows']}행 → 통과 {len(rows)} · 오류 {errs} · 경고 {warns}" + (f" · 중복이라 뺌 {st['dup']}" if st["dup"] else ""))
    for at, theme, why in st["proposals"]:
        log(f"[사전 제안] {at} — {theme}: {why}")
    if jobs:
        miss = [j["id"] for j in jobs if j["id"] not in st["answered"]]
        log(f"결과가 없는 입력 {len(miss)}건 / {len(jobs)}건" + (f": {', '.join(miss[:8])}{' …' if len(miss) > 8 else ''}" if miss else ""))
    return errs


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--results", help="결과 JSONL")
    ap.add_argument("--tsv", help="태그 기록 형식 TSV")
    ap.add_argument("--jobs", help="입력 JSONL(있으면 title·allowed_tags·원문 복사까지 대조)")
    ap.add_argument("--out-tsv", help="통과한 행을 이 경로에 시트 붙여넣기용 TSV 로 저장(헤더 없음)")
    ap.add_argument("--recorder", default="LLM 태깅", help="기록자 칸에 넣을 값")
    ap.add_argument("--dict", help="태그 사전 경로(기본: recommend.DICT)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if bool(a.results) == bool(a.tsv):
        ap.error("--results 와 --tsv 중 하나만")
    ctx = make_ctx(a.dict, recorder=a.recorder)
    jobs = [o for _, o in common.read_jsonl(a.jobs) if isinstance(o, dict)] if a.jobs else []
    probs, rows, st = check_json(common.read_jsonl(a.results), jobs, ctx) if a.results else check_tsv(read_tsv(a.tsv), ctx)
    errs = report(probs, rows, st, jobs)
    if a.out_tsv:
        Path(a.out_tsv).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out_tsv).write_text("".join("\t".join(r) + "\n" for r in rows), encoding="utf-8")
        print(f"통과 {len(rows)}행 → {a.out_tsv} (시트 '태그 기록 (Claude)' 탭 맨 아래에 붙이기)")
    sys.exit(1 if errs else 0)


def selftest():
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    d = tmp / "dict.tsv"
    d.write_text("대분류\t태그\t하위 영역\t뜻\t이런 표현이면 이 태그\t연결 취향축\t태그 상태\n"
                 "작품 · 소재\t로맨스\t소재\t사랑\t연애담\t\t확정\n작품 · 스토리 분위기\t감동\t분위기\t울림\t\t\t확정\n작품 · 소재\t후보태그\t소재\t뜻\t\t\t후보\n"
                 "배우 · 음색\t맑음\t음색\t뜻\t투명한 소리\t맑은 음색\t확정\n배우 조합\t호흡\t조합\t뜻\t\t\t확정\n", encoding="utf-8")
    ban = tmp / "banned.tsv"
    ban.write_text("외모\t잘생\n나이\t동갑\n친분\t부부\n우열\t최고\n", encoding="utf-8")
    ctx = make_ctx(d, titles={"공연1", "시드극"}, existing={("https://sheet", "공연1", "감동"), ("#00000000", "가나", "맑음")}, today="2026-10-11", banned_path=ban)
    allowed = [{"tag": "로맨스", "group": "작품 · 소재", "phrases": ["연애담"]}, {"tag": "감동", "group": "작품 · 스토리 분위기"}]
    wjob = {"id": "work:1", "kind": "work_theme", "title": "공연1", "venue": "극장", "synopsis": "두 사람이 서로 사랑에 빠지는 이야기를 그린다", "synopsis_source": {"level": "제작진·공식", "url": "https://k"}, "allowed_tags": allowed}
    ijob = {"id": "work:2", "kind": "work_theme", "title": "시드극", "synopsis": "", "intro_images": ["https://i"], "allowed_tags": allowed}  # 글 없이 이미지만(synopsis_source 도 없다)
    ajob = {"id": "actor:가나", "kind": "actor_trait", "context": {"actor": "가나", "work": "", "season": "2026", "role": "", "partner": ""},
            "source": {"type": "2차 설문", "level": "설문", "url": "", "tag": "2차 설문 #ab12cd34"}, "segments": [{"label": "본문", "text": "목소리가 아주 맑고 투명해서 좋았다"}],
            "allowed_tags": [{"tag": "맑음", "group": "배우 · 음색", "phrases": ["투명한 소리"]}, {"tag": "호흡", "group": "배우 조합"}], "existing_tags": [{"work": "배우 전반", "actor": "가나", "tag": "호흡", "source": "#ab12cd34"}]}
    good = {"work": "공연1", "tag": "로맨스", "confidence": "높음", "status": "확정", "evidence": "두 주인공의 연애가 이야기의 중심에 놓인다", "evidence_level": "제작진·공식", "source_url": "https://kopis.or.kr/x"}
    arow = {"target": "배우", "work": "배우 전반", "season": "", "role": "", "actor": "", "partner": "", "tag": "맑음", "scope": "작품 전체", "interpretation_diff": "없음", "confidence": "보통", "status": "검수 필요",
            "evidence": "소리가 곱게 들린다는 평이라 확신 보통 (2차 설문 #ab12cd34)"}
    chk = lambda f, row, job: f(row, job, ctx)
    msgs = lambda P: " | ".join(f"{lv}:{m}" for lv, m in P)
    # 정상 행: 시트 열 순서·대분류 자동 채움·출처 종류
    P, out = chk(check_work_row, good, wjob)
    assert not P and out[2] == "공연1" and out[6] == "작품" and out[10:13] == ["로맨스", "작품 · 소재", "소재"] and out[16] == "확정" and out[19] == "KOPIS 공연 상세" and out[20] == good["source_url"] and len(out) == 22, (P, out)
    # 하나씩 어긋나기: 사전 밖 태그·후보 태그·다른 제목·상태 짝·낮음·근거 수준·source_url·두 문장·100자·allowed 밖
    cases = [({"tag": "없는태그"}, "ERROR:태그 '없는태그' 가 사전에 없거나"), ({"tag": "후보태그"}, "사전에 없거나"), ({"work": "공연2"}, "입력 title"), ({"status": "검수 필요"}, "status '확정'"), ({"confidence": "낮음"}, "쓸 수 없음"),
             ({"evidence_level": "일반 관객 후기"}, "쓸 수 없음"), ({"evidence_level": "전문매체·언론"}, "synopsis_source.level"), ({"source_url": ""}, "빈 필드: source_url"), ({"source_url": "http://k"}, "https://"),
             ({"evidence": "사랑 이야기다. 슬프다."}, "한 문장이 아님"), ({"evidence": "사랑 이야기일까?  슬프다."}, "한 문장이 아님"), ({"evidence": "x" * 101}, "너무 김(101자 > 100자)"), ({"evidence": ""}, "빈 필드: evidence"),
             ({"evidence": "같은 글. 이야기"}, "앞 행을 가리키는")]
    for patch, want in cases:
        P, out = chk(check_work_row, {**good, **patch}, wjob)
        assert want in msgs(P), (patch, P)
        if patch.get("evidence") != "같은 글. 이야기":
            assert out is None or all(lv != "ERROR" for lv, _ in P), (patch, P)
    assert chk(check_work_row, {**good, "evidence": "x" * 100}, wjob)[1]  # 정확히 100자는 통과
    # 원문 복사·사전 예시 표현은 경고(내보내기엔 들어감), 작품 근거의 금지어도 경고
    P, out = chk(check_work_row, {**good, "evidence": "서로 사랑에 빠지는 이야기를 그린다"}, wjob)
    assert out and msgs(P).startswith("WARN:원문과 연속 3어절") and all(lv == "WARN" for lv, _ in P), P
    P, out = chk(check_work_row, {**good, "evidence": "연애담이 중심이다"}, wjob)
    assert out and "사전 예시 표현이 근거에 있는데" in msgs(P), P
    P, out = chk(check_work_row, {**good, "evidence": "부부의 갈등이 중심이다"}, wjob)
    assert out and msgs(P).startswith("WARN:금지어(친분): '부부'"), P
    P, _ = chk(check_work_row, {**good, "tag": "맑음"}, wjob)
    assert "대분류" in msgs(P) and "allowed_tags 밖" in msgs(P)  # 배우 태그는 작품 행에 못 씀
    P, _ = chk(check_work_row, {**good, "work": "공연I"}, None)
    assert "KOPIS 공연 제목" in msgs(P)  # 입력 없이도 KOPIS 공연 제목(지금 공연 + 최근 파일)과 대조
    # 이미지만 있는 입력: 근거 수준은 '제작진·공식'
    P, out = chk(check_work_row, {**good, "work": "시드극"}, ijob)
    assert not P and out[4] == "" and out[19] == "KOPIS 공연 상세(소개 이미지)", P  # 글이 없고 이미지로 판단했으면 출처 종류에 '(소개 이미지)' (7c 정답지 표기)
    assert "synopsis_source.level '제작진·공식'" in msgs(chk(check_work_row, {**good, "work": "시드극", "evidence_level": "전문매체·언론"}, ijob)[0])
    # 배우 행: 입력 context 로 배우 이름 채움, 근거 끝 source.tag(괄호 있어도 됨), 조합 규칙, 금지어는 오류
    P, out = chk(check_actor_row, arow, ajob)
    assert not P and out[6] == "배우" and out[8] == "가나" and out[9] == "" and out[3] == "2026" and out[17] == "설문" and out[19] == "2차 설문" and out[13] == "맑은 음색", (P, out)
    assert not chk(check_actor_row, {**arow, "evidence": "소리가 곱게 들린다는 평이다 2차 설문 #ab12cd34"}, ajob)[0]  # 괄호 없이 끝나도 통과
    for patch, want in [({"evidence": "소리가 곱게 들린다는 평이다"}, "source.tag"), ({"evidence": "소리가 곱게 들린다 (2차 설문 #ab12cd34) 끝"}, "source.tag"), ({"target": "조합"}, "partner 가 비어"), ({"partner": "다라"}, "partner 가 있음"),
                        ({"target": "조합", "partner": "다라", "tag": "호흡"}, "interpretation_diff 는 '해당 없음'"), ({"confidence": "낮음"}, "status '보류'"), ({"scope": "전체"}, "scope"),
                        ({"evidence": "동갑이라 곱게 들린다 (2차 설문 #ab12cd34)"}, "ERROR:금지어(나이): '동갑'"), ({"evidence": "부부라서 호흡이 좋다 (2차 설문 #ab12cd34)"}, "ERROR:금지어(친분)"),
                        ({"evidence": "최고로 곱게 들린다 (2차 설문 #ab12cd34)"}, "ERROR:금지어(우열)"), ({"evidence": "잘생겨서 좋다 (2차 설문 #ab12cd34)"}, "ERROR:금지어(외모)"), ({"tag": "로맨스"}, "대분류"),
                        ({"role": "엘렌"}, "'배우 전반'인데 role"), ({"evidence": "투명한 소리가 난다 (2차 설문 #ab12cd34)"}, "사전 예시 표현이 근거에 있는데")]:
        P, out = chk(check_actor_row, {**arow, **patch}, ajob)
        assert want in msgs(P), (patch, P)
    P, out = chk(check_actor_row, {**arow, "target": "조합", "partner": "다라", "tag": "호흡", "interpretation_diff": "해당 없음"}, ajob)
    assert not P and out[6] == "조합" and out[9] == "다라", (P, out)
    P, _ = chk(check_actor_row, arow, {**ajob, "source": {**ajob["source"], "level": "블로그"}})
    assert "시트 허용 목록" in msgs(P)
    blog = {**ajob, "source": {"type": "관객 후기", "level": "일반 관객 후기", "url": "https://b.com/1", "tag": "pongbox.tistory.com"}, "existing_tags": []}
    assert not chk(check_actor_row, {**arow, "evidence": "소리가 곱게 들린다는 평이다 (pongbox.tistory.com)"}, blog)[0]  # 도메인의 점은 문장 수에 안 센다
    # 파일 단위: 껍데기·중복(같은 출력 안, 시트, 입력 existing_tags)·태그 8개 초과·skipped 코드·결과 없는 입력
    env = lambda rows, **kw: {"schema": common.SCHEMA, "kind": "work_theme", "input_id": "work:1", "rows": rows, "skipped": [], "dict_proposals": [], **kw}
    other = {**good, "tag": "감동", "evidence": "눈물을 자아내는 결말이다", "source_url": "https://sheet"}  # 시트에 (https://sheet, 공연1, 감동) 이 이미 있다
    items = [(1, env([good, other, good])), (2, env([], schema="x")), (3, env([], input_id="work:9")), (4, ValueError("깨짐")), (5, env([good], kind="actor_trait")),
             (6, env([], skipped=[{"text": "", "reason": "엉터리"}], dict_proposals=[{"theme": "관객 참여", "reason": "r"}])), (7, env([])),
             (8, {"schema": common.SCHEMA, "kind": "actor_trait", "input_id": "actor:가나", "rows": [arow, {**arow, "tag": "호흡", "target": "조합", "partner": "다라", "interpretation_diff": "해당 없음"}], "skipped": [], "dict_proposals": []})]
    probs, rows, st = check_json(items, [wjob, ijob, ajob], ctx)
    text = msgs([(a, m) for a, _, m in probs])
    assert len(rows) == 2 and st["dup"] == 3 and "같은 출력 안에 같은" in text and "시트에 이미 있는" in text and "JSON 을 읽지 못함" in text, (rows, probs)
    assert "입력 existing_tags 에 이미 있는" in text and "schema 가" in text and "입력 파일에 없는 input_id" in text and "입력의 kind" in text and "rows 도 skipped 도 비어" in text and "규칙 문서의 코드가 아님: 엉터리" in text, text
    assert st["proposals"] == [("줄 6 · work:1", "관객 참여", "r")] and [r[10] for r in rows] == ["로맨스", "맑음"], (st, rows)
    wide = env([{**good, "tag": "로맨스"}] * 9)
    assert "태그가 9개" in msgs([(a, m) for a, _, m in check_json([(1, wide)], [wjob], ctx)[0]])
    lines = []
    assert report(probs, rows, st, [wjob, ijob, ajob], lines.append) > 0 and any("결과가 없는 입력 1건 / 3건: work:2" in x for x in lines) and any("[사전 제안]" in x for x in lines), lines
    # 같은 설문 번호(#8자리)면 링크가 없어도 같은 출처로 본다
    same = {**ajob, "source": {**ajob["source"], "tag": "2차 설문 #00000000"}, "existing_tags": []}
    out = chk(check_actor_row, {**arow, "evidence": "소리가 곱게 들린다 (2차 설문 #00000000)"}, same)[1]
    assert out and dup_problem("actor_trait", arow, out, same, ctx, set()) == "시트에 이미 있는 (링크·대상·태그) — 내보내기에서 뺌"
    assert dup_problem("actor_trait", arow, chk(check_actor_row, arow, {**ajob, "existing_tags": []})[1], {**ajob, "existing_tags": []}, ctx, set()) is None  # 다른 응답(#ab12cd34)이면 중복 아님
    # TSV 모드(시트 22열)
    ok = ["2026-10-11", "x", "공연1", "2026", "극장", "", "작품", "", "", "", "로맨스", "작품 · 소재", "소재", "", "해당 없음", "작품 전체", "확정", "전문매체·언론", "연애가 중심에 놓인다", "기사", "https://a.kr/1", ""]
    bad = {"작품명": (2, "공연X"), "태그": (10, "없음"), "링크": (20, ""), "수준": (17, "블로그"), "근거 길이": (18, "가" * 101), "상태": (16, "초안")}
    table = [(1, common.SHEET_COLS), (2, ok), (9, ok)] + [(i + 3, [*ok[:c], v, *ok[c + 1:]]) for i, (c, v) in enumerate(bad.values())]
    probs, rows, st = check_tsv(table, ctx)
    text = msgs([(a, m) for a, _, m in probs])
    assert st["rows"] == 8 and len(rows) == 1 and rows[0] == ok and "똑같은 행이 또 있음" in text, (st, rows, text)
    for w in ("KOPIS 공연 제목", "사전에 없거나", "출처 링크가 비어", "시트 허용 목록", "너무 김", "상태 '초안'"):
        assert w in text, (w, text)
    ok2 = list(ok)
    ok2[17], ok2[20] = "설문", ""
    assert not check_tsv([(1, ok2)], ctx)[0]  # 설문 근거는 출처 링크가 없어도 된다
    ok3 = [*ok]
    ok3[6], ok3[8], ok3[10], ok3[11], ok3[18] = "배우", "가나", "맑음", "배우 · 음색", "동갑이라 곱게 들린다 (pongbox.tistory.com)"
    assert "ERROR:금지어(나이)" in msgs([(a, m) for a, _, m in check_tsv([(1, ok3)], ctx)[0]])
    ok3[18] = "소리가 곱게 들린다는 평이다 (pongbox.tistory.com)"
    assert not check_tsv([(1, ok3)], ctx)[0]  # 끝 괄호(도메인) 속 점은 안 센다
    print("validate selftest OK")


if __name__ == "__main__":
    main()
