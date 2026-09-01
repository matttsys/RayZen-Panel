/** Static regression search for direct lexical use-before-initialization patterns. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['node_modules', 'dist', '.git']);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (excluded.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (relative(root, path).replaceAll('\\', '/').startsWith('wizard/artifacts')) continue;
      walk(path);
    } else if (/\.(?:js|mjs|ts)$/u.test(name)) files.push(path);
  }
}
walk(root);

const failures = [];
function isValueReference(id) {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id && !ts.isShorthandPropertyAssignment(p)) return false;
  if (ts.isMethodDeclaration(p) && p.name === id) return false;
  if (ts.isPropertyDeclaration(p) && p.name === id) return false;
  if (ts.isPropertySignature(p) && p.name === id) return false;
  if (ts.isVariableDeclaration(p) && p.name === id) return false;
  if (ts.isParameter(p) && p.name === id) return false;
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false;
  return true;
}

function containsIdentifier(node, name) {
  let found = false;
  function visit(child) {
    if (found) return;
    if (ts.isFunctionLike(child) && child !== node) return;
    if (ts.isIdentifier(child) && child.text === name && isValueReference(child)) { found = true; return; }
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return found;
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  function inspect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const list = node.parent;
      const flags = list?.flags || 0;
      if ((flags & ts.NodeFlags.Let) || (flags & ts.NodeFlags.Const)) {
        if (containsIdentifier(node.initializer, node.name.text)) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          failures.push(`${relative(root, file)}:${pos.line + 1}:${pos.character + 1} ${node.name.text} references itself during lexical initialization`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(sf);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`✔ Lexical TDZ audit: ${files.length} JS/TS files, no direct self-initializing let/const binding`);
