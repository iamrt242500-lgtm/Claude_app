import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDue, extractTasks, bucket, addDays, addMonths, isDate } from '../src/extract.js';

// 2026-03-11 is a Wednesday.
const REF = '2026-03-11', d = (t, ref = REF) => parseDue(t, ref)?.date ?? null;
test('date helpers: month arithmetic clamps to the last day', () => { assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); assert.equal(addMonths('2026-11-15', 3), '2027-02-15'); assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.ok(isDate('2024-02-29') && !isDate('2026-02-29')); });
test('relative words', () => {
  assert.equal(d('send it today'), '2026-03-11'); assert.equal(d('by EOD'), '2026-03-11'); assert.equal(d('due tomorrow'), '2026-03-12'); assert.equal(d('the day after tomorrow'), '2026-03-13');
  assert.equal(d('by end of week'), '2026-03-13', 'Friday of this week'); assert.equal(d('by EOW', '2026-03-14'), '2026-03-20', 'on a Saturday EOW means next Friday'); assert.equal(d('by EOW', '2026-03-13'), '2026-03-13', 'on Friday it is today');
  assert.equal(d('end of the month'), '2026-03-31'); assert.equal(d('EOM', '2024-02-10'), '2024-02-29'); assert.equal(d('next week'), '2026-03-16', 'Monday of next week'); assert.equal(d('next month'), '2026-04-11');
});
test('in N units and N units from now (digits and words)', () => {
  assert.equal(d('in 3 days'), '2026-03-14'); assert.equal(d('in two weeks'), '2026-03-25'); assert.equal(d('in a week'), '2026-03-18'); assert.equal(d('in 1 month'), '2026-04-11'); assert.equal(d('in a couple of days'), '2026-03-13'); assert.equal(d('5 days from now'), '2026-03-16'); assert.equal(d('in 2 months', '2026-12-31'), '2027-02-28');
});
test('weekdays: bare = next occurrence after today, this = this week, next = following week', () => {
  assert.equal(d('by Friday'), '2026-03-13'); assert.equal(d('by Wednesday'), '2026-03-18', 'today is Wednesday → next Wednesday, not today'); assert.equal(d('by Monday'), '2026-03-16'); assert.equal(d('by fri'), '2026-03-13'); assert.equal(d('by Thurs'), '2026-03-12');
  assert.equal(d('this Friday'), '2026-03-13'); assert.equal(d('this Wednesday'), '2026-03-11', 'this <today\'s weekday> is today'); assert.equal(d('this Monday'), '2026-03-16', 'this Monday has passed → rolls to the next one');
  assert.equal(d('next Tuesday'), '2026-03-17'); assert.equal(d('next Friday'), '2026-03-20'); assert.equal(d('next Monday'), '2026-03-16'); assert.equal(d('next Sunday'), '2026-03-22', 'weeks run Monday–Sunday');
});
test('absolute dates: ISO, month names, US m/d, years, rollover to next year, leap day', () => {
  assert.equal(d('on 2026-04-02'), '2026-04-02'); assert.equal(d('March 20'), '2026-03-20'); assert.equal(d('Mar 20th'), '2026-03-20'); assert.equal(d('20 March'), '2026-03-20'); assert.equal(d('the 5th of April'), '2026-04-05'); assert.equal(d('April 5, 2027'), '2027-04-05'); assert.equal(d('3/20'), '2026-03-20'); assert.equal(d('3/20/26'), '2026-03-20'); assert.equal(d('12/1/2026'), '2026-12-01');
  assert.equal(d('March 11'), '2026-03-11', 'today counts'); assert.equal(d('March 10'), '2027-03-10', 'already passed → next year'); assert.equal(d('1/5', '2026-03-11'), '2027-01-05'); assert.equal(d('Feb 29', '2026-03-11'), '2028-02-29', 'next leap day'); assert.equal(d('Feb 30'), null, 'impossible date → no date'); assert.equal(d('13/45'), null); assert.equal(d('2026-02-30'), null);
  assert.equal(d('may 5'), '2026-05-05'); assert.equal(d('Sept 3'), '2026-09-03');
});
test('phrases without a date, ASAP, case-insensitivity, earliest match wins', () => {
  assert.equal(parseDue('review the budget', REF), null); assert.equal(parseDue('do it ASAP', REF).date, null); assert.equal(parseDue('do it ASAP', REF).asap, true); assert.equal(d('BY FRIDAY'), '2026-03-13');
  assert.equal(parseDue('send draft by Friday, final next week', REF).match, 'Friday'); assert.equal(d('call mayor'), null, '"mayor" is not "mar"'); assert.equal(d('summary of satellites'), null, '"sat" inside a word is not Saturday'); assert.throws(() => parseDue('x', 'nope'), RangeError);
});
test('extractTasks: labels, checkboxes, names, @mentions, "we need to", due phrase removed from the title', () => {
  const notes = [
    'Attendees: Sam, Priya, Lee', 'Discussed the Q2 roadmap.', 'TODO: update the budget sheet by Friday', '- [ ] Book the venue for March 20', 'Action: Priya to send the revised proposal next Tuesday', 'Sam will draft the announcement by end of week.',
    '@Lee follow up with legal in 3 days', 'We need to decide on pricing', 'Maria Gonzalez will prepare slides before 3/20', 'Random sentence that is not a task.', 'Follow-up: confirm headcount ASAP',
  ].join('\n');
  const t = extractTasks(notes, REF); const by = Object.fromEntries(t.map((x) => [x.text, x]));
  assert.equal(t.length, 8);
  assert.deepEqual([by['Update the budget sheet'].owner, by['Update the budget sheet'].due], [null, '2026-03-13']); assert.equal(by['Book the venue for March 20'], undefined, 'for-phrase is stripped only when it is the due phrase'); assert.ok(by['Book the venue']); assert.equal(by['Book the venue'].due, '2026-03-20');
  assert.deepEqual([by['Send the revised proposal'].owner, by['Send the revised proposal'].due], ['Priya', '2026-03-17']); assert.deepEqual([by['Draft the announcement'].owner, by['Draft the announcement'].due], ['Sam', '2026-03-13']);
  assert.deepEqual([by['Follow up with legal'].owner, by['Follow up with legal'].due], ['Lee', '2026-03-14']); assert.deepEqual([by['Decide on pricing'] ?? by['Decide on pricing'], 1].length, 2); assert.equal(by['Decide on pricing'].owner, null); assert.equal(by['Decide on pricing'].due, null);
  assert.deepEqual([by['Prepare slides'].owner, by['Prepare slides'].due], ['Maria Gonzalez', '2026-03-20']); assert.equal(by['Confirm headcount'].due, null); assert.equal(by['Update the budget sheet'].line, 3);
});
test('extractTasks: duplicates collapse, junk is ignored, never throws', () => {
  assert.deepEqual(extractTasks('They will review it\nIt needs to ship\nWe will meet Friday', REF), [], 'pronoun-led statements are never turned into tasks owned by "They"/"It"/"We"'); assert.equal(extractTasks('We need to book the room', REF)[0].owner, null);
  assert.equal(extractTasks('TODO: ping Sam\nTODO: Ping Sam\n- [ ] ping sam', REF).length, 1); assert.deepEqual(extractTasks('', REF), []); assert.deepEqual(extractTasks(null, REF), []); assert.deepEqual(extractTasks('TODO:\nTODO: x\n[ ]\nAction:    ', REF), []);
  assert.doesNotThrow(() => extractTasks('TODO: ' + 'a'.repeat(5000) + ' by friday\n' + '@'.repeat(500) + '\n\u0000\u0001', REF)); assert.equal(extractTasks('Sam will fix it\r\nLee will test it', REF).length, 2, 'CRLF');
  const only = extractTasks('TODO: by Friday', REF); assert.deepEqual(only, [], 'a line that is only a date has no task text');
});
test('bucket', () => { assert.equal(bucket(null, REF), 'none'); assert.equal(bucket('2026-03-10', REF), 'overdue'); assert.equal(bucket('2026-03-11', REF), 'today'); assert.equal(bucket('2026-03-18', REF), 'week'); assert.equal(bucket('2026-03-19', REF), 'later'); });
