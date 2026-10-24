// Reuse drip's shipped vector identity and genuine demo screenshots; no invented app UI.
import sharp from 'sharp';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'docs/play-store/assets');
await mkdir(out,{recursive:true});
const svg=(await readFile(join(root,'public/favicon.svg'),'utf8')).replace(' rx="16"','');
await sharp(Buffer.from(svg)).resize(512,512).flatten({background:'#c6ff3d'}).ensureAlpha().png().toFile(join(out,'app-icon-512.png'));
const feature=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500"><rect width="1024" height="500" fill="#07070a"/><circle cx="910" cy="70" r="270" fill="#111809"/><text x="66" y="103" fill="#c6ff3d" font-family="Arial,sans-serif" font-size="54" font-weight="700">drip</text><text x="66" y="195" fill="#f5f5f7" font-family="Arial,sans-serif" font-size="46" font-weight="700">Your money,</text><text x="66" y="250" fill="#f5f5f7" font-family="Arial,sans-serif" font-size="46" font-weight="700">one day at a time.</text><text x="66" y="321" fill="#b8b8c3" font-family="Arial,sans-serif" font-size="22">Daily budgets. Automatic bank SMS tracking.</text><text x="66" y="356" fill="#b8b8c3" font-family="Arial,sans-serif" font-size="22">Your transactions stay on your device.</text><text x="66" y="440" fill="#898995" font-family="Arial,sans-serif" font-size="18">by Soft Orbit Apps</text><rect x="726" y="165" width="180" height="180" rx="44" fill="#c6ff3d"/><g transform="translate(760 192) scale(1.75)"><path d="M32 4C32 4 12 26 12 42a20 20 0 0 0 40 0C52 26 32 4 32 4Z" fill="#07070a"/></g></svg>`;
await sharp(Buffer.from(feature)).removeAlpha().png().toFile(join(out,'feature-graphic-1024x500.png'));
for (const [i,name] of ['today','briefing','activity','stats'].entries()) {
 await sharp(join(root,'docs/screenshots',name+'.png')).resize(1080,1920,{fit:'contain',background:'#07070a'}).removeAlpha().png().toFile(join(out,`${String(i+1).padStart(2,'0')}-${name}.png`));
}
await copyFile(join(root,'public/privacy.html'),join(root,'docs/play-store/privacy.html'));
console.log('Created icon, feature graphic, four screenshots, and privacy policy copy.');
