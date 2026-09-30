PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'en-US',
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  base_currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  assistant_tone TEXT NOT NULL DEFAULT 'formal' CHECK (assistant_tone IN ('formal', 'concise', 'conversational')),
  industries_json TEXT NOT NULL DEFAULT '[]',
  risk_profile TEXT CHECK (risk_profile IN ('conservative', 'moderate', 'aggressive')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instruments (
  instrument_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  exchange TEXT,
  isin TEXT UNIQUE,
  industry TEXT,
  currency TEXT NOT NULL,
  alpha_vantage_symbol TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX instruments_symbol_exchange_idx ON instruments(symbol, COALESCE(exchange, ''));

CREATE TABLE watchlist_items (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, instrument_id)
);

CREATE TABLE portfolios (
  portfolio_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main portfolio',
  base_currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE portfolio_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  currency TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0)
);

CREATE INDEX portfolio_snapshots_latest_idx ON portfolio_snapshots(portfolio_id, imported_at DESC);

CREATE TABLE positions (
  snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(snapshot_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  average_cost REAL NOT NULL CHECK (average_cost >= 0),
  last_price REAL NOT NULL CHECK (last_price >= 0),
  invested_value REAL NOT NULL,
  current_value REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  unrealized_pnl_percent REAL NOT NULL,
  PRIMARY KEY (snapshot_id, instrument_id)
);

CREATE TABLE market_events (
  event_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  occurred_at TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  return_percent REAL NOT NULL,
  z_price REAL,
  z_volume REAL,
  volume_multiple REAL,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX market_events_instrument_time_idx ON market_events(instrument_id, occurred_at DESC);

CREATE TABLE alert_thresholds (
  alert_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  threshold REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  channels_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notification_deliveries (
  delivery_id TEXT PRIMARY KEY,
  alert_id TEXT REFERENCES alert_thresholds(alert_id) ON DELETE SET NULL,
  event_id TEXT REFERENCES market_events(event_id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);