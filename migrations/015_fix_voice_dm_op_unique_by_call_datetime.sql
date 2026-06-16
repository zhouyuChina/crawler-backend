-- Migration 015: dm_voiceop 手拨记录改为按完整呼叫时间判重
-- 背景：同一天同一主叫/被叫可能出现多次手拨记录，按 callDate::date upsert 会在同批数据中重复命中同一行。

-- 清理新唯一键下的重复数据，保留最新抓到的一条。
DELETE FROM voice_dm_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", src, dst, "callDate") id
  FROM voice_dm_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY
    "crmKey",
    src,
    dst,
    "callDate",
    "createdAt" DESC,
    "endDate" DESC NULLS LAST
)
AND "callDate" IS NOT NULL;

DROP INDEX IF EXISTS uq_voice_dm_op_record_with_call_date;

CREATE UNIQUE INDEX uq_voice_dm_op_record_with_call_date
  ON voice_dm_op_records ("crmKey", src, dst, "callDate")
  WHERE "callDate" IS NOT NULL;
