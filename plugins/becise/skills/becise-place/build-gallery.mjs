#!/usr/bin/env node
/**
 * build-gallery.mjs — becise-place: compose a bundle dir into ONE live-chart gallery page. No Chrome.
 *
 * Reads <dir>/manifest.json and, for every non-fallback chart, mounts its self-contained
 * <id>.web.html SAME-PAGE: vendor libs deduped and emitted once, each chart's markup mounted in a
 * sized card with its DOM ids suffixed (`id="chart"` -> `id="chart--<chart_id>"`), and its config
 * scripts wrapped in one IIFE so N charts' top-level `const`s never collide at page scope.
 *
 * NO IFRAMES. The previous srcdoc-iframe isolation (validated under the Artifact CSP 2026-07-24)
 * rendered blank under the claude.ai/code Artifact CSP by 2026-07-29 — `frame-src` style policies
 * don't admit `about:srcdoc`, and a host policy change silently blanks every chart. Same-page
 * mounting has no frame-policy dependency: if the fragment renders, the gallery renders.
 *
 * USAGE:  node build-gallery.mjs '<json>'   |   echo '<json>' | node build-gallery.mjs
 * INPUT:  { "dir": "<bundle dir>", "out": "<gallery.html>",
 *           "title"?: "...", "subtitle"?: "...", "heights"?: { "<chart_id>": <px> }, "defaultHeight"?: 460 }
 * Then publish <out> with the Artifact tool.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// DOM-id-safe suffix from a chart_id (chart_ids are filename-safe already; belt and braces).
function idSuffix(chartId) { return String(chartId).replace(/[^A-Za-z0-9_-]/g, '_'); }

// Pull <head> CSS, <head> scripts and <body> out of a self-contained web.html.
function splitDocument(webHtml) {
  const headM = webHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headM ? headM[1] : '';
  const styleM = head.match(/<style>([\s\S]*?)<\/style>/i);
  const css = styleM ? styleM[1] : '';
  // Src-less head scripts are the vendored libs make-bundle inlined (Chart.js etc.).
  const headScripts = [...head.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)].map(m => m[0]);
  // Tolerate a missing </body> (Becise sometimes emits </script></html> with no closing body tag).
  const bodyM = webHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    || webHtml.match(/<body[^>]*>([\s\S]*?)(?:<\/html>\s*)?$/i);
  const body = bodyM ? bodyM[1] : webHtml;
  return { css, headScripts, body };
}

// Fragment CSS, made safe at page scope: the html/body sizing rule goes (it would fight the gallery
// page), and the universal `* { margin:0; … }` reset is scoped to the chart mounts so it can't
// flatten the gallery chrome's own spacing.
function scopeFragmentCss(css) {
  css = css.replace(/html\s*,\s*body\s*\{[^}]*\}/gi, '');
  css = css.replace(/(^|\n)(\s*)\*\s*\{/g, '$1$2.becise-embed, .becise-embed * {');
  return css.trim();
}

// Split a fragment body into inert markup and its executable script code. Data blocks
// (type="application/json", e.g. becise-metadata) stay in the markup; src-less JS is extracted for
// scoping. Module scripts keep their own scope by spec, so they stay in place untouched.
function splitBody(body, chartId, warnings) {
  const codes = [];
  const markup = body.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, code) => {
    const typeM = attrs.match(/\btype\s*=\s*(["'])(.*?)\1/i);
    const type = typeM ? typeM[2].trim().toLowerCase() : '';
    if (type && type !== 'text/javascript') return whole;
    if (/\bsrc\s*=/i.test(attrs)) {
      warnings.push(`[${chartId}] body <script src> left in place — should have been inlined by make-bundle`);
      return whole;
    }
    codes.push(code);
    return '';
  });
  return { markup, codes };
}

// Every id in the mounted markup gets a per-chart suffix, and every literal getElementById lookup
// in the chart's code gets the same suffix, so N mounted charts can't capture each other's nodes.
function suffixMarkupIds(markup, sfx) {
  return markup.replace(/\bid\s*=\s*(["'])([^"']+)\1/gi, (m, q, v) => `id=${q}${v}--${sfx}${q}`);
}
function suffixIdLookups(code, sfx, chartId, warnings) {
  code = code.replace(/getElementById\(\s*(["'])([^"']+)\1\s*\)/g,
    (m, q, v) => `getElementById(${q}${v}--${sfx}${q})`);
  if (/querySelector(?:All)?\(\s*["']#/.test(code)) {
    warnings.push(`[${chartId}] code uses querySelector('#…'); markup ids carry a --${sfx} suffix, the selector may miss`);
  }
  return code;
}

function main(input) {
  const { dir, out } = input;
  if (!dir || !out) throw new Error('dir and out are required');
  const defaultHeight = input.defaultHeight || 460;
  const heights = input.heights || {};
  const warnings = [];
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

  const live = manifest.charts.filter(c => !c.isFallback && !c.emptyPayload && c.files?.web);
  const fallback = manifest.charts.filter(c => c.isFallback || c.emptyPayload || !c.files?.web);

  // Vendor scripts and fragment CSS are identical across charts — emit each unique one ONCE,
  // ahead of every mounted chart's code.
  const vendorScripts = [];
  const vendorSeen = new Set();
  const fragmentCss = [];
  const cssSeen = new Set();

  const cards = live.map(c => {
    const web = readFileSync(join(dir, c.files.web), 'utf8');
    const sfx = idSuffix(c.chart_id);
    const h = heights[c.chart_id] || defaultHeight;

    const { css, headScripts, body } = splitDocument(web);
    const scopedCss = scopeFragmentCss(css);
    if (scopedCss && !cssSeen.has(scopedCss)) { cssSeen.add(scopedCss); fragmentCss.push(scopedCss); }
    for (const tag of headScripts) {
      if (!vendorSeen.has(tag)) { vendorSeen.add(tag); vendorScripts.push(tag); }
    }

    const { markup, codes } = splitBody(body, c.chart_id, warnings);
    const mounted = suffixMarkupIds(markup, sfx).trim();
    const code = codes.map(x => suffixIdLookups(x, sfx, c.chart_id, warnings)).join('\n;\n');

    // One IIFE per chart: the fragment's script blocks share top-level helpers, so they are scoped
    // TOGETHER, never per-block. No 'use strict' — emitted chart code has been observed to assign
    // undeclared globals (sloppy-mode legal); strict mode would throw and blank the chart.
    // Charts that already stitch .chart-eyebrow (operation) + headline (finding)
    // must not also print key_insight above the mount — that duplicates the
    // finding. Older HTML has no eyebrow; keep the gallery caption.
    const chartHasTitleBlock = /class=["'][^"']*chart-eyebrow/.test(mounted);

    return `<article class="card">
  <div class="card-head">
    <div class="titles"><p class="eyebrow">${escText(c.chart_id)}</p><h2>${escText(c.title || c.chart_id)}</h2></div>
    <span class="chip">${escText(c.chart_type || '?')}</span>
  </div>
  ${(!chartHasTitleBlock && c.key_insight) ? `<p class="insight">${escText(c.key_insight)}</p>` : ''}
  <div class="frame becise-embed" style="height:${h}px">
${mounted}
  </div>
</article>
<script>
(function () {
${code}
})();
</script>`;
  }).join('\n');

  const fallbackNote = fallback.length
    ? `<p class="fallback">Not rebuilt (${fallback.length}): ${fallback.map(f => escText(f.chart_id)).join(', ')}</p>` : '';

  const title = escText(input.title || `${live.length} live chart rebuilds`);
  const subtitle = input.subtitle ? escText(input.subtitle)
    : 'Each chart runs live — real Chart.js, not a screenshot.';

  const doc = `<style>
:root{--bg:#F7F8FA;--panel:#fff;--ink:#14161C;--soft:#4A4F5C;--faint:#868C99;--line:#E4E7EC;--accent:#1342FB;--accent-soft:#E7ECFF;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--shadow:0 1px 2px rgba(20,22,28,.05),0 4px 16px rgba(20,22,28,.04);}
@media(prefers-color-scheme:dark){:root{--bg:#0F1116;--panel:#171A21;--ink:#EDEFF3;--soft:#AEB4C0;--faint:#737A88;--line:#262A33;--accent:#6E8BFF;--accent-soft:#1C2440;--shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.28);}}
:root[data-theme="light"]{--bg:#F7F8FA;--panel:#fff;--ink:#14161C;--soft:#4A4F5C;--faint:#868C99;--line:#E4E7EC;--accent:#1342FB;--accent-soft:#E7ECFF;--shadow:0 1px 2px rgba(20,22,28,.05),0 4px 16px rgba(20,22,28,.04);}
:root[data-theme="dark"]{--bg:#0F1116;--panel:#171A21;--ink:#EDEFF3;--soft:#AEB4C0;--faint:#737A88;--line:#262A33;--accent:#6E8BFF;--accent-soft:#1C2440;--shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.28);}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;line-height:1.5;}
.wrap{max-width:960px;margin:0 auto;padding:0 24px 72px;}
header{padding:52px 0 8px;max-width:640px;}
.kicker{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 12px;}
h1{font-size:clamp(28px,4vw,42px);line-height:1.05;letter-spacing:-.02em;margin:0 0 14px;font-weight:660;text-wrap:balance;}
.sub{font-size:16px;color:var(--soft);margin:0;}
main{display:flex;flex-direction:column;gap:22px;margin-top:36px;}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px 22px;box-shadow:var(--shadow);}
.card-head{display:flex;align-items:flex-start;gap:14px;margin-bottom:6px;}
.titles{flex:1;min-width:0;}
.eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;color:var(--faint);margin:0 0 3px;}
h2{margin:0;font-size:18px;font-weight:620;letter-spacing:-.01em;text-wrap:balance;}
.chip{flex-shrink:0;font-family:var(--mono);font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:999px;background:var(--accent-soft);color:var(--accent);white-space:nowrap;}
.insight{margin:8px 0 14px;font-size:14.5px;color:var(--soft);}
.frame{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;}
.fallback{margin:26px 0 0;font-size:13px;color:var(--faint);}
</style>
<style>
${fragmentCss.join('\n')}
</style>
${vendorScripts.join('\n')}
<div class="wrap">
<header><p class="kicker">Becise · live chart rebuilds</p><h1>${title}</h1><p class="sub">${subtitle}</p></header>
<main>
${cards}
</main>
${fallbackNote}
</div>
`;

  writeFileSync(out, doc);
  return { out, live: live.length, fallback: fallback.length, warnings };
}

async function readInput() {
  const arg = process.argv[2];
  if (arg && arg !== '-') return JSON.parse(arg);
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
readInput().then(main).then(r => process.stdout.write(JSON.stringify(r) + '\n'))
  .catch(e => { console.error('build-gallery error:', e.message); process.exit(1); });
