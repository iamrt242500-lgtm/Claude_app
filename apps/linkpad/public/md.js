// Small, safe Markdown parser -> AST (no HTML strings anywhere). Shared by browser and tests.
const SAFE_URL = /^(https?:\/\/|mailto:|#)/i;
export const WIKI = /\[\[([^\[\]|\n]{1,100})(?:\|([^\[\]\n]{0,100}))?\]\]/g;

export function parseInline(src) {
  const out = []; let i = 0, buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < src.length) {
    const rest = src.slice(i); let m;
    if (rest[0] === '\\' && /[\\`*_\[\]()#>-]/.test(rest[1] ?? '')) { buf += rest[1]; i += 2; continue; }
    if ((m = /^`([^`\n]+)`/.exec(rest))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\[\[([^\[\]|\n]{1,100})(?:\|([^\[\]\n]{0,100}))?\]\]/.exec(rest))) { flush(); const title = m[1].trim(); out.push({ t: 'wiki', title, label: (m[2] ?? '').trim() || title }); i += m[0].length; continue; }
    if ((m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest))) { flush(); out.push(SAFE_URL.test(m[2]) ? { t: 'link', href: m[2], c: parseInline(m[1]) } : { t: 'text', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\*\*([^\n]+?)\*\*/.exec(rest)) || (m = /^__([^\n]+?)__/.exec(rest))) { flush(); out.push({ t: 'bold', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = /^\*([^*\s][^*\n]*?)\*/.exec(rest)) || (m = /^_([^_\s][^_\n]*?)_(?![\w])/.exec(rest))) { flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue; }
    buf += rest[0]; i++;
  }
  flush(); return out;
}

export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n'); const blocks = []; let i = 0;
  const isBlank = (l) => !l.trim();
  while (i < lines.length) {
    const line = lines[i]; let m;
    if (isBlank(line)) { i++; continue; }
    if ((m = /^```\s*([\w+#.-]*)\s*$/.exec(line))) { const code = []; i++; while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]); i++; blocks.push({ t: 'codeblock', lang: m[1], v: code.join('\n') }); continue; }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { blocks.push({ t: 'heading', level: m[1].length, c: parseInline(m[2]) }); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^>\s?/.test(line)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); blocks.push({ t: 'quote', c: parseMarkdown(q.join('\n')) }); continue; }
    if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line), re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/, items = [];
      while (i < lines.length && re.test(lines[i])) { const item = re.exec(lines[i])[1]; const task = /^\[( |x|X)\]\s+(.*)$/.exec(item); items.push(task ? { checked: task[1] !== ' ', c: parseInline(task[2]), task: true } : { c: parseInline(item) }); i++; }
      blocks.push({ t: 'list', ordered, items }); continue;
    }
    const p = []; while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|```|>\s?|\s*([-*+])\s+|\s*\d+[.)]\s+|-{3,}\s*$)/.test(lines[i])) p.push(lines[i++]);
    if (!p.length) { p.push(lines[i++]); }
    blocks.push({ t: 'p', c: parseInline(p.join(' ')) });
  }
  return blocks;
}
