-- Phase 7：埋点明细、日汇总、留言反馈、联系我们 / 打赏码（STA-01~03、SET-06~08、ADM-08）

-- 埋点明细：设备批量上报，按 device_id + session_id + seq 去重，只追加不改。
-- ts 是事件发生时间（设备时钟不可信时用服务端收到的时间），day 是 ts 对应的北京时间日期。
-- merchant_id / garment_id 由服务端按服饰归属确定（品牌事件取上报的 merchantId），不加外键：
-- 服饰软删除、账号停用后历史明细照常保留。garment_ids 只有 ai_recommend 用（JSON 数组）。
-- counted：是否计入了 stat_daily（tryon_start 同会话同服饰 30 秒内重复为 0；snapshot_create 没有对应指标也为 0）。
CREATE TABLE event (
  id           INTEGER PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  session_id   TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('brand_click', 'brand_dwell', 'tryon_start', 'tryon_end', 'ai_recommend', 'snapshot_create')),
  ts           INTEGER NOT NULL,
  day          TEXT    NOT NULL,
  merchant_id  INTEGER,
  garment_id   INTEGER,
  garment_ids  TEXT,
  snapshot_id  INTEGER,
  -- 上报原值；汇总时按口径截断
  duration_ms  INTEGER,
  question_key TEXT,
  counted      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  UNIQUE (device_id, session_id, seq)
);
-- tryon_start 30 秒去重查询
CREATE INDEX idx_event_tryon ON event (device_id, session_id, garment_id, ts) WHERE type = 'tryon_start';
CREATE INDEX idx_event_day ON event (day);

-- 日汇总：日期（北京时间）× 商家 × 服饰 × 设备。
-- garment_id = 0 表示品牌级指标（品牌点击、停留）；device_id = 0 表示没有设备归属（如快照设备已删除）。
-- 用 0 而不是 NULL，主键才能做 upsert 累加。
CREATE TABLE stat_daily (
  day             TEXT    NOT NULL,
  merchant_id     INTEGER NOT NULL,
  garment_id      INTEGER NOT NULL DEFAULT 0,
  device_id       INTEGER NOT NULL DEFAULT 0,
  brand_clicks    INTEGER NOT NULL DEFAULT 0,
  brand_dwell_ms  INTEGER NOT NULL DEFAULT 0,
  tryon_count     INTEGER NOT NULL DEFAULT 0,
  tryon_ms        INTEGER NOT NULL DEFAULT 0,
  redeem_count    INTEGER NOT NULL DEFAULT 0,
  recommend_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, merchant_id, garment_id, device_id)
);
CREATE INDEX idx_stat_merchant ON stat_daily (merchant_id, day);
CREATE INDEX idx_stat_device ON stat_daily (device_id, day);

-- 留言反馈：商家提交，管理员回复（可修改回复）；pending 待处理 / replied 已回复
CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  content     TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied')),
  reply       TEXT    NOT NULL DEFAULT '',
  replied_by  INTEGER REFERENCES account (id) ON DELETE SET NULL,
  replied_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_feedback_merchant ON feedback (merchant_id, id);
CREATE INDEX idx_feedback_status ON feedback (status, id);

-- 联系我们（电话、地址、微信二维码）与打赏码，由总后台配置；二维码存 media/site/
INSERT INTO setting (key, value, updated_at) VALUES
  ('site_contact_phone', '', 0),
  ('site_contact_address', '', 0),
  ('site_wechat_qr_url', '', 0),
  ('site_tip_qr_url', '', 0);
