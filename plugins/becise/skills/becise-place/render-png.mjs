#!/usr/bin/env node
/**
 * render-png.mjs — becise-place render muscle (neutral, no Becise IP).
 *
 * Rasterize a self-contained becise-chart `web.html` into a PNG at a chosen size.
 * The chart is fluid (100vw/100vh). `.chart-shell` may be opaque; the page may stay transparent.
 * Output size is a render-time CHOICE — pass width/height. Renders the *web.html* (deps inlined by
 * a dead-proxy render still succeeds.
 *
 * USAGE:  node render-png.mjs '<json>'   |   echo '<json>' | node render-png.mjs
 * INPUT:  { "webHtmlPath": "...", "out": "...", "width": 900, "height": 560,
 *           "scale": 2, "virtualTimeMs": 6000, "background": "FFFFFFFF", "offline": false }
 * OUTPUT (stdout): { "out": "<abs path>", "bytes": <n>, "width": w, "height": h, "chrome": "<path>" }
 *
 * Verify the PNG by Reading it before using it (see SKILL.md). To place it into a container,
 * host via get_upload_url -> PUT -> downloadUrl and fire the placement immediately (~300s TTL).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';

// Common Chrome/Chromium locations by platform; first that exists wins. Override with $CHROME.
const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
].filter(Boolean);

function findChrome() {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  throw new Error(`no Chrome/Chromium found (tried: ${CANDIDATES.join(', ')}). Set $CHROME to override.`);
}

function main(input) {
  const webHtmlPath = input.webHtmlPath && resolve(input.webHtmlPath);
  if (!webHtmlPath || !existsSync(webHtmlPath)) throw new Error(`webHtmlPath not found: ${input.webHtmlPath}`);
  const out = input.out ? (isAbsolute(input.out) ? input.out : resolve(input.out))
                        : webHtmlPath.replace(/\.web\.html$/, '').replace(/\.html$/, '') + '.png';
  const width = input.width || 900;
  const height = input.height || 560;
  const scale = input.scale || 2;
  const vt = input.virtualTimeMs || 6000;
  const bg = input.background || 'FFFFFFFF';

  mkdirSync(dirname(out), { recursive: true });
  const chrome = findChrome();

  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--default-background-color=${bg}`,
    `--force-device-scale-factor=${scale}`,
    `--virtual-time-budget=${vt}`,
    `--window-size=${width},${height}`,
    // offline proof: route all network through a dead proxy so any external fetch fails fast.
    ...(input.offline ? ['--proxy-server=127.0.0.1:1'] : []),
    `--screenshot=${out}`,
    `file://${webHtmlPath}`,
  ];

  execFileSync(chrome, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  if (!existsSync(out)) throw new Error('Chrome did not produce a screenshot');
  const bytes = statSync(out).size;
  if (bytes < 1000) throw new Error(`screenshot suspiciously small (${bytes}b) — chart likely did not render`);
  return { out, bytes, width, height, chrome };
}

async function readInput() {
  const arg = process.argv[2];
  if (arg && arg !== '-') return JSON.parse(arg);
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
readInput()
  .then(main)
  .then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n'))
  .catch(e => { console.error('render-png error:', e.message); process.exit(1); });
