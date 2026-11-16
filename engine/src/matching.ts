import type { Item } from './types.js';
import type { Policy } from './policy.js';
import { compareText } from './dates.js';

export function normalizeDescription(text: string, policy: Policy): string[] {
  let value = text.toLowerCase().replaceAll('"', ' inch ');
  for (const phrase of policy.matching.ignored_phrases) value = value.replaceAll(phrase.toLowerCase(), ' ');
  value = value.replace(/(\d)[x×](?=\d)/g, '$1 ').replace(/[^a-z0-9./]+/g, ' ');
  return value.trim().split(/\s+/).filter(Boolean).flatMap(token => (policy.matching.aliases[token] ?? token).split(/\s+/)).sort();
}
function dice(a: string[], b: string[]): number {
  const aa = new Set(a), bb = new Set(b);
  return aa.size + bb.size ? 2 * [...aa].filter(t => bb.has(t)).length / (aa.size + bb.size) : 0;
}
function bigrams(value: string): string[] { return Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)); }
export interface Match { status: 'matched' | 'new' | 'ambiguous'; item?: Item; candidates: { item_code: string; description: string; score: number }[] }
export function matchDescription(description: string, items: Item[], policy: Policy): Match {
  const tokens = normalizeDescription(description, policy), models = tokens.filter(t => /\d/.test(t));
  const candidates = items.map(item => {
    const target = normalizeDescription(item.description, policy);
    const compatible = !policy.matching.require_compatible_model_tokens || models.every(t => target.includes(t));
    const score = compatible ? (dice(tokens, target) + dice(bigrams(tokens.join(' ')), bigrams(target.join(' ')))) / 2 : 0;
    return { item_code: item.item_code, description: item.description, score };
  }).filter(c => c.score >= policy.matching.candidate_threshold).sort((a, b) => b.score - a.score || compareText(a.item_code, b.item_code));
  const best = candidates[0], next = candidates[1];
  if (!best) return { status: 'new', candidates: [] };
  if (best.score >= policy.matching.confidence_threshold && best.score - (next?.score ?? 0) >= policy.matching.winner_margin) return { status: 'matched', item: items.find(i => i.item_code === best.item_code), candidates };
  return { status: 'ambiguous', candidates };
}
