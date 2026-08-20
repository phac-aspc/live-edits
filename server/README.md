# Azure TEST API

The Express and Socket.IO service binds only to `127.0.0.1:3000`. IIS publishes it at `https://test.infobase-dev.com/live-edits`.

Production keeps `AUTH_MODE=token` so administrative routes always require `ADMIN_TOKEN`. `EDITOR_AUTH_MODE=network` allows reviewer routes without a shared token but requires a self-reported name and valid email on every HTTP and realtime connection. `EDITOR_AUTH_MODE=token` remains available for rollback.

Create `.env` from `.env.example`, install with `npm ci --omit=dev`, and initialize with `npm run init-db`. Production startup rejects disabled authentication, short administrator secrets, non-loopback binding, non-HTTPS public configuration, and inexact CORS origins.

See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) and [../docs/SECURITY.md](../docs/SECURITY.md).
