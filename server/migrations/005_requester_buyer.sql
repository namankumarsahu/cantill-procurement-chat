ALTER TABLE audit_events ADD COLUMN role TEXT;
CREATE SEQUENCE chat_pr_sequence;
CREATE SEQUENCE procurement_document_sequence;
CREATE TABLE chat_sessions (
 id UUID PRIMARY KEY, actor TEXT NOT NULL, import_id UUID NOT NULL REFERENCES imports(id),
 policy_snapshot JSONB NOT NULL, state JSONB NOT NULL, messages JSONB NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 0, run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL,
 created_pr_no TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement_documents (
 id UUID PRIMARY KEY, document_no TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL UNIQUE,
 run_id UUID NOT NULL REFERENCES processing_runs(id), import_id UUID NOT NULL REFERENCES imports(id),
 policy_version TEXT NOT NULL REFERENCES policy_versions(version), kind TEXT NOT NULL,
 route TEXT NOT NULL, supplier_id TEXT, plant TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE procurement_document_lines (
 document_id UUID NOT NULL REFERENCES procurement_documents(id), group_id TEXT NOT NULL,
 snapshot JSONB NOT NULL, PRIMARY KEY(document_id,group_id)
);
CREATE TABLE buyer_decisions (
 run_id UUID NOT NULL REFERENCES processing_runs(id), group_id TEXT NOT NULL,
 original JSONB NOT NULL, effective JSONB NOT NULL, comment TEXT,
 document_id UUID REFERENCES procurement_documents(id), actor TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(run_id,group_id)
);
CREATE TABLE contract_allocations (
 document_id UUID NOT NULL REFERENCES procurement_documents(id), contract_id TEXT NOT NULL,
 amount NUMERIC NOT NULL CHECK(amount>0), PRIMARY KEY(document_id,contract_id)
);
