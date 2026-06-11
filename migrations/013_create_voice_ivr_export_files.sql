-- Migration 013: IVR 导出 txt 文件元数据
-- 新 IVR 采集流程按接通/未接通筛选后下载 txt，原始号码保存为文件，数据库只记录文件元信息。

CREATE TABLE IF NOT EXISTS voice_ivr_export_files (
  id UUID PRIMARY KEY,
  "crmKey" VARCHAR(128) NOT NULL,
  mid INTEGER NOT NULL,
  disposition VARCHAR(16) NOT NULL,
  "sourceDate" VARCHAR(10) NOT NULL,
  "filePath" TEXT NOT NULL,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "contentHash" VARCHAR(64) NOT NULL,
  "sourceUrl" TEXT NULL,
  "capturedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_ivr_export_file_daily
  ON voice_ivr_export_files ("crmKey", mid, disposition, "sourceDate");

CREATE INDEX IF NOT EXISTS idx_voice_ivr_export_file_crm_date
  ON voice_ivr_export_files ("crmKey", "sourceDate", disposition);
