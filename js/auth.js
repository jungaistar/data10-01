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
  // 내 PC(파일로 열기 · localhost)는 로그인을 건너뛴다 — 대신 「사용 방법」만 붙인다(맨 아래 LOCAL 처리)
  var LOCAL = isLocal && C.localBypass !== false && !force;
  if (LOCAL) unlockPage();

  var gate = document.createElement('div');
  var LD = S.landing || {};
  gate.id = 'authGate'; gate.className = 'ag' + (LD.theme === 'light' ? ' ag-light' : '') +
    (LD.image && LD.imageMode === 'banner' ? ' ag-has-banner' : '') + (LD.image && LD.imageMode === 'cover' ? ' ag-has-cover' : '');
  // 과제별 색(plan.json landing.colors → auth-config) — 키는 ink · sub · bg · navy · navy2 · brand · brandDark · accent
  var COL = (S.landing || {}).colors || {}, VAR = { ink: '--ag-ink', sub: '--ag-sub', bg: '--ag-bg', navy: '--ag-navy', navy2: '--ag-navy-2', brand: '--ag-brand', brandDark: '--ag-brand-d', accent: '--ag-accent' };
  Object.keys(COL).forEach(function (k) { if (VAR[k] && /^#[0-9a-fA-F]{3,8}$/.test(COL[k])) root.style.setProperty(VAR[k], COL[k]); }); gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true');
  if (!LOCAL) document.body.appendChild(gate);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || gate).querySelector(sel); }

  if (!LOCAL && (!window.supabase || !C.url || !C.anonKey || !P)) {
    gate.innerHTML = shell('<div class="ag-card"><h2>로그인 설정이 없습니다</h2><p class="ag-sub">js/auth-config.js 에 Supabase 주소와 공개 키를 넣어 주세요. 안내는 docs/내_깃허브로_옮기기.md 에 있습니다.</p></div>');
    return;
  }

  var sb = LOCAL ? null : window.supabase.createClient(C.url, C.anonKey, {
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
    // 대문 사진(plan.json landing.image) — banner: 문구까지 든 완성 그림을 잘리지 않게 그대로, cover: 사진 위에 대표색을 덮고 문구를 얹는다
    if (L.image && L.imageMode === 'banner') {
      // 그림 속 「시작하기」 단추는 그림일 뿐이라, 그림 전체를 누르면 로그인 칸으로 내려간다
      return '<a class="ag-banner" href="#agLoginBox" title="로그인으로"><img src="' + esc(L.image) + '" alt="' + esc(L.imageAlt || S.title || '') + '"></a>' +
        '<div class="ag-wrap ag-wrap-banner"><section class="ag-hero ag-hero-sub"><h1 class="ag-sr">' + head + '</h1>' +
        (feats ? '<ul class="ag-feats">' + feats + '</ul>' : '') +
        (steps ? '<div class="ag-flow"><p class="ag-flow-t">이렇게 씁니다</p><ol>' + steps + '</ol></div>' : '') +
        '</section><section class="ag-side" id="agLoginBox">' + right + '</section></div>' +
        '<p class="ag-foot">가입 → 사용 신청 → 관리자 승인 뒤에 쓸 수 있습니다 · 업무 자료는 서버로 보내지 않고 이 브라우저에 저장합니다</p>';
    }
    var cover = L.image && L.imageMode === 'cover';
    // cover 사진 주소는 페이지 기준 절대 주소로 넣는다(CSS 변수 안의 상대 주소는 스타일시트 위치 기준으로 풀린다)
    return '<div class="ag-wrap"><section class="ag-hero' + (cover ? ' ag-cover' : '') + '"' +
      (cover ? ' style="--ag-photo:url(&quot;' + esc(new URL(L.image, location.href).href) + '&quot;)"' : '') + '>' + (cover ? '' : art((S.steps || []).slice(0, 6).length)) +
      (eyebrow ? '<p class="ag-eyebrow">' + esc(eyebrow) + '</p>' : '') +
      '<h1>' + head + '</h1>' +
      (lead ? '<p class="ag-lead">' + esc(lead) + '</p>' : '') +
      (feats ? '<ul class="ag-feats">' + feats + '</ul>' : '') +
      (steps ? '<div class="ag-flow"><p class="ag-flow-t">이렇게 씁니다</p><ol>' + steps + '</ol></div>' : '') +
      '</section><section class="ag-side">' + right + '</section></div>' +
      '<p class="ag-foot">가입 → 사용 신청 → 관리자 승인 뒤에 쓸 수 있습니다 · 업무 자료는 서버로 보내지 않고 이 브라우저에 저장합니다</p>';
  }
  function show(right) {
    gate.classList.remove('ag-home');
    root.classList.add('auth-lock'); gate.hidden = false; gate.innerHTML = shell(right); gate.scrollTop = 0; fx();
    var bn = gate.querySelector('.ag-banner');
    if (bn) bn.onclick = function (e) {
      e.preventDefault();
      var box = gate.querySelector('#agLoginBox'), inp = box && box.querySelector('input');
      if (box) box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, reduce ? 0 : 450);
    };
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


  // ───────── 홈페이지 모드(로그인 전) ─────────
  // 회사 홈페이지처럼: 머리글(회사 로고 · 메뉴 · 로그인) → 히어로 → 목표 → 기능 → 사용 순서 → 실제 화면 → 믿을 수 있는 이유 → 권유 띠 → 꼬리말.
  // 로그인 · 회원가입 카드는 창(모달)으로 연다. 내용은 plan.json(apply-auth-kit 이 auth-config 로 옮김)에서 온다.
  function homeOn() { return !!S.home && LD.home !== false; }
  var ICON = {
    upload: 'M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4',
    chart: 'M4 20h16M7 16v-5m5 5V7m5 9v-8',
    doc: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v5h5M9 13h7M9 17h5',
    clock: 'M12 7v5l3.5 2M12 21a9 9 0 100-18 9 9 0 000 18z',
    check: 'M9 12.5l2.2 2.2L15.5 10M12 21a9 9 0 100-18 9 9 0 000 18z',
    camera: 'M4 8.5A1.5 1.5 0 015.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5zM12 16a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z',
    bell: 'M6.5 16.5V11a5.5 5.5 0 0111 0v5.5l1.5 1.5H5zM10 20.5a2 2 0 004 0',
    spark: 'M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
    search: 'M10.5 17.5a7 7 0 100-14 7 7 0 000 14zM15.5 15.5L21 21',
    shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6zM9 12l2 2 4-4',
    folder: 'M3.5 7.5A1.5 1.5 0 015 6h4.5l2 2H19a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z',
    move: 'M5 12h13m0 0l-4.5-4.5M18 12l-4.5 4.5M5 5v14',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm-6 9a6 6 0 0112 0M16 4.5a3.5 3.5 0 010 6.8M18 14.5a6 6 0 013 5.5',
    layers: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5L12 21l8.5-4.5',
    target: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-4.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm0-3.5a1 1 0 100-2 1 1 0 000 2z',
    arrow: 'M5 12h14m0 0l-5-5m5 5l-5 5'
  };
  function icon(n, cls) { return '<svg class="' + (cls || 'hp-ic') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (ICON[n] || ICON.layers) + '"/></svg>'; }
  function iconFor(t) {
    t = String(t || '');
    if (/AI|초안|요약|프롬프트|추천|예측|머신러닝|라벨/.test(t)) return 'spark';
    if (/엑셀|가져오기|등록|올리|업로드|넣기|수집/.test(t)) return 'upload';
    if (/그래프|분석|BI|추이|대시보드|관리도|통계|달성률|파레토|병목/.test(t)) return 'chart';
    if (/PDF|문서|보고서|기획서|양식|합의서|인보이스|내보내|기준서|체크시트|작업서/.test(t)) return 'doc';
    if (/측정|시간|일정|타임|기한|만료|갱신|사이클/.test(t)) return 'clock';
    if (/판정|검사|합불|확인|점검|불량|대조/.test(t)) return 'check';
    if (/사진|도면|이미지|비전|스캔/.test(t)) return 'camera';
    if (/알림|메일|경보|경고/.test(t)) return 'bell';
    if (/검색|찾|진단|원인/.test(t)) return 'search';
    if (/로그인|승인|권한|구성원/.test(t)) return 'shield';
    if (/교육|신입|인원|담당/.test(t)) return 'users';
    if (/재고|자재|발주|실사/.test(t)) return 'layers';
    return 'target';
  }
  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
  function homeHtml() {
    var L = LD, co = L.company || {}, title = S.title || document.title;
    var head = String(L.headline || title).split('\n').map(esc).join('<br>');
    var lead = L.lead || S.summary || '';
    var eyebrow = L.eyebrow || (co.name ? co.name + (co.team ? ' · ' + co.team : '') : (S.course || ''));
    var feats = (S.features || []).slice(0, 6), flow = (S.flow || []).slice(0, 6), goals = (S.goals || []).slice(0, 3);
    var banner = L.image && L.imageMode === 'banner', cover = L.image && L.imageMode === 'cover';
    var heroImg = L.hero || (cover ? L.image : '');
    var brand = co.logo ? '<img class="hp-logo" src="' + esc(co.logo) + '" alt="' + esc(co.name || '') + '"' + (co.logoH > 0 ? ' style="height:' + Math.min(48, +co.logoH) + 'px"' : '') + '>' :
      (co.name ? '<span class="hp-wordmark">' + esc(co.name) + (co.en ? '<small>' + esc(co.en) + '</small>' : '') + '</span>' : '');
    var tool = '<span class="hp-tool"><span class="hp-mark">' + icon(iconFor(title + ' ' + (feats[0] || {}).name), 'hp-mark-ic') + '</span><span class="hp-tool-t">' + esc(title) + '</span></span>';
    var nav = '<header class="hp-nav"><div class="hp-in hp-nav-in">' +
      '<a class="hp-brand" href="#hp-top" aria-label="맨 위로">' + brand + (brand ? '<i class="hp-div" aria-hidden="true"></i>' : '') + tool + '</a>' +
      '<nav class="hp-links" aria-label="홈페이지 메뉴">' + (feats.length ? '<a href="#hp-features">기능</a>' : '') + (flow.length ? '<a href="#hp-flow">사용 순서</a>' : '') +
      (S.screen && ((heroImg && !cover) || banner) ? '<a href="#hp-screen">화면</a>' : '') + (S.plan ? '<a href="' + esc(S.plan) + '">기획서</a>' : '') + '</nav>' +
      '<div class="hp-acts"><button type="button" class="hp-btn hp-ghost" data-login="login">로그인</button>' +
      '<button type="button" class="hp-btn hp-primary" data-login="signup">시작하기</button></div></div></header>';
    var cta = '<div class="hp-cta-row"><button type="button" class="hp-btn hp-primary hp-lg" data-login="login">로그인하고 시작하기 ' + icon('arrow', 'hp-ic-s') + '</button>' +
      (S.plan ? '<a class="hp-btn hp-line hp-lg" href="' + esc(S.plan) + '">기획서 보기</a>' : '') + '</div>';
    var trust = '<ul class="hp-trust-chips"><li>' + icon('shield', 'hp-ic-s') + '승인된 구성원만</li><li>' + icon('folder', 'hp-ic-s') + '자료는 내 브라우저에</li><li>' + icon('users', 'hp-ic-s') + '회사 · 개인 메일 가입</li></ul>';
    var frame = function (src, cap) {
      return '<figure class="hp-frame"><div class="hp-frame-bar"><i></i><i></i><i></i><span>' + esc((location.host || '').replace(/^www\./, '')) + '</span></div>' +
        '<img src="' + esc(src) + '" alt="' + esc(cap) + '" loading="lazy"></figure>';
    };
    var chips = feats.slice(0, 2).map(function (f, i) {
      return '<div class="hp-float hp-float-' + (i + 1) + '">' + icon(iconFor(f.name)) + '<span>' + esc(f.name) + '</span></div>';
    }).join('');
    var visual = heroImg && !cover ? '<figure class="hp-photo"><img src="' + esc(heroImg) + '" alt="' + esc(L.heroAlt || title) + '"></figure>' :
      (S.screen ? frame(S.screen, title + ' 실제 화면') : '<div class="hp-art">' + art(flow.length) + '</div>');
    var hero;
    if (banner) {
      hero = '<section class="hp-banner" id="hp-top"><button type="button" class="hp-banner-btn" data-login="login" aria-label="로그인">' +
        '<img src="' + esc(L.image) + '" alt="' + esc(L.imageAlt || title) + '"></button></section>' +
        '<section class="hp-intro"><div class="hp-in hp-intro-in"><div><p class="hp-eyebrow">' + esc(eyebrow) + '</p><h1 class="hp-h1s">' + head + '</h1>' +
        (lead ? '<p class="hp-lead">' + esc(lead) + '</p>' : '') + '</div>' + cta + '</div></section>';
    } else {
      hero = '<section class="hp-hero' + (cover ? ' hp-cover' : '') + '" id="hp-top"' +
        (cover ? ' style="--hp-photo:url(&quot;' + esc(absUrl(L.image)) + '&quot;)"' : '') + '><div class="hp-in hp-hero-in">' +
        '<div class="hp-hero-copy hp-rv">' + (eyebrow ? '<p class="hp-eyebrow">' + esc(eyebrow) + '</p>' : '') + '<h1>' + head + '</h1>' +
        (lead ? '<p class="hp-lead">' + esc(lead) + '</p>' : '') + cta + trust + '</div>' +
        '<div class="hp-hero-vis hp-rv">' + visual + chips + '</div></div></section>';
    }
    var goalsH = goals.length ? '<section class="hp-sec hp-goals"><div class="hp-in"><div class="hp-goal-grid">' + goals.map(function (g, i) {
      return '<div class="hp-goal hp-rv"><span class="hp-goal-n">0' + (i + 1) + '</span><p>' + esc(g) + '</p></div>';
    }).join('') + '</div></div></section>' : '';
    var featH = feats.length ? '<section class="hp-sec" id="hp-features"><div class="hp-in"><div class="hp-head hp-rv"><p class="hp-kicker">기능</p><h2>현장에서 바로 쓰는 기능</h2></div>' +
      '<div class="hp-feat-grid">' + feats.map(function (f) {
        return '<article class="hp-feat hp-rv"><span class="hp-feat-ic">' + icon(iconFor(f.name + ' ' + f.desc)) + '</span><h3>' + esc(f.name) + '</h3><p>' + esc(f.desc) + '</p></article>';
      }).join('') + '</div></div></section>' : '';
    var flowH = flow.length ? '<section class="hp-sec hp-alt" id="hp-flow"><div class="hp-in"><div class="hp-head hp-rv"><p class="hp-kicker">사용 순서</p><h2>이렇게 씁니다</h2></div>' +
      '<ol class="hp-steps">' + flow.map(function (st, i) {
        return '<li class="hp-step hp-rv"><span class="hp-step-n">' + (i + 1) + '</span><h3>' + esc(st.step) + '</h3>' + (st.desc ? '<p>' + esc(st.desc) + '</p>' : '') + '</li>';
      }).join('') + '</ol></div></section>' : '';
    var screenH = S.screen && ((heroImg && !cover) || banner) ? '<section class="hp-sec" id="hp-screen"><div class="hp-in"><div class="hp-head hp-rv"><p class="hp-kicker">실제 화면</p><h2>한 화면에서 확인합니다</h2></div>' +
      '<div class="hp-screen hp-rv">' + frame(S.screen, title + ' 실제 화면') + '<p class="hp-cap">가상 예제 데이터로 찍은 화면입니다.</p></div></div></section>' : '';
    var trustH = '<section class="hp-sec hp-alt"><div class="hp-in"><div class="hp-head hp-rv"><p class="hp-kicker">믿고 쓰는 이유</p><h2>우리 팀만, 안전하게</h2></div><div class="hp-trust">' +
      '<div class="hp-tr hp-rv">' + icon('shield') + '<h3>승인제 접근</h3><p>회사 메일이나 개인 메일로 가입한 뒤 관리자가 승인한 구성원만 도구를 엽니다. 관리자는 팀원의 신청을 직접 승인합니다.</p></div>' +
      '<div class="hp-tr hp-rv">' + icon('folder') + '<h3>자료는 내 브라우저에</h3><p>업무 파일과 입력한 값은 서버로 보내지 않고 쓰는 사람의 브라우저에 저장합니다. 필요하면 백업 파일로 옮깁니다.</p></div>' +
      '<div class="hp-tr hp-rv">' + icon('move') + '<h3>우리 회사로 옮기기</h3><p>로그인 서버와 저장소를 회사 계정으로 옮겨 그대로 쓸 수 있습니다. SQL 한 번과 설정 파일 한 곳이면 됩니다.</p></div>' +
      '</div></div></section>';
    var band = '<section class="hp-band"><div class="hp-in hp-band-in hp-rv"><div><h2>오늘 업무부터 바로 써 보세요</h2><p>가입 → 사용 신청 → 관리자 승인 뒤 바로 열립니다.</p></div>' +
      '<div class="hp-cta-row"><button type="button" class="hp-btn hp-onband hp-lg" data-login="signup">회원가입</button><button type="button" class="hp-btn hp-line-band hp-lg" data-login="login">로그인</button></div></div></section>';
    var foot = '<footer class="hp-foot"><div class="hp-in hp-foot-in"><div class="hp-foot-brand">' + (co.name ? '<b>' + esc(co.name) + '</b>' : '') + '<span>' + esc(title) + '</span></div>' +
      '<p>' + esc(S.course || '') + (S.plan ? ' · <a href="' + esc(S.plan) + '">최종 기획서</a>' : '') + '</p>' +
      '<p class="hp-foot-s">© ' + new Date().getFullYear() + ' ' + esc(co.name || title) + ' · 업무 자료는 서버로 보내지 않고 이 브라우저에 저장합니다</p></div></footer>';
    var modal = '<div class="hp-modal" id="agModal" hidden><div class="hp-dialog" role="dialog" aria-modal="true" aria-label="로그인">' +
      '<button type="button" class="hp-x" data-close aria-label="닫기">×</button><div id="agModalBody"></div></div></div>';
    return '<div class="hp">' + nav + hero + goalsH + featH + flowH + screenH + trustH + band + foot + '</div>' + modal;
  }
  function openModal() {
    var m = gate.querySelector('#agModal'); if (!m) return;
    m.hidden = false; gate.classList.add('hp-modal-open');
    var i = m.querySelector('input'); if (i) setTimeout(function () { i.focus(); }, 30);
  }
  function closeModal() { var m = gate.querySelector('#agModal'); if (m) m.hidden = true; gate.classList.remove('hp-modal-open'); }
  function bindHome() {
    gate.querySelectorAll('[data-login]').forEach(function (b) {
      b.onclick = function () { viewLogin(b.getAttribute('data-login'), null, true); };
    });
    var m = gate.querySelector('#agModal');
    m.addEventListener('click', function (e) { if (e.target === m || e.target.hasAttribute('data-close')) closeModal(); });
    gate.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) closeModal(); });
    gate.querySelectorAll('.hp-nav a[href^="#"]').forEach(function (a) {
      a.onclick = function (e) { var t = gate.querySelector(a.getAttribute('href')); if (!t) return; e.preventDefault(); t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); };
    });
    var nav = gate.querySelector('.hp-nav');
    gate.addEventListener('scroll', function () { nav.classList.toggle('is-scrolled', gate.scrollTop > 8); }, { passive: true });
    // 화면에 들어올 때 살짝 떠오른다 — 모션 최소화 · IntersectionObserver 없으면 처음부터 보인다
    var els = gate.querySelectorAll('.hp-rv');
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('is-in'); }); }
    else {
      gate.classList.add('hp-anim');
      var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }); }, { root: gate, threshold: 0.12 });
      els.forEach(function (el) { io.observe(el); });
    }
    // 사용 순서 — 차례로 밝아진다
    var steps = gate.querySelectorAll('.hp-step'), k = 0;
    if (steps.length && !reduce) fxTimer = setInterval(function () {
      if (gate.hidden) return stopFx();
      steps.forEach(function (s, j) { s.classList.toggle('is-on', j === k); }); k = (k + 1) % steps.length;
    }, 2200);
  }

  // ───────── 로그인 · 회원가입 ─────────
  function viewLogin(tab, note, open) {
    var signup = tab === 'signup';
    var card = ('<div class="ag-card">' +
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
    if (homeOn()) {
      if (!gate.querySelector('.hp')) {
        stopFx(); root.classList.add('auth-lock'); gate.hidden = false;
        gate.classList.add('ag-home'); gate.innerHTML = homeHtml(); gate.scrollTop = 0; bindHome();
      }
      gate.querySelector('#agModalBody').innerHTML = card;
      if (open || note) openModal();
    } else show(card);
    if (note) msg(note.text, note.kind);
    gate.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { viewLogin(b.getAttribute('data-tab'), null, true); }; });
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
    stopFx(); gate.hidden = true; gate.innerHTML = ''; unlockPage(); mountShell(); startIdle();
  }
  function signOut() {
    sb.auth.signOut({ scope: 'local' }).then(function () { route(); });
  }

  // ───────── 상단 바 계정 칩 ─────────
  function isAdmin() { return !!(member && member.status === 'active' && (member.roles || []).indexOf('admin') >= 0); }
  function removeChip() {
    ['authChip', 'kitNav'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); });
    var pg = document.getElementById('kitPage'), main = document.getElementById('main');
    if (pg) pg.remove(); if (main) main.hidden = false;
    root.classList.remove('kit-shell', 'kit-a', 'kit-b', 'kit-page-on');
  }
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
      document.querySelectorAll('#authChip .auth-chip-n, #kitNav .auth-chip-n').forEach(function (n) { n.hidden = !r.count; n.textContent = r.count || ''; });
    });
  }


  // ───────── 도구 화면 틀(로그인 뒤) ─────────
  // 위쪽 줄: 사용 방법 · 관리(관리자) · 사용자 메뉴 / 왼쪽: 「도움 · 관리」 묶음 / 키트 페이지(#/kit-guide · #/kit-me · #/kit-admin)
  // 앱 라우터는 모르는 주소를 받아도 주소를 바꾸지 않는다(15개 실측) — 그래서 #main 을 감추고 옆의 키트 칸을 보인다.
  var KIT = { 'kit-guide': '사용 방법', 'kit-me': '내 정보', 'kit-admin': '관리' };
  var kitBound = false;
  function initials(n) { n = String(n || '').trim(); if (!n) return '나'; return /^[가-힣]{3,4}$/.test(n) ? n.slice(1, 3) : n.slice(0, /[가-힣]/.test(n) ? 2 : 2).toUpperCase(); }
  function mountShell() {
    removeChip();
    root.classList.add('kit-shell', document.querySelector('.sidebar') ? 'kit-b' : 'kit-a');
    var host = document.querySelector('.topbar') || document.body, adm = isAdmin(), local = !!member.local;
    var c = document.createElement('div');
    c.id = 'authChip'; c.className = 'auth-chip' + (host === document.body ? ' is-float' : '');
    c.innerHTML = '<a class="auth-chip-link" href="#/kit-guide">' + icon('doc', 'kit-ic') + '<span>사용 방법</span></a>' +
      (adm ? '<a class="auth-chip-link" href="#/kit-admin">' + icon('shield', 'kit-ic') + '<span>관리</span><span class="auth-chip-n" hidden></span></a>' : '') +
      (local ? '' : '<div class="auth-user"><button type="button" class="auth-user-btn" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="auth-av" aria-hidden="true">' + esc(initials(member.name || member.email)) + '</span>' +
      '<span class="auth-user-t"><b>' + esc(member.name || member.email || '') + '</b><small>' + (adm ? '관리자' : '구성원') + (member.org ? ' · ' + esc(member.org) : '') + '</small></span>' +
      '<svg class="auth-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="auth-menu" role="menu" hidden><p class="auth-menu-h">' + esc(member.email || '') + '</p>' +
      '<a role="menuitem" href="#/kit-me">' + icon('users', 'kit-ic') + '내 정보 · 비밀번호</a>' +
      (adm ? '<a role="menuitem" href="#/kit-admin">' + icon('shield', 'kit-ic') + '관리 · 구성원 승인</a>' : '') +
      '<a role="menuitem" href="#/kit-guide">' + icon('doc', 'kit-ic') + '사용 방법</a>' +
      '<button type="button" role="menuitem" id="authOut">' + icon('move', 'kit-ic') + '로그아웃</button></div></div>');
    host.appendChild(c);
    var btn = c.querySelector('.auth-user-btn'), menu = c.querySelector('.auth-menu');
    if (btn) {
    function setMenu(on) { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); }
    btn.onclick = function (e) { e.stopPropagation(); setMenu(menu.hidden); };
    menu.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('click', function (e) { if (!c.contains(e.target)) setMenu(false); });
    document.getElementById('authOut').onclick = signOut;
    }
    // 왼쪽 「도움 · 관리」 묶음 — 앱이 #nav 안을 다시 그려도 지워지지 않게 #nav 바로 뒤 형제로 둔다
    var nav = document.getElementById('nav');
    if (nav) {
      var g = document.createElement('nav'); g.id = 'kitNav'; g.className = 'kit-nav'; g.setAttribute('aria-label', '도움 · 관리');
      g.innerHTML = '<p class="kit-nav-t">' + (local ? '도움' : '도움 · 관리') + '</p>' +
        '<a href="#/kit-guide">' + icon('doc', 'kit-ic') + '<span>사용 방법</span></a>' +
        (local ? '' : '<a href="#/kit-me">' + icon('users', 'kit-ic') + '<span>내 정보</span></a>') +
        (adm ? '<a href="#/kit-admin">' + icon('shield', 'kit-ic') + '<span>관리</span><span class="auth-chip-n" hidden></span></a>' : '');
      nav.parentNode.insertBefore(g, nav.nextSibling);
    }
    // 키트 페이지 칸 — 앱 본문(#main)과 같은 틀 클래스를 써서 여백 · 폭이 같다
    var main = document.getElementById('main');
    if (main) {
      var pg = document.createElement('section'); pg.id = 'kitPage'; pg.className = (main.className || '') + ' kit-page'; pg.hidden = true; pg.tabIndex = -1;
      pg.setAttribute('aria-live', 'polite'); main.parentNode.insertBefore(pg, main.nextSibling);
    }
    if (!kitBound) { kitBound = true; addEventListener('hashchange', function () { if (member) kitRoute(); }); }
    kitRoute(); if (!local) refreshPendingCount();
  }
  function kitRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '').split(/[?/]/)[0];
    var pg = document.getElementById('kitPage'), main = document.getElementById('main');
    var on = !!KIT[h] && (h !== 'kit-admin' || isAdmin()) && (h === 'kit-guide' || !member.local);
    document.querySelectorAll('#kitNav a, #authChip .auth-chip-link').forEach(function (a) {
      if (a.getAttribute('href') === '#/' + h && on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!pg || !main) return;
    root.classList.toggle('kit-page-on', on);
    if (!on) { pg.hidden = true; pg.innerHTML = ''; main.hidden = false; return; }
    main.hidden = true; pg.hidden = false;
    ({ 'kit-guide': pageGuide, 'kit-me': pageMe, 'kit-admin': pageAdmin })[h](pg);
    try { pg.focus({ preventScroll: true }); } catch (e) {}
    window.scrollTo(0, 0);
  }
  function kpHead(kicker, title, sub) {
    return '<header class="kp-head"><p class="kp-kicker">' + esc(kicker) + '</p><h1>' + esc(title) + '</h1>' + (sub ? '<p class="kp-sub">' + esc(sub) + '</p>' : '') + '</header>';
  }
  var ST_KO = { pending: '승인 대기', active: '사용', disabled: '중지' };
  function fmtTime(t) { if (!t) return ''; var d = new Date(t); if (isNaN(d)) return String(t).slice(0, 16); var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  // ─── 사용 방법 ───
  function pageGuide(pg) {
    var G = S.guide || {}, flow = G.flow && G.flow.length ? G.flow : (S.flow || []), title = S.title || document.title;
    var toc = [['start', '처음 시작하기'], flow.length && ['flow', '사용 순서'], (G.screens || []).length && ['screens', '화면별 안내'],
      (G.data || []).length && ['data', '넣는 자료'], (G.rules || []).length && ['rules', '계산 · 판정 기준'], ['keep', '자료 보관 · 백업'], ['account', '계정 · 로그인'],
      (G.limits || []).length && ['limits', '이번 판에서 하지 않는 것']].filter(Boolean);
    var sec = function (id, t, body) { return '<section class="kp-card" id="kg-' + id + '"><h2>' + esc(t) + '</h2>' + body + '</section>'; };
    var li = function (a) { return '<ul class="kp-list">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; };
    pg.innerHTML = '<div class="kp">' + kpHead('사용 방법', title + ' 사용 안내', S.summary || '') +
      '<nav class="kp-toc" aria-label="목차">' + toc.map(function (t) { return '<a href="#kg-' + t[0] + '" data-kg="' + t[0] + '">' + esc(t[1]) + '</a>'; }).join('') +
      '<button type="button" class="kp-btn kp-ghost" data-print>인쇄 · PDF</button></nav>' +
      sec('start', '처음 시작하기', '<ol class="kp-steps">' +
        '<li><b>회원가입</b><span>로그인 전 화면의 「시작하기」에서 이름 · 소속 · 연락처와 회사 메일이나 개인 메일 · 비밀번호(8자 이상)로 가입합니다.</span></li>' +
        '<li><b>사용 신청 · 승인</b><span>가입하면 사용 신청이 들어가고, 관리자가 승인하면 바로 도구가 열립니다. 승인 전에는 「승인 대기」 화면이 보입니다.</span></li>' +
        '<li><b>예시로 둘러보기</b><span>처음에는 화면의 「예시 · 샘플 데이터로 시작」 단추로 가상 자료를 넣어 모든 메뉴를 한 번씩 눌러 봅니다. 실제 자료를 넣기 전에 설정에서 예시 자료를 지웁니다.</span></li>' +
        '<li><b>실제 자료로 쓰기</b><span>아래 「사용 순서」대로 실제 파일을 넣고 결과를 확인합니다. 결과는 엑셀 · 인쇄 · 워드로 내보낼 수 있습니다.</span></li></ol>') +
      (flow.length ? sec('flow', '사용 순서', '<ol class="kp-flow">' + flow.map(function (st, i) {
        return '<li><span class="kp-n">' + (i + 1) + '</span><div><b>' + esc(st.step) + '</b>' + (st.desc ? '<p>' + esc(st.desc) + '</p>' : '') + '</div></li>';
      }).join('') + '</ol>') : '') +
      ((G.screens || []).length ? sec('screens', '화면별 안내', '<div class="kp-tw"><table class="kp-table"><thead><tr><th>화면</th><th>하는 일</th></tr></thead><tbody>' +
        G.screens.map(function (r) { return '<tr><th scope="row">' + esc(r.name) + '</th><td>' + esc(r.desc) + '</td></tr>'; }).join('') + '</tbody></table></div>') : '') +
      ((G.data || []).length ? sec('data', '넣는 자료', '<div class="kp-tw"><table class="kp-table"><thead><tr><th>자료</th><th>들어 있어야 할 칸</th></tr></thead><tbody>' +
        G.data.map(function (r) { return '<tr><th scope="row">' + esc(r.name) + '</th><td>' + esc(r.fields) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="kp-note">열 이름이 조금 달라도 찾아 연결하고, 못 찾은 열은 화면에서 골라 연결합니다.</p>') : '') +
      ((G.rules || []).length ? sec('rules', '계산 · 판정 기준', li(G.rules)) : '') +
      sec('keep', '자료 보관 · 백업', li([
        '업무 파일과 입력한 값은 서버로 보내지 않고 지금 쓰는 브라우저 안에만 저장됩니다. 다른 PC · 다른 브라우저에서는 보이지 않습니다.',
        '설정의 「백업(JSON) 내려받기」로 정기적으로 백업하고, 다른 PC 에서는 「백업 불러오기」로 옮깁니다.',
        '브라우저의 「인터넷 사용 기록 삭제(쿠키 · 사이트 데이터)」나 시크릿 창은 저장된 자료를 지우거나 남기지 않으니 주의합니다.',
        'AI 자동 보내기는 설정에서 직접 켠 경우에만 동작하고, 사람 이름은 기본으로 가려 보냅니다.'])) +
      sec('account', '계정 · 로그인', li([
        '비밀번호는 오른쪽 위 이름 → 「내 정보 · 비밀번호」에서 바꿉니다. 잊었으면 관리자에게 알려 주세요.',
        '30분 동안 움직임이 없으면 이 기기에서만 자동으로 로그아웃됩니다. 입력한 자료는 브라우저에 남아 있습니다.',
        '관리자는 「관리」에서 가입한 사람을 승인하고, 다른 사람을 관리자로 지정하거나 사용을 중지할 수 있습니다.',
        '이 도구는 로그인 서버와 저장소를 회사 계정으로 옮겨 그대로 쓸 수 있습니다(저장소의 「내 깃허브로 옮기기」 안내).'])) +
      ((G.limits || []).length ? sec('limits', '이번 판에서 하지 않는 것', li(G.limits)) : '') +
      (S.plan ? '<p class="kp-foot">더 자세한 처리 흐름 · 구성 · 화면 설계는 <a href="' + esc(S.plan) + '" target="_blank" rel="noopener">최종 기획서</a>에 있습니다.</p>' : '') +
      '</div>';
    pg.querySelectorAll('[data-kg]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var t = pg.querySelector('#kg-' + a.getAttribute('data-kg')); if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }; });
    pg.querySelector('[data-print]').onclick = function () { window.print(); };
  }

  // ─── 내 정보 ───
  function pageMe(pg) {
    var m = member || {}, roles = (m.roles || []).indexOf('admin') >= 0 ? '관리자' : '구성원';
    pg.innerHTML = '<div class="kp">' + kpHead('내 정보', '내 정보 · 비밀번호', '이름 · 소속 · 연락처는 관리자 화면의 구성원 목록에 보입니다.') +
      '<div class="kp-grid2"><section class="kp-card"><h2>기본 정보</h2>' +
      '<dl class="kp-dl"><dt>이메일</dt><dd>' + esc(m.email || (me && me.email) || '') + '</dd><dt>상태</dt><dd><span class="kp-st is-' + esc(m.status) + '">' + esc(ST_KO[m.status] || m.status || '') + '</span> <span class="kp-st is-role">' + roles + '</span></dd></dl>' +
      '<form class="ag-form kp-form" id="kmForm" novalidate>' +
      '<label>이름<input name="name" maxlength="80" value="' + esc(m.name || '') + '" required></label>' +
      '<label>소속(회사 · 부서)<input name="org" maxlength="120" value="' + esc(m.org || '') + '"></label>' +
      '<label>연락처<input name="phone" type="tel" maxlength="40" value="' + esc(m.phone || '') + '"></label>' +
      '<button class="kp-btn kp-primary" type="submit">저장</button><p class="ag-msg kp-msg" role="status" aria-live="polite"></p></form></section>' +
      '<section class="kp-card"><h2>비밀번호 바꾸기</h2>' +
      '<p class="kp-note">카카오로 로그인하는 계정은 비밀번호가 없습니다. 메일로 가입한 계정만 바꿉니다.</p>' +
      '<form class="ag-form kp-form" id="kpForm" novalidate>' +
      '<label>새 비밀번호 <small>8자 이상</small><input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<label>새 비밀번호 확인<input name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<button class="kp-btn kp-primary" type="submit">비밀번호 바꾸기</button><p class="ag-msg kp-msg" role="status" aria-live="polite"></p></form>' +
      '<hr class="kp-hr"><button type="button" class="kp-btn kp-ghost" id="kmOut">로그아웃</button></section></div></div>';
    var say = function (form, t, k) { var p = form.querySelector('.kp-msg'); p.textContent = t || ''; p.className = 'ag-msg kp-msg' + (k ? ' is-' + k : ''); };
    var f1 = pg.querySelector('#kmForm');
    f1.onsubmit = function (e) {
      e.preventDefault(); var b = f1.querySelector('button'), patch = { name: f1.name.value.trim(), org: f1.org.value.trim(), phone: f1.phone.value.trim() };
      if (!patch.name) return say(f1, '이름을 넣어 주세요.', 'err');
      busy(b, true);
      sb.rpc(RPC.save, { p_user: me.id, p_patch: patch }).then(function (r) {
        busy(b, false); if (r.error) return say(f1, errText(r.error), 'err');
        member.name = patch.name; member.org = patch.org; member.phone = patch.phone; say(f1, '저장했습니다.', 'ok');
        var t = document.querySelector('.auth-user-t'); if (t) t.querySelector('b').textContent = patch.name;
      });
    };
    var f2 = pg.querySelector('#kpForm');
    f2.onsubmit = function (e) {
      e.preventDefault(); var b = f2.querySelector('button'), pw = f2.pw.value;
      if (pw.length < 8) return say(f2, '비밀번호는 8자 이상으로 해 주세요.', 'err');
      if (pw !== f2.pw2.value) return say(f2, '비밀번호 확인이 다릅니다.', 'err');
      busy(b, true);
      sb.auth.updateUser({ password: pw }).then(function (r) { busy(b, false); if (r.error) return say(f2, errText(r.error), 'err'); f2.reset(); say(f2, '비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 씁니다.', 'ok'); });
    };
    pg.querySelector('#kmOut').onclick = signOut;
  }

  // ─── 관리(관리자) ───
  var adminUi = { tab: 'members', q: '', st: 'all', edit: '' };
  function pageAdmin(pg) {
    pg.innerHTML = '<div class="kp">' + kpHead('관리', '구성원 · 권한 관리', '가입한 사람을 승인하고 관리자를 지정합니다. 승인된 사람만 도구를 엽니다.') + '<p class="kp-note">불러오는 중…</p></div>';
    Promise.all([
      sb.from(T.members).select('user_id,name,org,phone,email,roles,status,requested_at,approved_at').order('requested_at', { ascending: false }),
      sb.from(P + '_member_changes').select('id,user_id,fields,before,after,changed_name,changed_at').order('changed_at', { ascending: false }).limit(300)
    ]).then(function (rs) {
      if (rs[0].error) { pg.innerHTML = '<div class="kp">' + kpHead('관리', '구성원 · 권한 관리') + '<p class="ag-msg is-err">' + esc(errText(rs[0].error)) + '</p></div>'; return; }
      drawAdmin(pg, rs[0].data || [], rs[1].error ? [] : (rs[1].data || []));
    });
  }
  function drawAdmin(pg, all, changes) {
    var cnt = function (f) { return all.filter(f).length; };
    var isAdm = function (m) { return (m.roles || []).indexOf('admin') >= 0; };
    var stats = [['전체', all.length, ''], ['승인 대기', cnt(function (m) { return m.status === 'pending'; }), 'pending'], ['사용', cnt(function (m) { return m.status === 'active'; }), 'active'],
      ['중지', cnt(function (m) { return m.status === 'disabled'; }), 'disabled'], ['관리자', cnt(function (m) { return m.status === 'active' && isAdm(m); }), 'admin']];
    var q = adminUi.q.toLowerCase(), list = all.filter(function (m) {
      if (adminUi.st === 'admin' ? !(m.status === 'active' && isAdm(m)) : (adminUi.st !== 'all' && m.status !== adminUi.st)) return false;
      return !q || [m.name, m.org, m.email, m.phone].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var nameOf = {}; all.forEach(function (m) { nameOf[m.user_id] = m.name || m.email; });
    var rows = list.map(function (m) {
      var a = isAdm(m), self = me && m.user_id === me.id, acts = [];
      if (m.status === 'pending') { acts.push(['승인', { status: 'active' }, 'kp-primary']); acts.push(['거절', { status: 'disabled' }]); }
      if (m.status === 'active') { acts.push([a ? '관리자 해제' : '관리자로 지정', { roles: a ? [] : ['admin'] }]); if (!self) acts.push(['사용 중지', { status: 'disabled' }]); }
      if (m.status === 'disabled') acts.push(['다시 사용', { status: 'active' }]);
      var editing = adminUi.edit === m.user_id;
      return '<tr' + (m.status === 'pending' ? ' class="is-pending"' : '') + '><td><div class="kp-who"><span class="auth-av">' + esc(initials(m.name || m.email)) + '</span><div><b>' + esc(m.name || '(이름 없음)') + '</b>' + (self ? ' <small>(나)</small>' : '') + '<small>' + esc(m.email) + '</small></div></div></td>' +
        '<td>' + (editing ? '<input class="kp-in" data-f="org" value="' + esc(m.org) + '" placeholder="소속"><input class="kp-in" data-f="phone" value="' + esc(m.phone) + '" placeholder="연락처">' : esc(m.org) + '<small>' + esc(m.phone) + '</small>') + '</td>' +
        '<td><span class="kp-st is-' + m.status + '">' + ST_KO[m.status] + '</span>' + (a ? ' <span class="kp-st is-role">관리자</span>' : '') + '</td>' +
        '<td><small>신청 ' + esc(fmtTime(m.requested_at)) + (m.approved_at ? '<br>승인 ' + esc(fmtTime(m.approved_at)) : '') + '</small></td>' +
        '<td class="kp-acts" data-u="' + m.user_id + '">' + (editing ? '<input class="kp-in" data-f="name" value="' + esc(m.name) + '" placeholder="이름"><button type="button" class="kp-btn kp-primary kp-sm" data-save>저장</button><button type="button" class="kp-btn kp-sm" data-cancel>취소</button>' :
          acts.map(function (x) { return '<button type="button" class="kp-btn kp-sm ' + (x[2] || '') + '" data-p=\'' + esc(JSON.stringify(x[1])) + '\'>' + x[0] + '</button>'; }).join('') +
          '<button type="button" class="kp-btn kp-sm kp-ghost" data-edit>정보 고치기</button>') + '</td></tr>';
    }).join('');
    var label = { name: '이름', org: '소속', phone: '연락처', roles: '권한', status: '상태' };
    var val = function (k, v) { if (k === 'status') return ST_KO[v] || v || '—'; if (k === 'roles') return (v || []).indexOf ? ((v || []).indexOf('admin') >= 0 ? '관리자' : '일반') : '—'; return v == null || v === '' ? '—' : v; };
    var hist = changes.map(function (c) {
      return '<tr><td><small>' + esc(fmtTime(c.changed_at)) + '</small></td><td><b>' + esc(nameOf[c.user_id] || '(알 수 없음)') + '</b></td><td>' +
        (c.fields || []).map(function (k) { return '<span class="kp-chg">' + esc(label[k] || k) + ' ' + esc(val(k, (c.before || {})[k])) + ' → <b>' + esc(val(k, (c.after || {})[k])) + '</b></span>'; }).join('') +
        '</td><td>' + esc(c.changed_name || '') + '</td></tr>';
    }).join('');
    pg.innerHTML = '<div class="kp">' + kpHead('관리', '구성원 · 권한 관리', '가입한 사람을 승인하고 관리자를 지정합니다. 승인된 사람만 도구를 엽니다.') +
      '<div class="kp-stats">' + stats.map(function (s) { return '<button type="button" class="kp-stat' + (adminUi.st === (s[2] || 'all') ? ' is-on' : '') + '" data-st="' + (s[2] || 'all') + '"><span>' + s[0] + '</span><b>' + s[1] + '</b></button>'; }).join('') + '</div>' +
      '<div class="kp-tabs" role="tablist"><button type="button" role="tab" data-tab="members" aria-selected="' + (adminUi.tab === 'members') + '">구성원</button>' +
      '<button type="button" role="tab" data-tab="history" aria-selected="' + (adminUi.tab === 'history') + '">변경 이력 ' + changes.length + '</button>' +
      '<button type="button" role="tab" data-tab="help" aria-selected="' + (adminUi.tab === 'help') + '">관리자 안내</button></div>' +
      '<p class="ag-msg kp-msg" role="status" aria-live="polite"></p>' +
      (adminUi.tab === 'members' ? '<section class="kp-card kp-flat"><div class="kp-tools"><input class="kp-in kp-search" type="search" placeholder="이름 · 소속 · 메일 · 연락처 검색" value="' + esc(adminUi.q) + '">' +
        '<button type="button" class="kp-btn kp-ghost" data-csv>CSV 내려받기</button></div>' +
        (rows ? '<div class="kp-tw"><table class="kp-table kp-members"><thead><tr><th>이름 · 메일</th><th>소속 · 연락처</th><th>상태</th><th>일시</th><th>처리</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="kp-note">해당하는 구성원이 없습니다.</p>') + '</section>' : '') +
      (adminUi.tab === 'history' ? '<section class="kp-card kp-flat">' + (hist ? '<div class="kp-tw"><table class="kp-table"><thead><tr><th>일시</th><th>대상</th><th>바뀐 것</th><th>처리한 사람</th></tr></thead><tbody>' + hist + '</tbody></table></div>' : '<p class="kp-note">아직 변경 이력이 없습니다.</p>') + '</section>' : '') +
      (adminUi.tab === 'help' ? '<section class="kp-card"><ul class="kp-list">' +
        '<li>가입한 사람은 「승인 대기」로 들어옵니다. 회사 메일 · 이름 · 소속을 보고 본인이 맞으면 「승인」, 아니면 「거절」합니다.</li>' +
        '<li>「관리자로 지정」하면 그 사람도 이 화면에서 승인 · 지정 · 중지를 할 수 있습니다. 팀장 · 담당자를 관리자로 두면 편합니다.</li>' +
        '<li>퇴사 · 이동한 사람은 지우지 말고 「사용 중지」합니다. 언제든 「다시 사용」으로 되돌릴 수 있고 이력이 남습니다.</li>' +
        '<li>마지막 관리자는 해제하거나 중지할 수 없습니다. 다른 사람을 관리자로 먼저 지정해 주세요.</li>' +
        '<li>비밀번호는 관리자가 볼 수 없습니다. 잊은 사람은 회사 계정으로 옮긴 뒤 Supabase 화면에서 재설정 메일을 보내거나, 새 메일로 다시 가입해 승인합니다.</li>' +
        '<li>모든 승인 · 권한 · 정보 변경은 「변경 이력」에 일시와 처리한 사람이 남습니다.</li></ul></section>' : '') +
      '</div>';
    var redraw = function () { drawAdmin(pg, all, changes); };
    pg.querySelectorAll('[data-st]').forEach(function (b) { b.onclick = function () { adminUi.st = b.getAttribute('data-st'); adminUi.tab = 'members'; redraw(); }; });
    pg.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { adminUi.tab = b.getAttribute('data-tab'); redraw(); }; });
    var sx = pg.querySelector('.kp-search');
    if (sx) sx.oninput = function () { adminUi.q = sx.value; var pos = sx.selectionStart; redraw(); var n = pg.querySelector('.kp-search'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    var csv = pg.querySelector('[data-csv]');
    if (csv) csv.onclick = function () {
      var lines = [['이름', '소속', '연락처', '메일', '상태', '권한', '신청', '승인']].concat(all.map(function (m) { return [m.name, m.org, m.phone, m.email, ST_KO[m.status], isAdm(m) ? '관리자' : '', fmtTime(m.requested_at), fmtTime(m.approved_at)]; }));
      var text = '﻿' + lines.map(function (r) { return r.map(function (x) { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(','); }).join('\r\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = (S.title || '구성원') + '_구성원.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    var say = function (t, k) { var p = pg.querySelector('.kp-msg'); p.textContent = t || ''; p.className = 'ag-msg kp-msg' + (k ? ' is-' + k : ''); };
    var save = function (uid, patch, btn) {
      busy(btn, true);
      sb.rpc(RPC.save, { p_user: uid, p_patch: patch }).then(function (x) {
        busy(btn, false);
        if (x.error) return say(errText(x.error), 'err');
        adminUi.edit = '';
        if (me && uid === me.id) { route(); return; }
        pageAdmin(pg); refreshPendingCount();
      });
    };
    pg.querySelectorAll('.kp-acts').forEach(function (td) {
      var uid = td.getAttribute('data-u');
      td.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { save(uid, JSON.parse(b.getAttribute('data-p')), b); }; });
      var ed = td.querySelector('[data-edit]'); if (ed) ed.onclick = function () { adminUi.edit = uid; redraw(); };
      var cc = td.querySelector('[data-cancel]'); if (cc) cc.onclick = function () { adminUi.edit = ''; redraw(); };
      var sv = td.querySelector('[data-save]');
      if (sv) sv.onclick = function () {
        var tr = td.closest('tr'), get = function (k) { var i = tr.querySelector('[data-f="' + k + '"]'); return i ? i.value.trim() : ''; };
        if (!get('name')) return say('이름을 넣어 주세요.', 'err');
        save(uid, { name: get('name'), org: get('org'), phone: get('phone') }, sv);
      };
    });
  }

  // ───────── 구성원 관리(관리자) — 옛 창(지금은 관리 페이지를 쓴다) ─────────
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

  if (LOCAL) {   // 내 PC: 로그인 없이 도구 + 「사용 방법」
    member = { name: '내 PC', email: '', roles: [], status: 'active', local: true };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountShell); else mountShell();
    return;
  }
  // 다른 탭에서 로그아웃 · 로그인하면 따라간다
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'SIGNED_OUT' && member) route();
    if (ev === 'SIGNED_IN' && !member && !routing) route();
  });
  route();
})();
