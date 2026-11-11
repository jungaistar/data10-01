-- ════════════════════════════════════════════════════════════════════
-- data10-01 — 연결 확인(읽기만 합니다. 아무것도 만들거나 고치지 않습니다)
-- auth.sql 을 실행한 뒤 SQL Editor 에 붙여 넣고 Run. 결과 한 줄의 값이 README 의 「기대하는 값」과 같으면 됩니다.
-- ════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'data1001\_%' escape '\')            as "표(2)",
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'data1001\_%' escape '\' and rowsecurity) as "RLS 켜진 표(2)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'data1001\_%' escape '\')          as "정책(3)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'data1001\_%' escape '\')                                          as "함수(5)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'data1001\_%' escape '\'
       and has_function_privilege('anon', p.oid, 'execute'))                                                       as "비로그인이 부를 수 있는 함수(0)",
  (select count(*) from public.data1001_members)                                                                      as "구성원 수",
  (select count(*) from public.data1001_members where status = 'active' and 'admin' = any(roles))                     as "관리자 수(1 이상이면 준비 끝)";

-- 구성원 목록(누가 대기 · 사용 · 중지인지)
select name, org, email, status, roles, requested_at, approved_at
  from public.data1001_members
 order by requested_at;
