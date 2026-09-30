import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { DailyBar, Instrument, NewsArticle, PortfolioResponse, SimilarStocksResponse } from '@stocknarrative/shared';
import { z } from 'zod';
import { LOCAL_PORTFOLIO_ID, LOCAL_USER_ID, type WorkerEnv } from './env';
import { currencyForProviderSymbol, fetchAlphaVantageDailySeries, fetchAlphaVantageQuote, type QuoteEntitlement } from './market/alpha-vantage';
import { fetchAlphaVantageNews } from './market/alpha-vantage-news';
import { scoreNewsHeadline } from './news/sentiment';
import { parsePortfolioCsv, type PortfolioCsvRow } from './portfolio/csv';
import { streamConversation } from './ai/conversation/ConversationService';
import type { ConversationRequest, ConversationTurn } from './ai/conversation/types';
import { routeEventRequest, routeMarketRequest, routePortfolioRequest, routeRecommendationRequest } from './ai/agent/AgentService';
import { LocalMcpRegistry } from './mcp/LocalMcpRegistry';

const app = new Hono<{ Bindings: WorkerEnv }>();

const localTurnSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

const conversationRequestSchema = z.object({
  conversationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  message: z.string().trim().min(1).max(4000),
  symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/).optional(),
  style: z.enum(['formal', 'concise', 'conversational']).optional(),
});

app.use('/api/*', async (context, next) => {
  const allowedOrigin = context.env.CORS_ORIGIN ?? 'http://localhost:5173';
  return cors({ origin: allowedOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] })(context, next);
});

app.get('/api/v1/health', (context) => context.json({
  status: 'ok',
  service: 'stocknarrative-api',
  environment: context.env.ENVIRONMENT ?? 'production',
  checkedAt: new Date().toISOString(),
}));

app.get('/api/v1/dev/mcp/tools', (context) => {
  if (!isLocalDevelopment(context.env)) return context.json({ error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false } }, 404);
  return context.json({ protocol: 'local-mcp-compatible', tools: new LocalMcpRegistry(context.env).listTools() });
});

app.post('/api/v1/chat', async (context) => {
  if (!isDemoAccess(context.env)) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Chat requires an authenticated user.', retryable: false } }, 401);
  const parsed = conversationRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: { code: 'INVALID_CHAT_REQUEST', message: 'A valid conversation ID and message are required.', retryable: false } }, 400);

  const request: ConversationRequest = parsed.data;
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const objectId = context.env.STOCK_SESSION.idFromName(`${LOCAL_USER_ID}:${request.conversationId}`);
  const session = context.env.STOCK_SESSION.get(objectId);
  const historyResponse = await session.fetch('https://stock-session/turns');
  const historyPayload = await historyResponse.json() as { turns?: ConversationTurn[] };
  const history = historyPayload.turns ?? [];
  await session.fetch('https://stock-session/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', content: request.message }),
  });

  try {
    const portfolioResult = await routePortfolioRequest(context.env, request, history);
    const recommendationResult = portfolioResult ? null : await routeRecommendationRequest(context.env, request, history);
    const eventResult = portfolioResult || recommendationResult ? null : await routeEventRequest(context.env, request, history);
    const marketResult = portfolioResult || recommendationResult || eventResult ? null : await routeMarketRequest(context.env, request, history);
    const result = portfolioResult ?? recommendationResult ?? eventResult ?? marketResult ?? await streamConversation(context.env, request, history);
    const mode = portfolioResult ? 'agent-portfolio' : recommendationResult ? 'agent-recommendations' : eventResult ? 'agent-market-news' : marketResult ? 'agent-market-data' : 'conversation';
    const tools = portfolioResult ? ['portfolio.get_summary', 'personalization.get_profile'] : recommendationResult ? ['recommendations.find_related'] : eventResult ? ['market_data.get_quote', 'news.search'] : marketResult ? ['market_data.get_quote'] : [];
    context.executionCtx.waitUntil(result.completion.then(async (content) => {
      console.log(JSON.stringify({ event: 'ai_request_complete', requestId, conversationId: request.conversationId, mode, model: '@cf/meta/llama-3.1-8b-instruct-fp8', tools, latencyMs: Date.now() - startedAt, responseChars: content.length }));
      if (!content) return;
      await session.fetch('https://stock-session/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'assistant', content }),
      });
    }));
    const responseStream = appendFollowUps(result.stream, result.followUps);
    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Conversation-Mode': mode,
        'X-Request-ID': requestId,
        'X-Tools': tools.join(','),
      },
    });
  } catch (error) {
    return context.json({ error: { code: 'AI_UNAVAILABLE', message: error instanceof Error ? error.message : 'The conversation model is unavailable.', retryable: true } }, 503);
  }
});

function appendFollowUps(stream: ReadableStream, followUps: Promise<string[]>): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          controller.enqueue(chunk.value);
        }
        const questions = await followUps;
        if (questions.length) controller.enqueue(encoder.encode(`event: followups\ndata: ${JSON.stringify({ questions })}\n\n`));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

app.get('/api/v1/me/portfolio', async (context) => {
  if (!isDemoAccess(context.env)) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Portfolio access requires an authenticated user.', retryable: false } }, 401);

  const snapshot = await context.env.DB.prepare(
    `SELECT snapshot_id, imported_at, currency
     FROM portfolio_snapshots
     WHERE portfolio_id = ?
     ORDER BY imported_at DESC
     LIMIT 1`,
  ).bind(LOCAL_PORTFOLIO_ID).first<{ snapshot_id: string; imported_at: string; currency: string }>();

  if (!snapshot) return context.json({ error: { code: 'PORTFOLIO_EMPTY', message: 'Import a CSV snapshot to populate the local portfolio.', retryable: false } }, 404);

  const result = await context.env.DB.prepare(
    `SELECT i.instrument_id, i.symbol, i.name, i.exchange, i.isin, i.industry, i.currency,
            p.quantity, p.average_cost, p.last_price, p.invested_value, p.current_value,
            p.unrealized_pnl, p.unrealized_pnl_percent
     FROM positions p
     JOIN instruments i ON i.instrument_id = p.instrument_id
     WHERE p.snapshot_id = ?
     ORDER BY i.symbol`,
  ).bind(snapshot.snapshot_id).all<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    isin: string | null;
    industry: string | null;
    currency: string;
    quantity: number;
    average_cost: number;
    last_price: number;
    invested_value: number;
    current_value: number;
    unrealized_pnl: number;
    unrealized_pnl_percent: number;
  }>();

  const positions = result.results.map((row) => ({
    instrument: {
      instrumentId: row.instrument_id,
      symbol: row.symbol,
      name: row.name,
      exchange: row.exchange,
      isin: row.isin,
      industry: row.industry,
      currency: row.currency,
    } satisfies Instrument,
    quantity: String(row.quantity),
    averageCost: money(row.average_cost, row.currency),
    investedValue: money(row.invested_value, row.currency),
    currentValue: money(row.current_value, row.currency),
    unrealizedPnl: money(row.unrealized_pnl, row.currency),
    unrealizedPnlPercent: row.unrealized_pnl_percent,
    quote: { price: money(row.last_price, row.currency), asOf: null, isDelayed: true, source: 'portfolio_csv' },
  }));

  const totals = positions.reduce((total, position) => ({
    invested: total.invested + Number(position.investedValue.amount),
    current: total.current + Number(position.currentValue.amount),
    pnl: total.pnl + Number(position.unrealizedPnl.amount),
  }), { invested: 0, current: 0, pnl: 0 });

  const response: PortfolioResponse = {
    portfolioId: LOCAL_PORTFOLIO_ID,
    baseCurrency: snapshot.currency,
    asOf: snapshot.imported_at,
    totals: {
      investedValue: money(totals.invested, snapshot.currency),
      currentValue: money(totals.current, snapshot.currency),
      unrealizedPnl: money(totals.pnl, snapshot.currency),
    },
    positions,
  };
  return context.json(response);
});

app.post('/api/v1/dev/portfolio/import', async (context) => {
  if (!isDemoSeedEnabled(context.env)) return context.json({ error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false } }, 404);

  let rows: PortfolioCsvRow[];
  try {
    rows = parsePortfolioCsv(await context.req.text());
  } catch (error) {
    return context.json({ error: { code: 'INVALID_PORTFOLIO_CSV', message: safeError(error), retryable: false } }, 400);
  }

  const importedAt = new Date().toISOString();
  const snapshotId = crypto.randomUUID();
  const statements = [
    context.env.DB.prepare('INSERT OR IGNORE INTO users (user_id, display_name, base_currency) VALUES (?, ?, ?)').bind(LOCAL_USER_ID, 'Local portfolio', 'INR'),
    context.env.DB.prepare('INSERT OR IGNORE INTO user_preferences (user_id, assistant_tone) VALUES (?, ?)').bind(LOCAL_USER_ID, 'formal'),
    context.env.DB.prepare('INSERT OR IGNORE INTO portfolios (portfolio_id, user_id, name, base_currency) VALUES (?, ?, ?, ?)').bind(LOCAL_PORTFOLIO_ID, LOCAL_USER_ID, 'Imported portfolio', 'INR'),
    context.env.DB.prepare('INSERT INTO portfolio_snapshots (snapshot_id, portfolio_id, source, imported_at, currency, row_count) VALUES (?, ?, ?, ?, ?, ?)').bind(snapshotId, LOCAL_PORTFOLIO_ID, 'local_csv_import', importedAt, 'INR', rows.length),
  ];

  for (const row of rows) statements.push(...portfolioInsertStatements(context.env.DB, snapshotId, row));
  await context.env.DB.batch(statements);

  return context.json({
    snapshotId,
    importedAt,
    rowCount: rows.length,
    totals: rows.reduce((total, row) => ({
      investedValue: total.investedValue + row['Invested Amount (₹)'],
      currentValue: total.currentValue + row['Current Value (₹)'],
      unrealizedPnl: total.unrealizedPnl + row['P&L (₹)'],
    }), { investedValue: 0, currentValue: 0, unrealizedPnl: 0 }),
    currency: 'INR',
  }, 201);
});

const localMarketDataSchema = z.object({
  source: z.literal('kaggle-bse-cc0'),
  companies: z.array(z.object({
    symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/),
    scripCode: z.string().regex(/^\d+$/),
    name: z.string().trim().min(1).max(200),
    industry: z.string().trim().max(200).nullable(),
  })).max(500),
  bars: z.array(z.object({
    symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/),
    time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    close: z.number().positive(),
    volume: z.number().nonnegative(),
  })).max(50000),
  articles: z.array(z.object({
    articleId: z.string().min(1).max(200),
    symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/),
    title: z.string().trim().min(1).max(500),
    url: z.string().url(),
    sourceName: z.string().trim().min(1).max(200),
    sourceDomain: z.string().trim().min(1).max(200),
    publishedAt: z.string().datetime(),
  })).max(10000),
});

app.post('/api/v1/dev/market-data/import', async (context) => {
  if (!isDemoSeedEnabled(context.env)) return context.json({ error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false } }, 404);
  const parsed = localMarketDataSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: { code: 'INVALID_MARKET_DATA', message: 'Local market-data payload failed validation.', retryable: false } }, 400);

  const existingInstruments = await Promise.all(parsed.data.companies.map((company) => context.env.DB.prepare(
    'SELECT instrument_id FROM instruments WHERE symbol = ? AND exchange = ? LIMIT 1',
  ).bind(company.symbol, 'BSE').first<{ instrument_id: string }>()));
  const instruments = new Map(parsed.data.companies.map((company, index) => [
    company.symbol,
    existingInstruments[index]?.instrument_id ?? `bse_${company.scripCode}`,
  ]));
  if (!instruments.size) return context.json({ error: { code: 'PORTFOLIO_SYMBOLS_NOT_MAPPED', message: 'No imported portfolio instruments matched the BSE dataset.', retryable: false } }, 409);

  const catalogStatements = parsed.data.companies.map((company, index) => {
    const providerSymbol = `${company.symbol}.BSE`;
    if (existingInstruments[index]) {
      return context.env.DB.prepare(
        `UPDATE instruments SET name = ?, exchange = 'BSE', industry = COALESCE(industry, ?), currency = 'INR',
         alpha_vantage_symbol = COALESCE(alpha_vantage_symbol, ?) WHERE instrument_id = ?`,
      ).bind(company.name, company.industry, providerSymbol, existingInstruments[index].instrument_id);
    }
    return context.env.DB.prepare(
      `INSERT OR IGNORE INTO instruments (instrument_id, symbol, name, exchange, isin, industry, currency, alpha_vantage_symbol)
       VALUES (?, ?, ?, 'BSE', NULL, ?, 'INR', ?)`,
     ).bind(instruments.get(company.symbol), company.symbol, company.name, company.industry, providerSymbol);
  });
  for (let offset = 0; offset < catalogStatements.length; offset += 100) {
    await context.env.DB.batch(catalogStatements.slice(offset, offset + 100));
  }

  await context.env.DB.prepare('DELETE FROM local_daily_prices WHERE source = ?').bind(parsed.data.source).run();
  await context.env.DB.prepare('DELETE FROM local_news_articles WHERE source = ?').bind(parsed.data.source).run();
  const statements = [
    ...parsed.data.bars.flatMap((bar) => {
      const instrumentId = instruments.get(bar.symbol);
      return instrumentId ? [context.env.DB.prepare(
        `INSERT INTO local_daily_prices (instrument_id, trading_date, close_price, volume, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(instrument_id, trading_date, source) DO UPDATE SET close_price = excluded.close_price, volume = excluded.volume`,
      ).bind(instrumentId, bar.time, bar.close, bar.volume, parsed.data.source)] : [];
    }),
    ...parsed.data.articles.flatMap((article) => {
      const instrumentId = instruments.get(article.symbol);
      return instrumentId ? [context.env.DB.prepare(
        `INSERT INTO local_news_articles (article_id, instrument_id, title, url, source_name, source_domain, published_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET instrument_id = excluded.instrument_id, title = excluded.title, url = excluded.url,
           source_name = excluded.source_name, source_domain = excluded.source_domain, published_at = excluded.published_at, source = excluded.source`,
      ).bind(article.articleId, instrumentId, article.title, article.url, article.sourceName, article.sourceDomain, article.publishedAt, parsed.data.source)] : [];
    }),
  ];
  for (let offset = 0; offset < statements.length; offset += 100) {
    await context.env.DB.batch(statements.slice(offset, offset + 100));
  }
  return context.json({
    source: parsed.data.source,
    mappedInstrumentCount: instruments.size,
    importedBarCount: parsed.data.bars.filter((bar) => instruments.has(bar.symbol)).length,
    importedArticleCount: parsed.data.articles.filter((article) => instruments.has(article.symbol)).length,
  }, 201);
});

app.get('/api/v1/instruments/:symbol/quote', async (context) => {
  const symbol = context.req.param('symbol').toUpperCase();
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) return context.json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol format is invalid.', retryable: false } }, 400);
  const instrument = await context.env.DB.prepare(
    'SELECT instrument_id, symbol, name, exchange, industry, currency, alpha_vantage_symbol FROM instruments WHERE symbol = ? LIMIT 1',
  ).bind(symbol).first<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    industry: string | null;
    currency: string;
    alpha_vantage_symbol: string | null;
  }>();
  if (instrument && !instrument.alpha_vantage_symbol) {
    return context.json({ error: { code: 'PROVIDER_SYMBOL_NOT_CONFIGURED', message: 'This imported instrument needs a verified Alpha Vantage symbol mapping before a live quote can be requested.', retryable: false } }, 409);
  }
  const providerSymbol = instrument?.alpha_vantage_symbol ?? symbol;
  const currency = instrument?.currency ?? currencyForProviderSymbol(symbol);
  if (context.env.MARKET_DATA_SOURCE === 'local') {
    if (!instrument) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'This symbol is not in the local market dataset.', retryable: false } }, 404);
    const rows = await context.env.DB.prepare(
      'SELECT trading_date, close_price, volume FROM local_daily_prices WHERE instrument_id = ? ORDER BY trading_date DESC LIMIT 2',
    ).bind(instrument.instrument_id).all<{ trading_date: string; close_price: number; volume: number }>();
    if (!rows.results.length) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'No local daily prices are available for this instrument.', retryable: false } }, 404);
    const [latest, previous] = rows.results;
    const change = previous ? latest.close_price - previous.close_price : 0;
    return context.json({
      instrument: { instrumentId: instrument.instrument_id, symbol, name: instrument.name, exchange: instrument.exchange, currency, industry: instrument.industry },
      quote: { price: money(latest.close_price, currency), change: money(change, currency), changePercent: previous ? change / previous.close_price * 100 : 0, volume: latest.volume, marketCap: null, dayRange: null, asOf: null, tradingDate: latest.trading_date, isDelayed: true },
      source: { provider: 'BSE local dataset (CC0)', entitlement: 'eod', retrievedAt: new Date().toISOString() },
      cache: 'miss',
    });
  }
  const entitlement: QuoteEntitlement = context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT === 'realtime' || context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT === 'delayed'
    ? context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT
    : 'eod';
  const cacheKey = `v1:market:quote:${providerSymbol}:${currency}:${entitlement}`;
  const cached = await context.env.CACHE.get<QuoteResponse>(cacheKey, 'json');
  if (cached) return context.json({ ...cached, cache: 'hit' });

  const apiKey = context.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return context.json({ error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Alpha Vantage API key is not configured for this environment.', retryable: false } }, 503);

  try {
    const quote = await fetchAlphaVantageQuote(providerSymbol, apiKey, entitlement);
    const response: QuoteResponse = {
      instrument: {
        instrumentId: instrument?.instrument_id ?? `symbol_${symbol.toLowerCase()}`,
        symbol,
        name: instrument?.name ?? symbol,
        exchange: instrument?.exchange ?? null,
        currency,
        industry: instrument?.industry ?? null,
      },
      quote: {
        price: money(Number(quote.price), currency),
        change: money(Number(quote.change), currency),
        changePercent: quote.changePercent,
        volume: quote.volume,
        marketCap: null,
        dayRange: null,
        asOf: null,
        tradingDate: quote.tradingDay,
        isDelayed: entitlement !== 'realtime',
      },
      source: { provider: 'Alpha Vantage', entitlement, retrievedAt: new Date().toISOString() },
      cache: 'miss',
    };
    const cacheTtl = entitlement === 'realtime' ? 60 : entitlement === 'delayed' ? 900 : 21600;
    await context.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: cacheTtl });
    return context.json(response);
  } catch (error) {
    return context.json({ error: { code: 'QUOTE_PROVIDER_ERROR', message: safeError(error), retryable: true } }, 502);
  }
});

app.get('/api/v1/instruments/:symbol/series', async (context) => {
  const symbol = context.req.param('symbol').toUpperCase();
  const interval = context.req.query('interval') ?? 'daily';
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) return context.json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol format is invalid.', retryable: false } }, 400);
  if (interval !== 'daily') return context.json({ error: { code: 'UNSUPPORTED_INTERVAL', message: 'Only daily history is available with the current Alpha Vantage configuration.', retryable: false } }, 400);

  const instrument = await context.env.DB.prepare(
    'SELECT instrument_id, symbol, name, exchange, industry, currency, alpha_vantage_symbol FROM instruments WHERE symbol = ? LIMIT 1',
  ).bind(symbol).first<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    industry: string | null;
    currency: string;
    alpha_vantage_symbol: string | null;
  }>();
  if (instrument && !instrument.alpha_vantage_symbol) {
    return context.json({ error: { code: 'PROVIDER_SYMBOL_NOT_CONFIGURED', message: 'This imported instrument needs a verified Alpha Vantage symbol mapping before history can be requested.', retryable: false } }, 409);
  }

  const providerSymbol = instrument?.alpha_vantage_symbol ?? symbol;
  const currency = instrument?.currency ?? currencyForProviderSymbol(providerSymbol);
  if (context.env.MARKET_DATA_SOURCE === 'local') {
    if (!instrument) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'This symbol is not in the local market dataset.', retryable: false } }, 404);
    const rows = await context.env.DB.prepare(
      'SELECT trading_date, close_price, volume FROM local_daily_prices WHERE instrument_id = ? ORDER BY trading_date ASC',
    ).bind(instrument.instrument_id).all<{ trading_date: string; close_price: number; volume: number }>();
    if (!rows.results.length) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'No local daily history is available for this instrument.', retryable: false } }, 404);
    const bars = rows.results.map((row) => ({ time: row.trading_date, open: null, high: null, low: null, close: row.close_price, volume: row.volume, complete: true }));
    const latest = rows.results[rows.results.length - 1];
    const previous = rows.results[rows.results.length - 2];
    const change = previous ? latest.close_price - previous.close_price : 0;
    return context.json({
      instrument: { instrumentId: instrument.instrument_id, symbol, name: instrument.name, exchange: instrument.exchange, isin: null, industry: instrument.industry, currency },
      interval: 'daily',
      bars,
      lastBarDate: latest.trading_date,
      latestQuote: { price: money(latest.close_price, currency), change: money(change, currency), changePercent: previous ? change / previous.close_price * 100 : 0, volume: latest.volume, asOf: null, tradingDate: latest.trading_date, isDelayed: true, entitlement: 'eod' },
      source: { provider: 'BSE local dataset (CC0)', entitlement: 'historical_daily', retrievedAt: new Date().toISOString() },
      cache: 'miss',
    });
  }
  const entitlement: QuoteEntitlement = context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT === 'realtime' || context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT === 'delayed'
    ? context.env.ALPHA_VANTAGE_MARKET_ENTITLEMENT
    : 'eod';
  const cacheKey = `v1:market:series:daily:${providerSymbol}:${currency}:${entitlement}`;
  const cached = await context.env.CACHE.get<DailySeriesResponse>(cacheKey, 'json');
  if (cached) return context.json({ ...cached, cache: 'hit' });

  const apiKey = context.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return context.json({ error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Alpha Vantage API key is not configured for this environment.', retryable: false } }, 503);

  try {
    const bars = await fetchAlphaVantageDailySeries(providerSymbol, apiKey);
    const latestBar = bars[bars.length - 1];
    const previousBar = bars[bars.length - 2];
    let latestQuote: DailySeriesResponse['latestQuote'] = {
      price: money(latestBar.close, currency),
      change: money(previousBar ? latestBar.close - previousBar.close : 0, currency),
      changePercent: previousBar ? (latestBar.close / previousBar.close - 1) * 100 : 0,
      volume: latestBar.volume,
      asOf: null,
      tradingDate: latestBar.time,
      isDelayed: true,
      entitlement: 'eod',
    };
    if (entitlement !== 'eod') {
      const liveQuote = await fetchAlphaVantageQuote(providerSymbol, apiKey, entitlement);
      latestQuote = {
        price: money(Number(liveQuote.price), currency),
        change: money(Number(liveQuote.change), currency),
        changePercent: liveQuote.changePercent,
        volume: liveQuote.volume,
        asOf: null,
        tradingDate: liveQuote.tradingDay,
        isDelayed: entitlement === 'delayed',
        entitlement,
      };
    }
    const response: DailySeriesResponse = {
      instrument: {
        instrumentId: instrument?.instrument_id ?? `symbol_${symbol.toLowerCase()}`,
        symbol,
        name: instrument?.name ?? symbol,
        exchange: instrument?.exchange ?? null,
        isin: null,
        industry: instrument?.industry ?? null,
        currency,
      },
      interval: 'daily',
      bars,
      lastBarDate: bars[bars.length - 1].time,
      latestQuote,
      source: { provider: 'Alpha Vantage', entitlement: 'historical_daily', retrievedAt: new Date().toISOString() },
      cache: 'miss',
    };
    const cacheTtl = entitlement === 'realtime' ? 60 : entitlement === 'delayed' ? 900 : 21600;
    await context.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: cacheTtl });
    return context.json(response);
  } catch (error) {
    return context.json({ error: { code: 'HISTORY_PROVIDER_ERROR', message: safeError(error), retryable: true } }, 502);
  }
});

app.get('/api/v1/instruments/:symbol/news', async (context) => {
  const symbol = context.req.param('symbol').toUpperCase();
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) return context.json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol format is invalid.', retryable: false } }, 400);
  const limit = Number(context.req.query('limit') ?? '50');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return context.json({ error: { code: 'INVALID_LIMIT', message: 'News limit must be between 1 and 100.', retryable: false } }, 400);

  const instrument = await context.env.DB.prepare(
    'SELECT instrument_id, symbol, name, exchange, isin, industry, currency, alpha_vantage_symbol FROM instruments WHERE symbol = ? LIMIT 1',
  ).bind(symbol).first<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    isin: string | null;
    industry: string | null;
    currency: string;
    alpha_vantage_symbol: string | null;
  }>();
  const localSource = context.env.MARKET_DATA_SOURCE === 'local';
  if (instrument && !localSource && !instrument.alpha_vantage_symbol) {
    return context.json({ error: { code: 'PROVIDER_SYMBOL_NOT_CONFIGURED', message: 'This imported instrument needs a verified provider symbol mapping before news can be filtered.', retryable: false } }, 409);
  }

  let defaultToTime = Date.now();
  if (localSource && instrument) {
    const bounds = await context.env.DB.prepare(
      'SELECT MAX(published_at) AS latest FROM local_news_articles WHERE instrument_id = ?',
    ).bind(instrument.instrument_id).first<{ latest: string | null }>();
    if (bounds?.latest) defaultToTime = Date.parse(bounds.latest);
  }
  const defaultRange = localSource ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const fromDate = new Date(context.req.query('from') ?? defaultToTime - defaultRange);
  const toDate = new Date(context.req.query('to') ?? defaultToTime);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return context.json({ error: { code: 'INVALID_NEWS_RANGE', message: 'News range must contain valid from/to timestamps in ascending order.', retryable: false } }, 400);
  }
  if (toDate.getTime() - fromDate.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return context.json({ error: { code: 'NEWS_RANGE_TOO_LARGE', message: 'News requests are limited to a 90-day window.', retryable: false } }, 400);
  }
  const from = new Date(Math.floor(fromDate.getTime() / 60000) * 60000).toISOString();
  const to = new Date(Math.floor(toDate.getTime() / 60000) * 60000).toISOString();

  if (localSource) {
    if (!instrument) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'This symbol is not in the local BSE news dataset.', retryable: false } }, 404);
    const result = await context.env.DB.prepare(
      `SELECT article_id, title, url, source_name, source_domain, published_at
       FROM local_news_articles
       WHERE instrument_id = ? AND published_at >= ? AND published_at <= ?
       ORDER BY published_at DESC LIMIT ?`,
    ).bind(instrument.instrument_id, from, to, limit).all<{
      article_id: string;
      title: string;
      url: string;
      source_name: string;
      source_domain: string;
      published_at: string;
    }>();
    const articles: NewsArticle[] = result.results.map((article) => ({
      articleId: article.article_id,
      title: article.title,
      url: article.url,
      publishedAt: article.published_at,
      source: article.source_name,
      sourceDomain: article.source_domain,
      summary: '',
      topics: [],
      overallSentiment: scoreNewsHeadline(article.title),
      tickerSentiment: null,
    }));
    const localSentimentScores = articles.flatMap((article) => article.overallSentiment ? [article.overallSentiment.score] : []);
    const aggregateSentiment = localSentimentScores.length
      ? (() => {
        const score = localSentimentScores.reduce((sum, item) => sum + item, 0) / localSentimentScores.length;
        return { score, label: sentimentLabel(score) };
      })()
      : null;
    return context.json({
      instrument: { instrumentId: instrument.instrument_id, symbol, name: instrument.name, exchange: instrument.exchange, isin: instrument.isin, industry: instrument.industry, currency: instrument.currency },
      range: { from, to },
      articleCount: articles.length,
      aggregateSentiment,
      articles,
      source: { provider: 'BSE corporate-news archive (Kaggle CC0); headline wordlist sentiment v1', retrievedAt: new Date().toISOString() },
      cache: 'miss',
    } satisfies NewsResponse);
  }

  const newsTicker = instrument?.symbol ?? symbol;
  const providerSymbol = instrument?.alpha_vantage_symbol ?? symbol;
  const cacheKey = `v1:market:news:${newsTicker}:${from}:${to}:${limit}`;
  const cached = await context.env.CACHE.get<NewsResponse>(cacheKey, 'json');
  if (cached) return context.json({ ...cached, cache: 'hit' });
  const apiKey = context.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return context.json({ error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Alpha Vantage API key is not configured for this environment.', retryable: false } }, 503);

  try {
    const articles = await fetchAlphaVantageNews(newsTicker, from, to, limit, apiKey);
    const sentimentValues = articles.map((article) => article.tickerSentiment?.score ?? article.overallSentiment.score);
    const sentimentScore = sentimentValues.length ? sentimentValues.reduce((sum, score) => sum + score, 0) / sentimentValues.length : 0;
    const response: NewsResponse = {
      instrument: {
        instrumentId: instrument?.instrument_id ?? `symbol_${symbol.toLowerCase()}`,
        symbol,
        name: instrument?.name ?? symbol,
        exchange: instrument?.exchange ?? null,
        isin: instrument?.isin ?? null,
        industry: instrument?.industry ?? null,
        currency: instrument?.currency ?? currencyForProviderSymbol(providerSymbol),
      },
      range: { from, to },
      articleCount: articles.length,
      aggregateSentiment: { score: sentimentScore, label: sentimentLabel(sentimentScore) },
      articles,
      source: { provider: 'Alpha Vantage News & Sentiment', retrievedAt: new Date().toISOString() },
      cache: 'miss',
    };
    await context.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 300 });
    return context.json(response);
  } catch (error) {
    return context.json({ error: { code: 'NEWS_PROVIDER_ERROR', message: safeError(error), retryable: true } }, 502);
  }
});

app.get('/api/v1/instruments/:symbol/similar', async (context) => {
  const symbol = context.req.param('symbol').toUpperCase();
  const limit = Number(context.req.query('limit') ?? '3');
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) return context.json({ error: { code: 'INVALID_SYMBOL', message: 'Symbol format is invalid.', retryable: false } }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) return context.json({ error: { code: 'INVALID_LIMIT', message: 'Similar-stock limit must be between 1 and 3.', retryable: false } }, 400);
  if (context.env.MARKET_DATA_SOURCE !== 'local') return context.json({ error: { code: 'LOCAL_ANALYTICS_REQUIRED', message: 'Similarity ranking requires the local historical dataset.', retryable: false } }, 503);

  const selectedInstrument = await context.env.DB.prepare(
    'SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments WHERE symbol = ? AND exchange = ? LIMIT 1',
  ).bind(symbol, 'BSE').first<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    isin: string | null;
    industry: string | null;
    currency: string;
  }>();
  if (!selectedInstrument) return context.json({ error: { code: 'LOCAL_DATA_NOT_FOUND', message: 'This symbol is not in the local BSE dataset.', retryable: false } }, 404);

  const result = await context.env.DB.prepare(
    `SELECT i.instrument_id, i.symbol, i.name, i.exchange, i.isin, i.industry, i.currency,
            p.trading_date, p.close_price
     FROM local_daily_prices p JOIN instruments i ON i.instrument_id = p.instrument_id
     WHERE p.source = ? AND i.exchange = ?
     ORDER BY i.symbol, p.trading_date`,
  ).bind('kaggle-bse-cc0', 'BSE').all<{
    instrument_id: string;
    symbol: string;
    name: string;
    exchange: string | null;
    isin: string | null;
    industry: string | null;
    currency: string;
    trading_date: string;
    close_price: number;
  }>();
  const rowsByInstrument = new Map<string, typeof result.results>();
  for (const row of result.results) {
    rowsByInstrument.set(row.instrument_id, [...(rowsByInstrument.get(row.instrument_id) ?? []), row]);
  }
  const selectedRows = rowsByInstrument.get(selectedInstrument.instrument_id) ?? [];
  if (selectedRows.length < 3) return context.json({ error: { code: 'LOCAL_HISTORY_INSUFFICIENT', message: 'At least three daily closes are required for similarity ranking.', retryable: false } }, 422);

  const selectedByDate = new Map(selectedRows.map((row) => [row.trading_date, row.close_price]));
  const selectedIndustry = selectedInstrument.industry?.trim().toLowerCase() ?? '';
  const matches = [...rowsByInstrument.entries()].flatMap(([instrumentId, candidateRows]) => {
    if (instrumentId === selectedInstrument.instrument_id) return [];
    const candidateByDate = new Map(candidateRows.map((row) => [row.trading_date, row.close_price]));
    const commonDates = [...selectedByDate.keys()].filter((date) => candidateByDate.has(date)).sort().slice(-61);
    if (commonDates.length < 3) return [];
    const selectedCloses = commonDates.map((date) => selectedByDate.get(date)!);
    const candidateCloses = commonDates.map((date) => candidateByDate.get(date)!);
    const selectedReturn = selectedCloses[selectedCloses.length - 1] / selectedCloses[0] - 1;
    const candidateReturn = candidateCloses[candidateCloses.length - 1] / candidateCloses[0] - 1;
    const selectedDailyReturns = selectedCloses.slice(1).map((close, index) => close / selectedCloses[index] - 1);
    const candidateDailyReturns = candidateCloses.slice(1).map((close, index) => close / candidateCloses[index] - 1);
    const returnCorrelation = pearsonCorrelation(selectedDailyReturns, candidateDailyReturns);
    const candidate = candidateRows[candidateRows.length - 1];
    const sameIndustry = Boolean(selectedIndustry && candidate.industry?.trim().toLowerCase() === selectedIndustry);
    const returnSimilarity = 1 - Math.min(Math.abs(selectedReturn - candidateReturn), 1);
    const correlationSimilarity = returnCorrelation === null ? 0.5 : (returnCorrelation + 1) / 2;
    const similarityScore = (sameIndustry ? 0.45 : 0) + returnSimilarity * 0.3 + correlationSimilarity * 0.25;
    const evidence = [
      sameIndustry ? `Same industry: ${candidate.industry}` : `Industry: ${candidate.industry ?? 'Unclassified'}`,
      `${commonDates.length - 1}-interval return ${candidateReturn >= 0 ? '+' : ''}${(candidateReturn * 100).toFixed(1)}%`,
      returnCorrelation === null ? 'Return correlation unavailable' : `Daily-return correlation ${returnCorrelation.toFixed(2)}`,
    ];
    return [{
      instrument: {
        instrumentId: candidate.instrument_id,
        symbol: candidate.symbol,
        name: candidate.name,
        exchange: candidate.exchange,
        isin: candidate.isin,
        industry: candidate.industry,
        currency: candidate.currency,
      },
      similarityScore,
      periodReturn: candidateReturn,
      returnCorrelation,
      sameIndustry,
      evidence,
    }];
  }).sort((left, right) => right.similarityScore - left.similarityScore).slice(0, limit);

  const response: SimilarStocksResponse = {
    instrument: {
      instrumentId: selectedInstrument.instrument_id,
      symbol: selectedInstrument.symbol,
      name: selectedInstrument.name,
      exchange: selectedInstrument.exchange,
      isin: selectedInstrument.isin,
      industry: selectedInstrument.industry,
      currency: selectedInstrument.currency,
    },
    window: { from: selectedRows[Math.max(0, selectedRows.length - 61)].trading_date, to: selectedRows[selectedRows.length - 1].trading_date },
    matches,
    source: { provider: 'Local BSE close history', retrievedAt: new Date().toISOString() },
  };
  return context.json(response);
});

app.get('/api/v1/instruments/:symbol', async (context) => {
  const symbol = context.req.param('symbol').toUpperCase();
  const instrument = await context.env.DB.prepare(
    'SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments WHERE symbol = ? LIMIT 1',
  ).bind(symbol).first<Instrument>();
  if (!instrument) return context.json({ error: { code: 'INSTRUMENT_NOT_FOUND', message: 'Instrument was not found in the local catalog.', retryable: false } }, 404);
  return context.json({ instrument: {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    isin: instrument.isin,
    industry: instrument.industry,
    currency: instrument.currency,
  } });
});

app.post('/api/v1/dev/sessions/:sessionId/turns', async (context) => {
  if (!isLocalDevelopment(context.env)) return context.json({ error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false } }, 404);
  const parsed = localTurnSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ error: { code: 'INVALID_TURN', message: 'A message of 1 to 4000 characters is required.', retryable: false } }, 400);
  const sessionId = context.req.param('sessionId');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId)) return context.json({ error: { code: 'INVALID_SESSION', message: 'Session ID format is invalid.', retryable: false } }, 400);

  const objectId = context.env.STOCK_SESSION.idFromName(`${LOCAL_USER_ID}:${sessionId}`);
  const session = context.env.STOCK_SESSION.get(objectId);
  return session.fetch('https://stock-session/turns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: parsed.data.content }) });
});

app.onError((error, context) => {
  console.error(JSON.stringify({ requestId: context.req.header('cf-ray') ?? crypto.randomUUID(), route: new URL(context.req.url).pathname, error: error.name }));
  return context.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', retryable: false } }, 500);
});

app.notFound((context) => context.json({ error: { code: 'NOT_FOUND', message: 'Route not found.', retryable: false } }, 404));

export class StockSessionDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' && new URL(request.url).pathname === '/turns') {
      const turns = await this.state.storage.get<SessionTurn[]>('turns') ?? [];
      return Response.json({ turns });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/turns') {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, { status: 404 });
    }

    const payload = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }).safeParse(await request.json().catch(() => null));
    if (!payload.success) return Response.json({ error: { code: 'INVALID_TURN', message: 'Invalid session turn.' } }, { status: 400 });
    const turns = await this.state.storage.get<SessionTurn[]>('turns') ?? [];
    turns.push({ ...payload.data, createdAt: new Date().toISOString() });
    const recentTurns = turns.slice(-40);
    await this.state.storage.put('turns', recentTurns);
    return Response.json({ turns: recentTurns });
  }
}

type SessionTurn = { role: 'user' | 'assistant'; content: string; createdAt?: string };

type QuoteResponse = {
  instrument: { instrumentId: string; symbol: string; name: string; exchange: string | null; currency: string; industry: string | null };
  quote: { price: { amount: string; currency: string }; change: { amount: string; currency: string }; changePercent: number; volume: number; marketCap: null; dayRange: null; asOf: null; tradingDate: string; isDelayed: boolean };
  source: { provider: string; entitlement: QuoteEntitlement; retrievedAt: string };
  cache: 'hit' | 'miss';
};

type DailySeriesResponse = {
  instrument: { instrumentId: string; symbol: string; name: string; exchange: string | null; isin: string | null; industry: string | null; currency: string };
  interval: 'daily';
  bars: DailyBar[];
  lastBarDate: string;
  latestQuote: {
    price: { amount: string; currency: string };
    change: { amount: string; currency: string };
    changePercent: number;
    volume: number;
    asOf: null;
    tradingDate: string;
    isDelayed: boolean;
    entitlement: QuoteEntitlement;
  };
  source: { provider: string; entitlement: 'historical_daily'; retrievedAt: string };
  cache: 'hit' | 'miss';
};

type NewsResponse = {
  instrument: { instrumentId: string; symbol: string; name: string; exchange: string | null; isin: string | null; industry: string | null; currency: string };
  range: { from: string; to: string };
  articleCount: number;
  aggregateSentiment: { score: number; label: string } | null;
  articles: NewsArticle[];
  source: { provider: string; retrievedAt: string };
  cache: 'hit' | 'miss';
};

function portfolioInsertStatements(db: D1Database, snapshotId: string, row: PortfolioCsvRow): D1PreparedStatement[] {
  const instrumentId = `ins_${row.ISIN.toLowerCase()}`;
  const insertInstrument = db.prepare(
     `INSERT INTO instruments (instrument_id, symbol, name, exchange, isin, industry, currency, alpha_vantage_symbol)
      VALUES (?, ?, ?, 'BSE', ?, ?, 'INR', ?)
      ON CONFLICT(instrument_id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, exchange = excluded.exchange, industry = excluded.industry, currency = excluded.currency, alpha_vantage_symbol = excluded.alpha_vantage_symbol`,
    ).bind(instrumentId, row.Symbol, row.Symbol, row.ISIN, row.Sector, `${row.Symbol}.BSE`);
  const insertPosition = db.prepare(
    `INSERT INTO positions (snapshot_id, instrument_id, quantity, average_cost, last_price, invested_value, current_value, unrealized_pnl, unrealized_pnl_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(snapshotId, instrumentId, row.Quantity, row['Average Price (₹)'], row['LTP (₹)'], row['Invested Amount (₹)'], row['Current Value (₹)'], row['P&L (₹)'], row['P&L (%)']);
  return [insertInstrument, insertPosition];
}

function isLocalDevelopment(env: WorkerEnv) {
  return env.ENVIRONMENT === 'development' && env.LOCAL_DEV_IMPORT_ENABLED === 'true';
}

function isDemoAccess(env: WorkerEnv) {
  return isLocalDevelopment(env) || env.PUBLIC_DEMO_MODE === 'true';
}

function isDemoSeedEnabled(env: WorkerEnv) {
  return isLocalDevelopment(env) || env.DEMO_SEED_ENABLED === 'true';
}

function money(value: number, currency: string) {
  return { amount: value.toFixed(2), currency };
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function sentimentLabel(score: number) {
  if (score >= 0.35) return 'strongly_positive';
  if (score >= 0.1) return 'positive';
  if (score <= -0.35) return 'strongly_negative';
  if (score <= -0.1) return 'negative';
  return 'neutral';
}

function pearsonCorrelation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const leftVariance = left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0);
  const rightVariance = right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0);
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? null : numerator / denominator;
}

export default app;