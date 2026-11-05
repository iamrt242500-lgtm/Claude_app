# 배포 상태
**실제 배포는 수행되지 않았습니다.** 작업 환경에 배포 CLI(vercel/wrangler/netlify)와 계정 인증이 없고, 유료/외부 리소스 생성은 사용자 승인이 필요합니다.
로컬 프로덕션 빌드(`next build` + `next start`)에서 통합 테스트를 통과했습니다.
권장: 영구 볼륨이 있는 Node 호스트에 `npm run build && npm start`, `DATABASE_PATH`를 볼륨 경로로 설정. CI는 `.github/workflows/ci.yml`.
