# WebSocket API 文档

## 连接信息

### 连接地址
```
ws://localhost:3000/ws
```

### 连接配置
- **Namespace**: `/ws`
- **传输方式**: WebSocket 和 Polling（自动降级）
- **CORS**: 允许所有来源，支持凭证

### 连接示例（前端）

#### 使用 Socket.IO Client
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ws', {
  transports: ['websocket', 'polling'],
  withCredentials: true
});

socket.on('connect', () => {
  console.log('WebSocket 已连接:', socket.id);
});

socket.on('disconnect', () => {
  console.log('WebSocket 已断开');
});
```

---

## 客户端订阅事件

### 1. 订阅网页更新
**事件名**: `subscribe:webpage`

**说明**: 订阅网页数据更新通知

**发送数据**:
```javascript
socket.emit('subscribe:webpage', {});
```

**返回数据**:
```json
{
  "success": true
}
```

---

### 2. 取消订阅网页更新
**事件名**: `unsubscribe:webpage`

**说明**: 取消订阅网页数据更新通知

**发送数据**:
```javascript
socket.emit('unsubscribe:webpage');
```

**返回数据**:
```json
{
  "success": true
}
```

---

## 服务端推送事件

### 1. 网页创建事件
**事件名**: `webpage:created`

**说明**: 当插件提交新的网页数据时触发（所有类型的数据都会触发此事件）

**推送数据结构**:
```typescript
{
  id: string;              // 网页记录 ID
  url: string;             // 网页 URL
  title: string;           // 网页标题
  content: string;         // 文本内容
  htmlContent: string;     // HTML 内容
  domain: string;          // 域名
  metadata: object;        // 元数据
  sourcePluginId: string;  // 插件 ID
  browserType: string;     // 浏览器类型
  capturedAt: string;      // 捕获时间（ISO 8601）
  createdAt: string;       // 创建时间（ISO 8601）
  updatedAt: string;       // 更新时间（ISO 8601）
}
```

**监听示例**:
```javascript
socket.on('webpage:created', (data) => {
  console.log('新网页数据:', data);
  // 更新 UI，显示新数据
});
```

---

### 2. 网页删除事件
**事件名**: `webpage:deleted`

**说明**: 当网页数据被删除时触发

**推送数据结构**:
```typescript
{
  id: string;  // 被删除的网页记录 ID
}
```

**监听示例**:
```javascript
socket.on('webpage:deleted', (data) => {
  console.log('网页已删除:', data.id);
  // 从 UI 中移除对应数据
});
```

---

### 3. 统计数据更新事件
**事件名**: `statistics:updated`

**说明**: 当统计数据更新时触发

**推送数据结构**:
```typescript
{
  totalWebpages: number;    // 网页总数
  totalDomains: number;     // 域名总数
  recentWebpages: number;   // 最近网页数
  // ... 其他统计字段
}
```

**监听示例**:
```javascript
socket.on('statistics:updated', (stats) => {
  console.log('统计数据更新:', stats);
  // 更新统计面板
});
```

---

### 4. 请求接收事件
**事件名**: `request:received`

**说明**: 当服务器接收到代理请求时触发（请求开始处理）

**推送数据结构**:
```typescript
{
  id: string;              // 请求 ID
  url: string;             // 请求 URL
  method?: string;         // 请求方法（GET/POST 等）
  timestamp: string;       // 时间戳（ISO 8601）
  status: 'processing';    // 状态：处理中
}
```

**监听示例**:
```javascript
socket.on('request:received', (data) => {
  console.log('请求开始处理:', data.url);
  // 显示加载状态
});
```

---

### 5. 请求处理完成事件
**事件名**: `request:processed`

**说明**: 当代理请求处理完成时触发（成功或失败）

**推送数据结构**:
```typescript
{
  id: string;              // 请求 ID
  url: string;             // 请求 URL
  method?: string;         // 请求方法
  status: 'success' | 'error';  // 状态：成功或失败
  message?: string;        // 消息
  error?: string;          // 错误信息（失败时）
  skipped?: boolean;       // 是否跳过
  webpageId?: string;      // 网页记录 ID（成功时）
  responseBody?: string;   // 响应体（成功时）
  statusCode?: number;     // HTTP 状态码
}
```

**监听示例**:
```javascript
socket.on('request:processed', (data) => {
  if (data.status === 'success') {
    console.log('请求成功:', data.url, data.statusCode);
  } else {
    console.error('请求失败:', data.url, data.error);
  }
  // 更新 UI 状态
});
```

---

### 6. 通话记录创建事件 ⭐
**事件名**: `call-record:created`

**说明**: 当收到通话相关数据时触发（包括 4 种类型）
- `get_peer_status` - 对端状态
- `cont_controler` - 控制器状态
- `get_curcall_in` - 呼入通话
- `get_curcall_out` - 呼出通话

**推送数据结构**:
```typescript
{
  id: string;              // 网页记录 ID
  recordType: string;      // 记录类型（get_peer_status/cont_controler/get_curcall_in/get_curcall_out）
  url: string;             // 请求 URL
  content?: string;        // 响应内容（文本或 HTML）
  parsedData?: object;     // 解析后的数据（如果有）
  statusCode?: number;     // HTTP 状态码
  timestamp: string;       // 时间戳（ISO 8601）
}
```

**去重规则**:
- `get_peer_status` 和 `cont_controler`: **不去重**，每次都推送
- `get_curcall_in` 和 `get_curcall_out`: **按内容去重**，内容相同时不推送

**监听示例**:
```javascript
socket.on('call-record:created', (data) => {
  console.log('通话记录创建:', data.recordType);

  switch(data.recordType) {
    case 'get_peer_status':
      // 更新对端状态显示
      break;
    case 'cont_controler':
      // 更新控制器状态
      break;
    case 'get_curcall_in':
      // 添加到呼入通话列表
      break;
    case 'get_curcall_out':
      // 添加到呼出通话列表
      break;
  }
});
```

---

### 7. 通话记录更新事件
**事件名**: `call-record:updated`

**说明**: 当通话记录持续更新时触发（通话进行中）

**推送数据结构**:
```typescript
{
  id: string;              // 网页记录 ID
  recordType: string;      // 记录类型
  url: string;             // 请求 URL
  parsedData: object;      // 解析后的数据
  status: string;          // 状态
  timestamp: string;       // 时间戳（ISO 8601）
}
```

**监听示例**:
```javascript
socket.on('call-record:updated', (data) => {
  console.log('通话记录更新:', data.recordType, data.status);
  // 更新通话列表中的对应记录
});
```

---

### 8. 通话状态变更事件 ⭐
**事件名**: `call-status:changed`

**说明**: 当通话状态发生变化时触发（仅针对 `get_curcall_in` 和 `get_curcall_out`）

**触发条件**:
- 超过 3 秒没有新的数据更新，判定通话已结束
- 定时任务每秒检查一次

**推送数据结构**:
```typescript
{
  id: string;              // 网页记录 ID
  recordType: string;      // 记录类型（get_curcall_in 或 get_curcall_out）
  status: 'ended';         // 状态：已结束
  parsedData: null;        // 解析后的数据
  timestamp: string;       // 时间戳（ISO 8601）
}
```

**监听示例**:
```javascript
socket.on('call-status:changed', (data) => {
  console.log('通话已结束:', data.recordType, data.id);
  // 更新通话列表，标记通话为已结束状态
  // 可以显示通话时长、录音链接等
});
```

---

### 9. 数据变更事件
**事件名**: `data:changed`

**说明**: 当数据发生变更时触发（通用数据变更通知）

**推送数据结构**:
```typescript
{
  recordType: string;      // 记录类型
  oldData: object;         // 旧数据
  newData: object;         // 新数据
  timestamp: string;       // 时间戳（ISO 8601）
}
```

**监听示例**:
```javascript
socket.on('data:changed', (data) => {
  console.log('数据变更:', data.recordType);
  console.log('旧数据:', data.oldData);
  console.log('新数据:', data.newData);
  // 对比数据差异，更新 UI
});
```

---

## 完整使用示例

### React 示例
```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function App() {
  const [socket, setSocket] = useState(null);
  const [callRecords, setCallRecords] = useState([]);
  const [peerStatus, setPeerStatus] = useState(null);

  useEffect(() => {
    // 连接 WebSocket
    const newSocket = io('http://localhost:3000/ws', {
      transports: ['websocket', 'polling'],
      withCredentials: true
    });

    // 连接成功
    newSocket.on('connect', () => {
      console.log('WebSocket 已连接');
      // 订阅网页更新
      newSocket.emit('subscribe:webpage', {});
    });

    // 监听通话记录创建
    newSocket.on('call-record:created', (data) => {
      if (data.recordType === 'get_peer_status') {
        // 更新对端状态
        setPeerStatus(data.content);
      } else if (data.recordType === 'get_curcall_in' || data.recordType === 'get_curcall_out') {
        // 添加到通话列表
        setCallRecords(prev => [data, ...prev]);
      }
    });

    // 监听通话状态变更
    newSocket.on('call-status:changed', (data) => {
      // 更新通话状态为已结束
      setCallRecords(prev =>
        prev.map(record =>
          record.id === data.id
            ? { ...record, status: 'ended' }
            : record
        )
      );
    });

    // 监听网页创建
    newSocket.on('webpage:created', (data) => {
      console.log('新网页数据:', data);
    });

    setSocket(newSocket);

    // 清理
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <div>
      <h1>通话监控</h1>
      <div>对端状态: {peerStatus}</div>
      <div>
        <h2>通话记录</h2>
        {callRecords.map(record => (
          <div key={record.id}>
            {record.recordType} - {record.status || '进行中'}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Vue 3 示例
```javascript
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

export default {
  setup() {
    const socket = ref(null);
    const callRecords = ref([]);
    const peerStatus = ref(null);

    onMounted(() => {
      // 连接 WebSocket
      socket.value = io('http://localhost:3000/ws', {
        transports: ['websocket', 'polling'],
        withCredentials: true
      });

      // 连接成功
      socket.value.on('connect', () => {
        console.log('WebSocket 已连接');
        socket.value.emit('subscribe:webpage', {});
      });

      // 监听通话记录创建
      socket.value.on('call-record:created', (data) => {
        if (data.recordType === 'get_peer_status') {
          peerStatus.value = data.content;
        } else if (data.recordType === 'get_curcall_in' || data.recordType === 'get_curcall_out') {
          callRecords.value.unshift(data);
        }
      });

      // 监听通话状态变更
      socket.value.on('call-status:changed', (data) => {
        const index = callRecords.value.findIndex(r => r.id === data.id);
        if (index !== -1) {
          callRecords.value[index].status = 'ended';
        }
      });
    });

    onUnmounted(() => {
      if (socket.value) {
        socket.value.disconnect();
      }
    });

    return {
      callRecords,
      peerStatus
    };
  }
};
```

---

## 事件流程图

### 通话记录流程
```
插件发送数据
    ↓
服务器接收并保存到数据库
    ↓
识别记录类型（URL 关键词）
    ↓
┌─────────────────────────────────────┐
│  get_peer_status / cont_controler   │
│  - 不去重                            │
│  - 直接推送 call-record:created     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  get_curcall_in / get_curcall_out   │
│  - 内容去重                          │
│  - 推送 call-record:created         │
│  - 记录更新时间                      │
└─────────────────────────────────────┘
    ↓
定时任务每秒检查（仅通话类型）
    ↓
超过 3 秒无更新？
    ↓ 是
推送 call-status:changed (status: 'ended')
```

---

## 错误处理

### 连接错误
```javascript
socket.on('connect_error', (error) => {
  console.error('连接失败:', error);
  // 实现重连逻辑
});
```

### 断线重连
```javascript
socket.on('disconnect', (reason) => {
  console.log('连接断开:', reason);
  if (reason === 'io server disconnect') {
    // 服务器主动断开，需要手动重连
    socket.connect();
  }
  // 其他情况会自动重连
});
```

---

## 注意事项

1. **去重逻辑**:
   - `get_peer_status` 和 `cont_controler` 不去重，每次都推送最新数据
   - `get_curcall_in` 和 `get_curcall_out` 按内容去重，相同内容不重复推送

2. **通话结束判定**:
   - 仅针对 `get_curcall_in` 和 `get_curcall_out`
   - 超过 3 秒没有新数据更新，判定为通话结束
   - 会推送 `call-status:changed` 事件

3. **数据存储**:
   - 所有数据都存储在 `webpages` 表中
   - 通过 URL 关键词识别记录类型
   - WebSocket 推送不影响数据库存储

4. **性能优化**:
   - 使用内存缓存（Map）进行去重和状态跟踪
   - 不依赖数据库字段，减少数据库查询

---

## 相关文件

- WebSocket Gateway: `src/modules/websocket/websocket.gateway.ts`
- 通话记录服务: `src/modules/call-record/call-record.service.ts`
- 插件数据服务: `src/modules/plugin-data/plugin-data.service.ts`
