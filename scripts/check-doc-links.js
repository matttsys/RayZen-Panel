// Verifies that every relative markdown link in the shipped docs resolves to a
// real file. Run: node scripts/check-doc-links.js
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const listing = execSync(
  "find . -name '*.md' -not -path './node_modules/*' -not -path './.wrangler/*'",
  { cwd: root, encoding: 'utf8' }
);
const files = listing.trim().split('\n').filter(Boolean);

let broken = 0;
let checked = 0;
for (const rel of files) {
  const abs = join(root, rel);
  const text = readFileSync(abs, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const raw = match[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split('#')[0];
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dirname(abs), decodeURIComponent(target)))) {
      console.log(`BROKEN  ${rel}  ->  ${raw}`);
      broken++;
    }
  }
}

console.log(`${files.length} markdown files, ${checked} relative links, ${broken} broken`);
process.exit(broken ? 1 : 0);
