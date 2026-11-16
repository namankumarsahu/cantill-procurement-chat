CREATE TABLE imports (
  id UUID PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
  snapshot_date DATE NOT NULL, actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), counts JSONB NOT NULL, warnings JSONB NOT NULL
);
CREATE TABLE plants (
  import_id UUID NOT NULL REFERENCES imports(id), plant TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY(import_id, plant)
);
CREATE TABLE items (
  import_id UUID NOT NULL REFERENCES imports(id), item_code TEXT NOT NULL, description TEXT NOT NULL,
  uom TEXT NOT NULL, category TEXT NOT NULL, item_type TEXT NOT NULL,
  standard_price NUMERIC NOT NULL CHECK (standard_price > 0), PRIMARY KEY(import_id, item_code)
);
CREATE TABLE suppliers (
  import_id UUID NOT NULL REFERENCES imports(id), supplier_id TEXT NOT NULL, name TEXT NOT NULL,
  city TEXT NOT NULL, categories TEXT[] NOT NULL, status TEXT NOT NULL CHECK (status IN ('Active','Blocked','Inactive')),
  on_time_pct NUMERIC NOT NULL CHECK (on_time_pct BETWEEN 0 AND 100),
  quality_rating NUMERIC NOT NULL CHECK (quality_rating BETWEEN 0 AND 5), PRIMARY KEY(import_id, supplier_id)
);
CREATE TABLE po_history (
  import_id UUID NOT NULL REFERENCES imports(id), po_number TEXT NOT NULL, po_date DATE NOT NULL,
  supplier_id TEXT NOT NULL, item_code TEXT NOT NULL, quantity NUMERIC NOT NULL CHECK (quantity > 0),
  uom TEXT NOT NULL, unit_price NUMERIC NOT NULL CHECK (unit_price > 0), plant TEXT NOT NULL,
  delivered_on_time BOOLEAN NOT NULL, PRIMARY KEY(import_id, po_number),
  FOREIGN KEY(import_id,supplier_id) REFERENCES suppliers(import_id,supplier_id),
  FOREIGN KEY(import_id,item_code) REFERENCES items(import_id,item_code),
  FOREIGN KEY(import_id,plant) REFERENCES plants(import_id,plant)
);
CREATE INDEX history_item_date ON po_history(import_id,item_code,po_date);
CREATE TABLE contracts (
  import_id UUID NOT NULL REFERENCES imports(id), contract_id TEXT NOT NULL, supplier_id TEXT NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL CHECK (end_date >= start_date),
  value_cap NUMERIC NOT NULL CHECK (value_cap > 0), consumed_value NUMERIC NOT NULL CHECK (consumed_value >= 0),
  baseline_date DATE NOT NULL, source TEXT NOT NULL CHECK (source IN ('register','pdf_only')),
  PRIMARY KEY(import_id,contract_id), FOREIGN KEY(import_id,supplier_id) REFERENCES suppliers(import_id,supplier_id)
);
CREATE TABLE contract_lines (
  import_id UUID NOT NULL, contract_id TEXT NOT NULL, item_code TEXT NOT NULL, uom TEXT NOT NULL,
  rate NUMERIC NOT NULL CHECK (rate > 0), PRIMARY KEY(import_id,contract_id,item_code),
  FOREIGN KEY(import_id,contract_id) REFERENCES contracts(import_id,contract_id),
  FOREIGN KEY(import_id,item_code) REFERENCES items(import_id,item_code)
);
CREATE TABLE source_documents (
  import_id UUID NOT NULL REFERENCES imports(id), filename TEXT NOT NULL, sha256 TEXT NOT NULL,
  bytes BYTEA NOT NULL, source_text TEXT NOT NULL, PRIMARY KEY(import_id,filename)
);
CREATE TABLE policy_versions (
  version TEXT PRIMARY KEY, effective_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','superseded')),
  document JSONB NOT NULL, created_by TEXT NOT NULL, approved_by TEXT,
  approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE batches (
  id UUID PRIMARY KEY, import_id UUID NOT NULL REFERENCES imports(id), filename TEXT NOT NULL,
  actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pr_lines (
  batch_id UUID NOT NULL REFERENCES batches(id), source_row INTEGER NOT NULL,
  raw JSONB NOT NULL, PRIMARY KEY(batch_id,source_row)
);
CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(), before JSONB, after JSONB NOT NULL
);
