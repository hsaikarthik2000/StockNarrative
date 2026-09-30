import type { WorkerEnv } from '../../env';
import { streamConversation } from '../conversation/ConversationService';
import type { ConversationRequest, ConversationStream, ConversationTurn } from '../conversation/types';
import { LocalMcpRegistry } from '../../mcp/LocalMcpRegistry';
import type { MarketQuote, NewsSearch } from '../../tools/contracts';
import type { PortfolioSnapshot } from '../../tools/contracts';

const MARKET_REQUEST_PATTERN = /\b(current|latest|today|price|quote|trading|close|volume)\b/i;
const EVENT_REQUEST_PATTERN = /\b(why|move|jump|drop|spike|deviation|news)\b/i;
const PORTFOLIO_REQUEST_PATTERN = /\b(my\s+(?:current\s+|investment\s+)?portfolio|my holdings|my positions|my investments|portfolio details|portfolio value|portfolio breakdown|allocation|sector(?:-wise| wise)?|risk tolerance|risk profile|investment guideline|recommended investment|unrealized|average cost|largest holding|top performing)\b/i;
const RECOMMENDATION_REQUEST_PATTERN = /\b(recommend|recommendation|similar stocks?|related stocks?|comparable stocks?|which stocks?)\b/i;

export async function routeRecommendationRequest(
  env: Pick<WorkerEnv, 'AI' | 'DB' | 'CACHE' | 'MARKET_DATA_SOURCE'>,
  request: ConversationRequest,
  history: ConversationTurn[],
): Promise<ConversationStream | null> {
  if (!RECOMMENDATION_REQUEST_PATTERN.test(request.message)) return null;
  const symbol = await resolveSymbol(env.DB, request.symbol, request.message, history);
  if (!symbol) return null;
  try {
    const registry = new LocalMcpRegistry(env);
    const result = await registry.callTool('recommendations.find_related', { symbol, limit: 3 });
    const toolContext = `Verified recommendation tool result: ${JSON.stringify(result.structuredContent)}. Treat scores as relevance signals only, not expected returns, probabilities, safety ratings, or personalized suitability. Explain the evidence and state that the method is deterministic industry matching.`;
    return streamConversation(env, { ...request, symbol, toolContext }, history);
  } catch {
    return null;
  }
}

export async function routePortfolioRequest(
  env: Pick<WorkerEnv, 'AI' | 'DB' | 'CACHE' | 'MARKET_DATA_SOURCE'>,
  request: ConversationRequest,
  history: ConversationTurn[],
): Promise<ConversationStream | null> {
  if (!PORTFOLIO_REQUEST_PATTERN.test(request.message)) return null;
  try {
    const registry = new LocalMcpRegistry(env);
    const result = await registry.callTool('portfolio.get_summary', {});
    const profileResult = await registry.callTool('personalization.get_profile', {});
    const portfolio = result.structuredContent as PortfolioSnapshot;
    const profile = profileResult.structuredContent as { communicationStyle: string; riskProfile: string; watchlist: string[] };
    const summary = [
      `currency=${portfolio.portfolio.baseCurrency}`,
      `snapshotAsOf=${portfolio.portfolio.asOf}`,
      `investedValue.amount=${portfolio.portfolio.totals.investedValue.amount}`,
      `currentValue.amount=${portfolio.portfolio.totals.currentValue.amount}`,
      `unrealizedPnl.amount=${portfolio.portfolio.totals.unrealizedPnl.amount}`,
      ...portfolio.portfolio.positions.map((position) => [
        `position.symbol=${position.instrument.symbol}`,
        `position.name=${position.instrument.name}`,
        `position.industry=${position.instrument.industry ?? 'Unknown'}`,
        `position.quantity=${position.quantity}`,
        `position.averageCost.amount=${position.averageCost.amount}`,
        `position.currentValue.amount=${position.currentValue.amount}`,
        `position.unrealizedPnl.amount=${position.unrealizedPnl.amount}`,
        `position.unrealizedPnlPercent=${position.unrealizedPnlPercent}`,
      ].join(', ')),
    ].join('\n');
    const toolContext = `Verified portfolio and personalization tool results. Use only this authorized imported snapshot and profile:\n${summary}\ncommunicationStyle=${profile.communicationStyle}\nriskProfile=${profile.riskProfile}\nFor sector allocation, group positions by position.industry and calculate percentages from the provided position.currentValue.amount values. If the user asks about recommended guidelines and riskProfile is unknown, explain that no personal guideline is configured, then provide only clearly labeled general educational context. Copy every monetary amount exactly as the decimal string provided. Do not add comma grouping, change digits, recompute totals, or invent positions. Explain that values and P&L come from the imported CSV snapshot and are not a live account view.`;
    return streamConversation(env, { ...request, toolContext }, history);
  } catch {
    return null;
  }
}

export async function routeEventRequest(
  env: Pick<WorkerEnv, 'AI' | 'DB' | 'CACHE' | 'MARKET_DATA_SOURCE'>,
  request: ConversationRequest,
  history: ConversationTurn[],
): Promise<ConversationStream | null> {
  if (!EVENT_REQUEST_PATTERN.test(request.message)) return null;
  const symbol = await resolveSymbol(env.DB, request.symbol, request.message, history);
  if (!symbol || env.MARKET_DATA_SOURCE !== 'local') return null;

  try {
    const registry = new LocalMcpRegistry(env);
    const quoteResult = await registry.callTool('market_data.get_quote', { symbol });
    const quote = quoteResult.structuredContent as MarketQuote;
    const eventDate = new Date(`${quote.tradingDate}T12:00:00Z`);
    const from = new Date(eventDate.getTime() - 5 * 86400000).toISOString();
    const to = new Date(eventDate.getTime() + 5 * 86400000).toISOString();
    const newsResult = await registry.callTool('news.search', { symbol, from, to, limit: 20 });
    const news = newsResult.structuredContent as NewsSearch;
    const headlines = news.articles.slice(0, 5).map((article) => ({ title: article.title, source: article.source, publishedAt: article.publishedAt, sentiment: article.overallSentiment }));
    const toolContext = `Verified multi-step tool results. Quote: ${JSON.stringify({ symbol: quote.instrument.symbol, name: quote.instrument.name, price: quote.price, change: quote.change, changePercent: quote.changePercent, volume: quote.volume, tradingDate: quote.tradingDate, source: quote.provenance })}. News window: ${from} to ${to}. Archived headlines: ${JSON.stringify(headlines)}. State temporal overlap only; never claim that a headline caused the move.`;
    return streamConversation(env, { ...request, symbol, toolContext }, history);
  } catch {
    return null;
  }
}

export async function routeMarketRequest(
  env: Pick<WorkerEnv, 'AI' | 'DB' | 'CACHE' | 'MARKET_DATA_SOURCE'>,
  request: ConversationRequest,
  history: ConversationTurn[],
): Promise<ConversationStream | null> {
  if (!MARKET_REQUEST_PATTERN.test(request.message)) return null;
  const symbol = await resolveSymbol(env.DB, request.symbol, request.message, history);
  if (!symbol || env.MARKET_DATA_SOURCE !== 'local') return null;

  try {
    const registry = new LocalMcpRegistry(env);
    const toolResult = await registry.callTool('market_data.get_quote', { symbol });
    const quote = toolResult.structuredContent as Awaited<ReturnType<import('../../tools/market-data').D1MarketDataProvider['getQuote']>>;
    const toolContext = `Verified market tool result. Use only these facts for the answer: ${JSON.stringify({
      symbol: quote.instrument.symbol,
      name: quote.instrument.name,
      exchange: quote.instrument.exchange,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      tradingDate: quote.tradingDate,
      source: quote.provenance,
    })}. Explain that this is delayed end-of-day BSE data. Do not call it live or infer unsupported facts.`;
    return streamConversation(env, { ...request, symbol, toolContext }, history);
  } catch {
    return null;
  }
}

async function resolveSymbol(db: D1Database, requestedSymbol: string | undefined, message: string, history: ConversationTurn[] = []): Promise<string | null> {
  const historyText = history.slice(-6).map((turn) => turn.content).join(' ');
  const candidates = [requestedSymbol, ...(message.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{1,14}\b/g) ?? []), ...(historyText.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{1,14}\b/g) ?? [])]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => candidate.toUpperCase());
  for (const candidate of candidates) {
    const match = await db.prepare('SELECT symbol FROM instruments WHERE symbol = ? LIMIT 1').bind(candidate).first<{ symbol: string }>();
    if (match) return match.symbol;
  }
  return null;
}