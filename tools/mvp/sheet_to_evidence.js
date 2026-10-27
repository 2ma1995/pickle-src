#!/usr/bin/env node
// MVP 캐스트 태깅 시트(구글 시트) → '근거 1건 × 태그 1개 = 1행' 계산용 표.
// 쓰는 법: node tools/mvp/sheet_to_evidence.js [--cache 폴더] [--offline]
//   --cache   시트 CSV를 받아 둘 폴더(기본: OS 임시 폴더). 시트에 설문·X 후기 원문이 있어서 저장소 안에 두지 않는다
//   --offline 받아 둔 CSV만 쓴다
// 결과(data/mvp/): evidence_long.tsv · tag_ids.tsv · unmatched_tags.tsv · skipped_rows.tsv · report.md
// evidence_long.tsv 는 앞 17열이 recommend.py TAG_COLS 와 같은 이름·순서라 TAGS 경로만 바꾸면 그대로 읽힌다.
// 원문(설문 응답·X 후기 문장)은 결과에 넣지 않는다. 근거 칸에는 팀이 쓴 요약·해석만 들어간다.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SHEET = "1UfPrXNl-ALxvyYOdcYJx8H91Is8vq-hJj2pDgZUvxj8";
const TABS = {
  dict: 1712246643, combo: 1712246642, legacy: 191013004, xrev: 191013005, interview: 191013006,
  basicEvidence: 880211, surveyActor: 191013001, surveyCombo: 191013002,
};
const WORK_TABS = { "겨울왕국": 1712246639, "엘리자벳": 1712246640, "스위니토드": 1712246641, "레베카": 880300, "시카고": 880301 };
const MVP_WORKS = Object.keys(WORK_TABS);
const OTHER_WORK = "다른 작품";

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "data", "mvp");
const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const CACHE = argVal("--cache") || path.join(os.tmpdir(), "pickle_mvp_sheet");
const OFFLINE = args.includes("--offline");

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim())).map((r, n) => {
    const o = { __row: n + 2 };
    head.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
    return o;
  });
}

async function loadTab(gid) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${gid}.csv`);
  if (!OFFLINE) {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${gid}`);
    if (!res.ok) throw new Error(`시트 탭 ${gid} 받기 실패: ${res.status}`);
    fs.writeFileSync(file, await res.text(), "utf8");
  }
  return parseCsv(fs.readFileSync(file, "utf8"));
}

// ---------- 공통 ----------
const sha8 = s => crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 8);
const URL_RE = /https?:\/\/[^\s,)\]]+/g;
const urlsOf = s => [...new Set(((s || "").match(URL_RE) || []).map(u => u.replace(/[.;]+$/, "")))];
const squash = s => (s || "").replace(/\s+/g, "");
const clip = (s, n = 140) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// 태그 칸 나누기: 쉼표·슬래시·줄바꿈. 가운뎃점(·)은 태그 이름 안에 있어서 나누지 않는다
const splitTags = s => (s || "").split(/[,\/\n]| \| /).map(x => x.trim()).filter(Boolean);

// 상태 원문 → 표준 상태. recommend.py 는 '확정'(또는 빈 값)만 추천에 쓴다.
// 2026-10-27 사용자 결정: MVP 베타에서는 후보·검수 필요 태그를 전부 확정으로 올려 추천에 쓴다(원래 상태는 '상태 원문' 열에 남는다).
// 보류·자료 부족·미반영(설문 관람 전 기대)은 그대로 뺀다
const PROMOTE = new Set(["후보", "검수 필요"]);
const normState = raw => { const s = baseState(raw); return PROMOTE.has(s) ? "확정" : s; };
function baseState(raw) {
  const s = raw || "";
  if (/미반영/.test(s)) return "미반영";
  if (/보류/.test(s)) return "보류";
  if (/자료 부족|조사 전|근거 없음|근거 부족/.test(s) && !/후보/.test(s)) return "자료 부족";
  if (/검수 필요|재검수|검수 전/.test(s)) return "검수 필요";
  if (/후보/.test(s)) return "후보";
  if (/확정/.test(s)) return "확정";
  return s ? "검수 필요" : "";
}

// 근거 성격: 관람평 / 인터뷰 의도 / 홍보 / 관람 전 기대 / 경력 정보 / 혼합 / 미상
function natureOf(text) {
  const s = text || "";
  if (/설문/.test(s)) return "관람 전 기대";
  if (/경력/.test(s) && !/리뷰|관람|후기/.test(s)) return "경력 정보";
  const review = /리뷰|관람|관극|후기|비평|평가/.test(s), interview = /인터뷰|본인|Q&A|발언/.test(s), promo = /홍보|제작사|배포|소개|프로필|PRESS|프레스/.test(s);
  const n = [review && "관람평", interview && "인터뷰 의도", promo && "홍보"].filter(Boolean);
  return n.length === 1 ? n[0] : n.length ? "혼합" : "미상";
}

// ---------- 태그 사전 ----------
// 평가 유형: '특성'(스타일·결, 좋고 나쁨이 아님) / '수행 평가'(잘했는지). 하위 영역 기준 + 예외
const PERFORMANCE_AREAS = new Set(["파워·기술"]);
const PERFORMANCE_TAGS = new Set(["배역 싱크로", "전체 캐스트 밸런스"]);
const evalTypeOf = d => d.대분류.startsWith("작품") ? "작품 특성" : (PERFORMANCE_AREAS.has(d["하위 영역"]) || PERFORMANCE_TAGS.has(d.태그)) ? "수행 평가" : "특성";
// 사전에 없는 표기 → 사전 태그. 사용자가 정한 해석만 넣는다(pickle-tagging-rules)
const SYNONYM = { "맑고 청아한 음색": "맑음", "청아한 음색": "맑음", "개성있는 음색": "개성 있는 음색" };

function buildDict(rows) {
  const idFile = path.join(OUT, "tag_ids.tsv");
  const prev = fs.existsSync(idFile) ? readTsv(idFile) : [];
  const idOf = new Map(prev.map(r => [r["태그"], r["태그 ID"]]));
  let next = prev.reduce((m, r) => Math.max(m, +r["태그 ID"].slice(1) || 0), 0);
  const dict = new Map();
  for (const r of rows) {
    const tag = r["태그"]; if (!tag) continue;
    if (!idOf.has(tag)) idOf.set(tag, "T" + String(++next).padStart(3, "0"));  // 한 번 준 ID 는 바꾸지 않는다(새 태그만 뒤에 붙음)
    dict.set(tag, { ...r, id: idOf.get(tag), evalType: evalTypeOf(r) });
  }
  const bySquash = new Map([...dict.values()].map(d => [squash(d.태그), d]));
  return {
    dict,
    match(raw) {
      let t = raw.trim(), dir = "";
      // '가성 표현(부정)' · '배역 싱크로(음색 부정)'처럼 괄호 안 평가 방향은 떼어 평가 방향으로 옮긴다(괄호 원문은 태그 원문 열에 남는다)
      const neg = t.match(/\(([^()]*?)(부정|긍정|중립)\)\s*$/);
      if (neg) { dir = neg[2]; t = t.slice(0, neg.index).trim(); }
      t = t.replace(/\s*\((임시|후보|검수 필요)\)\s*$/, "").trim();
      if (dict.has(t)) return { d: dict.get(t), dir, how: "정확" };
      if (SYNONYM[t] && dict.has(SYNONYM[t])) return { d: dict.get(SYNONYM[t]), dir, how: "동의어" };
      if (bySquash.has(squash(t))) return { d: bySquash.get(squash(t)), dir, how: "띄어쓰기" };
      return { d: null, dir, how: "미매칭", text: t };
    },
    writeIds() {
      const rowsOut = [...dict.values()].sort((a, b) => a.id.localeCompare(b.id))
        .map(d => [d.id, d.태그, d.대분류, d["하위 영역"], d.evalType, d["태그 상태"]]);
      writeTsv(idFile, ["태그 ID", "태그", "대분류", "하위 영역", "평가 유형", "사전 상태"], rowsOut);
      // recommend.py DICT 로 읽는 사전. 시트 사전의 '검수 필요' 태그도 베타에서는 확정으로 쓴다(원래 상태 열에 남김)
      const DH = ["대분류", "태그", "하위 영역", "뜻", "이런 표현이면 이 태그", "연결 취향축", "태그 상태", "원래 상태", "태그 ID"];
      writeTsv(path.join(OUT, "tag_dict.tsv"), DH, rows.filter(r => r.태그).map(r => [r.대분류, r.태그, r["하위 영역"], r.뜻, r["이런 표현이면 이 태그"], r["연결 취향축"],
        PROMOTE.has(r["태그 상태"]) ? "확정" : r["태그 상태"], r["태그 상태"], idOf.get(r.태그)]));
    },
  };
}

function readTsv(file) {
  const [h, ...rs] = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(l => l.split("\t"));
  return rs.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] || ""])));
}
const tsvCell = v => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
function writeTsv(file, head, rows) {
  fs.writeFileSync(file, [head, ...rows].map(r => r.map(tsvCell).join("\t")).join("\n") + "\n", "utf8");
}

// ---------- 결과 행 ----------
// 앞 17열 = recommend.py TAG_COLS(열 이름 앞부분으로 찾는다). '태그'·'상태'로 시작하는 추가 열은 반드시 원래 열 뒤에 둔다
const HEAD = ["기록일", "기록자", "작품", "시즌", "공연장", "회차", "대상 유형", "배역", "배우", "상대 배우", "태그",
  "근거(내 말로 한 줄)", "출처 종류", "출처 링크", "상태", "근거 수준", "대분류",
  "증거 ID", "태그 ID", "태그 원문", "사전 매칭", "평가 유형", "평가 방향", "주의점", "출처 ID", "근거 성격",
  "적용 범위", "동회차 확인", "근거 연결", "원본 탭", "원본 행", "상태 원문"];

class Collector {
  constructor(D) { this.D = D; this.rows = []; this.unmatched = new Map(); this.skipped = []; this.seen = new Set(); }
  add(base, rawTags) {
    for (const raw of splitTags(rawTags)) {
      const m = this.D.match(raw);
      if (!m.d) {
        const k = m.text; const u = this.unmatched.get(k) || { n: 0, where: new Set() };
        u.n++; u.where.add(`${base.원본탭}:${base.배우 || base.작품}`); this.unmatched.set(k, u);
        continue;
      }
      const links = base.links || [];
      const srcId = links.length ? sha8(links.slice().sort().join(" ")) : sha8(`${base.원본탭}|${base.원본행}`);
      const key = [base.작품, base.대상유형, base.배역, base.배우, base.상대 || "", m.d.태그, srcId].join("|");
      if (this.seen.has(key)) continue;  // 같은 탭 안 같은 근거·같은 태그는 한 번만
      this.seen.add(key);
      // 배우 일반(다른 작품에서 받은 평가)은 작품 칸을 '다른 작품'으로 둔다. recommend.py 는 작품 칸이 다른 행을 'OO 리뷰 기준'으로 빌려 오고(목소리 태그만),
      // 이번 작품 행으로 세지 않는다. 어느 탭에서 왔는지는 원본 탭 열에 남는다
      const work = base.범위 === "배우 일반" ? OTHER_WORK : (base.작품 || "");
      this.rows.push({
        기록일: base.기록일 || "", 기록자: base.기록자 || "", 작품: work, 시즌: base.시즌 || "", 공연장: base.공연장 || "",
        회차: base.회차 || "", 대상유형: base.대상유형, 배역: base.배역 || "", 배우: base.배우 || "", 상대: base.상대 || "",
        태그: m.d.태그, 근거: clip(base.근거), 출처종류: base.출처종류 || "", 출처링크: links.join(" "), 상태: base.상태,
        근거수준: base.근거수준 || "", 대분류: m.d.대분류, 태그ID: m.d.id, 태그원문: raw, 매칭: m.how, 평가유형: m.d.evalType,
        방향: m.dir || base.방향 || "", 주의점: [base.주의점, /\(.+\)\s*$/.test(raw) && `태그 원문 괄호: ${raw.match(/\((.+)\)\s*$/)[1]}`].filter(Boolean).join(" · "), 출처ID: srcId, 성격: base.성격 || "미상", 범위: base.범위 || "",
        동회차: base.동회차 || (base.대상유형 === "조합" ? "미확인" : "해당 없음"), 연결: base.연결 || "행 단위",
        원본탭: base.원본탭, 원본행: base.원본행, 상태원문: base.상태원문 || "",
      });
    }
  }
  skip(tab, row, why, who) { this.skipped.push([tab, row, who || "", why]); }
}

// ---------- 배역 이름 맞추기 ----------
function roleNormalizer(workRows) {
  const roles = {};  // 작품 → [배역]
  for (const [w, rs] of Object.entries(workRows)) roles[w] = [...new Set(rs.map(r => r["배역/구분"]).filter(Boolean))];
  const alias = { "토드": "죽음(토드)", "죽음": "죽음(토드)", "요제프": "프란츠 요제프", "소피 대공비": "소피", "위즐튼": "위즐튼 공작" };
  return (work, r) => {
    r = (r || "").trim(); if (!r) return "";
    const list = roles[work] || [];
    if (list.includes(r)) return r;
    if (alias[r] && list.includes(alias[r])) return alias[r];
    return list.find(x => x.includes(r) || r.includes(x)) || r;
  };
}
// 시트 작품 탭의 캐스트로 배우가 그 작품·배역에 있는지 본다
const castOf = workRows => {
  const m = new Map();
  for (const [w, rs] of Object.entries(workRows)) for (const r of rs) if (r.배우) m.set(`${w}|${r.배우}`, r["배역/구분"]);
  return m;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const T = {};
  for (const [k, gid] of Object.entries(TABS)) T[k] = await loadTab(gid);
  const W = {};
  for (const [w, gid] of Object.entries(WORK_TABS)) W[w] = await loadTab(gid);
  const D = buildDict(T.dict);
  const C = new Collector(D);
  const normRole = roleNormalizer(W);
  const cast = castOf(W);
  const seasonOf = w => (W[w][0] || {}).시즌 || "";

  // 1) MVP_기존태그기록: 이미 1행 1태그 형식
  for (const r of T.legacy) {
    if (!MVP_WORKS.includes(r.작품)) { C.skip("MVP_기존태그기록", r.__row, "MVP 작품 아님", r.작품); continue; }
    const type = r["대상 유형"];
    if (type !== "작품" && !r.배우) { C.skip("MVP_기존태그기록", r.__row, "배우 칸이 비어 있음", r.배역); continue; }
    const lvl = r["근거 수준"];
    C.add({
      기록일: r.기록일, 기록자: r.기록자, 작품: r.작품, 시즌: r.시즌, 공연장: r.공연장, 회차: r["회차(선택)"], 대상유형: type,
      배역: normRole(r.작품, r.배역), 배우: r.배우, 상대: r["상대 배우(조합일 때)"], 근거: r["근거(원문 말고 내 말로 한 줄)"],
      출처종류: r["출처 종류"], links: urlsOf(r["출처 링크"]), 상태: normState(r.상태), 상태원문: r.상태, 근거수준: lvl,
      방향: r["평가 방향"], 성격: lvl === "배우 본인·공식" ? "인터뷰 의도" : lvl === "제작진·공식" ? "홍보" : "관람평",
      범위: type === "작품" ? "작품" : type === "조합" ? "조합" : (r["적용 범위"] === "특정 넘버" ? "이번 배역·특정 넘버" : "이번 배역"),
      원본탭: "MVP_기존태그기록", 원본행: r.__row,
    }, r.태그);
  }

  // 2) 엘리자벳_X후기태깅: 원문은 넣지 않고 팀 해석만. 'A × B' 두 사람은 조합, 비교 후기·세 사람은 누구 태그인지 몰라 건너뛴다
  for (const r of T.xrev) {
    const names = (r.배우 || "").split("×").map(s => s.trim()).filter(Boolean);
    const comparison = /비교/.test(r.배역);
    if (!r["기존 사전 매칭 태그"]) { C.skip("엘리자벳_X후기태깅", r.__row, "사전 매칭 태그 없음", r.배우); continue; }
    if (comparison || names.length > 2) { C.skip("엘리자벳_X후기태깅", r.__row, "비교 후기·3인 이상: 어느 배우 태그인지 판단 필요", r.배우); continue; }
    const roles = (r.배역 || "").split("×").map(s => normRole("엘리자벳", s.trim()));
    const base = {
      작품: "엘리자벳", 시즌: seasonOf("엘리자벳"), 근거: r["근거 해석·주의사항"], 출처종류: "X 후기", links: urlsOf(r["원문 링크"]),
      상태: normState(r["검수 상태"]), 상태원문: r["검수 상태"], 근거수준: "일반 관객 후기", 방향: r["평가 방향"], 성격: "관람평",
      주의점: [r["후기 구분"], r["독립 출처"] === "미확인" ? "독립 출처 미확인" : ""].filter(Boolean).join(" · "),
      연결: urlsOf(r["원문 링크"]).length ? "행 단위" : "행 단위·링크 없음", 원본탭: "엘리자벳_X후기태깅", 원본행: r.__row,
    };
    if (names.length === 2) C.add({ ...base, 대상유형: "조합", 배역: roles[0], 배우: names[0], 상대: names[1], 범위: "조합", 동회차: "미확인" }, r["기존 사전 매칭 태그"]);
    else C.add({ ...base, 대상유형: "배우", 배역: roles[0], 배우: names[0], 범위: /배우 일반/.test(r["적용 범위"]) ? "배우 일반" : "이번 배역" }, r["기존 사전 매칭 태그"]);
  }

  // 3) 엘리자벳_공식인터뷰태깅: 배우가 밝힌 의도. 음악감독 전언은 제작진
  for (const r of T.interview) {
    if (!r.배우 || !r["기존 61개 사전 태그 후보"]) { C.skip("엘리자벳_공식인터뷰태깅", r.__row, "배우·태그 후보 없음", r.배우); continue; }
    const staff = /음악감독|제작/.test(r["자료 유형"]);
    C.add({
      작품: r.작품 || "엘리자벳", 시즌: r.시즌, 대상유형: "배우", 배역: normRole("엘리자벳", r.배역), 배우: r.배우,
      근거: r["캐릭터·표현 의도"] || r["태그 매칭 근거·주의"], 출처종류: r["자료 유형"], links: urlsOf(r["출처 링크"]),
      상태: normState(r["검수 상태"]), 상태원문: r["검수 상태"], 근거수준: staff ? "제작진·공식" : "배우 본인·공식",
      성격: "인터뷰 의도", 주의점: [r["태그 매칭 근거·주의"] && "매칭 주의 있음", r["관객 후기 교차검증"] && `교차검증: ${r["관객 후기 교차검증"]}`].filter(Boolean).join(" · "),
      범위: /배우 일반|배우 활동/.test(r["적용 범위"]) ? "배우 일반" : "이번 배역", 원본탭: "엘리자벳_공식인터뷰태깅", 원본행: r.__row,
    }, r["기존 61개 사전 태그 후보"]);
  }

  // 4) 배우_기본태깅_근거기록: 작품과 상관없는 배우 일반 특성
  for (const r of T.basicEvidence) {
    if (/경력 정보/.test(r["적용 범위"])) { C.skip("배우_기본태깅_근거기록", r.__row, "경력 정보(특성 태그 아님)", r.배우명); continue; }
    const kind = r["근거 유형"];
    C.add({
      기록일: r.조사일, 작품: "", 대상유형: "배우", 배우: r.배우명, 근거: r["근거 내용·원문 요약"], 출처종류: kind, links: urlsOf(r["출처 URL"]),
      상태: normState(r["검수 상태"]), 상태원문: r["검수 상태"], 근거수준: /관극|후기/.test(kind) ? "일반 관객 후기" : "전문매체·언론",
      성격: natureOf(kind + " " + r["출처 독립성"]), 주의점: [r["출처 독립성"], r.비고].filter(Boolean).join(" · "),
      범위: "배우 일반", 원본탭: "배우_기본태깅_근거기록", 원본행: r.__row,
    }, r.태그);
  }

  // 5) 설문 후보: 관람 전 기대라 추천 점수에는 안 쓴다(상태 '미반영'). 응답 원문 대신 '응답 의미'만
  for (const [tab, rows] of [["설문_배우태그후보", T.surveyActor], ["설문_조합태그후보", T.surveyCombo]]) {
    for (const r of rows) {
      if (!MVP_WORKS.includes(r.작품)) { C.skip(tab, r.__row, "MVP 작품 아님", r.작품); continue; }
      if (!r["사전 매칭 태그"]) { C.skip(tab, r.__row, "사전 매칭 태그 없음", r.배우); continue; }
      const combo = r["대상 구분"] === "조합";
      C.add({
        작품: r.작품, 시즌: seasonOf(r.작품), 대상유형: combo ? "조합" : "배우", 배역: normRole(r.작품, r.배역), 배우: r.배우, 상대: r["상대 배우"],
        근거: r["응답 의미"], 출처종류: `${r.설문차수} 설문`, links: [], 상태: r["추천 반영"] === "미반영" ? "미반영" : normState(r["검수 상태"]),
        상태원문: `${r["검수 상태"]} / ${r["추천 반영"]}`, 근거수준: "설문", 방향: r["평가 방향"], 성격: "관람 전 기대",
        범위: combo ? "조합" : "이번 배역", 원본탭: tab, 원본행: r.__row,
      }, r["사전 매칭 태그"]);
    }
  }

  // 6) 조합_태깅
  for (const r of T.combo) {
    if (!MVP_WORKS.includes(r.작품)) { C.skip("조합_태깅", r.__row, "MVP 작품 아님", r.작품); continue; }
    const same = r["실제 동회차 출연 확인"] || "";
    C.add({
      기록일: r.수정일, 작품: r.작품, 시즌: r.시즌, 대상유형: "조합", 배역: normRole(r.작품, r.배역1), 배우: r.배우1, 상대: r.배우2,
      근거: r["조합 평가 요약"], 출처종류: "조합 태깅", links: urlsOf(r["X 후기 참고 링크"]), 상태: normState(r["검수 상태"]), 상태원문: r["검수 상태"],
      근거수준: "일반 관객 후기", 성격: "관람평", 주의점: [r.메모 && clip(r.메모, 80), `상대 배역: ${normRole(r.작품, r.배역2)}`].filter(Boolean).join(" · "),
      범위: "조합", 동회차: /^확인/.test(same) ? "확인" : /동회차 확인/.test(same) ? "후기상 확인" : "미확인",
      연결: urlsOf(r["X 후기 참고 링크"]).length ? "행 단위" : "행 단위·링크 없음", 원본탭: "조합_태깅", 원본행: r.__row,
    }, r["조합 태그"]);
  }

  // 7) 작품 탭(가로형): 위 행 단위 근거에 없는 태그만 더한다. 칸에 링크 여러 개 · 태그 여러 개가 묶여 있어 어떤 링크가 어떤 태그 근거인지 모른다 → '셀 묶음'
  const have = new Set(C.rows.map(r => `${r.작품}|${r.배우}|${r.태그}|${r.범위.startsWith("배우 일반") ? "일반" : "배역"}`));
  const haveGeneral = new Set(C.rows.filter(r => r.범위 === "배우 일반").map(r => `${r.배우}|${r.태그}`));
  for (const [w, rows] of Object.entries(W)) {
    for (const r of rows) {
      if (!r.배우) continue;
      const role = r["배역/구분"];
      const common = { 작품: w, 시즌: r.시즌, 대상유형: "배우", 배역: role, 배우: r.배우, 기록일: r["최종 수정일"], 연결: "셀 묶음", 원본탭: `${w} 탭`, 원본행: r.__row };
      const gLinks = urlsOf(r["일반 태그 근거 링크"]);
      for (const t of splitTags(r["배우 일반 태그"])) {
        const m = D.match(t);
        if (m.d && haveGeneral.has(`${r.배우}|${m.d.태그}`)) continue;
        C.add({ ...common, 범위: "배우 일반", links: gLinks, 상태: normState(r["일반 태그 상태"]), 상태원문: r["일반 태그 상태"],
          성격: natureOf(r["일반 태그 근거 링크"] + " " + r["일반 태그 상태"]), 근거: m.d && m.d.대분류 === "배우 · 가창" ? r["가창/음색 메모"] : r["연기/해석 메모"],
          주의점: "다른 작품·배우 일반 근거" }, t);
      }
      const rLinks = [...new Set([...urlsOf(r["배역 태그 근거 링크"]), ...urlsOf(r["X 후기 참고 링크"])])];
      const prevSeason = /이전 시즌/.test(r["배역 태그 상태"]);
      for (const t of splitTags(r["이번 배역 태그"])) {
        const m = D.match(t);
        if (m.d && have.has(`${w}|${r.배우}|${m.d.태그}|배역`)) continue;
        C.add({ ...common, 범위: "이번 배역", links: rLinks, 상태: normState(r["배역 태그 상태"]), 상태원문: r["배역 태그 상태"],
          성격: natureOf(r["배역 태그 근거 링크"] + " " + r["배역 태그 상태"] + " " + r["관극 확인 여부"]),
          근거: m.d && m.d.대분류 === "배우 · 가창" ? r["가창/음색 메모"] : r["연기/해석 메모"],
          주의점: [prevSeason && "이전 시즌 근거", !rLinks.length && "링크 미입력"].filter(Boolean).join(" · ") }, t);
      }
    }
  }

  // ---------- 검사 ----------
  const warn = [];
  for (const r of C.rows) {
    if (r.작품 && r.작품 !== OTHER_WORK && r.배우 && r.대상유형 === "배우" && !cast.has(`${r.작품}|${r.배우}`)) warn.push(`캐스트에 없는 배우: ${r.작품} ${r.배우} (${r.원본탭} ${r.원본행}행)`);
    if (r.대상유형 === "조합" && r.상대 && r.작품 && !cast.has(`${r.작품}|${r.상대}`)) warn.push(`캐스트에 없는 상대 배우: ${r.작품} ${r.상대} (${r.원본탭} ${r.원본행}행)`);
  }

  // ---------- 쓰기 ----------
  C.rows.sort((a, b) => [a.작품, a.배역, a.배우, a.대상유형, a.태그ID].join("|").localeCompare([b.작품, b.배역, b.배우, b.대상유형, b.태그ID].join("|"), "ko"));
  C.rows.forEach((r, i) => { r.증거ID = "E" + String(i + 1).padStart(4, "0"); });
  writeTsv(path.join(OUT, "evidence_long.tsv"), HEAD, C.rows.map(r => [r.기록일, r.기록자, r.작품, r.시즌, r.공연장, r.회차, r.대상유형, r.배역, r.배우, r.상대, r.태그,
    r.근거, r.출처종류, r.출처링크, r.상태, r.근거수준, r.대분류, r.증거ID, r.태그ID, r.태그원문, r.매칭, r.평가유형, r.방향, r.주의점, r.출처ID, r.성격,
    r.범위, r.동회차, r.연결, r.원본탭, r.원본행, r.상태원문]));
  D.writeIds();
  writeRoles(W);
  writeTsv(path.join(OUT, "unmatched_tags.tsv"), ["표기", "건수", "나온 곳(앞 5개)"],
    [...C.unmatched].sort((a, b) => b[1].n - a[1].n).map(([k, u]) => [k, u.n, [...u.where].slice(0, 5).join(", ")]));
  writeTsv(path.join(OUT, "skipped_rows.tsv"), ["원본 탭", "원본 행", "배우·작품", "이유"], C.skipped);
  fs.writeFileSync(path.join(OUT, "report.md"), report(C, warn), "utf8");
  console.log(`evidence_long.tsv ${C.rows.length}행 · 미매칭 표기 ${C.unmatched.size}개 · 건너뛴 행 ${C.skipped.length}개 · 경고 ${warn.length}개 → ${path.relative(ROOT, OUT)}`);
}

// 배역 표(recommend.py ROLES): 시트 작품 탭의 배역·캐스트가 기준. 예전 배역 표(roles_2026-10-02.tsv)에만 있는 배역(시카고 메리 선샤인 등 회차표에 나오는 조연)은 그대로 이어 붙인다.
// 비중(주연/조연)은 예전 표 값을 쓰고, 새 작품은 LEADS 로 정한다
const LEADS = { "레베카": ["막심 드 윈터", "댄버스 부인", "나(I)"], "스위니토드": ["스위니 토드", "러빗 부인"] };
function writeRoles(W) {
  const oldFile = path.join(ROOT, "data", "roles_2026-10-02.tsv");
  const old = fs.existsSync(oldFile) ? readTsv(oldFile) : [];
  const out = [];
  for (const [w, rows] of Object.entries(W)) {
    const byRole = new Map();
    for (const r of rows) if (r.배우 && r["배역/구분"]) (byRole.get(r["배역/구분"]) || byRole.set(r["배역/구분"], { actors: [], src: r.자료출처 || r["자료 출처"] || "", season: r.시즌 }).get(r["배역/구분"])).actors.push(r.배우);
    for (const [role, v] of byRole) {
      const o = old.find(x => x.작품 === w && x.배역 === role);
      const weight = o ? o.비중 : (LEADS[w] || []).includes(role) ? "주연" : "조연";
      out.push([w, v.season, "서울", role, weight, v.actors.length > 1 ? "Y" : "N", v.actors.join(", "), urlsOf(v.src)[0] || ""]);
    }
    for (const o of old.filter(x => x.작품 === w && !byRole.has(x.배역))) {
      const actors = o["캐스트 배우"].split(",").map(s => s.trim()).filter(Boolean);
      out.push([w, o.시즌, o.공연, o.배역, o.비중, actors.length > 1 ? "Y" : "N", actors.join(", "), o["출처 링크"]]);
    }
  }
  writeTsv(path.join(OUT, "roles.tsv"), ["작품", "시즌", "공연", "배역", "비중", "멀티캐스팅", "캐스트 배우", "출처 링크"], out);
}

function count(rows, f) { const m = new Map(); for (const r of rows) { const k = f(r); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); }
function report(C, warn) {
  const R = C.rows, line = a => a.map(([k, n]) => `${k || "(빈 값)"} ${n}`).join(" · ");
  const actorRows = R.filter(r => r.대상유형 === "배우");
  const perWork = MVP_WORKS.map(w => {
    const rs = actorRows.filter(r => r.작품 === w);
    const actors = new Set(rs.map(r => r.배우));
    const conf = rs.filter(r => r.상태 === "확정").length;
    const rowLevel = rs.filter(r => r.연결 !== "셀 묶음").length;
    return `| ${w} | ${actors.size} | ${rs.length} | ${conf} | ${rowLevel} | ${R.filter(r => r.작품 === w && r.대상유형 === "조합").length} |`;
  });
  return `# MVP 태깅 → 계산용 표 변환 결과

생성: ${new Date().toISOString().slice(0, 10)} · 원본: 구글 시트 MVP 캐스트 태깅 DB · 스크립트: tools/mvp/sheet_to_evidence.js

## 한눈에
- 전체 ${R.length}행 (배우 ${actorRows.length} · 조합 ${R.filter(r => r.대상유형 === "조합").length} · 작품 ${R.filter(r => r.대상유형 === "작품").length})
- 상태: ${line(count(R, r => r.상태))}
- 근거 성격: ${line(count(R, r => r.성격))}
- 근거 연결: ${line(count(R, r => r.연결))}
- 적용 범위: ${line(count(R, r => r.범위))}
- 평가 유형: ${line(count(R, r => r.평가유형))}
- 사전 매칭: ${line(count(R, r => r.매칭))}

## 작품별 (배우 대상)
| 작품 | 태그 있는 배우 | 행 | 확정 | 행 단위 근거 | 조합 행 |
|---|---|---|---|---|---|
${perWork.join("\n")}
('배우 일반' 행 ${actorRows.filter(r => r.작품 === OTHER_WORK).length}개는 작품 칸이 '${OTHER_WORK}'라 작품별 표에 안 들어감. recommend.py 는 이 중 목소리 태그만 빌려 온다)

## 원본 탭별
${count(R, r => r.원본탭).map(([k, n]) => `- ${k}: ${n}`).join("\n")}

## 확인할 것
- recommend.py 는 상태 '확정'(또는 빈 값)만 추천에 쓴다. 지금 확정은 ${R.filter(r => r.상태 === "확정").length}행뿐이라, 후보를 낮은 가중치로 쓸지 정해야 한다.
- '셀 묶음' 행은 작품 탭 칸에 태그·링크가 여러 개 묶여 있어 어떤 링크가 어떤 태그의 근거인지 모른다. 출처 ID 는 그 칸 링크 묶음 기준이라 독립 출처 수를 셀 때 1건으로 센다.
- 사전에 없는 표기 ${C.unmatched.size}개 → unmatched_tags.tsv
- 건너뛴 행 ${C.skipped.length}개 → skipped_rows.tsv (${line(count(C.skipped.map(s => ({ s })), x => x.s[3]))})
${warn.length ? "\n## 경고\n" + [...new Set(warn)].slice(0, 40).map(w => `- ${w}`).join("\n") + (warn.length > 40 ? `\n- …외 ${warn.length - 40}개` : "") : ""}
`;
}

main().catch(e => { console.error(e.message); process.exit(1); });
