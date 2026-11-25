#!/usr/bin/env node
// Setzt VERSION in sw.js auf einen Hash über alle vorab gespeicherten App-Dateien.
// Wird vor dem Veröffentlichen ausgeführt (siehe .github/workflows/pages.yml).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));

const hash = crypto.createHash('sha256');
for (const rel of list) {
  const file = rel === './' ? 'index.html' : rel.replace(/^\.\//, '');
  hash.update(rel + '\0');
  hash.update(fs.readFileSync(path.join(root, file)));
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
fs.writeFileSync(swPath, sw);
console.log('sw.js VERSION =', version);
