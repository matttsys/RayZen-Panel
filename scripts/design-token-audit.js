import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cssPath = path.join(root, 'src/assets/panel/style.css');
const css = fs.readFileSync(cssPath, 'utf8');
const marker = 'RayZen 1.0 — launch pixel-polish layer';
const start = css.indexOf(marker);
if (start < 0) throw new Error('Launch pixel-polish layer not found.');
const launch = css.slice(start);

const expected = {
  '--rz-s1':'4px','--rz-s2':'8px','--rz-s3':'12px','--rz-s4':'16px','--rz-s5':'24px','--rz-s6':'32px','--rz-s7':'48px',
  '--rz-r1':'8px','--rz-r2':'12px','--rz-r3':'16px','--rz-r4':'24px','--rz-r5':'32px',
  '--rz-i1':'16px','--rz-i2':'20px','--rz-i3':'24px',
};
const failures = [];
for (const [token, value] of Object.entries(expected)) {
  const re = new RegExp(`${token.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\s*:\\s*${value.replace('.', '\\.')}(?:\\s|;)`);
  if (!re.test(launch)) failures.push(`Missing or changed token ${token}: ${value}`);
}

const requiredSelectors = [
  '.rz-main', '.rz-card', '.rz-nav-item', '.rz-dialog-panel', '.rz-theme-choice',
  '.rz-mobile-nav', '.rz-sidebar', '.table-container', '.rz-view-head h2'
];
for (const selector of requiredSelectors) {
  if (!launch.includes(selector)) failures.push(`Launch layer does not govern ${selector}`);
}

const forbiddenWizardLabels = ['Choose intent', 'Review essentials', 'Save safely', 'Choose</', 'Import</', 'Refresh</'];
for (const label of forbiddenWizardLabels) {
  if (launch.includes(label)) failures.push(`Fake wizard label leaked into CSS layer: ${label}`);
}

const legacyPixelChecks = [
  { selector: '.rz-main', re: /\.rz-main\s*\{[^}]*padding:\s*var\(--rz-s7\)/s },
  { selector: '.rz-card', re: /\.rz-card\s*\{[^}]*padding:\s*var\(--rz-s5\)/s },
  { selector: '.rz-nav-item', re: /\.rz-nav-item\s*\{[^}]*min-height:\s*44px/s },
  { selector: '.rz-dialog-panel', re: /\.rz-dialog-panel\s*\{[^}]*border-radius:\s*var\(--rz-r4\)/s },
];
for (const check of legacyPixelChecks) if (!check.re.test(launch)) failures.push(`Token normalization missing for ${check.selector}`);

const report = {
  status: failures.length ? 'fail' : 'pass',
  spacingScale: ['4','8','12','16','24','32','48'],
  radiusScale: ['8','12','16','24','32'],
  iconScale: ['16','20','24'],
  auditedSelectors: requiredSelectors.length,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
