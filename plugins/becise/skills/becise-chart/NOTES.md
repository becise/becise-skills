# becise-chart — background notes

Reference for `SKILL.md`. Nothing here is needed to run the skill; read it when something surprises
you, when a warning fires, or before changing the scripts.

## What Becise's chart HTML actually is

Verified against real output. Two properties drive the whole client design:

1. **Not self-contained.** It pulls Chart.js, the date-fns adapter, the datalabels plugin, and the
   Inter font from CDNs. Anything CSP-bound (Artifacts) or offline renders blank until those are
   inlined. That inlining is the one transform `make-bundle.mjs` exists to perform.
2. **Fluid.** `maintainAspectRatio:false`, `100vw/100vh`, transparent background. Output size is a
   choice made at render time, not a property of the chart — which is why `render-png.mjs` takes
   explicit `width`/`height`.

It's also introspectable: an embedded `<script id="becise-metadata">` carries `chart_type`,
`chart_title`, and `key_insight` (auto-filled into the manifest), and the underlying data sits in a
`series` const.

## Why `chart_id`s must be globally unique

Every chart in a `charts[]` is cropped from **one** source image, so charts on different images need
separate calls, and each call numbers its charts independently. Two calls that both start at
`chart1` collide on merge.

The id is the filename. Before the guard existed, the second `chart1` overwrote the first's HTML and
the manifest ended up with two entries pointing at one file: one chart silently missing from the
deliverable, exit 0, no warning. Both entry paths now refuse duplicates before writing anything.

`"onDuplicate":"last-wins"` exists for one legitimate case — deliberately re-running the *same*
chart after a tighter-crop retry, where the later result should win. It keeps the retry and records
it in `manifest.warnings`. Auto-namespacing by call index was rejected: it silently changes ids the
caller chose, and `c0_chart1` carries less meaning than `slide3_chart1`.

## Media extraction from a `.pptx`: only when the slide IS the picture

A `.pptx` is a zip, and the chart on a slide is often just an image sitting in `ppt/media/`.
Whether grabbing it directly is safe is **decidable from `slide<N>.xml`**, and SKILL.md's
flat-image check encodes exactly that:

- **The hazard** (why a blanket grab is wrong): deck authors routinely lay **native text shapes
  over the picture** — total labels above columns, callouts, growth-rate rows. Those live in
  `slide<N>.xml`, not the media file. Ship the raw media and Becise rebuilds a chart with its
  totals silently missing. Observed in the wild: an Olipop deck where all five column totals were
  separate text boxes (five `<p:sp>` with `<a:t>` — fails the check).
- **The affirmative case** (why a blanket ban is also wrong): export-style decks (beautiful.ai
  etc.) pre-render slides as single full-bleed JPEGs with NOTHING else on the slide. On
  2026-07-30/31 the converters burned 3–7 minutes failing on such a deck while the media file —
  higher-resolution than any re-render — sat in the zip; extraction rescued all three runs
  (one `<p:pic>`, zero text runs, zero shapes — passes the check).
- **Binary by design**: any text run or drawable shape fails the check and forces a composed-slide
  render. No overlap geometry, no "the text looks unrelated" judgment — false negatives cost
  minutes, false positives cost correctness. Residual accepted risk: master/layout-level shapes
  don't appear in `slide<N>.xml`; masters carry footers and logos, not data annotations.
- The rels mapping matters: media numbering ≠ slide numbering (slide4 → image3.jpg in the field).

The zip is also still worth opening just to *understand* a composed slide (shape inventory,
`<a:t>` text) even when the pixel source must be a render.

## The low-token fallback heuristic

A genuine non-chartable is decided *after* real processing, around 30k+ server-side
`usage.inputTokens`. A fallback reporting a few thousand means the image barely got processed —
usually a wrong, blank, stale, or mis-cropped upload. Observed range: 6.7k for a bad image vs 34k for
a real run.

`bundle-from-critique` flags these as `suspectWrongImage`. The retry with a tight crop disambiguates:
rebuilds → bad image; identical low-token fallback → genuinely un-chartable.

Note this is Becise's *server-side* token count, reported back for exactly this purpose. It never
enters client context.

## `rebuild_chart` vs the legacy `chart_critique` contract

`rebuild_chart` (server, 2026-07-30) is the contract this skill now targets: **one tight chart
image per call**, optional `context.{text,story}`, no `location` hint. It exists because the
full-slide + location-hint path had three field failures the crop path doesn't:

1. **Content filters.** A busy full-slide image (icons, big `$` glyphs, side panels) tripped an
   upstream provider filter; the same chart's clean crop passed untouched. The server can't fall
   back across providers on a filter trip, so the whole chart died.
2. **Accuracy/cost.** The extraction model reads everything you send it. The `location` hint was a
   prompt-level "please ignore the rest" — a pixel crop actually removes the rest.
3. **URL lifetime.** `chart_critique` hands your presigned image URL to the provider, which fetches
   it late; `rebuild_chart` fetches it server-side at job start, so ~300s TTLs stop racing the job
   queue.

This is also platform parity: Becise's own deck-generation pipeline feeds the same rebuild engine
lambda-cropped single-chart images with no location hint. The crop contract is the configuration
that was already proven fast and accurate in production.

Context is **text, not pixels**, by design: you have seen the full view; a sentence of surrounding
copy tells the decider what it needs at a fraction of the cost, and `context.image` is reserved in
the schema for a future server version. The legacy `chart_critique` fallback in Step 2 exists for
version skew only — drop it once every deployed server has `rebuild_chart`.

## The HTML no longer passes through you (URL mode)

The server externalizes rebuilt chart documents: `html` in the result is a **presigned URL**
(~3h TTL), not inline markup. `bundle-from-critique` fetches it straight to disk, so the fragile
"multi-KB HTML rides through the calling context" hand-off is gone. (2026-07-30: before the bundler
understood URLs, it wrote the URL string itself to `.raw.html` — a 485-byte "chart" that rendered as
a bare link. The `emptyPayload` guard caught it; the bundler now fetches.)

Three edges remain:
- **Expired URL** → that chart lands in `skipped` with a fetch reason; re-run the tool for a fresh
  URL. Bundle promptly after results arrive.
- **Inline HTML** (older servers, other tools) still works — the bundler treats `html` as markup
  unless it starts with `https?:`/`data:`. The truncation guard (`looksLikeRealChart` →
  `emptyPayload`/`brokenWarning`) stays, and still protects the inline path.
- **Server-corrupt fetched HTML** (2026-07-31): the model transcribing Becise's helper library
  doubled its backslashes → one regex terminated early → SyntaxError → the fetched page bundles
  fine and renders BLANK. `scriptSyntaxErrors` in make-bundle compiles (never executes) every
  inline classic-JS script and folds failures into `emptyPayload` with a payloadWarning naming the
  script and error. The server has its own gate + retry for this; the skill check covers old
  servers, other entry paths into make-bundle, and any future regression.

Sandbox note: in the Claude harness, Node's `fetch` ignores the `HTTP(S)_PROXY` env the sandbox
provides (curl honors it) — the bundler falls back to `curl` on any fetch throw, and its terminal
error names `NODE_USE_ENV_PROXY=1` (Node ≥ 24) when a proxy env is present.

Extractor limitation (shared by the syntax gate, the inliner, and build-gallery): script bodies are
matched up to the first `</script>`, so a literal `</script>` inside a JS string would truncate the
body — exactly as a browser's HTML parser would, so a page like that is genuinely broken anyway and
the gate flagging it is correct, not a false positive. Zero occurrences in the vendored libs today;
the selftest's transform-pinning check guards a vendor bump reintroducing one.

## `manifest.json` — full shape

```
{ manifest_version: 1, generated_by, charts: [...], warnings: [], payloadWarnings: [] }
```

Every chart entry carries the **same keys** whether rebuilt or fallback; missing values are `null`,
never absent, so a consumer never probes:

```
{ chart_id, chart_type, title, key_insight, background, fluid,
  vendorized_deps, source_ref, isFallback, emptyPayload,
  files: { raw, web, artifact, png } }
```

`files.*` are relative to the bundle dir. `files.png` is `null` until `becise-place` renders one.
Bump `manifest_version` when the shape changes in a way a consumer must notice.

## `warnings[]` — what each one means

- **external ref survived inlining** — a real CSP/offline break. The transform and the detector are
  both quote-agnostic now (and the detector also catches unquoted attributes), deliberately: a
  last-line-of-defence check must not share the transform's blind spots.
- **unrecognized dep** — Becise introduced a library not in `VENDOR_MAP`. Add the row and drop the
  file in `vendor/`.
- **`VENDOR VERSION MISMATCH`** — the page requests a version `vendor/` doesn't have, so the inlined
  copy isn't what it asked for. Refresh `vendor/` and `VENDOR_MAP` together.

## vendor/

Chart.js **4.4.7** + the date-fns adapter + datalabels, as of 2026-07-27. 4.4.7 is correct because
that's what real Becise output requests — inline what the page asks for, not the newest release.
(A sibling skill vendoring 4.5.1 is the drifted one, not this.) The mismatch warning exists so a
future Becise bump surfaces instead of silently inlining the wrong library.

Font embedding (inlining real Inter woff2) is an optional refinement. Today `make-bundle` drops the
webfont link and lets the system sans stack take over — visually near-identical.

## Artifact fragment construction

`artifact.html` is a body fragment: no `<html>/<head>/<body>`, the `html,body` sizing rule stripped
(it fights the Artifact host), head scripts hoisted ahead of the body so the inlined libraries
execute before the chart config, and the chart wrapped in an explicitly-sized white card so the
fluid canvas has a height and reads on either viewer theme.

Fragments **cannot** be concatenated — their top-level `const`s (`BECISE`, helpers) and
`Chart.register` calls collide at page scope. That's why multi-chart galleries use one
`<iframe srcdoc>` per chart instead.
