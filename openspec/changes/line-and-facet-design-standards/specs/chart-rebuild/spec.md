# chart-rebuild — spec delta

These requirements extend the `chart-rebuild` capability to line and small-multiple output. They are
additive to the requirements established by `establish-chart-design-standards` (gridlines off,
no-collision labels, greyscale-hero emphasis, emphasis completeness) and do not restate them.

## ADDED Requirements

### Requirement: Quantitative axes retain readable tick labels

The rebuilt chart SHALL render tick labels on every quantitative axis so magnitude is readable from
the axis, unless every data point already carries a direct value label. In a small-multiple layout
each panel with an independent scale SHALL carry its own value-axis tick labels; a shared scale MAY
label ticks once on the edge panel.

#### Scenario: Single line chart with an unlabelled value axis

- **WHEN** the server rebuilds a line chart whose points are not all directly labelled
- **THEN** the value axis renders tick labels (a small number, e.g. up to ~5)
- **AND** the reader can read approximate magnitude off the axis

#### Scenario: Small multiples with independent scales

- **WHEN** the server rebuilds small multiples whose panels use independent value scales (e.g. a percent panel and a count panel)
- **THEN** each panel renders its own value-axis tick labels
- **AND** no panel is left with marks but no readable scale

#### Scenario: Every point directly labelled

- **WHEN** the chart labels every data point's value directly
- **THEN** the value-axis tick labels MAY be omitted, since magnitude is already readable from the marks

### Requirement: Small-multiple panels order by narrative role

The rebuilt small-multiple layout SHALL order panels by narrative role, not by input or series order.
The panel carrying the locked takeaway renders first — top for a vertical stack, left for a
horizontal row. When no takeaway is locked, the primary metric panel renders first.

#### Scenario: Locked takeaway names one metric

- **WHEN** `confirmedInsight` is about one of the faceted metrics (e.g. the fill-rate panel)
- **THEN** that metric's panel is placed first in reading order (top of a vertical stack, left of a row)
- **AND** the remaining panels follow as context

#### Scenario: No takeaway locked

- **WHEN** no `confirmedInsight` is supplied
- **THEN** the panel for the primary metric (by `role_hint`) renders first
- **AND** secondary/comparison panels follow

### Requirement: Line value labels are restricted to claim-named points

On a line or small-multiple chart the server SHALL label only the points the locked claim names, plus
optionally the series endpoints, and SHALL leave every other magnitude to the axis. The server SHALL
NOT blanket-label every point on a line, which competes with the line's shape.

#### Scenario: Claim names specific points

- **WHEN** the locked claim cites specific values (e.g. "91% in June … 79% in September")
- **THEN** only those points (June, September) carry value labels
- **AND** the remaining points are read from the axis

#### Scenario: No specific points named

- **WHEN** the claim is directional but names no specific point (e.g. "a steady decline")
- **THEN** the server labels at most the endpoints (first and last), or none, and relies on the axis
- **AND** it does not label every point

#### Scenario: Labelled points on a non-hero panel

- **WHEN** a small-multiple panel is not the one the claim is about
- **THEN** that panel carries no point labels and is read from its axis

### Requirement: Line and small-multiple emphasis executes as segment or region marking

When a takeaway is locked and resolves to a stretch of a line or a range of the category axis, the
server SHALL execute the emphasis visually: a **segment recolor** when the claim is about the line's
own behavior over a stretch (a rise/fall), or a **region wash** when the claim is about a time window
or category range. The emphasis mark SHALL be drawn beneath the data marks, in an attention hue
reserved for emphasis and distinct from the series color. A resolvable temporal or directional claim
SHALL NOT downgrade to `emphasis_status: "none"`.

#### Scenario: Claim about a time window

- **WHEN** `confirmedInsight` names a time window (e.g. "in the third quarter, July–September")
- **THEN** the server renders a region wash over that x-range on the panel the claim is about
- **AND** the wash sits beneath the line in a reserved attention hue, not the series color
- **AND** the result carries `emphasis_status: "applied"`

#### Scenario: Claim about a trend in the line

- **WHEN** `confirmedInsight` is about the line's own movement over a stretch (e.g. "fill rate fell from May to September")
- **THEN** the server recolors that segment of the line to the emphasis hue while the rest stays neutral
- **AND** the result carries `emphasis_status: "applied"`

#### Scenario: Resolvable claim must not silently no-op

- **WHEN** a locked temporal/directional claim resolves to a stretch or range on the rendered line/facet
- **THEN** the server does not return `emphasis_status: "none"` for lack of an execution path
- **AND** either a segment recolor or a region wash is rendered

#### Scenario: Even-comparison chosen

- **WHEN** the human chose the even-comparison / no-single-hero option
- **THEN** no segment or region emphasis is applied and the panels render neutrally

### Requirement: Value axes begin at zero

Every quantitative value axis on a line or small-multiple chart SHALL begin at zero — for bounded
ratio/rate/index metrics (percent, fill rate) as well as unbounded counts. The server SHALL NOT
truncate or float the baseline to amplify a change. When a zero baseline compresses the change into a
narrow band, the change is conveyed by claim-scoped value labels and by the emphasis wash/segment,
not by moving the baseline.

#### Scenario: Rate that lives in a narrow high band

- **WHEN** the server renders a bounded-rate series whose values sit in a narrow high band (e.g. fill rate 78–91%)
- **THEN** the value axis begins at zero
- **AND** the change is carried by the labelled claim points and the emphasis wash/segment, not by a truncated axis

#### Scenario: Unbounded count series

- **WHEN** the server renders an unbounded count or magnitude series (e.g. cases shipped)
- **THEN** the value axis begins at zero

### Requirement: Emphasis hue is distinct from series color

The attention hue used for a segment recolor or region wash SHALL be visually distinct from the
series color and from the greyscale de-emphasis ramp, so the emphasis reads as annotation rather than
as an additional series.

#### Scenario: Single-hue series with a highlighted region

- **WHEN** the series renders in the brand color and a region of the plot is washed for emphasis
- **THEN** the wash uses a low-opacity attention hue that differs from the series color
- **AND** a reader distinguishes the highlighted region from a second data series
