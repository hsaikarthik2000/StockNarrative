import type { Instrument, NewsArticle } from '@stocknarrative/shared';
import { scoreNewsHeadline } from '../news/sentiment';
import type { WorkerEnv } from '../env';
import type { NewsRetriever, NewsSearch } from './contracts';

export class D1NewsRetriever implements NewsRetriever {
  constructor(private readonly env: Pick<WorkerEnv, 'DB'>) {}

  async search(symbol: string, range: { from?: string; to?: string } = {}, limit = 20): Promise<NewsSearch> {
    const instrument = await this.env.DB.prepare(
      'SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments WHERE symbol = ? LIMIT 1',
    ).bind(symbol.toUpperCase()).first<InstrumentRow>();
    if (!instrument) throw new Error(`Instrument ${symbol} was not found.`);
    const from = range.from ?? '1970-01-01T00:00:00.000Z';
    const to = range.to ?? '9999-12-31T23:59:59.999Z';
    const result = await this.env.DB.prepare(
      `SELECT article_id, title, url, source_name, source_domain, published_at
       FROM local_news_articles WHERE instrument_id = ? AND published_at >= ? AND published_at <= ?
       ORDER BY published_at DESC LIMIT ?`,
    ).bind(instrument.instrument_id, from, to, Math.min(Math.max(limit, 1), 100)).all<NewsRow>();
    const articles: NewsArticle[] = result.results.map((article) => {
      const sentiment = scoreNewsHeadline(article.title);
      return {
        articleId: article.article_id,
        title: article.title,
        url: article.url,
        publishedAt: new Date(article.published_at).toISOString(),
        source: article.source_name,
        sourceDomain: article.source_domain,
        summary: '',
        topics: [],
        overallSentiment: sentiment,
        tickerSentiment: sentiment ? { ...sentiment, relevance: 1 } : null,
      };
    });
    return {
      instrument: toInstrument(instrument),
      articles,
      range: { from, to },
      provenance: { provider: 'BSE corporate-news archive (CC0)', retrievedAt: new Date().toISOString(), asOf: articles[0]?.publishedAt ?? null, isDelayed: true },
    };
  }
}

type InstrumentRow = { instrument_id: string; symbol: string; name: string; exchange: string | null; isin: string | null; industry: string | null; currency: string };
type NewsRow = { article_id: string; title: string; url: string; source_name: string; source_domain: string; published_at: string };
function toInstrument(row: InstrumentRow): Instrument { return { instrumentId: row.instrument_id, symbol: row.symbol, name: row.name, exchange: row.exchange, isin: row.isin, industry: row.industry, currency: row.currency }; }