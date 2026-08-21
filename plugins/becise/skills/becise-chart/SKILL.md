---
name: becise-chart
description: >
  Find, crop, and host a chart from ANY source (a Google Slides slide, an uploaded PDF/doc, a
  dashboard, a screenshot, or a plain image) so it can be assessed and rebuilt. Hands off cropped
  chart URLs to the `becise-chart-emphasis` skill, which asks the human what takeaway the chart
  should prove, rebuilds it via the Becise MCP, and shows the result — this skill does NOT call
  rebuild_chart, bundle, or SHOW anything itself. Use when the user wants to critique / rebuild /
  fix / improve a chart (as opposed to a whole slide); `becise-chart-emphasis` runs automatically as
  the next step. For full-slide critiques use `becise-critique`.
---

# Becise Chart → crop, host, hand off

Orchestration only. **No Becise IP lives here** — analysis happens server-side behind the
`chart_assess` / `rebuild_chart` MCP tools, which this skill does not call.

```
INGEST ──► GROUP ──► CROP ──► host each crop ──► hand off to becise-chart-emphasis
pixels     into      one      get_upload_url        (assess → ask → rebuild → bundle → SHOW)
per view   families  per      per family
                     family
```

**This skill's job ends at the handoff.** It never calls `chart_assess` or `rebuild_chart`, never
bundles, never shows a chart. `becise-chart-emphasis` owns everything from there — continue directly
into it for every kept family; do not stop and wait for further instructions.

Background and rationale live in `NOTES.md` next to this file. Read it when something surprises you.

## Before you start — load every becise tool in ONE ToolSearch

The becise MCP tools are deferred; each needs its schema loaded before the first call. Load **all of
them the pipeline will use in a single ToolSearch**, at job start, before the first crop:
`select:mcp__becise__get_upload_url,mcp__becise__chart_assess,mcp__becise__get_result,mcp__becise__rebuild_chart`.
One round-trip instead of three, and no ToolSearch stall between `chart_assess` and its `get_result`
poll. **Never reload a tool schema mid-session hoping it changed** — it won't. If a becise tool
returns an empty schema (`{properties:{}}`) or rejects an object arg with `expected object, received
string`, that is a server schema-publication bug, not a transient: stop and report it, do not retry
or reload.

## Where the scripts live

Commands write `<SKILL_DIR>` for the directory holding this SKILL.md — substitute the path you
loaded it from. Never assume `~/.claude/skills/…`: uploaded skills mount under `/mnt/skills/`,
Claude Code uses `~/.claude/skills/`, plugins use `${CLAUDE_PLUGIN_ROOT}/skills/`. If lost:
`find /mnt/skills ~/.claude/skills -name 'make-bundle.mjs' -path '*becise*' 2>/dev/null | head -1`.
`node` is always present. Nothing here needs Chrome.

The bundler scripts (`make-bundle.mjs`, `bundle-from-critique.mjs`) live in this skill's directory
but are used by `becise-chart-emphasis`, not by this skill — bundling happens after the rebuild,
which doesn't exist yet at this point in the flow.

## Step 0 — Find the chart families

Break the source into views (slides, PDF pages, dashboard panels, one screenshot), get pixels for
each (Step 1), and **look at every one yourself**.

**Is a chart:** bar/column, line/area, pie/donut, scatter/bubble, combo, funnel, heatmap —
plotted data geometry. **Colored-cell tables count** (heatmaps).
**Is not:** plain data tables, lone KPI numbers, process/flow/tree diagrams, maps, timelines,
isotype/pictographs, logos, photos. A concept diagram drawn to look chart-like (a funnel of shapes)
isn't chartable — note it rather than forcing it.

**The unit of work is a *family*, not a drawn chart.** A view often draws ONE dataset as several
visually separate charts, and cropping those apart destroys the comparison the slide exists to make.
Group them:

- **Same measure, same categories, drawn more than once** — the panels differ only in which *slice*
  they show (a period, a scenario, a source). Four donuts for July/Accumulated × Previous/Current
  Year is **one family**, not four charts.
- **A chart plus its own data table** — a table restating the same categories and values the chart
  draws is that chart's data layer, not a separate exhibit. One family. This matters most when the
  chart carries no data labels (an unlabelled pie next to a value table): crop them apart and the
  numbers are gone for good.
- **Panels sharing one legend, or sitting inside one row/column header grid** — the shared
  scaffolding is what names each panel. One family, and the crop must include that scaffolding.

**Split into separate families only on a genuine difference in measure** — different metrics,
populations, denominators, or time bases. Matching units and a matching axis are NOT evidence of one
dataset: two adjacent quarterly charts both labelled "% Change" are two families when one tracks a
guest-count gap and the other an average-check gap.

You do not have to get this perfectly right. The server makes the same call from the actual extracted
data and reports back when it disagrees — see `additional_datasets_detected` in
`becise-chart-emphasis`. **When genuinely unsure, group rather than split:** an over-grouped crop
comes back with a clear signal you can act on, while an over-split crop silently loses the
comparison and nothing downstream can tell.

Record per kept **family**: its view, where it sits (you'll crop it as ONE region in Step 1), and a
**`chart_id` unique across the whole job**, view-prefixed: `slide3_chart1`, `page9_chart1`. Two views
that each start at `chart1` collide when merged, and the bundler (in `becise-chart-emphasis`) refuses
duplicates.

**Big sources:** triage cheap metadata first (Slides `get_presentation` text, a PDF's extracted
text) to drop title/text/table pages, then eyeball only candidates; montage many views into one
contact sheet rather than reading each. **If the user named the view** ("the chart on slide 5"),
skip triage entirely and go straight to that one. **If nothing is chartable, stop** and say so.

**Fast path — a single already-tight chart image.** When the source is ONE image that is essentially
just the chart already (a screenshot or exported PNG, not a slide/PDF/dashboard and not a multi-panel
montage), skip the triage / contact-sheet / family-grouping machinery entirely: read it once to
confirm it is a chart and to spot any page chrome (title bar, logo, surrounding copy), then go
straight to Step 1 with a single family. Crop only if chrome is present; if the frame is already just
the chart, no crop is needed at all.

## Step 1 — Ingest and CROP: one image per family

Both `chart_assess` and `rebuild_chart` (called by `becise-chart-emphasis`, not here) take **the
chart family, not the page around it**. A crop scoped to the family is faster, more accurate, and far
less likely to trip upstream image filters than a full slide (a busy full-slide image has been
observed tripping a provider content filter that the same chart's clean crop sailed through).

**Tight means "excludes the page", not "excludes the family's own parts."** Crop to the whole region
the family occupies — every panel in it, plus everything between and around those panels that the
reader needs in order to decode a mark. Cutting a legend, a panel header, or a companion value table
out of frame is the single most damaging thing you can do here, because the server cannot recover
what was never in the image.

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

**Then crop each family out of its view:**

- **PDF-rendered views:** PyMuPDF `clip` renders the crop directly at high scale —
  `python3 -c "import fitz; d=fitz.open('in.pdf'); d[3].get_pixmap(matrix=fitz.Matrix(4,4), clip=fitz.Rect(x0,y0,x1,y1)).save('crop.png')"`
  (clip coords are in the page's point space — view the full render first and scale your estimate).
- **Raw images (thumbnails, screenshots):** PIL, in **ONE call** — read dimensions, crop, cap the
  size, save, and print the final dims all at once. Never run a separate dimension-probe call first;
  estimate the box from the image you already looked at and let the crop clamp to the real bounds:
  `python3 -c "from PIL import Image; im=Image.open('view.png'); W,H=im.size; c=im.crop((max(0,x0),max(0,y0),min(W,x1),min(H,y1))); c.thumbnail((1500,1500)); c.save('crop.png'); print(c.size)"`
  (`fitz` can also open plain images if PIL is missing).

**Must be INSIDE the crop** — anything needed to decode a value or name a panel:

- chart title, plus any parenthetical qualifier (units, currency basis, "inflation adjusted 2022 $",
  period coverage, "excludes X")
- axis titles, tick labels, data labels
- **the legend** — including one placed outside the plot, and including one shared by several panels
- on-plot annotations carrying meaning: bracket labels, callouts, sign conventions, reference lines
- **a companion data table** restating the chart's own categories and values
- footnote / source / "n =" line directly beneath
- for a panel grid: **the row and column headers that name each panel**
- totals printed above or beside the marks — these are often separate text boxes rather than part of
  the chart object, and they are real data the server needs

**Must be OUTSIDE the crop:** page headers/footers, page numbers, copyright and confidentiality
lines, corner logos, decorative dividers, an unrelated pull-quote parked beside the chart, and
anything belonging to a *different* family.

**Story text is captured as text, not pixels.** An explanatory sentence under the chart, or the slide
headline, goes into `context.text` at handoff (Step 2) rather than into the crop — it feeds the
takeaway without competing with the marks for resolution. Including it costs little when it sits in
the family's own column; it is not a substitute for passing it along as text.

Add a small margin on every side — descenders, tick labels, and the outer stroke of a legend swatch
routinely sit a pixel or two beyond where you'd draw the box. Extra whitespace inside a crop is
inert, so err generous.

**Verify every crop by LOOKING at it** before upload: every label/legend/axis readable, no data
marks cut off, every panel of the family present, nothing foreign in frame. Clipped labels → widen
and re-crop. This check is mandatory — a bad crop wastes a whole server round-trip in the next skill.

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
check found. **The two number pages differently — mind the off-by-one or you crop the wrong page:**

- **poppler — 1-based:** `pdftoppm -png -r 200 -f 9 -l 9 in.pdf page` → `page-9.png`
- **PyMuPDF — 0-based** (printed page 9 = index 8):
  `python3 -c "import fitz; d=fitz.open('in.pdf'); d[8].get_pixmap(matrix=fitz.Matrix(3,3)).save('page.png')"`

Only PyMuPDF renders a cropped region straight from the PDF; with poppler, render full and crop with
PIL. Missing a tool you need: `pip install pymupdf` / `pip install pillow` (add
`--break-system-packages` only if pip refuses on a distro-managed Python). Neither available and no
network → **say so plainly** rather than shipping a bad image.

Render at 2–3× (crops at 3–4×), **but cap the crop that leaves this skill at ~1500px longest side**
(the `thumbnail((1500,1500))` in the crop command above). `chart_assess`'s vision extraction is the
slowest step in the whole pipeline and its latency scales with image size; a 3–4× slide render is
multi-MB and buys no accuracy. The one floor: never shrink so far that the smallest data label (a
"0%"/"1%" slice tag) blurs — if the crop has tiny labels, keep it larger and re-check by eye.

**Two ways to get the crop to `chart_assess`, pick by size:**

- **Small crop (≲100KB): skip hosting, hand the FILE over.** Pass the crop's local path to
  `becise-chart-emphasis`; it inlines the bytes as base64 `data` on `chart_assess` directly. This
  drops `get_upload_url` **and** `host-crop.mjs` — two round-trips gone before the assess even starts.
- **Larger crop: host it.** Mint a URL pair with `get_upload_url`, then upload via `host-crop.mjs` —
  it validates the PUT (correct `Content-Type`, HTTP 200 check) and echoes the `downloadUrl` to reuse:
  `echo '{"crop":"<path>","uploadUrl":"…","downloadUrl":"…"}' | node <SKILL_DIR>/host-crop.mjs`.

**The durable artifact is the crop FILE, not the URL.** Presigned URLs expire ~300s, so mint
immediately before the call that consumes it and re-host from the file for any retry — never carry a
live URL across a wait. `get_upload_url` stays a tool call you make (it carries the server's secret
token, which never belongs in a script). Hand off to `becise-chart-emphasis` promptly.

## Step 2 — Hand off to becise-chart-emphasis (do not stop here)

For every kept chart you now have a `chart_id` and a hosted crop `downloadUrl`. Continue directly
into the **`becise-chart-emphasis`** skill for each one, in the same turn — don't wait for the user
to ask again, and don't SHOW, bundle, or call `chart_assess`/`rebuild_chart` yourself first.

Pass along, per chart:

- `chart_id` — the job-wide-unique id from Step 0
- the crop: a hosted `downloadUrl` for a larger crop, **or the crop's local file path** for a small
  one (≲100KB) so emphasis can inline it and skip hosting — see the two-ways note in Step 1
- anything you observed about where the chart lives and what surrounds it (you saw the full view —
  describe it in your own words; `becise-chart-emphasis` uses this as soft framing, never as the
  locked takeaway)

**Multiple charts in one job** → hand off all of them; `becise-chart-emphasis` asks about each chart
separately (never a combined ask) and produces one merged bundle at the end.

**If `becise-chart-emphasis` is not installed** (older plugin version), fall back to the legacy
one-skill flow, with no emphasis ask: call `rebuild_chart` per chart (`context.story` for any known
narrative, `context.text` for surrounding copy); poll `get_result` on `{state:"pending"}` and never
re-submit a pending job; allow **at most ONE re-run per chart total** for any failure (low-token
fallback, `content_filter`, syntax warning) and report+stop when the cap is hit rather than
hand-authoring a chart; then bundle with `bundle-from-critique.mjs` in this directory and SHOW
(verify visually with `becise-place`'s `render-png.mjs` when Chrome is available). Background on
why each of those rules exists lives in `NOTES.md`.

## Rules

- **No hand-authored chart code, ever.** This skill never calls a rebuild tool and never renders a
  chart itself — that is entirely `becise-chart-emphasis`'s job.
- No full-view screenshots as a substitute for a real crop — but a crop that spans several panels of
  ONE family is a real crop, not a full-view screenshot. The test is whether everything in frame
  belongs to the family, not how many chart-looking shapes it contains.
- Never crop a family's panels apart to "keep it tight". Splitting one dataset into several crops
  loses the comparison silently; grouping too much comes back as a fixable signal.
- Translate script errors into plain language for the user; don't paste raw stack output.
- **After editing any `.mjs` here, run `node <SKILL_DIR>/selftest.mjs`** (no network, Chrome, or
  MCP). It covers the silent-failure modes: id collision, quote-blind inlining, all-fallback,
  payload-less HTML, syntax-corrupt HTML, placeholder metadata, URL-mode html (fetch + curl
  fallback), single-object results, transform pinning, manifest shape.
