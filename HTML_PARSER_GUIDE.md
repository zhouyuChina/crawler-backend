# HTML 解析方案 - 通话记录

> 版本：v1.0
> 日期：2026-01-29

---

## 📋 目录

- [一、HTML 结构分析](#一html-结构分析)
- [二、解析方案设计](#二解析方案设计)
- [三、实现代码](#三实现代码)
- [四、测试用例](#四测试用例)

---

## 一、HTML 结构分析

### 1.1 呼出通话列表（1.html - get_curcall_out）

**表格结构：**

| 列索引 | 字段名 | 说明 |
|--------|--------|------|
| 0 | 編號 | 序号 |
| 1 | 主叫號碼 | 主叫号码（发起方） |
| 2 | 被叫號碼 | 被叫号码（接收方） |
| 3 | 呼叫狀態 | 呼叫状态 |
| 4 | 開始時間 | 开始时间 |
| 5 | 操作 | 操作按钮 |

**数据示例：**
```html
<tr>
  <td align="center"> 1 </td>
  <td align="center">184000</td>
  <td align="center">0470238620</td>
  <td align="center">初始狀態</td>
  <td align="center">22:26:30 </td>
  <td align="center"> </td>
</tr>
```

**统计信息：**
```html
<thead>
  <th align="center" colspan="6">
    <font color='blue'>任務筆數: (1:1)</font> 初始狀態: 1 語音振鈴: 0 語音通話: 0
  </th>
</thead>
```

---

### 1.2 呼入通话列表（2.html - get_curcall_in）

**表格结构：**

| 列索引 | 字段名 | 说明 |
|--------|--------|------|
| 0 | 編號 | 序号 |
| 1 | 被叫號碼 | 被叫号码 |
| 2 | 回撥號碼 | 回拨号码 |
| 3 | 呼叫狀態 | 呼叫状态 |
| 4 | 開始時間 | 开始时间 |
| 5 | 通话时长 | 通话时长 |
| 6 | 操作 | 操作按钮 |

**数据示例：**
```html
<tr>
  <td align="center">1</td>
  <td align="center">0402117300</td>
  <td align="center">184120</td>
  <td align="center">一段座席</td>
  <td align="center">22:26:19</td>
  <td align="center">00:00:11</td>
  <td align="center">...</td>
</tr>
```

**统计信息：**
```html
<thead>
  <th align="center" colspan=7>
    <font color='blue'>人工通話： 1</font>&nbsp;&nbsp;
    <font color='black'>一段：1</font>&nbsp;&nbsp;
    <font color='gray'>二段：0</font>&nbsp;&nbsp;
    <font color='gray'>三段：0</font>&nbsp;&nbsp;
    <font color='gray'>四段：0</font>&nbsp;&nbsp;
  </th>
</thead>
```

---

## 二、解析方案设计

### 2.1 技术选型

**推荐使用：cheerio**

```bash
npm install cheerio
npm install --save-dev @types/cheerio
```

**优点：**
- 类似 jQuery 的 API，易于使用
- 性能优秀，适合服务端解析
- 支持复杂的 CSS 选择器

---

### 2.2 数据结构设计

#### 呼出通话记录（OutgoingCall）

```typescript
interface OutgoingCall {
  index: number;           // 編號
  callerNumber: string;    // 主叫號碼
  calledNumber: string;    // 被叫號碼
  callStatus: string;      // 呼叫狀態
  startTime: string;       // 開始時間
}

interface OutgoingCallSummary {
  totalTasks: string;      // 任務筆數
  initialStatus: number;   // 初始狀態
  ringing: number;         // 語音振鈴
  talking: number;         // 語音通話
}

interface OutgoingCallData {
  calls: OutgoingCall[];
  summary: OutgoingCallSummary;
}
```

#### 呼入通话记录（IncomingCall）

```typescript
interface IncomingCall {
  index: number;           // 編號
  calledNumber: string;    // 被叫號碼
  callbackNumber: string;  // 回撥號碼
  callStatus: string;      // 呼叫狀態
  startTime: string;       // 開始時間
  duration: string;        // 通话时长
  channelId?: string;      // 通道 ID（从操作链接提取）
}

interface IncomingCallSummary {
  manualCalls: number;     // 人工通話
  stage1: number;          // 一段
  stage2: number;          // 二段
  stage3: number;          // 三段
  stage4: number;          // 四段
}

interface IncomingCallData {
  calls: IncomingCall[];
  summary: IncomingCallSummary;
}
```

---

### 2.3 解析流程

```
HTML 字符串
    ↓
cheerio.load()
    ↓
识别表格类型（通过列数或表头）
    ↓
    ├─ 6 列 → 呼出通话（get_curcall_out）
    └─ 7 列 → 呼入通话（get_curcall_in）
    ↓
遍历 <tr> 提取数据行
    ↓
解析统计信息（<thead>）
    ↓
返回结构化数据
```

---

## 三、实现代码

### 3.1 安装依赖

```bash
npm install cheerio
npm install --save-dev @types/cheerio
```

---

### 3.2 解析器实现

**文件：** `src/modules/call-record/parsers/html-parser.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface OutgoingCall {
  index: number;
  callerNumber: string;
  calledNumber: string;
  callStatus: string;
  startTime: string;
}

export interface OutgoingCallSummary {
  totalTasks: string;
  initialStatus: number;
  ringing: number;
  talking: number;
}

export interface OutgoingCallData {
  calls: OutgoingCall[];
  summary: OutgoingCallSummary;
}

export interface IncomingCall {
  index: number;
  calledNumber: string;
  callbackNumber: string;
  callStatus: string;
  startTime: string;
  duration: string;
  channelId?: string;
}

export interface IncomingCallSummary {
  manualCalls: number;
  stage1: number;
  stage2: number;
  stage3: number;
  stage4: number;
}

export interface IncomingCallData {
  calls: IncomingCall[];
  summary: IncomingCallSummary;
}

@Injectable()
export class HtmlParserService {
  /**
   * 解析呼出通话列表（1.html - get_curcall_out）
   */
  parseOutgoingCalls(html: string): OutgoingCallData {
    const $ = cheerio.load(html);
    const calls: OutgoingCall[] = [];

    // 遍历数据行（跳过表头）
    $('table.adminlist > tr').each((index, element) => {
      const $tr = $(element);
      const tds = $tr.find('td');

      // 跳过表头和统计行
      if (tds.length === 6) {
        const call: OutgoingCall = {
          index: parseInt($(tds[0]).text().trim(), 10),
          callerNumber: $(tds[1]).text().trim(),
          calledNumber: $(tds[2]).text().trim(),
          callStatus: $(tds[3]).text().trim(),
          startTime: $(tds[4]).text().trim(),
        };

        calls.push(call);
      }
    });

    // 解析统计信息
    const summaryText = $('table.adminlist > thead > th').text();
    const summary = this.parseOutgoingSummary(summaryText);

    return { calls, summary };
  }

  /**
   * 解析呼入通话列表（2.html - get_curcall_in）
   */
  parseIncomingCalls(html: string): IncomingCallData {
    const $ = cheerio.load(html);
    const calls: IncomingCall[] = [];

    // 遍历数据行（跳过表头）
    $('table.adminlist > tr').each((index, element) => {
      const $tr = $(element);
      const tds = $tr.find('td');

      // 跳过表头和统计行
      if (tds.length === 7) {
        // 提取通道 ID（从操作链接中）
        const channelId = this.extractChannelId($(tds[6]).html() || '');

        const call: IncomingCall = {
          index: parseInt($(tds[0]).text().trim(), 10),
          calledNumber: $(tds[1]).text().trim(),
          callbackNumber: $(tds[2]).text().trim(),
          callStatus: $(tds[3]).text().trim(),
          startTime: $(tds[4]).text().trim(),
          duration: $(tds[5]).text().trim(),
          channelId,
        };

        calls.push(call);
      }
    });

    // 解析统计信息
    const summaryText = $('table.adminlist > thead > th').text();
    const summary = this.parseIncomingSummary(summaryText);

    return { calls, summary };
  }

  /**
   * 自动识别并解析（根据列数判断类型）
   */
  parseCallRecords(html: string): OutgoingCallData | IncomingCallData {
    const $ = cheerio.load(html);

    // 获取第一个数据行的列数
    const firstDataRow = $('table.adminlist > tr').eq(1);
    const columnCount = firstDataRow.find('td').length;

    if (columnCount === 6) {
      // 呼出通话（6 列）
      return this.parseOutgoingCalls(html);
    } else if (columnCount === 7) {
      // 呼入通话（7 列）
      return this.parseIncomingCalls(html);
    } else {
      throw new Error(`未知的表格格式，列数: ${columnCount}`);
    }
  }

  /**
   * 解析呼出通话统计信息
   */
  private parseOutgoingSummary(text: string): OutgoingCallSummary {
    // 任務筆數: (1:1) 初始狀態: 1 語音振鈴: 0 語音通話: 0
    const totalTasksMatch = text.match(/任務筆數:\s*\(([^)]+)\)/);
    const initialStatusMatch = text.match(/初始狀態:\s*(\d+)/);
    const ringingMatch = text.match(/語音振鈴:\s*(\d+)/);
    const talkingMatch = text.match(/語音通話:\s*(\d+)/);

    return {
      totalTasks: totalTasksMatch ? totalTasksMatch[1] : '0:0',
      initialStatus: initialStatusMatch ? parseInt(initialStatusMatch[1], 10) : 0,
      ringing: ringingMatch ? parseInt(ringingMatch[1], 10) : 0,
      talking: talkingMatch ? parseInt(talkingMatch[1], 10) : 0,
    };
  }

  /**
   * 解析呼入通话统计信息
   */
  private parseIncomingSummary(text: string): IncomingCallSummary {
    // 人工通話： 1 一段：1 二段：0 三段：0 四段：0
    const manualCallsMatch = text.match(/人工通話[：:]\s*(\d+)/);
    const stage1Match = text.match(/一段[：:]\s*(\d+)/);
    const stage2Match = text.match(/二段[：:]\s*(\d+)/);
    const stage3Match = text.match(/三段[：:]\s*(\d+)/);
    const stage4Match = text.match(/四段[：:]\s*(\d+)/);

    return {
      manualCalls: manualCallsMatch ? parseInt(manualCallsMatch[1], 10) : 0,
      stage1: stage1Match ? parseInt(stage1Match[1], 10) : 0,
      stage2: stage2Match ? parseInt(stage2Match[1], 10) : 0,
      stage3: stage3Match ? parseInt(stage3Match[1], 10) : 0,
      stage4: stage4Match ? parseInt(stage4Match[1], 10) : 0,
    };
  }

  /**
   * 从操作链接中提取通道 ID
   */
  private extractChannelId(html: string): string | undefined {
    // <a href="javascript:TranCH('SIP/SIP-PROVIDER-184000-0001b47a')">
    const match = html.match(/TranCH\('([^']+)'\)/);
    return match ? match[1] : undefined;
  }
}
```

---

## 四、集成到 CallRecordService

### 4.1 修改 CallRecordService

```typescript
import { HtmlParserService } from './parsers/html-parser.service';

@Injectable()
export class CallRecordService {
  constructor(
    @InjectRepository(CallRecord)
    private readonly callRecordRepository: Repository<CallRecord>,
    private readonly htmlParserService: HtmlParserService,
  ) {}

  /**
   * 处理并解析 HTML 响应
   */
  async processHtmlResponse(
    recordType: string,
    url: string,
    responseBody: string,
    statusCode: number,
  ): Promise<{ record: CallRecord; parsed: any }> {
    let parsedData = null;

    // 如果是 HTML 格式，进行解析
    if (this.isHtml(responseBody)) {
      try {
        if (recordType === 'get_curcall_out') {
          parsedData = this.htmlParserService.parseOutgoingCalls(responseBody);
        } else if (recordType === 'get_curcall_in') {
          parsedData = this.htmlParserService.parseIncomingCalls(responseBody);
        } else {
          // 其他类型，尝试自动识别
          parsedData = this.htmlParserService.parseCallRecords(responseBody);
        }
      } catch (error) {
        console.error('HTML 解析失败:', error);
        // 解析失败时，保留原始 HTML
        parsedData = { raw: responseBody, parseError: error.message };
      }
    } else {
      // 尝试解析为 JSON
      try {
        parsedData = JSON.parse(responseBody);
      } catch {
        // 既不是 HTML 也不是 JSON，保存原始文本
        parsedData = { raw: responseBody };
      }
    }

    // 计算哈希值
    const hash = this.calculateHash(responseBody);

    // 保存到数据库
    const record = await this.create({
      recordType,
      url,
      responseBody,
      parsedData,
      dataHash: hash,
      statusCode,
    });

    return { record, parsed: parsedData };
  }

  /**
   * 判断是否为 HTML
   */
  private isHtml(content: string): boolean {
    return (
      content.includes('<table') ||
      content.includes('<html') ||
      content.includes('<!DOCTYPE')
    );
  }

  // ... 其他方法
}
```

---

### 4.2 修改 PluginDataService

在 `processBrowserRequest` 方法中集成 HTML 解析：

```typescript
async processBrowserRequest(dto: BrowserRequestDto) {
  // ... 前面的代码

  try {
    // 发起代理请求
    const responseData = await this.makeHttpRequest({
      url: dto.url,
      method: dto.method || 'GET',
      headers: this.parseHeaders(dto.requestHeaders),
      body: dto.requestBody,
    });

    const responseBody = responseData.body;

    // 判断是否需要变更检测
    if (this.needsChangeDetection(recordType)) {
      const { changed, hash } = await this.callRecordService.hasDataChanged(
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
    }

    // 处理并解析响应（自动识别 HTML 或 JSON）
    const { record, parsed } = await this.callRecordService.processHtmlResponse(
      recordType,
      dto.url,
      responseBody,
      responseData.statusCode,
    );

    console.log(`💾 通话记录已保存: ${record.id}`);
    console.log(`📊 解析结果:`, parsed);

    // 广播 WebSocket 事件
    this.websocketGateway.broadcastCallRecordCreated({
      id: record.id,
      recordType: record.recordType,
      url: record.url,
      parsedData: record.parsedData,
      timestamp: record.createdAt.toISOString(),
    });

    // ... 后续代码
  }
}
```

---

## 五、测试用例

### 5.1 单元测试

**文件：** `src/modules/call-record/parsers/html-parser.service.spec.ts`

```typescript
import { HtmlParserService } from './html-parser.service';
import * as fs from 'fs';
import * as path from 'path';

describe('HtmlParserService', () => {
  let service: HtmlParserService;

  beforeEach(() => {
    service = new HtmlParserService();
  });

  describe('parseOutgoingCalls', () => {
    it('should parse 1.html correctly', () => {
      const html = fs.readFileSync(
        path.join(__dirname, '../../../../1.html'),
        'utf-8',
      );

      const result = service.parseOutgoingCalls(html);

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toEqual({
        index: 1,
        callerNumber: '184000',
        calledNumber: '0470238620',
        callStatus: '初始狀態',
        startTime: '22:26:30',
      });

      expect(result.summary).toEqual({
        totalTasks: '1:1',
        initialStatus: 1,
        ringing: 0,
        talking: 0,
      });
    });
  });

  describe('parseIncomingCalls', () => {
    it('should parse 2.html correctly', () => {
      const html = fs.readFileSync(
        path.join(__dirname, '../../../../2.html'),
        'utf-8',
      );

      const result = service.parseIncomingCalls(html);

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toEqual({
        index: 1,
        calledNumber: '0402117300',
        callbackNumber: '184120',
        callStatus: '一段座席',
        startTime: '22:26:19',
        duration: '00:00:11',
        channelId: 'SIP/SIP-PROVIDER-184000-0001b47a',
      });

      expect(result.summary).toEqual({
        manualCalls: 1,
        stage1: 1,
        stage2: 0,
        stage3: 0,
        stage4: 0,
      });
    });
  });

  describe('parseCallRecords', () => {
    it('should auto-detect and parse outgoing calls', () => {
      const html = fs.readFileSync(
        path.join(__dirname, '../../../../1.html'),
        'utf-8',
      );

      const result = service.parseCallRecords(html);

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].callerNumber).toBe('184000');
    });

    it('should auto-detect and parse incoming calls', () => {
      const html = fs.readFileSync(
        path.join(__dirname, '../../../../2.html'),
        'utf-8',
      );

      const result = service.parseCallRecords(html);

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].calledNumber).toBe('0402117300');
    });
  });
});
```

---

### 5.2 运行测试

```bash
npm test -- html-parser.service.spec.ts
```

---

## 六、解析结果示例

### 6.1 呼出通话解析结果

```json
{
  "calls": [
    {
      "index": 1,
      "callerNumber": "184000",
      "calledNumber": "0470238620",
      "callStatus": "初始狀態",
      "startTime": "22:26:30"
    }
  ],
  "summary": {
    "totalTasks": "1:1",
    "initialStatus": 1,
    "ringing": 0,
    "talking": 0
  }
}
```

### 6.2 呼入通话解析结果

```json
{
  "calls": [
    {
      "index": 1,
      "calledNumber": "0402117300",
      "callbackNumber": "184120",
      "callStatus": "一段座席",
      "startTime": "22:26:19",
      "duration": "00:00:11",
      "channelId": "SIP/SIP-PROVIDER-184000-0001b47a"
    }
  ],
  "summary": {
    "manualCalls": 1,
    "stage1": 1,
    "stage2": 0,
    "stage3": 0,
    "stage4": 0
  }
}
```

---

## 七、数据库存储

解析后的数据会存储到 `call_records` 表的 `parsedData` 字段（JSONB 类型）：

```sql
SELECT
  id,
  record_type,
  parsed_data,
  created_at
FROM call_records
WHERE record_type = 'get_curcall_in'
ORDER BY created_at DESC
LIMIT 1;
```

**查询结果：**

```
id: 550e8400-e29b-41d4-a716-446655440000
record_type: get_curcall_in
parsed_data: {
  "calls": [...],
  "summary": {...}
}
created_at: 2026-01-29 10:00:00
```

---

## 八、前端使用示例

### 8.1 显示呼入通话列表

```typescript
import { useEffect, useState } from 'react';

function IncomingCallList() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    // 获取最新记录
    fetch('http://localhost:3000/api/call-records/latest/get_curcall_in')
      .then(res => res.json())
      .then(data => {
        if (data.parsedData && data.parsedData.calls) {
          setCalls(data.parsedData.calls);
        }
      });

    // 监听实时更新
    socket.on('call-record:created', (event) => {
      if (event.recordType === 'get_curcall_in' && event.parsedData.calls) {
        setCalls(event.parsedData.calls);
      }
    });
  }, []);

  return (
    <table>
      <thead>
        <tr>
          <th>被叫號碼</th>
          <th>回撥號碼</th>
          <th>呼叫狀態</th>
          <th>開始時間</th>
          <th>通话时长</th>
        </tr>
      </thead>
      <tbody>
        {calls.map(call => (
          <tr key={call.index}>
            <td>{call.calledNumber}</td>
            <td>{call.callbackNumber}</td>
            <td>{call.callStatus}</td>
            <td>{call.startTime}</td>
            <td>{call.duration}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## 九、注意事项

### 9.1 HTML 格式变化

如果 HTML 格式发生变化，需要更新解析逻辑：

1. 检查列数是否变化
2. 检查字段顺序是否变化
3. 检查统计信息格式是否变化

### 9.2 错误处理

解析失败时，原始 HTML 会保存到 `responseBody` 字段，可以手动查看：

```javascript
fetch('http://localhost:3000/api/call-records/:id')
  .then(res => res.json())
  .then(data => {
    if (data.parsedData.parseError) {
      console.error('解析失败:', data.parsedData.parseError);
      console.log('原始 HTML:', data.responseBody);
    }
  });
```

### 9.3 性能优化

对于大量数据的 HTML：

1. 限制解析的行数（只解析前 100 行）
2. 使用流式解析
3. 添加解析超时机制

---

## 十、实现步骤

### 步骤 1：安装依赖

```bash
npm install cheerio
npm install --save-dev @types/cheerio
```

### 步骤 2：创建解析器

创建 `src/modules/call-record/parsers/html-parser.service.ts`

### 步骤 3：编写测试

创建 `src/modules/call-record/parsers/html-parser.service.spec.ts`

### 步骤 4：集成到 CallRecordService

修改 `processHtmlResponse` 方法

### 步骤 5：测试

```bash
npm test -- html-parser.service.spec.ts
```

---

**文档版本：** v1.0
**最后更新：** 2026-01-29
**维护者：** 开发团队
