// Render the PWA icons from public/icon.svg (dev-only; the output PNGs are
// committed, so the build never runs this).
//
//   node scripts/gen-icons.mjs            # uses Google Chrome's default path
//   CHROME=/path/to/chrome node scripts/gen-icons.mjs
//
// Outputs, all in public/:
//   pwa-192.png, pwa-512.png              purpose "any": the square with rounded,
//                                         transparent corners, as the favicon
//   pwa-maskable-192.png, -512.png        purpose "maskable": full-bleed
//                                         background, glyph scaled into the
//                                         central safe zone (a circle 80% of
//                                         the icon's width), so any launcher
//                                         mask (circle, squircle) keeps it whole
//   apple-touch-icon.png (180)            full-bleed square; iOS rounds it
//
// Headless Chrome does the rasterising because it renders the SVG's gradient
// and drop-shadow filter exactly as browsers show icon.svg itself.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

const source = readFileSync(path.join(root, "public/icon.svg"), "utf8");

// The glyph is the <g filter="url(#lift)"> group; everything else is the
// background. Scaling the group about the centre moves it into the safe zone.
const GLYPH = /<g filter="url\(#lift\)" transform="([^"]*)">/;
if (!GLYPH.test(source)) throw new Error("icon.svg changed shape: update scripts/gen-icons.mjs");

/** The glyph's farthest point from the centre is ~335 of 512 (65%); 0.82
    brings it to ~54%, comfortably inside the 80% safe circle with its shadow. */
const MASKABLE_SCALE = 0.82;
const maskable = source.replace(
  GLYPH,
  (_m, t) => `<g filter="url(#lift)" transform="translate(512 512) scale(${MASKABLE_SCALE}) translate(-512 -512) ${t}">`,
);

function page(svg, size, radius) {
  const clip = radius ? `border-radius:${radius}%;overflow:hidden;` : "";
  return `<!doctype html><html><head><style>
html,body{margin:0;background:transparent}
div{width:${size}px;height:${size}px;${clip}}
svg{display:block;width:100%;height:100%}
</style></head><body><div>${svg}</div></body></html>`;
}

const outputs = [
  { file: "pwa-192.png", size: 192, svg: source, radius: 22 },
  { file: "pwa-512.png", size: 512, svg: source, radius: 22 },
  { file: "pwa-maskable-192.png", size: 192, svg: maskable, radius: 0 },
  { file: "pwa-maskable-512.png", size: 512, svg: maskable, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, svg: source, radius: 0 },
];

const tmp = mkdtempSync(path.join(tmpdir(), "hoppy-icons-"));
try {
  for (const { file, size, svg, radius } of outputs) {
    const html = path.join(tmp, `${file}.html`);
    writeFileSync(html, page(svg, size, radius));
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${path.join(root, "public", file)}`,
      `file://${html}`,
    ], { stdio: "ignore" });
    console.log(`public/${file} (${size}px)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
