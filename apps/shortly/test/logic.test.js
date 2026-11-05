import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, validateSlug, validateExpiry, classifyUa, referrerHost, generateCode, isExpired } from '../src/logic.js';

test('validateUrl accepts normal URLs, adds https for bare hosts, normalizes', () => {
  assert.equal(validateUrl('https://example.com/a?b=1#c').value, 'https://example.com/a?b=1#c');
  assert.equal(validateUrl('example.com/path').value, 'https://example.com/path'); assert.equal(validateUrl('  http://localhost:3000/x  ').value, 'http://localhost:3000/x');
  assert.equal(validateUrl('HTTPS://EXAMPLE.com').value, 'https://example.com/');
});
test('validateUrl rejects dangerous or invalid URLs', () => {
  for (const [u, re] of [['', /required/], ['javascript:alert(1)', /http and https/], ['data:text/html,<script>', /http and https/], ['file:///etc/passwd', /http and https/], ['ftp://x.com', /http and https/],
    ['https://user:pw@example.com', /credentials/], ['https://nodots', /valid URL/], ['not a url', /valid URL/], ['https://' + 'a'.repeat(2100) + '.com', /too long/], [null, /required/]])
    assert.match(validateUrl(u).error ?? '', re, String(u));
  assert.match(validateUrl('https://short.example/abc', 'short.example').error, /this service itself/); assert.match(validateUrl('https://SHORT.example:8080/', 'short.example:8080').error, /this service itself/);
  assert.ok(validateUrl('https://other.example/', 'short.example').value);
});
test('validateSlug', () => {
  assert.equal(validateSlug('').value, null); assert.equal(validateSlug(undefined).value, null); assert.equal(validateSlug('my-link_1').value, 'my-link_1');
  for (const s of ['ab', 'a'.repeat(33), 'has space', 'ünï', 'a/b', 'api', 'API', 's']) assert.ok(validateSlug(s).error, s);
});
test('validateExpiry', () => {
  assert.equal(validateExpiry('2026-12-31', '2026-03-01').value, '2026-12-31'); assert.equal(validateExpiry('2026-03-01', '2026-03-01').value, '2026-03-01', 'today is valid');
  for (const e of ['2026-02-28', '2026-13-01', 'soon', 20260301]) assert.ok(validateExpiry(e, '2026-03-01').error, String(e)); assert.equal(validateExpiry(null, 'x').value, null);
  assert.equal(isExpired('2026-03-01', '2026-03-01'), false, 'valid through the whole expiry day'); assert.equal(isExpired('2026-03-01', '2026-03-02'), true); assert.equal(isExpired(null, '2026-03-02'), false);
});
test('classifyUa and referrerHost', () => {
  assert.equal(classifyUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari'), 'mobile'); assert.equal(classifyUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/120'), 'desktop');
  assert.equal(classifyUa('Googlebot/2.1'), 'bot'); assert.equal(classifyUa('curl/8.0'), 'bot'); assert.equal(classifyUa('Slackbot-LinkExpanding'), 'bot'); assert.equal(classifyUa(''), 'unknown');
  assert.equal(referrerHost('https://www.Google.com/search?q=x'), 'google.com'); assert.equal(referrerHost('garbage'), null); assert.equal(referrerHost(undefined), null);
});
test('generateCode: right length, unambiguous alphabet, varies', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateCode())); assert.ok(codes.size > 195);
  for (const c of codes) { assert.equal(c.length, 6); assert.match(c, /^[A-HJ-NP-Za-km-z2-9]+$/); }
});
