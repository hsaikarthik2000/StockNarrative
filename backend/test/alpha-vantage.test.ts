import { describe, expect, it } from 'vitest';
import { currencyForProviderSymbol, normalizeDailySeries, normalizeGlobalQuote } from '../src/market/alpha-vantage';
import { fetchAlphaVantageNews, normalizeNewsFeed } from '../src/market/alpha-vantage-news';
import { scoreNewsHeadline } from '../src/news/sentiment';

describe('normalizeGlobalQuote', () => {
  it('normalizes Alpha Vantage quote fields', () => {
    const quote = normalizeGlobalQuote({
      'Global Quote': {
        '01. symbol': 'NVDA',
        '05. price': '138.2500',
        '06. volume': '48200000',
        '07. latest trading day': '2026-09-29',
        '09. change': '6.3500',
        '10. change percent': '4.8200%',
      },
    });
    expect(quote).toEqual({ symbol: 'NVDA', price: '138.2500', change: '6.3500', changePercent: 4.82, volume: 48200000, tradingDay: '2026-09-29' });
  });

  it('surfaces provider quota responses as retryable upstream errors', () => {
    expect(() => normalizeGlobalQuote({ Note: 'API call frequency is five calls per minute' })).toThrow(/rate limit/);
  });

  it('normalizes daily bars in chronological order and marks the current trading date incomplete', () => {
    const bars = normalizeDailySeries({
      'Time Series (Daily)': {
        '2026-09-30': { '1. open': '101', '2. high': '103', '3. low': '99', '4. close': '102', '5. volume': '1200' },
        '2026-09-29': { '1. open': '98', '2. high': '102', '3. low': '97', '4. close': '100', '5. volume': '1000' },
      },
    }, 100, '2026-09-30');
    expect(bars.map((bar) => bar.time)).toEqual(['2026-09-29', '2026-09-30']);
    expect(bars[0].complete).toBe(true);
    expect(bars[1].complete).toBe(false);
    expect(bars[1].close).toBe(102);
  });

  it('rejects daily provider messages instead of returning an empty chart', () => {
    expect(() => normalizeDailySeries({ Note: 'API call frequency is five calls per minute' })).toThrow(/rate limit/);
    expect(() => normalizeDailySeries({ 'Time Series (Daily)': { '2026-09-30': { '1. open': 'bad' } } })).toThrow(/malformed daily bar/);
  });
});

describe('normalizeNewsFeed', () => {
  it('normalizes source, publish time, topics, and matching ticker sentiment', () => {
    const articles = normalizeNewsFeed({
      feed: [{
        title: 'Chip demand rises',
        url: 'https://news.example.com/chips',
        time_published: '20260930T143015',
        source: 'Example News',
        source_domain: 'news.example.com',
        summary: 'Orders increased this quarter.',
        topics: [{ topic: 'Technology', relevance_score: '0.75' }],
        overall_sentiment_score: '0.2',
        overall_sentiment_label: 'Somewhat-Bullish',
        ticker_sentiment: [
          { ticker: 'NVDA.BSE', ticker_sentiment_score: '0.65', ticker_sentiment_label: 'Bullish', relevance_score: '0.91' },
        ],
      }],
    }, 'NVDA');

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      title: 'Chip demand rises',
      publishedAt: '2026-09-30T14:30:15Z',
      source: 'Example News',
      sourceDomain: 'news.example.com',
      topics: [{ topic: 'Technology', relevance: 0.75 }],
      overallSentiment: { label: 'Somewhat-Bullish', score: 0.2 },
      tickerSentiment: { label: 'Bullish', score: 0.65, relevance: 0.91 },
    });
  });

  it('omits malformed articles and exposes quota errors', () => {
    expect(normalizeNewsFeed({ feed: [{ title: 'Missing URL', time_published: '20260930T143015' }] }, 'NVDA')).toEqual([]);
    expect(() => normalizeNewsFeed({ Note: 'API call frequency exceeded' }, 'NVDA')).toThrow(/rate limited/);
  });

  it('enforces the requested result limit when the provider over-returns', async () => {
    const article = (title: string) => ({ title, url: `https://news.example.com/${title}`, time_published: '20260930T143015' });
    const result = await fetchAlphaVantageNews(
      'NVDA',
      '2026-09-30T00:00:00.000Z',
      '2026-09-30T23:59:00.000Z',
      1,
      'test-key',
      async () => new Response(JSON.stringify({ feed: [article('first'), article('second')] }), { status: 200 }),
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('first');
  });
});

describe('currencyForProviderSymbol', () => {
  it('uses INR for explicit India exchange suffixes', () => {
    expect(currencyForProviderSymbol('RELIANCE.BSE')).toBe('INR');
    expect(currencyForProviderSymbol('INFY.NSE')).toBe('INR');
    expect(currencyForProviderSymbol('NVDA')).toBe('USD');
  });
});

describe('scoreNewsHeadline', () => {
  it('scores clear positive and negative headlines and leaves unsupported text unscored', () => {
    expect(scoreNewsHeadline('Shares rise today')).toMatchObject({ score: 0.5, label: 'positive' });
    expect(scoreNewsHeadline('Bajaj Finance shares rise 3% after strong growth')).toMatchObject({ label: 'strongly_positive' });
    expect(scoreNewsHeadline('Company shares fell after weak results and missed estimates')).toMatchObject({ label: 'strongly_negative' });
    expect(scoreNewsHeadline('Board schedules its quarterly meeting')).toBeNull();
  });
});