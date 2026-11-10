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
    "summary": "프레스의 전압 · 전류 · 진동 · 온도 2초 센서 값을 ±3σ 관리도 · 온도 3구간으로 실시간 관리해 정상 / 이상 상태를 보고, 정비 · 고장 이력으로 라벨을 붙여 머신러닝 학습용 데이터셋을 만드는 예지보전 도구입니다.",
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
        "name": "머신러닝 · 라벨링",
        "desc": "정비 · 고장 이력으로 2초 센서 값에 정상 · 이상 · 제외 라벨을 붙이고, 구간을 골라 고치고, 학습용 CSV 로 내려받습니다."
      },
      {
        "name": "실시간 연결",
        "desc": "시뮬레이터 · HTTP 주소 · WebSocket 으로 값을 받아 관리도를 다시 그리고 경보를 바로 띄웁니다."
      }
    ],
    "steps": [
      "로그인 · 승인",
      "로그 넣기",
      "정리 · 타수 계산",
      "관리선 판정",
      "이력 맞춰 보기",
      "라벨링"
    ],
    "landing": {
      "colors": {
        "navy": "#002554",
        "navy2": "#001a3d",
        "brand": "#003087",
        "brandDark": "#002554",
        "accent": "#5fe35f"
      }
    }
  }
};
