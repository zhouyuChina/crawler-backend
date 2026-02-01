#!/usr/bin/env python3
"""
测试脚本: 使用 Python 从服务端发起带 Cookie 的代理请求

使用方法:
python3 test-proxy-python.py
"""

import requests
import json
import time

# 配置
BACKEND_URL = "http://localhost:9000/api/plugin/proxy"
TARGET_URL = f"http://203.175.165.11:50221/modules/get_peer_status.php?date={int(time.time() * 1000)}"
COOKIE = "_tea_utm_cache_10000007=undefined; PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a"

# 构造请求数据
payload = {
    "url": TARGET_URL,
    "method": "GET",
    "headers": {
        "Cookie": COOKIE,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "*/*",
        "Referer": "http://203.175.165.11:50221/modules/index.php",
        "Accept-Language": "zh-CN,zh;q=0.9"
    }
}

print("🚀 发起代理请求...")
print(f"目标URL: {TARGET_URL}")
print(f"Cookie: {COOKIE[:50]}...")
print()

try:
    # 发起请求
    response = requests.post(
        BACKEND_URL,
        json=payload,
        headers={"Content-Type": "application/json"}
    )

    print(f"📨 收到响应:")
    print(f"状态码: {response.status_code}")
    print()

    if response.status_code == 200 or response.status_code == 201:
        data = response.json()

        if data.get("success"):
            print("✅ 请求成功!")
            print()
            print("📊 响应信息:")
            print(f"- webpageId: {data.get('webpageId')}")
            print(f"- statusCode: {data.get('statusCode')}")
            print(f"- 响应体长度: {len(data.get('responseBody', ''))} 字符")
            print()
            print("📄 响应体内容:")
            print(data.get('responseBody'))
            print()
            print("📋 响应头:")
            print(json.dumps(data.get('responseHeaders'), indent=2, ensure_ascii=False))
        else:
            print(f"❌ 请求失败: {data.get('message') or data.get('error')}")
    else:
        print(f"❌ HTTP 错误: {response.status_code}")
        print(response.text)

except requests.exceptions.RequestException as e:
    print(f"❌ 请求错误: {e}")
except json.JSONDecodeError as e:
    print(f"❌ 解析响应失败: {e}")
    print(f"原始响应: {response.text}")
