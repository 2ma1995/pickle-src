// PICKLE web — 공통: 데이터 접근 · 상태 · 추천(PICK) · 라우터 · 클릭 위임.
// 화면은 views-*.js가 V(화면 함수)와 ACT(동작)에 등록한다. 이 파일은 workspace-f2 담당.
const D = window.PICKLE_DATA;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

// ---------- 날짜 (전부 로컬 YYYY-MM-DD 문자열. toISOString은 UTC라 하루 밀리니 쓰지 않는다) ----------
const fmt = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const today = () => fmt(new Date());
const addDays = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return fmt(x); };
const dowOf = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
const md = d => `${+d.slice(5, 7)}.${+d.slice(8, 10)}`;            // 10.24
const mdKo = d => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;       // 10월 24일
const timeKo = t => { const [h, m] = t.split(":").map(Number); return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${m ? ` ${m}분` : ""}`; };
const won = n => n.toLocaleString("ko-KR") + "원";
const man = n => n % 10000 === 0 ? `${n / 10000}만` : won(n);    // 180000 → 18만
const byWhen = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);

// ---------- 데이터 접근 ----------
const workOf = name => D.works.find(w => w.name === name);
const posterUrl = w => w?.poster ? "../app/" + w.poster : "";       // data.js의 포스터 경로는 app/ 기준
const runsOf = work => { const w = workOf(work); if (!w) return []; const live = w.runs.filter(r => r.end >= today()); return live.length ? live : w.runs; };
const runOf = (work, date) => workOf(work)?.runs.find(r => date >= r.start && date <= r.end) || runsOf(work)[0];
const rolesOf = work => D.roles[work] || [];
const weightOf = (work, role) => rolesOf(work).find(r => r.role === role)?.weight || "조연";
const leadRoles = work => rolesOf(work).filter(r => r.weight === "주연");
const leads = (work, cast) => leadRoles(work).filter(r => cast[r.role]).map(r => [r.role, cast[r.role]]);   // 배역 탭 순서
const rests = (work, cast) => Object.entries(cast).filter(([r]) => weightOf(work, r) !== "주연");
const perfsOf = (work, run) => D.perfs.filter(p => p.work === work && (!run || (p.date >= run.start && p.date <= run.end)));
const upcoming = work => perfsOf(work).filter(p => p.date >= today()).sort(byWhen);
const findPerf = (work, date, time) => D.perfs.find(p => p.work === work && p.date === date && p.time === time);
const specialNote = p => p.notes.find(n => /첫공|막공|폐막/.test(n)) || "";
const tagsOf = (work, actor) => (D.actorTags[work] || {})[actor] || [];
const videoOf = (work, actor) => ((D.videos || {})[work] || {})[actor]?.[0];
const ytId = v => (v?.url || "").match(/[?&]v=([\w-]+)/)?.[1];
const thumbOf = (work, actor) => { const id = ytId(videoOf(work, actor)); return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : ""; };
const searchUrl = (work, actor, role) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`뮤지컬 ${work} ${actor} ${role || ""}`)}`;

// ---------- 취향 (작품마다 따로) ----------
const AXES = [["가창", "노래"], ["연기", "연기"], ["감정 크게", "감정을 크게"], ["절제", "절제된"], ["맑은 음색", "맑은 음색"], ["묵직한 음색", "묵직한 음색"]];
const AXIS_PAIR = {"가창": "연기", "연기": "가창", "감정 크게": "절제", "절제": "감정 크게", "맑은 음색": "묵직한 음색", "묵직한 음색": "맑은 음색"};
const axisLabel = a => (AXES.find(x => x[0] === a) || [a, a])[1];
const wantSet = axes => new Set((axes || []).flatMap(a => D.axis[a] || [a]));   // 취향 축 → 태그들 (태그 사전)

// ---------- 상태 (이 브라우저에만) ----------
const KEY = "pickle_v3";
let S = {works: {}, plans: [], tags: [], votes: [], prefs: {grade: "", favs: []}};
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
// 작품별 상태: axes(취향), dates(갈 수 있는 날), actors(꼭 볼 배우), mode("date"|"actor")
const workState = work => (S.works[work] ||= {axes: [], dates: [], actors: (S.prefs.favs || []).filter(a => rolesOf(work).some(r => r.cast.includes(a))), mode: "date"});

// ---------- 추천 (PICK) ----------
// 회차 점수 = 출연 배우들의 리뷰 태그 중 고른 취향과 맞는 개수(배우마다 같은 태그는 1번) + 조합 태그.
// 근거 0이면 PICK을 찍지 않는다 — 데이터가 없는 건 취향과 안 맞는다는 뜻이 아니므로.
function scorePerf(work, p, axes) {
  const want = wantSet(axes), ev = [], hit = new Set();
  if (!want.size) return {pts: 0, ev, hit};
  for (const [role, a] of Object.entries(p.cast)) {
    const seen = new Set();
    for (const r of tagsOf(work, a)) if (want.has(r.tag) && !seen.has(r.tag)) { seen.add(r.tag); hit.add(a); ev.push({actor: a, role, tag: r.tag, why: r.why, src: r.src, link: r.link}); }
  }
  const names = Object.values(p.cast);
  for (const c of (D.comboTags[work] || [])) if (names.includes(c.a) && names.includes(c.b) && want.has(c.tag)) ev.push({actor: `${c.a}×${c.b}`, role: "조합", tag: c.tag, why: c.why, src: c.src, link: c.link});
  return {pts: ev.length, ev, hit};
}
// 상위 n회차. 주연 조합이 같은 회차는 가장 이른 것 하나만.
function picksFor(work, axes, n = 2, pool) {
  const seen = new Set(), out = [];
  const ranked = (pool || upcoming(work)).map(p => ({p, ...scorePerf(work, p, axes)})).filter(x => x.pts > 0).sort((x, y) => y.pts - x.pts || byWhen(x.p, y.p));
  for (const x of ranked) { const k = leads(work, x.p.cast).map(e => e[1]).join("|"); if (seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= n) break; }
  return out;
}
// 꼭 볼 배우: 같은 배역은 '또는', 배역끼리는 '그리고'
function pinsByRole(work, actors) { const pins = {}; for (const r of rolesOf(work)) for (const a of r.cast) if ((actors || []).includes(a)) (pins[r.role] ||= []).push(a); return pins; }
const passes = (p, pins) => Object.entries(pins).every(([role, as]) => as.includes(p.cast[role]));
// 캐스팅 보드의 열: 고른 날짜가 있으면 그 날의 회차 / 없으면 PICK 상위 2회차 / PICK도 없으면 다가오는 2회차.
function boardColumns(work) {
  const st = workState(work);
  st.dates = (st.dates || []).filter(d => d >= today());
  const pool = upcoming(work).filter(p => passes(p, pinsByRole(work, st.actors)));
  if (st.dates.length) return {mode: "dates", cols: pool.filter(p => st.dates.includes(p.date))};
  const picks = picksFor(work, st.axes, 2, pool).map(x => x.p).sort(byWhen);
  if (picks.length) return {mode: "pick", cols: picks};
  return {mode: "upcoming", cols: pool.slice(0, 2)};
}
// 열 중 PICK 하나: 점수 최고(동점이면 이른 회차), 모두 0이면 -1
function pickIndex(work, cols, axes) { let best = -1, bp = 0; cols.forEach((p, i) => { const s = scorePerf(work, p, axes).pts; if (s > bp) { bp = s; best = i; } }); return best; }
// 같은 배역 비교 투표의 순합(+면 내가 더 좋아한 쪽)
const voteNet = (work, role, a) => S.votes.filter(v => v.work === work && v.role === role && (v.a === a || v.b === a)).reduce((n, v) => n + (v.result === "tie" ? 0 : (v.result === "a") === (v.a === a) ? 1 : -1), 0);
// 내가 남긴 관람 태그를 추천 데이터에 합친다 (보고 나서 남긴 태그가 다음 PICK에 반영되는 고리)
function mergeMyTags() {
  for (const t of S.tags) {
    if (!t.actor || !(t.tags || []).length) continue;
    const rows = ((D.actorTags[t.work] ||= {})[t.actor] ||= []);
    for (const tag of t.tags) if (!rows.some(r => r.tag === tag && r.src === "내 관람")) rows.push({role: t.role, tag, why: t.note || "내가 보고 남긴 태그", src: "내 관람", season: "2026", link: ""});
  }
}
function addPlan(work, date, time) {
  let i = S.plans.findIndex(x => x.work === work && x.date === date && x.time === time);
  if (i < 0) { const p = findPerf(work, date, time); if (!p) return -1; S.plans.push({work, date, time, dow: p.dow, cast: p.cast, at: today()}); i = S.plans.length - 1; save(); }
  return i;
}

// ---------- 공통 UI 조각 (스타일은 style.css) ----------
const ICON = {
  back: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`,
  play: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5l9 5.5-9 5.5z" fill="currentColor"/></svg>`,
  next: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
};
// 상단 막대: back(해시)이 있으면 ‹, 없으면 PICKLE 로고. right는 HTML.
const topbar = ({back = "", title = "", right = ""} = {}) =>
  `<header class="top">${back ? `<a class="back" href="${esc(back)}" aria-label="뒤로">${ICON.back}</a>` : `<a class="brand" href="#works">PICKLE</a>`}${title ? `<span class="top-title disp">${esc(title)}</span>` : ""}<div class="top-right">${right}</div></header>`;
// 작품 취향 칩 줄 (캐스팅 보드 · 다른 화면 공용). 누르면 ACT.axis
const tasteChips = work => { const st = workState(work); return `<div class="chips">${AXES.map(([v, l]) => `<button type="button" class="chip ${st.axes.includes(v) ? "on" : ""}" data-act="axis" data-work="${esc(work)}" data-v="${esc(v)}" aria-pressed="${st.axes.includes(v)}">${esc(l)}</button>`).join("")}</div>`; };
let toastT; function toast(msg) { const t = $("#toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800); }

// ---------- 라우터 ----------
// #이름/인자1/인자2 → V[이름](인자1, 인자2). 화면 함수는 HTML 문자열을 돌려주고, 보여 줄 수 없으면 null(→ #works로 바꿈).
const V = {}, ACT = {};
let CUR = {name: "", args: []}, lastHash = "";
function route() {
  if (!$("#view")) return;   // 랜딩처럼 core.js만 빌려 쓰는 페이지
  const h = decodeURIComponent(location.hash.slice(1) || "works");
  const [name, ...args] = h.split("/");
  const html = V[name] ? V[name](...args) : null;
  if (html == null && name !== "works") { location.replace("#works"); return; }   // 없는 화면·잘못된 인자: URL도 같이 고친다
  CUR = {name, args};
  const view = $("#view"); view.innerHTML = html || ""; view.dataset.view = name;
  if (location.hash !== lastHash) { window.scrollTo(0, 0); lastHash = location.hash; }   // 같은 화면 안에서 다시 그릴 땐 스크롤 유지
}
const rerender = () => route();

// ---------- 공통 동작 ----------
ACT.axis = d => { const st = workState(d.work); st.axes = st.axes.includes(d.v) ? st.axes.filter(x => x !== d.v) : [...st.axes.filter(x => x !== AXIS_PAIR[d.v]), d.v]; save(); rerender(); };
ACT.clearAxes = d => { workState(d.work).axes = []; save(); rerender(); };

document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]"); if (go) { e.preventDefault(); location.hash = go.dataset.go; return; }
  const link = e.target.closest("a[href]"), el = e.target.closest("[data-act]");
  if (link && (!el || (el !== link && el.contains(link)))) return;   // 카드 안의 링크(영상·출처)는 카드 동작 대신 링크로
  if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault(); ACT[el.dataset.act](el.dataset, el, e);
});
document.addEventListener("input", e => { const el = e.target.closest("[data-input]"); if (el && ACT[el.dataset.input]) ACT[el.dataset.input](el.dataset, el, e); });
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", () => { mergeMyTags(); route(); });
