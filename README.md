# Hindsight — 판단 일지

결정을 내릴 때 **검증 가능한 예측과 확신도(%)** 를 기록하고, 검토 날짜에 결과를 입력하면
**적중률 · Brier 점수 · 보정(calibration) 분석**으로 내 판단이 얼마나 정확한지 보여주는 웹 서비스입니다.

## 핵심 기능
- 이메일/비밀번호 가입·로그인 (scrypt 해시, httpOnly 세션 쿠키, 사용자별 데이터 격리)
- 결정 기록(제목·배경·예측·확신도 1–99%·검토 날짜), 수정, 삭제
- 검토 시점이 도래한 결정 표시, 결과(적중/빗나감)와 배운 점 기록, 진행 중으로 되돌리기
- 통계: 적중률, Brier 점수, 과신/보수 경향, 확신도 구간별 적중률
- 모바일 대응 반응형 UI, 입력 검증·네트워크/서버 오류 표시

## 기술 스택
Next.js 15 (App Router) · React 19 · TypeScript · SQLite(Node 내장 `node:sqlite`) · Zod · Vitest

## 구조
```
src/lib/{db,auth,decisions,scoring,http}.ts   데이터/비즈니스 로직
src/app/api/**                                REST API (route handlers)
src/app/{page,login}, src/components/Dashboard.tsx   UI
tests/core.test.ts                            단위 테스트
scripts/smoke.mjs                             HTTP 통합 테스트
```

## 실행
요구: Node.js ≥ 22.13 (`node:sqlite` 사용)
```bash
npm install
cp .env.example .env.local   # 선택
npm run dev                  # http://localhost:3000
```

## 환경변수
| 이름 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_PATH` | `./data/hindsight.db` | SQLite 파일 경로 |

## 테스트
```bash
npm run typecheck
npm test                                  # 단위 테스트
npm run build && DATABASE_PATH=/tmp/t.db npx next start -p 3100 &
BASE=http://localhost:3100 node scripts/smoke.mjs   # API 통합 테스트
```

## API
| Method | Path | 설명 |
|---|---|---|
| POST | /api/auth/register, /login, /logout | 인증 |
| GET/POST | /api/decisions | 목록 / 생성 |
| GET/PATCH/DELETE | /api/decisions/:id | 조회 / 수정·결과 기록 / 삭제 |
| GET | /api/stats | 통계 |

## 배포
영구 디스크가 있는 Node 호스트(Render, Fly.io, VPS 등)에서 `npm run build && npm start`, `DATABASE_PATH`를 영구 볼륨에 지정하세요.
SQLite 파일을 쓰므로 파일시스템이 휘발성인 서버리스(Vercel 등)에는 그대로 맞지 않습니다. 자세한 내용은 `docs/DEPLOYMENT.md`.

## 한계
- 비밀번호 재설정, 이메일 인증, 로그인 시도 제한은 미구현
- 브라우저 E2E(Playwright) 자동화 테스트는 없음 (UI 흐름은 수동 확인)
