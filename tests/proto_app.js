// 앱(app/index.html) 화면 점검용 하니스: 인라인 스크립트를 가짜 DOM·저장소·시계와 함께 노드에서 그대로 실행해, 화면 HTML(V.*)과 클릭 동작을 확인한다. proto_check.js 가 불러 쓴다(배포 대상 아님)
const fs = require("fs"), path = require("path");
module.exports = function loadApp(D, opts = {}) {
  const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; const code = scripts[scripts.length - 1][1];
  const els = {}, mkEl = () => ({innerHTML: "", textContent: "", hidden: false, dataset: {}, style: {}, attrs: {}, classList: (() => { const cl = new Set(); return {add: c => cl.add(c), remove: c => cl.delete(c), toggle(c, f) { const on = f === undefined ? !cl.has(c) : f; on ? cl.add(c) : cl.delete(c); return on; }, contains: c => cl.has(c)}; })(), addEventListener() {}, querySelector: () => mkEl(), querySelectorAll: () => [], scrollIntoView() { this.scrolled = true; }, getBoundingClientRect: () => ({left: 0, right: 0, width: 0}), scrollLeft: 0, focus() { document.activeElement = this; }, value: "", setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }});
  const q = sel => (els[sel] ||= mkEl());
  const store = new Map(Object.entries(opts.storage || {})), localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear()};
  const listeners = {doc: {}, win: {}};
  const location = {_h: opts.hash || "", search: opts.search || "", href: "http://127.0.0.1:8767/index.html" + (opts.search || "") + (opts.hash || ""), get hash() { return this._h; }, set hash(v) { this._h = String(v).startsWith("#") ? v : "#" + v; (listeners.win.hashchange || []).forEach(f => f()); }, reload() {}, pathname: "/proto.html"};
  const opened = [], timers = [];  // timers: setTimeout 으로 건 것(실행은 안 한다, 시험이 직접 부른다)
  const root = mkEl(); if (opts.theme) root.attrs["data-theme"] = opts.theme;
  const document = {querySelector: q, querySelectorAll: () => [], addEventListener: (t, f) => (listeners.doc[t] ||= []).push(f), visibilityState: "visible", documentElement: root};
  const window = {PICKLE_DATA: D, scrollTo() {}, addEventListener: (t, f) => (listeners.win[t] ||= []).push(f), open: (...a) => opened.push(a), PICKLE_TRACK: opts.track};
  const now = opts.now || "2026-10-11T12:00:00";
  class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return new Date(now).getTime(); } }
  const history = {replaceState: (a, b, u) => { u = String(u); if (u.startsWith("#")) { location._h = u; return; }  // 해시만 바꾸면 쿼리는 그대로(브라우저와 같다)
    const m = u.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/); location.search = m[2] || ""; location._h = m[3] || ""; location.href = "http://127.0.0.1:8767" + u; }, back() {}};
  const body = code + "\n;return {V, D, get S() { return S; }, set S(v) { S = v; }, get SHEET() { return SHEET; }, get CTA() { return CTA; }, route, track, TRK, today, comboRecs, votesP, VOCAB, cleanVotes, loadVotes, curSel, ratingBox, RATE_CTX, save, sheetBody, finishPending};";
  const api = new Function("window", "document", "localStorage", "location", "history", "Date", "fetch", "setTimeout", "clearTimeout", "console", "URL", body)(window, document, localStorage, location, history, FD, opts.fetch || (async () => ({ok: true})), (f, ms) => timers.push({f, ms}) - 1, () => {}, {log() {}, error: console.error, warn() {}}, URL);
  // 클릭: data-* 가 붙은 가짜 요소로 문서의 click 핸들러를 부른다
  const click = (attrs, tag = "button") => { const el = {dataset: attrs, tagName: tag.toUpperCase(), textContent: ""};
    let prevented = false; const e = {target: {closest: sel => { const a = sel === "[data-go]" ? "go" : sel === "[data-act]" ? "act" : sel === "a[data-ticket]" ? "ticket" : sel === "a[href]" ? "href" : null; return (a === "go" && attrs.go !== undefined) || (a === "act" && attrs.act) || (a === "ticket" && attrs.ticket) ? el : null; }}, preventDefault() { prevented = true; }};
    if (attrs.go !== undefined) el.dataset = {go: attrs.go, ...attrs}; (listeners.doc.click || []).forEach(f => f(e)); return {prevented}; };
  const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(api));  // 펼치면(spread) S·SHEET·CTA 의 getter 가 값으로 굳어서, 설명자째 복사한다
  return Object.assign(out, {els, q, store, location, opened, timers, click, listeners, html, root, document});
};
