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
`chart_critique` MCP tool.

```
INGEST ──► chart_critique ──► bundle-from-critique.mjs ──► SHOW ──► (hand off)
pixels     one call/image     raw/web/artifact + manifest  Artifact  → becise-place
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

Record per kept chart: its view, a plain-language `location` hint (`"bar chart, right half"`), and a
**`chart_id` unique across the whole job**, view-prefixed: `slide3_chart1`, `page9_chart1`. Two calls
that each start at `chart1` collide when merged, and Step 3 refuses duplicates.

**Big sources:** triage cheap metadata first (Slides `get_presentation` text, a PDF's extracted
text) to drop title/text/table pages, then eyeball only candidates; montage many views into one
contact sheet rather than reading each. **If the user named the view** ("the chart on slide 5"),
skip triage entirely and go straight to that one. **If nothing is chartable, stop** and say so.

## Step 1 — Ingest: a fetchable image per view

| Source | Pixels |
| --- | --- |
| Google Slides | `get_page_thumbnail` (`LARGE`) — pass its URL straight through, it's server-fetchable |
| PDF / doc | render the page to PNG (below) |
| Local Office file (`.pptx`/`.key`/`.docx`) | convert to PDF first (below), then render the page |
| Image / screenshot / dashboard | use as-is |
| Webpage | screenshot the region (claude-in-chrome) |

**From Google Drive:** `get_drive_file_download_url` → `curl` it to disk (HTTP mode returns a temp
URL, not a path; a huge file may return base64-in-JSON → `jq -r .content | base64 -d`).

**Hosting.** Already at a public URL (including Slides thumbnails)? Pass it straight to
`chart_critique`. Local or auth-gated (rendered PDF page, screenshot, private Drive file)? Host it:
`get_upload_url` → `PUT` the bytes (`Content-Type: image/png`; plain `--data-binary`, ignore the
`crc32` param) → use the returned `downloadUrl`. **Presigned URLs expire ~300s** — call
`chart_critique` immediately, and mint a fresh one for any retry.

**Office file → PDF.** Also **check, never assume**: `which soffice ; ls -d /Applications/Keynote.app`

- **`soffice --headless --convert-to pdf --outdir <dir> in.pptx`** wherever LibreOffice exists.
- **macOS:** drive **Keynote** by AppleScript — it opens `.pptx` and exports PDF reliably, and it
  ships on every Mac. `open POSIX file "…"` → `export … as PDF` → `close saving no`.
- **Export to a user-visible dir (`~/Downloads`), never the scratchpad** — Keynote and PowerPoint are
  OS-sandboxed and cannot write there. They report success and write nothing.

Reach for a PowerPoint MCP or PowerPoint itself only after both fail; its AppleScript export is
unreliable and its save verbs differ by version.

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

Only PyMuPDF can take a **tight crop** (a `clip` rect, or bounds from `page.get_text('dict')`) — the
thing the low-token-fallback retry needs. If only poppler is present and you need a crop, install it:
`pip install pymupdf` (add `--break-system-packages` only if pip refuses on a distro-managed Python).
Neither available and no network → **say so plainly** rather than shipping a bad image.

Render at 2–3×. The result is local → host it before calling.

## Step 2 — Analyze

One `chart_critique` call **per source image**: that image's `url` plus every chart on it in one
`charts[]` of `{ chart_id, location }`, plus `storyContext` when you know the narrative. Repeat
across views, keep each result. Poll `get_result` on `{state:"pending"}` (charts take 60–90s; tell
the user it's running). Don't hand-save the HTML — Step 3 does it.

**Fallbacks with low `usage.inputTokens`** (a few k, vs ~30k+ for a real run) mean the image was
barely processed, not that the chart is un-chartable. Retry that one chart ONCE with a tighter crop
(`fitz` `clip` — the case that justifies installing PyMuPDF). Rebuilds → the first image was bad.
Identical low-token fallback → genuinely un-chartable, carry it through flagged.

## Step 3 — Build the bundle

Pipe the tool result straight in. Prefer STDIN; multi-chart results exceed argv limits.

```
# one image:
echo '{"outDir":"<dir>","result":<chart_critique result>}'                 | node <SKILL_DIR>/bundle-from-critique.mjs
# several images → ONE merged bundle:
echo '{"outDir":"<dir>","critiques":[<result A>,<result B>,…]}'            | node <SKILL_DIR>/bundle-from-critique.mjs
```

Writes per chart: `<id>.raw.html` (as returned), `<id>.web.html` (self-contained, opens offline),
`<id>.artifact.html` (body fragment for the Artifact tool), plus a shared `manifest.json`.
`files.png` is `null` — PNGs are `becise-place`'s job. All paths are relative to the bundle dir.

**Check the returned flags before publishing anything:**

| Flag | Means | Do |
| --- | --- | --- |
| `warning` | low-token fallback | retry once, tighter crop (Step 2) |
| `brokenWarning` / `payloadWarnings` | bundled HTML has no chart payload, renders EMPTY | don't publish it; re-check the raw file |
| `nothingRebuilt` | every chart came back `isFallback` | publish nothing; report the failures |
| `warnings[]` | external ref survived inlining, unknown dep, or `VENDOR VERSION MISMATCH` | see NOTES.md |

**Duplicate `chart_id`s are refused** on both entry paths — the id is the filename, so a silent
overwrite loses a chart. Fix the ids. Genuinely re-running the same chart after a crop retry?
Add `"onDuplicate":"last-wins"`.

Lower level, if you already have `.raw.html` on disk:
`node <SKILL_DIR>/make-bundle.mjs '{"outDir":"<dir>","charts":[{"chart_id":"<id>","rawHtmlPath":"…"}]}'`

## Step 4 — Show the chart (do not skip)

**The user asked to see a better chart. Show it before you talk about it.** Files they can't see
feel like the job didn't finish. No Chrome, no PNG, no `becise-place` needed.

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
- No hand-authored chart code, ever. No slide screenshots as a substitute for ingest.
- Translate script errors into plain language for the user; don't paste raw stack output.
- **After editing any `.mjs` here, run `node <SKILL_DIR>/selftest.mjs`** (no network, Chrome, or
  MCP). It covers the silent-failure modes: id collision, quote-blind inlining, all-fallback,
  payload-less HTML, manifest shape.
