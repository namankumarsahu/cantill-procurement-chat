CREATE TABLE processing_runs (
  id UUID PRIMARY KEY, batch_id UUID NOT NULL REFERENCES batches(id),
  import_id UUID NOT NULL REFERENCES imports(id), policy_version TEXT NOT NULL REFERENCES policy_versions(version),
  as_of_date DATE NOT NULL, policy_snapshot JSONB NOT NULL, result JSONB NOT NULL,
  actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
