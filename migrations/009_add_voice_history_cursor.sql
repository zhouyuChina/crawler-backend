-- Migration 009: 为 voice_crawl_states 添加历史补全游标字段
-- 支持大页量历史记录分批续跑、页码漂移感知和断点恢复

ALTER TABLE voice_crawl_states
  ADD COLUMN IF NOT EXISTS "historyStatus"         VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "historyNextPage"        INTEGER,
  ADD COLUMN IF NOT EXISTS "historyTotalPagesRef"   INTEGER,
  ADD COLUMN IF NOT EXISTS "historyLastRecordId"    VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "historyBatchStartedAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "historyBatchFinishedAt" TIMESTAMP;

COMMENT ON COLUMN voice_crawl_states."historyStatus"
  IS 'pending=待续跑 running=批次进行中 completed=已全部完成 failed=批次失败';

COMMENT ON COLUMN voice_crawl_states."historyNextPage"
  IS '下次历史批次的起始页码（以 historyTotalPagesRef 为基准，需加漂移量）';

COMMENT ON COLUMN voice_crawl_states."historyTotalPagesRef"
  IS '上次批次结束时记录的总页数，用于计算页码漂移';

COMMENT ON COLUMN voice_crawl_states."historyLastRecordId"
  IS '上次批次最后一条记录的 recordId（备用对齐，当漂移计算偏差较大时使用）';
