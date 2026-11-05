import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {EN} from '../src/i18n/en.js';
import {tl, setLang, getLang} from '../src/i18n/index.js';

const CJK = /[　-〿一-鿿＀-￯]/;
const files = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const unescape = s => s.replace(/\\(.)/g, (m, c) => ({n: '\n', t: '\t'}[c] ?? c));

test('every tl() key in the source has an English translation', () => {
  const missing = [];
  for (const file of files('src').filter(f => f.endsWith('.js') && !f.includes('i18n'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\btl\('((?:[^'\\]|\\.)*)'/g)) {
      const key = unescape(m[1]);
      if (!Object.hasOwn(EN, key)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every Chinese text fragment of index.html has an English translation', () => {
  const html = readFileSync('src/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const missing = [];
  for (const m of html.matchAll(/>([^<]+)</g)) {
    const text = m[1].replace(/&amp;/g, '&').trim();
    if (text && CJK.test(text) && !Object.hasOwn(EN, text) && !['中文'].includes(text)) missing.push(text);
  }
  for (const m of html.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]*)"/g)) {
    const text = m[1].trim();
    if (CJK.test(text) && !Object.hasOwn(EN, text) && text !== 'Language / 语言') missing.push(text);
  }
  assert.deepEqual(missing, []);
});

test('translations keep the same placeholders and contain no Chinese', () => {
  for (const [zh, en] of Object.entries(EN)) {
    const ph = s => (s.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(ph(en), ph(zh), zh);
    assert.ok(!/[一-鿿]/.test(en), `${zh} -> ${en}`);
  }
});

test('tl() falls back to Chinese, fills {0}… placeholders and leaves named ones', () => {
  const before = getLang();
  setLang('zh');
  assert.equal(tl('{0} 格', 3), '3 格');
  setLang('en');
  assert.equal(tl('{0} 格', 3), '3 cells');
  assert.equal(tl('性能模组'), 'Performance Module');
  assert.equal(tl('没有这个键'), '没有这个键');
  assert.match(tl('每与一个节点相邻，该模组属性临时 +{receiver}%。'), /\{receiver\}/);
  setLang(before);
});
