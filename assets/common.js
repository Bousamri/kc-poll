/* Shared helpers for the voter page and the presenter screen. */
(function () {
  'use strict';

  var cfg = Object.assign(
    { api: '', voteSeconds: 45, materialsUrl: '', materialsLabel: '' },
    window.POLL_CONFIG || {}
  );
  var params = new URLSearchParams(location.search);
  var apiFromUrl = params.get('api') || '';
  if (apiFromUrl) cfg.api = apiFromUrl; // for rehearsals against another backend
  var session = cleanSession(params.get('s'));
  var demo = params.has('demo') || !cfg.api;

  function cleanSession(s) {
    s = String(s || 'live').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
    return s || 'live';
  }

  function store(key) {
    return {
      get: function () {
        try {
          var v = window.localStorage.getItem(key);
          return v ? JSON.parse(v) : null;
        } catch (e) {
          return null;
        }
      },
      set: function (v) {
        try {
          window.localStorage.setItem(key, JSON.stringify(v));
        } catch (e) { /* private mode: keep going in memory */ }
      },
      del: function () {
        try {
          window.localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
      }
    };
  }

  function uid() {
    var a = new Uint8Array(12);
    try {
      window.crypto.getRandomValues(a);
    } catch (e) {
      for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    }
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    for (var j = 0; j < a.length; j++) out += abc[a[j] % abc.length];
    return out;
  }

  function request(url, opts, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
    }, ms || 15000);
    var o = Object.assign({ cache: 'no-store', redirect: 'follow', credentials: 'omit' }, opts || {});
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(
      function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      },
      function (e) {
        clearTimeout(timer);
        throw e;
      }
    );
  }

  var api = {
    get: function (action) {
      var u = cfg.api + (cfg.api.indexOf('?') >= 0 ? '&' : '?') +
        'action=' + encodeURIComponent(action) + '&s=' + encodeURIComponent(session) + '&_=' + Date.now();
      return request(u, { method: 'GET' });
    },
    // A plain string body is sent as text/plain, which Apps Script accepts without a CORS preflight.
    post: function (body) {
      return request(cfg.api, { method: 'POST', body: JSON.stringify(body) });
    }
  };

  /* Placido rings. Smaller rings sit lower, so the rings crowd together below centre,
     the way they do over an inferior cone. Ring 0 is the innermost. */
  function placidoSVG(n, decenter, cls, r0) {
    var inner = r0 || 6;
    var s = '<svg class="' + (cls || '') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
    for (var i = 0; i < n; i++) {
      var r = inner + i * ((48 - inner) / (n - 1));
      var cy = 50 + (n - 1 - i) * decenter;
      s += '<circle cx="50" cy="' + cy.toFixed(2) + '" r="' + r.toFixed(2) + '"/>';
    }
    return s + '</svg>';
  }

  // fraction 1 = all rings lit; as it falls, the outer rings go dark first.
  function setRings(svg, fraction) {
    if (!svg) return;
    var cs = svg.querySelectorAll('circle');
    var n = cs.length;
    var lit = Math.max(0, Math.min(1, fraction)) * n;
    for (var i = 0; i < n; i++) {
      var o = Math.max(0, Math.min(1, lit - i));
      cs[i].style.opacity = (0.14 + 0.86 * o).toFixed(3);
    }
  }

  function qrSVG(text, dark) {
    /* global qrcode */
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var m = 4;
    var size = n + 2 * m;
    var d = '';
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) {
          var start = c;
          while (c < n && qr.isDark(r, c)) c++;
          d += 'M' + (start + m) + ' ' + (r + m) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z';
        } else {
          c++;
        }
      }
    }
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' +
      esc(text) + '"><rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path d="' + d + '" fill="' +
      (dark || '#10233A') + '"/></svg>';
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.Poll = {
    cfg: cfg,
    params: params,
    session: session,
    demo: demo,
    apiFromUrl: apiFromUrl,
    store: store,
    uid: uid,
    api: api,
    placidoSVG: placidoSVG,
    setRings: setRings,
    qrSVG: qrSVG,
    loadScript: loadScript,
    esc: esc,
    el: el,
    reducedMotion: reducedMotion
  };
})();
