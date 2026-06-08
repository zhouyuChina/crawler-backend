-- 迁移：voice_op_records 只保留 mid + src + dst + callDate 唯一索引

DROP INDEX IF EXISTS uq_voice_op_record_without_call_date;
