# Azure TEST API

The Express 5 and Socket.IO service is designed to bind only to `127.0.0.1:3000`. IIS publishes it at `https://test.infobase-dev.com/live-edits`.

Create `.env` from `.env.example`, install with `npm ci --omit=dev`, and initialize with `npm run init-db`. The production installer and scheduled task are under `../deployment/windows/`.

API routes are mounted at `/api/v1`. The unauthenticated local health route is `/healthz`. Editor and administrator Bearer tokens have separate permissions. Production startup fails if authentication is disabled, tokens are short or equal, CORS origins are absent, or required deployment values are missing.

See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
