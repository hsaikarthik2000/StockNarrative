import type { WorkerEnv } from '../env';
import type { PredictionCacheEntry, PredictiveCacheEngine } from './contracts';

export class KvPredictiveCacheEngine implements PredictiveCacheEngine {
  constructor(private readonly env: Pick<WorkerEnv, 'CACHE'>) {}

  async get(key: string): Promise<PredictionCacheEntry | null> {
    const entry = await this.env.CACHE.get<PredictionCacheEntry>(`v1:prediction:${key}`, 'json');
    if (!entry || Date.parse(entry.expiresAt) <= Date.now()) return null;
    return entry;
  }

  async put(entry: PredictionCacheEntry): Promise<void> {
    const ttl = Math.max(1, Math.ceil((Date.parse(entry.expiresAt) - Date.now()) / 1000));
    await this.env.CACHE.put(`v1:prediction:${entry.key}`, JSON.stringify(entry), { expirationTtl: ttl });
  }
}