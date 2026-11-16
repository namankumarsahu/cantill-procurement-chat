import { z } from 'zod';

export type Scalar = string | number | boolean;
export type Operand = Scalar | Scalar[] | { parameter: string };
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } |
  { fact: string; operator: 'eq' | 'ne' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'; value: Operand };
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const reference = z.strictObject({ parameter: z.string().min(1) });
const operand = z.union([scalar, z.array(scalar), reference]);
const condition: z.ZodType<Condition> = z.lazy(() => z.union([
  z.strictObject({ all: z.array(condition) }), z.strictObject({ any: z.array(condition) }),
  z.strictObject({ not: condition }),
  z.strictObject({ fact: z.string().min(1), operator: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'between']), value: operand }),
]));
const amount = z.union([z.number().nonnegative().finite(), reference]);
export const sourceTypes = {
  'requirement.is_new': 'boolean', 'item.item_type': 'string', 'item.category': 'string',
  'requirement.plant': 'string', 'requirement.is_emergency': 'boolean',
  'requirement.valuation_inr': 'number', 'contract_selection.has_usable_contract': 'boolean',
} as const;
const fact = z.union([
  z.strictObject({ type: z.enum(['string', 'number', 'boolean']), source: z.enum(Object.keys(sourceTypes) as [keyof typeof sourceTypes, ...Array<keyof typeof sourceTypes>]) }),
  z.strictObject({ type: z.literal('boolean'), provider: z.literal('item_purchase_exists'), args: z.strictObject({ supplier_status: z.literal('Active'), history_days: amount }) }),
]);
const route = z.strictObject({
  decision: z.enum(['PO', 'SOURCING_REQUEST']),
  supplier_strategy: z.enum(['none', 'selected_contract', 'first_preferred', 'preferred_then_category']),
  price_strategy: z.enum(['selected_contract', 'supplier_reference']).optional(),
  suggest_count: amount, flags: z.array(z.string()),
});
const schema = z.strictObject({
  schema_version: z.literal(1), version: z.string().min(1), effective_date: z.iso.date(),
  status: z.enum(['draft', 'active', 'superseded']), created_by: z.string().min(1),
  approved_by: z.string().nullable(), approved_at: z.iso.datetime({ offset: true }).nullable(), source_text: z.string().min(1),
  parameters: z.record(z.string(), z.number().finite().nonnegative()),
  fact_registry: z.record(z.string(), fact), route_registry: z.record(z.string(), route),
  rules: z.array(z.strictObject({ id: z.string().min(1), clause: z.string().min(1), order: z.number().int(), when: condition, outcome: z.strictObject({ route: z.string().min(1) }) })).min(1),
  ranking: z.strictObject({
    weights: z.strictObject({ frequency: z.number().nonnegative(), recency: z.number().nonnegative(), contract: z.number().nonnegative(), on_time: z.number().nonnegative(), quality: z.number().nonnegative() }),
    frequency_normalization: z.literal('max_eligible_count'),
    recency_bands: z.array(z.strictObject({ max_days: z.number().int().nonnegative(), score: z.number().min(0).max(1) })),
    older_recency_score: z.number().min(0).max(1), on_time_scale: z.number().positive(), quality_scale: z.number().positive(),
    tie_breaker: z.literal('supplier_id_ascending'),
    category_top_up_order: z.tuple([z.literal('on_time_descending'), z.literal('quality_descending'), z.literal('supplier_id_ascending')]),
  }),
  matching: z.strictObject({ confidence_threshold: z.number().min(0).max(1), winner_margin: z.number().min(0).max(1), aliases: z.record(z.string(), z.string()), ignored_phrases: z.array(z.string()), require_compatible_model_tokens: z.boolean() }),
});
export type Policy = z.infer<typeof schema>;
export function parameter(policy: Policy, name: string): number {
  const value = policy.parameters[name];
  if (value === undefined) throw new Error(`Missing policy parameter: ${name}`);
  return value;
}
export function resolveOperand(policy: Policy, value: Operand): Scalar | Scalar[] {
  return typeof value === 'object' && !Array.isArray(value) ? parameter(policy, value.parameter) : value;
}
export function validatePolicy(input: unknown): Policy {
  const p = schema.parse(input);
  const fail = (message: string): never => { throw new Error(`Invalid policy: ${message}`); };
  for (const name of ['clubbing_created_days', 'clubbing_need_by_days', 'valuation_history_days', 'eligibility_history_days', 'preferred_history_days', 'consolidation_hours']) {
    if (!Number.isInteger(parameter(p, name))) fail(`${name} must be an integer`);
  }
  if (p.status !== 'draft' && (!p.approved_by || !p.approved_at)) fail('approved policy needs approval metadata');
  if (Math.abs(Object.values(p.ranking.weights).reduce((a, b) => a + b, 0) - 1) > Number.EPSILON * 10) fail('ranking weights must sum to one');
  if (new Set(p.rules.map(r => r.id)).size !== p.rules.length || new Set(p.rules.map(r => r.order)).size !== p.rules.length) fail('duplicate rule ID/order');
  for (const f of Object.values(p.fact_registry)) {
    if ('source' in f && f.type !== sourceTypes[f.source]) fail(`incorrect fact type for ${f.source}`);
    if ('provider' in f && (!Number.isInteger(resolveOperand(p, f.args.history_days)) || Number(resolveOperand(p, f.args.history_days)) < 0)) fail('history window must be a nonnegative integer');
  }
  function check(c: Condition, depth = 0): void {
    if (depth > 32) fail('condition nesting exceeds supported depth');
    if ('all' in c || 'any' in c) { for (const child of 'all' in c ? c.all : c.any) check(child, depth + 1); return; }
    if ('not' in c) { check(c.not, depth + 1); return; }
    const f = p.fact_registry[c.fact] ?? fail(`unknown fact ${c.fact}`);
    const v = resolveOperand(p, c.value);
    if (['gt', 'gte', 'lt', 'lte'].includes(c.operator) && (f.type !== 'number' || typeof v !== 'number')) fail('numeric comparison needs numbers');
    if (c.operator === 'between' && (f.type !== 'number' || !Array.isArray(v) || v.length !== 2 || v.some(x => typeof x !== 'number') || v[0] > v[1])) fail('between needs an ordered numeric pair');
    if (c.operator === 'in' && (!Array.isArray(v) || v.some(x => typeof x !== f.type))) fail('in needs a matching typed array');
    if (['eq', 'ne'].includes(c.operator) && typeof v !== f.type) fail('equality type mismatch');
  }
  for (const r of p.rules) { if (!Object.hasOwn(p.route_registry, r.outcome.route)) fail(`unknown route ${r.outcome.route}`); check(r.when); }
  const last = [...p.rules].sort((a, b) => a.order - b.order).at(-1)!;
  if (!('all' in last.when) || last.when.all.length) fail('last rule must be an unconditional fallback');
  for (const r of Object.values(p.route_registry)) {
    const count = resolveOperand(p, r.suggest_count);
    if (typeof count !== 'number' || !Number.isInteger(count)) fail('suggestion count must be an integer');
    if (r.decision === 'PO' && !((r.supplier_strategy === 'selected_contract' && r.price_strategy === 'selected_contract') || (r.supplier_strategy === 'first_preferred' && r.price_strategy === 'supplier_reference'))) fail('PO needs a safe supplier/price strategy');
    if (r.decision === 'SOURCING_REQUEST' && !['none', 'preferred_then_category'].includes(r.supplier_strategy)) fail('invalid sourcing strategy');
  }
  const bands = p.ranking.recency_bands;
  if (bands.some((b, i) => i > 0 && b.max_days <= bands[i - 1].max_days)) fail('recency bands must be ordered');
  return p;
}

export function policyDiff(before: Policy, after: Policy): string[] {
  const changes: string[] = [];
  function walk(a: unknown, b: unknown, path: string): void {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(aa), ...Object.keys(bb)])) walk(aa[key], bb[key], path ? `${path}.${key}` : key);
    } else changes.push(`${path}: ${JSON.stringify(a) ?? '(absent)'} -> ${JSON.stringify(b) ?? '(removed)'}`);
  }
  walk(before, after, '');
  return changes;
}
