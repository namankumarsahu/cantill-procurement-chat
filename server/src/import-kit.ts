import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { readCSV, parsePRCSV } from './csv.js';
import type { MasterData, Contract, ContractLine, PRLine } from '../../engine/src/types.js';

export interface SourceDocument { filename: string; sha256: string; bytes: Buffer; text: string; contract_id?:string|null }
export interface KitImport { data: MasterData; batch: PRLine[]; documents: SourceDocument[]; warnings: string[]; fingerprint: string; snapshot_date: string }
export type KitFiles = Map<string, Buffer>;
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const positive = z.string().regex(/^\d+(\.\d+)?$/).refine(v => new Decimal(v).gt(0), 'must be positive');
const nonnegative = z.string().regex(/^\d+(\.\d+)?$/);
const text = z.string().min(1);
const itemSchema = z.object({ item_code: text, description: text, uom: text, category: text, item_type: text, standard_price: positive });
const supplierSchema = z.object({ supplier_id: text, name: text, city: text, categories: z.string().transform(v => v.split(';').map(s => s.trim()).filter(Boolean)), status: z.enum(['Active', 'Blocked', 'Inactive']), on_time_pct: z.coerce.number().min(0).max(100), quality_rating: z.coerce.number().min(0).max(5) });
const historySchema = z.object({ po_number: text, po_date: z.iso.date(), supplier_id: text, item_code: text, quantity: positive, uom: text, unit_price: positive, plant: text, delivered_on_time: z.enum(['True', 'False']).transform(v => v === 'True') });
const contractSchema = z.object({ contract_id: text, supplier_id: text, start_date: z.iso.date(), end_date: z.iso.date(), value_cap: positive, consumed_value: nonnegative });
const lineSchema = z.object({ contract_id: text, item_code: text, uom: text, rate: positive });
function unique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); }
export async function readKitDirectory(root: string): Promise<KitFiles> {
  const files: KitFiles = new Map();
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name), name = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory() && ['master_data', 'contracts', 'pr_batches', 'pdf'].includes(entry.name)) await visit(path);
      else if (entry.isFile() && (/\.(csv|pdf)$/.test(name) || name === 'README.txt')) files.set(name, await readFile(path));
    }
  }
  await visit(root);
  return files;
}
export function readKitZip(bytes: Buffer): KitFiles {
  let total = 0, count = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize; count++;
    if (total > 50 * 1024 * 1024 || count > 200) throw new Error('Archive exceeds import limits');
    return /\.(csv|pdf)$|(?:^|\/)README\.txt$/.test(entry.name);
  } });
  const files: KitFiles = new Map();
  for (const [path, contents] of Object.entries(entries)) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.split('/').includes('..') || normalized.startsWith('/')) throw new Error('Unsafe archive path');
    const marker = normalized.match(/(?:^|\/)(master_data|contracts|pr_batches)\//);
    const name = marker ? normalized.slice(marker.index! + (marker[0].startsWith('/') ? 1 : 0)) : normalized.split('/').at(-1)!;
    if (files.has(name)) throw new Error(`Duplicate archive file: ${name}`);
    files.set(name, Buffer.from(contents));
  }
  return files;
}
export function snapshotFromReadme(files: KitFiles): string | undefined {
  const match = files.get('README.txt')?.toString().match(/as at\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i);
  if (!match) return;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.indexOf(match[2].toLowerCase()) + 1;
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}` : undefined;
}
export async function extractPDF(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}
export function parseContractText(source: string): Omit<Contract, 'consumed_value' | 'baseline_date' | 'source'> {
  const contract_id = source.match(/Contract No\.\s*(RC-[\w-]+)/)?.[1];
  const supplier_id = source.match(/Supplier\s+ID\s+(S\d+)/)?.[1];
  const dates = source.match(/valid from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
  const cap = source.match(/not exceed INR\s+([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(',', '');
  const lines: ContractLine[] = [...source.matchAll(/(ITM-\d+)\s+[^\n]+?\s+([A-Z]{2,5})\s+([\d,]+\.\d{2})(?=\s|$)/g)].map(m => ({ item_code: m[1], uom: m[2], rate: m[3].replaceAll(',', '') }));
  if (!contract_id || !supplier_id || !dates || !cap || !lines.length) throw new Error('Contract PDF could not be parsed completely; manual confirmation required');
  contractSchema.omit({ consumed_value: true }).parse({ contract_id, supplier_id, start_date: dates[1], end_date: dates[2], value_cap: cap });
  return { contract_id, supplier_id, start_date: dates[1], end_date: dates[2], value_cap: cap, lines };
}
export async function inspectKit(files: KitFiles, snapshotDate?: string): Promise<KitImport> {
  const snapshot_date = z.iso.date().parse(snapshotDate ?? snapshotFromReadme(files));
  const csv = (path: string, keys: string[]) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing kit file: ${path}`);
    return readCSV(bytes.toString('utf8'), keys);
  };
  const items = csv('master_data/item_master.csv', Object.keys(itemSchema.shape)).map(r => itemSchema.parse(r));
  const suppliers = csv('master_data/supplier_master.csv', Object.keys(supplierSchema.shape)).map(r => supplierSchema.parse(r));
  const plants = csv('master_data/plants.csv', ['plant', 'name']).map(r => z.object({ plant: text, name: text }).parse(r));
  const po_history = csv('master_data/po_history.csv', Object.keys(historySchema.shape)).map(r => historySchema.parse(r));
  const register = csv('contracts/contract_register.csv', Object.keys(contractSchema.shape)).map(r => contractSchema.parse(r));
  const registerLines = csv('contracts/contract_lines.csv', Object.keys(lineSchema.shape)).map(r => lineSchema.parse(r));
  const contracts: Contract[] = register.map(r => ({ ...r, source: 'register', baseline_date: snapshot_date, lines: registerLines.filter(l => l.contract_id === r.contract_id).map(({ contract_id: _, ...line }) => line) }));
  unique(items.map(r => r.item_code), 'item'); unique(suppliers.map(r => r.supplier_id), 'supplier'); unique(plants.map(r => r.plant), 'plant');
  unique(register.map(r => r.contract_id), 'contract'); unique(registerLines.map(r => `${r.contract_id}/${r.item_code}`), 'contract line'); unique(po_history.map(r => r.po_number), 'historical PO');
  const warnings: string[] = [], documents: SourceDocument[] = [];
  for (const [filename, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^contracts\/pdf\/[^/]+\.pdf$/.test(filename)) continue;
    const pdfText = await extractPDF(bytes), parsed = parseContractText(pdfText);
    documents.push({ filename, sha256: sha256(bytes), bytes, text: pdfText });
    const current = contracts.find(c => c.contract_id === parsed.contract_id);
    if (current) {
      const canonical = (lines: ContractLine[]) => JSON.stringify(lines.map(l => ({ ...l, rate: new Decimal(l.rate).toString() })).sort((a,b) => a.item_code.localeCompare(b.item_code)));
      if (current.supplier_id !== parsed.supplier_id || current.start_date !== parsed.start_date || current.end_date !== parsed.end_date || !new Decimal(current.value_cap).eq(parsed.value_cap) || canonical(current.lines) !== canonical(parsed.lines)) throw new Error(`PDF/register conflict for ${parsed.contract_id}; confirmation required`);
    } else {
      if (parsed.start_date <= snapshot_date) throw new Error(`PDF-only ${parsed.contract_id} predates snapshot; opening consumption needs confirmation`);
      contracts.push({ ...parsed, consumed_value: '0', baseline_date: parsed.start_date, source: 'pdf_only' });
      warnings.push(`${parsed.contract_id}: PDF-only binding contract imported with zero opening consumption`);
    }
  }
  unique(contracts.map(r => r.contract_id), 'contract');
  const itemMap = new Map(items.map(i => [i.item_code, i])), supplierMap = new Map(suppliers.map(s => [s.supplier_id, s]));
  for (const po of po_history) {
    if (!itemMap.has(po.item_code) || !supplierMap.has(po.supplier_id) || !plants.some(p => p.plant === po.plant) || itemMap.get(po.item_code)!.uom !== po.uom) throw new Error(`Invalid historical PO reference/UOM: ${po.po_number}`);
  }
  const nonactive = po_history.filter(po => supplierMap.get(po.supplier_id)!.status !== 'Active').length;
  if (nonactive) warnings.push(`${nonactive} historical POs have currently nonactive suppliers; retained only as historical evidence`);
  for (const line of registerLines) if (!contracts.some(c => c.contract_id === line.contract_id)) throw new Error(`Orphan contract line ${line.contract_id}`);
  for (const c of contracts) {
    if (!supplierMap.has(c.supplier_id) || c.end_date < c.start_date || !c.lines.length) throw new Error(`Invalid contract ${c.contract_id}`);
    unique(c.lines.map(l => l.item_code), 'PDF contract item');
    for (const l of c.lines) if (!itemMap.has(l.item_code) || itemMap.get(l.item_code)!.uom !== l.uom || !positive.safeParse(l.rate).success) throw new Error(`Invalid contract item/UOM/rate: ${c.contract_id}/${l.item_code}`);
    if (new Decimal(c.consumed_value).gt(c.value_cap)) warnings.push(`${c.contract_id}: opening consumption exceeds cap; contract unusable`);
    if (supplierMap.get(c.supplier_id)!.status !== 'Active') warnings.push(`${c.contract_id}: supplier is not Active; excluded from applicability`);
  }
  const batchBytes = files.get('pr_batches/sample_pr_batch.csv');
  const batch = batchBytes ? parsePRCSV(batchBytes.toString()) : [];
  const data = { items, suppliers, plants, po_history, contracts };
  const fingerprint = sha256(JSON.stringify({ data, batch, documents: documents.map(d => d.sha256), snapshot_date }));
  return { data, batch, documents, warnings, fingerprint, snapshot_date };
}
