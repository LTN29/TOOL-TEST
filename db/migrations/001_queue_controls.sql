USE fb_commenter;

-- Migration an toàn: chỉ mở rộng enum, không xóa hoặc đổi tên dữ liệu hiện có.
ALTER TABLE comment_jobs
  MODIFY COLUMN status ENUM(
    'PENDING','RUNNING','SUCCESS','FAILED','UNKNOWN','RETRY_DUE','SKIPPED','PAUSED','CANCELLED'
  ) NOT NULL DEFAULT 'PENDING';
