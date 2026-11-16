ALTER TABLE policy_versions ADD COLUMN base_version TEXT REFERENCES policy_versions(version);
ALTER TABLE policy_versions ADD COLUMN base_hash TEXT;
ALTER TABLE policy_versions ADD COLUMN source_filename TEXT;
ALTER TABLE policy_versions ADD COLUMN source_bytes BYTEA;

ALTER TABLE batches ADD COLUMN content_hash TEXT;
UPDATE batches b SET content_hash=(
 SELECT encode(sha256(convert_to(jsonb_agg(raw ORDER BY source_row)::text,'UTF8')),'hex')
 FROM pr_lines WHERE batch_id=b.id
);
ALTER TABLE processing_runs ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT true;
-- Merge legacy duplicate uploads logically; keep their raw rows and run history.
WITH identities AS (
 SELECT id,first_value(id) OVER(PARTITION BY content_hash ORDER BY created_at,id) canonical
 FROM batches WHERE content_hash IS NOT NULL
)
UPDATE processing_runs r SET batch_id=i.canonical FROM identities i WHERE r.batch_id=i.id;
WITH ordered AS (
 SELECT id,row_number() OVER(PARTITION BY batch_id ORDER BY created_at DESC,id DESC) n FROM processing_runs
)
UPDATE processing_runs r SET is_current=false FROM ordered o WHERE r.id=o.id AND o.n>1;
WITH ordered AS (
 SELECT id,row_number() OVER(PARTITION BY content_hash ORDER BY created_at,id) n FROM batches WHERE content_hash IS NOT NULL
)
UPDATE batches b SET content_hash=NULL FROM ordered o WHERE b.id=o.id AND o.n>1;
CREATE UNIQUE INDEX batches_content_hash ON batches(content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX current_run_per_batch ON processing_runs(batch_id) WHERE is_current;
