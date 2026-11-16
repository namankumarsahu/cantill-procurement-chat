import { Decimal } from 'decimal.js';
import type { Contract, HistoryPO, Item, MasterData } from './types.js';
import { parameter, type Policy } from './policy.js';
import { compareText, daysBetween, inHistory } from './dates.js';

export interface RankedSupplier {
  supplier_id: string; rank: number; score: number; reference_price: string; reference_source: string;
  factors: { frequency: number; recency: number; contract: number; on_time: number; quality: number };
  contributions: Record<string, number>; po_count: number; latest_po_date: string | null;
}
export const latestPO = (purchases: HistoryPO[]): HistoryPO | undefined => [...purchases].sort((a,b) => compareText(b.po_date, a.po_date) || compareText(b.po_number, a.po_number))[0];
export function rankSuppliers(item: Item, date: string, data: MasterData, policy: Policy): RankedSupplier[] {
  const purchases = data.po_history.filter(po => po.item_code === item.item_code && inHistory(po.po_date, date, parameter(policy, 'preferred_history_days')));
  const started = data.contracts.filter(c => c.start_date <= date && c.lines.some(l => l.item_code === item.item_code));
  const eligible = data.suppliers.filter(s => s.status === 'Active' && (purchases.some(po => po.supplier_id === s.supplier_id) || started.some(c => c.supplier_id === s.supplier_id)));
  const maxCount = Math.max(0, ...eligible.map(s => purchases.filter(po => po.supplier_id === s.supplier_id).length));
  const rows = eligible.map(s => {
    const pos = purchases.filter(po => po.supplier_id === s.supplier_id), latest = latestPO(pos);
    const contracts: Contract[] = started.filter(c => c.supplier_id === s.supplier_id).sort((a,b) => compareText(b.start_date, a.start_date) || compareText(a.contract_id, b.contract_id));
    const contract = contracts[0], age = latest ? daysBetween(date, latest.po_date) : Infinity;
    const factors = {
      frequency: maxCount ? pos.length / maxCount : 0,
      recency: policy.ranking.recency_bands.find(b => age <= b.max_days)?.score ?? policy.ranking.older_recency_score,
      contract: contract ? 1 : 0, on_time: s.on_time_pct / policy.ranking.on_time_scale, quality: s.quality_rating / policy.ranking.quality_scale,
    };
    const contributions = Object.fromEntries(Object.entries(factors).map(([name, value]) => [name, value * policy.ranking.weights[name as keyof typeof factors]]));
    return { supplier_id: s.supplier_id, rank: 0, score: Object.values(contributions).reduce((a,b) => a+b, 0),
      reference_price: new Decimal(latest?.unit_price ?? contract.lines.find(l => l.item_code === item.item_code)!.rate).toString(),
      reference_source: latest ? `PO ${latest.po_number} (${latest.po_date})` : `contract ${contract.contract_id}`,
      factors, contributions, po_count: pos.length, latest_po_date: latest?.po_date ?? null };
  });
  return rows.sort((a,b) => b.score-a.score || compareText(a.supplier_id, b.supplier_id)).map((r,i) => ({ ...r, rank: i+1 }));
}
export function suggestSuppliers(item: Item, rankings: RankedSupplier[], count: number, data: MasterData, policy: Policy): string[] {
  const preferred = rankings.map(r => r.supplier_id);
  const performance = (s: MasterData['suppliers'][number]) => s.on_time_pct / policy.ranking.on_time_scale * policy.ranking.weights.on_time + s.quality_rating / policy.ranking.quality_scale * policy.ranking.weights.quality;
  const others = data.suppliers.filter(s => s.status === 'Active' && s.categories.includes(item.category) && !preferred.includes(s.supplier_id))
    .sort((a,b) => performance(b)-performance(a) || b.on_time_pct-a.on_time_pct || b.quality_rating-a.quality_rating || compareText(a.supplier_id,b.supplier_id));
  return [...preferred, ...others.map(s => s.supplier_id)].slice(0, count);
}
