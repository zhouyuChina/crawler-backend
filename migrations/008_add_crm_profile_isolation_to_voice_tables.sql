-- 迁移：表格明细/汇总/抓取状态按 CRM 配置隔离
-- CRM 配置标识使用 crawl_profiles.id，历史无法匹配的数据保留为 legacy。

-- Step 1: 增加隔离字段
ALTER TABLE voice_ivr_records
  ADD COLUMN IF NOT EXISTS "crmProfileId" VARCHAR(128) NOT NULL DEFAULT 'legacy';

ALTER TABLE voice_op_records
  ADD COLUMN IF NOT EXISTS "crmProfileId" VARCHAR(128) NOT NULL DEFAULT 'legacy';

ALTER TABLE voice_ivr_summaries
  ADD COLUMN IF NOT EXISTS "crmProfileId" VARCHAR(128) NOT NULL DEFAULT 'legacy';

ALTER TABLE voice_op_summaries
  ADD COLUMN IF NOT EXISTS "crmProfileId" VARCHAR(128) NOT NULL DEFAULT 'legacy';

ALTER TABLE voice_crawl_states
  ADD COLUMN IF NOT EXISTS "crmProfileId" VARCHAR(128) NOT NULL DEFAULT 'legacy';

-- Step 2: 根据 sourceUrl 匹配 crawl_profiles.baseUrl 回填历史明细/汇总
UPDATE voice_ivr_records r
SET "crmProfileId" = p.id::text
FROM crawl_profiles p
WHERE r."sourceUrl" LIKE p."baseUrl" || '%';

UPDATE voice_op_records r
SET "crmProfileId" = p.id::text
FROM crawl_profiles p
WHERE r."sourceUrl" LIKE p."baseUrl" || '%';

UPDATE voice_ivr_summaries s
SET "crmProfileId" = p.id::text
FROM crawl_profiles p
WHERE s."sourceUrl" LIKE p."baseUrl" || '%';

UPDATE voice_op_summaries s
SET "crmProfileId" = p.id::text
FROM crawl_profiles p
WHERE s."sourceUrl" LIKE p."baseUrl" || '%';

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

-- Step 4: 按新隔离键去重，避免建唯一索引失败
DELETE FROM voice_ivr_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmProfileId", mid, "recordId", "callDate") id
  FROM voice_ivr_records
  WHERE "callDate" IS NOT NULL
  ORDER BY "crmProfileId", mid, "recordId", "callDate", "createdAt" ASC
)
AND "callDate" IS NOT NULL;

DELETE FROM voice_ivr_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmProfileId", mid, "recordId") id
  FROM voice_ivr_records
  WHERE "callDate" IS NULL
  ORDER BY "crmProfileId", mid, "recordId", "createdAt" ASC
)
AND "callDate" IS NULL;

DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmProfileId", mid, src, dst, ("callDate"::date)) id
  FROM voice_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY "crmProfileId", mid, src, dst, ("callDate"::date), "createdAt" DESC, "endDate" DESC NULLS LAST
)
AND "callDate" IS NOT NULL;

-- Step 5: 创建新唯一索引/查询索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_with_call_date
  ON voice_ivr_records ("crmProfileId", mid, "recordId", "callDate")
  WHERE "callDate" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_without_call_date
  ON voice_ivr_records ("crmProfileId", mid, "recordId")
  WHERE "callDate" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
  ON voice_op_records ("crmProfileId", mid, src, dst, ("callDate"::date))
  WHERE "callDate" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_ivr_record_crm_mid_created
  ON voice_ivr_records ("crmProfileId", mid, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_op_record_crm_mid_created
  ON voice_op_records ("crmProfileId", mid, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_ivr_summary_crm_mid_captured
  ON voice_ivr_summaries ("crmProfileId", mid, "capturedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_voice_op_summary_crm_mid_captured
  ON voice_op_summaries ("crmProfileId", mid, "capturedAt" DESC);

ALTER TABLE voice_crawl_states
  ADD CONSTRAINT uq_voice_crawl_state UNIQUE ("crmProfileId", module, mid);
