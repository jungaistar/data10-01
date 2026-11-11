# Supabase 연결 설정 안내 — data10-01

이 폴더에는 이 도구의 로그인(가입 · 사용 신청 · 관리자 승인)을 **내 Supabase 프로젝트**에 연결하는 데 필요한 것이 모두 들어 있습니다.
순서대로 따라 하면 20분 안에 끝납니다.

| 파일 | 하는 일 | 언제 |
|---|---|---|
| `auth.sql` | 구성원 표 2개 · 판정 함수 5개 · 접근 정책 3개를 만듭니다. 이름이 모두 `data1001_` 로 시작합니다. | 처음 한 번(여러 번 실행해도 안전) |
| `verify.sql` | 제대로 만들어졌는지 숫자로 확인합니다. 읽기만 합니다. | `auth.sql` 실행 뒤, 문제가 생겼을 때 |
| `README.md` | 이 안내 | |

업무 자료(입력한 값 · 가져온 엑셀 · 결과)는 Supabase 에 올라가지 않습니다. 쓰는 사람의 브라우저에 저장됩니다.
Supabase 가 맡는 일은 「누가 이 도구를 쓸 수 있는가」 하나입니다.

---

## 한눈에 보는 순서

1. Supabase 프로젝트 만들기
2. `auth.sql` 실행 → `verify.sql` 로 확인
3. 로그인 방식 켜기(이메일)
4. **연결 링크 등록** — 내 사이트 주소를 Supabase 에 알려 주기
5. **중요 키 두 가지 찾기** — Project URL · anon public 키
6. `js/auth-config.js` 에 두 값 넣기
7. 첫 관리자 만들기
8. (선택) 카카오 로그인
9. 마지막 확인

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인합니다.
2. 「New project」를 누릅니다.
   - Name: `data10-01` 처럼 알아보기 쉬운 이름
   - Database Password: 「Generate a password」로 만들고 **따로 적어 둡니다**. 이 도구에는 넣지 않습니다.
   - Region: `Northeast Asia (Seoul)`
3. 1~2분 기다리면 프로젝트가 열립니다.

무료 요금제로 충분합니다. 무료 프로젝트는 일주일 동안 아무도 쓰지 않으면 잠시 멈춥니다. 멈췄으면 대시보드에서 「Restore project」를 누르면 다시 켜집니다.

## 2. SQL 실행

1. 왼쪽 메뉴 「SQL Editor」 → 「New query」.
2. 이 폴더의 `auth.sql` 을 메모장 · VS Code 로 열어 **전체를 복사**해 붙여 넣습니다.
3. 맨 아래 §8 의 이메일 목록을 **내 이메일로 바꾸거나 비웁니다**.

   ```sql
   v_emails text[] := array['내이메일@회사.com']::text[];   -- 비우려면 array[]::text[]
   ```

   - 비워 두면 7번의 「첫 관리자 되기」 단추로 관리자를 정합니다. 이쪽이 더 쉽습니다.
4. 「Run」을 누릅니다. `Success. No rows returned` 가 나오면 됩니다.
5. 같은 방법으로 `verify.sql` 을 실행합니다. 첫 결과 한 줄이 아래와 같으면 정상입니다.

   | 칸 | 기대하는 값 |
   |---|---|
   | 표 | 2 |
   | RLS 켜진 표 | 2 |
   | 정책 | 3 |
   | 함수 | 5 |
   | 비로그인이 부를 수 있는 함수 | 0 |
   | 관리자 수 | 처음에는 0, 7번을 마치면 1 이상 |

`auth.sql` 은 `data1001_` 로 시작하는 것만 만들고 다른 표는 건드리지 않습니다. 이미 쓰고 있는 프로젝트에 넣어도 됩니다.

## 3. 로그인 방식 켜기(이메일)

「Authentication」 → 「Sign In / Providers」 → 「Email」.

- **Enable Email provider**: 켜져 있어야 합니다(처음부터 켜져 있습니다).
- **Confirm email**
  - 켜면: 가입한 사람이 메일의 확인 링크를 눌러야 로그인됩니다.
  - 끄면: 가입하자마자 로그인됩니다. 팀 안에서만 쓰고 어차피 관리자가 승인하므로, 처음에는 **끄는 것을 권합니다**.
  - Supabase 기본 메일은 한 시간에 보낼 수 있는 수가 아주 적습니다. 켜 둔 채 여러 명이 한꺼번에 가입하면 확인 메일이 오지 않을 수 있습니다.

## 4. 연결 링크 등록 — 내 사이트 주소 알려 주기

「Authentication」 → 「URL Configuration」.

내 사이트 주소가 `https://내아이디.github.io/data10-01/` 라면 이렇게 넣습니다.

| 칸 | 넣을 값 |
|---|---|
| Site URL | `https://내아이디.github.io/data10-01/` |
| Redirect URLs(「Add URL」) | `https://내아이디.github.io/data10-01/` |
| Redirect URLs(하나 더) | `https://내아이디.github.io/data10-01/**` |

- Redirect URLs 는 **두 줄 모두** 넣습니다. 끝에 `/**` 가 붙은 줄만 넣으면 맞지 않는 경우가 있습니다.
- 회사 서버나 다른 주소에 올렸다면 그 주소로 같은 모양 두 줄을 넣습니다.
- 내 PC 에서 로그인 화면까지 시험하려면 `http://localhost:8000/` 과 `http://localhost:8000/**` 도 넣습니다.
- 이 등록이 빠지면 메일 확인 링크나 카카오 로그인 뒤에 **다른 주소로 가 버립니다**. 「로그인이 안 된다」의 가장 흔한 원인입니다.

## 5. 중요 키 두 가지 찾기

이 도구에 넣는 값은 두 가지뿐입니다.

| 값 | 어디에 있나 | 생김새 |
|---|---|---|
| Project URL | 「Project Settings」 → 「Data API」(또는 프로젝트 첫 화면의 「Connect」) | `https://abcdefghijklmnop.supabase.co` |
| anon public 키 | 「Project Settings」 → 「API Keys」 → 「Legacy API Keys」 탭의 `anon` `public` | `eyJ…` 로 시작하는 긴 글자 |

메뉴 이름은 Supabase 화면이 바뀌면서 조금 달라질 수 있습니다. 「API」 「API Keys」 「Connect」 가운데 한 곳에 있습니다.

**넣으면 안 되는 키**

- `service_role` 키, `secret` 키(`sb_secret_…`): 모든 보호를 건너뛰는 키입니다. 웹 파일에 넣으면 누구나 볼 수 있으므로 **절대 넣지 않습니다**.
- Database Password, Access Token: 이 도구에는 쓰이지 않습니다.

anon public 키는 웹 페이지에 들어가도 되는 공개용 키입니다. 표마다 RLS(행 단위 보호)가 켜져 있어, 이 키만으로는 승인받지 않은 사람이 구성원 정보를 읽거나 고칠 수 없습니다.

## 6. `js/auth-config.js` 에 두 값 넣기

파일 맨 위 몇 줄만 고칩니다. 나머지(대문 문구 · 기능 소개)는 그대로 둡니다.

```js
window.AUTH_CONFIG = {
  "url": "https://abcdefghijklmnop.supabase.co",   // 5번의 Project URL
  "anonKey": "eyJ…",                               // 5번의 anon public 키
  "prefix": "data1001",                               // 그대로 둡니다(auth.sql 의 표 이름 앞부분)
  "kakao": false,                                  // 8번을 하지 않았다면 false
  "idleMinutes": 30,                               // 이만큼 아무 조작이 없으면 자동 로그아웃
  "localBypass": true,                             // 내 PC(localhost)에서는 로그인 생략
```

- 큰따옴표와 줄 끝 쉼표를 지우지 않게 조심합니다.
- 고친 뒤 깃허브에 올리고, 사이트를 열어 **Ctrl+F5**(맥은 Cmd+Shift+R)로 새로 고칩니다.
- 깃허브에 올리는 방법은 `docs/내_깃허브로_옮기기.md` 3번에 있습니다.

## 7. 첫 관리자 만들기

1. 내 사이트를 열고 「시작하기」 → 회원가입(이름 · 소속 · 연락처 · 이메일 · 비밀번호).
2. 로그인하면 「사용 신청」 화면이 나옵니다.
3. 관리자가 아직 한 명도 없으면 **「첫 관리자 되기」** 단추가 보입니다. 누르면 내가 관리자가 되고 도구가 열립니다.
   - 2번에서 `v_emails` 에 내 이메일을 넣었다면: 가입한 뒤 `auth.sql` 을 한 번 더 실행하면 관리자가 됩니다.
4. 그다음부터 가입하는 사람은 「승인 대기」가 되고, 관리자가 「관리」 화면에서 승인합니다. 관리자를 더 지정할 수도 있습니다.

## 8. (선택) 카카오 로그인

이메일 로그인만으로 충분하면 건너뜁니다(`"kakao": false`).

1. https://developers.kakao.com → 「내 애플리케이션」 → 애플리케이션 추가.
2. 「앱 키」의 **REST API 키**를 복사합니다.
3. 「카카오 로그인」을 켜고 **Redirect URI** 에 아래 주소를 넣습니다(내 사이트 주소가 아니라 Supabase 주소입니다).

   ```
   https://abcdefghijklmnop.supabase.co/auth/v1/callback
   ```

4. 「보안」에서 Client Secret 을 만들고 「사용함」으로 바꿉니다.
5. 「동의항목」에서 닉네임 · 이메일을 설정합니다. 이메일 항목은 앱 종류에 따라 추가 절차(비즈 앱 전환)가 필요할 수 있습니다.
6. Supabase 「Authentication」 → 「Sign In / Providers」 → 「Kakao」를 켜고 REST API 키(Client ID)와 Client Secret 을 넣습니다.
7. `js/auth-config.js` 의 `"kakao": true`.

## 9. 마지막 확인

- [ ] `verify.sql` 첫 줄: 표 2 · RLS 2 · 정책 3 · 함수 5 · 비로그인 0
- [ ] 사이트 첫 화면에서 「로그인」 창이 열린다
- [ ] 새 이메일로 가입 → 로그인 → 「사용 신청」 화면이 나온다
- [ ] 첫 관리자가 된 뒤 도구가 열리고 「관리」 메뉴가 보인다
- [ ] 다른 이메일로 가입하면 「승인 대기」가 되고, 관리자가 승인하면 열린다
- [ ] `verify.sql` 둘째 결과에 방금 가입한 사람들이 보인다

## 자주 나는 문제

| 보이는 것 | 원인 | 고치는 법 |
|---|---|---|
| `Invalid API key` | 키를 일부만 복사했거나 다른 프로젝트의 키 | 5번에서 anon public 키를 끝까지 다시 복사 |
| 로그인 · 메일 확인 뒤 엉뚱한 주소로 감 | 4번의 Redirect URLs 가 빠짐 | 내 사이트 주소 두 줄(끝 `/` 와 `/**`)을 등록 |
| 가입했는데 확인 메일이 안 옴 | 기본 메일 발송 한도 | 3번의 Confirm email 을 끄거나 잠시 뒤 다시 |
| `relation "public.data1001_members" does not exist` | `auth.sql` 을 실행하지 않았거나 `prefix` 를 바꿈 | 2번을 다시, `prefix` 는 `data1001` 그대로 |
| 가입했는데 계속 「승인 대기」 | 관리자가 아직 승인하지 않음 | 관리자가 「관리」에서 승인. 관리자가 없으면 7번 |
| 「첫 관리자 되기」가 안 보임 | 이미 관리자가 있음 | `verify.sql` 둘째 결과에서 관리자가 누구인지 확인 |
| 고쳤는데 그대로임 | 브라우저가 옛 파일을 쓰는 중 | Ctrl+F5, 그래도 같으면 판을 올림(`docs/내_깃허브로_옮기기.md` 4번) |
| 며칠 뒤 로그인이 안 됨 | 무료 프로젝트가 멈춤 | 대시보드에서 「Restore project」 |

## 지금 열려 있는 주소는

과정 중에 쓰던 주소는 과정용 Supabase 프로젝트에 연결돼 있습니다. 내 프로젝트로 옮기면 구성원은 새로 가입하고 승인합니다(업무 자료는 브라우저에 있으므로 「설정 → 백업」으로 옮깁니다).
