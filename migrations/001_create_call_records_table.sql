-- 创建通话记录表
-- 版本: v0.3
-- 日期: 2026-01-29

-- 1. 创建 call_records 表
CREATE TABLE IF NOT EXISTS call_records (
    id UUID PRIMARY KEY,
    "recordType" VARCHAR(50) NOT NULL,
    url VARCHAR(500) NOT NULL,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "parsedData" JSONB,
    "dataHash" VARCHAR(32),
    "statusCode" INTEGER,
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'active',
    "lastUpdateTime" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_call_records_record_type ON call_records("recordType");
CREATE INDEX IF NOT EXISTS idx_call_records_created_at ON call_records("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_call_records_type_created ON call_records("recordType", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_call_records_status ON call_records(status);
CREATE INDEX IF NOT EXISTS idx_call_records_last_update ON call_records("lastUpdateTime");

-- 3. 添加注释
COMMENT ON TABLE call_records IS '通话记录表';
COMMENT ON COLUMN call_records.id IS '主键 UUID';
COMMENT ON COLUMN call_records."recordType" IS '记录类型: get_curcall_in, get_curcall_out, get_peer_status, cont_controler';
COMMENT ON COLUMN call_records.url IS '原始请求 URL';
COMMENT ON COLUMN call_records."requestBody" IS '请求体内容';
COMMENT ON COLUMN call_records."responseBody" IS '响应体内容';
COMMENT ON COLUMN call_records."parsedData" IS '解析后的 JSON 数据';
COMMENT ON COLUMN call_records."dataHash" IS 'MD5 哈希值(用于变更检测)';
COMMENT ON COLUMN call_records."statusCode" IS 'HTTP 状态码';
COMMENT ON COLUMN call_records.metadata IS '元数据';
COMMENT ON COLUMN call_records.status IS '通话状态: active, ended';
COMMENT ON COLUMN call_records."lastUpdateTime" IS '最后更新时间';
COMMENT ON COLUMN call_records."createdAt" IS '创建时间';
COMMENT ON COLUMN call_records."updatedAt" IS '更新时间';

-- 4. 验证表是否创建成功
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'call_records'
ORDER BY ordinal_position;
