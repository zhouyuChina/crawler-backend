# 浏览器插件集成指南

## 问题：403 FORBIDDEN

当服务器代理请求时，如果目标服务器需要登录验证，会返回 403 错误。解决方案是让浏览器插件传递 cookies 给后端服务器。

## 解决方案：传递 Cookies

### 方法 1：使用 Chrome Extension API 获取 Cookies

```javascript
// manifest.json 需要添加权限
{
  "permissions": [
    "cookies",
    "webRequest",
    "<all_urls>"
  ]
}

// background.js 或 content script
async function getCookiesForUrl(url) {
  // 获取指定 URL 的所有 cookies
  const cookies = await chrome.cookies.getAll({ url: url });

  // 转换为 Cookie 字符串格式
  const cookieString = cookies
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');

  return cookieString;
}

// 发送代理请求
async function sendProxyRequest(url) {
  const cookieString = await getCookiesForUrl(url);

  const response = await fetch('http://localhost:9000/api/plugin/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: url,
      method: 'GET',
      headers: {
        'Cookie': cookieString,  // 传递 cookies
        'User-Agent': navigator.userAgent,  // 传递 User-Agent
        'Referer': window.location.href     // 传递 Referer
      }
    })
  });

  const data = await response.json();
  console.log('响应体:', data.data.responseBody);
}

// 示例调用
sendProxyRequest('http://203.175.165.11:50221/modules/cc_monitor/get_curcall_in.php?date=1767960084498');
```

### 方法 2：从 Document.cookie 获取（适用于 Content Script）

```javascript
// content-script.js
function sendProxyRequest(url) {
  // 直接使用 document.cookie 获取当前页面的 cookies
  const cookieString = document.cookie;

  fetch('http://localhost:9000/api/plugin/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: url,
      method: 'GET',
      headers: {
        'Cookie': cookieString,
        'User-Agent': navigator.userAgent,
        'Referer': window.location.href
      }
    })
  })
  .then(res => res.json())
  .then(data => {
    console.log('代理请求成功:', data);
  })
  .catch(error => {
    console.error('代理请求失败:', error);
  });
}
```

### 方法 3：拦截网络请求，提取 Headers（推荐）

```javascript
// background.js - 使用 webRequest API 监听请求

// manifest.json 需要添加权限
{
  "permissions": [
    "webRequest",
    "webRequestBlocking",
    "<all_urls>"
  ]
}

// 存储最近的请求头
let recentHeaders = {};

// 监听请求，记录请求头
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (details.url.includes('203.175.165.11:50221')) {
      // 保存这个请求的所有 headers
      const headers = {};
      details.requestHeaders.forEach(header => {
        headers[header.name] = header.value;
      });
      recentHeaders[details.url] = headers;
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// 发送代理请求时使用记录的 headers
function sendProxyRequestWithHeaders(url) {
  const headers = recentHeaders[url] || {};

  fetch('http://localhost:9000/api/plugin/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: url,
      method: 'GET',
      headers: headers  // 使用捕获的原始请求头
    })
  })
  .then(res => res.json())
  .then(data => {
    console.log('代理请求成功:', data);
  });
}
```

## 完整示例：Chrome Extension

### manifest.json
```json
{
  "manifest_version": 3,
  "name": "CRM Request Proxy",
  "version": "1.0",
  "permissions": [
    "cookies",
    "webRequest",
    "<all_urls>"
  ],
  "host_permissions": [
    "http://203.175.165.11/*",
    "http://localhost:9000/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"]
    }
  ]
}
```

### background.js
```javascript
// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'proxyRequest') {
    // 获取 cookies
    chrome.cookies.getAll({ url: request.url }, (cookies) => {
      const cookieString = cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      // 发送代理请求
      fetch('http://localhost:9000/api/plugin/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: request.url,
          method: request.method || 'GET',
          headers: {
            'Cookie': cookieString,
            'User-Agent': navigator.userAgent,
            ...request.extraHeaders
          }
        })
      })
      .then(res => res.json())
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    });

    return true; // 保持消息通道开放
  }
});
```

### content-script.js
```javascript
// 监听页面上的 AJAX 请求
(function() {
  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;

    // 如果是目标 URL，发送到后端代理
    if (url.includes('203.175.165.11:50221')) {
      console.log('拦截到请求:', url);

      // 通知 background script 发送代理请求
      chrome.runtime.sendMessage({
        action: 'proxyRequest',
        url: url,
        method: options?.method || 'GET',
        extraHeaders: options?.headers || {}
      }, (response) => {
        if (response.success) {
          console.log('代理请求成功:', response.data);
        }
      });
    }

    // 继续原始请求
    return originalFetch.apply(this, args);
  };
})();
```

## 测试代理请求（带 Cookies）

### 使用 curl 测试
```bash
curl -X POST http://localhost:9000/api/plugin/proxy \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://203.175.165.11:50221/modules/cc_monitor/get_curcall_in.php?date=1767960084498",
    "method": "GET",
    "headers": {
      "Cookie": "PHPSESSID=abc123; user_id=456",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "http://203.175.165.11:50221/index.php"
    }
  }'
```

### 使用 Node.js 测试
```javascript
const http = require('http');

const data = JSON.stringify({
  url: 'http://203.175.165.11:50221/modules/cc_monitor/get_curcall_in.php?date=1767960084498',
  method: 'GET',
  headers: {
    'Cookie': 'PHPSESSID=your_session_id_here; user_id=123',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'http://203.175.165.11:50221/index.php'
  }
});

const options = {
  hostname: 'localhost',
  port: 9000,
  path: '/api/plugin/proxy',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log('响应:', JSON.parse(responseData));
  });
});

req.write(data);
req.end();
```

## 关键点

1. **Cookie 必须传递**：目标服务器需要验证用户身份
2. **User-Agent 建议传递**：某些服务器会检查 User-Agent
3. **Referer 建议传递**：某些服务器会检查 Referer
4. **所有原始请求头都可以传递**：通过 `headers` 字段

## 后端服务器配置

后端代理请求功能已经支持自定义 headers，你只需要在浏览器插件中正确传递 cookies 和其他必要的 headers 即可。

**API 端点：** `POST http://localhost:9000/api/plugin/proxy`

**监控页面：** `http://localhost:9000/api/monitor`
