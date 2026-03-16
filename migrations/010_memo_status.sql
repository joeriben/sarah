-- Memo lifecycle status
-- Valid values: active, presented, discussed, acknowledged, promoted, dismissed
-- AI-authored memos start as 'presented'; researcher memos as 'active'
ALTER TABLE memo_content ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
