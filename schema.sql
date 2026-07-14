-- 流量儀表板資料表（與 kkdash 共用 DB，一律 traf_ 前綴）
CREATE TABLE IF NOT EXISTS traf_users (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  secret TEXT NOT NULL              -- bcrypt hash
);

CREATE TABLE IF NOT EXISTS traf_ga_daily (
  date            DATE PRIMARY KEY,
  users           INT  NOT NULL DEFAULT 0,
  sessions        INT  NOT NULL DEFAULT 0,
  pageviews       INT  NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(6,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS traf_ga_channels (
  date     DATE NOT NULL,
  channel  TEXT NOT NULL,
  sessions INT NOT NULL DEFAULT 0,
  users    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, channel)
);

CREATE TABLE IF NOT EXISTS traf_ga_pages (
  date      DATE NOT NULL,
  page_path TEXT NOT NULL,
  views     INT NOT NULL DEFAULT 0,
  users     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, page_path)
);

CREATE TABLE IF NOT EXISTS traf_ga_events (
  date       DATE NOT NULL,
  event_name TEXT NOT NULL,
  count      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, event_name)
);

CREATE TABLE IF NOT EXISTS traf_fb_page_daily (
  date        DATE PRIMARY KEY,
  reach       INT NOT NULL DEFAULT 0,
  engagement  INT NOT NULL DEFAULT 0,
  fans_total  INT NOT NULL DEFAULT 0,
  fans_change INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS traf_fb_posts (
  post_id    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ,
  message    TEXT,
  reach      INT NOT NULL DEFAULT 0,
  likes      INT NOT NULL DEFAULT 0,
  comments   INT NOT NULL DEFAULT 0,
  shares     INT NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traf_ads_daily (
  date          DATE NOT NULL,
  campaign_id   TEXT NOT NULL,
  campaign_name TEXT NOT NULL DEFAULT '',
  spend         NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions   BIGINT NOT NULL DEFAULT 0,
  clicks        INT NOT NULL DEFAULT 0,
  conversions   INT NOT NULL DEFAULT 0,
  actions       JSONB,
  PRIMARY KEY (date, campaign_id)
);

CREATE TABLE IF NOT EXISTS traf_fetch_log (
  id         SERIAL PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source     TEXT NOT NULL,          -- 'ga' | 'fb_page' | 'ads'
  date_from  DATE,
  date_to    DATE,
  status     TEXT NOT NULL,          -- 'ok' | 'error'
  error      TEXT
);
