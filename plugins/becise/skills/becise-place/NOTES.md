# becise-place — background notes

Reference for `SKILL.md`. Read when something surprises you or before changing the scripts.

## Why the gallery mounts charts same-page (NOT iframes)

Concatenating several `artifact.html` fragments into one page breaks them: their top-level `const`s
(`BECISE`, helpers) and `Chart.register` calls collide at page scope. The gallery used to solve this
with one `<iframe srcdoc="…web.html…">` per chart — validated under the Artifact CSP 2026-07-24,
**observed rendering blank under the claude.ai/code Artifact CSP 2026-07-29**: `frame-src`-style
policies don't admit `about:srcdoc`, so a host policy change silently blanks every chart while the
page chrome renders fine. Don't reintroduce frames; they put the whole deliverable at the mercy of
the host's frame policy.

`build-gallery.mjs` instead mounts each chart same-page and does the isolation itself:

- **Vendor libs deduped** — the inlined Chart.js/adapter/datalabels `<script>`s are identical
  across charts; each unique one is emitted ONCE, before any chart code (also halves gallery size).
- **One IIFE per chart** — all of a chart's body scripts are concatenated and wrapped together
  (they share top-level helpers, so per-block wrapping would break cross-references). No
  `'use strict'`: emitted chart code has been observed to assign undeclared globals, which strict
  mode turns into a thrown error and a blank chart.
- **Per-chart id suffix** — every `id="…"` in the mounted markup and every literal
  `getElementById('…')` in its code gets `--<chart_id>`, so chart N can't capture chart 1's canvas.
- **CSS defused** — the fragment's `html, body` sizing rule is stripped (same as
  `toArtifactFragment`) and its universal `* { margin:0; … }` reset is scoped to `.becise-embed`
  so it can't flatten the gallery chrome. Fragment CSS is deduped across charts too.

Residual global bleed (`Chart.defaults`, `Chart.register`) is shared by design: every fragment sets
identical values, and Chart.js registration is idempotent.

## `manifest.json` — full shape

```
{ manifest_version: 1, generated_by, charts: [...], warnings: [], payloadWarnings: [] }
```

Every chart entry, rebuilt or fallback:

```
{ chart_id, chart_type, title, key_insight, background, fluid,
  vendorized_deps, source_ref, isFallback, emptyPayload,
  files: { raw, web, artifact, png } }
```

Missing values are `null`, never absent — a consumer never has to probe for a key. `files.*` are
relative to the bundle dir. `files.png` is `null` from the producer; only this skill fills it.

Check `manifest_version` before trusting the shape. It's `1` today; the producer bumps it when a
change would break a consumer.

## Why `web.html`, never `raw.html`

`raw.html` is exactly what Becise returned, and it pulls Chart.js, the date-fns adapter, the
datalabels plugin, and the Inter font from CDNs. It renders in a networked browser and blank under
CSP or offline. `make-bundle.mjs` inlines those deps into `web.html`, which is the only form safe to
render, iframe, or host. `artifact.html` is the same content as a body fragment.

Charts are **fluid** (`maintainAspectRatio:false`, `100vw/100vh`, transparent background), so output
size is a render-time choice, not a property of the chart. That's why `render-png.mjs` takes explicit
`width`/`height` and why the gallery sets per-chart frame heights.

## `render-png.mjs`

Input `{ webHtmlPath, out?, width?, height?, scale?, virtualTimeMs?, background?, offline? }`.
Locates Chrome (override with `$CHROME`), renders, returns `{ out, bytes, width, height, chrome }`.
Exits non-zero if Chrome is missing or the PNG comes back suspiciously small (under 1000 bytes,
meaning the chart didn't draw). It renders `web.html` only.

`"offline":true` routes network through a dead proxy (`127.0.0.1:1`) so any external fetch fails
fast — a real self-contained chart still renders. Useful as a one-off proof, not as a default gate:
Chrome is slow (~7 of 18 minutes on a past 5-chart run) and the producer's static checks already
cover the surviving-external-ref case at zero cost.

## Google Slides gotchas, in full

- **`get_presentation` was observed to hang** (375s timeout) when looking up an existing slide's
  object id. Assign your own `objectId` via `createSlide` in the same batch instead, or target a page
  id you already hold.
- **EMU everywhere**: 914400 per inch; a widescreen page is 9144000×5143500. Final rendered size is
  `size` × `scaleX/scaleY`, so set `scale: 1` and put the real dimensions in `size`.
- **Never `updatePageElementTransform` on a placed chart image** — it drops out blank. Place at final
  coordinates the first time.
- Presigned upload URLs expire ~300s and `batchUpdate` is atomic, so upload immediately before firing
  the batch containing the `createImage`.

## Google Docs limits

No Docs `batchUpdate` / insert-inline-image tool is exposed, so positional insertion into an existing
doc is impossible. `import_to_google_doc` with `source_format: "html"` and inline `content` creates a
new Doc and embeds a **permanent** copy of the image at import time, so the presigned TTL only needs
to outlast the import. `file_path` does not work: the Workspace MCP is remote and can't read local
disk — use inline `content` or `file_url`.

Verify by exporting the doc to PDF (`get_drive_file_download_url`, `export_format: "pdf"`) and
confirming an `/Image` XObject is present.

Dropping a chart into an *existing* doc would mean `update_drive_file` with HTML, which replaces the
whole body and clobbers it. Treat that as new/copy.

## REPLACE, when it gets built

`source_ref` = `{ container, container_id, locator: { page/elementIds, bbox }, replaceable }`.

Clean only when the chart is a single replaceable object in an editable container: a Docs inline
image → replace; a Slides image or linked chart → delete the element and `createImage` at the same
transform. A multi-shape chart (`replaceable: "cluster"`) or a PDF/dashboard (`"none"`) can't be
replaced — degrade to a NEW copy and say so.

It's the only irreversible, outward-facing step in the pipeline: default to operating on a copy, and
confirm with the user before the write.
