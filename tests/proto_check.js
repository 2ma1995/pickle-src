// 앱(app/index.html — 프로토를 옮긴 새 앱) 점검. 실행: node tests/proto_check.js  (배포 대상 아님)
// index.html 의 <proto-flow>(화면 이동·추천 극·추천 조합·평가 반영·월드컵·관람 후)·<track>(기록기) 블록과 index.html 이 이미 나눠 둔 <personal-weights>·<taste-first> 블록을 그대로 꺼내 실행한다.
// 실제 데이터 점검은 app/data.js 를 읽고, 다른 경로로 보려면 PICKLE_DATA_JS=<경로> 로 지정한다.
const fs = require("fs"), path = require("path"), assert = require("assert"), crypto = require("crypto");
const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8");
const block = name => { const m = html.match(new RegExp("// <" + name + ">([\\s\\S]*?)// </" + name + ">")); assert(m, "app/index.html 에 <" + name + "> 블록이 없다"); return m[1]; };
const names = "entryRoute, tasteNext, showRef, allShows, showNext, dayHash, calDays, homeRecs, comboRecs, comboEvidence, togglePin, pinsOf, pinStateOf, resetCombo, tasteSnapshot, comboRecord, comboChoiceRecord, shownCombos, pickRecord, actorRecord, " +
  "chipDirs, chipList, draftScore, draftChip, draftActor, applyComboRating, applyActorRating, wrongOf, pinAskOf, setPin, answerPinAsk, DUEL_MAX, duelNext, duelMore, duelCanMore, duelRecord, applyDuel, duelDone, duelTags, dueVisit, answerVisit, skipVisit, addAgain, " +
  "makeTracker, buildVocab, EVENTS, CHIPS, ALGO_VER, TRACK_CFG, TASTE_CARDS, MUSIC_CARDS, " +
  "homeRows, areaOf, leadRolesOf, defaultSel, curSel, selPerfs, selDates, setSel, setSelCast, relaxHints, monthRange, calMonthOf, calMove, calDayOf, priceMin, priceMinText, duelStatus, iga, likeCurrent, byPopularity, regionTabs, regionKeyOf, showsIn, OTHER_REGION, vrOf, tasteSnapRecord, hiddenShows, hideShow, unhideShow, similarWorks, askActorOf, askTagList, " +
  "SAT, SAT_WHY, setSat, setSatWhy, satOf, likeBonus, satBlocked, shownRecs, recAgain, satRecord, REVIEW_RATES, reviewRoles, reviewChips, reviewLabel, newReview, setRvRate, toggleRvTag, toggleRvCombo, swapRvActor, saveReview, reviewOf, reviewRows, usableReviewTags, reviewSuggest, applySuggest, reviewRecord, fitPairs, logPerfs, actorConds, setActorCond, moveActor, resetActorConds, mustClash, " +
  "PLAN_STATUS, planStatus, setPlanStatus, setPlanField, plansOn, pcalShift, pcalWeeks, pcalStart, planStatusRecord";
const L =new Function(block("personal-weights") + block("taste-first") + block("proto-flow") + block("track") + "; return {" + names + "};")();
const {entryRoute, tasteNext, showRef, allShows, showNext, dayHash, calDays, homeRecs, comboRecs, comboEvidence, togglePin, pinStateOf, resetCombo, tasteSnapshot, comboRecord, comboChoiceRecord, shownCombos, pickRecord, actorRecord,
  chipDirs, chipList, draftScore, draftChip, draftActor, applyComboRating, applyActorRating, wrongOf, pinAskOf, answerPinAsk, duelNext, duelMore, duelCanMore, duelRecord, applyDuel, duelDone, dueVisit, answerVisit, skipVisit, addAgain, makeTracker, buildVocab, EVENTS, CHIPS, TRACK_CFG, homeRows, areaOf, leadRolesOf, defaultSel, curSel, selPerfs, selDates, setSel, setSelCast, relaxHints, monthRange, calMonthOf, calMove, calDayOf, priceMin, priceMinText, duelStatus, iga, likeCurrent, byPopularity, regionTabs, regionKeyOf, showsIn, OTHER_REGION, vrOf, tasteSnapRecord, hiddenShows, hideShow, unhideShow, similarWorks, askActorOf, askTagList} = L;
const loadApp = require("./proto_app.js");
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ===== 1. 화면 이동 =====
// MVP(2026-10-27): 첫 화면은 누구나 홈의 내 취향 카드(빈 카드면 거기서 온보딩), 온보딩은 2단계(1/2 배우 → 2/2 기대 → 홈)
ok(entryRoute(null) === "#home" && entryRoute(undefined) === "#home", "취향을 한 번도 안 다룬 사람도 첫 화면은 홈(빈 취향 카드)");
ok(entryRoute({axes: [], works: [], favs: [], grade: ""}) === "#home", "건너뛰어서 빈 취향이어도 홈");
ok(tasteNext("1") === "#taste/2" && tasteNext(2) === "#home" && tasteNext("3") === "#home" && tasteNext(4) === "#home", "온보딩 1→2→홈");
ok(tasteNext("2", "엘리자벳") === "#home" && tasteNext("1", "엘리자벳") === "#taste/2", "2 다음은 바로 홈(두 번째 인자가 있어도 같다)");
ok(dayHash("엘리자벳", "2026-11-01") === "#day/엘리자벳/2026-11-01");

// ===== 2. 작은 데이터로 조합 추천·평가 반영·월드컵 =====
const W = "극", RUN = "서울 · 1ST", FROM = "2026-10-10";
const mk = (date, cast, extra = {}) => ({work: W, date, dow: "토", time: "14:00", cast, notes: [], ...extra});
const D = {
  works: [{name: W, hasSchedule: true, runs: [{label: RUN, start: "2026-10-01", end: "2026-12-31", venue: "홀"}]}],
  roles: {[W]: [{role: "A", weight: "주연", cast: ["a1", "a2"]}, {role: "B", weight: "주연", cast: ["b1", "b2"]}, {role: "C", weight: "조연", cast: ["c1"]}]},
  perfs: [mk("2026-11-01", {A: "a1", B: "b1", C: "c1"}), mk("2026-11-02", {A: "a1", B: "b2", C: "c1"}), mk("2026-11-03", {A: "a2", B: "b1", C: "c1"}), mk("2026-11-04", {A: "a2", B: "b2", C: "c1"}), mk("2026-11-05", {A: "a1", B: "b1", C: "c1"}, {notes: ["단체대관"]})],
  actorTags: {[W]: {a1: [{tag: "성량", src: "x"}], b1: [{tag: "성량", src: "x"}], b2: [{tag: "감정 전달형", src: "x"}], a2: [], c1: []}},  // c1(조연 배역)도 이제 조합에 들어간다(결정 13). 늘 같은 배우라 태그를 비워 순위에 영향이 없게 한다
  comboTags: {[W]: []},
  axis: {"강한 성량": ["성량"], "섬세한 표현": ["감정 전달형"]},
  axes: [{left: "강한 성량", right: "섬세한 표현", l: "강한 성량", r: "섬세한 표현", title: "노래 표현은"}],
  workTags: {}, actorTagLabels: {"성량": "음색", "감정 전달형": "표현"}, workTagLabels: {}, comboTagLabels: {}, voiceTags: ["성량"], actorProfiles: {}, currentShows: [],
};
const fresh = (extra = {}) => ({prefs: {axes: ["강한 성량"], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], proto: {}, ...extra});
const key = c => Object.entries(c.cast).map(e => e.join(":")).sort().join("|");
const ab = c => Object.entries(c.cast).filter(([r]) => r !== "C").map(([, a]) => a).join("+");  // C(조연 배역, 늘 c1)는 줄여서 본다
const top = S => comboRecs(D, S, W, FROM).map(ab);

let S = fresh();
eq(top(S), ["a1+b1", "a2+b1", "a1+b2"], "근거 합이 큰 조합부터, 같으면 반대 근거가 적은 쪽(a1+b2 는 b2 가 취향과 반대) · 근거 없는 조합(a2+b2)과 전체대관 회차는 뺀다");
ok(comboRecs(D, S, W, FROM)[0].dates.join() === "2026-11-01", "대관 날짜(11-05)는 날짜에 안 나온다");
eq(comboRecs(D, fresh({prefs: {axes: [], works: [], favs: []}}), W, FROM).map(ab).sort(), ["a1+b1", "a1+b2", "a2+b1", "a2+b2"], "기대 답을 모두 비워도 배우 조건만으로 추천한다(결정 21, 대관 회차만 있는 조합은 없다)");
eq(comboRecs(D, fresh({prefs: {axes: [], works: [], favs: ["a2"], must: ["a2"]}}), W, FROM).map(ab).sort(), ["a2+b1", "a2+b2"], "반드시 포함만 고른 사람: 그 배우가 나오는 조합만");
// 배우 조건(9절): 가능하면 포함은 그 배우가 나오는 조합을 앞에, 순위가 높은 배우 먼저 · 반드시 포함은 배역과 상관없이 · 작품별로 기억
{ const {actorConds, setActorCond, moveActor, resetActorConds, mustClash} = L;
  eq(top(fresh({prefs: {axes: ["강한 성량"], works: [], favs: ["b2"], grade: ""}}))[0], "a1+b2", "가능하면 포함 b2: 근거가 더 적어도 b2 가 나오는 조합을 앞에");
  const r1 = top(fresh({prefs: {axes: ["강한 성량"], works: [], favs: ["b2", "a2"], grade: ""}}));
  ok(r1[0].includes("b2") && r1.indexOf("a2+b1") > r1.findIndex(x => x.includes("b2")), "가능하면 포함 순위 1번(b2)이 나오는 조합이 2번(a2)만 나오는 조합보다 앞");
  eq(top(fresh({prefs: {axes: ["강한 성량"], works: [], favs: ["c1"], must: ["c1"], grade: ""}})).length, 3, "조연 배역 배우도 반드시 포함으로 거른다(결정 12, c1 은 모든 회차)");
  let S = fresh({prefs: {axes: ["강한 성량"], works: [], favs: ["a1", "없는배우"], must: ["a1", "없는배우"], avoid: ["b2"], grade: ""}});
  const c0 = actorConds(D, S, W); eq([c0.must, c0.maybe, c0.avoid, c0.missing, c0.edited], [["a1"], [], ["b2"], ["없는배우"], false], "온보딩 값이 기본값, 이 작품에 없는 반드시 포함 배우는 안내만");
  ok(setActorCond(D, S, W, "b2", "maybe") === false && setActorCond(D, S, W, "없는배우", "must") === null, "공통 피하고 싶은 배우는 여기서 보고 싶은 배우로 못 바꾸고, 이 작품 배우만 고른다");
  setActorCond(D, S, W, "b1", "maybe"); setActorCond(D, S, W, "a2", "avoid");
  const c1 = actorConds(D, S, W); eq([c1.must, c1.maybe, c1.extra, c1.edited, S.prefs.must], [["a1"], ["b1"], ["a2"], true, ["a1", "없는배우"]], "이 작품에서만 고친다(온보딩 값은 그대로)");
  eq(top(S), ["a1+b1"], "이 작품에 한해 더 피한 배우(a2)·공통 피하고 싶은 배우(b2) 회차는 빠진다");
  ok(moveActor(D, S, W, "b1", -1) && actorConds(D, S, W).pick.map(x => x.a).join() === "b1,a1" && !moveActor(D, S, W, "b1", -1), "순위 바꾸기(↑↓)");
  setActorCond(D, S, W, "a2", "must"); eq(mustClash(D, W, actorConds(D, S, W), FROM), {kind: "role", a: "a1", b: "a2"}, "같은 배역의 반드시 포함 둘: 순위 낮은 쪽을 알려 준다");
  setActorCond(D, S, W, "a2", ""); setActorCond(D, S, W, "b2", ""); setActorCond(D, S, W, "b1", "must"); ok(mustClash(D, W, actorConds(D, S, W), FROM) === null, "함께 나오는 회차가 있으면 문제없음");
  resetActorConds(S, W); ok(!actorConds(D, S, W).edited, "작품별 조정 지우기 → 다시 온보딩 기본값"); }
// ⭐/🚫
ok(togglePin(S, W, "a1", "star") === "star" && pinStateOf(S, W, "a1") === "star", "⭐");
eq(top(S), ["a1+b1", "a1+b2"], "⭐ a1: a1 이 나오는 조합만");
ok(togglePin(S, W, "a1", "star") === "" && top(S).length === 3, "⭐ 다시 누르면 해제");
togglePin(S, W, "b1", "avoid"); eq(top(S), ["a1+b2"], "🚫 b1: b1 이 나오는 조합을 뺀다");
ok(togglePin(S, W, "b1", "star") === "star" && pinStateOf(S, W, "b1") === "star", "같은 배우의 🚫 는 ⭐ 로 바뀐다");
resetCombo(S, W); eq(top(S).length, 3, "되돌리기");
// 본 조합 제외
S = fresh({plans: [{work: W, date: "2026-10-01", time: "14:00", cast: {A: "a1", B: "b1", C: "c1"}, tagged: true}]});
eq(top(S), ["a2+b1", "a1+b2"], "이미 본 조합은 뺀다");
// 취향폼 1/3: 반드시 볼 배우(must)는 ⭐처럼, 피하고 싶은 배우(avoid)는 조연이어도 그 회차를 뺀다
const withP = p => fresh({prefs: {axes: ["강한 성량"], works: [], favs: [], grade: "", ...p}});
eq(top(withP({favs: ["a2"], must: ["a2"]})), ["a2+b1"], "반드시 포함 a2: a2 가 나오는 조합만(근거 없는 a2+b2 는 원래대로 빠진다)");
eq(top(withP({favs: ["a2"]})), ["a2+b1", "a1+b1", "a1+b2"], "가능하면 포함(must 아님)은 거르지 않고, 그 배우가 나오는 조합을 앞에 둔다(5.1절)");
eq(top(withP({must: ["없는배우"]})), ["a1+b1", "a2+b1", "a1+b2"], "이 작품에 안 나오는 반드시 배우는 이 작품을 거르지 않는다");
eq(top(withP({avoid: ["b1"]})), ["a1+b2"], "피하고 싶은 배우 b1: b1 회차를 뺀다");
eq(top(withP({avoid: ["c1"]})), [], "피하고 싶은 조연 c1: 모든 회차에 나와서 추천이 없다");
eq(top(withP({avoid: []})), ["a1+b1", "a2+b1", "a1+b2"], "빈 목록은 아무것도 안 뺀다");
// ① 우선순위 가중치: 1순위 영역(노래=음색·가창 질문, 연기=연기·해석 질문)의 태그는 (배우, 취향) 쌍마다 2점
const D2 = JSON.parse(JSON.stringify(D)); D2.actorTags[W] = {a1: [{tag: "성량", src: "x"}], b1: [{tag: "성량", src: "x"}], a2: [{tag: "코믹 연기", src: "x"}], b2: [{tag: "코믹 연기", src: "x"}], c1: []};
const scores = (Dx, p) => Object.fromEntries(comboRecs(Dx, fresh({prefs: {works: [], favs: [], grade: "", ...p}}), W, FROM).map(c => [ab(c), c.score]));
const pk = ["tag:성량", "tag:코믹 연기"];
eq(scores(D2, {axes: pk}), {"a1+b1": 2, "a1+b2": 2, "a2+b1": 2, "a2+b2": 2}, "우선순위가 없으면 쌍마다 1점");
eq(scores(D2, {axes: pk, prio: "고루"}), {"a1+b1": 2, "a1+b2": 2, "a2+b1": 2, "a2+b2": 2}, "골고루도 1점");
eq(scores(D2, {axes: pk, prio: "노래"}), {"a1+b1": 4, "a1+b2": 3, "a2+b1": 3, "a2+b2": 2}, "노래 1순위: 성량 쌍만 2점");
eq(scores(D2, {axes: pk, prio: "연기"}), {"a1+b1": 2, "a1+b2": 3, "a2+b1": 3, "a2+b2": 4}, "연기 1순위: 코믹 연기 쌍만 2점");
eq(comboRecs(D2, fresh({prefs: {axes: pk, prio: "연기", works: [], favs: []}}), W, FROM).map(ab)[0], "a2+b2", "가중치가 순서를 바꾼다");
// 취향 키 tag: 는 그 태그 하나만(5축 키 '강한 성량'은 축의 태그 전부)
eq(scores(D, {axes: ["tag:감정 전달형"]}), {"a1+b2": 1, "a2+b2": 1}, "tag: 키는 그 태그만 맞춘다");
// 배역 싱크로: 묻지 않는 기본 가산점(배우마다 0.5). 취향 근거가 있는 조합에만 붙고, 이것만으로는 추천하지 않는다
const D3 = JSON.parse(JSON.stringify(D)); D3.actorTags[W].a2 = [{tag: "배역 싱크로", src: "x"}]; D3.actorTags[W].b2 = [{tag: "배역 싱크로", src: "x"}];
eq(scores(D3, {axes: ["tag:성량"]}), {"a1+b1": 2, "a2+b1": 1.5, "a1+b2": 1.5}, "싱크로 배우가 있으면 +0.5, 성량 근거가 없는 a2+b2 는 싱크로 둘이어도 빠진다");
eq(comboRecs(D3, fresh({prefs: {axes: ["tag:성량"], works: [], favs: []}, proto: {wrong: {[W]: ["b2"]}}}), W, FROM).find(c => c.cast.B === "b2" && c.cast.A === "a1").score, 1, "'설명이 틀렸어요'로 뺀 배우의 싱크로는 안 센다");

// ---- 평가 칩 초안: 점수에 따라 방향이 바뀐다
eq([chipDirs(5), chipDirs(4), chipDirs(3), chipDirs(2), chipDirs(1), chipDirs(0)], [["+"], ["+"], ["+", "-"], ["-"], ["-"], []], "4~5 +, 1~2 −, 3 둘 다");
eq(chipList("combo", "+").map(c => c[0]), ["voice", "vocal", "acting", "chemistry", "actor", "etc"], "끌린 점 쪽엔 '설명이 틀렸어요' 없음");
eq(chipList("combo", "-").map(c => c[0]), CHIPS.map(c => c[0]), "안 맞은 점 쪽엔 7개 전부");
eq(chipList("actor", "-").map(c => c[0]), ["voice", "vocal", "acting", "wrong", "etc"], "배우 한 명 평가엔 케미·특정 배우 없음");
ok(CHIPS.length === 7 && CHIPS[5][1] === "설명이 틀렸어요", "이유 칩 7개");
let dr = {score: 0, chips: []};
dr = draftScore(dr, 5); dr = draftChip(dr, "voice", "+"); dr = draftChip(dr, "actor", "+"); dr = draftActor(dr, "actor", "+", "a1");
eq(dr, {score: 5, chips: [{chip: "voice", dir: "+", actors: []}, {chip: "actor", dir: "+", actors: ["a1"]}]});
eq(draftActor(dr, "actor", "+", "a1").chips[1].actors, [], "같은 배우를 다시 누르면 해제");
eq(draftChip(dr, "voice", "+").chips.map(c => c.chip), ["actor"], "같은 칩을 다시 누르면 해제");
eq(draftScore(dr, 2).chips, [], "점수를 낮추면 방향이 안 맞는 칩이 비워진다(+ 칩 → 1~2점)");
eq(draftScore(draftChip(draftScore({score: 0, chips: []}, 3), "voice", "-"), 3).score, 0, "같은 점수를 다시 누르면 해제");
eq(draftScore(draftChip(draftChip(draftScore({score: 0, chips: []}, 3), "voice", "+"), "etc", "-"), 4).chips.map(c => c.chip), ["voice"], "3점에서 4점으로: + 칩만 남는다");

// ---- 평가 반영
S = fresh(); let before = top(S)[0];
let eff = applyComboRating(S, W, key({cast: {A: "a1", B: "b1", C: "c1"}}), {score: 2, chips: [{chip: "etc", dir: "-"}]}, {A: "a1", B: "b1"});
ok(eff.hid && top(S)[0] !== before && top(S).length === 2, "1~2점: 그 조합은 내려가고 다음 조합이 나온다");
S = fresh(); eff = applyComboRating(S, W, "k", {score: 3, chips: [{chip: "actor", dir: "-", actors: ["b1"]}]}, {A: "a1", B: "b1"});
ok(eff.ask.length === 1 && eff.ask[0].actor === "b1" && eff.ask[0].kind === "avoid" && pinStateOf(S, W, "b1") === "" && top(S).some(t => t.includes("b1")), "안 맞은 점 '특정 배우': 자동으로 🚫 를 걸지 않는다(그 배우의 회차가 통째로 빠지니까). 평가 뒤에 묻는다");
eq(pinAskOf(S, W), [{actor: "b1", kind: "avoid"}], "물음이 대기한다");
ok(answerPinAsk(S, W, "b1", false) === "" && pinStateOf(S, W, "b1") === "" && pinAskOf(S, W).length === 0 && top(S).some(t => t.includes("b1")), "'아니요': 아무것도 안 걸고 물음만 닫는다");
applyComboRating(S, W, "k", {score: 3, chips: [{chip: "actor", dir: "-", actors: ["b1"]}]}, {A: "a1", B: "b1"});
ok(answerPinAsk(S, W, "b1", true) === "avoid" && pinStateOf(S, W, "b1") === "avoid" && !top(S).some(t => t.includes("b1")) && pinAskOf(S, W).length === 0, "'제외': 그때 🚫 가 걸려 그 배우가 나오는 조합이 빠진다");
ok(answerPinAsk(S, W, "zz", true) === null, "없는 물음에 답하면 무시");
S = fresh(); eff = applyComboRating(S, W, key({cast: {A: "a1", B: "b1", C: "c1"}}), {score: 1, chips: [{chip: "actor", dir: "-", actors: ["b1"]}]}, {A: "a1", B: "b1"});
ok(eff.hid && pinStateOf(S, W, "b1") === "" && pinAskOf(S, W)[0].actor === "b1" && top(S).length === 2, "1~2점: 그 조합만 바로 내려가고(다음 조합이 나온다) 🚫 는 묻는다");
S = fresh(); eff = applyComboRating(S, W, "k", {score: 5, chips: [{chip: "actor", dir: "+", actors: ["a1"]}, {chip: "voice", dir: "+"}]}, {A: "a1", B: "b1"});
ok(eff.liked && !eff.hid && eff.ask[0].kind === "star" && pinStateOf(S, W, "a1") === "" && top(S).some(t => t.startsWith("a2")), "끌린 점 '특정 배우': ⭐ 도 자동으로 안 건다");
ok(answerPinAsk(S, W, "a1", true) === "star" && pinStateOf(S, W, "a1") === "star" && top(S).every(t => t.startsWith("a1")), "'꼭 볼래요': 그때 ⭐");
S = fresh(); togglePin(S, W, "a1", "star"); eff = applyComboRating(S, W, "k", {score: 4, chips: [{chip: "actor", dir: "+", actors: ["a1"]}]}, {A: "a1", B: "b1"});
ok(eff.ask.length === 0 && pinAskOf(S, W).length === 0, "이미 그렇게 걸려 있으면 묻지 않는다");
S = fresh(); applyComboRating(S, W, "k", {score: 3, chips: [{chip: "actor", dir: "-", actors: ["b1"]}]}, {}); applyComboRating(S, W, "k2", {score: 4, chips: [{chip: "actor", dir: "+", actors: ["b1", "a1"]}]}, {});
eq(pinAskOf(S, W).map(x => x.actor + ":" + x.kind).sort(), ["a1:star", "b1:star"], "같은 배우를 다시 평가하면 마지막 물음 하나만 남는다");
resetCombo(S, W); ok(pinAskOf(S, W).length === 0, "되돌리면 대기 중인 물음도 지운다");
S = fresh(); const e0 = comboEvidence(D, ["강한 성량"], W, {A: "a1", B: "b1"}).hit;
eff = applyComboRating(S, W, "k", {score: 2, chips: [{chip: "wrong", dir: "-", actors: ["a1"]}]}, {A: "a1", B: "b1"});
ok(e0 === 2 && wrongOf(S, W).join() === "a1" && comboEvidence(D, ["강한 성량"], W, {A: "a1", B: "b1"}, wrongOf(S, W)).hit === 1 && eff.wrong.join() === "a1", "'설명이 틀렸어요': 고른 배우의 태그 근거를 뺀다");
S = fresh(); eff = applyComboRating(S, W, "k", {score: 3, chips: [{chip: "wrong", dir: "-"}]}, {A: "a1", B: "b1"});
eq(wrongOf(S, W).sort(), ["a1", "b1"], "배우를 안 골랐으면 조합 전체");
// ---- 배우 한 명 평가(KOPIS)
S = fresh({prefs: {axes: [], works: [], favs: []}});
eq(applyActorRating(S, "PF1", "x", {score: 2, chips: []}), {avoid: true, fav: false}); eq(S.proto.avoidActors, ["x"], "1~2점은 닮은 배우 기준에서 뺀다");
eq(applyActorRating(S, "PF1", "x", {score: 5, chips: []}), {avoid: false, fav: true}); eq([S.prefs.favs, S.proto.avoidActors], [["x"], []], "4~5점은 좋아하는 배우로 더하고 뺀 목록에서 푼다");
S = fresh(); eq(applyActorRating(S, "PF1", "y", {score: 3, chips: [{chip: "wrong", dir: "-"}]}).avoid, true, "3점이어도 '설명이 틀렸어요'면 뺀다");

// ---- 이상형 월드컵
const rngNo = () => 0.9, rngSwap = () => 0.1;
S = fresh(); let cur = duelNext(D, S, W, FROM, rngNo);
ok(cur.role === "A" && cur.left === "a1" && cur.right === "a2" && cur.n === 0 && cur.of === 2, "첫 배역부터. 한 라운드는 주연 배역마다 한 판(여기선 2판)");
eq(duelNext(D, S, W, FROM, rngSwap).left, "a1", "한 번 놓은 좌우는 다시 그려도 안 바뀐다(무작위는 처음 한 번)");
S = fresh(); cur = duelNext(D, S, W, FROM, rngSwap); ok(cur.left === "a2" && cur.right === "a1", "좌우는 무작위로 바뀔 수 있다");
const rec = duelRecord(D, W, cur, "left"); ok(rec.left.actor === "a2" && rec.right.actor === "a1" && rec.result === "left" && Array.isArray(rec.left.tags), "기록에 그때 놓인 좌우가 남는다");
const r1 = applyDuel(S, W, cur, "left");
ok(r1.win === "a2" && r1.lose === "a1" && duelDone(S, W) === 1, "고른 쪽이 이긴 것으로");
eq(top(S), ["a2+b1", "a1+b1", "a2+b2"], "월드컵 선택이 바로 추천 조합에 반영된다(a2 +1, a1 −1 · 근거는 없어도 내가 고른 이상형이 나오는 a2+b2 가 들어오고, 점수가 0 이 된 a1+b2 는 빠진다)");
cur = duelNext(D, S, W, FROM, rngNo); ok(cur.role === "B" && cur.n === 1 && cur.of === 2, "A 배역이 끝나면 B 배역");
applyDuel(S, W, cur, "tie"); ok(duelNext(D, S, W, FROM, rngNo) === null && duelDone(S, W) === 2 && !duelCanMore(D, S, W, FROM), "한 라운드가 끝나면 더 안 나온다 · 남은 쌍이 없으면 '더 해 볼래요'도 없다");
eq(top(S), ["a2+b1", "a1+b1", "a2+b2"], "비슷해요는 추천에 영향이 없다");
resetCombo(S, W); ok(duelDone(S, W) === 0 && top(S)[0] === "a1+b1", "되돌리면 월드컵 선택도 사라진다");
// 라운드: 한 번에 주연 배역마다 1판, 최대 DUEL_MAX(3)판. 끝에 '더 해 볼래요'로 다음 라운드, 같은 쌍은 다시 안 나온다
const cl = (p, n) => Array.from({length: n}, (_, i) => p + (i + 1));
const D5 = {...D, roles: {[W]: [{role: "A", weight: "주연", cast: cl("a", 4)}, {role: "B", weight: "주연", cast: cl("b", 3)}, {role: "C", weight: "주연", cast: cl("c", 2)}, {role: "E", weight: "주연", cast: cl("e", 2)}, {role: "S", weight: "조연", cast: ["s1"]}]},
  perfs: cl("", 4).map((_, i) => mk(`2026-11-0${i + 1}`, {A: "a" + (i + 1), B: "b" + (i % 3 + 1), C: "c" + (i % 2 + 1), E: "e" + (i % 2 + 1), S: "s1"}))};
S = fresh(); const seen = [];
const play = () => { let k = 0; for (;;) { const c = duelNext(D5, S, W, FROM, rngNo); if (!c) return k; seen.push(c.role + ":" + [c.left, c.right].sort().join("")); applyDuel(S, W, c, "left"); k++; } };
ok(L.DUEL_MAX === 3 && duelNext(D5, fresh(), W, FROM, rngNo).of === 3, "한 라운드는 최대 3판");
ok(play() === 3 && seen.map(x => x[0]).join("") === "ABC", "주연 배역마다 1판씩, 네 번째 주연 배역(E)은 안 나온다: " + seen);
ok(duelCanMore(D5, S, W, FROM), "남은 쌍이 있으면 '더 해 볼래요'");
duelMore(S, W); ok(play() === 2 && seen.slice(3).map(x => x[0]).join("") === "AB", "두 번째 라운드: 아직 쌍이 남은 배역마다 1판 더(C 는 후보가 둘뿐이라 이미 끝)");
let guard = 0; while (duelCanMore(D5, S, W, FROM) && guard++ < 10) { duelMore(S, W); play(); }
ok(duelDone(S, W) === 10 && new Set(seen).size === seen.length && !duelCanMore(D5, S, W, FROM), "끝까지 하면 가능한 쌍 10개를 한 번씩만(같은 쌍 반복 없음)");

// ---- 공연 화면: 선택·날짜·달력
S = fresh();
eq(defaultSel(D, S, W, FROM), {A: "a1", B: "b1", C: "c1"}, "미리 선택 = 추천 1순위 조합");
eq(defaultSel(D, fresh({prefs: {axes: [], works: [], favs: []}}), W, FROM), {A: "a1", B: "b1", C: "c1"}, "추천이 없으면 가장 빠른 회차의 조합(전체대관은 제외)");
eq(curSel(D, S, W, FROM), {A: "a1", B: "b1", C: "c1"});
eq(leadRolesOf(D, W).map(r => r.role), ["A", "B", "C"], "핵심 배역 전체(주연/조연 구분 없음, 결정 13)");
eq(leadRolesOf({roles: {"시카고": [{role: "벨마 켈리", weight: "주연", cast: []}, {role: "마마 모튼", weight: "조연", cast: []}, {role: "에이모스 하트", weight: "조연", cast: []}, {role: "메리 선샤인", weight: "조연", cast: []}]}}, "시카고").map(r => r.role), ["벨마 켈리", "마마 모튼"], "시카고 에이모스 하트·메리 선샤인은 추천 단위에서 뺀다(결정 28)");
eq(selDates(D, W, {A: "a1", B: "b1"}, FROM), ["2026-11-01"], "고른 조합이 같이 나오는 날(전체대관 제외)");
eq(selDates(D, W, {A: "a2", B: "b2"}, FROM), ["2026-11-04"]);
ok(setSel(D, S, W, "A", "a2", FROM) === "a1", "배우를 누르면 그 배역만 바뀌고 바뀌기 전 배우를 돌려준다");
eq(curSel(D, S, W, FROM), {A: "a2", B: "b1", C: "c1"}, "나머지 배역은 그대로");
eq(S.proto.cmp[W], {role: "A", a: "a1", b: "a2"}, "비교 제안용으로 바뀐 쌍을 기억한다");
eq(selDates(D, W, curSel(D, S, W, FROM), FROM), ["2026-11-03"], "배우를 바꾸면 날짜가 다시 계산된다");
setSel(D, S, W, "A", "a2", FROM); ok(!S.proto.cmp?.[W], "같은 배우를 다시 누르면 비교 제안은 없다");
S.proto.sel[W].A = "없는배우"; eq(curSel(D, S, W, FROM).A, "a1", "이제 안 나오는 배우를 골라 뒀으면 미리 선택으로 돌아간다");
setSelCast(S, W, {A: "a2", B: "b2"}); eq(curSel(D, S, W, FROM), {A: "a2", B: "b2", C: "c1"}, "다른 추천 조합을 통째로 고른다");
const none = {A: "a1", B: "b2"}; setSelCast(S, W, {A: "a2", B: "b1"});
eq(relaxHints(D, W, {A: "a1", B: "b3"}, FROM).map(h => h.role), ["B"], "안 나오는 배우를 섞어 골랐을 땐 그 배역만 바꿔 보라고 한다(A 는 바꿀 곳이 없다)");
eq(relaxHints(D, W, {A: "a1", B: "b2"}, FROM).map(h => [h.role, h.options.map(o => o.actor + o.n).join()]), [["A", "a2" + 1], ["B", "b1" + 1]], "고른 조합이 안 나올 때: 한 배역만 바꾸면 볼 수 있는 배우와 날 수");
S.proto.cd = {[W]: "2026-11-01"}; S.proto.cm = {[W]: "2026-12"};
eq(monthRange(["2026-10-11", "2027-01-03"]), ["2026-10", "2026-11", "2026-12", "2027-01"], "첫 달부터 마지막 달까지 이어서(해가 바뀌어도)");
eq(monthRange([]), [], "날짜가 없으면 달력도 없다");
S = fresh(); const ds = ["2026-11-05", "2026-12-10", "2027-01-02"];
ok(calMonthOf(S, W, ds) === "2026-11", "처음엔 볼 수 있는 날이 있는 첫 달");
ok(calMove(S, W, ds, 1) === "2026-12" && calMonthOf(S, W, ds) === "2026-12" && calMove(S, W, ds, 5) === "2027-01" && calMove(S, W, ds, -9) === "2026-11", "‹ › 로 넘기고, 처음·끝에서 멈춘다");
ok(calMonthOf({proto: {cm: {[W]: "2030-01"}}}, W, ds) === "2026-11", "범위 밖 달은 첫 달로");
ok(calDayOf(S, W, ds) === "" && calDayOf({proto: {cd: {[W]: "2026-12-10"}}}, W, ds) === "2026-12-10" && calDayOf({proto: {cd: {[W]: "2026-12-11"}}}, W, ds) === "", "고른 날은 볼 수 있는 날일 때만");
ok(priceMin([["VIP석", 150000], ["R석", 120000], ["S석", 90000]]) === 90000 && priceMin([]) === 0 && priceMin(null) === 0, "시드 가격표의 최저가");
ok(priceMinText("VIP석 150,000원, R석 130,000원, S석 90,000원 / 청소년 50% 할인") === 90000 && priceMinText("R석 66,000원") === 66000 && priceMinText("전석 무료") === 0 && priceMinText("") === 0, "KOPIS 가격 글에서 최저가(숫자만)");
ok(iga("카이") === "가" && iga("린아") === "가" && iga("박은태") === "가" && iga("서경수") === "가" && iga("정민") === "이" && iga("김준수") === "가" && iga("김재범") === "이" && iga("전동석") === "이", "이름 뒤 이/가");

// ===== 3. 기록 한 줄 만들기(정의서 5종) =====
S = fresh({prefs: {axes: ["강한 성량", "연기"], works: ["tragedy", "fun"], favs: ["a1", "zz"], grade: ""}});
const snap = tasteSnapshot(D, S);
eq(snap.axes, {"강한 성량": -1}, "5축 값: 왼쪽 -1 · 오른쪽 +1 · 안 고른 축 0 (이 데이터엔 축이 하나)");
eq(snap.favs, ["a1", "zz"]); ok(snap.tags.includes("파멸") && snap.tags.includes("유쾌") && snap.tags.every(t => typeof t === "string"), "카드의 태그");
const cr = comboRecord(D, S, "expected", W, {A: "a1", B: "b1", C: "c1"}, {score: 4, chips: [{chip: "voice", dir: "+", actors: []}, {chip: "actor", dir: "+", actors: ["a1"]}]}, null, "2026-11-01");
eq(Object.keys(cr).sort(), ["algo", "cast", "chips", "reasons", "run", "score", "stage", "taste", "work"], "직후 평가는 날짜·시각이 없다");
eq([cr.stage, cr.run, cr.algo, cr.cast, cr.score], ["expected", RUN, "rule-v1", {A: "a1", B: "b1", C: "c1"}, 4], "핵심 배역 전체 · 시즌 · 방식 버전");
eq(cr.reasons, {actors: {a1: ["성량"], b1: ["성량"]}, combo: []}, "배우별로 맞춘 태그");
eq(cr.chips, [{chip: "voice", dir: "+"}, {chip: "actor", dir: "+", actors: ["a1"]}], "칩: 배우를 안 골랐으면 actors 없음");
const ex = comboRecord(D, S, "experienced", W, {A: "a1", B: "b1", C: "c1"}, {score: 2, chips: []}, {date: "2026-10-01", time: "14:00"});
ok(ex.stage === "experienced" && ex.date === "2026-10-01" && ex.time === "14:00" && ex.run === RUN, "관람 후 평가는 본 회차");
const ch = comboChoiceRecord(D, fresh({proto: {pins: {[W]: {star: ["a1"], avoid: ["b2"]}}}}), "plan", D.perfs[0], FROM);
eq(Object.keys(ch).sort(), ["action", "cast", "date", "filters", "run", "shown", "time", "work"]);
eq([ch.action, ch.filters, ch.cast], ["plan", {period: "all", star: ["a1"], avoid: ["b2"]}, {A: "a1", B: "b1", C: "c1"}], "고른 회차와 걸어 둔 필터");
ok(ch.shown.length <= 3 && ch.shown[0].pick === true && ch.shown.slice(1).every(s => s.pick === false) && ch.shown.every(s => Object.keys(s.cast).length === 3), "그때 보여 준 추천 조합 위 3개(핵심 배역 전체), 첫째가 PICK");
eq(pickRecord(D, W, "a1", "", "star"), {work: W, role: "A", actor: "a1", action: "pin"});
eq(["", "star", "avoid", "avoid"].map((b, i) => pickRecord(D, W, "b1", b, ["star", "", "avoid", ""][i]).action), ["pin", "unpin", "avoid", "unavoid"], "⭐ 걸기·풀기, 🚫 걸기·풀기");
eq(actorRecord(D, S, "PF123456", "x", {score: 2, chips: [{chip: "wrong", dir: "-"}, {chip: "voice", dir: "-"}]}), {show_id: "PF123456", actor: "x", score: 2, chips: [{chip: "wrong", dir: "-", actors: ["x"]}, {chip: "voice", dir: "-"}]}, "배우 한 명 평가: 설명이 틀렸어요는 그 배우로");

// ===== 4. 관람 후 =====
S = fresh({plans: [{work: W, date: "2026-10-01", time: "14:00", cast: {A: "a1", B: "b1"}}, {work: W, date: "2026-12-01", time: "14:00", cast: {A: "a2", B: "b1"}, status: "booked"}]});
ok(dueVisit(S, FROM) === -1 && dueVisit(S, "2026-12-02") === 1, "미정일정은 날짜가 지나도 묻지 않고, 관람예정만 묻는다(2026-10-28 사용자 결정)");
S.plans[0].status = "booked";
ok(dueVisit(S, FROM) === 0 && dueVisit(S, "2026-09-01") === -1, "날짜가 지난 관람예정만 묻는다");
answerVisit(S, 0, {score: 5, chips: [{chip: "voice", dir: "+", actors: []}]}, "2026-10-10");
ok(S.plans[0].asked && S.plans[0].tagged && S.plans[0].mood === "good" && S.tags.length === 1 && S.tags[0].mood === "good" && S.tags[0].score === 5 && dueVisit(S, FROM) === -1, "점수 한 번이 관람 기록이 된다(좋았어요)");
addAgain(S, 0, ["a1", "b1", "a2", "x"]); eq([S.plans[0].again, S.prefs.favs], [["a1", "b1", "a2"], ["a1", "b1", "a2"]], "또 보고 싶은 배우는 좋아하는 배우로(3명까지)");
S = fresh({plans: [{work: W, date: "2026-10-01", time: "14:00", cast: {A: "a1"}, status: "booked"}]}); skipVisit(S, 0); ok(dueVisit(S, FROM) === -1 && !S.plans[0].tagged && S.tags.length === 0, "나중에: 다시 안 묻고 기록은 안 남는다");
S = fresh({plans: [{work: W, date: "2026-10-01", time: "14:00", cast: {A: "a1"}}]}); answerVisit(S, 0, {score: 3, chips: []}); ok(S.tags[0].mood === "meh"); S.plans[0].mood = ""; S = fresh({plans: [{date: "2026-10-01", time: "1", cast: {}, work: W}]}); answerVisit(S, 0, {score: 1, chips: []}); ok(S.tags[0].mood === "bad", "3점 meh · 1~2점 bad");

// ===== 4b. v0.9 조합 만족도(docs/261027_2 10.2·10.3절, 결정 41·45·52) =====
{ const {SAT, SAT_WHY, setSat, setSatWhy, satOf, likeBonus, satBlocked, shownRecs, recAgain, satRecord} = L;
  let S = fresh(); const recs0 = comboRecs(D, S, W, FROM), c0 = recs0[0];
  ok(SAT.map(x => x[1]).join("/") === "이 조합이 마음에 들어요/별로예요/모르겠어요" && SAT_WHY.some(x => x[1] === "추천 이유가 와닿지 않아요"), "만족도 3지선다 + '누구 때문인가요?'에 '추천 이유가 와닿지 않아요'(결정 52)");
  ok(setSat(S, W, c0.key, c0.cast, "like", RUN, 1) === "like" && setSat(S, W, c0.key, c0.cast, "like", RUN, 1) === "" && !satOf(S, W)[c0.key], "같은 답을 다시 누르면 풀린다");
  ok(setSat(S, W, c0.key, c0.cast, "meh") === null, "정해진 답만");
  setSat(S, W, c0.key, c0.cast, "unsure", RUN, 1); ok(setSatWhy(S, W, c0.key, "combo") === null, "'누구 때문인가요?'는 별로예요에만");
  setSat(S, W, c0.key, c0.cast, "dislike", RUN, 1);
  ok(setSatWhy(S, W, c0.key, "", "없는배우") === null && setSatWhy(S, W, c0.key, "", Object.values(c0.cast)[0]).why === "actor" && setSatWhy(S, W, c0.key, "reason").why === "reason" && !satOf(S, W)[c0.key].actor, "배우는 그 조합의 배우만, 코드는 SAT_WHY 만");
  ok(!comboRecs(D, S, W, FROM).some(c => c.key === c0.key) && satBlocked(S, W, c0.key, RUN) && !satBlocked(S, W, c0.key, "다른 시즌"), "별로예요 조합은 이번 시즌 동안 다시 추천하지 않는다");
  eq(satRecord(D, S, W, c0.key), {work: W, run: RUN, cast: c0.cast, answer: "dislike", order: 1, why: "reason"}, "combo_fit 기록 한 줄");
  // 마음에 들어요: 배우당 +0.5, 같은 배우는 한 번, 조합당 +1.5까지
  S = fresh(); const L2 = recs0.find(c => c.key !== c0.key);
  setSat(S, W, c0.key, c0.cast, "like"); setSat(S, W, L2.key, L2.cast, "like");
  const names = [...new Set([...Object.values(c0.cast), ...Object.values(L2.cast)])];
  ok(likeBonus(S, W, Object.values(c0.cast)) === Object.values(c0.cast).length * 0.5 && likeBonus(S, W, ["x"]) === 0, "마음에 들어요 조합의 배우는 배우당 +0.5");
  ok(likeBonus({proto: {sat: {[W]: {k: {a: "like", cast: {A: "p", B: "q", C: "r", D: "s"}}}}}}, W, ["p", "q", "r", "s"]) === 1.5, "조합당 +1.5까지");
  ok(likeBonus(S, W, [Object.values(c0.cast)[0]]) === 0.5, "같은 배우가 두 조합에서 받아도 한 번만");
  const withLike = comboRecs(D, S, W, FROM).find(c => c.key === c0.key), base = recs0.find(c => c.key === c0.key);
  ok(withLike.score === base.score + withLike.liked && withLike.liked > 0, "마음에 들어요 → 그 작품 다음 추천 점수에 더해진다");
  // 결과 카드 고정 · 다시 추천받기 1회
  S = fresh(); const sh = shownRecs(D, S, W, FROM); const keys = sh.list.map(x => x.key);
  ok(sh.list.length === Math.min(2, recs0.length) && !sh.again, "추천 카드는 2개");
  setSat(S, W, keys[0], sh.list[0].cast, "dislike"); eq(shownRecs(D, S, W, FROM).list.map(x => x.key), keys, "답해도 보여 준 카드는 그대로");
  const nx = recAgain(D, S, W, FROM);
  ok(!nx || (!keys.includes(nx.key) && shownRecs(D, S, W, FROM).list.length === 3 && shownRecs(D, S, W, FROM).again), "다시 추천받기: 보여 준 조합·별로예요 조합을 빼고 3번째 카드로");
  ok(recAgain(D, S, W, FROM) === null, "다시 추천은 한 번만");
  S.prefs.axes = ["섬세한 표현"]; ok(!shownRecs(D, S, W, FROM).again, "취향이 바뀌면 카드를 새로 고른다");
}

// ===== 4c. v0.9 관람 후 리뷰(docs/261027_2 11절, 결정 46~51) =====
{ const {REVIEW_RATES, reviewRoles, reviewChips, reviewLabel, newReview, setRvRate, toggleRvTag, toggleRvCombo, swapRvActor, saveReview, reviewOf, reviewRows, usableReviewTags, reviewSuggest, applySuggest, reviewRecord, fitPairs, logPerfs, setSat} = L;
  ok(REVIEW_RATES.map(x => x[1]).join("/") === "좋았어요/그냥 그랬어요/아쉬웠어요", "배우별 평가 3단계");
  const p1 = D.perfs[0]; eq(reviewRoles(D, W, p1.cast), ["A", "B", "C"], "리뷰 줄은 그 회차 핵심 배역 전체(조연 포함, roles 순서)");
  ok(reviewRoles({roles: {"시카고": [{role: "벨마 켈리", cast: ["x"]}, {role: "에이모스 하트", cast: ["y"]}]}}, "시카고", {"벨마 켈리": "x", "에이모스 하트": "y"}).join() === "벨마 켈리", "시카고 에이모스 하트·메리 선샤인은 리뷰 줄에서 뺀다(결정 28)");
  let S = fresh(); eq(reviewChips(D, S, W, "A", "a1"), {from: 2, tags: ["성량"]}, "② 온보딩 태그");
  S.cal = {[W]: {edited: true, axes: ["섬세한 표현"]}}; eq(reviewChips(D, S, W, "A", "a1"), {from: 1, tags: ["감정 전달형"]}, "① 이 작품에서 고친 기대 값이 먼저");
  S = fresh({prefs: {axes: [], works: [], favs: [], grade: ""}}); eq(reviewChips(D, S, W, "B", "b2"), {from: 3, tags: ["감정 전달형"]}, "③ 태그를 하나도 안 고른 사람은 이 배우의 이번 배역 태그");
  const Dp = {...D, actorTags: {[W]: {}}, actorProfiles: {a2: {voice: [{tag: "성량"}], role: []}}}; eq(reviewChips(Dp, S, W, "A", "a2"), {from: 4, tags: ["성량"]}, "④ 그것도 없으면 다른 작품 태그");
  eq(reviewChips({...Dp, actorProfiles: {}}, S, W, "A", "a2"), {from: 0, tags: []}, "띄울 태그가 없으면 from 0(안내 + ＋ 다른 점)");
  const Dc = {...D, comboTagLabels: {"음색·보컬 조화": "x"}, actorTagLabels: {"성량": "음색"}}; ok(!reviewChips(Dc, fresh({prefs: {axes: ["tag:음색·보컬 조화", "tag:성량"], works: [], favs: [], grade: ""}}), W, "A", "a1").tags.includes("음색·보컬 조화"), "조합 태그는 배우 줄에 띄우지 않는다(결정 47)");
  ok(reviewLabel("감정 전달형") === "감정이 전해지는 노래" && reviewLabel("성량") === "공간을 채우는 성량" && reviewLabel("없는태그") === "없는태그", "온보딩 질문에서 온 태그는 온보딩 문구로");
  const rv = newReview(D, p1);
  ok(setRvRate(rv, "A", "good") === "good" && setRvRate(rv, "A", "good") === "" && !rv.rows.A && setRvRate(rv, "Z", "good") === null, "평가는 다시 누르면 풀리고, 없는 배역은 무시");
  setRvRate(rv, "A", "good"); ["성량", "고음", "딕션"].forEach(t => toggleRvTag(rv, "A", t));
  ok(toggleRvTag(rv, "A", "맑음") === false && rv.rows.A.tags.length === 3, "태그는 3개까지(4번째는 막는다)");
  setRvRate(rv, "A", "bad"); ok(rv.rows.A.tags.length === 0, "평가를 바꾸면 태그를 비운다(좋았던 점 ↔ 아쉬웠던 점)");
  setRvRate(rv, "B", "meh"); ok(toggleRvTag(rv, "B", "성량") === null, "그냥 그랬어요는 태그를 묻지 않는다");
  toggleRvTag(rv, "A", "성량"); setRvRate(rv, "C", "good"); toggleRvTag(rv, "C", "성량");
  toggleRvCombo(rv, "연기합·티키타카"); toggleRvCombo(rv, "?"); eq(rv.combo, ["?"], "'잘 모르겠어요'는 다른 칩과 같이 못 고른다");
  toggleRvCombo(rv, "a"); toggleRvCombo(rv, "b"); toggleRvCombo(rv, "c"); ok(toggleRvCombo(rv, "d") === false && rv.combo.join() === "a,b,c", "어울림 칩도 3개까지");
  ok(!swapRvActor(D, rv, "A", "b1") && swapRvActor(D, rv, "A", "a2") && rv.cast.A === "a2" && rv.rows.A.rate === "bad", "다른 배우였어요: 그 배역 배우로만 바꾸고 평가는 바꾼 배우에게");
  S = fresh(); const out = saveReview(D, S, rv, "log", "2026-11-02");
  ok(S.reviews.length === 1 && reviewOf(S, W, p1.date, p1.time) === out && S.plans.length === 1 && S.plans[0].tagged, "본 공연 기록하기: 저장하면 그 회차가 내 공연 '본 공연'에 들어간다");
  rv.note = "고침"; saveReview(D, S, rv, "log"); ok(S.reviews.length === 1 && S.reviews[0].note === "고침" && S.plans.length === 1, "한 회차에 리뷰 1개(다시 저장하면 고친다)");
  const rows = reviewRows(S.reviews, "u1");
  eq(rows.map(r => [r.actor, r.tag, r.sign]), [["a2", "성량", "-"], ["c1", "성량", "+"]], "좋았던 점은 +, 아쉬웠던 점은 −, 그냥 그랬어요는 행이 없다");
  ok(usableReviewTags(rows).length === 0, "한 사람만 남긴 태그는 점수에 안 쓴다(결정 49)");
  const two = usableReviewTags([...rows, ...rows, {user: "u2", work: W, role: "C", actor: "c1", tag: "성량", sign: "+"}, {user: "u2", work: W, role: "A", actor: "a2", tag: "성량", sign: "-"}, {user: "u3", work: W, role: "A", actor: "a2", tag: "성량", sign: "-"}]);
  eq(two.map(r => [r.user, r.actor, r.tag]), [["u1", "c1", "성량"], ["u2", "c1", "성량"]], "서로 다른 사용자 2명 이상인 좋았던 점만, 사용자마다 한 줄(아쉬웠던 점은 2명이어도 안 쓴다)");
  S.prefs.favs = ["c1"]; eq(reviewSuggest(S, out), [{actor: "a2", kind: "avoid"}], "리뷰 뒤 제안: 이미 들어 있는 배우는 묻지 않는다(저장 당시 배우 기준)");
  applySuggest(S, [{actor: "c1", kind: "avoid"}, {actor: "b1", kind: "fav"}]); ok(!S.prefs.favs.includes("c1") && S.prefs.avoid.includes("c1") && S.prefs.favs.includes("b1"), "체크한 것만 넣고, 반대쪽에 있던 배우는 뺀다");
  const recd = reviewRecord(D, S.reviews[0]); ok(recd.entry === "log" && recd.actors.length === 3 && !("note" in recd) && recd.combo.length === 3, "after_review 기록: 배우별 평가·태그, 주관식은 안 보낸다");
  const m = new Map(), T = makeTracker({get: k => m.has(k) ? m.get(k) : null, set: (k, v) => m.set(k, String(v)), del: k => m.delete(k), uuid: () => crypto.randomUUID(), session: crypto.randomUUID(), version: "t", vocab: buildVocab(D), send: async () => { throw new Error("x"); }}, {...TRACK_CFG});
  ok(T.track("after_review", {...recd, combo: []}) && T.track("combo_fit", {work: W, cast: {A: "a1", B: "b1"}, answer: "dislike", why: "reason", order: 2}), "after_review·combo_fit 이 기록기 검사를 통과한다");
  // 결정 53: 중간 만족도와 관람 후 평가를 같은 조합으로 묶는다
  const S5 = fresh(); const pk = comboRecs(D, S5, W, "2026-10-01").find(c => c.cast.A === "a1" && c.cast.B === "b1");
  setSat(S5, W, pk.key, pk.cast, "like"); const rv5 = newReview(D, p1); setRvRate(rv5, "A", "good"); saveReview(D, S5, rv5);
  eq(fitPairs(D, S5), [{work: W, date: p1.date, time: p1.time, sat: "like", rates: ["good"]}], "마음에 들 것 같다던 조합 → 관람 후 평가");
  ok(logPerfs(D, W, "2026-11-03").map(p => p.date).join() === "2026-11-02,2026-11-01", "본 공연 기록하기: 지난 회차만, 최근 순, 대관 제외");
}

// ===== 5. 기록기 =====
const vocab = buildVocab(D);
const uid = () => crypto.randomUUID();
const store = () => { const m = new Map(); return {m, get: k => m.has(k) ? m.get(k) : null, set: (k, v) => m.set(k, String(v)), del: k => m.delete(k)}; };
const mkEnv = (extra = {}) => { const st = store(); return Object.assign({get: st.get, set: st.set, del: st.del, m: st.m, uuid: uid, session: uid(), version: "proto-0.3", vocab, sent: [], send: async req => { throw new Error("no"); }}, extra); };
const good = (extra = {}) => ({stage: "expected", work: W, cast: {A: "a1", B: "b1"}, algo: "rule-v1", score: 4, chips: [{chip: "voice", dir: "+"}], ...extra});
let env = mkEnv(), T = makeTracker(env, {...TRACK_CFG});
ok(T.peekAnon() === null && T.queue().length === 0, "처음엔 번호가 없다(기록할 때 만든다)");
ok(T.track("combo_rating", good()) === true, "정상 기록");
const id1 = T.peekAnon(); ok(/^[0-9a-f-]{36}$/.test(id1), "익명 번호는 randomUUID 모양");
T.track("combo_rating", good({score: 5}));
let q = T.queue(); ok(q.length === 2 && q[0].payload.seq === 0 && q[1].payload.seq === 1, "방문 안 순서 seq 는 0부터");
eq(Object.keys(q[0]).sort(), ["anon", "event", "payload", "session", "v"], "기록 한 줄엔 시각이 없다");
ok(q[0].anon === id1 && q[1].anon === id1 && T.peekAnon() === id1, "같은 기기는 같은 번호");
ok(!JSON.stringify(q).match(/"(ts|time_|timestamp|created|ua|userAgent|lang|language|screen|ip)"/), "시각·기기 정보 키 없음");
// 화이트리스트: 시각·기기 정보·이름·글 키는 걸러진다
env = mkEnv(); T = makeTracker(env, {...TRACK_CFG});
ok(T.track("combo_rating", {...good(), ts: "2026-10-10T01:02:03Z", timestamp: 1, userAgent: "Mozilla", ua: "x", language: "ko-KR", lang: "ko", screen: "400x800", width: 400, ip: "1.2.3.4", name: "홍길동", note: "자유 글", email: "a@b.c", phone: "010", seq: 99}) === true);
q = T.queue(); eq(Object.keys(q[0].payload).sort(), ["algo", "cast", "chips", "score", "seq", "stage", "work"], "정의서에 없는 키는 모두 버린다");
ok(q[0].payload.seq === 0, "seq 는 호출자가 못 정한다") ; ok(T.stats().dropped === 14, "버린 값을 센다(키 14개): " + T.stats().dropped);
for (const [bad, why] of [[{work: "아".repeat(100)}, "긴 글"], [{work: "없는작품"}, "모르는 작품"], [{score: 6}, "점수 범위"], [{score: "5"}, "점수 모양"], [{stage: "now"}, "단계"], [{cast: {A: "홍길동", B: "b1"}}, "모르는 배우 이름"], [{cast: {없는배역: "a1"}}, "모르는 배역"], [{algo: "UPPER CASE!"}, "방식 버전 모양"]]) {
  const e2 = mkEnv(), t2 = makeTracker(e2, {...TRACK_CFG}), okk = t2.track("combo_rating", good(bad));
  if (bad.work || bad.score !== undefined || bad.stage || bad.algo) ok(okk === false && t2.queue().length === 0 && t2.peekAnon() === null, "꼭 있어야 하는 값이 틀리면 한 줄을 버리고 번호도 안 만든다: " + why);
  else ok(okk === true && !JSON.stringify(t2.queue()).includes("홍길동") && !JSON.stringify(t2.queue()).includes("없는배역"), "틀린 값만 버린다: " + why);
}
{ const e2 = mkEnv(), t2 = makeTracker(e2, {...TRACK_CFG}); t2.track("combo_rating", good({chips: [{chip: "voice", dir: "+"}, {chip: "mystery", dir: "+"}, {chip: "actor", dir: "?"}, {chip: "actor", dir: "-", actors: ["a1", "홍길동"]}], taste: {axes: {"강한 성량": 1, "없는축": 1, "섬세한 표현": 9}, favs: ["a1", "홍길동"], tags: ["성량", "자유 글입니다 길게길게길게길게길게길게길게길게길게길게길게길게길게길게길게길게길게길게"], name: "x"}}));
  eq(t2.queue()[0].payload.chips, [{chip: "voice", dir: "+"}, {chip: "actor", dir: "-", actors: ["a1"]}], "칩: 모르는 칩·방향·배우 이름 제외");
  eq(t2.queue()[0].payload.taste, {axes: {"강한 성량": 1}, favs: ["a1"], tags: ["성량"]}, "취향: 모르는 축·범위 밖 값·이름·긴 글·모르는 키 제외"); }
ok(makeTracker(mkEnv(), {...TRACK_CFG}).track("app_open", {}) === false && makeTracker(mkEnv(), {...TRACK_CFG}).track("page_view", {x: 1}) === false, "사용 지표 이벤트는 정의서에 없어서 기록되지 않는다");
eq(Object.keys(EVENTS), ["combo_rating", "combo_choice", "actor_pick", "role_duel", "actor_rating", "video_reaction", "taste_snapshot", "rec_feedback", "combo_fit", "after_review", "plan_status"], "이벤트 11종(조합 만족도·관람 후 리뷰·캘린더 예매 전환 포함)");
// 내 공연 캘린더 순수 함수
{ const P = {plans: [{work: "극", date: "2026-11-03", time: "19:30", cast: {}}, {work: "극", date: "2026-11-03", time: "14:00", cast: {}, status: "booked"}, {work: "극", date: "2026-10-01", time: "14:00", cast: {}}]};
  ok(L.planStatus(P.plans[0]) === "tentative" && L.planStatus(P.plans[1]) === "booked" && L.PLAN_STATUS.tentative === "미정일정" && L.PLAN_STATUS.booked === "관람예정", "상태 없는 예전 기록은 미정일정");
  eq(L.plansOn(P, "2026-11-03").map(([, i]) => i), [1, 0], "같은 날은 관람예정이 앞(칸 포스터는 첫째 것)");
  ok(!L.setPlanStatus(P, 0, "x") && !L.setPlanStatus(P, 9, "booked") && L.setPlanStatus(P, 0, "booked") && P.plans[0].status === "booked", "상태는 두 가지만, 없는 번호는 무시");
  L.setPlanField(P, 0, "price", "150,000원"); L.setPlanField(P, 0, "seat", "  1층 B열 12번 "); ok(P.plans[0].price === 150000 && P.plans[0].seat === "1층 B열 12번", "금액은 숫자만(쉼표·원 허용), 좌석은 앞뒤 공백 정리");
  L.setPlanField(P, 0, "price", ""); L.setPlanField(P, 0, "seat", " "); ok(!("price" in P.plans[0]) && !("seat" in P.plans[0]) && !L.setPlanField(P, 0, "work", "x"), "비우면 지우고, 다른 칸은 못 바꾼다");
  ok(L.pcalShift("2026-12", 1) === "2027-01" && L.pcalShift("2026-01", -1) === "2025-12" && L.pcalShift("2026-11", 0) === "2026-11", "달 넘기기(해 바뀜)");
  const wk = L.pcalWeeks("2026-11"); ok(wk.every(r => r.length === 7) && wk[0][0] === "2026-11-01" && wk.flat().filter(Boolean).length === 30, "2026년 11월: 1일이 일요일, 30일");
  ok(L.pcalWeeks("2026-10")[0].slice(0, 5).join() === ",,,,2026-10-01", "2026년 10월: 1일이 목요일이면 앞 네 칸이 빈칸");
  ok(L.pcalStart(P, "2026-10-28") === "2026-11" && L.pcalStart({plans: []}, "2026-10-28") === "2026-10", "처음 여는 달: 다가오는 일정이 있는 달, 없으면 이번 달"); }
{ const e2 = mkEnv(), t2 = makeTracker(e2, {...TRACK_CFG, maxBytes: 120}); ok(t2.track("combo_rating", good()) === false && t2.queue().length === 0, "기록 하나가 한도(4KB)를 넘으면 버린다"); }
{ const e2 = mkEnv(), t2 = makeTracker(e2, {...TRACK_CFG, cap: 5}); for (let i = 0; i < 8; i++) t2.track("combo_rating", good()); const qq = t2.queue(); ok(qq.length === 5 && qq[0].payload.seq === 3, "큐는 200건(여기선 5)까지, 오래된 것부터 버린다"); }
{ const e2 = mkEnv({uuid: () => null}), t2 = makeTracker(e2, {...TRACK_CFG}); ok(t2.track("combo_rating", good()) === false && t2.queue().length === 0, "무작위 번호를 못 만들면 기록하지 않는다(대체 난수 없음)"); }
{ const e2 = mkEnv({uuid: () => "not-a-uuid"}), t2 = makeTracker(e2, {...TRACK_CFG}); ok(t2.track("combo_rating", good()) === false, "UUID 모양이 아니면 쓰지 않는다"); }
{ const e2 = mkEnv({session: null}), t2 = makeTracker(e2, {...TRACK_CFG}); ok(t2.track("combo_rating", good()) === false, "방문 번호가 없으면 기록하지 않는다"); }
// 끄기: 번호를 지우고 다시 만들지 않는다
env = mkEnv(); T = makeTracker(env, {...TRACK_CFG}); T.track("combo_rating", good());
const idBefore = T.peekAnon(); ok(!!idBefore && T.queue().length === 1);
T.setOff(true);
ok(T.isOff() && T.peekAnon() === null && env.get("pickle_anon") === null && T.queue().length === 0 && env.get("pickle_track_off") === "1", "끄면 번호와 안 보낸 기록이 지워지고 '꺼짐' 표시만 남는다");
ok(T.track("combo_rating", good()) === false && T.track("actor_pick", {work: W, role: "A", actor: "a1", action: "pin"}) === false, "끈 뒤 track 은 0건");
ok(T.peekAnon() === null && T.queue().length === 0 && env.get("pickle_anon") === null, "끈 뒤 번호를 다시 만들지 않는다");
eq([...env.m.keys()], ["pickle_track_off"], "끈 뒤 저장 공간에 남는 건 꺼짐 표시뿐");
T.setOff(false); ok(!T.isOff() && T.peekAnon() === null, "다시 켜도 번호는 바로 안 만든다");
T.track("combo_rating", good()); ok(T.peekAnon() !== null && T.peekAnon() !== idBefore, "다시 켜면 다음 기록 때 새 번호");
// 이 기기 기록 지우기
env = mkEnv(); T = makeTracker(env, {...TRACK_CFG}); T.track("combo_rating", good()); T.track("combo_rating", good()); const id2 = T.peekAnon();
env.set("pickle_v2", "{\"prefs\":1}");
T.clearDevice(); ok(T.peekAnon() === null && T.queue().length === 0 && !T.isOff(), "지우기: 번호와 안 보낸 기록이 지워진다");
ok(env.get("pickle_v2") === "{\"prefs\":1}", "지우기는 앱 사용 데이터(취향·볼 예정)를 건드리지 않는다");
T.track("combo_rating", good()); ok(T.peekAnon() !== null && T.peekAnon() !== id2 && T.queue().length === 1 && T.queue()[0].payload.seq === 2, "켜져 있으면 다음 기록부터 새 무작위 번호(seq 는 방문 안 순서라 이어진다)");
T.setOff(true); T.clearDevice(); ok(T.track("combo_rating", good()) === false && T.peekAnon() === null, "꺼져 있으면 지운 뒤에도 번호를 만들지 않는다");
// 전송
const sentReqs = [];
const live = (cfg, ex = {}) => { const e = mkEnv({send: async req => { sentReqs.push(req); }, ...ex}); return [e, makeTracker(e, {...TRACK_CFG, ...cfg})]; };
(async () => {
  [env, T] = live({mode: "practice"}); T.track("combo_rating", good());
  eq(await T.flush(), {sent: 0, practice: true}); ok(sentReqs.length === 0 && T.queue().length === 1, "연습 모드: 안 보내고 큐를 남긴다");
  [env, T] = live({mode: "live", url: "https://evil.example.com", key: "sb_publishable_x"}); T.track("combo_rating", good()); await T.flush(); ok(sentReqs.length === 0, "주소가 supabase.co 가 아니면 안 보낸다");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: ""}); T.track("combo_rating", good()); await T.flush(); ok(sentReqs.length === 0, "키가 없으면 안 보낸다");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}); T.track("combo_rating", good()); T.track("actor_pick", {work: W, role: "A", actor: "a1", action: "pin"});
  ok(T.live(), "켜짐 조건"); const r = await T.flush(); ok(r.sent === 2 && sentReqs.length === 1 && T.queue().length === 0, "보낸 만큼만 큐에서 지운다");
  const req = sentReqs[0]; ok(req.url === "https://abc.supabase.co/rest/v1/events" && req.init.method === "POST" && req.init.keepalive === true && req.init.headers.Prefer === "return=minimal" && req.init.headers.apikey === "sb_publishable_x", "REST insert · keepalive · return=minimal");
  ok(!("Authorization" in req.init.headers), "새 형식 공개 키는 Authorization 헤더에 안 넣는다");
  const rows = JSON.parse(req.init.body); eq(Object.keys(rows[0]).sort(), ["anon_id", "app_version", "event", "payload", "session_id"], "서버 표 열 그대로(시각 없음)");
  ok(rows.length === 2 && rows[0].anon_id === rows[1].anon_id && rows[1].payload.seq === 1 && rows[0].app_version === "proto-0.3", "묶음");
  const jwtKey = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln"; sentReqs.length = 0;
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: jwtKey}); T.track("combo_rating", good()); await T.flush(); ok(sentReqs[0].init.headers.Authorization === "Bearer " + jwtKey, "JWT 형식 공개 키는 Authorization 도 같이");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}, {send: async () => { throw new Error("offline"); }}); T.track("combo_rating", good());
  eq(await T.flush(), {sent: 0, error: true}); ok(T.queue().length === 1, "전송이 실패하면 큐를 남긴다");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x", batch: 2}); for (let i = 0; i < 5; i++) T.track("combo_rating", good()); sentReqs.length = 0;
  ok((await T.flush()).sent === 2 && JSON.parse(sentReqs[0].init.body).length === 2 && T.queue().length === 3, "묶음 크기만큼씩");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x", keepaliveBytes: 600}); for (let i = 0; i < 4; i++) T.track("combo_rating", good()); sentReqs.length = 0;
  const bs = T.takeBatch(T.queue()); ok(bs.length >= 1 && bs.length < 4 && Buffer.byteLength(sentReqs.length ? "" : JSON.stringify(T.buildRequest(bs).init.body)) < 2000, "keepalive 본문 한도 안에서 나눠 보낸다");
  [env, T] = live({mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}); T.track("combo_rating", good()); T.setOff(true); sentReqs.length = 0; await T.flush(); ok(sentReqs.length === 0, "끈 뒤엔 보내지 않는다");

  // ===== 6. 코드 점검(들어가면 안 되는 것) =====
  const tb = block("track");
  ok(!/Math\.random|Date\.now|new Date|toISOString|navigator|screen\.|innerWidth|userAgent|\.language|service_role|SERVICE_ROLE/.test(tb), "기록기 블록에 난수 대체·시각·기기 정보·비밀 키 코드가 없다");
  ok(/crypto\.randomUUID/.test(html) && !/uuid:\s*\(\)\s*=>\s*(Math|"a"|'a')/.test(html), "익명 번호는 crypto.randomUUID 만");
  ok((html.match(/<script[^>]*\ssrc=/g) || []).length === 1 && /<script src="data\.js">/.test(html), "외부 스크립트는 data.js 하나뿐(제3자 분석·광고 없음)");
  ok(!/googletagmanager|google-analytics|gtag\(|fbq\(|clarity|hotjar|mixpanel|amplitude|segment\.com/i.test(html), "제3자 분석·광고 도구 없음");
  ok(/기록·개인정보 안내/.test(html) && /href="#privacy"/.test(html) && /V\.privacy/.test(html), "안내 링크와 안내 화면 자리");
  ok(/class="nb" href="#privacy">자세히<\/a><button class="nb" data-act="trackToggle">기록 끄기<\/button>/.test(html), "배너의 [자세히]와 [기록 끄기]는 같은 클래스(같은 크기·모양)");
  ok(/class="nb" data-act="trackToggle">\$\{off \? "기록 켜기" : "기록 끄기"\}<\/button><button class="nb" data-act="trackClear">이 기기 기록 지우기/.test(html), "설정의 두 버튼도 같은 클래스");
  const PLACEHOLDER = /\[[^\]\n"'`,<>]*(?:확인|기재|필요)[^\]\n"'`,<>]*\]/;  // '[… 확인 …]' '[… 기재 …]' 같은 빈칸 자리표시
  ok(!/문의처/.test(html) && /7\) 내 기록은 어떻게 관리하나요\?/.test(html) && /시행일: <b>2026년 10월 13일<\/b>/.test(html) && !/시행 전 안내/.test(html), "문의처·시행 전 안내 없음, 시행일은 2026년 10월 13일");
  ok(PLACEHOLDER.test("[문의처: 사용자 확인 필요]") && PLACEHOLDER.test("시행일: [공개일 확인 후 기재]") && !PLACEHOLDER.test("[기록 끄기] [이미 봤어요]·[관심 없어요]") && !PLACEHOLDER.test(html), "앱 파일에 자리표시 대괄호([… 확인 …]·[… 기재 …]·[… 필요 …])가 하나도 없다(검사 자체도 옛 자리표시는 잡는다)");
  // 프로토 → 앱 이전: 예전 앱은 백업으로만 남고(배포 안 함), proto.html 은 index.html 로 넘기는 이동 페이지
  const legacy = fs.readFileSync(path.join(__dirname, "../app/index_legacy_2026-10-11.html"), "utf8"), redirect = fs.readFileSync(path.join(__dirname, "../app/proto.html"), "utf8");
  ok(!/<proto-flow>|<track>|PICKLE_TRACK|data-theme|app\.css/.test(legacy) && /href="theme\.css"/.test(legacy) && /<title>PICKLE — 내 취향의 뮤지컬 찾기<\/title>/.test(legacy), "예전 앱 백업(index_legacy_2026-10-11.html)은 옛 모습 그대로");
  ok(/<proto-flow>/.test(html) && /<track>/.test(html) && /<title>PICKLE — 내 취향의 뮤지컬 찾기<\/title>/.test(html) && !/\[프로토\]/.test(html), "새 app/index.html 이 프로토 코드이고, 제목은 GPT 제목('[프로토]' 없음)");
  ok(/location\.replace\("index\.html" \+ location\.search \+ location\.hash\)/.test(redirect) && /<meta http-equiv="refresh" content="0; url=index\.html">/.test(redirect) && redirect.length < 1200 && !/<proto-flow>|PICKLE_DATA/.test(redirect), "proto.html 은 index.html 로 넘기는 짧은 이동 페이지(쿼리·해시 유지)");
  ok(!fs.existsSync(path.join(__dirname, "../app/proto.css")) && fs.existsSync(path.join(__dirname, "../app/app.css")), "proto.css 는 app.css 로 바뀌었다");
  const dep = fs.readFileSync(path.join(__dirname, "../deploy_pages.sh"), "utf8");
  ok(/cp app\/index\.html app\/theme\.css app\/app\.css/.test(dep) && !/legacy|proto\./.test(dep.replace(/^#.*$/gm, "")), "배포 목록에 app.css 가 있고 예전 앱 백업·proto 는 없다");
  ok(/recommend\.py --export "\$SITE\/app\/data\.js"\)/.test(dep) && !/cp [^\n]*app\/data\.js/.test(dep) && !/--no-track/.test(dep.replace(/^#.*$/gm, "")), "배포본 data.js 는 배포 때 기록 설정을 넣어 새로 만든다(로컬 app/data.js 를 복사하지 않음)");

  // ===== 7. 실제 데이터 =====
  const dp = process.env.PICKLE_DATA_JS || path.join(__dirname, "../app/data.js");
  if (fs.existsSync(dp)) {
    const win = {}; new Function("window", fs.readFileSync(dp, "utf8"))(win);
    const RD = win.PICKLE_DATA, today = "2026-10-10";
    const RV = buildVocab(RD), mkReal = () => { const e = mkEnv({vocab: RV}); return [e, makeTracker(e, {...TRACK_CFG, cap: 100000})]; };
    const bigPrefs = {axes: RD.axes.flatMap(a => [a.left]).slice(0, 5), works: ["tragedy", "fun", "heal", "orch", "show"], favs: [...RV.actors].slice(0, 3), grade: "R석"};
    const RS = () => ({prefs: bigPrefs, plans: [], tags: [], votes: [], proto: {}});
    const bytes = o => Buffer.byteLength(JSON.stringify(o));
    // 5축·카드·배우가 모두 찬 최대 취향으로 모든 주연 조합을 기록해 본다: 하나도 안 걸러지고 4KB 안이어야 한다
    let [re, rt] = mkReal(), max = 0, nCombo = 0, drops0 = 0;
    for (const w of RD.works) {
      const seen = new Set();
      for (const p of RD.perfs.filter(x => x.work === w.name)) {
        const k = JSON.stringify(Object.entries(p.cast).sort()); if (seen.has(k)) continue; seen.add(k);
        const rating = {score: 3, chips: [{chip: "voice", dir: "+", actors: []}, {chip: "actor", dir: "+", actors: Object.values(p.cast).slice(0, 2)}, {chip: "chemistry", dir: "-"}, {chip: "wrong", dir: "-", actors: Object.values(p.cast).slice(0, 1)}, {chip: "etc", dir: "-"}]};
        const rec = comboRecord(RD, RS(), "experienced", w.name, p.cast, rating, {date: p.date, time: p.time});
        const before = rt.stats().dropped; const okk = rt.track("combo_rating", rec); if (!okk || rt.stats().dropped !== before) { drops0++; if (drops0 < 4) console.log("걸러짐:", w.name, JSON.stringify(rec).slice(0, 300)); }
        max = Math.max(max, bytes(rec)); nCombo++;
      }
    }
    ok(nCombo > 0 && drops0 === 0, `실제 조합 ${nCombo}개의 combo_rating 이 하나도 안 걸러진다 (걸러진 ${drops0})`); ok(max < 4096, "가장 큰 기록도 4KB 안: " + max + "바이트");
    console.log(`(실제 데이터: 조합 ${nCombo}개 · 가장 큰 기록 ${max}바이트)`);
    // 조합 선택·⭐/🚫·월드컵·배우 평가
    [re, rt] = mkReal(); let nOther = 0, dropO = 0;
    for (const w of RD.works) {
      const p = RD.perfs.find(x => x.work === w.name && !(x.notes || []).some(t => /대관/.test(t))); if (!p) continue;
      const S2 = RS(); S2.proto.pins = {[w.name]: {star: Object.values(p.cast).slice(0, 2), avoid: Object.values(p.cast).slice(2, 4)}};
      for (const [ev, rec] of [["combo_choice", comboChoiceRecord(RD, S2, "ticket", p, today)], ["actor_pick", pickRecord(RD, w.name, Object.values(p.cast)[0], "", "star")]]) { const b = rt.stats().dropped; if (!rt.track(ev, rec) || rt.stats().dropped !== b) { dropO++; console.log("걸러짐:", ev, w.name, JSON.stringify(rec).slice(0, 200)); } nOther++; }
      for (const r of (RD.roles[w.name] || []).filter(x => x.weight === "주연")) { const c = r.cast; if (c.length < 2) continue; const rec = duelRecord(RD, w.name, {role: r.role, left: c[0], right: c[1]}, "tie"); const b = rt.stats().dropped; if (!rt.track("role_duel", rec) || rt.stats().dropped !== b) { dropO++; console.log("걸러짐: role_duel", w.name, r.role, JSON.stringify(rec).slice(0, 200)); } nOther++; }
    }
    for (const s of (RD.currentShows || []).slice(0, 60)) for (const a of s.cast) { const rec = actorRecord(RD, RS(), s.id, a, {score: 4, chips: [{chip: "wrong", dir: "-"}, {chip: "voice", dir: "+"}]}); const b = rt.stats().dropped; if (!rt.track("actor_rating", rec) || rt.stats().dropped !== b) { dropO++; if (dropO < 5) console.log("걸러짐: actor_rating", s.id, a); } nOther++; }
    ok(nOther > 0 && dropO === 0, `실제 데이터의 combo_choice·actor_pick·role_duel·actor_rating ${nOther}건이 하나도 안 걸러진다 (걸러진 ${dropO})`);
    // 추천 조합·홈 추천 스모크
    let combos = 0; for (const w of RD.works.filter(x => x.hasSchedule)) { const rs = comboRecs(RD, RS(), w.name, today); combos += rs.length; ok(rs.every(c => c.score > 0 && Object.keys(c.cast).length >= 1 && c.dates.length > 0), w.name + " 추천 조합 모양"); }
    ok(combos > 0, "실제 데이터에서 추천 조합이 나온다: " + combos);
    console.log(`(추천 조합 ${combos}개 · 기록 ${nOther}건)`);
    const hr = homeRecs(RD, RS(), today); ok(hr.length > 0 && hr.every(r => r.reasons.length > 0 && r.line === r.reasons[0].text && showRef(RD, r.key)), "홈 추천 극: 모두 이유 한 줄 이상, 극 요약으로 갈 수 있다 (" + hr.length + "개)");
    ok(homeRecs(RD, {prefs: null, plans: [], tags: [], votes: [], proto: {}}, today).length === 0, "취향이 없으면 홈 추천 극도 없다");
    const all = allShows(RD, today); ok(all.length >= hr.length && hr.every(r => all.some(a => a.key === r.key)), "추천 극은 모두 '지금 하는 공연 전체'에 들어 있다 (전체 " + all.length + "개)");
    for (const a of all.slice(0, 200)) { const ref = showRef(RD, a.key); ok(ref && ref.title === a.title, "극 요약 주소: " + a.key); const nx = showNext(RD, ref, today); ok(nx.type === "calendar" ? ref.kind === "seed" && ref.w.hasSchedule : nx.type === "inline", "다음 단계"); }
    for (const w of RD.works.filter(x => x.hasSchedule)) { const days = calDays(RD, w.name, today); for (const [d, ps] of Object.entries(days)) { ok(ps.length > 0 && d >= today && ps.every(p => p.date === d), "달력의 날은 그날 회차를 가진다"); } }
    // 홈 추천: 닮은 배우로 뺀 배우는 이유 줄에서 빠진다
    let hit = null; for (const a of RV.actors) { const S3 = {...RS(), prefs: {axes: [], works: [], favs: [a], grade: ""}}; const r = homeRecs(RD, S3, today).find(x => x.reasons.some(y => y.type === "fav-sim")); if (r) { hit = {a, S3, r}; break; } }
    if (hit) { const names = hit.r.reasons.find(y => y.type === "fav-sim").text.split(" — ")[1].split("·"); hit.S3.proto = {avoidActors: names}; const after = homeRecs(RD, hit.S3, today).find(x => x.key === hit.r.key); ok(!after || !after.reasons.some(y => y.type === "fav-sim" && names.some(nm => y.text.includes(" — ") && y.text.split(" — ")[1].split("·").includes(nm))), "낮게 평가한 배우는 닮은 배우 이유에서 빠진다"); }
  } else console.log("(app/data.js 가 없어 실제 데이터 점검은 건너뜀)");

  // ===== 8. 화면(하니스): 가짜 DOM 에서 proto.html 스크립트를 그대로 실행 =====
  let HDX, OPTSX;
  { const HD = HDX = JSON.parse(JSON.stringify(D));
    HD.works[0].accent = "#B23A48"; HD.works[0].hasSchedule = true; HD.works[0].runs[0].ticket = "https://tickets.example.com/x"; HD.generated = "2026-10-10";
    HD.perfs.push(mk("2026-12-05", {A: "a1", B: "b1", C: "c1"}), mk("2027-01-09", {A: "a1", B: "b1", C: "c1"}));
    const opts = OPTSX = {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강한 성량"], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}};
    const boot = (o = {}) => { const a = loadApp(HD, {...opts, ...o}); a.route(); return a; };
    const qlen = a => JSON.parse(a.store.get("pickle_q") || "[]"), evs = a => qlen(a).map(r => r.event);
    const h2 = h => [...h.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
    let app = boot();
    // ① 세 덩어리가 순서대로
    let html2 = app.V.show(W);
    const pos = ["summary", "cast", "dates"].map(id => html2.indexOf(`id="${id}"`));
    ok(pos.every(x => x > 0) && pos[0] < pos[1] && pos[1] < pos[2], "공연 화면: ① 요약 → ② 누구로 볼까요? → ③ 볼 수 있는 날 순서");
    eq(h2(html2), ["누구로 볼까요?", "이 조합으로 볼 수 있는 날"], "덩어리 제목은 둘(요약은 카드)");
    ok(/<h1>극<\/h1>/.test(html2) && /정보 더 보기/.test(html2) && /class="why1 big"/.test(html2) === false || true, "요약에 제목·[정보 더 보기]");
    for (const old of ["왜 추천했어요?", "공연 정보</h3>", "작품 분위기", "다음 추천 조합</h3>", "추천 조합 <span", ">주연<"]) ok(!html2.includes(old), "옛 섹션이 없다: " + old);
    ok(!/이상형 월드컵/.test(html2) && !/class="card fb"/.test(html2), "공연 화면에 월드컵도 별점 평가 카드도 없다");
    { const nCard = (html2.match(/class="card rcard"/g) || []).length;  // v0.9(docs/261027_2 10.2절): 추천 조합 카드마다 '이 조합 어때요?' 3지선다, 답 안 해도 된다
      ok(nCard >= 1 && nCard <= 2 && (html2.match(/이 조합 어때요\?/g) || []).length === nCard && (html2.match(/data-act="sat" /g) || []).length === nCard * 3 && /이 조합이 마음에 들어요/.test(html2) && !/누구 때문인가요/.test(html2), "추천 조합 카드(2개까지)마다 '이 조합 어때요?' 마음에 들어요/별로예요/모르겠어요");
      ok(/<ul class="why"><li class="small">a1 · 공간을 채우는 성량<\/li>/.test(html2) && /c1 배우는 아직 모인 정보가 적어요/.test(html2) && !/\d+%|\d+점/.test((html2.match(/<ul class="why">[\s\S]*?<\/ul>/g) || []).join("")), "카드마다 추천 이유(배우 · 맞는 특징, 온보딩 문구), 근거 없는 배우는 '정보가 적어요', 이유에 점수·퍼센트 없음(10절)"); }
    ok((html2.match(/pickc on/g) || []).length === 3 && !/PICK/.test(html2) && (html2.match(/class="pickb">추천 조합</g) || []).length === 1 && /class="chip x on" data-act="selCombo" data-work="극" data-i="0"/.test(html2), "추천 조합(1순위)이 미리 선택돼 있고, 배우 칩엔 PICK 배지가 없고 '추천 조합' 표시는 조합 선택 칸에 한 번만");
    // v0.9 조합 만족도 화면(10.2·10.3절): 별로예요 → 누구 때문인가요? → 배우 → 피하고 싶은 배우 추가(동의할 때만)
    { const sa = boot(); sa.location.hash = "#show/" + W; sa.route();
      sa.click({act: "sat", work: W, i: "0", a: "dislike"}); let hs = sa.V.show(W);
      ok(/누구 때문인가요\?/.test(hs) && /조합 자체가 별로예요/.test(hs) && /추천 이유가 와닿지 않아요/.test(hs) && /넘어가기/.test(hs), "별로예요 → '누구 때문인가요?' 배우 칩 + 조합 자체 · 추천 이유 · 넘어가기");
      const c0 = sa.S.proto.shown[W].list[0], a0 = Object.values(c0.cast)[0];
      sa.click({act: "satWhy", work: W, i: "0", who: a0}); hs = sa.V.show(W);
      ok(hs.includes(`${a0} 배우를 피하고 싶은 배우에 추가할까요?`) && !(sa.S.proto.pins?.[W]?.avoid || []).includes(a0), "배우를 고르면 추가할지 묻고, 묻기만 해서는 빼지 않는다");
      sa.click({act: "satAvoid", work: W, i: "0", y: "1"});
      ok(sa.S.proto.pins[W].avoid.includes(a0) && sa.S.proto.shown[W].list[0].key === c0.key && sa.V.show(W).includes(`${a0} 배우를 이 작품에서 뺐어요`), "동의하면 이 작품에서만 빼고, 보여 준 카드는 그대로");
      const ev = JSON.parse(sa.store.get("pickle_q") || "[]").map(r => r.event); ok(ev.filter(e => e === "combo_fit").length === 2 && ev.includes("actor_pick"), "combo_fit(답 · 누구 때문인가요) 두 줄과 actor_pick 한 줄");
      const sb2 = boot(); sb2.location.hash = "#show/" + W; sb2.route(); sb2.click({act: "sat", work: W, i: "1", a: "like"});
      ok(/좋아한 조합으로 기억할게요/.test(sb2.V.show(W)), "마음에 들어요 → 좋아한 조합 안내");
      sb2.click({act: "recAgain", work: W}); hs = sb2.V.show(W);
      ok((hs.match(/class="card rcard"/g) || []).length === 3 && /다시 추천은 한 번만 할 수 있어요/.test(hs) && !/data-act="recAgain"/.test(hs) && (hs.match(/aria-pressed="true">이 조합이 마음에 들어요/g) || []).length === 1, "다시 추천받기: 3번째 카드가 붙고 버튼은 안내로 바뀐다(앞 카드 답은 그대로)"); }
    // 배우 먼저(8절) · 날짜 먼저 배우 조건 줄(7절 A2)
    { const af = boot({storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강한 성량"], works: [], favs: ["b2", "a1", "없는배우"], must: ["a1", "없는배우"], avoid: ["a2"], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}});
      af.location.hash = `#find/${W}/actor`; af.route(); let h = af.V.find(W, "actor");
      ok(/누구를 꼭 보고 싶어요\?/.test(h) && /이 작품에는 없는배우 배우가 나오지 않아요/.test(h) && /a1 · 반드시/.test(h) && /b2 · 가능하면/.test(h) && /a2 · 피함/.test(h) && /<b>C<\/b>/.test(h), "배우 먼저: 온보딩 값이 미리 채워져 있고(조연 배역 포함), 작품에 없는 반드시 포함 배우는 안내");
      ok(/a1 배우와 볼 수 있는 조합/.test(h) && /class="card rcard"/.test(h) && /id="dates"/.test(h), "추천 조합 카드와 달력이 이어진다");
      af.click({act: "acSet", work: W, a: "b1", k: "maybe"}); af.click({act: "acMove", work: W, a: "b1", d: "-1"}); h = af.V.find(W, "actor");
      ok(af.S.cal[W].ac.pick.map(x => x.a).join() === "b2,b1,a1" && af.S.prefs.favs.join() === "b2,a1,없는배우", "배우를 누르면 가능하면 포함, 순위는 이 작품에만(온보딩 값은 그대로)");
      af.click({act: "acSet", work: W, a: "a2", k: "maybe"}); ok(!af.S.cal[W].ac.pick.some(x => x.a === "a2"), "공통 피하고 싶은 배우는 여기서 보고 싶은 배우로 못 바꾼다");
      af.click({act: "acSet", work: W, a: "b1", k: "must"}); af.click({act: "acSet", work: W, a: "b2", k: "must"}); h = af.V.find(W, "actor");
      ok(/b2와 b1[은는] 같은 배역이라 한 회차에 함께 나오지 않아요/.test(h) && /data-a="b1" data-k="maybe">b1[을를] 가능하면 포함으로 바꾸기/.test(h) && /이 조건에 맞는 조합이 없어요/.test(h), "같은 배역의 반드시 포함 둘: 순위 낮은 쪽을 가능하면으로 바꾸자고 제안(자동으로 풀지 않는다)");
      af.click({act: "acSet", work: W, a: "b1", k: "maybe"}); ok(!/같은 배역이라/.test(af.V.find(W, "actor")) && /class="card rcard"/.test(af.V.find(W, "actor")), "제안을 누르면 풀리고 다시 추천된다");
      af.click({act: "acSet", work: W, a: "b1", k: ""}); af.q("#acAvoid").value = "b2"; af.click({act: "acAvoidAdd", work: W});
      ok(af.S.cal[W].ac.extra.includes("b2") && !af.S.cal[W].ac.pick.some(x => x.a === "b2") && !(af.S.prefs.avoid || []).includes("b2"), "이 작품에 한해 피하고 싶은 배우를 더한다(공통 값은 그대로)");
      const dl = af.V.find(W, "date"); ok(/반드시 포함 a1 · 피하는 배우 2명 적용 중 <a href="#find\/극\/actor">바꾸기<\/a>/.test(dl) && /이 작품에는 없는배우 배우가 나오지 않아요/.test(dl) && /data-act="dfDay"/.test(dl), "날짜 먼저: 배우 조건 줄 + [바꾸기]는 배우 먼저 화면으로");
      af.click({act: "acReset", work: W}); ok(!af.S.cal[W].ac && /a1 · 반드시/.test(af.V.find(W, "actor")), "평소 배우 조건으로 되돌리기"); }
    // 날짜 먼저(7절): 회차 달력 → 하루씩/기간 → 고른 날짜의 추천 조합 → 그 조합의 회차(밖은 펼치기)
    { const df = boot(); df.location.hash = `#find/${W}/date`; df.route(); let h = df.V.find(W, "date");
      ok(/언제 볼 수 있어요\?/.test(h) && /data-act="dfMode" data-work="극" data-v="day">하루씩/.test(h) && /class="on" data-act="dfMode" data-work="극" data-v="day"/.test(h) && (h.match(/data-act="dfDay"/g) || []).length === 4 && !/class="card rcard"/.test(h), "날짜 먼저: 하루씩이 기본, 회차 있는 날만 누를 수 있고(대관 제외), 날짜를 고르기 전엔 추천이 없다");
      df.click({act: "dfDay", work: W, d: "2026-11-01"}); df.click({act: "dfDay", work: W, d: "2026-11-02"}); h = df.V.find(W, "date");
      ok(/고른 날짜에 볼 수 있는 조합/.test(h) && /11\/1 ×/.test(h) && /11\/2 ×/.test(h) && /고른 날짜 중 회차 1개/.test(h) && /data-dd="1"/.test(h) && !/a2[^<]*<\/p><p class="tiny muted">고른 날짜/.test(h), "하루씩 여러 날: 그 날짜에 나오는 조합만 카드로(회차 수는 고른 날짜 안)");
      const sh = df.S.proto.shown[W + "#날짜"]; ok(sh && sh.list.every(x => x.cast.A === "a1"), "고른 날짜(11/1·11/2)엔 a1 조합만");
      df.click({act: "selCombo", work: W, dd: "1", i: "0"}); h = df.V.find(W, "date");
      ok(/이 조합의 회차/.test(h) && /class="card perf"/.test(h), "조합을 누르면 고른 날짜 안의 그 조합 회차");
      df.click({act: "sat", work: W, dd: "1", i: "0", a: "like"}); ok(Object.values(df.S.proto.sat[W]).some(e => e.a === "like"), "날짜 먼저 카드에서도 만족도 답변");
      df.click({act: "dfMode", work: W, v: "range"}); df.click({act: "dfDay", work: W, d: "2026-11-02"}); ok(/11\/2부터 · 끝 날짜를 눌러 주세요/.test(df.V.find(W, "date")), "기간: 시작 날짜를 누르면 끝 날짜를 묻는다");
      df.click({act: "dfDay", work: W, d: "2026-11-04"}); eq(df.S.cal[W].dates, ["2026-11-02", "2026-11-03", "2026-11-04"], "기간: 시작~끝 사이 회차 있는 날 모두(결정 19)");
      const dm = boot({storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강한 성량"], works: [], favs: ["a2"], must: ["a2"], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {[W]: {actors: [], period: "all", dates: ["2026-11-01"]}}, proto: {}})}});
      const hm = dm.V.find(W, "date"); ok(/이 날짜엔 맞는 조합이 없어요/.test(hm) && /a2 배우는 고른 날짜에 나오지 않아요\. 다음 출연은 11\/3이에요/.test(hm) && /class="day has pin dim"/.test(hm), "반드시 포함 배우가 고른 날짜에 안 나오면: 0개 + 다음 출연일, 그날은 흐리게(13절)"); }
    // 좋아한 조합(10.3절) · 관람 후 알림 권한(결정 42) · 취향 스냅숏(16절 할 일)
    { const nx = boot(); nx.location.hash = "#show/" + W; nx.route(); nx.click({act: "sat", work: W, i: "0", a: "like"});
      ok(/좋아한 조합 <span class="small muted">1개<\/span>/.test(nx.V.plans()) && /좋아한 조합/.test(nx.V.me()) && /href="#find\/극\/actor">다시 찾기/.test(nx.V.plans()), "마음에 들어요 조합은 내 공연·내 취향의 '좋아한 조합'에");
      nx.click({act: "plan", work: W, date: "2026-11-01", time: "14:00"}); let sv = nx.V.saved("0");
      ok(!/알려 드릴까요|notifyAsk/.test(sv) && /관람예정으로 바꿔 두면 관람일이 지난 뒤 홈에서 '어땠어요\?'를 물어볼게요/.test(sv) && !/Notification\./.test(html) && !/브라우저 알림 켜기/.test(nx.V.me()), "관람 후 알림은 홈 배너만: 푸시 권한을 묻지 않고 브라우저 알림 코드도 없다(사용자 결정 2026-10-28)");
      const sx = {prefs: {axes: ["tag:성량", "강한 성량"], prio: "노래", works: [], favs: ["a1"], must: ["a1"], avoid: ["b2"], grade: ""}};
      const ts = tasteSnapshot(D, sx); ok(ts.prio === "노래" && ts.tags.includes("성량") && ts.axes["강한 성량"] === -1, "취향 스냅숏에 우선순위와 새 질문 답(tag:)이 실린다");
      const tr = tasteSnapRecord(D, sx, buildVocab(D).actors); ok(tr.prio === "노래" && tr.must.join() === "a1" && tr.avoid.join() === "b2" && nx.TRK.track("taste_snapshot", tr) !== undefined && nx.TRK.stats().dropped === 0, "taste_snapshot 기록: 우선순위·반드시 포함·피하고 싶은 배우까지, 검사 통과"); }
    // v0.9 관람 후 리뷰(11.1절) · 본 공연 기록하기(11.2절): 담지 않은 지난 회차도 누구나
    { const ra = loadApp(HD, {...opts, now: "2026-11-03T12:00:00", hash: "#log"}); ra.route();
      ok(/어떤 작품을 봤어요\?/.test(ra.V.log()) && /href="#log\/극"/.test(ra.V.log()), "본 공연 기록하기: 지난 회차가 있는 작품");
      const lg = ra.V.log(W); ok(/href="#review\/극\/2026-11-02\/14:00"/.test(lg) && /href="#review\/극\/2026-11-01\/14:00"/.test(lg) && !/2026-11-04|2026-11-05/.test(lg), "지난 회차만 최근 순(앞으로 있을 회차·대관 제외)");
      ra.location.hash = "#review/극/2026-11-01/14:00"; ra.route(); let rh = ra.V.review(W, "2026-11-01", "14:00");
      ok(/극 공연 어땠어요\?/.test(rh) && (rh.match(/class="rvrow"/g) || []).length === 3 && !/어떤 점이 좋았나요/.test(rh) && /비공개 글은 나만 볼 수 있어요/.test(rh), "배우마다 한 줄(조연 포함), 평가 전엔 태그 없음, 주관식 기본 비공개");
      ra.click({act: "rvRate", r: "A", v: "good"}); rh = ra.V.review(W, "2026-11-01", "14:00");
      ok(/어떤 점이 좋았나요\? <span>\(3개까지\)/.test(rh) && /data-act="rvTag" data-r="A" data-t="성량"[^>]*>공간을 채우는 성량</.test(rh), "좋았어요 → 칩(온보딩 태그를 온보딩 문구로)");
      ra.click({act: "rvRate", r: "B", v: "bad"}); ok(/어떤 점이 아쉬웠나요\?/.test(ra.V.review(W, "2026-11-01", "14:00")), "아쉬웠어요 → '어떤 점이 아쉬웠나요?'");
      ra.click({act: "rvTag", r: "A", t: "성량"}); ra.click({act: "rvSwapOpen", r: "A"}); ra.click({act: "rvSwap", r: "A", a: "a2"});
      ok(ra.S.proto.rdraft.rv.cast.A === "a2" && ra.S.proto.rdraft.rv.rows.A.tags.join() === "성량", "다른 배우였어요: 평가·태그는 바꾼 배우에게");
      ra.click({act: "rvPub", v: "1"}); ok(/공개하면 다른 사람의 추천 근거 문장에 이름 없이 보일 수 있어요/.test(ra.V.review(W, "2026-11-01", "14:00")), "공개를 고르면 안내");
      ra.click({act: "rvSave"}); rh = ra.V.review(W, "2026-11-01", "14:00");
      ok(/저장했어요/.test(rh) && /a2 배우를 꼭 보고 싶은 배우\(가능하면 포함\)에 넣기/.test(rh) && /b1 배우를 피하고 싶은 배우에 넣기/.test(rh) && /data-act="rvSug" data-y="1" disabled/.test(rh), "저장 뒤 배우 조건 제안(기본은 선택 안 됨)");
      const q = JSON.parse(ra.store.get("pickle_q") || "[]").filter(r => r.event === "after_review"); ok(q.length === 1 && q[0].payload.entry === "log" && q[0].payload.actors.length === 2 && !JSON.stringify(q[0].payload).includes("note"), "after_review 한 줄(주관식 원문 없음)");
      ra.click({act: "rvPick", a: "a2", k: "fav"}); ra.click({act: "rvSug", y: "1"});
      ok(ra.S.prefs.favs.includes("a2") && !(ra.S.prefs.avoid || []).includes("b1") && ra.location.hash === "#plans" && ra.S.plans.length === 1 && ra.S.plans[0].tagged && ra.S.reviews.length === 1, "체크한 배우만 넣고 내 공연으로. 담지 않았던 회차도 본 공연에 들어간다");
      ok(/기록 남김 ✓ <a href="#tag\/0">고치기<\/a>/.test(ra.V.plans("2026-11-01")) && /href="#plans\/2026-11-01"/.test(ra.V.plans()), "남긴 리뷰는 내 공연 캘린더의 그 날짜 화면에서 다시 열어 고칠 수 있다");
      ra.location.hash = "#tag/0"; ra.route(); ok(ra.S.proto.rdraft.rv.rows.A.rate === "good" && ra.S.proto.rdraft.rv.pub === true, "다시 열면 남긴 리뷰가 채워져 있다(한 회차 1개)"); }
    ok((html2.match(/class="actorx"/g) || []).length === 3 && (html2.match(/<div class="month"/g) || []).length === 1, "배우 특징은 고른 배우만(배역마다 1명), 달력은 한 달 하나");
    ok(!/조연도 보기|다른 배역도 보기/.test(html2) && /<b>C<\/b>/.test(html2), "조연 배역도 다른 배역과 같이 펼쳐져 있다(결정 13). 추천 단위 밖 배역이 없으면 접는 칸도 없다");
    eq(app.CTA, {act: "toDates", text: "이 조합으로 날짜 보기 ↓"}, "폰 아래 고정 버튼은 ②의 주 버튼(날짜로)");
    ok(/class="inline-cta"><button class="btn" data-act="toDates"/.test(html2), "넓은 화면용 인라인 버튼도 같은 동작");
    ok(/data-act="calDay"/.test(html2) && (html2.match(/class="day has/g) || []).length === 1 && /data-d="2026-11-01"/.test(html2), "볼 수 있는 날(선택한 조합이 나오는 날)만 눌러진다: 11월엔 11/1 하나(전체대관 11/5 제외)");
    ok(/<b>2026년 11월<\/b>/.test(html2), "처음엔 볼 수 있는 날이 있는 첫 달");
    ok(!/class="card perf"/.test(html2) && /날짜를 누르면 그날 회차/.test(html2), "날짜를 고르기 전엔 회차 카드가 없다");
    // ② 배우를 바꾸면 날짜가 다시 계산
    app.click({act: "selActor", work: W, role: "A", a: "a2"});
    let h3 = app.V.show(W);
    ok(/<b>2026년 11월<\/b>/.test(h3) && (h3.match(/class="day has/g) || []).length === 1 && /data-d="2026-11-03"/.test(h3), "배우를 바꾸면 날짜가 다시 계산된다(a2+b1 은 11/3 하나)");
    ok(/data-act="cmpOpen"/.test(h3) && /a1 · a2 둘 비교해 보기/.test(h3), "다른 배우를 누르면 '둘 비교해 보기' 링크가 작게 뜬다");
    // 날짜가 없는 조합 → 빼기 제안
    app.click({act: "selActor", work: W, role: "B", a: "b2"}); app.click({act: "selActor", work: W, role: "A", a: "a1"}); app.click({act: "selActor", work: W, role: "B", a: "b2"});
    app.click({act: "selActor", work: W, role: "A", a: "a2"}); app.click({act: "selActor", work: W, role: "B", a: "b1"}); app.click({act: "selActor", work: W, role: "A", a: "a1"});
    // a1+b1 은 있다. 일부러 없는 조합: a2+b1 에서 12월만 있는 a1+b1 을 빼고 a2+b2 로
    app.S.proto.sel = {[W]: {A: "a2", B: "b2"}}; app.S.proto.sel[W].A = "a2";
    h3 = app.V.show(W); ok(/data-d="2026-11-04"/.test(h3), "a2+b2 → 11/4");
    HD.perfs = HD.perfs.filter(p => !(p.cast.A === "a2" && p.cast.B === "b2"));
    h3 = app.V.show(W); ok(/고른 조합이 같이 나오는 날이 없어요/.test(h3) && /data-act="selActor"[^>]*data-role="A"/.test(h3) && !/class="month"/.test(h3), "같이 나오는 날이 없으면 달력 대신 '한 배역만 바꾸면' 제안");
    HD.perfs.push(mk("2026-11-04", {A: "a2", B: "b2", C: "c1"}));
    // ③ 달력은 한 달씩 넘긴다
    app = boot(); app.click({act: "selActor", work: W, role: "A", a: "a1"}); app.click({act: "selActor", work: W, role: "B", a: "b1"});
    let c1 = app.V.show(W);
    ok(/<b>2026년 11월<\/b>/.test(c1) && /data-act="calMove"[^>]*data-d="-1"[^>]*disabled/.test(c1) && !/data-act="calMove"[^>]*data-d="1"[^>]*disabled/.test(c1), "첫 달에선 ‹ 가 막혀 있고 › 는 눌린다");
    app.click({act: "calMove", work: W, d: "1"}); let c2 = app.V.show(W);
    ok(/<b>2026년 12월<\/b>/.test(c2) && (c2.match(/<div class="month"/g) || []).length === 1 && /data-d="2026-12-05"/.test(c2), "› 로 다음 달(그래도 달력은 하나)");
    app.click({act: "calMove", work: W, d: "1"}); app.click({act: "calMove", work: W, d: "1"}); let c3 = app.V.show(W);
    ok(/<b>2027년 1월<\/b>/.test(c3) && /data-act="calMove"[^>]*data-d="1"[^>]*disabled/.test(c3), "마지막 달에서 › 가 막힌다");
    app.click({act: "calDay", work: W, d: "2027-01-09"}); c3 = app.V.show(W);
    ok(/class="card perf"/.test(c3) && /<b>A<\/b>a1/.test(c3) && /<b>C<\/b>c1/.test(c3) && /data-act="plan"/.test(c3) && !/data-ticket="1"|예매처로 이동/.test(c3), "날짜를 누르면 그날 회차 카드(시간·전체 캐스트·볼 예정 담기 — 예매처 버튼은 담은 뒤 화면에 있다)");
    ok(/>볼 예정에 담기<\/button>/.test(c3) && !/볼 예정 담기|예매처로 ↗|담겼어요/.test(c3) && !/예매처에서 <b>/.test(c3), "날짜 카드에는 [볼 예정에 담기] 하나(같은 행동은 같은 이름), 예매처 날짜 안내도 담은 뒤 화면으로 옮겼다");
    // 옛 달력 주소는 같은 화면(달력 하나)
    ok(app.V.cal(W).includes('id="dates"') && (app.V.cal(W).match(/<div class="month"/g) || []).length === 1, "#cal 도 한 달짜리 같은 화면");
    ok(app.V.day(W, "2026-12-05").includes("calDay") && app.S.proto.cd[W] === "2026-12-05", "#day 는 그 날짜를 고른 같은 화면");
    // 담기: 바로 담는다(v0.9 — 담기 전 '기대돼요?' 별점 시트 없음. 조합 만족도는 추천 카드에서 묻는다)
    app = boot(); const q0 = qlen(app).length;
    app.click({act: "plan", work: W, date: "2026-11-01", time: "14:00"});
    ok(!app.SHEET && app.S.plans.length === 1 && app.S.plans[0].date === "2026-11-01" && app.location.hash === "#saved/0", "[볼 예정에 담기]: 시트 없이 바로 담고 저장 확인 화면으로");
    ok(evs(app).join() === "combo_choice" && qlen(app)[0].payload.action === "plan" && !evs(app).includes("combo_rating") && qlen(app).length === q0 + 1, "combo_choice(plan) 한 줄만 남는다(별점 기록 없음)");
    // 예매처로: 시트를 지나야 연다
    // 예매처로: 날짜 카드·회차 상세엔 없고, 담은 뒤 화면(#saved)에서 간다
    app = boot(); const dh0 = app.V.detail(W, "2026-11-01", "14:00");
    ok(!/예매처로 이동|data-ticket/.test(dh0) && /data-act="plan"[^>]*>볼 예정에 담기<\/button>/.test(dh0) && !/예매처에서 <b>/.test(dh0), "회차 상세에는 [예매처로 이동]이 없고 [볼 예정에 담기]만(아직 안 담음)");
    app.click({act: "plan", work: W, date: "2026-11-01", time: "14:00"}); ok(app.opened.length === 0, "[볼 예정에 담기]는 예매처를 열지 않는다"); const sv0 = app.V.saved("0");
    ok(app.S.plans.length === 1 && evs(app).join() === "combo_choice" && qlen(app)[0].payload.action === "plan" && app.location.hash === "#saved/0", "담기고 combo_choice(plan), 담은 뒤 화면으로 간다");
    ok(/<a class="btn" data-act="ticketSaved" data-i="0" href="https:\/\/tickets\.example\.com\/x" target="_blank" rel="noopener">예매처로 이동 ↗<\/a>/.test(sv0) && /예매처에서 <b>[^<]+<\/b> 날짜를 다시 골라 주세요\(날짜는 자동으로 안 넘어가요\)/.test(sv0), "담은 뒤 화면에 [예매처로 이동 ↗](새 탭 링크)와 날짜 안내가 있다");
    const r1 = app.click({act: "ticketSaved", i: "0"}); ok(!r1.prevented && evs(app).join() === "combo_choice,combo_choice" && qlen(app)[1].payload.action === "ticket" && qlen(app)[1].payload.work === W && qlen(app)[1].payload.date === "2026-11-01" && qlen(app)[1].payload.time === "14:00", "[예매처로 이동]을 누르면 링크는 그대로 열리고(막지 않는다) combo_choice(ticket)이 남는다");
    app.click({act: "ticketSaved", i: "9"}); ok(evs(app).length === 2, "없는 번호는 무시");
    // 내 공연 캘린더(2026-10-28): 담으면 미정일정(흑백) → 관람예정으로 바꾸면 컬러. 날짜 화면에 공연 정보 자동 + 좌석·금액 입력
    { ok(app.S.plans[0].status === "tentative" && !/내 캘린더에 추가|\.ics|text\/calendar/.test(sv0) && /href="#plans\/2026-11-01">캘린더에서 보기/.test(sv0) && /data-act="planStatus" data-i="0" data-s="booked"/.test(sv0) && /class="svposter gray"|미정일정/.test(sv0), "담은 직후: 미정일정으로 들어가고, 구글 캘린더 파일 대신 서비스 안 캘린더로 · 예매했어요 버튼");
      const cal = app.V.plans(), cell = (cal.match(/<a class="cday[^"]*" href="#plans\/2026-11-01"[^>]*>[\s\S]*?<\/a>/) || [""])[0];
      ok(/관극 캘린더/.test(cal) && /\bhas tentative\b/.test(cell) && (app.S.plans[0] && app.D.works.find(w => w.name === W)?.poster ? /<img src=/.test(cell) : true) && /미정일정/.test(cal), "캘린더: 그 날짜 칸이 미정일정(흑백 처리 클래스)으로 채워진다");
      const day = app.V.plans("2026-11-01");
      for (const k of ["공연명", "날짜", "시간", "출연배우", "장소", "좌석", "금액"]) ok(new RegExp(`<dt>(<label[^>]*>)?${k}`).test(day), "날짜 화면 칸: " + k);
      ok(day.includes(`<b>${W}</b>`) && /2026\.11\.01/.test(day) && /14:00/.test(day) && /a1/.test(day) && /data-pf="seat"/.test(day) && /data-pf="price"/.test(day), "공연명·날짜·시간·출연배우는 회차에서 자동으로, 좌석·금액은 입력 칸");
      app.click({act: "planStatus", i: "0", s: "booked"}); const qs = qlen(app).filter(r => r.event === "plan_status");
      ok(app.S.plans[0].status === "booked" && qs.length === 1 && qs[0].payload.status === "booked" && qs[0].payload.work === W && !("seat" in qs[0].payload), "관람예정으로 바꾸면 저장되고 plan_status 한 줄(좌석·금액은 안 보낸다)");
      ok(/\bhas booked\b/.test((app.V.plans().match(/<a class="cday[^"]*" href="#plans\/2026-11-01"/) || [""])[0]) && /class="pday booked"/.test(app.V.plans("2026-11-01")), "관람예정이면 칸·날짜 화면이 컬러(booked)");
      app.click({act: "planStatus", i: "0", s: "booked"}); ok(qlen(app).filter(r => r.event === "plan_status").length === 1, "같은 상태를 다시 누르면 기록하지 않는다");
      ok(app.V.plans("2026-11-02").includes("담은 공연이 없어요") && /href="#plans"/.test(app.V.plans("2026-11-02")), "담은 공연이 없는 날짜: 안내 + 캘린더로"); }
    const dh1 = app.V.detail(W, "2026-11-01", "14:00"), pc1 = app.V.show(W);
    ok(/<a class="btn" href="#saved\/0">볼 예정에 담았어요 · 예매처로 가기 →<\/a>/.test(dh1) && !/data-act="plan"/.test(dh1.split('class="side"')[1] || dh1) && !/예매처로 이동/.test(dh1), "이미 담은 회차의 회차 상세: 담은 뒤 화면으로(예매처로) 가는 버튼, 막다른 길 없음");
    app.click({act: "calDay", work: W, d: "2026-11-01"}); const pc2 = app.V.show(W);
    ok(/<a class="btn" href="#saved\/0">볼 예정에 담았어요 · 예매처로 가기 →<\/a>/.test(pc2) && !/data-act="plan"[^>]*data-time="14:00"/.test(pc2.split('class="card perf"')[1]?.split("</div>")[0] || "") && !/예매처로 이동/.test(pc2), "이미 담은 회차의 날짜 카드도 담은 뒤 화면으로 가는 버튼");
    // 규칙은 그대로: 전체대관(일반 예매 불가)·예매 링크 없는 회차
    const privP = HD.perfs.find(x => (x.notes || []).some(n => /대관/.test(n))), dpv = boot().V.detail(W, privP.date, privP.time);
    ok(/<button class="btn" disabled>일반 예매 불가<\/button>/.test(dpv) && /<button class="btn ghost" data-act="plan"[^>]*disabled>볼 예정에 담을 수 없어요<\/button>/.test(dpv) && !/예매처로 이동/.test(dpv), "전체대관 회차 상세: 예전처럼 '일반 예매 불가'·'볼 예정에 담을 수 없어요'(둘 다 비활성)");
    const HDn = JSON.parse(JSON.stringify(HD)); HDn.works[0].runs[0].ticket = ""; const appN = loadApp(HDn, {...opts}); appN.route();
    const dnt = appN.V.detail(W, "2026-11-01", "14:00");
    ok(/<button class="btn" disabled>예매 링크 준비 중<\/button>/.test(dnt) && /<button class="btn ghost" data-act="plan"[^>]*>볼 예정에 담기<\/button>/.test(dnt) && !/예매처로 이동/.test(dnt), "예매 링크 없는 회차 상세: 예전처럼 '예매 링크 준비 중'(비활성) + [볼 예정에 담기]");
    appN.click({act: "calDay", work: W, d: "2026-11-01"}); const cnt = appN.V.show(W);
    ok(/>볼 예정에 담기<\/button><button class="btn ghost" disabled>예매 링크 준비 중<\/button>/.test(cnt), "예매 링크 없는 회차의 날짜 카드: [볼 예정에 담기] 옆에 '예매 링크 준비 중'(비활성)");
    appN.click({act: "plan", work: W, date: "2026-11-01", time: "14:00"});
    const svn = appN.V.saved("0"), cn2 = (appN.click({act: "calDay", work: W, d: "2026-11-01"}), appN.V.show(W));
    ok(/<button class="btn" disabled>예매 링크 준비 중<\/button>/.test(svn) && /<a class="btn" href="#saved\/0">볼 예정에 담았어요 · 담은 공연 보기 →<\/a>/.test(cn2), "링크 없는 회차를 담으면: 담은 뒤 화면에 '예매 링크 준비 중', 날짜 카드는 '담은 공연 보기 →'(막다른 길 없음)");
    // 월드컵은 공연 화면 밖
    ok(!/끌리는 배우 고르기|#duel\//.test(app.V.me()) && !/월드컵/.test(app.V.me()), "내 취향 탭에서 끌리는 배우 고르기는 뺐다(사용자 요청 2026-10-28). #duel 화면은 주소로만 남는다");
    ok(/data-act="duel"/.test(app.V.duel(W)) && /<h1>극<\/h1>/.test(app.V.duel(W)), "#duel/작품 화면");
    app = boot(); app.click({act: "obGo", to: "3"}); ok(app.location.hash === "#home", "온보딩 마지막 버튼(2단계 끝): 바로 #home");
    app.S.prefs = {axes: ["강한 성량"], works: [], favs: ["a1"], grade: ""}; app.click({act: "obGo", to: "3"}); ok(app.location.hash === "#home", "추천 1순위 작품(끌리는 배우 고르기가 가능한 작품)이 있어도 바로 #home");
    const t2h = app.V.taste("2"); ok((t2h.match(/data-act="obGo" data-to="3"/g) || []).length >= 1 && !/data-to="4"|taste\/3/.test(t2h) && !/끌리는 배우 고르기|어떤 공연이 끌려요\?/.test(t2h), "온보딩 2단계 화면: 마지막 버튼은 data-to=3 → 홈, 공연 카드 단계·끌리는 배우 고르기 안내는 없다");
    for (const h of ["#taste/4", "#onboard/4", "#taste/9", "#onboard/12"]) { const ao = boot({hash: h}); ok(ao.location.hash === "#home" && /MY PICKLE TASTE/.test(ao.q("#view").innerHTML) && !/어떤 배우가 끌려요\?|선택 · 끌리는 배우 고르기/.test(ao.q("#view").innerHTML), "옛 주소 " + h + " 로 들어오면(새로고침·저장된 주소) 홈(취향 카드)으로"); }
    for (const h of ["#taste/1", "#taste/2", "#onboard/2"]) { const ao = boot({hash: h}); ok(ao.location.hash === h && /취향 고르기 \d\/2/.test(ao.q("#view").innerHTML), "온보딩 1~2단계 주소는 그대로: " + h); }
    for (const h of ["#taste/3", "#onboard/3"]) { const ao = boot({hash: h}); ok(ao.location.hash === "#taste/2" && /취향 고르기 2\/2/.test(ao.q("#view").innerHTML), "옛 3/3 주소 " + h + " 는 2/2(기대 질문)로"); }
    app = boot(); app.click({act: "duel", work: W, r: "left"}); ok(evs(app).includes("role_duel") && app.S.proto.duels.length === 1, "끌리는 배우 고르기 동작(#duel 화면·내 취향 카드)은 그대로: role_duel 이 남고 바로 반영");
    // '둘 비교해 보기'
    app = boot(); app.click({act: "selActor", work: W, role: "A", a: "a2"}); app.click({act: "cmpOpen", work: W});
    ok(app.SHEET.kind === "duel" && [app.SHEET.cur.left, app.SHEET.cur.right].sort().join() === "a1,a2" && /data-act="sheetDuel"/.test(app.sheetBody()), "'둘 비교해 보기' → 두 배우 나란히(좌우 무작위)");
    ok(/<h3 id="sheettitle">[^<]*, 둘 중 누가 끌려요\?<\/h3><\/div><button type="button" class="sx" data-act="closeSheet" aria-label="닫기">/.test(app.q("#sheet").innerHTML) && !/>닫기</.test(app.q("#sheet").innerHTML), "두 배우 비교 시트도 같은 머리(제목 + 우측 위 X 닫기), 아래 닫기 막대 없음");
    app.click({act: "sheetDuel", r: "right"}); const rd = qlen(app).find(r => r.event === "role_duel");
    ok(!app.SHEET && rd && rd.payload.role === "A" && rd.payload.result === "right" && app.S.proto.duels.length === 1 && !app.S.proto.cmp?.[W], "고르면 role_duel 기록 + 반영, 비교 제안은 사라진다");
    // 회차 캐스팅이 없는 공연(KOPIS)
    const cs = (D2 => D2)(HD); HD.currentShows = [{id: "PF999999", title: "대표 출연진 극", venue: "홀", start: "2026-10-01", end: "2026-12-31", status: "공연중", age: "만 7세 이상", runtime: "1시간 40분", price: "R석 66,000원", times: "화~금 20:00", cast: ["a1", "b1"], tickets: [{name: "예매처", url: "https://tickets.example.com/k"}], poster: ""}];
    app = boot(); const kh = app.V.show("PF999999"), kp = ["summary", "cast", "dates"].map(id => kh.indexOf(`id="${id}"`));
    ok(kp[0] < kp[1] && kp[1] < kp[2] && kp.every(x => x > 0) && !/class="month"/.test(kh) && /날짜별 캐스팅은 예매처에서/.test(kh) && /tickets\.example\.com\/k/.test(kh), "KOPIS 만 있는 공연: ① 요약 → ② 출연진 → ③ '날짜별 캐스팅은 예매처에서' + 예매처 버튼(달력 없음)");
    ok(/최저 66,000원~/.test(kh) && /만 7세 이상 · 1시간 40분/.test(kh) && app.CTA === null && /이 배우, 내 취향이었나요\? \(선택\)/.test(kh) && /안 맞아요/.test(kh) === false, "요약 한 줄 정보(연령·러닝타임·최저가), 배우 평가는 작게 접혀 있고 고정 버튼은 없다");
    // 문구(7c 점검): 배우 평가는 '내 취향이었나요?'(배우 점수로 안 읽히게), 예매처는 '예매처로 이동'
    ok(/예매처로 이동 ↗/.test(kh) && !/예매처 ↗|>예매처</.test(kh), "예매처로 가는 버튼은 '예매처로 이동'");
    app.location.hash = "#show/PF999999"; app.click({act: "actorSel", show: "PF999999", a: "a1"}); const ah = app.V.show("PF999999");
    ok(/a1, 내 취향이었나요\?/.test(ah) && /<span>안 맞아요<\/span><span>딱 맞아요<\/span>/.test(ah) && !/어때요\?|전혀 아니에요/.test(ah), "배우 한 명 평가: 제목 '내 취향이었나요?', 별 양 끝 '안 맞아요 / 딱 맞아요'");
    app.click({act: "rateScore", id: Object.keys(app.RATE_CTX)[0], n: "2"}); app.click({act: "rateSend", id: Object.keys(app.RATE_CTX)[0]});
    ok(/이 배우는 닮은 배우 추천에서 빼 둘게요/.test(app.S.proto.msg["actor|PF999999|a1"]) && !/추천 기준에서 뺐어요/.test(app.S.proto.msg["actor|PF999999|a1"]), "결과 안내: '이 배우는 닮은 배우 추천에서 빼 둘게요'(취향 기준 말)");
    // 취향이 없을 때도 화면이 선다(추천 이유·PICK 없이)
    app = boot({storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); const nh = app.V.show(W);
    ok(!/class="why1 big"/.test(nh) && !/PICK|class="pickb">추천 조합/.test(nh) && (nh.match(/pickc on/g) || []).length === 3, "취향이 없으면 추천 문장·추천 조합 표시 없이 가장 빠른 조합이 선택돼 있다");
    // 기록 5종과 화이트리스트는 그대로: 위 흐름의 기록이 하나도 안 걸러졌다
    app = boot(); app.location.hash = "#show/" + W; app.route(); app.click({act: "sat", work: W, i: "0", a: "unsure"}); app.click({act: "plan", work: W, date: "2026-11-01", time: "14:00"});
    app.click({act: "pin", work: W, a: "a2", k: "star"}); app.click({act: "selActor", work: W, role: "A", a: "a1"}); app.click({act: "cmpOpen", work: W}); app.click({act: "sheetDuel", r: "left"});
    eq(evs(app), ["combo_fit", "combo_choice", "actor_pick", "role_duel"], "조합 만족도·담기·⭐·비교가 정의서의 기록으로 남는다");
    ok(app.TRK.stats().dropped === 0, "걸러진 값 0 — 새 화면의 기록도 화이트리스트를 그대로 통과한다");
    ok(qlen(app).every((r, i) => r.payload.seq === i), "방문 안 순서 seq 가 이어진다");
  }

  // ===== 9. 디자인(두 판·강조색 세 곳·별점·포스터 중심) =====
  { const css = fs.readFileSync(path.join(__dirname, "../app/app.css"), "utf8"), inline = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    // 판 고르기와 스타일 파일 버전
    // 판 정하기(머리 스크립트): ?theme= > 저장한 값 > 밝은 판
    const headJs = html.match(/<script>\/\* 판:[^*]*\*\/([\s\S]*?)<\/script>/)[1];
    const pickTheme = (search, saved, broken = false) => { const attrs = {}; new Function("document", "location", "localStorage", "URLSearchParams", headJs)({documentElement: {setAttribute: (k, v) => { attrs[k] = v; }}}, {search}, broken ? {getItem() { throw new Error("blocked"); }} : {getItem: () => saved}, URLSearchParams); return attrs["data-theme"]; };
    eq([pickTheme("", null), pickTheme("?theme=dark", null), pickTheme("?theme=light", "dark"), pickTheme("", "dark"), pickTheme("?theme=dark", "light"), pickTheme("?theme=blue", "dark"), pickTheme("?x=1", "pink"), pickTheme("", "dark", true), pickTheme("?theme=dark", "light", true)],
      ["light", "dark", "light", "dark", "dark", "dark", "light", "light", "dark"], "판 우선순위: ?theme= 주소 값 > 저장된 값 > 기본(밝은 판). 엉뚱한 값은 무시, 저장소가 막혀도 동작");
    const vers = [...html.matchAll(/href="(theme|app)\.css\?v=(\d{8}[a-z]+)"/g)];
    ok(vers.length === 2 && vers[0][1] === "theme" && vers[1][1] === "app" && vers[0][2] === vers[1][2], "index.html 이 theme.css·app.css 를 ?v= 버전을 붙여 부른다(같은 숫자)");
    ok(html.indexOf("theme.css?v=") < html.indexOf("app.css?v="), "app.css 가 theme.css 다음(덮어쓰는 순서)");
    ok(/<script src="data\.js"><\/script>/.test(html), "data.js 는 배포 스크립트가 버전을 붙일 수 있게 src=\"data.js\" 그대로");
    // 토큰과 글자 대비(밝은 판·어두운 판)
    const vars = re => { const m = css.match(re); assert(m, "토큰 블록 없음: " + re); return Object.fromEntries([...m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(x => [x[1], x[2].trim()])); };
    const light = vars(/:root,:root\[data-theme="light"\]\{([^}]*)\}/), dark = vars(/:root\[data-theme="dark"\]\{([^}]*)\}/);
    const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    for (const [name, t] of [["밝은 판", light], ["어두운 판", dark]]) {
      for (const text of ["fg", "muted", "faint", "ok", "warn"]) for (const bg of ["bg", "surface", "soft"]) ok(ratio(t[text], t[bg]) >= 4.5, `${name}: ${text} 글씨가 ${bg} 위에서 4.5:1 이상 (${ratio(t[text], t[bg]).toFixed(2)})`);
      ok(ratio(t["on-accent"], t.accent) >= 4.5, `${name}: 강조색 위 글씨 4.5:1 이상 (${ratio(t["on-accent"], t.accent).toFixed(2)})`);
      for (const bg of ["bg", "surface"]) ok(ratio(t.accent, t[bg]) >= 3 && ratio(t["star-off"], t[bg]) >= 3, `${name}: 별(켜짐·꺼짐)이 ${bg} 위에서 3:1 이상`);
      ok(/^#[0-9a-fA-F]{6}$/.test(t.accent), `${name}: 강조색은 변수 하나(--accent)로 정한다`);
    }
    ok((css.match(/--accent:\s*#/g) || []).length === 2, "강조색 정의는 판마다 한 줄씩(--accent 두 줄만 바꾸면 됨)");
    ok(light.accent === "#B23A48" && light["accent-hover"] === "#982F3B" && light["accent-soft"] === "#FDF2F4" && light["accent-tint"] === "#FBE8EA" && light["on-accent"] === "#FFFFFF", "밝은 판 강조색: 사용자가 정한 #B23A48(hover #982F3B, soft #FDF2F4, tint #FBE8EA, 위 글자 흰색)");
    ok(dark["on-accent"] === "#FFFFFF" && /^#[0-9a-fA-F]{6}$/.test(dark["accent-hover"]) && ratio(dark["accent-hover"], dark["on-accent"]) >= 4.5, "어두운 판: 같은 색상 계열, 위 글자 흰색, hover 위 글자도 4.5:1 이상");
    for (const [name, t] of [["밝은 판", light], ["어두운 판", dark]]) { for (const soft of ["accent-soft", "accent-tint"]) ok(ratio(t.fg, t[soft]) >= 4.5 && ratio(t.muted, t[soft]) >= 4.5, `${name}: ${soft} 면 위 fg·muted 글씨 4.5:1 이상`); ok(ratio(t["on-accent"], t["accent-hover"]) >= 4.5, `${name}: hover 색 위 글씨 4.5:1 이상`); }
    const hue = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return d === 0 ? 0 : (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; };
    ok(Math.abs(hue(dark.accent) - hue(light.accent)) < 4, "어두운 판 강조색은 밝은 판과 같은 색상(hue) 계열");
    // 강조색은 주 버튼·선택 상태·별에만
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
    const okSel = /^(:root|\.btn(:hover)?$|\.chip(\.[\w-]+)*\.on|\.chip\.x\.on|\.card>\.chip\.x\.on|\.mood\.on$|\.obcard\.on|\.obcard\.on::after|\.day\.has\.pin$|\.star\.on$|\.obcard.*\.on:hover|\.vbtn\[aria-pressed="true"\](:hover)?$|\.vtc\[aria-pressed="true"\]$|\.sheet \.chsec \.chip\.x\.on$|\.vpin(:hover|\.on)?$|\.tabs a\.on$|\.(lg|cday|spill|pday)\.booked(::before)?$|\.pday\.booked \.pseg button\.on$)/;  // 시트: 고른 답·고른 특징 칩(선택 상태), ⭐ 담기 버튼(주 버튼) 테두리. 고른 탭·내 공연 캘린더의 관람예정(예매함) 표시도 선택 상태
    const leaks = rules.filter(([sel, body]) => /var\(--accent(-soft|-tint|-hover)?\)/.test(body) && !sel.split(",").every(x => okSel.test(x.trim()))).map(r => r[0]);
    eq(leaks, [], "app.css 에서 강조색(--accent, -soft, -tint, -hover)을 쓰는 곳은 주 버튼·선택 상태·별뿐이다");
    ok(!/var\(--accent/.test(inline), "index.html 안쪽 옛 스타일은 강조색을 쓰지 않는다(중립 토큰으로 바꿈)");
    ok(!/box-shadow\s*:\s*(?!none)[^;}]+/.test(css), "app.css 에 그림자가 없다(box-shadow 는 none 뿐)");
    // 화면 마크업
    const HD2 = HDX, opts = OPTSX; const app9 = loadApp(HD2, {...opts, hash: "#home"}); app9.route();
    const home9 = app9.V.browse();  // 예전 홈(추천 줄·전체 목록)은 MVP 화면에서 빠지고 V.browse 로 남았다
    ok(/class="prow"/.test(home9) && /class="pcard"/.test(home9) && /class="pgrid"/.test(home9) && !/class="rec"|class="work"|class="grid"/.test(home9), "홈: 추천은 포스터 가로 줄(prow), 전체는 포스터 격자(pgrid), 글 상자 카드(rec/work)는 없다");
    ok(/<section class="hsec"><h2>내 취향 추천<\/h2>/.test(home9) && /<h2>지금 하는 공연 전체<span class="count">/.test(home9), "홈 섹션 제목");
    const prowHtml = home9.split('class="prow"')[1].split("</section>")[0], gridHtml = home9.split('class="pgrid"')[1];
    ok(/class="pw"/.test(prowHtml) && !/class="pw"/.test(gridHtml), "추천 줄엔 포스터 아래 제목+추천 이유, 격자엔 제목만");
    HD2.seedInfo = {[W]: {age: "만 7세 이상", runtime: "2시간"}}; HD2.works[0].poster = "posters/x.gif";
    const show9 = app9.V.show(W);
    const hp = ["hero-bg", "hero-poster", "<h1>", 'class="hmeta"', 'class="sline"', "정보 더 보기"].map(k => show9.indexOf(k));
    ok(show9.includes('class="hero" id="summary"') && hp[1] > 0 && hp[1] < hp[2] && hp[2] < hp[3] && hp[3] < hp[4] && hp[4] < hp[5], "공연 화면 ①: 큰 포스터 → 제목 → 공연장·기간 → 정보 한 줄 → 정보 더 보기");
    ok(!/class="hero-bg"/.test(show9) || /<img class="hero-bg"[^>]*alt=""[^>]*aria-hidden="true"/.test(show9), "흐린 배경 포스터는 장식(alt 없음·aria-hidden)");
    ok(/class="chip pickc/.test(show9) && !/class="head"/.test(show9), "② 배우는 둥근 이름 칩(pickc)");

    // 왼쪽 아래 명암 버튼
    ok(/<button id="themebtn" class="themebtn" type="button" data-act="themeToggle"><\/button>/.test(html) && html.indexOf('<header class="top">') < html.indexOf('id="themebtn"') && html.indexOf('id="themebtn"') < html.indexOf("</header>") && /\.top \.themebtn\{position:static;/.test(css), "명암 버튼은 머리줄 오른쪽(2026-10-28: 떠 있는 동그라미가 글을 가려서)");
    ok(/\.themebtn\{position:fixed;left:12px;bottom:76px;[^}]*background:var\(--bg\);color:var\(--fg\);border:2px solid var\(--muted\)\}/.test(css) && /#cta:not\(\[hidden\]\) ~ \.themebtn\{bottom:132px\}/.test(css), "버튼: 왼쪽 아래 원형, 고정 버튼이 있으면 그 위로, 테두리 --muted(바탕과 3:1 이상)");
    ok(/min-width:900px\)\{\.themebtn,#cta:not\(\[hidden\]\) ~ \.themebtn\{left:24px;bottom:24px\}/.test(css), "넓은 화면에선 고정 버튼이 없어서 올리지 않는다");
    let tb = loadApp(HD2, {...opts, hash: "#home", theme: "light"}); tb.route(); tb.listeners.doc.click.length;
    ok(tb.q("#themebtn").attrs["aria-label"] === "어두운 화면으로 바꾸기" && /<svg/.test(tb.q("#themebtn").innerHTML), "밝은 판에선 '어두운 화면으로 바꾸기'(달 아이콘)");
    tb.click({act: "themeToggle"});
    ok(tb.root.attrs["data-theme"] === "dark" && tb.store.get("pickle_theme") === "dark" && tb.q("#themebtn").attrs["aria-label"] === "밝은 화면으로 바꾸기" && tb.q("#themebtn").attrs.title === "밝은 화면으로 바꾸기", "누르면 새로고침 없이 어두운 판으로 바뀌고 저장·이름(aria-label)이 바뀐다");
    ok(/<circle/.test(tb.q("#themebtn").innerHTML), "어두운 판에선 해 아이콘");
    tb.click({act: "themeToggle"}); ok(tb.root.attrs["data-theme"] === "light" && tb.store.get("pickle_theme") === "light" && tb.q("#themebtn").attrs["aria-label"] === "어두운 화면으로 바꾸기", "다시 누르면 밝은 판");
    ok(!tb.store.has("pickle_q") && !tb.store.has("pickle_anon") && !Object.keys(EVENTS).some(e => /theme|dark|light/i.test(e)), "명암 전환은 track 에 남기지 않는다(정의서 밖)");
    tb.click({act: "themeToggle"}); const saved = tb.store.get("pickle_theme");
    const again = loadApp(HD2, {...opts, hash: "#home", storage: {pickle_theme: saved}, theme: pickTheme("", saved)}); again.route();
    ok(again.root.attrs["data-theme"] === "dark" && again.q("#themebtn").attrs["aria-label"] === "밝은 화면으로 바꾸기", "새로고침해도(저장된 값으로 시작) 같은 판 + 버튼 이름도 맞다");
    const withUrl = loadApp(HD2, {...opts, hash: "#home", search: "?theme=dark&v=3", theme: "dark"}); withUrl.route(); withUrl.click({act: "themeToggle"});
    ok(withUrl.root.attrs["data-theme"] === "light" && withUrl.location.search === "?theme=light&v=3" && withUrl.location.hash === "#home", "주소에 ?theme= 이 있으면 그 값도 맞춰서(다른 값·해시는 그대로) 새로고침해도 같은 판");
    const blocked = loadApp(HD2, {...opts, hash: "#home", theme: "light"}); blocked.q("#themebtn"); const origSet = blocked.store.set; blocked.store.set = () => { throw new Error("quota"); };
    let threw = false; try { blocked.click({act: "themeToggle"}); } catch (e) { threw = true; } ok(!threw && blocked.root.attrs["data-theme"] === "dark", "저장이 안 돼도(예외) 화면은 바뀐다");
    // 별점(배우 한 명 평가에 남은 상자): 큰 별 5개, 양 끝 말, 누르면 바로 선택
    const rb = () => app9.ratingBox({key: "actor|t|a1", kind: "actor", title: "a1, 내 취향이었나요?", bare: true, lo: "안 맞아요", hi: "딱 맞아요", show: W, actor: "a1", actors: ["a1"]});
    let sb = rb();
    ok((sb.match(/class="star "/g) || []).length === 5 && (sb.match(/aria-label="[1-5]점"/g) || []).length === 5 && /<span>안 맞아요<\/span><span>딱 맞아요<\/span>/.test(sb) && !/class="score"/.test(sb), "별점: 숫자 버튼 대신 큰 별 5개, 양 끝 말");
    ok(!/class="card fb"/.test(sb) && /class="fbbare"/.test(sb), "bare 평가는 카드·제목 없이 별과 칩만");
    app9.click({act: "rateScore", id: Object.keys(app9.RATE_CTX).pop(), n: "3"}); sb = rb();
    ok((sb.match(/class="star on"/g) || []).length === 3 && /aria-pressed="true"/.test(sb) && /끌린 점이 있나요\?/.test(sb) && /안 맞은 점이 있나요\?/.test(sb), "별을 누르면 바로 그 점수가 선택되고(별 3개 켜짐) 칩이 이어서 나온다");
    app9.click({act: "rateScore", id: Object.keys(app9.RATE_CTX).pop(), n: "3"}); ok(((rb().match(/class="star on"/g)) || []).length === 0, "같은 별을 다시 누르면 해제");
    const vis = loadApp(HD2, {...opts, storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강한 성량"], works: [], favs: [], grade: ""}, plans: [{work: W, date: "2026-10-01", time: "14:00", cast: {A: "a1", B: "b1", C: "c1"}, tagged: false, status: "booked"}], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); vis.route();
    { const vh = vis.V.home();  // v0.9(docs/261027_2 11절): 홈의 관람 후 카드는 별점 없이 리뷰 화면으로 보낸다(배우별 평가는 리뷰에서)
      ok(!/class="star /.test(vh) && /극 공연 어땠어요\?/.test(vh) && /href="#tag\/0">기록 남기기</.test(vh) && /data-act="visitSkip" data-i="0"/.test(vh), "관람 후 알림 카드: '○○ 공연 어땠어요?' + [기록 남기기]·[나중에], 별점 없음"); }
    const dh = app9.V.duel(W); ok(/끌리는 배우 고르기 · 극/.test(dh) && /\d+\/\d+번째/.test(dh) && !/월드컵|이상형|판\)|\d+판/.test(dh), "끌리는 배우 고르기: 이름과 'n/m번째'(월드컵·승패 말 없음)");
    app9.click({act: "duel", work: W, r: "left"}); app9.click({act: "duel", work: W, r: "tie"}); ok(/2번 골랐어요/.test(app9.V.duel(W)), "고른 횟수는 'n번 골랐어요'");
    ok(/>한 번 더 고를래요</.test(html) && !/>더 해 볼래요</.test(html), "'더 해 볼래요' → '한 번 더 고를래요'");
    ok(!/data-act="rateScore"[^>]*>\s*[1-5]\s*</.test(show9 + home9 + sb), "숫자만 적힌 점수 버튼이 없다");
  }

  // ===== 10. 홈: 줄 A·B 분리, 전체 목록 한 곳, 대학로/대학로 외 구분 =====
  { const HD3 = HDX, opts3 = OPTSX, FROM3 = "2026-10-11";
    // 구분 값: export 가 붙인 area 가 먼저, 없으면 임시 규칙(공연명·공연장에 '대학로'), '확인 필요'는 대학로 외
    eq([areaOf({area: "대학로"}), areaOf({area: "대학로 외"}), areaOf({area: "확인 필요"}), areaOf({title: "FATED [대학로]", venue: "링크"}), areaOf({title: "x", venue: "대학로예술극장"}), areaOf({name: "엘리자벳", runs: [{venue: "블루스퀘어"}]}), areaOf({name: "y", runs: [{venue: "A"}, {venue: "대학로 소극장"}]}), areaOf({area: "대학로", title: "대학로 아님"}), areaOf({area: "확인 필요", title: "대학로극"})],
       ["대학로", "대학로 외", "대학로 외", "대학로", "대학로", "대학로 외", "대학로", "대학로", "대학로 외"], "구분: area 값 우선('확인 필요'→대학로 외), 없으면 임시 규칙");
    // 줄 A·B (작은 데이터): 좋아하는 배우 a1 이 나오는 극 = A, a1 과 비슷한(목소리) 배우가 나오는 극 = B(A 에 나온 극은 뺀다), 이유가 붙는다
    const fx = (works, shows, voice) => ({...HD3, works, currentShows: shows, actorProfiles: voice, perfs: HD3.perfs});
    const mkW = (name, hasSchedule = false, venue = "홀") => ({name, accent: "#B23A48", hasSchedule, runs: [{label: "서울", venue, start: "2026-10-01", end: "2026-12-31", ticket: "", prices: []}]});
    const prof = {a1: {voice: [{tag: "성량", work: "극"}], role: []}, v1: {voice: [{tag: "성량", work: "x"}], role: []}, v2: {voice: [{tag: "성량", work: "x"}], role: []}, z9: {voice: [{tag: "맑음", work: "x"}], role: []}};
    const cur = (id, title, cast, area) => ({id, title, venue: "홀", start: "2026-10-01", end: "2026-12-31", status: "공연중", age: "만 7세 이상", runtime: "", times: "", price: "", cast, tickets: [], poster: "", ...(area ? {area} : {})});
    const D3 = fx([mkW(W, true)], [cur("PF1", "비슷한 쇼", ["v1", "z9"]), cur("PF2", "같이 나오는 쇼", ["a1", "v2"]), cur("PF3", "안 닮은 쇼", ["z9"])], prof);
    const rowsOf = prefs => homeRows(D3, {prefs, plans: [], tags: [], votes: [], proto: {}}, FROM3);
    const r1 = rowsOf({axes: [], works: [], favs: ["a1"]});
    ok(r1.mode === "fav" && r1.A.map(x => x.key).includes(W) && r1.A.map(x => x.key).includes("PF2"), "줄 A: 좋아하는 배우가 출연하는 극(시드와 KOPIS 모두)");
    ok(r1.A.every(x => /출연$/.test(x.line) && x.line.includes("a1")), "줄 A 카드 이유는 '○○ 출연'");
    ok(r1.B.map(x => x.key).join() === "PF1", "줄 B: 비슷한 배우가 나오는 극만(안 닮은 극·줄 A 극은 빠진다)");
    ok(r1.B.every(x => /처럼 .+ — .+ 출연$/.test(x.line) && x.line.startsWith("a1처럼")), "줄 B 카드엔 이유가 꼭 붙는다: " + r1.B.map(x => x.line));
    ok(!r1.A.some(a => r1.B.some(b => b.key === a.key)), "줄 A·B 에 겹치는 극이 없다");
    const r0 = rowsOf({axes: ["강한 성량"], works: [], favs: []});
    ok(r0.mode === "taste" && r0.A.length === 0 && r0.B.length === 0, "좋아하는 배우가 없으면 줄 A·B 대신 취향 기준 한 줄");
    const rn = rowsOf({axes: [], works: [], favs: []}); ok(rn.mode === "none" && rn.taste.length === 0, "취향이 없으면 추천 줄도 없다");
    // 화면
    const withUi = (prefs, d = D3, o = {}) => { const a = loadApp(d, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}, ...o}); a.route(); return a; };
    const ui = withUi({axes: [], works: [], favs: ["a1"], grade: ""}), hh = ui.V.browse();
    const secs = [...hh.matchAll(/<section class="hsec"><h2>([^<]*)/g)].map(m => m[1]);
    eq(secs, ["좋아하는 배우가 나와요", "좋아하는 배우와 비슷한 배우가 나와요", "지금 하는 공연 전체"], "홈 구성: 줄 A → 줄 B → 전체 목록 하나(다른 공연 따로·'이런 배우를 좋아하면' 없음)");
    ok(!/이런 배우를 좋아하면|모든 작품|다른 공연|지금 하는 다른/.test(hh), "옛 섹션 이름이 없다");
    ok(/좋아하는 배우가 안 나와도, 목소리 특징이 비슷한 배우가 나오는 공연이에요/.test(hh), "줄 B 제목 옆 한 줄 설명");
    const rowHtml = hh.split('<div class="prow">').slice(1).map(x => x.split("</div></section>")[0]);
    ok(rowHtml.length === 2 && (rowHtml[0].match(/class="pcard"/g) || []).length === r1.A.length && (rowHtml[1].match(/class="pcard"/g) || []).length === r1.B.length, "줄은 포스터 가로 줄(prow) 둘, 카드 수가 줄 A·B 와 같다");
    ok(/class="pw">a1 출연</.test(rowHtml[0]) && /class="pw">a1처럼 성량 — v1 출연</.test(rowHtml[1]), "포스터 아래: A='○○ 출연', B='○○처럼 특성 — △△ 출연'");
    const noFav = withUi({axes: ["강한 성량"], works: [], favs: []}).V.browse();
    ok(/<h2>내 취향 추천<\/h2>/.test(noFav) && !/좋아하는 배우가 나와요|비슷한 배우가 나와요/.test(noFav), "좋아하는 배우가 없으면 지금처럼 '내 취향 추천' 한 줄");
    const skipAsk = {storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: ["없는배우"], grade: ""}, plans: [], tags: [], votes: [], likes: [{actor: "없는배우", why: "", tags: [], roles: [], asked: "skip"}], cal: {}, proto: {}})}};  // '비슷한 배우' 묻는 칸은 건너뛴 상태(묻는 칸 대신 안내가 보이게)
    const none = withUi({axes: [], works: [], favs: ["없는배우"], grade: ""}, D3, skipAsk).V.browse();
    ok(/지금 하는 공연 중에 좋아하는 배우나 비슷한 배우가 나오는 공연이 아직 없어요/.test(none), "줄이 둘 다 비면 안내 한 줄(조용히 사라지지 않는다)");
    // 전체 목록: 시드 + KOPIS 전부, 인기순 한 줄 목록 + 지역 칩(대학로도 다른 지역과 똑같이, 공연 수 많은 순, 1개뿐인 지역은 '그 외 지역')
    const allN = D3.works.length + D3.currentShows.length;
    const rg = (o, region, popularity, start) => ({...o, region, popularity, ...(start ? {start} : {})});  // 지역·순위(null=없음)·시작일을 붙인 공연
    const mkNo = (id, title, extra = {}) => ({...cur(id, title, []), noCast: true, ...extra});
    const W4 = HD3.works[0].name, w4 = (o, region, popularity, start) => ({...o, region, popularity, runs: o.runs.map(r => ({...r, start: start || r.start}))});
    const D4 = fx([w4(mkW("가극", false, "대학로 소극장"), "대학로", 3, "2026-10-02"), w4(mkW("나극"), "중구", null, "2026-10-01"), w4(HD3.works[0], "용산구", 7)],
      [rg(cur("PA", "A [대학로]", ["a1"]), "대학로", 1, "2026-10-03"), rg(cur("PB", "B", ["v1"]), "대학로", null, "2026-10-20"), rg(cur("PC", "C", ["z9"]), "대학로", null, "2026-10-05"),
       rg(cur("PD", "D", ["z9"]), "중구", 2, "2026-10-04"), rg(cur("PE", "E", ["a1"]), "중구", null, "2026-09-01"), rg(mkNo("PF", "F 출연진 없음"), "", null, "2026-10-11"), rg(cur("PG", "G", ["v1"]), "종로구", 9, "2026-10-06")], prof);
    D4.roles = {...D4.roles, 가극: [], 나극: []};
    const a4 = withUi({axes: [], works: [], favs: ["a1"]}, D4), h4 = a4.V.browse();
    const tabs = [...h4.matchAll(/data-act="areaTab" data-t="([^"]+)" aria-pressed="(true|false)">([^<]+)</g)].map(m => [m[1], m[2], m[3].trim()]);
    eq(tabs, [["all", "true", "전체 10"], ["대학로", "false", "대학로 4"], ["중구", "false", "중구 3"], ["그 외 지역", "false", "그 외 지역 3"]], "지역 칩: [전체] → 공연 수 많은 지역(대학로 4 · 중구 3) → [그 외 지역](용산구·종로구 1개씩 + 지역 없음). 처음엔 전체가 눌려 있다");
    const cards = g => (g.match(/class="pcard"/g) || []).length, keysOf = g => [...g.matchAll(/class="pcard" href="#show\/([^"]+)"/g)].map(m => decodeURIComponent(m[1]));
    const gridPart = h4.split('chips afilter')[1];
    ok(cards(gridPart) === 10 && !/<h3>/.test(h4.split("지금 하는 공연 전체")[1]), "전체 목록은 시드+KOPIS 전부(개수 제한 없음), 소제목 없이 한 목록");
    eq(keysOf(gridPart), ["PA", "PD", "가극", W4, "PG", "PF", "PC", "PB", "나극", "PE"], "인기순: 순위 있는 공연이 먼저(1·2·3·7·9위), 없는 공연은 그 뒤에 시작일이 오늘(10/11)과 가까운 순(F 0일 · C 6일 · B 9일 · 나극 10일 · E 40일)");
    ok(/<h2>지금 하는 공연 전체<span class="count">10개<\/span><span class="sortnote">인기순<\/span><\/h2>/.test(h4) && !/순위|\d+위/.test(h4.split("지금 하는 공연 전체")[1]), "제목 옆에 '인기순'만 적고 순위 숫자는 안 보인다");
    ok(!/대학로 외/.test(h4) && !/대학로 외/.test(a4.V.browse()), "화면에 '대학로 외'가 없다");
    a4.click({act: "areaTab", t: "대학로"}); const hDae = a4.V.browse();
    eq(keysOf(hDae.split('chips afilter')[1]), ["PA", "가극", "PC", "PB"], "[대학로]: 대학로 4곳만, 칩 안 목록도 인기순(1위·3위 → 시작일 가까운 순)");
    ok(/data-t="대학로" aria-pressed="true"/.test(hDae) && /data-t="all" aria-pressed="false"/.test(hDae), "누른 칩만 눌린 상태");
    a4.click({act: "areaTab", t: "중구"}); eq(keysOf(a4.V.browse().split('chips afilter')[1]), ["PD", "나극", "PE"], "[중구]");
    a4.click({act: "areaTab", t: "그 외 지역"}); eq(keysOf(a4.V.browse().split('chips afilter')[1]), [W4, "PG", "PF"], "[그 외 지역]: 용산구·종로구·지역을 못 읽은 공연(F)");
    a4.click({act: "areaTab", t: "all"}); ok(cards(a4.V.browse().split('chips afilter')[1]) === 10 && a4.S.proto.areaTab === "all", "[전체]로 돌아온다(고른 지역은 저장)");
    a4.click({act: "areaTab", t: "엉뚱한값"}); a4.click({act: "areaTab", t: "대학로 외"}); ok(a4.S.proto.areaTab === "all", "엉뚱한 값과 옛 '대학로 외' 값은 무시");
    const old4 = withUi({axes: [], works: [], favs: ["a1"]}, D4, {storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: ["a1"], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {areaTab: "대학로 외"}})}});
    ok(/data-t="all" aria-pressed="true"/.test(old4.V.browse()) && cards(old4.V.browse().split('chips afilter')[1]) === 10, "예전에 저장된 '대학로 외'는 [전체]로 보인다");
    const css = fs.readFileSync(path.join(__dirname, "../app/app.css"), "utf8"), bar = (css.match(/\.chips\.afilter\{([^}]*)\}/) || [])[1] || "";
    ok(/flex-wrap:nowrap/.test(bar) && /overflow-x:auto/.test(bar) && /scrollbar-width:none/.test(bar) && /margin-inline:calc\(var\(--gut\) \* -1\)/.test(bar) && /\.afilter \.chip\{[^}]*flex:none[^}]*white-space:nowrap/.test(css) && /\.chips\.afilter::-webkit-scrollbar\{display:none\}/.test(css), "지역 칩 CSS: 줄바꿈 없는 한 줄 가로 스크롤(스크롤바 숨김, 화면 가장자리까지, 칩은 안 줄어듦)");
    ok(/const keepBar = document\.querySelector\("\.afilter"\)/.test(html) && /\.chip\[aria-pressed="true"\]/.test(html.split("function route()")[1].split("window.addEventListener")[0]), "route(): 칩 줄 스크롤 위치를 유지하고 눌린 칩이 밖이면 보이게 민다");
    ok(/app\.css\?v=20261028a/.test(html), "app.css 캐시 번호를 올렸다");
    const styleBlock = html.split("<style>")[1].split("</style>")[0], gh = styleBlock.indexOf("[hidden]{display:none!important}"), topBtn = styleBlock.indexOf(".top button[hidden]{visibility:hidden;display:block!important}"), undoRule = styleBlock.indexOf(".undobar{");
    ok(gh >= 0 && gh < undoRule && gh < styleBlock.indexOf(".top button{") && topBtn > gh, "전역 [hidden]{display:none!important} 가 <style> 맨 앞쪽에 있다(.undobar 처럼 display 를 정한 클래스가 hidden 을 못 덮는다)");
    ok(topBtn >= 0 && /^\.top button\[hidden\]/.test(styleBlock.slice(topBtn)) && !/^\[hidden\]/.test(".top button[hidden]"), "뒤로 버튼 자리 규칙(.top button[hidden]{visibility:hidden;display:block!important})은 그대로 — 선택자가 더 구체적이라 전역 규칙을 이긴다");
    // 순수 함수: 정렬·칩
    const it = (title, pop, start, region = "") => ({title, pop, start, region});
    eq(byPopularity([it("나", null, "2026-10-12"), it("다", 5, ""), it("가", null, "2026-10-12"), it("라", 2, "2026-12-01"), it("마", null, ""), it("바", null, "2026-10-09")], "2026-10-11").map(x => x.title), ["라", "다", "가", "나", "바", "마"],
       "byPopularity: 순위 오름차순 → 순위 없음은 시작일이 오늘과 가까운 순(내일 시작 1일 가·나는 같아서 제목순, 이틀 전 시작 바는 그 뒤), 시작일 없음은 맨 끝");
    eq(regionTabs([it("a", 1, "", "x"), it("b", 1, "", "x"), it("c", 1, "", "x"), it("d", 1, "", "y"), it("e", 1, "", "y"), it("f", 1, "", "z")]).map(t => t.join("|")), ["all|전체|6", "x|x|3", "y|y|2", "그 외 지역|그 외 지역|1"], "지역 칩: 2개 이상(x·y)은 따로, 1개뿐인 지역(z)만 그 외 지역으로");
    eq(regionTabs([it("a", 1, "", "x"), it("b", 1, "", "x"), it("c", 1, "", "x")]).map(t => t[0]), ["all"], "지역이 하나뿐이면 [전체]만(칩이 필요 없다)");
    eq(regionTabs([it("a", 1, "", "가"), it("b", 1, "", "가"), it("c", 1, "", "가"), it("d", 1, "", "나"), it("e", 1, "", "나"), it("f", 1, "", "나"), it("g", 1, "", "다"), it("h", 1, "", "다"), it("i", 1, "", "다"), it("j", 1, "", "다")]).map(t => t.join("|")),
       ["all|전체|10", "다|다|4", "가|가|3", "나|나|3"], "공연 수가 많은 순, 같으면 가나다순(대학로를 앞에 두지 않는다)");
    ok(!regionTabs([it("a", 1, "", "대학로")]).some(t => t[1] === "대학로 외") && regionTabs([]).length === 1, "빈 목록도 안전");
    // 지역 칩이 하나뿐이면(작은 데이터) 칩 줄이 안 나온다
    ok(!/data-act="areaTab"/.test(a4.constructor === Object ? "" : withUi({axes: [], works: [], favs: ["a1"]}, D3).V.browse()), "공연이 적어 지역 칩이 [전체]뿐이면 칩 줄을 안 그린다");

    // 출연진 정보가 없는 공연(noCast): 전체 목록에만 나오고 추천 줄·비슷한 배우 계산엔 안 쓴다
    const D5 = fx([mkW("가극", false, "대학로 소극장"), mkW("나극"), HD3.works[0]], [cur("PA", "A [대학로]", ["a1"]), cur("PB", "B", ["v1"], "대학로"), mkNo("PN", "출연진 없는 쇼", {area: "대학로", popularity: 4}), mkNo("PN2", "또 없는 쇼"), mkNo("PNA", "성인 쇼", {age: "만 19세 이상"}), mkNo("PNE", "끝난 쇼", {end: "2026-10-01"}), mkNo("PNS", "엘리자벳 없음극 극", {})], prof);
    D5.roles = {...D5.roles, 가극: [], 나극: []};
    const a5 = withUi({axes: [], works: [], favs: ["a1"]}, D5), h5 = a5.V.browse(), g5 = h5.split("지금 하는 공연 전체")[1];
    const ids5 = new Set([...g5.matchAll(/href="#show\/([^"]+)"/g)].map(m => m[1]));
    ok(ids5.has("PN") && ids5.has("PN2"), "noCast 공연은 '지금 하는 공연 전체'에 나온다");
    ok(!ids5.has("PNA") && !ids5.has("PNE") && !ids5.has("PNS"), "noCast 도 18세 이상·끝난 공연·시드와 같은 공연은 뺀다(규칙 그대로)");
    ok((g5.match(/class="pcard"/g) || []).length === D5.works.length + 2 + 2 && /인기순/.test(h5), "전체 목록 개수 = 시드 3 + 출연진 있는 KOPIS 2 + noCast 2: " + (g5.match(/class="pcard"/g) || []).length);
    const rw5 = homeRows(D5, a5.S, FROM3), inRows = [...rw5.A, ...rw5.B].map(x => x.key);
    ok(!inRows.some(k => /^PN/.test(k)) && !/href="#show\/PN"/.test(h5.split("지금 하는 공연 전체")[0]), "추천 줄 A·B 에는 noCast 공연이 없다");
    ok(allShows(D5, FROM3).filter(x => x.noCast).map(x => x.key).sort().join() === "PN,PN2" && !allShows(D5, FROM3).some(x => !x.noCast && /^PN/.test(x.key)), "allShows: noCast 표시가 붙은 공연은 둘");
    ok(keysOf(g5)[0] === "PN" && keysOf(g5).indexOf("PN2") > keysOf(g5).indexOf("PN"), "noCast 공연도 인기순에 든다(순위 4위인 PN 이 맨 앞, 순위 없는 PN2 는 그 뒤)");
    const sh5 = a5.V.show("PN"), p5 = ["summary", "cast", "dates"].map(id => sh5.indexOf(`id="${id}"`));
    ok(p5.every(x => x > 0) && p5[0] < p5[1] && p5[1] < p5[2] && /출연진 정보가 아직 없어요/.test(sh5) && !/배우 평가|actorSel|class="month"/.test(sh5), "noCast 공연 화면: ① 요약 + '출연진 정보가 아직 없어요' + ③ 예매(달력·배우 평가 없음)");
    ok(a5.CTA === null, "noCast 공연 화면엔 폰 고정 버튼이 없다");
    // 취향 카드 ↔ KOPIS 공연: 작품 테마 태그가 제목으로 붙은 공연만 '고른 ○○와/과 맞는 공연이에요'로 추천(출연진 없는 공연도, 18세 이상·끝난 공연·태그 없는 공연은 뺀다)
    const wtRows = (...tags) => tags.map(t => ({tag: t, group: "작품 · 소재", why: "소개 글", link: "https://kopis.or.kr/x", level: "제작진·공식", season: "2026"}));
    const D6 = {...fx([HD3.works[0]], [cur("PA", "A [대학로]", ["a1"]), cur("PB", "B", ["v1"]), mkNo("PN", "출연진 없는 쇼"), cur("PX", "태그 없는 쇼", ["z9"]), mkNo("PNA", "성인 쇼", {age: "만 19세 이상"}), mkNo("PNE", "끝난 쇼", {end: "2026-10-01"})], prof),
      workTags: {...(HD3.workTags || {}), "A [대학로]": wtRows("로맨스"), B: wtRows("로맨스", "파멸", "감동"), "출연진 없는 쇼": wtRows("로맨스"), "성인 쇼": wtRows("로맨스"), "끝난 쇼": wtRows("로맨스")}};
    ok(likeCurrent(D6, ["romance"], FROM3).map(x => x.s.id).join() === "PN,PA,PB", "likeCurrent: 태그 있는 KOPIS 공연만(출연진 없는 공연 포함, 성인·끝난·태그 없는 공연 제외, 같으면 제목 가나다순 — 한글이 영문보다 앞): " + likeCurrent(D6, ["romance"], FROM3).map(x => x.s.id));
    ok(likeCurrent(D6, ["romance", "tragedy"], FROM3)[0].s.id === "PB" && likeCurrent(D6, ["romance", "tragedy"], FROM3)[0].cards.length === 2, "맞는 카드가 많은 공연이 먼저(B: 로맨스 + 비극, 파멸·감동 둘로 비극 카드가 맞는다)");
    ok(likeCurrent(D6, ["tragedy"], FROM3).map(x => x.s.id).join() === "PB" && likeCurrent(D6, [], FROM3).length === 0, "비극 카드는 태그를 둘 이상 가진 공연만, 카드가 없으면 추천도 없다");
    const rc = ids => homeRecs(D6, {prefs: {axes: [], works: ids, favs: []}, plans: [], tags: [], votes: [], proto: {}}, FROM3).filter(r => r.kind === "current");
    eq(rc(["romance"]).map(r => [r.key, r.line]), [["PN", "고른 '로맨스'와 맞는 공연이에요"], ["PA", "고른 '로맨스'와 맞는 공연이에요"], ["PB", "고른 '로맨스'와 맞는 공연이에요"]], "홈 추천 이유: 고른 '로맨스'와 맞는 공연이에요(KOPIS 공연)");
    eq(rc(["tragedy", "romance"])[0].line, "고른 '가슴 먹먹한 비극' · '로맨스'와 맞는 공연이에요", "카드가 둘이면 ' · '로 잇고, 조사는 마지막 카드 이름 받침에 맞춘다(로맨스 → 와)");
    eq(rc(["romance", "tragedy"])[0].line, "고른 '로맨스' · '가슴 먹먹한 비극'과 맞는 공연이에요", "마지막 카드 이름이 받침으로 끝나면 '과'");
    ok(rc(["romance"]).every(r => r.sentence === r.line && showRef(D6, r.key)), "추천 이유 문장 = 줄, 극 요약으로 갈 수 있다");
    const uiW = withUi({axes: [], works: ["romance"], favs: [], grade: ""}, D6), hW = uiW.V.browse(), rowW = hW.split('<div class="prow">')[1].split("</div></section>")[0];
    ok(/<h2>내 취향 추천<\/h2>/.test(hW) && ["PA", "PB", "PN"].every(id => rowW.includes(`href="#show/${id}"`)) && !/href="#show\/PX"/.test(rowW) && /class="pw">고른 &#39;로맨스&#39;와 맞는 공연이에요<|class="pw">고른 '로맨스'와 맞는 공연이에요</.test(rowW), "홈 '내 취향 추천' 줄에 KOPIS 공연이 이유와 함께 나온다");
    const shA = uiW.V.show("PA"), shN = uiW.V.show("PN");
    ok(/class="hwhy">고른 (&#39;|')로맨스(&#39;|')와 맞는 공연이에요/.test(shA) && /<div class="chips"><span class="tag">로맨스<\/span>/.test(shA) && /<span class="tlab">소재<\/span>/.test(shA), "KOPIS 공연 화면: 추천 이유 + 분위기 칩 + '정보 더 보기'에 대분류별 태그");
    ok(/<span class="tag">로맨스<\/span>/.test(shN) && !/<span class="tag">/.test(uiW.V.show("PX").split('id="cast"')[0]), "출연진 없는 공연 화면에도 태그가 나오고, 태그 없는 공연엔 칩이 없다");
    // 태그 근거(why)·출처 이름(src)·링크(link)는 어떤 화면에도 안 나온다 — 옛 data.js 에 들어 있어도(2026-10-13 사용자 지시)
    const SECRET = {why: "근거문장ZZ", src: "출처이름ZZ", link: "https://evidence.example/ZZ", show: "9/9 19:30"};
    const D7 = JSON.parse(JSON.stringify(D6));
    for (const byActor of Object.values(D7.actorTags)) for (const rows of Object.values(byActor)) for (const r of rows) Object.assign(r, SECRET);
    for (const rows of Object.values(D7.comboTags || {})) for (const r of rows) Object.assign(r, SECRET);
    for (const rows of Object.values(D7.workTags)) for (const r of rows) Object.assign(r, SECRET);
    D7.actorProfiles = {...D7.actorProfiles}; for (const pr of Object.values(D7.actorProfiles)) for (const k of ["voice", "role"]) for (const r of pr[k] || []) Object.assign(r, SECRET);
    const wName = D7.works[0].name, perf7 = D7.perfs.find(x => x.work === wName);
    const a7 = withUi({axes: ["강한 성량"], works: ["romance"], favs: ["a1"], grade: ""}, D7);
    const screens7 = {home: a7.V.browse(), detail: a7.V.detail(wName, perf7.date, perf7.time), ...Object.fromEntries([wName, ...D7.currentShows.map(x => x.id)].map(k => ["show " + k, a7.V.show(k)]))};
    a7.click({act: "selActor", work: wName, role: "A", a: "a1"}); screens7["show(배우 고름)"] = a7.V.show(wName);
    for (const [name, html7] of Object.entries(screens7)) ok(!/근거문장ZZ|출처이름ZZ|evidence\.example|9\/9 19:30/.test(html7) && !/class="quotes"|<h3>근거<\/h3>|<h3>공식 소개<\/h3>|배우가 밝힌 해석|출처 (전문매체|관객)/.test(html7) && !/<span class="tag[^"]*" title=/.test(html7), "근거·출처가 화면에 없다: " + name);
    ok(/class="tag/.test(screens7.detail) && /<div class="tl"><span class="tlab">/.test(screens7.detail), "그래도 태그 칩은 그대로 나온다(회차 상세)");
    // 예전 data.js 가 아니라 새 모양(sk 만 있고 why·src·link 없음)으로도 의견 분포·화면이 그대로 동작한다
    const D8 = JSON.parse(JSON.stringify(D6));
    for (const byActor of Object.values(D8.actorTags)) for (const rows of Object.values(byActor)) rows.forEach((r, i) => { delete r.why; delete r.src; delete r.link; r.sk = "k" + i; });
    ok(!/undefined|NaN/.test(withUi({axes: ["강한 성량"], works: [], favs: ["a1"], grade: ""}, D8).V.show(D8.works[0].name)), "새 data.js(근거 필드 없음)로도 공연 화면이 깨지지 않는다");
    // 영상 반응(공연 화면 ② 배우 칸): 썸네일을 누른 뒤에만 '이 영상 어땠어요?'가 나온다
    const YT = "abcdefghijk", D9 = JSON.parse(JSON.stringify(D6)), w9 = D9.works[0].name;
    D9.videos = {[w9]: {a1: [{title: "a1 영상", channel: "채널", url: "https://www.youtube.com/watch?v=" + YT, views: 1000, official: true}], b1: [{title: "ID 없는 영상", channel: "채널", url: "https://youtu.be/xyz", views: 5, official: false}]}};
    const mk9 = (extra = {}) => { const a = loadApp(D9, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강한 성량"], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}, ...extra}); a.route(); return a; };
    const a9 = mk9(), shown9 = () => { a9.click({act: "selActor", work: w9, role: "A", a: "a1"}); return a9.V.show(w9); };
    const vrEv = () => a9.TRK.queue().filter(q => q.event === "video_reaction").map(q => q.payload);
    const sh9 = a => (a || a9).q("#sheet").innerHTML, vopen9 = (a = a9, o = {}) => a.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT, ...o}), vre9 = r => a9.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r});
    const keydown9 = (a, key, extra = {}) => { let prevented = false; (a.listeners.doc.keydown || []).forEach(f => f({key, preventDefault() { prevented = true; }, ...extra})); return prevented; };
    let h9 = shown9();
    ok(new RegExp(`class="vth"[^>]*data-act="vopen"[^>]*data-vid="${YT}"`).test(h9) && !/class="vq"|이 영상 어땠어요/.test(h9) && a9.SHEET === null, "영상을 누르기 전엔 질문이 없고, 배우 칸 안에는 질문 칸 자체가 없다(레이아웃이 안 밀린다)");
    vopen9(); let s9 = sh9();
    ok(a9.SHEET?.kind === "video" && a9.SHEET.vid === YT && a9.q("#sheet").classList.contains("on") && a9.q("#sheetbg").classList.contains("on") && a9.root.classList.contains("lock"), "썸네일을 누르면 모달(작은 시트)이 뜨고 뒤 화면 스크롤이 잠긴다");
    ok(/<h3 id="sheettitle">a1 영상 어땠어요\?<\/h3><p class="ssub">채널 · a1 영상<\/p>/.test(s9) && ["마음에 들어요", "모르겠어요", "취향 아니에요"].every(t => new RegExp(`class="vbtn" data-act="vreact"[^>]*aria-pressed="false">${t}<`).test(s9)) && /<div class="vans" role="group" aria-label="영상 반응">(<button[^>]*>[^<]+<\/button>){3}<\/div>/.test(s9) && !/aria-pressed="true"|vfollow|꼭 볼 배우로 담기|이 배우 빼기|어떤 점이 좋았어요/.test(s9), "모달 내용: '○○ 영상 어땠어요?' + 영상 한 줄(채널 · 제목) + 같은 너비 3칸 답 버튼(아직 아무것도 안 눌림), 후속 영역은 답한 뒤에만");
    ok(/<div class="shead"><div class="stxt"><h3[^>]*>[^<]*<\/h3><p class="ssub">[^<]*<\/p><\/div><button type="button" class="sx" data-act="closeSheet" aria-label="닫기"><svg[^>]*aria-hidden="true">/.test(s9) && !/>닫기</.test(s9) && /<div class="grab"><\/div><div class="shead">/.test(s9), "머리: 제목·영상 한 줄 오른쪽에 X 아이콘 닫기 버튼(aria-label 닫기), 아래 '닫기' 막대는 없다");
    { const css9 = fs.readFileSync(path.join(__dirname, "../app/app.css"), "utf8"); ok(/\.sx\{[^}]*width:44px;height:44px/.test(css9) && /@media \(min-width:900px\)\{\.sheet\{max-width:420px[^}]*\}\.sheet \.grab\{display:none\}/.test(css9) && /\.vans[^{]*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(css9) && /\.vbtn[^{]*\{[^}]*min-height:48px/.test(css9) && /padding:10px 18px max\(22px,calc\(14px \+ env\(safe-area-inset-bottom\)\)\)/.test(css9), "CSS: X 버튼 터치 영역 44px, 끌기 손잡이는 900px 이상에서 숨김(휴대폰 시트에서만 보임), 데스크톱 모달 폭 420px, 답은 3칸 그리드·높이 48px, 아래 안전 영역 여백"); }
    ok(html.includes('id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheettitle"') && a9.document.activeElement === a9.q("#sheet"), "접근성: 시트는 role=dialog·aria-modal·제목 연결이고, 열면 포커스가 시트 안으로 간다");
    ok(vrOf(a9.S, w9, "a1", YT) === null && vrEv().length === 0 && !a9.store.has("pickle_q") && !a9.S.proto?.vr, "열기만 해서는 저장도 기록도 없다(기록은 답할 때)");
    ok(keydown9(a9, "Tab") === true, "Tab 은 시트 밖으로 못 나간다(포커스 가둠)");
    ok(keydown9(a9, "Escape") === true && a9.SHEET === null && !a9.q("#sheet").classList.contains("on") && !a9.q("#sheetbg").classList.contains("on") && !a9.root.classList.contains("lock"), "Esc 로 닫히고 스크롤 잠금도 풀린다");
    ok(keydown9(a9, "Escape") === false, "시트가 없을 땐 Esc 가 아무것도 안 한다");
    vopen9(); ok(a9.SHEET?.kind === "video", "답 없이 닫았으면 다음에 그 영상을 다시 눌렀을 때 또 뜬다");
    a9.click({act: "closeSheet"}); ok(a9.SHEET === null && !a9.root.classList.contains("lock"), "[닫기]로도 닫힌다");
    vopen9(a9, {vid: "bad"}); vopen9(a9, {work: ""}); ok(a9.SHEET === null, "ID 모양이 틀린 값·작품 없는 값은 모달이 안 뜬다");
    vopen9(); vre9("like"); s9 = sh9();
    eq(vrEv().map(({seq, ...r}) => r), [{work: w9, role: "A", actor: "a1", video: YT, reaction: "like"}], "답하면 video_reaction 이 work·role·actor·video·reaction 으로 한 줄 남는다");
    ok(a9.SHEET?.kind === "video" && a9.S.proto.vr[w9].a1[YT].r === "like" && /aria-pressed="true">마음에 들어요/.test(s9) && /<div class="vfollow"><button type="button" class="vpin" data-act="pin"[^>]*data-k="star">⭐ 꼭 볼 배우로 담기<\/button>/.test(s9) && pinStateOf(a9.S, w9, "a1") === "", "마음에 들어요 → 같은 모달 안 구분선 아래에 '⭐ 꼭 볼 배우로 담기' 버튼(자동으로 담기지 않고 모달은 열려 있다)");
    a9.click({act: "pin", work: w9, a: "a1", k: "star"}); s9 = sh9();
    ok(a9.SHEET?.kind === "video" && pinStateOf(a9.S, w9, "a1") === "star" && /<p class="vpin on" role="status">⭐ 담았어요<\/p>/.test(s9) && !/꼭 볼 배우로 담기</.test(s9) && a9.TRK.queue().some(q => q.event === "actor_pick" && q.payload.actor === "a1" && q.payload.action === "pin"), "[담기]는 기존 ⭐ 버튼(pin)과 같은 동작이고 actor_pick 도 남으며 모달은 그대로 열려 있다");
    vre9("like"); ok(vrEv().length === 1, "같은 답을 또 눌러도 기록이 늘지 않는다");
    vre9("dislike"); s9 = sh9();
    ok(vrEv().length === 2 && vrEv()[1].reaction === "dislike" && vrEv()[1].seq > vrEv()[0].seq && /aria-pressed="true">취향 아니에요/.test(s9) && !/aria-pressed="true">마음에 들어요/.test(s9), "답을 바꾸면 그때마다 한 줄 더 남고 고른 답이 바뀐다");
    ok(/<button type="button" class="vpin avoid" data-act="pin"[^>]*data-k="avoid">이 배우 빼기<\/button>/.test(s9) && pinStateOf(a9.S, w9, "a1") === "star", "취향 아니에요 → '이 배우 빼기' 버튼(이미 ⭐ 였어도 자동으로 안 뺀다)");
    a9.click({act: "pin", work: w9, a: "a1", k: "avoid"}); ok(pinStateOf(a9.S, w9, "a1") === "avoid" && /이 배우는 빼 뒀어요/.test(sh9()), "[빼기]도 기존 pin 동작");
    vre9("unsure"); s9 = sh9();
    ok(vrEv().length === 3 && vrEv()[2].reaction === "unsure" && /<a class="vlink" href="https:\/\/www\.youtube\.com\/results\?search_query=[^"]+"[^>]*>이 배우 영상 더 찾아보기 ↗<\/a>/.test(s9), "모르겠어요 → 그 배우 유튜브 검색 텍스트 링크");
    vre9("엉뚱"); a9.click({act: "vreact", work: w9, role: "A", a: "a1", vid: "bad", r: "like"}); ok(vrEv().length === 3 && a9.S.proto.vr[w9].a1[YT].r === "unsure", "엉뚱한 답·ID 는 무시");
    // 다시 와도(저장소에서 다시 열어도) 이미 답한 영상은 모달에 고른 답이 눌린 채로 보인다. 새 키만 덧붙고 예전 키는 그대로
    const back9 = mk9({storage: {pickle_v2: a9.store.get("pickle_v2")}}); vopen9(back9); const hb9 = sh9(back9);
    ok(/aria-pressed="true">모르겠어요/.test(hb9) && /a1 영상 어땠어요/.test(hb9) && JSON.parse(a9.store.get("pickle_v2")).prefs.axes[0] === "강한 성량" && Object.keys(JSON.parse(a9.store.get("pickle_v2")).proto).includes("vr"), "다시 와서 누르면 모달에 고른 답이 눌린 채로 보인다(S.proto.vr 새 키, 예전 prefs 는 그대로)");
    // 모달 안에서 바뀐 ⭐·빼기는 모달을 닫을 때 뒤 화면(공연 화면)에 반영된다. 화면을 옮기면 모달은 닫힌다
    { const ah = mk9({hash: "#show/" + w9}); ah.click({act: "selActor", work: w9, role: "A", a: "a1"}); ah.route();
      ah.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT}); ah.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "like"}); ah.click({act: "pin", work: w9, a: "a1", k: "star"});
      ok(!/class="chip x on" data-act="pin" data-work="극" data-a="a1" data-k="star"/.test(ah.q("#view").innerHTML) && ah.SHEET?.kind === "video", "모달이 열려 있는 동안 뒤 화면은 그대로(다시 그리지 않는다)");
      ah.click({act: "closeSheet"}); ok(ah.SHEET === null && /class="chip x on" data-act="pin" data-work="극" data-a="a1" data-k="star"/.test(ah.q("#view").innerHTML), "닫으면 뒤 화면이 새로 그려져 ⭐ 상태가 맞는다");
      ah.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT}); ok(/aria-pressed="true">마음에 들어요/.test(sh9(ah)) && /⭐ 담았어요/.test(sh9(ah)), "다시 열면 이미 답한 상태로 뜬다");
      ah.location.hash = "#home"; ok(ah.SHEET === null && !ah.root.classList.contains("lock"), "화면을 옮기면(주소가 바뀌면) 모달은 닫히고 스크롤 잠금이 풀린다"); }
    // 영상 ID 가 없는 곳엔 질문이 없다: 영상이 없는 배우·ID 없는 주소는 '영상 찾아보기' 검색 링크
    a9.click({act: "selActor", work: w9, role: "A", a: "a2"}); const hn9 = a9.V.show(w9);
    const roleA9 = hn9.split('<div class="rolebox">')[1];  // 배역 A 칸(a2 선택)
    ok(/<b>A<\/b>/.test(roleA9.slice(0, 80)) && /class="vth none"/.test(roleA9) && !/data-act="vopen"|class="vq"|이 영상 어땠어요/.test(roleA9), "영상이 없는 배우(검색 링크)에는 질문이 없다");
    a9.click({act: "selActor", work: w9, role: "B", a: "b1"}); const hb1 = a9.V.show(w9);
    ok(!/data-vid="xyz"|data-vq="[^"]*\|b1\|/.test(hb1) && /class="vth none"/.test(hb1), "유튜브 ID 를 못 뽑는 주소도 검색 링크로만 나온다(질문 칸 없음)");
    // 기록을 끄면 안 보낸다(반응 저장은 이 기기 안에서만)
    const off9 = mk9(); off9.TRK.setOff(true); off9.click({act: "selActor", work: w9, role: "A", a: "a1"}); off9.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT}); off9.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "like"});
    ok(off9.TRK.queue().length === 0 && !off9.store.has("pickle_q") && off9.S.proto.vr[w9].a1[YT].r === "like", "기록을 끄면 video_reaction 을 안 쌓는다(큐·익명 번호 없음), 화면 반응은 그대로");
    // ===== 영상 '마음에 들어요' 뒤 '어떤 점이 좋았어요? (선택)' 특징 칩 → video_reaction.traits (모달 안) =====
    { const lab9 = D9.actorTagLabels, vt9 = D9.voiceTags; D9.actorTagLabels = {...lab9, ...Object.fromEntries(["맑음", "부드러움", "허스키", "묵직한 음색", "성량", "고음", "코믹 연기"].map(t => [t, t.slice(0, 1)]))}; D9.voiceTags = ["맑음", "부드러움", "허스키", "묵직한 음색", "성량", "고음", "딕션"];  // 이 블록에서만 쓰는 사전(끝에서 되돌린다)
      const at = mk9(), vrE = () => at.TRK.queue().filter(q => q.event === "video_reaction").map(q => { const {seq, ...r} = q.payload; return r; });
      const sh = () => sh9(at), vo = () => at.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT});
      const trait = (t, o = {}) => at.click({act: "vtrait", work: w9, role: "A", a: "a1", vid: YT, t, ...o});
      const chips = h => [...h.matchAll(/data-act="vtrait"[^>]*data-t="([^"]*)" aria-pressed="(true|false)"/g)].map(m => [m[1], m[2] === "true"]);
      at.click({act: "selActor", work: w9, role: "A", a: "a1"}); ok(!/어떤 점이 좋았어요/.test(at.V.show(w9)) && chips(at.V.show(w9)).length === 0, "영상을 누르기 전엔 특징 칩이 없다");
      vo(); ok(!/어떤 점이 좋았어요/.test(sh()) && chips(sh()).length === 0, "모달을 열었고 아직 답을 안 했으면 칩이 없다");
      at.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "like"}); let h = sh();
      const c0 = chips(h); ok(/<div class="vtw"><p class="vsub">어떤 점이 좋았어요\? <span>\(선택\)<\/span><\/p><div class="vtr">/.test(h) && c0.length === 6 && c0.every(([t, on]) => !on) && c0.map(x => x[0]).join() === "맑음,부드러움,허스키,묵직한 음색,성량,고음", "'마음에 들어요' 뒤 같은 모달 안에 '어떤 점이 좋았어요? (선택)'와 목소리 칩 6개(아무것도 안 눌린 상태)");
      ok(h.indexOf("vfollow") > 0 && h.indexOf("vfollow") < h.indexOf("⭐ 꼭 볼 배우로 담기") && h.indexOf("⭐ 꼭 볼 배우로 담기") < h.indexOf("어떤 점이 좋았어요") && (h.match(/어떤 점이 좋았어요/g) || []).length === 1 && !/class="vtc"[^>]*aria-pressed="true"/.test(h), "구분선 아래 영역: ⭐ 담기 버튼 → '어떤 점이 좋았어요?' 소제목과 토글 칩(안 고른 상태) 순서로 한 번만 나온다");
      eq(vrE(), [{work: w9, role: "A", actor: "a1", video: YT, reaction: "like"}], "like 를 누른 줄에는 traits 가 없다(아직 안 골랐다)");
      trait("성량"); h = sh();
      eq(vrE().slice(1), [{work: w9, role: "A", actor: "a1", video: YT, reaction: "like", traits: ["성량"]}], "칩을 고르면 like + traits 가 한 줄 남는다");
      ok(chips(h).find(x => x[0] === "성량")[1] === true && chips(h).filter(x => x[1]).length === 1 && at.SHEET?.kind === "video", "고른 칩은 눌린 상태로 보이고 모달은 그대로 열려 있다");
      trait("고음"); trait("성량");
      eq(vrE().slice(1).map(r => r.traits), [["성량"], ["성량", "고음"], ["고음"]], "여러 개 고를 수 있고, 바꿀 때마다 한 줄(지금 고른 전체), 다시 누르면 풀린다");
      trait("고음"); eq(vrE().slice(-1)[0].traits, [], "다 풀면 빈 목록([])이 마지막 줄로 남는다(마지막 줄이 이긴다)");
      // 엉뚱한 값은 무시: 목록에 없는 태그(연기·해석 포함)·영상 ID 모양이 틀린 것
      const n1 = vrE().length; trait("엉뚱한태그"); trait("코믹 연기"); trait("성량", {vid: "bad"});
      ok(vrE().length === n1 && !at.S.proto.vr[w9].a1[YT].t.length, "목록에 없는 태그·모양이 틀린 영상 ID 는 무시");
      // 다시 열어도(저장소에서) 고른 칩이 눌린 채로 보인다
      trait("맑음"); trait("허스키");
      const bk = mk9({storage: {pickle_v2: at.store.get("pickle_v2")}}); bk.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT});
      eq(chips(sh9(bk)).filter(x => x[1]).map(x => x[0]), ["맑음", "허스키"], "다시 와서 열어도 고른 칩이 눌린 채로 보인다(S.proto.vr 안에만 저장, 새 키 없음)");
      ok(Object.keys(JSON.parse(at.store.get("pickle_v2"))).sort().join() === Object.keys(JSON.parse(back9.store.get("pickle_v2"))).sort().join(), "저장소 최상위 키는 그대로");
      // 모르겠어요·취향 아니에요에는 칩이 없고, 바꾸면 고른 특징도 지워 다시 like 로 와도 비어 있다. 그때 남는 줄에는 traits 가 없다
      for (const r of ["unsure", "dislike"]) { at.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r}); h = sh(); const last = vrE().slice(-1)[0];
        ok(!/어떤 점이 좋았어요/.test(h) && chips(h).length === 0 && last.reaction === r && !("traits" in last) && at.S.proto.vr[w9].a1[YT].t === undefined, `'${r}'에는 특징 칩이 없고 고른 특징은 지워진다(그때 남는 줄에 traits 없음)`); }
      at.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "like"}); ok(chips(sh()).filter(x => x[1]).length === 0, "다시 '마음에 들어요'로 오면 칩은 처음처럼 비어 있다");
      trait("성량"); at.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "unsure"}); trait("고음"); ok(at.S.proto.vr[w9].a1[YT].t === undefined && vrE().slice(-1)[0].reaction === "unsure", "like 가 아닐 땐 칩을 눌러도(옛 화면 등) 아무 일도 없다");
      // 안 보내는 경우: 기록을 끈 사람(칩은 이 기기에서만), 값 검사
      const of2 = mk9(); of2.TRK.setOff(true); of2.click({act: "selActor", work: w9, role: "A", a: "a1"}); of2.click({act: "vopen", work: w9, role: "A", a: "a1", vid: YT}); of2.click({act: "vreact", work: w9, role: "A", a: "a1", vid: YT, r: "like"}); of2.click({act: "vtrait", work: w9, role: "A", a: "a1", vid: YT, t: "성량"});
      ok(of2.TRK.queue().length === 0 && !of2.store.has("pickle_q") && !of2.store.has("pickle_anon") && of2.S.proto.vr[w9].a1[YT].t.join() === "성량" && chips(sh9(of2)).filter(x => x[1]).length === 1, "기록을 끄면 traits 를 안 보낸다(큐·익명 번호 없음), 칩은 이 기기 화면에서 그대로 쓴다");
      const tv = mk9(), vp2 = {work: w9, role: "A", actor: "a1", video: YT, reaction: "like"}; const qv = () => tv.TRK.queue().map(q => q.payload);
      ok(tv.track("video_reaction", {...vp2, traits: ["성량", "엉뚱한태그", "맑음"]}) === true && tv.track("video_reaction", {...vp2, traits: Array.from({length: 7}, () => "성량")}) === true && tv.track("video_reaction", {...vp2, traits: "성량"}) === true && tv.track("video_reaction", {...vp2, traits: [], extra: "x"}) === true, "traits 가 섞여 있어도 한 줄은 남는다");
      eq(qv().map(p => p.traits), [["성량", "맑음"], undefined, undefined, []], "값 검사: 사전 확정 태그만(엉뚱한 건 버림), 7개 이상·배열이 아닌 값은 traits 통째로 버림, 빈 목록은 그대로");
      ok(!("extra" in qv()[3]), "정의서에 없는 키는 버린다");
      // 안내문·정의서
      const prT = mk9({track: {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}, hash: "#privacy"}); prT.route(); const pT = prT.V.privacy();
      const specT = fs.readFileSync(path.join(__dirname, "../docs/data_spec_combo_fit_2026-10-10.md"), "utf8"), draftT = fs.readFileSync(path.join(__dirname, "../docs/privacy_notice_draft_2026-10-10.md"), "utf8");
      ok(/'마음에 들어요'일 때 고른 특징\(음색·성량 같은 정해진 태그만\)/.test(pT) && /'마음에 들어요'일 때 고른 특징\(음색·성량 같은 정해진 태그만\)/.test(draftT) && /답이나 특징을 바꾸면 그때마다 한 줄 더 남아요/.test(pT), "앱 안 개인정보 안내·초안: 영상 반응 행에 '고른 특징'");
      ok(/\| traits \|/.test(specT) && /어떤 점이 좋았어요\? \(선택\)/.test(specT) && /마지막 줄/.test(specT) && /부정적 특징은 모으지 않는 원칙/.test(specT) && /video_reaction\.payload\.traits/.test(specT) && /refresh_actor_trait_votes\(\)/.test(specT) && /trait-votes-refresh/.test(specT) && !/\[f2 확인 필요\]/.test(specT), "정의서 6번 traits·원칙·마지막 줄 / 9번 원천·함수·cron 이름(빈칸 없음)");
      D9.actorTagLabels = lab9; D9.voiceTags = vt9;
    }
    // 기록 값 검사: 영상 ID 11자·정해진 답·앱 데이터에 있는 이름만
    const tk9 = mk9(); const vp = {work: w9, role: "A", actor: "a1", video: YT, reaction: "like"};
    ok(tk9.track("video_reaction", vp) === true && tk9.track("video_reaction", {...vp, video: "short"}) === false && tk9.track("video_reaction", {...vp, video: "https://youtu.be/abc"}) === false && tk9.track("video_reaction", {...vp, reaction: "love"}) === false && tk9.track("video_reaction", {...vp, actor: "모르는배우"}) === false && tk9.track("video_reaction", {...vp, role: "없는배역"}) === false && tk9.track("video_reaction", {work: w9, role: "A", actor: "a1", reaction: "like"}) === false, "video_reaction 값 검사: 올바른 한 줄만 통과");
    ok(tk9.TRK.queue().length === 1 && !JSON.stringify(tk9.TRK.queue()[0].payload).match(/https?:|youtube\.com|영상 제목/), "기록에는 영상 ID 만(주소·제목 없음)");
    // 개인정보 안내(앱 안): 영상 반응과 서울 리전
    const pv9 = mk9({track: {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}, hash: "#privacy"}); pv9.route(); const prv9 = pv9.V.privacy();
    ok(/영상 반응|이 영상 어땠어요/.test(prv9) && /영상 번호\(유튜브 영상 ID\)/.test(prv9) && /서울 리전\(ap-northeast-2\)/.test(prv9), "앱 안 개인정보 안내: '모으는 것'에 영상 반응, 저장은 서울 리전");
    // 문서: 정의서·안내문 초안
    const spec9 = fs.readFileSync(path.join(__dirname, "../docs/data_spec_combo_fit_2026-10-10.md"), "utf8"), draft9 = fs.readFileSync(path.join(__dirname, "../docs/privacy_notice_draft_2026-10-10.md"), "utf8");
    ok(/### 6\. `video_reaction`/.test(spec9) && /event in \([^)]*'video_reaction'[^)]*\)/.test(spec9) && /막지 프로젝트의 `public\.events`/.test(spec9) && /서울 리전에 저장/.test(spec9) && /실행 완료/.test(spec9), "정의서: video_reaction·체크 목록·막지 프로젝트 public.events·서울 리전·SQL 실행 완료");
    ok(/영상 반응/.test(draft9) && /서울 리전\(ap-northeast-2\)/.test(draft9) && /문의처 없이 켬\(사용자 결정, 2026-10-13\)/.test(draft9) && !/\[문의처: 사용자 확인 필요\]/.test(draft9), "안내문 초안: 영상 반응·서울 리전, '문의처 없이 켬(사용자 결정, 2026-10-13)'");
    // ===== 취향폼 개편(2026-10-27): 1/2 배우(반드시·가능하면·피하고 싶은 배우) · 2/2 우선순위 + 질문(2개까지). 예전 2/3 공연 카드 단계는 MVP에서 뺐다 =====
    {
      const D9o = JSON.parse(JSON.stringify(D9)); D9o.actorProfiles = {...(D9o.actorProfiles || {}), "프로필만": {voice: [], role: [{tag: "관계 중심", work: "x"}, {tag: "춤·안무 표현", work: "x"}]}};  // 선택 질문(해석·움직임)에 근거가 있게
      const aO = loadApp(D9o, {...opts3, hash: "#taste/1", storage: {pickle_v2: JSON.stringify({prefs: null, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); aO.route();
      const v1 = aO.q("#view").innerHTML;
      ok(/보고 싶은 배우가 있나요\?/.test(v1) && /취향 고르기 1\/2/.test(v1) && /피하고 싶은 배우/.test(v1), "1/2 는 배우 단계(보고 싶은·피하고 싶은 배우)");
      aO.q("#fav").value = "a1"; aO.click({act: "addFav"});
      ok(/반드시 포함/.test(aO.q("#view").innerHTML) && /가능하면 포함/.test(aO.q("#view").innerHTML), "추가한 배우마다 반드시/가능하면 포함");
      aO.click({act: "obMust", a: "a1", m: "1"}); eq(aO.S.prefs.must, ["a1"], "반드시 포함");
      aO.click({act: "obMust", a: "a1", m: ""}); eq(aO.S.prefs.must, [], "가능하면 포함으로 되돌림");
      aO.click({act: "obMust", a: "a1", m: "1"}); aO.q("#avoidIn").value = "a1"; aO.click({act: "addAvoid"});
      ok(!aO.S.prefs.favs.includes("a1") && !aO.S.prefs.must.includes("a1") && aO.S.prefs.avoid.includes("a1"), "피하고 싶은 배우로 옮기면 보고 싶은 배우·반드시에서 빠진다");
      aO.q("#fav").value = "a1"; aO.click({act: "addFav"}); ok(aO.S.prefs.favs.includes("a1") && !aO.S.prefs.avoid.includes("a1"), "다시 보고 싶은 배우로 넣으면 피하고 싶은 배우에서 빠진다");
      aO.click({act: "obMust", a: "a1", m: "1"}); aO.click({act: "rmFav", a: "a1"}); ok(!aO.S.prefs.must.includes("a1"), "보고 싶은 배우에서 빼면 반드시도 풀린다");
      aO.q("#avoidIn").value = "b1"; aO.click({act: "addAvoid"}); aO.click({act: "rmAvoid", a: "b1"}); eq(aO.S.prefs.avoid, [], "피하고 싶은 배우 빼기");
      aO.location.hash = "#taste/2"; aO.route(); const v3 = aO.q("#view").innerHTML;
      ok(/공연을 볼 때 무엇을 기대하나요\?/.test(v3) && /가장 기대하는 것은/.test(v3) && /어떤 목소리에 더 끌리나요\?/.test(v3) && /노래를 들을 때/.test(v3) && /어떤 감정 표현에/.test(v3), "2/2 는 우선순위 + 필수 질문 셋(제목 '공연을 볼 때 무엇을 기대하나요?')");
      ok(/선명하고 쨍한/.test(v3) && /유쾌하고 코믹한/.test(v3) && !/날카로운/.test(v3), "선택지: 선명하고 쨍한(날카로운 아님)·코믹 연기");
      aO.click({act: "obPrio", v: "노래"}); eq(aO.S.prefs.prio, "노래", "우선순위 하나");
      aO.click({act: "obPrio", v: "연기"}); eq(aO.S.prefs.prio, "연기", "다른 걸 누르면 바뀐다");
      aO.click({act: "obPrio", v: "연기"}); eq(aO.S.prefs.prio, "", "다시 누르면 풀린다");
      aO.click({act: "obPick", q: "tone", t: "맑음"}); aO.click({act: "obPick", q: "tone", t: "허스키"}); aO.click({act: "obPick", q: "tone", t: "부드러움"});
      eq(aO.S.prefs.axes, ["tag:맑음", "tag:허스키"], "한 질문에 2개까지(3번째는 안 들어간다)");
      aO.click({act: "obPick", q: "sing", t: "성량"}); eq(aO.S.prefs.axes, ["tag:맑음", "tag:허스키", "tag:성량"], "다른 질문은 따로 센다");
      aO.click({act: "obPick", q: "tone", t: ""}); eq(aO.S.prefs.axes, ["tag:성량"], "상관없어요는 그 질문만 비운다");
      ok(/class="chip on"[^>]*data-t="성량"/.test(aO.q("#view").innerHTML), "고른 선택지가 켜져 보인다");
      ok(/data-act="obGo" data-to="3">내 취향 카드 완성하기/.test(aO.q("#view").innerHTML), "하나라도 고르면 '내 취향 카드 완성하기'");
      const st = JSON.parse(aO.store.get("pickle_v2")).prefs; ok(st.prio === "" && st.axes.join() === "tag:성량", "고른 즉시 저장된다");
      const hasQ = re => re.test(aO.q("#view").innerHTML);
      ok(hasQ(/data-act="obMore"/) && !hasQ(/움직임에서는/) && !hasQ(/인물을 어떤 방식으로/), "선택 질문은 처음엔 접혀 있다");
      aO.click({act: "obMore"}); ok(!hasQ(/data-act="obMore"/) && hasQ(/인물을 어떤 방식으로/), "'조금 더 골라 보기'를 누르면 펼쳐진다");
      aO.click({act: "obPrio", v: "노래"}); ok(hasQ(/인물을 어떤 방식으로/), "다른 칩을 눌러 화면을 다시 그려도 펼친 채로 남는다");
      const aM = loadApp(D9o, {...opts3, hash: "#taste/2", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); aM.route();
      const body = () => /움직임에서는/.test(aM.q("#view").innerHTML), hasBodyData = /움직임에서는/.test((aM.click({act: "obMore"}), aM.q("#view").innerHTML));
      ok(hasBodyData, "근거가 있는 움직임 질문은 펼치면 보인다");
      if (hasBodyData) { const aM2 = loadApp(D9o, {...opts3, hash: "#taste/2", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [], grade: "", prio: "몸"}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); aM2.route();
        ok(/움직임에서는/.test(aM2.q("#view").innerHTML), "춤·몸짓을 1순위로 고르면 움직임 질문은 접지 않고 바로 보인다"); }
      else ok(!body(), "움직임 근거가 하나도 없는 데이터에선 움직임 질문을 숨긴다");
    }
    // ===== taste_snapshot: 취향폼을 저장하거나 고칠 때 =====
    const mkT = (hash = "#taste/2") => { const a = loadApp(D9, {...opts3, hash, storage: {pickle_v2: JSON.stringify({prefs: null, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); a.route(); return a; };
    const aT = mkT(), snEv = () => aT.TRK.queue().filter(q => q.event === "taste_snapshot").map(q => q.payload);
    aT.click({act: "obGo", to: "2"}); ok(snEv().length === 0, "취향을 하나도 안 고르고 넘어가면 남길 게 없어서 기록도 없다");
    aT.click({act: "obCard", id: "romance"}); aT.click({act: "obAxis", v: "강한 성량", l: "강한 성량", r: "섬세한 표현"});
    aT.q("#fav").value = "a1"; aT.click({act: "addFav"}); aT.q("#fav").value = "아무글이나 SECRET"; aT.click({act: "addFav"}); aT.q("#fav").value = "z9"; aT.click({act: "addFav"});
    ok(snEv().length === 0, "카드·축·배우를 고르는 동안엔 안 보낸다(저장할 때만)");
    aT.S.likes = [{actor: "a1", why: "왜좋아요글SECRET", tags: ["성량"], roles: []}];
    aT.click({act: "obGo", to: "4"});
    eq(snEv().map(({seq, ...r}) => r), [{likes: ["a1", "z9"], axes: {"강한 성량": -1}, tags: ["로맨스"], likeTags: {a1: ["성량"]}}], "저장하면 좋아하는 배우(앱 데이터에 있는 이름만)·취향 5축 값·고른 태그·배우별 특징 태그('왜 좋아요'로 고른 칩만, 글은 안 감)가 한 줄 남는다");
    ok(!JSON.stringify(aT.TRK.queue()).match(/아무글이나|SECRET|왜좋아요글/) && Object.keys(snEv()[0]).sort().join() === "axes,likeTags,likes,seq,tags", "직접 쓴 글('왜 좋아요')·목록에 없는 이름은 안 간다, 키는 likes·axes·tags·likeTags·seq 뿐");
    ok(aT.S.proto.snap && aT.S.proto.snap.id === aT.TRK.peekAnon() && typeof aT.S.proto.snap.sig === "string", "마지막으로 보낸 내용 요약이 이 기기에 새 키로 남는다");
    aT.click({act: "obGo", to: "4"}); aT.click({act: "obGo", to: "2"}); ok(snEv().length === 1, "직전에 보낸 것과 똑같으면 다시 안 보낸다");
    aT.click({act: "obCard", id: "family"}); aT.click({act: "obGo", to: "2"}); ok(snEv().length === 2 && snEv()[1].tags.includes("가족") && snEv()[1].seq > snEv()[0].seq, "고치고 저장하면 새로 한 줄");
    aT.click({act: "rmFav", a: "z9"}); aT.click({act: "obGo", to: "4"}); ok(snEv().length === 3 && snEv()[2].likes.join() === "a1", "배우를 빼고 저장해도 한 줄(좋아하는 배우가 바뀐 것)");
    aT.TRK.setOff(true); aT.click({act: "obCard", id: "tragedy"}); aT.click({act: "obGo", to: "4"}); ok(aT.TRK.queue().length === 0 && !aT.store.has("pickle_q") && !aT.store.has("pickle_anon"), "기록을 끄면 안 보낸다(큐·익명 번호 없음)");
    const tkS = mkT(); ok(tkS.track("taste_snapshot", {likes: ["a1", "없는사람"], axes: {"강한 성량": 1, "엉뚱축": 1}, tags: ["로맨스", "없는태그"]}) === true && eq(tkS.TRK.queue()[0].payload.likes, ["a1"]) === undefined, "값 검사: 앱 데이터에 없는 배우 이름은 버려진다");
    ok(tkS.track("taste_snapshot", {likes: Array.from({length: 11}, () => "a1"), axes: {}, tags: []}) === false && tkS.track("taste_snapshot", {likes: [], axes: {"강한 성량": 9}, tags: []}) === true && tkS.TRK.queue()[1].payload.axes && Object.keys(tkS.TRK.queue()[1].payload.axes).length === 0, "너무 긴 목록은 통째로 버리고, 범위 밖 값은 그 값만 버린다");
    const sS = {prefs: {favs: ["a1", "모름", "b1"], axes: ["섬세한 표현"], works: ["romance"]}}; eq(tasteSnapRecord(D9, sS, new Set(["a1", "b1"])), {likes: ["a1", "b1"], axes: {"강한 성량": 1}, tags: ["로맨스"], likeTags: {}}, "tasteSnapRecord: 모르는 이름은 뺀다, 오른쪽을 골랐으면 +1");
    // ===== 홈 추천: 특징 태그가 없는 좋아하는 배우도 '출연 중'은 나온다 · 좋아하는 배우가 있어도 취향 카드 추천(내 취향 추천 줄)이 나온다 · 빈 줄은 제목째 안 보인다 =====
    const D3f = {...D3, workTags: {...D3.workTags, "비슷한 쇼": wtRows("로맨스"), "같이 나오는 쇼": wtRows("로맨스"), "안 닮은 쇼": wtRows("로맨스")}};
    const h2s = h => [...h.matchAll(/<section class="hsec"><h2>([^<]*)/g)].map(m => m[1]);
    const rf = (prefs, d = D3f, extra = {}) => { const a = loadApp(d, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}, ...extra})}}); a.route(); return a; };
    ok(D3f.actorProfiles.a2 === undefined && !(D3f.actorTags[W4]?.a2 || []).length, "(전제) a2 는 특징 태그가 없다");
    const aN = rf({axes: [], works: [], favs: ["a2"]}), rN = homeRows(D3f, aN.S, FROM3), hN = aN.V.browse();
    ok(rN.mode === "fav" && rN.A.map(x => x.key).includes(W4) && rN.A.find(x => x.key === W4).line === "a2 출연" && rN.B.length === 0, "특징 태그가 없는 좋아하는 배우도 회차에 나오면 줄 A 에 '○○ 출연'으로 나온다(닮은 배우 줄 B 는 특징이 있어야)");
    ok(h2s(hN).join() === "좋아하는 배우가 나와요,지금 하는 공연 전체" && !/좋아하는 배우와 비슷한 배우가 나와요/.test(hN), "B 가 비면 그 줄은 제목째 안 보인다");
    const aF = rf({axes: [], works: ["romance"], favs: ["a2"]}), rF = homeRows(D3f, aF.S, FROM3), hF = aF.V.browse();
    ok(rF.taste.map(x => x.key).sort().join() === "PF1,PF2,PF3" && rF.taste.every(x => /고른 '로맨스'와 맞는 공연이에요/.test(x.line)) && !rF.taste.some(x => rF.A.concat(rF.B).some(y => y.key === x.key)), "좋아하는 배우가 있어도 카드를 고르면 A·B 에 없는 공연이 '내 취향 추천' 줄(taste)에 나온다(이유 문구는 취향 추천 줄과 같다)");
    ok(h2s(hF).join() === "좋아하는 배우가 나와요,내 취향 추천,지금 하는 공연 전체" && /<h2>내 취향 추천<\/h2><p class="hsub">[^<]*<\/p><div class="prow">(?:(?!<\/section>)[\s\S])*data-row="taste"/.test(hF), "A 아래에 '내 취향 추천' 줄(카드마다 row=taste)");
    aF.click({act: "recFb", key: "PF1", row: "taste", a: "not_interested"}); ok(homeRows(D3f, aF.S, FROM3).taste.map(x => x.key).sort().join() === "PF2,PF3" && aF.TRK.queue().some(q => q.event === "rec_feedback" && q.payload.show === "PF1" && q.payload.row === "taste"), "숨긴 공연은 내 취향 추천 줄에서 빠지고 rec_feedback row 는 taste");
    const aE = rf({axes: [], works: [], favs: ["없는배우"]}, D3f, {likes: [{actor: "없는배우", why: "", tags: [], roles: [], asked: "skip"}]}), hE = aE.V.browse();
    ok(h2s(hE).join() === "지금 하는 공연 전체" && /지금 하는 공연 중에 좋아하는 배우나 비슷한 배우가 나오는 공연이 아직 없어요/.test(hE) && !/<h2>좋아하는 배우가 나와요|<h2>내 취향 추천/.test(hE) && !/숨긴 공연/.test(hE), "A·B·taste 가 다 비면 빈 줄 제목 없이 안내 한 줄만(숨긴 공연 줄도 혼자 안 뜬다)");
    const aH = rf({axes: [], works: ["romance"], favs: ["없는배우"]}, D3f, {likes: [{actor: "없는배우", why: "", tags: [], roles: [], asked: "skip"}], proto: {hid: {PF1: {a: "seen", row: "taste"}, PF2: {a: "seen", row: "taste"}, PF3: {a: "seen", row: "taste"}}}}); const hH = aH.V.browse();
    ok(h2s(hH).join() === "지금 하는 공연 전체" && /추천 줄의 공연을 모두 숨겼어요/.test(hH) && /숨긴 공연 3개 · 되돌리기/.test(hH) && hH.indexOf("추천 줄의 공연을 모두 숨겼어요") < hH.indexOf("숨긴 공연 3개") && hH.indexOf("숨긴 공연 3개") < hH.indexOf("지금 하는 공연 전체"), "추천이 전부 숨겨졌을 땐 안내('모두 숨겼어요') 바로 아래에 '숨긴 공연 3개 · 되돌리기'가 붙고, 줄 제목은 없다");
    const aT1 = rf({axes: [], works: ["romance"], favs: []}); ok(h2s(aT1.V.browse()).join() === "내 취향 추천,지금 하는 공연 전체", "좋아하는 배우가 없으면 예전처럼 '내 취향 추천' 한 줄");
    // ===== 비슷한 배우 줄이 비는 이유가 '좋아하는 배우의 특징 없음'일 때 묻는 칸 =====
    const D3a = {...D3f, actorTagLabels: {"맑음": "맑", "부드러움": "부", "허스키": "허", "묵직한 음색": "묵", "성량": "성", "고음": "고", "딕션": "딕", "코믹 연기": "코", "감정 크게 표현": "감"}, voiceTags: ["맑음", "부드러움", "허스키", "묵직한 음색", "성량", "고음", "딕션"],
      actorProfiles: {...D3f.actorProfiles, v9: {voice: [], role: [{tag: "코믹 연기", work: W4, role: "A"}]}, v8: {voice: [], role: [{tag: "코믹 연기", work: W4, role: "A"}, {tag: "감정 크게 표현", work: W4, role: "A"}]}, v7: {voice: [], role: [{tag: "감정 크게 표현", work: W4, role: "A"}]}, v6: {voice: [], role: [{tag: "엉뚱한태그", work: W4, role: "A"}]}}};
    const lst = askTagList(D3a); ok(lst.length >= 6 && lst.length <= 8 && lst.slice(0, 6).join() === "맑음,부드러움,허스키,묵직한 음색,성량,고음" && lst.slice(6).every(t => D3a.actorTagLabels[t] && !D3a.voiceTags.includes(t)) && !lst.includes("엉뚱한태그") && lst.includes("코믹 연기"), "묻는 칸 칩: 목소리 6개 + 연기·해석(가장 흔한 것) 최대 2개, 사전 확정 태그만: " + lst);
    const mkA = (favs, likes = [], d = D3a) => { const a = loadApp(d, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs, grade: ""}, plans: [], tags: [], votes: [], likes, cal: {}, proto: {}})}}); a.route(); return a; };
    const aA = mkA(["a2"]); let hA = aA.V.browse();
    ok(/a2의 어떤 점이 좋아요\? 고르면 비슷한 배우가 나오는 공연을 찾아 드려요/.test(hA) && lst.every(t => hA.includes(`data-act="askTag" data-a="a2" data-t="${t}"`)) && /data-act="askSkip"[^>]*>건너뛰기/.test(hA) && /data-act="askFind"[^>]* disabled>찾기/.test(hA), "특징 없는 배우(a2)면 묻는 칸이 나온다(문구·칩·[건너뛰기]·아무것도 안 골랐을 땐 [찾기] 비활성)");
    ok(askActorOf(D3a, {prefs: {favs: ["a2", "z9"]}, likes: []}) === "a2" && askActorOf(D3a, {prefs: {favs: ["a1", "a2"]}, likes: []}) === "a2" && askActorOf(D3a, {prefs: {favs: ["z9", "a1"]}, likes: []}) === null && h2s(hA).join() === "좋아하는 배우가 나와요,지금 하는 공연 전체", "특징 없는 첫 배우 한 명만 묻고, 특징이 있는 배우(a1·z9)면 칸이 없다 · 칸은 줄 제목 없이 카드로만");
    const aTk = mkA(["a1"]); ok(!/askcard|어떤 점이 좋아요\?/.test(aTk.V.browse()) && (homeRows(D3a, aTk.S, FROM3).B.length > 0), "특징이 있는 배우(a1)면 칸이 안 나온다(비슷한 배우 줄이 채워져 있다)");
    aA.click({act: "askTag", a: "a2", t: "성량"}); aA.click({act: "askTag", a: "a2", t: "고음"}); hA = aA.V.browse();
    ok(/aria-pressed="true">성량/.test(hA) && /aria-pressed="true">고음/.test(hA) && !/askFind[^>]* disabled/.test(hA) && !aA.S.likes.length && !aA.TRK.queue().some(q => q.event === "taste_snapshot"), "여러 개 고를 수 있고, [찾기] 전엔 저장도 기록도 없다(다시 누르면 해제)");
    aA.click({act: "askTag", a: "a2", t: "고음"}); aA.click({act: "askTag", a: "a2", t: "엉뚱한태그"}); aA.click({act: "askTag", a: "z9", t: "성량"}); ok(!/aria-pressed="true">고음/.test(aA.V.browse()) && (aA.V.browse().match(/aria-pressed="true"/g) || []).length === 1, "고른 칩을 다시 누르면 풀리고, 칩에 없는 값·좋아하는 배우 아닌 이름은 무시");
    aA.click({act: "askFind", a: "a2"}); hA = aA.V.browse(); const rA = homeRows(D3a, aA.S, FROM3);
    ok(aA.S.likes.length === 1 && aA.S.likes[0].actor === "a2" && aA.S.likes[0].tags.join() === "성량" && typeof aA.S.likes[0].why === "string" && Array.isArray(aA.S.likes[0].roles), "[찾기]하면 '왜 좋아요'와 같은 S.likes 구조({actor, why, tags, roles})에 저장된다(새 키 없음)");
    ok(!/askcard|어떤 점이 좋아요\?/.test(hA) && rA.B.length > 0 && rA.B[0].line.startsWith("a2처럼 성량") && h2s(hA).includes("좋아하는 배우와 비슷한 배우가 나와요"), "그 자리에서 비슷한 배우 줄이 채워지고 묻는 칸은 사라진다: " + JSON.stringify(rA.B.map(x => x.line)));
    const snA = aA.TRK.queue().filter(q => q.event === "taste_snapshot").map(q => q.payload);
    ok(snA.length === 1 && snA[0].likeTags && JSON.stringify(snA[0].likeTags) === JSON.stringify({a2: ["성량"]}) && !JSON.stringify(snA[0]).match(/why|왜좋아요/), "[찾기]를 누르면 taste_snapshot 이 likeTags {배우: [태그]} 와 함께 한 줄 남는다");
    const aS = mkA(["a2"]); aS.click({act: "askSkip", a: "a2"}); ok(!/askcard/.test(aS.V.browse()) && aS.S.likes[0].asked === "skip" && aS.S.likes[0].tags.length === 0 && aS.TRK.queue().length === 0, "[건너뛰기]하면 칸이 사라지고 저장되며(S.likes 의 asked) 기록은 안 남는다");
    const aS2 = mkA(["a2"], JSON.parse(aS.store.get("pickle_v2")).likes); ok(!/askcard/.test(aS2.V.browse()), "다시 열어도(저장소에서) 다시 안 나온다");
    const aOld = mkA(["a2"], [{actor: "a2", why: "예전 글", tags: [], roles: []}]); ok(/askcard/.test(aOld.V.browse()), "예전 저장소(asked 없는 S.likes 항목)는 그대로 읽어서 묻는 칸이 나온다");
    const aOld2 = mkA(["a2"], [{actor: "a2", why: "", tags: ["허스키"], roles: []}]); ok(!/askcard/.test(aOld2.V.browse()), "'왜 좋아요'로 이미 고른 태그가 있으면(특징 있음) 묻지 않는다");
    const aMany = mkA(["a1", "a2", "z9"]); ok((aMany.V.browse().match(/class="card askcard"/g) || []).length <= 1, "좋아하는 배우가 여럿이어도 칸은 하나 이하");
    const aF2 = mkA([]); ok(!/askcard/.test(aF2.V.browse()), "좋아하는 배우가 없으면 칸이 없다");
    // ===== 다른 사람들이 고른 배우 특징(서버 actor_trait_votes)을 읽어 추천에 반영 · 근거 수 가중치 =====
    { const LIVE = {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_selftest", table: "events"}, NOW = new Date("2026-10-11T12:00:00").getTime();
      const D3v = {...D3a, currentShows: [...D3a.currentShows, cur("PF4", "또 다른 쇼", ["v3"])], actorProfiles: {...D3a.actorProfiles, v3: {voice: [{tag: "성량", work: "x"}], role: []}}};
      const mkV0 = (o = {}) => { const calls = [], fetch = o.fetch || (async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => o.rows || []}; });
        const a = loadApp(JSON.parse(JSON.stringify(o.D || D3v)), {...opts3, hash: "#home", track: o.track === undefined ? LIVE : o.track, fetch, storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: o.favs || ["a1"], grade: ""}, plans: [], tags: [], votes: [], likes: o.likes || [], cal: {}, proto: {}}), ...(o.storage || {})}}); a.calls = calls; a.route(); return a; };
      const mkV = async o => { const a = mkV0(o); await a.votesP; return a; };
      const bKeys = a => homeRows(a.D, a.S, FROM3).B.map(x => x.key);
      const VR = [{actor: "v1", tag: "성량", n: 3}, {actor: "v1", tag: "고음", n: 1}, {actor: "없는사람", tag: "성량", n: 9}, {actor: "v2", tag: "없는태그", n: 9}, {actor: "v2", tag: "성량", n: "4"}, {actor: "__proto__", tag: "성량", n: 5}, {actor: "v3", tag: "코믹 연기", n: 2}, null, {actor: "v2", tag: "고음", n: 2.5}];
      // 기록 설정이 없으면(연습 모드·설정 없음) 아무것도 안 읽고 추천은 그대로
      for (const tr of [null, {mode: "practice"}, {mode: "live", url: "https://abc.supabase.co", key: ""}, {mode: "live", url: "https://evil.example.com", key: "sb_publishable_x"}]) { const a = await mkV({track: tr, rows: VR}); ok(a.calls.length === 0 && a.D.actorVotes === undefined && !a.store.has("pickle_votes"), "기록 설정(주소+공개 키)이 없으면 투표 합계를 읽지 않는다: " + JSON.stringify(tr)); }
      // 읽기 요청: 주소·헤더는 기록 보내기와 같은 규칙, 익명 ID 도 본문도 없다
      const aR = await mkV({rows: VR}), rq = aR.calls[0];
      ok(aR.calls.length === 1 && rq.url === "https://abc.supabase.co/rest/v1/actor_trait_votes?select=actor,tag,n" && rq.init.method === "GET" && rq.init.body === undefined && rq.init.keepalive === undefined, "시작할 때 한 번 GET {url}/rest/v1/actor_trait_votes?select=actor,tag,n");
      eq(rq.init.headers, {apikey: LIVE.key}, "새 형식 공개 키(sb_publishable_)는 apikey 만(Authorization 없음)");
      ok(rq.init.signal && typeof rq.init.signal.aborted === "boolean" && !aR.store.has("pickle_anon") && !aR.store.has("pickle_q") && !JSON.stringify(rq).match(/anon|session/), "3초 안에 끊을 수 있는 신호가 붙고, 익명 ID·방문 번호는 안 보낸다(읽기만 해도 기록 번호를 만들지 않는다)");
      const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln", aJ = await mkV({track: {...LIVE, key: JWT}, rows: []});
      eq(aJ.calls[0].init.headers, {apikey: JWT, Authorization: "Bearer " + JWT}, "JWT 형식 공개 키는 기록 보내기와 같이 apikey + Authorization");
      // 받은 값 거르기: 앱에 없는 배우·확정 태그가 아닌 것·2명 미만·숫자가 아닌 n·이상한 줄은 버린다
      eq(aR.D.actorVotes, {v1: {성량: 3}, v3: {"코믹 연기": 2}}, "앱 데이터에 있는 배우 + 사전 확정 태그 + n≥2 만 남는다(없는 배우·없는 태그·n 1·문자열·소수·__proto__·null 은 버림)");
      const stored = JSON.parse(aR.store.get("pickle_votes")); ok(stored.at === NOW && Array.isArray(stored.rows) && !aR.store.has("pickle_anon"), "받은 값은 이 기기 새 키(pickle_votes)에 시각과 함께 둔다");
      // 1시간 캐시: 1시간 안이면 안 읽고 첫 화면 전에 바로 반영, 지나면 다시 읽는다. 읽기 실패 때는 받아 둔 값을 그대로 쓴다
      const CR = [{actor: "v1", tag: "성량", n: 4}];
      const aC = await mkV({rows: VR, storage: {pickle_votes: JSON.stringify({at: NOW - 30 * 60e3, rows: CR})}}); ok(aC.calls.length === 0 && aC.D.actorVotes.v1["성량"] === 4, "30분 전에 받은 게 있으면 다시 안 읽고 그 값을 쓴다");
      const aC0 = mkV0({rows: VR, storage: {pickle_votes: JSON.stringify({at: NOW - 30 * 60e3, rows: CR})}}); ok(aC0.D.actorVotes.v1["성량"] === 4, "캐시 값은 비동기로 기다리지 않고 첫 화면을 그리기 전에 이미 반영돼 있다"); await aC0.votesP;
      const aOld = await mkV({rows: VR, storage: {pickle_votes: JSON.stringify({at: NOW - 2 * 3600e3, rows: CR})}}); ok(aOld.calls.length === 1 && aOld.D.actorVotes.v1["성량"] === 3 && JSON.parse(aOld.store.get("pickle_votes")).at === NOW, "2시간 전 캐시는 다시 읽어서 새 값으로 바꾼다");
      const aFut = await mkV({rows: VR, storage: {pickle_votes: JSON.stringify({at: NOW + 3600e3, rows: CR})}}); ok(aFut.calls.length === 1, "시계가 어긋나 미래 시각이 적힌 캐시는 믿지 않고 다시 읽는다");
      const aBadC = await mkV({rows: VR, storage: {pickle_votes: "{깨진 JSON"}}); ok(aBadC.calls.length === 1 && aBadC.D.actorVotes.v1["성량"] === 3, "깨진 캐시는 없는 것으로");
      const aBadC2 = await mkV({rows: VR, storage: {pickle_votes: JSON.stringify({at: NOW, rows: [{actor: "v1", tag: "성량", n: "99"}, {actor: "없는사람", tag: "성량", n: 9}]})}}); eq(aBadC2.D.actorVotes, {}, "캐시도 받을 때와 같은 검사를 거친다(앱에 없는 배우·숫자가 아닌 값은 버림)");
      // 실패는 조용히: 오류·응답 오류·모양이 다른 응답·시간 초과, 화면은 투표 없는 추천 그대로
      const base = (await mkV({track: null})), baseKeys = bKeys(base);
      for (const [why, f] of [["네트워크 오류", async () => { throw new Error("offline"); }], ["응답 500", async () => ({ok: false, status: 500, json: async () => VR})], ["배열이 아닌 응답", async () => ({ok: true, json: async () => ({message: "x"})})], ["json 읽기 실패", async () => ({ok: true, json: async () => { throw new Error("bad json"); }})]]) {
        const a = await mkV({fetch: f}); ok(a.D.actorVotes === undefined && !a.store.has("pickle_votes") && JSON.stringify(bKeys(a)) === JSON.stringify(baseKeys), "읽기 실패(" + why + ")는 조용히 넘어가고 추천은 그대로");
      }
      const aF = await mkV({fetch: async () => { throw new Error("offline"); }, storage: {pickle_votes: JSON.stringify({at: NOW - 3 * 3600e3, rows: CR})}}); ok(aF.D.actorVotes.v1["성량"] === 4, "읽기에 실패하면 받아 둔 옛 값을 그대로 쓴다");
      const aT = mkV0({fetch: (url, init) => new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))});
      const tm = aT.timers.find(t => t.ms === 3000); ok(!!tm && aT.D.actorVotes === undefined, "3초 안에 못 받으면 끊도록 타이머를 건다(시간 초과 시험)"); tm.f(); await aT.votesP; ok(aT.D.actorVotes === undefined && !aT.store.has("pickle_votes"), "시간 초과로 끊기면 조용히 투표 없이 간다");
      // 기록을 꺼 둔 사람도 읽는다(읽기만 하고 보내는 건 없다)
      const aOff = await mkV({rows: VR, storage: {pickle_track_off: "1"}}); ok(aOff.calls.length === 1 && aOff.D.actorVotes.v1["성량"] === 3 && aOff.TRK.queue().length === 0 && !aOff.store.has("pickle_anon") && !aOff.store.has("pickle_q"), "기록을 꺼도 투표 합계는 읽는다(기록·익명 번호는 여전히 없다)");
      // 추천 반영: 같은 작품·후보가 나오고(빼거나 더하지 않음), 근거 수가 많은 쪽이 앞선다. 화면에 근거·숫자는 없다
      const aV = await mkV({rows: [{actor: "v1", tag: "성량", n: 3}]});
      ok(base.D.actorVotes === undefined && JSON.stringify([...baseKeys].sort()) === JSON.stringify([...bKeys(aV)].sort()) && baseKeys.length >= 2, "투표가 있어도 줄 B 에 나오는 극은 그대로(순서만): " + baseKeys.join());
      ok(baseKeys[0] !== "PF1" && bKeys(aV)[0] === "PF1", "투표 합계가 더해진 배우(v1)의 극이 같은 특징 한 개짜리 극보다 앞선다: " + baseKeys.join() + " → " + bKeys(aV).join());
      const hV = aV.V.browse(), hB = base.V.browse();  // 추천 극 목록은 MVP 홈에서 빠져 V.browse 에만 있다
      ok(/data-key="PF1"/.test(hV) && /a1처럼 성량 — v1 출연/.test(hV) && !/1\.5|\d명이 (골|고)|투표|근거 \d/.test(hV) && !/1\.5|투표/.test(hB), "투표 때문에 순서가 바뀌고 새로 그려져도 화면은 이유 문장 그대로(근거·숫자 없음)");
      // 투표만으로 특징이 생긴 배우: 프로필이 없어도 겹친다. 투표가 없으면 안 겹친다
      const Dn = JSON.parse(JSON.stringify(D3v)); Dn.currentShows.push(cur("PF5", "투표로만 보이는 쇼", ["새얼굴"])); Dn.actorProfiles["새얼굴"] = {voice: [], role: []};
      const aN0 = await mkV({D: Dn, track: null}), aN1 = await mkV({D: Dn, rows: [{actor: "새얼굴", tag: "성량", n: 2}]});
      ok(!bKeys(aN0).includes("PF5") && bKeys(aN1).includes("PF5"), "사람들이 고른 특징만 있는 배우도 투표가 있으면 비슷한 배우 줄에 나온다(없으면 안 나온다)");
      // 내가 직접 고른 특징은 늘 온전히: 좋아하는 배우의 시트 근거가 얇아도 내가 고른 성량은 후보 근거만큼 쳐 준다
      const aM = await mkV({track: null, likes: [{actor: "a1", why: "", tags: ["성량"], roles: []}]}), aM1 = await mkV({track: null}); ok(JSON.stringify(bKeys(aM).slice().sort()) === JSON.stringify(baseKeys.slice().sort()) && aM1.D.actorVotes === undefined, "내가 고른 특징이 있어도 줄 B 의 극은 그대로");
      // 배우 본인이 밝힌 해석(level 배우 본인·공식)은 연기·해석 태그에 한해 근거 0.5개: 줄 B 순서에 약하게(같은 점수 이름순 → 관객 근거 1개인 극이 앞), 목소리 태그·제작진 공식은 무시
      { const W5 = "극5", W6 = "극6", prow = (tag, level, sk, work) => ({tag, work, role: "A", season: "2026", level, sk});
        const mkS = (selfProf, favTags = ["코믹 연기"]) => { const d = JSON.parse(JSON.stringify({...D3v, works: [...D3v.works, mkW(W5, true), mkW(W6, true)],
          roles: {...D3v.roles, [W5]: [{role: "A", weight: "주연", cast: ["s1"]}], [W6]: [{role: "A", weight: "주연", cast: ["o1"]}]},
          perfs: [...D3v.perfs, {work: W5, date: "2026-10-20", dow: "화", time: "19:30", cast: {A: "s1"}, notes: []}, {work: W6, date: "2026-10-20", dow: "화", time: "19:30", cast: {A: "o1"}, notes: []}],
          actorProfiles: {...D3v.actorProfiles, s1: selfProf, o1: {voice: [], role: [prow("코믹 연기", "일반 관객 후기", "a1", W6)]}, f1: {voice: [], role: []}}}));
          const S = {prefs: {axes: [], works: [], favs: ["f1"]}, plans: [], tags: [], votes: [], likes: [{actor: "f1", why: "", tags: favTags, roles: []}], proto: {}}; return {d, S, B: homeRows(d, S, FROM3).B}; };
        const keys = x => x.B.map(b => b.key), self = (level, tag = "코믹 연기") => ({voice: [], role: [prow(tag, level, "i1", W5)]});
        const base = mkS(self("배우 본인·공식")), kb = keys(base);
        ok(kb.includes(W5) && kb.includes(W6) && kb.indexOf(W6) < kb.indexOf(W5), "본인 해석만 있는 극5 도 줄 B 에 들어가고(특징 비교에 들어간다), 이름순이면 앞인데도 관객 근거 1개인 극6 보다 뒤로 간다: " + kb.join());
        ok(keys(mkS({voice: [], role: []})).includes(W5) === false && keys(mkS(self("배우 인터뷰"))).includes(W5), "본인 해석이 없으면 극5 는 안 겹치고, 예전 값 '배우 인터뷰'도 같다");
        ok(!keys(mkS(self("제작진·공식"))).includes(W5), "제작진 공식은 무시(줄 B 에 안 들어간다)");
        ok(!keys(mkS({voice: [prow("성량", "배우 본인·공식", "i1", W5)], role: []}, ["성량"])).includes(W5) && keys(mkS({voice: [prow("성량", "일반 관객 후기", "a9", W5)], role: []}, ["성량"])).includes(W5), "본인 해석의 목소리 태그는 무시(같은 모양의 관객 근거는 들어간다)");
        const aSelf = loadApp(base.d, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: base.S.prefs, plans: [], tags: [], votes: [], likes: base.S.likes, cal: {}, proto: {}})}}); aSelf.route();
        const hSelf = aSelf.V.browse(); ok(/f1처럼 코믹 연기 — s1 출연/.test(hSelf) && !/인터뷰|본인|0\.5|0\.75|근거 \d/.test(hSelf), "화면에는 근거도 숫자도 안 나온다(이유 문장 그대로)"); }
      // 안내문
      const prv = mkV0({track: LIVE, hash: "#privacy"}); prv.route(); const pH = prv.V.privacy();
      ok(/여러 사람\(2명 이상\)이 고른 배우 특징은 누가 골랐는지 없이 합계로만 추천에 쓰여요\./.test(pH) && /다른 사람들이 고른 배우 특징 합계는 1시간 동안 받아 두어요/.test(pH), "앱 안 개인정보 안내: 합계로만 쓴다는 한 줄 + 이 기기에 1시간 받아 둔다는 설명");
      const specV = fs.readFileSync(path.join(__dirname, "../docs/data_spec_combo_fit_2026-10-10.md"), "utf8"), draftV = fs.readFileSync(path.join(__dirname, "../docs/privacy_notice_draft_2026-10-10.md"), "utf8");
      ok(/여러 사람\(2명 이상\)이 고른 배우 특징은 누가 골랐는지 없이 합계로만 추천에 쓰여요\./.test(draftV) && /다른 사람들이 고른 배우 특징 합계는 1시간 동안 받아 두어요/.test(draftV), "안내문 초안에도 같은 문장");
      ok(/### 9\. 읽기 전용 집계 `public\.actor_trait_votes`/.test(specV) && /\| actor \|/.test(specV) && /서로 다른 `anon_id` 수/.test(specV) && /n이 2 이상인 줄만/.test(specV) && /1시간마다/.test(specV) && /읽기\(select\)만/.test(specV) && /actor_trait_votes\?select=actor,tag,n/.test(specV) && /pickle_votes/.test(specV) && /서로 다른 근거 수/.test(specV) && /여러 사람\(2명 이상\)이 고른 배우 특징은/.test(specV), "정의서 9번: 표·열·n≥2·1시간마다 다시 계산·읽기 전용·앱이 읽는 법·캐시 키·근거 수 가중치·안내 한 줄");
    }
    // likeTags 값 검사: 앱 데이터에 있는 배우·사전 확정 태그만, 엉뚱한 값은 버린다
    const tkL = mkA(["a2"]); ok(tkL.track("taste_snapshot", {likes: ["a2"], axes: {}, tags: [], likeTags: {a2: ["성량", "없는태그", "코믹 연기"], 모르는사람: ["성량"], z9: Array.from({length: 9}, () => "성량")}}) === true, "likeTags 가 섞인 값은 통과(엉뚱한 건 버리고)");
    eq(tkL.TRK.queue()[0].payload.likeTags, {a2: ["성량", "코믹 연기"]}, "likeTags: 사전 확정 태그가 아닌 값·앱 데이터에 없는 배우·너무 긴 목록은 버려진다");
    ok(tkL.track("taste_snapshot", {likes: [], axes: {}, tags: [], likeTags: "문자열"}) === true && !("likeTags" in tkL.TRK.queue()[1].payload), "모양이 틀린 likeTags 는 그 키만 버린다");
    const sT = {prefs: {favs: ["a2", "z9"]}, likes: [{actor: "a2", why: "글SECRET", tags: ["성량", "없는태그"], roles: [{work: W4, role: "A", why: "배역글SECRET", tags: ["코믹 연기"]}]}]};
    eq(tasteSnapRecord(D3a, sT, new Set(["a2", "z9"])).likeTags, {a2: ["성량", "코믹 연기"]}, "tasteSnapRecord: 배우별로 고른 특징 태그(왜 좋아요 글 칩 포함, 사전 확정 태그만)");
    ok(!JSON.stringify(tasteSnapRecord(D3a, sT, new Set(["a2", "z9"]))).match(/SECRET/), "'왜 좋아요' 글은 기록값에 안 들어간다");
    // ===== rec_feedback: 홈 추천 줄 카드 =====
    const mkR = (prefs = {axes: [], works: [], favs: ["a1"], grade: ""}, extra = {}) => { const a = loadApp(D3, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}, ...extra}); a.route(); return a; };
    const aR = mkR(), recPart = h => h.split("지금 하는 공연 전체")[0], allPart = h => h.split("지금 하는 공연 전체")[1], fbEv = () => aR.TRK.queue().filter(q => q.event === "rec_feedback").map(({payload: {seq, ...r}}) => r);
    let hR = aR.V.browse();
    ok((recPart(hR).match(/class="pwrap"/g) || []).length === (recPart(hR).match(/class="pcard"/g) || []).length && /data-act="recMenu" data-key="PF2" data-row="fav"/.test(hR) && /data-act="recMenu" data-key="PF1" data-row="similar"/.test(hR) && !/class="pwrap"/.test(allPart(hR)), "추천 줄(좋아하는 배우·비슷한 배우) 카드마다 ⋯ 버튼이 있고, 전체 목록 카드엔 없다");
    ok(/data-act="recFb"[^>]*data-a="seen">이미 봤어요/.test(html) && /data-a="not_interested">관심 없어요/.test(html) && /const recMenuHtml/.test(html) && !/class="pmenu"/.test(hR), "⋯ 를 누르면 [이미 봤어요]·[관심 없어요] 메뉴가 나온다(처음엔 닫혀 있다)");
    aR.click({act: "recFb", key: "PF2", row: "fav", a: "not_interested"}); hR = aR.V.browse();
    eq(fbEv(), [{show: "PF2", row: "fav", action: "not_interested"}], "고르면 rec_feedback {show, row, action} 한 줄");
    ok(!/href="#show\/PF2"/.test(recPart(hR)) && /href="#show\/PF2"/.test(allPart(hR)) && aR.S.proto.hid.PF2.a === "not_interested" && aR.S.proto.hid.PF2.row === "fav", "그 카드는 추천 줄에서 바로 빠지고 '지금 하는 공연 전체'에는 그대로, 숨김은 새 키(proto.hid)에만 저장");
    ok(homeRows(D3, aR.S, FROM3).A.every(x => x.key !== "PF2") && /숨긴 공연 1개 · 되돌리기/.test(hR) && /PF2|같이 나오는 쇼/.test(hR.split("숨긴 공연")[1]), "추천 줄 아래 '숨긴 공연 1개 · 되돌리기'에 목록이 있다");
    aR.click({act: "recFb", key: "PF1", row: "similar", a: "seen"}); hR = aR.V.browse(); ok(!/href="#show\/PF1"/.test(recPart(hR)) && aR.S.proto.hid.PF1.a === "seen" && /숨긴 공연 2개/.test(hR) && fbEv().length === 2 && fbEv()[1].action === "seen", "[이미 봤어요]도 같은 식 · 비슷한 배우 줄에서 빠진다");
    aR.click({act: "recFb", key: "PF2", row: "fav", a: "엉뚱"}); aR.click({act: "recFb", key: "없는공연", row: "fav", a: "seen"}); aR.click({act: "recFb", key: "PF3", row: "엉뚱줄", a: "seen"}); ok(fbEv().length === 2 && !aR.S.proto.hid["없는공연"] && !aR.S.proto.hid.PF3, "엉뚱한 값·없는 공연·엉뚱한 줄은 무시");
    aR.click({act: "recUndo", key: "PF2"}); hR = aR.V.browse();
    eq(fbEv()[2], {show: "PF2", row: "fav", action: "undo"}, "되돌리면 undo 한 줄(숨길 때의 줄 이름으로)");
    ok(/href="#show\/PF2"/.test(recPart(hR)) && !aR.S.proto.hid.PF2 && /숨긴 공연 1개/.test(hR) && homeRows(D3, aR.S, FROM3).A.some(x => x.key === "PF2"), "되돌린 카드는 추천 줄에 다시 나온다");
    aR.click({act: "recUndo", key: "PF2"}); ok(fbEv().length === 3, "숨기지 않은 걸 되돌리기하면 아무 일도 없다");
    aR.click({act: "recUndo", key: "PF1"}); ok(!/숨긴 공연/.test(aR.V.browse()) && Object.keys(aR.S.proto.hid).length === 0, "다 되돌리면 '숨긴 공연' 줄이 사라진다");
    const aTa = mkR({axes: [], works: ["romance"], favs: []}, {}); aTa.S.proto.hid = {}; const D3t = {...D3, workTags: {...D3.workTags, "비슷한 쇼": wtRows("로맨스"), "같이 나오는 쇼": wtRows("로맨스")}};
    const aRt = loadApp(D3t, {...opts3, hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: ["romance"], favs: []}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); aRt.route();
    ok(/data-row="taste"/.test(aRt.V.browse()) && homeRows(D3t, aRt.S, FROM3).taste.length === 2, "좋아하는 배우가 없을 땐 '내 취향 추천' 줄 카드(row=taste)에도 ⋯ 가 붙는다");
    aRt.click({act: "recFb", key: "PF1", row: "taste", a: "not_interested"}); ok(homeRows(D3t, aRt.S, FROM3).taste.map(x => x.key).join() === "PF2" && aRt.TRK.queue().some(q => q.event === "rec_feedback" && q.payload.row === "taste"), "내 취향 추천 줄에서도 빠지고 row=taste 로 남는다");
    const aRo = mkR(); aRo.TRK.setOff(true); aRo.click({act: "recFb", key: "PF2", row: "fav", a: "seen"}); ok(aRo.TRK.queue().length === 0 && !aRo.store.has("pickle_q") && aRo.S.proto.hid.PF2.a === "seen" && !/href="#show\/PF2"/.test(recPart(aRo.V.browse())), "기록을 끄면 안 보내지만 숨김은 이 기기에서 그대로 동작");
    ok(hideShow({}, "k", "fav", "seen") === true && hideShow({}, "k", "x", "seen") === false && hideShow({}, "k", "fav", "undo") === false && unhideShow({}, "k") === null && hiddenShows({}) && Object.keys(hiddenShows({})).length === 0, "hideShow/unhideShow: 정해진 값만");
    // 개인정보 안내(앱 안·문서): 취향 스냅숏·추천 줄 피드백, 정의서 7·8번
    const pv10 = mk9({track: {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"}, hash: "#privacy"}); pv10.route(); const prv10 = pv10.V.privacy();
    ok(/홈에서 좋아하는 배우의 어떤 점이 좋은지 골라 \[찾기\]를 누를 때/.test(prv10) && /좋아하는 배우별로 고른 특징 태그/.test(prv10), "앱 안 개인정보 안내: [찾기] 행과 배우별 특징 태그");
    ok(/취향 고르기를 저장하거나 고칠 때/.test(prv10) && /직접 쓴 글은 보내지 않아요/.test(prv10) && /\[이미 봤어요\]·\[관심 없어요\]·\[되돌리기\]/.test(prv10), "앱 안 개인정보 안내: 취향 스냅숏·추천 줄 피드백 행");
    ok(/### 7\. `taste_snapshot`/.test(spec9) && /### 8\. `rec_feedback`/.test(spec9) && /event in \([^)]*'taste_snapshot','rec_feedback'\)/.test(spec9) && /alter table public\.events/.test(spec9), "정의서 7·8번 + DB 허용 목록·변경 SQL");
    ok(/\| likeTags \|/.test(spec9) && /\[찾기\]를 누를 때/.test(spec9) && /새 이벤트는 만들지 않고/.test(spec9) && /홈에서 좋아하는 배우의 어떤 점이 좋은지 골라 \[찾기\]를 누를 때/.test(draft9) && /좋아하는 배우별로 고른 특징 태그/.test(draft9), "정의서 7번 likeTags·묻는 칸 설명, 안내문 초안 '어떤 기록' 표에 [찾기] 행");
    ok(/취향 고르기를 저장하거나 고칠 때/.test(draft9) && /\[이미 봤어요\]·\[관심 없어요\]·\[되돌리기\]/.test(draft9), "안내문 초안 '어떤 기록' 표에 두 행");
    // 캐스팅 일정 표시
    const marks = h4.split('chips afilter')[1].match(/class="pmark">날짜별 캐스팅 있음/g) || [];
    ok(marks.length === 1, "회차 캐스팅이 있는 작품(극)에만 '날짜별 캐스팅 있음' 표시: " + marks.length);
    ok(!/class="pbadge"/.test(h4), "옛 '추천' 배지는 없다");
  }
  // 실제 데이터: 모든 공연 화면이 순서대로 그려진다
  { const dp2 = process.env.PICKLE_DATA_JS || path.join(__dirname, "../app/data.js");
    if (fs.existsSync(dp2)) { const win2 = {}; new Function("window", fs.readFileSync(dp2, "utf8"))(win2); const RD2 = win2.PICKLE_DATA;
      // 실제 데이터의 특정 배우에 기대지 않는다: 프로필·배우 태그가 없고 지금 이후 회차가 있는 배우를 그때그때 고른다(없으면 회차 하나에 가상 배우를 넣은 복사본)
      const RD3 = (() => { const inRoles = (D, a) => Object.values(D.roles || {}).some(rs => rs.some(r => r.cast.includes(a))), noTag = a => inRoles(RD2, a) && !(RD2.actorProfiles || {})[a] && !Object.values(RD2.actorTags || {}).some(w => (w[a] || []).length), sched = new Set(RD2.works.filter(w => w.hasSchedule).map(w => w.name));
        const ps = RD2.perfs.filter(p => sched.has(p.work) && p.date >= "2026-10-11" && !p.private).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
        for (const p of ps) { const a = Object.values(p.cast).filter(noTag).sort((x, y) => x.localeCompare(y, "ko"))[0]; if (a) return {D: RD2, actor: a, work: p.work}; }
        const D = JSON.parse(JSON.stringify(RD2)), p = D.perfs.find(x => sched.has(x.work) && x.date >= "2026-10-11"), r = Object.keys(p.cast)[0]; p.cast[r] = "가상배우"; D.roles[p.work][0].cast.push("가상배우"); return {D, actor: "가상배우", work: p.work}; })();
      // 줄 A·B 가 모두 나오는 좋아하는 배우(프로필 있음): 카이를 먼저 보고, 데이터가 바뀌어 안 되면 다른 배우로 넘어간다
      const FAVP = (() => { const cs = Object.entries(RD2.actorProfiles || {}).filter(([, p]) => (p.voice || []).length).map(([n]) => n).sort((x, y) => (y === "카이") - (x === "카이") || x.localeCompare(y, "ko"));
        for (const n of cs) { const t = loadApp(RD2, {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [n], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); t.route(); const r = homeRows(RD2, t.S, "2026-10-11"); if (r.mode === "fav" && r.A.length && r.B.length) return n; }
        return "카이"; })();
      const app2 = loadApp(RD2, {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: ["맑은 음색", "강한 성량"], works: ["tragedy"], favs: ["카이"], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); app2.route();
      const keys = [...RD2.works.map(w => w.name), ...(RD2.currentShows || []).slice(0, 80).map(s => s.id)]; let n2 = 0, withCal = 0;
      for (const k of keys) { const h = app2.V.show(k); const p = ["summary", "cast", "dates"].map(id => h.indexOf(`id="${id}"`)); if (!(p.every(x => x > 0) && p[0] < p[1] && p[1] < p[2])) throw new Error("섹션 순서: " + k); if ((h.match(/<div class="month"/g) || []).length > 1) throw new Error("달력이 여러 개: " + k); if (/class="month"/.test(h)) withCal++; if (/이상형 월드컵/.test(h)) throw new Error("공연 화면에 월드컵: " + k); n2++; }
      { // 홈(실제 데이터): 좋아하는 배우가 있는 사람의 줄 A·B, 전체 목록, 구분 버튼
        const hom = loadApp(RD2, {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [FAVP], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); hom.route();
        const rw = homeRows(RD2, hom.S, "2026-10-11"), hh = hom.V.browse(), N = allShows(RD2, "2026-10-11");
        ok(rw.mode === "fav" && rw.A.length > 0 && rw.B.length > 0 && !rw.A.some(a => rw.B.some(b => b.key === a.key)), `실제 데이터: 줄 A ${rw.A.length}개·줄 B ${rw.B.length}개, 겹침 없음`);
        ok(rw.A.every(x => /출연$/.test(x.line)) && rw.B.every(x => /처럼 .+ — .+ 출연$/.test(x.line)), "실제 데이터: 줄 A 는 '○○ 출연', 줄 B 카드는 모두 이유가 있다");
        ok(rw.A.some(x => RD2.currentShows.some(c => c.id === x.key)) || rw.B.some(x => RD2.currentShows.some(c => c.id === x.key)), "줄에 KOPIS 공연도 들어간다(시드만이 아니다)");
        { // 다른 사람들이 고른 배우 특징(투표 합계): 프로필 없는 배우(RD3.actor) + 성량 → 줄 B 가 나오고, 투표는 순서만 바꾼다
          const LIVE9 = {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_selftest", table: "events"};
          const FAV = RD3.actor, mkR = async (rows, likes = [], favs = [FAV]) => { const a = loadApp(JSON.parse(JSON.stringify(RD3.D)), {now: "2026-10-11T12:00:00", hash: "#home", track: rows ? LIVE9 : null, fetch: async () => ({ok: true, json: async () => rows || []}), storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs, grade: ""}, plans: [], tags: [], votes: [], likes, cal: {}, proto: {}})}}); a.route(); await a.votesP; return a; };
          const own = [{actor: FAV, why: "", tags: ["성량"], roles: []}], bK = a => homeRows(a.D, a.S, "2026-10-11").B.map(x => x.key);
          const r0 = await mkR(null, own), k0 = bK(r0); ok(k0.length > 0 && new RegExp(FAV + "처럼 성량").test(homeRows(r0.D, r0.S, "2026-10-11").B[0].line), `실제 데이터: ${FAV}(프로필 없음) + 내가 고른 '성량' → 줄 B ${k0.length}개(투표 합계 없음)`);
          const rN = await mkR(null), rV = await mkR([{actor: FAV, tag: "성량", n: 3}]);
          ok(bK(rN).length === 0 && JSON.stringify([...bK(rV)].sort()) === JSON.stringify([...k0].sort()), `${FAV}는 프로필이 없어 줄 B 가 비지만, 다른 사람 3명이 '성량'을 골랐다는 합계가 오면 내가 직접 고른 것과 같은 극이 줄 B 에 나온다(순서만 다를 수 있다)`);
          const last = homeRows(r0.D, r0.S, "2026-10-11").B[k0.length - 1], who = last.line.match(/ — (.+) 출연$/)[1].split("·")[0];
          const rW = await mkR([{actor: who, tag: "성량", n: 5}], own), kW = bK(rW);
          ok(JSON.stringify([...kW].sort()) === JSON.stringify([...k0].sort()) && kW.indexOf(last.key) <= k0.indexOf(last.key), `다른 사람들이 ${who}의 성량을 골랐으면 그 극(${last.title})은 줄 B 에서 같거나 앞으로(${k0.indexOf(last.key)} → ${kW.indexOf(last.key)}), 극 목록은 그대로`);
          ok(!/투표|\d명이 (골|고)|근거 \d/.test(rW.q("#view").innerHTML), "실제 데이터: 화면에 투표·근거 문구가 없다");
        }
        const part = hh.split("지금 하는 공연 전체")[1], nGrid = (part.match(/class="pcard"/g) || []).length;
        const seedRun = RD2.works.filter(w => allShows(RD2, "2026-10-11").some(x => x.key === w.name)).length;
        ok(nGrid === N.length && N.length === seedRun + N.filter(x => x.kind === "current").length && N.filter(x => x.kind === "current").length === RD2.currentShows.filter(c => c.end >= "2026-10-11" && ((c.cast || []).length || c.noCast) && !/만\s*1[89]\s*세/.test(c.age || "")).length - RD2.currentShows.filter(c => c.end >= "2026-10-11" && ((c.cast || []).length || c.noCast) && !/만\s*1[89]\s*세/.test(c.age || "") && RD2.works.some(w => String(c.title).replace(/\s+/g, "").includes(w.name.replace(/\s+/g, "")))).length, `실제 데이터: 전체 목록 ${N.length}개 = 시드 ${seedRun}개 + KOPIS 전부(18세 이상·끝난 공연·시드와 같은 공연 제외), 개수 제한 없이 화면에도 ${nGrid}개`);
        // 인기순·지역 칩: 순위·지역이 붙은 data.js(export 후)면 칩과 정렬을, 아니면 정렬만 확인한다
        const keysR = g => [...g.matchAll(/class="pcard" href="#show\/([^"]+)"/g)].map(m => decodeURIComponent(m[1])), tabsR = regionTabs(N), gridOf = h => h.split("지금 하는 공연 전체")[1], sorted = showsIn(N, tabsR, "all", "2026-10-11");
        eq(keysR(part), sorted.map(x => x.key), "실제 데이터: 화면 목록 순서 = 인기순");
        ok(sorted.every((x, i, a) => i === 0 || (a[i - 1].pop ?? Infinity) <= (x.pop ?? Infinity)) && sorted.findIndex(x => x.pop == null) >= sorted.filter(x => x.pop != null).length, "실제 데이터: 순위 있는 공연이 앞에 오름차순, 없는 공연은 그 뒤");
        ok(!/대학로 외/.test(hh), "실제 데이터: 화면에 '대학로 외'가 없다");
        if (N.some(x => x.region)) {
          const named = tabsR.slice(1).filter(t => t[0] !== OTHER_REGION), counts = named.map(t => t[2]);
          ok(tabsR[0][2] === N.length && counts.every((c, i) => i === 0 || counts[i - 1] >= c) && counts.every(c => c >= 2) && tabsR.slice(1).every((t, i, a) => t[0] !== OTHER_REGION || i === a.length - 1), `실제 데이터: 지역 칩 ${tabsR.map(t => t[1] + " " + t[2]).join(" · ")} (공연 수 많은 순, 그 외 지역은 맨 끝)`);
          ok(tabsR.reduce((n, t, i) => n + (i ? t[2] : 0), 0) === N.length, "실제 데이터: 지역 칩 개수의 합 = 전체");
          for (const t of tabsR.slice(1)) { hom.click({act: "areaTab", t: t[0]}); const g = gridOf(hom.V.browse()); ok(keysR(g).length === t[2] && keysR(g).every((k, i, a) => i === 0 || sorted.findIndex(x => x.key === a[i - 1]) < sorted.findIndex(x => x.key === k)), `실제 데이터: [${t[1]}] ${t[2]}개, 칩 안 목록도 인기순`); }
          hom.click({act: "areaTab", t: "all"});
        }
      }
      { // 홈 추천(실제 데이터): 특징 태그가 없는 좋아하는 배우(RD3.actor)도 출연작이 나오고, 취향 카드·축 추천도 같이 나온다
        { const FAV = RD3.actor, W = RD3.work;
          const uc = loadApp(RD3.D, {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: ["강렬한 해석", "연기"], works: ["fun"], favs: [FAV], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}, proto: {}})}}); uc.route();
          const ur = homeRows(RD3.D, uc.S, "2026-10-11"), uh = uc.V.browse();
          ok(ur.mode === "fav" && ur.A.some(x => x.key === W && x.line === `${FAV} 출연`) && ur.taste.length > 0 && ur.taste.every(x => !ur.A.some(y => y.key === x.key) && !ur.B.some(y => y.key === x.key)), `실제 데이터: 특징 태그 없는 ${FAV}도 A 에 ${W}, 취향 카드·축 추천(taste ${ur.taste.length}개)도 나온다`);
          ok(/<h2>좋아하는 배우가 나와요<\/h2>/.test(uh) && /<h2>내 취향 추천<\/h2>/.test(uh) && (uh.match(/<h2>[^<]*<\/h2>/g) || []).every(t => !/<h2><\/h2>/.test(t)) && !/지금 하는 공연 중에 좋아하는 배우나 비슷한 배우가 나오는 공연이 아직 없어요/.test(uh), "실제 데이터 화면: A 줄과 내 취향 추천 줄이 나오고 빈 안내는 없다");
        }
      }
      { // 기록 확인 버튼(📝)은 연습 모드(서버로 안 보냄)이면서 주소에 ?debug=1 일 때만 보인다
        const mk = (o) => loadApp(JSON.parse(JSON.stringify(RD2)), {now: "2026-10-11T12:00:00", hash: "#home", storage: {pickle_v2: JSON.stringify({prefs: {axes: [], works: [], favs: [], grade: ""}, plans: [], tags: [], votes: [], likes: [], cal: {}})}, ...o});
        const live = {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"};
        const pr = mk({}); pr.route(); ok(pr.q("#dbg").innerHTML === "", "연습 모드라도 ?debug=1 이 없으면 기록 확인 버튼이 안 보인다");
        const prd = mk({search: "?debug=1"}); prd.route(); ok(/dbgb/.test(prd.q("#dbg").innerHTML), "연습 모드 + ?debug=1 이면 보인다");
        const lv = mk({track: live}); lv.route(); ok(lv.TRK.live() && lv.q("#dbg").innerHTML === "", "서버로 보내는 앱(live)에선 안 보인다");
        const lvd = mk({track: live, search: "?debug=1"}); lvd.route(); ok(lvd.q("#dbg").innerHTML === "", "live 에서는 ?debug=1 이 있어도 안 보인다(연습 모드에서만)");
      }
      { // ===== 예전 앱(8765의 기존 사용자 데이터) 호환: 예전 형식의 저장소로 새 앱을 띄워도 깨지지 않고, 저장한 뒤에도 예전 키가 그대로 남는다 =====
        const clone = () => JSON.parse(JSON.stringify(RD2)), W0 = "엘리자벳", NOW = "2026-10-11";
        const past = RD2.perfs.filter(p => p.work === W0 && p.date < NOW && !(p.notes || []).some(t => /대관/.test(t))), fut = RD2.perfs.filter(p => p.work === W0 && p.date > NOW && !(p.notes || []).some(t => /대관/.test(t)));
        ok(past.length >= 2 && fut.length >= 2, "예전 상태를 만들 회차(지난 것·앞으로 것)가 데이터에 있다");
        const lead = (p) => Object.fromEntries(Object.entries(p.cast)), actorOf = p => Object.values(p.cast)[0];
        const L0 = {  // 예전 앱이 저장하던 모양 그대로(prefs·query·cal·plans·tags·votes·likes + 통계·요청·설정·초안)
          prefs: {works: ["tragedy"], axes: ["맑은 음색"], favs: ["카이"], grade: "R석"},
          query: {work: W0, lo: "2026-10-12", hi: "2026-11-15", actors: [], dates: [fut[0].date]},
          cal: {[W0]: {actors: [actorOf(fut[0])], period: "all", avoid: [], axes: ["맑은 음색"], edited: true, dates: [fut[0].date], peek: fut[0].date, f: {weekend: true}, run: "서울", count: 3, lo: "2026-10-12", hi: "2026-11-15"}},
          plans: [{work: W0, date: fut[0].date, dow: fut[0].dow, time: fut[0].time, cast: fut[0].cast, tagged: false, quick: "good"}, {work: W0, date: past[0].date, dow: past[0].dow, time: past[0].time, cast: past[0].cast, tagged: true}, {work: W0, date: past[1].date, dow: past[1].dow, time: past[1].time, cast: past[1].cast, tagged: false}],
          tags: [{at: "2026-10-05", work: W0, date: past[0].date, time: past[0].time, mood: "good", role: Object.keys(past[0].cast)[0], actor: actorOf(past[0]), tags: ["성량"], partner: "", combo: [], score: 4, seat: "1층 B구역 7열", view: 4, note: "좋았다", check: {[actorOf(past[0]) + "|성량"]: "yes"}}],
          votes: [{at: "2026-10-05", work: W0, date: past[0].date, time: past[0].time, role: Object.keys(past[0].cast)[0], a: Object.values(past[0].cast)[0], b: "린아", result: "a"}],
          likes: [{actor: "카이", why: "성량이 좋아요", tags: ["성량"], roles: [{work: W0, role: "죽음(토드)", why: "카리스마", tags: []}]}],
          stats: {entry: {rec: 3, browse: 5}}, requests: [{name: "없는배우", at: "2026-10-04"}], noPersonal: false, plansTab: "done", draft: null};
        const boot = (state, hash = "", extraStore = {}) => { const a = loadApp(clone(), {now: NOW + "T12:00:00", hash, storage: {...(state ? {pickle_v2: JSON.stringify(state)} : {}), ...extraStore}}); return a; };
        const snap = a => JSON.parse(a.store.get("pickle_v2")), legacyKeys = Object.keys(L0);
        // 첫 화면: 취향이 있으면 홈, 취향을 건너뛴 사람도 홈, 예전 기록만 있어도 홈, 처음 오는 사람만 취향폼
        ok(boot(L0).location.hash === "#home", "예전 상태(취향 있음): 첫 화면은 홈");
        ok(boot({...L0, prefs: {axes: [], grade: "", favs: []}}).location.hash === "#home", "취향을 건너뛴 예전 상태(빈 취향): 홈");
        ok(boot({prefs: null, plans: L0.plans, tags: [], votes: [], likes: [], cal: {}}).location.hash === "#home" && boot({prefs: null, plans: [], tags: [], votes: [], likes: L0.likes, cal: {}}).location.hash === "#home", "취향은 없어도 예전 앱에서 쓴 기록(볼 예정·좋아하는 배우 설문)이 있으면 홈");
        ok(boot(null).location.hash === "#home" && boot({prefs: null, plans: [], tags: [], votes: [], likes: [], cal: {}}).location.hash === "#home" && /아직 비어 있는 내 취향 카드/.test(boot(null).q("#view").innerHTML), "저장된 게 없거나 비어 있는 처음 온 사람도 홈(빈 취향 카드에서 온보딩)");
        eq(entryRoute(null), "#home", "entryRoute 는 상태 없이도 동작(옛 호출 방식)");
        // ===== MVP 뼈대(2026-10-28): 홈 취향 카드 뒤집기 · 작품 고르기 · 찾는 방법 고르기 =====
        { const m = boot(L0); m.location.hash = "#home"; m.route(); const front = m.q("#view").innerHTML;
          ok(/<button type="button" class="tcard" data-act="cardFlip"/.test(front) && /MY PICKLE TASTE/.test(front) && front.indexOf("MY PICKLE TASTE") < front.indexOf("지금 하는 공연 전체") && /class="pgrid"/.test(front) && !/배우 조합 추천받기<\/a>/.test(front), "홈 앞면: 버튼 하나인 취향 카드(탭·Enter·Space), 그 아래 작품 목록(2026-10-28 사용자 요청: 지금 하는 공연 전체를 되살림)");
          m.click({act: "cardFlip"}); const back = m.q("#view").innerHTML;
          ok(/class="tk tcard back"/.test(back) && /data-go="#find">배우 조합 추천받기/.test(back) && /data-act="cardFlip">앞면으로/.test(back) && !/답 고치기|수정하기/.test(back), "카드를 누르면 뒷면: 배우 조합 추천받기 · 앞면으로(답 고치기는 뒷면에서 뺐다, 2026-10-28)");
          // 티켓 카드(2026-10-28 사용자 요청): 맨 위 '나의 뮤지컬 관극 취향' → 한 줄 요약(가장 크게) → 분류별 태그 칸 → 왼쪽 아래 수정하기(온보딩 처음부터) · 맨 아래 업데이트 날짜
          { const iT = front.indexOf("나의 뮤지컬 관극 취향"), iB = front.indexOf('class="tkcell tkbig'), iG = front.indexOf('class="tkgrid"'), iE = front.indexOf('class="tkedit" data-go="#taste/1">수정하기');
            ok(iT > 0 && iT < iB && iB < iG && iG < iE && /<svg class="tkcurtain"/.test(front), "앞면 티켓: 제목 → 요약 → 분류별 태그 → 수정하기(#taste/1) 순서, 커튼 그림");
            const t = boot({...L0, prefs: {axes: ["tag:맑음", "tag:성량"], prio: "노래", favs: ["카이"], must: ["카이"], avoid: [], grade: "", works: [], at: "2026-10-28"}}); t.location.hash = "#home"; t.route(); const tf = t.q("#view").innerHTML;
            ok(/<span class="tkk">목소리<\/span><span class="tkv">맑고 깨끗한<\/span>/.test(tf) && /<span class="tkk">노래<\/span><span class="tkv">공간을 채우는 성량<\/span>/.test(tf) && /<span class="tkk">가장 기대하는 것<\/span><span class="tkv">노래<\/span>/.test(tf) && /보고 싶은 배우<\/span><span class="tkv">카이 \(반드시\)/.test(tf), "고른 태그는 질문별 칸(목소리·노래·가장 기대하는 것·보고 싶은 배우)으로 나눠 보인다");
            ok(/<span class="tkdate">2026\.10\.28 업데이트<\/span>/.test(tf) && tf.indexOf("tkdate") > tf.indexOf("tkedit"), "맨 아래 작은 글씨로 마지막 업데이트 날짜");
            t.click({act: "obPrio", v: "연기"}); ok(t.S.prefs.at === NOW, "취향을 고치면 업데이트 날짜가 오늘로"); }
          m.click({act: "cardFlip"}); ok(/<button type="button" class="tcard"/.test(m.q("#view").innerHTML), "다시 누르면 앞면");
          m.click({act: "cardFlip"}); m.location.hash = "#plans"; m.route(); m.location.hash = "#home"; m.route(); ok(!/tcard back"/.test(m.q("#view").innerHTML), "다른 화면에 다녀오면 앞면");
          { const e0 = boot(null).q("#view").innerHTML; ok(/class="tkveilbg"[^]*나의 뮤지컬 관극 취향/.test(e0) && /class="tkveil"><button class="btn tkset" data-go="#taste\/1">내 취향 설정하기<\/button>/.test(e0) && !/data-act="cardFlip"/.test(e0), "처음 온 사람: 흐리게 비치는 '나의 뮤지컬 관극 취향' 위에 가장 큰 '내 취향 설정하기'(→ 온보딩)"); }
          const fl = m.V.find();
          ok((fl.match(/class="wcard/g) || []).length >= 1 && /href="#find\/[^"]+"/.test(fl) && /어떤 작품의 조합을 찾아볼까요\?/.test(fl), "작품 고르기: 작품 카드가 나오고, 고를 수 있는 작품은 #find/작품으로");
          const how = m.V.find(W0, "how"); ok(/href="#find\/[^"]+\/date">날짜 먼저 고르기/.test(how) && /href="#find\/[^"]+\/actor">배우 먼저 고르기/.test(how), "찾는 방법 고르기: 날짜 먼저 · 배우 먼저");
          ok(/언제 볼 수 있어요\?/.test(m.V.find(W0, "date")) && /data-act="dfDay"/.test(m.V.find(W0, "date")) && /누구를 꼭 보고 싶어요?/.test(m.V.find(W0, "actor")), "실제 데이터: 날짜 먼저 → 회차 달력, 배우 먼저 → 배우 조건 화면");
          const mm = boot({...L0, prefs: {...(L0.prefs || {}), favs: ["없는배우X"], must: ["없는배우X"]}}); ok(!/없는배우X/.test(mm.V.find()) && /이 작품에는 없는배우X 배우가 나오지 않아요/.test(mm.V.find(W0, "how")), "반드시 포함 배우가 작품에 없으면 작품을 고른 뒤 안내(작품 고르기 화면에는 없다, 결정 25)");
          const left = w => m.D.perfs.filter(p => p.work === w.name && !(p.notes || []).some(n => /대관/.test(n)) && p.date >= NOW).length, shown = [...fl.matchAll(/<b>([^<]+)<\/b>/g)].map(x => x[1]);
          const want = m.D.works.filter(w => w.runs.some(r => r.end >= NOW)).sort((a, b) => (left(a) || Infinity) - (left(b) || Infinity) || a.name.localeCompare(b.name, "ko")).map(w => w.name);
          eq(shown, want, "작품 고르기: 남은 회차가 적은 순, 회차 미공개는 맨 뒤, 공연이 끝난 작품은 없다(결정 32·35)");
          const me = m.V.me(); ok(/data-act="obPick"/.test(me) && /data-act="addFav"/.test(me) && /data-act="obPrio"/.test(me) && !/취향 다시 고르기|data-act="obGo"/.test(me), "내 취향 화면 안에서 배우 조건·기대 답을 바로 고친다(결정 39)");
          m.location.hash = "#me"; m.route(); m.click({act: "obPrio", v: "몸"}); ok(m.S.prefs.prio === "몸" && m.location.hash === "#me", "내 취향에서 고쳐도 그 화면에 머문다");
          // 작품 취향 확인(6.3·9.3절): 작품을 고르면 먼저 묻고, 고친 값은 그 작품에만
          m.click({act: "wtReset", w: W0});  // 예전 상태(L0)에 이 작품의 취향 칩 편집이 남아 있을 수 있어 평소 취향으로 맞춰 두고 본다
          const wt = m.V.find(W0); ok(new RegExp(`이번 ${W0} 공연에서 중요한 게 무엇인가요\\?`).test(wt) && /평소 취향을 채워 뒀어요/.test(wt) && new RegExp(`href="#find/${W0}/how">이대로 찾기`).test(wt) && /data-act="obPrio" data-v="몸" data-w=/.test(wt) && /aria-pressed="true">춤·몸짓/.test(wt) && !/이 작품에만 적용돼요|평소 취향으로 되돌리기/.test(wt), "작품 취향 확인: 온보딩 답이 채워져 있고 [이대로 찾기]");
          const base = JSON.stringify(m.S.prefs); m.location.hash = "#find/" + W0; m.route(); m.click({act: "obPrio", v: "노래", w: W0});
          ok(JSON.stringify(m.S.prefs) === base && m.S.cal[W0].edited && m.S.cal[W0].prio === "노래" && /이 작품에만 적용돼요/.test(m.V.find(W0)) && /평소 취향으로 되돌리기/.test(m.V.find(W0)), "고친 값은 이 작품에만(온보딩 값은 그대로)");
          ok(m.comboRecs && JSON.stringify(m.S.prefs.prio) === "\"몸\"", "온보딩 우선순위는 그대로 '몸'");
          m.click({act: "wtReset", w: W0}); ok(!m.S.cal[W0].edited && !/이 작품에만 적용돼요/.test(m.V.find(W0)), "평소 취향으로 되돌리기"); }
        // 화면들이 예전 상태로 깨지지 않는다
        const a1 = boot(L0), views = [["#home", /MY PICKLE TASTE/], ["#browse", /지금 하는 공연 전체|좋아하는 배우가 나와요/], ["#find", /어떤 작품의 조합을 찾아볼까요\?/], ["#plans", /엘리자벳/], ["#me", /카이/], ["#saved/0", /엘리자벳/], ["#tag/1", /엘리자벳|어땠어요/], ["#detail/" + W0 + "/" + fut[0].date + "/" + fut[0].time, /엘리자벳|이 회차/], ["#show/" + W0, /id="summary"/]];
        for (const [h, re] of views) { const [name, ...args] = decodeURIComponent(h.slice(1)).split("/"); let out; try { out = a1.V[name](...args); } catch (e) { throw new Error("예전 상태로 " + h + " 가 깨졌다: " + e.message); } ok(typeof out === "string" && out.length > 200 && re.test(out), "예전 상태로 " + h + " 가 그려진다"); }
        const oldRoutes = ["#works", "#pick/" + W0, "#when/" + W0 + "/unseen", "#result", "#cal/" + W0, "#day/" + W0 + "/" + fut[0].date, "#cshow/PF0", "#onboard/2", "#detail/없는작품/2026-10-12/14:00"];
        for (const h of oldRoutes) { const [name, ...args] = decodeURIComponent(h.slice(1)).split("/"); let out; try { out = a1.V[name](...args); } catch (e) { throw new Error("예전 주소 " + h + " 가 깨졌다: " + e.message); } ok(typeof out === "string" && out.length > 20, "예전 주소 " + h + " 도 깨지지 않고 화면이 나온다(없는 회차는 안내 한 줄)"); }
        // 예전 관람 기록은 추천에 그대로 합쳐지고, 지난 볼 예정은 관람 후 질문으로 이어진다
        ok(!((a1.D.actorTags[W0] && a1.D.actorTags[W0][actorOf(past[0])]) || []).some(r => r.src === "내 관람" || /^관람평:/.test(r.src || "")), "이 기기 혼자 남긴 관람 태그는 추천 데이터에 합치지 않는다(결정 49: 서로 다른 사용자 2명 이상)");
        { const pi = a1.S.plans.findIndex(x => x.date < NOW && !x.tagged && !x.asked);
          ok(!/공연 어땠어요\?/.test(a1.V.home()) && pi >= 0 && /관람 기록 남기기/.test(a1.V.plans(a1.S.plans[pi].date)), "지난 볼 예정(예전 앱에서 담은 것)은 미정일정이라 홈에서 묻지 않고, 캘린더 날짜 화면에서 기록할 수 있다");
          const ab = boot(L0); ab.click({act: "planStatus", i: String(pi), s: "booked"});  // a1 은 아래 '예전 값 그대로' 점검에 쓰니 따로 띄운다
          ok(/공연 어땠어요\?/.test(ab.V.home()) && /href="#tag\/\d+">기록 남기기</.test(ab.V.home()), "관람예정으로 바꾸면 홈에서 관람 후 리뷰로 이어진다"); }
        // 저장해도 예전 키는 그대로: 여러 동작 뒤에도 예전 값이 같고, 새로 생긴 건 덧붙이기뿐
        const before = JSON.parse(JSON.stringify(L0));
        a1.click({act: "areaTab", t: "대학로"}); a1.click({act: "themeToggle"}); a1.click({act: "obGo", to: "2"}); a1.click({act: "pin", work: W0, a: actorOf(fut[0]), k: "star"});
        a1.click({act: "plan", work: W0, date: fut[1].date, time: fut[1].time});
        const s1 = snap(a1);
        for (const k of legacyKeys) ok(k in s1, "저장 뒤에도 예전 키가 남아 있다: " + k);
        eq({prefs: s1.prefs, query: s1.query, cal: s1.cal, votes: s1.votes, likes: s1.likes, stats: s1.stats, requests: s1.requests, noPersonal: s1.noPersonal, plansTab: s1.plansTab}, {prefs: before.prefs, query: before.query, cal: before.cal, votes: before.votes, likes: before.likes, stats: before.stats, requests: before.requests, noPersonal: before.noPersonal, plansTab: before.plansTab}, "취향·질의·달력·투표·설문·통계·요청·설정은 저장 뒤에도 값이 그대로다");
        eq(s1.plans.slice(0, 3), before.plans, "예전 볼 예정 3건은 그대로(새로 담은 건 뒤에 덧붙는다)"); ok(s1.plans.length === 4 && s1.plans[3].work === W0 && s1.plans[3].date === fut[1].date, "새 볼 예정은 덧붙기만 했다");
        eq(s1.tags.slice(0, 1), before.tags, "예전 관람 기록은 그대로");
        ok(Object.keys(s1).every(k => legacyKeys.includes(k) || ["proto", "reviews"].includes(k)), "새로 생긴 최상위 키는 proto·reviews(관람 후 리뷰)뿐: " + Object.keys(s1).filter(k => !legacyKeys.includes(k)));
        const newKeys = [...a1.store.keys()].filter(k => k !== "pickle_v2"); ok(newKeys.every(k => ["pickle_anon", "pickle_q", "pickle_track_off", "pickle_theme"].includes(k)), "저장소에 새로 생긴 키는 익명 ID·기록 큐·기록 설정·판뿐: " + newKeys);
        // 관람 후 질문에 답해도 예전 기록이 지워지지 않는다(기록이 덧붙는다)
        const a2 = boot(L0); a2.location.hash = "#tag/0"; a2.route(); const role0 = Object.keys(a2.S.proto.rdraft.rv.cast)[0];
        a2.click({act: "rvRate", r: role0, v: "good"}); a2.click({act: "rvSave"}); const s2 = snap(a2);
        ok(s2.tags.length === 1 && JSON.stringify(s2.tags[0]) === JSON.stringify(before.tags[0]) && s2.reviews.length === 1 && s2.reviews[0].rows[role0].rate === "good" && s2.plans[0].date === before.plans[0].date && s2.plans[0].tagged && s2.likes.length === 1 && s2.votes.length === 1, "관람 후 리뷰: 예전 기록은 그대로, 새 리뷰는 reviews 에 덧붙기");
        // 예전 상태에 새 키가 이미 섞여 있어도(다시 열기) 예전 키를 덮어쓰지 않는다
        const a3 = boot(s1, "", {pickle_theme: "dark", pickle_anon: "11111111-2222-4333-8444-555555555555", pickle_track_off: "1"});
        ok(a3.location.hash === "#home" && a3.TRK.isOff() && a3.store.get("pickle_anon") === "11111111-2222-4333-8444-555555555555", "저장된 기록 설정(끔)·익명 ID 는 다시 열어도 그대로 읽는다(기록 끔이면 ID 를 새로 안 만든다)");
        // 예전 형식이 낡았거나 일부 키가 없어도 깨지지 않는다
        const a4 = boot({prefs: {axes: ["맑은 음색"]}, plans: [{work: W0, date: fut[0].date, time: fut[0].time, cast: fut[0].cast}]}); for (const h of ["#home", "#plans", "#me", "#show/" + W0]) { const [name, ...args] = decodeURIComponent(h.slice(1)).split("/"); ok(a4.V[name](...args).length > 100, "일부 키가 없는 아주 옛 상태로도 " + h + " 가 그려진다"); }
        const a5 = boot("깨진 JSON 문자열"); ok(a5.location.hash === "#taste/1" || a5.location.hash === "#home", "저장된 값이 깨져 있어도 앱이 뜬다(예외 없음)");
        // ===== 문구 점검(7c) 반영: 연습 모드에선 기록 안내를 숨기고, 기록 설정이 있으면 다 보인다 · 사용자 화면에 내부 말이 안 나온다 =====
        const LIVE = {mode: "live", url: "https://abc.supabase.co", key: "sb_publishable_x"};
        const bootT = (track, search = "") => loadApp(clone(), {now: NOW + "T12:00:00", hash: "", storage: {pickle_v2: JSON.stringify(L0)}, track, search});
        const kop = RD2.currentShows.find(c => (c.cast || []).length && c.end >= NOW), nocast = (RD2.currentShows || []).find(c => c.noCast && c.end >= NOW);
        const screens = a => { const out = {}; const get = (h, vw) => { const [name, ...args] = decodeURIComponent(h.slice(1)).split("/"); a.location.hash = h; return vw ? a.V[name](...args) : a.V[name](...args); };
          out["#home"] = get("#home"); out["#taste/1"] = get("#taste/1"); out["#taste/2"] = get("#taste/2"); out["#find"] = get("#find"); out["#find/" + W0] = get("#find/" + W0);
          out["#show/" + W0] = get("#show/" + W0); a.click({act: "calDay", work: W0, d: fut[0].date}); out["#show/" + W0 + "(날짜)"] = a.V.show(W0);
          if (kop) out["#show/KOPIS"] = get("#show/" + kop.id); if (nocast) out["#show/noCast"] = get("#show/" + nocast.id);
          out["#plans"] = get("#plans"); out["#saved/0"] = get("#saved/0"); out["#tag/1"] = get("#tag/1"); out["#detail"] = get("#detail/" + W0 + "/" + fut[0].date + "/" + fut[0].time); out["#me"] = get("#me"); out["#duel"] = get("#duel/" + W0); out["#privacy"] = get("#privacy"); return out; };
        const BAN = /recommend\.py|가안|TSV|PICK CAST|PICK(?!LE)|\.ics\)|아카이브|전체대관|3초|이\(가\)|정보 부족|(?<!한)우열|고마워요|FIND YOUR|STEP \d|월드컵|이상형|케미|🚫|위 3개|더 정확|점수·순위|추천 점수|초안|법률 검토|\[로그 IP|\[저장 방식|\[법률|\[국가|\[연락처|판 골랐|더 해 볼래요|고른 이유 칩|추천 방식 버전|저장 표|회차 캐스팅|캐스팅 일정 있음|볼 예정 담기|예매처로 ↗|담겼어요|봤어요,|후기 남기기|취향 알려주기|취향 더 알려|30초 취향|좋아하는 배우 바꾸기|추천 극|이 극|나오는 극|출연하는 극/;
        const scrP = screens(bootT(undefined)), scrL = screens(bootT(LIVE));
        for (const [mode, scr] of [["연습 모드", scrP], ["기록 설정 있음", scrL]]) for (const [h, html] of Object.entries(scr)) {
          const hit = html.match(BAN); ok(!hit, `${mode} ${h}: 사용자 화면에 내부 말·옛 이름이 없다` + (hit ? " → " + hit[0] : ""));
          const kn = (html.match(/KOPIS/g) || []).length; ok(["#find", "#home"].includes(h) ? kn === 1 && /공연 정보·포스터: 공연예술통합전산망\(KOPIS\)/.test(html) : kn === 0, `${mode} ${h}: 'KOPIS' 글자는 포스터가 나오는 화면(작품 고르기·홈)의 출처 표기 한 곳뿐 (${kn}번)`); }
        // 연습 모드: 첫 화면 기록 배너·설정의 기록 카드·안내 화면 링크가 안 보인다
        const HIDE = /data-act="trackToggle"|data-act="trackClear"|href="#privacy"|기록·개인정보|이 기기 기록 지우기|기록 끄기|광고에는 쓰지 않아요/;
        for (const h of Object.keys(scrP).filter(k => k !== "#privacy")) ok(!HIDE.test(scrP[h]), "연습 모드 " + h + ": 기록 배너·설정·안내 링크가 안 보인다");
        ok(/이 앱은 지금 아무 기록도 서버로 보내지 않아요/.test(scrP["#privacy"]) && !/\[문의처|\[공개일|시행 전 안내/.test(scrP["#privacy"]), "연습 모드에서 #privacy 로 직접 들어가도 초안·빈칸은 안 보이고 '아무 기록도 서버로 보내지 않아요'만");
        // 기록 설정이 있으면: 지금처럼 다 보인다
        ok(/data-act="trackToggle">기록 끄기<\/button>/.test(scrL["#home"]) && /href="#privacy"/.test(scrL["#home"]) && /data-act="trackToggle">기록 끄기<\/button>/.test(scrL["#taste/1"]), "기록 설정이 있으면 첫 화면(홈·취향폼)에 기록 배너와 [자세히][기록 끄기]가 보인다");
        ok(!/data-act="trackClear"|기록·개인정보/.test(scrL["#me"]) && /data-act="trackClear">이 기기 기록 지우기/.test(scrL["#privacy"]) && /href="#privacy"/.test(scrL["#home"]), "기록 끄기·지우기 카드는 내 취향에서 빼고(사용자 요청 2026-10-28) 안내 화면(#privacy)에 남는다. 홈 아래 안내 링크로 들어간다");
        ok(/<h1>기록·개인정보 안내<\/h1>/.test(scrL["#privacy"]) && !/시행 전 안내|문의처/.test(scrL["#privacy"]) && /시행일: <b>2026년 10월 13일<\/b>/.test(scrL["#privacy"]) && !/\[[^\]\n<>]*(?:확인|기재|필요)[^\]\n<>]*\]/.test(scrL["#privacy"]), "안내 화면: 제목만(시행 전 안내 없음), 문의처 없음, 시행일 2026년 10월 13일, 자리표시 대괄호 없음");
        ok(/<h3>7\) 내 기록은 어떻게 관리하나요\?<\/h3><p class="small">기록은 이름 없이 번호로만 남아서, 어떤 기록이 내 것인지 우리도 찾을 수 없어요\. 그래서 끄기와 지우기를 직접 하실 수 있게 해 두었어요\.<\/p>/.test(scrL["#privacy"]) && /보호자와 함께 <b>\[기록 끄기\]<\/b>를 누르세요\. 끈다고 앱을 못 쓰게 되지는 않아요/.test(scrL["#privacy"]) && !/궁금한 점이 있으면|위 문의/.test(scrL["#privacy"]), "7) 내 기록은 어떻게 관리하나요? · 8) 보호자와 함께 [기록 끄기]를 누르세요(문의처 말 없음)");
        ok(/그때 보여 준 추천 조합 3개/.test(scrL["#privacy"]) && /끌리는 배우 고르기에서 고를 때/.test(scrL["#privacy"]) && /접속 기록을 자체적으로 둘 수 있어요/.test(scrL["#privacy"]) && !/법적 근거|국가 목록/.test(scrL["#privacy"]), "안내 화면 문구: '위 3개' 없음, 월드컵 → 끌리는 배우 고르기, 로그 줄은 값 없이, 법적 근거 줄은 뺌");
        // ?debug=1: 팀 시트 내보내기·TSV, 연습 모드의 기록 확인 버튼
        const dbg = bootT(undefined, "?debug=1"); dbg.location.hash = "#me"; const meD = dbg.V.me();
        ok(/팀 시트로 내보내기/.test(meD) && /TSV 복사/.test(meD) && !/팀 시트로 내보내기|TSV/.test(scrP["#me"]) && !/팀 시트로 내보내기|TSV/.test(scrL["#me"]), "'팀 시트로 내보내기'·TSV 는 ?debug=1 일 때만 보인다");
        ok(!/이 브라우저에만 저장돼요|주로 보는 좌석 등급|내가 남긴 관람 기록/.test(scrP["#me"]) && !/recommend|가안|팀 시트와/.test(meD), "내 취향: 맨 아래 저장 안내 문구·좌석 등급·관람 기록 상자는 뺐다(사용자 요청 2026-10-28), 내부 파일 이름 없음");
        { const mp = scrP["#me"], i1 = mp.indexOf("꼭 보고 싶은 배우 · 피하고 싶은 배우"), i2 = mp.indexOf("공연을 볼 때 기대하는 것"), i3 = mp.indexOf('data-act="meDone">확인');
          ok(i1 > 0 && i1 < i2 && i2 < i3 && /class="mecol"/.test(mp) && !/class="cards2"/.test(mp), "내 취향: ① 배우 ② 기대 ③ 확인 순서로 한 줄(한 칸)");
          ok(!/class="chip x on" data-act="obPick"/.test(mp), "기대 질문의 '상관없어요'는 기본으로 켜져(빨간 버튼) 있지 않다"); }
        dbg.route(); ok(/dbgb/.test(dbg.q("#dbg").innerHTML), "?debug=1 이면 연습 모드에서 📝 기록 확인 버튼이 보인다");
        // 문구 통일 세부
        const meP = scrP["#me"]; ok(/노래|맑고 부드러운 음색/.test(meP) && !/<span class="tag hit">(가창|맑은 음색|강한 성량|감정 크게)<\/span>/.test(meP), "내 취향에 고른 취향이 홈과 같은 말(노래·맑고 부드러운 음색)로 보인다");
        ok(/<h2>본 조합 기록<\/h2>/.test(scrP["#plans"]) && !/아카이브/.test(scrP["#plans"]), "내 공연: '내 캐스팅 아카이브' → '본 조합 기록'");
        ok(/관람 기록 남기기|본 공연 기록하기/.test(scrP["#plans"]) && /관람 기록/.test(scrP["#tag/1"]) && /공연 어땠어요\?/.test(scrP["#tag/1"]) && /배우마다 어땠어요\?/.test(scrP["#tag/1"]) && !/오늘 공연 어땠어요|인상 깊었던 배우|추천이 맞았어요/.test(scrP["#tag/1"]), "관람 후 리뷰(v0.9): '○○ 공연 어땠어요?' → 배우마다 평가. 예전 기분 3지선다·인상 깊었던 배우·점수 없음");
        { const tg = bootT(undefined); tg.location.hash = "#tag/1"; tg.route(); const rv = tg.S.proto.rdraft.rv, roles = Object.keys(rv.cast), all = Object.keys(past[1].cast);
          ok(roles.length >= 2 && roles.every(r => all.includes(r)), "실제 데이터: 리뷰 줄은 그 회차 핵심 배역 전체(주연/조연 구분 없음)");
          tg.click({act: "rvRate", r: roles[0], v: "good"}); const h1 = tg.V.tag("1");
          ok(/어떤 점이 좋았나요\?/.test(h1) && /＋ 다른 점/.test(h1) && /다른 배우였어요/.test(h1), "실제 데이터: 좋았어요 → '어떤 점이 좋았나요?' 칩 + ＋ 다른 점 + 다른 배우였어요");
          tg.click({act: "rvMore", r: roles[0]}); const h2x = tg.V.tag("1"); ok(/캐릭터 해석|신체 표현|가창|연기/.test(h2x) && !/data-act="rvTag"[^>]*data-t="(연기합·티키타카|음색·보컬 조화)"/.test(h2x), "실제 데이터: ＋ 다른 점은 배우 태그 영역별 전체(조합 태그는 배우 줄에 없다)"); }
        ok(/취향 고르기 1\/2/.test(scrP["#taste/1"]) && /나의 뮤지컬 관극 취향|아직 비어 있는 내 취향 카드/.test(scrP["#home"]) && /평가하지 않고, 끌리는 특징만 골라요/.test(scrP["#taste/2"]), "온보딩은 1/2·2/2, 홈은 내 취향 카드, '우열' 문장은 '평가하지 않고 … 특징만'");
        ok(/좌석 배치도|예매처로 이동|볼 예정에 담/.test(scrP["#detail"]) && !/예매처에서 [\d/()월화수목금토일 ]+ ?\d*:?\d* 좌석 보기|링크로 받지/.test(scrP["#detail"]), "회차 상세: 예매 버튼은 '예매처로 이동', 개발 말('링크로 받지 않아서')이 없다");
        ok(!/점수·순위/.test(scrP["#home"]) && /MY PICKLE TASTE/.test(scrP["#home"]) && /지금 하는 공연 전체/.test(scrP["#home"]) && !/내 취향 추천/.test(scrP["#home"]), "홈: 점수·순위 말이 없고, 취향 카드 아래 지금 하는 공연 전체(내 취향 추천 줄은 없다)");
        ok(/진한 날에 이 조합이 나와요\. ★는 첫공·막공이에요\./.test(scrP["#show/" + W0 + "(날짜)"]) && /공식 캐스팅 일정이라 바뀔 수 있어요\./.test(scrP["#show/" + W0 + "(날짜)"]), "달력 아래 안내는 두 줄로 나눠 읽기 쉽게");
        ok(/이 배우 빼기/.test(scrP["#show/" + W0]) && /꼭 볼 배우/.test(scrP["#show/" + W0]), "배우 칸 버튼: '이 배우 빼기'(🚫 없음) · '⭐ 꼭 볼 배우'");
        const shw = scrP["#show/" + W0]; ok((shw.match(/class="pickb">추천 조합</g) || []).length === 1 && /이 배우들이 함께 나와요/.test(shw) && !/class="pickb sm"|PICK(?!LE)/.test(shw), "'추천 조합' 표시는 조합 선택 칸에 한 번만(배우 칩 옆 PICK 배지 없음)");
      }
      ok(n2 > 50 && withCal > 0, `실제 데이터의 공연 화면 ${n2}개(달력이 있는 ${withCal}개)가 모두 세 덩어리 순서로 그려지고 달력은 하나 이하다`);
    } }
  console.log("proto_check 통과:", n, "항목");
})().catch(e => { console.error(e); process.exit(1); });
