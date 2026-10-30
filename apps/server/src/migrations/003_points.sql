-- Phase 3：积分账本、设备背景

-- 余额快照（毫积分，1 积分 = 1000），可由 point_ledger 重算对账；允许为负（试穿中透支）
ALTER TABLE merchant ADD COLUMN balance_milli INTEGER NOT NULL DEFAULT 0;

-- 设备前台背景，总后台按设备设置
ALTER TABLE device ADD COLUMN background TEXT NOT NULL DEFAULT 'black' CHECK (background IN ('black', 'white'));

-- 积分流水：只追加，不改不删。amount_milli 有符号（加为正、扣为负）
-- 试穿流水按 device_id + session_id + seq 幂等；非试穿流水这三列为 NULL（NULL 不参与唯一约束）
CREATE TABLE point_ledger (
  id                  INTEGER PRIMARY KEY,
  merchant_id         INTEGER NOT NULL REFERENCES account (id),
  type                TEXT    NOT NULL CHECK (type IN ('ADMIN_ADD', 'ADMIN_DEDUCT', 'TRYON_CONSUME', 'REFUND')),
  amount_milli        INTEGER NOT NULL,
  balance_after_milli INTEGER NOT NULL,
  garment_id          INTEGER REFERENCES garment (id) ON DELETE SET NULL,
  device_id           INTEGER REFERENCES device (id) ON DELETE SET NULL,
  session_id          TEXT,
  seq                 INTEGER,
  duration_ms         INTEGER,
  note                TEXT    NOT NULL DEFAULT '',
  actor_id            INTEGER REFERENCES account (id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  UNIQUE (device_id, session_id, seq)
);
CREATE INDEX idx_ledger_merchant ON point_ledger (merchant_id, type, id);
CREATE INDEX idx_ledger_type ON point_ledger (type, id);

-- 积分配置。xmax_ratio 是平台积分 : Xmax 积分换算比例，仅总后台可见；tryon_max_minutes 给 Phase 4 用
INSERT INTO setting (key, value, updated_at) VALUES
  ('points_per_minute', '1', 0),
  ('hide_threshold', '5', 0),
  ('xmax_ratio', '', 0),
  ('recharge_contact', '', 0),
  ('recharge_qr_url', '', 0),
  ('tryon_max_minutes', '5', 0);
