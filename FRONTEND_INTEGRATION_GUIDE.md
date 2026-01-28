# 前端集成文档 - 通话记录系统

> 版本：v1.0
> 日期：2026-01-29
> 后端 API 基础地址：`http://localhost:3000`

---

## 📋 目录

- [一、REST API 接口](#一rest-api-接口)
- [二、WebSocket 实时通信](#二websocket-实时通信)
- [三、完整示例代码](#三完整示例代码)
- [四、TypeScript 类型定义](#四typescript-类型定义)
- [五、常见问题](#五常见问题)

---

## 一、REST API 接口

### 1.1 查询通话记录列表

**接口地址：** `GET /api/call-records`

**查询参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | number | 否 | 1 | 页码 |
| limit | number | 否 | 10 | 每页数量 |
| recordType | string | 否 | - | 记录类型过滤 |
| startDate | string | 否 | - | 开始日期 (ISO 8601) |
| endDate | string | 否 | - | 结束日期 (ISO 8601) |

**请求示例：**

```javascript
// 基本查询
fetch('http://localhost:3000/api/call-records?page=1&limit=20')
  .then(res => res.json())
  .then(data => console.log(data));

// 按类型过滤
fetch('http://localhost:3000/api/call-records?recordType=get_peer_status')
  .then(res => res.json())
  .then(data => console.log(data));

// 按日期范围查询
fetch('http://localhost:3000/api/call-records?startDate=2026-01-01&endDate=2026-01-31')
  .then(res => res.json())
  .then(data => console.log(data));
```

**响应示例：**

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "recordType": "get_peer_status",
      "url": "https://pbx.example.com/api/get_peer_status?peer=SIP/1001",
      "parsedData": {
        "status": "online",
        "duration": 120,
        "peer": "SIP/1001"
      },
      "statusCode": 200,
      "createdAt": "2026-01-29T10:00:00.000Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

---

### 1.2 获取单条记录详情

**接口地址：** `GET /api/call-records/:id`

**请求示例：**

```javascript
fetch('http://localhost:3000/api/call-records/550e8400-e29b-41d4-a716-446655440000')
  .then(res => res.json())
  .then(data => console.log(data));
```

**响应示例：**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "recordType": "get_peer_status",
  "url": "https://pbx.example.com/api/get_peer_status?peer=SIP/1001",
  "requestBody": null,
  "responseBody": "{\"status\":\"online\",\"duration\":120}",
  "parsedData": {
    "status": "online",
    "duration": 120,
    "peer": "SIP/1001"
  },
  "dataHash": "5d41402abc4b2a76b9719d911017c592",
  "statusCode": 200,
  "metadata": {
    "requestMethod": "GET",
    "requestHeaders": {},
    "responseHeaders": {}
  },
  "createdAt": "2026-01-29T10:00:00.000Z",
  "updatedAt": "2026-01-29T10:00:00.000Z"
}
```

---

### 1.3 获取最新记录

**接口地址：** `GET /api/call-records/latest/:recordType`

**请求示例：**

```javascript
// 获取最新的 get_peer_status 记录
fetch('http://localhost:3000/api/call-records/latest/get_peer_status')
  .then(res => res.json())
  .then(data => console.log(data));
```

**响应示例：**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "recordType": "get_peer_status",
  "url": "https://pbx.example.com/api/get_peer_status?peer=SIP/1001",
  "parsedData": {
    "status": "online",
    "duration": 120
  },
  "createdAt": "2026-01-29T10:00:00.000Z"
}
```

---

### 1.4 获取统计数据

**接口地址：** `GET /api/call-records/statistics`

**请求示例：**

```javascript
fetch('http://localhost:3000/api/call-records/statistics')
  .then(res => res.json())
  .then(data => console.log(data));
```

**响应示例：**

```json
{
  "totalRecords": 1500,
  "byType": {
    "get_curcall_in": 400,
    "get_curcall_out": 350,
    "get_peer_status": 500,
    "cont_controler": 250
  },
  "today": 120,
  "lastHour": 45
}
```

---

### 1.5 删除记录

**接口地址：** `DELETE /api/call-records/:id`

**请求示例：**

```javascript
fetch('http://localhost:3000/api/call-records/550e8400-e29b-41d4-a716-446655440000', {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log(data));
```

**响应示例：**

```json
{
  "message": "通话记录已删除"
}
```

---

## 二、WebSocket 实时通信

### 2.1 连接配置

**WebSocket 地址：** `ws://localhost:3000/ws`

**安装依赖：**

```bash
npm install socket.io-client
```

**基本连接：**

```javascript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000/ws', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
});

socket.on('connect', () => {
  console.log('✅ WebSocket 已连接');
});

socket.on('disconnect', () => {
  console.log('❌ WebSocket 已断开');
});

socket.on('connect_error', (error) => {
  console.error('连接错误:', error);
});
```

---

### 2.2 事件列表

#### 2.2.1 call-record:created

**触发时机：** 新通话记录创建时

**事件数据：**

```typescript
{
  id: string;              // 记录 ID
  recordType: string;      // 记录类型
  url: string;             // 请求 URL
  parsedData: any;         // 解析后的数据
  timestamp: string;       // ISO 8601 时间戳
}
```

**监听示例：**

```javascript
socket.on('call-record:created', (data) => {
  console.log('📞 新通话记录:', data);

  // 更新 UI
  addCallRecordToList(data);

  // 显示通知
  showNotification(`新的 ${data.recordType} 记录`);
});
```

---

#### 2.2.2 data:changed

**触发时机：** 数据变更时（仅针对 get_peer_status 和 cont_controler）

**事件数据：**

```typescript
{
  recordType: string;      // 记录类型
  oldData: any | null;     // 旧数据
  newData: any;            // 新数据
  timestamp: string;       // ISO 8601 时间戳
}
```

**监听示例：**

```javascript
socket.on('data:changed', (data) => {
  console.log('🔄 数据变更:', data);

  // 比较差异
  const changes = compareData(data.oldData, data.newData);

  // 更新 UI
  updateDataDisplay(data.newData);

  // 高亮变更部分
  highlightChanges(changes);
});
```

---

#### 2.2.3 request:received

**触发时机：** 收到请求时（处理开始）

**事件数据：**

```typescript
{
  id: string;              // 请求 ID
  url: string;             // 请求 URL
  method?: string;         // 请求方法
  timestamp: string;       // ISO 8601 时间戳
  status: 'processing';    // 处理状态
}
```

**监听示例：**

```javascript
socket.on('request:received', (data) => {
  console.log('📥 收到请求:', data);

  // 显示加载状态
  showLoadingIndicator(data.id);
});
```

---

#### 2.2.4 request:processed

**触发时机：** 请求处理完成时

**事件数据：**

```typescript
{
  id: string;                    // 请求 ID
  url: string;                   // 请求 URL
  method?: string;               // 请求方法
  status: 'success' | 'error';   // 处理状态
  message?: string;              // 消息
  error?: string;                // 错误信息
  skipped?: boolean;             // 是否跳过
  webpageId?: string;            // 记录 ID
  responseBody?: string;         // 响应体
  statusCode?: number;           // HTTP 状态码
}
```

**监听示例：**

```javascript
socket.on('request:processed', (data) => {
  console.log('✅ 请求处理完成:', data);

  // 隐藏加载状态
  hideLoadingIndicator(data.id);

  if (data.status === 'error') {
    showErrorMessage(data.error);
  } else if (data.skipped) {
    showInfoMessage(data.message);
  } else {
    showSuccessMessage(data.message);
  }
});
```

---

## 三、完整示例代码

### 3.1 React + TypeScript 示例

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface CallRecord {
  id: string;
  recordType: string;
  url: string;
  parsedData: any;
  timestamp: string;
}

interface DataChangedEvent {
  recordType: string;
  oldData: any;
  newData: any;
  timestamp: string;
}

export function useCallRecords() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 创建 WebSocket 连接
    const newSocket = io('ws://localhost:3000/ws', {
      transports: ['websocket'],
      reconnection: true,
    });

    // 连接事件
    newSocket.on('connect', () => {
      console.log('✅ WebSocket 已连接');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket 已断开');
      setIsConnected(false);
    });

    // 监听通话记录创建事件
    newSocket.on('call-record:created', (data: CallRecord) => {
      console.log('📞 新通话记录:', data);
      setRecords(prev => [data, ...prev]);
    });

    // 监听数据变更事件
    newSocket.on('data:changed', (data: DataChangedEvent) => {
      console.log('🔄 数据变更:', data);
      // 更新对应的记录
      setRecords(prev =>
        prev.map(record =>
          record.recordType === data.recordType
            ? { ...record, parsedData: data.newData }
            : record
        )
      );
    });

    setSocket(newSocket);

    // 清理函数
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return { socket, records, isConnected };
}

// 使用示例
export function CallRecordList() {
  const { records, isConnected } = useCallRecords();

  return (
    <div>
      <div>连接状态: {isConnected ? '✅ 已连接' : '❌ 未连接'}</div>
      <ul>
        {records.map(record => (
          <li key={record.id}>
            <strong>{record.recordType}</strong>
            <pre>{JSON.stringify(record.parsedData, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

### 3.2 Vue 3 + TypeScript 示例

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { io, Socket } from 'socket.io-client';

export function useCallRecords() {
  const socket = ref<Socket | null>(null);
  const records = ref<any[]>([]);
  const isConnected = ref(false);

  onMounted(() => {
    // 创建 WebSocket 连接
    socket.value = io('ws://localhost:3000/ws', {
      transports: ['websocket'],
      reconnection: true,
    });

    // 连接事件
    socket.value.on('connect', () => {
      console.log('✅ WebSocket 已连接');
      isConnected.value = true;
    });

    socket.value.on('disconnect', () => {
      console.log('❌ WebSocket 已断开');
      isConnected.value = false;
    });

    // 监听通话记录创建事件
    socket.value.on('call-record:created', (data) => {
      console.log('📞 新通话记录:', data);
      records.value.unshift(data);
    });

    // 监听数据变更事件
    socket.value.on('data:changed', (data) => {
      console.log('🔄 数据变更:', data);
      const index = records.value.findIndex(
        r => r.recordType === data.recordType
      );
      if (index !== -1) {
        records.value[index].parsedData = data.newData;
      }
    });
  });

  onUnmounted(() => {
    socket.value?.disconnect();
  });

  return { socket, records, isConnected };
}
```

---

### 3.3 原生 JavaScript 示例

```javascript
class CallRecordManager {
  constructor() {
    this.socket = null;
    this.records = [];
    this.listeners = {};
  }

  connect() {
    this.socket = io('ws://localhost:3000/ws', {
      transports: ['websocket'],
      reconnection: true,
    });

    this.socket.on('connect', () => {
      console.log('✅ WebSocket 已连接');
      this.emit('connected');
    });

    this.socket.on('disconnect', () => {
      console.log('❌ WebSocket 已断开');
      this.emit('disconnected');
    });

    this.socket.on('call-record:created', (data) => {
      console.log('📞 新通话记录:', data);
      this.records.unshift(data);
      this.emit('record-created', data);
    });

    this.socket.on('data:changed', (data) => {
      console.log('🔄 数据变更:', data);
      this.emit('data-changed', data);
    });
  }

  disconnect() {
    this.socket?.disconnect();
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(
        cb => cb !== callback
      );
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }
}

// 使用示例
const manager = new CallRecordManager();
manager.connect();

manager.on('record-created', (data) => {
  console.log('新记录:', data);
  // 更新 UI
  updateUI(data);
});

manager.on('data-changed', (data) => {
  console.log('数据变更:', data);
  // 更新 UI
  updateDataDisplay(data);
});
```

---

## 四、TypeScript 类型定义

```typescript
// 通话记录类型
export interface CallRecord {
  id: string;
  recordType: 'get_curcall_in' | 'get_curcall_out' | 'get_peer_status' | 'cont_controler';
  url: string;
  requestBody?: string;
  responseBody?: string;
  parsedData: any;
  dataHash?: string;
  statusCode?: number;
  metadata?: {
    requestMethod?: string;
    requestHeaders?: any;
    responseHeaders?: any;
  };
  createdAt: string;
  updatedAt: string;
}

// 分页查询参数
export interface QueryCallRecordDto {
  page?: number;
  limit?: number;
  recordType?: string;
  startDate?: string;
  endDate?: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// WebSocket 事件类型
export interface CallRecordCreatedEvent {
  id: string;
  recordType: string;
  url: string;
  parsedData: any;
  timestamp: string;
}

export interface DataChangedEvent {
  recordType: string;
  oldData: any;
  newData: any;
  timestamp: string;
}

export interface RequestReceivedEvent {
  id: string;
  url: string;
  method?: string;
  timestamp: string;
  status: 'processing';
}

export interface RequestProcessedEvent {
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

// 统计数据类型
export interface StatisticsResponse {
  totalRecords: number;
  byType: {
    get_curcall_in: number;
    get_curcall_out: number;
    get_peer_status: number;
    cont_controler: number;
  };
  today: number;
  lastHour: number;
}
```

---

## 五、常见问题

### 5.1 WebSocket 连接失败

**问题：** 无法连接到 WebSocket

**解决方案：**

1. 检查后端服务是否启动
2. 确认 WebSocket 地址正确
3. 检查防火墙设置
4. 查看浏览器控制台错误信息

```javascript
socket.on('connect_error', (error) => {
  console.error('连接错误:', error);
  // 可以尝试重新连接
  setTimeout(() => {
    socket.connect();
  }, 5000);
});
```

---

### 5.2 如何处理断线重连

**解决方案：**

```javascript
const socket = io('ws://localhost:3000/ws', {
  reconnection: true,           // 启用自动重连
  reconnectionDelay: 1000,      // 重连延迟 1 秒
  reconnectionAttempts: 5,      // 最多尝试 5 次
});

socket.on('reconnect', (attemptNumber) => {
  console.log(`重连成功，尝试次数: ${attemptNumber}`);
  // 重新获取数据
  fetchLatestRecords();
});

socket.on('reconnect_failed', () => {
  console.error('重连失败');
  // 显示错误提示
  showErrorMessage('无法连接到服务器，请刷新页面');
});
```

---

### 5.3 如何过滤特定类型的记录

**解决方案：**

```javascript
socket.on('call-record:created', (data) => {
  // 只处理 get_peer_status 类型的记录
  if (data.recordType === 'get_peer_status') {
    updatePeerStatus(data.parsedData);
  }
});
```

---

### 5.4 如何实现数据去重

**解决方案：**

```javascript
const recordsMap = new Map();

socket.on('call-record:created', (data) => {
  // 使用 ID 作为键，避免重复
  if (!recordsMap.has(data.id)) {
    recordsMap.set(data.id, data);
    addToUI(data);
  }
});
```

---

### 5.5 如何实现消息通知

**解决方案：**

```javascript
socket.on('data:changed', (data) => {
  // 浏览器通知
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('数据变更', {
      body: `${data.recordType} 数据已更新`,
      icon: '/icon.png'
    });
  }

  // 或者使用 UI 通知组件
  showToast({
    type: 'info',
    message: `${data.recordType} 数据已更新`,
    duration: 3000
  });
});
```

---

## 六、测试工具

### 6.1 使用 Postman 测试 REST API

1. 导入以下 Collection：

```json
{
  "info": {
    "name": "Call Records API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Get Call Records",
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "http://localhost:3000/api/call-records?page=1&limit=10",
          "protocol": "http",
          "host": ["localhost"],
          "port": "3000",
          "path": ["api", "call-records"],
          "query": [
            {"key": "page", "value": "1"},
            {"key": "limit", "value": "10"}
          ]
        }
      }
    }
  ]
}
```

---

### 6.2 使用浏览器控制台测试 WebSocket

打开浏览器控制台，粘贴以下代码：

```javascript
// 加载 socket.io-client
const script = document.createElement('script');
script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
document.head.appendChild(script);

script.onload = () => {
  const socket = io('ws://localhost:3000/ws');

  socket.on('connect', () => console.log('✅ 已连接'));
  socket.on('call-record:created', data => console.log('📞 新记录:', data));
  socket.on('data:changed', data => console.log('🔄 数据变更:', data));

  window.testSocket = socket;
};
```

---

## 七、性能优化建议

### 7.1 使用虚拟滚动

当记录数量很大时，使用虚拟滚动提升性能：

```javascript
import { FixedSizeList } from 'react-window';

function CallRecordList({ records }) {
  const Row = ({ index, style }) => (
    <div style={style}>
      {records[index].recordType}: {JSON.stringify(records[index].parsedData)}
    </div>
  );

  return (
    <FixedSizeList
      height={600}
      itemCount={records.length}
      itemSize={50}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

---

### 7.2 使用防抖处理高频更新

```javascript
import { debounce } from 'lodash';

const updateUI = debounce((data) => {
  // 更新 UI
  renderData(data);
}, 300);

socket.on('data:changed', (data) => {
  updateUI(data);
});
```

---

## 八、安全建议

### 8.1 验证数据

```javascript
socket.on('call-record:created', (data) => {
  // 验证数据结构
  if (!data.id || !data.recordType || !data.parsedData) {
    console.error('无效的数据格式:', data);
    return;
  }

  // 处理数据
  processRecord(data);
});
```

---

### 8.2 限制连接数

```javascript
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

socket.on('disconnect', () => {
  reconnectAttempts++;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('超过最大重连次数');
    socket.disconnect();
  }
});

socket.on('connect', () => {
  reconnectAttempts = 0;
});
```

---

## 联系方式

如有问题，请联系后端开发团队或查看后端文档：
- 后端实现文档：`CALL_RECORD_IMPLEMENTATION.md`
- GitHub Issues：[项目地址]

---

**文档版本：** v1.0
**最后更新：** 2026-01-29
**维护者：** 开发团队
