"""LLM 자리(바꿔 끼우는 곳). 입력 JSONL(make_jobs.py 산출물)을 받아 결과 JSONL(7c 규칙 pickle-tagging/1 의 출력 껍데기, 줄마다 한 건)을 만든다. API 키는 쓰지 않는다.
  --backend manual   사람(지금은 7c)이 입력 파일을 직접 처리해서 --results 파일에 결과를 쓴다. 이 스크립트는 입력 id 와 대조해 남은 것만 <jobs>.todo.jsonl 로 뽑아 준다.
  --backend local    --cmd "ollama run <모델>" 처럼 표준입력으로 프롬프트를 받고 표준출력으로 JSON 을 내는 셸 명령이면 뭐든 된다(Ollama 형식 한 가지만 가정). 입력마다 한 번 실행하고, 이미 결과가 있는 id 는 건너뛴다(이어하기).
  python3 tools/tagging/run_llm.py --backend manual --jobs data/tagging/jobs_work_2026-10-11.jsonl --results data/tagging/results_work_2026-10-11.jsonl
  python3 tools/tagging/run_llm.py --selftest
결과는 반드시 validate.py 를 거쳐야 시트에 붙일 수 있다. 프롬프트 초안은 prompts/<kind>.md (규칙의 원본: docs/llm_tagging_spec_2026-10-11.md).

TODO 로컬 LLM 을 정할 때 같이 고를 것(지금은 만들지 않음). 현재 KOPIS 소개 글(sty)이 비어 있고 소개가 이미지뿐이라 글자만 받는 로컬 모델은 근거 글이 없다:
  1안) macOS Vision 같은 로컬 OCR 로 소개 이미지(intro_images)의 글자를 뽑아 입력의 synopsis_ocr 필드에 넣는 전처리
  2안) 이미지를 읽는 로컬 모델
  3안) 다른 공식 출처의 소개 글
그때까지 local 백엔드는 synopsis·synopsis_ocr 가 모두 비어 있는 입력을 건너뛴다(근거 없이 지어내지 않게)."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

PROMPTS = common.HERE / "prompts"


def done_ids(results):
    """결과 파일에 이미 있는 input_id 집합(깨진 줄은 무시)."""
    if not Path(results).exists():
        return set()
    return {o["input_id"] for _, o in common.read_jsonl(results) if isinstance(o, dict) and o.get("input_id")}


def pending(jobs, results):
    done = done_ids(results)
    return [j for j in jobs if j["id"] not in done]


def parse_output(text):
    """명령 출력에서 JSON 객체 하나를 꺼낸다(```json 울타리·앞뒤 설명이 붙어도 첫 { 부터 마지막 } 까지)."""
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b < a:
        raise ValueError("JSON 을 찾지 못함")
    return json.loads(text[a:b + 1])


def build_prompt(job):
    """prompts/<kind>.md 의 {입력 JSON} 자리에 입력 한 건을 넣는다(자리가 없으면 끝에 붙인다)."""
    f = PROMPTS / f"{job['kind']}.md"
    head = f.read_text(encoding="utf-8") if f.exists() else ""
    text = json.dumps(job, ensure_ascii=False)
    return head.replace("{입력 JSON}", text) if "{입력 JSON}" in head else f"{head}\n\n[입력]\n{text}\n"


def run_local(jobs, cmd, results, timeout=300, log=print):
    """입력마다 cmd(셸)를 한 번 실행해 결과를 results 에 한 줄씩 덧붙인다. → (성공, 실패, 건너뜀) 건수. 실패 원문은 <results>.errors.jsonl 에 남긴다."""
    ok = bad = skip = 0
    for job in pending(jobs, results):
        if not (job.get("synopsis") or job.get("synopsis_ocr")):
            skip += 1
            log(f"건너뜀 {job['id']}: 글 없음(이미지만) — 로컬 모델은 글자만 받는다(위 TODO 참고)")
            continue
        try:
            p = subprocess.run(cmd, shell=True, input=build_prompt(job), capture_output=True, text=True, timeout=timeout)
            if p.returncode:
                raise RuntimeError(f"명령 종료 코드 {p.returncode}: {p.stderr.strip()[:200]}")
            out = parse_output(p.stdout)
            out.setdefault("input_id", job["id"])
            with open(results, "a", encoding="utf-8") as f:
                f.write(json.dumps(out, ensure_ascii=False) + "\n")
            ok += 1
        except (ValueError, RuntimeError, subprocess.TimeoutExpired) as e:
            bad += 1
            log(f"실패 {job['id']}: {e}")
            with open(f"{results}.errors.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"input_id": job["id"], "error": str(e)}, ensure_ascii=False) + "\n")
    return ok, bad, skip


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--backend", choices=["manual", "local"])
    ap.add_argument("--jobs")
    ap.add_argument("--results")
    ap.add_argument("--cmd", help="local: 프롬프트를 표준입력으로 받는 셸 명령(예: 'ollama run 모델이름')")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not (a.backend and a.jobs):
        ap.error("--backend 와 --jobs 가 필요해요")
    jobs = [o for _, o in common.read_jsonl(a.jobs) if isinstance(o, dict)]
    results = a.results or str(Path(a.jobs).with_name(Path(a.jobs).name.replace("jobs_", "results_", 1)))
    if a.backend == "manual":
        todo = pending(jobs, results)
        out = Path(a.jobs).with_suffix(".todo.jsonl")
        common.write_jsonl(out, todo)
        print(f"입력 {len(jobs)}건 중 결과 있음 {len(jobs) - len(todo)}건, 남음 {len(todo)}건 → {out}")
        print(f"처리 방법: 프롬프트 {PROMPTS}/<kind>.md 와 규칙 문서에 따라 입력 한 건마다 출력 한 줄(JSON)을 만들어 {results} 에 모은다. 끝나면 validate.py.")
        return
    if not a.cmd:
        ap.error("local 은 --cmd 가 필요해요")
    ok, bad, skip = run_local(jobs, a.cmd, results, a.timeout)
    print(f"성공 {ok} · 실패 {bad} · 건너뜀 {skip} → {results}")


def selftest():
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    jobs = [{"id": f"work:{i}", "kind": "work_theme", "title": f"작품{i}", "synopsis": "글" if i != 3 else ""} for i in (1, 2, 3)]
    res = tmp / "results.jsonl"
    # 결과 파일 없음 → 전부 남음, 깨진 줄·id 없는 줄은 무시하고 있는 것만 뺀다
    assert [j["id"] for j in pending(jobs, res)] == ["work:1", "work:2", "work:3"]
    res.write_text('{"input_id": "work:1", "rows": []}\n깨진 줄\n{"rows": []}\n', encoding="utf-8")
    assert [j["id"] for j in pending(jobs, res)] == ["work:2", "work:3"]
    # 출력 파싱: 울타리·설명이 붙어도, JSON 이 없으면 오류
    assert parse_output('설명\n```json\n{"a": 1}\n```\n') == {"a": 1}
    try:
        parse_output("없음")
        raise SystemExit("파싱 실패여야 한다")
    except ValueError:
        pass
    # 로컬: 가짜 명령(프롬프트는 읽고 고정 결과를 출력). 이미 있는 1번은 건너뛰고, 글 없는 3번은 건너뜀
    logs = []
    fake = "cat >/dev/null; printf '```json\\n{\"schema\":\"pickle-tagging/1\",\"kind\":\"work_theme\",\"rows\":[]}\\n```'"
    assert run_local(jobs, fake, res, log=logs.append) == (1, 0, 1), logs
    got = {o["input_id"] for _, o in common.read_jsonl(res) if isinstance(o, dict) and "input_id" in o}
    assert got == {"work:1", "work:2"}, got  # input_id 가 없던 출력은 입력 id 를 채워 넣는다
    # 명령이 실패하거나 JSON 이 아니면 errors 파일에 남고 계속 간다
    res2 = tmp / "r2.jsonl"
    assert run_local(jobs[:1], "echo 그냥 글", res2, log=logs.append) == (0, 1, 0) and Path(f"{res2}.errors.jsonl").exists()
    assert run_local(jobs[:1], "exit 3", res2, log=logs.append) == (0, 1, 0)
    # 프롬프트에 입력 JSON 이 들어간다(자리표시자가 남지 않는다)
    pr = build_prompt(jobs[0])
    assert '"title": "작품1"' in pr and "{입력 JSON}" not in pr and "허용 태그에 있는 이름만" in pr
    print("run_llm selftest OK")


if __name__ == "__main__":
    main()
