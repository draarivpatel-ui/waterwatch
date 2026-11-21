import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const dirs = ['src/', 'scripts/', 'docs/'];
const files = ['index.html', 'styles.css', 'package.json', 'README.md'];
for (const dir of dirs) {
  for (const name of await readdir(new URL(dir, root))) {
    if (/\.(?:css|html|m?js|json|md)$/.test(name)) files.push(dir + name);
  }
}
const text = await Promise.all(
  files.map(async name => [name, await readFile(new URL(name, root), 'utf8')]));

test('shipped text omits typographic dash punctuation', () => {
  const forbidden = [0x2013, 0x2014].map(code => String.fromCodePoint(code));
  for (const [name, value] of text) {
    assert.equal(forbidden.some(dash => value.includes(dash)), false, name);
  }
});

test('shipped text has no generation-tool marketing', () => {
  for (const [name, value] of text) {
    assert.doesNotMatch(value, /\b(?:ai|openai|anthropic|chatgpt|gpt|claude)\b/i, name);
  }
});

test('styles do not force animated scrolling', () => {
  assert.doesNotMatch(
    text.find(([name]) => name === 'styles.css')[1],
    /scroll-behavior\s*:\s*smooth/i);
});
