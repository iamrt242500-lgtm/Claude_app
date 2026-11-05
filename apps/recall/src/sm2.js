// SM-2 spaced repetition. grade: 1=Again 2=Hard 3=Good 4=Easy  -> quality 1,3,4,5
export const QUALITY = { 1: 1, 2: 3, 3: 4, 4: 5 };
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function schedule(card, grade, today) {
  const q = QUALITY[grade];
  if (!q) throw new RangeError('grade must be 1-4');
  let { ease, reps, interval } = card;
  if (q < 3) { reps = 0; interval = 1; }
  else {
    interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
    reps += 1;
  }
  ease = Math.max(1.3, Math.round((ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) * 100) / 100);
  return { ease, reps, interval, due: addDays(today, interval) };
}

export function parseBulk(text) {
  const cards = [], bad = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const k = line.indexOf('::');
    const front = k < 0 ? '' : line.slice(0, k).trim(), back = k < 0 ? '' : line.slice(k + 2).trim();
    if (!front || !back) bad.push(i + 1); else cards.push({ front, back });
  });
  return { cards, bad };
}
