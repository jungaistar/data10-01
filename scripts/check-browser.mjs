// 헤드리스 브라우저로 주요 흐름 점검 (선택 — playwright-core 가 있는 PC 에서만)
//   PLAYWRIGHT_CORE=/경로/node_modules/playwright-core STUDENT_CSV=/경로/log.csv BIG_CSV=/경로/big.csv node scripts/check-browser.mjs
// 3차부터는 tools/relay.mjs(중계 서버)를 띄워 그 주소(http://127.0.0.1:포트/)로 엽니다 — 실시간 연결(HTTP·WebSocket)을 같은 서버로 시험하려고.
// 실시간 연결은 file:// 로 연 페이지에서도 한 번 더 받아 봅니다(다른 출처 → CORS). FILE=1 이면 처음부터 file:// 로 엽니다.
// 순서
//   ① 샘플 90일 → 대시보드 상태 → 화면별 가로 넘침
//   ② 수강생 형식 2초 로그 CSV 가져오기 → 실시간 관리도(관리도 4장·마지막 값·타수 719·이탈 목록·엑셀)
//   ③ 2초 로그 샘플(4대 × 3일) → P2 이탈·P4 금형 리셋·P3 정지 · 1분 평균 · 기준 바꾸기
//   ④ 큰 CSV(BIG_CSV, 하루 43,200행 × 4대)를 나눠 읽는 동안 화면이 멈추지 않는지(가장 긴 멈춤) · 다시 열어도 남는지(IndexedDB)
//   ⑤ 가상 고장 데이터(3대 × 5일 + 이력) → 고장 전 이탈(리드타임 3/3) · 온도 3구간 · 기준 바꾸기
//   ⑤-2 머신러닝 · 라벨링(v2.1) — 이력 3건 · 라벨 띠 · 수동 라벨 · 이력 넣기/고치기/빼기 · 학습용 CSV
//   ⑥ 실시간 연결 — 시뮬레이터(값이 이어 붙는지·밀려가는 창·고장 징후 → 경보)
//   ⑦ 실시간 연결 — HTTP 주소 받기·WebSocket(중계 서버), file:// 페이지에서 HTTP 받기(CORS)
// 순서로 누르고 JS 오류와 폭별 가로 넘침을 잽니다. BREAK=1 이면 일부러 넓은 상자를 넣어 넘침 검사가 잡는지 봅니다.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const fileUrl = 'file://' + path.join(root, 'index.html');
const PORT = 18900 + Math.floor(Math.random() * 90);
const relay = spawn(process.execPath, [path.join(root, 'tools/relay.mjs'), '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
let relayLog = ''; relay.stdout.on('data', d => { relayLog += d; }); relay.stderr.on('data', d => { relayLog += d; });
for (let i = 0; i < 50 && !/중계 서버/.test(relayLog); i++) await new Promise(r => setTimeout(r, 100));
const httpBase = 'http://127.0.0.1:' + PORT;
const url = process.env.FILE ? fileUrl : httpBase + '/index.html';
const STUDENT = process.env.STUDENT_CSV || path.join(root, 'samples', '센서로그_샘플_2026-10-21.csv');
const BIG = process.env.BIG_CSV || '';

const errors = [], problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// file:// 로 열면 fresh-guard(배포 판 확인)의 HEAD 요청을 브라우저가 거절하며 콘솔에 남김 — 정본 그대로 두는 것이라 이 한 줄만 셈에서 뺌
const benign = t => /URL scheme "file" is not supported/.test(t) && /_fg=/.test(t);
page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
function ok(cond, msg) { if (!cond) { problems.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok  ' + msg); }
async function go(hash) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(200); }
async function overflow() {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    document.querySelectorAll('main *').forEach(el => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      let p = el.parentElement, inScroll = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { inScroll = true; break; } p = p.parentElement; }
      if (!inScroll && r.right > W + 1) bad.push(el.tagName + '.' + el.className);
    });
    return bad.slice(0, 3);
  });
}
async function widths(ids, ws) {
  for (const id of ids) for (const w of ws) {
    await page.setViewportSize({ width: w, height: 900 });
    await go('#/' + id);
    const bad = await overflow();
    ok(!bad.length, id + ' ' + w + 'px 가로 넘침 없음' + (bad.length ? ' — ' + bad.join(', ') : ''));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
/* 2초 로그 반영이 끝날 때까지 — 버튼이 「읽는 중…」인 동안 기다림. 그동안 화면 멈춤(가장 긴 틈)을 잽니다 */
async function importFiles(files) {
  await go('#/import');
  await page.setInputFiles('input[type=file][accept=".xlsx,.xlsm,.xls,.csv,.txt"]', files);
  await page.waitForSelector('button:has-text("개 파일 반영")', { timeout: 30000 });
  await page.evaluate(() => { window.__gap = 0; let last = performance.now(); window.__iv = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n; }, 20); });
  const t0 = Date.now();
  await page.locator('button', { hasText: '개 파일 반영' }).click();
  await page.waitForFunction(() => !document.querySelector('button.btn-primary[disabled]') && !/읽는 중|합치는 중|일 집계/.test((document.getElementById('importProgress') || {}).textContent || '') , null, { timeout: 180000 });
  await page.waitForTimeout(300);
  const gap = await page.evaluate(() => { clearInterval(window.__iv); return window.__gap; });
  return { ms: Date.now() - t0, gap };
}

await page.goto(url);
if (process.env.BREAK) await page.addStyleTag({ content: '.page-head { min-width: 900px; } .lastcards { min-width: 900px; }' });

console.log('① 샘플 90일');
await page.locator('button', { hasText: '샘플 90일로 시작' }).first().click();
await page.waitForTimeout(500);
ok(await page.locator('#sampleBanner').isVisible(), '샘플 띠 보임');
const pcs = await page.locator('.press-grid .pcard').evaluateAll(a => a.map(x => x.querySelector('h3').textContent + ':' + x.className.replace(/.*lv-/, '')));
ok(pcs.join(' ') === 'P1:ok P2:bad P3:ok P4:ok', '대시보드 프레스 상태 — 센서만(v2.1, 금형 · 오버홀 근거 없음) (' + pcs.join(' ') + ')');
const dashT = await page.textContent('#main');
ok(!/금형 수명|오버홀|정비 일정/.test(dashT), '대시보드에 금형 수명 · 오버홀 · 정비 일정 없음(v2.1)');
const navT = await page.textContent('#nav');
ok(!/금형 타수|오버홀 알림|월별 타수 보고서/.test(navT) && /머신러닝 · 라벨링/.test(navT), '왼쪽 메뉴 — 세 탭 빠지고 머신러닝 · 라벨링 있음');
await go('#/die');
ok(await page.evaluate(() => document.body.getAttribute('data-route')) === 'dash', '옛 주소 #/die 는 대시보드로');
ok((await page.textContent('#main')).includes('아직 2초 센서 로그가 없습니다') === false, '대시보드에 빈 2초 로그 문구 없음');
await go('#/spc');
ok((await page.textContent('#main')).includes('아직 2초 센서 로그가 없습니다'), '실시간 관리도 — 2초 로그 없을 때 안내');
await widths(['dash', 'import', 'anomaly', 'ml', 'ai', 'settings', 'spc'], [1280, 390]);

console.log('② 수강생 형식 2초 로그 CSV — ' + path.basename(STUDENT));
const r1 = await importFiles([STUDENT]);
ok(true, '반영 ' + r1.ms + 'ms · 가장 긴 멈춤 ' + Math.round(r1.gap) + 'ms');
await go('#/spc');
const main2 = await page.textContent('#main');
ok(await page.locator('svg.chart.spc').count() === 4, '관리도 4장(전류·전압·온도·진동)');
ok(await page.locator('.lastcard').count() === 4, '마지막 값 카드 4개');
ok(await page.locator('svg.chart.spc line.lim').count() === 7, 'UCL·LCL 6줄(전류·전압·진동) + 온도 위험선 1줄');
ok(await page.locator('svg.chart.spc .zone').count() === 3, '온도 3구간 띠(예열·안정 생산·위험)');
ok(await page.locator('svg.chart.spc .base-zone').count() === 0, '기준 구간 = 전체 구간(3차 기본) — 띠 없음');
ok(/데이터가 있는 전체 구간 \(기본\)/.test(await page.locator('#spcRules select[aria-label="기준 구간"]').textContent()), '기준 구간 고르기에 「전체 구간(기본)」');
if (STUDENT.endsWith('log.csv')) {
  ok(/719타/.test(main2), '타수 719 (누적 1,890,112 → 1,890,831)');
  ok(/99\.9%/.test(main2), '기준(10초 1타) 대비 99.9%');
  ok(/이탈 목록 \(0번\)/.test(main2), '표본 표준편차·전체 구간 기준 — 이탈 0번');
}
await widths(['spc'], [1280, 768, 390, 360]);
// 일부러 이동범위 방식으로 바꾸면 이탈이 쏟아짐(설명문과 같은 결과인지) — 3차부터 온도는 3구간이라 전류·전압·진동만 셈
const outPts = t => [...t.matchAll(/번\(([\d,]+)점\)/g)].reduce((a, m) => a + +m[1].replace(/,/g, ''), 0);
const sdN = outPts(await page.textContent('.lastcards'));
await page.locator('#spcRules select[aria-label="σ 계산"]').selectOption('mr');
await page.locator('#spcRules button', { hasText: '기준 적용' }).click();
await page.waitForTimeout(300);
const mrText = await page.textContent('#main');
const mrN = outPts(await page.textContent('.lastcards'));
// 받은 로그(앞뒤 값이 거의 같음)에서만 뚜렷 — 리포의 가상 샘플은 2초마다 잡음이 커서 두 방식이 비슷함
if (STUDENT.endsWith('log.csv')) ok(mrN >= sdN * 3 + 50, '이동범위(MR̄/1.128)로 바꾸면 이탈점이 많아짐 — ' + sdN + '점 → ' + mrN + '점');
else ok(/MR̄\/1\.128/.test(await page.textContent('.spc-charts')), '이동범위(MR̄/1.128)로 바꾸면 그래프 제목의 σ 방식이 바뀜 (이탈점 ' + sdN + ' → ' + mrN + ')');
await page.locator('#spcRules button', { hasText: '기본값으로' }).click();
await page.waitForTimeout(300);
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: '엑셀로 내려받기(이탈 목록' }).click()]);
ok(/^관리도_.*\.xlsx$/.test(dl.suggestedFilename()), '관리도 엑셀 내려받기 ' + dl.suggestedFilename());
await go('#/dash');
ok(await page.locator('.pcard', { hasText: '최근 1시간 타수' }).count() >= 1, '대시보드에 2초 센서 마지막 값 카드');
await widths(['dash', 'import'], [1280, 390]);

console.log('③ 2초 로그 샘플(4대 × 3일)');
await go('#/import');
await page.locator('button', { hasText: '2초 로그 샘플(4대 × 3일)' }).click();
await page.waitForFunction(() => location.hash === '#/spc' && document.querySelectorAll('svg.chart.spc').length === 4, null, { timeout: 60000 });
await page.waitForTimeout(300);
ok((await page.textContent('#dataChip')).includes('172,350'), '2초 로그 172,350행');
ok((await page.textContent('#sampleBanner')).includes('2초 로그 가상 샘플'), '2초 로그 샘플 띠');
await page.locator('select[aria-label="프레스"]').selectOption('P2');
await page.waitForTimeout(300);
let t = await page.textContent('#main');
ok(/2026-10-21 1[3-6]:/.test(t) && /높음/.test(t), 'P2 10/21 오후 전류 이탈(높음)이 목록에');
ok(await page.locator('svg.chart.spc circle.viol').count() > 0, '이탈점 빨간 점');
await page.locator('select[aria-label="묶어 보기"]').selectOption('60');
await page.waitForTimeout(300);
ok((await page.textContent('#main')).includes('1분 평균'), '1분 평균으로 묶어 보기');
await page.locator('select[aria-label="프레스"]').selectOption('P4');
await page.waitForTimeout(300);
t = await page.textContent('#main');
ok(t.includes('M-07→M-08') && t.includes('2026-10-20 13:00:00'), 'P4 금형 리셋(교체) 감지');
await page.locator('select[aria-label="프레스"]').selectOption('P3');
await page.waitForTimeout(300);
ok(/정지 구간 1번/.test(await page.textContent('#main')), 'P3 정지 구간 1번');
await page.locator('.seg-sm button', { hasText: '최근 30분' }).click();
await page.waitForTimeout(300);
ok(/2026-10-21 16:29:5\d ~ 2026-10-21 16:59:58/.test(await page.textContent('#main')), '최근 30분 보기(로그 마지막 시각 기준)');
await widths(['spc', 'dash', 'anomaly'], [1280, 390]);

if (BIG && fs.existsSync(BIG)) {
  console.log('④ 큰 CSV — ' + (fs.statSync(BIG).size / 1048576).toFixed(1) + 'MB');
  const r = await importFiles([BIG]);
  ok(r.gap < 1500, '나눠 읽는 동안 가장 긴 멈춤 ' + Math.round(r.gap) + 'ms (< 1.5초) · 전체 ' + (r.ms / 1000).toFixed(1) + '초');
  await go('#/spc');
  ok((await page.textContent('#dataChip')).includes('345,150'), '샘플 172,350 + 큰 파일 172,800 = 345,150행 (' + (await page.textContent('#dataChip')) + ')');
  const t0 = Date.now(); await page.locator('select[aria-label="프레스"]').selectOption('P1'); await page.waitForTimeout(50);
  ok(Date.now() - t0 < 3000, '프레스 바꿔 다시 그리기 ' + (Date.now() - t0) + 'ms');
  await page.reload(); await page.waitForTimeout(1500);
  ok((await page.textContent('#dataChip')).includes('345,150'), '다시 열어도 2초 로그가 남음(IndexedDB)');
}

console.log('⑤ 가상 고장 데이터(3대 × 5일 + 이력)');
await go('#/import');
await page.locator('button', { hasText: '가상 고장 데이터(3대' }).click();
await page.waitForFunction(() => location.hash === '#/lead' && document.querySelectorAll('.lead-fail').length === 3, null, { timeout: 90000 });
await page.waitForTimeout(300);
let lt = await page.textContent('#main');
ok((await page.textContent('#dataChip')).includes('216,000'), '2초 로그 216,000행');
ok((await page.textContent('#sampleBanner')).includes('가상 더미 데이터'), '가상 데이터 띠');
ok(lt.includes('가상 데이터입니다'), '리드타임 화면에 「가상」 안내');
ok(/미리 잡은 고장3 \/ 3/.test(lt), '고장 3건 모두 고장 전에 경보');
ok(/첫 경보 2026-10-21 14:4\d:\d\d · 온도/.test(lt), 'P2 과열 — 온도 위험 구간 경보가 먼저');
ok(/전체 구간 − 고장 전 구간/.test(lt), '관리선 기준 견주기(전체 구간 vs 고장 전 구간 뺌)');
ok(await page.locator('svg.chart.timeline').count() === 3, '시간 줄 3대');
ok(await page.locator('svg.chart.timeline .tl-item.tl-pre').count() >= 3, '시간 줄에 고장 전 경보 막대');
ok(await page.locator('svg.chart.timeline path.tl-fail').count() === 3, '시간 줄에 고장 ▼ 3개');
ok(await page.locator('.lead-fail svg.chart.spc line.mark-fail').count() === 3, '고장별 그래프에 고장 시각 세로선');
ok(await page.locator('#events tbody tr').count() === 8, '이력 8건 표');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: '엑셀로 내려받기(고장별 리드타임' }).click()]);
ok(dl2.suggestedFilename() === '고장전이탈_리드타임.xlsx', '리드타임 엑셀 ' + dl2.suggestedFilename());
await widths(['lead'], [1280, 768, 390, 360]);
// 이력 넣기 → 표에 늘어남, 지우기
await page.locator('#events input[aria-label="일시"]').fill('2026-10-20T10:00');
await page.locator('#events input[aria-label="프레스"]').fill('P1');
await page.locator('#events input[aria-label="내용"]').fill('시험 정비');
await page.locator('#events select[aria-label="구분"]').selectOption('정비');
await page.locator('#events button', { hasText: '이력 넣기' }).click();
await page.waitForTimeout(300);
ok(await page.locator('#events tbody tr').count() === 9, '이력 넣기 → 9건');
await page.locator('#events tr', { hasText: '시험 정비' }).locator('button', { hasText: '지우기' }).click();
await page.waitForTimeout(300);
ok(await page.locator('#events tbody tr').count() === 8, '이력 지우기 → 8건');
// 온도 3구간 — P2
await go('#/spc');
await page.locator('select[aria-label="프레스"]').selectOption('P2');
await page.waitForTimeout(400);
lt = await page.textContent('#main');
ok(await page.locator('svg.chart.spc .zone').count() === 3, 'P2 온도 3구간 띠');
ok(/위험 구간 \d+번 \(경보 1번\)/.test(lt), 'P2 위험 구간 경보 1번');
ok(/예열 10번/.test(lt), 'P2 예열 10번(아침·점심 뒤)');
ok(await page.locator('#zoneCard .tile').count() === 4, '구간별 시간·예열 시간 칸 4개');
await page.locator('#zoneCard input[aria-label="위험 시작 온도"]').fill('60');
await page.locator('#zoneCard button', { hasText: 'P2 기준 적용' }).click();
await page.waitForTimeout(400);
ok(/경보 0번/.test(await page.textContent('#zoneCard')) && !/경보 1번/.test(await page.textContent('#zoneCard')), '위험 시작 60℃ 로 올리면 P2 위험 경보 없어짐');
await go('#/lead');
lt = await page.textContent('#main');
ok(!/첫 경보 2026-10-21 14:4\d:\d\d · 온도/.test(lt) && /P2 · 10-21 16:10 고장/.test(lt), '온도 기준을 바꾸면 P2 첫 경보가 온도가 아님(리드타임이 다시 계산됨)');
await go('#/spc');
await page.locator('select[aria-label="프레스"]').selectOption('P2');
await page.waitForTimeout(300);
await page.locator('#zoneCard button', { hasText: '데이터로 잡은 기본값으로' }).click();
await page.waitForTimeout(300);
ok(/경보 1번/.test(await page.textContent('#zoneCard')), '데이터로 잡은 기본값으로 되돌림');
await widths(['spc', 'dash'], [1280, 390]);

console.log('⑤-2 머신러닝 · 라벨링 (v2.1)');
await go('#/ml');
await page.waitForTimeout(500);
lt = await page.textContent('#main');
ok(await page.locator('#mlLogs tbody tr').count() === 3, '가상 정비 · 고장 이력 3건(V-0001~0003)');
ok(await page.locator('#mlView svg.chart.spc').count() === 4, '라벨 그림 4장(전압 · 전류 · 진동 · 온도)');
ok(await page.locator('#mlView svg.chart.spc rect.lband-abnormal').count() >= 4, '그림에 이상 구간 띠');
ok(/정상 · 이상 · 제외|라벨 분포/.test(lt) && /혼동|정확도/.test(lt), '라벨 분포 · 모델 정확도 보임');
const segN = await page.locator('#mlView table tbody tr').count();
await page.locator('#mlView button', { hasText: '이 구간 고르기' }).first().click();
await page.waitForTimeout(300);
await page.locator('#mlView select[aria-label="라벨"]').selectOption('2');
await page.locator('#mlView button', { hasText: '이 구간에 라벨 붙이기' }).click();
await page.waitForTimeout(500);
ok(await page.locator('#mlView .pill.src-manual').count() >= 1, '수동 라벨 — 구간 표에 「수동」 표시 (구간 ' + segN + '개)');
ok(await page.locator('#mlView svg.chart.spc rect.lband-manual').count() >= 4, '그림에 수동 라벨 테두리');
await page.locator('#mlView button', { hasText: '되돌리기' }).first().click();
await page.waitForTimeout(400);
ok(await page.locator('#mlView .pill.src-manual').count() === 0, '수동 라벨 되돌리기');
// 이력 한 줄 넣기 · 고치기 · 빼기
await page.locator('#mlLogs input[aria-label="설비"]').fill('P3');
await page.locator('#mlLogs input[aria-label="발견 일시"]').fill('2026-10-20T09:00');
await page.locator('#mlLogs input[aria-label="조치 일시"]').fill('2026-10-20T09:30');
await page.locator('#mlLogs input[aria-label="증상"]').fill('시험 증상');
await page.locator('#mlLogs button', { hasText: '한 줄 넣기' }).click();
await page.waitForTimeout(500);
ok(await page.locator('#mlLogs tbody tr').count() === 4, '이력 한 줄 넣기 → 4건(정비 번호 자동)');
await page.locator('#mlLogs tr', { hasText: '시험 증상' }).locator('button', { hasText: '고치기' }).click();
await page.waitForTimeout(300);
await page.locator('#mlLogs input[aria-label="원인"]').fill('시험 원인');
await page.locator('#mlLogs button', { hasText: '고친 내용 저장' }).click();
await page.waitForTimeout(500);
ok((await page.textContent('#mlLogs')).includes('시험 원인'), '이력 고치기');
await page.locator('#mlLogs tr', { hasText: '시험 증상' }).locator('button', { hasText: '빼기' }).click();
await page.waitForTimeout(500);
ok(await page.locator('#mlLogs tbody tr').count() === 3, '이력 빼기 → 3건');
const [dl3] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: '학습용 CSV 내려받기' }).click()]);
const csvPath = await dl3.path(), csvTxt = fs.readFileSync(csvPath, 'utf8'), csvLines = csvTxt.split('\r\n').filter(Boolean);
ok(csvLines.length === 216001 && csvLines[0].includes('time,equipment_id,voltage,current,vibration,temperature,label,label_name,label_source,log_id'), '학습용 CSV 216,000행 + 머리행 (' + csvLines.length + ')');
ok(csvTxt.includes(',1,abnormal,rule,V-0002'), 'CSV 에 이상 · 근거 V-0002');
await widths(['ml'], [1280, 768, 390, 360]);

console.log('⑥ 실시간 연결 — 시뮬레이터');
await go('#/live');
await page.locator('.seg button', { hasText: '내장 시뮬레이터' }).click();
await page.locator('select[aria-label="빠르기"]').selectOption('10');
await page.locator('#liveToggle').click();
await page.waitForTimeout(1500);
const rowsOf = async () => +((await page.textContent('#liveStatus')).match(/받은 행([\d,]+)/) || [0, '0'])[1].replace(/,/g, '');
const n1 = await rowsOf();
await page.waitForTimeout(2000);
const n2 = await rowsOf();
ok(n1 >= 2700 && n2 > n1 + 20, '시뮬레이터 값이 계속 이어 붙음 ' + n1 + ' → ' + n2);
ok(/받는 중/.test(await page.textContent('#liveStatus')), '상태 「받는 중」');
ok(await page.locator('#liveBody svg.chart.spc').count() === 4, '실시간 관리도 4장');
const lastStamp = async () => page.evaluate(() => { const c = document.querySelector('#liveBody .lastcard .note'); return c ? c.textContent : ''; });
const s1 = await lastStamp(); await page.waitForTimeout(1500); const s2 = await lastStamp();
ok(s1 && s2 && s1 !== s2, '마지막 값 시각이 바뀜(그래프가 다시 그려짐) ' + s1 + ' → ' + s2);
ok(/가져온 2초 로그\([\d,]+행\)로 잡은 값/.test(await page.textContent('#liveBody')), '관리선 = 같은 프레스의 가져온 2초 로그(⑤ 가상 데이터)로 잡은 값');
await page.locator('#liveBody .seg button', { hasText: '최근 5분' }).click();
await page.waitForTimeout(800);
const spanTxt = await page.evaluate(() => [...document.querySelectorAll('#liveBody svg.chart.spc')][0].querySelectorAll('text.tick').length);
ok(spanTxt > 0, '최근 5분 밀려가는 창');
await page.locator('select[aria-label="징후를 넣을 프레스"]').selectOption('P1');
await page.locator('button', { hasText: '전류 튐' }).click();
await page.waitForFunction(() => /P1 · 전류 — ±3σ 밖/.test((document.getElementById('liveBody') || {}).textContent || ''), null, { timeout: 40000 }).then(() => ok(true, '전류 튐 → 경보가 바로 뜸'), () => ok(false, '전류 튐 → 경보가 바로 뜸'));
await page.locator('select[aria-label="징후를 넣을 프레스"]').selectOption('P2');
await page.locator('button', { hasText: '온도 넘침' }).click();
await page.waitForFunction(() => /P2 · 온도 — 위험 구간/.test((document.getElementById('liveBody') || {}).textContent || ''), null, { timeout: 150000 }).then(() => ok(true, '온도 넘침 → 위험 구간 경보'), () => ok(false, '온도 넘침 → 위험 구간 경보'));
await widths(['live'], [1280, 390, 360]);
await go('#/live');
await page.locator('#liveToggle').click();
await page.waitForTimeout(300);
ok(/멈춤/.test(await page.textContent('#liveStatus')), '멈추기');

console.log('⑦ 실시간 연결 — HTTP 주소 받기 · WebSocket (중계 서버 ' + httpBase + ')');
await page.locator('.seg button', { hasText: 'HTTP(S) 주소 받기' }).click();
await page.locator('input[aria-label="받을 주소"]').fill(httpBase + '/api/rows?since={since}');
await page.locator('input[aria-label="몇 초마다"]').fill('1');
await page.locator('#liveToggle').click();
await page.waitForFunction(() => /받는 중/.test(document.getElementById('liveStatus').textContent) && /받은 행[\d,]{3,}/.test(document.getElementById('liveStatus').textContent), null, { timeout: 15000 }).catch(() => {});
const h1 = await rowsOf(); await page.waitForTimeout(3000); const h2 = await rowsOf();
let ls = await page.textContent('#liveStatus');
ok(/받는 중/.test(ls) && h1 >= 900 && h2 > h1, 'HTTP 받기 — 처음 최근 값, 그 뒤 since 로 이어 받음 ' + h1 + ' → ' + h2);
ok(/마지막 수신(방금|\d초 전)/.test(ls) && /받는 간격 평균 [\d.]+초/.test(ls), '마지막 수신·받는 간격 표시');
ok(/지금보다 /.test(ls), '데이터 시각과 지금의 차이(지연) 표시');
ok(/요청 · 오류[\d,]+ · 0/.test(ls), '요청 수 · 오류 0');
ok(await page.locator('#liveBody svg.chart.spc').count() === 4, 'HTTP 받기 — 관리도 4장');
await page.locator('#liveToggle').click();
await page.locator('input[aria-label="받을 주소"]').fill('http://127.0.0.1:' + (PORT + 1) + '/api/rows');
await page.locator('#liveToggle').click();
await page.waitForFunction(() => { const p = document.querySelector('#liveStatus .pill'); return p && p.textContent === '오류'; }, null, { timeout: 10000 }).catch(() => {});
ls = await page.textContent('#liveStatus');
ok(/오류/.test(ls) && /CORS|주소/.test(ls), '틀린 주소 — 오류와 이유 표시' + (/CORS|주소/.test(ls) ? '' : ' — ' + ls));
await page.locator('#liveToggle').click();
errors.splice(0, errors.length, ...errors.filter(e => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(e))); // 일부러 틀린 주소로 보낸 요청의 콘솔 줄은 셈에서 뺌
await page.locator('.seg button', { hasText: 'WebSocket' }).click();
await page.locator('input[aria-label="WebSocket 주소"]').fill('ws://127.0.0.1:' + PORT + '/ws');
await page.locator('#liveToggle').click();
await page.waitForTimeout(3500);
ls = await page.textContent('#liveStatus');
ok(/받는 중/.test(ls) && (await rowsOf()) >= 30, 'WebSocket — 붙자마자 최근 30행, 이어 받음 (' + (await rowsOf()) + '행)');
await page.locator('#liveToggle').click();
// file:// 로 연 페이지에서 같은 중계 서버로 — 다른 출처라 CORS 머리가 있어야 받힘
const fpage = await ctx.newPage();
fpage.on('pageerror', e => errors.push('file pageerror: ' + e.message));
fpage.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push('file console: ' + m.text()); });
await fpage.goto(fileUrl + '#/live');
await fpage.waitForTimeout(500);
await fpage.locator('.seg button', { hasText: 'HTTP(S) 주소 받기' }).click();
await fpage.locator('input[aria-label="받을 주소"]').fill(httpBase + '/api/rows?since={since}');
await fpage.locator('#liveToggle').click();
await fpage.waitForTimeout(3000);
const fl = await fpage.textContent('#liveStatus');
ok(/받는 중/.test(fl) && /받은 행[\d,]{3,}/.test(fl), 'file:// 페이지 → http://127.0.0.1 중계(다른 출처, CORS) 받기');
ok(/받기 시작한 처음 [\d,]+개\(/.test(await fpage.textContent('#liveBody')), '가져온 로그가 없으면 관리선 = 받기 시작한 처음 값으로 잡아 고정');
await fpage.locator('#liveToggle').click();
await fpage.close();

ok(!errors.length, 'JS 오류 없음' + (errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
relay.kill();
console.log(problems.length ? '\n문제 ' + problems.length + '건' : '\n모두 통과');
process.exitCode = problems.length ? 1 : 0;
