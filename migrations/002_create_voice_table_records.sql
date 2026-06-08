-- 创建 voice_ivr / voice_op 抓取相关表
-- 版本: v0.4
-- 日期: 2026-05-15

-- 1. cc_voiceivr (語音紀錄) 行表
CREATE TABLE IF NOT EXISTS voice_ivr_records (
    id UUID PRIMARY KEY,
    mid INTEGER NOT NULL,
    "recordId" VARCHAR(64) NOT NULL,
    src VARCHAR(64),
    dst VARCHAR(64),
    "statusType" VARCHAR(32),
    reason VARCHAR(255),
    task VARCHAR(255),
    "callDate" TIMESTAMP,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_with_call_date
    ON voice_ivr_records (mid, "recordId", "callDate")
    WHERE "callDate" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_without_call_date
    ON voice_ivr_records (mid, "recordId")
    WHERE "callDate" IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_ivr_record_mid_created
    ON voice_ivr_records (mid, "createdAt" DESC);

-- 2. cc_voiceivr 汇总表
CREATE TABLE IF NOT EXISTS voice_ivr_summaries (
    id UUID PRIMARY KEY,
    mid INTEGER NOT NULL,
    "totalRecords" INTEGER DEFAULT 0,
    "connectFail" INTEGER DEFAULT 0,
    busy INTEGER DEFAULT 0,
    "noAnswer" INTEGER DEFAULT 0,
    connected INTEGER DEFAULT 0,
    "totalPages" INTEGER DEFAULT 0,
    "sourceUrl" TEXT,
    "capturedAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_ivr_summary_mid_captured
    ON voice_ivr_summaries (mid, "capturedAt" DESC);

-- 3. cc_voiceop (人工紀錄) 行表
CREATE TABLE IF NOT EXISTS voice_op_records (
    id UUID PRIMARY KEY,
    mid INTEGER NOT NULL,
    "recordKey" VARCHAR(64),
    task VARCHAR(255),
    src VARCHAR(64),
    dst VARCHAR(64),
    agent VARCHAR(64),
    reason VARCHAR(64),
    duration VARCHAR(32),
    "callDate" TIMESTAMP,
    "endDate" TIMESTAMP,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
    ON voice_op_records (mid, src, dst, "callDate")
    WHERE "callDate" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_without_call_date
    ON voice_op_records (mid, src, dst)
    WHERE "callDate" IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_op_record_mid_created
    ON voice_op_records (mid, "createdAt" DESC);

-- 4. cc_voiceop 汇总表
CREATE TABLE IF NOT EXISTS voice_op_summaries (
    id UUID PRIMARY KEY,
    mid INTEGER NOT NULL,
    "totalRecords" INTEGER DEFAULT 0,
    "initCount" INTEGER DEFAULT 0,
    ringing INTEGER DEFAULT 0,
    connected INTEGER DEFAULT 0,
    "agentCount" INTEGER DEFAULT 0,
    "connectRate" NUMERIC(6, 2) DEFAULT 0,
    "callbackRate" NUMERIC(6, 2) DEFAULT 0,
    "totalPages" INTEGER DEFAULT 0,
    "sourceUrl" TEXT,
    "capturedAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_op_summary_mid_captured
    ON voice_op_summaries (mid, "capturedAt" DESC);

COMMENT ON TABLE voice_ivr_records IS 'cc_voiceivr 語音紀錄行表';
COMMENT ON TABLE voice_ivr_summaries IS 'cc_voiceivr 抓取快照汇总';
COMMENT ON TABLE voice_op_records IS 'cc_voiceop 人工紀錄行表';
COMMENT ON TABLE voice_op_summaries IS 'cc_voiceop 抓取快照汇总';
