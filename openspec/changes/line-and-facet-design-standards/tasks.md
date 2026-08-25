# Tasks — line and small-multiple design standards

Server-side items were implemented directly in `~/Desktop/treecise-webapp` as the sibling change
`line-facet-emphasis-and-axes` (see that repo's `openspec/changes/line-facet-emphasis-and-axes`),
mirroring how `establish-chart-design-standards`'s server work was delivered into
`stackedbar-craft-and-emphasis`. The `chart-rebuild` deltas here are the contract that change
implements.

## 1. Server (`treecise-webapp` — implemented in `line-facet-emphasis-and-axes`)

- [x] 1.1 Small-multiple tick labels always shown; each independent panel carries its own ticks
      (`beciseFacetYAxis` in `prompts/ChartHTMLBuilderSystem.js`; `smallMultiples.js`)
- [x] 1.2 Facet panel ordering narrative-first — claim's panel first, else total, else primary metric
      (`ChartTypeDeciderSystem.js` Step 5)
- [x] 1.3 Line/small-multiple value labels restricted to claim points; non-hero panels none
      (`beciseNamedPointDatalabels`; `line`/`smallMultiples` prose)
- [x] 1.4 Emphasis execution: new `region` (wash) / `segment` (recolor) modes, expressible on line +
      smallMultiples so a resolvable temporal/directional claim no longer downgrades to `none`
      (`chartEmphasis.js`, `ChartEmphasisDeriveSystem.js`, `beciseRegionWashPlugin` /
      `beciseEmphasisSegmentColor`)
- [x] 1.5 Mandatory zero baseline on every line/facet value axis (`beciseFacetYAxis` hard-coded;
      `line`/`multiLine` prose pins `zeroBaseline: true`)
- [x] 1.6 Reserved emphasis hue distinct from series color (`BECISE.emphasisWash` / `emphasisLine`)
- [x] 1.7 Regression: chart test suite green (51 passing); runtime helpers evaluated out-of-band;
      sanity invariant preserved (25 single backslashes, 0 pairs)
- [ ] 1.8 Re-run the reference combo chart through live `chart_assess` / `rebuild_chart` after deploy
      and confirm the first render matches the endorsed remake (requires deploy)

## 2. Skills — delivery verification (this repo)

- [x] 2.1 `becise-chart-emphasis/SKILL.md` Step 5: added the line/facet readability check + the
      directional-claim-emphasis check (no visible wash/segment with `emphasis_status: "none"` = defect)
- [x] 2.2 Both consume the one allowed rebuild retry; panel order and axis baseline explicitly NOT
      re-litigated
- [~] 2.3 Static selftest assertion not added — the facet y-tick behavior is now structural in the
      server runtime (`beciseFacetYAxis`) and covered by the server suite; skills verification stays
      render-only, consistent with the existing invariant checks

## 3. Release (this repo)

- [x] 3.1 Bumped `plugins/becise` `7.5.0` → `7.6.0` (MINOR) per `CLAUDE.md`
- [x] 3.2 Cross-referenced the server change (`treecise-webapp` `line-facet-emphasis-and-axes`) above

## 4. Validate

- [x] 4.1 `openspec validate line-and-facet-design-standards --strict`
