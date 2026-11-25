import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { containsLine } from '../js/words.js';
import { shardKey, normalizeWord } from '../js/normalize.js';

const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const shard = (k) => zlib.gunzipSync(fs.readFileSync(new URL(index.shards[k].file, dir))).toString('utf8');
const has = (raw) => {
  const w = normalizeWord(raw);
  return containsLine(shard(shardKey(w)), w);
};

test('Binärsuche im sortierten Text', () => {
  const text = ['AB', 'ABC', 'B', 'BA', 'ZZ'].join('\n') + '\n';
  for (const w of ['AB', 'ABC', 'B', 'BA', 'ZZ']) assert.equal(containsLine(text, w), true, w);
  for (const w of ['A', 'ABD', 'BB', 'Z', 'ZZZ', '']) assert.equal(containsLine(text, w), false, w);
});

test('Wortliste: Grundformen und Flexionsformen', () => {
  for (const w of ['Haus', 'Hauses', 'Häuser', 'geliebt', 'liebtest', 'anzurufen', 'Straße', 'ärgerten', 'Öfen', 'übermüdeten', 'Quarz', 'zwölftem']) {
    assert.equal(has(w), true, w);
  }
});

test('Wortliste: bekannte Lücken und Unsinn', () => {
  assert.equal(has('ANPOCHENS'), false);
  assert.equal(has('XQZRT'), false);
});

test('Wortliste: Dateien sind sortiert und eindeutig', () => {
  let total = 0;
  for (const k of Object.keys(index.shards)) {
    const lines = shard(k).split('\n').filter(Boolean);
    total += lines.length;
    for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1] < lines[i], `${k}: ${lines[i - 1]} / ${lines[i]}`);
    assert.ok(lines.every((l) => /^[A-ZÄÖÜ]{2,15}$/.test(l)), k);
  }
  assert.equal(total, index.count);
});
