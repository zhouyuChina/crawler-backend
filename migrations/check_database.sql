-- 数据库检查脚本
-- 用于检查当前数据库是否需要更新

-- 1. 检查 call_records 表是否存在
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_name = 'call_records'
        ) THEN '✅ call_records 表已存在'
        ELSE '❌ call_records 表不存在，需要创建'
    END AS table_status;

-- 2. 如果表存在,检查表结构
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'call_records'
ORDER BY ordinal_position;

-- 3. 检查索引
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'call_records';

-- 4. 检查现有表
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
ORDER BY table_name;
