# Tasks — establish chart design standards

**Status note (post-implementation):** the server-side items below were investigated and fixed
directly in the actual server repo (`~/Desktop/treecise-webapp`), not left as a hand-off — see that
repo's `openspec/changes/stackedbar-craft-and-emphasis/`. That change's scope is narrower than this
proposal's original speculation in a few places (it's evidence-scoped to what the two reference
charts actually exercised); the mapping below records what actually landed vs. what's still open.

## 1. Server (`treecise-webapp` — real code, see that repo's `stackedbar-craft-and-emphasis` change)

- [x] 1.1 Font emission fixed — `chartTheme.js` (`toCssFontStack`) + `ChartHTMLBuilderSystem.js`
      (bare CSS splice, `JSON.stringify`-safe JS-string sites, `fontFamily` added to canonical `BECISE`)
- [x] 1.2 Root cause was more specific than "linked Inter instead of DM Sans" — the declared font was
      already correct; the bug was in how it got quoted/wrapped. No separate "reference the right
      webfont" fix was needed once 1.1 landed.
- [x] 1.3 Gridlines off by default — `ChartHTMLBuilderSystem.js`'s shared `beciseAxis()`, applies to
      every chart type, with a `showGrid` escape hatch for the dense-multi-series-line case
- [ ] 1.4 Collision-aware value labels — NOT done; no evidence gathered this session pinpointing a
      specific label-collision code path to fix (the stackedBar/multiLine renders that collided were
      traced to the font bug and missing emphasis wiring, not a labeling algorithm defect)
- [ ] 1.5 Compact labels / unit-stated-once — NOT done; no reproducing case found in the two
      reference charts (both already rendered bare numbers/percents)
- [x] 1.6 Greyscale de-emphasis + brand hero — confirmed already working for point/bar and multiLine
      series emphasis; extended to stackedBar (see 1.8)
- [x] 1.7 Hero-to-baseline ordering — already existed in `stackedBar.js`'s `bottom_series_name`
      mechanism; the actual gap was upstream (chart-type Decider's claim-to-series mapping on a
      *compound* claim) — flagged as a follow-up in that repo's `design.md`, not fixed (low
      confidence from one data point; risks papering over a real model-compliance gap)
- [x] 1.8 stackedBar series emphasis now executes — `chartHtmlAssembly.js` wires `withEmphasis`
      through to per-type templates; `stackedBar.js` gained the emphasis-application rule
- [x] 1.9 stackedBar's detached bottom legend replaced with `beciseSegmentLegendPlugin`
      (segment-aligned end labels), matching the direct-labeling convention `multiLine`/`waterfall`/
      `smallMultiples` already used — scoped to `stackedBar`; other types were already compliant
- [ ] 1.10 Bubble/scatter opacity — NOT done; out of this session's evidence (neither reference chart
      was a bubble/scatter type)
- [x] 1.11 Trend annotation prominence — `stackedBar.js`'s CAGR arrow: clearance 12px→80px, line
      weight 1.5→3.5, color axisLine(grey)→text(black), rate label gains a "CAGR" suffix
- [x] 1.12 Regression-checked: `node --test tests/chartPipeline.test.js` (202/202 passed) and a
      manual assembly check of all six chart-type templates with the fixed theme + emphasis on

## 2. Skills — bundler (this repo)

- [x] 2.1 `make-bundle.mjs`: embeds a vendored brand font as data-URI `@font-face` in `web.html` and
      `artifact.html`
- [x] 2.2 Superseded by a better design than originally speculated: instead of changing `FONT_STACK`
      to lead with DM Sans (which wouldn't render it without the font bytes present), added a
      `FONT_MAP` + `embedBrandFont()` that detects the chart's own declared family and embeds the
      matching vendored font — generic to whichever brand font is actually declared, not hardcoded
      to DM Sans. `FONT_STACK`'s existing Inter→system-font nudge is retained, now correctly gated to
      only apply when no brand font matched (its match pattern was also updated to the corrected,
      unquoted `Inter, sans-serif` the server now emits for the default theme).
- [x] 2.3 Added `vendor/DMSans-Regular.ttf` and `vendor/DMSans-Bold.ttf`, mapped via `FONT_MAP`
- [x] 2.4 Confirmed: `embedBrandFont` runs before the link-strip; the embedded font makes the link's
      removal safe (verified in `selftest.mjs`)
- [x] 2.5 `selftest.mjs`: 3 new cases — brand font embedded correctly, `toArtifactFragment`'s
      single-`<style>`-block extraction isn't stolen by the injected font-face, and the no-brand-font
      case still gets the (corrected) Inter fallback nudge
- [x] 2.6 `node selftest.mjs` — all passed

## 3. Skills — delivery verification (this repo)

- [x] 3.1 `becise-chart-emphasis/SKILL.md` Step 5: added a "text actually legible" check (label
      collision, brand font not rendering) — scoped as a defect check, explicitly not re-litigating
      chart type/color/layout choices
- [x] 3.2 States it consumes the one allowed rebuild retry, same as an empty render

## 4. Release (this repo)

- [x] 4.1 Bumped `plugins/becise` to `7.5.0` (MINOR) per `CLAUDE.md` — on top of an already-staged
      `7.3.0`→`7.4.0` bump from unrelated prior doc edits found already in the working tree
- [x] 4.2 Server-side work tracked in `treecise-webapp`'s own `openspec/changes/stackedbar-craft-and-emphasis`

## 5. Validate

- [x] 5.1 `openspec validate establish-chart-design-standards --strict` — valid
- [~] 5.2 Re-ran the `stackedBar` prompt assembly end-to-end (Node, not the live MCP) with a DM Sans
      theme + emphasis on: confirmed valid CSS/JS, emphasis section present, legend/arrow fixes
      present. Did NOT re-run the two reference charts through the live `chart_assess`/`rebuild_chart`
      MCP tools this session (server deploy required first) — that's the real end-to-end
      confirmation still outstanding.
