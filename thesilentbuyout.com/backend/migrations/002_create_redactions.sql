-- Migration: Create redactions table to store submitted redacted documents
CREATE TABLE IF NOT EXISTS redactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user VARCHAR(128) DEFAULT 'anonymous',
  doc_text TEXT NOT NULL,
  redacted_terms JSON NULL,
  source_event INT NULL,
  notes TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_redactions_created_at ON redactions (created_at);
