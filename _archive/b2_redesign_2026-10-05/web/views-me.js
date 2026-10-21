// workspace-7c 담당: V.works(표지·목차), V.saved(i)(담기 확인), V.plans(내 공연), V.tag(i)(관람 후), V.me(내 취향) + 관련 ACT.
// 최상위 이름이 core.js·views-board.js와 부딪치지 않게 전부 이 함수 안에 둔다. 밖으로는 V.* 와 ACT.* 만 내보낸다.
(() => {
  const MOODS = {good: "좋았어요", meh: "그저 그랬어요", bad: "아쉬웠어요"};
  const GRADES = ["VIP석", "R석", "S석", "A석"];
  const slash = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;   // 10/24 — 팀 시트 내보내기 형식
  const daysTo = d => Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
  const CHECK = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
  const prefs = () => { S.prefs ||= {}; S.prefs.grade ||= ""; S.prefs.favs ||= []; return S.prefs; };
  const names = ls => ls.map(e => e[1]);
  const tagRec = x => S.tags.filter(t => t.work === x.work && t.date === x.date && t.time === x.time).pop();   // 이 회차에 남긴 평가(마지막 것)

  // 다시 그려도 키보드 초점이 사라지지 않게: 누른 요소와 같은 data-* 를 가진 요소에 초점을 되돌린다.
  const selOf = el => el?.dataset.act ? `[data-act="${el.dataset.act}"]` + Object.entries(el.dataset).filter(([k]) => k !== "act")
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}="${String(v).replace(/["\\]/g, "\\$&")}"]`).join("") : "";
  const redraw = el => { const s = selOf(el); rerender(); if (s) document.querySelector(s)?.focus({preventScroll: true}); };

  // ---------- 표지 · 목차 (#works) ----------
  const yr = d => d.slice(0, 4) === today().slice(0, 4) ? md(d) : `${d.slice(0, 4)}.${md(d)}`;
  const periodOf = r => r.start > today() ? `${md(r.start)}~${yr(r.end)}` : `~${yr(r.end)}`;
  const periods = work => { const rs = runsOf(work); return rs.map(r => (rs.length > 1 ? r.label + " " : "") + periodOf(r)); };
  const pickOf = work => { const axes = S.works[work]?.axes || []; return {axes, pick: axes.length ? picksFor(work, axes, 1)[0] : null}; };   // workState()는 부르지 않는다 — 모든 작품에 기본 상태를 미리 만들지 않으려고

  V.works = () => {
    // 다가오는 회차가 많은 작품부터. 캐스팅 일정이 없는 작품은 맨 뒤.
    const order = D.works.map((w, i) => ({w, i, n: w.hasSchedule ? upcoming(w.name).length : -1})).sort((a, b) => b.n - a.n || a.i - b.i).map(o => o.w);
    const cover = order[0], rest = order.slice(1), name = cover.name, up = upcoming(name);
    const run = runOf(name, up[0]?.date || today()) || {}, {axes, pick} = pickOf(name), img = posterUrl(cover);
    const pickBand = pick
      ? `<a class="pk-band" href="#board/${esc(name)}"><span class="stamp fill pk-stamp" aria-hidden="true">PICK</span>
          <span class="pk-body"><span class="pk-cap">${esc(axes.map(axisLabel).join(" · "))} 취향의 PICK</span>
            <span class="disp pk-when">${md(pick.p.date)} ${dowOf(pick.p.date)} ${esc(pick.p.time)}</span>
            <span class="pk-who">${esc(names(leads(name, pick.p.cast)).join(" · "))} · 근거 ${pick.pts}건</span></span>
          <span class="pk-go" aria-hidden="true">→</span></a>`
      : `<a class="pk-band none" href="#board/${esc(name)}"><span class="stamp ring pk-stamp" aria-hidden="true">PICK</span>
          <span class="pk-body"><span class="pk-who">${axes.length ? `${esc(axes.map(axisLabel).join(" · "))} 취향과 맞는 리뷰 근거가 아직 없어요` : "이 작품에서 중요한 걸 고르면 PICK을 찍어 드려요"}</span></span>
          <span class="pk-go" aria-hidden="true">→</span></a>`;
    const toc = rest.map((w, k) => {
      const no = String(k + 2).padStart(2, "0");
      if (!w.hasSchedule) return `<div class="toc-row off"><span class="disp toc-no">${no}</span><span class="toc-nm">${esc(w.name)}</span><span class="toc-when">캐스팅 준비 중</span></div>`;
      const pk = pickOf(w.name).pick;
      return `<a class="toc-row" href="#board/${esc(w.name)}"><span class="disp toc-no">${no}</span><span class="toc-nm">${esc(w.name)}</span>
        <span class="toc-when">${pk ? `<b class="toc-pick">PICK ${md(pk.p.date)}</b>` : ""}${periods(w.name).map(esc).join("<br>")}</span></a>`;
    }).join("");
    return `${topbar({right: `<a href="#plans">내 공연</a><a href="#me">내 취향</a>`})}
      <div class="pad cv-month"><span class="label">${today().slice(0, 4)} · ${+today().slice(5, 7)}월의 무대</span></div>
      <div class="split">
        <div class="cv-col">
          <a class="cv-img" href="#board/${esc(name)}">${img ? `<img src="${esc(img)}" alt="${esc(name)} 포스터">` : `<span class="cv-none disp">${esc(name)}</span>`}<span class="cv-tag">COVER</span></a>
          <a class="cv-head pad" href="#board/${esc(name)}"><span class="between"><h1 class="disp cv-title">${esc(name)}</h1><span class="disp cv-no">01</span></span>
            <span class="small muted">${esc(run.venue || "")}${run.end ? ` · ${mdKo(run.end)} 막공` : ""}</span></a>
          ${pickBand}
        </div>
        <nav class="aside toc pad" aria-label="목차"><span class="label">목차</span><div class="rule toc-list">${toc || `<p class="small muted">다른 작품은 준비 중이에요.</p>`}</div></nav>
      </div>`;
  };

  // ---------- 담기 확인 (#saved/인덱스) ----------
  // 캘린더 파일(.ics): 의존성 없이 data: URL. DTSTART는 시간대 없는 로컬 시각이라 보는 사람 기기의 시간대로 들어간다. 길이는 2시간 30분 고정.
  // ponytail: 공연마다 러닝타임이 다르다. 데이터에 러닝타임이 생기면 그 값으로
  function icsHref(x, run) {
    const p2 = n => String(n).padStart(2, "0");
    const loc = d => fmt(d).replace(/-/g, "") + "T" + p2(d.getHours()) + p2(d.getMinutes()) + "00";
    const start = new Date(`${x.date}T${x.time}:00`), end = new Date(start.getTime() + 150 * 60000), u = new Date();
    const stamp = `${u.getUTCFullYear()}${p2(u.getUTCMonth() + 1)}${p2(u.getUTCDate())}T${p2(u.getUTCHours())}${p2(u.getUTCMinutes())}${p2(u.getUTCSeconds())}Z`;
    const e = s => String(s).replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");
    const who = names(leads(x.work, x.cast)).join("·");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PICKLE//KO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      `UID:pickle-${x.date}-${x.time.replace(":", "")}-${x.work.replace(/\s+/g, "")}@pickle`, `DTSTAMP:${stamp}`, `DTSTART:${loc(start)}`, `DTEND:${loc(end)}`,
      `SUMMARY:${e(who ? `${x.work} (${who})` : x.work)}`, ...(run?.venue ? [`LOCATION:${e(run.venue)}`] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
  }

  V.saved = i => {
    const x = S.plans[+i]; if (!x) return null;
    const run = runOf(x.work, x.date) || {}, ls = leads(x.work, x.cast), file = `pickle-${x.work.replace(/\s+/g, "")}-${x.date}.ics`;
    return `${topbar({back: `#show/${x.work}/${x.date}/${x.time}`})}
      <div class="pad narrow sv">
        <span class="stamp fill sv-stamp" role="img" aria-label="담김">${CHECK}</span>
        <h1 class="disp sv-h">볼 예정에 담았어요</h1>
        <div class="ticket sv-ticket">
          <div class="sv-main"><span class="eyebrow sv-eye">볼 예정</span><span class="disp sv-title">${esc(x.work)}</span>
            <span class="sv-when">${md(x.date)} ${dowOf(x.date)}요일 · ${esc(x.time)}</span><span class="tiny sv-venue">${esc(run.venue || "")}</span></div>
          <div class="sv-stub">${ls.map(([r, a]) => `<span class="sv-lead"><small>${esc(r)}</small>${esc(a)}</span>`).join("")}</div>
        </div>
        <section class="sv-q"><h2 class="label">이 추천 어땠어요?</h2>
          <div class="chips">${[["good", "좋아요"], ["meh", "아쉬워요"]].map(([k, l]) => `<button type="button" class="chip ${x.quick === k ? "on" : ""}" data-act="savedQuick" data-i="${+i}" data-q="${k}" aria-pressed="${x.quick === k}">${l}</button>`).join("")}</div></section>
        <div class="stack sv-acts">
          ${run.ticket ? `<a class="btn" href="${esc(run.ticket)}" target="_blank" rel="noopener">예매처로 이동 ↗</a>
          <p class="tiny muted">예매처 달력에서 <b>${md(x.date)} ${esc(x.time)}</b>을 다시 골라야 해요.</p>` : `<button type="button" class="btn" disabled>예매 링크 준비 중</button>`}
          ${run.seatmap?.url ? `<a class="btn line" href="${esc(run.seatmap.url)}" target="_blank" rel="noopener">좌석 배치도 ↗</a>` : ""}
          <a class="btn line" download="${esc(file)}" href="${icsHref(x, run)}">내 캘린더에 추가 (.ics)</a>
          <a class="btn line" href="#board/${esc(x.work)}">캐스팅 보드로</a>
          <a class="btn line" href="#works">작품 목록</a>
        </div>
        <p class="tiny muted sv-note">공연 다음 날 '내 공연'에서 3초 평가를 남길 수 있어요.</p>
      </div>`;
  };
  ACT.savedQuick = (d, el) => { const x = S.plans[+d.i]; if (!x) return; x.quick = x.quick === d.q ? "" : d.q; save(); redraw(el); };

  // ---------- 내 공연 (#plans) ----------
  V.plans = () => {
    const t0 = today(), all = S.plans.map((x, i) => ({x, i}));
    const up = all.filter(o => o.x.date >= t0).sort((a, b) => byWhen(a.x, b.x)), past = all.filter(o => o.x.date < t0).sort((a, b) => byWhen(b.x, a.x));
    const ticket = ({x, i}, isPast) => {
      const run = runOf(x.work, x.date) || {}, ls = leads(x.work, x.cast), rec = tagRec(x), d = daysTo(x.date);
      const stub = !isPast ? `<div class="pl-stub"><span class="disp pl-d">${d === 0 ? "오늘" : `D-${d}`}</span><span class="tiny">${md(x.date)} ${dowOf(x.date)}</span></div>`
        : x.tagged ? `<div class="pl-stub done"><span class="disp pl-d">${esc(MOODS[rec?.mood] || "평가 완료")}</span><span class="tiny">3초 평가 ✓</span></div>`
        : `<a class="pl-stub rate" href="#tag/${i}"><span class="disp pl-d">봤어요</span><span class="tiny">3초 평가</span></a>`;
      return `<li class="pl-item"><div class="ticket pl-ticket">
          <a class="pl-main" href="#show/${esc(x.work)}/${x.date}/${esc(x.time)}"><span class="disp pl-title">${esc(x.work)}</span>
            <span class="pl-when">${md(x.date)} ${dowOf(x.date)} ${esc(x.time)}${run.venue ? ` · ${esc(run.venue)}` : ""}</span>
            <span class="pl-cast">${esc(names(ls).join(" · "))}</span></a>${stub}</div>
        <button type="button" class="chip pl-del" data-act="planDel" data-i="${i}" aria-label="${esc(x.work)} ${md(x.date)} 삭제">삭제</button></li>`;
    };
    const list = (title, arr, isPast) => arr.length ? `<section class="pl-sec"><h2 class="label">${title} ${arr.length}</h2><ul class="pl-list">${arr.map(o => ticket(o, isPast)).join("")}</ul></section>` : "";
    return `${topbar({back: "#works", title: "내 공연"})}
      <div class="pad narrow pl">${all.length
        ? `${list("다가오는 공연", up, false)}${list("지난 공연", past, true)}`
        : `<div class="pl-empty"><p class="disp">아직 담은 공연이 없어요</p><p class="small muted">회차 프로그램 페이지에서 '볼 예정에 담기'를 누르면 여기 모여요.</p><a class="btn" href="#works">작품 목록</a></div>`}</div>`;
  };
  ACT.planDel = d => { S.plans.splice(+d.i, 1); draft = null; save(); rerender(); toast("삭제했어요"); };

  // ---------- 관람 후 (#tag/인덱스) ----------
  let draft = null;   // 저장 전 입력. 화면을 다시 그려도 유지하고, 저장하면 비운다(새로고침하면 사라져도 괜찮다)
  V.tag = i => {
    const x = S.plans[+i]; if (!x) return null;
    if (!draft || draft.i !== +i) draft = {i: +i, mood: "", more: false, actor: "", role: "", tags: [], cmp: {}, partner: "", combo: [], view: 0, seat: "", note: ""};
    const t = draft, ls = leads(x.work, x.cast), others = ls.filter(([, a]) => a !== t.actor);
    if (t.actor && !others.some(([, a]) => a === t.partner)) t.partner = others[0]?.[1] || "";
    const same = t.actor ? (rolesOf(x.work).find(r => r.role === t.role)?.cast || []).filter(a => a !== t.actor) : [];
    const pressed = c => `class="chip ${c ? "on" : ""}" aria-pressed="${!!c}"`;
    return `${topbar({back: "#plans", title: "3초 평가"})}
      <div class="pad narrow tg">
        <p class="small muted">${esc(x.work)} · ${md(x.date)} ${dowOf(x.date)} ${esc(x.time)}</p>
        <section class="tg-card"><h1 class="disp tg-h">오늘 공연 어떠셨나요?</h1>
          <div class="tg-mood" role="group" aria-label="오늘 공연">${Object.entries(MOODS).map(([k, l]) => `<button type="button" class="tg-m ${t.mood === k ? "on" : ""}" data-act="tagMood" data-m="${k}" aria-pressed="${t.mood === k}">${l}</button>`).join("")}</div></section>
        <details id="tag-more" class="tg-more" ${t.more ? "open" : ""}><summary>더 남기기 (선택) — 남기면 다음 PICK이 더 정확해져요</summary>
          <div class="tg-body">
            <section class="tg-card"><h2 class="label">가장 인상 깊었던 주연</h2>
              <div class="chips">${ls.map(([r, a]) => `<button type="button" ${pressed(t.actor === a)} data-act="tagActor" data-a="${esc(a)}" data-r="${esc(r)}">${esc(a)} <small>${esc(r)}</small></button>`).join("")}</div></section>
            ${t.actor ? `<section class="tg-card"><h2 class="label">${esc(t.actor)}의 어떤 점이 좋았어요? <span class="muted">최대 3개</span></h2>
              <div class="chips">${Object.entries(D.actorTagLabels).map(([tag, label]) => `<button type="button" ${pressed(t.tags.includes(tag))} data-act="tagTag" data-t="${esc(tag)}" ${!t.tags.includes(tag) && t.tags.length >= 3 ? "disabled" : ""}>${esc(label)}</button>`).join("")}</div></section>` : ""}
            ${same.length ? `<section class="tg-card"><h2 class="label">같은 ${esc(t.role)} 역, 다른 배우와 비교하면? <span class="muted">본 적 있는 배우만</span></h2>
              ${same.map(b => `<div class="tg-cmp"><span class="tg-cn">${esc(b)}</span><div class="seg" role="group" aria-label="${esc(b)}와 비교">${[["skip", "안 봤어요"], ["a", `${t.actor} 쪽`], ["tie", "비슷"], ["b", `${b} 쪽`]].map(([v, l]) =>
                `<button type="button" class="${(t.cmp[b] || "skip") === v ? "on" : ""}" data-act="tagCmp" data-b="${esc(b)}" data-v="${v}" aria-pressed="${(t.cmp[b] || "skip") === v}">${esc(l)}</button>`).join("")}</div></div>`).join("")}</section>` : ""}
            ${t.actor && others.length ? `<section class="tg-card"><h2 class="label">상대 배우와의 합은요?</h2>
              <div class="chips">${others.map(([r, a]) => `<button type="button" ${pressed(t.partner === a)} data-act="tagPartner" data-a="${esc(a)}">${esc(a)} <small>${esc(r)}</small></button>`).join("")}</div>
              <div class="chips">${Object.entries(D.comboTagLabels).map(([tag, label]) => `<button type="button" ${pressed(t.combo.includes(tag))} data-act="tagCombo" data-t="${esc(tag)}">${esc(label)}</button>`).join("")}</div></section>` : ""}
            <section class="tg-card"><h2 class="label">어디 앉았어요? <span class="muted">나중에 좌석 추천에 써요</span></h2>
              <label class="tg-lab" for="tg-seat">좌석</label><input id="tg-seat" type="text" placeholder="예: 1층 B구역 7열 12번" value="${esc(t.seat)}" autocomplete="off" data-input="tagText" data-f="seat">
              <div class="tg-view" role="group" aria-label="시야 1부터 5">${[1, 2, 3, 4, 5].map(n => `<button type="button" ${pressed(t.view === n)} data-act="tagView" data-n="${n}" aria-label="시야 ${n}점">${n}</button>`).join("")}</div>
              <p class="tiny muted">시야 · 1 많이 가렸다 · 5 아주 잘 보였다</p></section>
            <section class="tg-card"><label class="label" for="tg-note">한 줄 후기</label><input id="tg-note" type="text" placeholder="선택" value="${esc(t.note)}" autocomplete="off" data-input="tagText" data-f="note"></section>
          </div></details>
        <button type="button" class="btn tg-save" data-act="tagSave" ${t.mood || t.tags.length ? "" : "disabled"}>저장</button>
      </div>`;
  };
  ACT.tagMood = (d, el) => { draft.mood = draft.mood === d.m ? "" : d.m; redraw(el); };
  ACT.tagActor = (d, el) => { const off = draft.actor === d.a; draft.actor = off ? "" : d.a; draft.role = off ? "" : d.r; draft.tags = []; draft.cmp = {}; draft.combo = []; redraw(el); };
  ACT.tagTag = (d, el) => { draft.tags = draft.tags.includes(d.t) ? draft.tags.filter(x => x !== d.t) : [...draft.tags, d.t].slice(0, 3); redraw(el); };
  ACT.tagCmp = (d, el) => { draft.cmp[d.b] = d.v; redraw(el); };
  ACT.tagPartner = (d, el) => { draft.partner = d.a; redraw(el); };
  ACT.tagCombo = (d, el) => { draft.combo = draft.combo.includes(d.t) ? draft.combo.filter(x => x !== d.t) : [...draft.combo, d.t]; redraw(el); };
  ACT.tagView = (d, el) => { draft.view = draft.view === +d.n ? 0 : +d.n; redraw(el); };
  ACT.tagText = (d, el) => { if (draft && (d.f === "seat" || d.f === "note")) draft[d.f] = el.value; };
  ACT.tagSave = () => {
    const t = draft, x = t && S.plans[t.i]; if (!x || !(t.mood || t.tags.length)) return;
    const at = today();
    S.tags.push({at, work: x.work, date: x.date, time: x.time, mood: t.mood, actor: t.actor, role: t.role, tags: t.tags.slice(), partner: t.combo.length ? t.partner : "", combo: t.combo.slice(), seat: t.seat.trim(), view: t.view, note: t.note.trim()});
    for (const [b, v] of Object.entries(t.cmp)) if (v !== "skip") S.votes.push({at, work: x.work, date: x.date, time: x.time, role: t.role, a: t.actor, b, result: v});
    x.tagged = true; const withTags = t.tags.length; draft = null; save(); mergeMyTags();
    location.hash = "#me"; toast(withTags ? "저장했어요. 다음 PICK에 반영돼요" : "저장했어요");
  };
  document.addEventListener("toggle", e => { if (draft && e.target.id === "tag-more") draft.more = e.target.open; }, true);   // toggle은 버블링되지 않아 capture로

  // ---------- 내 취향 (#me) ----------
  // 팀 시트 '태그 기록' 탭 맨 아래에 붙이는 TSV. 열: 기록일 · 출처 · 작품 · 시즌 · 공연장 · 회차 · 종류 · 배역 · 배우 · 상대 배우 · 태그 · 메모 · 근거 · 링크
  function exportRows() {
    const out = [], venue = (w, d) => runOf(w, d)?.venue || "";
    for (const t of S.tags) {
      const show = `${slash(t.date)} ${t.time}`, note = [t.note, t.seat ? `좌석 ${t.seat}` : "", t.view ? `시야 ${t.view}/5` : ""].filter(Boolean).join(" · "), v = venue(t.work, t.date);
      if (t.mood || !(t.tags || []).length) out.push([t.at, "앱", t.work, "2026", v, show, "관람", t.role || "", t.actor || "", "", MOODS[t.mood] || "", note, "직접 관람", ""]);
      for (const tag of t.tags || []) out.push([t.at, "앱", t.work, "2026", v, show, "배우", t.role, t.actor, "", tag, note, "직접 관람", ""]);
      if (t.partner) for (const tag of t.combo || []) out.push([t.at, "앱", t.work, "2026", v, show, "조합", t.role, t.actor, t.partner, tag, note, "직접 관람", ""]);
    }
    for (const v of S.votes) out.push([v.at, "앱", v.work, "2026", venue(v.work, v.date), `${slash(v.date)} ${v.time}`, "비교", v.role, v.a, v.b, v.result === "a" ? "더 좋았다" : v.result === "b" ? "덜 좋았다" : "비슷", "같은 배역 비교 투표", "직접 관람", ""]);
    return out.map(r => r.map(c => String(c ?? "").replace(/[\t\r\n]+/g, " ")));   // 칸 안의 탭·줄바꿈은 TSV를 깨므로 공백으로
  }
  const allActors = () => [...new Set(Object.values(D.roles).flatMap(rs => rs.flatMap(r => r.cast)))].sort((a, b) => a.localeCompare(b, "ko"));

  V.me = () => {
    const p = prefs(), rows = exportRows(), tasted = D.works.filter(w => (S.works[w.name]?.axes || []).length);
    const recs = S.tags.slice().reverse();
    return `${topbar({back: "#works", title: "내 취향"})}
      <div class="pad narrow me">
        <section class="me-sec"><h2 class="label">기본 좌석 등급</h2>
          <div class="chips">${GRADES.map(g => `<button type="button" class="chip ${p.grade === g ? "on" : ""}" data-act="meGrade" data-g="${g}" aria-pressed="${p.grade === g}">${g}</button>`).join("")}</div></section>
        <section class="me-sec"><h2 class="label">좋아하는 배우</h2>
          ${p.favs.length ? `<div class="chips">${p.favs.map(a => `<button type="button" class="chip on" data-act="favDel" data-a="${esc(a)}" aria-label="${esc(a)} 빼기">${esc(a)} ×</button>`).join("")}</div>` : ""}
          <form id="favform" class="me-fav" autocomplete="off"><label class="me-vh" for="me-fav-in">배우 이름</label>
            <input id="me-fav-in" type="text" list="me-actors" placeholder="배우 이름" enterkeyhint="done"><button type="submit" class="btn ink">추가</button>
            <datalist id="me-actors">${allActors().map(a => `<option value="${esc(a)}"></option>`).join("")}</datalist></form>
          <p class="tiny muted">작품 캐스팅 보드에서 처음 열 때 '꼭 볼 배우'로 미리 들어가요.</p></section>
        <section class="me-sec"><h2 class="label">작품별 취향</h2>
          ${tasted.length ? tasted.map(w => `<div class="me-w"><a class="me-wn" href="#board/${esc(w.name)}">${esc(w.name)}</a><div class="chips">${S.works[w.name].axes.map(a => `<span class="chip on me-ax">${esc(axisLabel(a))}</span>`).join("")}</div></div>`).join("")
            : `<p class="small muted">아직 고른 취향이 없어요. 작품의 캐스팅 보드에서 '이 작품에서 중요한 것'을 고르면 여기 모여요.</p>`}</section>
        <section class="me-sec"><h2 class="label">관람 기록 ${S.tags.length}건${S.votes.length ? ` · 비교 투표 ${S.votes.length}건` : ""}</h2>
          ${recs.length ? recs.map(t => `<article class="me-rec"><div class="between"><b>${esc(t.work)}</b><span class="small muted">${md(t.date)} ${dowOf(t.date)} ${esc(t.time)}</span></div>
              <div class="chips">${t.mood ? `<span class="chip on me-ax">${esc(MOODS[t.mood] || "")}</span>` : ""}${t.actor ? `<span class="chip me-ax">${esc(t.actor)}</span>` : ""}${(t.tags || []).map(g => `<span class="chip me-ax">${esc(D.actorTagLabels[g] || g)}</span>`).join("")}${t.partner ? (t.combo || []).map(g => `<span class="chip me-ax">${esc(t.partner)} · ${esc(D.comboTagLabels[g] || g)}</span>`).join("") : ""}</div>
              ${t.seat || t.view || t.note ? `<p class="tiny muted">${esc([t.seat, t.view ? `시야 ${t.view}/5` : "", t.note].filter(Boolean).join(" · "))}</p>` : ""}</article>`).join("")
            : `<p class="small muted">공연을 보고 3초 평가를 남기면 여기 쌓여요.</p>`}</section>
        ${rows.length ? `<section class="me-sec"><h2 class="label">팀 시트로 내보내기</h2><p class="small muted">'태그 기록' 탭 맨 아래에 붙여 넣는 TSV ${rows.length}줄이에요.</p>
          <button type="button" class="btn line" data-act="copyTsv">TSV 복사</button><pre id="me-tsv" tabindex="0">${esc(rows.map(r => r.join("\t")).join("\n"))}</pre></section>` : ""}
      </div>`;
  };
  ACT.meGrade = (d, el) => { const p = prefs(); p.grade = p.grade === d.g ? "" : d.g; save(); redraw(el); };
  ACT.favDel = d => { const p = prefs(); p.favs = p.favs.filter(a => a !== d.a); save(); rerender(); document.getElementById("me-fav-in")?.focus({preventScroll: true}); };
  ACT.copyTsv = () => {
    const text = exportRows().map(r => r.join("\t")).join("\n");
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast("복사했어요"), () => {
      const pre = document.getElementById("me-tsv"); if (!pre) return;
      const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); toast("선택한 글을 복사하세요");
    });
  };
  document.addEventListener("submit", e => {
    if (e.target.id !== "favform") return;
    e.preventDefault();
    const v = e.target.querySelector("input").value.trim(); if (!v) return;
    const p = prefs(); if (!p.favs.includes(v)) p.favs.push(v);
    save(); rerender(); document.getElementById("me-fav-in")?.focus({preventScroll: true});
  });
})();
