// All money is integer minor units (cents). Never floats in storage.
export const CURRENCIES = ['USD', 'EUR', 'GBP'];

/** "12.5" | "1,200.99" | 12.5 -> 1250 (cents) or null if invalid / negative. */
export function toCents(v) {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const n = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(n) ? n : null;
}
export const lineTotal = (qty, unitCents) => Math.round(qty * unitCents);

export function totals(items, taxBp) {
  const subtotal = items.reduce((s, i) => s + lineTotal(i.qty, i.unitCents), 0);
  const tax = Math.round((subtotal * taxBp) / 10000);
  return { subtotal, tax, total: subtotal + tax };
}
export function formatMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
export const todayUtc = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Validate invoice payload. Returns {value} or {errors}. */
export function validateInvoice(b) {
  const errors = {}; b = b && typeof b === 'object' ? b : {};
  const clientId = Number(b.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) errors.clientId = 'Choose a client';
  if (!isDate(b.issueDate)) errors.issueDate = 'Invalid issue date';
  if (!isDate(b.dueDate)) errors.dueDate = 'Invalid due date';
  else if (isDate(b.issueDate) && b.dueDate < b.issueDate) errors.dueDate = 'Due date cannot be before issue date';
  if (!CURRENCIES.includes(b.currency)) errors.currency = 'Unsupported currency';
  const tax = Number(b.taxPercent ?? 0);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) errors.taxPercent = 'Tax must be between 0 and 100';
  const notes = typeof b.notes === 'string' ? b.notes.trim() : '';
  if (notes.length > 2000) errors.notes = 'Notes too long (max 2000)';
  const items = [];
  if (!Array.isArray(b.items) || !b.items.length) errors.items = 'Add at least one line item';
  else if (b.items.length > 100) errors.items = 'Too many line items (max 100)';
  else b.items.forEach((it, i) => {
    const description = typeof it?.description === 'string' ? it.description.trim() : '';
    const qty = Number(it?.qty), unitCents = typeof it?.unitCents === 'number' ? it.unitCents : toCents(it?.unitPrice);
    if (!description || description.length > 200) errors.items = `Line ${i + 1}: description is required (max 200)`;
    else if (!(qty > 0) || qty > 100000) errors.items = `Line ${i + 1}: quantity must be greater than 0`;
    else if (!Number.isInteger(unitCents) || unitCents < 0) errors.items = `Line ${i + 1}: invalid unit price`;
    else items.push({ description, qty, unitCents });
  });
  if (Object.keys(errors).length) return { errors };
  return { value: { clientId, issueDate: b.issueDate, dueDate: b.dueDate, currency: b.currency, taxBp: Math.round(tax * 100), notes, items } };
}
