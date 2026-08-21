# chart-rebuild — spec delta

These requirements establish the visual defaults the server's rebuilt-chart output must satisfy.
They are the baseline for the `chart-rebuild` capability.

## ADDED Requirements

### Requirement: Interior gridlines default to off

The rebuilt chart SHALL omit interior gridlines by default, retaining the value-axis line and its
tick labels. Faint gridlines MAY be retained only when the chart's job requires the reader to
estimate many intermediate values off the plot.

#### Scenario: Bar, column, or line chart with a labelled value axis

- **WHEN** the server rebuilds a bar, column, line, or stacked chart whose value axis carries tick labels
- **THEN** the emitted configuration disables interior gridlines
- **AND** the axis line and tick labels remain visible

#### Scenario: Reader must read intermediate values off the grid

- **WHEN** the chart's purpose is to let the reader estimate values between marks (e.g. a dense multi-series line read against the axis)
- **THEN** the server MAY retain faint interior gridlines
- **AND** the gridline color is low-contrast relative to the marks

### Requirement: Value labels never overlap

The rebuilt chart SHALL NOT render overlapping value labels. When labels would collide at the target
render size, the server SHALL reduce them — label endpoints or the emphasized mark only, apply a
minimum-gap displacement, or fall back to axis-only reading — rather than emit colliding text.

#### Scenario: Dense series would collide

- **WHEN** rendering every data point's value label would cause labels to overlap at the delivered size
- **THEN** the server thins, displaces, or drops labels so that no two rendered labels overlap

#### Scenario: Sparse categorical chart

- **WHEN** value labels fit without collision (e.g. one label per bar in a ten-bar chart)
- **THEN** each mark's value label is rendered

### Requirement: Value labels are compact and units stated once

A rendered value label SHALL be a bare number or a number with a very short unit suffix (e.g. `36%`,
`9.5M`). The full unit word SHALL be stated once, on the axis title or a footnote, not repeated on
every label.

#### Scenario: Millions series

- **WHEN** a series is measured in millions
- **THEN** point/bar labels read as `9.5` or `9.5M`, not `9.5 Millions`
- **AND** the word "Millions" appears once on the axis title or footnote

#### Scenario: Percentage series

- **WHEN** a series is measured in percent
- **THEN** labels read as `36%`

### Requirement: Emphasis renders as greyscale de-emphasis with a brand-colored hero

When a takeaway is locked (`confirmedInsight`), the server SHALL render the non-emphasized marks in
greyscale and the emphasized mark(s) in the brand color, and SHALL order a hero segment of a stacked
chart to the readable baseline. Text labels remain black; grey is reserved for de-emphasized marks
and secondary chrome.

#### Scenario: One hero among many bars

- **WHEN** the locked takeaway names specific bars as the point
- **THEN** those bars render in the brand color and all other bars render greyscale

#### Scenario: One hero series in a stacked bar

- **WHEN** the locked takeaway names one series of a stacked bar as the point
- **THEN** that series renders in the brand color, the other series render greyscale
- **AND** the hero series is ordered to the baseline of the stack

#### Scenario: No standout chosen

- **WHEN** the human chose the even-comparison / no-single-hero option
- **THEN** the server applies its neutral categorical palette with no greyscale de-emphasis

### Requirement: Emphasis execution is complete across chart types

When emphasis is chosen and resolvable to a mark, the server SHALL execute it visually for the chart
type it renders. A resolvable emphasis SHALL NOT silently downgrade to `emphasis_status: "none"`
because the chosen chart type lacks an execution path.

#### Scenario: Series emphasis on a stacked bar

- **WHEN** `confirmedInsight` resolves to a series and the server renders a stacked bar
- **THEN** the result carries `emphasis_status: "applied"` with the greyscale/hero treatment rendered
- **AND** the emphasized series remains legible (its swatch and label are visible against the background)

### Requirement: Labels and legends align to the marks they name

The rebuilt chart SHALL prefer direct labeling or a legend aligned to the relevant data cluster over
a legend detached from the marks. Where a legend is used on a stacked or grouped chart, each entry
SHOULD align vertically or horizontally to the segment it names in the nearest data cluster.

#### Scenario: Stacked bar legend

- **WHEN** the server renders a stacked bar with a legend
- **THEN** each legend entry aligns to its segment in the end-most stack, or the series are directly labelled

#### Scenario: Single-series chart

- **WHEN** the chart has one series
- **THEN** no detached legend is emitted; the series is named by the title or axis

### Requirement: Bubble and scatter marks are semi-transparent

The rebuilt bubble or scatter chart SHALL render its marks with a semi-transparent fill so that
overlapping marks remain distinguishable.

#### Scenario: Overlapping bubbles

- **WHEN** the server renders a bubble or scatter chart
- **THEN** the mark fill opacity is roughly 55–70%
- **AND** overlapping marks show the blended region

### Requirement: Trend annotations are prominent

A trend arrow, callout, or reference annotation SHALL be rendered with clearance above the marks, a
line weight that reads as intentional, and a high-contrast color, and SHALL NOT overlap the data
marks or their value labels.

#### Scenario: Growth arrow over a bar chart

- **WHEN** the server renders a CAGR / growth arrow over a bar chart
- **THEN** the arrow sits clear above the tallest bar and its labels
- **AND** the arrow line is thick enough to read as a deliberate annotation, in a high-contrast color
- **AND** its rate label sits close to the arrow without overlapping the marks

### Requirement: Emitted font-family is a valid CSS stack

The rebuilt chart's HTML/CSS/canvas font declarations SHALL use a valid CSS font-family stack whose
first family is the brand font, with real fallbacks, and SHALL NOT emit a single malformed quoted
family or link a different font than the one declared.

#### Scenario: Brand font declared

- **WHEN** the server emits any font-family declaration (CSS or canvas `ctx.font`)
- **THEN** it is of the form `'DM Sans', <fallbacks>, sans-serif` (properly quoted, comma-separated)
- **AND** it does not read as one quoted string like `'DM Sans, Calibri'`

#### Scenario: Webfont referenced

- **WHEN** the server references a webfont for the chart
- **THEN** the referenced font is the same family it declares (DM Sans), not a different family (e.g. Inter)
