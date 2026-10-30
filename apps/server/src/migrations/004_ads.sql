-- Phase 4：广告素材、播放列表、热门榜人工干预、短剧专题、待机时长

-- 广告素材：视频（mp4/webm）或图片（jpg/png/webp），文件在 media/ads/ 下
CREATE TABLE ad_asset (
  id          INTEGER PRIMARY KEY,
  type        TEXT    NOT NULL CHECK (type IN ('video', 'image')),
  name        TEXT    NOT NULL,
  storage_key TEXT    NOT NULL UNIQUE,
  size_bytes  INTEGER NOT NULL,
  created_by  INTEGER REFERENCES account (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

-- 播放列表条目：device_id 为空是默认列表；某台设备有条目即视为单独配置，清空后回落到默认列表
-- asset_id 不级联删除：素材被引用时不允许删（ASSET_IN_USE）
CREATE TABLE playlist_item (
  id        INTEGER PRIMARY KEY,
  device_id INTEGER REFERENCES device (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  asset_id  INTEGER NOT NULL REFERENCES ad_asset (id),
  seconds   INTEGER NOT NULL DEFAULT 8 CHECK (seconds BETWEEN 1 AND 120)
);
CREATE INDEX idx_playlist_device ON playlist_item (device_id, position);
CREATE INDEX idx_playlist_asset ON playlist_item (asset_id);

-- 热门榜人工干预：pin_order 非空为置顶（按置顶先后排序），removed=1 为移出
CREATE TABLE hot_override (
  garment_id INTEGER PRIMARY KEY REFERENCES garment (id) ON DELETE CASCADE,
  pin_order  INTEGER,
  removed    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 热门榜按近 7 天试穿流水统计
CREATE INDEX idx_ledger_type_created ON point_ledger (type, created_at);

-- 短剧专题：garment_ids 为 JSON 数组，保持管理员设定的顺序
CREATE TABLE drama (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL,
  poster_key  TEXT    NOT NULL,
  garment_ids TEXT    NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 无操作多少分钟进入待机播放
INSERT INTO setting (key, value, updated_at) VALUES ('idle_minutes', '4', 0);
