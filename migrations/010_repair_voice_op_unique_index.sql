-- Migration 010: 修复 voice_op_records 的 ON CONFLICT 依赖索引
-- 症状：cc_voiceop 报错
-- there is no unique or exclusion constraint matching the ON CONFLICT specification

DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", mid, src, dst, ("callDate"::date)) id
  FROM voice_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY "crmKey", mid, src, dst, ("callDate"::date), "createdAt" DESC, "endDate" DESC NULLS LAST
)
AND "callDate" IS NOT NULL;

DROP INDEX IF EXISTS uq_voice_op_record_with_call_date;

CREATE UNIQUE INDEX uq_voice_op_record_with_call_date
  ON voice_op_records ("crmKey", mid, src, dst, ("callDate"::date))
  WHERE "callDate" IS NOT NULL;
