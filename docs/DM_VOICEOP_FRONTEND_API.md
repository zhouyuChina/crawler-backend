# 手拨记录前端接口文档

本文档面向前端，说明 `cc_voiceop`（人工记录）与 `dm_voiceop`（手拨记录）的触发、WS 推送与查询接口。

## 1. 触发抓取接口

- **URL**: `POST /api/plugin/table-crawl`
- **说明**: 触发表格抓取。后端将按 URL 自动匹配 `cc_voiceop` 或 `dm_voiceop` 策略。

### 请求体

```json
{
  "crmKey": "http://173.234.2.174:55668",
  "url": "http://173.234.2.174:55668/modules/dm_voiceop/index.php?mid=25&pageID=1",
  "headers": {
    "Cookie": "PHPSESSID=...",
    "Referer": "http://173.234.2.174:55668/modules/dm_voiceop/?mid=25",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  }
}
```

### 响应（示例）

```json
{
  "success": true,
  "module": "voice_dm_op",
  "mid": 25,
  "taskId": "f9b2485b-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "totalPages": 5,
  "pagesToFetch": 5
}
```

## 2. WS 订阅与推送

- **命名空间**: `/ws`
- **订阅事件**: `subscribe:table-crawl`
- **退订事件**: `unsubscribe:table-crawl`

`cc_voiceop` 与 `dm_voiceop` 共用同一套 WS 事件，前端通过 `module` 区分来源。

### 2.0 订阅/退订参数（支持单个/多个 crmKey）

`subscribe:table-crawl` 和 `unsubscribe:table-crawl` 均支持：

- 单个：`{ crmKey: 'http://173.234.2.174:55668' }`
- 多个：`{ crmKeys: ['http://173.234.2.174:55668', 'http://45.32.124.36:62361'] }`
- 不传参数：加入/退出 legacy 房间 `table-crawl`（兼容旧前端）

#### 前端示例

```javascript
// 订阅单个
socket.emit('subscribe:table-crawl', {
  crmKey: 'http://173.234.2.174:55668',
});

// 订阅多个
socket.emit('subscribe:table-crawl', {
  crmKeys: ['http://173.234.2.174:55668', 'http://45.32.124.36:62361'],
});

// 退订并查看本次实际退出的房间
socket.emit(
  'unsubscribe:table-crawl',
  { crmKeys: ['http://173.234.2.174:55668'] },
  (ack) => {
    // ack: { success: true, leftRooms: ['table-crawl:http://173.234.2.174:55668', ...] }
    console.log(ack);
  },
);
```

### 2.1 `table-crawl:summary`

```json
{
  "crmKey": "http://173.234.2.174:55668",
  "module": "voice_op",
  "mid": 25,
  "summary": {
    "totalRecords": 50,
    "initCount": 5,
    "ringing": 0,
    "connected": 33,
    "agentCount": 2,
    "connectRate": 70,
    "callbackRate": 5
  },
  "totalPages": 5,
  "pagesToFetch": 5,
  "capturedAt": "2026-06-11T13:37:55.000Z",
  "taskId": "f9b2485b-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### 2.2 `table-crawl:rows`

```json
{
  "crmKey": "http://173.234.2.174:55668",
  "module": "voice_dm_op",
  "mid": 25,
  "page": 2,
  "rows": [
    {
      "id": "uuid",
      "crmKey": "http://173.234.2.174:55668",
      "mid": 25,
      "recordKey": "2b0a...",
      "src": "732101",
      "dst": "2413020047",
      "callDate": "2026-06-11T07:37:28.000Z"
    }
  ],
  "taskId": "f9b2485b-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "timestamp": "2026-06-11T13:37:56.000Z"
}
```

### 2.3 `table-crawl:progress`

```json
{
  "crmKey": "http://173.234.2.174:55668",
  "module": "voice_dm_op",
  "mid": 25,
  "taskId": "f9b2485b-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "page": 3,
  "pagesToFetch": 5,
  "status": "running"
}
```

`status` 取值：`running | completed | failed | throttled`

## 3. 查询接口（crmKey + 日期）

- **URL**: `GET /api/plugin/voice-op-daily`
- **说明**: 查询指定日期（北京时间）的汇总与分页明细，支持 `voice_op` 和 `voice_dm_op`。

### Query 参数

- `crmKey` 必填，例如 `http://173.234.2.174:55668`
- `date` 必填，格式 `YYYY-MM-DD`（北京时间）
- `module` 选填，`voice_op` 或 `voice_dm_op`，默认 `voice_op`
- `page` 选填，默认 `1`
- `limit` 选填，默认 `50`，最大 `500`

### 响应（示例）

```json
{
  "crmKey": "http://173.234.2.174:55668",
  "module": "voice_dm_op",
  "date": "2026-06-11",
  "summary": {
    "totalRecords": 50,
    "initCount": 5,
    "ringing": 0,
    "connected": 33,
    "agentCount": 2,
    "connectRate": 70,
    "callbackRate": 5,
    "totalPages": 5,
    "capturedAt": "2026-06-11T13:37:55.000Z"
  },
  "items": [
    {
      "id": "uuid",
      "crmKey": "http://173.234.2.174:55668",
      "mid": 25,
      "src": "732101",
      "dst": "2413020047",
      "reason": "通話接通",
      "duration": "00:00:27",
      "callDate": "2026-06-11T07:37:28.000Z",
      "endDate": "2026-06-11T07:37:55.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 50,
    "totalPages": 1
  }
}
```

## 4. 配置页抓取内容字段

配置页新增了抓取内容选项：

- `handDialRecords`: 手拨记录（`dm_voiceop`）

新增配置时该选项默认勾选。
