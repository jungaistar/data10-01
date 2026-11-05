/* 3차 반영 — 온도 3구간 관리선 · 경보(이탈이 이어질 때) · 고장 전 이탈 맞춰 보기(리드타임)
   브라우저에서는 window.PressPdM, node 에서는 require('./pdm.js') (spc.js 를 씀). 기준 문서: docs/01_프로젝트_기획서.md 12장

   ① 온도 — 프레스는 돌수록 온도가 오르므로 ±3σ 대신 「예열 · 안정 생산 · 위험」 3구간으로 나눕니다.
      경계 두 개(예열 끝 온도 warmTop, 위험 시작 온도 dangerAt)를 프레스마다 둡니다. 기본값은 데이터로 잡습니다:
        안정 기준 온도 = 기록이 이어진 구간(30분 이상)의 뒤쪽 절반 값(정지 제외)의 중앙값, σs = 그 값들의 MAD × 1.4826
        예열 끝 = 안정 기준 − max(3σs, 2℃) · 위험 시작 = 안정 기준 + max(4σs, 3℃)  (0.5℃ 단위로 반올림, 설정에서 바꿈)
      위험 구간에 holdSec(기본 30초) 넘게 머물면 경보. 예열 시간 = 기록이 다시 시작된 때부터 예열 끝 온도에 처음 닿을 때까지.
   ② 경보 — 2초 값은 정상이어도 우연히 ±3σ 를 넘으므로(약 370개에 1개), 「winSec(10분) 안에 이탈점 minCount(5)개 이상」일 때 경보로 봅니다.
      예열 구간(온도 < 예열 끝)에서 난 이탈은 기본으로 뺍니다(차가울 때 전류·진동이 평소와 달라 아침마다 경보가 나므로).
   ③ 리드타임 — 고장 이력마다 그 앞 lookbackH(24시간, 같은 프레스의 앞선 고장·정비 뒤부터) 안에 처음 울린 경보를 찾아
      「몇 시간 · 몇 타 먼저」를 셉니다. 어느 고장 앞에도 들지 않은 경보는 헛경보 후보로 따로 셉니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./spc.js'));
  else root.PressPdM = factory(root.PressSPC);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  var ZONES = [{ id: 'warm', label: '예열' }, { id: 'stable', label: '안정 생산' }, { id: 'danger', label: '위험' }];
  var DEFAULT_RULE = { winSec: 600, minCount: 5, groupSec: 0, lookbackH: 24, holdSec: 30, excludeWarm: true, channels: { current: true, voltage: true, vib: true, temp: true } };
  var SIGMA_CH = ['current', 'voltage', 'vib']; // ±3σ 로 보는 채널(온도는 3구간)
  var DANGER_BIT = 16;

  function median(a) { if (!a.length) return NaN; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function round05(v) { return Math.round(v * 2) / 2; }

  function cleanRule(p) {
    var o = JSON.parse(JSON.stringify(DEFAULT_RULE));
    if (!p || typeof p !== 'object') return o;
    function n(k, min, max) { var v = Number(p[k]); if (p[k] != null && p[k] !== '' && isFinite(v) && v >= min && v <= max) o[k] = v; }
    n('winSec', 10, 86400); n('minCount', 1, 10000); n('lookbackH', 1, 24 * 60); n('holdSec', 0, 86400);
    if (p.groupSec === 0 || p.groupSec === 60 || p.groupSec === 300 || p.groupSec === '0' || p.groupSec === '60' || p.groupSec === '300') o.groupSec = Number(p.groupSec);
    if (p.excludeWarm === false) o.excludeWarm = false;
    if (p.channels && typeof p.channels === 'object') Object.keys(o.channels).forEach(function (k) { if (p.channels[k] != null) o.channels[k] = !!p.channels[k]; });
    return o;
  }

  /* 기록이 이어진 구간 — 기록 간격이 gapSec 를 넘으면 끊음 */
  function runsOf(s, i0, i1, gapSec) {
    var out = [], a = i0;
    for (var i = i0 + 1; i <= i1; i++) {
      if (i === i1 || s.t[i] - s.t[i - 1] > gapSec) { if (i > a) out.push({ i0: a, i1: i }); a = i; }
    }
    return out;
  }

  /* ── ① 온도 3구간 ───────────────────────────────────────── */
  function deriveZones(s, info, opts) {
    var O = P.cleanOpts(opts), vals = [], basis = 'steady';
    if (!s || !s.n) return null;
    var runs = runsOf(s, 0, s.n, O.gapSec);
    runs.forEach(function (r) {
      var len = s.t[r.i1 - 1] - s.t[r.i0];
      if (len < 1800) return;
      var half = s.t[r.i0] + len / 2;
      for (var i = r.i0; i < r.i1; i++) {
        if (s.t[i] < half) continue;
        if (info && info.counted && info.stopped[i]) continue;
        var v = s.temp[i]; if (!isNaN(v)) vals.push(v);
      }
    });
    if (vals.length < 50) { // 30분 넘게 이어진 기록이 없으면 — 있는 값 전부로 임시
      basis = 'short'; vals = [];
      for (var k = 0; k < s.n; k++) { if (info && info.counted && info.stopped[k]) continue; var x = s.temp[k]; if (!isNaN(x)) vals.push(x); }
      if (vals.length < 10) return null;
    }
    var med = median(vals), mad = median(vals.map(function (v) { return Math.abs(v - med); })) * 1.4826;
    var sig = Math.max(mad, 0.05);
    return { stable: med, sigma: sig, warmTop: round05(med - Math.max(3 * sig, 2)), dangerAt: round05(med + Math.max(4 * sig, 3)), n: vals.length, basis: basis, auto: true };
  }
  /* 저장된 기준(설정에서 고친 값)과 데이터로 잡은 기본값 합치기 */
  function zoneCfg(saved, derived, rule) {
    var R = cleanRule(rule), z = null;
    if (derived) z = { stable: derived.stable, sigma: derived.sigma, warmTop: derived.warmTop, dangerAt: derived.dangerAt, n: derived.n, basis: derived.basis, auto: true };
    if (saved && isFinite(saved.warmTop) && isFinite(saved.dangerAt) && saved.dangerAt > saved.warmTop) {
      z = z || {};
      z.warmTop = +saved.warmTop; z.dangerAt = +saved.dangerAt; z.auto = false;
    }
    if (!z) return null;
    z.holdSec = saved && isFinite(saved.holdSec) && saved.holdSec >= 0 ? +saved.holdSec : R.holdSec;
    return z;
  }
  function classify(v, z) { return isNaN(v) || !z ? -1 : v > z.dangerAt ? 2 : v < z.warmTop ? 0 : 1; }
  /* 구간 [i0,i1) — 구간별 머문 시간, 예열 시간(기록이 다시 시작될 때마다), 위험 구간(경보), 그래프용 표시(위험 점 = 16) */
  function zoneWindow(s, info, z, i0, i1, opts) {
    var O = P.cleanOpts(opts), out = { sec: [0, 0, 0], total: 0, flags: new Uint8Array(Math.max(0, i1 - i0)), dangers: [], warmups: [], last: null, z: z };
    if (!z || !(i1 > i0)) return out;
    var cur = null;
    for (var i = i0; i < i1; i++) {
      var v = s.temp[i], c = classify(v, z), t = s.t[i];
      if (c < 0) continue;
      if (i > i0) { var dt = t - s.t[i - 1]; if (dt <= O.gapSec) { out.sec[c] += dt; out.total += dt; } }
      if (c === 2) {
        out.flags[i - i0] = DANGER_BIT;
        if (cur && t - cur.to <= O.gapSec) { cur.to = t; cur.n++; if (v > cur.peak) cur.peak = v; }
        else { cur = { from: t, to: t, n: 1, peak: v }; out.dangers.push(cur); }
      } else cur = null;
      out.last = { t: t, v: v, zone: c };
    }
    out.dangers.forEach(function (d) { d.sec = d.to - d.from; d.alarm = d.sec >= z.holdSec; d.trigger = d.from + z.holdSec; });
    runsOf(s, i0, i1, O.gapSec).forEach(function (r) {
      var start = s.t[r.i0], len = s.t[r.i1 - 1] - start;
      if (len < 60) return;
      var t0 = NaN; for (var a = r.i0; a < r.i1 && a < r.i0 + 15; a++) if (!isNaN(s.temp[a])) { t0 = s.temp[a]; break; }
      if (!isFinite(t0)) return;
      if (t0 >= z.warmTop) { out.warmups.push({ from: start, startTemp: t0, already: true, sec: 0 }); return; }
      for (var k = r.i0; k < r.i1; k++) if (s.temp[k] >= z.warmTop) { out.warmups.push({ from: start, to: s.t[k], startTemp: t0, sec: s.t[k] - start, reached: true }); return; }
      out.warmups.push({ from: start, startTemp: t0, sec: len, reached: false, open: r.i1 === i1 });
    });
    var w = out.warmups.filter(function (x) { return x.reached; }).map(function (x) { return x.sec; });
    out.warmAvg = w.length ? w.reduce(function (a, b) { return a + b; }, 0) / w.length : null;
    out.warmMax = w.length ? Math.max.apply(null, w) : null;
    out.share = out.total ? out.sec.map(function (x) { return x / out.total; }) : [null, null, null];
    return out;
  }

  /* ── ② 경보: winSec 안에 이탈점 minCount 개 이상 ───────────── */
  function alarmEpisodes(t, values, flags, base, lim, R, mask) {
    R = cleanRule(R); mask = mask || 0xff;
    var q = [], eps = [], cur = null;
    for (var i = 0; i < flags.length; i++) {
      if (!(flags[i] & mask)) continue;
      var tt = t[base + i];
      q.push(tt); while (q.length && q[0] <= tt - R.winSec) q.shift();
      var x = values[i], z = lim ? (x - lim.center) / lim.sigma : NaN;
      if (cur && tt - cur.to <= R.winSec) { cur.to = tt; cur.n++; if (Math.abs(z) > Math.abs(cur.z)) { cur.z = z; cur.peak = x; } continue; }
      if (q.length >= R.minCount) { cur = { from: q[0], trigger: tt, to: tt, n: q.length, z: z, peak: x }; eps.push(cur); }
      else cur = null;
    }
    eps.forEach(function (e) { e.side = e.z > 0 ? 'up' : 'down'; });
    return eps;
  }
  /* 예열 구간(온도 < 예열 끝)에서 난 이탈은 지움 — 차가울 때는 전류·진동이 평소와 달라 아침마다 경보가 나므로(설정에서 끌 수 있음).
     flags 를 그 자리에서 고치고 지운 점 수를 돌려줍니다 */
  function maskWarm(s, z, cs, flags, i0) {
    if (!z) return 0;
    var n = 0;
    for (var i = 0; i < flags.length; i++) {
      if (!flags[i]) continue;
      var t = cs.t[i0 + i], lo = 0, hi = s.n;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (s.t[mid] < t) lo = mid + 1; else hi = mid; }
      if (lo < s.n && classify(s.temp[lo], z) === 0) { flags[i] = 0; n++; }
    }
    return n;
  }
  /* 프레스 하나의 경보 전부 — ±3σ 채널(경보 규칙) + 온도 위험 구간(holdSec 넘게) */
  function pressAlarms(s, info, opts, z, R, view) {
    R = cleanRule(R); view = view || {};
    var out = [];
    SIGMA_CH.forEach(function (ch) {
      if (!R.channels[ch]) return;
      var has = false; for (var i = 0; i < s.n; i += Math.max(1, Math.floor(s.n / 200))) if (!isNaN(s[ch][i])) { has = true; break; }
      if (!has) return;
      var d = P.chartData(s, info, ch, opts, { groupSec: R.groupSec, dieIdx: -1, exclude: view.exclude, lim: view.lims ? view.lims[ch] : undefined });
      if (!d.lim) return;
      if (R.excludeWarm && z) maskWarm(s, z, d.cs, d.flags, d.i0);
      alarmEpisodes(d.cs.t, d.values, d.flags, d.i0, d.lim, R, 1).forEach(function (e) { e.ch = ch; e.press = s.press; e.lim = d.lim; out.push(e); });
    });
    if (R.channels.temp && z) {
      zoneWindow(s, info, z, 0, s.n, opts).dangers.forEach(function (d) {
        if (!d.alarm) return;
        out.push({ ch: 'temp', press: s.press, from: d.from, trigger: d.trigger, to: d.to, n: d.n, peak: d.peak, side: 'up', zone: true });
      });
    }
    return out.sort(function (a, b) { return a.trigger - b.trigger; });
  }

  /* ── ③ 고장 전 이탈 맞춰 보기 ────────────────────────────── */
  function evTime(e) { return typeof e.at === 'number' ? e.at : P.parseStamp(e.at); }
  /* 고장마다 살펴볼 구간 [from, at) — 앞 lookbackH, 같은 프레스의 앞선 고장·정비가 있으면 그 뒤부터 */
  function failureWindows(events, R) {
    R = cleanRule(R);
    var list = (events || []).map(function (e) { return { e: e, t: evTime(e) }; }).filter(function (x) { return isFinite(x.t) && x.e.press; })
      .sort(function (a, b) { return a.t - b.t; });
    return list.filter(function (x) { return x.e.kind === '고장'; }).map(function (f) {
      var prev = list.filter(function (x) { return x.e.press === f.e.press && x.t < f.t && (x.e.kind === '고장' || x.e.kind === '정비'); }).pop();
      var from = f.t - R.lookbackH * 3600;
      if (prev && prev.t > from) from = prev.t;
      return { ev: f.e, at: f.t, from: from, press: f.e.press, after: f.t + Math.max(0, Number(f.e.downMin) || 0) * 60 };
    });
  }
  function strokesBetween(s, info, a, b) {
    if (!info || !info.counted) return null;
    var r = P.rangeIdx(s, a, b), n = 0;
    for (var i = r[0]; i < r[1]; i++) if (info.inc[i] > 0) n += info.inc[i];
    return n;
  }
  /* input: { series:{press:s}, infos:{press:info}, events:[], opts(관리도 기준), zones:{press:z}, rule, excludePre(고장 전 구간을 기준에서 뺌) } */
  function leadAnalysis(input) {
    var R = cleanRule(input.rule), series = input.series || {}, infos = input.infos || {};
    var wins = failureWindows(input.events, R).filter(function (w) { return series[w.press]; });
    var alarms = [];
    Object.keys(series).forEach(function (p) {
      var s = series[p], info = infos[p] || P.strokeInfo(s, input.opts);
      var ex = input.excludePre ? wins.filter(function (w) { return w.press === p; }).map(function (w) { return [w.from, w.after]; }) : null;
      pressAlarms(s, info, input.opts, (input.zones || {})[p], R, { exclude: ex }).forEach(function (a) { alarms.push(a); });
    });
    alarms.forEach(function (a) {
      a.cls = 'false';
      wins.forEach(function (w) {
        if (a.press !== w.press) return;
        if (a.trigger >= w.from && a.trigger < w.at) { a.cls = 'pre'; a.failure = w; }
        else if (a.cls !== 'pre' && a.trigger >= w.at && a.trigger <= w.after + 600) a.cls = 'during';
      });
    });
    var fails = wins.map(function (w) {
      var s = series[w.press], info = infos[w.press] || P.strokeInfo(s, input.opts);
      var mine = alarms.filter(function (a) { return a.failure === w; });
      var by = {};
      mine.forEach(function (a) { if (!by[a.ch]) by[a.ch] = a; });
      var first = mine[0] || null;
      Object.keys(by).forEach(function (ch) { var a = by[ch]; by[ch] = { alarm: a, lead: w.at - a.trigger, strokes: strokesBetween(s, info, a.trigger, w.at) }; });
      var covered = s.n && s.t[0] <= w.from + 3600 && s.t[s.n - 1] >= w.at - 600;
      return { ev: w.ev, press: w.press, at: w.at, from: w.from, alarms: mine, first: first, byChannel: by, covered: covered,
        lead: first ? w.at - first.trigger : null, strokes: first ? strokesBetween(s, info, first.trigger, w.at) : null };
    });
    var leads = fails.filter(function (f) { return f.lead != null; }).map(function (f) { return f.lead; });
    var strokes = fails.filter(function (f) { return f.strokes != null && f.lead != null; }).map(function (f) { return f.strokes; });
    var perCh = {};
    ['current', 'voltage', 'temp', 'vib'].forEach(function (ch) {
      var ls = fails.map(function (f) { return f.byChannel[ch] ? f.byChannel[ch].lead : null; }).filter(function (x) { return x != null; });
      perCh[ch] = { detected: ls.length, leadMedian: ls.length ? median(ls) : null, falseCount: alarms.filter(function (a) { return a.ch === ch && a.cls === 'false'; }).length };
    });
    return {
      rule: R, failures: fails, alarms: alarms, perChannel: perCh,
      stats: { failures: fails.length, detected: leads.length, leadMedian: leads.length ? median(leads) : null, leadMin: leads.length ? Math.min.apply(null, leads) : null,
        leadMax: leads.length ? Math.max.apply(null, leads) : null, strokesMedian: strokes.length ? median(strokes) : null,
        falseAlarms: alarms.filter(function (a) { return a.cls === 'false'; }).length, preAlarms: alarms.filter(function (a) { return a.cls === 'pre'; }).length }
    };
  }

  /* 이력 한 줄 정리(가져오기·직접 입력) — kind 는 고장·정비·금형 교체·오버홀 */
  var KINDS = ['고장', '정비', '금형 교체', '오버홀'];
  function cleanEvent(o, i) {
    if (!o || typeof o !== 'object') return null;
    var t = typeof o.at === 'number' ? o.at : P.parseStamp(o.at);
    if (!isFinite(t) || !o.press) return null;
    var kind = String(o.kind || '').trim();
    if (/고장|故障|breakdown|failure/i.test(kind)) kind = '고장';
    else if (/금형/.test(kind)) kind = '금형 교체';
    else if (/오버홀|overhaul/i.test(kind)) kind = '오버홀';
    else kind = '정비';
    return { id: o.id || 'e' + Date.now().toString(36) + (i || 0), at: P.stampText(t), press: String(o.press).trim(), kind: kind, part: String(o.part || '').slice(0, 200),
      note: String(o.note || '').slice(0, 300), downMin: isFinite(Number(o.downMin)) && Number(o.downMin) > 0 ? Number(o.downMin) : 0, virtual: !!o.virtual };
  }
  /* 엑셀·CSV 이력 표 → 이벤트 (머리행: 일시 · 프레스 · 구분 · 내용 · 메모 · 정지(분)) */
  var EVENT_HEAD = ['일시', '프레스', '구분', '내용', '메모', '정지(분)', '가상'];
  function eventsFromAoa(aoa) {
    var hr = -1, map = {};
    for (var r = 0; r < Math.min(aoa.length, 10) && hr < 0; r++) {
      var row = aoa[r] || [], m = {};
      row.forEach(function (c, i) {
        var x = String(c == null ? '' : c).replace(/\s/g, '');
        if (/^(일시|일자|날짜|발생일시|시각)/.test(x)) m.at = i;
        else if (/^(프레스|설비)/.test(x)) m.press = i;
        else if (/^(구분|종류|유형)/.test(x)) m.kind = i;
        else if (/^(내용|고장내용|부위|작업)/.test(x)) m.part = i;
        else if (/^(메모|비고|조치)/.test(x)) m.note = i;
        else if (/^정지/.test(x)) m.downMin = i;
        else if (/^가상/.test(x)) m.virtual = i;
      });
      if (m.at != null && m.press != null) { hr = r; map = m; }
    }
    if (hr < 0) return { events: [], error: '머리행(일시·프레스·구분)을 찾지 못했습니다.' };
    var out = [], skipped = 0;
    for (var k = hr + 1; k < aoa.length; k++) {
      var w = aoa[k]; if (!w || w.every(function (c) { return c == null || c === ''; })) continue;
      var e = cleanEvent({ at: w[map.at], press: w[map.press], kind: map.kind != null ? w[map.kind] : '', part: map.part != null ? w[map.part] : '', note: map.note != null ? w[map.note] : '', downMin: map.downMin != null ? w[map.downMin] : 0, virtual: map.virtual != null && /가상|virtual|true|1/i.test(String(w[map.virtual] == null ? '' : w[map.virtual])) }, k);
      if (e) out.push(e); else skipped++;
    }
    return { events: out, skipped: skipped };
  }
  function eventsToAoa(list) {
    var a = [EVENT_HEAD];
    (list || []).forEach(function (e) { a.push([e.at, e.press, e.kind, e.part, e.note, e.downMin || 0, e.virtual ? '가상' : '']); });
    return a;
  }

  return { ZONES: ZONES, DEFAULT_RULE: DEFAULT_RULE, SIGMA_CH: SIGMA_CH, DANGER_BIT: DANGER_BIT, KINDS: KINDS, EVENT_HEAD: EVENT_HEAD,
    median: median, cleanRule: cleanRule, runsOf: runsOf, deriveZones: deriveZones, zoneCfg: zoneCfg, classify: classify, zoneWindow: zoneWindow,
    alarmEpisodes: alarmEpisodes, maskWarm: maskWarm, pressAlarms: pressAlarms, failureWindows: failureWindows, strokesBetween: strokesBetween, leadAnalysis: leadAnalysis,
    cleanEvent: cleanEvent, eventsFromAoa: eventsFromAoa, eventsToAoa: eventsToAoa };
});
