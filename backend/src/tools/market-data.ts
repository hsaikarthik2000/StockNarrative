import type { DailyBar, Instrument } from '@stocknarrative/shared';
import type { WorkerEnv } from '../env';
import type { MarketDataProvider, MarketHistory, MarketQuote } from './contracts';

type InstrumentRow = {
  instrument_id: string;
  symbol: string;
  name: string;
  exchange: string | null;
  isin: string | null;
  industry: string | null;
  currency: string;
};

export class D1MarketDataProvider implements MarketDataProvider {
  constructor(private readonly env: Pick<WorkerEnv, 'DB' | 'MARKET_DATA_SOURCE'>) {}

  async getQuote(symbol: string): Promise<MarketQuote> {
    const instrument = await this.findInstrument(symbol);
    if (!instrument) throw new Error(`Instrument ${symbol} was not found.`);
    const rows = await this.env.DB.prepare(
      'SELECT trading_date, close_price, volume FROM local_daily_prices WHERE instrument_id = ? ORDER BY trading_date DESC LIMIT 2',
    ).bind(instrument.instrument_id).all<{ trading_date: string; close_price: number; volume: number }>();
    if (!rows.results.length) throw new Error(`No local market data is available for ${symbol}.`);
    const [latest, previous] = rows.results;
    const changeAmount = previous ? latest.close_price - previous.close_price : 0;
    const instrumentValue = toInstrument(instrument);
    return {
      instrument: instrumentValue,
      price: money(latest.close_price, instrument.currency),
      change: money(changeAmount, instrument.currency),
      changePercent: previous ? changeAmount / previous.close_price * 100 : 0,
      volume: latest.volume,
      tradingDate: latest.trading_date,
      provenance: provenance('BSE local dataset (CC0)', latest.trading_date),
    };
  }

  async getHistory(symbol: string, limit = 100): Promise<MarketHistory> {
    const instrument = await this.findInstrument(symbol);
    if (!instrument) throw new Error(`Instrument ${symbol} was not found.`);
    const rows = await this.env.DB.prepare(
      'SELECT trading_date, close_price, volume FROM local_daily_prices WHERE instrument_id = ? ORDER BY trading_date DESC LIMIT ?',
    ).bind(instrument.instrument_id, Math.min(Math.max(limit, 1), 500)).all<{ trading_date: string; close_price: number; volume: number }>();
    const bars: DailyBar[] = rows.results.reverse().map((row) => ({
      time: row.trading_date,
      open: null,
      high: null,
      low: null,
      close: row.close_price,
      volume: row.volume,
      complete: true,
    }));
    if (!bars.length) throw new Error(`No local market history is available for ${symbol}.`);
    return { instrument: toInstrument(instrument), bars, provenance: provenance('BSE local dataset (CC0)', bars.at(-1)?.time ?? null) };
  }

  private async findInstrument(symbol: string): Promise<InstrumentRow | null> {
    return this.env.DB.prepare(
      'SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments WHERE symbol = ? LIMIT 1',
    ).bind(symbol.toUpperCase()).first<InstrumentRow>();
  }
}

function toInstrument(row: InstrumentRow): Instrument {
  return {
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    isin: row.isin,
    industry: row.industry,
    currency: row.currency,
  };
}

function money(amount: number, currency: string) {
  return { amount: amount.toFixed(2), currency };
}

function provenance(provider: string, asOf: string | null) {
  return { provider, retrievedAt: new Date().toISOString(), asOf, isDelayed: true };
}