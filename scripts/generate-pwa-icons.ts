/**
 * Generate PWA icons as SVG + PNG files.
 * PNG icons are required for Chrome's beforeinstallprompt (PWA installability).
 * 
 * Run: bun scripts/generate-pwa-icons.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import sharp from "sharp";

const ICONS_DIR = "src/web/public/icons";

if (!existsSync(ICONS_DIR)) {
  mkdirSync(ICONS_DIR, { recursive: true });
}

/** Generate an SVG icon with the BIQ logo */
function generateSVG(size: number, maskable = false): string {
  const padding = maskable ? size * 0.1 : 0;
  const innerSize = size - padding * 2;
  const fontSize = innerSize * 0.38;
  const subFontSize = innerSize * 0.12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.15}" fill="#0f172a"/>
  <rect x="${padding + innerSize * 0.08}" y="${padding + innerSize * 0.08}" width="${innerSize * 0.84}" height="${innerSize * 0.84}" rx="${innerSize * 0.12}" fill="#1e293b" stroke="#3b82f6" stroke-width="${size * 0.015}"/>
  <text x="${size / 2}" y="${size * 0.48}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-weight="800" font-size="${fontSize}" fill="#3b82f6">BIQ</text>
  <text x="${size / 2}" y="${size * 0.68}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-weight="500" font-size="${subFontSize}" fill="#64748b">ENTERPRISE</text>
</svg>`;
}

// Generate all icon variants
const variants = [
  { name: "icon-192.svg", size: 192, maskable: false },
  { name: "icon-512.svg", size: 512, maskable: false },
  { name: "icon-maskable-192.svg", size: 192, maskable: true },
  { name: "icon-maskable-512.svg", size: 512, maskable: true },
  { name: "apple-touch-icon.svg", size: 180, maskable: false },
];

for (const v of variants) {
  const svg = generateSVG(v.size, v.maskable);
  writeFileSync(`${ICONS_DIR}/${v.name}`, svg);
  console.log(`✓ Generated ${ICONS_DIR}/${v.name}`);
}

// Generate PNG versions from SVGs (required for Chrome PWA installability)
const pngVariants = [
  { src: "icon-192.svg", out: "icon-192.png", size: 192 },
  { src: "icon-512.svg", out: "icon-512.png", size: 512 },
  { src: "icon-maskable-192.svg", out: "icon-maskable-192.png", size: 192 },
  { src: "icon-maskable-512.svg", out: "icon-maskable-512.png", size: 512 },
  { src: "apple-touch-icon.svg", out: "apple-touch-icon.png", size: 180 },
];

for (const v of pngVariants) {
  const svgPath = `${ICONS_DIR}/${v.src}`;
  const pngPath = `${ICONS_DIR}/${v.out}`;
  await sharp(svgPath)
    .resize(v.size, v.size)
    .png()
    .toFile(pngPath);
  console.log(`✓ Generated ${pngPath}`);
}

console.log("\nDone! SVG + PNG icons generated.");
console.log("Manifest references PNG icons for maximum browser compatibility.");
