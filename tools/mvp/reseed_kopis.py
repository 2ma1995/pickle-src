"""최신 data/kopis_current_*.tsv 의 '시드작품'·'시드공연일치' 칸을 지금 RUNS 로 다시 채운다.
RUNS(시드 작품)를 바꾼 뒤 주간 KOPIS 갱신(kopis_sync.py --current, API 키 필요)을 기다리지 않고 앱 데이터를 맞출 때 쓴다. 다른 칸은 그대로 둔다.
쓰는 법: python3 tools/mvp/reseed_kopis.py"""
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from kopis_sync import seed_of  # noqa: E402  (RUNS 는 recommend.py 에서 온다)

files = sorted(f for f in (ROOT / "data").glob("kopis_current_2*.tsv") if not f.stem.endswith("_excluded"))
path = files[-1]
rows = list(csv.DictReader(open(path, encoding="utf-8"), delimiter="\t"))
head = list(rows[0].keys())
changed = 0
for r in rows:
    w, same = seed_of({"title": r["작품"], "venue": r["공연장"]})
    new = (w, "Y" if same else ("N" if w else ""))
    if (r["시드작품"], r["시드공연일치"]) != new:
        changed += 1
        print(f"{r['작품']} @ {r['공연장']}: {r['시드작품'] or '-'}/{r['시드공연일치'] or '-'} → {new[0] or '-'}/{new[1] or '-'}")
    r["시드작품"], r["시드공연일치"] = new
with open(path, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=head, delimiter="\t", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print(f"{path.name}: {changed}행 바뀜")
