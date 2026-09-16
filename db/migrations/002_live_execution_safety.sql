USE fb_commenter;
ALTER TABLE comment_jobs
  MODIFY COLUMN status ENUM('PENDING','RUNNING','SUCCESS','FAILED','UNKNOWN','RETRY_DUE','SKIPPED','PAUSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(191) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS execution_stage VARCHAR(40) NOT NULL DEFAULT 'QUEUED' AFTER dry_run,
  ADD COLUMN IF NOT EXISTS effective_mode ENUM('DRY_RUN','LIVE') NOT NULL DEFAULT 'DRY_RUN' AFTER execution_stage,
  ADD COLUMN IF NOT EXISTS submit_at DATETIME NULL AFTER started_at,
  ADD COLUMN IF NOT EXISTS verified_at DATETIME NULL AFTER submit_at,
  ADD COLUMN IF NOT EXISTS execution_result VARCHAR(40) NULL AFTER verified_at;
UPDATE comment_jobs SET idempotency_key=id WHERE idempotency_key IS NULL OR idempotency_key='';
ALTER TABLE comment_jobs MODIFY COLUMN idempotency_key VARCHAR(191) NOT NULL;
SET @has_uq := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='comment_jobs' AND index_name='uq_jobs_idempotency');
SET @sql := IF(@has_uq=0,'ALTER TABLE comment_jobs ADD UNIQUE KEY uq_jobs_idempotency (idempotency_key)','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
