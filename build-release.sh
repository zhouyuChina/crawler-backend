#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="${ROOT_DIR}/.release"
PACKAGE_DIR="${STAGING_DIR}/package"
ARCHIVE_PATH="${ROOT_DIR}/release.zip"
INCLUDE_UPLOADS="${INCLUDE_UPLOADS:-false}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1"
    exit 1
  fi
}

copy_required() {
  local source_path="$1"

  if [ ! -e "${ROOT_DIR}/${source_path}" ]; then
    echo "缺少必需文件: ${source_path}"
    exit 1
  fi

  cp -R "${ROOT_DIR}/${source_path}" "${PACKAGE_DIR}/${source_path}"
}

copy_optional() {
  local source_path="$1"

  if [ -e "${ROOT_DIR}/${source_path}" ]; then
    cp -R "${ROOT_DIR}/${source_path}" "${PACKAGE_DIR}/${source_path}"
  fi
}

require_command npm
require_command zip

cd "${ROOT_DIR}"

echo "开始构建生产代码..."
npm run build

echo "准备打包目录..."
rm -rf "${STAGING_DIR}" "${ARCHIVE_PATH}"
mkdir -p "${PACKAGE_DIR}"

copy_required "dist"
copy_required "package.json"
copy_required "package-lock.json"
copy_required ".env.production.example"

copy_optional "public"
copy_optional "README.md"
copy_optional "DEPLOYMENT_GUIDE.md"

if [ "${INCLUDE_UPLOADS}" = "true" ] && [ -d "${ROOT_DIR}/uploads" ]; then
  copy_optional "uploads"
fi

cat > "${PACKAGE_DIR}/RELEASE_README.txt" <<'EOF'
部署说明:
1. 把 release.zip 上传到服务器并解压。
2. 复制 .env.production.example 为 .env.production，并按服务器实际配置修改。
3. 执行 npm ci --omit=dev 安装生产依赖。
4. 首次启动可使用 NODE_ENV=production DB_SYNCHRONIZE=true npm run start:prod。
5. 表结构创建完成后，把 DB_SYNCHRONIZE 改为 false 再重启服务。

说明:
- release.zip 不包含 node_modules，请在服务器执行 npm ci --omit=dev。
- 默认不包含 uploads；如需一起打包，可在本地执行 INCLUDE_UPLOADS=true npm run release。
EOF

echo "生成 release.zip ..."
(
  cd "${PACKAGE_DIR}"
  zip -rq "${ARCHIVE_PATH}" .
)

echo "打包完成: ${ARCHIVE_PATH}"
