-- 迁移：voice_op_records 改为按 呼叫日期 + 主叫 + 被叫 判重
-- 实际索引包含 mid，避免不同账号之间互相冲突。

-- Step 1: 删除旧的秒级唯一索引
DROP INDEX IF EXISTS uq_voice_op_record_with_call_date;
DROP INDEX IF EXISTS uq_voice_op_record_without_call_date;

-- Step 2: 按 mid + src + dst + callDate 日期去重，保留最新抓到的那条
DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", mid, src, dst, ("callDate"::date)) id
  FROM voice_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY "crmKey", mid, src, dst, ("callDate"::date), "createdAt" DESC, "endDate" DESC NULLS LAST
)
AND "callDate" IS NOT NULL;

-- Step 3: 建日期级表达式唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_op_record_with_call_date
  ON voice_op_records ("crmKey", mid, src, dst, ("callDate"::date))
  WHERE "callDate" IS NOT NULL;
