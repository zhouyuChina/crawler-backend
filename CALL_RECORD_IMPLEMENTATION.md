# 通话记录系统实现方案

> 版本：v1.0
> 日期：2026-01-29
> 作者：开发团队

---

## 📋 目录

- [一、需求分析](#一需求分析)
- [二、技术方案设计](#二技术方案设计)
- [三、数据库设计](#三数据库设计)
- [四、核心功能实现](#四核心功能实现)
- [五、API 接口设计](#五api-接口设计)
- [六、WebSocket 事件设计](#六websocket-事件设计)
- [七、实现步骤](#七实现步骤)

---

## 一、需求分析

### 1.1 业务背景

当前系统将所有从浏览器插件转发的请求数据直接存入数据库，导致：
- 数据量过大，存储成本高
- 大量重复数据，查询效率低
- 无法及时通知前端数据变更

### 1.2 业务需求

**第一步：请求过滤**

只处理包含以下关键词的请求：
- `get_curcall_in` - 获取呼入通话信息
- `get_curcall_out` - 获取呼出通话信息
- `get_peer_status` - 获取对端状态
- `cont_controler` - 控制器相关

其他请求不实际发起代理请求，直接跳过。

**第二步：数据变更检测**

针对以下两种类型的请求，实现数据变更检测：
- `get_peer_status`
- `cont_controler`

如果数据与上次一致，则跳过保存；如果数据发生变化，则：
1. 保存到数据库
2. 通过 WebSocket 推送给前端

---

## 二、技术方案设计

### 2.1 整体架构流程

```
浏览器插件
    ↓
POST /api/plugin/requests
    ↓
URL 关键词过滤 (是否包含必要关键词)
    ↓
识别 recordType (从 URL 提取关键词)
    ↓
发起代理请求获取响应体
    ↓
判断是否需要变更检测
    ├─ get_peer_status / cont_controler → 计算哈希 → 比较 → 跳过/保存
    └─ get_curcall_in / get_curcall_out → 直接保存
    ↓
保存到数据库 (call_records)
    ↓
WebSocket 推送
    ↓
返回响应
```

### 2.2 关键技术点

#### URL 关键词匹配
```typescript
const ALLOWED_KEYWORDS = [
  'get_curcall_in',
  'get_curcall_out',
  'get_peer_status',
  'cont_controler'
];
```

#### 数据变更检测
```typescript
// 使用 MD5 哈希值比较
function calculateHash(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}
```

---

## 三、数据库设计

### 3.1 新增表：call_records

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | UUID | PK | 主键 |
| `recordType` | VARCHAR(50) | NOT NULL | 记录类型 |
| `url` | VARCHAR(500) | NOT NULL | 原始请求 URL |
| `requestBody` | TEXT | NULL | 请求体内容 |
| `responseBody` | TEXT | NULL | 响应体内容 |
| `parsedData` | JSONB | NULL | 解析后的 JSON 数据 |
| `dataHash` | VARCHAR(32) | NULL | MD5 哈希值（用于变更检测） |
| `statusCode` | INT | NULL | HTTP 状态码 |
| `metadata` | JSONB | NULL | 其他元数据 |
| `createdAt` | TIMESTAMP | NOT NULL | 创建时间 |
| `updatedAt` | TIMESTAMP | NOT NULL | 更新时间 |

### 3.2 索引设计

```sql
CREATE INDEX idx_call_records_record_type ON call_records(recordType);
CREATE INDEX idx_call_records_created_at ON call_records(createdAt DESC);
CREATE INDEX idx_call_records_type_created ON call_records(recordType, createdAt DESC);
```

### 3.3 Entity 定义

```typescript
@Entity('call_records')
@Index(['recordType', 'createdAt'])
export class CallRecord {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  recordType: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'text', nullable: true })
  requestBody: string;

  @Column({ type: 'text', nullable: true })
  responseBody: string;

  @Column({ type: 'jsonb', nullable: true })
  parsedData: any;

  @Column({ type: 'varchar', length: 32, nullable: true })
  dataHash: string;

  @Column({ type: 'int', nullable: true })
  statusCode: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

---

## 四、核心功能实现

### 4.1 模块结构

```
src/modules/call-record/
├── call-record.module.ts
├── call-record.controller.ts
├── call-record.service.ts
├── entities/
│   └── call-record.entity.ts
└── dto/
    ├── create-call-record.dto.ts
    └── query-call-record.dto.ts
```

### 4.2 CallRecordService 核心方法

```typescript
@Injectable()
export class CallRecordService {
  // 创建记录
  async create(dto: CreateCallRecordDto): Promise<CallRecord> {
    const record = this.callRecordRepository.create(dto);
    return await this.callRecordRepository.save(record);
  }

  // 查询最新记录
  async findLatestByType(recordType: string): Promise<CallRecord | null> {
    return await this.callRecordRepository.findOne({
      where: { recordType },
      order: { createdAt: 'DESC' },
    });
  }

  // 数据变更检测
  async hasDataChanged(
    recordType: string,
    responseBody: string
  ): Promise<{ changed: boolean; hash: string }> {
    const newHash = this.calculateHash(responseBody);
    const latestRecord = await this.findLatestByType(recordType);
    const changed = !latestRecord || latestRecord.dataHash !== newHash;
    return { changed, hash: newHash };
  }

  private calculateHash(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }
}
```

### 4.3 PluginDataService 集成

```typescript
async processBrowserRequest(dto: BrowserRequestDto) {
  // 1. 检查 URL 是否包含关键词
  const recordType = this.identifyRecordType(dto.url);
  if (!recordType) {
    return { success: true, message: 'URL 不包含关键词，已跳过', skipped: true };
  }

  // 2. 发起代理请求
  const responseData = await this.makeHttpRequest({
    url: dto.url,
    method: dto.method || 'GET',
    headers: this.parseHeaders(dto.requestHeaders),
    body: dto.requestBody,
  });

  // 3. 判断是否需要变更检测
  if (this.needsChangeDetection(recordType)) {
    const { changed, hash } = await this.callRecordService.hasDataChanged(
      recordType,
      responseData.body
    );

    if (!changed) {
      return { success: true, message: '数据未变化，已跳过', skipped: true };
    }
  }

  // 4. 保存到数据库
  const callRecord = await this.callRecordService.create({
    recordType,
    url: dto.url,
    responseBody: responseData.body,
    parsedData: JSON.parse(responseData.body),
    dataHash: this.calculateHash(responseData.body),
    statusCode: responseData.statusCode,
  });

  // 5. WebSocket 推送
  this.websocketGateway.broadcastCallRecordCreated(callRecord);

  return { success: true, recordId: callRecord.id };
}
```

---

## 五、API 接口设计

### 5.1 POST /api/plugin/requests

**功能：** 处理插件转发的请求

**请求体：**
```json
{
  "dataType": "request",
  "url": "https://pbx.example.com/api/get_peer_status?peer=SIP/1001",
  "method": "GET",
  "requestHeaders": [
    { "name": "Authorization", "value": "Bearer xxx" }
  ]
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "通话记录已保存",
  "recordId": "uuid-xxx",
  "recordType": "get_peer_status"
}
```

### 5.2 GET /api/call-records

**功能：** 查询通话记录列表

**查询参数：**
- `page`: 页码（默认 1）
- `limit`: 每页数量（默认 10）
- `recordType`: 记录类型过滤
- `startDate`: 开始日期
- `endDate`: 结束日期

### 5.3 GET /api/call-records/:id

**功能：** 获取单条记录详情

### 5.4 GET /api/call-records/latest/:recordType

**功能：** 获取指定类型的最新记录

---

## 六、WebSocket 事件设计

### 6.1 连接配置

```javascript
const socket = io('ws://localhost:3000/ws');
```

### 6.2 事件列表

#### call-record:created
**触发时机：** 新记录创建时

```javascript
socket.on('call-record:created', (data) => {
  console.log('新记录:', data);
  // { id, recordType, url, parsedData, timestamp }
});
```

#### data:changed
**触发时机：** 数据变更时（仅 get_peer_status 和 cont_controler）

```javascript
socket.on('data:changed', (data) => {
  console.log('数据变更:', data);
  // { recordType, oldData, newData, timestamp }
});
```

#### request:received
**触发时机：** 收到请求时

#### request:processed
**触发时机：** 请求处理完成时

---

## 七、实现步骤

### 步骤 1：创建 CallRecord 模块
- 创建 Entity、DTO、Service、Controller、Module

### 步骤 2：修改 PluginDataService
- 添加关键词过滤逻辑
- 集成 CallRecordService
- 添加数据变更检测

### 步骤 3：扩展 WebSocket Gateway
- 添加 `broadcastCallRecordCreated` 方法
- 添加 `broadcastDataChanged` 方法

### 步骤 4：注册模块
- 在 `app.module.ts` 中注册 CallRecordModule
- 在 `plugin-data.module.ts` 中导入 CallRecordModule

### 步骤 5：数据库迁移
```bash
npm run typeorm migration:generate -- -n CreateCallRecordTable
npm run typeorm migration:run
```

### 步骤 6：测试
- 单元测试
- 集成测试
- WebSocket 测试

---

## 附录：数据流示例

### 场景 1：get_curcall_in（不做变更检测）
```
请求 → 关键词匹配 ✅ → 代理请求 → 直接保存 → WebSocket 推送 → 返回成功
```

### 场景 2：get_peer_status（数据未变化）
```
请求 → 关键词匹配 ✅ → 代理请求 → 计算哈希 → 比较哈希 → 相同 ⏭️ → 跳过保存 → 返回跳过
```

### 场景 3：get_peer_status（数据已变化）
```
请求 → 关键词匹配 ✅ → 代理请求 → 计算哈希 → 比较哈希 → 不同 ✅ → 保存 → WebSocket 推送 → 返回成功
```

---

## 关键词列表

| 关键词 | 说明 | 是否需要变更检测 |
|--------|------|-----------------|
| `get_curcall_in` | 获取呼入通话信息 | 否 |
| `get_curcall_out` | 获取呼出通话信息 | 否 |
| `get_peer_status` | 获取对端状态 | 是 |
| `cont_controler` | 控制器相关 | 是 |

---

**文档版本：** v1.0
**最后更新：** 2026-01-29
**维护者：** 开发团队
