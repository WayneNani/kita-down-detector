// Verhindert dangerouslySetInnerHTML im Frontend (XSS-Schutz, siehe technisches Konzept 7.1).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const treffer = [];
function durchsuche(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) durchsuche(p);
    else if (/\.(tsx?|jsx?)$/.test(name) && readFileSync(p, 'utf8').includes('dangerouslySetInnerHTML')) treffer.push(p);
  }
}
durchsuche(new URL('../src', import.meta.url).pathname);
if (treffer.length) {
  console.error('dangerouslySetInnerHTML ist verboten:\n' + treffer.join('\n'));
  process.exit(1);
}
console.log('OK: kein dangerouslySetInnerHTML in src/');
