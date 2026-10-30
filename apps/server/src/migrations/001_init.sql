-- Phase 1：账号、商家、会话、设备、审计、平台设置

CREATE TABLE account (
  id            INTEGER PRIMARY KEY,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'merchant')),
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  nickname      TEXT    NOT NULL DEFAULT '',
  -- admin 固定 approved；merchant：pending 待审核 / approved / rejected / disabled
  status        TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 一个商家账号 = 一个品牌（ACC-06）
CREATE TABLE merchant (
  account_id    INTEGER PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  brand_name    TEXT    NOT NULL,
  contact       TEXT    NOT NULL DEFAULT '',
  shop_location TEXT    NOT NULL DEFAULT '',
  slot_quota    INTEGER NOT NULL DEFAULT 18,
  review_note   TEXT    NOT NULL DEFAULT '',
  reviewed_at   INTEGER,
  -- 停用前的状态，启用时原样恢复，防止借“停用 → 启用”跳过审核
  status_before_disable TEXT
);

-- 只存令牌的 sha256，数据库泄露也拿不到可用会话
CREATE TABLE session (
  token_hash TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_session_account ON session (account_id);

-- 设备：开机自注册拿到 code（屏幕显示）+ 设备令牌；管理员按 code 绑定后才能试穿
CREATE TABLE device (
  id           INTEGER PRIMARY KEY,
  code         TEXT    NOT NULL UNIQUE,
  secret_hash  TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL DEFAULT '',
  location     TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL CHECK (status IN ('pending', 'bound', 'disabled')),
  created_at   INTEGER NOT NULL,
  bound_at     INTEGER,
  last_seen_at INTEGER
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES account (id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL DEFAULT '',
  target_id   TEXT    NOT NULL DEFAULT '',
  detail      TEXT,
  ip          TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log (created_at);

CREATE TABLE setting (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO setting (key, value, updated_at) VALUES
  ('platform_name', '闪裳Live', 0),
  ('logo_url', '', 0),
  ('login_bg_url', '', 0);
