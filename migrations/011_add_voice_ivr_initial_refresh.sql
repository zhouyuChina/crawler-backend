-- Migration 011: IVR 初始状态补偿字段与日期级唯一键
-- 背景：初始狀態 后续会变成最终状态，且 callDate 秒级时间可能变化。
-- 因此 voice_ivr_records 需要按 callDate 日期去重并允许 upsert 更新。
-- mid 仅作为请求参数/记录字段保留，不参与记录唯一性。

ALTER TABLE voice_ivr_records
  ADD COLUMN IF NOT EXISTS "needsRefresh" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "refreshAfter" TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS "refreshUntil" TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS "refreshAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRefreshAt" TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP NULL;

UPDATE voice_ivr_records
SET "needsRefresh" = TRUE,
    "refreshAfter" = COALESCE("refreshAfter", "createdAt" + INTERVAL '2 minutes'),
    "refreshUntil" = COALESCE("refreshUntil", "createdAt" + INTERVAL '1 hour'),
    "lastSeenAt" = COALESCE("lastSeenAt", "createdAt")
WHERE "statusType" = '初始狀態'
  AND "callDate" IS NOT NULL;

-- 删除同一 CRM/mid/recordId/日期 下的重复记录，优先保留非初始状态，再保留最新 callDate。
DELETE FROM voice_ivr_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", "recordId", ("callDate"::date)) id
  FROM voice_ivr_records
  WHERE "callDate" IS NOT NULL
  ORDER BY
    "crmKey",
    "recordId",
    ("callDate"::date),
    CASE WHEN "statusType" = '初始狀態' THEN 1 ELSE 0 END,
    "callDate" DESC NULLS LAST,
    "createdAt" DESC
)
AND "callDate" IS NOT NULL;

DROP INDEX IF EXISTS uq_voice_ivr_record_with_call_date;

CREATE UNIQUE INDEX uq_voice_ivr_record_with_call_date
  ON voice_ivr_records ("crmKey", "recordId", ("callDate"::date))
  WHERE "callDate" IS NOT NULL;

DROP INDEX IF EXISTS uq_voice_ivr_record_without_call_date;

DELETE FROM voice_ivr_records
WHERE id NOT IN (
  SELECT DISTINCT ON ("crmKey", "recordId") id
  FROM voice_ivr_records
  WHERE "callDate" IS NULL
  ORDER BY "crmKey", "recordId", "createdAt" DESC
)
AND "callDate" IS NULL;

CREATE UNIQUE INDEX uq_voice_ivr_record_without_call_date
  ON voice_ivr_records ("crmKey", "recordId")
  WHERE "callDate" IS NULL;

CREATE INDEX IF NOT EXISTS idx_voice_ivr_refresh_due
  ON voice_ivr_records ("crmKey", mid, "refreshAfter")
  WHERE "needsRefresh" = TRUE
    AND "dst" IS NOT NULL
    AND "callDate" IS NOT NULL;
