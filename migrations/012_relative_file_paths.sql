-- Make document file paths relative (portable across machines)
-- Strips absolute prefix, keeps just files/filename.ext

-- file_path: /home/.../uploads/{pid}/uuid.ext → files/uuid.ext
UPDATE document_content
SET file_path = 'files/' || substring(file_path from '[^/]+$')
WHERE file_path LIKE '/%';

-- thumbnail_path: same treatment
UPDATE document_content
SET thumbnail_path = 'files/' || substring(thumbnail_path from '[^/]+$')
WHERE thumbnail_path IS NOT NULL AND thumbnail_path LIKE '/%';
