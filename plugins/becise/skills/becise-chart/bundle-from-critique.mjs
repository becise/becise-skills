#!/usr/bin/env node
/**
 * bundle-from-critique.mjs — one-shot: a chart_critique result -> a chart bundle.
 *
 * Writes each result's `html` to <outDir>/<chart_id>.raw.html, then runs make-bundle.mjs to emit
 * <id>.web.html + <id>.artifact.html + manifest.json. isFallback charts are RECORDED in the manifest
 * (isFallback:true, no files) so downstream (build-gallery) can LIST them instead of dropping them.
 * Collapses "write N raw files + author bundle-input.json + invoke make-bundle" into one call.
 *
 * IMPORTANT: the chart HTML still passes through the caller once — it exists only inside the
 * chart_critique tool result, so nothing else can read it. This helper removes the per-file Write
 * dance and reformatting, not that single unavoidable emission. Prefer STDIN (arg length is capped;
 * a multi-chart result easily exceeds it).
 *
 * USAGE:  echo '<json>' | node bundle-from-critique.mjs [outDir]
 *         node bundle-from-critique.mjs '<json>'
 * INPUT:  { "outDir": "...", "result": <one chart_critique / rebuild_chart result> }
 *     OR: { "outDir": "...", "critiques": [ <result>, <result>, ... ] }   // MERGE many into one bundle
 *   Charts on different source images (different slides / PDF pages / screenshots) come back as
 *   SEPARATE calls → separate results. Pass them all under `critiques` to land them in ONE bundle +
 *   ONE manifest. `result`/each critique is shape-tolerant:
 *   {result:{results:[...]}}, {results:[...]}, [...], or a SINGLE chart object (rebuild_chart returns
 *   one chart per call): {chart_id, ...} / {results:{chart_id, ...}}.
 *   each item: {chart_id, html?, isFallback?, reason?, usage?}.
 *   `html` may be INLINE MARKUP or a URL (the server externalizes big documents to a presigned URL,
 *   ~3h TTL) — URL-mode html is fetched here and the fetched markup is bundled. A failed fetch skips
 *   that chart with a clear reason instead of sinking the bundle; presigned URLs expire, so bundle
 *   promptly and re-run the tool for a fresh URL if one has lapsed.
 * OUTPUT (stdout): { "bundled":[ids], "skipped":[{chart_id,reason,inputTokens,suspectWrongImage}],
 *                    "manifest":{...incl. fallback entries + payloadWarnings...},
 *                    "warning"?: "<low-token fallback: retry-to-disambiguate note>",
 *                    "brokenWarning"?: "<bundled-but-empty-HTML note>" }
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assertUniqueIds, manifestEntry, newManifest } from './make-bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function extractResults(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result?.result?.results)) return result.result.results;
  // rebuild_chart returns ONE chart per call — a bare chart object, possibly wrapped.
  for (const candidate of [result, result?.results, result?.result]) {
    if (candidate && typeof candidate === 'object' && typeof candidate.chart_id === 'string') return [candidate];
  }
  throw new Error('could not find results[] (or a single {chart_id, ...} chart) in a critique result');
}

// The server externalizes big chart documents: `html` arrives as a presigned URL, not markup.
// (data: URLs are honored too so the selftest can exercise this path with zero network.)
const URL_HTML = /^(https?:|data:)/i;

async function resolveHtml(it) {
  if (!URL_HTML.test(it.html.trim())) return it.html;
  const res = await fetch(it.html.trim(), { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`html URL fetch failed: HTTP ${res.status} (presigned URLs expire ~3h — re-run the tool for a fresh one)`);
  const body = await res.text();
  if (!body.trim()) throw new Error('html URL fetch returned an empty body');
  return body;
}

// One result (input.result) OR many (input.critiques: [result, ...]) → a flat list of chart items.
//
// Merging is where chart_ids collide: each source image is its own chart_critique call and each call
// numbers its charts from chart1, so slide 3 and slide 7 both yield "chart1". Left unchecked the
// second overwrites the first on disk and one chart silently vanishes from the deliverable — so
// validate ids BEFORE writing anything.
function collectItems(input) {
  const items = Array.isArray(input.critiques)
    ? input.critiques.flatMap(extractResults)
    : extractResults(input.result ?? input);
  if (input.onDuplicate === 'last-wins') {
    const byId = new Map();
    for (const it of items) byId.set(it.chart_id, it);
    return [...byId.values()];
  }
  assertUniqueIds(items.map(it => it.chart_id));
  return items;
}

// A fallback with very low input tokens means the image was barely processed. That's ambiguous:
// EITHER a wrong/blank/stale/mis-cropped upload (recoverable) OR a genuinely un-chartable chart
// (e.g. packed bubbles with no provenance). Flag it as worth ONE retry with a tighter crop to
// disambiguate — don't ship it as "can't rebuild" without that check. (~30k+ tokens = a real run.)
const SUSPECT_FALLBACK_INPUT_TOKENS = 15000;

// The chart HTML must pass through the caller once (it lives only in the tool result — there is NO
// harness auto-save of MCP results to disk, verified 2026-07-27), and that hand-off can drop the big
// config <script>, yielding HTML that bundles but renders EMPTY. The guard for that
// (looksLikeRealChart → manifest.payloadWarnings) lives in make-bundle.mjs so BOTH the fast path and
// a direct make-bundle call catch it; here we just surface manifest.payloadWarnings as brokenWarning.

async function main(input, outDirArg) {
  const outDir = input.outDir || outDirArg;
  if (!outDir) throw new Error('outDir is required (in JSON or as argv)');
  const items = collectItems(input);
  mkdirSync(outDir, { recursive: true });

  const charts = [];
  const skipped = [];
  const suspect = [];
  for (const it of items) {
    const id = it.chart_id;
    if (!id) throw new Error('each result item needs a chart_id');
    if (it.isFallback || !it.html) {
      const inputTokens = it.usage?.inputTokens ?? null;
      const suspectWrongImage = inputTokens != null && inputTokens < SUSPECT_FALLBACK_INPUT_TOKENS;
      skipped.push({ chart_id: id, reason: it.reason || 'isFallback / no html', inputTokens, suspectWrongImage });
      if (suspectWrongImage) suspect.push(id);
      continue;
    }
    let html;
    try {
      html = await resolveHtml(it);
    } catch (e) {
      // One expired/broken URL must not sink the other charts in the bundle.
      skipped.push({ chart_id: id, reason: e.message, inputTokens: it.usage?.inputTokens ?? null, suspectWrongImage: false });
      continue;
    }
    const rawPath = join(outDir, `${id}.raw.html`);
    writeFileSync(rawPath, html);
    charts.push({ chart_id: id, rawHtmlPath: rawPath });
  }
  // ALL results were fallbacks. Still emit a real bundle: a manifest that RECORDS every attempt is
  // the deliverable here ("we looked at these N charts and none could be rebuilt, for these reasons").
  // Crashing instead would leave an empty dir and no record — and would make fallback-recording
  // inconsistent, working for a partial failure but not a total one.
  let manifest;
  if (!charts.length) {
    manifest = newManifest();
  } else {
    // Reuse make-bundle.mjs verbatim so there is exactly one transform implementation.
    const mbInput = JSON.stringify({ outDir, charts });
    const stdout = execFileSync('node', [join(HERE, 'make-bundle.mjs'), mbInput], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    manifest = JSON.parse(stdout);
  }

  // Record fallbacks IN the manifest so downstream (build-gallery) can list them — otherwise a
  // "carry-through-flagged" chart vanishes from the deliverable entirely. Same entry shape as a
  // rebuilt chart (nulls, not missing keys) so a consumer never has to probe.
  for (const s of skipped) {
    manifest.charts.push(manifestEntry({
      chart_id: s.chart_id, key_insight: s.reason || null, isFallback: true,
    }));
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const out = { bundled: charts.map(c => c.chart_id), skipped, manifest };
  if (!charts.length) {
    out.nothingRebuilt = `All ${skipped.length} chart(s) came back isFallback — the bundle records ` +
      `them and their reasons, but there is nothing to render or publish. Report which charts failed ` +
      `and why; don't publish an empty gallery.`;
  }
  if (suspect.length) {
    out.warning = `Low-input-token fallback(s) — the image was barely processed, so EITHER a ` +
      `wrong/blank/stale/mis-cropped upload OR a genuinely un-chartable chart. Retry ONCE with a ` +
      `tighter crop of just that chart: if it rebuilds it was a bad image; if it returns an identical ` +
      `low-token fallback it's genuinely un-chartable. Charts: ${suspect.join(', ')}`;
  }
  if (Array.isArray(manifest.payloadWarnings) && manifest.payloadWarnings.length) {
    out.brokenWarning = `Bundled chart(s) with NO detectable chart payload — truncated / placeholder ` +
      `/ mis-transcribed HTML that will render EMPTY. Re-check the raw HTML before publishing. ` +
      `${manifest.payloadWarnings.join('; ')}`;
  }
  return out;
}

async function readInput() {
  const arg = process.argv[2];
  // If argv[2] looks like JSON, use it; else treat argv[2] as outDir and read JSON from stdin.
  if (arg && arg.trim().startsWith('{')) return { input: JSON.parse(arg), outDirArg: process.argv[3] };
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return { input: JSON.parse(Buffer.concat(chunks).toString('utf8')), outDirArg: arg };
}
readInput()
  .then(({ input, outDirArg }) => main(input, outDirArg))
  .then(m => process.stdout.write(JSON.stringify(m, null, 2) + '\n'))
  .catch(e => { console.error('bundle-from-critique error:', e.message); process.exit(1); });
