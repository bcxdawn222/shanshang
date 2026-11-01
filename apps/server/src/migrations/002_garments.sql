-- Phase 2：标签字典、服饰

-- 品类 / 场景 / 主色字典，由管理员维护（GAR-05、ADM-03）；只停用不删除，已上架服饰还在引用
CREATE TABLE dict_item (
  id      INTEGER PRIMARY KEY,
  kind    TEXT    NOT NULL CHECK (kind IN ('category', 'scene', 'color')),
  name    TEXT    NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, name)
);

INSERT INTO dict_item (kind, name, sort) VALUES
  ('category', '连衣裙', 1), ('category', 'T恤', 2), ('category', '衬衫', 3), ('category', '外套', 4),
  ('category', '风衣', 5), ('category', '针织衫', 6), ('category', '西装', 7), ('category', '羽绒服', 8),
  ('scene', '宴会', 1), ('scene', '约会', 2), ('scene', '闺蜜', 3), ('scene', '通勤', 4), ('scene', '休闲', 5),
  ('scene', '运动', 6), ('scene', '见家长', 7), ('scene', '面试', 8), ('scene', '生日派对', 9), ('scene', '旅行拍照', 10),
  ('color', '黑色', 1), ('color', '白色', 2), ('color', '灰色', 3), ('color', '米色', 4), ('color', '棕色', 5),
  ('color', '红色', 6), ('color', '粉色', 7), ('color', '橙色', 8), ('color', '黄色', 9), ('color', '绿色', 10),
  ('color', '蓝色', 11), ('color', '紫色', 12);

-- 服饰。状态：reviewing 审核期（对商家显示“训练中”）/ ready 已上架 / rejected 驳回 / offline 下架
-- 审核期到 available_at 自动转 ready（GAR-07）；删除为软删除，删除后释放格位
CREATE TABLE garment (
  id            INTEGER PRIMARY KEY,
  merchant_id   INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  gender        TEXT    NOT NULL CHECK (gender IN ('female', 'male', 'kid')),
  set_type      TEXT    NOT NULL CHECK (set_type IN ('suit', 'single')),
  category_id   INTEGER NOT NULL REFERENCES dict_item (id),
  color_id      INTEGER NOT NULL REFERENCES dict_item (id),
  scene_ids     TEXT    NOT NULL DEFAULT '[]',
  discount_text TEXT    NOT NULL DEFAULT '',
  -- 为空时用商家资料里的店铺位置（SET-09）
  shop_location TEXT    NOT NULL DEFAULT '',
  -- 原图在我们自己的存储里；xmax_url 是转存到 Xmax 后的地址，转存失败为空，设备端用官方 SDK 兜底
  image_key     TEXT    NOT NULL,
  xmax_url      TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('reviewing', 'ready', 'rejected', 'offline')),
  available_at  INTEGER NOT NULL,
  -- 谁下架的：商家自己下架可以自己上架，平台下架只能管理员恢复
  offline_by    TEXT    CHECK (offline_by IN ('merchant', 'admin')),
  review_note   TEXT    NOT NULL DEFAULT '',
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_garment_merchant ON garment (merchant_id, deleted_at);
CREATE INDEX idx_garment_status ON garment (status, available_at);
