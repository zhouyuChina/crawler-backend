# CRM 后端部署指南

> 版本: v0.3
> 日期: 2026-01-29

---

## 目录

1. [环境要求](#环境要求)
2. [首次部署](#首次部署)
3. [重新部署](#重新部署)
4. [数据库迁移](#数据库迁移)
5. [环境变量配置](#环境变量配置)
6. [常见问题](#常见问题)
7. [健康检查](#健康检查)

---

## 环境要求

### 系统要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **PostgreSQL**: >= 14.0
- **操作系统**: Linux / macOS / Windows

### 端口要求

- **应用端口**: 9000 (可配置)
- **数据库端口**: 5432 (默认)
- **WebSocket**: 使用应用端口 (9000)

---

## 首次部署

### 1. 克隆代码

```bash
git clone <repository-url>
cd backend
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制环境变量模板:

```bash
cp .env.example .env
```

编辑 `.env` 文件:

```env
# 应用配置
NODE_ENV=production
PORT=9000

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=crm_db

# 通话记录配置
CALL_END_DETECTION_TIMEOUT=3
CALL_STATUS_CHECK_INTERVAL=1
CALL_CLEANUP_TIMEOUT=60
```

### 4. 创建数据库

```bash
# 登录 PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE crm_db;

# 退出
\q
```

### 5. 运行数据库迁移

```bash
npm run typeorm migration:run
```

### 6. 构建项目

```bash
npm run build
```

### 7. 启动应用

```bash
# 生产环境启动
npm run start:prod

# 或使用 PM2 (推荐)
pm2 start dist/main.js --name crm-backend
```

---

## 重新部署

### 方案 1: 零停机部署 (推荐)

使用 PM2 实现零停机重启:

```bash
#!/bin/bash
# deploy.sh

echo "🚀 开始部署 CRM 后端..."

# 1. 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin master

# 2. 安装依赖
echo "📦 安装依赖..."
npm install

# 3. 运行数据库迁移
echo "🗄️ 运行数据库迁移..."
npm run typeorm migration:run

# 4. 构建项目
echo "🔨 构建项目..."
npm run build

# 5. 重启应用 (零停机)
echo "🔄 重启应用..."
pm2 reload crm-backend

echo "✅ 部署完成！"
```

使用方法:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

### 方案 2: 标准部署

适用于不使用 PM2 的场景:

```bash
#!/bin/bash
# deploy-standard.sh

echo "🚀 开始部署 CRM 后端..."

# 1. 拉取最新代码
git pull origin master

# 2. 安装依赖
npm install

# 3. 运行数据库迁移
npm run typeorm migration:run

# 4. 构建项目
npm run build

# 5. 停止旧进程
echo "⏹️ 停止旧进程..."
pkill -f "node dist/main.js" || true

# 6. 启动新进程
echo "▶️ 启动新进程..."
nohup npm run start:prod > logs/app.log 2>&1 &

echo "✅ 部署完成！"
```

---

### 方案 3: Docker 部署

#### 3.1 创建 Dockerfile

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 暴露端口
EXPOSE 9000

# 启动应用
CMD ["npm", "run", "start:prod"]
```

#### 3.2 创建 docker-compose.yml

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "9000:9000"
    environment:
      - NODE_ENV=production
      - DB_HOST=db
      - DB_PORT=5432
      - DB_USERNAME=postgres
      - DB_PASSWORD=your_password
      - DB_DATABASE=crm_db
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_password
      - POSTGRES_DB=crm_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

volumes:
  postgres_data:
```

#### 3.3 部署命令

```bash
# 首次部署
docker-compose up -d

# 重新部署
docker-compose down
docker-compose build
docker-compose up -d

# 查看日志
docker-compose logs -f app
```

---

## 数据库迁移

### 自动迁移 (推荐)

在部署脚本中自动运行:

```bash
npm run typeorm migration:run
```

### 手动迁移

```bash
# 生成迁移文件
npm run typeorm migration:generate -- -n MigrationName

# 运行迁移
npm run typeorm migration:run

# 回滚迁移
npm run typeorm migration:revert
```

### 查看迁移状态

```bash
npm run typeorm migration:show
```

---

## 环境变量配置

### 开发环境 (.env.development)

```env
NODE_ENV=development
PORT=9000

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=crm_dev

CALL_END_DETECTION_TIMEOUT=3
CALL_STATUS_CHECK_INTERVAL=1
CALL_CLEANUP_TIMEOUT=60
```

### 生产环境 (.env.production)

```env
NODE_ENV=production
PORT=9000

DB_HOST=your-production-db-host
DB_PORT=5432
DB_USERNAME=your-db-user
DB_PASSWORD=your-secure-password
DB_DATABASE=crm_production

CALL_END_DETECTION_TIMEOUT=3
CALL_STATUS_CHECK_INTERVAL=1
CALL_CLEANUP_TIMEOUT=60
```

---

## PM2 配置

### 创建 ecosystem.config.js

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      script: './dist/main.js',
      instances: 2, // 集群模式，2个实例
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 9000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};
```

### PM2 常用命令

```bash
# 启动应用
pm2 start ecosystem.config.js

# 重启应用 (零停机)
pm2 reload crm-backend

# 停止应用
pm2 stop crm-backend

# 删除应用
pm2 delete crm-backend

# 查看日志
pm2 logs crm-backend

# 查看状态
pm2 status

# 监控
pm2 monit

# 保存配置
pm2 save

# 开机自启
pm2 startup
```

---

## 常见问题

### 1. 端口被占用

```bash
# 查找占用端口的进程
lsof -i :9000

# 杀死进程
kill -9 <PID>
```

### 2. 数据库连接失败

检查配置:

```bash
# 测试数据库连接
psql -h localhost -U postgres -d crm_db

# 检查 PostgreSQL 服务状态
systemctl status postgresql
```

### 3. 迁移失败

```bash
# 查看迁移状态
npm run typeorm migration:show

# 回滚最后一次迁移
npm run typeorm migration:revert

# 重新运行迁移
npm run typeorm migration:run
```

### 4. 内存不足

调整 PM2 配置:

```javascript
// ecosystem.config.js
{
  max_memory_restart: '2G', // 增加内存限制
  node_args: '--max-old-space-size=4096' // 增加 Node.js 堆内存
}
```

### 5. WebSocket 连接失败

检查防火墙和反向代理配置:

```nginx
# Nginx 配置示例
location /ws {
    proxy_pass http://localhost:9000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

---

## 健康检查

### 1. 应用健康检查

```bash
# 检查应用是否运行
curl http://localhost:9000/

# 检查 API 响应
curl http://localhost:9000/api/statistics/overview
```

### 2. 数据库健康检查

```bash
# 检查数据库连接
psql -h localhost -U postgres -d crm_db -c "SELECT 1;"
```

### 3. WebSocket 健康检查

```javascript
// test-websocket.js
const io = require('socket.io-client');

const socket = io('http://localhost:9000/ws');

socket.on('connect', () => {
  console.log('✅ WebSocket 连接成功');
  process.exit(0);
});

socket.on('connect_error', (error) => {
  console.error('❌ WebSocket 连接失败:', error);
  process.exit(1);
});
```

运行测试:

```bash
node test-websocket.js
```

---

## 监控和日志

### 1. 日志管理

```bash
# 创建日志目录
mkdir -p logs

# 查看实时日志
tail -f logs/out.log

# 查看错误日志
tail -f logs/err.log

# 日志轮转配置 (logrotate)
cat > /etc/logrotate.d/crm-backend << EOF
/path/to/backend/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
EOF
```

### 2. 性能监控

使用 PM2 Plus (可选):

```bash
# 安装 PM2 Plus
pm2 install pm2-server-monit

# 链接到 PM2 Plus
pm2 link <secret_key> <public_key>
```

---

## 备份和恢复

### 数据库备份

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/path/to/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/crm_db_$DATE.sql"

# 创建备份
pg_dump -h localhost -U postgres crm_db > $BACKUP_FILE

# 压缩备份
gzip $BACKUP_FILE

echo "✅ 备份完成: $BACKUP_FILE.gz"

# 删除 7 天前的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

### 数据库恢复

```bash
# 解压备份
gunzip crm_db_20260129_120000.sql.gz

# 恢复数据库
psql -h localhost -U postgres crm_db < crm_db_20260129_120000.sql
```

---

## 安全建议

1. **使用强密码**: 数据库密码应使用强密码
2. **限制访问**: 配置防火墙规则,只允许必要的端口访问
3. **HTTPS**: 生产环境使用 HTTPS
4. **定期更新**: 定期更新依赖包和系统补丁
5. **备份**: 定期备份数据库
6. **监控**: 配置监控和告警

---

## 性能优化

### 1. 数据库优化

```sql
-- 创建索引
CREATE INDEX idx_call_records_record_type ON call_records(recordType);
CREATE INDEX idx_call_records_created_at ON call_records(createdAt DESC);
CREATE INDEX idx_call_records_status ON call_records(status);

-- 定期清理旧数据
DELETE FROM call_records WHERE status = 'ended' AND createdAt < NOW() - INTERVAL '30 days';
```

### 2. 应用优化

```javascript
// ecosystem.config.js
{
  instances: 'max', // 使用所有 CPU 核心
  exec_mode: 'cluster',
  max_memory_restart: '1G',
  node_args: '--max-old-space-size=2048'
}
```

---

## 回滚方案

如果部署出现问题,可以快速回滚:

```bash
#!/bin/bash
# rollback.sh

echo "⏪ 开始回滚..."

# 1. 回滚代码
git reset --hard HEAD~1

# 2. 安装依赖
npm install

# 3. 回滚数据库迁移
npm run typeorm migration:revert

# 4. 构建项目
npm run build

# 5. 重启应用
pm2 reload crm-backend

echo "✅ 回滚完成！"
```

---

## 相关文档

- [API 接口文档](./API_DOCUMENTATION.md)
- [通话记录系统实现方案](./CALL_RECORD_IMPLEMENTATION.md)
- [通话结束检测方案](./CALL_END_DETECTION.md)

---

**最后更新**: 2026-01-29

**维护者**: CRM 开发团队
