export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function instant(value: string): number {
  const local = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local && (!validDate(local[1]) || +local[2] > 23 || +local[3] > 59 || +(local[4] || 0) > 59)) return NaN;
  const iso = local ? `${local[1]}T${local[2]}:${local[3]}:${local[4] || '00'}+05:30` : value;
  if (!local && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  if (!validDate(value.slice(0, 10))) return NaN;
  return Date.parse(iso);
}
export function businessDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function daysBetween(a: string, b: string): number { return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS; }
export function inHistory(date: string, asOf: string, window: number): boolean {
  const age = daysBetween(asOf, date); return age > 0 && age <= window;
}
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
