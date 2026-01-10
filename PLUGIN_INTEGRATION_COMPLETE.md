# 插件集成完成 ✅

## 集成状态

**✅ 联调已完成！** 后端现在完全支持插件的新数据格式。

## 工作原理

### 1. 插件发送数据（新格式）

插件按照以下格式发送数据到 `POST /api/plugin/requests`：

```json
{
  "requestId": "12345",
  "dataType": "request",
  "url": "http://203.175.165.11:50221/modules/cc_monitor/get_curcall_in.php",
  "method": "GET",
  "requestHeaders": [
    {"name": "Cookie", "value": "PHPSESSID=abc123..."},
    {"name": "User-Agent", "value": "Mozilla/5.0..."},
    {"name": "Referer", "value": "http://203.175.165.11:50221/"}
  ],
  "requestBody": "",
  "contentType": "application/json"
}
```

### 2. 后端自动处理流程

后端收到数据后会自动：

1. **识别数据类型**：检测到 `dataType: "request"`
2. **转换请求头格式**：将数组格式转换为对象格式
   ```javascript
   // 从这个格式：
   [{"name": "Cookie", "value": "..."}, ...]

   // 转换为：
   {"Cookie": "...", "User-Agent": "...", ...}
   ```
3. **发起代理请求**：使用转换后的请求头向目标服务器发起请求
4. **获取响应体**：接收完整的响应数据（包括响应体、状态码、响应头）
5. **存储到数据库**：保存请求和响应信息
6. **WebSocket 推送**：实时推送到监控页面

### 3. 返回给插件的数据

```json
{
  "success": true,
  "message": "代理请求成功",
  "webpageId": "26a43ff2-6719-4ccf-bf67-ccd265dd3239",
  "statusCode": 200,
  "responseBody": "<script>top.location.href='/timeout.php';</script>",
  "responseHeaders": {
    "x-powered-by": "PHP/5.2.10-2ubuntu6",
    "content-type": "text/html; charset=utf-8",
    "content-length": "53",
    "date": "Fri, 09 Jan 2026 12:20:18 GMT",
    "server": "lighttpd/1.4.49"
  }
}
```

## 测试结果

### ✅ 已验证功能

运行 `node test-plugin-integration.js` 的结果：

```
✅ 识别为插件代理请求格式
URL: http://203.175.165.11:50221/modules/cc_monitor/get_curcall_out.php
Method: GET
✅ 已转换请求头格式，共 5 个
✅ 代理请求成功，状态码: 200
✅ 响应体: <script>top.location.href='/timeout.php';</script>
✅ 已存储到数据库
✅ 已通过 WebSocket 推送到监控页面
```

## 实时监控

打开监控页面查看所有请求：

**监控页面地址：** http://localhost:9000/api/monitor

监控页面会实时显示：
- 📊 请求统计（总数、成功、失败、跳过、成功率）
- 📋 最近 100 条请求列表
- 📄 每个请求的响应体（可展开查看）
- 🕒 请求时间戳
- 🔗 请求 URL
- ✅/❌ 请求状态

## 插件端需要做的事情

### 1. 发送请求格式

确保插件按照以下格式发送数据：

```javascript
// 在浏览器插件中
fetch('http://localhost:9000/api/plugin/requests', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    requestId: 'unique-id',
    dataType: 'request',  // 重要：标识需要代理的请求
    url: targetUrl,
    method: 'GET',
    requestHeaders: [
      {name: 'Cookie', value: cookieValue},
      {name: 'User-Agent', value: navigator.userAgent},
      {name: 'Referer', value: window.location.href}
      // ... 其他请求头
    ]
  })
})
.then(res => res.json())
.then(data => {
  console.log('响应体:', data.responseBody);
  console.log('状态码:', data.statusCode);
});
```

### 2. 获取 Cookie

参考 [BROWSER_PLUGIN_EXAMPLE.md](./BROWSER_PLUGIN_EXAMPLE.md) 中的三种方法：

**方法 1：使用 Chrome Extension API**
```javascript
const cookies = await chrome.cookies.getAll({ url: targetUrl });
const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
```

**方法 2：从 document.cookie 获取**
```javascript
const cookieString = document.cookie;
```

**方法 3：拦截网络请求提取 Headers**
```javascript
chrome.webRequest.onBeforeSendHeaders.addListener(...);
```

## 完整的数据流程

```
┌─────────────────┐
│  浏览器插件      │
│  1. 捕获请求     │
│  2. 提取 Cookie  │
│  3. 提取 Headers │
└────────┬────────┘
         │ POST /api/plugin/requests
         │ {dataType: "request", requestHeaders: [...]}
         ▼
┌─────────────────┐
│  后端服务器      │
│  1. 识别格式     │ ✅ 检测 dataType === "request"
│  2. 转换 Headers │ ✅ 数组 -> 对象
│  3. 代理请求     │ ✅ 携带 Cookie 发起请求
│  4. 获取响应体   │ ✅ 完整的响应数据
│  5. 存储数据库   │ ✅ 保存到 webpages 表
│  6. WebSocket    │ ✅ 实时推送
└────────┬────────┘
         │
         ├─────────────────────────┐
         │                         │
         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐
│  返回给插件      │       │  监控页面        │
│  - responseBody │       │  - 实时显示      │
│  - statusCode   │       │  - 响应体预览    │
│  - webpageId    │       │  - 统计数据      │
└─────────────────┘       └─────────────────┘
```

## 下一步

1. ✅ **后端完成**：已支持新格式，无需修改
2. 🔧 **插件开发**：按照上述格式发送数据即可
3. 🧪 **测试验证**：运行 `node test-plugin-integration.js` 验证
4. 📊 **实时监控**：打开 http://localhost:9000/api/monitor 查看

## 关键代码位置

- **请求处理**: [src/modules/plugin-data/plugin-data.controller.ts:74-97](src/modules/plugin-data/plugin-data.controller.ts#L74-L97)
- **代理请求**: [src/modules/plugin-data/plugin-data.service.ts:256-350](src/modules/plugin-data/plugin-data.service.ts#L256-L350)
- **WebSocket 推送**: [src/modules/websocket/websocket.gateway.ts:62-89](src/modules/websocket/websocket.gateway.ts#L62-L89)
- **监控页面**: [public/monitor.html](public/monitor.html)

## 常见问题

### Q: 为什么收到 403 FORBIDDEN？
A: Cookie 无效或已过期。确保插件传递的是当前有效的 Cookie。

### Q: 为什么收到 timeout.php 重定向？
A: 会话超时。需要在浏览器中重新登录，然后插件获取新的 Cookie。

### Q: 如何查看响应体？
A: 打开监控页面 http://localhost:9000/api/monitor，点击响应体部分即可展开查看。

### Q: 插件如何获取响应？
A: 后端会直接返回响应体、状态码等信息给插件，插件可以从返回的 JSON 中获取。

---

**🎉 集成完成！现在插件可以直接使用新格式发送数据了。**
