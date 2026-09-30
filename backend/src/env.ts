export type WorkerEnv = {
  DB: D1Database;
  CACHE: KVNamespace;
  STOCK_SESSION: DurableObjectNamespace;
  AI: Ai;
  ALPHA_VANTAGE_API_KEY?: string;
  ALPHA_VANTAGE_MARKET_ENTITLEMENT?: string;
  ALPHA_VANTAGE_IS_DELAYED?: string;
  MARKET_DATA_SOURCE?: 'local' | 'alphavantage';
  CORS_ORIGIN?: string;
  ENVIRONMENT?: string;
  LOCAL_DEV_IMPORT_ENABLED?: string;
  PUBLIC_DEMO_MODE?: string;
  DEMO_SEED_ENABLED?: string;
};

export const LOCAL_USER_ID = 'usr_local_demo';
export const LOCAL_PORTFOLIO_ID = 'prt_local_demo';