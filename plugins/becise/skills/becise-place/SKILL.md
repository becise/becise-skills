---
name: becise-place
description: >
  Put an already-rebuilt chart bundle where the user wants it — insert it into a Google Slides deck
  or Doc, render it as a PNG, publish it as a live page, or replace the original in place. Consumes
  the `manifest.json` bundle produced by the `becise-chart` skill (or any `becise-critique` chart
  output shipping the same `manifest.json`). Use when the user already HAS a
  chart bundle and wants to place / deliver / reuse it. To produce a bundle from a raw chart first,
  use `becise-chart` — which also shows the chart, so you don't need this just to see it.
---

# Becise Place — bundle → destination

Orchestration only. **No Becise IP here.** `becise-chart` produces the bundle and shows the chart;
this skill puts it somewhere specific. The handoff is `manifest.json` — nothing else crosses the
seam. Don't assume a destination; pick the mode from what the user asks for.

Background and rationale live in `NOTES.md` next to this file.

## Where the scripts live

Commands write `<SKILL_DIR>` for the directory holding this SKILL.md — substitute the path you
loaded it from. Never assume `~/.claude/skills/…`: uploaded skills mount under `/mnt/skills/`,
Claude Code uses `~/.claude/skills/`, plugins use `${CLAUDE_PLUGIN_ROOT}/skills/`.

## Preflight: check for Chrome BEFORE promising anything

**Most Claude containers have no Chrome**, and every PNG path depends on it. Check the **same
locations `render-png.mjs` checks** — a bare `which google-chrome` is a false negative on macOS,
where Chrome is an `.app` and not on `PATH`:

```
for c in "$CHROME" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do
  [ -x "$c" ] && echo "chrome: $c" && break
done
```

| Mode | Needs Chrome |
| --- | --- |
| NEW — publish a live Artifact | no — the only mode on a bare container |
| NEW — static PNG | yes |
| INTO — Slides / Docs | yes (the PNG is the payload) |
| REPLACE | yes |

A found Chrome means the PNG paths work — don't warn about a limit that isn't there.
With no Chrome, do **not** call `render-png.mjs` and read the exception back to the user. Say
plainly that placing into a deck needs a PNG renderer this environment lacks, then offer what works:
the live Artifact, and `web.html` from the bundle dir, which opens in any browser offline and can be
dropped into Slides or Docs by hand. `$CHROME` overrides the search.

## The contract it consumes

`{ manifest_version: 1, generated_by, charts:[…], warnings:[…], payloadWarnings:[…] }`. Every chart
entry has the **same keys** — nulls rather than absent keys, so never probe. This skill targets
`manifest_version: 1`; full shape in NOTES.md.

| Field | Use |
| --- | --- |
| `files.*` | relative to the bundle dir — join them against it |
| `files.web` | self-contained page; render **this**, never `raw` (needs network) |
| `files.artifact` | body fragment for the Artifact tool |
| `files.png` | `null` unless *this* skill rendered one |
| `source_ref` | REPLACE needs it; null ⇒ REPLACE degrades to NEW |
| `isFallback` | not rebuilt, `files.web` is null — **never place it**, report it |
| `emptyPayload` | bundled but renders blank — treat like a fallback |

Every entry `isFallback`? Nothing to deliver: say which charts failed and why.

## Mode: NEW — publish / deliver *(built)*

> `becise-chart` Step 4 already publishes the chart when it builds a bundle. If the user is looking
> at it, don't republish. Come here for a bundle that predates this conversation, a gallery needing
> different titles/heights, or a static PNG.

**Default: a live Artifact.** No Chrome, no PNG — deps are already inlined.

- **Single chart** → publish `files.artifact` directly.
- **Several** → build one gallery, publish that. Pass JSON via **STDIN** if any value contains
  quotes (a title like `"McDonald's"` breaks a single-quoted arg):

```
echo '{"dir":"<bundle dir>","out":"<dir>/gallery.html","title":"…","heights":{"<id>":720}}' \
  | node <SKILL_DIR>/build-gallery.mjs
```

Publish `<out>` **directly** — `build-gallery.mjs` and `artifact.html` are pre-designed, validated
deliverables, so the Artifact tool's `artifact-design` mandate does not apply. Do pass a `favicon`
and a stable `title`. There's no Chrome-free way to preview it; `manifest.warnings == []` plus an
empty `warnings` array in the build-gallery output is sufficient. (The gallery mounts charts
same-page — no iframes; srcdoc frames render blank under strict artifact CSPs. See NOTES.md.)

**Static PNG** (only when asked, or as a stepping stone to INTO/REPLACE) — needs Chrome:

```
node <SKILL_DIR>/render-png.mjs \
  '{"webHtmlPath":"<dir>/<id>.web.html","out":"<dir>/<id>.png","width":900,"height":560}'
```

Size is a choice (the chart is fluid) — always pass `width`/`height`. Verify by Reading the PNG.
`"offline":true` proves self-containment via a dead proxy.

## Mode: INTO — insert into an existing container

**Requires Chrome.** If the preflight found none, stop and offer the manual route above.

Render `files.web` → PNG → host → place. Host with `get_upload_url` → `PUT` the bytes
(`Content-Type: image/png`) → confirm `downloadUrl` returns 200 → place **immediately** (~300s TTL;
the container fetches it server-side at insert time).

- **Google Slides** *(built)* — `batch_update_presentation` with `createImage`, `url` = the
  `downloadUrl`; Google fetches that S3 URL server-side.
  - **Assign your own page id.** Don't look up the slide id with `get_presentation` — observed to
    hang (375s). Add a `createSlide` with your own `objectId` (`predefinedLayout: "BLANK"`) in the
    same batch, or target a page id you already hold.
  - **Sizes are EMU** (914400/inch; widescreen page 9144000×5143500). Final = `size` × `scaleX/Y`:
    set `scale: 1`, put real dimensions in `size`. Verify with `get_page_thumbnail`.
- **Google Docs** *(built, new-doc only)* — no Docs insert-image tool is exposed, so you **cannot**
  positionally insert into an existing doc. Create a new Doc with the chart embedded via
  `import_to_google_doc` (`source_format: "html"`, HTML inline in `content`, `<img src>` = the
  `downloadUrl`); Google embeds a permanent copy at import, so the TTL only needs to outlast it.
  `file_path` does not work (the Workspace MCP can't read local disk). Verify by exporting to PDF
  and confirming an `/Image` XObject.
- **Sheets / Slack** *(not yet built)* — upload the image.

## Mode: REPLACE — round-trip into the original *(not yet built)*

Needs `source_ref`. Clean only for a **single replaceable object in an editable container**. A
multi-shape chart (`replaceable:"cluster"`) or a PDF/dashboard (`"none"`) → **degrade to a NEW copy
and say so.** This is the only irreversible outward-facing step: default to operating on a copy, and
confirm before the write.

## Rules

- Colors are pre-themed by Becise. **Accept them as-is** — never re-theme on placement.
- Never place an `isFallback` or `emptyPayload` chart; surface it as "not rebuilt".
- Never `updatePageElementTransform` a placed chart image — it drops out blank. Place at final
  coordinates.
- Translate script errors into plain language; don't paste raw stack output.
- Built + validated: NEW, INTO → Slides, INTO → Docs (new-doc). Unbuilt: INTO → Sheets/Slack,
  REPLACE. When you build one, exercise it against a real container and flip its marker.
