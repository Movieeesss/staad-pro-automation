// Usage (from project root): npm i sharp && node tools/build-icons.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const art = `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <line x1="96" y1="190" x2="416" y2="190" stroke="#e2e8f0" stroke-width="14"/>
    <g fill="#38bdf8" stroke="none">
      <path d="M96 198 L74 234 H118 Z"/><path d="M256 198 L234 234 H278 Z"/><path d="M416 198 L394 234 H438 Z"/>
    </g>
    <line x1="96" y1="330" x2="416" y2="330" stroke="#475569" stroke-width="4" stroke-dasharray="10 10"/>
    <path d="M96 330 C120 400 200 390 256 270 C312 390 392 400 416 330" fill="rgba(56,189,248,.18)" stroke="#38bdf8" stroke-width="12"/>
  </g>
  <circle cx="256" cy="270" r="15" fill="#fb7185"/>`;
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="104"' : ''} fill="#090d16"/>${art}
</svg>`;

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon.svg', svg(true));
writeFileSync('icons/icon-maskable.svg', svg(false));

const render = (name, size, rounded) =>
  sharp(Buffer.from(svg(rounded)), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`icons/${name}`);

const any = [72, 96, 128, 144, 152, 192, 256, 384, 512];
await Promise.all([
  ...any.map((s) => render(`icon-${s}.png`, s, true)),
  render('icon-maskable-192.png', 192, false),
  render('icon-maskable-512.png', 512, false),
  render('apple-touch-icon-180.png', 180, false),
  render('favicon-32.png', 32, true),
]);
console.log('icons written');
