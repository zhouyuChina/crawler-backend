# CRM 后端服务

基于 Nest.js 构建的后端服务，用于接收浏览器插件传来的网页内容和截图数据，提供实时通知和数据统计分析功能。

## 技术栈

- **框架**: Nest.js + TypeScript
- **数据库**: PostgreSQL + TypeORM
- **实时通信**: WebSocket (Socket.IO)
- **文件处理**: Multer (本地存储)
- **数据验证**: class-validator + class-transformer

## 功能特性

1. ✅ 接收浏览器插件的网页内容和截图数据
2. ✅ PostgreSQL 数据持久化存储
3. ✅ WebSocket 实时推送数据更新通知
4. ✅ 数据统计分析（总览、域名分析、时间序列）
5. ✅ 文件上传与访问（截图管理）
6. ✅ 完善的异常处理和响应格式统一

## 项目结构

```
backend/
├── src/
│   ├── main.ts                    # 应用入口
│   ├── app.module.ts              # 根模块
│   ├── config/                    # 配置文件
│   ├── common/                    # 通用模块（过滤器、拦截器）
│   └── modules/                   # 业务模块
│       ├── webpage/               # 网页管理
│       ├── screenshot/            # 截图管理
│       ├── plugin-data/           # 插件数据接收
│       ├── websocket/             # WebSocket 实时通知
│       ├── statistics/            # 统计分析
│       └── storage/               # 文件存储
├── uploads/                       # 上传文件目录
├── .env                          # 环境变量配置
└── package.json
```

## 快速开始

### 前置要求

- Node.js >= 18
- PostgreSQL >= 12
- npm

### 1. 安装依赖

```bash
npm install
```

### 2. 配置数据库

确保 PostgreSQL 已经安装并运行，然后创建数据库：

```sql
CREATE DATABASE crm_db;
```

### 3. 配置环境变量

复制 `.env.example` 并修改为 `.env`，配置数据库连接信息：

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=crm_db

# Upload
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760

# CORS
CORS_ORIGIN=*
```

### 4. 运行项目

开发模式：
```bash
npm run start:dev
```

生产模式：
```bash
npm run build
npm run start:prod
```

服务启动后会显示：
- REST API: `http://localhost:3000/api`
- WebSocket: `ws://localhost:3000/ws`

## API 接口

### 插件数据接收

**POST** `/api/plugin/submit`

接收浏览器插件发送的网页内容和截图数据。

**请求格式**: `multipart/form-data`

**参数**:
- `url` (必填): 网页 URL
- `title` (可选): 网页标题
- `content` (可选): 网页文本内容
- `htmlContent` (可选): 完整 HTML 内容
- `metadata` (可选): JSON 格式的元数据
- `screenshot` (可选): 截图文件

**示例**:
```bash
curl -X POST http://localhost:3000/api/plugin/submit \
  -F "url=https://example.com" \
  -F "title=Example Page" \
  -F "content=Page content here" \
  -F "screenshot=@screenshot.png"
```

### 网页查询

**GET** `/api/webpage`

分页查询网页列表，支持筛选和搜索。

**查询参数**:
- `page`: 页码（默认 1）
- `limit`: 每页数量（默认 10）
- `domain`: 按域名筛选
- `keyword`: 关键词搜索（标题）
- `startDate`: 开始日期
- `endDate`: 结束日期

**示例**:
```bash
curl http://localhost:3000/api/webpage?page=1&limit=10&domain=example.com
```

**GET** `/api/webpage/:id`

获取单个网页详情（包含截图）。

**DELETE** `/api/webpage/:id`

删除网页数据（级联删除相关截图）。

### 统计分析

**GET** `/api/statistics/overview`

获取总体统计信息。

**响应示例**:
```json
{
  "success": true,
  "data": {
    "totalWebpages": 150,
    "totalScreenshots": 120,
    "topDomains": [
      { "domain": "example.com", "count": 45 },
      { "domain": "test.com", "count": 30 }
    ],
    "recentActivity": [
      { "date": "2025-12-23", "count": 25 }
    ]
  }
}
```

**GET** `/api/statistics/domain-analysis`

获取域名分析数据。

**GET** `/api/statistics/time-series`

获取时间序列统计。

**查询参数**:
- `startDate`: 开始日期
- `endDate`: 结束日期

### 文件访问

**GET** `/api/files/:folder/:filename`

访问上传的截图文件。

**示例**:
```bash
curl http://localhost:3000/api/files/screenshots/uuid-filename.png
```

## WebSocket 事件

### 连接

```javascript
const socket = io('ws://localhost:3000/ws');

socket.on('connect', () => {
  console.log('WebSocket connected');
});
```

### 订阅事件

**服务端 → 客户端**:

- `webpage:created` - 新网页创建通知
- `webpage:deleted` - 网页删除通知
- `statistics:updated` - 统计数据更新通知

**客户端 → 服务端**:

- `subscribe:webpage` - 订阅网页更新
- `unsubscribe:webpage` - 取消订阅

**示例**:
```javascript
// 订阅网页更新
socket.emit('subscribe:webpage');

// 监听新网页创建
socket.on('webpage:created', (data) => {
  console.log('New webpage created:', data);
});

// 监听网页删除
socket.on('webpage:deleted', (data) => {
  console.log('Webpage deleted:', data.id);
});
```

## 数据模型

### Webpage (网页)

```typescript
{
  id: string;              // UUID
  url: string;             // 网页 URL
  title: string;           // 标题
  content: string;         // 文本内容
  htmlContent: string;     // HTML 内容
  domain: string;          // 域名
  metadata: object;        // 元数据
  screenshots: Screenshot[]; // 关联截图
  createdAt: Date;         // 创建时间
  updatedAt: Date;         // 更新时间
  capturedAt: Date;        // 捕获时间
}
```

### Screenshot (截图)

```typescript
{
  id: string;              // UUID
  filename: string;        // 文件名
  filepath: string;        // 文件路径
  mimetype: string;        // 文件类型
  size: number;            // 文件大小
  width: number;           // 图片宽度
  height: number;          // 图片高度
  publicUrl: string;       // 访问 URL
  webpageId: string;       // 关联网页 ID
  createdAt: Date;         // 创建时间
}
```

## 安全配置

### 文件上传限制

- 允许的文件类型: `image/jpeg`, `image/png`, `image/webp`
- 最大文件大小: 10MB（可在 `.env` 中配置）
- 文件名使用 UUID 随机化

### CORS 配置

默认允许所有来源（开发环境），生产环境请修改 `.env` 中的 `CORS_ORIGIN`。

## 开发命令

```bash
# 开发模式（热重载）
npm run start:dev

# 生产构建
npm run build

# 生产模式运行
npm run start:prod

# 代码格式化
npm run format

# 代码检查
npm run lint
```

## 注意事项

1. **数据库建表**: 当前仓库没有完整的 TypeORM 迁移链路。首次生产部署请使用 `DB_SYNCHRONIZE=true` 自动建表，确认表结构创建完成后再改回 `false`。

2. **文件存储**: 当前使用本地存储，生产环境建议使用云存储服务（S3、OSS 等）。

3. **环境变量**: 生产环境请确保设置正确的数据库密码和 CORS 配置。

4. **PostgreSQL 版本**: 需要 PostgreSQL 12+ 以支持 JSONB 类型。

## 生产环境部署

### 推荐方式: Docker Compose 一键部署

仓库已经内置以下文件:

- `Dockerfile`
- `docker-compose.yml`
- `quick-deploy.sh`
- `.env.production.example`

首次部署只需要:

```bash
cp .env.production.example .env.production
sh ./quick-deploy.sh
```

也可以直接执行:

```bash
npm run deploy:quick
```

部署完成后检查:

- API: `http://localhost:3000/api`
- 健康检查: `http://localhost:3000/api/health`
- 监控页: `http://localhost:3000/api/monitor`

### 首次部署后的一个必做动作

`.env.production.example` 默认把 `DB_SYNCHRONIZE` 设为 `true`，目的是让当前项目在第一次启动时自动创建表结构。

首次部署成功后，请把 `.env.production` 中的这项改为:

```env
DB_SYNCHRONIZE=false
```

然后重新执行一次:

```bash
sh ./quick-deploy.sh
```

### 常用部署命令

```bash
# 查看容器状态
docker compose --env-file .env.production ps

# 查看后端日志
docker compose --env-file .env.production logs -f app

# 重新构建并部署
docker compose --env-file .env.production up -d --build

# 停止服务
docker compose --env-file .env.production down
```

### 不使用 Docker 的最小部署方式

如果你当前机器已经安装了 Node.js 和 PostgreSQL，也可以先用下面这组命令快速跑起来:

```bash
cp .env.production.example .env.production
# 把 DB_HOST 改成真实数据库地址，例如 localhost
npm install
npm run build
NODE_ENV=production DB_SYNCHRONIZE=true npm run start:prod
```

同样地，首次启动成功后请把 `DB_SYNCHRONIZE` 改为 `false`。

### 生产环境建议

1. 不要把真实的 `.env.production` 提交到 Git。
2. 对外公开前请修改 `DB_PASSWORD` 和 `CORS_ORIGIN`。
3. 如果要挂公网域名，建议在前面加 Nginx 或其他反向代理，并开启 HTTPS。

## 日志记录

已集成请求日志中间件，会自动记录：
- 所有 HTTP 请求（方法、URL、IP、User-Agent）
- 响应状态码和耗时
- 请求大小

日志格式示例：
```
[HTTP] → POST /api/plugin/submit - ::1 - Mozilla/5.0...
[HTTP] ← POST /api/plugin/submit 201 1234b - 156ms
```

开发环境：日志输出到控制台
生产环境：建议配置日志文件或日志收集服务（如 ELK Stack）

## 后续优化建议

- [ ] 添加用户认证和授权
- [ ] 实现数据库迁移管理
- [ ] 集成云存储服务
- [ ] 添加 API 限流保护
- [ ] 实现数据缓存（Redis）
- [ ] 配置日志文件输出（生产环境）
- [ ] 完善单元测试和 E2E 测试
- [ ] Docker 容器化部署

## License

MIT
