// 로그인 설정 — 이 파일 한 곳만 바꾸면 된다(생성: data10-00/scripts/apply-auth-kit.mjs, 대문 문구 출처 docs/plan.json).
// 내 Supabase 로 옮길 때: url · anonKey 를 내 프로젝트 값으로, 카카오를 설정하지 않았으면 kakao: false. 안내 = docs/내_깃허브로_옮기기.md
// prefix 는 supabase/auth.sql 의 표 이름 앞부분과 같아야 한다.
window.AUTH_CONFIG = {
  "url": "https://hcmgdztsgjvzcyxyayaj.supabase.co",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw",
  "prefix": "data1001",
  "kakao": true,
  "idleMinutes": 30,
  "localBypass": true,
  "site": {
    "title": "프레스 예지보전",
    "summary": "프레스 로그와 2초 센서 값을 넣으면 ±3σ 관리도 · 온도 3구간으로 이상을 잡고, 금형 교체 · 오버홀 시기와 월별 타수 보고서까지 만드는 예지보전 도구입니다.",
    "course": "현장 데이터 디지털화 전문가과정 · 2차수",
    "features": [
      {
        "name": "실시간 관리도",
        "desc": "2초 센서 값의 전류 · 전압 · 진동을 ±3σ 관리선으로, 온도는 예열 · 안정 · 위험 3구간으로 그립니다."
      },
      {
        "name": "고장 전 이탈",
        "desc": "고장 · 정비 이력과 경보를 맞춰 고장 몇 시간 전에 경보가 울렸는지 리드타임을 잽니다."
      },
      {
        "name": "금형 · 오버홀 알림",
        "desc": "금형 수명 사용률과 교체 예정일, 오버홀 주기를 넘긴 프레스를 알립니다."
      },
      {
        "name": "월별 타수 보고서",
        "desc": "프레스 종류별 · 프레스별 · 금형별 월 타수를 엑셀과 인쇄용으로 냅니다."
      }
    ],
    "steps": [
      "로그인 · 승인",
      "로그 넣기",
      "정리 · 타수 계산",
      "관리선 판정",
      "이력 맞춰 보기",
      "금형 · 오버홀"
    ]
  }
};
