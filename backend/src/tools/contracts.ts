import type { DailyBar, Instrument, NewsArticle, PortfolioResponse } from '@stocknarrative/shared';

export type ToolProvenance = {
  provider: string;
  retrievedAt: string;
  asOf: string | null;
  isDelayed: boolean;
};

export type MarketQuote = {
  instrument: Instrument;
  price: { amount: string; currency: string };
  change: { amount: string; currency: string };
  changePercent: number;
  volume: number;
  tradingDate: string;
  provenance: ToolProvenance;
};

export type MarketHistory = {
  instrument: Instrument;
  bars: DailyBar[];
  provenance: ToolProvenance;
};

export type PortfolioSnapshot = {
  portfolio: PortfolioResponse;
  provenance: ToolProvenance;
};

export type NewsSearch = {
  instrument: Instrument;
  articles: NewsArticle[];
  range: { from: string; to: string };
  provenance: ToolProvenance;
};

export type PredictionCacheEntry = {
  key: string;
  value: unknown;
  expiresAt: string;
  modelVersion: string;
};

export type PersonalizationProfile = {
  userId: string;
  preferredCurrency: string;
  communicationStyle: 'formal' | 'concise' | 'conversational';
  watchlist: string[];
  riskProfile: 'unknown' | 'conservative' | 'balanced' | 'growth';
};

export type Recommendation = {
  instrument: Instrument;
  score: number;
  reasons: string[];
  methodVersion: string;
};

export interface PortfolioFetcher {
  getPortfolio(userId: string): Promise<PortfolioSnapshot>;
}

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<MarketQuote>;
  getHistory(symbol: string, limit?: number): Promise<MarketHistory>;
}

export interface NewsRetriever {
  search(symbol: string, range?: { from?: string; to?: string }, limit?: number): Promise<NewsSearch>;
}

export interface PredictiveCacheEngine {
  get(key: string): Promise<PredictionCacheEntry | null>;
  put(entry: PredictionCacheEntry): Promise<void>;
}

export interface PersonalizationTool {
  getProfile(userId: string): Promise<PersonalizationProfile>;
}

export interface RecommendationEngine {
  recommend(userId: string, symbol?: string, limit?: number): Promise<Recommendation[]>;
}