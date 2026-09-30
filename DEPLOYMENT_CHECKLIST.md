# Cloudflare Deployment Checklist

## Required Decisions

Before creating production resources, confirm:

1. **Deployment mode**
   - Private interview demo with authentication, or
   - Public demo with deliberately limited non-personal data.

2. **Portfolio data policy**
   - Deploy the imported demo portfolio snapshot, or
   - Keep portfolio access local/private until authentication is added.

3. **Frontend hosting**
   - Cloudflare Pages project, or
   - Another static host with the Worker URL configured as the API origin.

4. **Market provider**
   - Keep the local BSE archive as the deployed demo source, or
   - Configure Alpha Vantage for an alternate provider path.

## Information Needed From the Project Owner

- Desired production Pages project name.
- Desired public hostname, if using a custom domain.
- Whether the demo portfolio snapshot may be deployed.
- Whether the submission should be private or publicly accessible.
- Alpha Vantage API key only if the remote provider path is enabled. Never commit it.

No credentials should be placed in the repository or prompt history.

## Discover the Cloudflare Account

After authenticating with Wrangler:

```powershell
corepack pnpm --dir backend exec wrangler whoami
```

Record the account ID shown by Wrangler. Do not commit personal access tokens.

## Create Production Resources

Run these only after choosing the production names and account:

```powershell
corepack pnpm --dir backend exec wrangler d1 create stocknarrative-db
corepack pnpm --dir backend exec wrangler kv namespace create CACHE
```

Copy the returned D1 database ID and KV namespace ID into a production Wrangler environment. Keep the local placeholder IDs unchanged for local development.

Apply migrations to the production database only after reviewing the target account:

```powershell
corepack pnpm --dir backend exec wrangler d1 migrations apply stocknarrative-db --env production --remote
```

## Production Configuration Gaps

The current local routes intentionally reject unauthenticated production portfolio access. Before public deployment, implement one of:

- Cloudflare Access or an application authentication layer with a verified user ID.
- A read-only demo mode that never exposes personal portfolio data.

The local portfolio importer also sends data only to localhost. A production seed/import process must be designed explicitly rather than exposing the development import route.

## Secrets and Variables

If Alpha Vantage is enabled in production:

```powershell
corepack pnpm --dir backend exec wrangler secret put ALPHA_VANTAGE_API_KEY --env production
```

Configure production variables for:

- `ENVIRONMENT=production`
- `MARKET_DATA_SOURCE=local` or `alphavantage`
- `CORS_ORIGIN=<Pages origin>`
- `LOCAL_DEV_IMPORT_ENABLED=false`

Workers AI, D1, KV, and Durable Object bindings must be present in the production Wrangler environment. Verify with a dry-run before deployment.

## Deployment Order

1. Decide authentication and portfolio-data policy.
2. Create production D1 and KV resources.
3. Add production Wrangler bindings and variables.
4. Apply D1 migrations.
5. Seed only approved non-sensitive demo data, if applicable.
6. Deploy the Worker with a dry-run first.
7. Deploy the frontend to Pages.
8. Set the frontend API origin and CORS origin.
9. Run health, chat, MCP discovery, market, news, and safety smoke tests.
10. Submit the application with [PROMPT_HISTORY.md](PROMPT_HISTORY.md) and [AI_TEST_PROMPTS.md](AI_TEST_PROMPTS.md).