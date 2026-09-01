import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
const lines = [];
lines.push('/* Generated from design-system/tokens.json. Do not hand edit. */');
lines.push(':root{');
for (const [k,v] of Object.entries(t.spacing)) lines.push(`--rz-space-${k}:${v}px;`);
for (const [k,v] of Object.entries(t.radius)) lines.push(`--rz-radius-${k}:${v}${typeof v==='number'?'px':''};`);
for (const [k,v] of Object.entries(t.icon)) lines.push(`--rz-icon-${k}:${v}px;`);
for (const [k,v] of Object.entries(t.control)) lines.push(`--rz-control-${k}:${v}px;`);
lines.push(`--rz-font-latin:${t.type.familyLatin};`);
lines.push(`--rz-font-fa:${t.type.familyPersian};`);
lines.push(`--rz-font-mono:${t.type.familyMono};`);
for (const [k,v] of Object.entries(t.motion)) lines.push(`--rz-motion-${k}:${typeof v==='number'?`${v}ms`:v};`);
for (const [k,v] of Object.entries(t.elevation)) lines.push(`--rz-elevation-${k}:${v};`);
lines.push('}');
for (const [theme,modes] of Object.entries(t.themes)) {
  for (const [mode,c] of Object.entries(modes)) {
    const selector = theme === 'ocean' && mode === 'light' ? ':root,:root[data-theme="ocean"][data-mode="light"]' : `:root[data-theme="${theme}"][data-mode="${mode}"]`;
    lines.push(`${selector}{`);
    const map={canvas:'canvas',canvasAlt:'canvas-alt',surface:'surface',surfaceHigh:'surface-high',surfaceSoft:'surface-soft',line:'line',text:'ink',text2:'ink-2',muted:'muted',accent:'accent',accentHover:'accent-hover',onAccent:'on-accent',success:'success',warning:'warning',danger:'danger',glow:'glow'};
    for (const [key,name] of Object.entries(map)) lines.push(`--rz-${name}:${c[key]};`);
    lines.push('}');
  }
}
lines.push('html[lang="fa"]{font-family:var(--rz-font-fa);font-feature-settings:"kern" 1;}');
lines.push('html:not([lang="fa"]){font-family:var(--rz-font-latin);}');
lines.push('@media (prefers-reduced-motion: reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;}}');
fs.writeFileSync(path.join(dir,'rayzen-tokens.css'), lines.join('\n'));

const kt=[];
kt.push('// Generated from design-system/tokens.json.');
kt.push('package app.rayzen.design');
kt.push('import androidx.compose.ui.unit.dp');
kt.push('import androidx.compose.ui.unit.sp');
kt.push('object RayZenDimens {');
for(const [k,v] of Object.entries(t.spacing)) kt.push(`  val Space${k} = ${v}.dp`);
for(const [k,v] of Object.entries(t.radius)) if(k!=='pill') kt.push(`  val Radius${k.replace(/(^|_)(\w)/g,(_,a,b)=>b.toUpperCase())} = ${v}.dp`);
kt.push('  val TouchTarget = 48.dp');
kt.push('  val ControlDefault = 44.dp');
kt.push('}');
kt.push('object RayZenTypeScale {');
for(const [k,v] of Object.entries(t.type)) if(typeof v==='object') kt.push(`  val ${k.replace(/(^|_)(\w)/g,(_,a,b)=>b.toUpperCase())} = ${v.size}.sp`);
kt.push('}');
fs.writeFileSync(path.join(dir,'RayZenTokens.kt'),kt.join('\n'));
