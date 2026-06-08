-- 迁移：表格明细/汇总/抓取状态按 CRM 地址隔离
-- crmKey 使用 CRM 的 host[:port]，例如 202.155.9.144:55668。
-- 当前历史数据统一归属 173.234.2.174:55668，避免大表 join/正则回填。

-- Step 1: 增加 crmKey 字段
ALTER TABLE voice_ivr_records
  ADD COLUMN IF NOT EXISTS "crmKey" VARCHAR(128) NOT NULL DEFAULT '173.234.2.174:55668';

ALTER TABLE voice_op_records
  ADD COLUMN IF NOT EXISTS "crmKey" VARCHAR(128) NOT NULL DEFAULT '173.234.2.174:55668';

ALTER TABLE voice_ivr_summaries
  ADD COLUMN IF NOT EXISTS "crmKey" VARCHAR(128) NOT NULL DEFAULT '173.234.2.174:55668';

ALTER TABLE voice_op_summaries
  ADD COLUMN IF NOT EXISTS "crmKey" VARCHAR(128) NOT NULL DEFAULT '173.234.2.174:55668';

ALTER TABLE voice_crawl_states
  ADD COLUMN IF NOT EXISTS "crmKey" VARCHAR(128) NOT NULL DEFAULT '173.234.2.174:55668';

-- Step 2: 历史数据统一写入当前 CRM 地址
UPDATE voice_ivr_records
SET "crmKey" = '173.234.2.174:55668'
WHERE "crmKey" IS DISTINCT FROM '173.234.2.174:55668';

UPDATE voice_op_records
SET "crmKey" = '173.234.2.174:55668'
WHERE "crmKey" IS DISTINCT FROM '173.234.2.174:55668';

UPDATE voice_ivr_summaries
SET "crmKey" = '173.234.2.174:55668'
WHERE "crmKey" IS DISTINCT FROM '173.234.2.174:55668';

UPDATE voice_op_summaries
SET "crmKey" = '173.234.2.174:55668'
WHERE "crmKey" IS DISTINCT FROM '173.234.2.174:55668';

UPDATE voice_crawl_states
SET "crmKey" = '173.234.2.174:55668'
WHERE "crmKey" IS DISTINCT FROM '173.234.2.174:55668';

-- Step 3: 删除旧索引/约束
ALTER TABLE voice_crawl_states DROP CONSTRAINT IF EXISTS uq_voice_crawl_state;

DROP INDEX IF EXISTS uq_voice_ivr_record_with_call_date;
DROP INDEX IF EXISTS uq_voice_ivr_record_without_call_date;
DROP INDEX IF EXISTS uq_voice_op_record_with_call_date;
DROP INDEX IF EXISTS uq_voice_op_record_without_call_date;

DROP INDEX IF EXISTS idx_voice_ivr_record_mid_created;
DROP INDEX IF EXISTS idx_voice_op_record_mid_created;
DROP INDEX IF EXISTS idx_voice_ivr_summary_mid_captured;
DROP INDEX IF EXISTS idx_voice_op_summary_mid_captured;
DROP INDEX IF EXISTS idx_voice_ivr_record_crm_mid_created;
DROP INDEX IF EXISTS idx_voice_op_record_crm_mid_created;
DROP INDEX IF EXISTS idx_voice_ivr_summary_crm_mid_captured;
DROP INDEX IF EXISTS idx_voice_op_summary_crm_mid_captured;

-- Step 4: 创建新唯一索引/查询索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_with_call_date
  ON voice_ivr_records ("crmKey", mid, "recordId", "callDate")
  WHERE "callDate" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_without_call_date
  ON voice_ivr_records ("crmKey", mid, "recordId")
  WHERE "callDate" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
  ON voice_op_records ("crmKey", mid, src, dst, ("callDate"::date))
  WHERE "callDate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_ivr_record_crm_mid_created
  ON voice_ivr_records ("crmKey", mid, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_op_record_crm_mid_created
  ON voice_op_records ("crmKey", mid, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_ivr_summary_crm_mid_captured
  ON voice_ivr_summaries ("crmKey", mid, "capturedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_op_summary_crm_mid_captured
  ON voice_op_summaries ("crmKey", mid, "capturedAt" DESC);

ALTER TABLE voice_crawl_states
  ADD CONSTRAINT uq_voice_crawl_state UNIQUE ("crmKey", module, mid);

-- Step 5: 删除之前误加的旧字段
ALTER TABLE voice_ivr_records DROP COLUMN IF EXISTS "crmProfileId";
ALTER TABLE voice_op_records DROP COLUMN IF EXISTS "crmProfileId";
ALTER TABLE voice_ivr_summaries DROP COLUMN IF EXISTS "crmProfileId";
ALTER TABLE voice_op_summaries DROP COLUMN IF EXISTS "crmProfileId";
ALTER TABLE voice_crawl_states DROP COLUMN IF EXISTS "crmProfileId";
