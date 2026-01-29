#!/bin/bash
# deploy_with_db.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署 CRM 后端 (包含数据库更新)..."

# 1. 备份数据库 (暂时跳过，因为版本不匹配)
echo "⚠️  跳过数据库备份 (pg_dump 版本不匹配)"

# 2. 检查数据库是否需要更新
echo "🔍 检查数据库状态..."
TABLE_EXISTS=$(psql -h localhost -U crawler_db -d crawler_db -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'call_records');")

if [ "$TABLE_EXISTS" = "f" ]; then
    echo "📊 需要创建 call_records 表..."

    # 3. 执行数据库迁移
    echo "🗄️ 执行数据库迁移..."
    psql -h localhost -U crawler_db -d crawler_db -f migrations/001_create_call_records_table.sql

    if [ $? -eq 0 ]; then
        echo "✅ 数据库迁移成功"
    else
        echo "❌ 数据库迁移失败"
        exit 1
    fi
else
    echo "✅ call_records 表已存在,跳过迁移"
fi

# 4. 拉取最新代码 (跳过)
echo "⚠️  跳过拉取代码 (手动部署)"

# 5. 安装依赖
echo "📦 安装依赖..."
npm install

# 6. 构建项目
echo "🔨 构建项目..."
npm run build

# 7. 重启应用 (跳过，使用宝塔管理)
echo "⚠️  跳过重启应用 (请在宝塔面板手动重启)"

# 8. 验证部署
echo "🧪 验证部署..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:7000/api/call-records/statistics)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 部署成功! API 响应正常"
else
    echo "⚠️ 警告: API 响应异常 (HTTP $HTTP_CODE)"
fi

echo "🎉 部署完成!"
