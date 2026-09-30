export type AlphaNewsArticle = {
  articleId: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  sourceDomain: string;
  summary: string;
  topics: Array<{ topic: string; relevance: number }>;
  overallSentiment: { label: string; score: number };
  tickerSentiment: { label: string; score: number; relevance: number } | null;
};

type AlphaNewsResponse = {
  feed?: Array<Record<string, unknown>>;
  Note?: string;
  Information?: string;
  'Error Message'?: string;
};

type RawTickerSentiment = {
  ticker?: string;
  ticker_sentiment_label?: string;
  ticker_sentiment_score?: string;
  relevance_score?: string;
};

export function normalizeNewsFeed(payload: AlphaNewsResponse, requestedSymbol: string): AlphaNewsArticle[] {
  if (payload.Note || payload.Information) {
    throw new Error('Alpha Vantage news request was rate limited. Retry after the provider quota window.');
  }
  if (payload['Error Message']) throw new Error('Alpha Vantage rejected the news request.');
  if (!Array.isArray(payload.feed)) throw new Error('Alpha Vantage returned no news feed.');

  return payload.feed.flatMap((item) => {
    const title = stringField(item.title);
    const url = stringField(item.url);
    const publishedAt = parsePublishedAt(stringField(item.time_published));
    if (!title || !url || !publishedAt) return [];

    const sourceDomain = stringField(item.source_domain) ?? safeDomain(url);
    const source = stringField(item.source) ?? sourceDomain;
    const overallScore = finiteNumber(item.overall_sentiment_score) ?? 0;
    const target = (Array.isArray(item.ticker_sentiment) ? item.ticker_sentiment : [])
      .map((value) => value as RawTickerSentiment)
      .find((sentiment) => matchesSymbol(sentiment.ticker ?? '', requestedSymbol));
    const topics = (Array.isArray(item.topics) ? item.topics : []).flatMap((value) => {
      const topic = value as Record<string, unknown>;
      const name = stringField(topic.topic);
      const relevance = finiteNumber(topic.relevance_score);
      return name && relevance !== null ? [{ topic: name, relevance }] : [];
    }).sort((left, right) => right.relevance - left.relevance);

    return [{
      articleId: stableArticleId(sourceDomain, publishedAt, title),
      title,
      url,
      publishedAt,
      source,
      sourceDomain,
      summary: stringField(item.summary) ?? '',
      topics,
      overallSentiment: {
        label: stringField(item.overall_sentiment_label) ?? 'Unknown',
        score: overallScore,
      },
      tickerSentiment: target ? {
        label: target.ticker_sentiment_label ?? 'Unknown',
        score: finiteNumber(target.ticker_sentiment_score) ?? overallScore,
        relevance: finiteNumber(target.relevance_score) ?? 0,
      } : null,
    }];
  });
}

export async function fetchAlphaVantageNews(
  symbol: string,
  from: string,
  to: string,
  limit: number,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AlphaNewsArticle[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'NEWS_SENTIMENT');
  url.searchParams.set('tickers', symbol);
  url.searchParams.set('time_from', toAlphaTime(from));
  url.searchParams.set('time_to', toAlphaTime(to));
  url.searchParams.set('sort', 'LATEST');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('Alpha Vantage news request timed out or could not connect.');
  }
  if (!response.ok) throw new Error(`Alpha Vantage returned HTTP ${response.status}.`);
  return normalizeNewsFeed(await response.json() as AlphaNewsResponse, symbol).slice(0, limit);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function parsePublishedAt(value: string | null): string | null {
  if (!value || !/^\d{8}T\d{6}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function safeDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function matchesSymbol(candidate: string, requested: string) {
  const normalizedCandidate = candidate.toUpperCase();
  const normalizedRequested = requested.toUpperCase();
  return normalizedCandidate === normalizedRequested || normalizedCandidate.startsWith(`${normalizedRequested}.`);
}

function stableArticleId(domain: string, publishedAt: string, title: string) {
  const input = `${domain}|${publishedAt}|${title.toLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `art_${(hash >>> 0).toString(36)}`;
}

function toAlphaTime(value: string) {
  const date = new Date(value);
  return `${date.toISOString().slice(0, 16).replace(/[-:]/g, '')}`;
}