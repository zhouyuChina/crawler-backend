-- 修复 voice_ivr_records 表结构与历史数据
-- 版本: v0.5
-- 日期: 2026-06-06

-- 1. callDate 被误写入 task 的记录，迁回 callDate。
UPDATE voice_ivr_records
SET "callDate" = task::timestamp,
    task = NULL
WHERE "callDate" IS NULL
  AND task ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$';

-- 2. 如果旧表仍有 result 列，将 result 合并到 reason，然后删除 result。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'voice_ivr_records'
      AND column_name = 'result'
  ) THEN
    UPDATE voice_ivr_records
    SET reason = result
    WHERE reason IS NULL
      AND result IS NOT NULL;

    ALTER TABLE voice_ivr_records DROP COLUMN result;
  END IF;
END $$;

-- 3. 删除旧约束：旧规则只按 (mid, recordId) 去重，会误吞相同 recordId 不同呼叫时间的记录。
ALTER TABLE voice_ivr_records
DROP CONSTRAINT IF EXISTS uq_voice_ivr_record;

-- 4. callDate 正常时，按 (mid, recordId, callDate) 去重。
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_with_call_date
ON voice_ivr_records (mid, "recordId", "callDate")
WHERE "callDate" IS NOT NULL;

-- 5. callDate 解析失败时，退回按 (mid, recordId) 去重，避免 NULL 时间记录无限重复。
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_record_without_call_date
ON voice_ivr_records (mid, "recordId")
WHERE "callDate" IS NULL;
