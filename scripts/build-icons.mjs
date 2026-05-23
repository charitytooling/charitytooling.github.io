// Regenerate PNG / ICO icons from public/icon.svg.
//
// Run with:   npm run build:icons
//
// Outputs:
//   public/apple-touch-icon.png  (180x180, opaque ink-900 background)
//   public/icon-192.png          (192x192, maskable safe-zone)
//   public/icon-512.png          (512x512, maskable safe-zone)
//   public/favicon.ico           (16/32/48 multi-resolution)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const svgPath = path.join(publicDir, 'icon.svg');

const BRAND_BG = { r: 15, g: 23, b: 42, alpha: 1 }; // ink-900 #0f172a

async function renderSquare({ size, inset = 0, background = BRAND_BG, outPath }) {
  const svg = await readFile(svgPath);
  // The svg already paints its own ink-900 rounded square. For maskable icons we
  // inset the artwork so Android's adaptive-icon mask still shows the heart pin
  // even when the launcher uses an aggressive circle/squircle crop.
  const inner = Math.round(size * (1 - inset * 2));
  const padded = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: padded, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

async function buildFavicon() {
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(
    sizes.map(async (size) => {
      const buf = await sharp(await readFile(svgPath), { density: 384 })
        .resize(size, size, { fit: 'contain' })
        .png()
        .toBuffer();
      return buf;
    }),
  );
  const ico = await pngToIco(buffers);
  const out = path.join(publicDir, 'favicon.ico');
  await writeFile(out, ico);
  console.log(`wrote ${path.relative(root, out)} (${sizes.join('/')})`);
}

await renderSquare({
  size: 180,
  inset: 0.06,
  outPath: path.join(publicDir, 'apple-touch-icon.png'),
});
await renderSquare({
  size: 192,
  inset: 0.1,
  outPath: path.join(publicDir, 'icon-192.png'),
});
await renderSquare({
  size: 512,
  inset: 0.1,
  outPath: path.join(publicDir, 'icon-512.png'),
});
await buildFavicon();

console.log('icons built.');
