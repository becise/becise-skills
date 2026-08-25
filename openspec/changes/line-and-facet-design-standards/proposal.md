# Establish line and small-multiple design standards

## Why

A monthly combo chart (bars + a fill-rate line, Jul–Sep circled on the source slide) was run through
`becise-chart` → `becise-chart-emphasis` with the takeaway locked to *"Q3 saw a notable decline in
case fill rates, dropping to 78–81% vs. the 91% in May/June."* The first render was a set of clean
but under-specified line panels, and a hand remake was needed to make it presentation-ready. Grouping
the remake's edits by root cause shows the same shape as the prior `establish-chart-design-standards`
work: **one unreliable capability and four inverted/absent defaults**, all specific to lines and
small multiples and all recurring on every applicable chart:

- **Emphasis was locked but never drawn (unreliable capability).** The takeaway named a time window
  and a direction ("Q3 declined"), yet `rebuild_chart` returned `emphasis_status: "none"` and marked
  nothing. The whole ask/lock contract exists to turn a claim into marks; for a line/small-multiple
  it produced no marks. The remake had to add the emphasis by hand (a faint wash over Jul–Sep on the
  hero panel). This is the line analog of the stacked-bar gap the prior change closed — emphasis that
  silently no-ops because the rendered type lacks an execution path.
- **Y-axis tick labels were absent (inverted default).** No panel showed value ticks, so magnitude
  was unreadable — you could see shape but not that one panel spanned 0–100% and another 0–20,000
  cases. On independent-scale small multiples this is not cosmetic; it removes the only cue to each
  panel's scale.
- **Panels were ordered by input, not by narrative (inverted default).** The panel the title is about
  (fill rate) rendered **last**; the two context panels came first. The remake moved the hero to the
  top of the stack.
- **Line value labels were all-or-nothing (inverted default).** The first render labelled no points;
  the remake labelled exactly the two the sentence cites (Jun 91%, Sep 79%) and left the rest to the
  axis. A line's job is shape — labelling every point fights that, labelling none loses the anchors
  the claim depends on.
- **Rate axis could float its baseline (absent default).** A truncated axis is the classic way to
  exaggerate a change. The rebuilt chart must anchor every value axis at zero — for the bounded fill
  rate (78–91%) as much as for the counts — and carry the change through labels and emphasis, not by
  moving the baseline.

Gridless was already correct in both renders — that default landed with the prior change and is only
referenced here, not re-proposed. Fixing the emphasis path for lines/facets and inverting the four
defaults would have made the first render ~80% of the final. This proposal codifies the target
behavior as spec deltas so the server produces it by default and the skills verify the defect-level
subset before publishing.

## What Changes

- **`chart-rebuild` (server output contract):**
  - Quantitative axes retain tick labels by default, and each independent-scale small-multiple panel
    carries its own value-axis ticks.
  - Small-multiple panels are ordered by narrative role — the panel carrying the locked takeaway
    (or, absent one, the primary metric) renders first (top for a vertical stack, left for a row).
  - On line and small-multiple charts, value labels are restricted to the points the locked claim
    names (plus optional endpoints); the axis carries every other magnitude.
  - Line and small-multiple emphasis executes as a **segment recolor** (for a claim about the line's
    own behavior/trend) or a **region wash** (for a claim about a time window), keyed to the claim,
    drawn beneath the data marks in a reserved attention hue distinct from the series color. A
    resolvable temporal/directional claim SHALL NOT downgrade to `emphasis_status: "none"`.
  - Every quantitative value axis begins at zero — bounded rates/indices as well as counts; the
    baseline is never truncated or floated to amplify a change.
- **`chart-delivery-verification` (skills SHOW step):** the pre-publish visual check additionally
  asserts the defect-level subset it can judge from the render without re-authoring: every
  quantitative panel is readable (tick labels present, or every point directly labelled), and a
  locked directional/temporal claim actually produced visible emphasis. A violation is treated like
  an empty render — it consumes the one allowed rebuild retry. Ordering and baseline choice are
  server layout decisions and are not re-litigated by the skill.

## Impact

- **Affected specs:** `chart-rebuild` (delta — new requirements), `chart-delivery-verification`
  (delta — new requirement).
- **Affected code — server (`~/Desktop/treecise-webapp`, separate repo):** the small-multiple /
  multi-line templates and the emphasis-resolution path (axis-tick emission, facet ordering,
  claim-scoped line labels, segment/region emphasis execution, rate-baseline selection). Handed off
  as a sibling server change (suggested: `line-facet-emphasis-and-axes`), mirroring how
  `establish-chart-design-standards` was delivered into `treecise-webapp`'s
  `stackedbar-craft-and-emphasis`. This repo cannot edit server code.
- **Affected code — skills (this repo):**
  `plugins/becise/skills/becise-chart-emphasis/SKILL.md` (Step 5 invariants) and
  `plugins/becise/skills/becise-chart/selftest.mjs` if a static assertion is added. A skills change
  requires a `plugins/becise` version bump per `CLAUDE.md`.
- **Relationship to prior change:** additive. `establish-chart-design-standards` already ADDED the
  gridlines-off, no-collision-labels, greyscale-hero, and emphasis-completeness requirements; the
  requirements here extend emphasis-completeness and the label/axis defaults to the line and
  small-multiple types specifically, and do not restate the shared ones.
- **Backward compatibility:** default and correctness changes only. Already-published bundles are
  unaffected; every new default keeps an escape hatch (see `design.md`) so a chart that genuinely
  needs point-by-point labels, a different panel order, or a full-range rate axis can still opt in.
