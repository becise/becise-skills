#!/usr/bin/env node
/**
 * make-bundle.mjs — becise-chart core transform (neutral, no Becise IP).
 *
 * Turns the raw HTML that `chart_critique` returns (one self-contained chart page per chart,
 * but with its JS/font pulled from CDNs) into a portable "chart bundle" on disk that any
 * downstream destination can consume.
 *
 * For each chart it writes:
 *   <id>.raw.html       — exactly what Becise returned (CDN deps intact; for reference/re-processing)
 *   <id>.web.html       — self-contained standalone page (deps INLINED; open/host/iframe anywhere, offline)
 *   <id>.artifact.html  — body-fragment for the Artifact tool (deps inlined, no <html>/<head>/<body>,
 *                         sized host card so the fluid chart doesn't collapse, readable on any theme)
 * and a shared manifest.json describing every chart (auto-filled from the embedded becise-metadata).
 *
 * The PNG (<id>.png) is produced separately by the caller (headless Chrome on <id>.web.html) — see SKILL.md.
 *
 * USAGE:  node make-bundle.mjs '<json>'   |   echo '<json>' | node make-bundle.mjs
 * INPUT:  { "outDir": "...", "vendorDir": "...", "charts": [ { "chart_id": "...", "rawHtmlPath": "..." } ] }
 * OUTPUT (stdout): the manifest JSON (also written to <outDir>/manifest.json).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_STACK = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Bump when the manifest's shape changes in a way a consumer must notice.
export const MANIFEST_VERSION = 1;

// npm-package substring -> vendored filename. Add rows here as Becise introduces new deps.
const VENDOR_MAP = [
  { pkg: 'chart.js',                   file: 'chart.umd.min.js',                       version: '4.4.7' },
  { pkg: 'chartjs-adapter-date-fns',   file: 'chartjs-adapter-date-fns.bundle.min.js', version: '3.0.0' },
  { pkg: 'chartjs-plugin-datalabels',  file: 'chartjs-plugin-datalabels.min.js',       version: '2.2.0' },
];

// Brand webfonts vendored for embedding. Unlike VENDOR_MAP (matched against a
// <script src> URL), a font is matched against the family NAME the chart's own
// CSS declares — a Google Fonts <link> carries no version to pin, and the font
// never arrives as a URL the inliner can intercept. Add a row here for each
// brand font the org theme can declare; the bundled Artifact/web pages have no
// network access to fetch it live, so embedding is the only way it renders.
const FONT_MAP = [
  { family: 'DM Sans', weights: { 400: 'DMSans-Regular.ttf', 700: 'DMSans-Bold.ttf' } },
];

function readVendor(vendorDir, file) {
  return readFileSync(join(vendorDir, file), 'utf8');
}

// First family in a CSS font-family stack, quotes stripped:
// "'DM Sans', Inter, sans-serif" -> "DM Sans"
function firstFontFamily(stack) {
  const first = String(stack).split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '');
}

// Embed a vendored brand webfont as a base64 @font-face when the chart's own
// html,body CSS rule declares one we carry in FONT_MAP. Detection reads the
// SAME value the chart declares — not a hardcoded org assumption — so this
// works for whichever brand font is actually in play, not just the current
// one. Prepends into the EXISTING <style> block (never adds a second one):
// toArtifactFragment assumes exactly one <style> element in <head>, and a
// second block would silently steal that extraction, dropping every real
// chart-shell/title/legend rule from the Artifact fragment.
function embedBrandFont(html, vendorDir) {
  const m = html.match(/html\s*,\s*body\s*\{[^}]*font-family:\s*([^;]+);/i);
  if (!m) return { html, embedded: null };
  const hit = FONT_MAP.find(f => f.family === firstFontFamily(m[1]));
  if (!hit) return { html, embedded: null };

  const faces = Object.entries(hit.weights).map(([weight, file]) => {
    const b64 = readFileSync(join(vendorDir, file)).toString('base64');
    return `@font-face { font-family: '${hit.family}'; font-weight: ${weight}; font-style: normal; ` +
      `src: url(data:font/ttf;base64,${b64}) format('truetype'); }`;
  }).join('\n');

  const embedded = /<style[^>]*>/i.test(html)
    ? html.replace(/<style([^>]*)>/i, (_tag, attrs) => `<style${attrs}>\n${faces}\n`)
    : /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (tag) => `${tag}\n<style>\n${faces}\n</style>\n`)
      : `<style>\n${faces}\n</style>\n${html}`;

  return { html: embedded, embedded: hit.family };
}

// The version the page's CDN URL actually asks for, e.g. ".../chart.js@4.4.7/dist/..." -> "4.4.7".
// Null when the URL pins no version (e.g. "chart.js@4" or a bare package path).
function requestedVersion(src, pkg) {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = src.match(new RegExp(esc + '@(\\d+\\.\\d+\\.\\d+)'));
  return m ? m[1] : null;
}

// Replace every <script src="EXTERNAL"></script> with an inline <script> of the vendored lib.
// Drop external stylesheet <link>s (e.g. Google Fonts) — the font-family stack falls back locally.
// Quote style is NOT assumed: Becise emits double quotes today, but a single-quoted src that slipped
// through would leave a live CDN ref in a page we certify as self-contained (CSP/offline break).
// Returns { html, deps, warnings }.
function inlineExternals(html, vendorDir) {
  const deps = [];
  const warnings = [];

  const { html: withFont, embedded: embeddedFont } = embedBrandFont(html, vendorDir);
  html = withFont;

  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script>/gi, (whole, _q, src) => {
    if (!/^https?:\/\//i.test(src)) return whole; // already local/inline
    const hit = VENDOR_MAP.find(v => src.includes(v.pkg));
    if (!hit) { warnings.push(`unrecognized external script left in place: ${src}`); return whole; }
    // A Becise version bump must not silently inline the wrong library.
    const want = requestedVersion(src, hit.pkg);
    if (want && want !== hit.version) {
      warnings.push(`VENDOR VERSION MISMATCH: page requests ${hit.pkg}@${want}, vendor/ has ` +
        `${hit.version} (inlined ${hit.version}). Update vendor/${hit.file} + VENDOR_MAP together.`);
    }
    const id = `${hit.pkg}@${hit.version}`;
    deps.push(id);
    return `<script>\n/* inlined: ${id} */\n${readVendor(vendorDir, hit.file)}\n</script>`;
  });

  html = html.replace(/<link\b[^>]*\bhref\s*=\s*(["'])(https?:\/\/.*?)\1[^>]*>/gi, (whole, _q, href) => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) return ''; // font: rely on fallback stack
    warnings.push(`unrecognized external link left in place: ${href}`);
    return whole;
  });

  // No brand font vendored for this chart's declared family — nudge the CSS
  // fallback to robust, near-universally-installed system fonts instead.
  // (Skipped when a brand font was embedded above: that font IS present, so
  // swapping the fallback stack out from under it would be pointless.)
  if (!embeddedFont) {
    html = html.replaceAll('Inter, sans-serif', FONT_STACK);
  }

  return { html, deps, warnings, embeddedFont };
}

// The server has been observed emitting the prompt's literal placeholders as metadata
// ({"chart_title":"<chart_title>", …}, incident 2026-07-31). A truthy placeholder title
// suppresses the real <h1> fallback below and leaks "<key_insight>" into gallery captions —
// treat placeholder values as absent.
const METADATA_PLACEHOLDER_RE = /^<\w+>$/;

function extractMetadata(html) {
  const m = html.match(/<script[^>]*id=["']becise-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const meta = JSON.parse(m[1].trim());
      if (meta && typeof meta === 'object') {
        for (const [k, v] of Object.entries(meta)) {
          if (typeof v === 'string' && METADATA_PLACEHOLDER_RE.test(v)) meta[k] = null;
        }
        return meta;
      }
    } catch { /* fall through */ }
  }
  return {};
}

// ── Inline-JS syntax gate (FINAL SPEC S10) ─────────────────────────────────
// A chart whose helper <script> has a hard SyntaxError bundles cleanly, publishes,
// and renders BLANK (incident 2026-07-31: model-side backslash doubling). Compile
// (never execute) each inline classic-JS script of the RAW html; failures fold into
// emptyPayload — no new manifest key, so every existing consumer's emptyPayload
// guard already protects it. Vendored libs are still src= refs at raw stage → skipped.
const JS_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export function scriptSyntaxErrors(html) {
  const failures = [];
  try {
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m, i = -1;
    while ((m = re.exec(html)) !== null) {
      i++;
      const attrs = m[1] || '';
      if (/(?:^|[\s"'])src\s*=/i.test(attrs)) continue; // external — browser ignores the body
      const t = /(?:^|[\s"'])type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (t && !JS_SCRIPT_TYPES.has((t[1] ?? t[2] ?? t[3] ?? '').trim().toLowerCase())) continue;
      try {
        new vm.Script(m[2]); // compiles only, never executes
      } catch (e) {
        failures.push({ scriptIndex: i, error: String(e?.message ?? e) });
      }
    }
  } catch {
    // Validator bug must never block bundling — fail open (parse errors above are the
    // only fail-closed path).
    return [];
  }
  return failures;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '').trim();
}

// Prefer the operation (eyebrow) over the finding (h1.chart-title). After the
// chart-visual-craft shell, .chart-title is key_insight — using it as
// manifest.title would put a sentence in gallery chrome that the chart already
// paints. Older HTML has no eyebrow; fall through to the h1.
export function extractTitle(html) {
  const eyebrow = html.match(/<(?:p|div)[^>]*class=["'][^"']*chart-eyebrow[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i);
  if (eyebrow) {
    const t = stripTags(eyebrow[1]);
    if (t) return t;
  }
  const h1 = html.match(/<h1[^>]*class=["'][^"']*chart-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? stripTags(h1[1]) : '';
}

// Build the Artifact body-fragment: strip document scaffolding, drop the html/body sizing rule
// (it would fight the Artifact host), and wrap the chart in an explicitly-sized white card so the
// fluid canvas has a height to fill and reads on either theme.
function toArtifactFragment(webHtml, title) {
  const headM = webHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headM ? headM[1] : '';

  const styleM = head.match(/<style>([\s\S]*?)<\/style>/i);
  let css = styleM ? styleM[1] : '';
  css = css.replace(/html\s*,\s*body\s*\{[^}]*\}/i, ''); // remove 100vw/100vh/transparent on the page itself

  // The inlined library <script>s live in <head>; they must execute before the body's config script.
  // (External <script src> refs are already inlined by inlineExternals, so match src-less scripts.)
  const headScripts = [...head.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)]
    .map(m => m[0]).join('\n');

  // Tolerate a missing </body> (Becise sometimes emits </script></html> with no closing body tag):
  // fall back to "from <body> to </html>/end".
  const bodyM = webHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    || webHtml.match(/<body[^>]*>([\s\S]*?)(?:<\/html>\s*)?$/i);
  const body = bodyM ? bodyM[1] : webHtml;

  const hostCss = `
#becise-artifact-host { max-width: 1000px; margin: 32px auto; padding: 16px 20px;
  height: min(78vh, 640px); background: #ffffff; border-radius: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); box-sizing: border-box; }
#becise-artifact-host .chart-shell { height: 100%; }`;

  return `<style>\n${css}\n${hostCss}\n</style>\n${headScripts}\n<div id="becise-artifact-host">\n${body}\n</div>\n`;
}

// A real Becise chart carries a data payload (Chart.js call, grid table, or inline SVG). HTML
// missing it still bundles but renders EMPTY — flag it. Causes seen in the field: truncated
// fetches, and (2026-07-31) the SERVER emitting corrupted markup — under URL mode the bytes
// arrive fetched-from-S3, so breakage is not a caller hand-off problem. Lives here (not just in
// bundle-from-critique) so BOTH entry paths get the guard.
function looksLikeRealChart(html) {
  if (!html || html.length < 800) return false;
  return /new Chart\s*\(|becise-grid|canonicalData|\brawData\b|const\s+series|<svg|<polyline/i.test(html);
}

// chart_ids are the bundle's filenames AND its manifest keys, so a duplicate is silent DATA LOSS:
// the second chart's <id>.raw.html overwrites the first, and the manifest ends up with two entries
// pointing at one file. This bites hardest on the flagship multi-view flow, where each source image
// gets its own chart_critique call and each call numbers its charts from chart1 independently.
export function assertUniqueIds(ids) {
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) { if (!dupes.includes(id)) dupes.push(id); }
    seen.add(id);
  }
  if (dupes.length) {
    throw new Error(
      `duplicate chart_id(s): ${dupes.join(', ')}. chart_ids must be unique across ALL charts in a ` +
      `bundle, including charts from different source images. Prefix by source view when you author ` +
      `them (slide3_chart1, page9_chart1) so the id carries provenance. ` +
      `If this is an intentional re-run of the SAME chart and the later result should win, ` +
      `pass "onDuplicate":"last-wins".`,
    );
  }
}

// EVERY manifest entry has this shape — rebuilt or fallback, so a consumer never has to probe for
// optional keys. Paths in `files` are RELATIVE to the bundle dir; `png` is null until something
// renders it (becise-place does; make-bundle never has).
export function manifestEntry(o) {
  return {
    chart_id: o.chart_id,
    chart_type: o.chart_type ?? null,
    title: o.title ?? null,
    key_insight: o.key_insight ?? null,
    background: o.background ?? null,
    fluid: o.fluid ?? null,
    vendorized_deps: o.vendorized_deps ?? [],
    source_ref: o.source_ref ?? null,
    isFallback: !!o.isFallback,
    emptyPayload: !!o.emptyPayload,
    files: { raw: null, web: null, artifact: null, png: null, ...(o.files || {}) },
  };
}

export function newManifest() {
  return {
    manifest_version: MANIFEST_VERSION,
    generated_by: 'becise-chart',
    charts: [], warnings: [], payloadWarnings: [],
  };
}

// "last-wins" is the deliberate escape hatch for re-running ONE chart (e.g. the tighter-crop retry
// after a low-token fallback): keep the later result, drop the earlier, and say so in the manifest.
export function resolveDuplicates(charts, onDuplicate, warnings = []) {
  if (onDuplicate !== 'last-wins') { assertUniqueIds(charts.map(c => c.chart_id)); return charts; }
  const byId = new Map();
  for (const c of charts) {
    if (byId.has(c.chart_id)) warnings.push(`[${c.chart_id}] duplicate chart_id — later result kept (onDuplicate:last-wins)`);
    byId.set(c.chart_id, c);
  }
  return [...byId.values()];
}

function main(input) {
  const { outDir } = input;
  const vendorDir = input.vendorDir || join(HERE, 'vendor');
  if (!outDir) throw new Error('outDir is required');
  if (!Array.isArray(input.charts) || !input.charts.length) throw new Error('charts[] is required');
  const dupWarnings = [];
  const charts = resolveDuplicates(input.charts, input.onDuplicate, dupWarnings);
  mkdirSync(outDir, { recursive: true });

  const manifest = newManifest();
  manifest.warnings.push(...dupWarnings);

  for (const c of charts) {
    const id = c.chart_id;
    if (!id) throw new Error('each chart needs a chart_id');
    const raw = readFileSync(c.rawHtmlPath, 'utf8');
    const meta = extractMetadata(raw);
    const { html: web, deps, warnings } = inlineExternals(raw, vendorDir);
    const artifact = toArtifactFragment(web, meta.chart_title || extractTitle(raw));

    const files = {
      raw: `${id}.raw.html`, web: `${id}.web.html`, artifact: `${id}.artifact.html`, png: null,
    };
    writeFileSync(join(outDir, files.raw), raw);
    writeFileSync(join(outDir, files.web), web);
    writeFileSync(join(outDir, files.artifact), artifact);

    // Any external ref surviving in the standalone page is a real problem (CSP / offline will break).
    // This is the LAST line of defence, so it must not share the transform's blind spots: it matches
    // double-quoted, single-quoted AND unquoted attrs. (A detector that only sees what the inliner
    // sees would certify a broken bundle as clean.)
    const leftover = [...web.matchAll(
      /(?:src|href)\s*=\s*(?:(["'])(https?:\/\/.*?)\1|(https?:\/\/[^\s>]+))/gi,
    )].map(m => m[2] ?? m[3]);
    for (const u of leftover) warnings.push(`EXTERNAL REF NOT INLINED in web.html: ${u}`);

    const syntaxFailures = scriptSyntaxErrors(raw);
    const emptyPayload = !looksLikeRealChart(raw) || syntaxFailures.length > 0;
    manifest.charts.push(manifestEntry({
      chart_id: id,
      chart_type: meta.chart_type || null,
      title: meta.chart_title || extractTitle(raw) || null,
      key_insight: meta.key_insight || c.description || null,
      background: 'transparent',
      fluid: true,
      vendorized_deps: deps,
      source_ref: c.source_ref || null,
      isFallback: !!c.isFallback,
      emptyPayload,
      files,
    }));
    manifest.warnings.push(...warnings.map(w => `[${id}] ${w}`));
    if (syntaxFailures.length > 0) {
      for (const f of syntaxFailures) {
        manifest.payloadWarnings.push(
          `[${id}] JS syntax error in inline script #${f.scriptIndex}: ${f.error} — the server emitted ` +
          `broken code; the chart will render EMPTY. Re-run the tool once for this chart; if it recurs, report it.`
        );
      }
    } else if (emptyPayload) {
      manifest.payloadWarnings.push(`[${id}] HTML has no detectable chart payload — likely truncated/placeholder/mis-transcribed; will render EMPTY`);
    }
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

async function readInput() {
  const arg = process.argv[2];
  if (arg && arg !== '-') return JSON.parse(arg);
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Run the CLI only when invoked directly — bundle-from-critique.mjs imports the shared
// manifest shape from here, and importing must not execute the CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readInput()
    .then(main)
    .then(m => process.stdout.write(JSON.stringify(m, null, 2) + '\n'))
    .catch(e => { console.error('make-bundle error:', e.message); process.exit(1); });
}
