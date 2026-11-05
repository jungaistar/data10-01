// 가상 샘플 파일 만들기: node scripts/make-samples.js
// js/sample-data.js 의 90일치를 달마다 한 파일로 씁니다(7·8·9월 .xlsx, 10월 .csv — 전부 지어낸 값).
// 쓴 파일을 앱과 같은 방식으로 다시 읽어(엑셀은 cellDates:false, CSV 는 UTF-8/EUC-KR 판별 후 raw) 원본 행과 같은지 확인합니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const b = Sample.build();
let recs = [];
for (const f of b.files) {
  const file = path.join(out, f.fileName);
  if (f.kind === 'xlsx') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, Sample.toSheet(XLSX, f.aoa), '프레스 로그');
    fs.writeFileSync(file, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  } else {
    fs.writeFileSync(file, '﻿' + f.csv, 'utf8'); // 엑셀에서 한글이 깨지지 않게 BOM
  }
  // 다시 읽기 — 앱(js/app.js readFile)과 같은 길
  const bytes = fs.readFileSync(file);
  const wb2 = f.kind === 'csv'
    ? XLSX.read(L.decodeCsv(bytes).text, { type: 'string', raw: true })
    : XLSX.read(bytes, { type: 'buffer', cellDates: false });
  const aoa = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, raw: true, defval: null });
  const p = L.parseSheet(aoa, { fileName: f.fileName });
  if (p.det.missing.length || p.warnings.length || p.det.warnings.length) throw new Error(f.fileName + ' 다시 읽기 문제: ' + JSON.stringify(p.det.warnings.concat(p.warnings).slice(0, 3)));
  const want = f.aoa.length - 2 + (f.kind === 'csv' ? 0 : 0);
  if (p.records.length !== want) throw new Error(f.fileName + ' 행 수가 다름: ' + p.records.length + ' / ' + want);
  const first = p.records[0], src = b.rows.find(r => r.date === first.date && r.press === first.press);
  if (!src || src.strokes !== first.strokes || src.current !== first.current || src.pressCum !== first.pressCum) throw new Error(f.fileName + ' 첫 행 값이 원본과 다름');
  recs = L.mergeRecords(recs, p.records).records;
  console.log(f.fileName, '행', p.records.length);
}
const r = L.dataRange(recs);
console.log('누적 행', recs.length, '기간', r.first, '~', r.last);

// ── 2차: 2초 센서 로그 샘플(수강생 로그와 같은 형식, 모든 칸 따옴표) ──
// 10/21 오후(13:00~17:00) 4대 = 28,800행. P2 전류·온도 상승, P3 진동 튐, P4 전압 내려앉음이 이 구간에 들어 있습니다.
// 앱과 같은 길(앞부분으로 2초 로그 판별 → 조각으로 나눠 읽기)로 다시 읽어 행 수·첫 행 값을 확인합니다.
{
  const P = require('../js/spc.js');
  const name = '센서로그_샘플_2026-10-21.csv';
  const lines = [Sample.rawCsvLine(Sample.RAW_HEAD)], first = [];
  // 3일치 흐름(잡음 상태·누적 타수)을 그대로 이어 가려고 전체를 만들고 10/21 오후만 남깁니다
  Sample.buildRaw(row => { if (row[0].startsWith('2026-10-21') && row[0].slice(11) >= '13:00:00') { if (!first.length) first.push(row); lines.push(Sample.rawCsvLine(row)); } });
  const file = path.join(out, name);
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
  const bytes = fs.readFileSync(file), text = new TextDecoder('utf-8').decode(bytes);
  const head = P.parseCsvText(text.slice(0, 20000)); head.pop();
  const det = L.detectColumns(head);
  if (!P.isHighFreq(head, det).high) throw new Error(name + ' 2초 로그로 판별되지 않음');
  const b = P.createRawBuilder(det); let n = 0;
  const parser = P.createCsvParser(r => { if (n++ > det.headerRow) b.add(r, n); });
  for (let i = 0; i < text.length; i += 1 << 20) parser.push(text.slice(i, i + (1 << 20)));
  parser.end();
  const res = b.finish();
  if (res.rows !== lines.length - 1 || res.warnCount) throw new Error(name + ' 다시 읽기 행 수·알림 ' + res.rows + ' / ' + (lines.length - 1) + ' · ' + res.warnCount);
  const s0 = res.series[first[0][1]];
  if (P.stampText(s0.t[0]) !== first[0][0] || Math.abs(s0.current[0] - Number(first[0][6])) > 1e-3) throw new Error(name + ' 첫 행 값이 원본과 다름');
  console.log(name, '행', res.rows, '·', (bytes.length / 1048576).toFixed(1) + 'MB', '· 프레스', Object.keys(res.series).join(','));
}

// ── 3차: 가상 고장·정비 이력 CSV(samples/) · 실시간 연결 받는 형식 표본(tools/sample-rows.json·csv) ──
// 다시 읽어(이력 → pdm.js eventsFromAoa · 표본 → live.js parsePayload) 건수가 같은지 확인합니다.
{
  const V = require('../js/virtual-data.js'), D = require('../js/pdm.js'), LV = require('../js/live.js'), P = require('../js/spc.js');
  const q = c => { c = String(c == null ? '' : c); return /[",\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
  const ev = D.eventsToAoa(V.events()), name = '가상_고장정비이력_2026-10-19~23.csv';
  fs.writeFileSync(path.join(out, name), '﻿' + ev.map(r => r.map(q).join(',')).join('\r\n') + '\r\n', 'utf8');
  const back = D.eventsFromAoa(P.parseCsvText(fs.readFileSync(path.join(out, name), 'utf8')));
  if (back.events.length !== V.EVENTS.length || !back.events.every(e => e.virtual)) throw new Error(name + ' 다시 읽기 ' + back.events.length);
  console.log(name, '이력', back.events.length, '건');
  const tools = path.join(__dirname, '..', 'tools');
  const sim = V.createSimulator({ warm: true, seed: 7 }), t0 = V.sec('2026-10-27 10:00:00'), rows = [];
  for (let t = t0; t < t0 + 6; t += 2) sim.tick(t).forEach(r => rows.push(V.toJson(r)));
  const doc = { _설명: '실시간 연결 받는 형식 표본(가상 값). rows 배열에 2초마다의 행. time 은 벽시계(yyyy-mm-dd hh:mm:ss). press·time 은 꼭, 나머지는 있는 만큼. 배열만 보내도 되고 한 행 객체만 보내도 됩니다.', rows };
  fs.writeFileSync(path.join(tools, 'sample-rows.json'), JSON.stringify(doc, null, 2) + '\n');
  const head = ['time', 'press', 'pressType', 'die', 'pressCum', 'dieCum', 'current', 'voltage', 'temp', 'vib'];
  fs.writeFileSync(path.join(tools, 'sample-rows.csv'), [head.join(',')].concat(rows.map(r => head.map(k => q(r[k])).join(','))).join('\n') + '\n');
  const a = LV.parsePayload(fs.readFileSync(path.join(tools, 'sample-rows.json'), 'utf8'), 'application/json'), b = LV.parsePayload(fs.readFileSync(path.join(tools, 'sample-rows.csv'), 'utf8'), 'text/csv');
  if (a.rows.length !== 9 || b.rows.length !== 9) throw new Error('받는 형식 표본 다시 읽기 ' + a.rows.length + ' / ' + b.rows.length);
  console.log('tools/sample-rows.json · .csv', '행', a.rows.length);
}
