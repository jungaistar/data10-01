/* data10 로그인 키트 — 정본: data10-00/kit/auth (리포마다 사본은 apply-auth-kit.mjs 가 복사한다. 사본을 직접 고치지 말 것)
 *
 * 하는 일
 *   ① 로그인 전 대문(과제 소개 + 로그인 · 회원가입)   ② 회사 메일이나 개인 메일 + 비밀번호로 가입 · 로그인, 카카오 로그인(설정 시)
 *   ③ 가입하면 「사용 신청」 → 관리자가 승인해야 도구가 열린다   ④ 관리자는 「구성원 관리」에서 승인 · 관리자 지정 · 중지
 *   ⑤ 30분 동안 움직임이 없으면 이 기기에서만 로그아웃(signOut scope local)
 * 설정은 js/auth-config.js 한 곳(Supabase 주소 · 공개 키 · 표 접두사 · 대문 문구). 내 Supabase 로 옮길 때도 그 파일만 바꾼다.
 * 업무 데이터는 지금처럼 이 브라우저에 저장한다 — 여기서는 「누가 쓸 수 있는가」만 정한다.
 * 내 PC(localhost · 파일로 열기)에서는 로그인을 건너뛴다(localBypass). 주소 끝에 ?auth=1 을 붙이면 내 PC 에서도 로그인 화면을 본다.
 */
(function () {
  'use strict';
  var C = window.AUTH_CONFIG || {}, P = C.prefix, S = C.site || {};
  var root = document.documentElement;
  var isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var force = /[?&]auth=1(&|$)/.test(location.search);

  function unlockPage() { root.classList.remove('auth-lock'); }
  if (isLocal && C.localBypass !== false && !force) { unlockPage(); return; }

  var gate = document.createElement('div');
  gate.id = 'authGate'; gate.className = 'ag' + ((S.landing || {}).theme === 'light' ? ' ag-light' : '');
  // 과제별 색(plan.json landing.colors → auth-config) — 키는 ink · sub · bg · navy · navy2 · brand · brandDark · accent
  var COL = (S.landing || {}).colors || {}, VAR = { ink: '--ag-ink', sub: '--ag-sub', bg: '--ag-bg', navy: '--ag-navy', navy2: '--ag-navy-2', brand: '--ag-brand', brandDark: '--ag-brand-d', accent: '--ag-accent' };
  Object.keys(COL).forEach(function (k) { if (VAR[k] && /^#[0-9a-fA-F]{3,8}$/.test(COL[k])) root.style.setProperty(VAR[k], COL[k]); }); gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true');
  document.body.appendChild(gate);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || gate).querySelector(sel); }

  if (!window.supabase || !C.url || !C.anonKey || !P) {
    gate.innerHTML = shell('<div class="ag-card"><h2>로그인 설정이 없습니다</h2><p class="ag-sub">js/auth-config.js 에 Supabase 주소와 공개 키를 넣어 주세요. 안내는 docs/내_깃허브로_옮기기.md 에 있습니다.</p></div>');
    return;
  }

  var sb = window.supabase.createClient(C.url, C.anonKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'sb-' + P + '-auth' }
  });
  var T = { members: P + '_members' }, RPC = { save: P + '_member_save', hasAdmin: P + '_has_admin', claim: P + '_claim_first_admin' };
  var me = null, member = null, idleTimer = null, idleMs = (C.idleMinutes || 30) * 60000;

  // ───────── 공통 틀 ─────────
  function shell(right) {
    var feats = (S.features || []).slice(0, 4).map(function (f) {
      return '<li><b>' + esc(f.name) + '</b><span>' + esc(f.desc) + '</span></li>';
    }).join('');
    var steps = (S.steps || []).slice(0, 6).map(function (s, i) {
      return '<li><span class="ag-n">' + (i + 1) + '</span>' + esc(s) + '</li>';
    }).join('');
    var L = S.landing || {}, head = String(L.headline || S.title || document.title).split('\n').map(esc).join('<br>');
    var eyebrow = L.eyebrow || S.course, lead = L.lead || S.summary;
    return '<div class="ag-wrap"><section class="ag-hero">' + art((S.steps || []).slice(0, 6).length) +
      (eyebrow ? '<p class="ag-eyebrow">' + esc(eyebrow) + '</p>' : '') +
      '<h1>' + head + '</h1>' +
      (lead ? '<p class="ag-lead">' + esc(lead) + '</p>' : '') +
      (feats ? '<ul class="ag-feats">' + feats + '</ul>' : '') +
      (steps ? '<div class="ag-flow"><p class="ag-flow-t">이렇게 씁니다</p><ol>' + steps + '</ol></div>' : '') +
      '</section><section class="ag-side">' + right + '</section></div>' +
      '<p class="ag-foot">가입 → 사용 신청 → 관리자 승인 뒤에 쓸 수 있습니다 · 업무 자료는 서버로 보내지 않고 이 브라우저에 저장합니다</p>';
  }
  function show(right) {
    root.classList.add('auth-lock'); gate.hidden = false; gate.innerHTML = shell(right); gate.scrollTop = 0; fx();
  }

  // ───────── 대문 그림(SVG) · 효과 ─────────
  // 현장 데이터가 관리도로 정리되는 모습: 점 격자 · 추세선 · 관리선 · 데이터 점. 점 수 = 「이렇게 씁니다」 단계 수(최소 4).
  // 모션 최소화 설정이면 효과 없이 완성된 그림만 보인다. 효과가 꺼져도 내용은 숨지 않는다(숨기는 규칙은 .ag-fx 아래에만).
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var played = false, fxTimer = null, PTS = [];
  function art(nSteps) {
    var n = Math.max(4, nSteps || 0), W = 600, H = 220, x0 = 40, x1 = 560;
    var ys = [0.70, 0.56, 0.62, 0.44, 0.50, 0.32, 0.38, 0.22];
    PTS = [];
    for (var i = 0; i < n; i++) PTS.push([x0 + (x1 - x0) * i / (n - 1), 38 + 170 * ys[i % ys.length]]);
    // Catmull-Rom → 베지어로 부드러운 선
    var d = 'M' + PTS[0][0] + ' ' + PTS[0][1];
    for (i = 0; i < n - 1; i++) {
      var p0 = PTS[Math.max(0, i - 1)], p1 = PTS[i], p2 = PTS[i + 1], p3 = PTS[Math.min(n - 1, i + 2)];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
        (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0] + ' ' + p2[1];
    }
    var area = d + ' L' + x1 + ' 186 L' + x0 + ' 186 Z';
    var pts = PTS.map(function (p, k) { return '<circle class="ag-pt" style="--d:' + (1.1 + k * 0.12).toFixed(2) + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="4.5"/>'; }).join('');
    return '<svg class="ag-art" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false">' +
      '<defs><pattern id="agDots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="currentColor" opacity=".35"/></pattern>' +
      '<linearGradient id="agFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="ag-par"><rect class="ag-grid" x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#agDots)"/>' +
      '<line class="ag-ucl" x1="' + x0 + '" y1="30" x2="' + x1 + '" y2="30"/><line class="ag-ucl" x1="' + x0 + '" y1="186" x2="' + x1 + '" y2="186"/>' +
      '<text class="ag-lbl" x="' + x1 + '" y="22" text-anchor="end">관리 상한</text><text class="ag-lbl" x="' + x1 + '" y="204" text-anchor="end">관리 하한</text>' +
      '<path class="ag-area" d="' + area + '" fill="url(#agFill)"/>' +
      '<path class="ag-line" d="' + d + '" pathLength="1"/>' + pts +
      '<circle class="ag-ring" cx="' + PTS[0][0] + '" cy="' + PTS[0][1] + '" r="10"/></g></svg>';
  }
  function stopFx() { if (fxTimer) clearInterval(fxTimer); fxTimer = null; }
  function fx() {
    stopFx();
    gate.classList.toggle('ag-fx', !reduce && !played);   // 들어올 때 한 번만(탭을 오가도 다시 재생하지 않음)
    played = true;
    var steps = gate.querySelectorAll('.ag-flow li'), ring = gate.querySelector('.ag-ring'), k = 0;
    function on(i) {
      for (var j = 0; j < steps.length; j++) steps[j].classList.toggle('is-on', j === i);
      var p = PTS[i % PTS.length]; if (ring && p) { ring.setAttribute('cx', p[0]); ring.setAttribute('cy', p[1]); }
    }
    if (!steps.length) return;
    on(0);
    if (reduce) return;
    fxTimer = setInterval(function () { if (gate.hidden) return stopFx(); k = (k + 1) % steps.length; on(k); }, 2400);
  }
  // 마우스를 따라 그림이 아주 조금 움직인다(데스크톱 · 모션 허용일 때만)
  if (!reduce && window.matchMedia && matchMedia('(pointer: fine)').matches) {
    gate.addEventListener('pointermove', function (e) {
      var g = gate.querySelector('.ag-par'); if (!g) return;
      var dx = e.clientX / innerWidth - 0.5, dy = e.clientY / innerHeight - 0.5;
      g.style.transform = 'translate(' + (dx * -14).toFixed(1) + 'px,' + (dy * -10).toFixed(1) + 'px)';
    });
  }
  function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle('is-busy', on); } }
  function msg(text, kind) { var m = $('.ag-msg'); if (m) { m.textContent = text || ''; m.className = 'ag-msg' + (kind ? ' is-' + kind : ''); } }
  function cleanUrl() {
    if (/[?&](code|error|error_description)=/.test(location.search) && history.replaceState) {
      history.replaceState(history.state, '', location.pathname + location.hash);
    }
  }
  function errText(e) {
    var m = (e && (e.message || e.error_description || e)) + '';
    if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (/Email not confirmed/i.test(m)) return '메일 확인이 아직입니다. 받은 메일의 링크를 누른 뒤 로그인해 주세요.';
    if (/already registered|already been registered/i.test(m)) return '이미 가입한 이메일입니다. 로그인해 주세요.';
    if (/Password should be at least/i.test(m)) return '비밀번호는 8자 이상으로 해 주세요.';
    if (/rate limit|too many/i.test(m)) return '잠시 뒤에 다시 해 주세요(요청이 너무 잦습니다).';
    if (/Failed to fetch|NetworkError/i.test(m)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
    return m;
  }

  // ───────── 로그인 · 회원가입 ─────────
  function viewLogin(tab, note) {
    var signup = tab === 'signup';
    show('<div class="ag-card">' +
      '<div class="ag-tabs" role="tablist"><button type="button" role="tab" data-tab="login" aria-selected="' + !signup + '">로그인</button>' +
      '<button type="button" role="tab" data-tab="signup" aria-selected="' + signup + '">회원가입</button></div>' +
      (signup ?
        '<form class="ag-form" id="agSignup" novalidate>' +
        '<label>이름<input name="name" autocomplete="name" required maxlength="80"></label>' +
        '<label>소속(회사 · 부서)<input name="org" autocomplete="organization" maxlength="120" placeholder="예) 품질팀"></label>' +
        '<label>연락처<input name="phone" type="tel" autocomplete="tel" maxlength="40" placeholder="010-0000-0000"></label>' +
        '<label>이메일 <small>회사 메일 또는 개인 메일</small><input name="email" type="email" autocomplete="email" required maxlength="200"></label>' +
        '<label>비밀번호 <small>8자 이상</small><input name="pw" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<label>비밀번호 확인<input name="pw2" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<button class="ag-btn ag-primary" type="submit">가입하고 사용 신청</button></form>'
        :
        '<form class="ag-form" id="agLogin" novalidate>' +
        '<label>이메일<input name="email" type="email" autocomplete="email" required></label>' +
        '<label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>' +
        '<button class="ag-btn ag-primary" type="submit">로그인</button></form>' +
        (C.kakao ? '<div class="ag-or"><span>또는</span></div><button type="button" class="ag-btn ag-kakao" id="agKakao">카카오로 로그인</button>' : '') +
        '<p class="ag-hint">처음이면 「회원가입」에서 가입하세요. 비밀번호를 잊었으면 관리자에게 알려 주세요.</p>') +
      '<p class="ag-msg" role="status" aria-live="polite"></p></div>');
    if (note) msg(note.text, note.kind);
    gate.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { viewLogin(b.getAttribute('data-tab')); }; });
    var f = $('#agLogin');
    if (f) f.onsubmit = function (ev) {
      ev.preventDefault();
      var b = f.querySelector('button'), em = f.email.value.trim(), pw = f.pw.value;
      if (!em || !pw) return msg('이메일과 비밀번호를 넣어 주세요.', 'err');
      busy(b, true); msg('로그인 중…');
      sb.auth.signInWithPassword({ email: em, password: pw }).then(function (r) {
        busy(b, false); if (r.error) return msg(errText(r.error), 'err'); route();
      });
    };
    var k = $('#agKakao');
    if (k) k.onclick = function () {
      busy(k, true);
      sb.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.origin + location.pathname } }).then(function (r) {
        if (r.error) { busy(k, false); msg(errText(r.error), 'err'); }
      });
    };
    var g = $('#agSignup');
    if (g) g.onsubmit = function (ev) {
      ev.preventDefault();
      var b = g.querySelector('button'), d = { name: g.name.value.trim(), org: g.org.value.trim(), phone: g.phone.value.trim() };
      var em = g.email.value.trim(), pw = g.pw.value;
      if (!d.name) return msg('이름을 넣어 주세요.', 'err');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return msg('이메일 모양이 맞지 않습니다.', 'err');
      if (pw.length < 8) return msg('비밀번호는 8자 이상으로 해 주세요.', 'err');
      if (pw !== g.pw2.value) return msg('비밀번호 확인이 다릅니다.', 'err');
      busy(b, true); msg('가입 중…');
      sb.auth.signUp({ email: em, password: pw, options: { data: d, emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
        busy(b, false);
        if (r.error) return msg(errText(r.error), 'err');
        if (r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0) return msg('이미 가입한 이메일입니다. 로그인해 주세요.', 'err');
        if (!r.data.session) return viewLogin('login', { text: '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하면 사용 신청이 들어갑니다.', kind: 'ok' });
        route();
      });
    };
  }

  // ───────── 사용 신청 · 대기 ─────────
  function claimButton(noAdmin) {
    return noAdmin ? '<div class="ag-claim"><p>이 프로젝트에는 아직 관리자가 없습니다. 내 Supabase 로 옮긴 직후라면 처음 들어온 사람이 관리자가 됩니다.</p>' +
      '<button type="button" class="ag-btn" id="agClaim">첫 관리자 되기</button></div>' : '';
  }
  function bindCommon() {
    var o = $('#agOut'); if (o) o.onclick = signOut;
    var c = $('#agClaim');
    if (c) c.onclick = function () {
      busy(c, true);
      sb.rpc(RPC.claim).then(function (r) { busy(c, false); if (r.error) return msg(errText(r.error), 'err'); route(); });
    };
  }
  function viewApply(user, noAdmin) {
    var md = user.user_metadata || {};
    show('<div class="ag-card"><h2>사용 신청</h2><p class="ag-sub">' + esc(user.email || '') + ' 계정으로 로그인했습니다. 아래를 적어 신청하면 관리자가 확인한 뒤 승인합니다.</p>' +
      '<form class="ag-form" id="agApply" novalidate>' +
      '<label>이름<input name="name" required maxlength="80" value="' + esc(md.name || md.full_name || md.nickname || '') + '"></label>' +
      '<label>소속(회사 · 부서)<input name="org" maxlength="120" value="' + esc(md.org || '') + '"></label>' +
      '<label>연락처<input name="phone" type="tel" maxlength="40" value="' + esc(md.phone || '') + '"></label>' +
      '<button class="ag-btn ag-primary" type="submit">사용 신청</button></form>' + claimButton(noAdmin) +
      '<p class="ag-msg" role="status" aria-live="polite"></p><button type="button" class="ag-link" id="agOut">다른 계정으로 로그인</button></div>');
    bindCommon();
    var f = $('#agApply');
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var row = { user_id: user.id, name: f.name.value.trim(), org: f.org.value.trim(), phone: f.phone.value.trim(), email: (user.email || '').slice(0, 200) };
      if (!row.name) return msg('이름을 넣어 주세요.', 'err');
      apply(row, f.querySelector('button'));
    };
  }
  function apply(row, btn) {
    busy(btn, true);
    return sb.from(T.members).insert(row).then(function (r) {
      busy(btn, false);
      if (r.error && r.error.code !== '23505') { msg(errText(r.error), 'err'); return; }
      route();
    });
  }
  function viewPending(m, noAdmin) {
    show('<div class="ag-card"><span class="ag-badge">승인 대기</span><h2>사용 신청을 받았습니다</h2>' +
      '<p class="ag-sub">' + esc(m.name || '') + (m.org ? ' · ' + esc(m.org) : '') + '<br>' + esc(m.email || '') + '</p>' +
      '<p>관리자가 승인하면 바로 쓸 수 있습니다. 승인된 뒤 이 화면을 새로고침하거나 아래 단추를 눌러 주세요.</p>' +
      '<button type="button" class="ag-btn ag-primary" id="agRe">승인됐는지 다시 보기</button>' + claimButton(noAdmin) +
      '<p class="ag-msg" role="status" aria-live="polite"></p><button type="button" class="ag-link" id="agOut">로그아웃</button></div>');
    bindCommon();
    $('#agRe').onclick = function () { route(); };
  }
  function viewStopped() {
    show('<div class="ag-card"><span class="ag-badge is-off">사용 중지</span><h2>이 계정은 사용이 중지되었습니다</h2>' +
      '<p>다시 쓰려면 관리자에게 알려 주세요.</p><button type="button" class="ag-link" id="agOut">로그아웃</button></div>');
    bindCommon();
  }
  function viewError(e) {
    show('<div class="ag-card"><h2>확인하지 못했습니다</h2><p class="ag-sub">' + esc(errText(e)) + '</p>' +
      '<button type="button" class="ag-btn ag-primary" id="agRe">다시 시도</button><button type="button" class="ag-link" id="agOut">로그아웃</button></div>');
    bindCommon(); $('#agRe').onclick = function () { route(); };
  }

  // ───────── 판정 ─────────
  // 판정은 겹쳐 불려도 된다 — 늦게 끝난 옛 판정이 새 화면을 덮지 않게 차례 번호로 거른다
  var gen = 0, routing = false;
  function route() {
    var my = ++gen; routing = true;
    function live() { return my === gen; }
    return sb.auth.getSession().then(function (r) {
      if (!live()) return;
      cleanUrl();
      var s = r.data && r.data.session;
      if (!s) { me = member = null; stopIdle(); removeChip(); viewLogin('login'); return; }
      me = s.user;
      return sb.from(T.members).select('user_id,name,org,phone,email,roles,status').eq('user_id', me.id).maybeSingle().then(function (q) {
        if (!live()) return;
        if (q.error) return viewError(q.error);
        member = q.data;
        if (member && member.status === 'active') return unlock();
        removeChip(); stopIdle();
        if (member && member.status === 'disabled') return viewStopped();
        return sb.rpc(RPC.hasAdmin).then(function (h) {
          if (!live()) return;
          var noAdmin = h.data === false;
          if (member) return viewPending(member, noAdmin);
          var md = me.user_metadata || {};
          // 가입할 때 이름을 적었으면 신청까지 바로 넣는다(카카오 등은 신청 화면에서 적는다)
          if (md.name && !noAdmin) return apply({ user_id: me.id, name: String(md.name).slice(0, 80), org: String(md.org || '').slice(0, 120), phone: String(md.phone || '').slice(0, 40), email: (me.email || '').slice(0, 200) });
          return viewApply(me, noAdmin);
        });
      });
    }).catch(function (e) { if (live()) viewError(e); }).then(function () { if (live()) routing = false; });
  }

  function unlock() {
    stopFx(); gate.hidden = true; gate.innerHTML = ''; unlockPage(); mountChip(); startIdle();
  }
  function signOut() {
    sb.auth.signOut({ scope: 'local' }).then(function () { route(); });
  }

  // ───────── 상단 바 계정 칩 ─────────
  function isAdmin() { return !!(member && member.status === 'active' && (member.roles || []).indexOf('admin') >= 0); }
  function removeChip() { var c = document.getElementById('authChip'); if (c) c.remove(); }
  function mountChip() {
    removeChip();
    var host = document.querySelector('.topbar') || document.body;
    var c = document.createElement('div');
    c.id = 'authChip'; c.className = 'auth-chip' + (host === document.body ? ' is-float' : '');
    c.innerHTML = '<span class="auth-chip-name" title="' + esc(member.email || '') + '">' + esc(member.name || member.email || '') + '</span>' +
      (isAdmin() ? '<button type="button" class="auth-chip-btn" id="authMembers">구성원 관리<span class="auth-chip-n" hidden></span></button>' : '') +
      '<button type="button" class="auth-chip-btn" id="authOut">로그아웃</button>';
    host.appendChild(c);
    document.getElementById('authOut').onclick = signOut;
    var mb = document.getElementById('authMembers');
    if (mb) { mb.onclick = openMembers; refreshPendingCount(); }
  }
  function refreshPendingCount() {
    sb.from(T.members).select('user_id', { count: 'exact', head: true }).eq('status', 'pending').then(function (r) {
      var n = document.querySelector('#authMembers .auth-chip-n'); if (!n) return;
      n.hidden = !r.count; n.textContent = r.count || '';
    });
  }

  // ───────── 구성원 관리(관리자) ─────────
  var ST = { pending: '승인 대기', active: '사용', disabled: '중지' };
  function openMembers() {
    var box = document.getElementById('authAdmin');
    if (!box) {
      box = document.createElement('div'); box.id = 'authAdmin'; box.className = 'ag-modal';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '구성원 관리');
      document.body.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target === box) closeMembers(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('authAdmin') && !box.hidden) closeMembers(); });
    }
    box.hidden = false; box.innerHTML = '<div class="ag-panel"><p>불러오는 중…</p></div>';
    loadMembers(box, 'pending');
  }
  function closeMembers() { var b = document.getElementById('authAdmin'); if (b) b.hidden = true; refreshPendingCount(); }
  function loadMembers(box, filter) {
    sb.from(T.members).select('user_id,name,org,phone,email,roles,status,requested_at,approved_at').order('requested_at', { ascending: false }).then(function (r) {
      if (r.error) { box.innerHTML = '<div class="ag-panel"><p class="ag-msg is-err">' + esc(errText(r.error)) + '</p><button type="button" class="ag-btn" data-close>닫기</button></div>'; box.querySelector('[data-close]').onclick = closeMembers; return; }
      var all = r.data || [], pend = all.filter(function (m) { return m.status === 'pending'; });
      if (filter === 'pending' && !pend.length) filter = 'all';
      var list = filter === 'pending' ? pend : all;
      var rows = list.map(function (m) {
        var admin = (m.roles || []).indexOf('admin') >= 0, self = me && m.user_id === me.id, acts = [];
        if (m.status === 'pending') { acts.push(['승인', { status: 'active' }, 'ag-primary']); acts.push(['거절(중지)', { status: 'disabled' }]); }
        if (m.status === 'active') { acts.push([admin ? '관리자 해제' : '관리자로 지정', { roles: admin ? [] : ['admin'] }]); if (!self) acts.push(['사용 중지', { status: 'disabled' }]); }
        if (m.status === 'disabled') acts.push(['다시 사용', { status: 'active' }]);
        return '<tr><td><b>' + esc(m.name) + '</b>' + (self ? ' <small>(나)</small>' : '') + '<br><small>' + esc(m.email) + '</small></td>' +
          '<td>' + esc(m.org) + '<br><small>' + esc(m.phone) + '</small></td>' +
          '<td><span class="ag-st is-' + m.status + '">' + ST[m.status] + '</span>' + (admin ? ' <span class="ag-st is-admin">관리자</span>' : '') +
          '<br><small>신청 ' + esc((m.requested_at || '').slice(0, 10)) + '</small></td>' +
          '<td class="ag-acts">' + acts.map(function (a) {
            return '<button type="button" class="ag-btn ag-sm ' + (a[2] || '') + '" data-u="' + m.user_id + '" data-p=\'' + esc(JSON.stringify(a[1])) + '\'>' + a[0] + '</button>';
          }).join('') + '</td></tr>';
      }).join('');
      box.innerHTML = '<div class="ag-panel"><div class="ag-panel-h"><h2>구성원 관리</h2><button type="button" class="ag-x" data-close aria-label="닫기">×</button></div>' +
        '<p class="ag-sub">가입한 사람이 「승인 대기」로 들어옵니다. 승인하면 바로 도구를 쓸 수 있고, 「관리자로 지정」하면 그 사람도 승인할 수 있습니다. 마지막 관리자는 뺄 수 없습니다.</p>' +
        '<div class="ag-tabs"><button type="button" data-f="pending" aria-selected="' + (filter === 'pending') + '">승인 대기 ' + pend.length + '</button>' +
        '<button type="button" data-f="all" aria-selected="' + (filter === 'all') + '">전체 ' + all.length + '</button></div>' +
        '<p class="ag-msg" role="status" aria-live="polite"></p>' +
        (rows ? '<div class="ag-tablewrap"><table class="ag-table"><thead><tr><th>이름 · 이메일</th><th>소속 · 연락처</th><th>상태</th><th>처리</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p>구성원이 없습니다.</p>') +
        '</div>';
      box.querySelector('[data-close]').onclick = closeMembers;
      box.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { loadMembers(box, b.getAttribute('data-f')); }; });
      box.querySelectorAll('[data-u]').forEach(function (b) {
        b.onclick = function () {
          busy(b, true);
          sb.rpc(RPC.save, { p_user: b.getAttribute('data-u'), p_patch: JSON.parse(b.getAttribute('data-p')) }).then(function (x) {
            busy(b, false);
            if (x.error) { var m = box.querySelector('.ag-msg'); m.textContent = errText(x.error); m.className = 'ag-msg is-err'; return; }
            if (me && b.getAttribute('data-u') === me.id) { closeMembers(); route(); return; }
            loadMembers(box, filter); refreshPendingCount();
          });
        };
      });
    });
  }

  // ───────── 무동작 로그아웃 ─────────
  function bump() { if (!idleTimer) return; clearTimeout(idleTimer); idleTimer = setTimeout(idleOut, idleMs); }
  function startIdle() { stopIdle(); idleTimer = setTimeout(idleOut, idleMs); }
  function stopIdle() { if (idleTimer) clearTimeout(idleTimer); idleTimer = null; }
  function idleOut() {
    idleTimer = null;
    var b = document.getElementById('authAdmin'); if (b) b.hidden = true;
    sb.auth.signOut({ scope: 'local' }).then(function () {
      viewLogin('login', { text: (C.idleMinutes || 30) + '분 동안 움직임이 없어 로그아웃했습니다. 입력한 자료는 이 브라우저에 남아 있습니다.', kind: 'ok' });
    });
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { addEventListener(ev, bump, { passive: true }); });

  // 다른 탭에서 로그아웃 · 로그인하면 따라간다
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'SIGNED_OUT' && member) route();
    if (ev === 'SIGNED_IN' && !member && !routing) route();
  });
  route();
})();
