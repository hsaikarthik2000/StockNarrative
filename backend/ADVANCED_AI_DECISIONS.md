# Advanced AI Decisions

## Current Decision

The first production-shaped AI slice uses Workers AI, Durable Objects, D1, KV, and a local MCP-compatible registry. The six tool boundaries are implemented, while the market and archived-news tools are active in the event workflow.

## Vectorize

Vectorize is deferred. The current dataset has a small archived headline corpus and no user-consented interest or risk embeddings. Adding a vector index now would create tenant isolation, deletion, model-version, and reindexing obligations without improving the current questions the product can answer.

Reconsider Vectorize when the product needs semantic retrieval across a materially larger news corpus or an explicitly opted-in personalization profile. At that point, define the embedding model, namespace, metadata filters, deletion path, and retrieval evaluation before indexing user data.

## Predictive Cache

The KV predictive-cache adapter is available for derived, non-personalized outputs with an explicit expiration and model version. It must not be used to cache portfolio-specific answers in shared keys, and it does not represent a forecast or probability of return.

## Recommendations

Recommendations currently use deterministic industry and historical evidence with a method version. Scores are relevance signals, not suitability, expected return, or investment advice. Workers AI should not turn these scores into unsupported predictions.

## Revisit Criteria

- Semantic news retrieval becomes a demonstrated product requirement.
- Users opt in to persistent risk or interest preferences.
- Recommendation relevance can be evaluated against labeled outcomes.
- A calibrated forecasting dataset and review process exist before showing projections.