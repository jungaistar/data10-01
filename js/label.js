/* v2.1 — 머신러닝 · 라벨링 (2026-11-10 요청: 전압 · 전류 · 진동 · 온도 데이터에 정비 · 고장 이력으로 정상 / 이상 라벨 붙이기)
   브라우저에서는 window.PressLabel, node 에서는 require('./label.js') (spc.js 를 씀). 화면은 js/app.js 의 pageMl.

   ① 정비 · 고장 이력(maintenance_log) — log_id · equipment_id · found_at · fixed_at · symptom · failure_part · cause · action
      (한글 머리행: 정비 번호 · 설비 · 발견 일시 · 조치 일시 · 증상 · 고장 부위 · 원인 · 조치)
   ② 라벨 규칙 — 설비가 같고 시각이
        [발견 일시 − 고장 전 구간(preH, 기본 24시간), 조치 일시]      → 이상(고장 전 · 고장 중)
        (조치 일시, 조치 일시 + 안정 구간(postH, 기본 2시간)]        → 제외(불확실)
        그 밖                                                        → 정상
      고장 전 구간 기본 24시간은 「고장 전 이탈」(pdm.js lookbackH = 24)과 같은 정의입니다.
      두 이력의 구간이 겹치면 이상이 제외보다 우선합니다. 사람이 고른 수동 라벨은 규칙 라벨보다 우선합니다(나중에 넣은 것이 이김).
   ③ 라벨 분포 · 특징 요약(라벨별 평균 · 표준편차) · 학습용 CSV
   ④ 기준선 모델 — 1분 칸 평균으로 묶고, 정상 칸 절반(번갈아)으로 채널별 평균 · 표준편차를 잡아
      나머지 정상 칸 + 이상 칸 전부를 「채널 z 점수의 최댓값 > k 이면 이상」으로 판정해 혼동행렬을 셉니다(순수 JS). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./spc.js'));
  else root.PressLabel = factory(root.PressSPC);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  var NORMAL = 0, ABNORMAL = 1, EXCLUDE = 2;
  var LABELS = [{ id: NORMAL, key: 'normal', label: '정상' }, { id: ABNORMAL, key: 'abnormal', label: '이상' }, { id: EXCLUDE, key: 'exclude', label: '제외' }];
  var SRC_DEFAULT = 0, SRC_RULE = 1, SRC_MANUAL = 2; // 근거: 이력 밖(규칙상 정상) · 이력 규칙 · 수동
  var SRC_TEXT = ['규칙', '규칙', '수동'];
  var CHS = ['voltage', 'current', 'vib', 'temp']; // 요청 순서(전압 · 전류 · 진동 · 온도)
  var CH_LABEL = { voltage: '전압', current: '전류', vib: '진동', temp: '온도' };
  var CH_UNIT = { voltage: 'V', current: 'A', vib: 'mm/s', temp: '℃' };
  var DEFAULT_RULE = { preH: 24, postH: 2 };
  var DEFAULT_MODEL = { k: 3, binSec: 60 };

  /* ── ① 정비 · 고장 이력 ─────────────────────────────── */
  var MLOG_FIELDS = [
    { id: 'log_id', ko: '정비 번호', aliases: ['logid', 'log', '정비번호', '이력번호', '기록번호', '번호', 'id', 'no'] },
    { id: 'equipment_id', ko: '설비', aliases: ['equipmentid', 'equipment', '설비', '설비번호', '설비id', '설비코드', '설비명', '프레스', '호기', 'press'] },
    { id: 'found_at', ko: '발견 일시', aliases: ['foundat', 'found', '발견일시', '발견시각', '발견', '발생일시', '고장일시', '발생시각'] },
    { id: 'fixed_at', ko: '조치 일시', aliases: ['fixedat', 'fixed', '조치일시', '조치시각', '조치완료일시', '완료일시', '복구일시', '수리완료일시'] },
    { id: 'symptom', ko: '증상', aliases: ['symptom', '증상', '고장증상', '현상'] },
    { id: 'failure_part', ko: '고장 부위', aliases: ['failurepart', 'part', '고장부위', '부위', '고장부품'] },
    { id: 'cause', ko: '원인', aliases: ['cause', '원인', '고장원인'] },
    { id: 'action', ko: '조치', aliases: ['action', '조치', '조치내용', '조치사항'] }
  ];
  var MLOG_HEAD = MLOG_FIELDS.map(function (f) { return f.id + ' (' + f.ko + ')'; });
  function normHead(x) { return String(x == null ? '' : x).replace(/\([^)]*\)/g, '').replace(/[\s_\-·.]/g, '').toLowerCase(); }
  function eqKey(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/[\s_\-]/g, ''); }
  function stampOf(v) { return typeof v === 'number' && v > 1e8 ? v : P.parseStamp(v); }
  function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }

  /* 한 줄 정리 — 설비 · 발견 일시가 없으면 null. 조치 일시가 없거나 발견보다 앞이면 발견 일시로(noFix 표시) */
  function cleanLog(o, i) {
    if (!o || typeof o !== 'object') return null;
    var eq = txt(o.equipment_id, 60), f = stampOf(o.found_at), x = stampOf(o.fixed_at);
    if (!eq || !isFinite(f)) return null;
    var noFix = !isFinite(x) || x < f;
    return { log_id: txt(o.log_id, 40) || '', equipment_id: eq, found_at: P.stampText(f), fixed_at: P.stampText(noFix ? f : x), noFix: noFix,
      symptom: txt(o.symptom), failure_part: txt(o.failure_part), cause: txt(o.cause), action: txt(o.action), virtual: !!o.virtual, _i: i };
  }
  /* 빈 정비 번호에 M-0001 꼴로 다음 번호, 겹치는 번호에는 「-2」 */
  function fillIds(list) {
    var used = {}, max = 0;
    list.forEach(function (l) { var m = /^M-(\d+)$/.exec(l.log_id); if (m) max = Math.max(max, +m[1]); });
    list.forEach(function (l) {
      if (!l.log_id) { max++; l.log_id = 'M-' + ('000' + max).slice(-4); }
      var id = l.log_id, k = 2; while (used[id]) id = l.log_id + '-' + (k++);
      l.log_id = id; used[id] = 1; delete l._i;
    });
    return list;
  }
  function cleanLogs(arr) { return fillIds((Array.isArray(arr) ? arr : []).map(cleanLog).filter(Boolean)); }
  /* 엑셀 · CSV 표 → 이력 (영문 칸 이름 · 한글 별칭 모두, 머리행은 앞 10줄 안에서) */
  function logsFromAoa(aoa) {
    var hr = -1, map = {};
    for (var r = 0; r < Math.min((aoa || []).length, 10) && hr < 0; r++) {
      var m = {};
      (aoa[r] || []).forEach(function (c, i) {
        var k = normHead(c); if (!k) return;
        MLOG_FIELDS.forEach(function (f) { if (m[f.id] == null && (k === normHead(f.id) || f.aliases.indexOf(k) >= 0)) m[f.id] = i; });
      });
      if (m.equipment_id != null && m.found_at != null) { hr = r; map = m; }
    }
    if (hr < 0) return { logs: [], skipped: 0, error: '머리행(equipment_id · found_at 또는 설비 · 발견 일시)을 찾지 못했습니다.' };
    var out = [], skipped = 0;
    for (var k = hr + 1; k < aoa.length; k++) {
      var w = aoa[k]; if (!w || w.every(function (c) { return c == null || c === ''; })) continue;
      var o = {}; MLOG_FIELDS.forEach(function (f) { if (map[f.id] != null) o[f.id] = w[map[f.id]]; });
      var l = cleanLog(o, k); if (l) out.push(l); else skipped++;
    }
    return { logs: out, skipped: skipped, map: map };
  }
  function logsToAoa(list) {
    var a = [MLOG_HEAD.slice()];
    (list || []).forEach(function (l) { a.push(MLOG_FIELDS.map(function (f) { return l[f.id]; })); });
    return a;
  }
  /* 가져온 이력을 이미 있는 이력에 합치기 — 같은 정비 번호는 새 값으로 */
  function mergeLogs(old, add) {
    var by = {}, order = [];
    (old || []).concat(add || []).forEach(function (l) { if (!by[l.log_id]) order.push(l.log_id); by[l.log_id] = l; });
    return order.map(function (id) { return by[id]; });
  }
  /* 「고장 전 이탈」 화면의 고장 이력(pdm.js 이벤트) → 정비 · 고장 이력 (조치 일시 = 고장 + 정지 분) */
  function logsFromEvents(events) {
    return (events || []).filter(function (e) { return e && e.kind === '고장'; }).map(function (e, i) {
      var t = stampOf(e.at);
      return cleanLog({ log_id: 'E-' + ('000' + (i + 1)).slice(-4), equipment_id: e.press, found_at: t, fixed_at: t + (Number(e.downMin) || 0) * 60,
        symptom: e.part, failure_part: '', cause: '', action: e.note, virtual: e.virtual }, i);
    }).filter(Boolean);
  }

  /* ── ② 라벨 ─────────────────────────────────────────── */
  function cleanRule(p) {
    var o = { preH: DEFAULT_RULE.preH, postH: DEFAULT_RULE.postH };
    if (!p || typeof p !== 'object') return o;
    var a = Number(p.preH), b = Number(p.postH);
    if (p.preH !== '' && p.preH != null && isFinite(a) && a >= 0 && a <= 720) o.preH = a;
    if (p.postH !== '' && p.postH != null && isFinite(b) && b >= 0 && b <= 168) o.postH = b;
    return o;
  }
  function cleanModel(p) {
    var o = { k: DEFAULT_MODEL.k, binSec: DEFAULT_MODEL.binSec };
    if (!p || typeof p !== 'object') return o;
    var k = Number(p.k), b = Number(p.binSec);
    if (p.k != null && p.k !== '' && isFinite(k) && k >= 0.5 && k <= 20) o.k = k;
    if ([10, 30, 60, 300].indexOf(b) >= 0) o.binSec = b;
    return o;
  }
  /* 수동 라벨 한 건 { id, press, from, to, label(0·1·2), note } */
  function cleanManual(o, i) {
    if (!o || typeof o !== 'object' || !o.press) return null;
    var a = stampOf(o.from), b = stampOf(o.to), lab = Number(o.label);
    if (!isFinite(a) || !isFinite(b) || [0, 1, 2].indexOf(lab) < 0) return null;
    if (b < a) { var x = a; a = b; b = x; }
    return { id: txt(o.id, 40) || 'h' + Date.now().toString(36) + (i || 0), press: txt(o.press, 60), from: P.stampText(a), to: P.stampText(b), label: lab, note: txt(o.note, 200) };
  }
  /* 저장 자료(db.ml) 정리 — 옛 자료(칸 없음)는 기본값 */
  function cleanState(o) {
    o = o && typeof o === 'object' ? o : {};
    return { logs: cleanLogs(o.logs), rule: cleanRule(o.rule), model: cleanModel(o.model),
      manual: (Array.isArray(o.manual) ? o.manual : []).map(cleanManual).filter(Boolean) };
  }
  function lowerBound(t, x, n) { var lo = 0, hi = n; while (lo < hi) { var mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; } return lo; }
  function upperBound(t, x, n) { var lo = 0, hi = n; while (lo < hi) { var mid = (lo + hi) >> 1; if (t[mid] <= x) lo = mid + 1; else hi = mid; } return lo; }
  /* 설비 하나의 규칙 구간 — [{from, to, lab, log, open}] (open: 시작 시각 쪽이 열린 구간 = 조치 뒤 안정 구간) */
  function intervalsFor(press, logs, rule) {
    var R = cleanRule(rule), key = eqKey(press), out = [];
    (logs || []).forEach(function (l) {
      if (eqKey(l.equipment_id) !== key) return;
      var f = stampOf(l.found_at), x = stampOf(l.fixed_at); if (!isFinite(f)) return; if (!isFinite(x) || x < f) x = f;
      out.push({ from: f - R.preH * 3600, to: x, lab: ABNORMAL, log: l.log_id });
      if (R.postH > 0) out.push({ from: x, to: x + R.postH * 3600, lab: EXCLUDE, log: l.log_id, open: true });
    });
    return out;
  }
  /* 시계열 s(spc.js 형식: t · n · 채널) 에 라벨 — { lab, src, ref(refs 번호, 없으면 -1), refs } */
  function labelSeries(s, logs, rule, manual) {
    var n = s && s.n || 0, lab = new Uint8Array(n), src = new Uint8Array(n), ref = new Int16Array(n), refs = [];
    ref.fill(-1);
    if (!n) return { lab: lab, src: src, ref: ref, refs: refs, press: s && s.press };
    function fill(i0, i1, L, S, R) { for (var i = i0; i < i1; i++) { lab[i] = L; src[i] = S; ref[i] = R; } }
    function refNo(id) { var k = refs.indexOf(id); if (k < 0) { refs.push(id); k = refs.length - 1; } return k; }
    var iv = intervalsFor(s.press, logs, rule);
    // 제외 먼저, 이상을 나중에 — 겹치면 이상이 이김
    iv.filter(function (x) { return x.lab === EXCLUDE; }).forEach(function (x) { fill(upperBound(s.t, x.from, n), upperBound(s.t, x.to, n), EXCLUDE, SRC_RULE, refNo(x.log)); });
    iv.filter(function (x) { return x.lab === ABNORMAL; }).forEach(function (x) { fill(lowerBound(s.t, x.from, n), upperBound(s.t, x.to, n), ABNORMAL, SRC_RULE, refNo(x.log)); });
    (manual || []).forEach(function (m) {
      if (eqKey(m.press) !== eqKey(s.press)) return;
      var a = stampOf(m.from), b = stampOf(m.to); if (!isFinite(a) || !isFinite(b)) return;
      fill(lowerBound(s.t, a, n), upperBound(s.t, b, n), m.label, SRC_MANUAL, refNo(m.id));
    });
    return { lab: lab, src: src, ref: ref, refs: refs, press: s.press };
  }
  /* 같은 라벨 · 근거가 이어진 구간 — 기록 틈(gapSec 넘음)에서도 끊음 */
  function segments(s, res, gapSec) {
    gapSec = gapSec || 30;
    var out = [], cur = null;
    for (var i = 0; i < (s ? s.n : 0); i++) {
      var L = res.lab[i], S = res.src[i], R = res.ref[i];
      if (cur && cur.lab === L && cur.src === S && cur.ref === R && s.t[i] - s.t[i - 1] <= gapSec) { cur.to = s.t[i]; cur.n++; continue; }
      cur = { from: s.t[i], to: s.t[i], lab: L, src: S, ref: R, id: R >= 0 ? res.refs[R] : '', n: 1 };
      out.push(cur);
    }
    return out;
  }
  /* 라벨 분포 — { n:[정상, 이상, 제외], manual:[…], total } */
  function counts(res) {
    var c = { n: [0, 0, 0], manual: [0, 0, 0], total: res ? res.lab.length : 0 };
    for (var i = 0; i < c.total; i++) { c.n[res.lab[i]]++; if (res.src[i] === SRC_MANUAL) c.manual[res.lab[i]]++; }
    return c;
  }
  /* 특징 요약 — 라벨별 · 채널별 { n, mean, std } (표본 표준편차, 빈 값은 건너뜀). 여러 설비를 합치려면 list 로 */
  function featureStats(list) {
    var acc = [0, 1, 2].map(function () { var o = {}; CHS.forEach(function (c) { o[c] = { n: 0, mean: 0, m2: 0 }; }); return o; });
    (list || []).forEach(function (x) {
      var s = x.s, res = x.res;
      for (var i = 0; i < s.n; i++) {
        var a = acc[res.lab[i]];
        for (var j = 0; j < CHS.length; j++) {
          var v = s[CHS[j]] ? s[CHS[j]][i] : NaN; if (v == null || isNaN(v)) continue;
          var w = a[CHS[j]]; w.n++; var d = v - w.mean; w.mean += d / w.n; w.m2 += d * (v - w.mean);
        }
      }
    });
    return acc.map(function (a) {
      var o = {}; CHS.forEach(function (c) { var w = a[c]; o[c] = { n: w.n, mean: w.n ? w.mean : null, std: w.n > 1 ? Math.sqrt(w.m2 / (w.n - 1)) : null }; });
      return o;
    });
  }

  /* ── ③ 학습용 데이터셋 CSV ──────────────────────────── */
  var CSV_HEAD = ['time', 'equipment_id', 'voltage', 'current', 'vibration', 'temperature', 'label', 'label_name', 'label_source', 'log_id'];
  function num(v, d) { return v == null || isNaN(v) ? '' : (+v).toFixed(d); }
  function csvCell(c) { c = String(c == null ? '' : c); return /[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }
  /* list: [{s, res}] → 글자 조각 배열(5,000행씩, Blob 에 그대로). opts.dropExclude 면 제외 행을 뺌 */
  function datasetCsv(list, opts) {
    opts = opts || {};
    var parts = ['﻿' + CSV_HEAD.join(',') + '\r\n'], buf = [], rows = 0;
    (list || []).forEach(function (x) {
      var s = x.s, res = x.res;
      for (var i = 0; i < s.n; i++) {
        var L = res.lab[i]; if (opts.dropExclude && L === EXCLUDE) continue;
        buf.push([P.stampText(s.t[i]), csvCell(s.press), num(s.voltage[i], 2), num(s.current[i], 2), num(s.vib[i], 3), num(s.temp[i], 2),
          L, LABELS[L].key, res.src[i] === SRC_MANUAL ? 'manual' : 'rule', res.ref[i] >= 0 ? csvCell(res.refs[res.ref[i]]) : ''].join(','));
        rows++;
        if (buf.length >= 5000) { parts.push(buf.join('\r\n') + '\r\n'); buf = []; }
      }
    });
    if (buf.length) parts.push(buf.join('\r\n') + '\r\n');
    return { parts: parts, rows: rows };
  }

  /* ── ④ 기준선 모델(z 점수) ─────────────────────────── */
  /* binSec 칸으로 묶기 — 칸마다 채널 평균과 라벨(가장 많은 라벨, 같으면 이상 > 제외 > 정상) */
  function bins(s, res, binSec) {
    binSec = binSec || 60;
    var out = [], cur = null;
    for (var i = 0; i < s.n; i++) {
      var b = Math.floor(s.t[i] / binSec);
      if (!cur || cur.b !== b) { cur = { b: b, t: b * binSec, c: [0, 0, 0], sum: {}, cnt: {}, press: s.press }; CHS.forEach(function (ch) { cur.sum[ch] = 0; cur.cnt[ch] = 0; }); out.push(cur); }
      cur.c[res.lab[i]]++;
      for (var j = 0; j < CHS.length; j++) { var v = s[CHS[j]][i]; if (!isNaN(v)) { cur.sum[CHS[j]] += v; cur.cnt[CHS[j]]++; } }
    }
    return out.map(function (x) {
      var m = {}; CHS.forEach(function (ch) { m[ch] = x.cnt[ch] ? x.sum[ch] / x.cnt[ch] : NaN; });
      var lab = x.c[ABNORMAL] >= x.c[EXCLUDE] && x.c[ABNORMAL] >= x.c[NORMAL] && x.c[ABNORMAL] > 0 ? ABNORMAL : x.c[EXCLUDE] >= x.c[NORMAL] && x.c[EXCLUDE] > 0 ? EXCLUDE : NORMAL;
      return { t: x.t, press: x.press, lab: lab, v: m, n: x.c[0] + x.c[1] + x.c[2] };
    });
  }
  /* 정상 칸으로 채널별 평균 · 표준편차 */
  function fitNormal(list) {
    var o = {};
    CHS.forEach(function (ch) {
      var n = 0, mean = 0, m2 = 0;
      list.forEach(function (b) { var v = b.v[ch]; if (isNaN(v)) return; n++; var d = v - mean; mean += d / n; m2 += d * (v - mean); });
      o[ch] = n > 1 ? { mean: mean, std: Math.sqrt(m2 / (n - 1)), n: n } : null;
    });
    return o;
  }
  function score(b, fit) {
    var best = NaN, ch = '';
    CHS.forEach(function (c) { var f = fit[c], v = b.v[c]; if (!f || !(f.std > 0) || isNaN(v)) return; var z = Math.abs(v - f.mean) / f.std; if (!(z <= best)) { best = z; ch = c; } });
    return { z: best, ch: ch };
  }
  function confusion(items, k) {
    var m = { tp: 0, fn: 0, fp: 0, tn: 0 };
    items.forEach(function (x) { if (isNaN(x.z)) return; var pred = x.z > k; if (x.lab === ABNORMAL) { if (pred) m.tp++; else m.fn++; } else if (pred) m.fp++; else m.tn++; });
    var n = m.tp + m.fn + m.fp + m.tn;
    m.n = n; m.accuracy = n ? (m.tp + m.tn) / n : null;
    m.precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : null; m.recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : null;
    m.specificity = m.tn + m.fp ? m.tn / (m.tn + m.fp) : null;
    return m;
  }
  /* list: [{s, res}] — 설비마다 따로 기준을 잡습니다(설비마다 평소 값이 다름).
     정상 칸을 시간순으로 번갈아 학습(짝수 번째) · 시험(홀수 번째)으로 나누고, 이상 칸은 전부 시험에(학습에 안 씀). 제외 칸은 쓰지 않음 */
  function zModel(list, opts) {
    var M = cleanModel(opts), test = [], per = {}, trainN = 0;
    (list || []).forEach(function (x) {
      var bs = bins(x.s, x.res, M.binSec), normal = bs.filter(function (b) { return b.lab === NORMAL; });
      var train = normal.filter(function (b, i) { return i % 2 === 0; });
      var fit = fitNormal(train);
      per[x.s.press] = { fit: fit, train: train.length, normal: normal.length, abnormal: bs.filter(function (b) { return b.lab === ABNORMAL; }).length };
      trainN += train.length;
      normal.forEach(function (b, i) { if (i % 2 === 1) { var sc = score(b, fit); test.push({ press: b.press, t: b.t, lab: NORMAL, z: sc.z, ch: sc.ch }); } });
      bs.forEach(function (b) { if (b.lab !== ABNORMAL) return; var sc = score(b, fit); test.push({ press: b.press, t: b.t, lab: ABNORMAL, z: sc.z, ch: sc.ch }); });
    });
    var sweep = [2, 3, 4, 5, 6].map(function (k) { var c = confusion(test, k); c.k = k; return c; });
    return { opts: M, per: per, train: trainN, test: test.length, testAbnormal: test.filter(function (x) { return x.lab === ABNORMAL; }).length,
      matrix: confusion(test, M.k), sweep: sweep, items: test };
  }

  /* 그림용 — 구간 [i0, i1) 의 채널 값을 칸 nb 개로(평균 · 최소 · 최대) */
  function labelBands(segs, from, to) {
    return segs.filter(function (g) { return g.to >= from && g.from <= to && (g.lab !== NORMAL || g.src === SRC_MANUAL); })
      .map(function (g) { return { from: g.from, to: g.to, cls: 'lband-' + LABELS[g.lab].key + (g.src === SRC_MANUAL ? ' lband-manual' : ''), title: LABELS[g.lab].label + ' · ' + SRC_TEXT[g.src] + (g.id ? ' ' + g.id : '') }; });
  }

  return { NORMAL: NORMAL, ABNORMAL: ABNORMAL, EXCLUDE: EXCLUDE, LABELS: LABELS, SRC_DEFAULT: SRC_DEFAULT, SRC_RULE: SRC_RULE, SRC_MANUAL: SRC_MANUAL, SRC_TEXT: SRC_TEXT,
    CHS: CHS, CH_LABEL: CH_LABEL, CH_UNIT: CH_UNIT, DEFAULT_RULE: DEFAULT_RULE, DEFAULT_MODEL: DEFAULT_MODEL, MLOG_FIELDS: MLOG_FIELDS, MLOG_HEAD: MLOG_HEAD, CSV_HEAD: CSV_HEAD,
    eqKey: eqKey, cleanLog: cleanLog, cleanLogs: cleanLogs, fillIds: fillIds, logsFromAoa: logsFromAoa, logsToAoa: logsToAoa, mergeLogs: mergeLogs, logsFromEvents: logsFromEvents,
    cleanRule: cleanRule, cleanModel: cleanModel, cleanManual: cleanManual, cleanState: cleanState, intervalsFor: intervalsFor, labelSeries: labelSeries, segments: segments,
    counts: counts, featureStats: featureStats, datasetCsv: datasetCsv, bins: bins, fitNormal: fitNormal, score: score, confusion: confusion, zModel: zModel, labelBands: labelBands };
});
