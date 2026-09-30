import {
  dailySeriesResponseSchema,
  instrumentSchema,
  newsResponseSchema,
  portfolioResponseSchema,
  similarStocksResponseSchema,
  type DailySeriesResponse,
  type Instrument,
  type NewsResponse,
  type PortfolioResponse,
  type SimilarStocksResponse,
} from '@stocknarrative/shared';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export type ChatRequest = {
  conversationId: string;
  message: string;
  symbol?: string;
  style?: 'formal' | 'concise' | 'conversational';
};

export async function streamChat(
  request: ChatRequest,
  onToken: (token: string) => void,
  onFollowUps: (questions: string[]) => void,
  onAnswerComplete: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl('/api/v1/chat'), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `Conversation request failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let eventName = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        continue;
      }
      const data = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (!data) continue;
      if (data === '[DONE]') {
        onAnswerComplete();
        continue;
      }
      try {
        const parsed = JSON.parse(data) as { response?: unknown; questions?: unknown };
        if (eventName === 'followups' && Array.isArray(parsed.questions)) {
          onFollowUps(parsed.questions.filter((question): question is string => typeof question === 'string').slice(0, 2));
        } else if (typeof parsed.response === 'string') {
          onToken(parsed.response);
        }
        eventName = '';
      } catch {
        continue;
      }
    }
  }
}

export async function getPortfolio(signal?: AbortSignal): Promise<PortfolioResponse> {
  const response = await fetch(apiUrl('/api/v1/me/portfolio'), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `Portfolio request failed (${response.status}).`);
  }
  return portfolioResponseSchema.parse(payload);
}

export async function getDailySeries(symbol: string, signal?: AbortSignal): Promise<DailySeriesResponse> {
  const response = await fetch(apiUrl(`/api/v1/instruments/${encodeURIComponent(symbol)}/series?interval=daily`), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `Market history request failed (${response.status}).`);
  }
  return dailySeriesResponseSchema.parse(payload);
}

export async function getNews(
  symbol: string,
  from: string | undefined,
  to: string | undefined,
  signal?: AbortSignal,
): Promise<NewsResponse> {
  const query = new URLSearchParams({ limit: '50' });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const response = await fetch(apiUrl(`/api/v1/instruments/${encodeURIComponent(symbol)}/news?${query}`), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `News request failed (${response.status}).`);
  }
  return newsResponseSchema.parse(payload);
}

export async function getSimilarStocks(symbol: string, signal?: AbortSignal): Promise<SimilarStocksResponse> {
  const response = await fetch(apiUrl(`/api/v1/instruments/${encodeURIComponent(symbol)}/similar?limit=3`), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `Similar stocks request failed (${response.status}).`);
  }
  return similarStocksResponseSchema.parse(payload);
}

export async function getInstrument(symbol: string, signal?: AbortSignal): Promise<Instrument> {
  const response = await fetch(apiUrl(`/api/v1/instruments/${encodeURIComponent(symbol)}`), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as { message?: string }).message
      : undefined;
    throw new Error(message ?? `Instrument request failed (${response.status}).`);
  }
  if (typeof payload !== 'object' || payload === null || !('instrument' in payload)) {
    throw new Error('Instrument response had an invalid shape.');
  }
  return instrumentSchema.parse(payload.instrument);
}