import { stringify } from 'csv-stringify/sync';
import { exportColumns, type ExportRow } from '../../engine/src/process.js';

export function decisionsCSV(rows: ExportRow[]): string {
  // Keep formula-like requester text inert when the CSV is opened in a spreadsheet.
  return stringify(rows, { header: true, columns: [...exportColumns], record_delimiter: '\r\n', escape_formulas: true });
}
