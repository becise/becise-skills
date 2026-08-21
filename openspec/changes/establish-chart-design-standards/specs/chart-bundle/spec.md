# chart-bundle — spec delta

These requirements govern the skills-side bundler (`make-bundle.mjs`, `bundle-from-critique.mjs`,
`selftest.mjs`, `vendor/`) that turns the server's raw chart HTML into portable, dependency-inlined
files. They are the baseline for the `chart-bundle` capability.

## ADDED Requirements

### Requirement: Brand webfont is embedded, not left to a local fallback

The bundler SHALL embed the brand webfont (DM Sans, the weights the chart uses) into each bundled
output as a data-URI `@font-face`, so the font renders in the CSP-restricted Artifact surface and in
the offline `web.html` where no external font request is possible and the font is not assumed present
on the viewer's machine.

#### Scenario: Bundling a chart that declares the brand font

- **WHEN** the bundler processes raw chart HTML whose declared font-family leads with DM Sans
- **THEN** the emitted `web.html` and `artifact.html` each contain a self-contained `@font-face` for DM Sans as a data URI
- **AND** no external font request is required to render the declared font

#### Scenario: Artifact CSP

- **WHEN** the `artifact.html` fragment is published to the Artifact surface (which blocks external hosts)
- **THEN** the brand font still renders because it is embedded, not linked

### Requirement: Fallback stack leads with the brand font and never substitutes another family

The bundler's fallback font stack SHALL lead with the brand font (DM Sans). The bundler SHALL NOT
substitute a different first family (e.g. Inter) than the chart declares, and SHALL NOT drop the
brand font in a way that leaves a non-brand family first.

#### Scenario: Bundler default stack

- **WHEN** the bundler applies its own fallback font stack
- **THEN** the first family is DM Sans, followed by generic fallbacks
- **AND** the stack does not lead with Inter or another non-brand family

#### Scenario: Stripping an external font link

- **WHEN** the bundler removes an external font `<link>` during dependency inlining
- **THEN** it has already embedded the declared brand font, so removal does not change the rendered font

### Requirement: Self-test covers the font-never-loads regression

`selftest.mjs` SHALL include a case that fails if a bundled chart would render in a non-brand font —
i.e. it asserts the bundle embeds the declared brand `@font-face` and that the effective first font
family is the brand font.

#### Scenario: Bundle missing the embedded face

- **WHEN** a bundle declares DM Sans but embeds no matching `@font-face`
- **THEN** `selftest.mjs` reports a failure for that case

#### Scenario: Bundle substitutes a different family

- **WHEN** a bundle's effective first font family is not the declared brand font
- **THEN** `selftest.mjs` reports a failure for that case
