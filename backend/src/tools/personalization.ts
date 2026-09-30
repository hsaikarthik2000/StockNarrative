import type { WorkerEnv } from '../env';
import { LOCAL_USER_ID } from '../env';
import type { PersonalizationProfile, PersonalizationTool } from './contracts';

export class D1PersonalizationTool implements PersonalizationTool {
  constructor(private readonly env: Pick<WorkerEnv, 'DB'>) {}

  async getProfile(userId: string): Promise<PersonalizationProfile> {
    const resolvedUserId = userId || LOCAL_USER_ID;
    const preferences = await this.env.DB.prepare(
      'SELECT assistant_tone, risk_profile FROM user_preferences WHERE user_id = ? LIMIT 1',
    ).bind(resolvedUserId).first<{ assistant_tone: string; risk_profile: string | null }>();
    const watchlist = await this.env.DB.prepare(
      `SELECT i.symbol FROM watchlist_items w JOIN instruments i ON i.instrument_id = w.instrument_id
       WHERE w.user_id = ? ORDER BY w.sort_order, i.symbol`,
    ).bind(resolvedUserId).all<{ symbol: string }>();
    return {
      userId: resolvedUserId,
      preferredCurrency: 'INR',
      communicationStyle: preferences?.assistant_tone === 'concise' || preferences?.assistant_tone === 'conversational' ? preferences.assistant_tone : 'formal',
      watchlist: watchlist.results.map((item) => item.symbol),
      riskProfile: preferences?.risk_profile === 'conservative' ? 'conservative' : preferences?.risk_profile === 'aggressive' ? 'growth' : preferences?.risk_profile === 'moderate' ? 'balanced' : 'unknown',
    };
  }
}