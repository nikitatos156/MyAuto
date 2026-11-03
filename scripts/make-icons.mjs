// Генерация иконок PWA и Android из SVG (нужен sharp). node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require('/opt/npm-tools/node_modules/sharp'); }

const glyph = (color = 'url(#arc)', needle = '#F4F3EF', ticks = '#5D626C', hubInner = '#E8590C') => {
  const r = 300, out = [];
  for (let i = 0; i <= 8; i++) {
    const a = ((135 + i * 33.75) * Math.PI) / 180;
    out.push(`<line x1="${(Math.cos(a) * 188).toFixed(1)}" y1="${(Math.sin(a) * 188).toFixed(1)}" x2="${(Math.cos(a) * 226).toFixed(1)}" y2="${(Math.sin(a) * 226).toFixed(1)}" stroke="${ticks}" stroke-width="20" stroke-linecap="round"/>`);
  }
  const na = (312 * Math.PI) / 180;
  return `
    <path d="M -212.1 212.1 A ${r} ${r} 0 1 1 212.1 212.1" fill="none" stroke="${color}" stroke-width="66" stroke-linecap="round"/>
    ${out.join('')}
    <line x1="0" y1="0" x2="${(Math.cos(na) * 236).toFixed(1)}" y2="${(Math.sin(na) * 236).toFixed(1)}" stroke="${needle}" stroke-width="30" stroke-linecap="round"/>
    <circle r="50" fill="${needle}"/>
    <circle r="20" fill="${hubInner}"/>`;
};
const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262930"/><stop offset="1" stop-color="#0E0F12"/></linearGradient>
  <linearGradient id="arc" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FFB15C"/><stop offset="0.55" stop-color="#FF7A1A"/><stop offset="1" stop-color="#E8590C"/></linearGradient>
</defs>`;
const full = (scale = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<rect width="1024" height="1024" fill="url(#bg)"/><g transform="translate(512 540) scale(${scale})">${glyph()}</g></svg>`;
const fg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<g transform="translate(512 540) scale(${scale})">${glyph()}</g></svg>`;
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(512 560) scale(1.25)">${glyph('#fff', '#fff', '#fff', '#000')}</g></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<circle cx="512" cy="512" r="512" fill="url(#bg)"/><g transform="translate(512 540) scale(0.82)">${glyph()}</g></svg>`;

const png = async (svg, size, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
};

fs.writeFileSync('resources/icon.svg', full());
await png(full(), 192, 'public/icons/icon-192.png');
await png(full(), 512, 'public/icons/icon-512.png');
await png(full(0.78), 512, 'public/icons/maskable-512.png');
await png(full(), 180, 'public/icons/apple-touch-icon.png');
await png(full(), 32, 'public/icons/favicon-32.png');

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const base = `resources/android/res/mipmap-${d}`;
  await png(full(), 48 * k, `${base}/ic_launcher.png`);
  await png(round, 48 * k, `${base}/ic_launcher_round.png`);
  await png(fg(0.62), 108 * k, `${base}/ic_launcher_foreground.png`);
  await png(mono, 24 * k, `resources/android/res/drawable-${d}/ic_stat_myauto.png`);
}
console.log('icons done');
