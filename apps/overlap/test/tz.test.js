import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetMinutes, localParts, localMidnight, isValidZone, findOverlap, isDate, cityName, allZones } from '../src/tz.js';

const U = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
test('offsetMinutes: DST, half-hour and 45-minute zones, southern hemisphere', () => {
  assert.equal(offsetMinutes('America/New_York', U(2026, 1, 15, 12)), -300); assert.equal(offsetMinutes('America/New_York', U(2026, 7, 15, 12)), -240);
  assert.equal(offsetMinutes('Europe/London', U(2026, 1, 15, 12)), 0); assert.equal(offsetMinutes('Europe/London', U(2026, 7, 15, 12)), 60);
  assert.equal(offsetMinutes('Asia/Kolkata', U(2026, 1, 1)), 330); assert.equal(offsetMinutes('Asia/Kathmandu', U(2026, 1, 1)), 345); assert.equal(offsetMinutes('Asia/Tokyo', U(2026, 7, 1)), 540); assert.equal(offsetMinutes('UTC', U(2026, 7, 1)), 0);
  assert.equal(offsetMinutes('Australia/Sydney', U(2026, 1, 15)), 660, 'southern summer'); assert.equal(offsetMinutes('Australia/Sydney', U(2026, 7, 15)), 600); assert.equal(offsetMinutes('Australia/Lord_Howe', U(2026, 1, 15)), 660); assert.equal(offsetMinutes('Australia/Lord_Howe', U(2026, 7, 15)), 630);
});
test('DST transition instants: US 2026-03-08 02:00 local, EU 2026-03-29 01:00 UTC', () => {
  assert.equal(offsetMinutes('America/New_York', U(2026, 3, 8, 6, 59)), -300); assert.equal(offsetMinutes('America/New_York', U(2026, 3, 8, 7, 0)), -240);
  assert.equal(offsetMinutes('Europe/London', U(2026, 3, 29, 0, 59)), 0); assert.equal(offsetMinutes('Europe/London', U(2026, 3, 29, 1, 0)), 60);
  assert.equal(offsetMinutes('America/New_York', U(2026, 11, 1, 5, 59)), -240); assert.equal(offsetMinutes('America/New_York', U(2026, 11, 1, 6, 0)), -300);
});
test('localParts and localMidnight', () => {
  assert.deepEqual(localParts('Asia/Kolkata', U(2026, 1, 1, 0, 0)), { y: 2026, m: 1, d: 1, h: 5, mi: 30, s: 0 });
  assert.equal(localMidnight('America/New_York', 2026, 1, 15), U(2026, 1, 15, 5)); assert.equal(localMidnight('America/New_York', 2026, 7, 15), U(2026, 7, 15, 4)); assert.equal(localMidnight('Asia/Tokyo', 2026, 3, 9), U(2026, 3, 8, 15));
  assert.equal(localMidnight('America/New_York', 2026, 3, 8), U(2026, 3, 8, 5), 'midnight before the 2 am spring-forward'); assert.equal(localMidnight('America/New_York', 2026, 3, 9), U(2026, 3, 9, 4));
  assert.equal(localMidnight('Asia/Kathmandu', 2026, 1, 1), U(2025, 12, 31, 18, 15));
});
test('zone validation and helpers', () => {
  assert.ok(isValidZone('Europe/Paris') && isValidZone('UTC') && isValidZone('Asia/Kolkata') && isValidZone('Asia/Calcutta') && isValidZone('America/Argentina/Buenos_Aires') && isValidZone('Europe/Kyiv'), 'modern and legacy IDs both accepted'); for (const bad of ['Mars/Base', '', 'europe/paris ', null, 'A'.repeat(100), '../etc', '+05:00', 'Europe', 'Europe/Paris/../x']) assert.equal(isValidZone(bad), false, String(bad));
  assert.equal(cityName('America/Argentina/Buenos_Aires'), 'Buenos Aires'); assert.ok(isDate('2026-02-28') && !isDate('2026-02-30') && !isDate('2026-13-01') && !isDate('x')); assert.ok(allZones().includes('Asia/Seoul') && allZones().includes('Asia/Kolkata') && !allZones().includes('Asia/Calcutta'), 'list uses modern names'); assert.equal(allZones()[0], 'UTC'); assert.ok(allZones().every(isValidZone), 'every listed zone validates');
});
test('overlap NY–London flips with the mismatched DST weeks (the classic trap)', () => {
  const loc = (r) => r.best.local.map((l) => [l.start, l.end]);
  const before = findOverlap(['America/New_York', 'Europe/London'], '2026-03-02');   // US still on EST (-5), UK on GMT (0)
  assert.equal(before.best.minutes, 180); assert.deepEqual(loc(before), [['09:00', '12:00'], ['14:00', '17:00']]);
  const mid = findOverlap(['America/New_York', 'Europe/London'], '2026-03-09');      // US on EDT (-4), UK still GMT -> 4 h
  assert.equal(mid.best.minutes, 240); assert.deepEqual(loc(mid), [['09:00', '13:00'], ['13:00', '17:00']]);
  const after = findOverlap(['America/New_York', 'Europe/London'], '2026-04-06');    // both on summer time again (UK +1, 5 h apart) -> back to 3 h
  assert.equal(after.best.minutes, 180); assert.deepEqual(loc(after), [['09:00', '12:00'], ['14:00', '17:00']]);
});
test('overlap with half-hour and 45-minute zones is minute-exact (no hour-grid truncation)', () => {
  const india = findOverlap(['Asia/Kolkata', 'Europe/London'], '2026-01-15', { start: 9, end: 18 });   // IST 09–18 = 03:30–12:30Z ; London 09–18 = 09–18Z -> 09:00–12:30Z = 3.5 h
  assert.equal(india.best.minutes, 210); assert.deepEqual(india.best.local.map((l) => [l.start, l.end]), [['14:30', '18:00'], ['09:00', '12:30']]);
  const nepal = findOverlap(['Asia/Kathmandu', 'Asia/Kolkata'], '2026-01-15');   // NPT 09–17 = 03:15–11:15Z ; IST 09–17 = 03:30–11:30Z -> 03:30–11:15Z = 7.75 h
  assert.equal(nepal.best.minutes, 465); assert.deepEqual(nepal.best.local.map((l) => [l.start, l.end]), [['09:15', '17:00'], ['09:00', '16:45']]);
  assert.equal(findOverlap(['America/New_York', 'Europe/London', 'Asia/Tokyo'], '2026-03-09').best, null); assert.equal(findOverlap(['Asia/Tokyo', 'America/Los_Angeles'], '2026-06-10').windows.length, 0);
  assert.equal(findOverlap(['America/New_York', 'Europe/London', 'Asia/Tokyo'], '2026-03-09', { start: 0, end: 24 }).best.minutes, 1440, '24 h availability for all');
});
test('per-zone working windows override the default', () => {
  const r = findOverlap(['America/New_York', 'Europe/London'], '2026-03-09', { start: 9, end: 17 }, [{ start: 9, end: 17 }, { start: 13, end: 20 }]);   // London late shift 13–20 = 13–20Z; NY 13–21Z → 13–20Z overlap = 7h
  assert.equal(r.best.minutes, 420);
});
test('grid covers 24 consecutive hours from the first zone\'s local midnight, also on DST-change days', () => {
  const g = findOverlap(['America/New_York'], '2026-03-08'); assert.equal(g.slots.length, 96); assert.equal(g.start, U(2026, 3, 8, 5)); assert.equal(g.slots[95].t - g.slots[0].t, 95 * 15 * 60000);
  const hours = g.slots.map((s) => s.per[0].h); assert.ok(!hours.includes(2), 'the skipped 02:00 hour does not appear on the spring-forward day'); assert.equal(g.slots[0].per[0].h, 0);
  const fall = findOverlap(['America/New_York'], '2026-11-01'); assert.equal(fall.slots.map((s) => s.per[0]).filter((x) => x.h === 1 && x.mi === 0).length, 2, 'the repeated 01:00 appears twice on the fall-back day');
});
