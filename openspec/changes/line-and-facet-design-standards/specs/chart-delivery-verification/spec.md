# chart-delivery-verification — spec delta

This requirement extends the pre-publish visual check in `becise-chart-emphasis` (Step 5, the SHOW
step) to line and small-multiple renders. It is additive to the invariant check established by
`establish-chart-design-standards`. The check asserts only the defect-level subset it can judge from
the render without re-authoring the chart; panel ordering and axis-baseline choice are server layout
decisions and are explicitly not re-litigated here.

## ADDED Requirements

### Requirement: Pre-publish check asserts line and small-multiple readability and emphasis

When Chrome is available, the SHOW-step visual check SHALL additionally assert, for line and
small-multiple renders: every quantitative panel is readable (value-axis tick labels are present, or
every point on that panel is directly labelled), and a locked directional/temporal claim produced
visible emphasis (a region wash or a recolored segment). A violation SHALL be treated like an empty
render — it consumes the one allowed rebuild retry rather than being published. The check SHALL NOT
fail a chart over panel order or baseline choice, which are the server's to decide.

#### Scenario: A panel has marks but no readable scale

- **WHEN** the rendered check shows a quantitative panel with data marks but no value-axis tick labels and no direct point labels
- **THEN** the check fails
- **AND** the failure triggers the single allowed `rebuild_chart` retry (not a publish)

#### Scenario: Directional claim produced no visible emphasis

- **WHEN** the locked claim is temporal or directional and the render shows no region wash and no recolored segment (and the result was `emphasis_status: "none"`)
- **THEN** the check flags the missing emphasis and consumes the single allowed retry

#### Scenario: Emphasis rendered and panels readable

- **WHEN** the render shows readable scales on every quantitative panel and the locked directional claim's emphasis is visible
- **THEN** the check passes and the chart is published

#### Scenario: Panel order or baseline is a server choice

- **WHEN** the render is readable and emphasis is present but the reviewer would have ordered panels differently or chosen a different axis baseline
- **THEN** the check does not fail on that basis; ordering and baseline are not re-litigated by the skill

#### Scenario: Chrome unavailable

- **WHEN** Chrome is not available to render the check
- **THEN** the chart is published with a note that it is visually unverified, as today
