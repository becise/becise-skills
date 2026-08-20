---
name: becise-chart-emphasis
description: >
  Lock the takeaway for a cropped chart with the human, then rebuild it via the Becise MCP with
  server-derived emphasis and SHOW the result. Runs after `becise-chart` hands off a cropped chart
  (chart_id + hosted image URL) — always asks a multiple-choice question grounded in `chart_assess`
  candidates before any chart is built or shown, handles a possible one-question follow-up, then
  calls `rebuild_chart` with the locked takeaway, bundles, and publishes. Never activates on
  `slide_revision_analyze` / `slide_revision_critique` / `slide_revision_build` — chart exhibits on
  the slide-revision path are unaffected and unrelated to this skill.
---

# Becise Chart Emphasis — ask → rebuild → bundle → SHOW

Orchestration only. **No Becise IP lives here** — extraction, takeaway candidates, mark selection,
and rendering all happen server-side behind the `chart_assess` / `rebuild_chart` MCP tools.

```
becise-chart hands off ──► chart_assess ──► ask #1 ──► rebuild_chart ──► bundle ──► SHOW ──► (place)
{chart_id, crop url}       candidates      multiple    confirmedInsight   merged     Artifact  becise-place
per chart                  (no HTML)       choice      (+ optional        bundle
                                                         clarification)
```

**Always ask, per chart, even if the user already said the takeaway.** No draft chart is ever
shown before the ask. `becise-place` only runs after this skill has SHOWN the final chart —
never before.

Background and rationale live in `NOTES.md` next to `becise-chart`'s `SKILL.md`; this skill's own
`NOTES.md` (next to this file) covers the ask/clarification contract specifically.

## Where the scripts live

The bundler (`make-bundle.mjs`, `bundle-from-critique.mjs`) lives in the **`becise-chart`** skill's
directory, not this one — locate it the same way `becise-chart` locates cross-skill scripts:
`find /mnt/skills ~/.claude/skills -name bundle-from-critique.mjs -path '*becise*' 2>/dev/null | head -1`.
The PNG verification helper (`render-png.mjs`) lives in **`becise-place`** — same lookup pattern,
different filename. Never assume `~/.claude/skills/…` directly; substitute the path you loaded
things from.

## When you activate

Immediately after `becise-chart` hands off one or more cropped charts (`chart_id` + hosted crop
`downloadUrl`, each). Also activates if the user directly asks to "improve"/"rebuild"/"fix" a chart
and a crop already exists from earlier in the conversation.

**Never activate on `slide_revision_analyze`, `slide_revision_critique`, or `slide_revision_build`.**
Chart exhibits produced on that path follow the slide-revision build contract only — this skill has
no role there, and slide-revision's own story lock (`confirmedClaim`) is a different mechanism for a
different surface.

## Step 1 — Assess (per chart, no HTML)

For each handed-off chart, call `chart_assess`:

```
chart_assess({
  chartImage: { url: <crop downloadUrl>, mimeType: "image/png" },
  chart_id: <the chart_id from becise-chart>,
  context: { text?: <what becise-chart observed around the chart> }
})
```

Poll `get_result` on `{state:"pending"}` — this is fast (extraction + one text call), typically
under a minute. On `done`, you get `candidate_claims` (2–3 takeaway sentences), a `series_sketch`
(category/series labels — keep these, you'll need them if a clarification comes up later), and
`next_step` telling you to stop and ask. **No chart is shown or built at this point.**

**Multi-chart job:** run assess and ask #1 separately for each chart — never batch several charts'
takeaways into one combined question.

**`additional_datasets_detected` on the result** — the server extracted the image and found more than
one *unrelated* dataset in it (different measures, not more panels of one dataset), and assessed only
the first. The candidates you received describe that first dataset alone. This is a signal that the
crop spanned two genuinely separate charts — not an error, and not something to retry:

- Go back to the view, crop the other chart as its own family, host it, and run assess for it too —
  then ask #1 separately per chart, as above.
- Do NOT put the extra datasets to the human using the candidates you have; those candidates do not
  describe them.
- If re-cropping isn't possible (the source is no longer available), say plainly that the image held
  more than one chart and only the first was handled. Never quietly ship one chart as if it were all
  of them.

**If `chart_assess` is not in the tool listing** (older server), fall back to the legacy flow: call
`rebuild_chart` directly with the human's stated takeaway as `context.story` (soft framing, not the
locked emphasis contract), then bundle and SHOW without an emphasis ask.

## Step 2 — Ask #1: what should the audience take away? (always)

Present the candidates as a multiple choice, in the human's language — never say "candidate_claims,"
"confirmedInsight," or other field names in chat.

```
What's the one thing this chart should prove?

1. <candidate_claims[0]>
2. <candidate_claims[1]>
3. <candidate_claims[2] if present>
4. They're all roughly comparable — no single standout
5. Something else
```

Always include option 4 (maps to `emphasisModeHint: "none"`) even when none of the candidates reads
as an even-comparison option — the human may see the data differently than the server's candidates
suggest. Always include "Something else" as the last option (freeform).

**Ask even when the user already stated a takeaway earlier in this thread.** Their prior words don't
skip this ask — map them into the multiple choice (as one of the options, or as your best guess at
"Something else" pre-filled) and confirm, rather than silently locking it. This is the one place
this skill differs from `becise-story-enrichment`'s "already-answered, skip re-asking" shortcut —
per-chart emphasis is always a fresh ask.

**The user does not need to see the chart to answer.** Never render a preview to help them decide.

**Mapping the answer:**

| They picked | Set on the next call |
|---|---|
| A candidate sentence | `confirmedInsight = <that sentence>` |
| "Roughly comparable / no standout" | `emphasisModeHint: "none"` (confirmedInsight optional) |
| Something else / typed their own | `confirmedInsight = <their words>` |

## Step 3 — Rebuild with the locked takeaway

```
rebuild_chart({
  chartImage: { url: <crop downloadUrl>, mimeType: "image/png" },  // same crop as Step 1 (mint a fresh URL if the original expired)
  chart_id: <same chart_id>,
  confirmedInsight?: <from the mapping above>,
  emphasisModeHint?: "none"   // only when they picked the comparable/no-standout option
})
```

Poll `get_result` on `{state:"pending"}`. Three outcomes:

**`emphasis_status: "applied"`** — success, marks punched. Go to Step 4 (bundle).

**`emphasis_status: "none"`** — success, no punch (either their explicit choice, or the server
couldn't resolve a clarified takeaway to marks and soft-landed). Go to Step 4 — **do not** ask
anything further about this.

**`emphasis_status: "needs_clarification"`** — a NORMAL result, not an error and not a retry. The
server couldn't map the takeaway to a specific mark with confidence. Ask **exactly one** follow-up
question using the returned `labels` (category/series names) — still no chart shown:

```
Which one do you mean — <label 1>, <label 2>, or <label 3>?
```

Then re-call `rebuild_chart` with the **same** `confirmedInsight` plus `emphasisClarification: <their
answer>`. Whatever comes back next (`applied` or `none`), stop asking — never a second clarification
round for the same chart.

**`additional_datasets_detected` (can accompany any of the three outcomes)** — the crop held more than
one unrelated chart and only the first was rebuilt. Do NOT re-run this chart: the one you got back is
correct and complete for its own dataset, and this does not count against the retry cap. Instead,
finish this chart normally (bundle it), then crop the other chart as its own family and run this skill
from Step 1 for it — it needs its own assess and its own ask, since a takeaway locked for one dataset
says nothing about another. Tell the human the source held more than one chart and that you're
handling them separately; never present the first as though it were the whole picture.

**Retry cap (failures, not clarification):** at most ONE re-run per chart for an actual failure —
`isFallback: true`, a content-filter reason, or an empty/broken payload. The clarification round
above does not count against this cap; it is designed flow, not a failure. When the cap is reached,
the deliverable IS the failure report: which chart failed, why, and an offer to retry later. Include
extracted values in that report if you have them (the user's own data) — but **never render a chart
yourself**, not from the image, not from extracted data, not "as a fallback." A hand-built chart
wearing Becise's data delivers the analysis stripped of the product.

## Step 4 — Build the bundle

Same bundler as before, now called from here. Pipe the tool result straight in — prefer STDIN;
multi-chart results exceed argv limits.

```
# one chart:
echo '{"outDir":"<dir>","result":<rebuild_chart result>}' | NODE_USE_ENV_PROXY=1 node <bundler path>/bundle-from-critique.mjs
# several charts → ONE merged bundle:
echo '{"outDir":"<dir>","critiques":[<result A>,<result B>,…]}' | NODE_USE_ENV_PROXY=1 node <bundler path>/bundle-from-critique.mjs
```

`NODE_USE_ENV_PROXY=1` is the fast path for sandboxes whose proxy Node's fetch ignores (Node ≥ 24;
harmless elsewhere). URL-mode `html` (a presigned URL, ~3h TTL) is fetched by the bundler —
**bundle promptly**; an expired URL skips that chart with a clear reason (re-run `rebuild_chart` for
a fresh one).

Writes per chart: `<id>.raw.html`, `<id>.web.html` (self-contained, opens offline),
`<id>.artifact.html` (body fragment for the Artifact tool), plus a shared `manifest.json`.
`files.png` is `null` — PNGs are `becise-place`'s job.

**Check the returned flags before publishing anything** — same table as always:

| Flag | Means | Do |
| --- | --- | --- |
| `warning` | low-token fallback | re-check the crop, retry once (Step 3's retry cap) |
| `skipped[].reason` mentions URL fetch | presigned `html` URL expired/unreachable | re-run `rebuild_chart` for that chart, re-bundle |
| `payloadWarnings` naming a **JS syntax error** | broken code, chart renders EMPTY | never publish or hand-patch; one re-run (the cap); recurs → report |
| `brokenWarning` / other `payloadWarnings` | bundled HTML has no chart payload | don't publish; re-check the raw file |
| `nothingRebuilt` | every chart came back `isFallback` | publish nothing; report the failures |
| `warnings[]` | external ref survived inlining, unknown dep, `VENDOR VERSION MISMATCH` | see `becise-chart`'s `NOTES.md` |

Duplicate `chart_id`s are refused (the id is the filename). Genuinely re-running the same chart
after a retry? Add `"onDuplicate":"last-wins"`.

## Step 5 — Show the chart (do not skip)

**The user asked to see a better chart. Show it before you talk about it.** No Chrome, no PNG, no
`becise-place` needed to SHOW — but verify first when you can.

**Verify visually BEFORE publishing (when Chrome is available).** Syntactically perfect chart code
can still draw nothing. If `becise-place` is installed and its preflight finds Chrome, render each
chart (~4s) and LOOK at the PNG:

```
node <becise-place dir>/render-png.mjs '{"webHtmlPath":"<dir>/<id>.web.html","out":"<dir>/<id>.check.png","width":900,"height":560}'
```

- **Data marks present?** Bars/lines/points/cells visible. A `grid` chart renders as an HTML table;
  facet layouts mount at runtime — table cells / panel charts count as marks. An all-zero series
  legitimately shows near-empty bars with "0" labels — that counts too.
- **Grossly consistent with the source?** Values you can read off the render should match what you
  sent (right magnitudes, right category count). Judge data integrity only — chart type, colors,
  layout, and emphasis choice are Becise's call; never re-litigate them.
- Fails either check → that's the chart's one re-run (Step 3's cap). Fails the same way again →
  report it with the check PNG as evidence, publish nothing for that chart.
- No Chrome / no `becise-place` → publish as normal and note the chart is visually unverified.

- **One chart** → publish its `<id>.artifact.html` **directly** with the Artifact tool. It's already
  a deps-inlined fragment in a sized card. Don't re-design, rewrite, or wrap it.
- **Several** → one gallery, then publish that file. `build-gallery.mjs` lives in `becise-place` —
  locate it the same cross-skill way: `find /mnt/skills ~/.claude/skills -name build-gallery.mjs 2>/dev/null | head -1`.
  `echo '{"dir":"<dir>","out":"<dir>/gallery.html","title":"…"}' | node <path>/build-gallery.mjs`
  Not found? Publish one at a time — that's a complete answer, not a degraded one. **Never
  concatenate fragments** — their top-level `const`s and `Chart.register` calls collide at page scope.

Never publish an entry with `isFallback` or `emptyPayload` true; name those as "not rebuilt," with
the reason. Then one short message: what you rebuilt, what the takeaway was, what's next. The chart
is the answer — keep the prose brief.

## Step 6 — Hand off to becise-place (only if they want it placed somewhere)

`manifest.json` is the consumed contract (`manifest_version: 1`) — full shape in `becise-place`'s
`NOTES.md`.

- Wants it **in a Slides deck / Doc, as a PNG, or replaced in place** → hand the bundle dir to
  **`becise-place`**. Those paths need Chrome; it checks and says so if missing.
- Wants **just the chart** (the common case) → Step 5 already delivered it. Don't republish.
- **No `becise-place` installed** → say what's in the bundle dir and what each file does
  (`web.html` opens in any browser offline). A missing skill limits destinations; it must never
  look like a failure.

## Rules

- **Always ask #1, per chart, no exceptions** — including multi-chart jobs and threads where the
  user already stated a takeaway.
- **Never show a chart before the ask.** Assess produces no HTML; nothing exists to show yet.
- **Never ask a second clarifying question for the same chart.** One `needs_clarification` round,
  then accept whatever the server does next.
- **Never treat `needs_clarification` as an error.** Don't retry the same call, don't report a
  failure — ask the one follow-up and re-call.
- Colors and emphasis come back pre-themed and pre-decided. **Accept them as-is** — never re-theme
  or re-pick marks here.
- **No hand-authored chart code, ever — including when Becise fails.** A failed rebuild is
  reported, not replaced with your own chart.
- **Never activate on `slide_revision_*` tools or slide-exhibit rebuilds.**
- Translate script errors into plain language for the user; don't paste raw stack output.
