---
name: becise-chart
description: >
  Critique and rebuild a chart from ANY source (a Google Slides slide, an uploaded PDF/doc, a
  dashboard, a screenshot, or a plain image) with the Becise MCP, then SHOW the improved chart to
  the user. Produces a portable, self-contained chart bundle (raw/web/artifact + manifest) and
  publishes the result as a live Artifact — no Chrome required. Use when the user wants to critique
  / rebuild / fix / improve a chart (as opposed to a whole slide). To then insert that chart into a
  Slides deck or Doc, save it as a PNG, or replace the original, hand the bundle to the
  `becise-place` skill. For full-slide critiques use `becise-critique`.
---

# Becise Chart → shown chart + bundle

Orchestration only. **No Becise IP lives here** — analysis happens server-side behind the
`rebuild_chart` MCP tool.

```
INGEST ──► CROP ──► rebuild_chart ──► bundle-from-critique.mjs ──► SHOW ──► (hand off)
pixels     one     one call/chart     raw/web/artifact + manifest  Artifact  → becise-place
per view   chart   (parallel calls)
           each
```

**Self-sufficient through "here is your rebuilt chart."** `becise-place` is only for putting it
somewhere specific. If it isn't installed, say what the bundle holds and where; never leave the user
with files they can't see.

Background and rationale live in `NOTES.md` next to this file. Read it when something surprises you.

## Where the scripts live

Commands write `<SKILL_DIR>` for the directory holding this SKILL.md — substitute the path you
loaded it from. Never assume `~/.claude/skills/…`: uploaded skills mount under `/mnt/skills/`,
Claude Code uses `~/.claude/skills/`, plugins use `${CLAUDE_PLUGIN_ROOT}/skills/`. If lost:
`find /mnt/skills ~/.claude/skills -name 'make-bundle.mjs' -path '*becise*' 2>/dev/null | head -1`.
`node` is always present. Nothing here needs Chrome.

## Step 0 — Find the charts

Break the source into views (slides, PDF pages, dashboard panels, one screenshot), get pixels for
each (Step 1), and **look at every one yourself**.

**Is a chart:** bar/column, line/area, pie/donut, scatter/bubble, combo, funnel, heatmap —
plotted data geometry. **Colored-cell tables count** (heatmaps).
**Is not:** plain data tables, lone KPI numbers, process/flow/tree diagrams, maps, timelines,
isotype/pictographs, logos, photos. A concept diagram drawn to look chart-like (a funnel of shapes)
isn't chartable — note it rather than forcing it.

Record per kept chart: its view, where it sits (you'll crop it in Step 1), and a **`chart_id`
unique across the whole job**, view-prefixed: `slide3_chart1`, `page9_chart1`. Two views that each
start at `chart1` collide when merged, and Step 3 refuses duplicates.

**Big sources:** triage cheap metadata first (Slides `get_presentation` text, a PDF's extracted
text) to drop title/text/table pages, then eyeball only candidates; montage many views into one
contact sheet rather than reading each. **If the user named the view** ("the chart on slide 5"),
skip triage entirely and go straight to that one. **If nothing is chartable, stop** and say so.

## Step 1 — Ingest and CROP: one tight image per chart

`rebuild_chart` takes **the chart, not the page around it**. A tight crop is faster, more accurate,
and far less likely to trip upstream image filters than a full slide (a busy full-slide image has
been observed tripping a provider content filter that the same chart's clean crop sailed through).

First get full-view pixels:

| Source | Pixels |
| --- | --- |
| Google Slides | `get_page_thumbnail` (`LARGE`) → `curl` it to disk, then crop |
| PDF / doc | render the page to PNG (below) |
| Local Office file (`.pptx`/`.key`/`.docx`) | convert to PDF first (below), then render the page |
| Image / screenshot / dashboard | use as-is, then crop |
| Webpage | screenshot the region (claude-in-chrome) |

**From Google Drive:** `get_drive_file_download_url` → `curl` it to disk (HTTP mode returns a temp
URL, not a path; a huge file may return base64-in-JSON → `jq -r .content | base64 -d`).

**Then crop each chart out of its view:**

- **PDF-rendered views:** PyMuPDF `clip` renders the crop directly at high scale —
  `python3 -c "import fitz; d=fitz.open('in.pdf'); d[3].get_pixmap(matrix=fitz.Matrix(4,4), clip=fitz.Rect(x0,y0,x1,y1)).save('crop.png')"`
  (clip coords are in the page's point space — view the full render first and scale your estimate).
- **Raw images (thumbnails, screenshots):** PIL —
  `python3 -c "from PIL import Image; Image.open('view.png').crop((x0,y0,x1,y1)).save('crop.png')"`
  (`fitz` can also open plain images if PIL is missing).
- Include the chart's **title, axis labels, legend, and data labels**, plus a small margin. Exclude
  everything else — neighboring panels, page headers, decorative side content.

**Verify every crop by LOOKING at it** before upload: every label/legend/axis readable, no data
marks cut off, nothing foreign in frame. Clipped labels → widen and re-crop. This check is
mandatory — a bad crop wastes a whole server round-trip.

**Local `.pptx` — flat-image check FIRST (seconds, no conversion).** A `.pptx` is a zip:
`unzip -o -d <dir> deck.pptx 'ppt/slides/*' 'ppt/media/*'`. Open `ppt/slides/slide<N>.xml`. If it
has **exactly one `<p:pic>`, zero `<a:t>` text runs, and no other drawable shape** (`<p:sp>`,
`<p:grpSp>`, `<p:graphicFrame>`, `<p:cxnSp>`), the slide IS that image: map its `r:embed` id
through `_rels/slide<N>.xml.rels` to the `ppt/media/` file (never map by filename — slide4 →
image3.jpg happens) and crop that directly. Original resolution, better pixels than any re-render.
**Any text run or extra shape means the check FAILS — render the composed slide** (text may be
layered over the picture; see NOTES.md) **and never use the raw media. No geometry judgment: text
present = fail.** Export decks (beautiful.ai etc.) are flat on nearly every slide; native decks
fail the check and take the ladder below.

**Getting pixels from a local file never requires the network.** Do not import it into Google
Slides/Drive, hand it to `scrape_deck`, or route it through any external service to render it —
that uploads the user's file without being asked. If every path below fails, say so plainly.

**Office file → PDF** (composed slides only). **Check, never assume**:
`which soffice ; ls -d /Applications/Keynote.app`

- **`soffice --headless --convert-to pdf --outdir <dir> in.pptx`** wherever LibreOffice exists.
- **macOS: Keynote by AppleScript — TWO attempts maximum, then move down the ladder.** Automation
  fails in the field when scripted naively: sandboxed `osascript` can't launch apps (error
  `-10810` — run unsandboxed), and sending `open` to a cold Keynote races its scripting
  registration (error `-1708` / bogus `unmerge id` document refs — retrying variants of the naive
  recipe does NOT recover it). Use the hardened shape, which survives cold starts and stale open
  documents: `launch` → poll `count documents` inside `try` until scripting answers → `close every
  document saving no` → `open (POSIX file …)` → poll `count of documents > 0` (the return value of
  `open` is unreliable mid-import — never use it) → `export front document to (POSIX file …) as
  PDF` (fresh filename; Keynote errors on overwrite) → `close every document saving no`.
- **Export to a user-visible dir (`~/Downloads`), never the scratchpad** — Keynote is OS-sandboxed
  away from the scratchpad; it reports success and writes nothing.
- **PowerPoint is the last resort — ONE attempt, and never via a PowerPoint MCP's export tool**
  (observed 0-for-3: reports "exported" and writes NOTHING anywhere). If Microsoft PowerPoint is
  installed, drive it directly by AppleScript with BOTH paths as `POSIX file` objects and the
  destination INSIDE its own container (`~/Library/Containers/com.microsoft.Powerpoint/Data/tmp/`),
  then `cp` the PDF out — any destination outside the container hangs on a modal dialog that
  wedges the app. Verify by **mtime**, not existence; no file = the rung failed, move on — do not
  hunt containers for a phantom PDF.

**Verify every render.** `stat` the output before using it. Export tools — MCP wrappers especially —
routinely return "success" while producing no file. Don't confirm by `find`-ing the filename: a stale
file from an earlier export will match and send you a long way down the wrong path. Write to a fresh
dir, or check mtime.

**Rendering a PDF page.** Which renderer is present **varies by environment — check, never assume**:
`which pdftoppm ; python3 -c "import fitz" 2>/dev/null && echo fitz-ok`

Claude containers typically have poppler and no `fitz`; macOS is often the reverse. Use whatever the
check found. **The two number pages differently — mind the off-by-one or you rebuild the wrong page:**

- **poppler — 1-based:** `pdftoppm -png -r 200 -f 9 -l 9 in.pdf page` → `page-9.png`
- **PyMuPDF — 0-based** (printed page 9 = index 8):
  `python3 -c "import fitz; d=fitz.open('in.pdf'); d[8].get_pixmap(matrix=fitz.Matrix(3,3)).save('page.png')"`

Only PyMuPDF renders a cropped region straight from the PDF; with poppler, render full and crop with
PIL. Missing a tool you need: `pip install pymupdf` / `pip install pillow` (add
`--break-system-packages` only if pip refuses on a distro-managed Python). Neither available and no
network → **say so plainly** rather than shipping a bad image.

Render at 2–3× (crops at 3–4×). **Hosting each crop:** `get_upload_url` → `PUT` the bytes
(`Content-Type: image/png`; plain `--data-binary`, ignore the `crc32` param) → use the returned
`downloadUrl`. **Presigned URLs expire ~300s** — call `rebuild_chart` immediately, and mint a fresh
one for any retry. (The server fetches the URL once at job start, so it only needs to survive
seconds, but don't cut it fine.)

## Step 2 — Analyze

One `rebuild_chart` call **per chart** — issue the calls back-to-back so multi-chart jobs run in
parallel (each returns its own `jobId`):

- `chartImage`: `{ url: <crop downloadUrl>, mimeType: "image/png" }`
- `chart_id`: the job-wide-unique id from Step 0
- `context.story`: the narrative claim the chart must support, when you know it
- `context.text`: what surrounds the chart — the slide/page/panel's other content, in your words.
  You've SEEN the full view; describe it. Don't upload it.

Poll `get_result` per jobId on `{state:"pending"}` (typically 1–3 min per chart; a chart the
server internally retried can take up to ~8 min, and provider degradation stretches it further —
**keep polling, never re-submit a pending job**; tell the user it's running). Don't hand-save the
HTML — Step 3 does it. Successful results carry `html` as a **presigned URL** (~3h), not inline
markup; Step 3's bundler fetches it.

**GLOBAL retry cap: at most ONE re-run per chart in total, whatever the trigger** — low-token
fallback, content_filter, syntax warning, or empty payload. The per-trigger notes below never
stack. **When the cap is reached, the deliverable IS the failure report**: which chart failed, the
reason, and the offer to retry later. Including extracted VALUES in that report (a small table of
what Becise's analysis found) is useful and fine — it's the user's own data. **But never render a
chart yourself** — not from the image, not from extracted data mined out of a broken result, not
"as a fallback." Becise's rendering carries its design judgment; a hand-built chart wearing
Becise's data delivers the analysis stripped of the product. Report, offer the retry, stop.

**If `rebuild_chart` is not in the tool listing** (older server), fall back to the legacy
`chart_critique` contract: one call per source image with the FULL view's url and all its charts in
`charts[]` of `{ chart_id, location }` + `storyContext`. Everything downstream is unchanged.

**`get_result` dying with a transport error** ("MCP server connection lost" or similar) while the
job runs is EXPECTED on long jobs — the proxy times out the long-poll before the server answers.
It is not a failure and not worth reporting: call `get_result` again with the same `jobId`, as many
times as it takes, until you get `done` or `error`.

**Fallbacks with low `usage.inputTokens`** (a few k, vs ~30k+ for a real run) mean the image was
barely processed, not that the chart is un-chartable. Look at the uploaded crop again — wrong file,
blank render, stale export? Fix and retry that one chart ONCE (this is the chart's one re-run).
Rebuilds → the first image was bad. Identical low-token fallback → genuinely un-chartable, carry it
through flagged.

**`isFallback` with a filter/incomplete reason** (e.g. `content_filter`) should be rare now that
crops are the default input. If one still fires, tighten the crop further (chart marks + axis labels
only) and retry that one chart ONCE (this is the chart's one re-run).

## Step 3 — Build the bundle

Pipe the tool result(s) straight in. Prefer STDIN; multi-chart results exceed argv limits.
`result`/`critiques` entries accept both shapes: `rebuild_chart`'s single chart object and
`chart_critique`'s `results[]`. URL-mode `html` is fetched by the bundler — **bundle promptly**
(presigned URLs last ~3h; an expired one skips that chart with a clear reason — re-run the tool for
a fresh URL).

```
# one chart:
echo '{"outDir":"<dir>","result":<rebuild_chart result>}'                  | NODE_USE_ENV_PROXY=1 node <SKILL_DIR>/bundle-from-critique.mjs
# several charts → ONE merged bundle:
echo '{"outDir":"<dir>","critiques":[<result A>,<result B>,…]}'            | NODE_USE_ENV_PROXY=1 node <SKILL_DIR>/bundle-from-critique.mjs
```

`NODE_USE_ENV_PROXY=1` is the fast path for sandboxes whose proxy Node's fetch ignores (Node ≥ 24;
harmless elsewhere). On older Nodes the bundler falls back to `curl` by itself — and if a fetch
still fails terminally, its skip reason says exactly what to do.

Writes per chart: `<id>.raw.html` (the fetched/returned markup), `<id>.web.html` (self-contained,
opens offline), `<id>.artifact.html` (body fragment for the Artifact tool), plus a shared
`manifest.json`. `files.png` is `null` — PNGs are `becise-place`'s job. All paths are relative to
the bundle dir.

**Check the returned flags before publishing anything:**

| Flag | Means | Do |
| --- | --- | --- |
| `warning` | low-token fallback | re-check the crop, retry once (Step 2) |
| `skipped[].reason` mentions URL fetch | presigned `html` URL expired/unreachable | re-run the tool for that chart, re-bundle |
| `payloadWarnings` naming a **JS syntax error** | the server emitted broken code; the chart renders EMPTY | never publish or hand-patch it; re-run the tool ONCE for that chart (the global cap); recurs → report it |
| `brokenWarning` / other `payloadWarnings` | bundled HTML has no chart payload, renders EMPTY | don't publish it; re-check the raw file |
| `nothingRebuilt` | every chart came back `isFallback` | publish nothing; report the failures |
| `warnings[]` | external ref survived inlining, unknown dep, or `VENDOR VERSION MISMATCH` | see NOTES.md |

**Duplicate `chart_id`s are refused** on both entry paths — the id is the filename, so a silent
overwrite loses a chart. Fix the ids. Genuinely re-running the same chart after a crop retry?
Add `"onDuplicate":"last-wins"`.

Lower level, if you already have `.raw.html` on disk:
`node <SKILL_DIR>/make-bundle.mjs '{"outDir":"<dir>","charts":[{"chart_id":"<id>","rawHtmlPath":"…"}]}'`

## Step 4 — Show the chart (do not skip)

**The user asked to see a better chart. Show it before you talk about it.** Files they can't see
feel like the job didn't finish. No Chrome, no PNG, no `becise-place` needed to SHOW — but verify
first when you can:

**Verify visually BEFORE publishing (when Chrome is available).** Syntactically perfect chart code
can still draw nothing (observed in the field: axes and labels rendered, zero bars — a data-shape
bug no parser can catch). If `becise-place` is installed and its preflight finds Chrome, render
each chart (~4s) and LOOK at the PNG:

```
node <becise-place dir>/render-png.mjs '{"webHtmlPath":"<dir>/<id>.web.html","out":"<dir>/<id>.check.png","width":900,"height":560}'
```

- **Data marks present?** Bars/lines/points/cells visible — not just axes, gridlines, and labels.
  A `grid` chart renders as an HTML table and facet layouts mount at runtime: table cells / panel
  charts count as marks. An all-zero series legitimately shows near-empty bars with "0" labels —
  that counts too.
- **Grossly consistent with the source?** The values you can read off the render should match the
  chart you sent (right magnitudes, right number of categories). Judge data integrity only — the
  design (chart type, colors, layout) is Becise's call, never re-litigate it.
- Fails either check → that is the chart's ONE re-run (global cap). The re-run renders broken the
  same way → **report it with the check PNG as evidence and publish nothing for that chart** — a
  systematic rendering bug won't fix itself by resampling, and publishing a blank or wrong chart
  is worse than a clear failure report.
- No Chrome / no `becise-place` → publish as normal and note the chart is visually unverified.

- **One chart** → publish its `<id>.artifact.html` **directly** with the Artifact tool. It's already
  a deps-inlined fragment in a sized card. Don't re-design, rewrite, or wrap it.
- **Several** → one gallery, then publish that file. `build-gallery.mjs` lives in **`becise-place`**,
  so locate it first — same install root as this skill, or
  `find /mnt/skills ~/.claude/skills -name build-gallery.mjs 2>/dev/null | head -1`:
  `echo '{"dir":"<dir>","out":"<dir>/gallery.html","title":"…"}' | node <path>/build-gallery.mjs`
  Not found? Publish them **one at a time** — that is a complete answer, not a degraded one.
  **Never concatenate fragments** — their top-level `const`s and `Chart.register` calls collide at
  page scope.

Never publish an entry with `isFallback` or `emptyPayload` true; name those as "not rebuilt", with
the reason. Then one short message: what you rebuilt, what failed and why, what's next. The chart is
the answer — keep the prose brief.

## Step 5 — Hand off

`manifest.json` is a consumed contract (`manifest_version: 1`; every entry has the same keys, nulls
never absent). Full shape in NOTES.md.

- Wants it **in a Slides deck / Doc, as a PNG, or replaced in place** → hand the bundle dir to
  **`becise-place`**. Those paths need Chrome; it checks and says so if missing.
- Wants **just the chart** (the common case) → Step 4 already delivered it. Don't republish.
- **No `becise-place` installed** → say what's in the bundle dir and what each file does
  (`web.html` opens in any browser offline). A missing skill limits destinations; it must never look
  like a failure.

## Rules

- Colors come back pre-themed. **Accept them as-is** — never re-theme here.
- **No hand-authored chart code, ever — including when Becise fails.** A failed rebuild is reported,
  not replaced with your own chart. No full-view screenshots as a substitute for a real crop.
- Translate script errors into plain language for the user; don't paste raw stack output.
- **After editing any `.mjs` here, run `node <SKILL_DIR>/selftest.mjs`** (no network, Chrome, or
  MCP). It covers the silent-failure modes: id collision, quote-blind inlining, all-fallback,
  payload-less HTML, syntax-corrupt HTML, placeholder metadata, URL-mode html (fetch + curl
  fallback), single-object results, transform pinning, manifest shape.
