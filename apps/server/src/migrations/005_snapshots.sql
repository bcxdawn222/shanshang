-- Phase 5：试穿快照、6 位核销短码（RDM-01~05）

-- 快照：设备先预约拿到短码和链接，Canvas 合成后再上传图片（image_key 上传前为空）。
-- token 是公开链接 /s/<token> 里的随机令牌（256 bit，base64url）；商家按短码查询时也要拼出图片地址，所以存明文。
-- code 只要求在“未核销且未过期”的快照里唯一，生成时在应用层查重重试，这里不加唯一约束。
-- merchant_id 取服饰所属商家，生成时固定；不记录顾客任何身份信息。
CREATE TABLE snapshot (
  id          INTEGER PRIMARY KEY,
  token       TEXT    NOT NULL UNIQUE,
  code        TEXT    NOT NULL,
  garment_id  INTEGER NOT NULL REFERENCES garment (id) ON DELETE CASCADE,
  merchant_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  device_id   INTEGER REFERENCES device (id) ON DELETE SET NULL,
  image_key   TEXT,
  created_at  INTEGER NOT NULL,
  -- created_at + 7 天
  expires_at  INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by INTEGER REFERENCES account (id) ON DELETE SET NULL,
  -- 过期清理删除图片的时间
  purged_at   INTEGER
);
-- 短码查重、按短码查询
CREATE INDEX idx_snapshot_code ON snapshot (code, expires_at);
-- 商家核销记录
CREATE INDEX idx_snapshot_merchant ON snapshot (merchant_id, redeemed_at);
-- 过期清理只扫还没清理的
CREATE INDEX idx_snapshot_purge ON snapshot (expires_at) WHERE purged_at IS NULL;
-- 总后台排查列表
CREATE INDEX idx_snapshot_created ON snapshot (created_at);
