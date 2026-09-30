import type { PortfolioResponse } from '@stocknarrative/shared';
import { LOCAL_PORTFOLIO_ID } from '../env';
import type { WorkerEnv } from '../env';
import type { PortfolioFetcher, PortfolioSnapshot } from './contracts';

export class D1PortfolioFetcher implements PortfolioFetcher {
  constructor(private readonly env: Pick<WorkerEnv, 'DB'>) {}

  async getPortfolio(userId: string): Promise<PortfolioSnapshot> {
    const snapshot = await this.env.DB.prepare(
      `SELECT snapshot_id, imported_at, currency FROM portfolio_snapshots
       WHERE portfolio_id = ? ORDER BY imported_at DESC LIMIT 1`,
    ).bind(userId === 'usr_local_demo' ? LOCAL_PORTFOLIO_ID : userId).first<{ snapshot_id: string; imported_at: string; currency: string }>();
    if (!snapshot) throw new Error('No portfolio snapshot is available.');
    const result = await this.env.DB.prepare(
      `SELECT i.instrument_id, i.symbol, i.name, i.exchange, i.isin, i.industry, i.currency,
              p.quantity, p.average_cost, p.last_price, p.invested_value, p.current_value,
              p.unrealized_pnl, p.unrealized_pnl_percent
       FROM positions p JOIN instruments i ON i.instrument_id = p.instrument_id
       WHERE p.snapshot_id = ? ORDER BY i.symbol`,
    ).bind(snapshot.snapshot_id).all<PositionRow>();
    const positions = result.results.map((row) => ({
      instrument: { instrumentId: row.instrument_id, symbol: row.symbol, name: row.name, exchange: row.exchange, isin: row.isin, industry: row.industry, currency: row.currency },
      quantity: String(row.quantity),
      averageCost: money(row.average_cost, row.currency),
      investedValue: money(row.invested_value, row.currency),
      currentValue: money(row.current_value, row.currency),
      unrealizedPnl: money(row.unrealized_pnl, row.currency),
      unrealizedPnlPercent: row.unrealized_pnl_percent,
      quote: { price: money(row.last_price, row.currency), asOf: null, isDelayed: true, source: 'portfolio_csv' },
    }));
    const totals = positions.reduce((total, position) => ({
      invested: total.invested + Number(position.investedValue.amount),
      current: total.current + Number(position.currentValue.amount),
      pnl: total.pnl + Number(position.unrealizedPnl.amount),
    }), { invested: 0, current: 0, pnl: 0 });
    const portfolio: PortfolioResponse = {
      portfolioId: LOCAL_PORTFOLIO_ID,
      baseCurrency: snapshot.currency,
      asOf: new Date(snapshot.imported_at).toISOString(),
      totals: { investedValue: money(totals.invested, snapshot.currency), currentValue: money(totals.current, snapshot.currency), unrealizedPnl: money(totals.pnl, snapshot.currency) },
      positions,
    };
    return { portfolio, provenance: { provider: 'Imported portfolio CSV', retrievedAt: new Date().toISOString(), asOf: snapshot.imported_at, isDelayed: true } };
  }
}

type PositionRow = {
  instrument_id: string; symbol: string; name: string; exchange: string | null; isin: string | null; industry: string | null; currency: string;
  quantity: number; average_cost: number; last_price: number; invested_value: number; current_value: number; unrealized_pnl: number; unrealized_pnl_percent: number;
};

function money(amount: number, currency: string) { return { amount: amount.toFixed(2), currency }; }