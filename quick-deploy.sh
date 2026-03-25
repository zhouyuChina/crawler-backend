#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env.production"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "未检测到 Docker Compose，请先安装 Docker Desktop 或 docker-compose。"
  exit 1
fi

cd "${ROOT_DIR}"

if [ ! -f "${ENV_FILE}" ]; then
  cp "${ROOT_DIR}/.env.production.example" "${ENV_FILE}"
  echo "已创建 .env.production，当前使用仓库内的快速部署默认值。"
  echo "如果服务需要暴露到公网，部署完成后请尽快修改 DB_PASSWORD 和 CORS_ORIGIN。"
fi

mkdir -p "${ROOT_DIR}/uploads"

"${COMPOSE_CMD[@]}" --env-file "${ENV_FILE}" up -d --build

PORT_VALUE="$(awk -F= '$1 == "PORT" { print $2 }' "${ENV_FILE}")"
PORT_VALUE="${PORT_VALUE:-3000}"

echo ""
echo "部署完成，建议检查以下地址："
echo "  API: http://localhost:${PORT_VALUE}/api"
echo "  Health: http://localhost:${PORT_VALUE}/api/health"
echo ""
echo "查看日志："
echo "  ${COMPOSE_CMD[*]} --env-file .env.production logs -f app"
echo ""
echo "首次部署确认表结构创建成功后，建议把 .env.production 中的 DB_SYNCHRONIZE 改为 false，再重新执行一次本脚本。"
