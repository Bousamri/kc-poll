/* Presenter screen: QR + countdown + live count, then results per question with an answer reveal.
   Works on a projector (keyboard or clicker) and on a phone (buttons). */
(function () {
  'use strict';
  var P = window.Poll;
  var cfg = P.cfg;
  var S = P.session;
  var QS = window.POLL.questions;
  var K = window.POLL_ANSWERS;
  var ORDER = QS.map(function (q) { return q.id; });
  var DUR = Number(cfg.voteSeconds) || 30;
  var esc = P.esc;

  var key = readKey();
  var presenter = false;
  var keyRejected = false;
  var view = 'join';
  var local = {};
  var localAt = {};
  var pending = {};
  ORDER.forEach(function (id) { local[id] = false; localAt[id] = 0; pending[id] = 0; });
  var srv = { ok: false, lastOk: 0, reveal: {}, counts: null, voters: 0, round: 0 };
  var timer = { start: 0, raf: 0 };
  var pollT = 0;
  var failCount = 0;
  var lastTally = -1;
  var demo = P.demo ? newDemo() : null;
  var resetArmed = 0;

  var $ = function (id) { return document.getElementById(id); };
  var main = $('main');
  var CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  $('bgRings').innerHTML = P.placidoSVG(12, 1.15);
  $('brandMark').innerHTML = P.placidoSVG(4, 2.2);
  $('clockRings').innerHTML = P.placidoSVG(8, 0.55, '', 31);
  var clockSvg = document.querySelector('#clockRings svg');
  P.setRings(clockSvg, 1);

  /* ---------- voter link and QR ---------- */
  var base = new URL('./', location.href);
  var vq = new URLSearchParams();
  if (S !== 'live') vq.set('s', S);
  if (P.apiFromUrl) vq.set('api', P.apiFromUrl);
  if (P.params.has('demo')) vq.set('demo', '1');
  var voterUrl = base.href + (vq.toString() ? '?' + vq.toString() : '');
  $('qr').innerHTML = P.qrSVG(voterUrl);
  var shortUrl = voterUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  var cut = shortUrl.indexOf('/');
  $('joinUrl').innerHTML = cut > 0
    ? esc(shortUrl.slice(0, cut + 1)) + '<b>' + esc(shortUrl.slice(cut + 1)) + '</b>'
    : '<b>' + esc(shortUrl) + '</b>';

  var WORDS = { 15: 'Fifteen', 20: 'Twenty', 30: 'Thirty', 40: 'Forty', 45: 'Forty-five', 60: 'Sixty', 90: 'Ninety' };
  document.querySelector('.join-title').innerHTML = 'Two questions.<br>' + (WORDS[DUR] || DUR) + ' seconds.';
  $('clockNum').textContent = String(DUR);

  if (S !== 'live') {
    $('sessBadge').hidden = false;
    $('sessBadge').textContent = 'Rehearsal · ' + S;
  }

  /* ---------- results views ---------- */
  QS.forEach(function (q, i) {
    var k = K[q.id];
    var sec = P.el('section', 'view results');
    sec.id = 'v' + q.id;
    var h = '<div class="r-head"><p class="kicker">Question ' + (i + 1) + ' · ' + esc(q.tag) + '</p>' +
      '<h2 class="r-q">' + esc(q.text) + '</h2><p class="r-mode" id="mode-' + q.id + '"></p></div><ol class="bars">';
    q.options.forEach(function (o) {
      h += '<li class="bar' + (k.correct === o.id ? ' correct' : '') + '" data-c="' + o.id + '">' +
        '<div class="bar-label"><span class="bar-main"><span class="check">' + CHECK + '</span>' + esc(o.main) + '</span>' +
        '<span class="bar-sub">' + esc(o.sub) + '</span></div>' +
        '<div class="bar-mid"><div class="bar-track"><div class="bar-fill"></div><span class="bar-tag">Most chosen</span></div>' +
        '<span class="bar-src">' + esc(k.sources[o.id]) + '</span></div>' +
        '<div class="bar-val"><span class="bar-pct">–</span><span class="bar-n"></span></div></li>';
    });
    h += '</ol><div class="r-foot"><p class="r-n"><b id="n-' + q.id + '">0</b> <span id="nl-' + q.id + '">answers</span>' +
      '<span class="phones" id="ph-' + q.id + '" hidden>· answer shown on phones</span></p>' +
      '<p class="r-answer"><span class="a1">Answer: <b>' + esc(k.headline) + '</b> · ' + esc(k.value) + ' · ' + esc(k.basis) + '</span>' +
      '<span class="a2">' + esc(k.takeaway) + '</span></p></div>';
    sec.innerHTML = h;
    main.appendChild(sec);
  });

  /* ---------- state helpers ---------- */
  function counts() { return demo ? demo.c : srv.counts; }
  function voters() { return demo ? demo.voters : srv.voters || 0; }
  function isShown(id) {
    if (pending[id] || Date.now() - localAt[id] < 4000) return local[id];
    if (presenter) return !!srv.reveal[id];
    return local[id] || !!srv.reveal[id];
  }

  function setView(v) {
    if (v !== 'join' && ORDER.indexOf(v) < 0) return;
    view = v;
    render();
  }

  function setReveal(id, v) {
    local[id] = v;
    localAt[id] = Date.now();
    render();
    if (!key || demo) return;
    pending[id] += 1;
    admin('reveal', { q: id, v: v }).then(null, function () { /* stays local */ }).then(function () {
      pending[id] -= 1;
      localAt[id] = Date.now();
      render();
    });
  }

  function next() {
    if (view === 'join') {
      if (!timer.start) { startTimer(); return; }
      setView(ORDER[0]);
      return;
    }
    if (!isShown(view)) { setReveal(view, true); return; }
    var i = ORDER.indexOf(view);
    if (i < ORDER.length - 1) setView(ORDER[i + 1]);
  }
  function prev() {
    if (view === 'join') return;
    var i = ORDER.indexOf(view);
    setView(i > 0 ? ORDER[i - 1] : 'join');
  }

  /* ---------- talking to the sheet ---------- */
  function applySrv(res) {
    srv.ok = true;
    srv.lastOk = Date.now();
    srv.reveal = res.reveal || {};
    srv.round = res.round || 0;
    if (res.counts) srv.counts = res.counts;
    if (typeof res.voters === 'number') srv.voters = res.voters;
    if (res.presenter) presenter = true;
    ORDER.forEach(function (id) {
      if (presenter && !pending[id] && Date.now() - localAt[id] >= 4000) local[id] = !!srv.reveal[id];
    });
  }

  function admin(op, extra, tries) {
    if (!key || demo) return Promise.resolve(null);
    var body = Object.assign({ action: 'admin', s: S, k: key, op: op }, extra || {});
    return P.api.post(body).then(function (res) {
      if (res && res.ok) {
        presenter = true;
        keyRejected = false;
        applySrv(res);
        render();
        return res;
      }
      if (res && res.error === 'not authorized') {
        presenter = false;
        keyRejected = true;
        render();
        return null;
      }
      throw new Error((res && res.error) || 'failed');
    }).catch(function (e) {
      tries = (tries || 0) + 1;
      if (tries > 5) throw e;
      return new Promise(function (r) { setTimeout(r, 700 * tries); }).then(function () { return admin(op, extra, tries); });
    });
  }

  function poll() {
    clearTimeout(pollT);
    if (demo) {
      demoTick();
      render();
      pollT = setTimeout(poll, 650);
      return;
    }
    P.api.get('results').then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'bad response');
      failCount = 0;
      applySrv(res);
    }).catch(function () {
      failCount += 1;
    }).then(function () {
      render();
      var ms = document.hidden ? 10000 : failCount ? Math.min(2000 * Math.pow(1.6, failCount), 12000) : 2000;
      pollT = setTimeout(poll, ms);
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  /* ---------- countdown ---------- */
  function startTimer() {
    timer.start = Date.now();
    if (demo) demo.running = true;
    tick();
    render();
  }
  function tick() {
    cancelAnimationFrame(timer.raf);
    var rem = timer.start ? DUR - (Date.now() - timer.start) / 1000 : DUR;
    var over = !!timer.start && rem <= 0;
    P.setRings(clockSvg, timer.start ? Math.max(0, rem) / DUR : 1);
    $('clockNum').textContent = String(Math.max(0, Math.ceil(rem)));
    $('clock').classList.toggle('over', over);
    $('clockCap').textContent = !timer.start ? 'seconds' : over ? 'time’s up' : 'seconds left';
    if (timer.start && !over) timer.raf = requestAnimationFrame(tick);
    else renderButtons();
  }

  /* ---------- drawing ---------- */
  function render() {
    $('vjoin').classList.toggle('on', view === 'join');
    ORDER.forEach(function (id) { $('v' + id).classList.toggle('on', view === id); });
    var segs = document.querySelectorAll('.seg button');
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].getAttribute('data-view') === view);

    var n = voters();
    if (n !== lastTally) {
      var t = $('tally');
      t.textContent = String(n);
      $('tallyLbl').textContent = n === 1 ? 'person has answered' : 'people have answered';
      if (lastTally >= 0 && n > lastTally) {
        t.classList.remove('bump');
        void t.offsetWidth;
        t.classList.add('bump');
      }
      lastTally = n;
    }

    var c = counts();
    QS.forEach(function (q) {
      var id = q.id;
      var cq = (c && c[id]) || null;
      var total = cq ? cq.n || 0 : 0;
      var max = 0;
      q.options.forEach(function (o) { max = Math.max(max, cq ? cq[o.id] || 0 : 0); });
      var tops = [];
      var sec = $('v' + id);
      var rows = sec.querySelectorAll('.bar');
      for (var r = 0; r < rows.length; r++) {
        var li = rows[r];
        var oid = li.getAttribute('data-c');
        var k = cq ? cq[oid] || 0 : 0;
        li.querySelector('.bar-fill').style.width = (max ? (100 * k) / max : 0).toFixed(1) + '%';
        li.querySelector('.bar-pct').textContent = total ? Math.round((100 * k) / total) + '%' : '–';
        li.querySelector('.bar-n').textContent = total ? k + (k === 1 ? ' vote' : ' votes') : '';
        var top = max > 0 && k === max;
        li.classList.toggle('top', top);
        if (top) tops.push(q.options[r]);
      }
      sec.classList.toggle('revealed', isShown(id));
      $('n-' + id).textContent = String(total);
      $('nl-' + id).textContent = total === 1 ? 'answer' : 'answers';
      $('ph-' + id).hidden = !srv.reveal[id] || !!demo;
      $('mode-' + id).innerHTML = tops.length
        ? 'Most chosen: <b>' + tops.map(function (o) { return esc(o.main); }).join('</b> and <b>') + '</b> · ' +
          Math.round((100 * max) / total) + '%'
        : 'No answers yet';
    });

    var live = demo || (srv.ok && Date.now() - srv.lastOk < 9000);
    var conn = $('conn');
    conn.className = 'conn ' + (live ? 'live' : srv.lastOk || failCount ? 'bad' : '');
    $('connText').textContent = demo ? 'Demo data' : live ? 'Live' : srv.lastOk || failCount ? 'Reconnecting' : 'Connecting';
    $('roleBadge').hidden = !presenter;
    renderButtons();
    if (!$('panel').hidden) renderPanel();
  }

  function renderButtons() {
    var bt = $('btnTimer');
    bt.hidden = view !== 'join';
    bt.textContent = timer.start ? 'Restart timer' : 'Start ' + DUR + ' s';
    bt.classList.toggle('primary', !timer.start);
    var br = $('btnReveal');
    br.hidden = view === 'join';
    if (view !== 'join') {
      var shown = isShown(view);
      var locked = shown && !presenter && !demo && !!srv.reveal[view];
      br.disabled = locked;
      br.textContent = locked ? 'Revealed' : shown ? 'Hide answer' : 'Reveal answer';
      br.classList.toggle('primary', !shown);
    }
  }

  /* ---------- settings panel ---------- */
  function renderPanel() {
    var pnl = $('panel');
    var other = S === 'live' ? 'test' : 'live';
    var otherUrl = location.pathname + (other === 'live' ? '' : '?s=' + other) +
      (P.apiFromUrl ? (other === 'live' ? '?' : '&') + 'api=' + encodeURIComponent(P.apiFromUrl) : '');
    var h = '<button type="button" class="iconbtn x" data-act="close">Close</button>' +
      '<h2>Poll settings</h2>' +
      '<h3>Session</h3><p>' + (S === 'live'
        ? 'This is the <b>live</b> session, the one on your slide.'
        : 'This is the rehearsal session <b>' + esc(S) + '</b>. Its votes never mix with the live ones.') +
      '</p><div class="row"><a class="btn" href="' + esc(otherUrl) + '">' +
      (other === 'live' ? 'Back to the live session' : 'Open a rehearsal session') + '</a></div>' +
      '<h3>Voting page</h3><p class="mono">' + esc(voterUrl) + '</p>' +
      '<div class="row"><a class="btn" href="' + esc(voterUrl) + '" target="_blank" rel="noopener">Open it</a></div>' +
      '<h3>Connection</h3><p>' + (demo
        ? '<span class="warn">Demo mode.</span> No backend is set in config.js, so the numbers here are made up.'
        : srv.ok ? 'Connected to your Google Sheet.' : '<span class="warn">Not connected yet.</span> Check the URL in config.js.') + '</p>' +
      '<h3>Presenter controls</h3><p>' + (presenter
        ? 'On. Revealing an answer here also shows it on the audience’s phones.'
        : keyRejected
          ? '<span class="warn">This presenter key was refused.</span> Open your presenter link again.'
          : key ? 'Checking your presenter key…'
            : 'Off. This screen can still show and reveal results, but phones only get the answer when you use your presenter link.') + '</p>';
    if (presenter) {
      h += '<div class="row"><button type="button" class="btn" data-act="reset">' +
        (resetArmed && Date.now() - resetArmed < 5000 ? 'Press again to clear ' + esc(S) : 'Clear all answers in ' + esc(S)) +
        '</button></div><p style="font-size:13px;color:var(--dim)">Clearing starts the session from zero. The rows stay in your sheet; they are just not counted.</p>';
    }
    h += '<h3>Keys</h3><div class="keys">' +
      '<kbd>→ / Space / clicker</kbd><span>Next step: start timer, show Q1, reveal, show Q2, reveal</span>' +
      '<kbd>←</kbd><span>Back one screen</span>' +
      '<kbd>0 1 2</kbd><span>Join screen, question 1, question 2</span>' +
      '<kbd>R</kbd><span>Reveal or hide the answer</span>' +
      '<kbd>T</kbd><span>Start or restart the timer</span>' +
      '<kbd>F</kbd><span>Full screen</span>' +
      '<kbd>B</kbd><span>Black screen</span>' +
      '<kbd>?</kbd><span>This panel</span></div>';
    pnl.innerHTML = h;
  }
  function togglePanel(force) {
    var pnl = $('panel');
    var open = typeof force === 'boolean' ? force : pnl.hidden;
    pnl.hidden = !open;
    if (open) renderPanel();
  }
  $('panel').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'close') togglePanel(false);
    if (act === 'reset') {
      if (resetArmed && Date.now() - resetArmed < 5000) {
        resetArmed = 0;
        b.disabled = true;
        b.textContent = 'Clearing…';
        admin('reset').then(function () {
          ORDER.forEach(function (id) { local[id] = false; localAt[id] = Date.now(); });
          timer.start = 0;
          tick();
          render();
        }, function () { render(); });
      } else {
        resetArmed = Date.now();
        renderPanel();
        setTimeout(function () { if (!$('panel').hidden) renderPanel(); }, 5100);
      }
    }
  });

  /* ---------- input ---------- */
  document.querySelector('.seg').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-view]');
    if (b) { setView(b.getAttribute('data-view')); b.blur(); }
  });
  $('btnTimer').addEventListener('click', function (ev) { startTimer(); ev.currentTarget.blur(); });
  $('btnReveal').addEventListener('click', function (ev) {
    if (view !== 'join') setReveal(view, !isShown(view));
    ev.currentTarget.blur();
  });
  $('btnFull').addEventListener('click', function (ev) { toggleFull(); ev.currentTarget.blur(); });
  $('btnSettings').addEventListener('click', function (ev) { togglePanel(); ev.currentTarget.blur(); });

  function toggleFull() {
    var d = document;
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); }
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(function () {});
  }
  function toggleBlack() { $('blackout').hidden = !$('blackout').hidden; }
  $('blackout').addEventListener('click', toggleBlack);

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var k = e.key;
    if (k === 'Escape') { togglePanel(false); return; }
    if (!$('blackout').hidden && k !== 'b' && k !== 'B' && k !== '.') { toggleBlack(); e.preventDefault(); return; }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') { e.preventDefault(); prev(); }
    else if (k === '0' || k === 'j') setView('join');
    else if (k === '1') setView('q1');
    else if (k === '2') setView('q2');
    else if (k === 'r' || k === 'R') { if (view !== 'join') setReveal(view, !isShown(view)); }
    else if (k === 't' || k === 'T') startTimer();
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'b' || k === 'B' || k === '.') toggleBlack();
    else if (k === '?' || k === 'h' || k === 'H') togglePanel();
  });

  // Hide the controls and the cursor on a projector when the mouse is still.
  var idleT = 0;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function () { document.body.classList.add('idle'); }, 2600);
  }
  ['mousemove', 'mousedown', 'touchstart'].forEach(function (evName) {
    document.addEventListener(evName, wake, { passive: true });
  });
  wake();

  /* ---------- presenter key: from the #k= link once, then remembered on this device ---------- */
  function readKey() {
    var m = location.hash.match(/k=([A-Za-z0-9_-]+)/);
    if (m) {
      try { localStorage.setItem('kcpoll:key', m[1]); } catch (e) { /* ignore */ }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      return m[1];
    }
    try { return localStorage.getItem('kcpoll:key') || ''; } catch (e) { return ''; }
  }

  /* ---------- demo data when no backend is set ---------- */
  function newDemo() {
    var zero = function () { return { n: 0, A: 0, B: 0, C: 0, D: 0, E: 0 }; };
    return {
      running: false,
      voters: 0,
      max: 86,
      c: { q1: zero(), q2: zero() },
      w: { q1: [0.08, 0.17, 0.32, 0.25, 0.18], q2: [0.04, 0.18, 0.38, 0.27, 0.13] }
    };
  }
  function demoTick() {
    if (!demo.running && view === 'join') return;
    if (demo.voters >= demo.max || Math.random() > 0.7) return;
    var add = 1 + Math.floor(Math.random() * 3);
    for (var i = 0; i < add && demo.voters < demo.max; i++) {
      demo.voters += 1;
      ORDER.forEach(function (id) {
        if (id === 'q2' && Math.random() < 0.04) return;
        var x = Math.random();
        var acc = 0;
        var letters = ['A', 'B', 'C', 'D', 'E'];
        for (var j = 0; j < 5; j++) {
          acc += demo.w[id][j];
          if (x <= acc || j === 4) { demo.c[id][letters[j]] += 1; demo.c[id].n += 1; break; }
        }
      });
    }
  }

  /* ---------- start ---------- */
  var startView = P.params.get('view');
  if (startView === 'q1' || startView === 'q2') view = startView;
  render();
  tick();
  poll();
  if (key && !demo) admin('whoami').then(null, function () { /* offline for now */ });
})();
