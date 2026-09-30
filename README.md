# StockNarrative AI

StockNarrative AI is an explainable market-intelligence application for an India-focused stock portfolio. It combines archived BSE market data, archived news, portfolio context, deterministic analytics, Cloudflare Workers AI, Durable Object conversation memory, and a local MCP-compatible tool registry.

The product is deliberately evidence-first: it reports what the data shows, labels historical freshness, distinguishes correlation from causation, and does not present relevance scores as investment advice or probabilities.

## Interview Assignment Mapping

The assignment asks for an AI-powered Cloudflare application with an LLM, workflow/coordination, user input, and memory/state.

| Requirement | Implementation |
| --- | --- |
| LLM | Cloudflare Workers AI using `@cf/meta/llama-3.1-8b-instruct-fp8` through the Worker `AI` binding. |
| Workflow/coordination | Cloudflare Worker routing, deterministic intent selection, multi-step market/news orchestration, and a local MCP-compatible registry. |
| User input | React chat UI with text input, browser SpeechRecognition voice input, streamed responses, and generated follow-up questions. |
| Memory/state | `StockSessionDO` stores the latest 40 turns, representing 20 user/assistant exchanges per conversation. |
| Persistent data | D1 stores instruments, portfolio snapshots, positions, local daily prices, and archived news metadata. |
| Derived cache | KV stores bounded non-authoritative cached values, with private portfolio answers excluded from shared cache design. |

## Architecture

```text
User
	|
	v
Cloudflare Pages React UI
	|
	| POST /api/v1/chat, streamed text/event-stream
	v
Cloudflare Worker
	|
	+--> StockSessionDO: recent conversation turns
	|
	+--> Intent router
	|      |
	|      +--> ConversationService --> Workers AI
	|      |
	|      +--> Local MCP Registry
	|             |
	|             +--> market_data.get_quote --> D1 BSE data
	|             +--> news.search -----------> D1 archived headlines
	|             +--> portfolio.get_summary -> D1 imported snapshot
	|             +--> personalization.get_profile -> D1 preferences
	|             +--> cache.get_prediction -> KV
	|             +--> recommendations.find_related -> D1 evidence
	|
	+--> structured telemetry: request ID, mode, tools, latency, response size
```

The registry is intentionally described as **MCP-compatible**, not as a remote MCP server. It provides tool discovery, input schemas, validation, and structured tool calls behind a small internal boundary. A remote MCP transport can replace the registry later without changing the tool contracts.

## Repository Structure

```text
frontend/
	React + TypeScript + Vite dashboard
	src/App.tsx              UI, chat state, chart, portfolio and analytics views
	src/lib/api.ts           API calls and streamed chat parsing
	src/styles.css           responsive dashboard and assistant UI

backend/
	src/index.ts             Hono Worker routes and streaming response transport
	src/ai/conversation/     prompt construction and Workers AI conversation service
	src/ai/agent/            deterministic agent routing and tool-context assembly
	src/mcp/                 local MCP-compatible registry
	src/tools/               six typed tool contracts and implementations
	src/market/              Alpha Vantage adapters retained as an alternate provider
	src/news/                headline-only rule-based sentiment
	src/portfolio/           CSV parsing and validation
	migrations/              D1 schema
	test/                    backend regression tests

packages/shared/
	Zod schemas and shared TypeScript API contracts

assets/
	BSE dataset archive and extracted CSV/JSON files
	portfolio CSV snapshot
	data-source and licensing notes
```

## Conversation Flow

### General questions

1. The frontend creates or reuses a conversation ID.
2. The Worker loads recent turns from `StockSessionDO`.
3. `ConversationService` constructs the system prompt and recent context.
4. Workers AI streams the answer to the browser.
5. The completed user and assistant turns are written back to the Durable Object.
6. A second short Workers AI call produces two follow-up questions after the main response.

The UI clears its loading state when the primary model stream sends `[DONE]`; follow-up generation does not keep the main response loader visible.

### Tool-required questions

The first agent version uses deterministic routing instead of allowing an unbounded model planner to call arbitrary tools. This makes the behavior inspectable and safe for the interview prototype.

- Market wording such as “latest price” or “volume” routes to `market_data.get_quote`.
- Event wording such as “why did it move” routes through quote retrieval, derives a five-day window, calls `news.search`, and then asks Workers AI to synthesize the evidence.
- Portfolio wording such as “my current portfolio” or “sector allocation” routes to portfolio and personalization tools.
- Recommendation wording routes to `recommendations.find_related`.
- Omitted symbols can be recovered from recent Durable Object history for follow-up questions such as `I asked why`.

When verified tool evidence exists, it is placed immediately before the active user turn and explicitly takes priority over stale fallback conversation text.

## Six Tool Capabilities

### 1. Portfolio Fetcher

`portfolio.get_summary` reads the authorized imported snapshot from D1. It returns positions, quantities, cost basis, current snapshot values, P&L, totals, and snapshot freshness.

The public interview deployment uses an explicitly labeled demo snapshot. It is not a live brokerage connection and does not expose credentials, passwords, API keys, payment data, or account secrets.

### 2. Market Data Provider

`market_data.get_quote` reads BSE daily close and volume from D1 in the current demo environment. The response includes:

- Instrument identity and exchange
- Close price and currency
- Close-to-close change
- Change percentage
- Volume
- Trading date
- Source and delayed/end-of-day provenance

The Alpha Vantage adapter remains available as an alternate provider, but Alpha Vantage is disabled in the public demo deployment.

### 3. News Retriever

`news.search` retrieves archived BSE headline metadata from D1 for a validated symbol and ISO date window. It returns title, source, URL, publication time, and headline-only rule-based sentiment where available.

The system reports no nearby coverage when the archive has no matching article. It never claims that a headline caused a price move.

### 4. Predictive Cache Engine

`cache.get_prediction` is a read-only KV lookup for versioned, non-personalized derived results. Cache entries include a key, expiration, and model version. The model cannot write arbitrary predictions into shared KV, and cached relevance data is never represented as a forecast or probability.

### 5. Personalization Tool

`personalization.get_profile` reads authorized communication style, watchlist, and risk-profile preferences from D1. Unknown risk is preserved as `unknown`; the system does not infer a user’s suitability profile from portfolio holdings.

### 6. Recommendation Engine

`recommendations.find_related` returns explainable related instruments using deterministic industry evidence in the current implementation. It returns reasons and a method version. Its score represents relevance only, not expected return, safety, probability, or suitability.

## Cloudflare Components

### Workers AI

The Worker binds Cloudflare Workers AI directly through `AI` in `backend/wrangler.toml`. The conversation service uses a Llama 3.1 8B instruction model with streaming, constrained temperature, and bounded output tokens. The assignment recommends Llama 3.3, but permits other LLM choices; the model can be changed through the service boundary.

### Durable Objects

`StockSessionDO` is authoritative for active conversation turns. It stores a bounded rolling list and serializes access per session. The Worker uses a local demo session identity today; production authentication is a remaining hardening step.

### D1

D1 stores normalized, queryable metadata and demo data:

- Users and preferences
- Portfolio snapshots and positions
- Instruments and exchange metadata
- Daily close/volume rows
- Archived news metadata
- Market event and alert schema foundations

Raw credentials and provider secrets are not stored in D1.

### KV

KV is used for bounded, non-authoritative caching. It is not treated as a lock or source of truth. User-specific portfolio/chat results are not placed in shared cache keys.

## Data Provenance and Limitations

The public demo uses the downloaded BSE-oriented archive documented in [assets/DATA_SOURCES.md](assets/DATA_SOURCES.md):

- 99 mapped BSE instruments
- 24,416 daily close/volume rows
- 333 linked archived news records
- Historical coverage through 2023-05-26
- Daily close and volume only; no fabricated OHLC values
- Headline metadata only; no full article text or source sentiment labels

The public data is explicitly labeled as delayed/end-of-day demo data. The portfolio CSV is an imported snapshot rather than a live account.

## Safety and Privacy Decisions

The system prompt and UI explicitly state that the assistant never handles credentials or sensitive account data. It does not request or reveal passwords, API keys, broker credentials, payment information, or other account secrets.

Additional grounding rules include:

- Do not fabricate current prices or financial facts.
- Do not call archived data live.
- Do not claim a headline caused a move.
- Do not turn recommendation relevance into investment advice.
- Do not expose private portfolio data through shared caches or telemetry.
- Do not present uncalibrated forecasts or probabilities.

## UI Implementation

The assistant UI includes:

- Text chat and browser speech-to-text input
- Streamed response rendering
- Markdown-style formatting for model output
- Automatic scroll to the newest generated content
- Two AI-generated follow-up buttons after the primary response
- Branded rotating generation statuses
- Maximize/minimize transitions
- Accessible labels and status regions
- Reduced-motion support
- Collision-proof UUID message IDs so streamed responses cannot attach to the wrong question

## Deployment

The public interview deployment is currently available at:

- Frontend: [https://stocknarrative.pages.dev](https://stocknarrative.pages.dev)
- Worker: `https://stocknarrative-api-production.equity-radar.workers.dev`

Production configuration uses:

- `PUBLIC_DEMO_MODE=true`
- `DEMO_SEED_ENABLED=false` after one-time seeding
- `MARKET_DATA_SOURCE=local`
- `ALPHA_VANTAGE` disabled
- CORS restricted to the Pages origin
- Production D1 and KV resources
- Workers AI and Durable Object bindings

The import/seed endpoints were enabled only for the one-time demo seed and then disabled. This is a public interview demo, not an authenticated brokerage application. A real production deployment would require authentication, tenant isolation, and an authorized user identity before exposing portfolio data.

## Validation

The project has been validated with:

```powershell
corepack pnpm --dir backend test
corepack pnpm --dir backend exec wrangler deploy --dry-run --env production
corepack pnpm --dir frontend build
```

The backend suite currently contains 15 passing tests. Live smoke checks have covered:

- General streamed conversation
- Durable Object conversation memory
- Market quote agent
- Market/news event agent
- Portfolio and personalization agent
- Recommendation agent
- MCP tool discovery
- Public Worker health, portfolio, and chat routes
- Public Pages deployment

## Documentation and Submission Artifacts

- [AI_TEST_PROMPTS.md](AI_TEST_PROMPTS.md): extensive manual/regression prompt suite
- [PROMPT_HISTORY.md](PROMPT_HISTORY.md): concise, truthful AI-assisted development record
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md): Cloudflare deployment decisions and commands
- [backend/API_CONTRACT.md](backend/API_CONTRACT.md): target API and architecture contract
- [backend/ADVANCED_AI_DECISIONS.md](backend/ADVANCED_AI_DECISIONS.md): Vectorize and advanced-AI decisions
- [assets/DATA_SOURCES.md](assets/DATA_SOURCES.md): dataset provenance and limitations

## Known Limitations

- Routing is deterministic and pattern-based rather than full model-native tool calling.
- The MCP registry is local and MCP-compatible, not a remote MCP server.
- Production demo mode is public and intentionally not a substitute for authentication.
- The BSE archive is historical, not live market data.
- No trading execution, broker integration, notifications, calibrated forecasting, or Vectorize retrieval is enabled.
- The public demo should be deleted or disabled after the interview if it is no longer needed.