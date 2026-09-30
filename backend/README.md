# Cloudflare Worker Backend

The local backend provides a health route, local D1 portfolio and market-data paths, archived news retrieval, Workers AI conversation streaming, `StockSessionDO` rolling-turn state, a local MCP-compatible tool registry, market/news/portfolio/recommendation agent routes, and a tested rolling anomaly detector.

## Local Setup

From the workspace root:

```powershell
corepack pnpm install
corepack pnpm --dir backend db:migrate:local
```

Keep your existing Alpha Vantage value in the root `.dev.vars` as `ALPHA_VANTAGE_API_KEY=...`. The backend `dev` script loads that file without printing its contents and binds Wrangler to `127.0.0.1:8787`.

Start the Worker in one terminal:

```powershell
corepack pnpm --dir backend dev
```

Import the provided local CSV once, in a second terminal:

```powershell
corepack pnpm --dir backend import:portfolio
```

The importer reads `assets/portfolio_Data.csv.txt` by default and sends its contents only to the localhost Worker. It prints aggregate totals, not individual position rows. Re-running creates a new historical snapshot. The CSV and `.dev.vars` are excluded by the root `.gitignore`.

Start Vite in another terminal:

```powershell
corepack pnpm --dir frontend dev
```

Vite proxies `/api/*` to the local Worker. `GET /api/v1/me/portfolio` feeds the portfolio panel. `GET /api/v1/instruments/{symbol}/quote` checks the local KV cache before calling Alpha Vantage. `GET /api/v1/health` verifies the Worker is up.

## Storage Boundaries

- D1 holds user/profile metadata, instruments, watchlist rows, portfolio snapshots/positions, market-event metadata, alerts, and notification delivery records.
- The CSV import is a local-development-only route. Portfolio reads return `401` outside the explicitly enabled local environment until authentication is implemented.
- A temporary public interview demo may set `PUBLIC_DEMO_MODE=true`; this exposes only the seeded demo snapshot and chat path, never credentials or the CSV import route.
- KV holds only non-personalized quote payloads (`v1:market:quote:{symbol}`) for 60 seconds. No portfolio positions, user chat, or secrets are cached there.
- Durable Object storage retains at most 40 messages (20 user/assistant exchanges) per local test session.
- No remote D1 database, KV namespace, Vectorize index, queue, or Worker deployment has been created. Wrangler IDs in `wrangler.toml` are local placeholders; replace them with resources created in your Cloudflare account before remote deployment.

## Routes and Current Limits

- `GET /api/v1/health`: local Worker health.
- `GET /api/v1/me/portfolio`: latest imported local CSV snapshot; production currently requires authentication and returns `401`.
- `POST /api/v1/dev/portfolio/import`: validated CSV import, available only when `ENVIRONMENT=development` and `LOCAL_DEV_IMPORT_ENABLED=true`.
- `GET /api/v1/instruments/{symbol}/quote`: Alpha Vantage global quote with KV caching. Exchange/provider symbol mapping and INR quote support still need to be added before relying on Indian-market quotes.
- `POST /api/v1/dev/sessions/{sessionId}/turns`: local Durable Object smoke-test route.
- `POST /api/v1/chat`: local Workers AI conversation and agent route with streamed responses.
- `GET /api/v1/dev/mcp/tools`: local MCP-compatible tool catalogue.

The anomaly detector currently accepts normalized, completed bars as a pure service and is covered by unit tests. Provider history retrieval, anomaly event persistence/scheduling, and queue-backed notification dispatch are not wired yet.

The portfolio CSV has no capture timestamp, so its LTP values are shown as imported snapshot values, not current live quotes. No model-generated forecast is shown because the forecast service is not implemented or calibrated.

Run checks with:

```powershell
corepack pnpm --dir backend test
corepack pnpm --dir backend build
```

See [API_CONTRACT.md](API_CONTRACT.md) for the complete target API, architecture, model pipeline, notification design, and remaining integration work.