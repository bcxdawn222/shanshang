-- Phase 6：玩法配置（FUN-03、FUN-05、FUN-06、ADM-07）

-- 每行是管理员保存的一份完整 JSON，整体替换。
-- 没有行 = 未配置：接口返回 null，设备端回落到 packages/shared 的默认值；“恢复默认”就是删掉这一行。
CREATE TABLE fun_config (
  key        TEXT    PRIMARY KEY CHECK (key IN ('zodiac_wheel', 'recommend_options', 'fortune_library')),
  value      TEXT    NOT NULL,
  updated_by INTEGER REFERENCES account (id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
