#!/bin/bash

# 测试脚本: 使用 curl 从服务端发起带 Cookie 的代理请求
#
# 使用方法:
# chmod +x test-proxy-curl.sh
# ./test-proxy-curl.sh

# 配置
BACKEND_URL="http://localhost:9000/api/plugin/proxy"
TARGET_URL="http://203.175.165.11:50221/modules/get_peer_status.php?date=$(date +%s)000"
COOKIE="_tea_utm_cache_10000007=undefined; PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a"

echo "🚀 发起代理请求..."
echo "目标URL: $TARGET_URL"
echo "Cookie: ${COOKIE:0:50}..."
echo ""

# 发起请求
curl -X POST "$BACKEND_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"$TARGET_URL\",
    \"method\": \"GET\",
    \"headers\": {
      \"Cookie\": \"$COOKIE\",
      \"User-Agent\": \"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36\",
      \"Accept\": \"*/*\",
      \"Referer\": \"http://203.175.165.11:50221/modules/index.php\",
      \"Accept-Language\": \"zh-CN,zh;q=0.9\"
    }
  }" \
  | jq '.'

echo ""
echo "✅ 请求完成"
