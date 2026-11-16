import { stringify } from 'csv-stringify/sync';
import { Decimal } from 'decimal.js';
import { exportColumns, type ExportRow } from '../../engine/src/process.js';

export function decisionsCSV(rows: ExportRow[]): string {
  const exportedRows = rows.map(row => ({
    ...row,
    group_value_inr: row.group_value_inr === '' ? '' : new Decimal(row.group_value_inr).toFixed(0, Decimal.ROUND_HALF_UP),
  }));
  // Keep formula-like requester text inert when the CSV is opened in a spreadsheet.
  return stringify(exportedRows, { header: true, columns: [...exportColumns], record_delimiter: '\r\n', escape_formulas: true });
}
