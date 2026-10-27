// 2단계 개인화(내 관람 기록 → 태그 가중치) 점검. 실행: node tests/personal_check.js  (배포 대상 아님)
// app/index.html 의 <personal-weights> 블록을 그대로 꺼내 실행하므로, 앱에 실린 코드를 그대로 검증한다.
const fs = require("fs"), path = require("path"), assert = require("assert");
const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8");
const block = name => { const m = html.match(new RegExp("// <" + name + ">([\\s\\S]*?)// </" + name + ">")); assert(m, "app/index.html 에 <" + name + "> 블록이 없다"); return m[1]; };
const {personalWeights: pw, personalCounts: pc, suggestTags: suggest, opinionDist, voiceSplit, mergeTags, isOfficial, TASTE_CARDS, MUSIC_CARDS, TASTE_AXES, toggleCard, toggleAxis, cardHit, likeWorks, actorChips, followBase, hasTaste, similarWorks, traitsOf, similarTo, knownActor, addRequest, eul, roleRows, isPrivate, runningLeads, liveShows, minAge, ONBOARD_QS, togglePick, prefWeight, prefT, prefLabel, tagCounts} =
  new Function(block("personal-weights") + block("taste-first") + "; return {personalWeights, personalCounts, suggestTags, opinionDist, voiceSplit, mergeTags, isOfficial, TASTE_CARDS, MUSIC_CARDS, TASTE_AXES, toggleCard, toggleAxis, cardHit, likeWorks, actorChips, followBase, hasTaste, similarWorks, traitsOf, similarTo, knownActor, addRequest, eul, roleRows, isPrivate, runningLeads, liveShows, minAge, ONBOARD_QS, togglePick, prefWeight, prefT, prefLabel, tagCounts};")();

const W = "작품X", cast = {A역: "a1", B역: "b1", 조연역: "s1"};
const D = {
  roles: {[W]: [{role: "A역", weight: "주연"}, {role: "B역", weight: "주연"}, {role: "조연역", weight: "조연"}]},
  actorTags: {[W]: {a1: [{tag: "성량"}, {tag: "맑음"}, {tag: "성량"}], b1: [{tag: "딕션"}], s1: [{tag: "허스키"}]}},  // a1의 성량은 리뷰 두 곳 → 한 번만
  perfs: [],
};
const plan = (extra = {}) => ({work: W, date: "2026-10-10", time: "14:00", cast, ...extra});
const rec = (extra = {}) => ({work: W, date: "2026-10-10", time: "14:00", mood: "good", role: "A역", actor: "a1", tags: ["고음"], ...extra});
const S = (extra = {}) => ({plans: [plan()], tags: [rec()], votes: [], ...extra});
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 1. 좋았어요 1건 → 그날 주연 배우들의 리뷰 태그 +0.5(배우마다 1번), 내가 고른 태그 +1, 조연 태그는 무관
let w = pw(S(), D);
assert(near(w["성량"], 0.5) && near(w["맑음"], 0.5) && near(w["딕션"], 0.5), "리뷰 태그 +0.5");
assert(near(w["고음"], 1), "내가 고른 태그 +1");
assert.strictEqual(w["허스키"], undefined, "조연 태그는 제외");
// 1-1. 내가 고른 태그가 리뷰에도 있으면 더해진다(0.5 + 1)
assert(near(pw(S({tags: [rec({tags: ["성량"]})]}), D)["성량"], 1.5));
// 1-2. 앱이 합쳐 넣은 '내 관람' 태그 행은 리뷰로 세지 않는다(3번과 겹쳐 두 번 세지 않게)
const D2 = JSON.parse(JSON.stringify(D)); D2.actorTags[W].a1.push({tag: "고음", src: "내 관람"});
assert(near(pw(S(), D2)["고음"], 1), "내 관람 행은 리뷰로 안 셈");

// 2. 아쉬웠어요 → 음수
w = pw(S({tags: [rec({mood: "bad"})]}), D);
assert(near(w["성량"], -0.5) && near(w["고음"], -1));
// 2-1. 기분이 비었거나 '그저 그랬어요'면 건너뜀, 기분이 비면 저장 확인 화면의 좋아요/아쉬워요가 대신한다
assert.deepStrictEqual(pw(S({tags: [rec({mood: ""})]}), D), {});
assert.deepStrictEqual(pw(S({tags: [rec({mood: "meh"})]}), D), {});
assert(near(pw(S({tags: [rec({mood: ""})], plans: [plan({quick: "good"})]}), D)["고음"], 1));
assert(near(pw(S({tags: [rec({mood: ""})], plans: [plan({quick: "meh"})]}), D)["고음"], -1));
assert(near(pw(S({tags: [rec({mood: "good"})], plans: [plan({quick: "meh"})]}), D)["고음"], 1), "기분이 있으면 quick은 무시");
// 2-2. 플랜이 지워졌어도 D.perfs 의 캐스트로 이어진다
const D3 = {...D, perfs: [{work: W, date: "2026-10-10", time: "14:00", cast}]};
assert(near(pw(S({plans: []}), D3)["딕션"], 0.5));
assert.strictEqual(pw(S({plans: []}), D)["딕션"], undefined, "캐스트를 못 찾으면 리뷰 태그는 건너뜀");
assert(near(pw(S({plans: []}), D)["고음"], 1), "그래도 내가 고른 태그는 반영");

// 3. 비교 투표: a가 이기면 a만 가진 태그 +0.5, b만 가진 태그 -0.5, 둘 다 가진 태그는 그대로, 비슷은 무시
const D4 = {roles: D.roles, actorTags: {[W]: {x: [{tag: "성량"}, {tag: "맑음"}], y: [{tag: "성량"}, {tag: "허스키"}]}}};
const votes = r => ({plans: [], tags: [], votes: [{work: W, role: "A역", a: "x", b: "y", result: r}]});
w = pw(votes("a"), D4);
assert(near(w["맑음"], 0.5) && near(w["허스키"], -0.5) && w["성량"] === undefined);
w = pw(votes("b"), D4);
assert(near(w["맑음"], -0.5) && near(w["허스키"], 0.5));
assert.deepStrictEqual(pw(votes("tie"), D4), {});

// 4. ±2로 자름 / 0은 뺌
const many = Array.from({length: 6}, (_, i) => rec({date: `2026-10-${10 + i}`, tags: ["고음"]}));
const manyPlans = many.map(r => plan({date: r.date}));
w = pw({plans: manyPlans, tags: many, votes: []}, D);
assert.strictEqual(w["고음"], 2, "+2로 자름");
const bad = many.map(r => ({...r, mood: "bad"}));
assert.strictEqual(pw({plans: manyPlans, tags: bad, votes: []}, D)["고음"], -2, "-2로 자름");
assert.strictEqual(pw({plans: [plan(), plan({date: "2026-10-11"})], tags: [rec(), rec({date: "2026-10-11", mood: "bad"})], votes: []}, D)["고음"], undefined, "좋았던 것과 아쉬웠던 것이 상쇄되면 0 → 제외");

// 4-1. 관람 후 '추천 이유가 맞았나요?' 답(r.check): 맞았어요=1·m, 달랐어요=그 태그 건너뜀, 모르겠어요·답 없음=0.5·m
const chk = c => pw(S({tags: [rec({check: c})]}), D);
w = chk({"a1|성량": "yes", "a1|맑음": "no"});
assert(near(w["성량"], 1) && w["맑음"] === undefined && near(w["딕션"], 0.5), "yes=1, no=건너뜀, 답 없음=0.5");
assert(near(chk({"a1|성량": "?"})["성량"], 0.5), "모르겠어요는 답 없음과 같다");
w = pw(S({tags: [rec({mood: "bad", check: {"a1|성량": "yes", "a1|맑음": "no"}})]}), D);
assert(near(w["성량"], -1) && w["맑음"] === undefined, "아쉬웠어요 + 맞았어요 = -1");
assert(near(chk({"a1|고음": "no"})["고음"], 1), "내가 직접 고른 태그(r.tags)는 check와 무관하게 1");
assert(near(pw(S({tags: [rec({check: {"b1|딕션": "yes"}})]}), D)["딕션"], 1), "다른 배우 태그도 '배우|태그'로 따로 받는다");

// 4-2. 좋아하는 배우 설문(S.likes): 확정한 태그 +0.5씩, 배우 단위는 목소리 태그만, 배역 단위는 전부, 반복은 쌓이고 ±2로 자름
const lk = likes => pw({plans: [], tags: [], votes: [], likes}, D);
w = lk([{actor: "a1", why: "x", tags: ["성량", "감정 전달형"], roles: [{work: W, role: "A역", why: "y", tags: ["감정 전달형", "고음"]}]}]);
assert(near(w["성량"], 0.5), "배우 단위 목소리 태그 +0.5");
assert(near(w["감정 전달형"], 0.5), "배우 단위 비목소리 태그는 무시, 배역 단위 태그만 +0.5(한 번)");
assert(near(w["고음"], 0.5), "배역 단위 태그 +0.5");
const three = ["a1", "a2", "a3"].map(a => ({actor: a, why: "", tags: ["성량"], roles: []}));
assert(near(lk(three)["성량"], 1.5), "반복은 쌓인다");
assert.strictEqual(lk([...three, ...three, ...three])["성량"], 2, "±2로 자른다");
assert.deepStrictEqual(lk([{actor: "a1", why: "", tags: [], roles: []}]), {}, "입력 없는 배우는 반영 없음");
// 목소리 태그 목록: D.voiceTags가 있으면 그것만, 없으면 앱 안의 기본 목록(맑음·성량 등)
const likeA = [{actor: "a1", why: "", tags: ["성량", "고음"], roles: []}];
assert.deepStrictEqual(pw({plans: [], tags: [], votes: [], likes: likeA}, {...D, voiceTags: ["고음"]}), {"고음": 0.5}, "D.voiceTags에 있는 태그만 배우 단위로 반영");
assert.deepStrictEqual(pw({plans: [], tags: [], votes: [], likes: likeA}, D), {"성량": 0.5, "고음": 0.5}, "D.voiceTags가 없으면 기본 목록");
assert.deepStrictEqual(pw({plans: [], tags: [], votes: [], likes: [{actor: "a1", why: "", tags: ["성량"], roles: [{work: W, role: "A역", why: "", tags: ["성량"]}]}]}, {...D, voiceTags: ["고음"]}), {"성량": 0.5}, "배역 단위 태그는 voiceTags와 무관하게 반영");
assert.deepStrictEqual(pw({plans: [], tags: [], votes: [], likes: three, noPersonal: true}, D), {}, "반영을 끄면 설문도 빈 값");
assert.deepStrictEqual(pw(S(), D), pw({...S(), likes: []}, D), "likes가 없던 예전 상태와 같다");
assert(near(pw({...S(), likes: three}, D)["성량"], 0.5 + 1.5), "관람 기록과 설문은 더해진다(기록 0.5 + 설문 1.5)");
// suggestTags: 태그 이름이 글에 들어 있으면 후보(띄어쓰기 무시), 없으면 빈 목록. AI 없이 키워드만
assert.deepStrictEqual(suggest("성량이 크고 감정전달형이에요", ["성량", "감정 전달형", "고음"]), ["성량", "감정 전달형"]);
assert.deepStrictEqual(suggest("", ["성량"]), []);
const phrases = {"맑음": ["맑다", "청아하다", "여린 미성"], "성량": ["성량이 압도적", "파워풀하다"]};
assert.deepStrictEqual(suggest("목소리가 청아하다 그리고 파워풀하다", ["맑음", "성량", "고음"], phrases), ["맑음", "성량"], "사전 표현으로도 후보를 찾는다");
assert.deepStrictEqual(suggest("목소리가 청아하다", ["맑음", "성량"], phrases), ["맑음"]);
assert.deepStrictEqual(suggest("목소리가 청아하다", ["맑음", "성량"]), [], "phrases가 없으면 태그 이름만 본다");
assert.deepStrictEqual(suggest("여린미성이 좋아요", ["맑음"], phrases), ["맑음"], "띄어쓰기는 무시");
// 활용형(어간) 매칭: 실제 사전의 표현·태그 이름으로. 한 글자 어간(맑)은 사전 표현에서만, 바로 뒤에 어미가 붙을 때만
const dict = {"맑음": ["맑다", "청아하다", "여린 미성"], "부드러움": ["부드럽다", "포근하다", "따뜻한 톤"], "성량": ["성량이 압도적", "파워풀하다"], "딕션": ["가사가 잘 들린다", "딕션이 좋다"], "고음": ["고음이 시원하다"], "묵직한 음색": ["저음이 좋다", "묵직하다", "중후하다"], "코믹 연기": ["능청스럽다"], "현실적·생활감": ["생활감 있다", "현실적이다"]};
const dn = Object.keys(dict), sg = text => suggest(text, dn, dict);
assert.deepStrictEqual(sg("목소리가 맑고 청아해요"), ["맑음"], "맑고·청아해요");
assert.deepStrictEqual(sg("목소리가 부드러운"), ["부드러움"], "부드러운(태그 이름 어간 부드러)");
assert.deepStrictEqual(sg("목소리가 부드럽고 포근해요"), ["부드러움"], "부드럽고");
assert.deepStrictEqual(sg("파워풀해요"), ["성량"], "파워풀해요");
assert.deepStrictEqual(sg("딕션이 또렷"), ["딕션"], "태그 이름 딕션이 글에 있다");
assert.deepStrictEqual(sg("성량이 크고 고음이 시원해요"), ["성량", "고음"], "조사가 붙은 태그 이름(성량이)");
assert.deepStrictEqual(sg("묵직해서 좋아요"), ["묵직한 음색"], "묵직해서");
assert.deepStrictEqual(sg("능청스러워요"), ["코믹 연기"], "ㅂ 불규칙(능청스럽→능청스러워)");
assert.deepStrictEqual(sg("현실적인 연기였어요"), ["현실적·생활감"], "현실적이다 → 현실적인");
// 잘못 걸리면 안 되는 글: 태그 이름의 한 글자 어간(고음→고)은 쓰지 않고, 한 글자 어간(맑)은 어미가 안 붙으면 안 맞는다, 두 글자 어간도 어미가 아니면 안 맞는다
assert.deepStrictEqual(sg("고은성이 좋아요"), [], "고은성은 고음이 아니다");
assert.deepStrictEqual(sg("고민이 많아요"), [], "고민도 고음이 아니다");
assert.deepStrictEqual(sg("맑 날씨 얘기만 했어요"), [], "맑 뒤에 어미가 없으면 안 맞는다");
assert.deepStrictEqual(sg("중후반부가 지루해요"), [], "중후반은 중후하다가 아니다");
assert.deepStrictEqual(sg("비현실적인 사랑이에요"), [], "비현실적은 현실적이다가 아니다(부정 접두어)");
assert.deepStrictEqual(suggest("맑고 청아해요", ["맑음"]), [], "사전 표현이 없으면 태그 이름만 본다(한 글자 어간 맑은 태그 이름에서는 안 쓴다)");

// 4-3. 두 겹 배우 특성·근거 수준: 배우 인터뷰는 내 기록 가중치에서 빠지고, 의견 분포는 출처(sk·링크)로 센다
const Di = JSON.parse(JSON.stringify(D)); Di.actorTags[W].a1.push({tag: "고음", level: "배우 인터뷰", src: "i"}, {tag: "부드러움", level: "배우 인터뷰", src: "i"});
assert(near(pw(S(), Di)["고음"], 1) && pw(S(), Di)["부드러움"] === undefined, "인터뷰 태그는 리뷰로 안 센다(내가 고른 고음 1은 그대로, 인터뷰에만 있는 부드러움은 없음)");
const Dx = {axes: [{left: "가창", right: "연기"}, {left: "맑은 음색", right: "묵직한 음색"}, {left: "강한 성량", right: "섬세한 표현"}],
  axis: {"맑은 음색": ["맑음", "부드러움"], "묵직한 음색": ["허스키", "묵직한 음색"], "강한 성량": ["성량"], "섬세한 표현": ["섬세한 가창 표현", "감정 전달형"], "가창": ["맑음", "성량"], "연기": ["코믹 연기"]}};
const rr = (tag, link, level) => ({tag, link, src: "s", level});
assert.deepStrictEqual(opinionDist([rr("맑음", "l1"), rr("부드러움", "l2"), rr("맑음", "l3"), rr("허스키", "l4")], Dx), ["맑은 음색 3 · 묵직한 음색 1"], "의견 분포는 출처 수로");
assert.deepStrictEqual(opinionDist([rr("맑음", "l1"), rr("맑음", "l1"), rr("허스키", "l2")], Dx), ["맑은 음색 1 · 묵직한 음색 1"], "같은 링크는 한 번");
assert.deepStrictEqual(opinionDist([rr("맑음", "l1"), rr("부드러움", "l2")], Dx), [], "한쪽만 있으면 분포 없음");
assert.deepStrictEqual(opinionDist([rr("성량", "a"), rr("코믹 연기", "b")], Dx), [], "가창↔연기는 반대가 아니다");
const rs = (tag, sk) => ({tag, sk, level: "일반 관객 후기"});  // export 가 링크 대신 싣는 출처 해시(sk)로도 같은 출처를 센다
assert.deepStrictEqual(opinionDist([rs("맑음", "a1"), rs("부드러움", "a2"), rs("맑음", "a1"), rs("허스키", "b1")], Dx), ["맑은 음색 2 · 묵직한 음색 1"], "sk 가 같으면 같은 출처 한 번(링크가 없어도)");
assert.deepStrictEqual(opinionDist([{tag: "맑음", src: "내 관람"}, {tag: "허스키", sk: "z"}], Dx), ["맑은 음색 1 · 묵직한 음색 1"], "내 관람 기록(src 만 있음)도 한 출처로 센다");
// 근거 수준 새 값: 일반 관객 후기·설문·직접 관람은 관객 쪽, 배우 본인·제작진 공식은 점수에서 빠진다
for (const lv of ["배우 본인·공식", "제작진·공식", "배우 인터뷰"]) assert(isOfficial({level: lv}), lv);
for (const lv of ["전문매체·언론", "일반 관객 후기", "설문", "직접 관람", "관객 후기", "기타", "", undefined]) assert(!isOfficial({level: lv}), String(lv));
for (const lv of ["배우 본인·공식", "제작진·공식"]) { const Do = JSON.parse(JSON.stringify(D)); Do.actorTags[W].a1.push({tag: "고음", level: lv, src: "i"}, {tag: "부드러움", level: lv, src: "i"}); assert(pw(S(), Do)["부드러움"] === undefined, lv + " 태그는 리뷰로 안 센다"); }
const vsp = voiceSplit([rr("맑음"), rr("코믹 연기"), rr("성량"), rr("감정 전달형")], D);
assert.deepStrictEqual([vsp.voice.map(x => x.tag), vsp.role.map(x => x.tag)], [["맑음", "성량"], ["코믹 연기", "감정 전달형"]], "목소리 / 이 배역 두 줄");
assert.deepStrictEqual(voiceSplit([rr("고음"), rr("성량")], {...D, voiceTags: ["고음"]}).voice.map(x => x.tag), ["고음"], "D.voiceTags가 있으면 그것으로 가른다");

// 4-4. 같은 태그를 여러 작품에서 빌려 오면 칩 하나('성량 (데스노트·드라큘라)'). 이 작품 리뷰가 있으면 이 작품 태그. 같은 작품이 겹쳐도 한 번
const mg = mergeTags([{tag: "성량", from: "데스노트"}, {tag: "성량", from: "드라큘라"}, {tag: "맑음"}, {tag: "성량", from: "데스노트"}, {tag: "고음", from: "A"}, {tag: "고음", season: "2026"}, {tag: "딕션", from: "A"}, {tag: "딕션", from: "B"}]);
assert.deepStrictEqual(mg.map(g => [g.r.tag, g.froms, g.own]), [["성량", ["데스노트", "드라큘라"], false], ["맑음", [], true], ["고음", ["A"], true], ["딕션", ["A", "B"], false]], mg);
assert.strictEqual(mg[2].r.from, undefined, "이 작품 행이 섞이면 그 행이 대표(from 없음)");
assert.strictEqual(mg.length, 4, "태그마다 하나");

// 4-5. 첫 화면 '취향 먼저'
// 카드: 3개 이상 묶은 카드는 태그 둘 이상, 나머지는 하나 이상이 작품 태그에 있을 때 맞는다
const card = id => [...TASTE_CARDS, ...MUSIC_CARDS].find(c => c.id === id), tset = (...t) => new Set(t);
assert(cardHit(card("tragedy"), tset("파멸", "묵직함")) && !cardHit(card("tragedy"), tset("감동")), "비극 카드는 '감동' 하나로는 안 맞는다");
assert(cardHit(card("tragedy"), tset("감동", "파멸")) && cardHit(card("fun"), tset("유쾌")) && !cardHit(card("fun"), tset("힐링")));
assert(cardHit(card("orch"), tset("웅장한 앙상블")) && cardHit(card("orch"), tset("클래식, 오페라")) && cardHit(card("poprock"), tset("락 넘버")) && cardHit(card("show"), tset("군무")), "두 태그 카드는 하나만 있어도");
assert.strictEqual(new Set([...TASTE_CARDS, ...MUSIC_CARDS].map(c => c.id)).size, TASTE_CARDS.length + MUSIC_CARDS.length, "카드 id는 겹치지 않는다");
assert(TASTE_CARDS.length === 12 && MUSIC_CARDS.length === 5 && TASTE_CARDS.concat(MUSIC_CARDS).every(c => c.tags.length && c.l));
// 카드 고르기: 위 카드 3개·음악 줄 2개까지(서로 세지 않는다), 다시 누르면 풀림, 가득 차면 null
assert.deepStrictEqual(toggleCard(["tragedy", "fun"], "heal"), ["tragedy", "fun", "heal"]);
assert.strictEqual(toggleCard(["tragedy", "fun", "heal"], "tense"), null, "4번째는 안 된다");
assert.deepStrictEqual(toggleCard(["tragedy", "fun", "heal"], "fun"), ["tragedy", "heal"], "다시 누르면 풀림");
assert.deepStrictEqual(toggleCard(["tragedy", "fun", "heal"], "orch"), ["tragedy", "fun", "heal", "orch"], "음악 줄은 따로 센다");
assert.strictEqual(toggleCard(["orch", "jazz"], "show"), null, "음악 줄은 2개까지");
// 배우 취향 축: 키는 앱 취향 키와 같고, 한 축에서 하나만, 상관없어요는 그 축을 비운다
assert.deepStrictEqual(TASTE_AXES.map(a => [a[0], a[1]]), [["맑은 음색", "묵직한 음색"], ["강한 성량", "섬세한 표현"], ["감정 크게", "절제"], ["강렬한 해석", "자연스러운 해석"], ["가창", "연기"]]);
assert.deepStrictEqual(toggleAxis(["강한 성량"], "맑은 음색", "맑은 음색", "묵직한 음색"), ["강한 성량", "맑은 음색"]);
assert.deepStrictEqual(toggleAxis(["맑은 음색"], "묵직한 음색", "맑은 음색", "묵직한 음색"), ["묵직한 음색"], "반대쪽을 고르면 바뀐다");
assert.deepStrictEqual(toggleAxis(["맑은 음색"], "맑은 음색", "맑은 음색", "묵직한 음색"), [], "다시 누르면 풀림");
assert.deepStrictEqual(toggleAxis(["맑은 음색", "강한 성량"], "", "맑은 음색", "묵직한 음색"), ["강한 성량"], "상관없어요는 그 축만 비운다");
// 작품 정렬: 맞는 카드 수 순(같으면 목록 순), 맞는 게 없거나 일정 없는 작품은 뺀다
const Dh = {works: [{name: "A", hasSchedule: true}, {name: "B", hasSchedule: true}, {name: "C", hasSchedule: true}, {name: "D", hasSchedule: false, runs: [{end: "2026-12-31"}]}, {name: "E", hasSchedule: true}, {name: "F", hasSchedule: false, runs: [{end: "2026-01-01"}]}],
  workTags: {A: [{tag: "유쾌"}, {tag: "유쾌"}], B: [{tag: "파멸"}, {tag: "묵직함"}, {tag: "로맨스"}], C: [{tag: "감동"}, {tag: "유쾌"}], D: [{tag: "로맨스"}, {tag: "유쾌"}], F: [{tag: "로맨스"}, {tag: "유쾌"}]}};
assert.deepStrictEqual(likeWorks(Dh, ["tragedy", "romance", "fun"], "2026-10-08").map(x => [x.w.name, x.cards.map(c => c.l)]),
  [["B", ["가슴 먹먹한 비극", "로맨스"]], ["D", ["로맨스", "웃으면서 나오는 공연"]], ["A", ["웃으면서 나오는 공연"]], ["C", ["웃으면서 나오는 공연"]]], "B(2)·D(2, 회차 캐스팅이 없어도 지금 하는 작품) → A,C(1). 끝난 F는 빠지고, E는 태그가 없다");
assert.deepStrictEqual(likeWorks(Dh, []), [], "카드를 안 고르면 빈 목록");
assert.deepStrictEqual(likeWorks({works: Dh.works}, ["fun"]), [], "작품 태그가 아직 없으면(D.workTags 없음) 빈 목록");
assert.deepStrictEqual(likeWorks(Dh, ["romance"], "2026-10-08").map(x => x.w.name), ["B", "D"], "끝난 작품(F)은 회차 캐스팅이 없어도 뺀다");
assert.deepStrictEqual(likeWorks(Dh, ["romance"]).map(x => x.w.name), ["B", "D", "F"], "기준 날짜를 안 주면 끝났는지 안 본다(예전 호출)");
// 이런 배우: 남은 회차 주연 중 취향과 맞는 태그가 있고 반대 근거가 없는 배우, 이름순
const Da = {axes: [{left: "가창", right: "연기"}, {left: "맑은 음색", right: "묵직한 음색"}, {left: "강한 성량", right: "섬세한 표현"}],
  axis: {"맑은 음색": ["맑음", "부드러움"], "묵직한 음색": ["허스키"], "강한 성량": ["성량"], "섬세한 표현": ["섬세한 가창 표현"], "가창": ["맑음", "성량"], "연기": ["코믹 연기"]},
  roles: {W2: [{role: "R1", weight: "주연"}, {role: "R2", weight: "주연"}, {role: "S", weight: "조연"}]},
  perfs: [{work: "W2", date: "2026-10-10", cast: {R1: "다", R2: "가", S: "조"}}, {work: "W2", date: "2026-10-12", cast: {R1: "나", R2: "라", S: "조"}}, {work: "W2", date: "2026-09-01", cast: {R1: "지난", R2: "가", S: "조"}},
    {work: "W2", date: "2026-10-14", cast: {R1: "마", R2: "바", S: "조"}}],
  actorTags: {W2: {"가": [{tag: "맑음"}, {tag: "성량"}], "나": [{tag: "맑음"}, {tag: "허스키"}], "다": [{tag: "허스키"}], "라": [{tag: "섬세한 가창 표현"}], "조": [{tag: "맑음"}], "지난": [{tag: "맑음"}],
    "마": [{tag: "맑음", level: "배우 본인·공식"}], "바": [{tag: "맑음"}, {tag: "섬세한 가창 표현"}]}}};
const ac = (axes, from = "2026-10-01") => actorChips(Da, "W2", axes, from).map(x => [x.a, ...x.tags].join("|"));
assert.deepStrictEqual(ac(["맑은 음색"]), ["가|맑음", "나|맑음", "바|맑음"], "이름순, 조연(조)·지난 회차만 나오는 배우(지난)·공식 출처만 있는 배우(마)는 빠진다. 나는 같은 축 양쪽을 다 가져서 반대 근거가 아니다");
assert.deepStrictEqual(ac(["맑은 음색", "강한 성량"]), ["가|맑음|성량", "나|맑음"], "성량 취향이면 섬세한 가창 표현을 가진 바는 반대 근거로 빠진다(나는 반대쪽 태그가 없어 남는다)");
assert.deepStrictEqual(ac(["묵직한 음색"]), ["나|허스키", "다|허스키"], "나는 맑음도 있지만 같은 축 양쪽이라 반대 근거가 아니다");
assert.deepStrictEqual(ac(["가창"]), ["가|맑음|성량", "나|맑음", "바|맑음"], "가창 취향은 반대 근거가 없고, 맞는 태그는 2개까지 보여 준다");
assert.deepStrictEqual(ac(["가창", "강한 성량"]), ["가|성량|맑음", "나|맑음"], "노래/연기 중요도 축의 태그는 이유 칸에서 뒤로(구체적인 취향 먼저). 바는 섬세한 표현(성량의 반대)이 있어 빠진다");
assert.deepStrictEqual(ac([]), [], "고른 취향이 없으면 칩 없음");
assert.deepStrictEqual(ac(["맑은 음색"], "2026-10-11"), ["나|맑음", "바|맑음"], "from 이후 회차만");
assert(!JSON.stringify(actorChips(Da, "W2", ["맑은 음색"], "2026-10-01")).match(/\d/), "배우 이름 옆에 숫자(점수·순위)를 안 붙인다");
assert.deepStrictEqual(actorChips({...Da, perfs: []}, "W2", ["맑은 음색"], "2026-10-01"), [], "남은 회차가 없으면 없음");
// 작품별 취향: 직접 바꾸기 전엔 기본 취향을 따라간다, 바꾼 작품은 안 따라간다, edited 표시가 없던 예전 작품은 기본과 다르면 바꾼 것으로 본다
let st = {};
assert.deepStrictEqual(followBase(st, ["맑은 음색"]), ["맑은 음색"]); assert.strictEqual(st.edited, false, "처음 만든 작품은 바꾸지 않은 것");
assert.deepStrictEqual(followBase(st, ["강한 성량"]), ["강한 성량"], "기본 취향이 바뀌면 따라간다");
st.axes = ["절제"]; st.edited = true;
assert.deepStrictEqual(followBase(st, ["강한 성량"]), ["절제"], "이 작품에서 바꿨으면 안 따라간다");
st.edited = false; assert.deepStrictEqual(followBase(st, ["강한 성량"]), ["강한 성량"], "기본 취향으로 되돌리면 다시 따라간다");
st = {axes: ["맑은 음색", "절제"]}; assert.deepStrictEqual(followBase(st, ["절제", "맑은 음색"]), ["절제", "맑은 음색"]); assert.strictEqual(st.edited, false, "예전 작품: 기본과 같으면(순서 무관) 안 바꾼 것");
st = {axes: ["가창"]}; assert.deepStrictEqual(followBase(st, ["절제"]), ["가창"]); assert.strictEqual(st.edited, true, "예전 작품: 기본과 다르면 바꾼 것으로 보고 지키지 않고 둔다");
st = {axes: []}; assert.deepStrictEqual(followBase(st, []), []); assert.strictEqual(st.edited, false);
// 취향이 있는지: 카드나 축이 하나라도 있어야 한다(좋아하는 배우만 있으면 추천 근거 없음)
assert(!hasTaste(null) && !hasTaste({}) && !hasTaste({axes: [], works: [], favs: []}) && hasTaste({works: ["fun"]}) && hasTaste({axes: ["절제"]}) && hasTaste({axes: ["절제"], works: []}));
assert(hasTaste({axes: [], works: [], favs: ["x"]}), "좋아하는 배우도 취향의 예시라서 하나만 있어도 취향이 있다");

// 4-6. 좋아하는 배우 → 닮은 배우가 나오는 공연(점수 아님). 배우 프로필·지금 하는 공연 주연·같은 목소리 축 같은 쪽·반대쪽이면 제외
// 프로필: 목소리는 어느 작품이든(work 는 참고), 연기·해석 태그는 그 태그가 기록된 작품·배역(rw, rr)이 붙는다
const pf = (voice, role = [], rw = "W", rr = "r") => ({voice: voice.map(tag => ({tag, work: "W"})), role: role.map(tag => ({tag, work: rw, role: rr}))});
const roles = () => [{role: "R1", weight: "주연", cast: []}, {role: "R2", weight: "주연", cast: []}, {role: "S", weight: "조연", cast: []}];
const Ds = {
  works: ["엘리자벳", "겨울왕국", "지난공연", "준비중", "시카고"].map(name => ({name, hasSchedule: name !== "준비중"})),
  roles: {"엘리자벳": roles(), "겨울왕국": roles(), "지난공연": roles(), "시카고": roles()},
  axes: [{left: "가창", right: "연기"}, {left: "맑은 음색", right: "묵직한 음색"}, {left: "강한 성량", right: "섬세한 표현"}],
  axis: {"맑은 음색": ["맑음", "부드러움"], "묵직한 음색": ["허스키", "묵직한 음색"], "강한 성량": ["성량"], "섬세한 표현": ["섬세한 가창 표현"], "가창": ["맑음", "부드러움", "허스키", "묵직한 음색", "성량", "고음", "딕션"]},
  voiceTags: ["맑음", "부드러움", "허스키", "묵직한 음색", "성량", "고음", "딕션"],
  voiceAxis: {"맑음": "음색", "부드러움": "음색", "허스키": "음색", "묵직한 음색": "음색", "성량": "성량", "고음": "고음", "딕션": "딕션"},
  perfs: [
    {work: "엘리자벳", date: "2026-10-10", cast: {R1: "카이", R2: "박지연", S: "조연성량"}}, {work: "엘리자벳", date: "2026-10-12", cast: {R1: "서경수", R2: "박지연", S: "조연성량"}},
    {work: "겨울왕국", date: "2026-10-10", cast: {R1: "정선아", R2: "민경아", S: "조연성량"}},
    {work: "지난공연", date: "2026-09-01", cast: {R1: "카이", R2: "서경수", S: "조연성량"}},
    {work: "시카고", date: "2026-10-20", cast: {R1: "최재림", R2: "윤공주", S: "조연성량"}}, {work: "준비중", date: "2026-10-20", cast: {R1: "카이", R2: "서경수", S: "조"}}],
  actorProfiles: {"최재림": pf(["성량"]), "카이": pf(["성량"]), "서경수": pf(["성량", "고음"]), "박지연": pf(["부드러움"]), "정선아": pf(["성량", "허스키"]), "민경아": pf(["맑음"]), "윤공주": pf(["성량", "허스키"], ["코믹 연기"], "시카고", "R2"), "조연성량": pf(["성량"])},
};
const clone = o => JSON.parse(JSON.stringify(o));
const sim = (a, extra = [], from = "2026-10-01", D2 = Ds) => similarWorks(D2, a, extra, from);
const shape = r => r.map(x => [x.w.name, x.here, x.groups.map(g => g.names.join("·") + "/" + g.labels.join("·"))]);
const namesOf = r => r.flatMap(x => x.groups.flatMap(g => g.names));
// 최재림(성량): 성량이 있는 주연이 나오는 작품. 본인이 나오는 시카고가 맨 앞, 나머지는 닮은 특성 수가 같으니 이름순. 조연·끝난 공연·일정 없는 작품은 빠진다
assert.deepStrictEqual(shape(sim("최재림")), [
  ["시카고", true, ["윤공주/성량"]],
  ["겨울왕국", false, ["정선아/성량"]],
  ["엘리자벳", false, ["서경수·카이/성량"]]], "성량 주연이 나오는 작품: 같은 특성 후보는 한 줄(이름순), 허스키·고음은 최재림 특성이 아니라 겹침이 아니다");
assert(!namesOf(sim("최재림")).includes("최재림"), "본인은 후보가 아니다");
assert.deepStrictEqual(sim("최재림", [], "2026-09-01").map(x => x.w.name), ["시카고", "겨울왕국", "엘리자벳", "지난공연"], "끝나지 않은 공연만: from 을 당기면 지난공연도 나온다");
// 특징 태그가 없는 좋아하는 배우: 출연 중(here)은 그대로 알려 주고(닮은 배우 묶기 groups 만 특징이 있을 때), 안 나오면 빈 목록
const Dnt = clone(Ds); Dnt.perfs.push({work: "엘리자벳", date: "2026-10-14", cast: {R1: "무태그배우", R2: "x", S: "x"}});
assert.deepStrictEqual(shape(sim("무태그배우", [], "2026-10-01", Dnt)), [["엘리자벳", true, []]], "특징이 없어도 회차에 나오면 '출연 중'(here)은 나온다, 닮은 배우 묶기는 없다");
assert.deepStrictEqual(sim("무태그배우", [], "2026-10-01"), [], "특징도 없고 출연도 안 하면 빈 목록");
assert.deepStrictEqual(shape(sim("무태그배우", ["성량"], "2026-10-01", Dnt)).find(x => x[0] === "엘리자벳"), ["엘리자벳", true, ["서경수·카이/성량"]], "내가 고른 태그(extra)가 있으면 특징이 생겨서 닮은 배우도 묶인다");
// 같은 목소리 축의 같은 쪽: 맑음 ↔ 부드러움은 같은 쪽(맑은 음색)이라 겹치고, 라벨은 좋아하는 배우의 태그. 허스키는 반대쪽이라 제외
assert.deepStrictEqual(shape(sim("무명맑음팬", ["맑음"])), [["겨울왕국", false, ["민경아/맑음"]], ["엘리자벳", false, ["박지연/맑음"]]], "맑음·부드러움은 같은 축 같은 쪽, 정선아·윤공주(허스키)는 반대쪽이라 제외");
// 반대쪽 제외: 맑음을 좋아하는 사람에게 허스키·묵직한 음색만 가진 배우는 성량이 같아도 빠진다. 양쪽 다 가진 배우는 남는다
const Do = clone(Ds); Do.actorProfiles["허스키성량"] = pf(["허스키", "성량"]); Do.actorProfiles["양쪽성량"] = pf(["허스키", "맑음", "성량"]); Do.actorProfiles["묵직성량"] = pf(["묵직한 음색", "성량"]);
Do.perfs.push({work: "엘리자벳", date: "2026-10-14", cast: {R1: "허스키성량", R2: "양쪽성량", S: "x"}}, {work: "겨울왕국", date: "2026-10-14", cast: {R1: "묵직성량", R2: "x", S: "x"}});
const oppo = namesOf(sim("무명맑음성량팬", ["맑음", "성량"], "2026-10-01", Do));
assert(!oppo.includes("허스키성량") && !oppo.includes("묵직성량"), "반대쪽(음색 R)만 가진 배우는 성량이 같아도 제외");
assert(oppo.includes("양쪽성량"), "양쪽을 다 가진 배우는 반대 근거가 아니라 남는다");
assert.deepStrictEqual(namesOf(sim("최재림", [], "2026-10-01", Do)).filter(n => /성량$/.test(n)).sort(), ["묵직성량", "양쪽성량", "허스키성량"], "음색 취향이 없는 최재림(성량만)에게는 반대 제외가 없다");
// 연기·해석 태그는 같은 태그만 겹친다. 한 줄 안에서는 목소리가 먼저
const Dr = clone(Ds); Dr.actorProfiles["코믹맨"] = pf([], ["코믹 연기", "감정 크게 표현"], "겨울왕국", "R1"); Dr.actorProfiles["절제맨"] = pf([], ["절제된 연기"], "겨울왕국", "R2");
Dr.perfs.push({work: "겨울왕국", date: "2026-10-15", cast: {R1: "코믹맨", R2: "절제맨", S: "x"}});
assert.deepStrictEqual(sim("무명코믹팬", ["성량", "코믹 연기"], "2026-10-01", Dr).find(x => x.w.name === "겨울왕국").groups.map(g => [g.names, g.labels]), [[["정선아"], ["성량"]], [["코믹맨"], ["코믹 연기"]]], "같은 태그만 겹침(절제된 연기는 아님)");
assert.deepStrictEqual(sim("무명코믹팬", ["성량", "코믹 연기"], "2026-10-01", Dr).find(x => x.w.name === "시카고").groups.map(g => [g.names, g.labels]), [[["윤공주"], ["성량", "코믹 연기"]], [["최재림"], ["성량"]]], "겹침이 많은 줄이 먼저, 한 줄 안에서는 목소리 → 연기");
// 두 겹: 후보의 연기·해석 태그는 이 작품 그 배역의 기록만 근거다. 다른 작품 배역에서만 가진 태그는 겹침이 아니다(목소리는 모든 작품에서 합친다)
const Dt = clone(Dr);
Dt.actorProfiles["타작품코믹"] = pf(["성량"], ["코믹 연기"], "엘리자벳", "R1");  // 코믹 연기는 엘리자벳 배역에서만, 성량(목소리)은 다른 작품 것
Dt.actorProfiles["다른시즌코믹"] = {voice: [], role: [{tag: "코믹 연기", work: "겨울왕국", role: "R1", season: "2024"}]};  // 같은 작품 같은 배역의 다른 시즌 기록
Dt.actorProfiles["다른배역코믹"] = pf([], ["코믹 연기"], "겨울왕국", "R9");  // 같은 작품이지만 다른 배역
Dt.perfs.push({work: "겨울왕국", date: "2026-10-17", cast: {R1: "타작품코믹", R2: "다른배역코믹", S: "x"}}, {work: "겨울왕국", date: "2026-10-18", cast: {R1: "다른시즌코믹", R2: "x", S: "x"}});
const only코믹 = sim("무명코믹팬2", ["코믹 연기"], "2026-10-01", Dt), g코 = x => (only코믹.find(w => w.w.name === x)?.groups || []).flatMap(g => g.names);
assert.deepStrictEqual(g코("겨울왕국").sort(), ["다른시즌코믹", "코믹맨"], "이 작품 그 배역(다른 시즌 포함)의 코믹 연기만 겹침. 다른 작품 배역(타작품코믹)·같은 작품 다른 배역(다른배역코믹)은 아니다");
assert.strictEqual(sim("무명코믹팬2", ["코믹 연기"], "2026-10-01", Dt).some(x => x.w.name === "엘리자벳"), false, "엘리자벳 주연은 코믹 연기 기록이 없다(타작품코믹이 그 작품 배역 기록이 있어도 이 작품에 안 나오면 후보가 아님)");
assert(traitsOf(Dt, "타작품코믹", [], {work: "겨울왕국", roles: ["R1"]}).role.length === 0 && traitsOf(Dt, "타작품코믹", [], {work: "엘리자벳", roles: ["R1"]}).role[0] === "코믹 연기", "같은 프로필도 어느 작품의 배역으로 보느냐에 따라 연기 태그가 달라진다");
assert.deepStrictEqual(traitsOf(Dt, "타작품코믹", [], {work: "겨울왕국", roles: ["R1"]}).voice.map(v => v.tag), ["성량"], "목소리는 다른 작품 것도 합친다");
assert.deepStrictEqual(traitsOf(Dt, "타작품코믹").role, ["코믹 연기"], "좋아하는 배우 쪽(here 없음)은 다른 작품 연기 태그도 취향으로 남는다");
assert(sim("타작품코믹", [], "2026-10-01", Dt).some(x => x.w.name === "겨울왕국" && x.groups.some(g => g.names.includes("코믹맨"))), "좋아하는 배우가 다른 작품에서 가진 코믹 연기를 취향으로 이 작품 코믹맨과 겹친다");
// 같은 쪽 목소리는 한 특성으로 센다: 맑음·부드러움을 둘 다 좋아해도 특성 하나, 같은 태그 중복도 하나
const tr = traitsOf(Ds, "x", ["맑음", "부드러움", "성량", "코믹 연기", "코믹 연기"]);
assert.deepStrictEqual([tr.voice.map(v => v.tag), tr.role], [["맑음", "성량"], ["코믹 연기"]]);
assert.deepStrictEqual(tr.voice.map(v => [v.axis, v.side]), [["음색", "L"], ["성량", "L"]]);
assert.deepStrictEqual(traitsOf(Ds, "카이").voice.map(v => v.tag), ["성량"], "프로필에서 가져온다");
assert.deepStrictEqual(traitsOf({...Ds, voiceAxis: undefined}, "x", ["허스키", "맑음"]).voice.map(v => [v.tag, v.axis, v.side]), [["허스키", "음색", "R"], ["맑음", "음색", "L"]], "D.voiceAxis 가 없어도 음색은 한 축");
// 작품 순서: 본인이 나오는 작품 → 겹치는 서로 다른 특성 수 → 이름
const Dn = clone(Ds); Dn.actorProfiles["둘다"] = pf(["성량", "고음"]); Dn.perfs.push({work: "겨울왕국", date: "2026-10-16", cast: {R1: "둘다", R2: "x", S: "x"}});
const byN = sim("무명성량고음팬", ["성량", "고음"], "2026-10-01", Dn);
assert.deepStrictEqual(byN.map(x => [x.w.name, x.n]), [["겨울왕국", 2], ["엘리자벳", 2], ["시카고", 1]], "겹치는 특성이 둘인 작품 먼저(같으면 이름순)");
// 회차 캐스팅이 없는 작품(hasSchedule false)도 배역 탭의 주연 캐스트로 후보가 된다. 끝난 작품·조연은 뺀다. 회차가 있는 작품은 예전 그대로
const Dns = clone(Ds); Dns.works.push({name: "사의찬미", hasSchedule: false, runs: [{end: "2026-10-25"}]}, {name: "끝난무대", hasSchedule: false, runs: [{end: "2026-09-01"}]});
Dns.roles["사의찬미"] = [{role: "김우진", weight: "주연", cast: ["사찬1", "사찬2"]}, {role: "윤심덕", weight: "주연", cast: ["사찬3"]}, {role: "사내", weight: "조연", cast: ["사찬조연"]}];
Dns.roles["끝난무대"] = [{role: "R1", weight: "주연", cast: ["끝난성량"]}];
Dns.actorTags = {"사의찬미": {"사찬1": [{tag: "성량"}], "사찬2": [{tag: "맑음"}], "사찬3": [{tag: "성량"}, {tag: "허스키"}], "사찬조연": [{tag: "성량"}]}, "끝난무대": {"끝난성량": [{tag: "성량"}]}};  // 이런 배우 칸은 이 작품의 배우 태그(D.actorTags)를 본다
Object.assign(Dns.actorProfiles, {"사찬1": pf(["성량"]), "사찬2": pf(["맑음"]), "사찬3": pf(["성량", "허스키"]), "사찬조연": pf(["성량"]), "끝난성량": pf(["성량"])});
const nsShape = shape(sim("최재림", [], "2026-10-08", Dns));
assert.deepStrictEqual(nsShape.map(x => x[0]), ["시카고", "겨울왕국", "사의찬미", "엘리자벳"], "회차 캐스팅이 없는 사의찬미도 최재림(성량) 추천에 나온다(이름순 사이에). 끝난무대·조연은 안 나온다");
assert.deepStrictEqual(nsShape.find(x => x[0] === "사의찬미"), ["사의찬미", false, ["사찬1·사찬3/성량"]], "배역 탭 주연 캐스트가 후보(조연 사찬조연 제외), 허스키는 최재림 취향이 아니라 상관없음");
assert.deepStrictEqual(shape(sim("최재림")), shape(sim("최재림", [], "2026-10-01", Ds)), "회차가 있는 작품만 있을 때는 예전과 똑같다");
assert.strictEqual(sim("사찬1", [], "2026-10-08", Dns).find(x => x.w.name === "사의찬미").here, true, "회차 캐스팅이 없는 작품에서 배역 탭에 이름이 있으면 출연 중");
assert.deepStrictEqual(sim("사찬1", [], "2026-10-08", Dns).find(x => x.w.name === "사의찬미").groups.map(g => g.names), [["사찬3"]], "본인은 후보가 아니다");
assert(!sim("최재림", [], "2026-10-08", Dns).some(x => x.w.name === "끝난무대"), "끝난 작품은 회차 캐스팅이 없어도 뺀다");
assert.deepStrictEqual(sim("최재림", [], "2026-08-01", Dns).some(x => x.w.name === "끝난무대"), true, "기준 날짜를 당기면(그땐 공연 중) 나온다");
assert.deepStrictEqual(actorChips(Dns, "사의찬미", ["강한 성량"], "2026-10-08").map(x => x.a + "|" + x.tags.join(",")), ["사찬1|성량", "사찬3|성량"], "이런 배우 칸도 회차 캐스팅이 없는 작품의 주연(사찬2는 취향 근거 없음, 조연 제외)");
assert.deepStrictEqual(actorChips(Dns, "끝난무대", ["강한 성량"], "2026-10-08"), [], "끝난 작품은 배우 칩 없음");
// 전체대관 회차(비고에 '대관')는 일반 예매가 안 돼서 후보·출연 중 계산에서 뺀다
assert(isPrivate({notes: ["전체대관"]}) && isPrivate({notes: ["첫공", "단체 대관"]}) && !isPrivate({notes: ["첫공"]}) && !isPrivate({notes: []}) && !isPrivate({}), "비고에 '대관'이 들어 있으면 전체대관");
const Dv = clone(Ds); Dv.works.push({name: "대관작", hasSchedule: true, runs: []}); Dv.roles["대관작"] = roles();
Dv.perfs.push({work: "대관작", date: "2026-11-14", notes: ["전체대관"], cast: {R1: "대관성량", R2: "x", S: "x"}});
Dv.actorProfiles["대관성량"] = pf(["성량"]);
assert.strictEqual(runningLeads(Dv, Dv.works.find(w => w.name === "대관작"), "2026-10-08"), null, "남은 회차가 전체대관뿐인 작품은 후보가 없다(작품 추천에서도 빠진다)");
assert(!sim("최재림", [], "2026-10-08", Dv).some(x => x.w.name === "대관작"), "전체대관 회차의 주연은 닮은 배우로 안 나온다");
Dv.perfs.push({work: "대관작", date: "2026-11-15", notes: [], cast: {R1: "일반성량", R2: "x", S: "x"}}); Dv.actorProfiles["일반성량"] = pf(["성량"]);
assert.deepStrictEqual([...runningLeads(Dv, Dv.works.find(w => w.name === "대관작"), "2026-10-08").keys()].sort(), ["x", "일반성량"], "일반 회차가 같이 있으면 그 회차의 주연만(전체대관 회차의 대관성량은 제외)");
assert.deepStrictEqual(sim("최재림", [], "2026-10-08", Dv).find(x => x.w.name === "대관작").groups.flatMap(g => g.names), ["일반성량"]);
Dv.perfs.push({work: "대관작", date: "2026-11-16", notes: ["전체대관"], cast: {R1: "대관출연자", R2: "x", S: "x"}});
assert.strictEqual(sim("대관출연자", ["성량"], "2026-10-08", Dv).find(x => x.w.name === "대관작").here, false, "전체대관 회차에만 나오는 배우는 '출연 중'이 아니다");
// 지금 하는 다른 공연(KOPIS currentShows): 대표 출연진이 후보, 목소리 특성만 견준다. 19세 이상·출연진 없음·끝난 공연·시드와 같은 제목은 뺀다
const csh = (id, title, cast, extra = {}) => ({id, title, venue: "홀", start: "2026-09-01", end: "2026-12-31", status: "공연중", cast, poster: "https://kopis.or.kr/a.jpg", age: "만 7세 이상", runtime: "100분", times: "", tickets: [], ...extra});
const Dcs = clone(Ds); Dcs.currentShows = [csh("C1", "신작 뮤지컬", ["현재성량", "현재맑음", "프로필없음"]), csh("C19", "성인극", ["현재성량"], {age: "만 19세 이상"}), csh("C18", "열여덟극", ["현재성량"], {age: "만 18세 이상"}), csh("CN", "배우없음극", []),
  csh("CE", "끝난극", ["현재성량"], {end: "2026-10-01"}), csh("CS", "뮤지컬 엘리자벳 콘서트", ["현재성량"]), csh("C17", "열일곱극", ["현재성량"], {age: "만 17세 이상"}), csh("COM", "코믹극", ["코믹역배우"])];
Object.assign(Dcs.actorProfiles, {"현재성량": pf(["성량"]), "현재맑음": pf(["맑음"]), "코믹역배우": pf([], ["코믹 연기"], "다른작품", "역")});
assert.deepStrictEqual(liveShows(Dcs, "2026-10-10").map(s => s.id), ["C1", "C17", "COM"], "19세·18세 이상, 출연진 없음, 끝난 공연, 시드(엘리자벳) 제목이 든 공연은 뺀다");
assert.deepStrictEqual(liveShows(Dcs, "2026-09-01").map(s => s.id), ["C1", "CE", "C17", "COM"], "기준 날짜를 당기면(그땐 공연 중) 끝난극도 나온다");
assert.strictEqual(minAge("만 19세 이상"), 19); assert.strictEqual(minAge("전체 관람가"), 0); assert.strictEqual(minAge("12개월 이상"), 0); assert.strictEqual(minAge(undefined), 0);
const cs = sim("최재림", [], "2026-10-10", Dcs), c1 = cs.find(x => x.w.name === "신작 뮤지컬");
assert(c1 && c1.w.current === true && c1.w.id === "C1" && c1.here === false && c1.groups.length === 1 && c1.groups[0].names.join() === "현재성량" && c1.groups[0].labels.join() === "성량", "최재림(성량) → 성량 있는 대표 출연진이 나오는 현재 공연이 추천된다(프로필 없는 배우는 겹침 없음)");
assert(!cs.some(x => ["성인극", "열여덟극", "배우없음극", "끝난극", "뮤지컬 엘리자벳 콘서트"].includes(x.w.name)), "추천에도 19세 이상·출연진 없음·끝난 공연·시드 제목 공연은 안 나온다");
assert.strictEqual(cs.filter(x => x.w.name === "엘리자벳").length, 1, "시드 작품은 한 번만(현재 공연 목록의 시드 제목 공연으로 중복되지 않는다)");
assert(!cs.some(x => x.w.name === "코믹극"), "배역 정보가 없어서 연기·해석 태그(코믹 연기)는 현재 공연 후보에 안 쓴다(목소리만)");
const rolefav = sim("무명코믹팬3", ["코믹 연기"], "2026-10-10", Dcs); assert(!rolefav.some(x => x.w.current), "좋아하는 쪽이 연기 태그뿐이면 현재 공연은 추천되지 않는다(후보는 목소리만)");
// 본인이 대표 출연진이면 '출연 중', 순서는 본인 공연 → 겹치는 특성 수 → 이름(시드 작품과 섞여서)
const here = sim("현재성량", [], "2026-10-10", Dcs), h1 = here.find(x => x.w.name === "신작 뮤지컬");
assert(h1 && h1.here === true && here[0].here === true && here[0].w.name === "신작 뮤지컬" && !h1.groups.some(g => g.names.includes("현재성량")), "본인이 나오는 현재 공연이 맨 앞, 본인은 후보가 아니다");
assert.strictEqual(sim("최재림", [], "2026-10-10", Dcs)[0].w.name, "시카고", "본인이 나오는 시카고가 현재 공연보다 앞");
assert.deepStrictEqual(sim("최재림", [], "2026-10-10", Dcs).filter(x => !x.here).map(x => x.w.name), ["겨울왕국", "신작 뮤지컬", "엘리자벳", "열일곱극"], "겹치는 특성이 하나씩이라 이름순(시드 작품과 현재 공연이 섞여 정렬, 17세 이상 공연은 나온다)");
assert.deepStrictEqual(sim("최재림", [], "2026-10-10", {...Ds, currentShows: undefined}).map(x => x.w.name), sim("최재림", [], "2026-10-10", Ds).map(x => x.w.name), "currentShows 가 없는 예전 데이터는 그대로");
// 작품 화면(회차 없는 작품)의 배우 태그: 목소리는 모든 작품(빌려 온 행), 연기·해석은 그 배역 기록만, 공식 출처는 뺀다
const Dsh = {voiceTags: Ds.voiceTags, actorTags: {"사의찬미": {"사찬1": [{tag: "성량", role: "김우진"}, {tag: "성량", role: "다른작품배역", from: "시카고"}, {tag: "섬세한 내면형", role: "김우진"}, {tag: "관계 중심", role: "윤심덕"}, {tag: "감정 크게 표현"}, {tag: "맑음", role: "x", level: "배우 본인·공식"}, {tag: "절제된 연기", role: "김우진", level: "제작진·공식"}]}}};
assert.deepStrictEqual(roleRows(Dsh, "사의찬미", "사찬1", "김우진").map(r => r.tag), ["성량", "성량", "섬세한 내면형", "감정 크게 표현"], "목소리는 다른 작품 행도, 연기·해석은 그 배역(김우진)·배역 미상 행만, 공식 출처와 다른 배역(윤심덕) 행은 뺀다");
assert.deepStrictEqual(roleRows(Dsh, "사의찬미", "사찬1", "윤심덕").map(r => r.tag), ["성량", "성량", "관계 중심", "감정 크게 표현"], "같은 배우도 어느 배역 화면이냐에 따라 연기 태그가 달라진다");
assert.deepStrictEqual(roleRows(Dsh, "사의찬미", "없는배우", "김우진"), [], "태그가 없는 배우");
// 본인이 조연으로 나와도 '출연 중'
const Ds2 = clone(Ds); Ds2.perfs.push({work: "겨울왕국", date: "2026-10-20", cast: {R1: "x", R2: "y", S: "단역배우"}}); Ds2.actorProfiles["단역배우"] = pf(["성량"]);
assert.strictEqual(sim("단역배우", [], "2026-10-01", Ds2).find(x => x.w.name === "겨울왕국").here, true, "조연으로 나와도 출연 중");
assert.strictEqual(sim("최재림").find(x => x.w.name === "엘리자벳").here, false);
// 특성이 없으면 빈 목록(좋아하는 점을 물어본다). 아는 배우 = 프로필에 있거나 어느 캐스트에 있다
assert.deepStrictEqual(sim("무명배우"), [], "프로필도 좋아요 태그도 없으면 빈 목록");
assert(sim("무명배우", ["성량"]).length > 0, "프로필이 없어도 내가 고른 태그(왜 좋아요)로 찾는다");
const Dk = {...Ds, roles: {...Ds.roles, "엘리자벳": [{role: "R1", weight: "주연", cast: ["캐스트만"]}]}};
assert(knownActor(Ds, "최재림") && !knownActor(Ds, "무명배우") && knownActor(Dk, "캐스트만") && !knownActor({}, "누구"), "프로필에 있거나 어느 캐스트에 있으면 아는 배우");
// 데이터에 없는 이름은 요청 목록에 한 번만
const reqs = []; assert.strictEqual(addRequest(reqs, "무명배우", "2026-10-08"), true); assert.strictEqual(addRequest(reqs, "무명배우", "2026-10-09"), false); assert.deepStrictEqual(reqs, [{name: "무명배우", at: "2026-10-08"}]);
// 배우 이름 옆에 숫자(점수·순위)가 없다. 묶음의 score 는 순서 계산용이라 화면에 나가는 이름·특성(labels·names)에만 숫자가 없는지 본다
assert(!JSON.stringify(sim("최재림").flatMap(x => x.groups.map(g => [g.names, g.labels]))).match(/\d/), "묶음에 보이는 건 이름과 특성뿐이다");
// 조사: 받침 있으면 을, 없으면 를
assert.deepStrictEqual(["최재림", "고은성", "이지혜", "카이", "서경수", "김준수", "ABC"].map(eul), ["을", "을", "를", "를", "를", "를", "를"]);

// 5. S.noPersonal → 빈 값
assert.deepStrictEqual(pw(S({noPersonal: true}), D), {});

// 6. 회차 수(내 취향 화면): 같은 회차는 한 번, 기분이 비면 quick으로
assert.deepStrictEqual(pc(S()), {good: 1, bad: 0});
assert.deepStrictEqual(pc({plans: manyPlans, tags: [...many.slice(0, 2), ...bad.slice(2, 3)], votes: []}), {good: 2, bad: 1});
assert.deepStrictEqual(pc({plans: [], tags: [rec(), rec({mood: "bad"})], votes: []}), {good: 0, bad: 1}, "같은 회차 중복은 마지막 기록 하나");
assert.deepStrictEqual(pc({plans: [], tags: [], votes: []}), {good: 0, bad: 0});

// ---- 근거 수 가중치 · 다른 사람들이 고른 특징(D.actorVotes): 서로 다른 근거 1개는 1, 2개 이상은 1.5, 내가 고른 특징은 늘 1.5. 순서에만 영향, 포함 여부는 그대로
const pfS = (tags, sks, kind = "voice", rw = "W", rr = "r") => ({voice: kind === "voice" ? tags.map((tag, i) => ({tag, work: "W", sk: sks[i]})) : [], role: kind === "role" ? tags.map((tag, i) => ({tag, work: rw, role: rr, sk: sks[i]})) : []});
const Dw = clone(Ds); Dw.actorProfiles["카이"] = pfS(["성량", "성량"], ["s1", "s2"]);  // 카이의 성량: 서로 다른 출처 2곳
const w1 = (D2, a, extra, here) => { const t = traitsOf(D2, a, extra, here); return [...t.voice.map(v => [v.tag, v.w]), ...t.role.map(r => [r, t.rw[r]])]; };
assert.deepStrictEqual(w1(Dw, "카이"), [["성량", 1.5]], "서로 다른 출처 2곳 = 1.5");
assert.deepStrictEqual(w1(Dw, "최재림"), [["성량", 1]], "출처 1곳(프로필에 출처 열쇠가 없어도 1개로 센다) = 1");
Dw.actorProfiles["중복출처"] = pfS(["성량", "성량"], ["s1", "s1"]); assert.deepStrictEqual(w1(Dw, "중복출처"), [["성량", 1]], "같은 출처가 여러 행이어도 1곳");
assert.deepStrictEqual(w1(Dw, "최재림", ["성량"]), [["성량", 1.5]], "내가 '어떤 점이 좋아요'에서 직접 고른 특징은 근거 수와 상관없이 온전히(1.5)");
Dw.actorVotes = {"최재림": {"성량": 2, "고음": 3}, "투표만": {"성량": 2, "코믹 연기": 4}};
assert.deepStrictEqual(w1(Dw, "최재림"), [["성량", 1.5], ["고음", 1.5]], "시트 근거 1곳 + 다른 사람 2명 = 3 → 1.5, 프로필에 없던 고른 특징(고음)도 목소리 특성으로 더해진다");
assert.deepStrictEqual(w1(Dw, "투표만"), [["성량", 1.5], ["코믹 연기", 1.5]], "프로필이 없어도 고른 특징이 특성이 된다(좋아하는 배우 쪽은 연기·해석 태그도)");
assert.deepStrictEqual(w1(Dw, "투표만", [], {work: "겨울왕국", roles: ["R1"]}), [["성량", 1.5]], "후보 쪽은 배역을 모르니 투표로 연기·해석 태그를 새로 더하지 않는다(목소리만)");
Dw.actorProfiles["코믹후보"] = pfS(["코믹 연기"], ["c1"], "role", "겨울왕국", "R1"); Dw.actorVotes["코믹후보"] = {"코믹 연기": 3};
assert.deepStrictEqual(w1(Dw, "코믹후보", [], {work: "겨울왕국", roles: ["R1"]}), [["코믹 연기", 1.5]], "그 배역 기록에 이미 있는 연기 태그는 투표로 근거 수가 오른다");
assert.deepStrictEqual(w1(Dw, "코믹후보", [], {work: "겨울왕국", roles: ["R9"]}), [], "다른 배역이면 그 태그는 후보의 특성이 아니다(투표가 있어도)");
// 순서: 같은 겹침 한 개라도 후보 쪽 근거가 많은 작품이 먼저. 근거가 얇은 작품도 빠지지 않는다
const namesOf2 = r => r.map(x => x.w.name);
Dw.actorVotes = {};
assert.deepStrictEqual(namesOf2(sim("무명성량팬", ["성량"], "2026-10-01", Dw)), ["엘리자벳", "겨울왕국", "시카고"], "카이(출처 2곳)가 나오는 엘리자벳이 먼저, 나머지는 같은 점수라 이름순");
assert.deepStrictEqual(namesOf2(sim("무명성량팬", ["성량"], "2026-10-01", Ds)), ["겨울왕국", "시카고", "엘리자벳"], "(기준) 근거가 다 1곳이면 예전처럼 이름순");
Dw.actorVotes = {"윤공주": {"성량": 2}};
assert.deepStrictEqual(namesOf2(sim("무명성량팬", ["성량"], "2026-10-01", Dw)), ["시카고", "엘리자벳", "겨울왕국"], "다른 사람 2명이 윤공주 성량을 골랐으면 시카고도 근거가 두꺼워져 엘리자벳과 같은 점수 → 이름순");
const grp = (D2, w) => sim("무명성량팬", ["성량"], "2026-10-01", D2).find(x => x.w.name === w).groups.map(g => [g.names, g.labels]);
assert.deepStrictEqual(grp(Dw, "시카고"), grp(Ds, "시카고"), "투표는 묶음의 이름·특성을 바꾸지 않는다");
// 포함 여부는 그대로: 근거 수가 달라도(투표 없음/있음) 같은 작품·같은 후보가 나온다
const memberOf = r => r.map(x => x.w.name + ":" + x.groups.flatMap(g => g.names).sort().join()).sort();
assert.deepStrictEqual(memberOf(sim("무명성량팬", ["성량"], "2026-10-01", Dw)), memberOf(sim("무명성량팬", ["성량"], "2026-10-01", Ds)), "근거 가중치는 순서만 바꾸고 작품·후보를 빼거나 더하지 않는다");
// 투표만으로 특성이 생긴 후보는 새로 겹친다(근거 수 2 = 1.5)
const Dvt = clone(Ds); Dvt.perfs.push({work: "겨울왕국", date: "2026-10-19", cast: {R1: "투표성량", R2: "x", S: "x"}}); Dvt.actorVotes = {"투표성량": {"성량": 3}};
assert(sim("최재림", [], "2026-10-01", Dvt).find(x => x.w.name === "겨울왕국").groups.some(g => g.names.includes("투표성량")), "프로필이 없어도 사람들이 고른 성량으로 최재림과 겹친다");
assert(!sim("최재림", [], "2026-10-01", Ds).flatMap(x => x.groups).some(g => g.names.includes("투표성량")), "투표가 없으면 그대로(겹치지 않음)");
// 순서만 바꾸는 점수는 화면에 나가는 이름·특성에는 숫자가 없다
assert(!JSON.stringify(sim("무명성량팬", ["성량"], "2026-10-01", Dw).flatMap(x => x.groups.map(g => [g.names, g.labels]))).match(/\d/), "이름·특성에 점수가 섞이지 않는다");

// ---- 배우 본인이 밝힌 해석(배우 본인·공식 / 배우 인터뷰)은 연기·해석 태그에 한해 근거 0.5개: 순서·특징 비교에만, 목소리 태그·제작진 공식은 안 쓴다
const it = (tag, level, sk, role = "R1", work = "겨울왕국") => ({tag, work, role, season: "2026", level, sk});
const Dself = clone(Ds); Dself.actorProfiles = {...Dself.actorProfiles};
Dself.actorProfiles["본인만"] = {voice: [], role: [it("코믹 연기", "배우 본인·공식", "i1")]};
Dself.actorProfiles["본인둘"] = {voice: [], role: [it("코믹 연기", "배우 본인·공식", "i1"), it("코믹 연기", "배우 인터뷰", "i2")]};
Dself.actorProfiles["본인같은곳"] = {voice: [], role: [it("코믹 연기", "배우 본인·공식", "i1"), it("코믹 연기", "배우 인터뷰", "i1")]};
Dself.actorProfiles["관객하나"] = {voice: [], role: [it("코믹 연기", "일반 관객 후기", "a1")]};
Dself.actorProfiles["관객과본인"] = {voice: [], role: [it("코믹 연기", "일반 관객 후기", "a1"), it("코믹 연기", "배우 본인·공식", "i1")]};
Dself.actorProfiles["본인과투표"] = {voice: [], role: [it("코믹 연기", "배우 본인·공식", "i1")]}; Dself.actorVotes = {"본인과투표": {"코믹 연기": 2}};
const wOf = (a, here = null) => { const t = traitsOf(Dself, a, [], here); return t.rw["코믹 연기"]; };
assert.deepStrictEqual(["본인만", "본인둘", "본인같은곳", "관객하나", "관객과본인", "본인과투표"].map(a => wOf(a)), [0.75, 1, 0.75, 1, 1.25, 1.5], "본인 해석 1곳 = 근거 0.5(0.75), 서로 다른 본인 해석 2곳 = 1(관객 1곳과 같음), 같은 출처는 한 번, 관객 1 + 본인 0.5 = 1.5(1.25), 본인 0.5 + 투표 2 = 2.5(1.5)");
assert(wOf("본인만") < wOf("관객하나"), "본인 인터뷰만 있는 특징은 근거 1개짜리 관객 근거보다 약하다");
assert.deepStrictEqual(traitsOf(Dself, "본인만").role, ["코믹 연기"], "본인 해석만 있는 연기·해석 태그도 특성으로 들어간다(비슷한 배우·특징 비교)");
// 목소리 태그는 본인 해석이면 무시(내보내기가 빼지만 앱도 한 번 더), 제작진 공식은 연기·해석이든 목소리든 무시
Dself.actorProfiles["본인목소리"] = {voice: [it("성량", "배우 본인·공식", "i1")], role: []};
Dself.actorProfiles["제작진"] = {voice: [it("고음", "제작진·공식", "o1")], role: [it("코믹 연기", "제작진·공식", "o1")]};
Dself.actorProfiles["제작진과관객"] = {voice: [], role: [it("코믹 연기", "일반 관객 후기", "a1"), it("코믹 연기", "제작진·공식", "o1")]};
assert.deepStrictEqual(traitsOf(Dself, "본인목소리").voice, [], "본인 해석의 목소리 태그는 안 쓴다");
assert.deepStrictEqual([traitsOf(Dself, "제작진").voice, traitsOf(Dself, "제작진").role], [[], []], "제작진 공식은 목소리든 연기·해석이든 안 쓴다");
assert.strictEqual(wOf("제작진과관객"), 1, "제작진 공식 근거는 센 근거 수에 안 들어간다(관객 1곳 그대로)");
// 후보 쪽(here): 그 작품 그 배역 기록만. 본인 해석도 같은 규칙
assert.deepStrictEqual(traitsOf(Dself, "본인만", [], {work: "겨울왕국", roles: ["R1"]}).role, ["코믹 연기"], "그 작품 그 배역의 본인 해석은 후보의 특성");
assert.deepStrictEqual(traitsOf(Dself, "본인만", [], {work: "엘리자벳", roles: ["R1"]}).role, [], "다른 작품이면 후보의 특성이 아니다");
// '비슷한 배우' 순서: 이름순이면 겨울왕국이 먼저인 두 작품에서 본인 해석뿐인 후보(겨울왕국)가 관객 근거 1개 후보(엘리자벳)보다 뒤로 간다. 포함 여부는 그대로
const Dcmp = clone(Dself); Dcmp.actorVotes = {}; Dcmp.actorProfiles["관객하나"] = {voice: [], role: [it("코믹 연기", "일반 관객 후기", "a1", "R1", "엘리자벳")]};  // 시카고의 윤공주(관객 근거 1곳, 연기 태그)도 같은 점수로 나온다
Dcmp.perfs.push({work: "겨울왕국", date: "2026-10-21", cast: {R1: "본인만", R2: "x", S: "x"}}, {work: "엘리자벳", date: "2026-10-21", cast: {R1: "관객하나", R2: "x", S: "x"}});
const cmpOrder = D2 => sim("무명코믹팬3", ["코믹 연기"], "2026-10-01", D2).map(x => x.w.name);
assert.deepStrictEqual(cmpOrder(Dcmp), ["시카고", "엘리자벳", "겨울왕국"], "본인 해석만 있는 겨울왕국은 관객 근거 1개인 엘리자벳·시카고보다 약하게 반영(순서만, 둘은 같은 점수라 이름순)");
const Dno = clone(Dcmp); Dno.actorProfiles["본인만"] = {voice: [], role: []};
assert.deepStrictEqual(cmpOrder(Dno), ["시카고", "엘리자벳"], "본인 해석이 없으면 그 후보는 아예 겹치지 않는다(본인 해석이 특징 비교에 들어간다는 뜻)");

// 취향 질문(3/3): 질문마다 2개까지, 상관없어요는 그 질문만 비운다. 취향 키는 tag: 접두어라 5축 키('묵직한 음색' = 허스키+묵직)와 안 겹친다
const qTone = ONBOARD_QS.find(q => q.id === "tone"), qSing = ONBOARD_QS.find(q => q.id === "sing");
assert.deepStrictEqual(togglePick([], qTone, "맑음"), ["tag:맑음"]);
assert.strictEqual(togglePick(["tag:맑음", "tag:허스키"], qTone, "부드러움"), null, "한 질문에서 3번째는 안 된다");
assert.deepStrictEqual(togglePick(["tag:맑음", "tag:허스키", "tag:성량"], qTone, ""), ["tag:성량"], "상관없어요는 그 질문만 비운다");
assert.deepStrictEqual(togglePick(["tag:맑음"], qTone, "맑음"), [], "다시 누르면 풀림");
assert.deepStrictEqual(togglePick(["tag:맑음", "tag:허스키"], qSing, "성량"), ["tag:맑음", "tag:허스키", "tag:성량"], "다른 질문은 따로 센다");
assert.deepStrictEqual(prefT({axis: {"묵직한 음색": ["허스키", "묵직한 음색"]}}, "tag:묵직한 음색"), ["묵직한 음색"]);
assert.deepStrictEqual(prefT({axis: {"묵직한 음색": ["허스키", "묵직한 음색"]}}, "묵직한 음색"), ["허스키", "묵직한 음색"], "예전 5축 키는 그대로");
assert.strictEqual(prefLabel("tag:선명하고 쨍한 음색"), "선명하고 쨍한");
// ① 우선순위: 1순위 영역 질문의 태그만 2배
assert.strictEqual(prefWeight("노래", "tag:성량"), 2); assert.strictEqual(prefWeight("연기", "tag:성량"), 1);
assert.strictEqual(prefWeight("연기", "tag:관계 중심"), 2); assert.strictEqual(prefWeight("고루", "tag:성량"), 1); assert.strictEqual(prefWeight("노래", "강한 성량"), 1, "예전 5축 키는 1");
assert.strictEqual(prefWeight("노래", "tag:음색·보컬 조화"), 1, "조합 질문은 영역이 없다");
assert.deepStrictEqual(tagCounts({actorProfiles: {a: {voice: [{tag: "성량"}], role: [{tag: "관계 중심"}]}, b: {voice: [{tag: "성량"}], role: []}}, comboTags: {W: [{tag: "대비 시너지"}]}}), {"성량": 2, "관계 중심": 1, "대비 시너지": 1});
for (const q of ONBOARD_QS) for (const [l, t] of q.opts) assert.ok(l && t && !t.startsWith("tag:"), "선택지는 [보이는 말, 태그]");

console.log("personal ok");
