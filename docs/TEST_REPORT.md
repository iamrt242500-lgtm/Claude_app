# 테스트 결과 (로컬, Node 26.7)
- Type check (`tsc --noEmit`): 통과
- Production build (`next build`): 통과
- 단위 테스트 (Vitest): 7/7 통과 — 점수 계산, CRUD, 사용자 격리, 입력 검증, 통계, 인증
- HTTP 통합 테스트 (`scripts/smoke.mjs`, 프로덕션 서버): 24/24 통과 — 인증, 검증 오류, CRUD, 결과 기록, 통계, 타 사용자 접근 차단, 재로그인 후 영속성, 로그아웃 무효화
- UI 수동 확인(내장 브라우저): 로그인 화면 렌더, 가입 → 대시보드 이동, 결정 생성 후 목록 반영
- 미수행: Playwright E2E 자동화, 모바일 뷰포트 시각 검증, 접근성 감사, 부하 테스트
