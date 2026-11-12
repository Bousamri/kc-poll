/* Voter page: two questions, saved on the phone, sent in the background, revealed when the presenter says so. */
(function () {
  'use strict';
  var P = window.Poll;
  var cfg = P.cfg;
  var S = P.session;
  var QS = window.POLL.questions;
  var ORDER = QS.map(function (q) { return q.id; });

  var store = P.store('kcpoll:v1:' + S);
  var st = store.get() || {};
  if (!st.id) st.id = P.uid();
  st.answers = st.answers || {};
  st.sent = st.sent || {};
  st.reveal = st.reveal || {};
  st.counts = st.counts || {};
  st.late = st.late || {};
  if (!st.firstOpen) st.firstOpen = Date.now();
  save();

  var app = document.getElementById('app');
  var timerEl = document.getElementById('timer');
  var timerNum = document.getElementById('timerNum');
  var timerUnit = document.getElementById('timerUnit');
  var progressEl = document.getElementById('progress');
  var footRight = document.getElementById('footRight');

  var view = null;
  var sections = {};
  var advanceT = 0;
  var sending = false;
  var sendFailed = false;
  var retryT = 0;
  var retryDelay = 1500;
  var revealT = 0;
  var lastCheck = 0;
  var answersLoading = null;
  var notice = '';
  var timerRAF = 0;

  document.getElementById('bgRings').innerHTML = P.placidoSVG(12, 1.15);
  document.getElementById('brandMark').innerHTML = P.placidoSVG(4, 2.2);
  document.getElementById('timerRings').innerHTML = P.placidoSVG(5, 1.6);
  var timerSvg = document.querySelector('#timerRings svg');

  var TICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#132840" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function save() { store.set(st); }
  function qById(id) {
    for (var i = 0; i < QS.length; i++) if (QS[i].id === id) return QS[i];
    return null;
  }
  function optOf(q, c) {
    for (var i = 0; i < q.options.length; i++) if (q.options[i].id === c) return q.options[i];
    return null;
  }
  function allRevealed() { return ORDER.every(function (id) { return st.reveal[id]; }); }
  function openIds() { return ORDER.filter(function (id) { return !st.reveal[id]; }); }

  /* ---------- build the question screens ---------- */
  var noticeEl = P.el('div', 'notice');
  noticeEl.hidden = true;
  app.appendChild(noticeEl);

  QS.forEach(function (q, i) {
    var sec = P.el('section', 'qview');
    sec.setAttribute('data-q', q.id);
    sec.hidden = true;
    var h = '<p class="eyebrow"><span class="step">' + (i + 1) + ' / ' + QS.length + '</span>' + P.esc(q.tag) + '</p>' +
      '<h1 class="qtext">' + P.esc(q.text) + '</h1>' +
      '<div class="opts" role="radiogroup" aria-label="' + P.esc(q.tag) + '">';
    q.options.forEach(function (o) {
      h += '<button type="button" class="opt" role="radio" aria-checked="false" data-c="' + o.id + '">' +
        '<span class="opt-main">' + P.esc(o.main) + '</span>' +
        '<span class="opt-sub">' + P.esc(o.sub) + '<span class="tick">' + TICK + '</span></span></button>';
    });
    h += '</div><p class="hint">Tap one. You can change it until the answer is shown.</p>';
    if (i > 0) h += '<button type="button" class="back" data-back="' + QS[i - 1].id + '">← Question ' + i + '</button>';
    sec.innerHTML = h;
    sec.addEventListener('click', function (ev) {
      var b = ev.target.closest('.opt');
      if (b) { choose(q.id, b.getAttribute('data-c')); return; }
      var bk = ev.target.closest('[data-back]');
      if (bk) go(bk.getAttribute('data-back'));
    });
    app.appendChild(sec);
    sections[q.id] = sec;
  });

  var doneSec = P.el('section', 'done');
  doneSec.hidden = true;
  app.appendChild(doneSec);
  sections.done = doneSec;
  doneSec.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-edit]');
    if (t) { go(t.getAttribute('data-edit')); return; }
    if (ev.target.closest('[data-demo-reveal]')) demoReveal();
  });
  footRight.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-again]')) again();
  });

  /* ---------- navigation ---------- */
  function firstView() {
    for (var k = 0; k < ORDER.length; k++) {
      if (!st.answers[ORDER[k]] && !st.reveal[ORDER[k]]) return ORDER[k];
    }
    return 'done';
  }
  function nextView(after) {
    var i = ORDER.indexOf(after);
    for (var j = i + 1; j < ORDER.length; j++) {
      if (!st.answers[ORDER[j]] && !st.reveal[ORDER[j]]) return ORDER[j];
    }
    return firstView();
  }

  function go(id, opts) {
    opts = opts || {};
    clearTimeout(advanceT);
    if (id !== 'done' && st.reveal[id]) id = firstView();
    view = id;
    for (var k in sections) if (sections.hasOwnProperty(k)) sections[k].hidden = k !== id;
    var sec = sections[id];
    sec.classList.remove('enter');
    void sec.offsetWidth;
    sec.classList.add('enter');
    if (id === 'done') {
      renderDone(true);
      scheduleRevealCheck(opts.soon ? 1200 : firstCheckDelay());
    } else {
      mark(id);
    }
    noticeEl.textContent = notice;
    noticeEl.hidden = !notice || id === 'done';
    var bars = progressEl.children;
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i <= ORDER.indexOf(id));
    progressEl.hidden = id === 'done';
    renderFoot();
    tickTimer();
    if (!opts.first) window.scrollTo(0, 0);
  }

  function mark(qid) {
    var sec = sections[qid];
    var btns = sec.querySelectorAll('.opt');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', btns[i].getAttribute('data-c') === st.answers[qid] ? 'true' : 'false');
    }
  }

  function choose(qid, c) {
    if (st.reveal[qid]) return;
    clearTimeout(advanceT);
    st.answers[qid] = c;
    delete st.late[qid];
    notice = '';
    save();
    mark(qid);
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* not supported */ }
    flush();
    advanceT = setTimeout(function () { go(nextView(qid)); }, 420);
  }

  function again() {
    ORDER.forEach(function (id) {
      if (!st.reveal[id]) {
        delete st.answers[id];
        delete st.sent[id];
        delete st.late[id];
      }
    });
    st.firstOpen = Date.now();
    save();
    go(firstView());
  }

  /* ---------- sending ---------- */
  function pendingIds() {
    return ORDER.filter(function (id) { return st.answers[id] && st.sent[id] !== st.answers[id]; });
  }

  function flush() {
    clearTimeout(retryT);
    if (P.demo) {
      ORDER.forEach(function (id) { if (st.answers[id]) st.sent[id] = st.answers[id]; });
      save();
      renderSend();
      return;
    }
    if (sending) return;
    var ids = pendingIds();
    if (!ids.length) { renderSend(); return; }
    sending = true;
    renderSend();
    var id = ids[0];
    var c = st.answers[id];
    P.api.post({ action: 'vote', s: S, v: st.id, q: id, c: c }).then(function (res) {
      if (res && res.ok) {
        sending = false;
        sendFailed = false;
        st.sent[id] = c;
        if (res.accepted === false) st.late[id] = true;
        retryDelay = 1500;
        save();
        applyServer(res);
        flush();
      } else if (res && res.error === 'bad vote') {
        sending = false;
        st.sent[id] = c; // the server will never take it; stop retrying
        save();
        flush();
      } else {
        throw new Error((res && res.error) || 'failed');
      }
    }).catch(function () {
      sending = false;
      sendFailed = true;
      renderSend();
      retryT = setTimeout(flush, retryDelay + Math.random() * 1200);
      retryDelay = Math.min(retryDelay * 1.8, 20000);
    });
  }

  function renderSend() {
    var box = document.getElementById('sendState');
    if (!box) return;
    var cls;
    var txt;
    if (P.demo) { cls = 'ok'; txt = 'Demo mode: answers stay on this phone.'; }
    else if (!pendingIds().length) {
      if (!ORDER.some(function (id) { return st.answers[id]; })) { cls = ''; txt = ''; }
      else { cls = 'ok'; txt = 'Sent.'; }
    }
    else if (sendFailed || navigator.onLine === false) { cls = 'err'; txt = 'Not sent yet. Your answers are saved on this phone and will go through by themselves.'; }
    else { cls = 'busy'; txt = 'Sending…'; }
    box.className = 'sendstate ' + cls;
    box.querySelector('.t').textContent = txt;
    box.hidden = !txt;
  }

  /* ---------- server state: reveal flags, tallies, restarts ---------- */
  function applyServer(res) {
    if (!res || !res.ok) return;
    if (typeof res.round === 'number') {
      if (st.round === undefined || st.round === null) st.round = res.round;
      else if (res.round !== st.round) { restart(res.round); return; }
    }
    var changed = false;
    ORDER.forEach(function (id) {
      var r = !!(res.reveal && res.reveal[id]);
      if (r !== !!st.reveal[id]) { st.reveal[id] = r; changed = true; }
    });
    if (res.counts) {
      ORDER.forEach(function (id) {
        if (res.counts[id]) { st.counts[id] = res.counts[id]; changed = true; }
      });
    }
    save();
    if (!changed) return;
    if (view !== 'done' && st.reveal[view]) go(firstView());
    else if (view === 'done') renderDone(false);
  }

  function restart(round) {
    st.answers = {};
    st.sent = {};
    st.reveal = {};
    st.counts = {};
    st.late = {};
    st.round = round;
    st.firstOpen = Date.now();
    save();
    notice = 'The poll was restarted. Please answer again.';
    go(firstView());
  }

  function firstCheckDelay() {
    var rp = Number(P.params.get('rp'));
    return rp > 0 ? rp * 1000 : 12000 + Math.random() * 8000;
  }
  function pollInterval() {
    var rp = Number(P.params.get('rp'));
    if (rp > 0) return rp * 1000;
    return allRevealed() ? 45000 + Math.random() * 15000 : 20000 + Math.random() * 10000;
  }
  function scheduleRevealCheck(ms) {
    clearTimeout(revealT);
    if (P.demo || view !== 'done') return;
    revealT = setTimeout(checkReveal, ms);
  }
  function checkReveal() {
    if (document.hidden) { scheduleRevealCheck(15000); return; }
    lastCheck = Date.now();
    P.api.get('state').then(applyServer, function () { /* try again later */ }).then(function () {
      scheduleRevealCheck(pollInterval());
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    flush();
    if (view === 'done' && !P.demo && Date.now() - lastCheck > 8000) {
      clearTimeout(revealT);
      checkReveal();
    }
  });
  window.addEventListener('online', flush);

  /* ---------- done screen ---------- */
  function markSVG() {
    return '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle pathLength="1" cx="32" cy="35" r="11"/><circle pathLength="1" cx="32" cy="33" r="20" opacity=".7"/>' +
      '<circle pathLength="1" cx="32" cy="31" r="29" opacity=".4"/>' +
      '<path class="chk" pathLength="1" d="M26 34.5l4.5 4.5 8-9.5" style="stroke-width:3.4"/></svg>';
  }

  function ensureAnswers() {
    if (window.POLL_ANSWERS || answersLoading) return;
    answersLoading = P.loadScript('assets/answers.js?v=2').then(function () {
      if (view === 'done') renderDone(false);
    }, function () {
      answersLoading = null;
      setTimeout(ensureAnswers, 3000);
    });
  }

  function renderDone(play) {
    var any = ORDER.some(function (id) { return st.reveal[id]; });
    var all = allRevealed();
    if (any) ensureAnswers();
    var h = '<div class="done-mark' + (play ? ' play' : '') + '">' + markSVG() + '</div>';
    h += '<h1>' + (all ? 'The answers' : 'Thank you.') + '</h1>';
    h += '<p class="lede">' + (all
      ? 'Thank you for taking part.'
      : any
        ? 'The first answer is out. The second follows shortly.'
        : 'Your answers are in. Eyes on the screen: the answers come later in the talk.') + '</p>';
    ORDER.forEach(function (id, i) { h += st.reveal[id] ? revealCard(id, i) : waitCard(id, i); });
    h += '<p class="sendstate" id="sendState" role="status"><span class="dot"></span><span class="t"></span></p>';
    if (cfg.materialsUrl) {
      h += '<p style="margin:18px 0 0"><a class="btn-ghost" href="' + P.esc(cfg.materialsUrl) +
        '" target="_blank" rel="noopener">' + P.esc(cfg.materialsLabel || 'Materials') + ' →</a></p>';
    }
    if (P.demo && !all) {
      h += '<p style="margin:18px 0 0"><button type="button" class="btn-ghost" data-demo-reveal>Preview the answers (demo)</button></p>';
    }
    doneSec.innerHTML = h;
    renderSend();
    renderFoot();
  }

  function waitCard(id, i) {
    var q = qById(id);
    var a = st.answers[id];
    var o = a && optOf(q, a);
    var h = '<article class="card"><p class="eyebrow">Question ' + (i + 1) + ' · ' + P.esc(q.tag) + '</p>';
    if (o) {
      h += '<div class="yours"><div><span class="lbl">Your answer</span><b>' + P.esc(o.main) + '</b><span class="pc">' +
        P.esc(o.sub) + '</span></div><button type="button" class="link" data-edit="' + id + '">Change</button></div>';
    } else {
      h += '<div class="yours"><div><span class="lbl">Not answered yet</span></div>' +
        '<button type="button" class="link" data-edit="' + id + '">Answer</button></div>';
    }
    return h + '<p class="wait">The answer appears here when it is shown on screen.</p></article>';
  }

  function dots(n) {
    var cols = n <= 15 ? n : 11;
    var rows = Math.ceil(n / cols);
    var hit = Math.min(n - 1, Math.floor((rows - 1) / 2) * cols + Math.floor(cols / 2));
    var h = '<div class="dots" style="grid-template-columns:repeat(' + cols + ',1fr)" aria-hidden="true">';
    for (var i = 0; i < n; i++) h += '<i' + (i === hit ? ' class="hit"' : '') + '></i>';
    return h + '</div>';
  }

  function revealCard(id, i) {
    var K = window.POLL_ANSWERS;
    var q = qById(id);
    if (!K) {
      return '<article class="card"><p class="eyebrow">Question ' + (i + 1) + ' · ' + P.esc(q.tag) +
        '</p><p class="wait">Loading the answer…</p></article>';
    }
    var k = K[id];
    var a = st.answers[id];
    var o = a && optOf(q, a);
    var right = a === k.correct;
    var c = st.counts[id];
    var share = c && c.n && a ? Math.round((100 * (c[a] || 0)) / c.n) : null;
    var h = '<article class="card enter"><p class="eyebrow">Question ' + (i + 1) + ' · ' + P.esc(q.tag) + '</p>';
    h += '<p class="ans"><span class="big">' + P.esc(k.headline) + '</span><span class="val">' + P.esc(k.value) + '</span></p>';
    h += '<p class="basis">' + P.esc(k.basis) + '</p>';
    h += dots(k.one) + '<p class="dots-cap">' + P.esc(k.dotsCap || '') + '</p>';
    if (o) {
      h += '<div class="mine' + (right ? ' right' : '') + '">' +
        (right ? 'You chose <b>' + P.esc(o.main) + '</b>, the closest option. Well judged.'
               : 'You chose <b>' + P.esc(o.main) + '</b>.<span class="src">That is ' + P.esc(k.said[a]) + '</span>') +
        '</div>';
      if (st.late[id]) h += '<p class="room">Your answer arrived after the reveal, so it was not counted.</p>';
      else if (share !== null && share > 0) h += '<p class="room">' + share + '% of the room chose the same.</p>';
    } else {
      h += '<div class="mine">You did not answer this one.</div>';
    }
    return h + '<p class="take">' + P.esc(k.takeaway) + '</p></article>';
  }

  function demoReveal() {
    var fake = {
      q1: { n: 84, A: 7, B: 14, C: 27, D: 21, E: 15 },
      q2: { n: 81, A: 3, B: 15, C: 31, D: 22, E: 10 }
    };
    ORDER.forEach(function (id) { st.reveal[id] = true; st.counts[id] = fake[id]; });
    save();
    renderDone(false);
  }

  function renderFoot() {
    var bits = [];
    if (S !== 'live') bits.push('<span class="demo-flag">Session: ' + P.esc(S) + '</span>');
    if (P.demo) bits.push('<span class="demo-flag">Demo: nothing is sent</span>');
    if (view === 'done' && openIds().length && ORDER.some(function (id) { return st.answers[id]; })) {
      bits.push('<button type="button" class="link" data-again>Answer again</button>');
    }
    footRight.innerHTML = bits.join(' · ');
  }

  /* ---------- countdown: each phone gets the same number of seconds from first opening ---------- */
  function tickTimer() {
    cancelAnimationFrame(timerRAF);
    if (view === 'done') { timerEl.hidden = true; return; }
    var total = Number(cfg.voteSeconds) || 30;
    var rem = total - (Date.now() - st.firstOpen) / 1000;
    if (rem <= -60) { timerEl.hidden = true; return; }
    timerEl.hidden = false;
    if (rem <= 0) {
      timerEl.classList.add('over');
      P.setRings(timerSvg, 0);
      timerNum.textContent = 'Time’s up';
      timerUnit.textContent = '';
      return;
    }
    timerEl.classList.remove('over');
    P.setRings(timerSvg, rem / total);
    timerNum.textContent = String(Math.ceil(rem));
    timerUnit.textContent = 's';
    timerRAF = requestAnimationFrame(tickTimer);
  }

  /* ---------- start ---------- */
  var start = firstView();
  go(start, { first: true, soon: start === 'done' });
  flush();
})();
