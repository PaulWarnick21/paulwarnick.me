// Builds the hero photo and the photo gallery into index.html.
//
//   node scripts/build.mjs
//
// Inputs:
//   content/photos.json            hand-edited: the gallery order, alt text and
//                                  location captions, how many photos show
//                                  before "Show all photos", and which photo
//                                  sits behind the name.
//   content/photos.generated.json  written by scripts/process-photos.ps1: the
//                                  resized files, their sizes and average colour.
//
// The gallery is one set of justified rows. A caption shows on hover and in
// the full-screen viewer. The hero uses the crops process-photos.ps1 makes
// from the original (wide for landscape screens, tall for upright phones).
// Output goes between the <!-- hero:* --> and <!-- gallery:* --> markers in
// index.html; everything else is left alone.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const EDITORIAL = join(ROOT, 'content', 'photos.json');
const GENERATED = join(ROOT, 'content', 'photos.generated.json');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (!existsSync(GENERATED)) {
  throw new Error('No processed photos yet. Run: powershell -NoProfile -File scripts/process-photos.ps1');
}
const editorial = JSON.parse(await readFile(EDITORIAL, 'utf8'));
const generated = JSON.parse(await readFile(GENERATED, 'utf8'));
// PowerShell's JSON writer can flatten one-item lists, so accept both shapes.
const processed = new Map([].concat(generated.photos ?? []).map((entry) => {
  const widths = [].concat(entry.widths).sort((a, b) => a - b);
  const base = `assets/photos/${entry.file}`;
  return [entry.file, {
    ...entry,
    widths,
    src: `${base}-${widths[0]}.jpg`,
    srcset: widths.filter((w) => w <= 1600).map((w) => `${base}-${w}.jpg ${w}w`).join(', '),
    heroSrcset: widths.map((w) => `${base}-${w}.jpg ${w}w`).join(', '),
    full: `${base}-${widths[widths.length - 1]}.jpg`,
  }];
}));

const warnings = [];

function sizesFor(ar) {
  // Justified rows grow past their base height, so these are generous.
  const px = (rowH) => `${Math.round(ar * rowH * 1.4)}px`;
  return `(max-width: 520px) ${px(150)}, (max-width: 900px) ${px(220)}, ${px(320)}`;
}

function photoHtml(item, extra) {
  const p = processed.get(item.file);
  if (!p) { warnings.push(`"${item.file}" is in photos.json but wasn't processed`); return ''; }
  if (!item.alt) warnings.push(`${item.file}: no alt text`);
  const ar = +(p.w / p.h).toFixed(4);
  const thumbW = p.widths[0];
  const thumbH = Math.round(thumbW / ar);
  const caption = item.caption ? ` data-caption="${esc(item.caption)}"` : '';
  const label = item.caption ? `<span class="photo-caption">${esc(item.caption)}</span>` : '';
  return `          <a class="photo${extra}" href="${esc(p.full)}" data-w="${p.w}" data-h="${p.h}"${caption} style="--ar: ${ar}; --tone: ${esc(p.color)}">` +
    `<img src="${esc(p.src)}" srcset="${esc(p.srcset)}" sizes="${sizesFor(ar)}" width="${thumbW}" height="${thumbH}" alt="${esc(item.alt || 'Photo')}" loading="lazy" decoding="async">${label}</a>`;
}

const visible = editorial.visible ?? editorial.gallery.length;
let photoCount = 0;
let hiddenPhotos = 0;
const items = editorial.gallery.map((item, i) => {
  const hidden = i >= visible;
  const extra = hidden ? ' is-extra' : '';
  photoCount++;
  if (hidden) hiddenPhotos++;
  return photoHtml(item, extra);
}).filter(Boolean);

const used = new Set(editorial.gallery.map((i) => i.file));
for (const file of processed.keys()) {
  if (!used.has(file) && file !== editorial.hero.file) warnings.push(`"${file}" was processed but isn't in the gallery or the hero`);
}

const collapsible = hiddenPhotos > 0;
const galleryHtml = `        <div class="justified gallery"${collapsible ? ' data-collapsible' : ''} data-gallery>
${items.join('\n')}
        </div>` + (collapsible ? `
        <div class="gallery-more">
          <button class="pill" type="button" data-show-all hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>Show all ${photoCount} photos
          </button>
        </div>` : '');

const heroFile = (name) => existsSync(join(ROOT, 'assets', 'photos', name)) ? `assets/photos/${name}` : null;
const wide = [1600, 2560].map((w) => [w, heroFile(`hero-wide-${w}.jpg`)]).filter(([, f]) => f);
const tall = [750, 1200].map((w) => [w, heroFile(`hero-tall-${w}.jpg`)]).filter(([, f]) => f);
if (!wide.length) throw new Error('No hero crops yet. Run: powershell -NoProfile -File scripts/process-photos.ps1 -HeroOnly');
const srcset = (list) => list.map(([w, f]) => `${f} ${w}w`).join(', ');
const heroHtml =
  `      <picture>
` +
  (tall.length ? `        <source media="(orientation: portrait)" srcset="${esc(srcset(tall))}" sizes="100vw">
` : '') +
  `        <img class="hero-img" src="${esc(wide[0][1])}" srcset="${esc(srcset(wide))}" sizes="100vw" alt="" fetchpriority="high" decoding="async">
` +
  `      </picture>` +
  (editorial.hero.credit ? `
      <p class="hero-credit">${esc(editorial.hero.credit)}</p>` : '');

function inject(html, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(\\s*<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`index.html is missing the <!-- ${name}:start/end --> markers`);
  return html.replace(re, `$1\n${content}$2`);
}

let html = await readFile(INDEX, 'utf8');
html = inject(html, 'hero', heroHtml);
html = inject(html, 'gallery', galleryHtml);
await writeFile(INDEX, html);

console.log(`Built: ${photoCount} photos in the gallery (${photoCount - hiddenPhotos} shown before "Show all"), hero from ${editorial.hero.source}.`);
for (const w of [...new Set(warnings)]) console.warn(`  warning: ${w}`);
