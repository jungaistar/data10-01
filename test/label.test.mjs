// 실행: node test/label.test.mjs   (의존성 없음) — v2.1 머신러닝 · 라벨링(js/label.js)
// 손으로 만든 작은 시계열과 가상 더미 데이터(3대 × 5일 + 정비 · 고장 이력 3건)로 검사합니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const P = require('../js/spc.js');
const D = require('../js/pdm.js');
const V = require('../js/virtual-data.js');
const LB = require('../js/label.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const T0 = P.parseStamp('2026-11-01 08:00:00');
/* 2초 간격 n 행, 값은 fn(i) → { current, voltage, temp, vib } */
function mk(press, n, fn) {
  const s = { press, n, t: new Float64Array(n), current: new Float64Array(n), voltage: new Float64Array(n), temp: new Float64Array(n), vib: new Float64Array(n) };
  for (let i = 0; i < n; i++) { s.t[i] = T0 + 2 * i; const v = fn ? fn(i) : {}; for (const c of ['current', 'voltage', 'temp', 'vib']) s[c][i] = v[c] == null ? NaN : v[c]; }
  return s;
}
const st = sec => P.stampText(T0 + sec);
const labAt = (s, res, sec) => res.lab[Math.round(sec / 2)];

console.log('정비 · 고장 이력 읽기');
test('영문 칸 이름(그림의 maintenance_log) — 8칸 모두, 엑셀 일련번호 날짜도', () => {
  const aoa = [['log_id', 'equipment_id', 'found_at', 'fixed_at', 'symptom', 'failure_part', 'cause', 'action'],
    ['A-1', 'PRESS-01', '2026-03-02 09:15', '2026-03-02 11:00', '이음', '베어링', '윤활 부족', '교체'],
    ['A-2', 'PRESS-01', 46100.5, 46100.75, '', '', '', '']];
  const r = LB.logsFromAoa(aoa);
  assert.equal(r.error, undefined); assert.equal(r.logs.length, 2);
  assert.deepEqual(Object.keys(r.map).sort(), ['action', 'cause', 'equipment_id', 'failure_part', 'fixed_at', 'found_at', 'log_id', 'symptom']);
  assert.equal(r.logs[0].found_at, '2026-03-02 09:15:00'); assert.equal(r.logs[0].fixed_at, '2026-03-02 11:00:00'); assert.equal(r.logs[0].cause, '윤활 부족');
  assert.equal(r.logs[1].found_at.slice(11), '12:00:00'); assert.equal(r.logs[1].fixed_at.slice(11), '18:00:00');
});
test('한글 별칭 · 제목 줄 · 칸 순서 바뀜 — 「조치」와 「조치 일시」를 섞지 않음, 설비 · 발견 일시 없는 행은 건너뜀, 조치 일시 없으면 발견 일시로', () => {
  const aoa = [['■ 정비 대장'], ['조치', '설비', '발견 일시', '조치 일시', '증상', '고장 부위', '원인', '정비 번호'],
    ['교체', 'P1', '2026-03-02 09:15:00', '', '진동', '베어링', '마모', ''],
    ['청소', '', '2026-03-03 09:00:00', '', '', '', '', ''],
    ['청소', 'P2', '날짜아님', '', '', '', '', '']];
  const r = LB.logsFromAoa(aoa);
  assert.equal(r.logs.length, 1); assert.equal(r.skipped, 2);
  assert.equal(r.map.action, 0); assert.equal(r.map.fixed_at, 3); assert.equal(r.map.log_id, 7);
  assert.equal(r.logs[0].action, '교체'); assert.equal(r.logs[0].noFix, true); assert.equal(r.logs[0].fixed_at, r.logs[0].found_at);
});
test('머리행이 없으면 알림 · 빈 표', () => {
  assert.ok(LB.logsFromAoa([['일자', '프레스'], ['2026-01-01', 'P1']]).error);
  assert.ok(LB.logsFromAoa([]).error);
});
test('정비 번호 — 비면 M-0001 꼴 다음 번호, 겹치면 -2 · 합치기는 같은 번호를 새 값으로 · 엑셀 왕복', () => {
  const list = LB.fillIds([LB.cleanLog({ log_id: 'M-0003', equipment_id: 'P1', found_at: '2026-01-01 10:00' }), LB.cleanLog({ equipment_id: 'P1', found_at: '2026-01-02 10:00' }), LB.cleanLog({ log_id: 'M-0003', equipment_id: 'P2', found_at: '2026-01-03 10:00' })]);
  assert.deepEqual(list.map(l => l.log_id), ['M-0003', 'M-0004', 'M-0003-2']);
  const merged = LB.mergeLogs(list, [Object.assign({}, list[0], { cause: '새 원인' })]);
  assert.equal(merged.length, 3); assert.equal(merged[0].cause, '새 원인');
  const back = LB.logsFromAoa(LB.logsToAoa(merged));
  assert.deepEqual(back.logs.map(l => l.log_id + l.equipment_id + l.found_at), merged.map(l => l.log_id + l.equipment_id + l.found_at));
});
test('「고장 전 이탈」 이력(가상 8건) → 고장 3건만, 조치 일시 = 고장 + 정지 분', () => {
  const r = LB.logsFromEvents(V.events());
  assert.equal(r.length, 3);
  const p2 = r.find(l => l.equipment_id === 'P2');
  assert.equal(p2.found_at, '2026-10-21 16:10:00'); assert.equal(p2.fixed_at, '2026-10-21 17:00:00'); assert.ok(p2.virtual);
});

console.log('라벨 규칙');
// 3,600행(2시간). 이력: 발견 +3,000초, 조치 +4,000초, 고장 전 0.25시간(900초), 안정 0.5시간(1,800초)
const S1 = mk('P-1', 3600, i => ({ current: 80 + (i % 3), voltage: 380, temp: 45, vib: 2 }));
const LOG1 = LB.cleanLogs([{ log_id: 'X1', equipment_id: 'p1', found_at: st(3000), fixed_at: st(4000) }]);
const RULE = { preH: 0.25, postH: 0.5 };
test('경계 — [발견 − 고장 전, 조치] 이상(양 끝 포함), (조치, 조치 + 안정] 제외, 나머지 정상 · 설비 이름은 「-」 · 대소문자 무시', () => {
  const res = LB.labelSeries(S1, LOG1, RULE, []);
  assert.equal(labAt(S1, res, 2098), 0); assert.equal(labAt(S1, res, 2100), 1); assert.equal(labAt(S1, res, 4000), 1);
  assert.equal(labAt(S1, res, 4002), 2); assert.equal(labAt(S1, res, 5800), 2); assert.equal(labAt(S1, res, 5802), 0);
  assert.equal(res.refs[res.ref[Math.round(3000 / 2)]], 'X1'); assert.equal(res.src[0], LB.SRC_DEFAULT); assert.equal(res.src[1500], LB.SRC_RULE);
  const c = LB.counts(res);
  assert.deepEqual(c.n, [1050 + 699, 951, 900]); assert.equal(c.total, 3600);
});
test('다른 설비 이력은 붙지 않음 · 이력 없음 = 모두 정상 · 빈 시계열', () => {
  assert.deepEqual(LB.counts(LB.labelSeries(S1, LB.cleanLogs([{ equipment_id: 'P2', found_at: st(3000) }]), RULE, [])).n, [3600, 0, 0]);
  assert.deepEqual(LB.counts(LB.labelSeries(S1, [], RULE, [])).n, [3600, 0, 0]);
  assert.equal(LB.labelSeries(mk('P1', 0), LOG1, RULE, []).lab.length, 0);
});
test('겹침 — 앞 이력의 제외 구간에 다음 이력의 고장 전 구간이 겹치면 이상이 이김', () => {
  const logs = LB.cleanLogs([{ log_id: 'A', equipment_id: 'P1', found_at: st(1000), fixed_at: st(1200) }, { log_id: 'B', equipment_id: 'P1', found_at: st(3000), fixed_at: st(3100) }]);
  const res = LB.labelSeries(S1, logs, { preH: 0.5, postH: 1 }, []); // A 제외 (1200, 4800] · B 이상 [1200, 3100]
  assert.equal(labAt(S1, res, 1300), 1); assert.equal(res.refs[res.ref[650]], 'B');
  assert.equal(labAt(S1, res, 3200), 2);
});
test('수동 라벨이 규칙보다 앞섬 · 나중에 넣은 수동이 이김 · 설비가 다르면 안 붙음', () => {
  const man = [LB.cleanManual({ id: 'h1', press: 'P1', from: st(2500), to: st(2700), label: 0 }), LB.cleanManual({ id: 'h2', press: 'P1', from: st(2600), to: st(2600), label: 2 }), LB.cleanManual({ id: 'h3', press: 'P9', from: st(0), to: st(100), label: 1 })];
  const res = LB.labelSeries(S1, LOG1, RULE, man);
  assert.equal(labAt(S1, res, 2500), 0); assert.equal(res.src[1250], LB.SRC_MANUAL); assert.equal(res.refs[res.ref[1250]], 'h1');
  assert.equal(labAt(S1, res, 2600), 2); assert.equal(labAt(S1, res, 2702), 1); assert.equal(labAt(S1, res, 50), 0);
  const c = LB.counts(res); assert.equal(c.manual[0] + c.manual[2], 101);
  // 구간 — 근거가 바뀌는 곳에서 끊음
  const segs = LB.segments(S1, res);
  assert.deepEqual(segs.map(g => g.lab + ':' + g.id), ['0:', '1:X1', '0:h1', '2:h2', '0:h1', '1:X1', '2:X1', '0:']);
  assert.equal(segs.reduce((a, g) => a + g.n, 0), 3600);
  assert.equal(LB.labelBands(segs, -Infinity, Infinity).length, 6); // 정상(규칙) 둘은 띠 없음
});
test('수동 라벨 정리 — 시작 · 끝 뒤바뀜은 바로잡고, 시각 · 라벨이 틀리면 버림', () => {
  const m = LB.cleanManual({ press: 'P1', from: st(100), to: st(0), label: '1' });
  assert.equal(m.from, st(0)); assert.equal(m.label, 1);
  assert.equal(LB.cleanManual({ press: 'P1', from: 'x', to: st(0), label: 1 }), null);
  assert.equal(LB.cleanManual({ press: 'P1', from: st(0), to: st(0), label: 5 }), null);
  assert.equal(LB.cleanManual({ from: st(0), to: st(0), label: 1 }), null);
});
test('옛 자료 · 이상한 값 — cleanState 는 기본값(24시간 · 2시간, k 3 · 1분)으로', () => {
  const a = LB.cleanState(undefined);
  assert.deepEqual(a, { logs: [], rule: { preH: 24, postH: 2 }, model: { k: 3, binSec: 60 }, manual: [] });
  const b = LB.cleanState({ logs: [{ equipment_id: 'P1', found_at: '2026-01-01 10:00' }, { found_at: 'x' }, null], rule: { preH: -1, postH: '3' }, model: { k: 99, binSec: 7 }, manual: [{ press: 'P1', from: 'x' }] });
  assert.equal(b.logs.length, 1); assert.equal(b.logs[0].log_id, 'M-0001');
  assert.deepEqual(b.rule, { preH: 24, postH: 3 }); assert.deepEqual(b.model, { k: 3, binSec: 60 }); assert.deepEqual(b.manual, []);
});

console.log('특징 요약 · 데이터셋 · 기준선 모델');
test('특징 요약 — 라벨별 평균 · 표본 표준편차, 빈 값은 건너뜀', () => {
  const s = mk('P1', 6, i => ({ current: [1, 2, 3, 10, 20, 30][i], voltage: i === 0 ? null : 5 }));
  const res = LB.labelSeries(s, LB.cleanLogs([{ equipment_id: 'P1', found_at: st(6), fixed_at: st(10) }]), { preH: 0, postH: 0 }, []);
  const f = LB.featureStats([{ s, res }]);
  assert.equal(f[0].current.mean, 2); assert.equal(f[0].current.std, 1); assert.equal(f[0].current.n, 3);
  assert.equal(f[1].current.mean, 20); assert.equal(f[1].current.std, 10);
  assert.equal(f[0].voltage.n, 2); assert.equal(f[2].current.n, 0); assert.equal(f[2].current.mean, null);
});
test('학습용 CSV — 머리행 10칸 · 행 수 · 라벨 근거(rule/manual)와 정비 번호 · 제외 빼기 · 따옴표', () => {
  const man = [LB.cleanManual({ id: 'h1', press: 'P-1', from: st(0), to: st(2), label: 1 })];
  const res = LB.labelSeries(S1, LOG1, RULE, man);
  const all = LB.datasetCsv([{ s: S1, res }]), lines = all.parts.join('').split('\r\n').filter(Boolean);
  assert.equal(lines[0].replace('﻿', ''), 'time,equipment_id,voltage,current,vibration,temperature,label,label_name,label_source,log_id');
  assert.equal(all.rows, 3600); assert.equal(lines.length, 3601); assert.ok(all.parts.length >= 2, '5,000행보다 적어도 머리행 + 몸통');
  assert.equal(lines[1], st(0) + ',P-1,380.00,80.00,2.000,45.00,1,abnormal,manual,h1');
  assert.equal(lines[1 + 1500], st(3000) + ',P-1,380.00,80.00,2.000,45.00,1,abnormal,rule,X1');
  assert.equal(lines[1 + 3000].split(',').slice(6).join(','), '0,normal,rule,');
  assert.equal(LB.datasetCsv([{ s: S1, res }], { dropExclude: true }).rows, 2700);
  const s2 = mk('P,"2"', 1, () => ({})); const c2 = LB.datasetCsv([{ s: s2, res: LB.labelSeries(s2, [], RULE, []) }]).parts.join('');
  assert.ok(c2.includes(',"P,""2""",,,,,0,normal,rule,'), c2);
});
test('칸 묶기 — 칸마다 평균, 라벨은 가장 많은 것(같으면 이상)', () => {
  const s = mk('P1', 60, i => ({ current: i, voltage: 1, temp: 1, vib: 1 })); // 120초 = 1분 칸 2~3개
  const res = LB.labelSeries(s, [], RULE, [LB.cleanManual({ press: 'P1', from: st(0), to: st(58), label: 1 })]);
  const bs = LB.bins(s, res, 60);
  assert.ok(bs.length >= 2);
  const b0 = bs[0], n0 = b0.n; assert.equal(b0.lab, 1);
  assert.equal(b0.v.current, (n0 - 1) / 2);
});
test('z 점수 모델 — 정상 잡음 + 마지막 30분만 뚜렷하게 오름: 이상 칸(1시간) 절반만 잡고 헛경보 0 · 혼동행렬 합 = 시험 칸', () => {
  const wig = m => { const x = Math.sin(m * 12.9898 + 1) * 43758.5453; return x - Math.floor(x) - 0.5; }; // 결정적 잡음 ±0.5
  const n = 3600 * 3; // 6시간
  const s = mk('P1', n, i => { const m = Math.floor(i / 30); const up = i >= n - 900 ? 8 : 0; return { current: 80 + wig(m) + up, voltage: 380 + wig(m + 3) * 0.3, temp: 45 + wig(m + 5) * 0.2, vib: 2 + wig(m + 7) * 0.05 }; });
  const logs = LB.cleanLogs([{ log_id: 'F', equipment_id: 'P1', found_at: P.stampText(s.t[n - 1]), fixed_at: P.stampText(s.t[n - 1]) }]);
  const res = LB.labelSeries(s, logs, { preH: 1, postH: 0 }, []);
  const m = LB.zModel([{ s, res }], { k: 3, binSec: 60 });
  assert.equal(m.matrix.tp + m.matrix.fn, m.testAbnormal); assert.equal(m.matrix.n, m.test);
  assert.equal(m.matrix.fp, 0);
  assert.equal(m.matrix.tp, 30); assert.equal(m.matrix.fn, 30); // 고장 전 1시간 중 값이 아직 안 변한 앞 30분은 못 잡음
  assert.equal(m.per.P1.abnormal, 60);
  assert.equal(m.sweep.length, 5); assert.ok(m.sweep.every(c => c.tp + c.fn === m.testAbnormal));
  // 이상이 없으면 재현율 · 정밀도 없음(지어내지 않음)
  const m0 = LB.zModel([{ s, res: LB.labelSeries(s, [], RULE, []) }], {});
  assert.equal(m0.testAbnormal, 0); assert.equal(m0.matrix.recall, null);
});

console.log('가상 더미 데이터 + 정비 · 고장 이력 3건');
const VIRT = (() => {
  const det = L.detectColumns([V.HEAD]), b = P.createRawBuilder(det);
  V.build(r => b.add(r));
  return b.finish().series;
})();
const VLOGS = LB.cleanLogs(V.mlog());
const VLIST = Object.keys(VIRT).map(p => ({ s: VIRT[p], res: LB.labelSeries(VIRT[p], VLOGS, {}, []) }));
test('가상 이력 3건 = 「고장 전 이탈」 고장 3건과 같은 설비 · 같은 시각, 칸 8개 모두 채움', () => {
  assert.equal(VLOGS.length, 3);
  const fails = V.events().filter(e => e.kind === '고장');
  for (const f of fails) assert.ok(VLOGS.some(l => l.equipment_id === f.press && l.found_at === f.at), f.press + ' ' + f.at);
  assert.ok(VLOGS.every(l => l.virtual && l.symptom && l.failure_part && l.cause && l.action && !l.noFix));
});
test('고장 전 구간 기본 24시간 = pdm.js lookbackH — 앞선 고장 · 정비가 없는 P2 는 「고장 전 이탈」이 보는 구간과 이상 시작이 같음', () => {
  assert.equal(LB.DEFAULT_RULE.preH, D.DEFAULT_RULE.lookbackH);
  const w = D.failureWindows(V.events(), {}).find(x => x.press === 'P2');
  const x = VLIST.find(v => v.s.press === 'P2'), segs = LB.segments(x.s, x.res).filter(g => g.lab === 1);
  const r = P.rangeIdx(x.s, w.from, w.at);
  assert.equal(segs[0].from, x.s.t[r[0]]); assert.equal(P.stampText(segs[0].from), '2026-10-20 16:10:00');
});
test('설비마다 이상 · 제외가 붙고, 이상 구간에서 심어 둔 징후(P1 진동 · P2 온도)가 정상보다 큼', () => {
  for (const x of VLIST) { const c = LB.counts(x.res); assert.ok(c.n[1] > 0 && c.n[2] > 0 && c.n[0] > c.n[1], x.s.press + ' ' + c.n); }
  const p1 = LB.featureStats([VLIST.find(v => v.s.press === 'P1')]), p2 = LB.featureStats([VLIST.find(v => v.s.press === 'P2')]);
  assert.ok(p1[1].vib.std > p1[0].vib.std, 'P1 진동 흩어짐');
  assert.ok(p2[1].temp.mean > p2[0].temp.mean, 'P2 온도');
});
test('가상 데이터 기준선 모델 — 숫자는 계산한 값(범위만 확인) · 학습에 이상 칸을 쓰지 않음', () => {
  const m = LB.zModel(VLIST, {});
  assert.ok(m.testAbnormal > 0 && m.matrix.tn > 0);
  assert.ok(m.matrix.accuracy > 0 && m.matrix.accuracy < 1);
  assert.equal(m.matrix.tp + m.matrix.fn, m.testAbnormal);
  const nAb = VLIST.reduce((a, x) => a + LB.bins(x.s, x.res, 60).filter(b => b.lab === 1).length, 0);
  assert.equal(m.testAbnormal, nAb);
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패가 있습니다' : ''));
