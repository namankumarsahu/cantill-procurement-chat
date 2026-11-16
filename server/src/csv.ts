import { parse } from 'csv-parse/sync';
import type { PRLine } from '../../engine/src/types.js';

export function readCSV(text: string, required: string[]): Record<string, string>[] {
  let header: string[] = [];
  const records = parse(text, {
    bom: true, skip_empty_lines: true, trim: true,
    columns: (names: string[]) => {
      header = names;
      if (new Set(names).size !== names.length) throw new Error('Duplicate CSV column');
      for (const key of required) if (!names.includes(key)) throw new Error(`Missing CSV column: ${key}`);
      return names;
    },
  }) as Record<string, string>[];
  if (!header.length) throw new Error('CSV is empty');
  return records;
}
export const prColumns = ['pr_no', 'pr_line', 'created_at', 'requester', 'department', 'plant', 'item_code', 'description', 'quantity', 'uom', 'estimated_unit_price', 'need_by_date', 'urgency'] as const;
export function parsePRCSV(text: string): PRLine[] {
  return readCSV(text, [...prColumns]).map((row, i) => ({ ...Object.fromEntries(prColumns.map(c => [c, row[c]])), source_row: i + 2 }) as unknown as PRLine);
}
