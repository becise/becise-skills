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

## The low-token fallback heuristic

A genuine non-chartable is decided *after* real processing, around 30k+ server-side
`usage.inputTokens`. A fallback reporting a few thousand means the image barely got processed —
usually a wrong, blank, stale, or mis-cropped upload. Observed range: 6.7k for a bad image vs 34k for
a real run.

`bundle-from-critique` flags these as `suspectWrongImage`. The retry with a tight crop disambiguates:
rebuilds → bad image; identical low-token fallback → genuinely un-chartable.

Note this is Becise's *server-side* token count, reported back for exactly this purpose. It never
enters client context.

## The HTML passes through you once

The chart HTML exists only inside the `chart_critique` tool result — there is no harness auto-save of
MCP results to disk (verified). `bundle-from-critique` removes the per-file write dance and the
reformatting, but not that single unavoidable emission.

That hand-off is where HTML can get truncated or mis-transcribed, producing a page that bundles fine
and renders empty. `looksLikeRealChart` in `make-bundle.mjs` guards it (surfaced as `emptyPayload` /
`brokenWarning`). The guard lives in `make-bundle` rather than the wrapper so both entry paths get it.

**This whole class of bug disappears** if `chart_critique` ever returns a fetchable URL for the HTML
alongside the inline copy: the client would curl it to disk and never hold it. That's a server-side
change, currently parked.

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
