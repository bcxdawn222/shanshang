#!/usr/bin/env bash
# 闪裳Live · SQLite 在线备份（服务运行中也可执行，WAL 下得到一致快照）
#
# 以服务用户 shanshang 运行（避免 root 生成 root 属主的 -wal/-shm 文件导致服务写不进）：
#   runuser -u shanshang -- bash /opt/shanshang/current/scripts/backup-db.sh
# 定时（crontab -u shanshang -e），每天 03:30：
#   30 3 * * * bash /opt/shanshang/current/scripts/backup-db.sh >> /var/backups/shanshang/backup.log 2>&1
#
# 优先用 sqlite3 命令行的 .backup；没装 sqlite3 时用服务端自带的 better-sqlite3 的 backup()。
# 只备份数据库；media/ 目录（图片、视频）另行同步，见部署手册。
#
# 环境变量（都有默认值）：
#   DB_FILE     数据库，默认 /var/lib/shanshang/shanshang.db
#   BACKUP_DIR  备份目录，默认 /var/backups/shanshang（需服务用户可写，权限 700）
#   KEEP_DAYS   保留天数，默认 14
#   APP_DIR     服务端目录（找 better-sqlite3），默认 /opt/shanshang/current/server
set -euo pipefail

DB_FILE="${DB_FILE:-/var/lib/shanshang/shanshang.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/shanshang}"
KEEP_DAYS="${KEEP_DAYS:-14}"
APP_DIR="${APP_DIR:-/opt/shanshang/current/server}"

umask 077

if [[ ! -f "$DB_FILE" ]]; then
  echo "数据库不存在：$DB_FILE" >&2
  exit 1
fi
if [[ ! "$KEEP_DAYS" =~ ^[0-9]+$ ]]; then
  echo "KEEP_DAYS 必须是整数：$KEEP_DAYS" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$BACKUP_DIR/.shanshang-$STAMP.db.tmp"
DEST="$BACKUP_DIR/shanshang-$STAMP.db"
trap 'rm -f "$TMP"' EXIT

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".timeout 10000" ".backup '$TMP'"
  CHECK="$(sqlite3 "$TMP" 'PRAGMA integrity_check;')"
else
  if [[ ! -d "$APP_DIR/node_modules/better-sqlite3" ]]; then
    echo "没有 sqlite3，且 $APP_DIR 下找不到 better-sqlite3" >&2
    exit 1
  fi
  # -e 脚本按当前目录解析 require，所以先进入服务端目录
  CHECK="$(cd "$APP_DIR" && SRC="$DB_FILE" DST="$TMP" node -e '
    const Database = require("better-sqlite3");
    (async () => {
      const src = new Database(process.env.SRC, { fileMustExist: true, timeout: 10000 });
      await src.backup(process.env.DST);
      src.close();
      const dst = new Database(process.env.DST, { readonly: true });
      console.log(dst.pragma("integrity_check", { simple: true }));
      dst.close();
    })().catch((e) => { console.error(e); process.exit(1); });
  ')"
fi

if [[ "$CHECK" != "ok" ]]; then
  echo "备份完整性检查失败：$CHECK" >&2
  exit 1
fi

mv "$TMP" "$DEST"
gzip -f "$DEST"
echo "$(date '+%F %T') 备份完成：$DEST.gz"

# 清理超过 KEEP_DAYS 天的备份
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'shanshang-*.db.gz' -mtime +"$KEEP_DAYS" -print -delete
