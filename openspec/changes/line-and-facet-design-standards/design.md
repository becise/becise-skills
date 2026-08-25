# Design — line and small-multiple design standards

## Context

Derived from one rebuild session on a monthly combo chart (bars + fill-rate line, Jul–Sep circled on
the source) with the takeaway locked to a Q3 fill-rate decline. The first render was clean but
under-specified; a hand remake produced the target. Grouping the remake's edits by root cause gives
one unreliable capability (emphasis locked but not drawn) and four line/facet-specific defaults
(absent y-ticks, input-order panels, all-or-nothing point labels, undifferentiated rate baseline).
As with `establish-chart-design-standards`, the goal is to move the corrections upstream so the first
render is close to final. Gridless was already correct and is not re-proposed.

## Key decisions

### Design defaults live server-side; skills verify a defect subset, never re-author

Unchanged from the prior change: the server owns all chart-design IP and is the single source of
truth for chart HTML. Every requirement that shapes the rendered chart — tick labels, panel order,
claim-scoped labels, segment/region emphasis, rate baseline — is a `chart-rebuild` (server) delta so
every consumer inherits it. The skills add only a verification gate. The standing rule holds: **no
hand-authored chart code in the skills, ever** — the SHOW-step check fails a bad render and spends
the one retry; it does not patch the chart.

### Line emphasis is region/segment marking, not greyscale

The prior change's emphasis form is greyscale-the-others / color-the-hero, which suits bars and
categorical marks. A single line has no "other marks" to grey; its emphasis is a *stretch* of the
line or a *range* of the axis. Two primitives cover it: a **region wash** when the claim is about a
time window ("in Q3"), and a **segment recolor** when the claim is about the line's own movement
("fell from May to September"). Pick by whether the highlighted thing is a period or a trend. This is
why the requirement lives in `chart-rebuild` next to "Emphasis execution is complete across chart
types" — it closes the line/small-multiple version of the same silent-no-op gap the stacked bar had.

### Mandatory y-ticks and claim-scoped labels are one coupled decision

A line's job is shape, so blanketing every point with numbers competes with the mark; labelling only
the claim-named points keeps it clean. But dropping point labels means the *only* remaining cue to
magnitude is the axis — so the axis ticks become load-bearing. The two requirements are therefore a
pair: restrict point labels **and** guarantee axis ticks. Doing one without the other reproduces the
failure (the first render did neither: no point labels and no ticks, so magnitude was unreadable).
For independent-scale small multiples this is sharper still — each panel's ticks are the only signal
that panels are on different scales.

### Hero panel first is a narrative-ordering rule, not a size rule

Panels are ordered by which one carries the claim, not by series input order or by magnitude. The
reference render put the metric the title is about (fill rate) last; the remake moved it to the top.
Absent a locked claim, the primary metric (`role_hint`) leads. Ordering is a server layout decision;
the skill does not re-litigate it (see below).

### Zero baseline is mandatory for every value axis

Every quantitative value axis begins at zero — bounded rates as much as counts. A truncated or
floated baseline is the classic way to exaggerate a change, and allowing it "when framed" invites
exactly the ambiguity we want to remove. For a bounded rate in a narrow high band (fill rate 78–91%)
a zero baseline does compress the change into a flat band; that compression is intended, and the
change is carried by the claim-scoped labels (the 91% and 79% anchors) and the emphasis wash, not by
moving the baseline. The one honest cost — a visually mild slope — is accepted in exchange for a
chart that never overstates the move. This pairs with the emphasis requirement: the wash/segment is
what makes a zero-baselined change legible without dishonest scaling.

### Verification is scoped to render-judgable defects

The skill can see, from the check PNG, two defects without second-guessing taste: a quantitative
panel with marks but no readable scale, and a directional claim that produced no visible emphasis
(corroborated by `emphasis_status: "none"`). Those consume the one allowed retry, consistent with how
the prior change treated the stacked-bar emphasis gap. Panel order and baseline choice are *not*
render defects — they are server layout calls — so the verification requirement explicitly excludes
them to preserve the "skills never re-litigate chart design" boundary.

## Escape hatches (defaults, not mandates)

- **Y-axis ticks** — may be omitted only when every point is directly labelled (magnitude already
  readable).
- **Panel order** — narrative-first is the default; a chart with no locked claim falls back to
  primary-metric-first, and an explicit ordering hint (if the contract later grows one) overrides.
- **Line labels** — claim-named points plus optional endpoints; a chart that genuinely needs every
  point read exactly (rare for a line) can opt into full labelling.
- **Value baseline** — no escape hatch: every quantitative axis begins at zero.
- **Emphasis** — the even-comparison / no-standout takeaway renders neutrally with no wash or segment
  recolor.

## Open questions

- The exact attention hue and wash opacity (the reference remake used a ~10% red) are the brand's
  call and are left as "a reserved hue distinct from the series color," not pinned.
- Whether a segment recolor should also carry endpoint dots or a subtle label; left to the server
  template.
- Whether the delivery check should attempt the readability assertion when Chrome is absent (a static
  config lint of the emitted axis options) or stay render-only. This change keeps it render-only and
  publishes-with-a-note when Chrome is unavailable, matching the prior change.

## Not in scope

- Combo charts that keep a dual-axis single-frame layout (the source here was a combo chart split
  into small multiples by the server; whether to split vs. keep a dual axis is a chart-type Decider
  question, tracked separately server-side).
- Bar/column/stacked defaults, which `establish-chart-design-standards` already covers.
