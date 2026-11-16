ALTER TABLE contracts DROP CONSTRAINT contracts_source_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_source_check CHECK (source IN ('register','pdf_only','manual'));
CREATE TABLE contract_drafts (
 id UUID PRIMARY KEY, base_import_id UUID NOT NULL REFERENCES imports(id),
 fields JSONB NOT NULL, method TEXT NOT NULL, notes JSONB NOT NULL,
 filename TEXT, sha256 TEXT, bytes BYTEA, source_text TEXT,
 actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 confirmed_import_id UUID REFERENCES imports(id), confirmed_by TEXT,
 confirmed_at TIMESTAMPTZ, confirmed_fields JSONB
);
