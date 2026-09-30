import type { Instrument } from '@stocknarrative/shared';
import type { WorkerEnv } from '../env';
import type { Recommendation, RecommendationEngine } from './contracts';

export class D1RecommendationEngine implements RecommendationEngine {
  constructor(private readonly env: Pick<WorkerEnv, 'DB'>) {}

  async recommend(_userId: string, symbol?: string, limit = 3): Promise<Recommendation[]> {
    const selected = symbol ? await this.env.DB.prepare(
      'SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments WHERE symbol = ? LIMIT 1',
    ).bind(symbol.toUpperCase()).first<InstrumentRow>() : null;
    if (!selected) return [];
    const rows = await this.env.DB.prepare(
      `SELECT instrument_id, symbol, name, exchange, isin, industry, currency FROM instruments
       WHERE instrument_id != ? AND industry = ? ORDER BY symbol LIMIT ?`,
    ).bind(selected.instrument_id, selected.industry, Math.min(Math.max(limit, 1), 3)).all<InstrumentRow>();
    return rows.results.map((row) => ({
      instrument: toInstrument(row),
      score: 0.5,
      reasons: [`Same industry as ${selected.symbol}`, 'Candidate requires historical and risk review before any decision'],
      methodVersion: 'industry-match-v1',
    }));
  }
}

type InstrumentRow = { instrument_id: string; symbol: string; name: string; exchange: string | null; isin: string | null; industry: string | null; currency: string };
function toInstrument(row: InstrumentRow): Instrument { return { instrumentId: row.instrument_id, symbol: row.symbol, name: row.name, exchange: row.exchange, isin: row.isin, industry: row.industry, currency: row.currency }; }