-- 迁移：修正 voice_op_records 唯一约束
-- 将 (mid, recordKey) 改为 (mid, src, dst, callDate) 部分唯一索引

-- Step 1: 删除旧约束
ALTER TABLE voice_op_records DROP CONSTRAINT IF EXISTS uq_voice_op_record;

-- Step 2: callDate IS NOT NULL 时，mid + src + dst + callDate 唯一
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
  ON voice_op_records (mid, src, dst, "callDate")
  WHERE "callDate" IS NOT NULL;

-- Step 3: callDate IS NULL 时，mid + src + dst 唯一
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_without_call_date
  ON voice_op_records (mid, src, dst)
  WHERE "callDate" IS NULL;
