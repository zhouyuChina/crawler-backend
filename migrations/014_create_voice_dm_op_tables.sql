-- Migration 014: 新增 dm_voiceop（手拨记录）独立行表与汇总表

CREATE TABLE IF NOT EXISTS voice_dm_op_records (
    id UUID PRIMARY KEY,
    "crmKey" VARCHAR(128) NOT NULL DEFAULT 'legacy',
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_dm_op_record_with_call_date
    ON voice_dm_op_records ("crmKey", src, dst, ("callDate"::date))
    WHERE "callDate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_dm_op_record_crm_mid_created
    ON voice_dm_op_records ("crmKey", mid, "createdAt" DESC);

CREATE TABLE IF NOT EXISTS voice_dm_op_summaries (
    id UUID PRIMARY KEY,
    "crmKey" VARCHAR(128) NOT NULL DEFAULT 'legacy',
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

CREATE INDEX IF NOT EXISTS idx_voice_dm_op_summary_crm_mid_captured
    ON voice_dm_op_summaries ("crmKey", mid, "capturedAt" DESC);

COMMENT ON TABLE voice_dm_op_records IS 'dm_voiceop 手拨记录行表';
COMMENT ON TABLE voice_dm_op_summaries IS 'dm_voiceop 抓取快照汇总';
