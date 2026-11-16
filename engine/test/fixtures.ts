import seed from '../../server/policies/v5.0.json' with { type: 'json' };
import { validatePolicy } from '../src/policy.js';
import type { Contract, MasterData, PRLine } from '../src/types.js';
export const policy = () => validatePolicy(structuredClone(seed));
export function master(): MasterData {
  return {
    items: [{ item_code: 'I', description: 'Synthetic component', uom: 'NOS', category: 'Parts', item_type: 'Material', standard_price: '1' }],
    suppliers: [
      { supplier_id: 'A', name: 'Alpha', city: 'Test', categories: ['Parts'], status: 'Active', on_time_pct: 90, quality_rating: 4 },
      { supplier_id: 'B', name: 'Beta', city: 'Test', categories: ['Parts'], status: 'Active', on_time_pct: 80, quality_rating: 5 },
      { supplier_id: 'X', name: 'Blocked', city: 'Test', categories: ['Parts'], status: 'Blocked', on_time_pct: 100, quality_rating: 5 },
    ],
    plants: [{ plant: 'P', name: 'One' }, { plant: 'Q', name: 'Two' }],
    po_history: [{ po_number: 'H1', po_date: '2026-10-20', supplier_id: 'A', item_code: 'I', quantity: '1', uom: 'NOS', unit_price: '1', plant: 'P', delivered_on_time: true }],
    contracts: [],
  };
}
export function line(n = 1, overrides: Partial<PRLine> = {}): PRLine {
  return { source_row: n+1, pr_no: `TEST-${String(n).padStart(3,'0')}`, pr_line: '1', created_at: '2026-11-02 10:00', requester: 'Test', department: 'Test', plant: 'P', item_code: 'I', description: 'Synthetic component', quantity: '1', uom: 'NOS', estimated_unit_price: '', need_by_date: '2026-11-20', urgency: 'Normal', ...overrides };
}
export function contract(overrides: Partial<Contract> = {}): Contract {
  return { contract_id: 'C', supplier_id: 'A', start_date: '2026-01-01', end_date: '2026-12-31', value_cap: '100', consumed_value: '0', baseline_date: '2026-01-01', source: 'register', lines: [{ item_code: 'I', rate: '10', uom: 'NOS' }], ...overrides };
}
