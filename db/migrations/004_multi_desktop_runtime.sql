USE fb_commenter;

ALTER TABLE comment_jobs MODIFY COLUMN status ENUM('PENDING','READY_FOR_WORKER','RUNNING','SUCCESS','FAILED','UNKNOWN','RETRY_DUE','SKIPPED','PAUSED','CANCELLED') NOT NULL DEFAULT 'PENDING';

CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  worker_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_device_tokens_worker FOREIGN KEY (worker_id) REFERENCES worker_nodes(id) ON DELETE CASCADE,
  INDEX idx_device_tokens_worker (worker_id,revoked_at)
);

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='worker_key');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN worker_key VARCHAR(120) NULL AFTER id",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='device_name');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN device_name VARCHAR(160) NULL AFTER worker_key",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='os');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN os VARCHAR(40) NULL AFTER device_name",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='app_version');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN app_version VARCHAR(40) NULL AFTER os",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='last_seen_at');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN last_seen_at DATETIME NULL AFTER last_health_at",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='current_job_id');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN current_job_id CHAR(36) NULL AFTER last_seen_at",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND column_name='default_dry_run');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD COLUMN default_dry_run BOOLEAN NOT NULL DEFAULT TRUE AFTER current_job_id",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @c := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='worker_nodes' AND index_name='uq_worker_key');
SET @s := IF(@c=0,"ALTER TABLE worker_nodes ADD UNIQUE KEY uq_worker_key (worker_key)",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
UPDATE worker_nodes SET worker_key=LOWER(REPLACE(name,' ','-')),device_name=name,os=COALESCE(os,'unknown'),app_version=COALESCE(app_version,'legacy') WHERE worker_key IS NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='fb_accounts' AND column_name='assigned_worker_id');
SET @s := IF(@c=0,"ALTER TABLE fb_accounts ADD COLUMN assigned_worker_id BIGINT NULL AFTER profile_key",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @s := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='fb_accounts' AND index_name='idx_accounts_worker')=0,"ALTER TABLE fb_accounts ADD INDEX idx_accounts_worker (assigned_worker_id,is_active)",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;

SET @c := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='comment_jobs' AND column_name='assigned_worker_id');
SET @s := IF(@c=0,"ALTER TABLE comment_jobs ADD COLUMN assigned_worker_id BIGINT NULL AFTER account_id",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
SET @s := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='comment_jobs' AND index_name='idx_jobs_worker')=0,"ALTER TABLE comment_jobs ADD INDEX idx_jobs_worker (assigned_worker_id,status,scheduled_at)",'SELECT 1'); PREPARE x FROM @s; EXECUTE x; DEALLOCATE PREPARE x;
UPDATE comment_jobs j JOIN fb_accounts a ON a.id=j.account_id SET j.assigned_worker_id=a.assigned_worker_id WHERE j.assigned_worker_id IS NULL AND a.assigned_worker_id IS NOT NULL;
