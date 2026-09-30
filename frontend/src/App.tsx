import { FormEvent, useEffect, useRef, useState } from 'react';
import type { DailyBar, DailySeriesResponse, NewsArticle, NewsResponse, PortfolioPosition, PortfolioResponse } from '@stocknarrative/shared';
import { getDailySeries, getInstrument, getNews, getPortfolio, getSimilarStocks, streamChat } from './lib/api';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Cpu,
  ExternalLink,
  Globe2,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  Minimize2,
  Moon,
  Newspaper,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';

type Stock = {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeValue: number;
  volume: string;
  marketCap: string;
  industry: string;
  positive: boolean;
  currency?: string;
  source?: 'demo' | 'portfolio-csv';
  portfolioPosition?: PortfolioPosition;
};

type ChatMessage = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
};

type Tab = 'narrative' | 'technicals' | 'news' | 'analytics';

const stocks: Stock[] = [
  { ticker: 'NVDA', name: 'NVIDIA Corporation', price: 138.25, change: 4.82, changeValue: 6.35, volume: '48.2M', marketCap: '$3.40T', industry: 'Semiconductors', positive: true },
  { ticker: 'AAPL', name: 'Apple Inc.', price: 224.50, change: -0.65, changeValue: -1.45, volume: '32.1M', marketCap: '$3.43T', industry: 'Consumer tech', positive: false },
  { ticker: 'TSLA', name: 'Tesla, Inc.', price: 248.90, change: 3.15, changeValue: 7.60, volume: '55.4M', marketCap: '$792B', industry: 'Electric vehicles', positive: true },
  { ticker: 'MSFT', name: 'Microsoft Corporation', price: 442.10, change: 1.12, changeValue: 4.90, volume: '21.0M', marketCap: '$3.28T', industry: 'Cloud & software', positive: true },
  { ticker: 'AMZN', name: 'Amazon.com, Inc.', price: 186.30, change: -1.20, changeValue: -2.25, volume: '28.9M', marketCap: '$1.94T', industry: 'E-commerce', positive: false },
  { ticker: 'RELIANCE', name: 'Reliance Industries', price: 2980.15, change: 2.40, changeValue: 69.80, volume: '14.2M', marketCap: '₹20.1L Cr', industry: 'Energy & tech', positive: true },
];

const suggestedStocks: (Stock & { similarity: number; reason: string })[] = [
  { ticker: 'AMD', name: 'Advanced Micro Devices', price: 164.42, change: 2.14, changeValue: 3.45, volume: '29.6M', marketCap: '$266B', industry: 'Semiconductors', positive: true, similarity: 94, reason: 'Shares AI accelerator demand' },
  { ticker: 'AVGO', name: 'Broadcom Inc.', price: 183.24, change: 1.38, changeValue: 2.49, volume: '18.2M', marketCap: '$856B', industry: 'Semiconductors', positive: true, similarity: 89, reason: 'Same data-center supply chain' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', price: 198.50, change: 1.72, changeValue: 3.36, volume: '12.7M', marketCap: '$1.03T', industry: 'Semiconductors', positive: true, similarity: 86, reason: 'Upstream foundry exposure' },
  { ticker: 'ORCL', name: 'Oracle Corporation', price: 187.62, change: 0.82, changeValue: 1.53, volume: '9.8M', marketCap: '$519B', industry: 'Cloud & software', positive: true, similarity: 88, reason: 'Cloud infrastructure spending' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.', price: 203.10, change: 0.64, changeValue: 1.29, volume: '16.4M', marketCap: '$2.48T', industry: 'Cloud & software', positive: true, similarity: 83, reason: 'Comparable hyperscaler exposure' },
  { ticker: 'QCOM', name: 'Qualcomm Inc.', price: 171.06, change: -0.42, changeValue: -0.72, volume: '7.3M', marketCap: '$190B', industry: 'Consumer tech', positive: false, similarity: 79, reason: 'Adjacent semiconductor segment' },
  { ticker: 'RIVN', name: 'Rivian Automotive', price: 14.28, change: 1.06, changeValue: 0.15, volume: '24.1M', marketCap: '$16B', industry: 'Electric vehicles', positive: true, similarity: 81, reason: 'EV demand and production cycle' },
  { ticker: 'META', name: 'Meta Platforms', price: 742.85, change: 1.42, changeValue: 10.40, volume: '11.3M', marketCap: '$1.88T', industry: 'Cloud & software', positive: true, similarity: 80, reason: 'AI infrastructure capex peer' },
];

const stockUniverse: Stock[] = [...stocks, ...suggestedStocks];
const defaultWatchlist = stocks.map((stock) => stock.ticker);
function formatMoney(amount: number | string, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
}

function portfolioPositionToStock(position: PortfolioPosition): Stock {
  const price = Number(position.quote.price.amount);
  const pnl = Number(position.unrealizedPnl.amount);
  return {
    ticker: position.instrument.symbol,
    name: position.instrument.name,
    price,
    change: position.unrealizedPnlPercent,
    changeValue: pnl,
    volume: 'Not in CSV',
    marketCap: 'Not in CSV',
    industry: position.instrument.industry ?? 'Other',
    positive: pnl >= 0,
    currency: position.quote.price.currency,
    source: 'portfolio-csv',
    portfolioPosition: position,
  };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function groupNewsArticles(articles: NewsArticle[]) {
  const groups = new Map<string, NewsArticle[]>();
  for (const article of articles) {
    const topic = article.topics[0]?.topic ?? 'Other coverage';
    groups.set(topic, [...(groups.get(topic) ?? []), article]);
  }
  return [...groups.entries()].map(([topic, groupArticles]) => {
    const scores = groupArticles.flatMap((article) => {
      const score = article.tickerSentiment?.score ?? article.overallSentiment?.score;
      return score === undefined || score === null ? [] : [score];
    });
    const score = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
    return {
      id: topic,
      headline: topic === 'Other coverage' && groupArticles.length === 1 ? groupArticles[0].title : topic,
      articles: groupArticles,
      score,
      sentiment: score === null ? 'Not scored' : score >= 0.1 ? 'Positive' : score <= -0.1 ? 'Negative' : 'Neutral',
    };
  }).sort((left, right) => right.articles.length - left.articles.length);
}

function timeAgo(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  if (Math.abs(seconds) < 60) return formatter.format(-seconds, 'second');
  if (Math.abs(seconds) < 3600) return formatter.format(-Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(-Math.round(seconds / 3600), 'hour');
  const days = Math.round(seconds / 86400);
  if (Math.abs(days) < 30) return formatter.format(-days, 'day');
  if (Math.abs(days) < 365) return formatter.format(-Math.round(days / 30), 'month');
  return formatter.format(-Math.round(days / 365), 'year');
}

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function shiftUtcDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sentimentTone(score: number) {
  return score > 0.1 ? 'positive-tag' : score < -0.1 ? 'negative-tag' : 'neutral-tag';
}

function renderAssistantInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function AssistantMessage({ text }: { text: string }) {
  const blocks: Array<{ type: 'paragraph' | 'ordered' | 'unordered' | 'heading'; lines: string[]; start?: number }> = [];
  let current: (typeof blocks)[number] | null = null;
  const flush = () => {
    if (current?.lines.length) blocks.push(current);
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const unordered = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,3}\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', lines: [heading[1]] });
    } else if (ordered) {
      if (current?.type !== 'ordered') {
        flush();
        current = { type: 'ordered', lines: [], start: Number(ordered[1]) };
      }
      current.lines.push(ordered[2]);
    } else if (unordered) {
      if (current?.type !== 'unordered') {
        flush();
        current = { type: 'unordered', lines: [] };
      }
      current.lines.push(unordered[1]);
    } else if (current?.type === 'paragraph') {
      current.lines.push(line.trim());
    } else {
      flush();
      current = { type: 'paragraph', lines: [line.trim()] };
    }
  }
  flush();

  return <div className="assistant-markdown">
    {blocks.map((block, index) => {
      if (block.type === 'heading') return <h3 key={index}>{renderAssistantInline(block.lines[0])}</h3>;
      if (block.type === 'ordered') return <ol key={index} start={block.start}>{block.lines.map((line, itemIndex) => <li key={itemIndex}>{renderAssistantInline(line)}</li>)}</ol>;
      if (block.type === 'unordered') return <ul key={index}>{block.lines.map((line, itemIndex) => <li key={itemIndex}>{renderAssistantInline(line)}</li>)}</ul>;
      return <p key={index}>{renderAssistantInline(block.lines.join(' '))}</p>;
    })}
  </div>;
}

const mcpEvents = [
  { tool: 'Portfolio fetcher', target: 'user_portfolio_main', latency: '12 ms', state: 'DONE' },
  { tool: 'Market data', target: 'GLOBAL_QUOTE · NVDA', latency: '85 ms', state: 'DONE' },
  { tool: 'News retrieval', target: 'TOP_HEADLINES · SEMIS', latency: '110 ms', state: 'DONE' },
  { tool: 'Synthesis agent', target: 'REASONING_CHAIN', latency: '320 ms', state: 'DONE' },
];

const assistantThinkingMessages = [
  'Reading between the price lines',
  'Turning market noise into signal',
  'Making the numbers speak plainly',
  'Shaping the clearest answer',
];

function MarketChart({ bars, provider }: { bars: DailyBar[]; provider: string }) {
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number } | null>(null);
  const low = Math.min(...bars.map((bar) => bar.low ?? bar.close));
  const high = Math.max(...bars.map((bar) => bar.high ?? bar.close));
  const span = high - low || 1;
  const points = bars.map((bar, index) => ({
    x: (index / Math.max(bars.length - 1, 1)) * 720,
    y: 200 - ((bar.close - low) / span) * 180,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L720 220 L0 220Z`;
  const labels = [bars[0].time, bars[Math.floor((bars.length - 1) / 2)].time, bars[bars.length - 1].time];
  const formatDate = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  return (
    <div className="chart-wrap" aria-label="Daily stock price chart">
      <div className="chart-y-labels"><span>{high.toFixed(2)}</span><span>{((high + low) / 2).toFixed(2)}</span><span>{low.toFixed(2)}</span></div>
      <svg className="market-chart" viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label={`${provider} daily closing prices`}>
        <defs>
          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#cf4206" stopOpacity=".24" />
            <stop offset="100%" stopColor="#cf4206" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 80, 140, 200].map((y) => <line key={y} x1="0" x2="720" y1={y} y2={y} className="chart-grid" />)}
        <path d={areaPath} fill="url(#chartFill)" />
        <path d={linePath} fill="none" stroke="#cf4206" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {hoveredPoint && <g className="chart-hover-marker"><line x1={points[hoveredPoint.index].x} x2={points[hoveredPoint.index].x} y1="12" y2="215" /><circle cx={points[hoveredPoint.index].x} cy={points[hoveredPoint.index].y} r="5" /></g>}
        <rect x="0" y="0" width="720" height="220" fill="transparent" onPointerMove={(event) => {
          const wrapper = event.currentTarget.parentElement?.getBoundingClientRect();
          const chart = event.currentTarget.getBoundingClientRect();
          if (!wrapper || !chart.width) return;
          const fraction = Math.max(0, Math.min(1, (event.clientX - chart.left) / chart.width));
          const index = Math.round(fraction * Math.max(bars.length - 1, 0));
          const point = points[index];
          const x = chart.left - wrapper.left + (point.x / 720) * chart.width;
          const y = chart.top - wrapper.top + (point.y / 220) * chart.height;
          setHoveredPoint({ index, x: Math.max(100, Math.min(wrapper.width - 100, x)), y: Math.max(38, y) });
        }} onPointerLeave={() => setHoveredPoint(null)} />
      </svg>
      {hoveredPoint && <div className="chart-tooltip" role="status" style={{ left: hoveredPoint.x, top: hoveredPoint.y }}><time>{formatDate(bars[hoveredPoint.index].time)}</time><strong>Close {bars[hoveredPoint.index].close.toFixed(2)}</strong><span>Volume {bars[hoveredPoint.index].volume.toLocaleString('en-IN')}</span></div>}
      <div className="chart-x-labels">{labels.map((label, index) => <span key={`${label}-${index}`}>{formatDate(label)}</span>)}</div>
    </div>
  );
}

function DataPending({ title, detail }: { title: string; detail: string }) {
  return <div className="tab-content data-pending"><span className="empty-mark"><Activity size={19} /></span><span className="eyebrow">LIVE DATA NOT CONNECTED</span><h2>{title}</h2><p>{detail}</p></div>;
}

function PortfolioSnapshotView({ position, importedAt, liveSeries, loading, error }: { position: PortfolioPosition; importedAt?: string; liveSeries: DailySeriesResponse | null; loading: boolean; error: string | null }) {
  const { instrument, quantity, averageCost, investedValue, currentValue, unrealizedPnl, unrealizedPnlPercent, quote } = position;
  const livePrice = liveSeries ? Number(liveSeries.latestQuote.price.amount) : null;
  return <div className="narrative-content portfolio-snapshot">
    <div className="narrative-head"><div><span className="eyebrow lime-text">{liveSeries ? liveSeries.source.provider.includes('Alpha Vantage') ? 'ALPHA VANTAGE · BSE · END OF DAY' : 'LOCAL BSE ARCHIVE · END OF DAY' : 'IMPORTED PORTFOLIO SNAPSHOT'}</span><h2>{instrument.symbol} position overview</h2></div><span className="sentiment-badge"><span /> {liveSeries ? 'BSE EOD' : 'CSV DATA'}</span></div>
    <p className="narrative-lede">{liveSeries ? `The BSE close is current market data. Position values below remain the imported CSV snapshot because its cost basis and quantity have not been reconciled for corporate actions.` : 'The imported portfolio values are available below. Alpha Vantage BSE data is loading or unavailable; the CSV price has no market timestamp.'}</p>
    <dl className="position-metrics">
      <div><dt>Quantity</dt><dd>{Number(quantity).toLocaleString('en-IN')}</dd></div>
      <div><dt>Average cost</dt><dd>{formatMoney(averageCost.amount, averageCost.currency)}</dd></div>
      <div><dt>Invested value</dt><dd>{formatMoney(investedValue.amount, investedValue.currency)}</dd></div>
      <div><dt>CSV market value</dt><dd>{formatMoney(currentValue.amount, currentValue.currency)}</dd></div>
      <div><dt>CSV unrealized P&amp;L</dt><dd className={Number(unrealizedPnl.amount) >= 0 ? 'up' : 'down'}>{formatMoney(unrealizedPnl.amount, unrealizedPnl.currency)}</dd></div>
      <div><dt>CSV return</dt><dd className={unrealizedPnlPercent >= 0 ? 'up' : 'down'}>{unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%</dd></div>
      {liveSeries && <div><dt>BSE close · {liveSeries.latestQuote.tradingDate}</dt><dd>{formatMoney(livePrice ?? 0, liveSeries.latestQuote.price.currency)}</dd></div>}
      <div><dt>ISIN</dt><dd>{instrument.isin ?? 'Not supplied'}</dd></div>
      <div><dt>Portfolio imported</dt><dd>{importedAt ? new Date(importedAt).toLocaleString() : 'Unknown'}</dd></div>
    </dl>
    <div className="disclaimer"><ShieldCheck size={14} /><span>{liveSeries ? 'CSV cost basis and quantity may predate stock splits or other corporate actions; no live position P&L is calculated from that unverified basis.' : loading ? 'Fetching BSE end-of-day data from Alpha Vantage…' : error ?? `CSV price ${formatMoney(quote.price.amount, quote.price.currency)} · timestamp unavailable.`}</span></div>
  </div>;
}

function PortfolioPriceSnapshot({ position, liveSeries, loading, error }: { position: PortfolioPosition; liveSeries: DailySeriesResponse | null; loading: boolean; error: string | null }) {
  const { instrument, averageCost, quote, unrealizedPnlPercent } = position;
  const livePrice = liveSeries ? Number(liveSeries.latestQuote.price.amount) : null;
  return <div className="tab-content chart-content portfolio-price-snapshot">
    <div className="content-title"><div><span className="eyebrow">{liveSeries ? 'BSE · DAILY · END OF DAY' : 'PORTFOLIO SNAPSHOT'}</span><h2>{liveSeries ? 'Daily price history' : 'Cost basis vs. recorded price'}</h2></div></div>
    <div className="position-comparison">
      <div><span>AVERAGE COST</span><strong>{formatMoney(averageCost.amount, averageCost.currency)}</strong></div>
      <div><span>{liveSeries ? `BSE CLOSE · ${liveSeries.latestQuote.tradingDate}` : 'CSV LAST PRICE'}</span><strong>{formatMoney(livePrice ?? Number(quote.price.amount), quote.price.currency)}</strong></div>
      <b className={liveSeries ? '' : unrealizedPnlPercent >= 0 ? 'up' : 'down'}>{liveSeries ? 'BASIS UNVERIFIED' : `${unrealizedPnlPercent >= 0 ? '+' : ''}${unrealizedPnlPercent.toFixed(2)}% CSV`}</b>
    </div>
    {liveSeries ? <><div className="chart-legend"><span><i /> {instrument.symbol} BSE daily close · {liveSeries.source.provider}</span></div><MarketChart bars={liveSeries.bars} provider={liveSeries.source.provider} /><div className="disclaimer"><Activity size={14} /><span>{liveSeries.bars.length} daily close/volume bars · latest trading date {liveSeries.latestQuote.tradingDate} · end-of-day, not intraday. CSV quantity and cost basis are not adjusted for corporate actions here.</span></div></> : <div className={`news-load-state ${error ? 'news-error' : ''}`}><Activity size={16} /><span>{loading ? `Loading BSE daily history for ${instrument.symbol}…` : error ?? 'Showing the imported CSV price only.'}</span></div>}
  </div>;
}

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Stock | null>(null);
  const [dailySeries, setDailySeries] = useState<DailySeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [similarData, setSimilarData] = useState<Awaited<ReturnType<typeof getSimilarStocks>> | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState(defaultWatchlist);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [tab, setTab] = useState<Tab>('narrative');
  const [alertVisible, setAlertVisible] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'initial-assistant-message', sender: 'ai', text: 'Choose a stock to load its market narrative, then ask me about the price move, portfolio impact, or news context.' },
  ]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState(assistantThinkingMessages[0]);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [conversationId] = useState(() => crypto.randomUUID());
  const [threshold, setThreshold] = useState(5);
  const [isListening, setIsListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [assistantMaximized, setAssistantMaximized] = useState(false);
  const [assistantClosing, setAssistantClosing] = useState(false);
  const [newsRange, setNewsRange] = useState('30d');
  const [newsData, setNewsData] = useState<NewsResponse | null>(null);
  const [newsDataKey, setNewsDataKey] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsArchiveTicker, setNewsArchiveTicker] = useState<string | null>(null);
  const [newsArchiveEnd, setNewsArchiveEnd] = useState<string | null>(null);
  const [expandedNewsGroup, setExpandedNewsGroup] = useState<string | null>(null);
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventNewsData, setEventNewsData] = useState<NewsResponse | null>(null);
  const [eventNewsLoading, setEventNewsLoading] = useState(false);
  const [eventNewsError, setEventNewsError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getPortfolio(controller.signal)
      .then((data) => {
        setPortfolio(data);
        setPortfolioError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPortfolioError(error instanceof Error ? error.message : 'Portfolio could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPortfolioLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDailySeries(null);
      setSeriesLoading(false);
      setSeriesError(null);
      return;
    }
    const controller = new AbortController();
    setDailySeries(null);
    setSeriesLoading(true);
    setSeriesError(null);
    getDailySeries(selected.ticker, controller.signal)
      .then((response) => setDailySeries(response))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSeriesError(error instanceof Error ? error.message : 'Daily history could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSeriesLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setSimilarData(null);
      setSimilarLoading(false);
      setSimilarError(null);
      return;
    }
    const controller = new AbortController();
    setSimilarData(null);
    setSimilarLoading(true);
    setSimilarError(null);
    getSimilarStocks(selected.ticker, controller.signal)
      .then((result) => setSimilarData(result))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSimilarError(error instanceof Error ? error.message : 'Peer ranking could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSimilarLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setNewsData(null);
      setNewsDataKey(null);
      setNewsLoading(false);
      setNewsError(null);
      return;
    }
    const controller = new AbortController();
    const requestKey = `${selected.ticker}:${newsRange}`;
    const isPortfolioArchive = selected.source === 'portfolio-csv';
    const hasArchiveAnchor = isPortfolioArchive && newsArchiveTicker === selected.ticker && newsArchiveEnd !== null;
    const end = hasArchiveAnchor ? new Date(newsArchiveEnd) : new Date();
    end.setUTCSeconds(0, 0);
    const rangeMilliseconds: Record<string, number> = {
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const from = new Date(end.getTime() - rangeMilliseconds[newsRange]).toISOString();
    const to = end.toISOString();
    setNewsLoading(true);
    setNewsError(null);
    getNews(selected.ticker, isPortfolioArchive && !hasArchiveAnchor ? undefined : from, isPortfolioArchive && !hasArchiveAnchor ? undefined : to, controller.signal)
      .then((response) => {
        setNewsData(response);
        setNewsDataKey(requestKey);
        setNewsError(null);
        if (isPortfolioArchive && !hasArchiveAnchor) {
          setNewsArchiveTicker(selected.ticker);
          setNewsArchiveEnd(response.range.to);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setNewsError(error instanceof Error ? error.message : 'News could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setNewsLoading(false);
      });
    return () => controller.abort();
  }, [newsArchiveEnd, newsArchiveTicker, newsRange, selected]);

  const currentNewsKey = selected ? `${selected.ticker}:${newsRange}` : null;
  const visibleNewsData = newsDataKey === currentNewsKey ? newsData : null;
  const activeSeries = dailySeries?.instrument.symbol === selected?.ticker ? dailySeries : null;
  const displayedPrice = activeSeries ? Number(activeSeries.latestQuote.price.amount) : selected?.price ?? 0;
  const displayedChange = activeSeries ? Number(activeSeries.latestQuote.change.amount) : selected?.changeValue ?? 0;
  const displayedChangePercent = activeSeries ? activeSeries.latestQuote.changePercent : selected?.change ?? 0;
  const displayedCurrency = activeSeries?.latestQuote.price.currency ?? selected?.currency ?? 'USD';
  const portfolioValue = Number(portfolio?.totals.currentValue.amount ?? 0);

  useEffect(() => {
    if (!activeSeries) return;
    setEventStartDate(activeSeries.bars[0].time);
    setEventEndDate(activeSeries.latestQuote.tradingDate);
    setSelectedEventId('');
  }, [activeSeries?.instrument.symbol, activeSeries?.latestQuote.tradingDate]);

  const visibleStocks = stockUniverse.filter((stock) => watchlist.includes(stock.ticker)).filter((stock) => {
    const matchesSearch = `${stock.ticker} ${stock.name}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'All' || stock.industry.toLowerCase().includes(filter.toLowerCase());
    return matchesSearch && matchesFilter;
  });

  const recommendations = similarData && similarData.instrument.symbol === selected?.ticker ? similarData.matches : [];
  const analyticsEvents = (activeSeries?.bars ?? []).flatMap((bar, index, bars) => {
    if (index === 0) return [];
    const previous = bars[index - 1];
    const magnitude = (bar.close / previous.close - 1) * 100;
    if (bar.time < eventStartDate || bar.time > eventEndDate || Math.abs(magnitude) < threshold) return [];
    const baselineVolumes = bars.slice(Math.max(0, index - 20), index).map((item) => item.volume).filter((volume) => volume > 0);
    const averageVolume = baselineVolumes.length ? baselineVolumes.reduce((sum, volume) => sum + volume, 0) / baselineVolumes.length : 0;
    return [{
      id: `${selected?.ticker}-${bar.time}`,
      date: bar.time,
      magnitude,
      direction: magnitude >= 0 ? 'UP' as const : 'DOWN' as const,
      volumeMultiple: averageVolume ? bar.volume / averageVolume : null,
      headline: `${selected?.ticker} daily close moved ${magnitude >= 0 ? '+' : ''}${magnitude.toFixed(2)}%`,
    }];
  });
  const activeEvent = analyticsEvents.find((event) => event.id === selectedEventId) ?? analyticsEvents[0];
  const selectedEventNews = eventNewsData?.articles ?? [];
  const groupedNews = groupNewsArticles(visibleNewsData?.articles ?? []);

  useEffect(() => {
    if (!selected || !activeEvent) return;
    const controller = new AbortController();
    const eventDate = new Date(`${activeEvent.date}T12:00:00Z`);
    const from = new Date(eventDate.getTime() - 5 * 86400000).toISOString();
    const to = new Date(eventDate.getTime() + 5 * 86400000).toISOString();
    setEventNewsData(null);
    setEventNewsLoading(true);
    setEventNewsError(null);
    getNews(selected.ticker, from, to, controller.signal)
      .then((response) => setEventNewsData(response))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setEventNewsError(error instanceof Error ? error.message : 'Event news could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventNewsLoading(false);
      });
    return () => controller.abort();
  }, [activeEvent?.date, selected]);

  function selectStock(stock: Stock) {
    const portfolioPosition = portfolio?.positions.find((position) => position.instrument.symbol === stock.ticker);
    setSelected(stock.source === 'portfolio-csv' ? stock : portfolioPosition ? portfolioPositionToStock(portfolioPosition) : stock);
    setTab('narrative');
    setMobileMenuOpen(false);
    setSuggestionsOpen(true);
    setSelectedEventId('');
  }

  function selectPortfolioPosition(position: PortfolioPosition) {
    selectStock(portfolioPositionToStock(position));
  }

  async function selectRankedInstrument(symbol: string) {
    try {
      const instrument = await getInstrument(symbol);
      selectStock({
        ticker: instrument.symbol,
        name: instrument.name,
        price: 0,
        change: 0,
        changeValue: 0,
        volume: 'Loading',
        marketCap: 'Not supplied',
        industry: instrument.industry ?? 'Other',
        positive: true,
        currency: instrument.currency,
        source: 'demo',
      });
    } catch (error) {
      setSimilarError(error instanceof Error ? error.message : 'Could not load this BSE listing.');
    }
  }

  function addToWatchlist(ticker: string) {
    setWatchlist((current) => current.includes(ticker) ? current : [...current, ticker]);
  }

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: typing ? 'auto' : 'smooth' });
    });
  }, [messages, typing, assistantMaximized]);

  useEffect(() => {
    if (!typing) return;
    let index = 0;
    setThinkingMessage(assistantThinkingMessages[index]);
    const timer = window.setInterval(() => {
      index = (index + 1) % assistantThinkingMessages.length;
      setThinkingMessage(assistantThinkingMessages[index]);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [typing]);

  function toggleAssistant() {
    if (assistantClosing) return;
    if (assistantMaximized) {
      setAssistantClosing(true);
      window.setTimeout(() => {
        setAssistantMaximized(false);
        setAssistantClosing(false);
      }, 220);
      return;
    }
    setAssistantMaximized(true);
  }

  function discussEventInAssistant() {
    setAssistantMaximized(true);
    setAssistantClosing(false);
    sendMessage(`Explain the ${selected?.ticker ?? 'stock'} price deviation and its five-day news window`);
  }

  async function sendMessage(text = chatInput) {
    if (!text.trim() || typing) return;
    const message = text.trim();
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    setMessages((current) => [...current, { id: userMessageId, sender: 'user', text: message }]);
    setChatInput('');
    setFollowUpQuestions([]);
    setTyping(true);
    setMessages((current) => [...current, { id: assistantMessageId, sender: 'ai', text: '' }]);
    try {
      await streamChat(
        { conversationId, message, symbol: selected?.ticker },
        (token) => setMessages((current) => current.map((item) => item.id === assistantMessageId ? { ...item, text: item.text + token } : item)),
        (questions) => setFollowUpQuestions(questions),
        () => setTyping(false),
      );
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === assistantMessageId
        ? { ...item, text: error instanceof Error ? error.message : 'The conversation model is unavailable.' }
        : item));
    } finally {
      setTyping(false);
    }
  }

  function onChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  function toggleVoiceInput() {
    const speechWindow = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceMessage('Voice input is not supported by this browser.');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setChatInput(transcript);
        setVoiceMessage('Voice input captured. Review it, then send.');
      }
    };
    recognition.onerror = () => {
      setVoiceMessage('Voice input could not start. Check microphone permission.');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setVoiceMessage('Listening…');
    setIsListening(true);
  }

  return (
    <div className={`app-shell ${darkMode ? 'theme-dark' : 'theme-light'}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="StockNarrative home">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.2} /></span>
          <span className="brand-copy"><strong>stock<span>narrative</span></strong><small>MARKET INTELLIGENCE</small></span>
        </a>
        <div className="global-search">
          <Search size={16} />
          <input aria-label="Search ticker or company" placeholder="Search a company or ticker" value={search} onChange={(event) => setSearch(event.target.value)} />
          <kbd>/</kbd>
        </div>
        <div className="top-actions">
          <button className="icon-button mobile-menu" title="Open watchlist" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><Menu size={18} /></button>
          <button className="icon-button" title="Toggle color theme" onClick={() => setDarkMode(!darkMode)}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button notification-button" title="Notifications"><Bell size={17} /><i /></button>
          <button className={`logs-button ${logsOpen ? 'is-active' : ''}`} onClick={() => setLogsOpen(!logsOpen)}><Cpu size={15} /><span>Agent activity</span><span className="live-dot" /></button>
          <div className="avatar" title="Demo profile">JD</div>
        </div>
      </header>

      {alertVisible && <section className="alert-strip">
        <span className="alert-kicker"><Sparkles size={13} /> SIGNAL DETECTED</span>
        <p><strong>NVDA +6.4%</strong><span className="alert-divider">/</span> AI infrastructure guidance is moving the semiconductor basket.</p>
        <button onClick={() => selectStock(stocks[0])} className="alert-link">Read analysis <ArrowUpRight size={14} /></button>
        <button className="alert-close" title="Dismiss alert" onClick={() => setAlertVisible(false)}><X size={15} /></button>
      </section>}

      {logsOpen && <section className="activity-drawer">
        <div className="drawer-heading"><div><span className="eyebrow">SYSTEM TRACE</span><h2>Agent activity</h2></div><button className="icon-button" onClick={() => setLogsOpen(false)} title="Close activity"><X size={17} /></button></div>
        <div className="activity-list">{mcpEvents.map((event) => <div className="activity-row" key={event.tool}><span className="activity-check"><Check size={13} /></span><div><strong>{event.tool}</strong><small>{event.target}</small></div><span className="activity-latency">{event.latency}</span><span className="activity-state">{event.state}</span></div>)}</div>
        <p className="drawer-footnote">Demo trace · No external services connected</p>
      </section>}

      <main className="dashboard" id="top">
        <aside className={`left-rail ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <section className="panel portfolio-panel">
            <div className="panel-heading"><div><span className="eyebrow">ACCOUNT OVERVIEW</span><h2><BriefcaseBusiness size={15} /> Portfolio</h2></div><button className="small-icon" title="Portfolio options"><Settings2 size={15} /></button></div>
            <div className="portfolio-total"><span>Current value · {portfolio?.baseCurrency ?? 'INR'}</span><strong>{formatMoney(portfolioValue, portfolio?.baseCurrency ?? 'INR')}</strong><small>{portfolioLoading ? 'Loading local portfolio…' : portfolio ? `CSV snapshot imported ${new Date(portfolio.asOf).toLocaleString()}` : 'Portfolio snapshot unavailable'}</small></div>
            <div className="portfolio-columns"><span>POSITION</span><span>UNITS</span><span>INVESTED</span><span>VALUE</span></div>
            <div className="portfolio-positions">{portfolio?.positions.map((position) => <button className="portfolio-position" key={position.instrument.instrumentId} onClick={() => selectPortfolioPosition(position)}>
              <strong>{position.instrument.symbol}</strong><span>{Number(position.quantity).toLocaleString('en-IN')}</span><span>{formatMoney(position.investedValue.amount, position.investedValue.currency)}</span><span>{formatMoney(position.currentValue.amount, position.currentValue.currency)}</span>
              <small>Unrealized P&amp;L <b>{position.unrealizedPnlPercent >= 0 ? '+' : ''}{position.unrealizedPnlPercent.toFixed(2)}%</b><em>{formatMoney(position.unrealizedPnl.amount, position.unrealizedPnl.currency)}</em></small>
            </button>)}{!portfolioLoading && !portfolio?.positions.length && <div className="empty-state">{portfolioError ?? 'No portfolio positions found.'}</div>}</div>
            <div className="portfolio-disclaimer">{portfolioError ? `Local API: ${portfolioError}` : 'Values are from your CSV snapshot; its market-price timestamp was not provided.'}</div>
          </section>

          <section className="panel watchlist-panel">
            <div className="panel-heading"><div><span className="eyebrow">YOUR MARKETS</span><h2><Bookmark size={15} /> Watchlist <span className="count">{visibleStocks.length}</span></h2></div><button className="small-icon" title="Add symbol"><Plus size={16} /></button></div>
            <label className="watch-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a symbol" /></label>
            <div className="filter-row" aria-label="Filter watchlist">
              {['All', 'Semiconductors', 'Cloud', 'Electric'].map((item) => <button key={item} onClick={() => setFilter(item === 'Electric' ? 'Electric' : item)} className={filter === item ? 'selected' : ''}>{item === 'Semiconductors' ? 'Chips' : item === 'Electric' ? 'EV' : item}</button>)}
            </div>
            <div className="stock-list">
              {visibleStocks.map((stock) => <button className={`stock-row ${selected?.ticker === stock.ticker ? 'stock-selected' : ''}`} key={stock.ticker} onClick={() => selectStock(stock)}>
                <span className="stock-symbol"><strong>{stock.ticker}</strong><small>{stock.name}</small></span>
                <span className="stock-quote"><strong>${stock.price.toFixed(2)}</strong><small className={stock.positive ? 'up' : 'down'}>{stock.positive ? '+' : ''}{stock.change.toFixed(2)}%</small></span>
              </button>)}
              {visibleStocks.length === 0 && <div className="empty-state">No matching symbols.</div>}
            </div>
            <button className="manage-watchlist">Manage watchlist <ArrowUpRight size={13} /></button>
          </section>

          <div className="privacy-note"><ShieldCheck size={15} /><span>Portfolio details stay private<br />and under your control.</span><CircleHelp size={14} /></div>
        </aside>

        <section className="main-column">
          {selected ? <>
          <section className="panel quote-panel">
            <div className="quote-topline"><span className="market-status"><i /> {activeSeries ? activeSeries.source.provider.includes('Alpha Vantage') ? selected.source === 'portfolio-csv' ? 'ALPHA VANTAGE · BSE · END OF DAY' : 'ALPHA VANTAGE · END OF DAY' : 'LOCAL BSE ARCHIVE · END OF DAY' : selected.source === 'portfolio-csv' ? seriesLoading ? 'LOADING BSE MARKET DATA' : 'IMPORTED PORTFOLIO SNAPSHOT' : seriesLoading ? 'LOADING ALPHA VANTAGE DATA' : 'ALPHA VANTAGE DATA UNAVAILABLE'}</span><span className="quote-time">{activeSeries ? `TRADING DATE · ${activeSeries.latestQuote.tradingDate}` : selected.source === 'portfolio-csv' ? 'CSV LTP · Timestamp unavailable' : seriesError ? 'Provider request failed' : 'Loading daily market data'} <ChevronDown size={13} /></span></div>
            <div className="quote-main">
              <div><div className="company-line"><span className="ticker-label">{selected.ticker}</span><span className="company-name">{selected.name}</span></div><div className="price-line"><strong>{seriesLoading && !activeSeries ? 'Loading…' : formatMoney(displayedPrice, displayedCurrency)}</strong><span className={displayedChange >= 0 ? 'up' : 'down'}>{displayedChange >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{displayedChange >= 0 ? '+' : ''}{formatMoney(displayedChange, displayedCurrency)} ({displayedChangePercent.toFixed(2)}%{selected.source === 'portfolio-csv' && !activeSeries ? ' CSV P&L' : activeSeries ? ' DAY' : ''})</span></div></div>
                <div className="quote-actions"><button className="save-button" onClick={() => setSuggestionsOpen(true)} title="Show related stocks"><Target size={15} /><span>Related</span></button><button className="save-button" title="Save to watchlist" onClick={() => addToWatchlist(selected.ticker)}><Bookmark size={16} /><span>{watchlist.includes(selected.ticker) ? 'Saved' : 'Save'}</span></button></div>
            </div>
            <div className="quote-stats"><div><span>{selected.source === 'portfolio-csv' ? 'QUANTITY' : 'VOLUME'}</span><strong>{selected.portfolioPosition ? Number(selected.portfolioPosition.quantity).toLocaleString('en-IN') : activeSeries ? activeSeries.latestQuote.volume.toLocaleString('en-IN') : seriesLoading ? 'Loading…' : '—'}</strong></div><div><span>{selected.source === 'portfolio-csv' ? 'AVERAGE COST' : 'MARKET CAP'}</span><strong>{selected.portfolioPosition ? formatMoney(selected.portfolioPosition.averageCost.amount, selected.portfolioPosition.averageCost.currency) : 'Not supplied'}</strong></div><div><span>{selected.source === 'portfolio-csv' ? 'INVESTED VALUE' : 'INDUSTRY'}</span><strong>{selected.portfolioPosition ? formatMoney(selected.portfolioPosition.investedValue.amount, selected.portfolioPosition.investedValue.currency) : selected.industry}</strong></div><div><span>{selected.source === 'portfolio-csv' ? 'CSV MARKET VALUE' : 'DAY RANGE'}</span><strong>{selected.portfolioPosition ? formatMoney(selected.portfolioPosition.currentValue.amount, selected.portfolioPosition.currentValue.currency) : 'Not supplied'}</strong></div></div>
          </section>

          {suggestionsOpen && <section className="related-popup panel" aria-label="Related stocks">
            <div className="related-popup-heading"><div><span className="eyebrow">RELATED TO {selected.ticker}</span><h2><Target size={14} /> Similar stocks</h2></div><button className="small-icon" title="Close suggestions" aria-label="Close suggestions" onClick={() => setSuggestionsOpen(false)}><X size={15} /></button></div>
            <p className="suggestion-basis">Industry, supply-chain, and shared-exposure matches.</p>
            {similarLoading ? <p className="empty-state">Comparing BSE sector and price history…</p>
              : similarError ? <p className="empty-state">{similarError}</p>
                : recommendations.length ? <>
                  {similarData && <p className="suggestion-basis">Ranked from sector, overlapping returns, and daily-return correlation · {similarData.window.from} to {similarData.window.to}</p>}
                  {recommendations.map((match) => <article className="suggestion-row" key={match.instrument.instrumentId}>
                    <button className="suggestion-select" onClick={() => void selectRankedInstrument(match.instrument.symbol)}><strong>{match.instrument.symbol}</strong><span>{match.instrument.name}</span><small><i style={{ width: `${match.similarityScore * 100}%` }} />{Math.round(match.similarityScore * 100)}% data similarity</small><small>{match.evidence.join(' · ')}</small></button>
                    <button className="suggestion-add" title={`Add ${match.instrument.symbol} to watchlist`} onClick={() => addToWatchlist(match.instrument.symbol)}>{watchlist.includes(match.instrument.symbol) ? <Check size={14} /> : <Plus size={14} />}</button>
                  </article>)}
                </> : <p className="empty-state">No ranked peers are available in this local dataset.</p>}
          </section>}

          <section className="panel intelligence-panel">
            <nav className="tab-bar" aria-label="Stock analysis sections">
              <button className={tab === 'narrative' ? 'active' : ''} onClick={() => setTab('narrative')}><Sparkles size={15} /> Narrative</button>
              <button className={tab === 'technicals' ? 'active' : ''} onClick={() => setTab('technicals')}><Activity size={15} /> Price action</button>
              <button className={tab === 'news' ? 'active' : ''} onClick={() => setTab('news')}><Newspaper size={15} /> News <span className="tab-count">{visibleNewsData?.articleCount ?? (newsLoading ? '…' : '—')}</span></button>
              <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}><CalendarDays size={15} /> Advanced analytics</button>
              <span className="updated-label">UPDATED JUST NOW</span>
            </nav>

            {tab === 'narrative' && (selected.source === 'portfolio-csv' && selected.portfolioPosition ? <PortfolioSnapshotView position={selected.portfolioPosition} importedAt={portfolio?.asOf} liveSeries={activeSeries} loading={seriesLoading} error={seriesError} /> : selected.source === 'portfolio-csv' ? <DataPending title="Portfolio position details are unavailable" detail="Reload the local portfolio snapshot and select the position again." /> : <div className="narrative-content">
              <div className="narrative-head"><div><span className="eyebrow lime-text">TODAY'S MARKET STORY</span><h2>AI demand is pulling the whole supply chain higher.</h2></div><span className="sentiment-badge"><span /> STRONGLY BULLISH</span></div>
              <p className="narrative-lede">A fresh wave of data-center spending from major cloud providers has reset expectations for accelerator demand. The move in {selected.ticker} is being reinforced by rising trading volume, not just headline momentum.</p>
              <div className="confidence-row"><div className="confidence-copy"><ShieldCheck size={15} /><span>Source confidence</span><strong>96%</strong></div><div className="confidence-track"><i /></div><span className="source-count">24 sources</span></div>
              <div className="section-rule"><span>WHAT'S DRIVING IT</span><span>3 SIGNALS</span></div>
              <div className="driver-list">
                <article className="driver-row"><span className="driver-index">01</span><span className="driver-icon positive-icon"><ArrowUpRight size={16} /></span><div><h3>Cloud capex guidance climbs</h3><p>Microsoft, Meta and Google raised infrastructure outlooks, adding a combined $14B to expected spend.</p></div><span className="impact-tag positive-tag">HIGH IMPACT</span></article>
                <article className="driver-row"><span className="driver-index">02</span><span className="driver-icon positive-icon"><Activity size={15} /></span><div><h3>Supply constraints ease</h3><p>Foundry utilization remains elevated, while lead-time reports point to improving near-term availability.</p></div><span className="impact-tag positive-tag">SUPPORTIVE</span></article>
                <article className="driver-row"><span className="driver-index">03</span><span className="driver-icon neutral-icon"><Globe2 size={15} /></span><div><h3>Export policy remains a watchpoint</h3><p>Recent guidance clarified regional exceptions, but policy changes can still add volatility.</p></div><span className="impact-tag neutral-tag">MONITOR</span></article>
              </div>
              <div className="timeline-block"><div className="section-rule"><span>SESSION TIMELINE</span><button onClick={() => setTab('technicals')}>View chart <ArrowUpRight size={12} /></button></div><div className="timeline-event"><time>10:15</time><span className="timeline-dot" /><p><strong>Momentum accelerated</strong> after an analyst target revision, alongside a 1.8× volume burst.</p></div><div className="timeline-event"><time>09:30</time><span className="timeline-dot muted-dot" /><p><strong>Opening gap higher</strong> as cloud partner results reset the AI infrastructure outlook.</p></div></div>
              <div className="projection-card"><div className="projection-icon"><TrendingUp size={16} /></div><div className="projection-copy"><span className="eyebrow">ASSISTANT PROJECTION · 12 MONTHS</span><strong>Forecast service not connected</strong><small>No model-generated range is available yet.</small></div><span className="projection-upside">PENDING</span><p>A projection will appear after the backend forecast endpoint and calibration data are connected. No estimate is fabricated from the current UI demo.</p></div>
              <div className="disclaimer"><ShieldCheck size={14} /><span>AI-generated market context, not investment advice. Verify primary sources before acting.</span></div>
            </div>)}

            {tab === 'technicals' && (selected.source === 'portfolio-csv' && selected.portfolioPosition ? <PortfolioPriceSnapshot position={selected.portfolioPosition} liveSeries={activeSeries} loading={seriesLoading} error={seriesError} /> : selected.source === 'portfolio-csv' ? <DataPending title="Historical price data is unavailable" detail="Reload the local portfolio snapshot and select the position again." /> : <div className="tab-content chart-content"><div className="content-title"><div><span className="eyebrow">DAILY · END OF DAY</span><h2>Price action</h2></div><span className="eyebrow">{activeSeries ? `${activeSeries.bars.length} TRADING DAYS` : ''}</span></div>{activeSeries ? <><div className="chart-legend"><span><i /> {selected.ticker} daily close · {activeSeries.source.provider}</span></div><MarketChart bars={activeSeries.bars} provider={activeSeries.source.provider} /><div className="disclaimer"><Activity size={14} /><span>Daily close/volume history · last trading date {activeSeries.latestQuote.tradingDate} · end-of-day data, not intraday.</span></div></> : <div className={`news-load-state ${seriesError ? 'news-error' : ''}`}><Activity size={16} /><span>{seriesLoading ? `Loading daily history for ${selected.ticker}…` : seriesError ?? 'Daily history is not available.'}</span></div>}</div>)}

            {tab === 'news' && <div className="tab-content news-content">
              <div className="content-title"><div><span className="eyebrow">{visibleNewsData?.source.provider.includes('BSE') ? `BSE ARCHIVE · THROUGH ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(visibleNewsData.range.to))}` : `COVERAGE · ${newsRange.toUpperCase()}`}</span><h2>News and sentiment</h2></div><label className="news-range-control"><span>TIME WINDOW</span><select value={newsRange} onChange={(event) => setNewsRange(event.target.value)}><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label></div>
              {visibleNewsData && !newsLoading && <div className="news-summary">{visibleNewsData.aggregateSentiment ? <><span className={`sentiment-badge ${sentimentTone(visibleNewsData.aggregateSentiment.score)}`}><span /> {visibleNewsData.aggregateSentiment.label.replace(/_/g, ' ').toUpperCase()}</span><span>{visibleNewsData.articleCount} articles · {visibleNewsData.source.provider.includes('lexicon') ? 'Experimental rule-based headline sentiment' : 'Provider sentiment'} {visibleNewsData.aggregateSentiment.score >= 0 ? '+' : ''}{visibleNewsData.aggregateSentiment.score.toFixed(2)}</span></> : <><span className="sentiment-badge neutral-tag"><span /> NOT SCORED</span><span>{visibleNewsData.articleCount} archived articles · No recognizable sentiment cues in headlines</span></>}</div>}
              {newsLoading ? <div className="news-load-state"><Activity size={16} /> Loading {selected.source === 'portfolio-csv' ? 'archived BSE coverage' : 'Alpha Vantage coverage'} for {selected.ticker}…</div>
                : newsError ? <div className="news-load-state news-error"><Newspaper size={16} /><span>{newsError}</span></div>
                  : visibleNewsData?.articleCount === 0 ? <div className="news-load-state"><Newspaper size={16} /> No articles were returned for this symbol and time window.</div>
                    : <div className="news-groups">{groupedNews.map((group) => <section className="news-group" key={group.id}>
                <button className="news-group-toggle" aria-expanded={expandedNewsGroup === group.id} onClick={() => setExpandedNewsGroup(expandedNewsGroup === group.id ? null : group.id)}>
                  <span className="news-group-title"><strong>{group.headline}</strong><small>{group.articles.length} articles · {group.sentiment} topic sentiment</small></span>
                  <span className="aggregate-sentiment"><i style={{ width: group.score === null ? '0%' : `${Math.abs(group.score) * 100}%` }} />{group.score === null ? '—' : `${group.score > 0 ? '+' : ''}${group.score.toFixed(2)}`}</span><span className="news-group-chevron">{expandedNewsGroup === group.id ? '−' : '+'}</span>
                </button>
                {expandedNewsGroup === group.id && <div className="news-articles">{group.articles.map((article) => {
                  const articleScore = article.tickerSentiment?.score ?? article.overallSentiment?.score ?? null;
                  return <article className="news-card" key={article.articleId}>
                    <div className="news-card-top"><span>{article.source.toUpperCase()} · {article.sourceDomain}</span><time dateTime={article.publishedAt}>{visibleNewsData?.source.provider.includes('BSE') ? formatPublishedAt(article.publishedAt) : timeAgo(article.publishedAt)}</time></div><h3>{article.title}</h3>{article.summary && <p className="news-card-summary">{article.summary}</p>}<div className="news-card-bottom"><span className={`news-tone ${sentimentTone(articleScore ?? 0)}`}>{article.tickerSentiment?.label ?? article.overallSentiment?.label ?? 'Not scored'}</span>{article.tickerSentiment && <span>Ticker relevance {(article.tickerSentiment.relevance * 100).toFixed(0)}%</span>}<a href={article.url} target="_blank" rel="noreferrer" aria-label={`Open article from ${article.source}`}><ExternalLink size={14} /></a></div>
                  </article>;
                })}</div>}
              </section>)}</div>
              }
              <div className="disclaimer"><ShieldCheck size={14} /><span>{visibleNewsData?.source.provider ?? 'News provider'} · Local sentiment is an experimental headline wordlist signal, not full-text analysis. No source credibility is inferred.</span></div>
            </div>}

            {tab === 'analytics' && <div className="tab-content analytics-content">
              <div className="content-title"><div><span className="eyebrow">OBSERVED DAILY PRICE MOVES</span><h2>Deviation timeline</h2></div><label className="threshold-control"><span>SPIKE THRESHOLD</span><select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}><option value={3}>±3%</option><option value={5}>±5%</option><option value={8}>±8%</option></select></label></div>
              <div className="event-range-controls"><label><span>FROM</span><input type="date" value={eventStartDate} max={eventEndDate || undefined} onChange={(event) => setEventStartDate(event.target.value)} /></label><label><span>TO</span><input type="date" value={eventEndDate} min={eventStartDate || undefined} max={activeSeries?.latestQuote.tradingDate} onChange={(event) => setEventEndDate(event.target.value)} /></label><span className="range-help">Events use close-to-close returns from available daily data.</span></div>
              <div className="event-picker-heading"><span>DETECTED DEVIATIONS</span><span>{analyticsEvents.length} in range</span></div>
              {!activeSeries ? <div className={`no-events ${seriesError ? 'news-error' : ''}`}><Activity size={16} />{seriesLoading ? 'Loading daily history…' : seriesError ?? 'Daily history is unavailable for this symbol.'}</div>
                : analyticsEvents.length ? <div className="event-scenarios">{analyticsEvents.map((event) => <button key={event.id} className={`event-scenario ${activeEvent?.id === event.id ? 'event-scenario-active' : ''}`} onClick={() => setSelectedEventId(event.id)}><span className="scenario-date">{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${event.date}T12:00:00Z`))}</span><span className="scenario-copy"><strong>{event.headline}</strong><small>{event.volumeMultiple === null ? 'Volume baseline unavailable' : `${event.volumeMultiple.toFixed(2)}× 20-day average volume`} · close-to-close</small></span><span className={event.direction === 'UP' ? 'scenario-move positive-move' : 'scenario-move negative-move'}>{event.direction === 'UP' ? '+' : ''}{event.magnitude.toFixed(2)}%</span></button>)}</div>
                  : <div className="no-events"><Activity size={16} /> No daily close move meets ±{threshold}% in this date range.</div>}
              {activeEvent && <>
                <div className="event-window-heading"><div><span className="eyebrow">ARCHIVED NEWS WINDOW · ±5 DAYS</span><strong>{activeEvent.date} · {activeEvent.direction === 'UP' ? '+' : ''}{activeEvent.magnitude.toFixed(2)}% close-to-close</strong></div><span>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${shiftUtcDate(activeEvent.date, -5)}T12:00:00Z`))} — {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${shiftUtcDate(activeEvent.date, 5)}T12:00:00Z`))}</span></div>
                {eventNewsLoading ? <div className="news-load-state"><Activity size={16} /> Checking archived news around {activeEvent.date}…</div>
                  : eventNewsError ? <div className="news-load-state news-error"><Newspaper size={16} /><span>{eventNewsError}</span></div>
                    : !eventNewsData?.articles.length ? <div className="no-events"><Newspaper size={16} /> No archived news articles were found within five days of this deviation.</div>
                      : <div className="event-timeline">{selectedEventNews.map((article) => {
                        const offsetDays = Math.round((Date.parse(article.publishedAt) - Date.parse(`${activeEvent.date}T12:00:00Z`)) / 86400000);
                        const relation = offsetDays === 0 ? 'EVENT DAY' : `${Math.abs(offsetDays)} DAYS ${offsetDays < 0 ? 'BEFORE' : 'AFTER'}`;
                        const sentiment = article.overallSentiment?.label ?? 'Not scored';
                        return <article className={`event-news ${offsetDays === 0 ? 'event-news-trigger' : ''}`} key={article.articleId}>
                          <div className="event-news-date"><time dateTime={article.publishedAt}>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(article.publishedAt))}</time><i /></div><div className="event-news-body"><span className="event-relation">{relation} · {article.source}</span><h3>{article.title}</h3><span className="news-tone neutral-tag">{sentiment}</span></div>
                        </article>;
                      })}</div>}
                <div className="correlation-note"><Sparkles size={15} /><p><strong>Observed evidence</strong> A date-window match shows temporal overlap only; it does not establish that an article caused the price deviation.</p><button onClick={discussEventInAssistant}>Discuss in assistant <ArrowUpRight size={13} /></button></div>
              </>}
              <div className="disclaimer"><ShieldCheck size={14} /><span>Deviation is computed from local daily closes. Volume multiple uses the prior 20 available rows; news comes only from the archived BSE headline corpus.</span></div>
            </div>}
          </section>
          </> : <section className="panel detail-empty"><span className="empty-mark"><Activity size={21} /></span><span className="eyebrow">YOUR MARKET DESK</span><h1>Start with a stock.</h1><p>Select a symbol from your watchlist or portfolio to open its price, narrative, news, and event analytics here.</p><div className="empty-metrics"><span><strong>{formatMoney(portfolioValue, portfolio?.baseCurrency ?? 'INR')}</strong><small>PORTFOLIO VALUE</small></span><span><strong>{portfolio?.positions.length ?? (portfolioLoading ? '…' : '0')}</strong><small>PORTFOLIO POSITIONS</small></span><span><strong>{watchlist.length}</strong><small>WATCHLIST SYMBOLS</small></span></div><div className="empty-hint"><Search size={15} /> Choose a holding or watchlist symbol.</div></section>}
        </section>

        <aside className={`right-rail ${assistantMaximized || assistantClosing ? 'assistant-maximized' : ''} ${assistantClosing ? 'assistant-closing' : ''}`}>
          <section className="panel assistant-panel">
            <div className="assistant-heading"><div className="assistant-icon"><Sparkles size={16} /></div><div><h2>Financial assistant</h2><span><i /> {selected?.source === 'portfolio-csv' ? 'PORTFOLIO SNAPSHOT LOADED' : selected ? 'MARKET CONTEXT READY' : 'READY WHEN YOU ARE'}</span></div><div className={`assistant-wave ${typing || isListening ? 'wave-active' : ''}`} aria-hidden="true"><i /><i /><i /><i /><i /></div><button className="small-icon" title={assistantMaximized && !assistantClosing ? 'Minimize assistant' : 'Maximize assistant'} aria-label={assistantMaximized && !assistantClosing ? 'Minimize assistant' : 'Maximize assistant'} onClick={toggleAssistant}>{assistantMaximized && !assistantClosing ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
            <div className="assistant-context"><span>{selected ? 'ASKING ABOUT' : 'MARKET CONTEXT'}</span><strong>{selected ? <>{selected.ticker} <span>·</span> {selected.name}</> : 'Select a stock to add its narrative'}</strong></div>
            {selected && <div className="assistant-briefing"><span><Sparkles size={12} /> {activeSeries ? activeSeries.source.provider.toUpperCase() : 'PORTFOLIO SNAPSHOT'}</span><p>{activeSeries ? <><strong>{selected.ticker}</strong> · daily close {activeSeries.latestQuote.price.amount} {activeSeries.latestQuote.price.currency} on {activeSeries.latestQuote.tradingDate}. Deviations are computed from observed closes; nearby news appears only when the archive has a match.</> : <><strong>{selected.ticker}</strong> is loaded from the imported portfolio snapshot. Waiting for the selected local market-data series; CSV return remains separate.</>}</p><button onClick={() => setTab('analytics')}>Open deviation timeline <ArrowUpRight size={12} /></button></div>}
            <div className="messages" ref={messagesRef} aria-live="polite">{messages.map((message) => <div className={`message ${message.sender}`} key={message.id}><span className="message-label">{message.sender === 'ai' ? 'NARRATIVE AI' : 'YOU'}</span>{message.sender === 'ai' ? <AssistantMessage text={message.text} /> : <p>{message.text}</p>}</div>)}{typing && <div className="typing-indicator"><i /><i /><i /> {thinkingMessage}</div>}</div>
            {!typing && followUpQuestions.length > 0 && <><div className="prompt-label">TRY ASKING</div><div className="prompt-list">{followUpQuestions.map((question) => <button key={question} onClick={() => sendMessage(question)}>{question} <ArrowUpRight size={13} /></button>)}</div></>}
            <form className="chat-form" onSubmit={onChatSubmit}><input aria-label="Ask a market question" placeholder="Ask about this move..." value={chatInput} onChange={(event) => setChatInput(event.target.value)} /><button className={`voice-button ${isListening ? 'listening' : ''}`} type="button" title={isListening ? 'Stop voice input' : 'Start voice input'} aria-label={isListening ? 'Stop voice input' : 'Start voice input'} onClick={toggleVoiceInput}>{isListening ? <MicOff size={15} /> : <Mic size={15} />}</button><button type="submit" title="Send question" disabled={typing || !chatInput.trim()}><Send size={15} /></button></form>
            {voiceMessage && <div className="voice-status" aria-live="polite">{voiceMessage}</div>}
            <div className="assistant-foot"><span><Cpu size={13} /> CLOUDFLARE WORKERS AI</span><span>No credentials or sensitive account data handled</span></div>
          </section>
        </aside>
      </main>

      <footer className="page-footer"><span>STOCKNARRATIVE <b>·</b> MARKET INTELLIGENCE</span><span className="cloudflare-credit"><Cloud size={13} /> CLOUDFLARE WORKERS · ACTIVE BACKEND</span><span>DEMO DATA · NOT INVESTMENT ADVICE</span><button><CircleHelp size={14} /> Help</button></footer>
    </div>
  );
}

export default App;