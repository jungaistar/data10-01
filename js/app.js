/* 프레스 예지보전 — 화면 (v2.1: 금형 타수 · 교체주기 · 오버홀 · 월별 타수 보고서 화면을 빼고 머신러닝 · 라벨링을 더함)
   계산은 js/logic.js(PressLogic), 그래프는 js/charts.js, 저장은 js/store.js, AI 연결은 js/ai-endpoint.js·ai-panel.js. */
(function () {
  'use strict';
  var L = window.PressLogic, S = window.PressStore, C = window.PressCharts, AIP = window.AIPanel, P = window.PressSPC, RS = window.PressRaw;
  var D = window.PressPdM, LV = window.PressLive, VD = window.PressVirtual; // 3차 — 온도 3구간·리드타임 · 실시간 연결 · 가상 더미 데이터
  var LB = window.PressLabel; // v2.1 — 머신러닝 · 라벨링
  var db = S.loadDb();
  var ui = { press: '', month: '', pending: [], errors: [], progress: '', busy: false, spc: { press: '', die: -1, view: 'all', from: '', to: '', group: 0 }, live: { kind: '', press: '', winMin: 10 }, ml: { press: '', day: '', edit: '', from: '', to: '', lab: 1, statPress: '', dropExclude: false } };
  var raw = {};       // 2초 센서 로그 — 프레스마다 시계열(IndexedDB 에 저장, js/rawstore.js)
  var rawInfo = {};   // 프레스마다 타수·정지 계산 캐시
  var rawSaved = null; // true 저장됨 · false 저장 안 됨(메모리만)
  var main = document.getElementById('main');
  var A = null; // 지금 데이터의 분석 결과(render 마다 다시 계산)

  /* ── 작은 도구 ───────────────────────────── */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function fld(label, control, hint) {
    return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  var toastTimer = null;
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function save() {
    var ok = S.saveDb(db);
    document.getElementById('storeNote').textContent = ok ? '이 브라우저에 저장됨 · ' + S.sizeKb() + 'KB' : '저장 안 됨(브라우저 저장소가 막혔거나 가득 참) — JSON 백업을 받아 두세요';
    return ok;
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(t) {
    function fallback() { var ta = h('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.', true); } ta.remove(); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('복사했습니다.'); }, fallback); else fallback();
  }
  var N = function (v, d) { return L.fmtN(v, d); };
  function pill(level) { return h('span', { class: 'pill lv-' + level }, L.LEVELS[level] || level); }
  function pageHead(stage, title, lead, right) {
    return h('div', { class: 'page-head' }, h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null), right || null);
  }
  function tile(k, v, sub) { return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'note' }, sub) : null); }
  function table(head, rows, opts) {
    opts = opts || {};
    var t = h('table', { class: 'list' + (opts.cls ? ' ' + opts.cls : '') });
    var tr = h('tr');
    head.forEach(function (x, i) { tr.appendChild(h('th', { class: opts.num && opts.num[i] ? 'num' : null, scope: 'col' }, x)); });
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr', { class: r.cls || null });
      (r.cells || r).forEach(function (x, i) { row.appendChild(h('td', { class: (opts.num && opts.num[i] ? 'num' : '') || null }, x)); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return h('div', { class: 'table-wrap' }, t);
  }
  function emptyNotice() {
    return h('section', { class: 'card empty' },
      h('p', null, '아직 가져온 프레스 로그가 없습니다.'),
      h('p', null, '로그 엑셀·CSV 를 가져오거나, 가상 샘플(프레스 4대 × 90일)로 먼저 둘러봐 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('a', { class: 'btn btn-primary', href: '#/import' }, '데이터 가져오기로'),
        h('button', { type: 'button', class: 'btn', onclick: askSample }, '샘플 90일로 시작')));
  }
  function goPress(id) { ui.press = id; location.hash = '#/anomaly'; }

  /* ── 가져오기 ───────────────────────────── */
  /* CSV 는 앞부분(512KB)만 먼저 읽어 2초 로그인지 봅니다. 2초 로그면 반영할 때 조각으로 끝까지 읽고(큰 파일도 화면이 멈추지 않게),
     아니면 지금처럼 통째로 읽습니다. */
  var HEAD_BYTES = 512 * 1024, CHUNK_BYTES = 4 * 1024 * 1024;
  function readFile(file) {
    if (!/\.(csv|txt)$/i.test(file.name)) return readWhole(file);
    return file.slice(0, HEAD_BYTES).arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), enc = P.sniffEncoding(u8);
      var text = new TextDecoder(enc).decode(u8);
      var aoa = P.parseCsvText(text);
      if (file.size > HEAD_BYTES && aoa.length > 1) aoa.pop(); // 잘린 마지막 행
      var det = L.detectColumns(aoa), hf = P.isHighFreq(aoa, det);
      if (!hf.high) return readWhole(file);
      var it = { fileName: file.name, sheets: [{ name: 'CSV', aoa: aoa }], sheet: 'CSV', overrides: {}, file: file, previewOnly: true, encoding: enc === 'utf-8' ? 'UTF-8' : 'EUC-KR(CP949)', size: file.size };
      reparse(it);
      return it;
    });
  }
  function readWhole(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var bytes = new Uint8Array(fr.result), wb, enc = '';
          if (/\.(csv|txt)$/i.test(file.name)) {
            var dec = L.decodeCsv(bytes); enc = dec.encoding;
            wb = XLSX.read(dec.text, { type: 'string', raw: true });
          } else wb = XLSX.read(bytes, { type: 'array', cellDates: false });
          var it = prepare(file.name, wb); it.encoding = enc; resolve(it);
        } catch (e) { reject(new Error(file.name + ': 읽지 못했습니다(' + e.message + ')')); }
      };
      fr.onerror = function () { reject(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function prepare(name, wb) {
    var sheets = wb.SheetNames.map(function (n) { return { name: n, aoa: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) }; });
    var pick = L.pickSheet(sheets) || sheets[0];
    var item = { fileName: name, sheets: sheets, sheet: pick ? pick.name : '', overrides: {} };
    reparse(item);
    return item;
  }
  function reparse(item) {
    var sh = item.sheets.filter(function (s) { return s.name === item.sheet; })[0];
    item.aoa = sh ? sh.aoa : [];
    item.result = L.parseSheet(item.aoa, { fileName: item.fileName, overrides: item.overrides });
    item.hf = P.isHighFreq(item.aoa, item.result.det);
    item.raw = item.previewOnly ? true : item.hf.high;
  }
  function fileId(f) { return f.name + '|' + f.size + '|' + (f.lastModified || 0); }
  function handleFiles(list) {
    var all = Array.prototype.slice.call(list || []), skipped = [];
    var files = all.filter(function (f) {
      if (/^~\$/.test(f.name)) { skipped.push(f.name + ' (엑셀 잠금 파일)'); return false; }
      if (!/\.(xlsx|xlsm|xls|csv|txt)$/i.test(f.name)) { if (!/^\./.test(f.name)) skipped.push(f.name + ' (엑셀·CSV 아님)'); return false; }
      if (ui.pending.some(function (p) { return p.fid === fileId(f); })) { skipped.push(f.name + ' (이미 올려 둠)'); return false; }
      return true;
    });
    if (!files.length) { toast(skipped.length ? '가져올 파일이 없습니다(' + skipped.length + '개 건너뜀).' : '엑셀·CSV 파일을 골라 주세요.', true); return; }
    files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    ui.errors = skipped.map(function (x) { return '건너뜀: ' + x; });
    var i = 0;
    (function next() {
      if (i >= files.length) { ui.progress = ''; render(); toast(files.length + '개 파일을 읽었습니다. 아래에서 열 연결을 확인한 뒤 반영해 주세요.'); return; }
      var f = files[i++];
      ui.progress = '읽는 중 ' + i + ' / ' + files.length + ' — ' + f.name;
      var pr = document.getElementById('importProgress'); if (pr) pr.textContent = ui.progress;
      readFile(f).then(function (it) {
        if (!it.fileName) throw new Error(f.name + ': 읽지 못했습니다.');
        it.fid = fileId(f);
        it.already = db.files.some(function (x) { return x.name === f.name; });
        ui.pending.push(it);
        applySameHeader(it);
      }, function (e) { ui.errors.push(e.message); }).then(function () { setTimeout(next, 0); });
    })();
  }
  /* 머리행이 같은 파일에 이미 고친 열 연결이 있으면 그대로 씁니다(첫 파일만 고치면 나머지도 따라감) */
  function applySameHeader(it) {
    var sig = L.headerSignature(it.result.det);
    var src = ui.pending.filter(function (p) { return p !== it && Object.keys(p.overrides).length && L.headerSignature(p.result.det) === sig; })[0];
    if (src) { it.overrides = JSON.parse(JSON.stringify(src.overrides)); reparse(it); }
  }
  function commit(items) {
    var total = { added: 0, updated: 0 }, ok = 0;
    var rawItems = items.filter(function (it) { return it.raw && !it.result.det.missing.length; });
    items.forEach(function (it) {
      var r = it.result;
      if (r.det.missing.length || it.raw) return;
      var m = L.mergeRecords(db.records, r.records);
      db.records = m.records;
      total.added += m.stat.added; total.updated += m.stat.updated;
      db.files.push({ name: it.fileName, sheet: it.sheet, rows: r.records.length, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      ok++;
    });
    function finish(rawMsg) {
      var sm = L.syncMaster(db.presses, db.dies, db.records);
      db.presses = sm.presses; db.dies = sm.dies;
      db.sample = db.sample && items.every(function (it) { return it.sample; });
      ui.pending = ui.pending.filter(function (p) { return items.indexOf(p) < 0; });
      ui.errors = [];
      save();
      toast((ok ? ok + '개 파일 반영 — 새 행 ' + total.added + ' · 바뀐 행 ' + total.updated : '') + (rawMsg ? (ok ? ' · ' : '') + rawMsg : '') +
        (sm.added.presses ? ' · 기준표에 프레스 ' + sm.added.presses + '대 추가' : ''));
      render();
    }
    if (!rawItems.length) { finish(''); return Promise.resolve(); }
    ui.busy = true; render();
    return readRawItems(rawItems).then(function (st) {
      ui.busy = false; ui.progress = '';
      finish('2초 로그 ' + rawItems.length + '개 파일 ' + L.fmtN(st.rows) + '행 → 프레스 ' + st.presses.join(', ') + (st.replaced ? ' (같은 시각 ' + L.fmtN(st.replaced) + '행은 새 값으로)' : '') + (st.warnCount ? ' · 행 점검 알림 ' + L.fmtN(st.warnCount) + '건' : ''));
      if (location.hash !== '#/spc' && !items.some(function (it) { return it.sample; })) location.hash = '#/spc';
    }, function (e) {
      ui.busy = false; ui.progress = '';
      ui.errors.push(e.message || String(e)); toast('2초 로그를 반영하지 못했습니다: ' + (e.message || e), true); render();
    });
  }

  /* ── 2초 로그 반영 ─────────────────────── */
  function setProgress(t) { ui.progress = t; var pr = document.getElementById('importProgress'); if (pr) pr.textContent = t; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  /* 파일마다 조각으로 읽어 행 → 프레스별 시계열 → 이미 있는 것과 합치기 → 일 집계를 기존 판정으로 */
  function readRawItems(items) {
    var stat = { rows: 0, replaced: 0, warnCount: 0, presses: [] }, touched = {};
    var chain = Promise.resolve();
    items.forEach(function (it, idx) {
      chain = chain.then(function () {
        var b = P.createRawBuilder(it.result.det), det = it.result.det, label = '(' + (idx + 1) + '/' + items.length + ') ' + it.fileName;
        var work;
        if (it.previewOnly && it.file) {
          var pos = 0, rowNo = 0, dec = new TextDecoder(it.encoding === 'UTF-8' ? 'utf-8' : 'euc-kr'), started = Date.now();
          var parser = P.createCsvParser(function (row) { rowNo++; if (rowNo - 1 > det.headerRow) b.add(row, rowNo); });
          work = (function next() {
            if (pos >= it.file.size) { parser.push(dec.decode()); parser.end(); return Promise.resolve(); }
            return it.file.slice(pos, pos + CHUNK_BYTES).arrayBuffer().then(function (buf) {
              pos += buf.byteLength;
              parser.push(dec.decode(new Uint8Array(buf), { stream: true }));
              setProgress('읽는 중 ' + label + ' — ' + Math.round(pos / it.file.size * 100) + '% · ' + L.fmtN(b.result.rows) + '행' + (Date.now() - started > 1500 ? ' · ' + Math.round((Date.now() - started) / 1000) + '초' : ''));
              return tick().then(next);
            });
          })();
        } else {
          var aoa = it.aoa, r = det.headerRow + 1;
          work = (function next() {
            var end = Math.min(aoa.length, r + 20000);
            for (; r < end; r++) b.add(aoa[r], r + 1);
            setProgress('읽는 중 ' + label + ' — ' + Math.round(r / aoa.length * 100) + '%');
            return r < aoa.length ? tick().then(next) : Promise.resolve();
          })();
        }
        return work.then(function () {
          setProgress('합치는 중 ' + label);
          var res = b.finish();
          stat.rows += res.rows; stat.warnCount += res.warnCount;
          if (res.warnings.length) ui.rawWarnings = res.warnings;
          Object.keys(res.series).forEach(function (p) {
            var m = P.mergeSeries(raw[p], res.series[p]);
            stat.replaced += m.replaced || 0; raw[p] = m; touched[p] = 1; delete rawInfo[p];
          });
          db.rawFiles = (db.rawFiles || []).concat([{ name: it.fileName, rows: res.rows, skipped: res.skipped, presses: Object.keys(res.series).sort(L.natCmp).join(', '),
            from: P.stampText(res.first), to: P.stampText(res.last), at: new Date().toISOString().slice(0, 16).replace('T', ' ') }]);
          return tick();
        });
      });
    });
    return chain.then(function () {
      stat.presses = Object.keys(touched).sort(L.natCmp);
      setProgress('일 집계 만드는 중');
      rebuildDaily(stat.presses);
      return saveRaw(stat.presses).then(function () { return stat; });
    });
  }
  function infoOf(p) {
    var O = P.cleanOpts(db.spc), key = raw[p].n + '|' + O.cycleSec + '|' + O.stopSec + '|' + O.gapSec;
    if (!rawInfo[p] || rawInfo[p].key !== key) { rawInfo[p] = P.strokeInfo(raw[p], O); rawInfo[p].key = key; }
    return rawInfo[p];
  }
  /* ── 3차: 온도 3구간 · 경보 기준 ─────────────
     온도 경계(예열 끝·위험 시작)는 설정에서 고친 값(db.zones)이 있으면 그것을, 없으면 가져온 2초 로그(없으면 실시간으로 받은 값)로 잡은 기본값을 씁니다. */
  var zoneCache = {};
  function ruleOf() { return D.cleanRule(db.pdm); }
  function derivedZone(p, s, info) {
    var ck = p + (s.live ? '#live' : ''), key = s.n + '|' + s.t[0] + '|' + s.t[s.n - 1] + '|' + P.cleanOpts(db.spc).gapSec + '|' + (info && info.key);
    var c = zoneCache[ck];
    if (c && c.key === key) return c.z;
    var z = D.deriveZones(s, info, db.spc);
    zoneCache[ck] = { key: key, z: z };
    return z;
  }
  function zoneOf(p, s, info) {
    if (s && s.live && !raw[p]) { // 실시간 — 가져온 로그가 없으면 받기 시작한 처음 10분(300개 이상)으로 잡아 고정(징후를 따라 움직이지 않게)
      var fr = live.frozen[p] || (live.frozen[p] = {});
      if (!fr.z && s.n >= 300) fr.z = D.deriveZones(s, info, db.spc);
      return D.zoneCfg(db.zones[p], fr.z || null, db.pdm);
    }
    var base = raw[p] || s, bi = raw[p] ? infoOf(p) : info;
    return D.zoneCfg(db.zones[p], base && base.n ? derivedZone(p, base, bi) : null, db.pdm);
  }
  /* 채널마다 관리도 자료 — 온도는 3구간(위험 점 = 빨간 점), 나머지는 ±3σ. 예열 구간 이탈은 기본으로 뺍니다(설정). view.lims = 채널마다 정해 둔 관리 한계(실시간) */
  function chartsFor(s, info, O, view, z) {
    var R = ruleOf();
    return chansOf(s).map(function (c) {
      var v = view;
      if (view.lims && view.lims[c] !== undefined) { v = {}; Object.keys(view).forEach(function (k) { v[k] = view[k]; }); v.lim = view.lims[c]; }
      var d = P.chartData(s, info, c, O, v), j;
      if (c === 'temp' && z) {
        var flags = new Uint8Array(d.values.length), nD = 0;
        for (j = 0; j < d.values.length; j++) if (D.classify(d.values[j], z) === 2) { flags[j] = D.DANGER_BIT; nD++; }
        var r = P.rangeIdx(s, view.from, view.to), zw = D.zoneWindow(s, info, z, r[0], r[1], O);
        d.lim = null; d.flags = flags; d.zone = z; d.zw = zw; d.count = { r1: 0, run9: 0, trend6: 0, two3: 0, danger: nD };
        d.events = zw.dangers.map(function (x) { return { from: x.from, to: x.to, n: x.n, peak: x.peak, side: 'up', z: NaN, zone: true, alarm: x.alarm, rules: [x.alarm ? '위험 구간 ' + z.holdSec + '초 넘게(경보)' : '위험 구간(짧게)'] }; });
        return d;
      }
      if (d.lim && z && R.excludeWarm) {
        d.masked = D.maskWarm(s, z, d.cs, d.flags, d.i0);
        if (d.masked) {
          d.count = { r1: 0, run9: 0, trend6: 0, two3: 0 };
          for (j = 0; j < d.flags.length; j++) { var f = d.flags[j]; if (f & 1) d.count.r1++; if (f & 2) d.count.run9++; if (f & 4) d.count.trend6++; if (f & 8) d.count.two3++; }
          d.events = P.toEvents(d.cs.t, d.values, d.flags, d.lim, Math.max(10, (view.groupSec || 2) * 5), d.i0);
          if (d.last) for (j = d.values.length - 1; j >= 0; j--) if (!isNaN(d.values[j])) { d.last.flag = d.flags[j]; break; }
        }
      }
      return d;
    });
  }
  /* 이력(고장·정비·금형 교체) → 그래프 세로선 */
  function marksFor(p) {
    return (db.events || []).filter(function (e) { return e.press === p; }).map(function (e) {
      return { t: P.parseStamp(e.at), label: e.kind + ' — ' + (e.part || ''), short: e.kind === '고장' ? '고장' : e.kind === '금형 교체' ? '금형' : '정비', cls: e.kind === '고장' ? 'fail' : e.kind === '금형 교체' ? 'die' : 'maint' };
    });
  }
  function lastCard(d) {
    var m = CH_META[d.channel], lv = 'none', st = '기준 없음', notes = [];
    if (d.zone) {
      var zc = d.last ? D.classify(d.last.v, d.zone) : -1;
      lv = zc === 2 ? 'bad' : zc === 1 ? 'ok' : 'none'; st = zc < 0 ? '값 없음' : D.ZONES[zc].label;
      notes.push('예열 끝 ' + fmt(d.zone.warmTop, 1) + ' · 위험 ' + fmt(d.zone.dangerAt, 1) + m.unit);
      var al = d.events.filter(function (e) { return e.alarm; }).length;
      notes.push('이 구간 위험 경보 ' + (al ? al + '번' : '없음') + (d.count.danger ? ' · 위험 점 ' + N(d.count.danger) + '개' : ''));
    } else {
      if (d.lim && d.last) {
        var v = d.last.v;
        if (v > d.lim.ucl || v < d.lim.lcl) { lv = 'bad'; st = '관리선 밖'; }
        else if (v > d.lim.uwl || v < d.lim.lwl) { lv = 'warn'; st = '경고선 밖'; }
        else { lv = 'ok'; st = '관리선 안'; }
      }
      if (d.lim) notes.push('중심선 ' + fmt(d.lim.center) + ' · 관리선 ' + fmt(d.lim.lcl) + ' ~ ' + fmt(d.lim.ucl));
      var ev = d.events.length;
      notes.push('이 구간 이탈 ' + (ev ? ev + '번(' + N(d.count.r1 + d.count.run9 + d.count.trend6 + d.count.two3) + '점)' : '없음') + (d.masked ? ' · 예열 중 ' + N(d.masked) + '점 뺌' : ''));
    }
    return h('div', { class: 'lastcard lv-' + lv },
      h('div', { class: 'lc-top' }, h('span', { class: 'k' }, m.label), h('span', { class: 'pill lv-' + lv }, st)),
      h('div', { class: 'v' }, d.last ? fmt(d.last.v) : '-', h('small', null, ' ' + m.unit)),
      h('div', { class: 'note' }, d.last ? P.stampText(d.last.t, 'md') + ':' + P.stampText(d.last.t, 'time').slice(6) : ''),
      notes.map(function (x) { return h('div', { class: 'note' }, x); }));
  }
  function chartFig(d, win, O, group, marks) {
    var m = CH_META[d.channel];
    var ds = P.downsample(d.cs.t, d.values, d.flags, d.i0, 600, 2000);
    var cap = m.label + ' (' + m.unit + ')' + (group ? ' — ' + (group / 60) + '분 평균' : '') +
      (d.zone ? ' — 3구간 관리선(예열 · 안정 생산 · 위험)' + (d.zone.auto ? ' · 데이터로 잡은 기본값' : ' · 설정한 값')
        : d.lim ? ' · σ ' + fmt(d.lim.sigma, 4) + (d.lim.method === 'mr' ? ' (MR̄/1.128)' : ' (표본 표준편차)') : ' · 기준 구간 값이 모자라 관리선을 못 그림');
    var f = C.spcFigure(cap, { ds: ds, lim: d.lim, base: d.base, from: win.from, to: win.to, warn: O.warnLines, unit: m.unit, color: m.color, gapSec: Math.max(O.gapSec, group * 3),
      zones: d.zone || null, noBase: !!d.zone || O.baseMode === 'all' || !!win.noBase, marks: marks || [] });
    if (ds.violCount > ds.viol.length) f.appendChild(h('p', { class: 'note' }, (d.zone ? '위험 구간 점이 ' : '이탈점이 ') + N(ds.violCount) + '개라 그래프에는 칸마다 가장 먼 점만 그렸습니다. 전부는 아래 목록·엑셀에 있습니다.'));
    if (!ds.raw) f.appendChild(h('p', { class: 'note' }, N(d.values.length) + '점을 ' + ds.buckets.length + '칸으로 줄여 그림(칸마다 평균·최소·최대) — ' + (d.zone ? '위험 구간 점' : '이탈점') + '은 줄이지 않고 모두 빨간 점으로 표시. 구간을 좁히면 원값이 그대로 보입니다.'));
    return f;
  }

  /* 원 로그 → 하루 묶음(프레스·날짜·금형) — 「최근 14일 vs 앞 42일」 이상 감지가 이어서 씁니다 */
  function rebuildDaily(presses) {
    presses.forEach(function (p) {
      db.records = db.records.filter(function (r) { return !(r.src === 'raw' && r.press === p); });
      if (!raw[p]) return;
      db.records = L.mergeRecords(db.records, P.dailyFromSeries(raw[p], infoOf(p))).records;
    });
  }
  function saveRaw(presses) {
    var m = {}; presses.forEach(function (p) { if (raw[p]) m[p] = raw[p]; });
    return RS.save(m).then(function (ok) { rawSaved = ok; });
  }
  function rawRows() { return Object.keys(raw).reduce(function (s, p) { return s + raw[p].n; }, 0); }
  function clearRaw() { raw = {}; rawInfo = {}; db.rawFiles = []; return RS.clear(); }
  function loadRawSample() {
    toast('2초 로그 샘플을 만드는 중입니다(4대 × 3일, 172,350행)…');
    ui.busy = true; render();
    setTimeout(function () {
      var det = L.detectColumns([window.PressSample.RAW_HEAD]);
      var it = { fileName: '센서로그_샘플_2026-10-19~21 (2초)', result: { det: det, records: [], warnings: [] }, raw: true, sample: true, aoa: [window.PressSample.RAW_HEAD] };
      window.PressSample.buildRaw(function (row) { it.aoa.push(row); });
      clearRaw().then(function () {
        db = L.emptyDb(); db.sample = true; db.sampleKind = 'raw';
        ui.pending = []; ui.press = ''; ui.month = ''; ui.spc = { press: '', die: -1, view: 'all', from: '', to: '', group: 0 };
        return commit([it]);
      }).then(function () { location.hash = '#/spc'; });
    }, 30);
  }
  function loadVirtual() {
    toast('가상 더미 데이터를 만드는 중입니다(프레스 3대 × 5일, 216,000행 + 고장·정비 이력)…');
    ui.busy = true; render();
    setTimeout(function () {
      var det = L.detectColumns([VD.HEAD]);
      var it = { fileName: '가상더미_프레스3대_2026-10-19~23 (2초)', result: { det: det, records: [], warnings: [] }, raw: true, sample: true, aoa: [VD.HEAD] };
      VD.build(function (row) { it.aoa.push(row); });
      clearRaw().then(function () {
        db = L.emptyDb(); db.sample = true; db.sampleKind = 'virtual'; db.events = VD.events(); db.ml = LB.cleanState({ logs: VD.mlog() });
        ui.pending = []; ui.press = ''; ui.month = ''; ui.spc = { press: '', die: -1, view: 'all', from: '', to: '', group: 0 }; zoneCache = {}; leadCache = null;
        return commit([it]);
      }).then(function () { location.hash = '#/lead'; });
    }, 30);
  }
  /* 가상 2초 로그를 CSV 파일로(받은 로그와 같은 11열·따옴표) — 중계 서버 --csv 재생이나 다른 도구에서 시험할 때 */
  function downloadVirtualCsv() {
    toast('가상 2초 로그 CSV 를 만드는 중입니다(216,000행)…');
    setTimeout(function () {
      var parts = ['\ufeff' + window.PressSample.rawCsvLine(VD.HEAD) + '\r\n'], buf = [];
      VD.build(function (row) { buf.push(window.PressSample.rawCsvLine(row)); if (buf.length >= 5000) { parts.push(buf.join('\r\n') + '\r\n'); buf = []; } });
      if (buf.length) parts.push(buf.join('\r\n') + '\r\n');
      download('가상더미_센서로그_2026-10-19~23.csv', new Blob(parts, { type: 'text/csv;charset=utf-8' }));
    }, 30);
  }
  function askVirtual() { if ((!db.records.length && !rawRows()) || confirm('지금 데이터를 지우고 가상 더미 데이터(프레스 3대 × 5일 2초 로그 + 고장·정비·금형 교체 이력)를 불러올까요?')) loadVirtual(); }
  function askRawSample() { if ((!db.records.length && !rawRows()) || confirm('지금 데이터를 지우고 2초 로그 샘플(프레스 4대 × 3일)을 불러올까요?')) loadRawSample(); }
  function sampleItems() {
    var b = window.PressSample.build();
    var items = b.files.map(function (f) {
      // 앱이 실제 파일을 읽을 때와 같은 길로 — 엑셀은 통합문서로 만들었다가 다시 읽고, CSV 는 글자로 읽습니다
      var wb;
      if (f.kind === 'csv') wb = XLSX.read(f.csv, { type: 'string', raw: true });
      else {
        var w = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(w, window.PressSample.toSheet(XLSX, f.aoa), '프레스 로그');
        wb = XLSX.read(XLSX.write(w, { bookType: 'xlsx', type: 'array' }), { type: 'array', cellDates: false });
      }
      var it = prepare(f.fileName, wb); it.sample = true; return it;
    });
    return { items: items, master: b.master };
  }
  function loadSample() {
    var s = sampleItems();
    clearRaw();
    db = L.emptyDb(); db.sample = true;
    db.presses = s.master.presses; db.dies = s.master.dies;
    ui.pending = []; ui.press = ''; ui.month = '';
    commit(s.items);
    location.hash = '#/dash';
  }
  function askSample() { if (!db.records.length || confirm('지금 데이터를 지우고 가상 샘플(프레스 4대 × 90일)을 불러올까요?')) loadSample(); }

  function pageImport() {
    var input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xlsm,.xls,.csv,.txt' });
    input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });
    var folder = h('input', { type: 'file', multiple: true, webkitdirectory: true });
    folder.addEventListener('change', function () { handleFiles(folder.files); folder.value = ''; });
    var drop = h('div', { class: 'drop' },
      h('label', { class: 'btn btn-primary' }, input, '로그 파일 고르기(여러 개 가능)'),
      h('label', { class: 'btn' }, folder, '폴더째 고르기'),
      h('span', { class: 'note' }, '또는 파일을 여기로 끌어다 놓아 주세요. 엑셀(.xlsx·.xls)과 CSV 를 함께 넣어도 됩니다.'));
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });

    var out = [pageHead('데이터', '프레스 로그 가져오기', '설비 화면·PLC·수기 엑셀에서 꺼낸 로그를 넣어 주세요. 열 이름이 달라도 열 연결에서 맞출 수 있습니다.'),
      h('section', { class: 'card' }, h('h2', null, '1. 파일 넣기'), drop,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: askSample }, '하루 묶음 샘플 90일로 시작'),
          h('button', { type: 'button', class: 'btn', onclick: askRawSample }, '2초 로그 샘플(4대 × 3일)'),
          h('button', { type: 'button', class: 'btn', onclick: askVirtual }, '가상 고장 데이터(3대 × 5일 + 이력)'),
          h('button', { type: 'button', class: 'btn', onclick: downloadVirtualCsv }, '가상 고장 데이터 CSV 내려받기(2초 로그 약 26MB)'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('가상_고장정비이력_2026-10-19~23.csv'), download: '' }, '가상 고장·정비 이력 CSV'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('센서로그_샘플_2026-10-21.csv'), download: '' }, '2초 로그 샘플 CSV 내려받기'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('프레스로그_샘플_2026-09.xlsx'), download: '' }, '샘플 엑셀 내려받기(9월)'),
          h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('프레스로그_샘플_2026-10.csv'), download: '' }, '샘플 CSV 내려받기(10월)')),
        h('ul', { class: 'note' },
          h('li', null, '한 행 = 한 프레스의 한 기록(하루 또는 시각별)입니다. 꼭 필요한 열은 일자와 프레스이고, 나머지(프레스 종류·금형명·타수·누적 타수·가동 시간·전류·전압·온도·진동)는 있는 만큼 씁니다.'),
          h('li', null, '2초 간격 센서 로그(일자에 초까지, 예: 2026-10-01 09:00:02)는 알아서 가려 「실시간 관리도」로 보냅니다. 큰 CSV(하루 43,200행 × 프레스 여러 대)도 조각으로 나눠 읽어 화면이 멈추지 않습니다. 같은 프레스·같은 시각은 한 번만 셉니다.'),
          h('li', null, '타수는 「타수」 열이 있으면 그 값을, 없으면 같은 프레스의 「프레스 누적 타수」 차이를, 그것도 없으면 「금형 (누적) 타수」 차이를 씁니다. 「금형 타수」 열은 금형 교체 때 0 으로 돌아가는 누적 카운터로 읽습니다(받은 로그 확인).'),
          h('li', null, '같은 행(일자 + 시각 + 프레스 + 금형)을 다시 가져오면 새 값으로 바뀝니다. 같은 파일을 두 번 넣어도 두 번 세지 않습니다.'),
          h('li', null, 'CSV 는 UTF-8 과 한글 엑셀이 저장한 CP949(EUC-KR) 를 알아서 가려 읽습니다.'),
          h('li', null, '「가상 고장 데이터」는 3차에 만든 가상 더미 값입니다(프레스 3대 × 10/19~23, 고장 3건·정비 3건·금형 교체 2건, 정비 · 고장 이력 3건). 고장 전 이탈이 몇 시간·몇 타 먼저 나타나는지 「고장 전 이탈」에서, 정상 / 이상 라벨은 「머신러닝 · 라벨링」에서 봅니다.'),
          h('li', null, '파일은 서버로 보내지 않고 이 브라우저 안에서만 읽습니다.')),
        h('p', { class: 'note progress', id: 'importProgress', 'aria-live': 'polite' }, ui.progress || ''),
        ui.errors.length ? h('details', { class: 'warn-list', open: true }, h('summary', null, '읽지 못했거나 건너뛴 파일 ' + ui.errors.length + '개'),
          h('ul', null, ui.errors.map(function (e) { return h('li', null, e); }))) : null)];

    if (ui.pending.length) {
      var box = h('section', { class: 'card' }, h('h2', null, '2. 열 연결 확인 후 반영 (' + ui.pending.length + '개 파일)'));
      var ready = ui.pending.filter(function (it) { return !it.result.det.missing.length; });
      box.appendChild(table(['파일', '기간', '행', '프레스', '알림', '상태'], ui.pending.map(function (it) {
        var r = it.result, rg = L.dataRange(r.records);
        var presses = []; r.records.forEach(function (x) { if (presses.indexOf(x.press) < 0) presses.push(x.press); });
        var rows = it.previewOnly ? '앞부분 ' + r.records.length + '행 미리 봄 · 전체 ' + (it.size / 1048576).toFixed(1) + 'MB' : r.records.length;
        return { cls: r.det.missing.length ? 'excluded' : null, cells: [it.fileName + (it.encoding ? ' (' + it.encoding + ')' : ''),
          rg.first ? rg.first + ' ~ ' + rg.last + (it.previewOnly ? ' …' : '') : '-', rows, presses.sort(L.natCmp).join(', ') || '-', r.warnings.length + r.det.warnings.length,
          r.det.missing.length ? '열 연결 필요' : it.raw ? '2초 센서 로그(' + (it.hf.reason || '고빈도') + ') → 실시간 관리도' : it.already ? '이전에 가져온 파일(새 값으로 바뀜)' : '반영 준비됨'] };
      }), { num: [0, 0, 0, 0, 1, 0] }));
      box.appendChild(h('h3', null, '파일별 자세히'));
      ui.pending.forEach(function (it) { box.appendChild(pendingCard(it)); });
      box.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !ready.length || ui.busy, onclick: function () { commit(ready); } }, ui.busy ? '읽는 중…' : '확인한 ' + ready.length + '개 파일 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ui.pending = []; render(); } }, '취소')));
      out.push(box);
    }

    var presses = Object.keys(db.presses), st = A.strokeStat;
    var rawPs = Object.keys(raw).sort(L.natCmp);
    if (rawPs.length) out.push(h('section', { class: 'card' }, h('h2', null, '쌓인 2초 센서 로그'),
      table(['프레스', '종류', '기간', '행', '날 수', '금형'], rawPs.map(function (p) { var m = P.summary(raw[p]); return [p, m.type || '-', P.stampText(m.from) + ' ~ ' + P.stampText(m.to), N(m.n), m.days, m.dies.join(', ') || '-']; }), { num: [0, 0, 0, 1, 1, 0] }),
      h('p', { class: 'note' }, rawSaved === false ? '이 브라우저 저장소(IndexedDB)가 막혀 이번 창에만 있습니다. 창을 닫으면 사라집니다.' : '이 브라우저(IndexedDB)에 저장됩니다. 하루 묶음(타수·가동 시간·센서 평균)은 아래 「쌓인 데이터」로 이어져 일 단위 이상 감지에 쓰입니다. 「머신러닝 · 라벨링」은 이 2초 로그에 라벨을 붙입니다.'),
      ui.rawWarnings && ui.rawWarnings.length ? h('details', { class: 'warn-list' }, h('summary', null, '마지막으로 읽은 파일의 행 점검 알림(앞 50건)'),
        h('ul', null, ui.rawWarnings.map(function (w) { return h('li', null, (w.row ? w.row + '행: ' : '') + w.msg); }))) : null,
      (db.rawFiles || []).length ? h('details', null, h('summary', null, '가져온 2초 로그 파일 ' + db.rawFiles.length + '개'),
        table(['파일', '프레스', '처음', '끝', '행', '가져온 때'], db.rawFiles.slice().reverse().map(function (f) { return [f.name, f.presses, f.from, f.to, N(f.rows), f.at]; }), { num: [0, 0, 0, 0, 1, 0] })) : null,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('a', { class: 'btn btn-primary', href: '#/spc' }, '실시간 관리도 보기'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          if (!confirm('2초 센서 로그와 거기서 만든 하루 묶음만 지울까요?')) return;
          clearRaw().then(function () { db.records = db.records.filter(function (r) { return r.src !== 'raw'; }); save(); render(); });
        } }, '2초 로그만 지우기'))));
    out.push(h('section', { class: 'card' }, h('h2', null, '쌓인 데이터'),
      db.records.length ? h('div', null,
        h('div', { class: 'tiles' },
          tile('기간', A.range.first.slice(5).replace('-', '/') + ' ~ ' + A.range.last.slice(5).replace('-', '/'), (L.daysBetween(A.range.first, A.range.last) + 1) + '일'),
          tile('프레스', presses.length + '대'),
          tile('로그 행', N(db.records.length))),
        h('p', { class: 'note' }, '타수 계산: 타수 열 ' + N(st.fromRow) + '행 · 프레스 누적 타수 차이 ' + N(st.fromPressCum) + '행 · 금형 누적 타수 차이 ' + N(st.fromDieCum) + '행' +
          (st.noPrev ? ' · 앞 누적값이 없어 못 센 첫 행 ' + st.noPrev + '행' : '') + (st.reset ? ' · 누적값이 줄어(카운터 초기화) 못 센 행 ' + st.reset + '행' : '') + (st.none ? ' · 타수 정보가 없는 행 ' + N(st.none) + '행' : '')),
        st.mismatch ? h('details', { class: 'warn-list' }, h('summary', null, '타수 합과 프레스 누적 타수 차이가 맞지 않는 곳 ' + st.mismatch + '곳 (확인해 주세요)'),
          h('ul', null, st.mismatchRows.map(function (x) { return h('li', null, x); }))) : null,
        h('details', null, h('summary', null, '가져온 파일 ' + db.files.length + '개 보기'),
          table(['가져온 파일', '시트', '행', '가져온 때'], db.files.slice().reverse().map(function (f) { return [f.name, f.sheet, f.rows, f.at]; }), { num: [0, 0, 1, 0] })),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            if (!confirm('이 브라우저에 쌓인 로그·기준표·설정을 모두 지울까요? (되돌릴 수 없습니다. 먼저 설정 화면에서 JSON 백업을 받아 두면 안전합니다)')) return;
            db = L.emptyDb(); S.clearDb(); ui.press = ''; ui.month = ''; clearRaw(); save(); render();
          } }, '모든 데이터 지우기'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            if (!confirm('로그만 지우고 설비·금형 기준표와 설정은 남길까요?')) return;
            db.records = []; db.files = []; db.sample = false; clearRaw(); save(); render();
          } }, '로그만 지우기')))
        : h('p', { class: 'note' }, '아직 없습니다.')));
    return out;
  }
  function pendingCard(it) {
    var r = it.result, det = r.det;
    var sheetSel = h('select', { 'aria-label': '시트' });
    it.sheets.forEach(function (s) { var o = h('option', { value: s.name }, s.name); if (s.name === it.sheet) o.selected = true; sheetSel.appendChild(o); });
    sheetSel.addEventListener('change', function () { it.sheet = sheetSel.value; it.overrides = {}; reparse(it); render(); });
    var hdr = det.headers || [], ex = it.aoa[det.headerRow + 1] || [];
    var mapGrid = h('div', { class: 'map-grid' });
    L.FIELDS.forEach(function (f) {
      var sel = h('select', { 'aria-label': f.label + ' 열' });
      sel.appendChild(h('option', { value: '-1' }, '(이 파일에는 없음)'));
      hdr.forEach(function (t, i) {
        var o = h('option', { value: String(i) }, L.colName(i) + ' · ' + (t || '(빈 머리)'));
        if (det.map[f.id] === i) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        var sig = L.headerSignature(it.result.det), n = 0;
        ui.pending.forEach(function (p) {
          if (p !== it && L.headerSignature(p.result.det) !== sig) return;
          p.overrides[f.id] = Number(sel.value); reparse(p); if (p !== it) n++;
        });
        if (n) toast('머리행이 같은 파일 ' + n + '개에도 같은 연결을 적용했습니다.');
        render();
      });
      var col = det.map[f.id], exv = col == null ? '' : ex[col];
      if (f.id === 'date' && typeof exv === 'number') { var dt = L.toDateTime(exv); exv = dt.date + (dt.time ? ' ' + dt.time : '') + ' (엑셀 날짜 ' + exv + ')'; }
      mapGrid.appendChild(h('div', { class: 'map-row' + (f.req && col == null ? ' missing' : '') },
        h('span', { class: 'col' }, f.label, f.req ? h('span', { class: 'req' }, ' 필수') : null), sel,
        h('span', { class: 'ex' }, col == null ? '연결 안 됨' : '예: ' + (exv == null || exv === '' ? '(빈칸)' : String(exv)) + (f.id === 'runHr' && det.units.runHr && /분|min/.test(det.units.runHr) ? ' — 분 단위로 보고 시간으로 바꿈' : ''))));
    });
    var needs = det.missing.length > 0;
    return h('details', { class: 'block', open: needs || ui.pending.length === 1 ? true : null }, h('summary', null, it.fileName + (det.missing.length ? ' — 열 연결 필요' : '')),
      h('div', { class: 'form-grid' },
        fld('시트', sheetSel, it.sheets.length > 1 ? '로그 시트를 자동으로 골랐습니다.' : null),
        h('div', { class: 'field' }, h('span', null, '읽은 결과'),
          h('div', null, det.headerRow < 0 ? '머리행을 못 찾음' : '머리행 ' + (det.headerRow + 1) + '행 · 로그 행 ' + r.records.length + (r.skipped ? ' · 건너뛴 행 ' + r.skipped : '')))),
      det.warnings.map(function (w) { return h('p', { class: 'alert warn' }, w); }),
      r.warnings.length ? h('details', { class: 'warn-list' }, h('summary', null, '행 점검 알림 ' + r.warnings.length + '건'),
        h('ul', null, r.warnings.slice(0, 50).map(function (w) { return h('li', null, w.row + '행: ' + w.msg); }))) : null,
      h('details', { open: needs ? true : null }, h('summary', null, '열 연결 보기·고치기 (' + Object.keys(det.map).length + '개 연결됨)'), mapGrid));
  }

  /* ── 대시보드 ───────────────────────────── */
  function pageDash() {
    if (!db.records.length) return [pageHead('대시보드', '프레스 예지보전 — 전압 · 전류 · 진동 · 온도'), emptyNotice()];
    var st = A.statuses;
    var cnt = { bad: 0, warn: 0, ok: 0, none: 0 };
    st.forEach(function (s) { cnt[s.level] = (cnt[s.level] || 0) + 1; });
    var chBad = A.anomalies.filter(function (a) { return a.level === 'bad' || a.level === 'warn'; }).length;
    var hero = h('div', { class: 'hero' },
      h('div', { class: 'hero-text' }, h('h1', null, '프레스 예지보전 대시보드'),
        h('p', null, '전압 · 전류 · 진동 · 온도로 정상 / 이상 상태를 봅니다 · 기준일 ' + A.asOf + ' (로그 마지막 날) · 로그 ' + A.range.first + ' ~ ' + A.range.last + ' · 프레스 ' + st.length + '대')));
    var kpis = h('div', { class: 'dkpis' },
      dk('점검 필요', cnt.bad, '대', 'lv-bad', '센서 값이 관리한계 밖으로 이어짐'),
      dk('주의', cnt.warn, '대', 'lv-warn', '주의 한계 밖 · 관리한계 밖 며칠'),
      dk('정상', cnt.ok, '대', 'lv-ok', cnt.none ? '비교 못 함 ' + cnt.none + '대' : '평소 범위 안'),
      dk('이상 채널', chBad, '개', 'lv-info', '프레스 × 채널(전압 · 전류 · 진동 · 온도)'));
    var cards = h('div', { class: 'press-grid' }, st.map(pressCard));
    var mlBox = h('section', { class: 'dp' }, h('div', { class: 'dp-head' }, h('h2', null, '머신러닝 · 라벨링'), h('a', { class: 'dp-more', href: '#/ml' }, '라벨링 화면')),
      h('p', { class: 'dp-sub' }, '정비 · 고장 이력 ' + db.ml.logs.length + '건 · 수동 라벨 ' + db.ml.manual.length + '건 · 고장 전 구간 ' + db.ml.rule.preH + '시간 · 안정 구간 ' + db.ml.rule.postH + '시간'),
      h('p', { class: 'note' }, db.ml.logs.length ? '이력으로 2초 센서 로그에 정상 · 이상 · 제외 라벨을 붙여 학습용 데이터셋으로 내려받습니다.' : '정비 · 고장 이력(엑셀 · CSV)을 넣으면 2초 센서 로그에 정상 / 이상 라벨을 붙입니다.'));
    return [hero, kpis, rawDash(), h('h2', { class: 'sec' }, '프레스별 상태 (하루 묶음 기준)'), cards, mlBox];
  }
  function dk(t, v, unit, cls, note) {
    return h('div', { class: 'dk ' + cls }, h('div', { class: 'dk-body' }, h('div', { class: 'dk-t' }, t), h('div', { class: 'dk-v' }, String(v), h('small', null, unit)), h('div', { class: 'dk-note' }, note)));
  }
  function pressCard(s) {
    var sensors = s.sensors.filter(function (a) { return a.base; }).map(function (a) {
      return h('li', null, h('span', { class: 'k' }, a.label), h('span', { class: 'v' }, a.recent.median == null ? '-' : N(a.recent.median, 1) + a.unit),
        h('span', { class: 'note' }, '평소 ' + N(a.base.center, 1) + a.unit), a.level === 'ok' ? null : pill(a.level));
    });
    return h('article', { class: 'pcard lv-' + s.level },
      h('div', { class: 'pcard-top' }, h('div', null, h('h3', null, s.id), h('div', { class: 'note' }, s.type || '종류 미입력')), pill(s.level)),
      s.reasons.length ? h('ul', { class: 'reasons' }, s.reasons.slice(0, 3).map(function (r) { return h('li', { class: 'lv-' + r.level, title: r.text }, r.short || r.text); }))
        : h('p', { class: 'note' }, s.level === 'none' ? '센서 값이 없거나 기준선이 짧아 비교하지 못했습니다.' : '평소 범위 안입니다.'),
      s.reasons.length > 3 ? h('p', { class: 'note' }, '외 ' + (s.reasons.length - 3) + '건') : null,
      h('dl', { class: 'pstats' },
        h('dt', null, '마지막 기록'), h('dd', null, s.lastDate || '-')),
      sensors.length ? h('ul', { class: 'sens' }, sensors) : null,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { goPress(s.id); } }, '이상 감지 그래프')));
  }


  /* ── 실시간 관리도 (2초 센서 로그) ─────────── */
  var CH_META = { current: { label: '전류', unit: 'A', color: 'var(--series-1)' }, voltage: { label: '전압', unit: 'V', color: 'var(--series-4)' },
    temp: { label: '온도', unit: '℃', color: 'var(--series-2)' }, vib: { label: '진동', unit: 'mm/s', color: 'var(--series-3)' } };
  var VIEWS = [['all', '전체'], [10, '최근 10분'], [30, '최근 30분'], [60, '최근 1시간'], [240, '최근 4시간'], [1440, '최근 하루'], ['custom', '기간 지정']];
  function spcWindow(s) {
    var last = s.t[s.n - 1], first = s.t[0], v = ui.spc.view;
    if (v === 'custom') {
      var a = P.fromLocalInput(ui.spc.from), b = P.fromLocalInput(ui.spc.to);
      return { from: isFinite(a) ? a : first, to: isFinite(b) ? b : last };
    }
    if (typeof v === 'number') return { from: Math.max(first, last - v * 60), to: last };
    return { from: first, to: last };
  }
  function chansOf(s) { return P.CH.filter(function (c) { var v = s[c]; for (var i = 0; i < v.length; i += Math.max(1, Math.floor(v.length / 200))) if (!isNaN(v[i])) return true; return false; }); }
  function emptyRaw(title) {
    return [pageHead('실시간', title || '실시간 관리도'), h('section', { class: 'card empty' },
      h('p', null, '아직 2초 센서 로그가 없습니다.'),
      h('p', null, '「데이터 가져오기」에서 설비가 2초마다 보낸 로그 CSV 를 넣거나, 2초 로그 샘플(프레스 4대 × 3일)로 둘러봐 주세요.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('a', { class: 'btn btn-primary', href: '#/import' }, '데이터 가져오기로'),
        h('button', { type: 'button', class: 'btn', onclick: askRawSample }, '2초 로그 샘플로 시작')))];
  }
  function pageSpc() {
    var presses = Object.keys(raw).sort(L.natCmp);
    if (!presses.length) return emptyRaw();
    if (presses.indexOf(ui.spc.press) < 0) { ui.spc.press = presses[0]; ui.spc.die = -1; }
    var s = raw[ui.spc.press], info = infoOf(ui.spc.press), O = P.cleanOpts(db.spc), win = spcWindow(s);
    var view = { from: win.from, to: win.to, dieIdx: ui.spc.die, groupSec: ui.spc.group };
    var z = zoneOf(ui.spc.press, s, info);
    var charts = chartsFor(s, info, O, view, z), marks = marksFor(ui.spc.press);

    // 고르기
    var pSel = h('select', { 'aria-label': '프레스' }, presses.map(function (p) { return h('option', { value: p, selected: p === ui.spc.press }, p + (raw[p].type ? ' · ' + raw[p].type : '')); }));
    pSel.addEventListener('change', function () { ui.spc.press = pSel.value; ui.spc.die = -1; render(); });
    var dSel = h('select', { 'aria-label': '금형' }, h('option', { value: '-1' }, '전체 금형'), s.dies.map(function (d, i) { return d ? h('option', { value: String(i), selected: i === ui.spc.die }, d) : null; }));
    dSel.addEventListener('change', function () { ui.spc.die = Number(dSel.value); render(); });
    var gSel = h('select', { 'aria-label': '묶어 보기' }, [[0, '2초 원값(받은 그대로)'], [60, '1분 평균'], [300, '5분 평균']].map(function (x) { return h('option', { value: String(x[0]), selected: x[0] === ui.spc.group }, x[1]); }));
    gSel.addEventListener('change', function () { ui.spc.group = Number(gSel.value); render(); });
    var seg = h('div', { class: 'seg seg-sm' }, VIEWS.map(function (v) {
      return h('button', { type: 'button', class: 'btn btn-sm' + (ui.spc.view === v[0] ? ' on' : ''), 'aria-pressed': ui.spc.view === v[0] ? 'true' : 'false', onclick: function () {
        ui.spc.view = v[0];
        if (v[0] === 'custom' && !ui.spc.from) { ui.spc.from = P.toLocalInput(win.from); ui.spc.to = P.toLocalInput(win.to); }
        render();
      } }, v[1]);
    }));
    var custom = null;
    if (ui.spc.view === 'custom') {
      var fIn = h('input', { type: 'datetime-local', step: 1, value: ui.spc.from, 'aria-label': '시작' }), tIn = h('input', { type: 'datetime-local', step: 1, value: ui.spc.to, 'aria-label': '끝' });
      custom = h('div', { class: 'btn-row' }, fIn, h('span', { class: 'note' }, '~'), tIn, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.spc.from = fIn.value; ui.spc.to = tIn.value; render(); } }, '보기'));
    }
    var controls = h('section', { class: 'card spc-controls' },
      h('div', { class: 'form-grid' }, fld('프레스', pSel), fld('금형', dSel, s.dies.filter(Boolean).length > 1 ? '금형을 고르면 그 금형으로 친 때의 값만 보고, 관리 한계도 그 값으로 잡습니다.' : null),
        fld('묶어 보기', gSel, '2초 값은 정상이어도 370개에 1개꼴(약 12분에 한 번) 우연히 ±3σ 를 넘습니다. 1분 평균으로 묶으면 우연한 이탈이 줄고 서서히 바뀌는 것이 잘 보입니다.')),
      h('div', { class: 'field' }, h('span', null, '보는 구간'), seg), custom,
      h('p', { class: 'note' }, '로그 ' + P.stampText(s.t[0]) + ' ~ ' + P.stampText(s.t[s.n - 1]) + ' · ' + N(s.n) + '행 · 지금 보는 구간 ' + P.stampText(win.from) + ' ~ ' + P.stampText(win.to) +
        ' · 「최근 N분」은 로그 마지막 시각 기준입니다(새 파일을 넣으면 따라갑니다).'));

    // 마지막 값 카드
    var lastCards = h('div', { class: 'lastcards' }, charts.map(lastCard));

    // 관리도
    var figs = h('div', { class: 'spc-charts' }, charts.map(function (d) { return chartFig(d, win, O, ui.spc.group, marks); }));
    var tempD = charts.filter(function (d) { return d.zone; })[0];

    // 타수
    var r = P.rangeIdx(s, win.from, win.to), w = P.strokeWindow(s, info, r[0], r[1]);
    var stroke = h('section', { class: 'card' }, h('h2', null, '타수 · 가동률 · 정지'),
      info.counted ? [
        h('div', { class: 'tiles' },
          tile('타수', N(w.strokes) + '타', '시간당 ' + N(w.perHour, 0) + '타 (' + info.source + ' 차이)'),
          tile('기준 대비', L.pctText(w.perf), O.cycleSec + '초에 1타 = 시간당 ' + N(3600 / O.cycleSec) + '타 기준'),
          tile('시간 가동률', L.pctText(w.availability), '기록된 ' + P.durText(w.coveredSec) + ' 중 가동 ' + P.durText(w.runSec)),
          tile('정지', w.stops.length + '번', w.stops.length ? '합 ' + P.durText(w.stops.reduce(function (a, x) { return a + x.sec; }, 0)) : O.stopSec + '초 넘게 타수가 안 오른 때'),
          tile('마지막 타수 뒤', isFinite(w.sinceStroke) ? P.durText(w.sinceStroke) : '-', isFinite(w.sinceStroke) && w.sinceStroke > O.stopSec ? '정지 중으로 보임' : '가동 중'),
          tile('금형 리셋(교체)', w.resets.length + '번', w.resets.length ? w.resets.map(function (x) { return x.fromDie + '→' + x.toDie; }).join(', ') : '금형 타수가 0 으로 돌아간 때')),
        hourFig(w, O),
        w.stops.length ? h('details', { open: w.stops.length <= 8 ? true : null }, h('summary', null, '정지 구간 ' + w.stops.length + '번'),
          table(['시작', '끝', '길이', ''], w.stops.slice(-200).reverse().map(function (x) { return [P.stampText(x.from), P.stampText(x.to), P.durText(x.sec), x.open ? '진행 중' : '']; }))) : null,
        w.resets.length ? h('details', { open: true }, h('summary', null, '금형 리셋(교체) 감지 ' + w.resets.length + '번'),
          table(['시각', '바뀌기 전', '바뀐 뒤', '바뀌기 전 금형 타수', '알아낸 방법'], w.resets.map(function (x) { return [P.stampText(x.t), x.fromDie || '-', x.toDie || '-', isFinite(x.before) ? N(x.before) : '-', x.kind]; }))) : null,
        w.gaps.length ? h('details', null, h('summary', null, '기록 끊김 ' + w.gaps.length + '번 (' + O.gapSec + '초 넘게 기록이 없던 때 — 쉬는 시간·근무 외 포함)'),
          table(['끊긴 때', '다시 들어온 때', '길이'], w.gaps.slice(-200).reverse().map(function (x) { return [P.stampText(x.from), P.stampText(x.to), P.durText(x.sec)]; }))) : null
      ] : h('p', { class: 'note' }, '이 로그에는 프레스 누적 타수·금형 타수가 없어 타수를 셀 수 없습니다.'));

    // 이탈 목록
    var evs = [];
    charts.forEach(function (d) { d.events.forEach(function (e) { evs.push({ ch: d.channel, e: e, lim: d.lim, zone: d.zone }); }); });
    evs.sort(function (a, b) { return b.e.from - a.e.from; });
    var evBox = h('section', { class: 'card' }, h('h2', null, '이탈 목록 (' + N(evs.length) + '번)'),
      h('p', { class: 'note' }, '바로 이어진 이탈점은 한 번으로 묶었습니다. 온도는 ±3σ 대신 「위험 구간」에 들어간 때입니다. 최근 것부터 · 화면에는 300번까지, 엑셀에는 전부.'),
      evs.length ? table(['채널', '시작', '끝', '점 수', '규칙', '가장 먼 값', '중심선에서', '방향'], evs.slice(0, 300).map(function (x) {
        var m = CH_META[x.ch];
        return { cls: 'lv-row', cells: [m.label, P.stampText(x.e.from), x.e.to > x.e.from ? P.stampText(x.e.to, 'time') : '', N(x.e.n), x.e.rules.join(', '), fmt(x.e.peak) + ' ' + m.unit,
          x.e.zone ? '위험 ' + fmt(x.zone.dangerAt, 1) + m.unit + ' 넘음' : (x.e.z > 0 ? '+' : '') + fmt(x.e.z, 1) + 'σ', x.e.side === 'up' ? '높음' : '낮음'] };
      }), { num: [0, 0, 0, 1, 0, 1, 1, 0] }) : h('p', { class: 'note' }, '이 구간에는 켜 둔 규칙에 걸린 점이 없습니다.'),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn', onclick: function () { exportSpc(s, charts, evs, w, win); } }, '엑셀로 내려받기(이탈 목록·관리 한계·정지·리셋)')));

    return [pageHead('실시간', '실시간 관리도 — ' + ui.spc.press, '전류·전압·온도·진동을 2초 값 그대로 시간순으로 그리고, 기준 구간의 평균(중심선)과 ±3σ 관리선(UCL/LCL)으로 벗어남을 봅니다.',
      h('a', { class: 'btn', href: '#/import' }, '로그 더 넣기')),
      controls, h('h2', { class: 'sec' }, '마지막 값'), lastCards, figs, zoneCard(ui.spc.press, s, info, z, tempD), spcRulesCard(O, s, info), stroke, evBox];
  }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '-';
    if (d == null) { var a = Math.abs(v); d = a >= 100 ? 1 : a >= 10 ? 2 : 3; }
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function hourFig(w, O) {
    var hs = w.hours.filter(function (x) { return x.covered > 0; }).slice(-24);
    if (!hs.length) return null;
    var every = Math.ceil(hs.length / 12);
    var labels = hs.map(function (x, i) { return i % every ? '' : P.stampText(x.t, hs.length > 1 && P.dateOf(hs[0].t) !== P.dateOf(hs[hs.length - 1].t) ? 'md' : 'time').replace(/:00(:00)?$/, '시').replace(/ (\d\d):\d\d$/, ' $1시'); });
    return C.figure('시간별 타수' + (w.hours.length > 24 ? ' (마지막 24칸)' : '') + ' — 기준 = 기록된 시간 ÷ ' + O.cycleSec + '초', { labels: labels, type: 'bar', unit: '타',
      series: [{ name: '친 타수', values: hs.map(function (x) { return x.strokes; }), color: 'var(--series-1)' }, { name: '기준(' + O.cycleSec + '초 1타)', values: hs.map(function (x) { return Math.round(x.expected); }), color: 'var(--series-5)' }] });
  }
  function spcRulesCard(O, s, info) {
    var method = h('select', { 'aria-label': 'σ 계산' }, h('option', { value: 'sd', selected: O.method === 'sd' }, '표본 표준편차 (기본)'), h('option', { value: 'mr', selected: O.method === 'mr' }, '이동범위 MR̄ ÷ 1.128 (I-MR)'));
    var mode = h('select', { 'aria-label': '기준 구간' }, h('option', { value: 'all', selected: O.baseMode === 'all' }, '데이터가 있는 전체 구간 (기본)'), h('option', { value: 'firstN', selected: O.baseMode === 'firstN' }, '처음 N개'), h('option', { value: 'range', selected: O.baseMode === 'range' }, '기준 기간 지정'));
    var nIn = h('input', { type: 'number', min: 10, step: 1, value: O.baseN, inputmode: 'numeric', 'aria-label': '처음 몇 개' });
    var bf = h('input', { type: 'datetime-local', step: 1, value: O.baseFrom || P.toLocalInput(s.t[0]), 'aria-label': '기준 시작' });
    var bt = h('input', { type: 'datetime-local', step: 1, value: O.baseTo || P.toLocalInput(Math.min(s.t[s.n - 1], s.t[0] + 3600)), 'aria-label': '기준 끝' });
    function box(checked, t, sub) { var b = h('input', { type: 'checkbox' }); b.checked = !!checked; return { el: b, label: h('label', { class: 'opt' }, b, h('span', null, h('span', { class: 't' }, t), sub ? h('span', { class: 's' }, sub) : null)) }; }
    var warn = box(O.warnLines, '±2σ 경고선 그리기'), stops = box(O.excludeStops, '정지 구간 값은 빼기', '정지하면 전류·진동이 떨어져 늘 이탈로 나옵니다');
    var rb = { r1: box(true, '1점이 ±3σ 밖', '늘 봄'), run9: box(O.rules.run9, '연속 9점이 중심선 한쪽', '평균이 옮겨 간 것'), trend6: box(O.rules.trend6, '연속 6점 계속 증가·감소', '추세'), two3: box(O.rules.two3, '3점 중 2점이 ±2σ 밖', '같은 쪽') };
    rb.r1.el.disabled = true;
    var cyc = h('input', { type: 'number', min: 1, step: 1, value: O.cycleSec, 'aria-label': '기준 사이클(초)' });
    var stp = h('input', { type: 'number', min: 2, step: 1, value: O.stopSec, 'aria-label': '정지로 볼 시간(초)' });
    var gap = h('input', { type: 'number', min: 2, step: 1, value: O.gapSec, 'aria-label': '기록 끊김으로 볼 시간(초)' });
    var br = P.baseRange(s, info, O, ui.spc.die);
    return h('section', { class: 'card', id: 'spcRules' }, h('h2', null, '관리도 기준'),
      h('ul', { class: 'note explain' },
        h('li', null, h('strong', null, '중심선·관리선'), ' — 기준 구간 값의 평균이 중심선, 평균 ± 3σ 가 관리선(UCL·LCL)입니다. 지금 기준 구간: ' + (isFinite(br.from) ? P.stampText(br.from) + ' ~ ' + P.stampText(br.to) + ' (' + N(br.n) + '개)' : '없음') + (br.short ? ' — 값이 N개보다 적어 있는 만큼 썼습니다' : '') + (br.mode === 'all' ? '.' : '. 그래프의 옅은 띠입니다.')),
        h('li', null, h('strong', null, '기준 구간 = 데이터가 있는 전체 구간이 기본'), ' (수강생 결정 10-27) — 넣은 로그 전부(정지 구간 제외)로 평균·σ 를 잡습니다. 「처음 N개」(2차 기본, 1,800개 = 1시간)나 「기준 기간 지정」(예열이 끝난 뒤·정비 직후 등 정상이던 때)으로 바꿀 수 있습니다. 고장 직전처럼 이상한 구간까지 기준에 들어가면 σ 가 커져 늦게 잡힐 수 있습니다 — 「고장 전 이탈 맞춰 보기」에서 두 기준을 견줘 봅니다.'),
        h('li', null, h('strong', null, '온도는 ±3σ 대신 3구간'), ' — 프레스는 돌수록 온도가 오르므로 「예열 · 안정 생산 · 위험」 구간 경계로 봅니다(아래 「온도 3구간 관리선」).'),
        h('li', null, h('strong', null, 'σ 는 표본 표준편차가 기본'), ' — 이동범위(MR̄/1.128)는 하나씩 재는 값의 표준 관리도(I-MR) 방식이지만, 2초 값은 앞뒤 값이 거의 같아(자기상관) σ 가 매우 작게 잡힙니다. 받은 로그(3,600행)로 재 보니 이동범위 방식은 온도 3,425점·전류 2,520점이 관리선 밖으로 나왔고, 표본 표준편차는 0점이었습니다. 1분·5분 평균으로 묶어 볼 때는 이동범위도 쓸 만합니다.'),
        h('li', null, h('strong', null, '규칙'), ' — 1점 ±3σ 는 늘 봅니다. 「연속 9점 한쪽」 「연속 6점 증가·감소」는 2초 값에서는 정상이어도 아주 자주 걸려(받은 로그 전류 3,600점 중 3,086점이 연속 9점 한쪽) 기본은 꺼 두었습니다. 1분 평균으로 묶어 볼 때 켜 보세요.')),
      h('div', { class: 'form-grid' }, fld('σ 계산', method), fld('기준 구간', mode), fld('처음 몇 개', nIn, '2초 간격이면 1,800개 = 1시간'),
        fld('기준 기간 — 시작', bf), fld('기준 기간 — 끝', bt), h('div', { class: 'field span-all' }, h('span', null, '그리기'), h('div', { class: 'opt-grid' }, warn.label, stops.label))),
      h('div', { class: 'field', style: 'margin-top:12px' }, h('span', null, '이상 판정 규칙'), h('div', { class: 'opt-grid' }, rb.r1.label, rb.run9.label, rb.trend6.label, rb.two3.label)),
      h('div', { class: 'form-grid', style: 'margin-top:12px' }, fld('기준 사이클(초) — 몇 초에 1타', cyc, '받은 설명: 10초에 1타'), fld('정지로 볼 시간(초)', stp, '이만큼 타수가 안 오르면 정지(기본 60초 = 6사이클)'), fld('기록 끊김으로 볼 시간(초)', gap, '2초 로그 기준 30초')),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var before = P.cleanOpts(db.spc);
          db.spc = P.cleanOpts({ method: method.value, baseMode: mode.value, baseN: nIn.value, baseFrom: bf.value, baseTo: bt.value, warnLines: warn.el.checked, excludeStops: stops.el.checked,
            rules: { r1: true, run9: rb.run9.el.checked, trend6: rb.trend6.el.checked, two3: rb.two3.el.checked }, cycleSec: cyc.value, stopSec: stp.value, gapSec: gap.value });
          if (before.stopSec !== db.spc.stopSec || before.gapSec !== db.spc.gapSec || before.cycleSec !== db.spc.cycleSec || before.excludeStops !== db.spc.excludeStops) { rawInfo = {}; rebuildDaily(Object.keys(raw)); }
          save(); toast('관리도 기준을 바꿨습니다.'); render();
        } }, '기준 적용'),
        h('button', { type: 'button', class: 'btn', onclick: function () { db.spc = {}; rawInfo = {}; rebuildDaily(Object.keys(raw)); save(); toast('기본값으로 되돌렸습니다.'); render(); } }, '기본값으로')));
  }
  function exportSpc(s, charts, evs, w, win) {
    var wb = XLSX.utils.book_new(), O = P.cleanOpts(db.spc);
    var a = [['프레스', '채널', '시작', '끝', '점 수', '규칙', '가장 먼 값', '단위', '중심선에서(σ)', '방향', '중심선', 'UCL', 'LCL']];
    evs.slice().reverse().forEach(function (x) {
      var m = CH_META[x.ch], lm = x.lim;
      a.push([s.press, m.label, P.stampText(x.e.from), P.stampText(x.e.to), x.e.n, x.e.rules.join(', '), L.round(x.e.peak, 4), m.unit, x.e.zone ? null : L.round(x.e.z, 2), x.e.side === 'up' ? '높음' : '낮음',
        lm ? L.round(lm.center, 4) : null, lm ? L.round(lm.ucl, 4) : x.zone ? x.zone.dangerAt : null, lm ? L.round(lm.lcl, 4) : null]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), '이탈 목록');
    var b = [['프레스', '채널', '단위', '묶어 보기', 'σ 계산', '기준 구간 시작', '기준 구간 끝', '기준 값 수', '중심선', 'σ', 'UCL(+3σ)', 'LCL(−3σ)', '+2σ', '−2σ', '보는 구간 시작', '보는 구간 끝', '±3σ 밖 점', '연속 9점', '연속 6점', '3점 중 2점']];
    charts.forEach(function (d) { var m = CH_META[d.channel], l = d.lim || {}; b.push([s.press, m.label, m.unit, ui.spc.group ? ui.spc.group / 60 + '분 평균' : '2초 원값', O.method === 'mr' ? 'MR̄/1.128' : '표본 표준편차',
      P.stampText(d.base.from), P.stampText(d.base.to), d.lim ? d.lim.n : 0, L.round(l.center, 4), L.round(l.sigma, 5), L.round(l.ucl, 4), L.round(l.lcl, 4), L.round(l.uwl, 4), L.round(l.lwl, 4), P.stampText(win.from), P.stampText(win.to), d.count.r1, d.count.run9, d.count.trend6, d.count.two3]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b), '관리 한계');
    var c = [['시작', '끝', '길이(초)']]; w.stops.forEach(function (x) { c.push([P.stampText(x.from), P.stampText(x.to), Math.round(x.sec)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(c), '정지 구간');
    var r = [['시각', '바뀌기 전 금형', '바뀐 뒤 금형', '바뀌기 전 금형 타수', '알아낸 방법']]; w.resets.forEach(function (x) { r.push([P.stampText(x.t), x.fromDie, x.toDie, isFinite(x.before) ? x.before : null, x.kind]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r), '금형 리셋');
    var hr = [['시각(시간 칸)', '친 타수', '기준 타수', '기준 대비', '기록된 시간(분)', '가동 시간(분)']]; w.hours.forEach(function (x) { hr.push([P.stampText(x.t), x.strokes, Math.round(x.expected), x.perf == null ? null : L.round(x.perf * 100, 1), L.round(x.covered / 60, 1), L.round(x.run / 60, 1)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hr), '시간별 타수');
    var td = charts.filter(function (d) { return d.zone; })[0];
    if (td) {
      var zw = td.zw, zr = [['프레스', '예열 끝(℃)', '위험 시작(℃)', '위험 경보까지(초)', '기준', '예열(초)', '안정 생산(초)', '위험(초)', '평균 예열 시간(분)']];
      zr.push([s.press, td.zone.warmTop, td.zone.dangerAt, td.zone.holdSec, td.zone.auto ? '데이터로 잡은 기본값' : '설정한 값', Math.round(zw.sec[0]), Math.round(zw.sec[1]), Math.round(zw.sec[2]), zw.warmAvg == null ? null : L.round(zw.warmAvg / 60, 1)]);
      zr.push([]); zr.push(['예열 시작', '시작 온도', '예열 끝 온도에 닿은 때', '걸린 시간(분)']);
      zw.warmups.forEach(function (x) { zr.push([P.stampText(x.from), L.round(x.startTemp, 2), x.reached ? P.stampText(x.to) : x.already ? '이미 예열됨' : '닿지 않음', L.round(x.sec / 60, 1)]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zr), '온도 3구간');
    }
    XLSX.writeFile(wb, '관리도_' + s.press + '_' + P.stampText(win.from).slice(0, 10) + '.xlsx');
  }
  /* 대시보드 — 2초 로그 마지막 값(프레스마다, 최근 1시간 기준) */
  function rawDash() {
    var presses = Object.keys(raw).sort(L.natCmp);
    if (!presses.length) return null;
    var O = P.cleanOpts(db.spc);
    return [h('h2', { class: 'sec' }, '2초 센서 — 마지막 값', h('a', { class: 'dp-more', href: '#/spc' }, '실시간 관리도')),
      h('div', { class: 'press-grid' }, presses.map(function (p) {
        var s = raw[p], info = infoOf(p), last = s.t[s.n - 1], view = { from: last - 3600, to: last };
        var ds = chartsFor(s, info, O, view, zoneOf(p, s, info));
        var r = P.rangeIdx(s, view.from, view.to), w = P.strokeWindow(s, info, r[0], r[1]);
        var outs = ds.reduce(function (a, d) { return a + d.events.length; }, 0);
        var lastOut = ds.some(function (d) { return d.zone ? d.last && D.classify(d.last.v, d.zone) === 2 : d.lim && d.last && (d.last.v > d.lim.ucl || d.last.v < d.lim.lcl); });
        var lv = lastOut ? 'bad' : outs ? 'warn' : 'ok';
        var stopNow = info.counted && isFinite(w.sinceStroke) && w.sinceStroke > O.stopSec;
        return h('article', { class: 'pcard lv-' + lv },
          h('div', { class: 'pcard-top' }, h('div', null, h('h3', null, p), h('div', { class: 'note' }, (s.type || '종류 미입력') + ' · ' + P.stampText(last))),
            h('span', { class: 'pill lv-' + lv }, lastOut ? '관리선 밖·위험' : outs ? '최근 1시간 이탈 ' + outs + '번' : '관리선 안')),
          h('ul', { class: 'sens' }, ds.map(function (d) {
            var m = CH_META[d.channel], zc = d.zone && d.last ? D.classify(d.last.v, d.zone) : -1, bad = d.zone ? zc === 2 : d.lim && d.last && (d.last.v > d.lim.ucl || d.last.v < d.lim.lcl);
            return h('li', null, h('span', { class: 'k' }, m.label), h('span', { class: 'v' }, d.last ? fmt(d.last.v) + m.unit : '-'),
              h('span', { class: 'note' }, d.zone ? (zc >= 0 ? D.ZONES[zc].label + ' 구간' : '-') : d.lim ? fmt(d.lim.lcl) + ' ~ ' + fmt(d.lim.ucl) : '기준 없음'), bad ? pill('bad') : null);
          })),
          info.counted ? h('dl', { class: 'pstats' },
            h('dt', null, '최근 1시간 타수'), h('dd', null, N(w.strokes) + '타 · 기준 대비 ' + L.pctText(w.perf)),
            h('dt', null, '지금'), h('dd', null, stopNow ? '정지 ' + P.durText(w.sinceStroke) + ' 째' : '가동 중'),
            h('dt', null, '정지'), h('dd', null, w.stops.length ? w.stops.length + '번 · ' + P.durText(w.stops.reduce(function (a, x) { return a + x.sec; }, 0)) : '없음')) : null,
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.spc.press = p; ui.spc.die = -1; ui.spc.view = 60; location.hash = '#/spc'; } }, '관리도 보기')));
      }))];
  }

  /* ── 3차: 온도 3구간 관리선 카드 ─────────────
     프레스는 계속 돌면 온도가 오르므로 ±3σ 대신 「예열 · 안정 생산 · 위험」 경계 두 개로 봅니다(수강생 요청 10-27). */
  function zoneCard(p, s, info, z, td) {
    var box = h('section', { class: 'card', id: 'zoneCard' }, h('h2', null, '온도 3구간 관리선 — ' + p));
    if (!chansOf(s).some(function (c) { return c === 'temp'; })) { box.appendChild(h('p', { class: 'note' }, '이 로그에는 온도 값이 없습니다.')); return box; }
    var der = derivedZone(p, raw[p] || s, raw[p] ? infoOf(p) : info), R = ruleOf();
    box.appendChild(h('ul', { class: 'note explain' },
      h('li', null, h('strong', null, '왜 3구간인가'), ' — 프레스는 돌기 시작하면 온도가 오르다가(예열) 일정한 온도에서 머물고(안정 생산), 냉각이 안 되면 그 위로 넘칩니다(위험). 오르는 것이 정상이라 평균 ± 3σ 로는 아침마다 이탈이 나므로, 온도 범위를 세 구간으로 나눠 봅니다.'),
      h('li', null, h('strong', null, '기본값은 데이터로 잡음'), der ? ' — 기록이 30분 넘게 이어진 구간의 뒤쪽 절반(정지 제외, ' + N(der.n) + '개)의 중앙값 ' + fmt(der.stable, 2) + '℃ 를 안정 기준 온도로, 그 값들의 흩어짐 σs = ' + fmt(der.sigma, 3) + '℃ 로 잡았습니다. 예열 끝 = 안정 기준 − max(3σs, 2℃) = ' + fmt(der.warmTop, 1) + '℃, 위험 시작 = 안정 기준 + max(4σs, 3℃) = ' + fmt(der.dangerAt, 1) + '℃ (0.5℃ 단위).' + (der.basis === 'short' ? ' 30분 넘게 이어진 기록이 없어 있는 값 전부로 임시로 잡았습니다.' : '') : ' — 값이 모자라 잡지 못했습니다. 아래에 직접 넣어 주세요.'),
      h('li', null, h('strong', null, '설비 기준이 있으면 그 값으로'), ' — 유압유 허용 온도·제조사 권장 범위처럼 정해진 값이 있으면 아래에 넣어 주세요. 프레스마다 따로 저장합니다.'),
      h('li', null, h('strong', null, '경보'), ' — 위험 구간에 ' + (z ? z.holdSec : R.holdSec) + '초 넘게 머물면 경보. 예열 시간 = 기록이 다시 시작된 때(아침·점심 뒤)부터 예열 끝 온도에 처음 닿을 때까지.')));
    if (z && td && td.zw) {
      var zw = td.zw, tot = zw.total || 1;
      var al = zw.dangers.filter(function (x) { return x.alarm; });
      box.appendChild(h('div', { class: 'tiles' },
        tile('예열', P.durText(zw.sec[0]), L.pctText(zw.sec[0] / tot) + ' · ' + fmt(z.warmTop, 1) + '℃ 아래'),
        tile('안정 생산', P.durText(zw.sec[1]), L.pctText(zw.sec[1] / tot) + ' · ' + fmt(z.warmTop, 1) + ' ~ ' + fmt(z.dangerAt, 1) + '℃'),
        tile('위험', P.durText(zw.sec[2]), L.pctText(zw.sec[2] / tot) + ' · ' + fmt(z.dangerAt, 1) + '℃ 위 · 경보 ' + al.length + '번'),
        tile('예열 시간', zw.warmAvg == null ? '-' : '평균 ' + P.durText(zw.warmAvg), zw.warmMax == null ? '이 구간에 예열이 없음' : '가장 길게 ' + P.durText(zw.warmMax) + ' · ' + zw.warmups.filter(function (x) { return x.reached; }).length + '번')));
      if (zw.warmups.length) box.appendChild(h('details', { open: zw.warmups.length <= 12 ? true : null }, h('summary', null, '예열 ' + zw.warmups.length + '번 (지금 보는 구간)'),
        table(['시작', '시작 온도', '예열 끝 온도에 닿은 때', '걸린 시간'], zw.warmups.slice(-60).reverse().map(function (x) {
          return [P.stampText(x.from), fmt(x.startTemp, 1) + '℃', x.reached ? P.stampText(x.to, 'time') : x.already ? '이미 예열됨' : x.open ? '아직 예열 중' : '닿지 않음', x.reached ? P.durText(x.sec) : x.already ? '0' : P.durText(x.sec) + '+'];
        }), { num: [0, 1, 0, 1] })));
      if (zw.dangers.length) box.appendChild(h('details', { open: true }, h('summary', null, '위험 구간 ' + zw.dangers.length + '번 (경보 ' + al.length + '번)'),
        table(['들어간 때', '나온 때', '머문 시간', '가장 높은 값', '경보'], zw.dangers.slice(-100).reverse().map(function (x) {
          return { cls: x.alarm ? 'row-bad' : null, cells: [P.stampText(x.from), P.stampText(x.to, 'time'), P.durText(x.sec), fmt(x.peak, 1) + '℃', x.alarm ? '경보(' + z.holdSec + '초 넘음)' : '짧게 — 경보 아님'] };
        }), { num: [0, 0, 1, 1, 0] })));
    }
    var wIn = h('input', { type: 'number', step: 0.5, inputmode: 'decimal', value: z ? z.warmTop : '', 'aria-label': '예열 끝 온도' });
    var dIn = h('input', { type: 'number', step: 0.5, inputmode: 'decimal', value: z ? z.dangerAt : '', 'aria-label': '위험 시작 온도' });
    var hIn = h('input', { type: 'number', min: 0, step: 2, inputmode: 'numeric', value: z ? z.holdSec : R.holdSec, 'aria-label': '위험 경보까지(초)' });
    var ex = h('input', { type: 'checkbox' }); ex.checked = R.excludeWarm;
    box.appendChild(h('div', { class: 'form-grid', style: 'margin-top:12px' },
      fld('예열 끝 온도(℃) — 이 아래는 예열', wIn, der ? '데이터 기본값 ' + fmt(der.warmTop, 1) + '℃' : null),
      fld('위험 시작 온도(℃) — 이 위는 위험', dIn, der ? '데이터 기본값 ' + fmt(der.dangerAt, 1) + '℃' : null),
      fld('위험 경보까지(초)', hIn, '위험 구간에 이만큼 넘게 머물면 경보(기본 30초)'),
      h('div', { class: 'field span-all' }, h('span', null, '예열 중 다른 값'), h('div', { class: 'opt-grid' }, h('label', { class: 'opt' }, ex, h('span', null, h('span', { class: 't' }, '예열 구간의 전류·전압·진동 이탈은 빼기(기본)'), h('span', { class: 's' }, '차가울 때는 전류·진동이 평소와 달라 아침마다 이탈로 나옵니다')))))));
    box.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var w = Number(wIn.value), d = Number(dIn.value), hs = Number(hIn.value);
        if (!(isFinite(w) && isFinite(d) && d > w)) { toast('위험 시작 온도가 예열 끝 온도보다 높아야 합니다.', true); return; }
        db.zones[p] = { warmTop: w, dangerAt: d, holdSec: isFinite(hs) && hs >= 0 ? hs : 30 };
        var r = D.cleanRule(db.pdm); r.excludeWarm = ex.checked; db.pdm = r;
        leadCache = null; save(); toast(p + ' 온도 3구간 기준을 바꿨습니다.'); render();
      } }, p + ' 기준 적용'),
      h('button', { type: 'button', class: 'btn', onclick: function () { delete db.zones[p]; leadCache = null; save(); toast(p + ' 은(는) 데이터로 잡은 기본값을 씁니다.'); render(); } }, '데이터로 잡은 기본값으로')));
    return box;
  }

  /* ── 3차: 고장 전 이탈 맞춰 보기(리드타임) ─────────────
     고장 이력마다 그 앞(기본 24시간, 같은 프레스의 앞선 고장·정비 뒤부터) 안에 처음 울린 경보를 찾아 몇 시간·몇 타 먼저였는지 셉니다. */
  var leadCache = null;
  function leadData(excludePre) {
    var ps = Object.keys(raw).sort(L.natCmp);
    var key = ps.map(function (p) { return p + ':' + raw[p].n; }).join(',') + '|' + JSON.stringify(db.spc) + JSON.stringify(db.pdm) + JSON.stringify(db.zones) + JSON.stringify(db.events) + '|' + !!excludePre;
    if (leadCache && leadCache[key]) return leadCache[key];
    var infos = {}, zones = {};
    ps.forEach(function (p) { infos[p] = infoOf(p); zones[p] = zoneOf(p, raw[p], infos[p]); });
    var r = D.leadAnalysis({ series: raw, infos: infos, events: db.events, opts: db.spc, zones: zones, rule: db.pdm, excludePre: !!excludePre });
    r.zones = zones;
    if (!leadCache || Object.keys(leadCache).length > 4) leadCache = {};
    leadCache[key] = r;
    return r;
  }
  function hoursText(sec) { return sec == null ? '-' : sec >= 3600 ? fmt(sec / 3600, 1) + '시간' : P.durText(sec); }
  var CLS_LABEL = { pre: '고장 전', during: '고장 중·직후', 'false': '헛경보 후보' };
  function segsOf(s) {
    var out = [], a = s.t[0];
    for (var i = 1; i < s.n; i++) if (s.t[i] - s.t[i - 1] > 3600) { out.push([a, s.t[i - 1]]); a = s.t[i]; }
    if (s.n) out.push([a, s.t[s.n - 1]]);
    return out;
  }
  function pageLead() {
    var head = pageHead('이력', '고장 전 이탈 맞춰 보기', '관리도의 이탈(경보)이 고장·정비 이력보다 몇 시간·몇 타 먼저 나타났는지 봅니다. 「이탈이 고장 전에 미리 보였나」를 확인해 관리선·경보 기준을 정하는 화면입니다.');
    var ps = Object.keys(raw).sort(L.natCmp), out = [head];
    if (db.sampleKind === 'virtual') out.push(h('p', { class: 'alert warn' }, h('strong', null, '가상 데이터입니다. '), '프레스 3대의 2초 로그·고장·정비·금형 교체 이력은 모두 지어낸 값입니다(수강생 결정 10-27). 실제 설비 로그와 고장 이력을 넣으면 같은 화면에서 실제 리드타임이 나옵니다.'));
    if (!ps.length) {
      out.push(h('section', { class: 'card empty' }, h('p', null, '아직 2초 센서 로그가 없습니다.'),
        h('p', null, '가상 고장 데이터(프레스 3대 × 5일 + 이력)로 둘러보거나, 2초 로그를 가져온 뒤 아래에 고장·정비 이력을 넣어 주세요.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: askVirtual }, '가상 고장 데이터로 시작'), h('a', { class: 'btn', href: '#/import' }, '데이터 가져오기로'))));
      out.push(eventsCard(ps));
      return out;
    }
    var R = ruleOf(), O = P.cleanOpts(db.spc);
    var A1 = leadData(false), A2 = O.baseMode === 'all' ? leadData(true) : null, st = A1.stats;
    var baseName = O.baseMode === 'all' ? '전체 구간' : O.baseMode === 'firstN' ? '처음 ' + N(O.baseN) + '개' : '기준 기간';
    out.push(h('div', { class: 'tiles' },
      tile('고장 이력', st.failures + '건', (db.events || []).length + '건 중 고장 · 2초 로그가 있는 프레스'),
      tile('미리 잡은 고장', st.failures ? st.detected + ' / ' + st.failures : '-', '고장 전 ' + R.lookbackH + '시간 안에 경보가 울린 고장'),
      tile('리드타임(중앙값)', hoursText(st.leadMedian), st.leadMin != null ? hoursText(st.leadMin) + ' ~ ' + hoursText(st.leadMax) + ' · 첫 경보 → 고장' : '경보가 앞서 울린 고장이 없음'),
      tile('헛경보 후보', st.falseAlarms + '번', '어느 고장 앞에도 들지 않은 경보')));
    if (A2) out.push(h('section', { class: 'card' }, h('h2', null, '관리선 기준 구간에 따라'),
      h('p', { class: 'note' }, '기본(수강생 결정)은 「데이터가 있는 전체 구간」입니다. 이 경우 고장 직전의 이상한 값까지 평균·σ 에 들어가 σ 가 커지므로, 고장 전 구간(살펴본 시간 + 고장 정지 시간)을 기준에서 뺀 경우와 견줘 봅니다. 앞당겨 잡는 만큼 헛경보도 늘 수 있습니다.'),
      table(['관리선 기준', '미리 잡은 고장', '리드타임 중앙값', '가장 짧게 ~ 길게', '타수(중앙값)', '헛경보 후보'], [A1, A2].map(function (a, i) {
        var x = a.stats;
        return [i ? '전체 구간 − 고장 전 구간' : '전체 구간 (지금 기본)', x.detected + ' / ' + x.failures, hoursText(x.leadMedian), x.leadMin != null ? hoursText(x.leadMin) + ' ~ ' + hoursText(x.leadMax) : '-', x.strokesMedian == null ? '-' : N(x.strokesMedian) + '타', x.falseAlarms + '번'];
      }), { num: [0, 1, 1, 1, 1, 1] })));
    // 고장마다
    A1.failures.forEach(function (f) {
      var s = raw[f.press], info = infoOf(f.press), z = A1.zones[f.press];
      var card = h('section', { class: 'card lead-fail' }, h('h2', null, f.press + ' · ' + f.ev.at.slice(5, 16) + ' 고장 — ' + (f.ev.part || ''), f.ev.virtual ? h('span', { class: 'pill lv-none' }, '가상') : null),
        h('p', null, f.first ? [h('strong', null, '첫 경보 ' + P.stampText(f.first.trigger) + ' · ' + CH_META[f.first.ch].label), ' — 고장 ', h('strong', null, hoursText(f.lead) + ' 전'), f.strokes != null ? ', ' + N(f.strokes) + '타 전' : '', '.']
          : '살펴본 구간(' + P.stampText(f.from) + ' ~ 고장)에 경보가 없었습니다 — 이 고장은 관리도로 미리 잡지 못했습니다.' + (f.covered ? '' : ' (이 구간의 2초 로그가 모자랍니다)')),
        h('p', { class: 'note' }, '살펴본 구간: ' + P.stampText(f.from) + ' ~ ' + P.stampText(f.at) + ' (고장 전 ' + R.lookbackH + '시간, 같은 프레스의 앞선 고장·정비가 있으면 그 뒤부터)' + (f.ev.note ? ' · 기록: ' + f.ev.note : '')),
        table(['채널', '첫 경보', '고장까지', '타수', '이 구간 경보', '처음 벗어난 값'], ['current', 'voltage', 'temp', 'vib'].filter(function (c) { return s[c] && chansOf(s).indexOf(c) >= 0; }).map(function (c) {
          var b = f.byChannel[c], cnt = f.alarms.filter(function (a) { return a.ch === c; }).length;
          return b ? { cls: b.alarm === f.first ? 'row-bad' : null, cells: [CH_META[c].label, P.stampText(b.alarm.trigger), hoursText(b.lead), b.strokes == null ? '-' : N(b.strokes) + '타', cnt + '번', b.alarm.zone ? '위험 ' + fmt(z.dangerAt, 1) + '℃ 위 ' + fmt(b.alarm.peak, 1) + '℃' : fmt(b.alarm.peak) + CH_META[c].unit + ' (' + (b.alarm.z > 0 ? '+' : '') + fmt(b.alarm.z, 1) + 'σ)'] }
            : [CH_META[c].label, '없음', '-', '-', '0번', '-'];
        }), { num: [0, 0, 1, 1, 1, 0] }));
      var ch = f.first ? f.first.ch : 'current';
      var view = { from: Math.max(s.t[0], f.from), to: Math.min(s.t[s.n - 1], f.at + 1800), dieIdx: -1, groupSec: 60 };
      var d = chartsFor(s, info, O, view, z).filter(function (x) { return x.channel === ch; })[0];
      if (d) card.appendChild(chartFig(d, { from: view.from, to: view.to, noBase: true }, O, 60, marksFor(f.press)));
      out.push(card);
    });
    // 시간 줄
    out.push(h('section', { class: 'card' }, h('h2', null, '시간 줄 — 경보와 이력'),
      h('p', { class: 'note' }, '가로축은 기록이 있는 시간만 이어 붙였습니다(밤·점심처럼 1시간 넘게 기록이 없는 때는 좁은 틈). 빨간 막대 = 고장 전에 울린 경보, 주황 = 헛경보 후보, 회색 = 고장 중·직후. 옅은 붉은 띠 = 고장 전 살펴본 구간, ▼ 고장 · ◆ 정비 · ■ 금형 교체. 막대에 마우스를 올리면 시각이 보입니다.'),
      ps.map(function (p) {
        var s = raw[p], wins = A1.failures.filter(function (f) { return f.press === p; });
        var lanes = ['current', 'voltage', 'temp', 'vib'].filter(function (c) { return chansOf(s).indexOf(c) >= 0; }).map(function (c) {
          return { label: CH_META[c].label, items: A1.alarms.filter(function (a) { return a.press === p && a.ch === c; }).map(function (a) {
            return { from: a.from, to: a.to, cls: 'tl-' + a.cls, title: P.stampText(a.trigger) + ' 경보 · ' + CLS_LABEL[a.cls] + ' · ' + N(a.n) + '점' };
          }) };
        });
        var evs = (db.events || []).filter(function (e) { return e.press === p; }).map(function (e) { return { t: P.parseStamp(e.at), kind: e.kind, label: e.part }; });
        return h('figure', { class: 'fig' }, h('figcaption', null, p + (s.type ? ' · ' + s.type : '')), C.timeline({ segs: segsOf(s), lanes: lanes, events: evs, windows: wins.map(function (f) { return { from: f.from, to: f.at }; }), title: p + ' 경보와 이력' }));
      })));
    // 경보 목록
    var al = A1.alarms.slice().sort(function (a, b) { return b.trigger - a.trigger; });
    out.push(h('section', { class: 'card' }, h('h2', null, '경보 목록 (' + al.length + '번)'),
      h('p', { class: 'note' }, '경보 = ' + (R.groupSec ? (R.groupSec / 60) + '분 평균' : '2초 값') + '이 ' + Math.round(R.winSec / 60) + '분 안에 ±3σ 밖으로 ' + R.minCount + '번 이상 나간 때(온도는 위험 구간에 ' + R.holdSec + '초 넘게 머문 때)' + (R.excludeWarm ? ' · 예열 구간 이탈은 뺌' : '') + '. 관리선 기준: ' + baseName + '.'),
      al.length ? table(['프레스', '채널', '경보 시각', '처음 벗어난 때', '끝', '점 수', '가장 먼 값', '판정'], al.slice(0, 300).map(function (a) {
        var m = CH_META[a.ch];
        return { cls: a.cls === 'pre' ? 'row-bad' : a.cls === 'false' ? 'row-warn' : null, cells: [a.press, m.label, P.stampText(a.trigger), P.stampText(a.from, 'time'), P.stampText(a.to, 'time'), N(a.n), fmt(a.peak) + m.unit + (a.zone ? '' : ' (' + (a.z > 0 ? '+' : '') + fmt(a.z, 1) + 'σ)'), CLS_LABEL[a.cls] + (a.failure ? ' — ' + a.failure.ev.at.slice(5, 16) + ' ' + a.failure.ev.part : '')] };
      }), { num: [0, 0, 0, 0, 0, 1, 1, 0] }) : h('p', { class: 'note' }, '경보가 없습니다.'),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn', onclick: function () { exportLead(A1, A2); } }, '엑셀로 내려받기(고장별 리드타임·경보 목록·이력)'))));
    out.push(leadRulesCard(R));
    out.push(eventsCard(ps));
    return out;
  }
  function exportLead(A1, A2) {
    var wb = XLSX.utils.book_new();
    var f = [['프레스', '고장 일시', '내용', '살펴본 구간 시작', '첫 경보', '첫 경보 채널', '리드타임(시간)', '타수', '전류(시간 전)', '전압(시간 전)', '온도(시간 전)', '진동(시간 전)', '가상']];
    A1.failures.forEach(function (x) {
      var hr = function (c) { return x.byChannel[c] ? L.round(x.byChannel[c].lead / 3600, 2) : null; };
      f.push([x.press, x.ev.at, x.ev.part, P.stampText(x.from), x.first ? P.stampText(x.first.trigger) : null, x.first ? CH_META[x.first.ch].label : null, x.lead == null ? null : L.round(x.lead / 3600, 2), x.strokes, hr('current'), hr('voltage'), hr('temp'), hr('vib'), x.ev.virtual ? '가상' : '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f), '고장별 리드타임');
    var s = [['관리선 기준', '고장', '미리 잡음', '리드타임 중앙값(시간)', '최소(시간)', '최대(시간)', '타수 중앙값', '헛경보 후보']];
    [A1, A2].forEach(function (a, i) { if (!a) return; var x = a.stats; s.push([i ? '전체 구간 − 고장 전 구간' : '지금 기준', x.failures, x.detected, x.leadMedian == null ? null : L.round(x.leadMedian / 3600, 2), x.leadMin == null ? null : L.round(x.leadMin / 3600, 2), x.leadMax == null ? null : L.round(x.leadMax / 3600, 2), x.strokesMedian, x.falseAlarms]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s), '요약');
    var a = [['프레스', '채널', '경보 시각', '처음 벗어난 때', '끝', '점 수', '가장 먼 값', 'σ', '판정', '이어진 고장']];
    A1.alarms.forEach(function (x) { a.push([x.press, CH_META[x.ch].label, P.stampText(x.trigger), P.stampText(x.from), P.stampText(x.to), x.n, L.round(x.peak, 3), x.zone ? null : L.round(x.z, 2), CLS_LABEL[x.cls], x.failure ? x.failure.ev.at + ' ' + x.failure.ev.part : '']); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), '경보 목록');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(D.eventsToAoa(db.events)), '고장·정비 이력');
    XLSX.writeFile(wb, '고장전이탈_리드타임.xlsx');
  }
  function leadRulesCard(R) {
    var lb = h('input', { type: 'number', min: 1, step: 1, value: R.lookbackH, 'aria-label': '고장 전 살펴볼 시간' });
    var win = h('input', { type: 'number', min: 1, step: 1, value: Math.round(R.winSec / 60), 'aria-label': '경보 — 몇 분 안에' });
    var mc = h('input', { type: 'number', min: 1, step: 1, value: R.minCount, 'aria-label': '경보 — 이탈 몇 번' });
    var gp = h('select', { 'aria-label': '경보에 쓸 값' }, [[0, '2초 원값 (기본)'], [60, '1분 평균']].map(function (x) { return h('option', { value: String(x[0]), selected: x[0] === R.groupSec }, x[1]); }));
    var boxes = ['current', 'voltage', 'temp', 'vib'].map(function (c) { var b = h('input', { type: 'checkbox' }); b.checked = !!R.channels[c]; return { id: c, el: b, label: h('label', { class: 'opt' }, b, h('span', { class: 't' }, CH_META[c].label)) }; });
    return h('section', { class: 'card', id: 'leadRules' }, h('h2', null, '경보 · 리드타임 기준'),
      h('ul', { class: 'note explain' },
        h('li', null, '2초 값은 정상이어도 370개에 1개꼴로 ±3σ 를 넘습니다. 그래서 「몇 분 안에 몇 번」 넘을 때를 경보로 봅니다(기본 10분 안에 5번).'),
        h('li', null, '고장 전 살펴볼 시간(기본 24시간) 안에서 처음 울린 경보를 「미리 보인 이탈」로 셉니다. 같은 프레스에 앞선 고장·정비가 있으면 그 뒤부터 봅니다.'),
        h('li', null, '관리선 자체(중심선·σ·기준 구간)는 「실시간 관리도 → 관리도 기준」, 온도 경계는 「온도 3구간 관리선」에서 바꿉니다.')),
      h('div', { class: 'form-grid' }, fld('고장 전 살펴볼 시간(시간)', lb), fld('경보 — 몇 분 안에', win), fld('경보 — ±3σ 밖 몇 번 이상', mc), fld('경보에 쓸 값', gp),
        h('div', { class: 'field span-all' }, h('span', null, '경보로 볼 채널'), h('div', { class: 'opt-grid' }, boxes.map(function (b) { return b.label; })))),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var ch = {}; boxes.forEach(function (b) { ch[b.id] = b.el.checked; });
          db.pdm = D.cleanRule({ lookbackH: lb.value, winSec: Number(win.value) * 60, minCount: mc.value, groupSec: gp.value, channels: ch, holdSec: R.holdSec, excludeWarm: R.excludeWarm });
          leadCache = null; save(); toast('경보 · 리드타임 기준을 바꿨습니다.'); render();
        } }, '기준 적용'),
        h('button', { type: 'button', class: 'btn', onclick: function () { db.pdm = {}; leadCache = null; save(); toast('기본값으로 되돌렸습니다.'); render(); } }, '기본값으로')));
  }
  function eventsCard(ps) {
    var list = (db.events || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var at = h('input', { type: 'datetime-local', step: 1, 'aria-label': '일시' });
    var pr = h('input', { type: 'text', list: 'pressList', placeholder: 'P1', 'aria-label': '프레스' });
    var dl = h('datalist', { id: 'pressList' }, ps.concat(Object.keys(db.presses)).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (p) { return h('option', { value: p }); }));
    var kd = h('select', { 'aria-label': '구분' }, D.KINDS.map(function (k) { return h('option', { value: k }, k); }));
    var pt = h('input', { type: 'text', placeholder: '예: 주축 베어링 손상', 'aria-label': '내용' });
    var dm = h('input', { type: 'number', min: 0, step: 1, value: 0, 'aria-label': '정지(분)' });
    var file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    file.addEventListener('change', function () {
      var f = file.files[0]; if (!f) return;
      f.arrayBuffer().then(function (buf) {
        var u8 = new Uint8Array(buf), wb = /\.csv$/i.test(f.name) ? XLSX.read(L.decodeCsv(u8).text, { type: 'string', raw: true }) : XLSX.read(u8, { type: 'array', cellDates: false });
        var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
        var r = D.eventsFromAoa(aoa);
        if (r.error) { toast(r.error, true); return; }
        var keys = {}; (db.events || []).forEach(function (e) { keys[e.at + '|' + e.press + '|' + e.kind] = 1; });
        var add = r.events.filter(function (e) { return !keys[e.at + '|' + e.press + '|' + e.kind]; });
        db.events = (db.events || []).concat(add); leadCache = null; save();
        toast('이력 ' + add.length + '건을 넣었습니다' + (r.events.length - add.length ? ' (같은 것 ' + (r.events.length - add.length) + '건 건너뜀)' : '') + (r.skipped ? ' · 못 읽은 행 ' + r.skipped : '') + '.'); render();
      }).catch(function (e) { toast('읽지 못했습니다: ' + e.message, true); });
      file.value = '';
    });
    return h('section', { class: 'card', id: 'events' }, h('h2', null, '고장 · 정비 · 금형 교체 이력 (' + list.length + '건)'),
      list.length ? table(['일시', '프레스', '구분', '내용', '메모', '정지', ''], list.map(function (e) {
        return { cls: e.kind === '고장' ? 'row-bad' : null, cells: [e.at, e.press, h('span', null, e.kind, e.virtual ? h('span', { class: 'pill lv-none tiny' }, '가상') : null), e.part || '-', e.note || '', e.downMin ? e.downMin + '분' : '-',
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'aria-label': e.at + ' ' + e.press + ' 이력 지우기', onclick: function () { if (!confirm(e.at + ' ' + e.press + ' ' + e.kind + ' 이력을 지울까요?')) return; db.events = db.events.filter(function (x) { return x !== e; }); leadCache = null; save(); render(); } }, '지우기')] };
      }), { num: [0, 0, 0, 0, 0, 1, 0] }) : h('p', { class: 'note' }, '아직 없습니다. 아래에서 넣거나 엑셀·CSV(머리행: 일시 · 프레스 · 구분 · 내용 · 메모 · 정지(분))로 가져와 주세요.'),
      h('h3', { style: 'margin-top:14px' }, '이력 넣기'),
      h('div', { class: 'form-grid' }, fld('일시', at), fld('프레스', h('span', null, pr, dl)), fld('구분', kd), fld('내용', pt, '고장 부위·정비 내용·금형 이름'), fld('정지(분)', dm, '고장으로 멈춘 시간 — 그 동안의 경보는 「고장 중」으로 셉니다')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var e = D.cleanEvent({ at: P.fromLocalInput(at.value), press: pr.value, kind: kd.value, part: pt.value, downMin: dm.value });
          if (!e) { toast('일시와 프레스를 넣어 주세요.', true); return; }
          db.events = (db.events || []).concat([e]); leadCache = null; save(); toast('이력을 넣었습니다.'); render();
        } }, '이력 넣기'),
        h('label', { class: 'btn' }, file, '엑셀·CSV 로 가져오기'),
        h('button', { type: 'button', class: 'btn', onclick: function () { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(D.eventsToAoa(db.events)), '고장·정비 이력'); XLSX.writeFile(wb, '고장정비이력.xlsx'); } }, '엑셀로 내려받기'),
        list.some(function (e) { return e.virtual; }) ? h('button', { type: 'button', class: 'btn', onclick: function () { if (!confirm('가상 이력만 지울까요?')) return; db.events = db.events.filter(function (e) { return !e.virtual; }); leadCache = null; save(); render(); } }, '가상 이력만 지우기') : null));
  }

  /* ── 3차: 실시간 연결 ─────────────
     내장 시뮬레이터 · HTTP(S) 주소 받기(N초마다) · WebSocket. 받은 값은 이 브라우저 메모리에 최근 6시간만 두고(「2초 로그에 합치기」로 저장),
     관리선은 그 프레스의 가져온 2초 로그가 있으면 그것으로 잡은 값을, 없으면 받은 값으로 잡습니다. 그 요청 말고는 아무것도 밖으로 보내지 않습니다. */
  var live = { src: null, buf: LV.createBuffer({ keepSec: 6 * 3600 }), status: { state: 'stopped', msg: '' }, alarms: [], seen: {}, recv: [], lastRecv: NaN, rows: 0, unseen: 0, timer: null, kind: '', paintAt: 0, paintTimer: null, limCache: {}, frozen: {} };
  function liveCfg() {
    var c = db.live || {};
    return { kind: c.kind === 'poll' || c.kind === 'ws' ? c.kind : 'sim', url: c.url || '', wsUrl: c.wsUrl || '', intervalSec: c.intervalSec > 0 ? c.intervalSec : 2, speed: c.speed > 0 ? c.speed : 1, prefill: c.prefill !== false };
  }
  function liveRunning() { return !!(live.src && live.src.running()); }
  function liveStart(cfg) {
    liveStop(true);
    live.kind = cfg.kind; live.buf.clear(); live.alarms = []; live.seen = {}; live.recv = []; live.rows = 0; live.unseen = 0; live.lastRecv = NaN; live.limCache = {}; live.frozen = {};
    var handlers = { onRows: liveOnRows, onStatus: function (st) { live.status = st; livePaintStatus(); }, since: function () { return live.buf.lastTime(); } };
    if (cfg.kind === 'sim') live.src = LV.createSource('sim', { speed: cfg.speed, prefillMin: cfg.prefill ? 30 : 0 }, handlers);
    else if (cfg.kind === 'poll') live.src = LV.createSource('poll', { url: cfg.url, intervalSec: cfg.intervalSec }, handlers);
    else live.src = LV.createSource('ws', { url: cfg.wsUrl }, handlers);
    live.src.start();
    clearInterval(live.timer); live.timer = setInterval(livePaintStatus, 1000);
  }
  function liveStop(quiet) {
    if (live.src) live.src.stop();
    clearInterval(live.timer); live.timer = null;
    if (!quiet) livePaintStatus();
  }
  function liveOnRows(rows, meta) {
    meta = meta || {};
    if (!meta.prefill) { var now = Date.now(); live.recv.push(now); if (live.recv.length > 30) live.recv.shift(); live.lastRecv = now; }
    var a = live.buf.append(rows, P.cleanOpts(db.spc).gapSec);
    live.rows += a.added;
    if (a.added) liveCheckAlarms(a.presses, !!meta.prefill);
    if (route().id === 'live') liveSchedulePaint(); else if (a.added) updateNavBadge();
  }
  /* 관리 한계 — 그 프레스의 가져온 2초 로그가 있으면 그것으로, 없으면 받기 시작한 처음 10분(300개 이상)으로 잡아 고정 */
  function liveLims(p) {
    if (!raw[p]) {
      var fr = live.frozen[p] || (live.frozen[p] = {});
      if (fr.lims) return fr.lims;
      var s = live.buf.series(p); if (!s || s.n < 300) return null;
      var si = P.strokeInfo(s, db.spc), o = P.cleanOpts(db.spc), lm = {};
      o.baseMode = 'all';
      P.CH.forEach(function (ch) { lm[ch] = P.chartData(s, si, ch, o, {}).lim; });
      fr.lims = lm; fr.n = s.n; fr.from = s.t[0]; fr.to = s.t[s.n - 1];
      return lm;
    }
    var key = raw[p].n + '|' + JSON.stringify(db.spc), c = live.limCache[p];
    if (c && c.key === key) return c.lims;
    var lims = {}, info = infoOf(p);
    P.CH.forEach(function (ch) { if (ch !== 'temp' || !zoneOf(p, raw[p], info)) lims[ch] = P.chartData(raw[p], info, ch, db.spc, {}).lim; });
    live.limCache[p] = { key: key, lims: lims };
    return lims;
  }
  function liveCheckAlarms(presses, quiet) {
    var R = ruleOf();
    presses.forEach(function (p) {
      var s = live.buf.series(p); if (!s || s.n < 30) return;
      var info = P.strokeInfo(s, db.spc), z = zoneOf(p, s, info);
      D.pressAlarms(s, info, db.spc, z, R, { lims: liveLims(p) || undefined }).forEach(function (a) {
        var key = p + '|' + a.ch + '|' + a.trigger;
        if (live.seen[key]) return;
        live.seen[key] = 1;
        live.alarms.unshift({ press: p, a: a, at: Date.now(), quiet: quiet });
        if (!quiet) { live.unseen++; toast('경보 — ' + p + ' ' + CH_META[a.ch].label + (a.zone ? ' 위험 구간 ' + fmt(a.peak, 1) + '℃' : ' ±3σ 밖 ' + a.n + '번(' + (a.z > 0 ? '+' : '') + fmt(a.z, 1) + 'σ)') + ' · ' + P.stampText(a.trigger, 'time'), true); }
      });
    });
    if (live.alarms.length > 300) live.alarms.length = 300;
  }
  function liveSchedulePaint() {
    var wait = 700 - (Date.now() - live.paintAt);
    if (live.paintTimer) return;
    live.paintTimer = setTimeout(function () { live.paintTimer = null; live.paintAt = Date.now(); if (route().id === 'live') liveRefresh(); }, Math.max(0, wait));
  }
  function updateNavBadge() {
    var a = document.querySelector('#nav a[href="#/live"] .t'); if (!a) return;
    var b = a.querySelector('.nav-badge');
    if (!live.unseen) { if (b) b.remove(); return; }
    if (!b) { b = h('span', { class: 'nav-badge', title: '새 경보' }); a.appendChild(b); }
    b.textContent = String(live.unseen);
  }
  var LIVE_STATE = { stopped: ['멈춤', 'none'], connecting: ['연결 중', 'warn'], live: ['받는 중', 'ok'], error: ['오류', 'bad'] };
  function livePaintStatus() {
    var el = document.getElementById('liveStatus'); if (!el) return;
    var st = live.status || { state: 'stopped' }, lab = LIVE_STATE[st.state] || ['-', 'none'], info = live.src ? live.src.info : {};
    var lastT = live.buf.lastTime(), nowW = VD.wallNow(), ago = isFinite(live.lastRecv) ? (Date.now() - live.lastRecv) / 1000 : NaN;
    var iv = live.recv.length > 1 ? (live.recv[live.recv.length - 1] - live.recv[0]) / (live.recv.length - 1) / 1000 : NaN;
    var lag = isFinite(lastT) && live.kind !== 'sim' ? nowW - lastT : NaN, gaps = live.buf.stat.gaps, stale = isFinite(ago) && liveRunning() && ago > Math.max(10, (liveCfg().intervalSec || 2) * 3);
    el.innerHTML = '';
    add(el, [
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '상태'), h('span', { class: 'pill lv-' + (stale ? 'warn' : lab[1]) }, stale ? '받는 것이 멈춤' : lab[0]), h('span', { class: 'note ls-msg' }, st.msg || '')),
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '마지막 수신'), h('span', { class: 'v' }, isFinite(ago) ? (ago < 1 ? '방금' : Math.round(ago) + '초 전') : '-'), h('span', { class: 'note' }, isFinite(iv) ? '받는 간격 평균 ' + fmt(iv, 1) + '초' : '')),
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '마지막 데이터 시각'), h('span', { class: 'v' }, isFinite(lastT) ? P.stampText(lastT, 'md') + ':' + P.stampText(lastT, 'time').slice(6) : '-'), h('span', { class: 'note' }, isFinite(lag) ? '지금보다 ' + (lag >= 0 ? P.durText(lag) + ' 늦음' : P.durText(-lag) + ' 빠름(시계 차이)') : live.kind === 'sim' ? '시뮬레이터 시계' : '')),
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '받은 행'), h('span', { class: 'v' }, N(live.rows)), h('span', { class: 'note' }, '프레스 ' + live.buf.presses().length + '대' + (live.buf.stat.dup ? ' · 같은 시각 ' + N(live.buf.stat.dup) + '행 건너뜀' : '') + (live.buf.stat.old ? ' · 지난 시각 ' + N(live.buf.stat.old) + '행 건너뜀' : ''))),
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '시간 틈(기록 끊김)'), h('span', { class: 'v' }, gaps.length + '번'), h('span', { class: 'note' }, gaps.length ? '마지막 ' + gaps[gaps.length - 1].press + ' ' + P.stampText(gaps[gaps.length - 1].from, 'time') + '부터 ' + P.durText(gaps[gaps.length - 1].sec) : P.cleanOpts(db.spc).gapSec + '초 넘게 비면 셈')),
      h('div', { class: 'ls-item' }, h('span', { class: 'k' }, '요청 · 오류'), h('span', { class: 'v' }, live.kind === 'sim' ? '-' : N(info.requests || info.okCount || 0) + ' · ' + N(info.errors || 0)), h('span', { class: 'note' }, info.lastErr ? '마지막 오류: ' + info.lastErr : live.kind === 'sim' ? '밖으로 나가는 요청 없음' : ''))]);
    var btn = document.getElementById('liveToggle');
    if (btn) btn.textContent = liveRunning() ? '멈추기' : '연결 시작';
  }
  function liveRefresh() {
    var body = document.getElementById('liveBody'); if (!body) return;
    live.unseen = 0; updateNavBadge();
    livePaintStatus();
    var ps = live.buf.presses();
    body.innerHTML = '';
    if (!ps.length) { add(body, h('section', { class: 'card empty' }, h('p', null, liveRunning() ? '값을 기다리는 중입니다…' : '「연결 시작」을 누르면 받은 값이 여기에 2초마다 이어 그려집니다.'))); return; }
    if (ps.indexOf(ui.live.press) < 0) ui.live.press = ps[0];
    var p = ui.live.press, s = live.buf.series(p), info = P.strokeInfo(s, db.spc), O = P.cleanOpts(db.spc), z = zoneOf(p, s, info), lims = liveLims(p);
    var last = s.t[s.n - 1], win = { from: Math.max(s.t[0], last - ui.live.winMin * 60), to: last, noBase: true };
    var charts = chartsFor(s, info, O, { from: win.from, to: win.to, dieIdx: -1, groupSec: 0, lims: lims || undefined }, z);
    var pSeg = h('div', { class: 'seg seg-sm' }, ps.map(function (x) { return h('button', { type: 'button', class: 'btn btn-sm' + (x === p ? ' on' : ''), 'aria-pressed': x === p ? 'true' : 'false', onclick: function () { ui.live.press = x; liveRefresh(); } }, x); }));
    var wSeg = h('div', { class: 'seg seg-sm' }, [5, 10, 30, 60].map(function (m) { return h('button', { type: 'button', class: 'btn btn-sm' + (m === ui.live.winMin ? ' on' : ''), 'aria-pressed': m === ui.live.winMin ? 'true' : 'false', onclick: function () { ui.live.winMin = m; liveRefresh(); } }, '최근 ' + m + '분'); }));
    var r = P.rangeIdx(s, win.from, win.to), w = P.strokeWindow(s, info, r[0], r[1]);
    var al = live.alarms.filter(function (x) { return !x.quiet; });
    add(body, [
      h('section', { class: 'card live-pick' }, h('div', { class: 'live-pick-row' }, h('div', { class: 'field' }, h('span', null, '프레스'), pSeg), h('div', { class: 'field' }, h('span', null, '보는 구간(밀려가는 창)'), wSeg)),
        h('p', { class: 'note' }, '관리선: ' + (raw[p] ? '이 프레스의 가져온 2초 로그(' + N(raw[p].n) + '행)로 잡은 값 — 받는 동안 움직이지 않습니다.'
          : lims ? '받기 시작한 처음 ' + N(live.frozen[p].n) + '개(' + P.stampText(live.frozen[p].from, 'time') + ' ~ ' + P.stampText(live.frozen[p].to, 'time') + ')로 잡아 고정한 값 — 정상일 때의 2초 로그를 가져오면 그것으로 잡습니다.'
          : '받은 값이 300개(10분)가 되면 그때까지의 값으로 잡아 고정합니다. 지금은 받은 ' + N(s.n) + '개로 임시로 그립니다.') +
          (z ? ' 온도 3구간: 예열 끝 ' + fmt(z.warmTop, 1) + '℃ · 위험 ' + fmt(z.dangerAt, 1) + '℃.' : ''))),
      h('section', { class: 'card' }, h('h2', null, '경보 (' + al.length + '번)'),
        al.length ? h('ul', { class: 'alarm-list' }, al.slice(0, 30).map(function (x) {
          var a = x.a, m = CH_META[a.ch];
          return h('li', { class: 'lv-bad' }, h('strong', null, P.stampText(a.trigger, 'time')), ' ' + x.press + ' · ' + m.label + ' — ',
            a.zone ? '위험 구간 ' + P.durText(a.to - a.from) + ' 머묾, 가장 높게 ' + fmt(a.peak, 1) + '℃' : '±3σ 밖 ' + a.n + '번(가장 먼 값 ' + fmt(a.peak) + m.unit + ', ' + (a.z > 0 ? '+' : '') + fmt(a.z, 1) + 'σ)');
        })) : h('p', { class: 'note' }, '아직 경보가 없습니다. 경보 = ' + Math.round(ruleOf().winSec / 60) + '분 안에 ±3σ 밖 ' + ruleOf().minCount + '번 이상 · 온도는 위험 구간 ' + (z ? z.holdSec : ruleOf().holdSec) + '초 넘게.' + (live.kind === 'sim' ? ' 위의 「고장 징후 넣기」로 시험해 볼 수 있습니다.' : ''))),
      h('div', { class: 'lastcards' }, charts.map(lastCard)),
      h('div', { class: 'spc-charts' }, charts.map(function (d) { return chartFig(d, win, O, 0, marksFor(p)); })),
      info.counted ? h('section', { class: 'card' }, h('h2', null, '타수 — 최근 ' + ui.live.winMin + '분'), h('div', { class: 'tiles' },
        tile('타수', N(w.strokes) + '타', '시간당 ' + N(w.perHour, 0) + '타'), tile('기준 대비', L.pctText(w.perf), O.cycleSec + '초에 1타'),
        tile('지금', isFinite(w.sinceStroke) && w.sinceStroke > O.stopSec ? '정지 ' + P.durText(w.sinceStroke) + ' 째' : '가동 중', '마지막 타수 뒤 ' + (isFinite(w.sinceStroke) ? P.durText(w.sinceStroke) : '-')),
        tile('금형', s.dies[s.die[s.n - 1]] || '-', w.resets.length ? '교체 ' + w.resets.map(function (x) { return x.fromDie + '→' + x.toDie; }).join(', ') : '이 구간 교체 없음'))) : null]);
  }
  function liveMerge() {
    var ps = live.buf.presses(); if (!ps.length) { toast('합칠 값이 없습니다.', true); return; }
    var n = 0, first = Infinity, lastT = -Infinity;
    ps.forEach(function (p) { var s = live.buf.series(p); delete s.live; n += s.n; first = Math.min(first, s.t[0]); lastT = Math.max(lastT, s.t[s.n - 1]); raw[p] = P.mergeSeries(raw[p], s); delete rawInfo[p]; });
    zoneCache = {}; leadCache = null; live.limCache = {}; live.frozen = {};
    rebuildDaily(ps);
    db.rawFiles = (db.rawFiles || []).concat([{ name: '실시간 연결(' + (live.kind === 'sim' ? '시뮬레이터 — 가상' : live.kind === 'poll' ? 'HTTP' : 'WebSocket') + ')', rows: n, skipped: 0, presses: ps.join(', '), from: P.stampText(first), to: P.stampText(lastT), at: new Date().toISOString().slice(0, 16).replace('T', ' ') }]);
    saveRaw(ps).then(function () { save(); toast('받은 값 ' + N(n) + '행을 2초 로그에 합쳤습니다(' + ps.join(', ') + ').'); render(); });
  }
  function pageLive() {
    var cfg = liveCfg(), kind = ui.live.kind || cfg.kind;
    var seg = h('div', { class: 'seg seg-sm' }, [['sim', '내장 시뮬레이터(가상 값)'], ['poll', 'HTTP(S) 주소 받기'], ['ws', 'WebSocket']].map(function (x) {
      return h('button', { type: 'button', class: 'btn btn-sm' + (kind === x[0] ? ' on' : ''), 'aria-pressed': kind === x[0] ? 'true' : 'false', onclick: function () { ui.live.kind = x[0]; render(); } }, x[1]);
    }));
    var url = h('input', { type: 'url', value: cfg.url, placeholder: 'http://localhost:8787/api/rows?since={since}', 'aria-label': '받을 주소', inputmode: 'url', spellcheck: 'false' });
    var every = h('input', { type: 'number', min: 1, step: 1, value: cfg.intervalSec, 'aria-label': '몇 초마다' });
    var wsUrl = h('input', { type: 'text', value: cfg.wsUrl, placeholder: 'ws://localhost:8787/ws', 'aria-label': 'WebSocket 주소', spellcheck: 'false' });
    var speed = h('select', { 'aria-label': '빠르기' }, [[1, '실제 빠르기(2초마다 한 번)'], [10, '10배 빠르게(시험용)']].map(function (x) { return h('option', { value: String(x[0]), selected: x[0] === cfg.speed }, x[1]); }));
    var pre = h('input', { type: 'checkbox' }); pre.checked = cfg.prefill;
    var fields;
    if (kind === 'sim') fields = h('div', { class: 'form-grid' }, fld('빠르기', speed), h('div', { class: 'field span-all' }, h('span', null, '시작할 때'), h('div', { class: 'opt-grid' }, h('label', { class: 'opt' }, pre, h('span', null, h('span', { class: 't' }, '앞 30분을 한꺼번에 채우기'), h('span', { class: 's' }, '관리선을 바로 잡을 수 있게'))))));
    else if (kind === 'poll') fields = h('div', { class: 'form-grid' }, h('div', { class: 'span-all' }, fld('받을 주소(HTTP · HTTPS)', url, '주소의 {since} 는 마지막으로 받은 시각으로 바뀝니다(그 뒤 행만 받기). JSON({ "rows": [...] } 또는 행 배열) · CSV(머리행 포함) 둘 다 읽습니다.')), fld('몇 초마다', every, '설비가 2초마다 값을 내면 2초'));
    else fields = h('div', { class: 'form-grid' }, h('div', { class: 'span-all' }, fld('WebSocket 주소(ws:// · wss://)', wsUrl, '서버가 보내는 메시지마다 JSON 한 행 또는 { "rows": [...] }')));
    var injectRow = null;
    if (kind === 'sim' && liveRunning() && live.kind === 'sim') {
      var ip = h('select', { 'aria-label': '징후를 넣을 프레스' }, VD.PRESSES.map(function (p) { return h('option', { value: p.id }, p.id); }));
      injectRow = h('div', { class: 'field', style: 'margin-top:12px' }, h('span', null, '고장 징후 넣기(시뮬레이터 — 경보가 뜨는지 시험)'),
        h('div', { class: 'btn-row' }, ip, Object.keys(VD.FAULTS).map(function (k) {
          return h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { if (live.src.inject(ip.value, k)) toast(ip.value + ' — ' + VD.FAULTS[k].label + ' 을(를) 넣었습니다. 몇 분 안에 경보가 뜹니다.'); } }, VD.FAULTS[k].label);
        })));
    }
    var toggle = h('button', { type: 'button', class: 'btn btn-primary', id: 'liveToggle', onclick: function () {
      if (liveRunning()) { liveStop(); render(); return; }
      var c = { kind: kind, url: url.value.trim() || cfg.url, wsUrl: wsUrl.value.trim() || cfg.wsUrl, intervalSec: Number(every.value) || 2, speed: Number(speed.value) || 1, prefill: pre.checked };
      if (kind === 'poll' && !/^https?:\/\//i.test(c.url)) { toast('http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.', true); return; }
      if (kind === 'ws' && !/^wss?:\/\//i.test(c.wsUrl)) { toast('ws:// 또는 wss:// 로 시작하는 주소를 넣어 주세요.', true); return; }
      if (kind === 'poll' && location.protocol === 'https:' && /^http:\/\//i.test(c.url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(c.url)) toast('https 페이지에서 http 주소는 브라우저가 막습니다(혼합 콘텐츠). https 주소를 쓰거나 중계 서버 주소로 페이지를 열어 주세요.', true);
      db.live = { kind: c.kind, url: c.url, wsUrl: c.wsUrl, intervalSec: c.intervalSec, speed: c.speed, prefill: c.prefill }; save();
      liveStart(c); render();
    } }, liveRunning() ? '멈추기' : '연결 시작');
    return [pageHead('실시간', '실시간 연결', '설비 값을 2초마다 받아 관리도에 바로 이어 그리고, 경보를 띄웁니다. 시험용 내장 시뮬레이터, 또는 중계 서버(HTTP·WebSocket) 주소에서 받습니다.'),
      h('section', { class: 'card' }, h('h2', null, '받는 길'), seg, h('div', { style: 'margin-top:12px' }, fields), injectRow,
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, toggle,
          h('button', { type: 'button', class: 'btn', onclick: liveMerge }, '받은 값을 2초 로그에 합치기(저장)'),
          h('button', { type: 'button', class: 'btn', onclick: function () { if (!confirm('받은 값(메모리)을 비울까요? 2초 로그에 합친 것은 남습니다.')) return; live.buf.clear(); live.alarms = []; live.seen = {}; live.rows = 0; live.unseen = 0; live.frozen = {}; liveRefresh(); } }, '받은 값 비우기')),
        h('ul', { class: 'note explain' },
          h('li', null, h('strong', null, '밖으로 나가는 것'), ' — HTTP 방식은 넣은 주소로 GET 요청만 보냅니다(쿠키·로그인 정보·본문 없음). 받은 값은 이 브라우저 메모리에 최근 6시간만 두고, 「2초 로그에 합치기」를 누를 때만 이 브라우저(IndexedDB)에 저장합니다. 시뮬레이터는 요청이 없습니다.'),
          h('li', null, h('strong', null, '설비에서 바로 받으려면'), ' — 브라우저는 Modbus·OPC UA 로 설비에 직접 붙을 수 없습니다. 설비(PLC·센서) → 게이트웨이(OPC UA · Modbus TCP · MQTT) → 작은 중계(Node-RED 또는 작은 서버, HTTP·WebSocket + CORS) → 이 페이지 순서로 잇습니다(기획서 12장). 시험용 중계: ', h('code', null, 'node tools/relay.mjs'), ' 를 켜고 주소에 ', h('code', null, 'http://localhost:8787/api/rows?since={since}'), '.'),
          h('li', null, h('strong', null, '받는 형식'), ' — ', h('code', null, '{ "rows": [ { "time": "2026-10-27 10:00:02", "press": "P1", "die": "M-01", "pressCum": 1890112, "dieCum": 120, "current": 85.2, "voltage": 380.9, "temp": 44.8, "vib": 2.03 } ] }'), ' (표본: tools/sample-rows.json). 받은 로그 CSV 와 같은 한글 머리도 읽습니다.'))),
      h('section', { class: 'card live-status', id: 'liveStatus', 'aria-live': 'polite' }),
      h('div', { id: 'liveBody' })];
  }

  /* ── ③ 이상 감지 ─────────────────────────── */
  var CH_COLOR = { current: 'var(--series-1)', temp: 'var(--series-2)', vib: 'var(--series-3)', voltage: 'var(--series-4)' };
  function pageAnomaly() {
    if (!db.records.length) return [pageHead('①', '이상 감지'), emptyNotice()];
    var R = A.rules;
    var presses = A.statuses.map(function (s) { return s.id; });
    if (!ui.press || presses.indexOf(ui.press) < 0) {
      var worstP = A.statuses.slice().sort(function (a, b) { return L.RANK[b.level] - L.RANK[a.level]; })[0];
      ui.press = worstP ? worstP.id : presses[0];
    }
    var sel = h('select', { 'aria-label': '프레스' });
    presses.forEach(function (p) { var o = h('option', { value: p }, p); if (p === ui.press) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { ui.press = sel.value; render(); });
    var chans = L.CHANNELS.filter(function (c) { return R.channels[c.id]; });
    // 전체 한눈 표 — 프레스 × 채널
    var matrix = table(['프레스'].concat(chans.map(function (c) { return c.label; })), presses.map(function (p) {
      return [h('button', { type: 'button', class: 'linkbtn', onclick: function () { ui.press = p; render(); } }, p)].concat(chans.map(function (c) {
        var a = A.anomalies.filter(function (x) { return x.press === p && x.channel === c.id; })[0];
        return a ? pill(a.level) : h('span', { class: 'note' }, '열 없음');
      }));
    }), { cls: 'matrix' });
    var mine = A.anomalies.filter(function (a) { return a.press === ui.press; });
    var figs = mine.map(function (a) {
      return h('section', { class: 'card an lv-' + a.level },
        h('div', { class: 'an-top' }, pill(a.level), h('strong', null, ui.press + ' · ' + a.label + (a.unit ? '(' + a.unit + ')' : ''))),
        h('p', { class: 'an-ev' }, a.evidence),
        a.base ? h('p', { class: 'note' }, '기준선 구간 ' + a.base.from + ' ~ ' + a.base.to + ' (가동일 ' + a.base.n + '일) · 최근 구간 ' + a.recent.from + ' ~ ' + a.recent.to + ' (가동일 ' + a.recent.n + '일) · σ ' + N(a.base.sigma, 3) + a.unit +
          (a.base.floored ? ' (값이 거의 같아 기준선의 0.5% 를 바닥값으로 씀)' : '')) : null,
        C.sensorFigure(a.label + ' 하루 평균 — ' + ui.press, { points: a.points, base: a.base, recentFrom: a.recent.from, unit: a.unit, k: R.k, kWarn: R.kWarn, color: CH_COLOR[a.channel] }));
    });
    return [
      pageHead('①', '이상 감지 (통계 기준)', '평소(기준선)보다 벗어난 날이 이어지는지를 봅니다. 고장 기록으로 배운 예측이 아니라 「평소와 다름」을 알리는 1단계입니다.'),
      h('section', { class: 'card filters' }, fld('프레스', sel),
        h('p', { class: 'note span-all' }, ruleText(R) + ' · ', h('a', { href: '#/settings' }, '기준 바꾸기'))),
      h('section', { class: 'card' }, h('h2', null, '전체 한눈 보기 (기준일 ' + A.asOf + ')'), matrix),
      figs.length ? figs : h('section', { class: 'card' }, h('p', { class: 'note' }, ui.press + ' 에는 전류·전압·온도·진동 값이 없습니다.')),
      h('details', { class: 'card rules' }, h('summary', null, '이 판정을 읽는 법'),
        h('ul', null,
          h('li', null, '하루에 여러 행이 있으면 하루 평균으로 묶습니다. 쉬는 날(값 없음)은 건너뜁니다.'),
          h('li', null, '기준선 = 최근 구간 바로 앞 ' + R.baseDays + '일의 ' + (R.method === 'mad' ? '중앙값, 흩어짐 = 1.4826 × MAD(중앙값과의 차이의 중앙값). 튀는 값 몇 개에 흔들리지 않습니다.' : '평균, 흩어짐 = 표준편차.')),
          h('li', null, '관리한계 = 기준선 ± ' + R.k + 'σ, 주의 한계 = ± ' + R.kWarn + 'σ. 그래프의 빨간 점은 관리한계 밖, 주황 점은 주의 한계 밖입니다.'),
          h('li', null, '하루 튄 값만으로는 판정하지 않습니다(지속 조건). 전류와 온도가 함께 오르는 것처럼 여러 채널이 같이 움직이면 더 눈여겨봅니다.'),
          h('li', null, '정비 · 고장 이력으로 라벨을 붙이고 「어떤 모양이 고장 전에 나왔는가」를 배우는 일은 「머신러닝 · 라벨링」에서 합니다.')))
    ];
  }
  function ruleText(R) { return L.ruleText(R); }

  /* ── ② 머신러닝 · 라벨링 (v2.1, 2026-11-10 요청) ─────────────
     정비 · 고장 이력(maintenance_log)으로 2초 센서 로그에 정상 · 이상 · 제외 라벨을 붙이고, 사람이 구간을 골라 고치고,
     라벨 분포 · 특징 요약 · 기준선 모델(z 점수) 혼동행렬을 보고, 학습용 CSV 로 내려받습니다. 계산은 js/label.js(PressLabel). */
  var mlCache = null;
  function mlList() {
    var ps = Object.keys(raw).sort(L.natCmp), gap = P.cleanOpts(db.spc).gapSec;
    var key = JSON.stringify([db.ml.logs, db.ml.rule, db.ml.manual, gap]) + '|' + ps.map(function (p) { return p + ':' + raw[p].n + ':' + raw[p].t[raw[p].n - 1]; }).join(',');
    if (mlCache && mlCache.key === key) return mlCache;
    mlCache = { key: key, models: {}, list: ps.map(function (p) {
      var s = raw[p], res = LB.labelSeries(s, db.ml.logs, db.ml.rule, db.ml.manual);
      return { s: s, res: res, segs: LB.segments(s, res, gap), counts: LB.counts(res) };
    }) };
    return mlCache;
  }
  function mlModel(mc) {
    var M = db.ml.model, k = M.binSec + '|' + M.k;
    if (!mc.models[k]) mc.models[k] = LB.zModel(mc.list, M);
    return mc.models[k];
  }
  function labPill(lab, src) {
    return h('span', null, h('span', { class: 'pill lab-' + lab }, LB.LABELS[lab].label), src === LB.SRC_MANUAL ? h('span', { class: 'pill src-manual tiny' }, '수동') : null);
  }
  function pctOf(a, b) { return b ? L.pctText(a / b) : '-'; }
  function daysOf(s) {
    if (!s || !s.n) return [];
    var out = [], d = P.dateOf(s.t[0]), last = P.dateOf(s.t[s.n - 1]);
    while (d <= last) { var a = P.parseStamp(d + ' 00:00:00'), r = P.rangeIdx(s, a, a + 86399); if (r[1] > r[0]) out.push(d); d = L.addDays(d, 1); }
    return out;
  }
  function readLogFile(f) {
    return f.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), wb = /\.(csv|txt)$/i.test(f.name) ? XLSX.read(L.decodeCsv(u8).text, { type: 'string', raw: true }) : XLSX.read(u8, { type: 'array', cellDates: false });
      var r = { logs: [], skipped: 0, error: '' };
      wb.SheetNames.some(function (sn) {
        var x = LB.logsFromAoa(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null }));
        if (!x.error) { r = x; return true; }
        r.error = x.error; return false;
      });
      return r;
    });
  }
  function mlSetLogs(list, msg) { db.ml.logs = LB.fillIds(list.map(function (l) { return Object.assign({}, l); })); mlCache = null; save(); if (msg) toast(msg); render(); }

  function mlLogCard(ps) {
    var logs = db.ml.logs, ed = ui.ml.edit ? logs.filter(function (l) { return l.log_id === ui.ml.edit; })[0] : null;
    var keys = {}; ps.forEach(function (p) { keys[LB.eqKey(p)] = 1; });
    var F = {};
    LB.MLOG_FIELDS.forEach(function (f) {
      var dt = f.id === 'found_at' || f.id === 'fixed_at', v = ed ? ed[f.id] : '';
      F[f.id] = h('input', dt ? { type: 'datetime-local', step: 1, value: v ? String(v).replace(' ', 'T') : '', 'aria-label': f.ko }
        : { type: 'text', value: v || '', list: f.id === 'equipment_id' ? 'mlPressList' : null, placeholder: f.id === 'log_id' ? '비우면 자동(M-0001)' : f.id === 'equipment_id' ? (ps[0] || 'P1') : '', 'aria-label': f.ko });
    });
    var dl = h('datalist', { id: 'mlPressList' }, ps.concat(Object.keys(db.presses)).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (p) { return h('option', { value: p }); }));
    var file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt' });
    file.addEventListener('change', function () {
      var f = file.files[0]; if (!f) return;
      readLogFile(f).then(function (r) {
        if (!r.logs.length) { toast(r.error || '읽은 이력이 없습니다.', true); return; }
        var before = logs.length, merged = LB.mergeLogs(logs, LB.fillIds(r.logs.slice()));
        mlSetLogs(merged, '이력 ' + r.logs.length + '건을 읽었습니다(새로 ' + (merged.length - before) + '건 · 같은 정비 번호는 새 값으로)' + (r.skipped ? ' · 설비나 발견 일시가 없어 건너뛴 행 ' + r.skipped : '') + '.');
      }).catch(function (e) { toast('읽지 못했습니다: ' + e.message, true); });
      file.value = '';
    });
    var evFails = (db.events || []).filter(function (e) { return e.kind === '고장'; });
    var rows = logs.map(function (l) {
      var has = !!keys[LB.eqKey(l.equipment_id)];
      return { cls: l.log_id === ui.ml.edit ? 'row-warn' : null, cells: [h('strong', null, l.log_id), l.equipment_id, l.found_at, l.fixed_at + (l.noFix ? ' (조치 일시 없음)' : ''), l.symptom || '-', l.failure_part || '-', l.cause || '-', l.action || '-',
        h('span', null, has ? '있음' : h('span', { class: 'pill lv-warn tiny' }, '설비 이름 확인'), l.virtual ? h('span', { class: 'pill lv-none tiny' }, '가상') : null),
        h('span', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.ml.edit = l.log_id; render(); var c = document.getElementById('mlLogForm'); if (c) c.scrollIntoView({ block: 'center' }); } }, '고치기'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'aria-label': l.log_id + ' 빼기', onclick: function () { if (!confirm(l.log_id + ' 이력을 뺄까요?')) return; if (ui.ml.edit === l.log_id) ui.ml.edit = ''; mlSetLogs(logs.filter(function (x) { return x !== l; })); } }, '빼기'))] };
    });
    return h('section', { class: 'card', id: 'mlLogs' }, h('h2', null, '1. 정비 · 고장 이력 (maintenance_log · ' + logs.length + '건)'),
      h('p', { class: 'note' }, '엑셀 · CSV 머리행은 log_id · equipment_id · found_at · fixed_at · symptom · failure_part · cause · action, 또는 한글로 정비 번호 · 설비 · 발견 일시 · 조치 일시 · 증상 · 고장 부위 · 원인 · 조치. 설비와 발견 일시만 있으면 읽습니다(조치 일시가 없으면 발견 일시로). 설비 이름은 2초 로그의 프레스 이름과 같아야 라벨이 붙습니다(띄어쓰기 · 대소문자 · 「-」 「_」는 가리지 않음).'),
      logs.length ? table(['정비 번호', '설비', '발견 일시', '조치 일시', '증상', '고장 부위', '원인', '조치', '센서 로그', ''], rows, { cls: 'items' })
        : h('p', { class: 'note' }, '아직 없습니다. 파일로 넣거나 아래에서 한 줄씩 넣어 주세요.'),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('label', { class: 'btn btn-primary' }, file, '이력 파일 넣기(엑셀 · CSV)'),
        h('button', { type: 'button', class: 'btn', onclick: function () { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(LB.logsToAoa(logs)), 'maintenance_log'); XLSX.writeFile(wb, '정비고장이력_maintenance_log.xlsx'); } }, logs.length ? '엑셀로 내려받기' : '빈 양식 내려받기'),
        h('a', { class: 'btn', href: 'samples/' + encodeURIComponent('가상_정비고장이력_maintenance_log.csv'), download: '' }, '가상 이력 CSV(예시)'),
        evFails.length ? h('button', { type: 'button', class: 'btn', onclick: function () {
          var add = LB.logsFromEvents(db.events), have = {};
          logs.forEach(function (l) { have[LB.eqKey(l.equipment_id) + '|' + l.found_at] = 1; });
          add = add.filter(function (l) { return !have[LB.eqKey(l.equipment_id) + '|' + l.found_at]; }).map(function (l) { l.log_id = ''; return l; });
          if (!add.length) { toast('「고장 전 이탈」의 고장 이력이 이미 다 들어 있습니다.'); return; }
          mlSetLogs(logs.concat(add), '「고장 전 이탈」 고장 이력 ' + add.length + '건을 넣었습니다(조치 일시 = 고장 + 정지 분). 원인 · 조치는 고쳐 넣어 주세요.');
        } }, '「고장 전 이탈」 고장 이력에서 가져오기(' + evFails.length + '건)') : null,
        db.sampleKind === 'virtual' && !logs.some(function (l) { return l.virtual; }) ? h('button', { type: 'button', class: 'btn', onclick: function () { mlSetLogs(LB.mergeLogs(logs, LB.cleanLogs(VD.mlog())), '가상 정비 · 고장 이력 3건을 넣었습니다.'); } }, '가상 이력 3건 넣기') : null,
        logs.some(function (l) { return l.virtual; }) ? h('button', { type: 'button', class: 'btn', onclick: function () { if (!confirm('가상 이력만 뺄까요?')) return; mlSetLogs(logs.filter(function (l) { return !l.virtual; })); } }, '가상 이력만 빼기') : null),
      h('h3', { style: 'margin-top:14px', id: 'mlLogForm' }, ed ? ed.log_id + ' 고치기' : '한 줄 넣기'),
      h('div', { class: 'ml-form' }, fld('정비 번호 (log_id)', F.log_id), fld('설비 (equipment_id)', h('span', null, F.equipment_id, dl)), fld('발견 일시 (found_at)', F.found_at), fld('조치 일시 (fixed_at)', F.fixed_at),
        fld('증상 (symptom)', F.symptom), fld('고장 부위 (failure_part)', F.failure_part), fld('원인 (cause)', F.cause), fld('조치 (action)', F.action)),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var o = {}; LB.MLOG_FIELDS.forEach(function (f) { o[f.id] = f.id === 'found_at' || f.id === 'fixed_at' ? P.fromLocalInput(F[f.id].value) : F[f.id].value; });
          if (ed) o.virtual = ed.virtual;
          var l = LB.cleanLog(o); if (!l) { toast('설비와 발견 일시를 넣어 주세요.', true); return; }
          if (l.log_id && logs.some(function (x) { return x.log_id === l.log_id && x !== ed; })) { toast('이미 있는 정비 번호입니다: ' + l.log_id, true); return; }
          var next = ed ? logs.map(function (x) { return x === ed ? l : x; }) : logs.concat([l]);
          ui.ml.edit = ''; mlSetLogs(next, ed ? '고쳤습니다.' : '넣었습니다.');
        } }, ed ? '고친 내용 저장' : '한 줄 넣기'),
        ed ? h('button', { type: 'button', class: 'btn', onclick: function () { ui.ml.edit = ''; render(); } }, '고치기 취소') : null));
  }

  function mlRuleCard() {
    var R = db.ml.rule;
    var pre = h('input', { type: 'number', min: 0, max: 720, step: 0.5, value: R.preH, inputmode: 'decimal', 'aria-label': '고장 전 구간(시간)' });
    var post = h('input', { type: 'number', min: 0, max: 168, step: 0.5, value: R.postH, inputmode: 'decimal', 'aria-label': '조치 뒤 안정 구간(시간)' });
    return h('section', { class: 'card' }, h('h2', null, '2. 라벨 규칙'),
      h('ul', { class: 'note' },
        h('li', null, h('span', { class: 'pill lab-1' }, '이상'), ' 같은 설비에서 [발견 일시 − 고장 전 구간, 조치 일시] 안 — 고장 전 · 고장 중'),
        h('li', null, h('span', { class: 'pill lab-2' }, '제외'), ' 조치 일시 뒤 안정 구간 — 고친 직후라 정상인지 불확실(학습에서 뺌)'),
        h('li', null, h('span', { class: 'pill lab-0' }, '정상'), ' 그 밖'),
        h('li', null, '고장 전 구간 기본 24시간은 「고장 전 이탈」의 「고장 앞 24시간」과 같은 정의입니다. 두 이력이 겹치면 이상이 제외보다 앞서고, 아래 3에서 사람이 고른 수동 라벨이 규칙보다 앞섭니다.')),
      h('div', { class: 'form-grid' }, fld('고장 전 구간 (시간)', pre, '발견 일시보다 이만큼 앞부터 이상'), fld('조치 뒤 안정 구간 (시간)', post, '0 이면 제외 구간 없음')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { db.ml.rule = LB.cleanRule({ preH: pre.value, postH: post.value }); mlCache = null; save(); toast('라벨 규칙을 바꿨습니다.'); render(); } }, '규칙 적용'),
        h('button', { type: 'button', class: 'btn', onclick: function () { db.ml.rule = LB.cleanRule({}); mlCache = null; save(); render(); } }, '기본값(24시간 · 2시간)')));
  }

  function mlViewCard(mc) {
    var ps = mc.list.map(function (x) { return x.s.press; });
    if (ps.indexOf(ui.ml.press) < 0) ui.ml.press = (mc.list.filter(function (x) { return x.counts.n[1]; })[0] || mc.list[0]).s.press;
    var X = mc.list.filter(function (x) { return x.s.press === ui.ml.press; })[0], s = X.s;
    var days = daysOf(s);
    if (ui.ml.day !== 'all' && days.indexOf(ui.ml.day) < 0) {
      var firstAb = X.segs.filter(function (g) { return g.lab === LB.ABNORMAL; })[0];
      ui.ml.day = firstAb ? P.dateOf(firstAb.to) : days[0] || 'all';
    }
    var from = ui.ml.day === 'all' ? s.t[0] : P.parseStamp(ui.ml.day + ' 00:00:00'), to = ui.ml.day === 'all' ? s.t[s.n - 1] : from + 86399;
    var r = P.rangeIdx(s, from, to); if (r[1] > r[0]) { from = s.t[r[0]]; to = s.t[r[1] - 1]; }
    var pSel = h('select', { 'aria-label': '설비' }, ps.map(function (p) { return h('option', { value: p, selected: p === ui.ml.press ? true : null }, p); }));
    pSel.addEventListener('change', function () { ui.ml.press = pSel.value; ui.ml.day = ''; render(); });
    var dSel = h('select', { 'aria-label': '날짜' }, [h('option', { value: 'all' }, '전체')].concat(days.map(function (d) { return h('option', { value: d, selected: d === ui.ml.day ? true : null }, d); })));
    dSel.addEventListener('change', function () { ui.ml.day = dSel.value; render(); });
    var bands = LB.labelBands(X.segs, from, to);
    var marks = [];
    db.ml.logs.forEach(function (l) {
      if (LB.eqKey(l.equipment_id) !== LB.eqKey(s.press)) return;
      marks.push({ t: P.parseStamp(l.found_at), label: l.log_id + ' 발견 — ' + (l.symptom || ''), short: l.log_id + ' 발견', cls: 'fail' });
      if (l.fixed_at !== l.found_at) marks.push({ t: P.parseStamp(l.fixed_at), label: l.log_id + ' 조치 — ' + (l.action || ''), short: l.log_id + ' 조치', cls: 'maint' });
    });
    var figs = LB.CHS.filter(function (ch) { return s[ch]; }).map(function (ch) {
      var ds = P.downsample(s.t, Array.prototype.slice.call(s[ch], r[0], r[1]), null, r[0], 600);
      return C.spcFigure(s.press + ' · ' + LB.CH_LABEL[ch] + '(' + LB.CH_UNIT[ch] + ')', { ds: ds, unit: LB.CH_UNIT[ch], color: CH_META[ch].color, from: from, to: to, bands: bands, bandLegend: true, noViol: true, noBase: true, marks: marks, gapSec: P.cleanOpts(db.spc).gapSec });
    });
    // 구간 표 — 이 범위의 이상 · 제외 · 수동 구간
    var segs = X.segs.filter(function (g) { return g.to >= from && g.from <= to && (g.lab !== LB.NORMAL || g.src === LB.SRC_MANUAL); });
    var fIn = h('input', { type: 'datetime-local', step: 1, value: ui.ml.from || P.toLocalInput(from), 'aria-label': '시작' });
    var tIn = h('input', { type: 'datetime-local', step: 1, value: ui.ml.to || P.toLocalInput(to), 'aria-label': '끝' });
    var lSel = h('select', { 'aria-label': '라벨' }, LB.LABELS.map(function (x) { return h('option', { value: x.id, selected: x.id === ui.ml.lab ? true : null }, x.label); }));
    var note = h('input', { type: 'text', placeholder: '예: 금형 교체 시운전 — 정상 아님', 'aria-label': '메모' });
    var mine = db.ml.manual.filter(function (m) { return LB.eqKey(m.press) === LB.eqKey(s.press); });
    return h('section', { class: 'card', id: 'mlView' }, h('h2', null, '3. 라벨 보기 · 고치기'),
      h('div', { class: 'form-grid' }, fld('설비', pSel), fld('날짜', dSel),
        h('p', { class: 'note' }, s.press + ' 전체 ' + N(X.counts.total) + '행 — 정상 ' + N(X.counts.n[0]) + ' · 이상 ' + N(X.counts.n[1]) + ' · 제외 ' + N(X.counts.n[2]) + (mine.length ? ' · 수동 라벨 ' + mine.length + '건' : ''))),
      h('div', { class: 'grid-2' }, figs),
      h('h3', { style: 'margin-top:14px' }, '이 범위의 이상 · 제외 · 수동 구간 (' + segs.length + ')'),
      segs.length ? table(['시작', '끝', '길이', '라벨', '근거', '행', ''], segs.slice(0, 80).map(function (g) {
        return [P.stampText(g.from), P.stampText(g.to), P.durText(g.to - g.from), labPill(g.lab, g.src), (g.src === LB.SRC_MANUAL ? '수동 ' : '규칙 ') + (g.id || ''), N(g.n),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { ui.ml.from = P.toLocalInput(g.from); ui.ml.to = P.toLocalInput(g.to); render(); var e = document.getElementById('mlManual'); if (e) e.scrollIntoView({ block: 'center' }); } }, '이 구간 고르기')];
      }), { num: [0, 0, 0, 0, 0, 1, 0] }) : h('p', { class: 'note' }, '이 범위는 모두 규칙상 정상입니다.'),
      segs.length > 80 ? h('p', { class: 'note' }, '앞 80개만 보입니다. 날짜를 골라 좁혀 주세요.') : null,
      h('h3', { id: 'mlManual', style: 'margin-top:14px' }, '구간을 골라 라벨 고치기 (수동 라벨이 규칙보다 앞섬)'),
      h('div', { class: 'ml-form' }, fld('시작', fIn), fld('끝', tIn), fld('라벨', lSel), fld('메모', note)),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var m = LB.cleanManual({ press: s.press, from: P.fromLocalInput(fIn.value), to: P.fromLocalInput(tIn.value), label: lSel.value, note: note.value }, db.ml.manual.length);
          if (!m) { toast('시작 · 끝 시각을 넣어 주세요.', true); return; }
          var rr = P.rangeIdx(s, P.parseStamp(m.from), P.parseStamp(m.to));
          db.ml.manual.push(m); ui.ml.from = ''; ui.ml.to = ''; ui.ml.lab = Number(lSel.value); mlCache = null; save();
          toast(s.press + ' ' + m.from + ' ~ ' + m.to + ' (' + N(rr[1] - rr[0]) + '행) 을 「' + LB.LABELS[m.label].label + '」로 고쳤습니다.'); render();
        } }, '이 구간에 라벨 붙이기'),
        h('button', { type: 'button', class: 'btn', onclick: function () { ui.ml.from = P.toLocalInput(from); ui.ml.to = P.toLocalInput(to); render(); } }, '보는 범위 전체로')),
      mine.length ? table(['설비', '시작', '끝', '라벨', '메모', ''], mine.map(function (m) {
        return [m.press, m.from, m.to, labPill(m.label, LB.SRC_MANUAL), m.note || '-', h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: function () { db.ml.manual = db.ml.manual.filter(function (x) { return x.id !== m.id; }); mlCache = null; save(); render(); } }, '되돌리기')];
      }), { cls: 'items' }) : null);
  }

  function mlStatsCard(mc) {
    var tot = [0, 0, 0], man = 0;
    var rows = mc.list.map(function (x) {
      var c = x.counts; tot[0] += c.n[0]; tot[1] += c.n[1]; tot[2] += c.n[2]; man += c.manual[0] + c.manual[1] + c.manual[2];
      return [x.s.press, N(c.total), N(c.n[0]) + ' (' + pctOf(c.n[0], c.total) + ')', N(c.n[1]) + ' (' + pctOf(c.n[1], c.total) + ')', N(c.n[2]) + ' (' + pctOf(c.n[2], c.total) + ')', N(c.manual[0] + c.manual[1] + c.manual[2])];
    });
    var all = tot[0] + tot[1] + tot[2];
    rows.push([h('strong', null, '합계'), N(all), N(tot[0]), N(tot[1]), N(tot[2]), N(man)]);
    var fp = ui.ml.statPress || '';
    var sel = h('select', { 'aria-label': '특징 요약 설비' }, [h('option', { value: '' }, '모든 설비')].concat(mc.list.map(function (x) { return h('option', { value: x.s.press, selected: x.s.press === fp ? true : null }, x.s.press); })));
    sel.addEventListener('change', function () { ui.ml.statPress = sel.value; render(); });
    var fs = LB.featureStats(mc.list.filter(function (x) { return !fp || x.s.press === fp; }));
    var frows = LB.LABELS.map(function (lb) {
      return [labPill(lb.id)].concat(LB.CHS.map(function (ch) { var v = fs[lb.id][ch]; return v.n ? N(v.mean, 2) + ' ± ' + N(v.std, 2) : '-'; })).concat([N(fs[lb.id][LB.CHS[0]].n)]);
    });
    return h('section', { class: 'card' }, h('h2', null, '4. 라벨 분포 · 특징 요약'),
      table(['설비', '행', '정상', '이상', '제외', '수동 라벨 행'], rows, { num: [0, 1, 1, 1, 1, 1] }),
      h('div', { class: 'form-grid', style: 'margin-top:14px' }, fld('특징 요약 설비', sel)),
      table(['라벨'].concat(LB.CHS.map(function (ch) { return LB.CH_LABEL[ch] + '(' + LB.CH_UNIT[ch] + ') 평균 ± 표준편차'; })).concat(['행']), frows, { num: [0, 1, 1, 1, 1, 1] }),
      h('p', { class: 'note' }, '2초 원값 기준입니다. 설비마다 평소 값이 달라 「모든 설비」는 섞인 값입니다 — 설비를 골라 비교해 주세요. 이상에는 고장으로 멈춘 시간(전류 · 진동이 낮음)도 들어갑니다.'));
  }

  function mlModelCard(mc) {
    var M = db.ml.model, m = mlModel(mc), cm = m.matrix;
    var kSel = h('select', { 'aria-label': '판정 기준 k' }, [2, 2.5, 3, 3.5, 4, 5, 6].map(function (k) { return h('option', { value: k, selected: k === M.k ? true : null }, '|z| > ' + k); }));
    var bSel = h('select', { 'aria-label': '묶는 칸' }, [[10, '10초'], [30, '30초'], [60, '1분'], [300, '5분']].map(function (b) { return h('option', { value: b[0], selected: b[0] === M.binSec ? true : null }, b[1] + ' 평균'); }));
    function apply() { db.ml.model = LB.cleanModel({ k: kSel.value, binSec: bSel.value }); save(); render(); }
    kSel.addEventListener('change', apply); bSel.addEventListener('change', apply);
    var P3 = function (v) { return v == null ? '-' : L.pctText(v); };
    var enough = m.testAbnormal > 0 && cm.tn + cm.fp > 0;
    return h('section', { class: 'card' }, h('h2', null, '5. 기준선 모델 (z 점수) — 맛보기'),
      h('p', { class: 'note' }, '설비마다 정상 칸의 채널별 평균 · 표준편차를 잡고, 전압 · 전류 · 진동 · 온도 z 점수 가운데 가장 큰 값이 k 를 넘으면 「이상」으로 판정합니다. 칸 = 고른 시간 평균. 정상 칸을 시간순으로 번갈아 학습(기준 잡기) · 시험으로 나누고, 이상 칸은 학습에 쓰지 않고 시험에만 씁니다. 제외 칸은 쓰지 않습니다.'),
      h('div', { class: 'form-grid' }, fld('판정 기준', kSel), fld('묶는 칸', bSel), h('p', { class: 'note' }, '학습 ' + N(m.train) + '칸 · 시험 ' + N(m.test) + '칸(이상 ' + N(m.testAbnormal) + ')')),
      enough ? h('div', { class: 'grid-2' },
        h('div', null, h('table', { class: 'cm-table' },
          h('thead', null, h('tr', null, h('th', null, '실제 \\ 판정'), h('th', null, '이상'), h('th', null, '정상'))),
          h('tbody', null,
            h('tr', null, h('th', null, '이상'), h('td', { class: 'hit' }, N(cm.tp)), h('td', { class: 'miss' }, N(cm.fn))),
            h('tr', null, h('th', null, '정상'), h('td', { class: 'miss' }, N(cm.fp)), h('td', { class: 'hit' }, N(cm.tn)))))),
        h('div', { class: 'tiles' }, tile('정확도', P3(cm.accuracy), '맞게 판정한 칸'), tile('재현율', P3(cm.recall), '이상 칸 중 잡은 것'), tile('정밀도', P3(cm.precision), '이상 판정 중 실제 이상'), tile('특이도', P3(cm.specificity), '정상 칸 중 정상 판정')))
        : h('p', { class: 'alert info' }, '이상 칸과 정상 칸이 모두 있어야 잴 수 있습니다. 정비 · 고장 이력을 넣어 주세요.'),
      enough ? h('details', null, h('summary', null, 'k 를 바꾸면'), table(['k', '잡은 이상', '놓친 이상', '헛경보', '정확도', '재현율', '정밀도'], m.sweep.map(function (c) { return ['|z| > ' + c.k, N(c.tp), N(c.fn), N(c.fp), P3(c.accuracy), P3(c.recall), P3(c.precision)]; }), { num: [0, 1, 1, 1, 1, 1, 1] })) : null,
      h('ul', { class: 'note' },
        h('li', null, '숫자는 지금 들어 있는 자료로 이 브라우저에서 바로 계산한 값입니다' + (db.sampleKind === 'virtual' ? '(지금은 가상 데이터 — 실제 성능이 아님)' : '') + '. 이웃한 칸은 서로 비슷해 실제보다 좋게 나올 수 있습니다.'),
        h('li', null, '고장 전 구간 전부를 이상으로 두었으므로, 값이 아직 변하기 전 시간도 이상에 들어가 재현율이 낮게 나옵니다. 2의 고장 전 구간을 바꿔 가며 비교해 보세요.'),
        h('li', null, '더 나은 모델(로지스틱 회귀 · 트리 등)은 아래 6의 CSV 를 파이썬 · 엑셀에서 불러와 만듭니다.')));
  }

  function mlExportCard(mc) {
    var drop = h('input', { type: 'checkbox' }); drop.checked = !!ui.ml.dropExclude;
    drop.addEventListener('change', function () { ui.ml.dropExclude = drop.checked; });
    return h('section', { class: 'card' }, h('h2', null, '6. 학습용 데이터셋 내려받기'),
      h('p', { class: 'note' }, 'CSV 칸: ' + LB.CSV_HEAD.join(' · ') + ' — 시각 · 설비 · 전압 · 전류 · 진동 · 온도 · 라벨(0 정상 · 1 이상 · 2 제외) · 라벨 이름 · 라벨 근거(rule 규칙 · manual 수동) · 근거가 된 정비 번호(log_id) 또는 수동 라벨 번호. UTF-8(BOM), 2초 원값 그대로입니다.'),
      h('label', { class: 'opt' }, drop, h('span', { class: 't' }, '「제외」 행은 빼고 내려받기')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          toast('CSV 를 만드는 중입니다…');
          setTimeout(function () {
            var c = LB.datasetCsv(mc.list, { dropExclude: ui.ml.dropExclude });
            download('학습용_라벨데이터_' + mc.list.map(function (x) { return x.s.press; }).join('-') + '.csv', new Blob(c.parts, { type: 'text/csv;charset=utf-8' }));
            toast(N(c.rows) + '행을 내려받았습니다.');
          }, 30);
        } }, '학습용 CSV 내려받기')));
  }

  function pageMl() {
    var ps = Object.keys(raw).sort(L.natCmp);
    var out = [pageHead('②', '머신러닝 · 라벨링', '정비 · 고장 이력으로 전압 · 전류 · 진동 · 온도 2초 로그에 정상 / 이상 라벨을 붙이고, 사람이 고치고, 학습용 데이터셋으로 내려받습니다.')];
    if (db.sampleKind === 'virtual') out.push(h('p', { class: 'alert warn' }, h('strong', null, '가상 데이터입니다. '), '프레스 3대의 2초 로그와 정비 · 고장 이력 3건(V-0001~0003)은 모두 지어낸 값입니다. 실제 로그와 이력을 넣으면 같은 화면에서 실제 라벨이 붙습니다.'));
    out.push(mlLogCard(ps), mlRuleCard());
    if (!ps.length) {
      out.push(h('section', { class: 'card empty' }, h('p', null, '아직 2초 센서 로그가 없습니다. 라벨은 2초 로그에 붙습니다.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: askVirtual }, '가상 고장 데이터로 시작'), h('a', { class: 'btn', href: '#/import' }, '데이터 가져오기로'))));
      return out;
    }
    var mc = mlList();
    out.push(mlViewCard(mc), mlStatsCard(mc), mlModelCard(mc), mlExportCard(mc));
    return out;
  }

  /* ── ③ AI 분석 ──────────────────────────── */
  function pageAi() {
    if (!db.records.length) return [pageHead('③', 'AI 분석'), emptyNotice()];
    var mask = db.maskNames !== false;
    if (mask) {
      db.aliases.press = L.assignAliases(db.aliases.press, Object.keys(db.presses).concat(A.statuses.map(function (s) { return s.id; })), L.ALIAS.press);
    }
    var info = L.buildAiPromptInfo({ asOf: A.asOf, range: A.range, rules: A.rules, statuses: A.statuses, anomalies: A.anomalies, aliases: mask ? db.aliases : null });
    var prompt = info.prompt;
    function back(t) { return mask ? L.unmaskText(t, db.aliases) : t; }
    var answer = h('textarea', { rows: 10, placeholder: 'AI 답을 여기에 붙여 넣어 주세요. 별칭(설비1)은 실제 이름으로 되돌려 이 브라우저에 저장합니다.' });
    answer.value = (db.aiNotes || {})[A.asOf] || '';
    answer.addEventListener('input', function () { db.aiNotes[A.asOf] = back(answer.value); save(); });
    answer.addEventListener('change', function () { var b = back(answer.value); if (b !== answer.value) { answer.value = b; toast('답의 별칭을 실제 이름으로 되돌렸습니다.'); } });
    var promptBox = h('textarea', { rows: 14, readonly: true, class: 'mono' }); promptBox.value = prompt;
    var maskBox = h('input', { type: 'checkbox' }); maskBox.checked = mask;
    maskBox.addEventListener('change', function () { db.maskNames = maskBox.checked; save(); render(); });
    var mapRows = [];
    ['press', 'die'].forEach(function (k) { Object.keys(info.map[k]).sort(L.natCmp).forEach(function (n) { mapRows.push([info.map[k][n], n, k === 'press' ? '프레스' : '금형']); }); });
    mapRows.sort(function (a, b) { return L.natCmp(a[0], b[0]); });
    var maskCard = h('div', { class: 'mask-box' },
      h('label', { class: 'opt' }, maskBox, h('span', null, h('span', { class: 't' }, '이름 가리기(외부 AI 에 프레스·금형 이름을 보내지 않음)'),
        h('span', { class: 's' }, '프롬프트의 프레스 이름을 「설비1」, 금형명을 「금형1」 같은 별칭으로 바꿉니다. 대응표는 이 브라우저에만 있고, AI 답의 별칭은 붙여 넣을 때 실제 이름으로 되돌립니다.'))),
      mask && info.leaks.length ? h('p', { class: 'alert warn' }, '가리지 못한 이름이 프롬프트에 남아 있습니다: ' + info.leaks.join(', ') + ' — 보내기 전에 지워 주세요.') : null,
      mask ? (info.leaks.length ? null : h('p', { class: 'note' }, '확인: 프롬프트에 실제 프레스·금형 이름이 없습니다(' + (Object.keys(db.aliases.press).length + Object.keys(db.aliases.die).length) + '개 대조). 프레스 종류(톤수)와 숫자는 그대로 들어갑니다.'))
        : h('p', { class: 'alert info' }, '지금은 실제 이름이 그대로 들어갑니다. 회사·협력사 보안 기준을 확인해 주세요.'),
      mask && mapRows.length ? h('details', null, h('summary', null, '별칭 대응표 — 이 프롬프트에 쓴 ' + mapRows.length + '개 (이 PC 에만 있음)'),
        table(['별칭', '실제 이름', '구분'], mapRows, { cls: 'alias' })) : null);
    return [
      pageHead('③', 'AI 분석 (반자동)', '도구가 계산한 사실(상태·근거 숫자)만 담은 프롬프트를 만듭니다. 로그 원본은 넣지 않습니다.'),
      h('section', { class: 'card', id: 'ai' },
        h('ol', { class: 'steps' },
          h('li', null, '아래 프롬프트를 복사해 회사가 허용한 AI(ChatGPT 등)에 붙여 넣어 주세요.'),
          h('li', null, '받은 답을 「AI 답」 칸에 붙여 넣으면 별칭이 실제 이름으로 돌아가 저장됩니다. 답은 꼭 검토해 주세요 — 원인은 추정입니다.')),
        maskCard, promptBox,
        h('div', { class: 'btn-row', style: 'margin:10px 0' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '프롬프트 복사'),
          AIP.sendButton('설정한 AI 서버로 보내기(선택)', function () { return prompt; }, function (text) { text = back(text); answer.value = text; db.aiNotes[A.asOf] = text; save(); toast('AI 답을 받았습니다(별칭은 실제 이름으로 되돌림). 꼭 검토해 주세요.'); },
            { toast: toast, settingsHref: '#/settings', system: '너는 프레스 설비 보전 담당자를 돕는 보조야. 주어진 사실 밖의 숫자를 만들지 마.' })),
        fld('AI 답 (기준일 ' + A.asOf + ')', answer, '붙여 넣은 답은 이 브라우저에 저장됩니다.'))
    ];
  }

  /* ── 설정 ───────────────────────────────── */
  function pageSettings() {
    var pIds = Object.keys(db.presses).sort(L.natCmp);
    // v2.1 — 오버홀 주기 · 금형 수명 칸은 화면에서 뺐습니다. 저장된 값은 그대로 둡니다(종류 · 메모만 고침)
    var pInputs = pIds.map(function (id) {
      var p = L.cleanPress(db.presses[id], id);
      var x = { id: id, type: h('input', { value: p.type, 'aria-label': id + ' 종류' }), note: h('input', { value: p.note, 'aria-label': id + ' 메모' }) };
      x.cells = [h('strong', null, id), x.type, x.note, delBtn('presses', id)];
      return x;
    });
    function saveMaster() {
      pInputs.forEach(function (x) { db.presses[x.id] = L.cleanPress(Object.assign({}, db.presses[x.id] || {}, { type: x.type.value, note: x.note.value }), x.id); });
      save(); toast('설비 기준표를 저장했습니다.'); render();
    }
    var newP = h('input', { placeholder: '예: P5', 'aria-label': '새 프레스 이름' });
    var backup = h('input', { type: 'file', accept: '.json' });
    backup.addEventListener('change', function () {
      var f = backup.files[0]; if (!f) return;
      f.text().then(function (t) {
        var o = JSON.parse(t); if (!o || !Array.isArray(o.records)) throw new Error('이 도구의 백업 파일이 아닙니다.');
        db = L.restoreDb(o); save(); toast('백업을 불러왔습니다(' + db.records.length + '행).'); render();
      }).catch(function (e) { toast('불러오지 못했습니다: ' + e.message, true); });
    });
    return [
      pageHead('설정', '설비 기준표 · 판정 기준 · AI 연결 · 백업'),
      h('section', { class: 'card' }, h('h2', null, '설비(프레스) 기준표'),
        h('p', { class: 'note' }, '로그를 가져오면 처음 보는 프레스가 자동으로 더해집니다. 「프레스 종류」를 비우면 로그의 값을 씁니다.'),
        pIds.length ? table(['프레스', '프레스 종류', '메모', ''], pInputs.map(function (x) { return x.cells; }), { cls: 'items' }) : h('p', { class: 'note' }, '아직 없습니다.'),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, newP, h('button', { type: 'button', class: 'btn', onclick: function () {
          var id = newP.value.trim(); if (!id) return; if (db.presses[id]) { toast('이미 있는 프레스입니다.', true); return; }
          db.presses[id] = L.emptyPress(id); save(); render();
        } }, '프레스 추가'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: saveMaster }, '기준표 저장'))),
      rulesCard(),
      AIP.settingsCard({ toast: toast, onChange: render }),
      h('section', { class: 'card' }, h('h2', null, '백업'),
        h('p', { class: 'note' }, '쌓인 로그 · 기준표 · 정비 · 고장 이력 · 수동 라벨은 이 브라우저에만 있습니다. 다른 PC 로 옮기거나 브라우저 정리 전에 JSON 으로 받아 두세요. 2초 센서 로그 원본은 너무 커서 JSON 에 넣지 않습니다(하루 묶음과 관리도 기준은 들어감) — 원본 CSV 를 따로 보관해 주세요.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () { download('프레스예지보전_백업_' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(db)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, backup, 'JSON 백업 불러오기')))
    ];
  }
  function delBtn(kind, id) {
    return h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'aria-label': id + ' 기준표에서 빼기', onclick: function () {
      var used = db.records.some(function (r) { return r.press === id; });
      if (!confirm(id + ' 을(를) 기준표에서 뺄까요?' + (used ? ' 로그에 남아 있어 다음에 가져오기를 하면 빈 칸으로 다시 생깁니다.' : ''))) return;
      delete db[kind][id]; save(); render();
    } }, '빼기');
  }
  function rulesCard() {
    var r = L.cleanRules(db.rules);
    var defs = [
      ['recentDays', '이상 감지 — 최근 구간(일)', 1, 1], ['baseDays', '이상 감지 — 기준선 구간(일)', 1, 1], ['minBase', '기준선에 필요한 최소 가동일', 1, 1],
      ['k', '관리한계 k (σ 배수)', 1, 0.5], ['kWarn', '주의 한계 (σ 배수)', 1, 0.5], ['persist', '연속 가동일 수(지속 조건)', 1, 1], ['spikes', '연속 아니어도 관리한계 밖 며칠이면 「주의」', 1, 1]];
    var inputs = {};
    var grid = h('div', { class: 'form-grid' }, defs.map(function (d) {
      var i = h('input', { type: 'number', min: 0, step: d[3], value: L.round(r[d[0]] * d[2], 2), inputmode: 'decimal' });
      inputs[d[0]] = { el: i, mul: d[2] };
      return fld(d[1], i);
    }));
    var method = h('select', { 'aria-label': '기준선 계산' }, h('option', { value: 'mad' }, '중앙값 · MAD (튀는 값에 강함, 권장)'), h('option', { value: 'sigma' }, '평균 · 표준편차'));
    method.value = r.method;
    var chBoxes = L.CHANNELS.map(function (c) { var b = h('input', { type: 'checkbox' }); b.checked = !!r.channels[c.id]; return { id: c.id, el: b, label: h('label', { class: 'opt' }, b, h('span', { class: 't' }, c.label)) }; });
    return h('section', { class: 'card', id: 'rules' }, h('h2', null, '판정 기준'),
      h('p', { class: 'note' }, '지금: ' + L.ruleText(r)),
      grid,
      h('div', { class: 'form-grid', style: 'margin-top:12px' }, fld('기준선 계산', method), h('div', { class: 'field span-all' }, h('span', null, '살펴볼 채널'), h('div', { class: 'opt-grid' }, chBoxes.map(function (c) { return c.label; })))),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var p = Object.assign({}, db.rules, { method: method.value, channels: {} }); // 화면에서 뺀 칸(수명 · 주기)의 옛 값은 그대로
          Object.keys(inputs).forEach(function (k) { p[k] = Number(inputs[k].el.value) / inputs[k].mul; });
          chBoxes.forEach(function (c) { p.channels[c.id] = c.el.checked; });
          db.rules = L.cleanRules(p); save(); toast('판정 기준을 바꿨습니다.'); render();
        } }, '기준 적용'),
        h('button', { type: 'button', class: 'btn', onclick: function () { db.rules = L.cleanRules({}); save(); toast('기본값으로 되돌렸습니다.'); render(); } }, '기본값으로')));
  }

  /* ── 라우터 ─────────────────────────────── */
  var PAGES = [
    { id: 'dash', no: '홈', t: '대시보드', s: '프레스 정상 / 이상 상태', fn: pageDash },
    { id: 'spc', no: '실', t: '실시간 관리도', s: '2초 센서 ±3σ·온도 3구간', fn: pageSpc },
    { id: 'live', no: '연', t: '실시간 연결', s: '시뮬레이터·HTTP·WebSocket', fn: pageLive },
    { id: 'lead', no: '이', t: '고장 전 이탈', s: '이력 맞춰 보기·리드타임', fn: pageLead },
    { id: 'import', no: '0', t: '데이터 가져오기', s: '로그 엑셀·CSV 여러 개', fn: pageImport },
    { id: 'anomaly', no: '①', t: '이상 감지', s: '전류·온도·진동·전압', fn: pageAnomaly },
    { id: 'ml', no: '②', t: '머신러닝 · 라벨링', s: '고장 이력으로 정상/이상 라벨', fn: pageMl },
    { id: 'ai', no: '③', t: 'AI 분석', s: '사실만 담은 프롬프트', fn: pageAi },
    { id: 'settings', no: '설', t: '설정', s: '기준표·판정 기준·백업', fn: pageSettings }
  ];
  function route() { var id = (location.hash || '').replace(/^#\//, '').split('?')[0]; return PAGES.filter(function (p) { return p.id === id; })[0] || (db.records.length ? PAGES[0] : PAGES.filter(function (p) { return p.id === 'import'; })[0]); }
  function render() {
    var p = route();
    db.ml = LB.cleanState(db.ml); // 옛 자료(칸 없음)는 기본값
    A = L.analyze(db);
    document.body.setAttribute('data-route', p.id);
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    PAGES.forEach(function (x) {
      var badge = null;
      if (x.id === 'live' && live.unseen) badge = h('span', { class: 'nav-badge', title: '새 경보' }, String(live.unseen));
      if (x.id === 'dash' && db.records.length) { var nb = A.statuses.filter(function (s) { return s.level === 'bad'; }).length; if (nb) badge = h('span', { class: 'nav-badge', title: '점검 필요 ' + nb + '대' }, String(nb)); }
      nav.appendChild(h('a', { href: '#/' + x.id, 'aria-current': x === p ? 'page' : null }, h('span', { class: 'no' }, x.no), h('span', { class: 't' }, x.t, badge), h('span', { class: 's' }, x.s)));
    });
    document.getElementById('dataChip').textContent = db.records.length
      ? '기준일 ' + A.asOf + ' · 프레스 ' + A.statuses.length + '대 · 로그 ' + L.fmtN(db.records.length) + '행'
      : '데이터 없음';
    if (rawRows()) document.getElementById('dataChip').textContent += ' · 2초 로그 ' + L.fmtN(rawRows()) + '행';
    if (liveRunning()) document.getElementById('dataChip').textContent += ' · 실시간 연결 중';
    var b = document.getElementById('sampleBanner');
    b.hidden = !db.sample;
    if (db.sampleKind === 'virtual') b.textContent = '지금 보시는 것은 가상 더미 데이터입니다(수강생 결정 10-27 — 실제 로그·고장 이력 대신). 프레스 P1~P3 × 10/19~10/23, 08~12시·13~17시 2초 로그와 고장 3건(P2 10/21 16:10 과열 정지 · P1 10/22 14:20 베어링 손상 · P3 10/23 11:10 금형 균열)·정비 3건·금형 교체 2건 이력을 지어 넣었습니다. 「고장 전 이탈」에서 경보가 고장보다 몇 시간 먼저 나타났는지, 「머신러닝 · 라벨링」에서 같은 고장 3건(정비 · 고장 이력 V-0001~0003)으로 붙인 정상 / 이상 라벨을 봅니다.';
    else if (db.sampleKind === 'raw') b.textContent = '지금 보시는 것은 2초 로그 가상 샘플입니다(프레스 P1~P4 × 10/19~10/21, 08~12시·13~17시). P2 10/21 오후 전류·온도 상승, P3 10/20 10:00 20분 정지와 10/21 14시대 진동 튐, P4 10/20 13:00 금형 M-07→M-08 교체, P4 10/21 오후 전압 조금 내려앉음(연속 9점 규칙으로 보임), P1 10/20 15:10 기록 끊김을 심어 두었습니다. 3일치라 일 단위 이상 감지는 「비교 못 함」으로 나옵니다.';
    else b.textContent = '지금 보시는 것은 가상 샘플입니다(프레스 P1~P4 × 90일). P2 전류·온도 상승(마지막 2주)을 일부러 심어 두었습니다. 실제 로그를 넣기 전에 「데이터 가져오기 → 모든 데이터 지우기」를 해 주세요.';
    main.innerHTML = '';
    add(main, p.fn());
    if (p.id === 'live') liveRefresh();
    document.title = p.t + ' — 프레스 예지보전';
    save();
  }
  window.addEventListener('hashchange', function () { render(); main.focus(); window.scrollTo(0, 0); });
  render();
  RS.loadAll().then(function (m) {
    rawSaved = RS.available() !== false;
    var ks = Object.keys(m).filter(function (k) { return m[k] && m[k].n && m[k].t; });
    if (!ks.length) return;
    ks.forEach(function (k) { raw[k] = m[k]; });
    render();
  });
})();
