import { Decimal } from 'decimal.js';
import type { BatchResult, ExportRow } from '../src/process.js';
export interface WorkedCase { number:number; name:string; pr:number; route:string; value:string; supplier?:string; price?:string; suggestions?:string; contract?:string }
export const workedCases: WorkedCase[] = [
  { number:1,name:'Contract PO',pr:19,route:'CONTRACT_PO',value:'137530.65',supplier:'S001',price:'9168.71',contract:'RC-2025-011' },
  { number:2,name:'PDF-only contract',pr:45,route:'CONTRACT_PO',value:'26829.11',supplier:'S021',price:'2439.01',contract:'RC-2026-031' },
  { number:3,name:'Exhausted contract ceiling',pr:4,route:'RFQ',value:'220255.60',suggestions:'S014;S013;S016' },
  { number:4,name:'Lowest contract with sufficient ceiling',pr:34,route:'CONTRACT_PO',value:'32546.60',supplier:'S007',price:'7.06',contract:'RC-2026-013' },
  { number:5,name:'Split requests clubbed',pr:146,route:'SPOT_PO',value:'126471.60',supplier:'S024',price:'166.41' },
  { number:6,name:'Different plants remain separate',pr:106,route:'SPOT_PO',value:'156170.30',supplier:'S027',price:'21.59' },
  { number:7,name:'Free-text hydraulic hose',pr:88,route:'SPOT_PO',value:'97955.00',supplier:'S023',price:'391.82' },
  { number:8,name:'Emergency PO',pr:59,route:'EMERGENCY_PO',value:'253184.40',supplier:'S014',price:'106.38' },
  { number:9,name:'RFQ above spot limit',pr:89,route:'RFQ',value:'336562.15',suggestions:'S043;S044;S042' },
  { number:10,name:'RFQ without active purchase history',pr:50,route:'RFQ',value:'80300.00',suggestions:'S003;S002;S005' },
  { number:11,name:'RFP with supplier shortage',pr:100,route:'RFP',value:'2070780.00',suggestions:'S020;S017;S019;S018' },
  { number:12,name:'Capex before other rules',pr:47,route:'CAPEX_SOURCING',value:'6036704.08',suggestions:'S045;S047;S020;S048;S046' },
  { number:13,name:'New item sourcing',pr:170,route:'NEW_ITEM_SOURCING',value:'141100.00',suggestions:'' },
  { number:14,name:'Multiple requirements on one PO',pr:31,route:'CONTRACT_PO',value:'23227.40',supplier:'S007',price:'7.06',contract:'RC-2026-013' },
];
export function sampleRow(result: BatchResult, number: number): ExportRow {
  const row=result.rows.find(r=>r.pr_no===`PR-26-${String(number).padStart(5,'0')}` && r.pr_line==='1');
  if (!row) throw new Error(`Missing worked-example row ${number}`);
  return row;
}
export function checkWorked(result: BatchResult, c: WorkedCase): string[] {
  const r=sampleRow(result,c.pr), errors:string[]=[];
  for (const [key,expected] of Object.entries({ route:c.route,group_value_inr:c.value,...(c.supplier?{ supplier_id:c.supplier }:{}),...(c.price?{ unit_price:c.price }:{}),...(c.suggestions!==undefined?{ suggested_supplier_ids:c.suggestions }:{}) })) {
    if (r[key as keyof ExportRow]!==expected) errors.push(`${key}: expected ${expected}, received ${r[key as keyof ExportRow]}`);
  }
  const req=result.requirements.find(q=>q.group_id===r.group_id)!;
  if (c.contract && req.contract_id!==c.contract) errors.push('Incorrect contract');
  if (!r.reason.includes(`clause ${req.clause}`) || r.policy_version!=='5.0') errors.push('Missing policy/clause provenance');
  const sameGroup=(ids:number[])=>ids.every(id=>sampleRow(result,id).group_id===r.group_id);
  if (c.number===3 && !sameGroup([4,26])) errors.push('Bearing requests not clubbed');
  if (c.number===4 && !sameGroup([34,32])) errors.push('Bolt requests not clubbed');
  if (c.number===5 && !sameGroup([146,144,145])) errors.push('Split oil requests not clubbed');
  if (c.number===6 && (sampleRow(result,103).group_id===r.group_id || sampleRow(result,103).route!=='SPOT_PO' || sampleRow(result,103).group_value_inr!=='137311.20')) errors.push('Different-plant request not evaluated separately');
  if (c.number===7 && r.resolved_item_code!=='ITM-1035') errors.push('Incorrect free-text item match');
  if (c.number===11 && !req.flags.includes('supplier_shortage')) errors.push('Missing shortage explanation');
  if (c.number===13 && (r.resolved_item_code!=='NEW' || req.lines.length!==1)) errors.push('NEW item clubbed or invented');
  if (c.number===14 && (!sameGroup([31,35]) || sampleRow(result,34).group_id===r.group_id || ![31,35,34,32].every(id=>sampleRow(result,id).po_id===r.po_id))) errors.push('Incorrect PO consolidation');
  return errors;
}
export const wholeRupees=(value:string):string=>new Decimal(value).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toString();
