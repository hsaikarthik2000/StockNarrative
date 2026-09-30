import { z } from 'zod';
import type { WorkerEnv } from '../env';
import { D1MarketDataProvider } from '../tools/market-data';
import { D1NewsRetriever } from '../tools/news';
import { D1PortfolioFetcher } from '../tools/portfolio';
import { LOCAL_USER_ID } from '../env';
import { D1PersonalizationTool } from '../tools/personalization';
import { KvPredictiveCacheEngine } from '../tools/predictive-cache';
import { D1RecommendationEngine } from '../tools/recommendation';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const quoteInputSchema = z.object({ symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/) });
const newsInputSchema = z.object({ symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/), from: z.string().datetime(), to: z.string().datetime(), limit: z.number().int().min(1).max(100).default(20) });
const cacheInputSchema = z.object({ key: z.string().min(1).max(160) });
const recommendationInputSchema = z.object({ symbol: z.string().regex(/^[A-Z0-9.-]{1,20}$/), limit: z.number().int().min(1).max(3).default(3) });

export class LocalMcpRegistry {
  private readonly marketData: D1MarketDataProvider;
  private readonly news: D1NewsRetriever;
  private readonly portfolio: D1PortfolioFetcher;
  private readonly personalization: D1PersonalizationTool;
  private readonly predictiveCache: KvPredictiveCacheEngine;
  private readonly recommendations: D1RecommendationEngine;

  constructor(env: Pick<WorkerEnv, 'DB' | 'CACHE' | 'MARKET_DATA_SOURCE'>) {
    this.marketData = new D1MarketDataProvider(env);
    this.news = new D1NewsRetriever(env);
    this.portfolio = new D1PortfolioFetcher(env);
    this.personalization = new D1PersonalizationTool(env);
    this.predictiveCache = new KvPredictiveCacheEngine(env);
    this.recommendations = new D1RecommendationEngine(env);
  }

  listTools(): ToolDefinition[] {
    return [{
      name: 'market_data.get_quote',
      description: 'Retrieve the latest available quote for a supported instrument.',
      inputSchema: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'Exchange symbol, for example BAJFINANCE.' } },
        required: ['symbol'],
        additionalProperties: false,
      },
    }, {
      name: 'news.search',
      description: 'Search archived news headlines around a defined time window.',
      inputSchema: {
        type: 'object',
        properties: { symbol: { type: 'string' }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['symbol', 'from', 'to'],
        additionalProperties: false,
      },
    }, {
      name: 'portfolio.get_summary',
      description: 'Retrieve the authorized local portfolio snapshot and position summary.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }, {
      name: 'personalization.get_profile',
      description: 'Retrieve authorized communication, watchlist, and risk preferences.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }, {
      name: 'cache.get_prediction',
      description: 'Read a versioned, non-personalized cached derived result when it is still fresh.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['key'], additionalProperties: false },
    }, {
      name: 'recommendations.find_related',
      description: 'Find explainable same-industry related instruments without predicting returns or suitability.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['symbol'], additionalProperties: false },
    }];
  }

  async callTool(name: string, input: unknown): Promise<{ name: string; structuredContent: unknown }> {
    if (name === 'market_data.get_quote') {
      const parsed = quoteInputSchema.parse(input);
      return { name, structuredContent: await this.marketData.getQuote(parsed.symbol) };
    }
    if (name === 'news.search') {
      const parsed = newsInputSchema.parse(input);
      return { name, structuredContent: await this.news.search(parsed.symbol, { from: parsed.from, to: parsed.to }, parsed.limit) };
    }
    if (name === 'portfolio.get_summary') {
      return { name, structuredContent: await this.portfolio.getPortfolio(LOCAL_USER_ID) };
    }
    if (name === 'personalization.get_profile') {
      return { name, structuredContent: await this.personalization.getProfile(LOCAL_USER_ID) };
    }
    if (name === 'cache.get_prediction') {
      const parsed = cacheInputSchema.parse(input);
      return { name, structuredContent: await this.predictiveCache.get(parsed.key) };
    }
    if (name === 'recommendations.find_related') {
      const parsed = recommendationInputSchema.parse(input);
      return { name, structuredContent: await this.recommendations.recommend(LOCAL_USER_ID, parsed.symbol, parsed.limit) };
    }
    throw new Error(`Unknown MCP tool: ${name}`);
  }
}