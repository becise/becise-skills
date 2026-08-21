# Design — establish chart design standards

## Context

Derived from two rebuild sessions whose edits, grouped by root cause, were one font bug, one
unreliable emphasis path, and three inverted defaults. The goal is to move those corrections upstream
so the first render is close to final.

## Key decisions

### Design defaults live server-side; skills verify, never re-author

The server owns all chart-design IP and is the single source of truth for chart HTML. Putting the
greyscale-emphasis / gridline / annotation defaults in the server means every consumer (this skill,
`becise-critique`, future ones) gets them without duplicating logic, and the skills stay pure
orchestration. The skills' role is a verification gate (`chart-delivery-verification`), not a second
place that draws charts. This preserves the standing rule: **no hand-authored chart code in the
skills, ever** — the verification step fails a bad render and spends the retry; it does not patch the
chart.

### Font: embed, don't link

Two surfaces make a linked webfont unusable: the Artifact CSP blocks external hosts, and the offline
`web.html` has no network. The only robust fix is embedding the face as a data URI in the bundle
(skills, `chart-bundle`). But the *server* must still emit a valid family stack and reference the
right font — otherwise the bundler embeds DM Sans while the chart declares a broken family or points
at Inter, and the embed is wasted. Hence the fix is split: server emits correct declarations
(`chart-rebuild`), bundler guarantees the bytes are present (`chart-bundle`). Either alone is
insufficient.

### Greyscale-emphasis is the execution of the takeaway, not a separate style

The ask/lock flow already produces a `confirmedInsight` and resolves it to marks. Greying the
non-heroes and coloring the hero is simply the visual form of that decision. Treating it as a first
-class output of emphasis (rather than an optional theme) is why requirement "Emphasis renders as
greyscale de-emphasis" sits in `chart-rebuild` next to "Emphasis execution is complete across chart
types" — the second guarantees the first actually happens for every chart type, closing the
stacked-bar gap where emphasis silently no-opped.

## Escape hatches (defaults, not mandates)

Each new default is overridable so a chart that genuinely needs the other behavior can still get it:

- **Gridlines** — retained (faint) for charts whose job is reading intermediate values off the axis.
- **Color** — the even-comparison / no-standout takeaway keeps the full categorical palette; greyscale
  applies only when a hero is chosen.
- **Legend** — a mark-aligned or direct label is preferred, but a detached legend remains valid when
  alignment is impossible (e.g. many thin segments).
- **Value labels** — dropping to axis-only is the fallback when labels cannot fit without collision.

## Open questions

- Exact palette values (hero brand color, the greyscale ramp, bubble opacity within 55–70%) are the
  brand's call and are left as ranges here rather than pinned.
- Whether the delivery-verification invariants should also run when Chrome is absent (e.g. a
  lightweight static-HTML lint) or stay render-only. This proposal keeps them render-only and
  publishes-with-a-note when Chrome is unavailable, matching today's behavior.

## Not in scope

- The slide-revision path (`slide_revision_*`) and its exhibits — a different build contract.
- Chart-type selection logic — unchanged; these rules apply to whatever type the server picks.
