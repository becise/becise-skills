#!/usr/bin/env node
/**
 * build-gallery.mjs — becise-place: compose a bundle dir into ONE live-chart gallery page. No Chrome.
 *
 * Reads <dir>/manifest.json and, for every non-fallback chart, embeds its self-contained
 * <id>.web.html in an isolated <iframe srcdoc="…">. Frames isolate scope so N charts' scripts never
 * collide (concatenating artifact.html fragments would). Output is a body fragment ready for the
 * Artifact tool (no <html>/<head>/<body> of its own). Fallback charts are listed, never embedded.
 *
 * Frames carry sandbox="allow-scripts" — deliberately WITHOUT allow-same-origin, which is exactly
 * right for a Chart.js page (it needs script execution, not storage or parent access) and is worth
 * having on a customer-facing deliverable.
 *
 * USAGE:  node build-gallery.mjs '<json>'
 * INPUT:  { "dir": "<bundle dir>", "out": "<gallery.html>",
 *           "title"?: "...", "subtitle"?: "...", "heights"?: { "<chart_id>": <px> }, "defaultHeight"?: 460 }
 * Then publish <out> with the Artifact tool.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function esc(s) { // full entity-escape for a "-quoted srcdoc attr (decodes back before the iframe parses)
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function main(input) {
  const { dir, out } = input;
  if (!dir || !out) throw new Error('dir and out are required');
  const defaultHeight = input.defaultHeight || 460;
  const heights = input.heights || {};
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

  const live = manifest.charts.filter(c => !c.isFallback && c.files?.web);
  const fallback = manifest.charts.filter(c => c.isFallback || !c.files?.web);

  const cards = live.map(c => {
    const web = readFileSync(join(dir, c.files.web), 'utf8');
    const h = heights[c.chart_id] || defaultHeight;
    return `<article class="card">
  <div class="card-head">
    <div class="titles"><p class="eyebrow">${escText(c.chart_id)}</p><h2>${escText(c.title || c.chart_id)}</h2></div>
    <span class="chip">${escText(c.chart_type || '?')}</span>
  </div>
  ${c.key_insight ? `<p class="insight">${escText(c.key_insight)}</p>` : ''}
  <div class="frame" style="height:${h}px"><iframe title="${esc(c.title || c.chart_id)}" loading="lazy" sandbox="allow-scripts" srcdoc="${esc(web)}"></iframe></div>
</article>`;
  }).join('\n');

  const fallbackNote = fallback.length
    ? `<p class="fallback">Not rebuilt (${fallback.length}): ${fallback.map(f => escText(f.chart_id)).join(', ')}</p>` : '';

  const title = escText(input.title || `${live.length} live chart rebuilds`);
  const subtitle = input.subtitle ? escText(input.subtitle)
    : 'Each chart runs live — real Chart.js in an isolated frame, not a screenshot.';

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
.frame{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;}
.frame iframe{width:100%;height:100%;border:0;display:block;background:#fff;}
.fallback{margin:26px 0 0;font-size:13px;color:var(--faint);}
</style>
<div class="wrap">
<header><p class="kicker">Becise · live chart rebuilds</p><h1>${title}</h1><p class="sub">${subtitle}</p></header>
<main>
${cards}
</main>
${fallbackNote}
</div>
`;

  writeFileSync(out, doc);
  return { out, live: live.length, fallback: fallback.length };
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
