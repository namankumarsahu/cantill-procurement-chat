ALTER TABLE policy_versions ADD COLUMN rule_restatements JSONB NOT NULL DEFAULT '[]';
ALTER TABLE policy_versions ADD COLUMN feedback_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE processing_runs ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TABLE policy_impact_previews (
 id UUID PRIMARY KEY, policy_version TEXT NOT NULL REFERENCES policy_versions(version),
 review_hash TEXT NOT NULL, run_id UUID REFERENCES processing_runs(id), run_hash TEXT,
 summary JSONB NOT NULL, actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
