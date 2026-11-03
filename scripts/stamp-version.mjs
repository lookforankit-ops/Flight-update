// Stamps a version onto every file reference of the web app (imports, script, stylesheet), so phones and
// browsers fetch fresh files after each update instead of mixing cached old modules with new ones.
// Run before committing a change to the web app:  node scripts/stamp-version.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date();
const version = process.argv[2] || now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

const files = ['index.html', ...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
for (const rel of files) {
  const file = path.join(root, rel);
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  // import ... from './x.js' / './x.js?v=...'
  s = s.replace(/(from\s+['"]\.\/[\w-]+\.js)(?:\?v=[\w.-]+)?(['"])/g, `$1?v=${version}$2`);
  // index.html: src/app.js, styles.css, and the visible build label
  s = s.replace(/(src="src\/app\.js)(?:\?v=[\w.-]+)?(")/g, `$1?v=${version}$2`);
  s = s.replace(/(href="styles\.css)(?:\?v=[\w.-]+)?(")/g, `$1?v=${version}$2`);
  s = s.replace(/(<meta name="app-version" content=")[^"]*(")/g, `$1${version}$2`);
  if (s !== before) fs.writeFileSync(file, s);
}
console.log(`Stamped version ${version}`);
