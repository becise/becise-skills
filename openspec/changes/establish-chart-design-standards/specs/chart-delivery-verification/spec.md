# chart-delivery-verification — spec delta

This requirement governs the pre-publish visual check in `becise-chart-emphasis` (Step 5, the SHOW
step), which renders the bundled chart to a PNG and inspects it before publishing. It is the
baseline for the `chart-delivery-verification` capability.

## ADDED Requirements

### Requirement: Pre-publish check asserts the design invariants

When Chrome is available, the SHOW-step visual check SHALL assert the design invariants in addition
to "data marks present": no interior gridlines unless the chart intentionally retained them, no
overlapping value labels, and the brand font actually rendered. A violation SHALL be treated like an
empty render — it consumes the one allowed rebuild retry rather than being published.

#### Scenario: Overlapping value labels in the render

- **WHEN** the rendered check PNG shows value labels overlapping
- **THEN** the check fails
- **AND** the failure triggers the single allowed `rebuild_chart` retry (not a publish)

#### Scenario: Brand font did not render

- **WHEN** the rendered check PNG shows a non-brand font (the DM Sans / bundler bug recurred)
- **THEN** the check fails and the chart is not published as-is

#### Scenario: Chrome unavailable

- **WHEN** Chrome is not available to render the check PNG
- **THEN** the chart is published with a note that it is visually unverified, as today

#### Scenario: All invariants hold

- **WHEN** the render shows data marks, no colliding labels, no unintended gridlines, and the brand font
- **THEN** the check passes and the chart is published
