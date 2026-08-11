import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('src');
const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
const aliases = tsconfig.compilerOptions?.paths || {};

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) out.push(resolve(path));
  }
  return out;
}

const files = new Set(filesUnder(root));
const importPattern = /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g;

function candidate(path) {
  for (const value of [path, `${path}.ts`, join(path, 'index.ts')]) {
    const absolute = resolve(value);
    if (files.has(absolute)) return absolute;
  }
  return null;
}

function resolveImport(from, specifier) {
  if (specifier.startsWith('.')) return candidate(join(dirname(from), specifier));
  for (const [pattern, targets] of Object.entries(aliases)) {
    if (pattern.includes('*')) {
      const [prefix, suffix] = pattern.split('*');
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const middle = specifier.slice(prefix.length, suffix ? -suffix.length : undefined);
      for (const target of targets) {
        const found = candidate(target.replace('*', middle));
        if (found) return found;
      }
    } else if (specifier === pattern) {
      for (const target of targets) {
        const found = candidate(target);
        if (found) return found;
      }
    }
  }
  return null;
}

const graph = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const edges = [];
  for (const match of text.matchAll(importPattern)) {
    const target = resolveImport(file, match[1]);
    if (target) edges.push(target);
  }
  graph.set(file, edges);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map(p => relative(process.cwd(), p)).join(' -> ');
    throw new Error(`Static module cycle detected: ${cycle}`);
  }
  if (visited.has(file)) return;
  visiting.add(file); stack.push(file);
  for (const target of graph.get(file) || []) visit(target);
  stack.pop(); visiting.delete(file); visited.add(file);
}
for (const file of files) visit(file);
console.log(`✔ ${files.size} TypeScript modules are free of static import cycles`);
