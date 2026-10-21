// 캐스팅 보드(#board/작품) · 프로그램 페이지(#show/작품/날짜/시간). 스타일은 board.css, 부품은 style.css.
// 클래식 스크립트끼리 전역을 공유하므로 전체를 감싼다. 밖으로는 V.board, V.show, ACT.xxx만 내놓는다.
(() => {
const MAX_DATES = 3;
const josa = s => ((s.charCodeAt(s.length - 1) - 0xAC00) % 28 ? "과" : "와");   // 받침 있으면 과, 없으면 와
const faceThumb = (work, a) => { const t = thumbOf(work, a); return t ? `<img class="thumb" src="${esc(t)}" alt="${esc(a)} 영상 장면" loading="lazy">` : `<div class="thumb none">영상 없음</div>`; };
const hrefShow = (work, p) => `#show/${esc(work)}/${p.date}/${p.time}`;

// 다시 그려도 가로 스크롤 위치와 키보드 초점을 지킨다 (날짜 줄·보드·카드가 맨 앞으로 튀지 않게)
const SCROLLERS = ".bd-strip,.bd-scroll,.sh-pages";
const keep = fn => {
  const xs = [...document.querySelectorAll(SCROLLERS)].map(e => e.scrollLeft), f = document.activeElement?.dataset;
  fn();
  document.querySelectorAll(SCROLLERS).forEach((e, i) => { e.scrollLeft = xs[i] || 0; });
  if (f?.act) document.querySelector(`[data-act="${f.act}"]${f.d ? `[data-d="${f.d}"]` : ""}${f.a ? `[data-a="${CSS.escape(f.a)}"]` : ""}${f.v ? `[data-v="${CSS.escape(f.v)}"]` : ""}`)?.focus({preventScroll: true});
};
const axisAct = ACT.axis; ACT.axis = (...a) => keep(() => axisAct(...a));   // core의 취향 칩도 같은 방식으로

const addDate = (st, d) => { if (st.dates.includes(d)) return true; if (st.dates.length >= MAX_DATES) { toast(`날짜는 ${MAX_DATES}일까지 고를 수 있어요`); return false; } st.dates = [...st.dates, d].sort(); return true; };
ACT.boardMode = d => { workState(d.work).mode = d.m; save(); rerender(); };
ACT.boardDate = d => { const st = workState(d.work); if (st.dates.includes(d.d)) st.dates = st.dates.filter(x => x !== d.d); else if (!addDate(st, d.d)) return; save(); keep(rerender); };
ACT.boardActor = d => { const st = workState(d.work); st.actors = st.actors.includes(d.a) ? st.actors.filter(a => a !== d.a) : [...st.actors, d.a]; save(); keep(rerender); };
ACT.boardActorDate = d => { const st = workState(d.work); if (!addDate(st, d.d)) return; st.mode = "date"; save(); rerender(); };   // 같이 나오는 날을 골랐으면 날짜로 모드로
ACT.showPlan = d => { const i = addPlan(d.work, d.date, d.time); if (i >= 0) location.hash = "#saved/" + i; };

// ---------- 캐스팅 보드 ----------
V.board = work => {
  const w = workOf(work); if (!w || !w.hasSchedule) return null;
  const st = workState(work), mode = st.mode === "actor" ? "actor" : "date", want = wantSet(st.axes), ups = upcoming(work);
  const bc = boardColumns(work), cols = bc.cols, pi = pickIndex(work, cols, st.axes), n = cols.length;
  const pins = pinsByRole(work, st.actors), lr = leadRoles(work), A = esc(work);
  const seg = `<div class="seg" role="group" aria-label="보는 방식">${[["date", "날짜로"], ["actor", "배우로"]].map(([m, l]) => `<button type="button" class="${mode === m ? "on" : ""}" data-act="boardMode" data-work="${A}" data-m="${m}" aria-pressed="${mode === m}">${l}</button>`).join("")}</div>`;
  const top = topbar({back: "#works", title: work, right: seg});
  if (!ups.length) return `${top}<p class="pad bd-empty">다가오는 회차가 없어요.</p>`;

  const scores = cols.map(p => scorePerf(work, p, st.axes));
  const sum = bc.mode === "dates" ? `고른 날 ${st.dates.length}일 · 회차 ${n}` : bc.mode === "pick" ? "PICK 회차를 먼저 채웠어요" : "다가오는 회차";

  // 4. 고르는 곳: 날짜로 = 날짜 줄 / 배우로 = 배역별 얼굴
  let pick;
  if (mode === "date") {
    const ok = new Set(ups.filter(p => passes(p, pins)).map(p => p.date));
    let lastM = "";
    const days = [...new Set(ups.map(p => p.date))].map(d => {
      const m = d.slice(0, 7), mon = m !== lastM ? `<span class="bd-mon">${+d.slice(5, 7)}월</span>` : ""; lastM = m;
      const on = st.dates.includes(d), off = !on && !ok.has(d);
      return `${mon}<button type="button" class="bd-day ${on ? "on" : ""}" data-act="boardDate" data-work="${A}" data-d="${d}" aria-pressed="${on}" aria-label="${mdKo(d)} ${dowOf(d)}요일" ${off ? "disabled" : ""}><span>${dowOf(d)}</span><b class="disp">${+d.slice(8)}</b></button>`;
    }).join("");
    pick = `<div class="bd-strip" role="group" aria-label="날짜 고르기">${days}</div>`
      + (st.actors.length ? `<div class="pad bd-pins"><span class="label">꼭 볼 배우</span>${st.actors.map(a => `<button type="button" class="chip on" data-act="boardActor" data-work="${A}" data-a="${esc(a)}" aria-label="${esc(a)} 빼기">${esc(a)} ✕</button>`).join("")}</div>` : "");
  } else {
    const countWith = acts => { const pn = pinsByRole(work, acts); return ups.filter(p => passes(p, pn)).length; };
    const matched = ups.filter(p => passes(p, pins));
    pick = `<div class="pad bd-pick">${lr.map(r => {
      const names = r.cast.filter(a => ups.some(p => p.cast[r.role] === a)); if (!names.length) return "";
      return `<div class="bd-role"><span class="eyebrow">${esc(r.role)} 역</span><div class="bd-faces">${names.map(a => {
        const on = st.actors.includes(a), off = !on && countWith([...st.actors, a]) === 0, ok = want.size && tagsOf(work, a).some(t => want.has(t.tag));
        return `<button type="button" class="bd-face ${on ? "on" : ""}" data-act="boardActor" data-work="${A}" data-a="${esc(a)}" aria-pressed="${on}" ${off ? "disabled" : ""}>${faceThumb(work, a)}<span class="plate ${on ? "pick" : ""}">${esc(a)}${ok ? ` <span class="ok">✓</span>` : ""}</span></button>`;
      }).join("")}</div></div>`;
    }).join("")}
      <div class="bd-match"><b>${st.actors.length ? `이 배우들이 같이 나오는 날 ${matched.length}회` : "배우를 고르면 같이 나오는 날을 보여 드려요"}</b>
        ${st.actors.length ? `<div class="chips">${matched.slice(0, 12).map(p => `<button type="button" class="chip ${st.dates.includes(p.date) ? "on" : ""}" data-act="boardActorDate" data-work="${A}" data-d="${p.date}">${md(p.date)} ${dowOf(p.date)} ${p.time}</button>`).join("")}${matched.length > 12 ? `<span class="tiny muted">외 ${matched.length - 12}회</span>` : ""}</div>` : ""}</div></div>`;
  }

  // 5. 보드: 열 = 회차, 행 = 주연 배역. PICK 열은 와인 테두리 + 도장
  let board;
  if (!n) board = `<p class="pad bd-empty">이 조건으로 나오는 회차가 없어요. 날짜나 배우를 바꿔 보세요.</p>`;
  else {
    const heads = cols.map((p, i) => {
      const note = (specialNote(p).match(/첫공|막공|폐막/) || [""])[0];
      return `<a class="bd-head ${i === pi ? "pick" : ""}" href="${hrefShow(work, p)}"><span class="disp bd-md">${md(p.date)}</span><span class="bd-sub">${dowOf(p.date)} ${esc(p.time)}${note ? ` · ${note}` : ""}</span>${st.axes.length ? `<span class="bd-ev">근거 ${scores[i].pts}</span>` : ""}${i === pi ? `<span class="stamp fill bd-stamp">PICK</span>` : ""}</a>`;
    }).join("");
    const rows = lr.filter(r => cols.some(p => p.cast[r.role])).map(r => `<span class="eyebrow bd-rolelab">${esc(r.role)}</span>${cols.map((p, i) => {
      const a = p.cast[r.role]; if (!a) return `<div></div>`;
      return `<div class="bd-cell">${faceThumb(work, a)}<span class="plate ${i === pi ? "pick" : ""}">${esc(a)}${scores[i].hit.has(a) ? ` <span class="ok">✓</span>` : ""}</span></div>`;
    }).join("")}`).join("");
    const sup = cols.map(p => ({p, r: rests(work, p.cast)})).filter(x => x.r.length);
    board = `<section class="board bd-board" style="--n:${n};--pi:${pi}" aria-label="캐스팅 보드"><div class="bd-scroll"><div class="bd-grid ${n > 3 ? "scroll" : ""}">${pi >= 0 ? `<span class="bd-pickbox" aria-hidden="true"></span>` : ""}${heads}${rows}</div></div>
      ${sup.length ? `<details class="bd-sup"><summary>조연 보기</summary>${sup.map(x => `<p><b>${md(x.p.date)} ${dowOf(x.p.date)} ${esc(x.p.time)}</b> ${x.r.map(([r, a]) => `${esc(r)} ${esc(a)}`).join(" · ")}</p>`).join("")}</details>` : ""}</section>`;
  }

  // 6. PICK 이유 한 줄
  let reason;
  if (!st.axes.length) reason = `<p class="bd-plain">위에서 이 작품에서 중요한 것을 고르면 PICK을 찍어 드려요</p>`;
  else if (pi < 0) reason = `<p class="bd-plain">아직 고를 근거가 부족해요 · 영상으로 비교해 보세요</p>`;
  else {
    const p = cols[pi], by = new Map(), label = st.axes.map(axisLabel).join(" · ");
    for (const e of scores[pi].ev) { if (!by.has(e.actor)) by.set(e.actor, []); by.get(e.actor).push(e.tag); }
    reason = `<a class="bd-reason" href="${hrefShow(work, p)}"><span class="disp bd-r-t">PICK · ${md(p.date)} ${dowOf(p.date)} ${esc(p.time)}</span><span class="bd-r-go">근거 보기 →</span><span class="bd-r-x">${esc(label)}${josa(label)} 맞는 리뷰 근거 ${scores[pi].pts}건 — ${[...by].map(([a, ts]) => `${esc(a)} ${ts.map(esc).join(" · ")}`).join(", ")}</span></a>`;
  }

  return `${top}
    <div class="pad bd-taste"><span class="label">내 취향</span>${tasteChips(work)}</div>
    <div class="pad between bd-title"><h1 class="disp">캐스팅 보드</h1><span class="bd-sum">${esc(sum)}</span></div>
    ${pick}${board}${reason}`;
};

// ---------- 프로그램 페이지 ----------
V.show = (work, date, time) => {
  const p = findPerf(work, date, time); if (!p) return null;
  const st = workState(work), run = runOf(work, date) || {}, want = wantSet(st.axes), sc = scorePerf(work, p, st.axes), A = esc(work);
  const same = x => x.date === date && x.time === time;
  const gp = picksFor(work, st.axes, 1)[0], bc = boardColumns(work), bi = pickIndex(work, bc.cols, st.axes);
  const isPick = !!(gp && same(gp.p)) || (bi >= 0 && same(bc.cols[bi]));   // 전체 1위이거나, 방금 본 보드에서 PICK이던 회차
  const ls = leads(work, p.cast), label = st.axes.map(axisLabel).join(" · ");

  const note = specialNote(p), nm = note.match(/^(.+?)\s*(첫공|막공|폐막)$/);
  const stamp = note ? `<span class="stamp ring sh-stamp" aria-label="${esc(note)}">${nm ? `${esc(nm[1])}<br>${esc(nm[2])}` : esc(note)}</span>` : "";
  const pickLine = sc.pts > 0 ? `<div class="sh-pick">${isPick ? `<span class="disp">PICK</span>` : ""}<span>근거 ${sc.pts}건 · ${esc(label)} 기준</span></div>` : "";

  const card = ([role, a], i) => {
    const rows = tagsOf(work, a), uniq = [...new Set(rows.map(r => r.tag))], hits = uniq.filter(t => want.has(t)), others = uniq.filter(t => !want.has(t));
    const q = rows.find(r => want.has(r.tag)) || rows[0], v = videoOf(work, a), net = voteNet(work, role, a);
    const vid = ytId(v)
      ? `<a class="sh-vid" href="${esc(v.url)}" target="_blank" rel="noopener" aria-label="${esc(a)} 영상 보기: ${esc(v.title)}"><img src="${esc(thumbOf(work, a))}" alt="${esc(a)} 영상 장면" loading="lazy"><span class="sh-vlabel">${ICON.play}<span class="t">${esc(v.title)} · ${esc(v.channel)}</span></span></a>`
      : `<a class="sh-vid none" href="${esc(searchUrl(work, a, role))}" target="_blank" rel="noopener">${ICON.play} 영상 찾아보기</a>`;
    return `<article class="sh-card">
      <div class="between"><span class="eyebrow">${esc(role)} 역</span>${ls.length > 1 ? `<span class="tiny"><b>${i + 1} / ${ls.length}</b></span>` : ""}</div>
      <h2 class="disp sh-name">${esc(a)}</h2>${vid}
      ${uniq.length ? `<p class="sh-tags">${hits.map(t => `<b class="wine">✓ ${esc(t)}</b>`).join(" · ")}${hits.length && others.length ? " · " : ""}${others.map(esc).join(" · ")}</p>` : `<p class="small muted">아직 리뷰 태그가 없어요</p>`}
      ${net ? `<p class="small wine"><b>${net > 0 ? "내가 더 좋았던 쪽" : "내가 덜 좋았던 쪽"}</b></p>` : ""}
      ${q ? `<div class="quote"><span class="mark" aria-hidden="true">“</span><div><span class="body">${esc(q.why)}</span><span class="tiny muted sh-src">${esc(q.src)}${q.link ? ` · <a href="${esc(q.link)}" target="_blank" rel="noopener">출처 ↗</a>` : ""}</span></div></div>` : ""}
    </article>`;
  };

  const sup = rests(work, p.cast), ck = ls.map(e => e[1]).join("|");
  const sameCombo = upcoming(work).filter(x => !same(x) && leads(work, x.cast).map(e => e[1]).join("|") === ck);
  const grade = S.prefs?.grade || "R석", prices = run.prices || [], mine = prices.find(([g]) => g === grade) || prices[0];
  const others = prices.filter(x => x !== mine).map(([g, c]) => `${g.replace(/석$/, "")} ${man(c)}`).join(" · ");
  const pl = S.plans.findIndex(x => x.work === work && x.date === date && x.time === time);
  const ticket = `<div class="ticket sh-ticket"><div class="sh-tk-main"><span class="sh-tk-grade">${mine ? `${esc(mine[0])}${mine[0] === grade && S.prefs?.grade ? " · 내 등급" : ""}` : "가격"}</span><span class="disp sh-tk-price">${mine ? won(mine[1]) : "준비 중"}</span>${others ? `<span class="sh-tk-others">${esc(others)}</span>` : ""}</div>
    ${pl >= 0 ? `<a class="sh-tk-go" href="#saved/${pl}">담겨 있어요<br>보기 →</a>` : `<button type="button" class="sh-tk-go" data-act="showPlan" data-work="${A}" data-date="${date}" data-time="${esc(time)}">볼 예정에<br>담기</button>`}</div>`;

  return `${topbar({back: "#board/" + work, title: work})}
    <div class="split sh">
      <div class="sh-main">
        <section class="pad sh-head"><h1 class="disp sh-date">${md(date)}</h1><p class="sh-when">${dowOf(date)}요일 ${timeKo(time)}${run.venue ? ` · ${esc(run.venue)}` : ""}</p>${pickLine}${stamp}</section>
        <div class="sh-pages" tabindex="0" aria-label="주연 배우 카드 — 옆으로 넘겨 보세요">${ls.map(card).join("")}</div>
        <div class="pad stack sh-more">
          ${sup.length ? `<p class="small"><b>조연</b> ${sup.map(([r, a]) => `${esc(r)} ${esc(a)}`).join(" · ")}</p>` : ""}
          ${sameCombo.length ? `<div class="stack"><span class="label">같은 주연 조합 다른 회차 ${sameCombo.length}</span><div class="chips">${sameCombo.slice(0, 10).map(x => `<a class="chip" href="${hrefShow(work, x)}">${md(x.date)} ${dowOf(x.date)} ${esc(x.time)}</a>`).join("")}${sameCombo.length > 10 ? `<span class="tiny muted">외 ${sameCombo.length - 10}회</span>` : ""}</div></div>` : ""}
        </div>
      </div>
      <aside class="aside pad sh-aside">${ticket}
        ${run.ticket ? `<a class="btn line" href="${esc(run.ticket)}" target="_blank" rel="noopener">예매처에서 좌석 보기 ↗</a><p class="tiny muted">예매처가 날짜를 링크로 받지 않아요. 달력에서 ${md(date)} ${esc(time)}을 다시 골라 주세요.</p>` : ""}
        ${run.seatmap?.url ? `<a class="sh-link" href="${esc(run.seatmap.url)}" target="_blank" rel="noopener">좌석 배치도 ↗</a>` : ""}
      </aside>
    </div>`;
};
})();
