// 실행: node test/relay.test.mjs   (의존성 없음 — tools/relay.mjs 를 띄워 실시간 연결 받는 길을 node 로 시험)
// ① 시뮬레이터 모드: /api/rows(JSON·since) · /api/rows.csv · CORS·사설망 허용 머리 · OPTIONS · /api/inject · 페이지(HEAD Last-Modified) · 폴더 밖 막기
// ② js/live.js 의 poll·ws 받는 길이 실제로 행을 이어 받는지(같은 시각 두 번 안 셈)
// ③ CSV 재생 모드(--csv samples/센서로그_샘플_2026-10-21.csv, 60배속)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LV = require('../js/live.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function start(args, port) {
  const p = spawn(process.execPath, [path.join(root, 'tools/relay.mjs'), '--port', String(port), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return { p, log: () => out, ready: (async () => { for (let i = 0; i < 50; i++) { if (/중계 서버/.test(out)) return; await sleep(100); } throw new Error('relay 가 뜨지 않음: ' + out); })() };
}
const PORT = 18000 + Math.floor(Math.random() * 1000), base = 'http://127.0.0.1:' + PORT;

console.log('① 중계 서버 — 시뮬레이터');
const r1 = start([], PORT);
await r1.ready;
await test('/api/rows — JSON { server_time, rows }, 3대, CORS·사설망 허용 머리', async () => {
  const res = await fetch(base + '/api/rows?limit=9');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const j = await res.json();
  assert.equal(j.rows.length, 9); assert.equal(j.source, 'sim');
  assert.deepEqual([...new Set(j.rows.map(r => r.press))].sort(), ['P1', 'P2', 'P3']);
  const p = LV.parsePayload(JSON.stringify(j), res.headers.get('content-type'));
  assert.equal(p.rows.length, 9); assert.ok(p.rows.every(r => isFinite(r.t) && isFinite(r.current) && isFinite(r.temp)));
});
await test('since — 그 뒤 행만(오래된 것부터), CSV 도 같은 행', async () => {
  const all = (await (await fetch(base + '/api/rows?limit=60')).json()).rows;
  const mid = all[30].time;
  const after = (await (await fetch(base + '/api/rows?since=' + encodeURIComponent(mid))).json()).rows;
  assert.ok(after.length > 0 && after.every(r => r.time > mid), 'since 뒤만');
  const csv = await (await fetch(base + '/api/rows.csv?since=' + encodeURIComponent(mid))).text();
  assert.equal(LV.parsePayload(csv, 'text/csv').rows.length, after.length);
  assert.ok(/^time,press,pressType/.test(csv));
});
await test('OPTIONS 미리 묻기 204 · 고장 징후 넣기 · 상태', async () => {
  const o = await fetch(base + '/api/rows', { method: 'OPTIONS', headers: { 'Access-Control-Request-Private-Network': 'true', Origin: 'https://data10-01.jobability.co.kr' } });
  assert.equal(o.status, 204); assert.equal(o.headers.get('access-control-allow-private-network'), 'true');
  const i = await (await fetch(base + '/api/inject?press=P2&kind=heat')).json();
  assert.equal(i.ok, true); assert.equal(i.faults.P2.kind, 'heat');
  assert.equal((await fetch(base + '/api/inject?press=P2&kind=nope')).status, 400);
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.ok, true); assert.ok(h.rows >= 900);
});
await test('페이지 — index.html(HEAD 에 Last-Modified, fresh-guard 용) · 폴더 밖·.git 은 막음', async () => {
  const g = await fetch(base + '/');
  assert.equal(g.status, 200); assert.ok(/프레스 예지보전/.test(await g.text()));
  const hd = await fetch(base + '/index.html', { method: 'HEAD' });
  assert.equal(hd.status, 200); assert.ok(hd.headers.get('last-modified'));
  assert.equal((await fetch(base + '/js/live.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(base + '/..%2F..%2Fetc%2Fpasswd')).status, 403);
  assert.ok([403, 404].includes((await fetch(base + '/.git/config')).status));
});
await test('js/live.js poll — {since} 로 이어 받기, 같은 시각 두 번 안 셈 · 받는 중 상태', async () => {
  const buf = LV.createBuffer(), states = [];
  const src = LV.createSource('poll', { url: base + '/api/rows?since={since}', intervalSec: 1 }, { since: () => buf.lastTime(), onRows: r => buf.append(r), onStatus: s => states.push(s.state) });
  src.start(); await sleep(4300); src.stop();
  assert.ok(src.info.requests >= 4, '요청 ' + src.info.requests); assert.equal(src.info.errors, 0);
  assert.ok(states.includes('live'));
  assert.equal(buf.stat.dup, 0, '같은 시각 ' + buf.stat.dup);
  const s = buf.series('P1');
  for (let i = 1; i < s.n; i++) assert.ok(s.t[i] > s.t[i - 1]);
  assert.ok(s.t[s.n - 1] - s.t[0] >= 590, '처음 부르면 앞 10분, 그 뒤 받은 만큼 — ' + (s.t[s.n - 1] - s.t[0]) + '초');
});
await test('js/live.js poll — 주소가 틀리면 오류 상태(이유 포함)', async () => {
  const st = [];
  const src = LV.createSource('poll', { url: 'http://127.0.0.1:' + (PORT + 1) + '/api/rows', intervalSec: 1 }, { onRows: () => {}, onStatus: s => st.push(s) });
  src.start(); await sleep(800); src.stop();
  const e = st.find(x => x.state === 'error');
  assert.ok(e && /CORS|fetch failed|ECONNREFUSED|주소/.test(e.msg), JSON.stringify(st));
});
await test('js/live.js ws — 붙자마자 최근 30행, 그 뒤 2초마다 3행', async () => {
  const got = [];
  const src = LV.createSource('ws', { url: 'ws://127.0.0.1:' + PORT + '/ws' }, { onRows: r => got.push(r.length), onStatus: () => {} });
  src.start(); await sleep(4500); src.stop();
  assert.equal(got[0], 30); assert.ok(got.length >= 2 && got.slice(1).every(n => n === 3), got.join(','));
});
r1.p.kill();

console.log('② 중계 서버 — CSV 재생');
const r2 = start(['--csv', path.join(root, 'samples', '센서로그_샘플_2026-10-21.csv'), '--speed', '60'], PORT + 2);
await r2.ready;
await test('받은 로그 CSV 를 지금 시각으로 옮겨 60배속으로 흘려보냄 — 4대, 2초 간격', async () => {
  await sleep(2500);
  const j = await (await fetch('http://127.0.0.1:' + (PORT + 2) + '/api/rows?limit=5000')).json();
  assert.equal(j.source, 'csv');
  assert.deepEqual([...new Set(j.rows.map(r => r.press))].sort(), ['P1', 'P2', 'P3', 'P4']);
  assert.ok(j.rows.length >= 4 * 60, '행 ' + j.rows.length); // 2.5초 × 60배속 = 150초 → 대당 75행 남짓
  const span = (V => V.sec(j.rows[j.rows.length - 1].time) - V.sec(j.rows[0].time))(require('../js/virtual-data.js'));
  assert.ok(span >= 100, '데이터 시각이 배속만큼 앞서 감 ' + span);
  assert.ok(/CSV 재생: 28,800행/.test(r2.log()), r2.log());
  const p1 = j.rows.filter(r => r.press === 'P1').map(r => r.time);
  assert.equal(new Set(p1).size, p1.length, '같은 시각 없음');
});
r2.p.kill();

console.log('\n' + passed + '개 통과' + (failed ? ' — 실패 ' + failed + '개' : ''));
process.exitCode = failed ? 1 : 0;
