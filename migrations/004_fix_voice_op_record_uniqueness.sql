-- 迁移：修正 voice_op_records 唯一约束
-- 将 (mid, recordKey) 改为 (mid, src, dst, callDate) 唯一索引

-- Step 1: 删除旧约束
ALTER TABLE voice_op_records DROP CONSTRAINT IF EXISTS uq_voice_op_record;

-- Step 2: 去重 callDate IS NOT NULL 的数据，保留最早插入的那条
DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON (mid, src, dst, "callDate") id
  FROM voice_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY mid, src, dst, "callDate", "createdAt" ASC
)
AND "callDate" IS NOT NULL;

-- Step 3: 去重 callDate IS NULL 的数据
DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON (mid, src, dst) id
  FROM voice_op_records
  WHERE "callDate" IS NULL
  ORDER BY mid, src, dst, "createdAt" ASC
)
AND "callDate" IS NULL;

-- Step 4: 建唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
  ON voice_op_records (mid, src, dst, "callDate")
  WHERE "callDate" IS NOT NULL;
