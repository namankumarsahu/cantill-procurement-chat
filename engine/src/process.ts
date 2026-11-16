import { Decimal } from 'decimal.js';
import type { Contract, Item, MasterData, PRLine } from './types.js';
import { validatePolicy, parameter, resolveOperand, type Policy, type Condition, type Scalar } from './policy.js';
import { matchDescription } from './matching.js';
import { businessDate, compareText, daysBetween, HOUR_MS, inHistory, instant, validDate } from './dates.js';
import { latestPO, rankSuppliers, suggestSuppliers, type RankedSupplier } from './ranking.js';

export const exportColumns = ['pr_no', 'pr_line', 'resolved_item_code', 'group_id', 'po_id', 'decision', 'route', 'supplier_id', 'unit_price', 'group_value_inr', 'suggested_supplier_ids', 'policy_version', 'reason'] as const;
export type ExportRow = Record<typeof exportColumns[number], string>;
interface Resolved { line: PRLine; item?: Item; timestamp: number; date: string }
export interface Requirement {
  group_id: string; resolved_item_code: string; plant: string; first_created_at: string;
  requirement_date: string; quantity: string; is_emergency: boolean; lines: PRLine[];
  decision: 'PO' | 'SOURCING_REQUEST'; route: string; supplier_id: string; unit_price: string;
  group_value_inr: string; suggested_supplier_ids: string[]; po_id: string; reason: string;
  policy_version: string; clause: string; contract_id: string | null;
  valuation: { unit_price: string; source: string }; rankings: RankedSupplier[];
  flags: string[]; eligibility_po_numbers: string[];
}
export interface POProposal { po_id: string; supplier_id: string; plant: string; route: string; first_created_at: string; group_ids: string[] }
export interface BatchResult { as_of_date: string; policy_version: string; requirements: Requirement[]; rows: ExportRow[]; purchase_orders: POProposal[]; contract_consumed: Record<string, string> }
const positiveDecimal = (v: string) => /^\d+(\.\d+)?$/.test(v) && new Decimal(v).gt(0);
function compareLines(a: PRLine, b: PRLine): number {
  return instant(a.created_at)-instant(b.created_at) || compareText(a.pr_no,b.pr_no) || Number(a.pr_line)-Number(b.pr_line) || a.source_row-b.source_row;
}
export function testCondition(c: Condition, facts: Record<string, Scalar | Decimal>, p: Policy): boolean {
  if ('all' in c) return c.all.every(child => testCondition(child, facts, p));
  if ('any' in c) return c.any.some(child => testCondition(child, facts, p));
  if ('not' in c) return !testCondition(c.not, facts, p);
  const left = facts[c.fact], right = resolveOperand(p,c.value);
  const equal = (v: Scalar) => left instanceof Decimal ? left.eq(String(v)) : left === v;
  switch (c.operator) {
    case 'eq': return equal(right as Scalar);
    case 'ne': return !equal(right as Scalar);
    case 'in': return (right as Scalar[]).some(equal);
    case 'gt': return new Decimal(String(left)).gt(right as number);
    case 'gte': return new Decimal(String(left)).gte(right as number);
    case 'lt': return new Decimal(String(left)).lt(right as number);
    case 'lte': return new Decimal(String(left)).lte(right as number);
    case 'between': { const [min,max] = right as number[]; return new Decimal(String(left)).gte(min) && new Decimal(String(left)).lte(max); }
  }
}
function selectContract(group: Resolved[], data: MasterData, consumed: Map<string, Decimal>) {
  const anchor = group[0], qty = group.reduce((n,r) => n.plus(r.line.quantity), new Decimal(0));
  const applicable = data.contracts.filter(c => c.start_date <= anchor.date && c.end_date >= anchor.date && data.suppliers.some(s => s.supplier_id === c.supplier_id && s.status === 'Active'))
    .flatMap(c => c.lines.filter(l => l.item_code === anchor.item!.item_code && l.uom === anchor.item!.uom).map(l => ({ contract: c, rate: new Decimal(l.rate) })))
    .sort((a,b) => a.rate.comparedTo(b.rate) || compareText(a.contract.contract_id,b.contract.contract_id) || compareText(a.contract.supplier_id,b.contract.supplier_id));
  for (const {contract} of applicable) if (anchor.date < contract.baseline_date) throw new Error(`Cannot reconstruct ${contract.contract_id} consumption before ${contract.baseline_date}`);
  const usable = applicable.find(({contract,rate}) => consumed.get(contract.contract_id)!.plus(qty.times(rate).toDecimalPlaces(2,Decimal.ROUND_HALF_UP)).lte(contract.value_cap));
  return { usable, valuation: usable ?? applicable[0] };
}
export function batchAsOf(lines: PRLine[], requested?: string): string {
  const dates = lines.map(l => instant(l.created_at)).filter(Number.isFinite).map(businessDate).sort(compareText);
  const as_of_date = requested ?? dates.at(-1);
  if (!as_of_date || !validDate(as_of_date)) throw new Error('Supply a valid as_of_date when no PR creation date is valid');
  return as_of_date;
}
export function processBatch(inputPolicy: Policy, data: MasterData, lines: PRLine[], options: { as_of_date?: string; preview_draft?: boolean } = {}): BatchResult {
  const policy = validatePolicy(inputPolicy);
  if (new Set(lines.map(l => l.source_row)).size !== lines.length) throw new Error('source_row must uniquely identify each input row');
  const as_of_date = batchAsOf(lines,options.as_of_date);
  if ((policy.status === 'draft' && !options.preview_draft) || policy.effective_date > as_of_date) throw new Error('An approved, effective policy is required');
  const rejected = new Map<number, { reason: string; code: string }>(), resolved: Resolved[] = [];
  const copies = new Map<string, PRLine[]>();
  for (const line of lines) { const key = JSON.stringify([line.pr_no,line.pr_line]); copies.set(key,[...(copies.get(key) ?? []),line]); }
  const duplicateIssues = new Map<number,string>();
  for (const same of copies.values()) if (same.length > 1) {
    const canonical = (row: PRLine) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'source_row')));
    const conflict = same.some(r => canonical(r) !== canonical(same[0]));
    for (const r of conflict ? same : same.slice(1)) duplicateIssues.set(r.source_row, conflict ? 'Conflicting duplicate PR line; correct all copies' : 'Duplicate PR line; first identical occurrence retained');
  }
  for (const line of lines) {
    const errors: string[] = [], timestamp = instant(line.created_at), date = Number.isFinite(timestamp) ? businessDate(timestamp) : '';
    let item: Item | undefined;
    if (!line.pr_no || !/^[1-9]\d*$/.test(line.pr_line)) errors.push('Missing PR number or invalid PR line');
    if (duplicateIssues.has(line.source_row)) errors.push(duplicateIssues.get(line.source_row)!);
    if (!data.plants.some(p => p.plant === line.plant)) errors.push(`Unknown or missing plant: ${line.plant || '(empty)'}`);
    if (!positiveDecimal(line.quantity)) errors.push('Quantity must be a positive number');
    if (!Number.isFinite(timestamp)) errors.push('Invalid creation timestamp');
    if (!validDate(line.need_by_date)) errors.push('Invalid need-by date');
    else if (date && line.need_by_date < date) errors.push('Need-by date is before creation');
    if (date > as_of_date) errors.push(`Creation date is after as_of_date ${as_of_date}`);
    if (!['Normal','Emergency'].includes(line.urgency)) errors.push('Urgency must be Normal or Emergency');
    if (!line.description.trim() || !line.uom.trim()) errors.push('Description and UOM are required');
    if (line.item_code) {
      item = data.items.find(i => i.item_code === line.item_code);
      if (!item) errors.push(`Unknown explicit item code: ${line.item_code}`);
    } else if (line.description.trim()) {
      const match = matchDescription(line.description,data.items,policy);
      item = match.item;
      if (match.status === 'ambiguous') errors.push(`Ambiguous item; confirm a candidate: ${match.candidates.map(c => c.item_code).join('; ')}`);
    }
    if (item && item.uom !== line.uom) errors.push(`UOM mismatch: expected ${item.uom}, received ${line.uom}`);
    if (!item && !line.item_code && !positiveDecimal(line.estimated_unit_price)) errors.push('New item requires a positive estimated unit price');
    if (errors.length) rejected.set(line.source_row,{ reason: errors.join('. '), code: item?.item_code ?? (line.item_code ? '' : 'NEW') });
    else resolved.push({line,item,timestamp,date});
  }
  resolved.sort((a,b) => compareLines(a.line,b.line));
  const groups: Resolved[][] = [];
  for (const r of resolved) {
    const group = r.item && groups.find(g => g[0].item?.item_code === r.item!.item_code && g[0].line.plant === r.line.plant && daysBetween(r.date,g[0].date) <= parameter(policy,'clubbing_created_days') && Math.abs(daysBetween(r.line.need_by_date,g[0].line.need_by_date)) <= parameter(policy,'clubbing_need_by_days'));
    if (group) group.push(r); else groups.push([r]);
  }
  const consumed = new Map(data.contracts.map(c => [c.contract_id,new Decimal(c.consumed_value)]));
  const requirements: Requirement[] = groups.map((group,index) => {
    const first = group[0], item = first.item, date = first.date;
    const quantity = group.reduce((n,r) => n.plus(r.line.quantity),new Decimal(0)), emergency = group.some(r => r.line.urgency === 'Emergency');
    const contract = item ? selectContract(group,data,consumed) : undefined;
    const previous = item ? latestPO(data.po_history.filter(po => po.item_code === item.item_code && inHistory(po.po_date,date,parameter(policy,'valuation_history_days')))) : undefined;
    const valuationPrice = new Decimal(contract?.valuation?.rate ?? previous?.unit_price ?? item?.standard_price ?? first.line.estimated_unit_price);
    const value = quantity.times(valuationPrice).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
    const valuationSource = contract?.valuation ? `contract ${contract.valuation.contract.contract_id}${contract.usable ? '' : ' (ceiling insufficient)'}` : previous ? `PO ${previous.po_number} (${previous.po_date})` : item ? 'item master standard price' : 'requester estimated unit price';
    const sourceValues = {
      'requirement.is_new': !item, 'item.item_type': item?.item_type ?? '', 'item.category': item?.category ?? '',
      'requirement.plant': first.line.plant, 'requirement.is_emergency': emergency,
      'requirement.valuation_inr': value, 'contract_selection.has_usable_contract': !!contract?.usable,
      'requirement.quantity': quantity, 'requirement.line_count': group.length,
      'requirement.requirement_date': date, 'requirement.department': first.line.department,
      'requirement.requester': first.line.requester, 'item.uom': item?.uom ?? first.line.uom,
      'item.description': item?.description ?? first.line.description,
      'item.standard_price': new Decimal(item?.standard_price ?? 0),
    };
    const eligibility = new Set<string>();
    const facts = Object.fromEntries(Object.entries(policy.fact_registry).map(([name,f]) => {
      if ('source' in f) return [name,sourceValues[f.source]];
      const purchases = data.po_history.filter(po => po.item_code === item?.item_code && inHistory(po.po_date,date,Number(resolveOperand(policy,f.args.history_days))) && data.suppliers.some(s => s.supplier_id === po.supplier_id && s.status === 'Active'));
      purchases.forEach(po => eligibility.add(po.po_number));
      return [name,purchases.length > 0];
    }));
    const rule = [...policy.rules].sort((a,b) => a.order-b.order).find(r => testCondition(r.when,facts,policy));
    if (!rule) throw new Error('No matching policy rule');
    const outcome = policy.route_registry[rule.outcome.route];
    const rankings = item ? rankSuppliers(item,date,data,policy) : [];
    let supplier_id = '', unit_price = '', contract_id: string | null = null, reference = valuationSource;
    if (outcome.supplier_strategy === 'selected_contract') {
      if (!contract?.usable) throw new Error(`Rule ${rule.id} requires a usable contract`);
      const selected = contract.usable;
      supplier_id = selected.contract.supplier_id; unit_price = selected.rate.toString(); contract_id = selected.contract.contract_id;
      consumed.set(contract_id,consumed.get(contract_id)!.plus(quantity.times(selected.rate).toDecimalPlaces(2,Decimal.ROUND_HALF_UP)));
      reference = `contract ${contract_id}`;
    } else if (outcome.supplier_strategy === 'first_preferred') {
      if (!rankings.length) throw new Error(`Rule ${rule.id} requires an eligible preferred supplier`);
      supplier_id = rankings[0].supplier_id; unit_price = rankings[0].reference_price; reference = rankings[0].reference_source;
    }
    if (supplier_id && !data.suppliers.some(s => s.supplier_id === supplier_id && s.status === 'Active')) throw new Error('Nonactive supplier cannot receive a PO');
    const count = Number(resolveOperand(policy,outcome.suggest_count));
    const suggestions = item && outcome.supplier_strategy === 'preferred_then_category' ? suggestSuppliers(item,rankings,count,data,policy) : [];
    const flags = [...outcome.flags];
    if (outcome.supplier_strategy === 'preferred_then_category' && suggestions.length < count) flags.push('supplier_shortage');
    const reason = `Policy ${policy.version}, clause ${rule.clause} (${rule.id}): ${rule.outcome.route}. Requirement ${quantity.toString()} × INR ${valuationPrice.toString()} = INR ${value.toFixed(2)}, valued from ${valuationSource}.${supplier_id ? ` Supplier ${supplier_id} at INR ${unit_price}, relying on ${reference}.` : ''}${flags.includes('supplier_shortage') ? ` Only ${suggestions.length} eligible suppliers available.` : ''}`;
    return { group_id: `REQ-${String(index+1).padStart(4,'0')}`, resolved_item_code: item?.item_code ?? 'NEW', plant: first.line.plant,
      first_created_at: first.line.created_at, requirement_date: date, quantity: quantity.toString(), is_emergency: emergency, lines: group.map(r => r.line),
      decision: outcome.decision, route: rule.outcome.route, supplier_id, unit_price, group_value_inr: value.toFixed(2), suggested_supplier_ids: suggestions, po_id: '', reason,
      policy_version: policy.version, clause: rule.clause, contract_id, valuation: { unit_price: valuationPrice.toString(), source: valuationSource }, rankings, flags, eligibility_po_numbers: [...eligibility].sort(compareText) };
  });
  const purchase_orders = consolidatePOs(requirements,policy);
  const byRow = new Map(requirements.flatMap(req => req.lines.map(line => [line.source_row,req] as const)));
  const rows = lines.map(line => {
    const req = byRow.get(line.source_row), reject = rejected.get(line.source_row);
    return { pr_no: line.pr_no, pr_line: line.pr_line, resolved_item_code: req?.resolved_item_code ?? reject?.code ?? '', group_id: req?.group_id ?? '', po_id: req?.po_id ?? '', decision: req?.decision ?? 'SOURCING_REQUEST', route: req?.route ?? 'NOT_PROCESSED', supplier_id: req?.supplier_id ?? '', unit_price: req?.unit_price ?? '', group_value_inr: req?.group_value_inr ?? '', suggested_supplier_ids: req?.suggested_supplier_ids.join(';') ?? '', policy_version: policy.version, reason: req?.reason ?? reject?.reason ?? 'Not processed' };
  });
  return { as_of_date, policy_version: policy.version, requirements, rows, purchase_orders, contract_consumed: Object.fromEntries([...consumed].map(([id,v]) => [id,v.toFixed(2)])) };
}

export function consolidatePOs(requirements:Requirement[],policy:Policy):POProposal[]{
  const purchase_orders: POProposal[] = [];
  for (const req of requirements.filter(r => r.decision === 'PO')) {
    let po = purchase_orders.find(p => p.supplier_id === req.supplier_id && p.plant === req.plant && p.route === req.route && instant(req.first_created_at)-instant(p.first_created_at) <= parameter(policy,'consolidation_hours')*HOUR_MS);
    if (!po) { po = { po_id: `PO-${String(purchase_orders.length+1).padStart(4,'0')}`, supplier_id: req.supplier_id, plant: req.plant, route: req.route, first_created_at: req.first_created_at, group_ids: [] }; purchase_orders.push(po); }
    po.group_ids.push(req.group_id); req.po_id = po.po_id;
  }
  return purchase_orders;
}
