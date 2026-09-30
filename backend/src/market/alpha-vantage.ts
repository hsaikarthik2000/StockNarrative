export type AlphaQuote = {
  symbol: string;
  price: string;
  change: string;
  changePercent: number;
  volume: number;
  tradingDay: string;
};

export type AlphaDailyBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
};

type AlphaGlobalQuoteResponse = {
  'Global Quote'?: Record<string, string>;
  Note?: string;
  Information?: string;
  'Error Message'?: string;
};

type AlphaDailyResponse = {
  'Time Series (Daily)'?: Record<string, Record<string, string>>;
  Note?: string;
  Information?: string;
  'Error Message'?: string;
};

export type QuoteEntitlement = 'eod' | 'delayed' | 'realtime';

export function currencyForProviderSymbol(symbol: string) {
  const exchange = symbol.toUpperCase().split('.').at(-1);
  return exchange === 'BSE' || exchange === 'NSE' ? 'INR' : 'USD';
}

export function normalizeDailySeries(payload: AlphaDailyResponse, limit = 100, today = currentTradingDate()): AlphaDailyBar[] {
  if (payload.Note || payload.Information) {
    throw new Error('Alpha Vantage rate limit reached. Retry after the provider quota window.');
  }
  if (payload['Error Message']) throw new Error('Alpha Vantage rejected the daily history request.');
  const series = payload['Time Series (Daily)'];
  if (!series) throw new Error('Alpha Vantage returned no daily history for this symbol.');

  const bars = Object.entries(series).map(([time, values]) => {
    const [open, high, low, close, volume] = [
      values['1. open'],
      values['2. high'],
      values['3. low'],
      values['4. close'],
      values['5. volume'],
    ].map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || [open, high, low, close, volume].some((value) => !Number.isFinite(value)) || Math.min(open, high, low, close) <= 0 || volume < 0) {
      throw new Error('Alpha Vantage returned a malformed daily bar.');
    }
    return { time, open, high, low, close, volume, complete: time < today };
  }).sort((left, right) => left.time.localeCompare(right.time));

  if (bars.length === 0) throw new Error('Alpha Vantage returned an empty daily series.');
  return bars.slice(-limit);
}

export function normalizeGlobalQuote(payload: AlphaGlobalQuoteResponse): AlphaQuote {
  if (payload.Note || payload.Information) {
    throw new Error('Alpha Vantage rate limit reached. Retry after the provider quota window.');
  }
  if (payload['Error Message']) throw new Error('Alpha Vantage rejected the quote request.');

  const quote = payload['Global Quote'];
  if (!quote?.['01. symbol'] || !quote['05. price'] || !quote['10. change percent']) {
    throw new Error('Alpha Vantage returned no quote for this symbol.');
  }
  const changePercent = Number(quote['10. change percent'].replace('%', ''));
  const volume = Number(quote['06. volume'] ?? '0');
  if (!Number.isFinite(changePercent) || !Number.isFinite(volume)) {
    throw new Error('Alpha Vantage returned an invalid quote payload.');
  }
  return {
    symbol: quote['01. symbol'],
    price: quote['05. price'],
    change: quote['09. change'] ?? '0',
    changePercent,
    volume,
    tradingDay: quote['07. latest trading day'] ?? new Date().toISOString().slice(0, 10),
  };
}

export async function fetchAlphaVantageQuote(
  symbol: string,
  apiKey: string,
  entitlement: QuoteEntitlement = 'eod',
  fetcher: typeof fetch = fetch,
): Promise<AlphaQuote> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'GLOBAL_QUOTE');
  url.searchParams.set('symbol', symbol);
  if (entitlement !== 'eod') url.searchParams.set('entitlement', entitlement);
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new Error('Alpha Vantage request timed out or could not connect.');
  }
  if (!response.ok) throw new Error(`Alpha Vantage returned HTTP ${response.status}.`);
  return normalizeGlobalQuote(await response.json() as AlphaGlobalQuoteResponse);
}

export async function fetchAlphaVantageDailySeries(
  symbol: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AlphaDailyBar[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'TIME_SERIES_DAILY');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('outputsize', 'compact');
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('Alpha Vantage history request timed out or could not connect.');
  }
  if (!response.ok) throw new Error(`Alpha Vantage returned HTTP ${response.status}.`);
  return normalizeDailySeries(await response.json() as AlphaDailyResponse);
}

function currentTradingDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}