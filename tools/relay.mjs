#!/usr/bin/env node
// 작은 중계 서버(참고용) — 설비 → [게이트웨이] → 이 중계 → 브라우저(실시간 연결) 의 「중계」 자리를 PC 한 대에서 시험해 보는 용도
// 의존성 없음(Node 18 이상). 실행:
//   node tools/relay.mjs                         가상 값(시뮬레이터) 2초마다 — 프레스 P1~P3
//   node tools/relay.mjs --csv samples/센서로그_샘플_2026-10-21.csv   받은 2초 로그 CSV 를 지금 시각으로 옮겨 다시 흘려보냄
//   옵션: --port 8787 · --speed 1(CSV 재생 배속 — 올리면 데이터 시각이 실제보다 앞서 감) · --origin *(CORS 허용 출처) · --no-static(페이지는 주지 않음) · --host 127.0.0.1
// 주소:
//   GET  /api/rows?since=2026-10-27%2010:00:00&limit=500   since 뒤의 행(JSON { server_time, rows:[…] }) — 페이지의 주소 칸에 http://localhost:8787/api/rows?since={since}
//   GET  /api/rows.csv?since=…                              같은 것을 CSV 로
//   GET  /api/health                                        상태
//   GET  /api/inject?press=P1&kind=heat                     (시뮬레이터) 고장 징후 넣기 — vib · spike · heat · stop · die
//   WS   /ws                                                연결하면 최근 30행, 그 뒤 새 행이 생길 때마다 { rows:[…] }
//   GET  /                                                  이 폴더의 도구 페이지(같은 출처라 CORS 걱정 없이 열림)
// 모든 응답에 CORS(Access-Control-Allow-Origin) 와 Access-Control-Allow-Private-Network 를 붙입니다 — 공개 HTTPS 페이지에서 내 PC(localhost)로 묻는 것을 브라우저가 허락하도록.
// 실제 설비에서는 이 자리에 Node-RED·작은 서버가 OPC UA / Modbus TCP / MQTT 로 값을 받아 같은 형식으로 내보내면 됩니다(기획서 12.4).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = require(path.join(ROOT, 'js/virtual-data.js'));
const P = require(path.join(ROOT, 'js/spc.js'));
const Live = require(path.join(ROOT, 'js/live.js'));

const args = process.argv.slice(2);
function opt(name, def) { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; return v == null || v.startsWith('--') ? true : v; }
const PORT = Number(opt('port', process.env.PORT || 8787));
const HOST = opt('host', '127.0.0.1');
const ORIGIN = opt('origin', '*');
const CSV = opt('csv', '');
const SPEED = Math.max(0.1, Number(opt('speed', 1)) || 1);
const STATIC = !args.includes('--no-static');
const KEEP = 20000;

const rows = []; // { t, json }
const clients = new Set();
let mode = 'sim', sim = null, replay = null;

function push(list) {
  if (!list.length) return;
  const js = list.map(r => ({ t: r.t, json: V.toJson(r) }));
  js.forEach(x => rows.push(x));
  if (rows.length > KEEP) rows.splice(0, rows.length - KEEP);
  const msg = JSON.stringify({ rows: js.map(x => x.json) });
  for (const c of clients) wsSend(c, msg);
}

if (CSV) {
  mode = 'csv';
  const text = fs.readFileSync(CSV, 'utf8');
  const parsed = Live.parsePayload(text, 'text/csv');
  if (!parsed.rows.length) { console.error('CSV 에서 행을 읽지 못했습니다: ' + (parsed.error || '')); process.exit(1); }
  const list = parsed.rows.sort((a, b) => a.t - b.t);
  const first = list[0].t, span = list[list.length - 1].t - first + 2;
  replay = { list, first, span, start: V.wallNow(), i: 0, loop: 0 };
  console.log(`CSV 재생: ${list.length.toLocaleString()}행 · ${P.stampText(first)} ~ ${P.stampText(list[list.length - 1].t)} → 지금 시각으로 옮겨 ${SPEED}배속`);
  setInterval(() => {
    const now = V.wallNow(), played = (now - replay.start) * SPEED, out = [];
    while (true) {
      if (replay.i >= list.length) { replay.i = 0; replay.loop++; }
      const r = list[replay.i], off = (r.t - first) + replay.loop * span;
      if (off > played) break;
      out.push({ ...r, t: replay.start + off, running: true }); // 간격은 그대로 — 배속을 올리면 데이터 시각이 실제 시각보다 앞서 감
      replay.i++;
      if (out.length > 5000) break;
    }
    push(out);
  }, 1000);
} else {
  sim = V.createSimulator({ warm: true });
  let clock = Math.floor(V.wallNow() / 2) * 2;
  for (let t = clock - 600; t < clock; t += 2) push(sim.tick(t)); // 앞 10분
  setInterval(() => { const now = V.wallNow(); while (clock <= now) { push(sim.tick(clock)); clock += 2; } }, 500);
  console.log('시뮬레이터: 프레스 ' + sim.presses.join(', ') + ' — 2초마다 (가상 값)');
}

/* ── HTTP ───────────────────────────────────────── */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN === true ? '*' : ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function pick(q) {
  const since = q.get('since') ? P.parseStamp(q.get('since')) : NaN;
  const limit = Math.min(5000, Math.max(1, Number(q.get('limit')) || (q.get('since') ? 500 : 1800))); // since 없이 처음 부르면 최근 1,800행(3대면 약 20분)
  const press = q.get('press');
  let list = rows;
  if (isFinite(since)) { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].t <= since) lo = m + 1; else hi = m; } list = rows.slice(lo); }
  if (press) list = list.filter(x => x.json.press === press);
  if (isFinite(since)) return list.slice(0, limit); // 오래된 것부터 — 다음 요청이 이어 받음
  return list.slice(-limit);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
const CSV_HEAD = ['time', 'press', 'pressType', 'die', 'pressCum', 'dieCum', 'current', 'voltage', 'temp', 'vib'];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (u.pathname === '/api/rows') { const l = pick(u.searchParams); json(res, 200, { server_time: P.stampText(V.wallNow()), source: mode, rows: l.map(x => x.json) }); return; }
  if (u.pathname === '/api/rows.csv') {
    const l = pick(u.searchParams); cors(res);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    res.end([CSV_HEAD.join(',')].concat(l.map(x => CSV_HEAD.map(k => x.json[k]).join(','))).join('\n') + '\n');
    return;
  }
  if (u.pathname === '/api/health') { json(res, 200, { ok: true, source: mode, rows: rows.length, last: rows.length ? rows[rows.length - 1].json.time : null, clients: clients.size, speed: SPEED }); return; }
  if (u.pathname === '/api/inject') {
    if (!sim) { json(res, 400, { ok: false, error: '시뮬레이터 모드에서만' }); return; }
    const ok = sim.inject(u.searchParams.get('press') || 'P1', u.searchParams.get('kind') || 'heat', V.wallNow());
    json(res, ok ? 200 : 400, { ok, faults: sim.faults() }); return;
  }
  if (!STATIC || (req.method !== 'GET' && req.method !== 'HEAD')) { json(res, 404, { error: 'not found' }); return; }
  let rel = decodeURIComponent(u.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || /[\\/]\.git([\\/]|$)/.test(file)) { json(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { json(res, 404, { error: 'not found' }); return; }
    const mt = fs.statSync(file).mtime.toUTCString(); // fresh-guard(HEAD 로 Last-Modified 를 봄)가 그대로 돌게
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Last-Modified': mt });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

/* ── WebSocket(의존성 없이 — 서버 → 브라우저 글자 보내기만) ─────────── */
function wsSend(sock, text) {
  const p = Buffer.from(text);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  try { sock.write(Buffer.concat([h, p])); } catch { clients.delete(sock); }
}
server.on('upgrade', (req, sock) => {
  const u = new URL(req.url, 'http://localhost');
  const key = req.headers['sec-websocket-key'];
  if (u.pathname !== '/ws' || !key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  clients.add(sock);
  wsSend(sock, JSON.stringify({ rows: rows.slice(-30).map(x => x.json) }));
  sock.on('data', buf => {
    const op = buf[0] & 0x0f;
    if (op === 0x8) { try { sock.write(Buffer.from([0x88, 0])); } catch { /* 닫힘 */ } sock.end(); clients.delete(sock); }
    else if (op === 0x9) { try { sock.write(Buffer.from([0x8a, 0])); } catch { /* 닫힘 */ } }
  });
  sock.on('close', () => clients.delete(sock));
  sock.on('error', () => clients.delete(sock));
});

server.listen(PORT, HOST, () => {
  console.log(`중계 서버: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/  (도구 페이지)`);
  console.log(`  실시간 연결 주소 — HTTP: http://localhost:${PORT}/api/rows?since={since}  ·  WebSocket: ws://localhost:${PORT}/ws`);
  console.log('  끝내려면 Ctrl+C');
});
