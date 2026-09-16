CREATE DATABASE IF NOT EXISTS fb_commenter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fb_commenter;

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  cooldown_minutes INT NOT NULL DEFAULT 180,
  max_comments_per_account_per_day INT NOT NULL DEFAULT 8,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_windows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  window_date DATE NULL,
  weekday TINYINT NULL COMMENT '1=Monday ... 7=Sunday',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  min_gap_minutes INT NOT NULL DEFAULT 10,
  max_gap_minutes INT NOT NULL DEFAULT 30,
  max_jobs INT NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_windows_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  INDEX idx_windows_due (campaign_id, is_active, window_date, weekday)
);

CREATE TABLE IF NOT EXISTS fb_accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  profile_key VARCHAR(120) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  session_status ENUM('UNKNOWN','READY','SESSION_EXPIRED','CHECKPOINT','DISABLED') NOT NULL DEFAULT 'UNKNOWN',
  daily_limit_override INT NULL,
  last_health_at DATETIME NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  post_url VARCHAR(1000) NOT NULL,
  external_post_id VARCHAR(255) NULL,
  label VARCHAR(255) NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_posts_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  INDEX idx_posts_campaign (campaign_id, is_enabled, priority)
);

CREATE TABLE IF NOT EXISTS post_accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  scheduled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pa_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY uq_post_account (post_id, account_id),
  INDEX idx_pa_enabled (is_enabled, scheduled_at)
);

CREATE TABLE IF NOT EXISTS comment_groups (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_comment_groups_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE KEY uq_comment_group_name (campaign_id,name),
  INDEX idx_comment_groups_campaign (campaign_id,is_active)
);

CREATE TABLE IF NOT EXISTS campaign_accounts (
  campaign_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id,account_id),
  CONSTRAINT fk_campaign_accounts_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_accounts_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campaign_account_groups (
  campaign_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  group_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id,account_id),
  CONSTRAINT fk_cag_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_cag_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cag_group FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  group_id BIGINT NULL,
  content TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_templates_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_templates_group FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE RESTRICT,
  INDEX idx_templates_campaign (campaign_id, is_active)
);

CREATE TABLE IF NOT EXISTS comment_jobs (
  id CHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(191) NOT NULL,
  campaign_id BIGINT NOT NULL,
  post_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  comment_text TEXT NOT NULL,
  status ENUM('PENDING','RUNNING','SUCCESS','FAILED','UNKNOWN','RETRY_DUE','SKIPPED','PAUSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  execution_stage VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  effective_mode ENUM('DRY_RUN','LIVE') NOT NULL DEFAULT 'DRY_RUN',
  scheduled_at DATETIME NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 2,
  retry_after DATETIME NULL,
  worker_name VARCHAR(120) NULL,
  error_code VARCHAR(80) NULL,
  error_message TEXT NULL,
  started_at DATETIME NULL,
  submit_at DATETIME NULL,
  verified_at DATETIME NULL,
  execution_result VARCHAR(40) NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_jobs_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_template FOREIGN KEY (template_id) REFERENCES comment_templates(id) ON DELETE CASCADE,
  UNIQUE KEY uq_campaign_post_account (campaign_id, post_id, account_id),
  UNIQUE KEY uq_jobs_idempotency (idempotency_key),
  INDEX idx_jobs_due (status, scheduled_at, retry_after),
  INDEX idx_jobs_account_day (account_id, created_at, status)
);

CREATE TABLE IF NOT EXISTS worker_nodes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE,
  base_url VARCHAR(500) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  health_status ENUM('UNKNOWN','ONLINE','OFFLINE') NOT NULL DEFAULT 'UNKNOWN',
  last_health_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO campaigns (name, is_active, cooldown_minutes, max_comments_per_account_per_day, dry_run)
SELECT 'Sale Demo', 1, 180, 8, 1
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name='Sale Demo');

INSERT INTO worker_nodes (name, base_url, is_enabled)
SELECT 'local-worker', 'http://127.0.0.1:4311', 1
WHERE NOT EXISTS (SELECT 1 FROM worker_nodes WHERE name='local-worker');
