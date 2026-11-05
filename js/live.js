/* 3차 반영 — 실시간 연결: 설비 값을 2초마다 받아 관리도에 이어 붙입니다.
   브라우저에서는 window.PressLive, node 에서는 require('./live.js') (spc.js · virtual-data.js 를 씀). 기준 문서: 기획서 12장

   받는 길 세 가지
     sim  — 내장 시뮬레이터(가상 값, 이 브라우저 안에서 만듦 — 밖으로 나가는 요청 없음)
     poll — 사용자가 넣은 HTTP(S) 주소를 N초마다 GET (JSON 또는 CSV). 그 요청 말고는 아무것도 밖으로 보내지 않습니다
            (credentials:'omit' · 본문 없음 · 주소에 {since} 가 있으면 마지막으로 받은 시각으로 바꿔 넣음)
     ws   — WebSocket 주소(ws:// · wss://)에 붙어 서버가 보내는 JSON 을 받음
   받는 형식(표본 tools/sample-rows.json): { "rows": [ { "time": "2026-10-27 10:00:02", "press": "P1", "pressType": "…", "die": "M-01",
     "pressCum": 1890112, "dieCum": 120, "current": 85.2, "voltage": 380.9, "temp": 44.8, "vib": 2.03 }, … ] }
   — 배열만 와도 되고, 한 행 객체만 와도 됩니다. 칸 이름은 받은 로그 CSV 의 한글 머리(일자·프레스·전류(A) …)도 읽습니다.
   time 은 「벽시계」 글자(yyyy-mm-dd hh:mm:ss) — 숫자(유닉스 시각 초·밀리초)면 이 PC 의 시간대로 바꿉니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./spc.js'), require('./virtual-data.js'), require('./logic.js'));
  else root.PressLive = factory(root.PressSPC, root.PressVirtual, root.PressLogic);
})(typeof self !== 'undefined' ? self : this, function (P, V, L) {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : {};
  var CH = ['current', 'voltage', 'temp', 'vib'];

  /* ── 받은 글자 → 행 ─────────────────────────────────────── */
  var KEYS = {
    t: ['time', 'ts', 'timestamp', 'datetime', 'date', 'at'],
    press: ['press', 'machine', 'equipment', 'device'],
    type: ['pressType', 'type', 'machineType'],
    die: ['die', 'mold', 'dieName'],
    pc: ['pressCum', 'pressCount', 'strokeCount', 'counter'],
    dc: ['dieCum', 'dieCount'],
    current: ['current', 'amp', 'amps'], voltage: ['voltage', 'volt', 'volts'], temp: ['temp', 'temperature'], vib: ['vib', 'vibration', 'rms']
  };
  var FROM_FIELD = { date: 't', press: 'press', pressType: 'type', die: 'die', pressCum: 'pc', dieCum: 'dc', current: 'current', voltage: 'voltage', temp: 'temp', vib: 'vib' };
  /* 칸 이름 → 우리 칸(t·press·…). 영어 이름을 먼저, 없으면 한글 머리(logic.js 의 열 찾기) */
  function keyMap(keys) {
    var m = {}, lower = {};
    keys.forEach(function (k) { lower[String(k).toLowerCase()] = k; });
    Object.keys(KEYS).forEach(function (id) { KEYS[id].some(function (a) { var k = lower[a.toLowerCase()]; if (k != null) { m[id] = k; return true; } return false; }); });
    if (L && L.matchField) keys.forEach(function (k) { var f = L.matchField(k), id = f && FROM_FIELD[f]; if (id && m[id] == null) m[id] = k; });
    return m;
  }
  function num(v) { if (v == null || v === '') return NaN; var x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim()); return isFinite(x) ? x : NaN; }
  function toSec(v) {
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 1e11) return V.wallNow(v);           // 밀리초
      if (v > 1e9) return V.wallNow(v * 1000);     // 초
      return P.parseStamp(v);                      // 엑셀 일련번호
    }
    var s = String(v == null ? '' : v).trim();
    if (/^\d{10,13}$/.test(s)) return toSec(Number(s));
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /T/.test(s)) { var ms = Date.parse(s); if (isFinite(ms)) return V.wallNow(ms); }
    return P.parseStamp(s);
  }
  /* 객체 배열 → 행 { t, press, type, die, pc, dc, current, voltage, temp, vib } · 못 읽은 행 수 */
  function normalize(objs) {
    var out = [], bad = 0, m = null, sig = '';
    (objs || []).forEach(function (o) {
      if (!o || typeof o !== 'object') { bad++; return; }
      var ks = Object.keys(o), sg = ks.join('|');
      if (sg !== sig) { m = keyMap(ks); sig = sg; }
      var t = m.t != null ? toSec(o[m.t]) : NaN, press = m.press != null && o[m.press] != null ? String(o[m.press]).trim() : '';
      if (!isFinite(t) || !press) { bad++; return; }
      var r = { t: t, press: press, type: m.type != null && o[m.type] != null ? String(o[m.type]) : '', die: m.die != null && o[m.die] != null ? String(o[m.die]).trim() : '',
        pc: m.pc != null ? num(o[m.pc]) : NaN, dc: m.dc != null ? num(o[m.dc]) : NaN };
      CH.forEach(function (c) { r[c] = m[c] != null ? num(o[m[c]]) : NaN; });
      out.push(r);
    });
    return { rows: out, bad: bad };
  }
  function csvToObjects(text) {
    var aoa = P.parseCsvText(text).filter(function (r) { return r && r.some(function (c) { return c != null && c !== ''; }); });
    if (!aoa.length) return [];
    var head = aoa[0].map(function (c) { return String(c == null ? '' : c).trim(); });
    return aoa.slice(1).map(function (r) { var o = {}; head.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
  }
  /* 받은 글자 → { rows, bad, format, error } */
  function parsePayload(text, contentType) {
    var s = String(text == null ? '' : text).replace(/^﻿/, '').trim();
    if (!s) return { rows: [], bad: 0, format: 'empty' };
    var isJson = /json/i.test(contentType || '') || s.charAt(0) === '{' || s.charAt(0) === '[';
    if (isJson) {
      var j;
      try { j = JSON.parse(s); } catch (e) {
        // 한 줄에 JSON 하나씩(NDJSON)
        try { j = s.split(/\r?\n/).filter(Boolean).map(function (l) { return JSON.parse(l); }); } catch (e2) { return { rows: [], bad: 0, format: 'json', error: 'JSON 을 읽지 못했습니다(' + e.message + ')' }; }
      }
      var list = Array.isArray(j) ? j : j && Array.isArray(j.rows) ? j.rows : j && Array.isArray(j.data) ? j.data : j && Array.isArray(j.items) ? j.items : j && typeof j === 'object' ? [j] : [];
      var n = normalize(list); n.format = 'json';
      if (j && typeof j === 'object' && !Array.isArray(j) && !Array.isArray(j.rows) && !Array.isArray(j.data) && !Array.isArray(j.items) && n.bad) n.error = '행을 찾지 못했습니다 — { "rows": [ … ] } 또는 행 배열로 보내 주세요';
      return n;
    }
    var c = normalize(csvToObjects(s)); c.format = 'csv';
    if (!c.rows.length && c.bad) c.error = 'CSV 머리행에 시각(time·일자)·프레스(press) 칸이 있어야 합니다';
    return c;
  }

  /* ── 받은 값 모아 두기(프레스마다, 시각순·같은 시각은 한 번) ─────── */
  function createBuffer(opts) {
    opts = opts || {};
    var keepSec = opts.keepSec || 6 * 3600, data = {}, stat = { rows: 0, dup: 0, old: 0, gaps: [], lastT: NaN };
    function get(p) { return data[p] || (data[p] = { press: p, type: '', dies: [], dieIdx: {}, t: [], pc: [], dc: [], die: [], current: [], voltage: [], temp: [], vib: [] }); }
    function append(rows, gapSec) {
      gapSec = gapSec || 30;
      var added = 0, touched = {};
      rows.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (r) {
        var b = get(r.press), n = b.t.length, last = n ? b.t[n - 1] : -Infinity;
        if (r.t === last) { stat.dup++; return; }
        if (r.t < last) { stat.old++; return; }
        if (n && r.t - last > gapSec) stat.gaps.push({ press: r.press, from: last, to: r.t, sec: r.t - last });
        if (r.type) b.type = r.type;
        var di = b.dieIdx[r.die]; if (di == null) { di = b.dieIdx[r.die] = b.dies.length; b.dies.push(r.die); }
        b.t.push(r.t); b.pc.push(r.pc); b.dc.push(r.dc); b.die.push(di);
        CH.forEach(function (c) { b[c].push(r[c]); });
        added++; touched[r.press] = 1;
        if (!(r.t <= stat.lastT)) stat.lastT = r.t;
      });
      if (stat.gaps.length > 200) stat.gaps = stat.gaps.slice(-200);
      Object.keys(touched).forEach(function (p) { trim(data[p]); });
      stat.rows += added;
      return { added: added, presses: Object.keys(touched) };
    }
    function trim(b) {
      var n = b.t.length; if (!n) return;
      var cut = b.t[n - 1] - keepSec, k = 0;
      while (k < n && b.t[k] < cut) k++;
      if (k > 600 || k > n / 4) ['t', 'pc', 'dc', 'die'].concat(CH).forEach(function (x) { b[x].splice(0, k); });
    }
    /* 프레스 하나 → spc.js 시계열(타입 배열) */
    function series(p) {
      var b = data[p]; if (!b || !b.t.length) return null;
      var n = b.t.length, s = { press: p, type: b.type, dies: b.dies.slice(), n: n, t: Float64Array.from(b.t), pc: Float64Array.from(b.pc), dc: Float64Array.from(b.dc), die: Uint16Array.from(b.die), live: true };
      CH.forEach(function (c) { s[c] = Float32Array.from(b[c]); });
      return s;
    }
    return {
      append: append, series: series,
      presses: function () { return Object.keys(data).filter(function (p) { return data[p].t.length; }).sort(L ? L.natCmp : undefined); },
      count: function () { return Object.keys(data).reduce(function (a, p) { return a + data[p].t.length; }, 0); },
      lastTime: function (p) { if (p) { var b = data[p]; return b && b.t.length ? b.t[b.t.length - 1] : NaN; } return stat.lastT; },
      stat: stat,
      clear: function () { data = {}; stat.rows = 0; stat.dup = 0; stat.old = 0; stat.gaps = []; stat.lastT = NaN; }
    };
  }

  /* ── 받는 길(시뮬레이터 · HTTP 주소 · WebSocket) ────────────────
     handlers: onRows(rows, info) · onStatus({ state, msg }) — state: 'connecting' | 'live' | 'error' | 'stopped'
     setTimeout·fetch·WebSocket 을 전역에서 가져오므로 node(18+)에서도 같은 코드로 시험할 수 있습니다 */
  function isLocalUrl(url) {
    var m = /^\w+:\/\/(\[[^\]]+\]|[^/:?#]+)/.exec(String(url || '')), host = m ? m[1].toLowerCase() : '';
    return /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.local$/.test(host);
  }
  function fillUrl(url, since) {
    var s = isFinite(since) ? P.stampText(since) : '';
    if (/\{since\}/.test(url)) return url.replace(/\{since\}/g, encodeURIComponent(s));
    return url;
  }
  function createSource(kind, cfg, handlers) {
    cfg = cfg || {}; handlers = handlers || {};
    var timer = null, ws = null, running = false, sim = null, clock = NaN, seq = 0;
    var onRows = handlers.onRows || function () {}, onStatus = handlers.onStatus || function () {};
    var info = { kind: kind, requests: 0, okCount: 0, errors: 0, lastOk: NaN, lastErr: '', bytes: 0 };
    function status(state, msg) { info.state = state; onStatus({ state: state, msg: msg || '' }); }
    function later(fn, ms) { timer = setTimeout(fn, ms); }
    function startSim() {
      sim = V.createSimulator({ presses: cfg.presses, warm: cfg.warm !== false, seed: cfg.seed });
      var speed = Math.max(1, Number(cfg.speed) || 1), now = cfg.startAt != null ? cfg.startAt : V.wallNow();
      clock = Math.floor(now / 2) * 2;
      if (cfg.prefillMin > 0) { // 앞 N분을 한꺼번에 채워 관리선을 바로 잡을 수 있게
        var rows = [], from = clock - cfg.prefillMin * 60;
        for (var t = from; t < clock; t += 2) sim.tick(t).forEach(function (r) { rows.push(r); });
        onRows(rows, { prefill: true });
      }
      status('live', '시뮬레이터 — 2초마다 ' + sim.presses.length + '대' + (speed > 1 ? ' (' + speed + '배 빠르게)' : ''));
      (function tick() {
        if (!running) return;
        var r = sim.tick(clock); clock += 2; info.okCount++; info.lastOk = Date.now();
        onRows(r, {});
        later(tick, 2000 / speed);
      })();
    }
    function startPoll() {
      var every = Math.max(1, Number(cfg.intervalSec) || 2) * 1000;
      status('connecting', cfg.url);
      (function poll() {
        if (!running) return;
        var url = fillUrl(cfg.url, handlers.since ? handlers.since() : NaN), t0 = Date.now(), my = ++seq;
        info.requests++;
        var ctl = G.AbortController ? new G.AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, Math.max(5000, every * 2));
        G.fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: ctl ? ctl.signal : undefined })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var ct = res.headers.get('content-type') || '';
            return res.text().then(function (txt) { return { txt: txt, ct: ct }; });
          })
          .then(function (x) {
            clearTimeout(to);
            if (!running || my !== seq) return;
            info.bytes += x.txt.length;
            var p = parsePayload(x.txt, x.ct);
            if (p.error) throw new Error(p.error);
            info.okCount++; info.lastOk = Date.now(); info.lastMs = Date.now() - t0;
            status('live', p.rows.length + '행 받음 · ' + p.format.toUpperCase() + ' · ' + info.lastMs + 'ms');
            onRows(p.rows, { bad: p.bad, format: p.format });
          })
          .catch(function (e) {
            clearTimeout(to);
            if (!running) return;
            info.errors++;
            var msg = e && e.name === 'AbortError' ? '응답 없음(시간 초과)' : (e && e.message) || String(e);
            if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
              msg += ' — 주소·서버 실행·CORS(Access-Control-Allow-Origin) 설정을 확인해 주세요';
              // 공개 https 페이지 → 내 PC·사내망 주소: 브라우저가 「로컬 네트워크 접근」 허락을 따로 받습니다(Chrome 등)
              if (G.location && G.location.protocol === 'https:' && isLocalUrl(cfg.url)) msg += '. 공개 페이지에서 내 PC·사내망 주소로 받으려면 브라우저의 「로컬 네트워크 접근」을 허용해야 합니다(주소창 왼쪽 아이콘 → 사이트 설정). 가장 확실한 길은 중계 서버 주소(예: http://localhost:8787/)로 이 페이지를 여는 것입니다';
            }
            info.lastErr = msg; status('error', msg);
          })
          .then(function () { if (running && my === seq) later(poll, Math.max(0, every - (Date.now() - t0))); });
      })();
    }
    function startWs() {
      status('connecting', cfg.url);
      try { ws = new G.WebSocket(cfg.url); } catch (e) { info.lastErr = e.message; status('error', e.message); return; }
      ws.onopen = function () { status('live', 'WebSocket 연결됨'); };
      ws.onmessage = function (m) {
        var txt = typeof m.data === 'string' ? m.data : '';
        if (!txt) return;
        info.bytes += txt.length;
        var p = parsePayload(txt, '');
        if (p.error) { info.errors++; info.lastErr = p.error; status('error', p.error); return; }
        info.okCount++; info.lastOk = Date.now();
        if (info.state !== 'live') status('live', 'WebSocket 수신 중');
        onRows(p.rows, { bad: p.bad, format: p.format });
      };
      ws.onerror = function () { info.errors++; info.lastErr = 'WebSocket 오류 — 주소·서버 실행을 확인해 주세요'; status('error', info.lastErr); };
      ws.onclose = function () { ws = null; if (running) { status('error', '연결이 끊김 — 5초 뒤 다시 붙음'); later(startWs, 5000); } };
    }
    return {
      info: info,
      start: function () {
        if (running) return; running = true;
        if (kind === 'sim') startSim(); else if (kind === 'poll') startPoll(); else if (kind === 'ws') startWs();
        else { running = false; status('error', '알 수 없는 방식'); }
      },
      stop: function () { running = false; seq++; clearTimeout(timer); timer = null; if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* 이미 닫힘 */ } ws = null; } status('stopped', '멈춤'); },
      running: function () { return running; },
      inject: function (press, faultKind) { return sim ? sim.inject(press, faultKind, clock) : false; },
      clock: function () { return clock; }
    };
  }

  return { CH: CH, isLocalUrl: isLocalUrl, keyMap: keyMap, toSec: toSec, normalize: normalize, csvToObjects: csvToObjects, parsePayload: parsePayload, createBuffer: createBuffer, fillUrl: fillUrl, createSource: createSource };
});
