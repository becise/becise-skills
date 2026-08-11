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
INGEST ──► CROP ──► host each crop ──► hand off to becise-chart-emphasis
pixels     one     get_upload_url        (assess → ask → rebuild → bundle → SHOW)
per view   chart    per chart
           each
```

**This skill's job ends at the handoff.** It never calls `chart_assess` or `rebuild_chart`, never
bundles, never shows a chart. `becise-chart-emphasis` owns everything from there — continue directly
into it for every kept chart; do not stop and wait for further instructions.

Background and rationale live in `NOTES.md` next to this file. Read it when something surprises you.

## Where the scripts live

Commands write `<SKILL_DIR>` for the directory holding this SKILL.md — substitute the path you
loaded it from. Never assume `~/.claude/skills/…`: uploaded skills mount under `/mnt/skills/`,
Claude Code uses `~/.claude/skills/`, plugins use `${CLAUDE_PLUGIN_ROOT}/skills/`. If lost:
`find /mnt/skills ~/.claude/skills -name 'make-bundle.mjs' -path '*becise*' 2>/dev/null | head -1`.
`node` is always present. Nothing here needs Chrome.

The bundler scripts (`make-bundle.mjs`, `bundle-from-critique.mjs`) live in this skill's directory
but are used by `becise-chart-emphasis`, not by this skill — bundling happens after the rebuild,
which doesn't exist yet at this point in the flow.

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
start at `chart1` collide when merged, and the bundler (in `becise-chart-emphasis`) refuses
duplicates.

**Big sources:** triage cheap metadata first (Slides `get_presentation` text, a PDF's extracted
text) to drop title/text/table pages, then eyeball only candidates; montage many views into one
contact sheet rather than reading each. **If the user named the view** ("the chart on slide 5"),
skip triage entirely and go straight to that one. **If nothing is chartable, stop** and say so.

## Step 1 — Ingest and CROP: one tight image per chart

Both `chart_assess` and `rebuild_chart` (called by `becise-chart-emphasis`, not here) take **the
chart, not the page around it**. A tight crop is faster, more accurate, and far less likely to trip
upstream image filters than a full slide (a busy full-slide image has been observed tripping a
provider content filter that the same chart's clean crop sailed through).

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
mandatory — a bad crop wastes a whole server round-trip in the next skill.

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

Render at 2–3× (crops at 3–4×). **Hosting each crop:** `get_upload_url` → `PUT` the bytes
(`Content-Type: image/png`; plain `--data-binary`, ignore the `crc32` param) → use the returned
`downloadUrl`. **Presigned URLs expire ~300s** — hand off to `becise-chart-emphasis` promptly, and
mint a fresh one for any retry there. (The server fetches the URL once at job start, so it only
needs to survive seconds, but don't cut it fine.)

## Step 2 — Hand off to becise-chart-emphasis (do not stop here)

For every kept chart you now have a `chart_id` and a hosted crop `downloadUrl`. Continue directly
into the **`becise-chart-emphasis`** skill for each one, in the same turn — don't wait for the user
to ask again, and don't SHOW, bundle, or call `chart_assess`/`rebuild_chart` yourself first.

Pass along, per chart:

- `chart_id` — the job-wide-unique id from Step 0
- the crop `downloadUrl` (or the crop bytes, if you'd rather re-host)
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
- No full-view screenshots as a substitute for a real crop.
- Translate script errors into plain language for the user; don't paste raw stack output.
- **After editing any `.mjs` here, run `node <SKILL_DIR>/selftest.mjs`** (no network, Chrome, or
  MCP). It covers the silent-failure modes: id collision, quote-blind inlining, all-fallback,
  payload-less HTML, syntax-corrupt HTML, placeholder metadata, URL-mode html (fetch + curl
  fallback), single-object results, transform pinning, manifest shape.
