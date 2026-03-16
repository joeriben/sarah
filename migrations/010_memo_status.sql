-- Memo lifecycle status
ALTER TABLE memo_content ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
-- AI-authored memos start as 'presented'; researcher memos as 'active'
-- Valid values: active, presented, discussed, acknowledged, promoted, dismissed
