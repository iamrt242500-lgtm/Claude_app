// FIFO inventory costing. Pure; shared by server and browser. Quantities are whole units, costs are integer cents per unit.
export const parseMoney = (input) => {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 ? input : null; if (typeof input !== 'string') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/^\$/, '').replace(/,/g, '')); return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0) : null;
};
export const formatMoney = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100).toLocaleString('en-US')}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
export const byOrder = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id);

/**
 * Replay movements (any order) oldest-first.
 *   { id, day, type: 'receive'|'issue'|'adjust', qty, unitCost }
 *   receive: +qty at unitCost · issue: −qty (qty > 0 given) · adjust: signed qty; positive needs unitCost, negative consumes FIFO.
 * Returns { ok, error?, atId?, lots: [{ qty, cost, day, id }], onHand, value, cost: Map(id → total cents consumed/added), balanceAfter: Map(id → on hand) }.
 * Fails at the first movement that would take stock below zero.
 */
export function replay(movements) {
  const lots = [], cost = new Map(), balanceAfter = new Map(); let onHand = 0;
  for (const m of [...movements].sort(byOrder)) {
    const delta = m.type === 'issue' ? -m.qty : m.qty;
    if (delta > 0) { lots.push({ qty: delta, cost: m.unitCost ?? 0, day: m.day, id: m.id }); cost.set(m.id, delta * (m.unitCost ?? 0)); }
    else if (delta < 0) {
      let need = -delta, total = 0; if (need > onHand) return { ok: false, error: `Only ${onHand} on hand on ${m.day}, can't remove ${need}`, atId: m.id, lots, onHand, value: lots.reduce((s, l) => s + l.qty * l.cost, 0), cost, balanceAfter };
      while (need > 0) { const l = lots[0], take = Math.min(l.qty, need); total += take * l.cost; l.qty -= take; need -= take; if (!l.qty) lots.shift(); }
      cost.set(m.id, total);
    }
    onHand += delta; balanceAfter.set(m.id, onHand);
  }
  return { ok: true, lots, onHand, value: lots.reduce((s, l) => s + l.qty * l.cost, 0), cost, balanceAfter };
}
/** Average issue rate per day over the `days` before and including `asOf` (YYYY-MM-DD); only issues and negative adjustments count. */
export function dailyUsage(movements, asOf, days = 30) {
  const from = new Date(Date.parse(asOf + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
  const used = movements.filter((m) => m.day >= from && m.day <= asOf && (m.type === 'issue' || (m.type === 'adjust' && m.qty < 0))).reduce((s, m) => s + Math.abs(m.qty), 0); return used / days;
}
/** Days of stock left at the current usage rate, or null when there is no usage. */
export const daysOfCover = (onHand, usagePerDay) => (usagePerDay > 0 ? Math.floor(onHand / usagePerDay) : null);
export const isLow = (onHand, reorderPoint) => reorderPoint > 0 && onHand <= reorderPoint;
