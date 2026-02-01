# 使用 Cookie 访问目标网站 - 完整指南

## 概述

您的后端支持**两种方式**使用 Cookie 访问目标网站,**不需要浏览器插件也可以工作**。

---

## 方式对比

### 方式 1: 浏览器插件代理请求
```
浏览器插件 → 后端 /api/plugin/requests → 目标网站
```
- ✅ 插件自动获取浏览器中的 Cookie
- ✅ 适合需要浏览器环境的场景
- ✅ 支持自动捕获网络请求

### 方式 2: 服务端直接代理请求 ⭐ **推荐用于测试**
```
任何客户端 → 后端 /api/plugin/proxy → 目标网站
```
- ✅ **不需要浏览器插件**
- ✅ 可以从任何地方调用(Postman、curl、Node.js、Python 等)
- ✅ 只需要提供 Cookie 字符串
- ✅ 适合自动化脚本和测试

---

## 使用方法

### 1. 使用 Node.js

```bash
node test-proxy-with-cookie.js
```

**代码示例**:
```javascript
const http = require('http');

const requestData = JSON.stringify({
  url: 'http://203.175.165.11:50221/modules/get_peer_status.php?date=' + Date.now(),
  method: 'GET',
  headers: {
    'Cookie': 'PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': '*/*',
    'Referer': 'http://203.175.165.11:50221/modules/index.php'
  }
});

const options = {
  hostname: 'localhost',
  port: 9000,
  path: '/api/plugin/proxy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const response = JSON.parse(data);
    console.log('响应体:', response.data.responseBody);
  });
});

req.write(requestData);
req.end();
```

---

### 2. 使用 curl

```bash
./test-proxy-curl.sh
```

**命令示例**:
```bash
curl -X POST "http://localhost:9000/api/plugin/proxy" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://203.175.165.11:50221/modules/get_peer_status.php?date=1769849100000",
    "method": "GET",
    "headers": {
      "Cookie": "PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "*/*"
    }
  }'
```

---

### 3. 使用 Python

```bash
python3 test-proxy-python.py
```

**代码示例**:
```python
import requests
import time

payload = {
    "url": f"http://203.175.165.11:50221/modules/get_peer_status.php?date={int(time.time() * 1000)}",
    "method": "GET",
    "headers": {
        "Cookie": "PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "*/*"
    }
}

response = requests.post(
    "http://localhost:9000/api/plugin/proxy",
    json=payload
)

data = response.json()
print("响应体:", data['data']['responseBody'])
```

---

### 4. 使用 Postman

1. **创建新请求**
   - Method: `POST`
   - URL: `http://localhost:9000/api/plugin/proxy`

2. **设置 Headers**
   - `Content-Type`: `application/json`

3. **设置 Body** (选择 raw, JSON)
   ```json
   {
     "url": "http://203.175.165.11:50221/modules/get_peer_status.php?date=1769849100000",
     "method": "GET",
     "headers": {
       "Cookie": "PHPSESSID=d4dd8e9a0ca5d6b89e58522cef9c4e75; COOKIE_USER_ID=697d9d830c40a",
       "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
       "Accept": "*/*"
     }
   }
   ```

4. **点击 Send**

---

## API 接口说明

### POST /api/plugin/proxy

**请求参数**:
```typescript
{
  url: string;              // 目标网站 URL (必填)
  method?: string;          // HTTP 方法 (可选, 默认 GET)
  headers?: {               // 请求头 (可选)
    Cookie: string;         // Cookie 字符串
    [key: string]: string;  // 其他请求头
  };
  body?: string;            // 请求体 (可选)
  contentType?: string;     // Content-Type (可选)
}
```

**响应格式**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "代理请求成功",
    "webpageId": "uuid-string",
    "statusCode": 200,
    "responseBody": "目标网站返回的完整响应体",
    "responseHeaders": {
      "content-type": "text/html; charset=utf-8",
      "server": "lighttpd/1.4.49"
    }
  },
  "statusCode": 201,
  "timestamp": "2026-01-31T08:43:59.231Z",
  "path": "/api/plugin/proxy"
}
```

---

## 如何获取 Cookie

### 方法 1: 从浏览器开发者工具获取

1. 打开目标网站
2. 按 `F12` 打开开发者工具
3. 切换到 `Application` 或 `存储` 标签
4. 点击左侧 `Cookies` → 选择目标域名
5. 复制所有 Cookie,格式为: `name1=value1; name2=value2`

### 方法 2: 从网络请求中复制

1. 打开开发者工具 (`F12`)
2. 切换到 `Network` 标签
3. 刷新页面或触发请求
4. 点击任意请求
5. 在 `Headers` 中找到 `Request Headers` → `Cookie`
6. 复制整个 Cookie 字符串

---

## 测试结果

✅ **测试成功!**

```
🚀 发起代理请求...
目标URL: http://203.175.165.11:50221/modules/get_peer_status.php?date=1769849064696
Cookie: _tea_utm_cache_10000007=undefined; PHPSESSID=d4dd8...

📨 收到响应:
状态码: 201

✅ 请求成功!

📊 响应信息:
- webpageId: 7c3368ee-7b13-4aec-a8b7-128edb19f9e9
- statusCode: 200
- 响应体长度: 178 字符

📄 响应体内容:
<font color='green'>綠色-待機</font>,<font color='red'> 紅色-離線</font>,
<font color='purple'> 紫色-振鈴</font>,<font color='blue'> 藍色-通話中</font>,
<font color='grey'> 灰色-斷線</font>&nbsp;<br/>
```

---

## 数据存储

所有通过代理请求获取的数据都会自动保存到数据库:

- **表名**: `webpages`
- **字段**:
  - `id`: 记录 UUID
  - `url`: 目标 URL
  - `content`: 响应体内容
  - `metadata`: 包含请求头、响应头、状态码等
  - `sourcePluginId`: `browser-extension-proxy`
  - `createdAt`: 创建时间

查询示例:
```sql
SELECT * FROM webpages
WHERE "sourcePluginId" = 'browser-extension-proxy'
ORDER BY "createdAt" DESC
LIMIT 10;
```

---

## 调试日志

后端已添加详细的 Cookie 调试日志,重启服务后会显示:

```
🍪 [Controller] 收到 Cookie:
   长度: 256 字符
   前100字符: PHPSESSID=abc123def456; user_token=xyz789...
   Cookie数量: 3 个

🌐 [Service] 准备发起 HTTP 请求:
   目标URL: http://example.com/api/data
   协议: HTTP
   方法: GET

🍪 [Service] 即将发送 Cookie 到目标网站:
   长度: 256 字符
   前100字符: PHPSESSID=abc123def456...

📨 [Service] 收到目标网站响应:
   状态码: 200
   响应体长度: 1024 字符
```

---

## 常见问题

### Q1: Cookie 过期了怎么办?
**A**: 重新从浏览器中获取最新的 Cookie 字符串。

### Q2: 目标网站返回 401/403 怎么办?
**A**: 检查:
1. Cookie 是否正确
2. 是否需要其他请求头(如 Referer, Origin)
3. Cookie 是否已过期

### Q3: 可以同时发送多个请求吗?
**A**: 可以!每个请求都是独立的,可以并发调用。

### Q4: 响应体太大会有问题吗?
**A**: 目前没有大小限制,但建议不要超过 10MB。

---

## 总结

✅ **不需要浏览器插件也可以使用 Cookie 访问目标网站**

✅ **支持多种编程语言和工具** (Node.js, Python, curl, Postman 等)

✅ **所有数据自动保存到数据库**

✅ **支持 WebSocket 实时推送**

✅ **完整的调试日志支持**

---

**最后更新**: 2026-01-31
