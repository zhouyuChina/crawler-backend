# 数据库更新指南

> 版本: v0.2 → v0.3
> 日期: 2026-01-29

---

## 变更概述

### 新增表

- **call_records**: 通话记录表 (新增)

### 变更说明

v0.3 版本新增了通话记录管理系统,需要在数据库中创建 `call_records` 表。

---

## 检查数据库是否需要更新

### 方法 1: 使用 SQL 脚本检查

```bash
# 连接到数据库
psql -h localhost -U postgres -d crm_db

# 运行检查脚本
\i migrations/check_database.sql
```

### 方法 2: 手动检查

```sql
-- 检查 call_records 表是否存在
SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'call_records'
);
```

**结果判断**:
- `t` (true): 表已存在,无需更新
- `f` (false): 表不存在,需要更新

---

## 数据库更新步骤

### 步骤 1: 备份数据库 (重要!)

```bash
# 创建备份目录
mkdir -p backups

# 备份数据库
pg_dump -h localhost -U postgres crm_db > backups/crm_db_backup_$(date +%Y%m%d_%H%M%S).sql

# 压缩备份
gzip backups/crm_db_backup_*.sql
```

### 步骤 2: 检查当前数据库状态

```bash
# 连接数据库
psql -h localhost -U postgres -d crm_db

# 查看现有表
\dt

# 退出
\q
```

### 步骤 3: 执行数据库迁移

#### 方法 A: 使用 SQL 脚本 (推荐)

```bash
# 执行迁移脚本
psql -h localhost -U postgres -d crm_db -f migrations/001_create_call_records_table.sql

# 查看执行结果
echo $?  # 0 表示成功
```

#### 方法 B: 手动执行 SQL

```bash
# 连接数据库
psql -h localhost -U postgres -d crm_db

# 复制并执行 migrations/001_create_call_records_table.sql 中的 SQL
```

### 步骤 4: 验证迁移结果

```bash
# 连接数据库
psql -h localhost -U postgres -d crm_db

# 检查表是否创建成功
\d call_records

# 检查索引
\di call_records*

# 查询表结构
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'call_records'
ORDER BY ordinal_position;
```

**预期结果**:

```
 column_name     | data_type                   | is_nullable
-----------------+-----------------------------+-------------
 id              | uuid                        | NO
 recordType      | character varying           | NO
 url             | character varying           | NO
 requestBody     | text                        | YES
 responseBody    | text                        | YES
 parsedData      | jsonb                       | YES
 dataHash        | character varying           | YES
 statusCode      | integer                     | YES
 metadata        | jsonb                       | YES
 status          | character varying           | YES
 lastUpdateTime  | timestamp without time zone | YES
 createdAt       | timestamp without time zone | YES
 updatedAt       | timestamp without time zone | YES
```

### 步骤 5: 测试应用连接

```bash
# 启动应用
npm run start:prod

# 测试 API
curl http://localhost:9000/api/call-records/statistics
```

---

## 回滚方案

如果迁移出现问题,可以回滚:

### 方法 1: 删除新表

```sql
-- 删除 call_records 表
DROP TABLE IF EXISTS call_records CASCADE;
```

### 方法 2: 恢复备份

```bash
# 解压备份
gunzip backups/crm_db_backup_20260129_120000.sql.gz

# 删除当前数据库
psql -h localhost -U postgres -c "DROP DATABASE crm_db;"

# 重新创建数据库
psql -h localhost -U postgres -c "CREATE DATABASE crm_db;"

# 恢复备份
psql -h localhost -U postgres crm_db < backups/crm_db_backup_20260129_120000.sql
```

---

## 完整部署流程 (包含数据库更新)

### 自动化部署脚本

```bash
#!/bin/bash
# deploy_with_db.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署 CRM 后端 (包含数据库更新)..."

# 1. 备份数据库
echo "💾 备份数据库..."
mkdir -p backups
BACKUP_FILE="backups/crm_db_backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump -h localhost -U postgres crm_db > $BACKUP_FILE
gzip $BACKUP_FILE
echo "✅ 备份完成: ${BACKUP_FILE}.gz"

# 2. 检查数据库是否需要更新
echo "🔍 检查数据库状态..."
TABLE_EXISTS=$(psql -h localhost -U postgres -d crm_db -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'call_records');")

if [ "$TABLE_EXISTS" = "f" ]; then
    echo "📊 需要创建 call_records 表..."

    # 3. 执行数据库迁移
    echo "🗄️ 执行数据库迁移..."
    psql -h localhost -U postgres -d crm_db -f migrations/001_create_call_records_table.sql

    if [ $? -eq 0 ]; then
        echo "✅ 数据库迁移成功"
    else
        echo "❌ 数据库迁移失败"
        exit 1
    fi
else
    echo "✅ call_records 表已存在,跳过迁移"
fi

# 4. 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin master

# 5. 安装依赖
echo "📦 安装依赖..."
npm install

# 6. 构建项目
echo "🔨 构建项目..."
npm run build

# 7. 重启应用
echo "🔄 重启应用..."
pm2 reload crm-backend

# 8. 验证部署
echo "🧪 验证部署..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/api/call-records/statistics)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 部署成功! API 响应正常"
else
    echo "⚠️ 警告: API 响应异常 (HTTP $HTTP_CODE)"
fi

echo "🎉 部署完成!"
```

### 使用方法

```bash
# 赋予执行权限
chmod +x deploy_with_db.sh

# 执行部署
./deploy_with_db.sh
```

---

## 常见问题

### Q1: 如何确认数据库是否需要更新?

```bash
# 运行检查脚本
psql -h localhost -U postgres -d crm_db -f migrations/check_database.sql
```

### Q2: 迁移失败怎么办?

1. 查看错误信息
2. 检查数据库连接
3. 确认用户权限
4. 如果需要,恢复备份

### Q3: 生产环境如何安全更新?

1. **停机维护窗口**: 选择低峰时段
2. **备份**: 必须先备份
3. **测试**: 在测试环境先验证
4. **监控**: 更新后密切监控
5. **回滚准备**: 准备好回滚方案

### Q4: 如何验证迁移是否成功?

```bash
# 1. 检查表结构
psql -h localhost -U postgres -d crm_db -c "\d call_records"

# 2. 检查索引
psql -h localhost -U postgres -d crm_db -c "\di call_records*"

# 3. 测试插入数据
psql -h localhost -U postgres -d crm_db -c "
INSERT INTO call_records (id, \"recordType\", url, status)
VALUES (gen_random_uuid(), 'test', 'http://test.com', 'active');
"

# 4. 查询数据
psql -h localhost -U postgres -d crm_db -c "SELECT * FROM call_records LIMIT 1;"

# 5. 删除测试数据
psql -h localhost -U postgres -d crm_db -c "DELETE FROM call_records WHERE \"recordType\" = 'test';"
```

---

## 不同环境的更新策略

### 开发环境

```bash
# 使用 synchronize 自动同步
NODE_ENV=development npm run start:dev
```

### 测试环境

```bash
# 先在测试环境验证迁移脚本
psql -h test-db-host -U postgres -d crm_test -f migrations/001_create_call_records_table.sql
```

### 生产环境

```bash
# 使用完整的部署脚本
./deploy_with_db.sh
```

---

## 监控和验证

### 部署后检查清单

- [ ] 数据库表已创建
- [ ] 索引已创建
- [ ] 应用启动成功
- [ ] API 响应正常
- [ ] WebSocket 连接正常
- [ ] 日志无错误
- [ ] 性能正常

### 监控命令

```bash
# 查看应用日志
pm2 logs crm-backend

# 查看数据库连接
psql -h localhost -U postgres -d crm_db -c "
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE datname = 'crm_db';
"

# 查看表大小
psql -h localhost -U postgres -d crm_db -c "
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

---

## 性能优化建议

### 索引优化

```sql
-- 如果查询慢,可以添加额外的索引
CREATE INDEX idx_call_records_status_type ON call_records(status, "recordType");
CREATE INDEX idx_call_records_created_desc ON call_records("createdAt" DESC);
```

### 定期清理

```sql
-- 清理 30 天前的已结束通话记录
DELETE FROM call_records
WHERE status = 'ended'
    AND "createdAt" < NOW() - INTERVAL '30 days';
```

---

## 相关文档

- [部署指南](./DEPLOYMENT_GUIDE.md)
- [API 接口文档](./API_DOCUMENTATION.md)
- [通话记录系统实现方案](./CALL_RECORD_IMPLEMENTATION.md)

---

**最后更新**: 2026-01-29

**维护者**: CRM 开发团队
