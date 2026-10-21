"""캐스팅 스케줄 이미지(표 형식) → data/schedules/*.tsv 초안.

맥 내장 Vision OCR을 쓴다(무료, 모델 다운로드 없음). 준비: python3 -m venv ocrenv && ocrenv/bin/pip install ocrmac
사용: ocrenv/bin/python cast_ocr.py <이미지> <작품> [--year 2026] [--src URL] > data/schedules/<작품>_2026.tsv
표 모양 가정: 머리글 행에 '시간'과 배역 이름이 있고, 한 회차가 한 줄(시간 칸 기준), 날짜는 세로 병합 가능.
배역·배우 이름은 배역 탭 명단(data/roles_*.tsv)과 대조해서 오탈자는 가장 비슷한 이름으로 바꾸고, 못 맞추면 '?이름'으로 남겨 사람이 보게 한다.
원본 크기로 한 번, 2배로 키워서 한 번 읽고 원본에서 빈 칸만 2배 결과로 채운다(작은 글씨는 2배가 잘 읽고, 막공 뱃지 같은 장식은 원본이 덜 헷갈린다).
검증: 손으로 확인한 TSV와 비교 → diff <(cut -f1-8 data/schedules/드라큘라_2026.tsv) <(cut -f1-8 초안.tsv)
"""
import argparse, csv, difflib, glob, re, sys
from PIL import Image
from ocrmac import ocrmac

NOTE = {"막공", "첫공", "프리뷰", "마티네"}
RE_TIME = re.compile(r"^(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분)?)$")
RE_DATE = re.compile(r"^(\d{1,2})\s*[/월]\s*(\d{1,2})일?$")
RE_WORD = re.compile(r"[가-힣A-Za-z]")


def roster(work):
    """배역 탭 명단: (배역 이름 목록, 배우 이름 집합)."""
    path = sorted(glob.glob("data/roles_*.tsv"))[-1]
    roles, actors = [], set()
    for r in csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"):
        if r["작품"] == work:
            cast = next(v for k, v in r.items() if "캐스트" in k)  # 머리글이 '캐스트' 또는 '캐스트 배우'
            roles.append(r["배역"])
            actors |= {a.strip() for a in cast.split(",") if a.strip()}
    return roles, actors


def match(name, pool, unknown):
    if name in pool:
        return name
    near = [p for p in pool if p.startswith(name)] or difflib.get_close_matches(name, pool, n=1, cutoff=0.5)
    if near:
        return near[0]
    unknown.add(name)
    return "?" + name


def ocr_boxes(img, scale):
    im = Image.open(img)
    W, H = im.size
    if scale != 1:
        im = im.resize((W * scale, H * scale), Image.LANCZOS)
    out = []
    for text, _, (x, y, w, h) in ocrmac.OCR(im, language_preference=["ko-KR"], recognition_level="accurate").recognize():
        out.append({"t": text.strip(), "x": (x + w / 2) * W, "y": (1 - (y + h / 2)) * H, "x0": x * W, "w": w * W})  # 좌표는 0~1 비율이라 원본 픽셀로
    return out


def tokens(b, actors):
    """'티파니 영'처럼 띄어쓴 이름은 그대로 두고, '막공 조정은 막공'처럼 여러 단어가 붙은 상자만 글자 길이 비율로 x를 나눈다."""
    if b["t"] in actors or not any(p in NOTE or p in actors for p in b["t"].split()):
        return [(b["t"], b["x"])]
    parts, res = b["t"].split(), []
    total, pos = sum(map(len, parts)) + len(parts) - 1, 0
    for p in parts:
        res.append((p, b["x0"] + b["w"] * (pos + len(p) / 2) / total))
        pos += len(p) + 1
    return res


def norm_time(s):
    h, m1, m2 = RE_TIME.match(s).groups()
    h, m = int(h), int(m1 or m2 or 0)
    return f"{h + 12 if h < 10 else h:02d}:{m:02d}"  # '2시'는 14:00


def extract(boxes, roles, actors, year, unknown):
    """OCR 상자 → (배역 열 목록, 회차 행 목록). 행 = [날짜, 시간, 배우..., 비고]."""
    hdr = next(b for b in boxes if b["t"] == "시간")
    header = sorted((b for b in boxes if abs(b["y"] - hdr["y"]) < 12 and b["x"] > hdr["x"]), key=lambda b: b["x"])
    cols = [(b["x"], match(b["t"], roles, unknown)) for b in header]
    gap = min(c2[0] - c1[0] for c1, c2 in zip(cols, cols[1:]))
    times = sorted((b for b in boxes if RE_TIME.match(b["t"])), key=lambda b: b["y"])
    dates = [b for b in boxes if RE_DATE.match(b["t"])]
    rows = []
    for t in times:
        d = min(dates, key=lambda b: abs(b["y"] - t["y"]))
        m, dd = RE_DATE.match(d["t"]).groups()
        cast, notes = {}, set()
        for b in boxes:
            if b is t or b is d or abs(b["y"] - t["y"]) > 14 or b["x"] <= hdr["x"] + gap / 2:
                continue
            for tok, x in tokens(b, actors):
                if tok in NOTE:
                    notes.add(tok); continue
                if not RE_WORD.search(tok):
                    continue  # 뱃지·점 같은 장식
                role = min(cols, key=lambda c: abs(c[0] - x))[1]
                cast[role] = match(tok, actors, unknown)
        rows.append([f"{year}-{int(m):02d}-{int(dd):02d}", norm_time(t["t"])] + [cast.get(r, "") for _, r in cols] + [", ".join(sorted(notes))])
    return [r for _, r in cols], sorted(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("work")
    ap.add_argument("--year", default="2026"); ap.add_argument("--src", default="")
    a = ap.parse_args()
    roles, actors = roster(a.work)
    unknown, junk = set(), set()
    cols, rows = extract(ocr_boxes(a.image, 1), roles, actors, a.year, unknown)
    _, rows2 = extract(ocr_boxes(a.image, 2), roles, actors, a.year, junk)
    by2 = {(r[0], r[1]): r for r in rows2}
    for r in rows:
        r2 = by2.get((r[0], r[1]))
        for i in range(2, len(r) - 1):
            if r2 and r[i] == "" and r2[i] and not r2[i].startswith("?"):
                r[i] = r2[i]

    if a.src:
        print(f"# 출처: {a.src} (이미지 OCR 초안, 확인 필요)")
    print("\t".join(["날짜", "시간"] + cols + ["비고"]))
    for r in rows:
        print("\t".join(r))
    if unknown:
        print("명단에 없는 이름:", sorted(unknown), file=sys.stderr)
    blanks = [f"{r[0]} {r[1]}" for r in rows if "" in r[2:-1]]
    if blanks:
        print("빈 칸 있는 회차(이미지와 대조):", blanks, file=sys.stderr)
    print(f"{len(rows)}회차, 배역 {len(cols)}개", file=sys.stderr)


if __name__ == "__main__":
    main()
