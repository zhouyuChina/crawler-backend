-- Migration 013: IVR 导出号码极简表
-- 新 IVR 采集流程按接通/未接通筛选后下载 txt，只保留号码、状态和北京时间日期。

CREATE TABLE IF NOT EXISTS voice_ivr_export_numbers (
  id UUID PRIMARY KEY,
  "crmKey" VARCHAR(128) NOT NULL,
  mid INTEGER NOT NULL,
  "phoneNumber" VARCHAR(32) NOT NULL,
  disposition VARCHAR(16) NOT NULL,
  "sourceDate" VARCHAR(10) NOT NULL,
  "sourceUrl" TEXT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_export_number_daily
  ON voice_ivr_export_numbers ("crmKey", mid, "phoneNumber", disposition, "sourceDate");

CREATE INDEX IF NOT EXISTS idx_voice_ivr_export_number_crm_date
  ON voice_ivr_export_numbers ("crmKey", "sourceDate", disposition);
