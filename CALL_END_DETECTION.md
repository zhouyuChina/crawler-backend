# 通话结束检测方案

> 版本：v1.0
> 日期：2026-01-29

---

## 一、问题描述

### 1.1 业务场景

**get_curcall_in** 接口会持续返回通话时长：

```
22:26:19 → 通话时长: 00:00:05
22:26:24 → 通话时长: 00:00:10
22:26:29 → 通话时长: 00:00:15
22:26:34 → 通话结束，不再有新请求 ❌
```

**问题：** 前端无法知道通话何时结束

---

## 二、解决方案

### 方案 A：基于时间的心跳检测（推荐）

#### 核心思路

1. 每次收到请求时，更新 `lastUpdateTime`
2. 后端定时任务每秒检查所有记录
3. 如果 `lastUpdateTime` 超过 3 秒 → 标记为 `ended`
4. 推送 WebSocket 事件通知前端

#### 数据库字段调整

在 `CallRecord` 实体中添加：

```typescript
@Column({ type: 'varchar', length: 20, default: 'active' })
status: string;  // 'active' | 'ended'

@Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
lastUpdateTime: Date;
```

#### 状态流转

```
active (通话中)
    ↓ (超过 3 秒未更新)
ended (通话结束)
```

---

## 三、实现步骤

### 3.1 修改 CallRecord 实体

```typescript
@Entity('call_records')
@Index(['recordType', 'createdAt'])
export class CallRecord {
  // ... 现有字段

  @Column({ type: 'varchar', length: 20, default: 'active' })
  @Index()
  status: string;  // 'active' | 'ended'

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  lastUpdateTime: Date;
}
```

---

### 3.2 修改 CallRecordService

#### 添加定时任务

```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LessThan } from 'typeorm';

@Injectable()
export class CallRecordService {
  // ... 现有代码

  /**
   * 定时任务：每秒检查并更新通话状态
   */
  @Cron('*/1 * * * * *') // 每秒执行
  async updateCallStatus(): Promise<void> {
    const threeSecondsAgo = new Date(Date.now() - 3000);

    // 查找超过 3 秒未更新的 active 记录
    const expiredRecords = await this.callRecordRepository.find({
      where: {
        status: 'active',
        lastUpdateTime: LessThan(threeSecondsAgo),
      },
    });

    if (expiredRecords.length === 0) {
      return;
    }

    console.log(`🔍 发现 ${expiredRecords.length} 条通话已结束`);

    // 批量更新状态为 ended
    for (const record of expiredRecords) {
      record.status = 'ended';
      await this.callRecordRepository.save(record);

      // 推送 WebSocket 事件
      this.websocketGateway.broadcastCallStatusChanged({
        id: record.id,
        recordType: record.recordType,
        status: 'ended',
        parsedData: record.parsedData,
        timestamp: new Date().toISOString(),
      });

      console.log(`✅ 通话已结束: ${record.id} (${record.recordType})`);
    }
  }

  /**
   * 创建或更新记录（UPSERT）
   * 用于 get_curcall_in 和 get_curcall_out 的持续更新
   */
  async upsertByKey(
    recordType: string,
    uniqueKey: string,
    dto: CreateCallRecordDto,
  ): Promise<CallRecord> {
    // 查找现有记录
    const existing = await this.callRecordRepository.findOne({
      where: {
        recordType,
        metadata: {
          uniqueKey,
        } as any,
      },
    });

    if (existing) {
      // 更新现有记录
      existing.responseBody = dto.responseBody;
      existing.parsedData = dto.parsedData;
      existing.dataHash = dto.dataHash;
      existing.statusCode = dto.statusCode;
      existing.lastUpdateTime = new Date();
      existing.status = 'active'; // 重置为 active

      return await this.callRecordRepository.save(existing);
    } else {
      // 创建新记录
      const record = this.callRecordRepository.create({
        ...dto,
        status: 'active',
        lastUpdateTime: new Date(),
      });

      return await this.callRecordRepository.save(record);
    }
  }
}
```

---

### 3.3 修改 PluginDataService

#### 针对 get_curcall_in 和 get_curcall_out 使用 UPSERT

```typescript
async processBrowserRequest(dto: BrowserRequestDto) {
  const requestId = uuidv4();
  const timestamp = new Date().toISOString();

  // 1. 检查 URL 是否包含关键词
  const recordType = this.identifyRecordType(dto.url);

  if (!recordType) {
    return {
      success: true,
      message: 'URL 不包含关键词，已跳过',
      skipped: true,
    };
  }

  console.log(`✅ 识别为 ${recordType} 类型请求`);

  // 2. 广播请求接收事件
  this.websocketGateway.broadcastRequestReceived({
    id: requestId,
    url: dto.url,
    method: dto.method,
    timestamp,
    status: 'processing',
  });

  try {
    // 3. 发起代理请求获取响应体
    const responseData = await this.makeHttpRequest({
      url: dto.url,
      method: dto.method || 'GET',
      headers: this.parseHeaders(dto.requestHeaders),
      body: dto.requestBody,
    });

    const responseBody = responseData.body;

    // 4. 解析响应体
    let parsedData = null;
    try {
      parsedData = JSON.parse(responseBody);
    } catch {
      // 不是 JSON，可能是 HTML
      if (this.isHtml(responseBody)) {
        parsedData = await this.parseHtml(recordType, responseBody);
      }
    }

    // 5. 计算哈希值
    const hash = this.calculateHash(responseBody);

    // 6. 判断是否需要变更检测
    if (this.needsChangeDetection(recordType)) {
      // get_peer_status 和 cont_controler：检测变更
      const { changed } = await this.callRecordService.hasDataChanged(
        recordType,
        responseBody,
      );

      if (!changed) {
        return {
          success: true,
          message: '数据未变化，已跳过',
          skipped: true,
          reason: 'data_unchanged',
        };
      }

      // 数据变化，创建新记录
      const callRecord = await this.callRecordService.create({
        recordType,
        url: dto.url,
        requestBody: dto.requestBody,
        responseBody,
        parsedData,
        dataHash: hash,
        statusCode: responseData.statusCode,
        metadata: {
          requestMethod: dto.method || 'GET',
        },
      });

      // 推送事件
      this.websocketGateway.broadcastCallRecordCreated({
        id: callRecord.id,
        recordType: callRecord.recordType,
        url: callRecord.url,
        parsedData: callRecord.parsedData,
        timestamp: callRecord.createdAt.toISOString(),
      });

      return {
        success: true,
        message: '通话记录已保存',
        recordId: callRecord.id,
        recordType: callRecord.recordType,
      };
    } else {
      // get_curcall_in 和 get_curcall_out：使用 UPSERT
      // 从 parsedData 中提取唯一键（例如：被叫号码）
      const uniqueKey = this.extractUniqueKey(recordType, parsedData);

      const callRecord = await this.callRecordService.upsertByKey(
        recordType,
        uniqueKey,
        {
          recordType,
          url: dto.url,
          requestBody: dto.requestBody,
          responseBody,
          parsedData,
          dataHash: hash,
          statusCode: responseData.statusCode,
          metadata: {
            requestMethod: dto.method || 'GET',
            uniqueKey,
          },
        },
      );

      // 推送更新事件
      this.websocketGateway.broadcastCallRecordUpdated({
        id: callRecord.id,
        recordType: callRecord.recordType,
        url: callRecord.url,
        parsedData: callRecord.parsedData,
        status: callRecord.status,
        timestamp: callRecord.lastUpdateTime.toISOString(),
      });

      return {
        success: true,
        message: '通话记录已更新',
        recordId: callRecord.id,
        recordType: callRecord.recordType,
      };
    }
  } catch (error) {
    // 错误处理
    this.websocketGateway.broadcastRequestProcessed({
      id: requestId,
      url: dto.url,
      method: dto.method,
      status: 'error',
      error: error.message || '处理请求失败',
    });

    throw error;
  }
}

/**
 * 提取唯一键（用于 UPSERT）
 */
private extractUniqueKey(recordType: string, parsedData: any): string {
  if (!parsedData || !parsedData.calls || parsedData.calls.length === 0) {
    return `${recordType}-${Date.now()}`;
  }

  const firstCall = parsedData.calls[0];

  if (recordType === 'get_curcall_in') {
    // 呼入：使用 被叫號碼 + 回撥號碼
    return `${firstCall.calledNumber}-${firstCall.callbackNumber}`;
  } else if (recordType === 'get_curcall_out') {
    // 呼出：使用 主叫號碼 + 被叫號碼
    return `${firstCall.callerNumber}-${firstCall.calledNumber}`;
  }

  return `${recordType}-${Date.now()}`;
}

/**
 * 判断是否为 HTML
 */
private isHtml(content: string): boolean {
  return content.includes('<table') || content.includes('<html');
}

/**
 * 解析 HTML
 */
private async parseHtml(recordType: string, html: string): Promise<any> {
  // 这里会调用 HtmlParserService
  // 后续实现
  return null;
}
```

---

### 3.4 扩展 WebSocket Gateway

添加新的事件：

```typescript
// 广播通话记录更新事件（用于持续更新的通话）
broadcastCallRecordUpdated(data: {
  id: string;
  recordType: string;
  url: string;
  parsedData: any;
  status: string;
  timestamp: string;
}) {
  this.server.emit('call-record:updated', data);
  this.logger.log(`广播通话记录更新: ${data.recordType} - ${data.status}`);
}

// 广播通话状态变更事件
broadcastCallStatusChanged(data: {
  id: string;
  recordType: string;
  status: string;
  parsedData: any;
  timestamp: string;
}) {
  this.server.emit('call-status:changed', data);
  this.logger.log(`广播通话状态变更: ${data.recordType} → ${data.status}`);
}
```

---

### 3.5 启用定时任务

在 `app.module.ts` 中导入 ScheduleModule：

```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // ... 其他模块
    ScheduleModule.forRoot(), // 启用定时任务
    CallRecordModule,
  ],
})
export class AppModule {}
```

安装依赖：

```bash
npm install @nestjs/schedule
```

---

## 四、前端集成

### 4.1 监听事件

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

interface CallRecord {
  id: string;
  recordType: string;
  parsedData: any;
  status: 'active' | 'ended';
  timestamp: string;
}

function useIncomingCalls() {
  const [calls, setCalls] = useState<Map<string, CallRecord>>(new Map());

  useEffect(() => {
    const socket = io('ws://localhost:3000/ws');

    // 监听通话记录更新（持续更新时长）
    socket.on('call-record:updated', (data: CallRecord) => {
      console.log('🔄 通话更新:', data);

      setCalls(prev => {
        const newCalls = new Map(prev);
        newCalls.set(data.id, data);
        return newCalls;
      });
    });

    // 监听通话状态变更（通话结束）
    socket.on('call-status:changed', (data: CallRecord) => {
      console.log('🔚 通话结束:', data);

      setCalls(prev => {
        const newCalls = new Map(prev);
        const call = newCalls.get(data.id);
        if (call) {
          call.status = data.status;
          newCalls.set(data.id, call);
        }
        return newCalls;
      });

      // 显示通知
      if (data.status === 'ended') {
        showNotification(`通话已结束: ${data.parsedData.calls[0]?.calledNumber}`);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { calls: Array.from(calls.values()) };
}
```

---

### 4.2 UI 显示

```typescript
function IncomingCallList() {
  const { calls } = useIncomingCalls();

  return (
    <table>
      <thead>
        <tr>
          <th>被叫號碼</th>
          <th>回撥號碼</th>
          <th>呼叫狀態</th>
          <th>開始時間</th>
          <th>通话时长</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {calls.map(call => {
          const firstCall = call.parsedData?.calls?.[0];
          if (!firstCall) return null;

          return (
            <tr
              key={call.id}
              className={call.status === 'ended' ? 'ended' : 'active'}
            >
              <td>{firstCall.calledNumber}</td>
              <td>{firstCall.callbackNumber}</td>
              <td>{firstCall.callStatus}</td>
              <td>{firstCall.startTime}</td>
              <td>{firstCall.duration}</td>
              <td>
                {call.status === 'active' ? (
                  <span className="badge badge-success">通话中</span>
                ) : (
                  <span className="badge badge-secondary">已结束</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

---

### 4.3 CSS 样式

```css
/* 通话中 - 高亮显示 */
tr.active {
  background-color: #e8f5e9;
  animation: pulse 2s infinite;
}

/* 已结束 - 灰色显示 */
tr.ended {
  background-color: #f5f5f5;
  opacity: 0.7;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

.badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.badge-success {
  background-color: #4caf50;
  color: white;
}

.badge-secondary {
  background-color: #9e9e9e;
  color: white;
}
```

---

## 五、配置选项

### 5.1 环境变量

```env
# 通话结束检测时间（秒）
CALL_END_DETECTION_TIMEOUT=3

# 定时任务执行间隔（秒）
CALL_STATUS_CHECK_INTERVAL=1

# 自动清理已结束通话的时间（秒）
CALL_CLEANUP_TIMEOUT=60
```

### 5.2 配置文件

```typescript
// src/config/configuration.ts

export default () => ({
  // ... 现有配置

  callRecord: {
    endDetectionTimeout: parseInt(
      process.env.CALL_END_DETECTION_TIMEOUT || '3',
      10,
    ),
    statusCheckInterval: parseInt(
      process.env.CALL_STATUS_CHECK_INTERVAL || '1',
      10,
    ),
    cleanupTimeout: parseInt(
      process.env.CALL_CLEANUP_TIMEOUT || '60',
      10,
    ),
  },
});
```

---

## 六、数据流示例

### 场景：呼入通话从开始到结束

```
时间轴：
22:26:19 → 收到请求 → 创建记录 → status: active → 推送 call-record:created
22:26:24 → 收到请求 → 更新记录 → status: active → 推送 call-record:updated
22:26:29 → 收到请求 → 更新记录 → status: active → 推送 call-record:updated
22:26:34 → 通话结束，不再有请求
22:26:37 → 定时任务检测 → 超过 3 秒 → status: ended → 推送 call-status:changed
```

**数据库记录变化：**

```
创建时：
{
  id: "uuid-123",
  recordType: "get_curcall_in",
  parsedData: { calls: [{ duration: "00:00:05" }] },
  status: "active",
  lastUpdateTime: "2026-01-29 22:26:19"
}

更新时（22:26:24）：
{
  id: "uuid-123",
  recordType: "get_curcall_in",
  parsedData: { calls: [{ duration: "00:00:10" }] },
  status: "active",
  lastUpdateTime: "2026-01-29 22:26:24"
}

结束时（22:26:37）：
{
  id: "uuid-123",
  recordType: "get_curcall_in",
  parsedData: { calls: [{ duration: "00:00:15" }] },
  status: "ended",  ← 状态变更
  lastUpdateTime: "2026-01-29 22:26:29"
}
```

---

## 七、WebSocket 事件时序

```
前端                    后端                    定时任务
 |                       |                        |
 |                       |← 22:26:19 收到请求     |
 |← call-record:created  |                        |
 |                       |                        |
 |                       |← 22:26:24 收到请求     |
 |← call-record:updated  |                        |
 |                       |                        |
 |                       |← 22:26:29 收到请求     |
 |← call-record:updated  |                        |
 |                       |                        |
 |                       |  (通话结束，无新请求)   |
 |                       |                        |
 |                       |                        |← 22:26:37 检测超时
 |                       |                        |  标记为 ended
 |← call-status:changed  |← 推送事件              |
 |  (status: ended)      |                        |
```

---

## 八、优化建议

### 8.1 自动清理已结束的通话

```typescript
@Cron('*/10 * * * * *') // 每 10 秒执行
async cleanupEndedCalls(): Promise<void> {
  const sixtySecondsAgo = new Date(Date.now() - 60000);

  // 删除超过 60 秒的已结束通话
  const result = await this.callRecordRepository.delete({
    status: 'ended',
    lastUpdateTime: LessThan(sixtySecondsAgo),
  });

  if (result.affected > 0) {
    console.log(`🗑️ 清理了 ${result.affected} 条已结束的通话记录`);
  }
}
```

---

### 8.2 批量更新优化

```typescript
@Cron('*/1 * * * * *')
async updateCallStatus(): Promise<void> {
  const threeSecondsAgo = new Date(Date.now() - 3000);

  // 使用批量更新
  const result = await this.callRecordRepository
    .createQueryBuilder()
    .update(CallRecord)
    .set({ status: 'ended' })
    .where('status = :status', { status: 'active' })
    .andWhere('lastUpdateTime < :time', { time: threeSecondsAgo })
    .returning('*')
    .execute();

  // 推送事件
  result.raw.forEach((record) => {
    this.websocketGateway.broadcastCallStatusChanged({
      id: record.id,
      recordType: record.recordType,
      status: 'ended',
      parsedData: record.parsedData,
      timestamp: new Date().toISOString(),
    });
  });
}
```

---

## 九、测试方案

### 9.1 单元测试

```typescript
describe('CallRecordService - Status Detection', () => {
  it('should mark call as ended after 3 seconds', async () => {
    // 创建一个 3 秒前的记录
    const oldTime = new Date(Date.now() - 4000);
    const record = await service.create({
      recordType: 'get_curcall_in',
      url: 'test',
      status: 'active',
      lastUpdateTime: oldTime,
    });

    // 运行定时任务
    await service.updateCallStatus();

    // 查询记录
    const updated = await service.findOne(record.id);

    expect(updated.status).toBe('ended');
  });
});
```

---

### 9.2 集成测试

```typescript
describe('E2E: Call End Detection', () => {
  it('should detect call end after timeout', async () => {
    // 1. 发送第一次请求（创建记录）
    await request(app.getHttpServer())
      .post('/api/plugin/requests')
      .send({
        dataType: 'request',
        url: 'https://pbx.example.com/api/get_curcall_in',
        method: 'GET',
      });

    // 2. 等待 4 秒
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 3. 触发定时任务（或等待自动执行）
    await callRecordService.updateCallStatus();

    // 4. 查询记录，验证状态为 ended
    const records = await request(app.getHttpServer())
      .get('/api/call-records?recordType=get_curcall_in')
      .expect(200);

    expect(records.body.items[0].status).toBe('ended');
  });
});
```

---

## 十、总结

### 核心机制

1. **UPSERT 策略**：get_curcall_in 和 get_curcall_out 使用 UPSERT，持续更新同一条记录
2. **心跳检测**：定时任务每秒检查 `lastUpdateTime`
3. **自动标记**：超过 3 秒未更新 → 标记为 `ended`
4. **实时推送**：通过 WebSocket 通知前端状态变更
5. **自动清理**：定期清理已结束的旧记录

### 优点

- ✅ 自动检测通话结束，无需额外信号
- ✅ 前端实时感知状态变化
- ✅ 减少数据冗余（UPSERT 而非 INSERT）
- ✅ 自动清理旧数据，节省存储空间

### 配置灵活

- 可配置超时时间（默认 3 秒）
- 可配置检查间隔（默认 1 秒）
- 可配置清理时间（默认 60 秒）

---

**文档版本：** v1.0
**最后更新：** 2026-01-29
**维护者：** 开发团队
