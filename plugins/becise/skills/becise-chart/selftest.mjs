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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scriptSyntaxErrors, extractTitle } from './make-bundle.mjs';

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

function run(script, json, opts = {}) {
  const out = execFileSync(process.execPath, [script], { input: JSON.stringify(json), encoding: 'utf8', maxBuffer: 64e6, ...opts });
  return JSON.parse(out);
}
function runExpectFail(script, json, opts = {}) {
  try {
    execFileSync(process.execPath, [script], { input: JSON.stringify(json), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  } catch (e) { return String(e.stderr || ''); }
  throw new Error('expected a non-zero exit, got success');
}

const tmp = mkdtempSync(join(tmpdir(), 'becise-selftest-'));
const dir = n => join(tmp, n);

// ── curl shims (keep the fallback path hermetic — never spawn the real curl) ──
// bundle-from-critique's curl fallback fires whenever fetch throws; a PATH shim
// makes each outcome deterministic. env inherits process.env with the shim first.
function curlShim(name, body) {
  const d = join(tmp, `shim-${name}`);
  mkdirSync(d, { recursive: true });
  const p = join(d, 'curl');
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return d;
}
const shimEnv = (shimDir) => ({ env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` } });
// fetch-unreachable trigger: undici rejects port 1 as a "bad port" BEFORE any
// network I/O, so this throws instantly and hermetically.
const UNREACHABLE = 'https://127.0.0.1:1/chart.html';

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

// 5. The server externalizes chart documents — `html` arrives as a presigned URL, not markup.
//    (2026-07-30: the old bundler wrote the URL string itself to .raw.html, shipping a 485-byte
//    "chart" that rendered as a bare link.) data: URLs exercise the fetch path with zero network.
check('URL-mode html is fetched and bundled, not written as the chart', () => {
  const doc = chartHtml({ title: 'Fetched chart' });
  const r = run(FROM, {
    outDir: dir('urlmode'),
    result: { results: [{ chart_id: 'u1', html: `data:text/html;base64,${Buffer.from(doc).toString('base64')}` }] },
  });
  assert(r.bundled.join(',') === 'u1', `expected u1 bundled, got ${r.bundled.join(',')}`);
  assert(!r.brokenWarning, `fetched chart should have a real payload, got: ${r.brokenWarning}`);
  assert(r.manifest.charts[0].title === 'Fetched chart', `metadata should come from the FETCHED markup, got ${r.manifest.charts[0].title}`);
  const raw = readFileSync(join(dir('urlmode'), 'u1.raw.html'), 'utf8');
  assert(raw.startsWith('<!DOCTYPE html>'), 'raw.html must hold the fetched markup, not the URL string');
});

check('an unreachable html URL (fetch AND curl fail) skips that chart with a reason, not the bundle', () => {
  const failShim = curlShim('fail', '#!/bin/sh\nexit 7\n');
  const r = run(FROM, {
    outDir: dir('urlfail'),
    critiques: [
      { results: [{ chart_id: 'ok1', html: chartHtml({ title: 'Inline survivor' }) }] },
      { results: [{ chart_id: 'gone1', html: UNREACHABLE }] },
    ],
  }, shimEnv(failShim));
  assert(r.bundled.join(',') === 'ok1', `inline chart must survive, got ${r.bundled.join(',')}`);
  const s = r.skipped.find(x => x.chart_id === 'gone1');
  assert(s, 'unfetchable chart must be recorded in skipped');
  assert(/curl/i.test(s.reason), `reason should show the curl fallback was tried, got: ${s.reason}`);
  assert(r.manifest.charts.some(c => c.chart_id === 'gone1' && c.isFallback), 'and recorded in the manifest as fallback');
});

// The sandbox failure mode this exists for: Node's fetch ignores the harness proxy
// (ENOTFOUND / bad port) while curl works. The shim proves the rescue end-to-end
// with zero network.
check('curl fallback rescues a fetch-unreachable URL', () => {
  const fixture = join(tmp, 'curlok-fixture.html');
  writeFileSync(fixture, chartHtml({ title: 'Rescued by curl' }));
  const okShim = curlShim('ok', `#!/bin/sh\ncat "${fixture}"\n`);
  const r = run(FROM, {
    outDir: dir('curlok'),
    result: { results: [{ chart_id: 'cf1', html: UNREACHABLE }] },
  }, shimEnv(okShim));
  assert(r.bundled.join(',') === 'cf1', `expected cf1 bundled via curl, got ${r.bundled.join(',')} (skipped: ${JSON.stringify(r.skipped)})`);
  assert(!r.brokenWarning, `rescued chart should have a real payload, got: ${r.brokenWarning}`);
  assert(r.manifest.charts[0].title === 'Rescued by curl', 'metadata should come from the curl-fetched markup');
});

check('curl fallback returning an empty body skips the chart with a reason', () => {
  const emptyShim = curlShim('empty', '#!/bin/sh\nexit 0\n');
  const r = run(FROM, {
    outDir: dir('curlempty'),
    result: { results: [{ chart_id: 'ce1', html: UNREACHABLE }] },
  }, shimEnv(emptyShim));
  assert(r.bundled.length === 0, 'nothing should bundle from an empty body');
  const s = r.skipped.find(x => x.chart_id === 'ce1');
  assert(s && /empty body/i.test(s.reason), `reason should name the empty body, got: ${s?.reason}`);
});

check('non-string html is skipped with a readable reason', () => {
  const r = run(FROM, {
    outDir: dir('nonstring'),
    result: { results: [{ chart_id: 'ns1', html: { unexpected: 'object' } }] },
  });
  const s = r.skipped.find(x => x.chart_id === 'ns1');
  assert(s && /not a string/i.test(s.reason), `expected a type-guard reason, got: ${s?.reason}`);
});

// rebuild_chart returns ONE chart per call — a bare object, not results[].
check('single-object rebuild_chart result shapes are accepted', () => {
  const r = run(FROM, {
    outDir: dir('single'),
    critiques: [
      { chart_id: 'solo1', html: chartHtml({ title: 'Bare object' }) },
      { results: { chart_id: 'solo2', html: chartHtml({ title: 'Wrapped object' }) } },
    ],
  });
  assert(r.bundled.sort().join(',') === 'solo1,solo2', `both single-object shapes must bundle, got ${r.bundled.join(',')}`);
});

// 6. Server-corrupt code (2026-07-31: model-side backslash doubling → SyntaxError → chart
//    bundles fine and renders BLANK). The syntax gate must flag it as emptyPayload, name the
//    error, and still write the files (for forensics / a manual fix).
check('syntax-corrupt HTML is flagged emptyPayload with the parse error named, files still written', () => {
  const raw = dir('syn.raw.html');
  // The incident corruption shape: doubled backslashes free the inner "/" to end the regex early.
  const corrupt = chartHtml({ title: 'Broken transcription' })
    .replace('</body>', `<script>function beciseSplitEntityName(n){return n.split(/\\\\s*\\\\/\\\\s*/);}</script></body>`);
  writeFileSync(raw, corrupt);
  const m = run(MAKE, { outDir: dir('syn'), charts: [{ chart_id: 'syn', rawHtmlPath: raw }] });
  assert(m.charts[0].emptyPayload === true, 'syntax-dead chart must be flagged emptyPayload');
  assert(m.payloadWarnings.some(w => /JS syntax error in inline script #\d+/.test(w)), `warning must name the script and error, got: ${m.payloadWarnings.join('; ')}`);
  assert(m.payloadWarnings.some(w => /re-run the tool once/i.test(w)), 'warning must carry the re-run guidance');
  readFileSync(join(dir('syn'), 'syn.web.html'), 'utf8'); // files written despite the flag
});

// 7. Placeholder metadata (same incident): "<chart_title>" must not suppress the real <h1>.
check('placeholder metadata is nulled; title falls back to the real <h1>', () => {
  const raw = dir('ph.raw.html');
  const html = chartHtml({ title: 'Fallback Heading' })
    .replace(/"chart_title":"[^"]*"/, '"chart_title":"<chart_title>"')
    .replace(/"key_insight":"[^"]*"/, '"key_insight":"<key_insight>"');
  writeFileSync(raw, html);
  const m = run(MAKE, { outDir: dir('ph'), charts: [{ chart_id: 'ph', rawHtmlPath: raw }] });
  assert(m.charts[0].title === 'Fallback Heading', `title should fall back to the <h1>, got: ${m.charts[0].title}`);
  assert(m.charts[0].key_insight === null, `placeholder key_insight should be null, got: ${m.charts[0].key_insight}`);
  assert(m.charts[0].emptyPayload === false, 'placeholder metadata alone is not an empty payload');
});

// 7b. After the stitched title block, h1.chart-title is the finding. manifest.title must
//     stay the operation (eyebrow), not that sentence.
check('extractTitle prefers .chart-eyebrow over h1.chart-title', () => {
  assert(extractTitle('<p class="chart-eyebrow">Sales Channel · Revenue Share</p><h1 class="chart-title">Telephone took the mix</h1>')
    === 'Sales Channel · Revenue Share');
  assert(extractTitle('<h1 class="chart-title">Only Heading</h1>') === 'Only Heading');
});

check('placeholder metadata falls back to eyebrow then h1', () => {
  const raw = dir('ph2.raw.html');
  const html = chartHtml({ title: 'Should Not Win' })
    .replace(/"chart_title":"[^"]*"/, '"chart_title":"<chart_title>"')
    .replace('<h1 class="chart-title">Should Not Win</h1>',
      '<p class="chart-eyebrow">Operation Title</p><h1 class="chart-title">Finding sentence</h1>');
  writeFileSync(raw, html);
  const m = run(MAKE, { outDir: dir('ph2'), charts: [{ chart_id: 'ph2', rawHtmlPath: raw }] });
  assert(m.charts[0].title === 'Operation Title', `title should be eyebrow, got: ${m.charts[0].title}`);
});

check('gallery omits .insight when the chart already has .chart-eyebrow', () => {
  const gallery = join(HERE, '..', 'becise-place', 'build-gallery.mjs');
  if (!existsSync(gallery)) return;
  const raw = dir('g2.raw.html');
  const html = chartHtml({ title: 'Op' })
    .replace('<h1 class="chart-title">Op</h1>',
      '<p class="chart-eyebrow">Op</p><h1 class="chart-title">Finding already on the chart</h1>');
  writeFileSync(raw, html);
  const outDir = dir('g2');
  run(MAKE, { outDir, charts: [{ chart_id: 'g2', rawHtmlPath: raw }] });
  const out = join(outDir, 'gallery.html');
  execFileSync(process.execPath, [gallery], {
    input: JSON.stringify({ dir: outDir, out, title: 'G' }),
    encoding: 'utf8',
    maxBuffer: 64e6
  });
  const g = readFileSync(out, 'utf8');
  assert(!/<p class="insight">/.test(g), 'gallery must not duplicate key_insight above a stitched title block');
});

// 8. The transforms themselves must not corrupt scripts (a vendor bump reintroducing a literal
//    </script> would break web/artifact only — a LOCAL bug, not a re-run-the-tool case). Pin them.
check('transform outputs stay syntax-valid: web.html, artifact.html, gallery', () => {
  const web = readFileSync(join(dir('merge'), 'slide3_chart1.web.html'), 'utf8');
  const webFails = scriptSyntaxErrors(web);
  assert(webFails.length === 0, `web.html scripts must parse, got: ${JSON.stringify(webFails)}`);
  const art = readFileSync(join(dir('merge'), 'slide3_chart1.artifact.html'), 'utf8');
  const artFails = scriptSyntaxErrors(art);
  assert(artFails.length === 0, `artifact.html scripts must parse, got: ${JSON.stringify(artFails)}`);
  const gallery = join(HERE, '..', 'becise-place', 'build-gallery.mjs');
  if (existsSync(gallery)) {
    const out = join(dir('merge'), 'gallery.html');
    execFileSync(process.execPath, [gallery], { input: JSON.stringify({ dir: dir('merge'), out, title: 'Pin' }), encoding: 'utf8', maxBuffer: 64e6 });
    const gFails = scriptSyntaxErrors(readFileSync(out, 'utf8'));
    assert(gFails.length === 0, `gallery scripts must parse, got: ${JSON.stringify(gFails)}`);
  }
});

// 9. HTTP-status failures must NOT consult curl (an expired presigned URL 403s identically
//    over any route; retrying it via curl just loses the expiry hint and 30s). Needs a real
//    HTTP response → loopback server in a child process (execFileSync blocks this process's
//    event loop, so the server can't live here). Some sandboxes block listening — skip, not fail.
{
  const srv = spawn(process.execPath, ['-e',
    "const http=require('http');const s=http.createServer((q,r)=>{r.statusCode=403;r.end('denied')});" +
    "s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    srv.stdout.once('data', d => { clearTimeout(timer); resolve(parseInt(String(d).trim(), 10) || null); });
    srv.on('error', () => { clearTimeout(timer); resolve(null); });
    srv.on('exit', () => { clearTimeout(timer); resolve(null); });
  });
  if (port == null) {
    process.stdout.write('  skip HTTP-status failures do not consult curl (sandbox blocks loopback listen)\n');
  } else {
    check('HTTP-status failures do not consult curl', () => {
      const wouldSucceedShim = curlShim('would-succeed', `#!/bin/sh\necho "<!DOCTYPE html><html>curl should not have run</html>"\n`);
      const r = run(FROM, {
        outDir: dir('http403'),
        result: { results: [{ chart_id: 'h1', html: `http://127.0.0.1:${port}/expired.html` }] },
      }, shimEnv(wouldSucceedShim));
      assert(r.bundled.length === 0, 'a 403 must not bundle');
      const s = r.skipped.find(x => x.chart_id === 'h1');
      assert(s && /HTTP 403/.test(s.reason), `reason must carry the HTTP status, got: ${s?.reason}`);
      assert(/expire/i.test(s.reason), 'the presigned-expiry hint must survive');
    });
  }
  srv.kill();
}

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
