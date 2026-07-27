#!/usr/bin/env node
/**
 * selftest.mjs — regression fixtures for the four silent-failure modes found 2026-07-27.
 *
 * Every one of these used to produce plausible-looking output with an empty `warnings` array, which
 * is the dangerous shape: make-bundle says clean, becise-place trusts that, and the customer opens a
 * link to a chart that is wrong or missing. Run after touching make-bundle / bundle-from-critique:
 *
 *   node <SKILL_DIR>/selftest.mjs
 *
 * Exits non-zero on the first failure. No network, no Chrome, no MCP calls.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAKE = join(HERE, 'make-bundle.mjs');
const FROM = join(HERE, 'bundle-from-critique.mjs');

let failures = 0;
function check(name, fn) {
  try { fn(); process.stdout.write(`  ok   ${name}\n`); }
  catch (e) { failures++; process.stdout.write(`  FAIL ${name}\n         ${e.message}\n`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// A Becise-shaped chart page. `quote` lets us prove the inliner isn't quote-sensitive.
function chartHtml({ title, quote = '"' } = {}) {
  const q = quote;
  return `<!DOCTYPE html><html><head>
<script id="becise-metadata" type="application/json">${JSON.stringify({ chart_type: 'bar', chart_title: title, key_insight: `${title} insight` })}</script>
<script src=${q}https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js${q}></script>
<link href=${q}https://fonts.googleapis.com/css2?family=Inter${q} rel="stylesheet" />
<style>html,body{width:100vw;height:100vh;background:transparent}</style></head>
<body><div class="chart-shell"><h1 class="chart-title">${title}</h1><canvas id="c"></canvas></div>
<script>const series=[{x:'A',y:1},{x:'B',y:2}];
new Chart(document.getElementById('c'),{type:'bar',data:{}});
/* ${'pad '.repeat(220)} */</script></body></html>`;
}

function run(script, json) {
  const out = execFileSync('node', [script], { input: JSON.stringify(json), encoding: 'utf8', maxBuffer: 64e6 });
  return JSON.parse(out);
}
function runExpectFail(script, json) {
  try {
    execFileSync('node', [script], { input: JSON.stringify(json), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return String(e.stderr || ''); }
  throw new Error('expected a non-zero exit, got success');
}

const tmp = mkdtempSync(join(tmpdir(), 'becise-selftest-'));
const dir = n => join(tmp, n);

process.stdout.write('becise-chart selftest\n');

// 1. Two source images whose charts are both named chart1 must NOT silently collapse into one.
check('duplicate chart_id across critiques[] is rejected, not silently overwritten', () => {
  const err = runExpectFail(FROM, {
    outDir: dir('dup'),
    critiques: [
      { results: [{ chart_id: 'chart1', html: chartHtml({ title: 'Revenue by region' }) }] },
      { results: [{ chart_id: 'chart1', html: chartHtml({ title: 'Churn by cohort' }) }] },
    ],
  });
  assert(/duplicate chart_id/i.test(err), `error should name the collision, got: ${err.trim()}`);
  assert(/slide3_chart1|provenance/i.test(err), 'error should tell the caller how to fix it');
});

// The deliberate escape hatch: re-running ONE chart (the tighter-crop retry) keeps the later result.
check('onDuplicate:last-wins keeps the retry and notes it', () => {
  const r = run(FROM, {
    outDir: dir('lastwins'), onDuplicate: 'last-wins',
    critiques: [
      { results: [{ chart_id: 'chart1', html: chartHtml({ title: 'First attempt' }) }] },
      { results: [{ chart_id: 'chart1', html: chartHtml({ title: 'Tighter crop' }) }] },
    ],
  });
  assert(r.bundled.length === 1, `expected 1 bundled chart, got ${r.bundled.length}`);
  assert(r.manifest.charts.length === 1, 'manifest should hold one entry, not two');
  assert(r.manifest.charts[0].title === 'Tighter crop', `later result should win, got ${r.manifest.charts[0].title}`);
});

// Distinct ids across images still merge into one bundle — the flagship flow must keep working.
check('distinct ids from two source images merge into one bundle', () => {
  const r = run(FROM, {
    outDir: dir('merge'),
    critiques: [
      { results: [{ chart_id: 'slide3_chart1', html: chartHtml({ title: 'Revenue by region' }) }] },
      { results: [{ chart_id: 'slide7_chart1', html: chartHtml({ title: 'Churn by cohort' }) }] },
    ],
  });
  assert(r.bundled.length === 2, `expected 2 bundled, got ${r.bundled.join(',')}`);
  const titles = r.manifest.charts.map(c => c.title).sort();
  assert(titles.join('|') === 'Churn by cohort|Revenue by region', `both charts must survive, got ${titles}`);
});

// 2. A single-quoted src must be inlined too — and if it ever isn't, the detector must SAY so
//    rather than certify the bundle as clean.
check('single-quoted external src is inlined (no live CDN ref survives)', () => {
  const raw = dir('sq.raw.html');
  writeFileSync(raw, chartHtml({ title: 'Single quoted', quote: "'" }));
  const m = run(MAKE, { outDir: dir('sq'), charts: [{ chart_id: 'sq', rawHtmlPath: raw }] });
  assert(m.warnings.length === 0, `expected no warnings, got: ${m.warnings.join('; ')}`);
  assert(m.charts[0].vendorized_deps.length === 1, `dep should be vendorized, got ${JSON.stringify(m.charts[0].vendorized_deps)}`);
  const web = readFileSync(join(dir('sq'), 'sq.web.html'), 'utf8');
  assert(!/https?:\/\/cdn\.jsdelivr/.test(web), 'a live CDN ref survived into web.html');
  assert(!/fonts\.googleapis/.test(web), 'the Google Fonts link survived into web.html');
  assert(web.length > 100_000, `chart.js does not look inlined (web.html is only ${web.length}b)`);
});

check('a surviving external ref is reported whatever its quote style', () => {
  const raw = dir('leak.raw.html');
  writeFileSync(raw, chartHtml({ title: 'Leaky' }).replace('</body>', `<img src='https://evil.example/x.png'><img src=https://bare.example/y.png></body>`));
  const m = run(MAKE, { outDir: dir('leak'), charts: [{ chart_id: 'leak', rawHtmlPath: raw }] });
  assert(m.warnings.some(w => /evil\.example/.test(w)), `single-quoted leak not reported: ${m.warnings.join('; ')}`);
  assert(m.warnings.some(w => /bare\.example/.test(w)), `unquoted leak not reported: ${m.warnings.join('; ')}`);
});

// A Becise version bump must not silently inline a different library than the page asked for.
check('vendor version mismatch is warned, not silently inlined', () => {
  const raw = dir('ver.raw.html');
  writeFileSync(raw, chartHtml({ title: 'Bumped' }).replace('chart.js@4.4.7', 'chart.js@4.9.9'));
  const m = run(MAKE, { outDir: dir('ver'), charts: [{ chart_id: 'ver', rawHtmlPath: raw }] });
  assert(m.warnings.some(w => /VENDOR VERSION MISMATCH/.test(w)), `expected a mismatch warning, got: ${m.warnings.join('; ')}`);
});

// 3. All-fallback must still produce a manifest recording what was attempted.
check('all-fallback emits a manifest recording every attempt', () => {
  const r = run(FROM, {
    outDir: dir('allfb'),
    critiques: [{ results: [
      { chart_id: 'c1', isFallback: true, reason: 'not_chartable', usage: { inputTokens: 34000 } },
      { chart_id: 'c2', isFallback: true, reason: 'not_chartable', usage: { inputTokens: 6700 } },
    ] }],
  });
  assert(r.bundled.length === 0, 'nothing should be bundled');
  assert(r.manifest.charts.length === 2, `both attempts should be recorded, got ${r.manifest.charts.length}`);
  assert(r.manifest.charts.every(c => c.isFallback), 'entries should be flagged isFallback');
  assert(r.nothingRebuilt, 'caller must be told there is nothing to publish');
  assert(r.warning, 'the low-token fallback should still be flagged for a retry');
  JSON.parse(readFileSync(join(dir('allfb'), 'manifest.json'), 'utf8')); // manifest exists on disk
});

// 4. Truncated / mis-transcribed HTML that would render EMPTY must be flagged.
check('payload-less HTML is flagged as emptyPayload', () => {
  const raw = dir('empty.raw.html');
  writeFileSync(raw, '<!DOCTYPE html><html><head></head><body><h1 class="chart-title">Nothing here</h1></body></html>');
  const m = run(MAKE, { outDir: dir('empty'), charts: [{ chart_id: 'empty', rawHtmlPath: raw }] });
  assert(m.charts[0].emptyPayload === true, 'should be flagged emptyPayload');
  assert(m.payloadWarnings.length === 1, `expected one payload warning, got ${m.payloadWarnings.length}`);
});

// The manifest is a consumed contract (becise-place reads it) — hold its shape.
check('manifest is versioned and every entry has the same keys', () => {
  const r = run(FROM, {
    outDir: dir('shape'),
    critiques: [{ results: [
      { chart_id: 'good', html: chartHtml({ title: 'Real chart' }) },
      { chart_id: 'bad', isFallback: true, reason: 'not_chartable' },
    ] }],
  });
  assert(r.manifest.manifest_version === 1, `expected manifest_version 1, got ${r.manifest.manifest_version}`);
  const [a, b] = r.manifest.charts.map(c => Object.keys(c).sort().join(','));
  assert(a === b, `rebuilt and fallback entries must share one shape:\n  ${a}\n  ${b}`);
  const fb = r.manifest.charts.find(c => c.chart_id === 'bad');
  assert(fb.files && 'web' in fb.files && fb.files.web === null, 'fallback files should be nulls, not {}');
  const ok = r.manifest.charts.find(c => c.chart_id === 'good');
  assert(ok.files.png === null, 'files.png must be null until something renders it');
  assert(ok.files.web === 'good.web.html', 'files paths are relative to the bundle dir');
});

rmSync(tmp, { recursive: true, force: true });
process.stdout.write(failures ? `\n${failures} failure(s)\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
