#!/usr/bin/env bash
# 闪裳Live · 本地构建并打包
#
# 在仓库任意位置执行：bash deploy/scripts/build.sh
# 产物：deploy/out/shanshang-<版本>.tar.gz（deploy/out/ 已在 .gitignore）
# 包内结构：
#   VERSION
#   server/   服务端代码 + package.json + package-lock.json（依赖在服务器上 npm ci 安装）
#   admin/    后台静态站（base=/sl/admin/）
#   device/   设备前台静态站（base=/sl/device/）
#   scripts/  backup-db.sh（服务器上发布前备份用）
#
# 可选环境变量：
#   VERSION      版本号，默认 <日期时间>-<git 短哈希>
#   ADMIN_BASE   后台 base，默认 /sl/admin/（生产去掉前缀时设为 /admin/）
#   DEVICE_BASE  设备前台 base，默认 /sl/device/
#   ALLOW_DIRTY  设为 1 时允许工作区有未提交改动（默认拒绝，保证包与提交一致）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT/deploy/out"
cd "$ROOT"

if [[ "${ALLOW_DIRTY:-0}" != "1" ]] && [[ -n "$(git status --porcelain -- apps packages)" ]]; then
  echo "apps/ 或 packages/ 有未提交改动；提交后再构建，或设 ALLOW_DIRTY=1" >&2
  exit 1
fi

VERSION="${VERSION:-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)}"
if [[ ! "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "VERSION 只能包含字母、数字、点、下划线、连字符：$VERSION" >&2
  exit 1
fi

export ADMIN_BASE="${ADMIN_BASE:-/sl/admin/}"
export DEVICE_BASE="${DEVICE_BASE:-/sl/device/}"
# Windows Git Bash 会把以 / 开头的环境变量改写成 Windows 路径（/sl/admin/ → /Program Files/Git/sl/admin/），
# 传给 node 后 vite base 错误、线上白屏。关闭这层转换；Linux 上这两个变量无影响
export MSYS_NO_PATHCONV=1
export MSYS2_ENV_CONV_EXCL='*'

for app in admin device; do
  echo "==> 构建 apps/$app"
  (cd "apps/$app" && npm ci && npm run build)
  if [[ ! -f "apps/$app/dist/index.html" ]]; then
    echo "apps/$app/dist/index.html 不存在，构建失败" >&2
    exit 1
  fi
  # 构建后自检：入口 html 里所有以 / 开头的 src/href（脚本、CSS、favicon、modulepreload）都必须挂在 base 下，
  # 且入口脚本存在；动态 import 的 chunk 由 vite 按 base 生成，再查一遍 JS 里不能出现被改写的路径
  base_var="$(echo "$app" | tr '[:lower:]' '[:upper:]')_BASE"
  base="${!base_var}"
  html="apps/$app/dist/index.html"
  bad="$(grep -oE '(src|href)="/[^"]*"' "$html" | grep -v "=\"${base}" || true)"
  if [[ -n "$bad" ]] || ! grep -q "src=\"${base}assets/" "$html"; then
    echo "$html 的资源路径不以 $base 开头：" >&2
    echo "${bad:-（缺少 ${base}assets/ 入口脚本）}" >&2
    exit 1
  fi
  if grep -rlq 'Program Files' "apps/$app/dist/assets/"; then
    echo "apps/$app/dist/assets 里出现 Windows 路径（Git Bash 路径转换未关闭）" >&2
    exit 1
  fi
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/shanshang-$VERSION"
mkdir -p "$PKG/server" "$PKG/scripts"

echo "==> 组装 $VERSION"
printf '%s\n' "$VERSION" > "$PKG/VERSION"
# 服务端只带运行需要的文件：不带 node_modules、data/、.env、测试
cp -R apps/server/src "$PKG/server/src"
cp apps/server/package.json apps/server/package-lock.json "$PKG/server/"
cp -R apps/admin/dist "$PKG/admin"
cp -R apps/device/dist "$PKG/device"
cp deploy/scripts/backup-db.sh "$PKG/scripts/"

# 防呆：包里不应出现 .env 或数据库文件
if find "$PKG" \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) | grep -q .; then
  echo "包内发现 .env 或数据库文件，已中止" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/shanshang-$VERSION.tar.gz" -C "$STAGE" "shanshang-$VERSION"
echo "==> 完成：deploy/out/shanshang-$VERSION.tar.gz"
