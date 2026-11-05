import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../public/md.js';

const flat = (nodes) => JSON.stringify(nodes);
test('blocks: headings, paragraphs (soft line join), hr, quote, code fences', () => {
  const b = parseMarkdown('# Title\n\nline one\nline two\n\n---\n\n> quoted **text**\n\n```js\nconst a = 1;\n<b>x</b>\n```\n');
  assert.deepEqual(b.map((x) => x.t), ['heading', 'p', 'hr', 'quote', 'codeblock']);
  assert.equal(b[0].level, 1); assert.deepEqual(b[1].c, [{ t: 'text', v: 'line one line two' }]); assert.equal(b[4].lang, 'js'); assert.equal(b[4].v, 'const a = 1;\n<b>x</b>');
  assert.equal(b[3].c[0].c[1].t, 'bold');
});
test('lists: bullets, ordered, task items', () => {
  const [ul, ol] = parseMarkdown('- a\n- [x] done\n- [ ] todo\n\n1. one\n2) two');
  assert.equal(ul.ordered, false); assert.equal(ul.items.length, 3); assert.equal(ul.items[1].checked, true); assert.equal(ul.items[2].checked, false); assert.equal(ol.ordered, true); assert.equal(ol.items.length, 2);
});
test('inline: code, bold, italic, links, wikilinks with labels, escapes', () => {
  const n = parseInline('a `code **no**` **b** *i* [x](https://e.com) [[Page One]] [[Other|shown]] \\*lit\\*');
  assert.deepEqual(n.map((x) => x.t), ['text', 'code', 'text', 'bold', 'text', 'em', 'text', 'link', 'text', 'wiki', 'text', 'wiki', 'text']);
  assert.equal(n[1].v, 'code **no**'); assert.deepEqual(n[9], { t: 'wiki', title: 'Page One', label: 'Page One' }); assert.deepEqual(n[11], { t: 'wiki', title: 'Other', label: 'shown' });
  assert.equal(n.at(-1).v, ' *lit*');
});
test('security: unsafe URL schemes are never links; raw HTML stays text; no html strings in AST', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'JAVASCRIPT:x', ' java\tscript:x']) {
    const n = parseInline(`[click](${u})`); assert.ok(!n.some((x) => x.t === 'link'), u);
  }
  assert.equal(parseInline('[ok](mailto:a@b.co)')[0].t, 'link'); assert.equal(parseInline('[ok](#anchor)')[0].t, 'link');
  const n = parseInline('<img src=x onerror=alert(1)> <script>x</script>'); assert.equal(n.length, 1); assert.equal(n[0].t, 'text');
  assert.ok(!flat(parseMarkdown('<b>x</b>')).includes('"t":"html"'));
});
test('robustness: unterminated constructs and weird input never throw', () => {
  for (const s of ['**unterminated', '[[open', '[x](', '`tick', '```\nno end', '> ', '#', '- ', '1. ', '_a', '*', '[[]]', '[[a|b|c]]', '\u0000', 'x'.repeat(5000), '*'.repeat(500)]) assert.doesNotThrow(() => parseMarkdown(s), s.slice(0, 20));
  assert.deepEqual(parseMarkdown(''), []); assert.deepEqual(parseMarkdown(null), []);
  assert.equal(parseMarkdown('```\nopen block\nstill code')[0].v, 'open block\nstill code');
});
test('performance: pathological nesting stays fast', () => {
  const t = Date.now(); parseMarkdown('*a '.repeat(2000) + '**b '.repeat(2000) + '[['.repeat(2000)); assert.ok(Date.now() - t < 1500, 'parser too slow: ' + (Date.now() - t));
});
