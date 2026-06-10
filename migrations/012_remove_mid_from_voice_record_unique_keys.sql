-- Migration 012: 记录唯一键移除 mid，OP 仍保留 src 参与合并。
-- mid 仍作为请求参数/记录字段保留，不参与记录级唯一性。

-- OP：同一 CRM、同一天、同一 src + dst 合并为一条业务数据。
DELETE FROM voice_op_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", src, dst, ("callDate"::date)) id
  FROM voice_op_records
  WHERE "callDate" IS NOT NULL
  ORDER BY
    "crmKey",
    src,
    dst,
    ("callDate"::date),
    "createdAt" DESC,
    "endDate" DESC NULLS LAST
)
AND "callDate" IS NOT NULL;

DROP INDEX IF EXISTS uq_voice_op_record_with_call_date;

CREATE UNIQUE INDEX uq_voice_op_record_with_call_date
  ON voice_op_records ("crmKey", src, dst, ("callDate"::date))
  WHERE "callDate" IS NOT NULL;
