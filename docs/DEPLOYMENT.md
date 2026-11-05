# Deployment
**Status: NOT DEPLOYED.** No deploy-platform credentials exist in this environment, and creating hosting resources needs the owner's account (and paid disk for persistence), so none was attempted.
Verified locally: `npm start` serves the app, `/api/health` returns ok, data survives restart.
## Options
- **Render:** connect the repo → "Blueprint" picks up `render.yaml` (Docker, 1 GB disk at `/data`; disk needs a paid plan). Set `ACCESS_PASSWORD`.
- **Any Docker host (Fly.io, VPS):** `docker build -t hindsight .` then `docker run -p 3000:3000 -v hindsight-data:/data -e ACCESS_PASSWORD=… hindsight` (image build untested here).
- Without a persistent volume data is lost on redeploy. Put it behind HTTPS since auth is Basic.
CI (`.github/workflows/ci.yml`) runs checks, unit/API tests, E2E and a Docker build on push — not yet observed running on GitHub.
