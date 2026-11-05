/* 가상 더미 데이터 세트(3차) — 프레스 3대 × 5일 2초 로그 + 고장·정비·금형 교체 이력 + 실시간 시뮬레이터
   값은 전부 지어낸 것입니다(수강생 결정 10-27: 실제 로그·고장 이력 대신 「가상의 더미 data」).
   브라우저에서는 window.PressVirtual, node 에서는 require('./virtual-data.js') — tools/relay.mjs 도 이 모델을 씁니다.

   프레스 모델(createModel) — 2초마다 한 행:
     · 온도: 가동 중에는 안정 온도로 오르고(시간 상수 15분, 예열), 멈추거나 기록이 끊긴 동안은 주변 온도(24℃)로 식음(시간 상수 90분)
       → 아침 첫 가동은 24℃ 부근에서, 점심 뒤에는 35℃ 부근에서 다시 올라감
     · 전류·진동: 천천히 흔들리는 잡음(앞뒤 값이 비슷 — 받은 로그처럼) + 2초마다 잡음, 차가울 때 조금 높음
     · 타수: 10초에 1타(프레스 누적 타수·금형 타수), 정지 중에는 오르지 않음, 금형을 바꾸면 금형 타수 0
   일부러 심어 둔 고장 징후(SCRIPT):
     ① P1 주축 베어링 — 10/21 13:00 부터 진동이 서서히(끝으로 갈수록 빠르게) 오르고, 10/22 오전부터 전류가 가끔 튐 → 10/22 14:20 고장
     ② P2 오일쿨러 막힘 — 10/21 13:30 부터 온도가 안정 온도 위로 계속 오름(넘침) → 10/21 16:10 과열 정지
     ③ P3 금형 균열 — 10/23 08:30 부터 전류·진동이 짧게 튀는 일이 잦아짐 → 10/23 11:10 고장, 11:40 금형 M-06 → M-09
   그 밖: P3 10/20 13:00 계획 금형 교체(M-05 → M-06), 정비 기록 3건. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PressVirtual = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) { var u = 0; for (var i = 0; i < 6; i++) u += rnd(); return Math.max(-3.5, Math.min(3.5, (u - 3) / Math.sqrt(0.5))); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 벽시계 초(spc.js 와 같은 방식 — Date.UTC 로 시간대 바꿈 없이) */
  function sec(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) / 1000;
  }
  function stamp(t) {
    var d = new Date(t * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }
  /* 이 PC 의 지금 시각 → 벽시계 초 */
  function wallNow(ms) { ms = ms == null ? Date.now() : ms; return Math.floor(ms / 1000 - new Date(ms).getTimezoneOffset() * 60); }

  var HEAD = ['일자', '프레스', '프레스 종류', '금형명', '프레스 누적 타수', '금형 타수', '전류(A)', '전압(V)', '온도(℃)', '진동(mm/s)', '데이터 구분'];
  var LABEL = '가상 더미';
  var AMB = 24, CYCLE = 10, TAU_HEAT = 900, TAU_COOL = 5400, GAP = 30;
  var PRESSES = [
    { id: 'P1', type: '유압 프레스 800톤', die: 'M-01', cur: 86, volt: 381, temp: 45, vib: 2.0, pc0: 1890000, dc0: 12000 },
    { id: 'P2', type: '유압 프레스 800톤', die: 'M-03', cur: 92, volt: 380.5, temp: 47, vib: 2.25, pc0: 2264000, dc0: 41000 },
    { id: 'P3', type: '기계식 프레스 400톤', die: 'M-05', cur: 58, volt: 380, temp: 42, vib: 3.0, pc0: 5221000, dc0: 118000 }
  ];
  var DAYS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  var SESSIONS = [[8 * 3600, 12 * 3600], [13 * 3600, 17 * 3600]];

  /* 고장·정비·금형 교체 이력(가상) — kind: 고장 · 정비 · 금형 교체 */
  var EVENTS = [
    { at: '2026-10-20 13:00:00', press: 'P3', kind: '금형 교체', part: '금형 M-05 → M-06', note: '계획 교체(수명 기준 도달)', downMin: 0 },
    { at: '2026-10-21 16:10:00', press: 'P2', kind: '고장', part: '유압유 과열 정지', note: '오일쿨러 막힘 — 유온 높음 알람으로 정지', downMin: 50 },
    { at: '2026-10-22 07:30:00', press: 'P2', kind: '정비', part: '오일쿨러 청소 · 냉각팬 교체', note: '과열 정지 후속 조치', downMin: 0 },
    { at: '2026-10-22 07:30:00', press: 'P3', kind: '정비', part: '정기 점검(유압 필터 교체)', note: '계획 정비', downMin: 0 },
    { at: '2026-10-22 14:20:00', press: 'P1', kind: '고장', part: '주축 베어링 손상', note: '이음·진동 커져 정지, 당일 생산 중단', downMin: 160 },
    { at: '2026-10-23 07:40:00', press: 'P1', kind: '정비', part: '주축 베어링 교체', note: '고장 후속 조치', downMin: 0 },
    { at: '2026-10-23 11:10:00', press: 'P3', kind: '고장', part: '금형 M-06 균열', note: '제품 버(burr) 발생으로 발견, 생산 중지', downMin: 30 },
    { at: '2026-10-23 11:40:00', press: 'P3', kind: '금형 교체', part: '금형 M-06 → M-09', note: '균열 금형 교체(고장 교체)', downMin: 0 }
  ];
  function events() { return EVENTS.map(function (e, i) { var o = {}; for (var k in e) o[k] = e[k]; o.id = 'v' + (i + 1); o.virtual = true; return o; }); }

  /* ── 프레스 모델 ──────────────────────────────────────── */
  function createModel(cfg, seed, opt) {
    opt = opt || {};
    var rnd = mulberry32(seed);
    function g() { return gauss(rnd); }
    var st = { T: opt.warm ? cfg.temp : AMB, last: null, lastStroke: null, pc: cfg.pc0, dc: cfg.dc0, die: cfg.die, ar: { cur: 0, vib: 0, temp: 0, volt: 0 } };
    function step(t, f) {
      f = f || {};
      var dt = st.last == null ? 2 : t - st.last;
      if (!(dt > 0)) dt = 2;
      if (dt > GAP) { st.T = AMB + (st.T - AMB) * Math.exp(-(dt - 2) / TAU_COOL); st.lastStroke = t; dt = 2; }
      var running = !f.stop;
      var target = running ? cfg.temp + (f.dayTemp || 0) + (f.tempAdd || 0) : AMB;
      st.T += (target - st.T) * (1 - Math.exp(-dt / (running ? TAU_HEAT : TAU_COOL)));
      if (f.die && f.die !== st.die) { st.die = f.die; st.dc = 0; }
      if (st.lastStroke == null) st.lastStroke = t;
      else if (running && t - st.lastStroke >= CYCLE) { st.pc++; st.dc++; st.lastStroke = t; }
      var ar = st.ar;
      ar.cur = 0.995 * ar.cur + 0.0999 * 0.25 * g();
      ar.vib = 0.99 * ar.vib + 0.141 * 0.015 * g();
      ar.temp = 0.998 * ar.temp + 0.0632 * 0.1 * g();
      ar.volt = 0.99 * ar.volt + 0.141 * 0.1 * g();
      var cold = Math.max(0, Math.min(1, (cfg.temp - st.T) / (cfg.temp - AMB)));
      var cur = cfg.cur + (f.dayCur || 0) + ar.cur + 0.6 * g() + 0.8 * cold + (f.curAdd || 0);
      var vib = cfg.vib + ar.vib + 0.035 * g() + 0.03 * cold + (f.vibAdd || 0);
      var volt = cfg.volt + ar.volt + 0.35 * g() + (f.voltAdd || 0);
      var temp = st.T + ar.temp + 0.06 * g();
      if (!running) { cur = cfg.cur * 0.32 + 0.3 * g(); vib = 0.35 + 0.03 * g(); }
      else { if (f.curSpike) cur += f.curSpike; if (f.vibSpike) vib += f.vibSpike; }
      st.last = t;
      return { t: t, press: cfg.id, type: cfg.type, die: st.die, pc: st.pc, dc: st.dc, current: cur, voltage: volt, temp: temp, vib: vib, running: running };
    }
    return { step: step, state: st, cfg: cfg };
  }
  /* 행 → 받은 로그와 같은 글자 칸(11열) */
  function cells(r, label) {
    return [stamp(r.t), r.press, r.type, r.die, String(r.pc), String(r.dc), r.current.toFixed(2), r.voltage.toFixed(2), r.temp.toFixed(2), r.vib.toFixed(3), label || LABEL];
  }
  /* 행 → 실시간 연결 JSON 한 행(docs 의 표본 형식) */
  function toJson(r) {
    return { time: stamp(r.t), press: r.press, pressType: r.type, die: r.die, pressCum: r.pc, dieCum: r.dc,
      current: +r.current.toFixed(2), voltage: +r.voltage.toFixed(2), temp: +r.temp.toFixed(2), vib: +r.vib.toFixed(3) };
  }

  /* ── 심어 둔 고장 징후 ─────────────────────────────────── */
  var T0 = sec(DAYS[0] + ' 00:00:00');
  /* 가동 시각(세션 안) 누적 초 — 밤·점심을 건너뛴 「가동 시간」 */
  function opSec(t) {
    var d = Math.floor((t - T0) / 86400), s = t - T0 - d * 86400, o = d * 8 * 3600;
    SESSIONS.forEach(function (ss) { o += Math.max(0, Math.min(s, ss[1]) - ss[0]); });
    return o;
  }
  function prog(t, a, b) { var A = opSec(sec(a)), B = opSec(sec(b)); return Math.max(0, Math.min(1, (opSec(t) - A) / (B - A))); }
  var S = {
    p1A: sec('2026-10-21 13:00:00'), p1F: sec('2026-10-22 14:20:00'), p1R: sec('2026-10-22 17:00:00'),
    p2A: sec('2026-10-21 13:30:00'), p2F: sec('2026-10-21 16:10:00'), p2R: sec('2026-10-21 17:00:00'),
    p3D: sec('2026-10-20 13:00:00'), p3A: sec('2026-10-23 08:30:00'), p3F: sec('2026-10-23 11:10:00'), p3R: sec('2026-10-23 11:40:00')
  };
  function script(id, t, spk, day) {
    var f = { dayTemp: day.temp, dayCur: day.cur };
    if (id === 'P1') {
      if (t >= S.p1A && t < S.p1F) {
        var u = prog(t, '2026-10-21 13:00:00', '2026-10-22 14:20:00');
        f.vibAdd = 0.1 * u + 1.3 * Math.pow(u, 4);
        f.curAdd = 1.2 * u;
        if (u > 0.55 && spk() < 0.004 + 0.05 * Math.pow((u - 0.55) / 0.45, 2)) f.curSpike = 7 + 3 * spk();
      }
      if (t >= S.p1F && t < S.p1R) f.stop = true;
    } else if (id === 'P2') {
      if (t >= S.p2A && t < S.p2F) { var v = (t - S.p2A) / (S.p2F - S.p2A); f.tempAdd = 11 * Math.pow(v, 1.3); f.curAdd = 1.0 * v; }
      if (t >= S.p2F && t < S.p2R) f.stop = true;
    } else if (id === 'P3') {
      f.die = t >= S.p3R ? 'M-09' : t >= S.p3D ? 'M-06' : 'M-05';
      if (t >= S.p3A && t < S.p3F) {
        var w = (t - S.p3A) / (S.p3F - S.p3A);
        if (spk() < 0.002 + 0.06 * w * w) { f.curSpike = 10 + 4 * spk(); f.vibSpike = 0.5 + 0.3 * spk(); }
      }
      if (t >= S.p3F && t < S.p3R) f.stop = true;
    }
    return f;
  }
  /* 가상 데이터 세트 전체 — onRow(글자 칸 배열). 돌려주는 값은 행 수 (3대 × 5일 × 8시간 = 216,000행) */
  function build(onRow, opts) {
    opts = opts || {};
    var presses = opts.presses || PRESSES.map(function (p) { return p.id; }), n = 0;
    PRESSES.filter(function (p) { return presses.indexOf(p.id) >= 0; }).forEach(function (p, pi) {
      var m = createModel(p, 20261027 + pi * 131), spk = mulberry32(777 + pi * 17), dr = mulberry32(4242 + pi * 7);
      DAYS.forEach(function (d) {
        var day = { temp: 0.4 * gauss(dr) * 0.6, cur: 0.5 * gauss(dr) * 0.6 };
        var base = sec(d + ' 00:00:00');
        SESSIONS.forEach(function (ss) {
          for (var s = ss[0]; s < ss[1]; s += 2) {
            var t = base + s, r = m.step(t, script(p.id, t, spk, day));
            n++;
            onRow(opts.json ? toJson(r) : cells(r), r);
          }
        });
      });
    });
    return n;
  }

  /* ── 실시간 시뮬레이터 ─────────────────────────────────────
     프레스마다 모델 하나, tick(t) 마다 프레스 수만큼 행. inject(press, kind) 로 고장 징후를 넣어 경보가 뜨는지 볼 수 있습니다.
     kind: vib(진동 서서히 오름, 10분) · spike(전류 튐, 5분) · heat(온도 넘침, 10분) · stop(정지 3분) · die(금형 교체) */
  var FAULTS = {
    vib: { label: '진동 서서히 오름', sec: 600 },
    spike: { label: '전류 튐', sec: 300 },
    heat: { label: '온도 넘침(과열)', sec: 600 },
    stop: { label: '정지 3분', sec: 180 },
    die: { label: '금형 교체', sec: 2 }
  };
  function createSimulator(opts) {
    opts = opts || {};
    var ids = opts.presses || PRESSES.map(function (p) { return p.id; });
    var cfgs = PRESSES.filter(function (p) { return ids.indexOf(p.id) >= 0; });
    var models = {}, faults = {}, spk = mulberry32(opts.seed || 99), dieNo = {};
    cfgs.forEach(function (c, i) { models[c.id] = createModel(c, (opts.seed || 5150) + i * 37, { warm: opts.warm !== false }); dieNo[c.id] = 10 + i * 10; });
    function cond(id, t) {
      var f = {}, x = faults[id];
      if (!x) return f;
      var u = (t - x.at) / FAULTS[x.kind].sec;
      if (u > 1) { if (x.kind !== 'heat' && x.kind !== 'vib') { delete faults[id]; return f; } u = 1; }
      if (x.kind === 'vib') f.vibAdd = 1.5 * Math.pow(u, 1.5);
      else if (x.kind === 'spike') { if (spk() < 0.12) f.curSpike = 9 + 4 * spk(); }
      else if (x.kind === 'heat') f.tempAdd = 15 * u; // 10분 동안 안정 온도보다 15℃ 높은 쪽으로(온도는 15분 시간 상수로 따라 오름)
      else if (x.kind === 'stop') f.stop = true;
      else if (x.kind === 'die') { dieNo[id]++; f.die = 'M-' + dieNo[id]; delete faults[id]; }
      return f;
    }
    return {
      presses: cfgs.map(function (c) { return c.id; }),
      tick: function (t) { return cfgs.map(function (c) { return models[c.id].step(t, cond(c.id, t)); }); },
      inject: function (id, kind, t) { if (!models[id] || !FAULTS[kind]) return false; faults[id] = { kind: kind, at: t }; return true; },
      clear: function (id) { if (id) delete faults[id]; else faults = {}; },
      faults: function () { return faults; }
    };
  }

  return { HEAD: HEAD, LABEL: LABEL, PRESSES: PRESSES, DAYS: DAYS, SESSIONS: SESSIONS, EVENTS: EVENTS, FAULTS: FAULTS, AMB: AMB,
    events: events, createModel: createModel, createSimulator: createSimulator, build: build, cells: cells, toJson: toJson, sec: sec, stamp: stamp, wallNow: wallNow, opSec: opSec };
});
