USE fb_commenter;
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
  campaign_id BIGINT NOT NULL, account_id BIGINT NOT NULL, is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (campaign_id,account_id),
  CONSTRAINT fk_campaign_accounts_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_accounts_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS campaign_account_groups (
  campaign_id BIGINT NOT NULL, account_id BIGINT NOT NULL, group_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (campaign_id,account_id),
  CONSTRAINT fk_cag_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_cag_account FOREIGN KEY (account_id) REFERENCES fb_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cag_group FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE CASCADE
);
INSERT INTO comment_groups(campaign_id,name,description)
SELECT c.id,seed.name,'Nhóm gợi ý; thêm câu đã duyệt trước khi tạo lịch'
FROM campaigns c CROSS JOIN (
  SELECT 'Hỏi thông tin' AS name UNION ALL
  SELECT 'Hỏi giá & giao hàng' UNION ALL
  SELECT 'Thể hiện quan tâm'
) seed
WHERE NOT EXISTS (SELECT 1 FROM comment_groups g WHERE g.campaign_id=c.id AND g.name=seed.name);
SET @has_group_column := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='comment_templates' AND column_name='group_id');
SET @sql := IF(@has_group_column=0,'ALTER TABLE comment_templates ADD COLUMN group_id BIGINT NULL AFTER campaign_id','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
INSERT INTO comment_groups(campaign_id,name,description)
SELECT c.id,'Nội dung chung','Nhóm được tạo tự động cho nội dung cũ' FROM campaigns c
WHERE EXISTS (SELECT 1 FROM comment_templates t WHERE t.campaign_id=c.id AND t.group_id IS NULL)
AND NOT EXISTS (SELECT 1 FROM comment_groups g WHERE g.campaign_id=c.id AND g.name='Nội dung chung');
UPDATE comment_templates t JOIN comment_groups g ON g.campaign_id=t.campaign_id AND g.name='Nội dung chung'
SET t.group_id=g.id WHERE t.group_id IS NULL;
SET @has_job_group_column := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='comment_jobs' AND column_name='group_id');
SET @sql := IF(@has_job_group_column=0,'ALTER TABLE comment_jobs ADD COLUMN group_id BIGINT NULL AFTER template_id','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
UPDATE comment_jobs j JOIN comment_templates t ON t.id=j.template_id SET j.group_id=t.group_id WHERE j.group_id IS NULL;
INSERT INTO campaign_accounts(campaign_id,account_id)
SELECT DISTINCT p.campaign_id,pa.account_id FROM post_accounts pa JOIN posts p ON p.id=pa.post_id
ON DUPLICATE KEY UPDATE is_enabled=campaign_accounts.is_enabled;
INSERT INTO campaign_account_groups(campaign_id,account_id,group_id)
SELECT ca.campaign_id,ca.account_id,COALESCE(MAX(CASE WHEN g.name='Nội dung chung' THEN g.id END),MIN(g.id))
FROM campaign_accounts ca JOIN comment_groups g ON g.campaign_id=ca.campaign_id
GROUP BY ca.campaign_id,ca.account_id ON DUPLICATE KEY UPDATE group_id=campaign_account_groups.group_id;
SET @has_fk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='comment_templates' AND constraint_name='fk_templates_group');
SET @sql := IF(@has_fk=0,'ALTER TABLE comment_templates ADD CONSTRAINT fk_templates_group FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE RESTRICT','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_job_fk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='comment_jobs' AND constraint_name='fk_jobs_group');
SET @sql := IF(@has_job_fk=0,'ALTER TABLE comment_jobs ADD CONSTRAINT fk_jobs_group FOREIGN KEY (group_id) REFERENCES comment_groups(id) ON DELETE RESTRICT','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
