/* 작은 SVG 그래프 — 외부 라이브러리 없이 막대(묶음)·꺾은선(data09-25 에서 옮겨 옴) + 센서 관리도(기준선·관리한계 띠).
   한 그래프에 y축은 하나(두 척도를 한 그래프에 섞지 않음). 막대·점에 마우스를 올리면 값이 보입니다(title).
   색은 CSS 변수(--series-1 …)를 씁니다. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function fmt(v, unit) {
    if (v == null) return '-';
    if (unit === '%') return (Math.round(v * 1000) / 10) + '%';
    return (Math.round(v * 10) / 10).toLocaleString('ko-KR') + (unit ? unit : '');
  }

  /* opts: { labels:[], series:[{name, values:[], color}], unit, type:'bar'|'line', height, title } */
  function chart(opts) {
    var W = 640, H = opts.height || 220, padL = 48, padR = 12, padT = 12, padB = 30;
    var n = opts.labels.length, unit = opts.unit || '';
    var all = [];
    opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); }); });
    var max = niceMax(Math.max.apply(null, all.concat([opts.minMax || 0])));
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.title || '' });
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function y(v) { return padT + plotH - (v / max) * plotH; }
    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = y(gv);
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, class: g === 0 ? 'axis' : 'grid' }));
      svg.appendChild(el('text', { x: padL - 6, y: gy + 4, 'text-anchor': 'end', class: 'tick' }, fmt(gv, unit === '%' ? '%' : '')));
    }
    var step = plotW / Math.max(n, 1);
    opts.labels.forEach(function (lb, i) {
      svg.appendChild(el('text', { x: padL + step * (i + 0.5), y: H - 10, 'text-anchor': 'middle', class: 'tick' }, lb));
    });
    if (!all.length) {
      svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick' }, '표시할 값이 없습니다'));
      return svg;
    }
    if (opts.type === 'line') {
      opts.series.forEach(function (s) {
        var d = '', pen = false;
        s.values.forEach(function (v, i) {
          if (v == null || !isFinite(v)) { pen = false; return; }
          d += (pen ? 'L' : 'M') + (padL + step * (i + 0.5)).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
          pen = true;
        });
        svg.appendChild(el('path', { d: d, class: 'ln', style: 'stroke:' + s.color }));
        s.values.forEach(function (v, i) {
          if (v == null || !isFinite(v)) return;
          var c = el('circle', { cx: padL + step * (i + 0.5), cy: y(v), r: 4.5, class: 'dot', style: 'fill:' + s.color });
          c.appendChild(el('title', null, opts.labels[i] + ' · ' + s.name + ' ' + fmt(v, unit)));
          svg.appendChild(c);
        });
      });
    } else {
      var k = opts.series.length, gap = 2, bw = Math.min(28, (step * 0.7 - gap * (k - 1)) / k);
      opts.labels.forEach(function (lb, i) {
        var x0 = padL + step * (i + 0.5) - (bw * k + gap * (k - 1)) / 2;
        opts.series.forEach(function (s, j) {
          var v = s.values[i];
          if (v == null || !isFinite(v)) return;
          var top = y(v), h = Math.max(0, padT + plotH - top), r = Math.min(4, bw / 2, h);
          var x = x0 + j * (bw + gap);
          // 위쪽 모서리만 둥글게(기준선 쪽은 각지게)
          var p = 'M' + x + ' ' + (top + h) + 'V' + (top + r) + 'Q' + x + ' ' + top + ' ' + (x + r) + ' ' + top +
            'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + top + ' ' + (x + bw) + ' ' + (top + r) + 'V' + (top + h) + 'Z';
          var b = el('path', { d: p, class: 'bar', style: 'fill:' + s.color });
          b.appendChild(el('title', null, lb + ' · ' + s.name + ' ' + fmt(v, unit)));
          svg.appendChild(b);
        });
      });
    }
    return svg;
  }
  /* 범례 — 계열이 둘 이상일 때만 */
  function legend(series) {
    var box = document.createElement('div'); box.className = 'legend';
    if (series.length < 2) return box;
    series.forEach(function (s) {
      var i = document.createElement('span'); i.className = 'lg';
      var sw = document.createElement('i'); sw.style.background = s.color; i.appendChild(sw);
      i.appendChild(document.createTextNode(s.name)); box.appendChild(i);
    });
    return box;
  }
  function figure(title, opts) {
    var f = document.createElement('figure'); f.className = 'fig';
    var cap = document.createElement('figcaption'); cap.textContent = title; f.appendChild(cap);
    opts.title = title;
    f.appendChild(legend(opts.series));
    f.appendChild(chart(opts));
    return f;
  }

  /* 센서 관리도 — 날짜 간격대로 점을 찍고, 기준선(중앙값)·주의 한계·관리한계를 가로선으로, 최근 구간을 옅은 띠로.
     opts: { points:[{date, v, z, zone}], base:{center, upper, lower, upperWarn, lowerWarn}|null, recentFrom, unit, k, kWarn, title, color } */
  function dayNo(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function sensorChart(opts) {
    var W = 640, H = 230, padL = 52, padR = 14, padT = 12, padB = 30;
    var pts = opts.points || [], unit = opts.unit || '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart sensor', role: 'img', 'aria-label': opts.title || '' });
    if (!pts.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick' }, '표시할 값이 없습니다')); return svg; }
    var b = opts.base;
    var vals = pts.map(function (p) { return p.v; });
    if (b) vals = vals.concat([b.upper, b.lower]);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || Math.abs(hi) * 0.1 || 1;
    lo -= span * 0.08; hi += span * 0.08;
    var x0 = dayNo(pts[0].date), x1 = dayNo(pts[pts.length - 1].date); if (x1 === x0) x1 = x0 + 1;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function X(iso) { return padL + (dayNo(iso) - x0) / (x1 - x0) * plotW; }
    function Y(v) { return padT + (hi - v) / (hi - lo) * plotH; }
    if (opts.recentFrom && dayNo(opts.recentFrom) <= x1) {
      var rx = Math.max(padL, X(opts.recentFrom) - 4);
      svg.appendChild(el('rect', { x: rx, y: padT, width: padL + plotW - rx, height: plotH, class: 'recent-zone' }));
      svg.appendChild(el('text', { x: padL + plotW - 4, y: padT + plotH - 6, 'text-anchor': 'end', class: 'tick' }, '최근 구간'));
    }
    for (var g = 0; g <= 4; g++) {
      var gv = lo + (hi - lo) * g / 4, gy = Y(gv);
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, class: g === 0 ? 'axis' : 'grid' }));
      svg.appendChild(el('text', { x: padL - 6, y: gy + 4, 'text-anchor': 'end', class: 'tick' }, fmt(gv)));
    }
    var nT = 6;
    for (var t = 0; t <= nT; t++) {
      var dn = x0 + (x1 - x0) * t / nT, d = new Date(Math.round(dn) * 86400000);
      svg.appendChild(el('text', { x: padL + plotW * t / nT, y: H - 10, 'text-anchor': t === 0 ? 'start' : t === nT ? 'end' : 'middle', class: 'tick' }, (d.getUTCMonth() + 1) + '/' + d.getUTCDate()));
    }
    if (b) {
      [['upper', 'lim'], ['lower', 'lim'], ['upperWarn', 'lim-warn'], ['lowerWarn', 'lim-warn'], ['center', 'center']].forEach(function (x) {
        var y = Y(b[x[0]]);
        var ln = el('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: x[1] });
        ln.appendChild(el('title', null, (x[0] === 'center' ? '기준선 ' : x[1] === 'lim' ? '관리한계 ' : '주의 한계 ') + fmt(b[x[0]]) + unit));
        svg.appendChild(ln);
      });
    }
    var dpath = '';
    pts.forEach(function (p, i) { dpath += (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' '; });
    svg.appendChild(el('path', { d: dpath, class: 'ln', style: 'stroke:' + (opts.color || 'var(--series-1)') }));
    pts.forEach(function (p) {
      var az = p.z == null || p.zone !== 'recent' ? 0 : Math.abs(p.z); // 색 표시는 최근 구간만(기준선 구간은 비교 대상)
      var cls = 'dot' + (opts.k && az >= opts.k ? ' dot-bad' : opts.kWarn && az >= opts.kWarn ? ' dot-warn' : '');
      var c = el('circle', { cx: X(p.date), cy: Y(p.v), r: az >= (opts.kWarn || 99) ? 4.5 : 3, class: cls, style: cls === 'dot' ? 'fill:' + (opts.color || 'var(--series-1)') : '' });
      c.appendChild(el('title', null, p.date + ' · ' + fmt(p.v) + unit + (p.z != null ? ' · z ' + (Math.round(p.z * 10) / 10) : '')));
      svg.appendChild(c);
    });
    return svg;
  }
  function sensorFigure(title, opts) {
    var f = document.createElement('figure'); f.className = 'fig';
    var cap = document.createElement('figcaption'); cap.textContent = title; f.appendChild(cap);
    opts.title = title;
    var lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = '<span class="lg"><i style="background:' + (opts.color || 'var(--series-1)') + '"></i>하루 평균</span>' +
      (opts.base ? '<span class="lg"><i class="sw-center"></i>기준선</span><span class="lg"><i class="sw-warn"></i>주의 한계</span><span class="lg"><i class="sw-lim"></i>관리한계</span>' : '') +
      '<span class="lg"><i class="sw-zone"></i>최근 구간</span>';
    f.appendChild(lg);
    f.appendChild(sensorChart(opts));
    return f;
  }

  /* 2초 로그 관리도(Shewhart) — 시각을 가로축으로, 중심선(CL)·±3σ 관리선(UCL/LCL)·±2σ 경고선, 기준 구간 띠, 이탈점 빨간 점.
     opts: { ds: PressSPC.downsample 결과, lim:{center,ucl,lcl,uwl,lwl}|null, base:{from,to}, from, to, warn, unit, color, title, gapSec } */
  function hm(sec, withDay) {
    var d = new Date(sec * 1000), t = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
    return withDay ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + t : t;
  }
  function stamp(sec) { var d = new Date(sec * 1000); return d.toISOString().slice(0, 19).replace('T', ' '); }
  function spcChart(opts) {
    var W = 720, H = 250, padL = 56, padR = 74, padT = 12, padB = 30;
    var ds = opts.ds, lim = opts.lim, unit = opts.unit || '', color = opts.color || 'var(--series-1)';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart spc', role: 'img', 'aria-label': opts.title || '' });
    var pts = ds.raw ? ds.points : ds.buckets;
    if (!pts.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick' }, '이 구간에 값이 없습니다')); return svg; }
    var x0 = isFinite(opts.from) ? opts.from : ds.t0, x1 = isFinite(opts.to) ? opts.to : ds.t1; if (x1 <= x0) x1 = x0 + 1;
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { var a = ds.raw ? p.v : p.min, b = ds.raw ? p.v : p.max; if (a < lo) lo = a; if (b > hi) hi = b; });
    ds.viol.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    if (lim) { lo = Math.min(lo, lim.lcl); hi = Math.max(hi, lim.ucl); }
    var zn = opts.zones; // 온도 3구간 { warmTop, dangerAt } (3차)
    if (zn) { lo = Math.min(lo, zn.warmTop - 1); hi = Math.max(hi, zn.dangerAt + 1); }
    var span = hi - lo || Math.abs(hi) * 0.1 || 1; lo -= span * 0.06; hi += span * 0.06;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function X(t) { return padL + (t - x0) / (x1 - x0) * plotW; }
    function Y(v) { return padT + (hi - v) / (hi - lo) * plotH; }
    var clip = 'c' + Math.random().toString(36).slice(2, 8);
    var defs = el('defs'); var cp = el('clipPath', { id: clip }); cp.appendChild(el('rect', { x: padL, y: padT, width: plotW, height: plotH })); defs.appendChild(cp); svg.appendChild(defs);
    if (zn) {
      var yD = Y(zn.dangerAt), yW = Y(zn.warmTop);
      [[padT, yD, 'zone-danger', '위험'], [yD, yW, 'zone-stable', '안정 생산'], [yW, padT + plotH, 'zone-warm', '예열']].forEach(function (b) {
        var y1 = Math.max(padT, Math.min(padT + plotH, b[0])), y2 = Math.max(padT, Math.min(padT + plotH, b[1]));
        if (y2 - y1 < 1) return;
        svg.appendChild(el('rect', { x: padL, y: y1, width: plotW, height: y2 - y1, class: 'zone ' + b[2] }));
        svg.appendChild(el('text', { x: padL + 6, y: Math.min(y2 - 4, y1 + 14), class: 'tick zone-label' }, b[3]));
      });
    }
    (opts.bands || []).forEach(function (b) { // v2.1 라벨 구간(이상 · 제외 · 수동) — 세로 띠
      if (!(b.to >= x0 && b.from <= x1)) return;
      var a = Math.max(padL, X(b.from)), c = Math.min(padL + plotW, X(b.to));
      var r = el('rect', { x: a, y: padT, width: Math.max(1.5, c - a), height: plotH, class: 'lband ' + (b.cls || '') });
      r.appendChild(el('title', null, stamp(b.from) + ' ~ ' + stamp(b.to) + ' ' + (b.title || '')));
      svg.appendChild(r);
    });
    if (opts.base && isFinite(opts.base.from) && opts.base.to >= x0 && opts.base.from <= x1 && !opts.noBase) {
      var bx = Math.max(padL, X(opts.base.from)), bx2 = Math.min(padL + plotW, X(opts.base.to));
      svg.appendChild(el('rect', { x: bx, y: padT, width: Math.max(2, bx2 - bx), height: plotH, class: 'base-zone' }));
      svg.appendChild(el('text', { x: bx + 4, y: padT + 14, class: 'tick' }, '기준 구간'));
    }
    for (var g = 0; g <= 4; g++) {
      var gv = lo + (hi - lo) * g / 4, gy = Y(gv);
      svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: gy, y2: gy, class: g === 0 ? 'axis' : 'grid' }));
      svg.appendChild(el('text', { x: padL - 6, y: gy + 4, 'text-anchor': 'end', class: 'tick' }, fmtV(gv, span)));
    }
    var withDay = Math.floor(x0 / 86400) !== Math.floor(x1 / 86400), nT = 5;
    for (var t = 0; t <= nT; t++) {
      var tv = x0 + (x1 - x0) * t / nT;
      svg.appendChild(el('text', { x: padL + plotW * t / nT, y: H - 10, 'text-anchor': t === 0 ? 'start' : t === nT ? 'end' : 'middle', class: 'tick' }, hm(tv, withDay)));
    }
    var gr = el('g', { 'clip-path': 'url(#' + clip + ')' });
    var gapSec = opts.gapSec || 30, d = '', pen = false, prevT = null;
    if (ds.raw) {
      pts.forEach(function (p) {
        if (prevT != null && p.t - prevT > gapSec) pen = false;
        d += (pen ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); pen = true; prevT = p.t;
      });
      gr.appendChild(el('path', { d: d, class: 'ln spc-ln', style: 'stroke:' + color }));
    } else {
      var w = (ds.t1 - ds.t0) / Math.max(1, ds.buckets.length), band = '';
      pts.forEach(function (b) { var x = X(b.t).toFixed(1); band += 'M' + x + ' ' + Y(b.max).toFixed(1) + 'V' + Y(b.min).toFixed(1); });
      gr.appendChild(el('path', { d: band, class: 'spc-band', style: 'stroke:' + color }));
      pts.forEach(function (b) {
        if (prevT != null && b.t - prevT > Math.max(gapSec, w * 3)) pen = false;
        d += (pen ? 'L' : 'M') + X(b.t).toFixed(1) + ' ' + Y(b.mean).toFixed(1); pen = true; prevT = b.t;
      });
      gr.appendChild(el('path', { d: d, class: 'ln spc-ln', style: 'stroke:' + color }));
    }
    svg.appendChild(gr);
    if (lim) {
      var lines = [['ucl', 'lim', 'UCL'], ['lcl', 'lim', 'LCL'], ['center', 'center', 'CL']];
      if (opts.warn) lines.push(['uwl', 'lim-warn', '+2σ'], ['lwl', 'lim-warn', '−2σ']);
      lines.forEach(function (x) {
        var y = Y(lim[x[0]]);
        var ln = el('line', { x1: padL, x2: padL + plotW, y1: y, y2: y, class: x[1] });
        ln.appendChild(el('title', null, x[2] + ' ' + fmtV(lim[x[0]], span) + unit));
        svg.appendChild(ln);
        if (x[1] !== 'lim-warn') svg.appendChild(el('text', { x: padL + plotW + 4, y: y + 4, class: 'tick lim-label' + (x[1] === 'lim' ? ' bad' : '') }, x[2] + ' ' + fmtV(lim[x[0]], span)));
      });
    }
    if (zn) [['dangerAt', '위험 ' + fmtV(zn.dangerAt, span)], ['warmTop', '예열 끝 ' + fmtV(zn.warmTop, span)]].forEach(function (x) {
      var y = Y(zn[x[0]]);
      svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y, y2: y, class: x[0] === 'dangerAt' ? 'lim' : 'zone-line' }));
      svg.appendChild(el('text', { x: padL + plotW + 4, y: y + 4, class: 'tick lim-label' + (x[0] === 'dangerAt' ? ' bad' : '') }, x[1]));
    });
    (opts.marks || []).forEach(function (m) { // 고장·정비·금형 교체 같은 이력 시각(세로선)
      if (!(m.t >= x0 && m.t <= x1)) return;
      var x = X(m.t), ln = el('line', { x1: x, x2: x, y1: padT, y2: padT + plotH, class: 'mark mark-' + (m.cls || 'ev') });
      ln.appendChild(el('title', null, stamp(m.t) + ' ' + (m.label || '')));
      svg.appendChild(ln);
      svg.appendChild(el('text', { x: Math.min(x + 3, padL + plotW - 4), y: padT + plotH - 6, class: 'tick mark-label', 'text-anchor': x + 3 > padL + plotW - 60 ? 'end' : 'start' }, m.short || m.label || ''));
    });
    ds.viol.forEach(function (p) {
      var c = el('circle', { cx: X(p.t), cy: Y(p.v), r: 3.5, class: 'dot-bad viol' });
      c.appendChild(el('title', null, stamp(p.t) + ' · ' + fmtV(p.v, span) + unit));
      svg.appendChild(c);
    });
    return svg;
  }
  function fmtV(v, span) {
    if (v == null || !isFinite(v)) return '-';
    var d = span < 0.5 ? 3 : span < 5 ? 2 : span < 50 ? 1 : 0;
    return Number(v.toFixed(d)).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function spcFigure(title, opts) {
    var f = document.createElement('figure'); f.className = 'fig';
    var cap = document.createElement('figcaption'); cap.textContent = title; f.appendChild(cap);
    opts.title = title;
    var lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = '<span class="lg"><i style="background:' + (opts.color || 'var(--series-1)') + '"></i>' + (opts.ds.raw ? '측정값' : '측정값(칸 평균 · 옅은 세로줄 = 칸 최소~최대)') + '</span>' +
      (opts.lim ? '<span class="lg"><i class="sw-center"></i>중심선</span><span class="lg"><i class="sw-lim"></i>±3σ 관리선</span>' + (opts.warn ? '<span class="lg"><i class="sw-warn"></i>±2σ 경고선</span>' : '') : '') +
      (opts.zones ? '<span class="lg"><i class="sw-zwarm"></i>예열</span><span class="lg"><i class="sw-zstable"></i>안정 생산</span><span class="lg"><i class="sw-zdanger"></i>위험</span>' : '') +
      (opts.noViol ? '' : '<span class="lg"><i class="sw-bad"></i>' + (opts.zones ? '위험 구간 점' : '이탈점') + '</span>') + (opts.noBase || opts.zones ? '' : '<span class="lg"><i class="sw-zone"></i>기준 구간</span>') +
      (opts.marks && opts.marks.length ? '<span class="lg"><i class="sw-mark"></i>고장·정비 이력</span>' : '') +
      (opts.bandLegend ? '<span class="lg"><i class="sw-labn"></i>이상</span><span class="lg"><i class="sw-lexc"></i>제외</span><span class="lg"><i class="sw-lman"></i>수동 라벨(테두리)</span>' : '');
    f.appendChild(lg);
    f.appendChild(spcChart(opts));
    return f;
  }
  /* 이력 맞춰 보기 — 프레스 한 대의 시간 줄(가동 시간만 이어 붙임: 밤·점심처럼 1시간 넘게 기록이 없는 때는 좁은 틈으로)
     opts: { segs:[[from,to],…] 기록이 있는 구간, lanes:[{label, items:[{from,to,cls,title}]}], events:[{t,kind,label}], windows:[{from,to}] 고장 전 살펴본 구간 } */
  function timeline(opts) {
    var W = 900, laneH = 26, padL = 64, padR = 12, padT = 22, gapW = 8;
    var lanes = opts.lanes || [], H = padT + (lanes.length + 1) * laneH + 26;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart timeline', role: 'img', 'aria-label': opts.title || '고장·정비 이력과 경보' });
    var segs = (opts.segs || []).filter(function (g) { return g[1] > g[0]; });
    if (!segs.length) { svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick' }, '기록이 없습니다')); return svg; }
    var total = segs.reduce(function (a, g) { return a + (g[1] - g[0]); }, 0), plotW = W - padL - padR - gapW * (segs.length - 1), k = plotW / total;
    var starts = [], x = padL;
    segs.forEach(function (g) { starts.push(x); x += (g[1] - g[0]) * k + gapW; });
    function X(t) {
      for (var i = 0; i < segs.length; i++) {
        if (t < segs[i][0]) return i ? starts[i] - gapW / 2 : padL;
        if (t <= segs[i][1]) return starts[i] + (t - segs[i][0]) * k;
      }
      return W - padR;
    }
    // 날짜 경계·틈
    var lastDay = '';
    segs.forEach(function (g, i) {
      var d = stamp(g[0]).slice(5, 10).replace('-', '/');
      if (i) svg.appendChild(el('line', { x1: starts[i] - gapW / 2, x2: starts[i] - gapW / 2, y1: padT - 4, y2: H - 22, class: 'tl-gap' }));
      if (d !== lastDay) { svg.appendChild(el('text', { x: starts[i] + 2, y: padT - 8, class: 'tick' }, d.replace(/^0/, '').replace('/0', '/'))); lastDay = d; }
    });
    (opts.windows || []).forEach(function (w) {
      var a = X(w.from), b = X(w.to);
      svg.appendChild(el('rect', { x: a, y: padT, width: Math.max(1, b - a), height: lanes.length * laneH, class: 'tl-window' }));
    });
    lanes.forEach(function (ln, i) {
      var y = padT + i * laneH;
      svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y + laneH, y2: y + laneH, class: 'grid' }));
      svg.appendChild(el('text', { x: padL - 6, y: y + laneH / 2 + 4, 'text-anchor': 'end', class: 'tick' }, ln.label));
      ln.items.forEach(function (it) {
        var a = X(it.from), b = X(it.to == null ? it.from : it.to);
        var r = el('rect', { x: a, y: y + 5, width: Math.max(3, b - a), height: laneH - 10, rx: 2, class: 'tl-item ' + (it.cls || '') });
        r.appendChild(el('title', null, it.title || ''));
        svg.appendChild(r);
      });
    });
    var ey = padT + lanes.length * laneH;
    svg.appendChild(el('text', { x: padL - 6, y: ey + laneH / 2 + 4, 'text-anchor': 'end', class: 'tick' }, '이력'));
    (opts.events || []).forEach(function (e) {
      var xx = X(e.t), cls = e.kind === '고장' ? 'tl-fail' : e.kind === '금형 교체' ? 'tl-die' : 'tl-maint';
      svg.appendChild(el('line', { x1: xx, x2: xx, y1: padT, y2: ey + laneH, class: 'tl-evline ' + cls }));
      var mk = e.kind === '고장' ? el('path', { d: 'M' + (xx - 6) + ' ' + (ey + 6) + 'L' + (xx + 6) + ' ' + (ey + 6) + 'L' + xx + ' ' + (ey + 18) + 'Z', class: cls })
        : el('rect', { x: xx - 4, y: ey + 8, width: 8, height: 8, class: cls, transform: e.kind === '정비' || e.kind === '오버홀' ? 'rotate(45 ' + xx + ' ' + (ey + 12) + ')' : '' });
      mk.appendChild(el('title', null, stamp(e.t) + ' ' + e.kind + ' — ' + (e.label || '')));
      svg.appendChild(mk);
    });
    return svg;
  }
  root.PressCharts = { chart: chart, figure: figure, sensorChart: sensorChart, sensorFigure: sensorFigure, spcChart: spcChart, spcFigure: spcFigure, timeline: timeline };
})(window);
