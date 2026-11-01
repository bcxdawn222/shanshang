#!/usr/bin/env bash
# 闪裳Live · 发布到服务器 / 回滚
#
# 用法（本地执行，先 bash deploy/scripts/build.sh）：
#   DEPLOY_HOST=<USER>@<SERVER> bash deploy/scripts/deploy.sh                 # 发布 deploy/out 下最新的包
#   DEPLOY_HOST=<USER>@<SERVER> bash deploy/scripts/deploy.sh deploy/out/shanshang-<版本>.tar.gz
#   DEPLOY_HOST=<USER>@<SERVER> bash deploy/scripts/deploy.sh --rollback      # 切回上一个版本
#   DEPLOY_HOST=<USER>@<SERVER> bash deploy/scripts/deploy.sh --rollback <版本>
#
# 环境变量：
#   DEPLOY_HOST   必填，ssh 目标（用户需能 sudo；用 root 登录时设 SUDO=）
#   DEPLOY_PORT   ssh 端口，默认 22
#   APP_ROOT      服务器安装目录，默认 /opt/shanshang（releases/<版本> + current 软链）
#   SERVICE       systemd 服务名，默认 shanshang
#   KEEP_RELEASES 保留的版本数，默认 5
#   SUDO          默认 sudo
#
# 服务器端流程：上传 → 解压到 releases/<版本> → npm ci --omit=dev → 备份数据库 →
#   切换 current 软链 → 重启服务 → 健康检查（失败自动切回上一版本）。
# 回滚只切代码，不动数据库；需要恢复数据库见部署手册。
set -euo pipefail

: "${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 DEPLOY_HOST=<USER>@<SERVER>}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
APP_ROOT="${APP_ROOT:-/opt/shanshang}"
SERVICE="${SERVICE:-shanshang}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SUDO="${SUDO-sudo}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH=(ssh -p "$DEPLOY_PORT" -o BatchMode=yes "$DEPLOY_HOST")

MODE="deploy"
TARGET=""
if [[ "${1:-}" == "--rollback" ]]; then
  MODE="rollback"
  TARGET="${2:-}"
else
  TARGET="${1:-}"
fi

for v in APP_ROOT SERVICE KEEP_RELEASES; do
  if [[ ! "${!v}" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "$v 含非法字符：${!v}" >&2
    exit 1
  fi
done

# 服务器上执行的公共函数：切换 current 并做健康检查
REMOTE_LIB='
set -euo pipefail
switch_to() {
  ln -sfn "$APP_ROOT/releases/$1" "$APP_ROOT/current.new"
  mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
  systemctl restart "$SERVICE"
}
health() {
  local port
  port="$(sed -n "s/^PORT=//p" /etc/shanshang/server.env | tail -n1)"
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:${port:-8300}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
'

if [[ "$MODE" == "rollback" ]]; then
  if [[ -n "$TARGET" && ! "$TARGET" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "版本号含非法字符：$TARGET" >&2
    exit 1
  fi
  echo "==> 回滚 $DEPLOY_HOST ${TARGET:-（上一版本）}"
  "${SSH[@]}" "$SUDO env APP_ROOT='$APP_ROOT' SERVICE='$SERVICE' TARGET='$TARGET' bash -s" <<EOF
$REMOTE_LIB
cur="\$(basename "\$(readlink -f "\$APP_ROOT/current")")"
if [[ -z "\$TARGET" ]]; then
  TARGET="\$(ls -1 "\$APP_ROOT/releases" | sort | grep -vx "\$cur" | awk -v c="\$cur" '\$0 < c' | tail -n1)"
fi
[[ -n "\$TARGET" && -d "\$APP_ROOT/releases/\$TARGET" ]] || { echo "找不到可回滚的版本：\$TARGET" >&2; exit 1; }
echo "当前 \$cur → 切到 \$TARGET"
switch_to "\$TARGET"
health || { echo "回滚后健康检查失败，请 journalctl -u \$SERVICE 排查" >&2; exit 1; }
echo "回滚完成：\$TARGET"
EOF
  exit 0
fi

PKG="${TARGET:-$(ls -1t "$ROOT"/deploy/out/shanshang-*.tar.gz 2>/dev/null | head -n1 || true)}"
if [[ -z "$PKG" || ! -f "$PKG" ]]; then
  echo "找不到发布包；先执行 bash deploy/scripts/build.sh" >&2
  exit 1
fi
NAME="$(basename "$PKG" .tar.gz)"
VERSION="${NAME#shanshang-}"
if [[ ! "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "包名不符合 shanshang-<版本>.tar.gz：$PKG" >&2
  exit 1
fi

REMOTE_TMP="/tmp/$NAME.tar.gz"
echo "==> 上传 $NAME 到 $DEPLOY_HOST"
scp -P "$DEPLOY_PORT" -o BatchMode=yes "$PKG" "$DEPLOY_HOST:$REMOTE_TMP"

echo "==> 服务器安装并切换"
"${SSH[@]}" "$SUDO env APP_ROOT='$APP_ROOT' SERVICE='$SERVICE' KEEP='$KEEP_RELEASES' VERSION='$VERSION' PKG='$REMOTE_TMP' bash -s" <<EOF
$REMOTE_LIB
REL="\$APP_ROOT/releases/\$VERSION"
[[ ! -e "\$REL" ]] || { echo "版本已存在：\$REL（换个 VERSION 重新构建）" >&2; exit 1; }
install -d -m 755 "\$APP_ROOT/releases"
tmp="\$(mktemp -d "\$APP_ROOT/releases/.unpack.XXXXXX")"
tar -xzf "\$PKG" -C "\$tmp"
mv "\$tmp/shanshang-\$VERSION" "\$REL"
rmdir "\$tmp"
rm -f "\$PKG"

# 代码属 root、服务用户只读
(cd "\$REL/server" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "\$REL"
chmod -R u=rwX,go=rX "\$REL"

# 发布前备份数据库（首次部署还没有库则跳过）
if [[ -f /var/lib/shanshang/shanshang.db ]]; then
  runuser -u shanshang -- env APP_DIR="\$REL/server" bash "\$REL/scripts/backup-db.sh"
fi

prev=""
[[ -L "\$APP_ROOT/current" ]] && prev="\$(basename "\$(readlink -f "\$APP_ROOT/current")")"
switch_to "\$VERSION"
if ! health; then
  echo "健康检查失败" >&2
  if [[ -n "\$prev" ]]; then
    echo "自动切回 \$prev" >&2
    switch_to "\$prev"
  fi
  exit 1
fi
echo "发布完成：\$VERSION（上一版本：\${prev:-无}）"

# 只保留最近 KEEP 个版本，当前版本永不删除
cur="\$(basename "\$(readlink -f "\$APP_ROOT/current")")"
ls -1 "\$APP_ROOT/releases" | sort | head -n -"\$KEEP" | while read -r old; do
  [[ "\$old" == "\$cur" ]] || rm -rf "\$APP_ROOT/releases/\$old"
done
EOF
