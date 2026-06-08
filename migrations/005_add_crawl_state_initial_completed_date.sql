-- 迁移：记录 IVR 每日初始锚点抓取完成日期

ALTER TABLE voice_crawl_states
  ADD COLUMN IF NOT EXISTS "initialCompletedDate" VARCHAR(10);
