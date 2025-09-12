-- Migration: Add story structure fields to events table (non-destructive, nullable)
ALTER TABLE events
  ADD COLUMN chapter INT NULL AFTER id,
  ADD COLUMN scene INT NULL AFTER chapter,
  ADD COLUMN source_start INT NULL AFTER scene,
  ADD COLUMN source_end INT NULL AFTER source_start,
  ADD COLUMN source_hash VARCHAR(64) NULL AFTER source_end,
  ADD COLUMN revision INT NOT NULL DEFAULT 1 AFTER source_hash,
  ADD COLUMN tags JSON NULL AFTER misc_data;

-- Index to accelerate chapter ordering queries
CREATE INDEX idx_events_chapter_order ON events (chapter, event_order);
CREATE INDEX idx_events_source_hash ON events (source_hash);
