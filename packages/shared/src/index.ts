import { z } from 'zod';

export const moneySchema = z.object({
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.string().length(3),
});

export const instrumentSchema = z.object({
  instrumentId: z.string(),
  symbol: z.string(),
  name: z.string(),
  exchange: z.string().nullable(),
  isin: z.string().nullable(),
  industry: z.string().nullable(),
  currency: z.string().length(3),
});

export const portfolioPositionSchema = z.object({
  instrument: instrumentSchema,
  quantity: z.string(),
  averageCost: moneySchema,
  investedValue: moneySchema,
  currentValue: moneySchema,
  unrealizedPnl: moneySchema,
  unrealizedPnlPercent: z.number(),
  quote: z.object({
    price: moneySchema,
    asOf: z.string().datetime().nullable(),
    isDelayed: z.boolean(),
    source: z.string(),
  }),
});

export const portfolioResponseSchema = z.object({
  portfolioId: z.string(),
  baseCurrency: z.string().length(3),
  asOf: z.string().datetime(),
  totals: z.object({
    investedValue: moneySchema,
    currentValue: moneySchema,
    unrealizedPnl: moneySchema,
  }),
  positions: z.array(portfolioPositionSchema),
});

export const dailyBarSchema = z.object({
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number(),
  volume: z.number(),
  complete: z.boolean(),
});

export const dailySeriesResponseSchema = z.object({
  instrument: instrumentSchema,
  interval: z.literal('daily'),
  bars: z.array(dailyBarSchema).min(1),
  latestQuote: z.object({
    price: moneySchema,
    change: moneySchema,
    changePercent: z.number(),
    volume: z.number(),
    asOf: z.string().datetime().nullable(),
    tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isDelayed: z.boolean(),
    entitlement: z.enum(['eod', 'delayed', 'realtime']),
  }),
  source: z.object({ provider: z.string(), retrievedAt: z.string().datetime() }),
  cache: z.enum(['hit', 'miss']),
});

export const newsArticleSchema = z.object({
  articleId: z.string(),
  title: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime(),
  source: z.string(),
  sourceDomain: z.string(),
  summary: z.string(),
  topics: z.array(z.object({ topic: z.string(), relevance: z.number() })),
  overallSentiment: z.object({ label: z.string(), score: z.number() }).nullable(),
  tickerSentiment: z.object({ label: z.string(), score: z.number(), relevance: z.number() }).nullable(),
});

export const newsResponseSchema = z.object({
  instrument: instrumentSchema,
  range: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  articleCount: z.number().int().nonnegative(),
  aggregateSentiment: z.object({ score: z.number(), label: z.string() }).nullable(),
  articles: z.array(newsArticleSchema),
  source: z.object({ provider: z.string(), retrievedAt: z.string().datetime() }),
  cache: z.enum(['hit', 'miss']),
});

export const similarStocksResponseSchema = z.object({
  instrument: instrumentSchema,
  window: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  matches: z.array(z.object({
    instrument: instrumentSchema,
    similarityScore: z.number().min(0).max(1),
    periodReturn: z.number(),
    returnCorrelation: z.number().min(-1).max(1).nullable(),
    sameIndustry: z.boolean(),
    evidence: z.array(z.string()),
  })),
  source: z.object({ provider: z.string(), retrievedAt: z.string().datetime() }),
});

export type Money = z.infer<typeof moneySchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type PortfolioPosition = z.infer<typeof portfolioPositionSchema>;
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;
export type DailyBar = z.infer<typeof dailyBarSchema>;
export type DailySeriesResponse = z.infer<typeof dailySeriesResponseSchema>;
export type NewsArticle = z.infer<typeof newsArticleSchema>;
export type NewsResponse = z.infer<typeof newsResponseSchema>;
export type SimilarStocksResponse = z.infer<typeof similarStocksResponseSchema>;

export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
  };
};