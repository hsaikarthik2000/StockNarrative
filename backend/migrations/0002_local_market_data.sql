CREATE TABLE local_daily_prices (
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  trading_date TEXT NOT NULL,
  close_price REAL NOT NULL CHECK (close_price > 0),
  volume REAL NOT NULL CHECK (volume >= 0),
  source TEXT NOT NULL,
  PRIMARY KEY (instrument_id, trading_date, source)
);

CREATE INDEX local_daily_prices_date_idx ON local_daily_prices(instrument_id, trading_date DESC);

CREATE TABLE local_news_articles (
  article_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX local_news_articles_instrument_time_idx ON local_news_articles(instrument_id, published_at DESC);