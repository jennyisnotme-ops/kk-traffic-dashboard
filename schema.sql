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

CREATE TABLE IF NOT EXISTS traf_reports (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  config     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- R3b-1: 帳號權限系統 — traf_users 擴充 + session 認證
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS allowed_pages JSONB NOT NULL DEFAULT '["overview","ga","fb_insights","fb_posts","fb_ads","custom"]';
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}';
ALTER TABLE traf_users ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS traf_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES traf_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traf_sessions_expires ON traf_sessions(expires_at);

-- R3c-1: 版面自訂（'default' 全域預設版面 或 使用者 id 的字串形式 = 該使用者個人版面）
CREATE TABLE IF NOT EXISTS traf_layouts (
  id         SERIAL PRIMARY KEY,
  scope      TEXT NOT NULL,   -- 'default' 或 使用者 id 的字串形式
  cards      JSONB NOT NULL,  -- [{cid, type?}] 陣列，cid 對應既有卡片 id/自訂報表 custom_<id>
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope)
);
