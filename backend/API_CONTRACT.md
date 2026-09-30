# StockNarrative Frontend/Backend API Contract

Status: proposed contract for replacing the frontend's local demo fixtures. The current frontend is not connected to these endpoints. Keep the API behind a Cloudflare Worker and keep every provider credential on the server.

## 0. Target Architecture

This contract follows the intended edge-native design. The existing workspace has `frontend/` and `backend/` at its root; the `packages/` layout below is the desired pnpm-workspace end state and is not a claim about the current files.

```text
stock-tracker-bot/
├── package.json
├── pnpm-workspace.yaml
└── packages/
    ├── shared/
    │   └── src/                 # API types/schemas and MCP tool input/output schemas
    ├── frontend/
    │   └── src/                 # React SPA, components, hooks, Pages entry
    └── backend/
        ├── wrangler.toml        # Worker, D1, KV, Vectorize, DO, Queue bindings
        └── src/
            ├── index.ts         # Worker API gateway
            ├── durable-objects/ # StockSessionDO
            ├── adapters/        # Alpha Vantage, Finnhub, Twilio, FCM
            ├── mcp/             # Tool registry and tool wrappers
            ├── db/              # D1 schema, migrations, queries
            ├── services/        # Anomaly, narrative, embedding/recommendation
            └── utils/           # Retry, PII scrubbing, validation
```

| Component | Cloudflare/service choice | Responsibility |
| --- | --- | --- |
| Frontend | React SPA on Cloudflare Pages | Dashboard, assistant, alert preferences |
| API | Cloudflare Workers | HTTPS API gateway, JWT validation, rate limits, PII scrubber, routing |
| Stateful session | `StockSessionDO` Durable Object | Per-session state, last 20 turns, WebSocket coordination, serialized session work |
| User data | D1 | Profiles/preferences, portfolios/positions, watchlists, alert thresholds, anomaly log metadata |
| Transient cache | KV | TTL-cached quotes, daily summaries, and non-user-specific computed analysis |
| Similarity | Vectorize | News-theme and risk-profile embedding retrieval for explainable recommendations |
| Agent | Workers AI, configured Llama 3 70B Instruct where available | Multi-step intent reasoning and MCP tool selection |
| Dialogue | Workers AI, configured Llama 3 8B Instruct where available | Low-latency answer generation and streaming |
| Providers | Alpha Vantage, Finnhub | Market/news adapter inputs; normalize before caching/analysis |
| Notifications | Queues plus Twilio and FCM | Background SMS/WhatsApp and Web Push dispatch |

Configure model IDs through Worker environment bindings and pin supported catalog IDs per deployment. Confirm model availability, context limits, quotas, and regional behavior before rollout; do not assume a model alias or latency is universal. Treat “under 200 ms” as a time-to-first-token p95 objective for the dialogue path, not a guaranteed full-answer or 70B reasoning SLA. Measure it separately from provider/MCP latency and use a documented fallback when budgets are exceeded.

### Demand-driven cache defaults

| Data | Initial TTL | Notes |
| --- | ---: | --- |
| Live quote | 60 seconds | Include provider `asOf`, stale status, and schema version in cached value |
| Daily summary / computed symbol analysis | 1 hour | Cache only symbol-level, non-personalized outputs in shared keys |
| News groups | 5 minutes initially | Key by instrument and exact resolved time window; tune against provider update cadence |
| Portfolio/personalized analysis | No shared KV cache | If cached at all, use a user-scoped, permission-checked key and a short explicit TTL |

KV is an eventually consistent cache, not the source of truth or a lock. Cache misses/failures fall back to provider adapters with bounded retries and jitter. Add single-flight/coalescing for expensive hot-key misses (for example through a dedicated Durable Object or queue) rather than assuming KV prevents duplicate upstream calls. Do not persist raw multi-year tick/candle history in D1; fetch it on demand, cache briefly where terms allow, and persist only computed event/anomaly metadata.

## 1. Contract Conventions

- Base URL: `/api/v1` (local Vite proxy in development; deployed Worker URL in production).
- Transport: HTTPS, UTF-8 JSON for ordinary routes; `text/event-stream` for streamed assistant responses; WebSocket only for explicitly negotiated live session/alert updates.
- Dates: ISO-8601 UTC strings, e.g. `2026-09-18T14:15:00Z`. Date-only filters are inclusive calendar dates in the user's configured timezone; return the resolved UTC boundaries.
- Money: `{ amount, currency }`, decimal string amount to avoid floating-point currency errors. Do not encode formatted `$` strings in API values.
- Percentages: numeric percentage points (`6.4` means `6.4%`). Probabilities and sentiment scores are decimals in `[0,1]` unless a field explicitly says `percent`.
- Symbols: uppercase provider-independent ticker plus stable `instrumentId`, exchange, and currency. Do not assume ticker alone is globally unique.
- Null means unknown/not supplied. Do not use zero for unavailable data.
- All list endpoints return pagination metadata, even when the current response fits on one page.
- All market/news/model responses include `asOf`, `isDelayed`, and provenance metadata. UI must display stale/delayed status.
- All protected routes require an authenticated user. Do not accept a `userId` query/body field as authorization.
- Scrub sensitive user text before any model call. Never place provider credentials, raw account secrets, or unsanitized PII in model context, KV, telemetry, or shared caches.

### Standard error response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "to must be on or after from",
    "requestId": "req_01J...",
    "details": [{ "field": "to", "issue": "before_from" }],
    "retryable": false
  }
}
```

Use appropriate HTTP status codes: `400` invalid input, `401` unauthenticated, `403` forbidden, `404` missing resource, `409` conflict, `429` rate limit, `502` provider failure, `503` temporarily unavailable. Never return stack traces, tokens, provider secrets, raw account identifiers, or unredacted PII.

## 2. Endpoints

### 2.1 Current user and preferences

`GET /me`

Returns display-safe identity, locale/timezone, base currency, tone, personalization preferences, and entitlements. Tone defaults to `formal`. Example:

```json
{
  "user": {
    "id": "usr_123",
    "displayName": "Jordan D.",
    "locale": "en-US",
    "timeZone": "Asia/Kolkata",
    "baseCurrency": "USD",
    "preferences": {
      "assistantTone": "formal",
      "industries": ["Semiconductors", "Cloud & software"],
      "riskProfile": "moderate"
    }
  }
}
```

The frontend should use these values instead of hard-coded profile, Bengaluru context, or currency assumptions. Do not return sensitive authentication credentials.

### 2.2 Market overview / pulse

`GET /market/pulse`

Response:

```json
{
  "asOf": "2026-09-30T14:30:00Z",
  "isDelayed": true,
  "indices": [
    { "symbol": "SPX", "name": "S&P 500", "price": { "amount": "5842.47", "currency": "USD" }, "changePercent": 0.82 },
    { "symbol": "IXIC", "name": "NASDAQ Composite", "price": { "amount": "18421.09", "currency": "USD" }, "changePercent": 1.14 },
    { "symbol": "VIX", "name": "CBOE Volatility Index", "price": { "amount": "16.24", "currency": "USD" }, "changePercent": -2.31 }
  ],
  "source": { "provider": "market-adapter", "retrievedAt": "2026-09-30T14:30:02Z" }
}
```

### 2.3 Watchlist

`GET /me/watchlist`

Returns ordered instruments with a latest quote summary. `POST /me/watchlist` adds one symbol; `DELETE /me/watchlist/{instrumentId}` removes it; `PATCH /me/watchlist/order` accepts `{ "instrumentIds": ["ins_1", "ins_2"] }`.

POST body:

```json
{ "symbol": "AMD", "exchange": "NASDAQ" }
```

Response is the created watchlist item and normalized instrument. Enforce uniqueness per user/instrument and return `409 ALREADY_WATCHLISTED` or an idempotent success consistently. The frontend's plus/check action maps to POST/DELETE.

### 2.4 Portfolio and positions

`GET /me/portfolio?currency=USD`

Response:

```json
{
  "portfolioId": "prt_123",
  "baseCurrency": "USD",
  "asOf": "2026-09-30T14:30:00Z",
  "totals": {
    "investedValue": { "amount": "12920.00", "currency": "USD" },
    "currentValue": { "amount": "14767.00", "currency": "USD" },
    "unrealizedPnl": { "amount": "1847.00", "currency": "USD" },
    "dayChange": { "amount": "1246.80", "currency": "USD" }
  },
  "positions": [
    {
      "instrument": { "instrumentId": "ins_nvda", "symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ", "industry": "Semiconductors", "currency": "USD" },
      "quantity": "24",
      "averageCost": { "amount": "110.00", "currency": "USD" },
      "investedValue": { "amount": "2640.00", "currency": "USD" },
      "quote": { "price": { "amount": "138.25", "currency": "USD" }, "changePercent": 4.82, "asOf": "2026-09-30T14:30:00Z", "isDelayed": true },
      "currentValue": { "amount": "3318.00", "currency": "USD" },
      "unrealizedPnl": { "amount": "678.00", "currency": "USD" },
      "weightPercent": 22.47
    }
  ]
}
```

Do not store or return a predicted probability as if it were an objective account fact. Forecasts are separate, explicitly modeled resources (section 2.9). The current demo's units/costs/returns must be replaced with real user-authorized data; never infer or fabricate positions.

Local implementation note: the supplied CSV is imported into a D1 portfolio snapshot and its `LTP` is returned as `quote.source = "portfolio_csv"`, with `quote.asOf = null` because the file contains no market-price timestamp. The snapshot's `asOf` is only the import time and must not be presented as the quote time. By user selection, local Indian CSV imports default to BSE: `exchange = "BSE"`, `currency = "INR"`, and `alpha_vantage_symbol = "{symbol}.BSE"`. This is a configured default, not exchange inference; change the mapping if the actual position is NSE-listed. Keep CSV cost basis/P&L separate from live market closes until quantities and basis have been reconciled for splits and other corporate actions. The CSV import/read routes are local-development-only until authenticated ownership is implemented.

### 2.5 Instrument lookup and quote

`GET /instruments/search?q=...&limit=10`

Returns matching symbols with stable IDs, name, exchange, currency, and industry. Search is used by the global search/watchlist add action.

`GET /instruments/{instrumentId}/quote`

```json
{
  "instrument": { "instrumentId": "ins_nvda", "symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ", "currency": "USD", "industry": "Semiconductors" },
  "quote": {
    "price": { "amount": "138.25", "currency": "USD" },
    "change": { "amount": "6.35", "currency": "USD" },
    "changePercent": 4.82,
    "volume": 48200000,
    "marketCap": { "amount": "3400000000000", "currency": "USD" },
    "dayRange": { "low": "132.40", "high": "139.10" },
    "asOf": "2026-09-30T14:30:00Z",
    "tradingDate": "2026-09-30",
    "isDelayed": true
  },
  "source": { "provider": "market-adapter", "retrievedAt": "2026-09-30T14:30:02Z" }
}
```

The current Alpha Vantage adapter caches successful, non-personalized quotes in KV according to entitlement (EOD six hours, delayed 15 minutes, realtime 60 seconds). A symbol imported from the portfolio without an explicit `alpha_vantage_symbol` mapping returns `409 PROVIDER_SYMBOL_NOT_CONFIGURED`. Indian exchange suffixes such as `.BSE` and `.NSE` use INR.

`GET /instruments/{instrumentId}/series?from=...&to=...&interval=5m`

Returns ordered OHLCV bars and server-detected annotations. Each bar: `time`, `open`, `high`, `low`, `close`, `volume`. Use this for the price-action chart and historical event detection; do not fabricate chart points from a static SVG.

### 2.6 Similar-stock recommendations

`GET /instruments/{instrumentId}/recommendations?limit=5`

Response:

```json
{
  "basedOn": "ins_nvda",
  "generatedAt": "2026-09-30T14:30:03Z",
  "methodVersion": "rules-v1",
  "items": [
    {
      "instrument": { "instrumentId": "ins_amd", "symbol": "AMD", "name": "Advanced Micro Devices", "exchange": "NASDAQ", "industry": "Semiconductors", "currency": "USD" },
      "matchScore": 0.94,
      "reasons": ["same industry", "AI accelerator exposure", "shared data-center demand"],
      "quote": { "price": { "amount": "164.42", "currency": "USD" }, "changePercent": 2.14, "asOf": "2026-09-30T14:30:00Z" },
      "isInWatchlist": false
    }
  ]
}
```

The frontend should render only when a stock is selected, open it in the closeable related-stocks popover, and call the watchlist POST endpoint for “Add”. Backend recommendation logic may start with explicit rules (industry, supply-chain tags, shared revenue/market drivers); return reasons and a method version so the match score is explainable. Do not call the score a probability.

The target recommendation pipeline also uses Workers AI embeddings and Vectorize: embed normalized news themes and an opt-in user risk/interest profile, query by cosine similarity, then combine retrieval matches with deterministic industry/supply-chain rules. Return the match evidence and `methodVersion`; never expose raw private profile text in a shared vector record. Establish consent, namespace/tenant isolation, vector metadata filters, deletion behavior, and embedding model/version before indexing user-specific vectors. Vector similarity is relevance, not expected return or suitability.

### 2.7 Narrative synthesis

`GET /instruments/{instrumentId}/narrative?asOf=...`

Response:

```json
{
  "instrumentId": "ins_nvda",
  "generatedAt": "2026-09-30T14:30:04Z",
  "headline": "AI demand is pulling the supply chain higher",
  "summary": "...",
  "sentiment": { "label": "strongly_bullish", "score": 0.82, "confidence": 0.91 },
  "sourceConfidence": 0.96,
  "sourceCount": 24,
  "drivers": [
    { "id": "drv_1", "title": "Cloud capex guidance climbs", "detail": "...", "direction": "positive", "impact": "high", "evidenceArticleIds": ["art_1", "art_2"] }
  ],
  "risks": [{ "title": "Export policy uncertainty", "detail": "...", "direction": "negative", "evidenceArticleIds": ["art_3"] }],
  "disclaimer": "AI-generated market context, not investment advice.",
  "model": { "name": "market-narrative", "version": "2026-09-01" }
}
```

The chat briefing and narrative tab must be driven from this same response, so the assistant does not invent a second conflicting story. Store article IDs as evidence and let the UI navigate to the source group.

### 2.8 Grouped news / coverage

`GET /api/v1/instruments/{symbol}/news?from=2026-09-29T00:00:00Z&to=2026-09-30T23:59:59Z&limit=50`

The UI converts its quick ranges (`6h`, `24h`, `7d`, `30d`) to explicit UTC timestamps. The route accepts windows up to 90 days and limits from 1 to 100; it normalizes and caps the result count even if the provider returns more items than requested. Successful non-personalized results are cached in KV for five minutes. Imported portfolio instruments without an `alpha_vantage_symbol` mapping return `409 PROVIDER_SYMBOL_NOT_CONFIGURED`. For mapped Indian holdings, market history/quotes use the exchange-qualified provider symbol (for example `BAJFINANCE.BSE`), while `NEWS_SENTIMENT` uses the base company ticker.

The current provider adapter uses Alpha Vantage `NEWS_SENTIMENT` (`tickers`, `time_from`, `time_to`, `sort=LATEST`, `limit`). Sentiment and ticker relevance are provider-supplied fields. Alpha Vantage does not provide a calibrated source credibility score in this response, so none is returned or inferred.

For the MVP, `MARKET_DATA_SOURCE=local` reads the downloaded BSE CC0 corpus from D1 and makes no market/news provider requests. `assets/DATA_SOURCES.md` records its source, license, and coverage. The local price file contains daily close and volume only; API bars therefore return `open`, `high`, and `low` as `null`, and the UI draws a close-only line rather than candles. Local corporate-news entries expose headline, publisher domain, date, and source link; sentiment and aggregate sentiment are `null`, not inferred. When local news dates are omitted, the route anchors the default 30-day window to the latest archived item for that instrument.

```json
{
  "instrument": { "instrumentId": "symbol_nvda", "symbol": "NVDA", "name": "NVDA", "exchange": null, "isin": null, "industry": null, "currency": "USD" },
  "range": { "from": "2026-09-29T00:00:00.000Z", "to": "2026-09-30T23:59:00.000Z" },
  "articleCount": 1,
  "aggregateSentiment": { "score": 0.42, "label": "positive" },
  "articles": [
    {
      "articleId": "art_example",
      "title": "Example publisher headline",
      "url": "https://publisher.example/article",
      "publishedAt": "2026-09-30T14:12:00.000Z",
      "source": "Example publisher",
      "sourceDomain": "publisher.example",
      "summary": "Provider-supplied short summary.",
      "topics": [{ "topic": "Technology", "relevance": 0.8 }],
      "overallSentiment": { "label": "Somewhat-Bullish", "score": 0.42 },
      "tickerSentiment": { "label": "Bullish", "score": 0.61, "relevance": 0.9 }
    }
  ],
  "source": { "provider": "Alpha Vantage News & Sentiment", "retrievedAt": "2026-09-30T14:30:00.000Z" },
  "cache": "miss"
}
```

The frontend groups returned articles by their highest-relevance provider topic. Results are capped rather than cursor-paginated in this local implementation. Show the headline, provider-supplied summary, source link, timestamp, sentiment, and ticker relevance; do not publish full article text or represent sentiment/relevance as source credibility. Follow Alpha Vantage/provider terms for attribution and summaries.

### 2.9 Advanced analytics: event scenarios and correlation

`GET /instruments/{instrumentId}/events?from=2026-09-01&to=2026-09-30&thresholdPercent=5&direction=both&limit=100`

The service computes events from timestamped normalized OHLCV data, not from mock news. Document calculation semantics. Recommended initial rule: compare close to prior close for daily bars, or bar close to immediately preceding bar for intraday bars; emit when absolute return is at least the requested threshold. Deduplicate overlapping bars into one event with a defined cooldown/merge rule. Include the interval and rule version in the response.

The configured anomaly engine evaluates price and volume independently against the preceding `N = 30` completed periods. For each series `X`, use the population baseline `mu = sum(X_i)/N`, `sigma = sqrt(sum((X_i - mu)^2)/N)`, and `Z = (X_current - mu)/sigma`. Trigger when `abs(Z_price) >= 2.5` or `Z_volume >= 3.0`. Define the bar interval per market/session, exclude the current incomplete bar from the baseline, require a documented warm-up policy, and treat `sigma = 0` as “score unavailable” rather than dividing by zero. Record `zPrice`, `zVolume`, baseline period, bar interval, rule version, trigger reason, event timestamp, and idempotency key in D1 anomaly metadata. This anomaly rule can coexist with the user-selected absolute-return threshold; return which rule triggered each event.

```json
{
  "instrumentId": "ins_nvda",
  "query": { "from": "2026-09-01", "to": "2026-09-30", "thresholdPercent": 5, "barInterval": "1d", "ruleVersion": "return-threshold-v1" },
  "events": [
    {
      "eventId": "evt_0918",
      "occurredAt": "2026-09-18T20:00:00Z",
      "direction": "up",
      "returnPercent": 6.4,
      "priceBefore": { "amount": "129.94", "currency": "USD" },
      "priceAfter": { "amount": "138.25", "currency": "USD" },
      "volumeMultiple": 1.8,
      "trigger": "absolute_return_threshold",
      "ruleVersion": "return-threshold-v1"
    }
  ],
  "asOf": "2026-09-30T14:30:00Z"
}
```

`GET /events/{eventId}/correlation?beforeDays=5&afterDays=5&timeZone=Asia/Kolkata`

Response includes event, resolved inclusive UTC window, price bars, grouped news, per-article evidence, and a narrative explaining leads/lags without claiming causation:

```json
{
  "event": { "eventId": "evt_0918", "instrumentId": "ins_nvda", "occurredAt": "2026-09-18T20:00:00Z", "returnPercent": 6.4 },
  "window": { "from": "2026-09-13T00:00:00Z", "to": "2026-09-24T00:00:00Z", "beforeDays": 5, "afterDays": 5, "timeZone": "Asia/Kolkata" },
  "newsGroups": [{ "groupId": "grp_capex", "title": "Cloud infrastructure guidance rises", "sentimentScore": 0.78, "articleIds": ["art_1"] }],
  "narrative": { "summary": "...", "supportingSignals": ["..."], "counterSignals": ["..."], "limitations": ["Temporal association does not establish causation"] },
  "provenance": { "priceProvider": "...", "newsProviders": ["..."], "modelVersion": "..." },
  "generatedAt": "2026-09-30T14:30:00Z"
}
```

The date range controls the event search. The user selects one returned event; the selected event, not a hard-coded date, drives the ±5-day correlation request. Reject negative windows and cap window sizes server-side.

### 2.10 Forecast/projection

`GET /instruments/{instrumentId}/forecast?horizon=12m`

Response must be scenario-based, include methodology and uncertainty, and never promise a price:

```json
{
  "instrumentId": "ins_nvda",
  "generatedAt": "2026-09-30T14:30:04Z",
  "horizon": "12m",
  "currency": "USD",
  "scenarios": {
    "bear": { "price": "119.00", "returnPercent": -13.9, "probability": 0.25 },
    "base": { "price": "151.00", "returnPercent": 9.2, "probability": 0.50 },
    "bull": { "price": "181.00", "returnPercent": 31.0, "probability": 0.25 }
  },
  "confidence": 0.58,
  "drivers": ["..."],
  "risks": ["..."],
  "model": { "name": "...", "version": "...", "calibratedThrough": "2026-06-30" },
  "disclaimer": "Probabilistic scenario, not a guaranteed target or investment advice."
}
```

Scenario probabilities must total 1 (within a documented tolerance); projected values should be currency-consistent and auditable. Do not label model confidence as the probability of making a profit. Provide a backtest/calibration note before presenting forecasts as decision support.

### 2.11 Conversational assistant

`POST /assistant/sessions` creates a session and returns `{ "sessionId": "...", "createdAt": "..." }`.

`POST /assistant/sessions/{sessionId}/messages`

Request:

```json
{
  "message": "Explain the selected event and news published around it",
  "context": {
    "instrumentId": "ins_nvda",
    "eventId": "evt_0918",
    "portfolioId": "prt_123",
    "locale": "en-US"
  },
  "clientMessageId": "msg_client_123"
}
```

Response:

```json
{
  "messageId": "msg_server_456",
  "sessionId": "ses_123",
  "answer": "...",
  "createdAt": "2026-09-30T14:31:00Z",
  "citations": [{ "articleId": "art_1", "title": "...", "sourceName": "Bloomberg", "url": "https://publisher.example/article" }],
  "usedContext": { "instrumentId": "ins_nvda", "eventId": "evt_0918", "narrativeGeneratedAt": "2026-09-30T14:30:04Z" },
  "disclaimer": "..."
}
```

Persist the active session and its most recent 20 conversational turns (up to 20 user/assistant exchanges) in `StockSessionDO`, keyed by an authenticated opaque session ID. Do not trust a client-supplied user ID to select another user's object. D1 may retain only explicitly required audit/retention metadata; it is not the authoritative transcript store unless the product adds a separately consented history feature. Enforce message/context limits, rate-limit, redact sensitive data, and return citations to backend-owned article IDs. Deduplicate retries by `clientMessageId`. Use the same narrative/news/portfolio/event services as the visible UI.

The agentic path invokes the configured Llama 3 70B Instruct model for complex intents, tool selection, and multi-step MCP planning. MCP tools return schema-validated normalized data; do not send provider-specific responses or arbitrary tool output straight to the dialogue model. The dialogue path supplies the validated results, narrative, user-selected tone (formal by default), and citations to the configured Llama 3 8B Instruct model. Stream answer tokens from the Worker to the browser while keeping all model credentials server-side. Maintain separate timing/usage budgets for planner, tool calls, and dialogue generation.

Recommended SSE response events are `meta`, `delta`, `citation`, `complete`, and `error`, each with a JSON `data:` payload. `meta` includes request/session IDs and model versions; `delta` includes text and sequence number; `citation` includes the article ID; `complete` includes final message ID, usage, and disclaimer. Send heartbeat comments for long tool calls; abort model/tool work when the client disconnects where supported. Provide a JSON mode only through explicit content negotiation or a separate non-stream endpoint.

Voice input: the existing browser `SpeechRecognition` control produces text and sends it through the same message endpoint; no audio endpoint is required initially. If server transcription is later needed, add `POST /assistant/transcriptions` multipart audio, explicit retention/consent policy, allowed format/duration limits, and return `{ transcript, language, durationMs }`.

### Internal MCP tool registry

The Worker exposes an MCP registry to the agent internally; do not make a generic “run arbitrary tool” endpoint public. Each tool has a stable name, JSON input schema, JSON output schema, permission check, timeout, and audit metadata. Initial tool set: `market.quote`, `market.history`, `market.searchNews`, `portfolio.getSummary`, `portfolio.getPositions`, `personalization.getPreferences`, `recommendations.findRelated`, `analytics.detectEvents`, `analytics.correlateEventNews`, and `cache.prefetchSymbol`. Portfolio tools must enforce authenticated ownership and return only the minimum context needed. MCP errors use stable codes (`INVALID_ARGUMENT`, `PERMISSION_DENIED`, `UPSTREAM_RATE_LIMIT`, `UPSTREAM_UNAVAILABLE`, `TIMEOUT`) and never include secrets.

### 2.12 Alerts (next phase)

`GET/POST/PATCH/DELETE /me/alerts` should manage user-owned threshold and notification preferences. Each alert includes instrument, condition, threshold, enabled state, channels, quiet hours/time zone, created/updated time, and last delivery status. Define delivery consent, event deduplication, retries, and delivery status before enabling notifications.

The anomaly/threshold producer writes an idempotent event and enqueues a notification job. A queue consumer checks the user's active alert preferences and dispatches urgent SMS/WhatsApp through Twilio and Web Push through Firebase Cloud Messaging (FCM). Keep provider tokens and secrets in Worker secrets; never in Pages/Vite variables. Store delivery attempts/status and provider message IDs, but redact destination addresses in logs. Retry transient errors with bounded exponential backoff and jitter; dead-letter permanent/exhausted jobs and expose a user-safe status.

### Realtime session transport

Use `StockSessionDO` for authenticated WebSocket upgrade at `/api/v1/assistant/sessions/{sessionId}/connect` only when realtime interaction is needed. Validate the JWT and session ownership before forwarding the socket to the Durable Object. Messages are typed JSON envelopes (`client_message`, `cancel`, `ping`; server `delta`, `citation`, `complete`, `error`, `alert`). The existing UI can initially use SSE for assistant tokens and ordinary HTTP polling for dashboard data; WebSocket is for two-way session updates, not required for every quote read. Enforce payload/frame limits, idle timeout, origin allowlist, connection caps, and explicit reconnect/backoff behavior.

## 3. Cloudflare Backend Responsibilities

- **Worker (`backend/src/index.ts`)**: API gateway/router, JWT authentication middleware, schema validation, PII scrubbing before model calls, rate limits, CORS allowlist, error normalization, request IDs, response headers, and MCP agent orchestration.
- **Adapters**: normalized quote, historical-bar and news-provider interfaces; retries with bounded exponential backoff/jitter; provider timeout and quota handling; provenance and stale data flags.
- **D1**: user profiles/preferences including tone, portfolios/positions, watchlists, alert thresholds, anomaly logs, instrument metadata, article metadata/clusters, and model-run metadata. Do not store raw high-frequency history or the authoritative last-20 chat turns here. Add indexes for user/instrument/time and event/article joins. Use migrations.
- **KV**: use the TTL table in section 0 for quote/pulse/news/symbol-analysis cache keys. Include schema version/provider timestamp; exclude user-specific portfolio/chat outputs from shared keys. KV is eventually consistent and never authoritative.
- **Durable Objects**: deploy the named `StockSessionDO` as a required session primitive. It owns per-session coordination and the rolling last-20-turn context, serializes concurrent messages, and coordinates WebSocket/SSE cancellation. Keep durable session data minimal; apply expiry/retention and user deletion rules. Do not use one globally hot object for market data.
- **Vectorize + Workers AI embeddings**: index normalized news-theme embeddings and opted-in preference/risk embeddings using explicit tenant metadata filters and a pinned embedding model. Provide deletion/reindex procedures; validate retrieved metadata before it enters prompts.
- **Queues/Cron/Workflows**: schedule/demand-refresh market/news data, compute rolling anomalies, and enqueue alert dispatch. Use idempotency keys, bounded concurrency, provider quota budgets, backoff, and dead-letter handling; don't make the browser responsible for these jobs.
- **Workers AI / model adapters**: separately configure the Llama 3 70B agentic planner and Llama 3 8B dialogue model where supported. The planner calls only registered MCP tools; the dialogue model receives normalized, schema-validated results and streams a grounded response. Track model IDs/versions, tokens, latency, budget, and fallback. Validate structured output; model output is untrusted and must retain article evidence IDs.
- **Anomaly service**: calculate rolling 30-period population Z-scores from normalized market bars; use `abs(Z_price) >= 2.5` or `Z_volume >= 3.0`, handle warm-up/zero variance explicitly, persist only event/anomaly metadata in D1, and enqueue dispatch work.
- **Secrets/config**: `wrangler secret put` for provider/API/auth secrets. Public frontend variables may contain only the API base URL and public analytics identifiers.
- **Observability**: structured logs with request ID, route, provider, model version, latency split by planner/MCP/dialogue, cache hit/miss/stale result, retry count and queue delivery; redact user prompts/PII by default. Add error, latency, quota and dead-letter alerts.

Suggested initial D1 entities: `users`, `user_preferences`, `instruments`, `watchlist_items`, `portfolios`, `positions`, `news_articles`, `news_clusters`, `market_events`, `anomaly_logs`, `event_news_links`, `alerts`, `notification_deliveries`, and `model_runs`. Durable Object storage is authoritative for active session turns. Store provider payloads only where terms permit and retain normalized, minimal fields.

## 4. Frontend Integration Plan

1. As a separate workspace migration, move the existing root `frontend/` and `backend/` into `packages/frontend/` and `packages/backend/`, add root `package.json` + `pnpm-workspace.yaml`, and keep the Pages and Worker deploy pipelines independently buildable. Do not move files until workspace scripts and deployment roots are updated together.
2. Add `packages/frontend/src/lib/api.ts`: typed `fetch` wrapper, API base URL, auth credentials, abort signals, standard error parser, and request ID logging. Never put provider API keys here.
3. Add shared request/response and MCP schemas in `packages/shared/src/`; consume them from both `packages/frontend` and `packages/backend`. Validate responses at runtime before they enter UI state.
4. Replace fixtures in `packages/frontend/src/App.tsx` incrementally (currently `frontend/src/App.tsx`):
   - `stocks`, `stockUniverse`, `portfolioHoldings`, `portfolioValue` -> watchlist, instrument search, portfolio endpoints.
   - quote panel and `MarketChart` -> quote and OHLCV series endpoints.
   - `relatedIndustries`/`suggestedStocks` -> recommendations endpoint.
   - narrative driver literals and assistant briefing -> narrative endpoint.
   - `groupedNews`/`coverageCounts` -> paginated grouped news endpoint; map quick ranges to timestamps.
   - `analyticsEvents`/`eventWindowNews` -> event list and selected-event correlation endpoints.
   - projected range literals -> forecast endpoint.
   - `sendMessage` timeout/mock branches -> assistant session/message endpoint; preserve citations and errors in transcript.
   - `mcpEvents` -> real sanitized activity/health endpoint only if exposing tool traces to end users is approved.
5. Fetch initial user, portfolio, watchlist, and market pulse concurrently. Fetch quote/narrative/news/recommendations when a symbol is selected. Fetch event correlation only after the user selects an event. Abort stale symbol requests when selection changes.
6. Use loading, empty, stale, offline, permission, provider-error, and retry states. Do not continue to show mock numbers after a live request fails; visibly label fallback demo mode if one is intentionally provided.
7. Add pagination/infinite loading for news and event lists. Debounce symbol search. Keep all date filtering in ISO; display dates in the user's time zone.
8. Render API `currency`, `asOf`, `isDelayed`, source attribution, confidence methodology/version, and disclaimers. Do not infer missing values or convert decimal scores without an explicit field definition.
9. Add integration tests with mocked Worker responses for success, empty, unauthorized, rate-limited, stale, and provider failure cases. Add contract tests on the Worker to ensure response fixtures conform to the shared schemas.

## 5. Acceptance Checklist Before Removing Demo Mode

- Authenticated users only see their own portfolio, watchlist, assistant history, and alerts.
- Quotes and all history timestamps identify currency, exchange, provider timestamp, and delay status.
- Portfolio totals equal the returned positions after documented FX/rounding rules.
- Event threshold calculation, deduplication/cooldown, date inclusivity and timezone boundaries are tested.
- Event news query returns the exact configured before/after window and marks publication time relative to the event; correlation narrative says association, not causation.
- Grouped news total counts match returned pagination metadata; source scores have documented calibration and provenance.
- Forecast probabilities sum to 1, horizons are explicit, and calibration/uncertainty/disclaimer are visible.
- Chat answers cite retrieved source IDs and do not fabricate portfolio values or unsupported live facts.
- Provider outages, quotas, stale caches, rate limits and retries produce stable, actionable API errors.
- No secrets or sensitive user details are exposed in frontend bundles or logs.
