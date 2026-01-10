# 前端调用示例

完整 API 文档请查看：[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

---

## 快速开始

### 1. React 示例

```jsx
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const API_BASE = 'http://localhost:9000/api';
const WS_URL = 'http://localhost:9000/ws';

function WebpageList() {
  const [webpages, setWebpages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);

  // 获取网页列表
  useEffect(() => {
    fetchWebpages();
  }, []);

  // WebSocket 实时更新
  useEffect(() => {
    const ws = io(WS_URL);
    setSocket(ws);

    ws.on('connect', () => {
      console.log('WebSocket 已连接');
      ws.emit('subscribe:webpage');
    });

    ws.on('webpage:created', (webpage) => {
      console.log('新网页:', webpage);
      setWebpages(prev => [webpage, ...prev]);
    });

    ws.on('request:processed', (result) => {
      if (result.status === 'success' && !result.skipped) {
        console.log('请求成功:', result.url);
        console.log('响应体:', result.responseBody);
      }
    });

    return () => {
      ws.emit('unsubscribe:webpage');
      ws.disconnect();
    };
  }, []);

  const fetchWebpages = async (page = 1) => {
    try {
      const res = await fetch(`${API_BASE}/webpage?page=${page}&limit=20`);
      const data = await res.json();
      setWebpages(data.data);
    } catch (error) {
      console.error('获取失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteWebpage = async (id) => {
    try {
      await fetch(`${API_BASE}/webpage/${id}`, {
        method: 'DELETE'
      });
      setWebpages(prev => prev.filter(w => w.id !== id));
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div>
      <h1>网页列表</h1>
      {webpages.map(webpage => (
        <div key={webpage.id} className="webpage-card">
          <h3>{webpage.title}</h3>
          <p>{webpage.url}</p>
          <p>状态码: {webpage.metadata?.statusCode}</p>
          <button onClick={() => deleteWebpage(webpage.id)}>删除</button>
        </div>
      ))}
    </div>
  );
}

export default WebpageList;
```

---

### 2. Vue 示例

```vue
<template>
  <div class="webpage-list">
    <h1>网页列表</h1>

    <div v-if="loading">加载中...</div>

    <div v-else>
      <div v-for="webpage in webpages" :key="webpage.id" class="webpage-card">
        <h3>{{ webpage.title }}</h3>
        <p>{{ webpage.url }}</p>
        <p>状态码: {{ webpage.metadata?.statusCode }}</p>
        <button @click="deleteWebpage(webpage.id)">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import io from 'socket.io-client';

const API_BASE = 'http://localhost:9000/api';
const WS_URL = 'http://localhost:9000/ws';

const webpages = ref([]);
const loading = ref(true);
let socket = null;

onMounted(async () => {
  await fetchWebpages();

  // WebSocket 连接
  socket = io(WS_URL);

  socket.on('connect', () => {
    console.log('WebSocket 已连接');
    socket.emit('subscribe:webpage');
  });

  socket.on('webpage:created', (webpage) => {
    webpages.value.unshift(webpage);
  });

  socket.on('request:processed', (result) => {
    if (result.status === 'success') {
      console.log('请求成功:', result.responseBody);
    }
  });
});

onUnmounted(() => {
  if (socket) {
    socket.emit('unsubscribe:webpage');
    socket.disconnect();
  }
});

const fetchWebpages = async (page = 1) => {
  try {
    const res = await fetch(`${API_BASE}/webpage?page=${page}&limit=20`);
    const data = await res.json();
    webpages.value = data.data;
  } catch (error) {
    console.error('获取失败:', error);
  } finally {
    loading.value = false;
  }
};

const deleteWebpage = async (id) => {
  try {
    await fetch(`${API_BASE}/webpage/${id}`, {
      method: 'DELETE'
    });
    webpages.value = webpages.value.filter(w => w.id !== id);
  } catch (error) {
    console.error('删除失败:', error);
  }
};
</script>
```

---

### 3. 原生 JavaScript 示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>CRM 前端示例</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
  <h1>网页列表</h1>
  <div id="webpages"></div>

  <script>
    const API_BASE = 'http://localhost:9000/api';
    const WS_URL = 'http://localhost:9000/ws';

    // 获取网页列表
    async function fetchWebpages() {
      try {
        const res = await fetch(`${API_BASE}/webpage?page=1&limit=20`);
        const data = await res.json();
        renderWebpages(data.data);
      } catch (error) {
        console.error('获取失败:', error);
      }
    }

    // 渲染网页列表
    function renderWebpages(webpages) {
      const container = document.getElementById('webpages');
      container.innerHTML = webpages.map(w => `
        <div class="webpage-card">
          <h3>${w.title}</h3>
          <p>${w.url}</p>
          <p>状态码: ${w.metadata?.statusCode || 'N/A'}</p>
          <button onclick="deleteWebpage('${w.id}')">删除</button>
        </div>
      `).join('');
    }

    // 删除网页
    async function deleteWebpage(id) {
      try {
        await fetch(`${API_BASE}/webpage/${id}`, {
          method: 'DELETE'
        });
        fetchWebpages(); // 重新加载列表
      } catch (error) {
        console.error('删除失败:', error);
      }
    }

    // WebSocket 连接
    const socket = io(WS_URL);

    socket.on('connect', () => {
      console.log('WebSocket 已连接');
      socket.emit('subscribe:webpage');
    });

    socket.on('webpage:created', (webpage) => {
      console.log('新网页:', webpage);
      fetchWebpages(); // 重新加载列表
    });

    socket.on('request:processed', (result) => {
      if (result.status === 'success') {
        console.log('请求成功:', result.url);
        console.log('响应体:', result.responseBody);
      }
    });

    // 初始化
    fetchWebpages();
  </script>
</body>
</html>
```

---

## 浏览器插件集成示例

### Chrome Extension (Manifest V3)

**manifest.json**:

```json
{
  "manifest_version": 3,
  "name": "CRM Data Collector",
  "version": "1.0",
  "permissions": [
    "cookies",
    "webRequest"
  ],
  "host_permissions": [
    "<all_urls>"
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

**background.js**:

```javascript
const API_BASE = 'http://localhost:9000/api';

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'proxyRequest') {
    handleProxyRequest(request.data).then(sendResponse);
    return true; // 保持消息通道开放
  }
});

async function handleProxyRequest(data) {
  try {
    // 获取 Cookie
    const cookies = await chrome.cookies.getAll({ url: data.url });
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 发送代理请求
    const response = await fetch(`${API_BASE}/plugin/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dataType: 'request',
        requestId: data.requestId || generateId(),
        url: data.url,
        method: data.method || 'GET',
        requestHeaders: [
          { name: 'Cookie', value: cookieString },
          { name: 'User-Agent', value: navigator.userAgent },
          { name: 'Referer', value: data.referer || '' }
        ]
      })
    });

    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
```

**content-script.js**:

```javascript
// 拦截页面上的请求
(function() {
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const [url, options] = args;

    // 检查是否是需要代理的 URL
    if (typeof url === 'string' && shouldProxy(url)) {
      console.log('拦截请求:', url);

      // 发送到后端代理
      chrome.runtime.sendMessage({
        action: 'proxyRequest',
        data: {
          url: url,
          method: options?.method || 'GET',
          referer: window.location.href
        }
      }, (response) => {
        if (response.success) {
          console.log('代理请求成功:', response.data);
        }
      });
    }

    // 继续原始请求
    return originalFetch.apply(this, args);
  };

  function shouldProxy(url) {
    // 自定义规则，判断是否需要代理
    return url.includes('203.175.165.11');
  }
})();
```

---

## 常见场景示例

### 场景 1: 实时监控请求

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:9000/ws');
const requests = new Map(); // 存储请求状态

socket.on('connect', () => {
  console.log('✅ 监控已启动');
});

// 监听请求开始
socket.on('request:received', (data) => {
  requests.set(data.id, {
    ...data,
    status: 'processing',
    startTime: Date.now()
  });

  updateUI();
});

// 监听请求完成
socket.on('request:processed', (result) => {
  const request = requests.get(result.id);
  if (request) {
    request.status = result.status;
    request.statusCode = result.statusCode;
    request.responseBody = result.responseBody;
    request.error = result.error;
    request.duration = Date.now() - request.startTime;

    updateUI();
  }
});

function updateUI() {
  console.log('当前请求数:', requests.size);
  console.log('处理中:', [...requests.values()].filter(r => r.status === 'processing').length);
  console.log('成功:', [...requests.values()].filter(r => r.status === 'success').length);
}
```

---

### 场景 2: 分页加载

```javascript
class WebpageList {
  constructor() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.totalPages = 0;
  }

  async loadPage(page = 1) {
    const response = await fetch(
      `http://localhost:9000/api/webpage?page=${page}&limit=${this.pageSize}`
    );
    const data = await response.json();

    this.currentPage = page;
    this.totalPages = data.meta.totalPages;

    return data.data;
  }

  async nextPage() {
    if (this.currentPage < this.totalPages) {
      return this.loadPage(this.currentPage + 1);
    }
  }

  async prevPage() {
    if (this.currentPage > 1) {
      return this.loadPage(this.currentPage - 1);
    }
  }
}

// 使用
const list = new WebpageList();
const webpages = await list.loadPage(1);
console.log('第1页数据:', webpages);
```

---

### 场景 3: 搜索和筛选

```javascript
async function searchWebpages(params) {
  const queryParams = new URLSearchParams();

  if (params.keyword) queryParams.append('keyword', params.keyword);
  if (params.domain) queryParams.append('domain', params.domain);
  if (params.startDate) queryParams.append('startDate', params.startDate);
  if (params.endDate) queryParams.append('endDate', params.endDate);
  queryParams.append('page', params.page || 1);
  queryParams.append('limit', params.limit || 20);

  const response = await fetch(
    `http://localhost:9000/api/webpage?${queryParams.toString()}`
  );
  return response.json();
}

// 使用示例
const results = await searchWebpages({
  keyword: '登录',
  domain: 'example.com',
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  page: 1,
  limit: 20
});

console.log('搜索结果:', results.data);
console.log('总数:', results.meta.total);
```

---

### 场景 4: 统计数据可视化

```javascript
async function loadStatistics() {
  // 获取概览统计
  const overview = await fetch('http://localhost:9000/api/statistics/overview')
    .then(res => res.json());

  // 获取域名分析
  const domainAnalysis = await fetch('http://localhost:9000/api/statistics/domain-analysis')
    .then(res => res.json());

  // 获取时间序列（最近7天）
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const timeSeries = await fetch(
    `http://localhost:9000/api/statistics/time-series?startDate=${startDate}&endDate=${endDate}`
  ).then(res => res.json());

  return {
    overview,
    domainAnalysis,
    timeSeries
  };
}

// 使用示例 (配合图表库如 Chart.js)
const stats = await loadStatistics();

console.log('总记录数:', stats.overview.totalWebpages);
console.log('今日新增:', stats.overview.todayCount);
console.log('域名排行:', stats.domainAnalysis.domains);
console.log('趋势数据:', stats.timeSeries.timeSeries);
```

---

### 场景 5: 响应体查看

```javascript
async function viewResponseBody(webpageId) {
  const response = await fetch(`http://localhost:9000/api/webpage/${webpageId}`);
  const webpage = await response.json();

  console.log('URL:', webpage.url);
  console.log('状态码:', webpage.metadata?.statusCode);

  // 响应体可能在 content 或 htmlContent 字段
  const responseBody = webpage.content || webpage.htmlContent;
  console.log('响应体:', responseBody);

  // 如果是 JSON，尝试解析
  try {
    const json = JSON.parse(responseBody);
    console.log('JSON 数据:', json);
  } catch {
    console.log('非 JSON 数据');
  }

  return webpage;
}

// 使用
const webpage = await viewResponseBody('4c9c6199-6662-49cf-82e3-4901808bd624');
```

---

## 错误处理示例

```javascript
async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('资源不存在');
      } else if (response.status === 400) {
        const error = await response.json();
        throw new Error(error.message || '请求参数错误');
      } else if (response.status === 500) {
        throw new Error('服务器错误，请稍后重试');
      } else {
        throw new Error(`请求失败: ${response.status}`);
      }
    }

    return await response.json();
  } catch (error) {
    console.error('API 请求失败:', error);
    throw error;
  }
}

// 使用
try {
  const data = await apiRequest('http://localhost:9000/api/webpage/invalid-id');
} catch (error) {
  alert(error.message); // 显示错误信息
}
```

---

## TypeScript 类型定义

```typescript
// types.ts

export interface Webpage {
  id: string;
  url: string;
  title: string;
  content: string;
  htmlContent: string;
  domain: string;
  metadata: {
    description?: string;
    statusCode?: number;
    requestMethod?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    proxied?: boolean;
  };
  sourcePluginId: string;
  browserType: string;
  createdAt: string;
  updatedAt: string;
  capturedAt: string;
}

export interface WebpageListResponse {
  data: Webpage[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ProxyRequest {
  dataType: 'request';
  requestId: string;
  url: string;
  method?: string;
  requestHeaders?: Array<{ name: string; value: string }>;
  requestBody?: string;
  contentType?: string;
}

export interface ProxyResponse {
  success: boolean;
  message: string;
  webpageId: string;
  statusCode: number;
  responseBody: string;
  responseHeaders: Record<string, string>;
}

export interface RequestProcessed {
  id: string;
  url: string;
  method?: string;
  status: 'success' | 'error';
  message?: string;
  error?: string;
  skipped?: boolean;
  webpageId?: string;
  responseBody?: string;
  statusCode?: number;
}
```

---

**更多详细信息请查看**: [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
