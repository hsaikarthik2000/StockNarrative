# StockNarrative AI Prompt History

This is a concise record of the AI-assisted development process for the StockNarrative AI assignment. The implementation was directed and reviewed by the project author. AI assistance was used for code exploration, implementation suggestions, debugging, documentation, and validation. No credentials or private account data were included in prompts.

## Product and Data Direction

1. Build an explainable stock dashboard for an India-focused portfolio.
2. Use downloaded local data for the MVP because Alpha Vantage rate limits made it unsuitable as the only development source.
3. Keep downloaded market and portfolio data under `assets/` and preserve source/license provenance.
4. Use BSE as the default market because the selected archive is BSE-oriented.
5. Do not fabricate OHLC values when the local dataset supplies only daily close and volume.

## Non-AI Dashboard Prompts

6. Tie news counts and articles to the selected ticker and selected time range.
7. Derive deviation events from observed close-to-close changes and preceding volume baselines.
8. Show an explicit no-nearby-news state when the archive has no article in the event window.
9. Add headline-only rule-based sentiment while preserving `Not scored` for unsupported headlines.
10. Add date, close, and volume details to chart hover interactions.
11. Rank three comparable stocks using industry, return, and daily-correlation evidence.
12. Add years to pricing-chart labels and hover dates.
13. Remove the unused Broad Market panel.
14. Add a StockNarrative favicon matching the header brand mark.

## Conversational AI Prompts

15. Implement the smallest conversational AI slice first: Worker -> conversation service -> Workers AI -> streamed response.
16. Keep prompt construction in a conversation service rather than inside the Worker route.
17. Use a system prompt that forbids invented market facts, distinguishes general education from retrieved data, and avoids personalized investment advice.
18. Use Cloudflare Workers AI with a Llama text-generation model and a direct `AI` binding.
19. Stream model output to the frontend and persist recent turns in a Durable Object.
20. Generate two AI follow-up questions only after the main response completes.
21. Stop the visible loader when the main response stream sends `[DONE]`, without waiting for follow-up generation.
22. Render common model Markdown such as bold text, headings, ordered lists, bullets, italics, and inline code.
23. Add assistant auto-scroll, maximize/minimize transitions, themed scrollbars, and rotating branded loading messages.

## Agent and Tool Prompts

24. Define typed boundaries for six capabilities: portfolio fetcher, market data provider, news retriever, predictive cache engine, personalization tool, and recommendation engine.
25. Implement a local MCP-compatible registry before depending on a remote MCP server.
26. Register and validate `market_data.get_quote` using the local D1 BSE dataset.
27. Add `news.search` and create a multi-step market-plus-news event path.
28. Add `portfolio.get_summary` and use only the authorized imported portfolio snapshot.
29. Add `personalization.get_profile` and treat unknown risk preferences as unknown rather than inferring them.
30. Add `cache.get_prediction` as a read-only cache capability; keep writes server-controlled.
31. Add `recommendations.find_related` with deterministic industry evidence and no return or suitability claims.
32. Route omitted tickers from recent Durable Object history so follow-up questions such as `I asked why` retain the active instrument.
33. Give verified tool evidence priority over stale fallback conversation turns.
34. Preserve exact portfolio decimal strings and prevent model-generated digit regrouping.
35. Explicitly state that the assistant never handles credentials, passwords, API keys, payment details, or sensitive account data.

## Reliability and Validation Prompts

36. Add one bounded retry for transient Workers AI stream failures.
37. Add request ID, mode, tool list, model, latency, and response-size telemetry without logging raw user messages.
38. Verify market, market-plus-news, portfolio, recommendation, and MCP discovery paths with live local Worker requests.
39. Run backend tests, backend/frontend typechecks, frontend production builds, and Wrangler dry-runs after substantive changes.
40. Maintain a separate [AI_TEST_PROMPTS.md](AI_TEST_PROMPTS.md) suite covering educational questions, memory, tools, safety, failures, and UI behavior.

## Current Architecture Decisions

- Conversational AI and agentic responsibilities remain separate.
- Durable Objects hold recent active conversation turns.
- D1 is the source of truth for imported portfolio and local market metadata.
- KV is used for bounded non-authoritative caching.
- The local MCP registry is intentionally an internal compatibility layer, not a claim of remote MCP deployment.
- Vectorize is deferred until semantic news retrieval or opted-in user embeddings become a demonstrated requirement.
- Portfolio values are treated as an imported snapshot, not a live brokerage account.
- Archived BSE data is always labeled delayed/end-of-day.

## Validation Snapshot

- Backend test suite: 15 tests passing.
- Backend and frontend TypeScript checks: passing after the latest validated changes.
- Frontend production build: passing.
- Wrangler local dry-run: passing with AI, D1, KV, and Durable Object bindings.
- Live local checks: streamed general conversation, market quote agent, market/news agent, portfolio agent, recommendation agent, and MCP tool discovery.

## Disclosure

This file is a concise development index, not a fabricated replacement for the original conversation transcript.