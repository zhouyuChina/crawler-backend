# CRM 后端快速部署指南

> 当前仓库已内置可直接执行的 Docker Compose 部署方案。

## 1. 推荐方案

推荐直接使用仓库根目录下的这几个文件:

- `Dockerfile`
- `docker-compose.yml`
- `quick-deploy.sh`
- `.env.production.example`

## 2. 首次部署

### 前置要求

- Docker Desktop 或 Docker Engine
- Docker Compose（`docker compose` 或 `docker-compose` 任意一种即可）

### 命令

```bash
cp .env.production.example .env.production
sh ./quick-deploy.sh
```

也可以使用 npm 脚本:

```bash
npm run deploy:quick
```

## 3. 部署后检查

默认端口是 `3000`，部署完成后可检查:

- API: `http://localhost:3000/api`
- 健康检查: `http://localhost:3000/api/health`
- 监控页: `http://localhost:3000/api/monitor`

查看容器状态:

```bash
docker compose --env-file .env.production ps
```

查看后端日志:

```bash
docker compose --env-file .env.production logs -f app
```

## 4. 关于首次建表

当前项目在生产环境下默认不会自动同步表结构，但仓库里还没有完整的 TypeORM 迁移链路。

因此，快速部署方案采用以下策略:

- 首次部署时使用 `DB_SYNCHRONIZE=true`
- 应用启动后由 TypeORM 根据实体自动建表
- 确认表结构创建完成后，把 `.env.production` 中的 `DB_SYNCHRONIZE` 改为 `false`
- 再执行一次部署脚本

`.env.production.example` 已经默认包含:

```env
DB_SYNCHRONIZE=true
```

首次上线确认无误后，请手动改成:

```env
DB_SYNCHRONIZE=false
```

然后重新部署:

```bash
sh ./quick-deploy.sh
```

## 5. 常用命令

重新构建并部署:

```bash
docker compose --env-file .env.production up -d --build
```

停止服务:

```bash
docker compose --env-file .env.production down
```

查看数据库日志:

```bash
docker compose --env-file .env.production logs -f db
```

查看后端日志:

```bash
docker compose --env-file .env.production logs -f app
```

## 6. 重要环境变量

默认的 `.env.production.example` 适合本机或单机服务器快速启动，核心字段如下:

```env
NODE_ENV=production
PORT=3000

DB_HOST=db
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=crm_db
DB_SYNCHRONIZE=true
DB_LOGGING=false

UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
CORS_ORIGIN=*
```

如果服务需要对公网开放，至少要改这两项:

```env
DB_PASSWORD=your-strong-password
CORS_ORIGIN=https://your-frontend-domain.com
```

## 7. 不使用 Docker 的方式

如果目标机器已经安装好 Node.js 和 PostgreSQL，可以直接使用下面的最小部署命令:

```bash
cp .env.production.example .env.production
# 把 DB_HOST 改成真实数据库地址，例如 localhost
npm install
npm run build
NODE_ENV=production DB_SYNCHRONIZE=true npm run start:prod
```

同样地，首次启动成功后请把 `DB_SYNCHRONIZE` 切回 `false`。
