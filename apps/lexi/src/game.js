// Wordle-style rules. Pure; shared by server and browser.
/** Score a guess: 'g' correct place, 'y' elsewhere (respecting letter counts), 'x' absent. */
export function score(guess, answer) {
  const n = answer.length, res = Array(n).fill('x'), left = {};
  for (let i = 0; i < n; i++) { if (guess[i] === answer[i]) res[i] = 'g'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
  for (let i = 0; i < n; i++) if (res[i] === 'x' && left[guess[i]] > 0) { res[i] = 'y'; left[guess[i]]--; }
  return res.join('');
}
/** Best known state per letter across guesses: g > y > x. */
export function keyboard(rows) {
  const rank = { x: 1, y: 2, g: 3 }, out = {};
  for (const { guess, result } of rows) for (let i = 0; i < guess.length; i++) { const c = guess[i], s = result[i]; if (!out[c] || rank[s] > rank[out[c]]) out[c] = s; }
  return out;
}
/** Day number (UTC calendar days since 2026-01-01) for a YYYY-MM-DD date. */
export const dayIndex = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 86400000);
