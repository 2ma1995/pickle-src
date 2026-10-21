// core.js 추천 규칙 점검: node web/core.test.js  (브라우저 없이 data.js + core.js를 읽어 PICK 계산을 확인)
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const ctx = {console, document: {addEventListener() {}, querySelector() { return null; }}, location: {hash: ""}, localStorage: {getItem() { return null; }, setItem() {}}};
ctx.window = ctx; ctx.addEventListener = () => {};
vm.createContext(ctx);
for (const f of ["../app/data.js", "core.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx);
const r = (code) => vm.runInContext(code, ctx);
const score = (date, time) => r(`scorePerf("엘리자벳", findPerf("엘리자벳", "${date}", "${time}"), ["가창", "맑은 음색"]).pts`);
assert.strictEqual(score("2026-10-24", "14:00"), 3);   // 이지수 음색-맑음·감정 실린 가창 + 김준수 고음·성량
assert.strictEqual(score("2026-10-18", "15:00"), 2);   // 카이 · 박은태 고음·성량
assert.strictEqual(score("2026-10-24", "19:00"), 1);   // 박은태
assert.strictEqual(r(`scorePerf("엘리자벳", findPerf("엘리자벳", "2026-10-24", "14:00"), []).pts`), 0);   // 취향 없으면 0
assert.strictEqual(r(`pickIndex("엘리자벳", ["2026-10-18|15:00","2026-10-24|14:00","2026-10-24|19:00"].map(s => findPerf("엘리자벳", ...s.split("|"))), ["가창", "맑은 음색"])`), 1);
assert.strictEqual(r(`AXIS_PAIR["가창"]`), "연기");
console.log("core ok");
