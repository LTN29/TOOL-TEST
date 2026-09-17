USE fb_commenter;

CREATE TABLE IF NOT EXISTS device_pairing_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  key_hash CHAR(64) NOT NULL UNIQUE,
  issued_by_worker_id BIGINT NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pairing_issuer FOREIGN KEY (issued_by_worker_id) REFERENCES worker_nodes(id) ON DELETE CASCADE,
  INDEX idx_pairing_expiry (expires_at,consumed_at)
);
