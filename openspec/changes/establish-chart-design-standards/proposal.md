# Establish chart design standards

## Why

Two consecutive chart rebuilds (a donut → bar, and a stacked bar) each required a long tail of
manual edits after the first render. Grouping those edits by root cause shows they were not ten
independent taste calls — they trace to **one bug, one unreliable capability, and three inverted
defaults**, all of which recur on every applicable chart:

- **Font never renders (bug, every chart).** The server emits `font-family: 'DM Sans, Calibri'` —
  a single malformed quoted family, not a fallback stack — and links **Inter** (not DM Sans) via a
  CDN `<link>`. The skills bundler (`make-bundle.mjs:28`) then sets its own fallback to
  `"'Inter', system-ui, …"` and drops the font `<link>` entirely (`make-bundle.mjs:76`). Net: the
  intended brand font (DM Sans) is never embedded and never renders. The user cannot see this unless
  they already know what DM Sans looks like.
- **Emphasis is chosen but not visually executed (unreliable capability).** For point/bar emphasis
  (the donut → bar case) the server correctly greys non-hero bars and colors the heroes. For
  **series emphasis on a stacked bar** it either rendered illegibly or came back
  `emphasis_status: "none"` and applied nothing — so the greyscale-others / color-the-hero treatment,
  and ordering the hero segment to the readable baseline, had to be rebuilt by hand. That treatment
  *is* what emphasis is supposed to produce.
- **Three defaults were reversed on both charts:** interior gridlines on (removed twice), the legend
  detached at the bottom (moved to align with the marks), and trend annotations cramped against the
  bars in low-contrast grey (raised, thickened, blackened).

Fixing the bug, making emphasis execute across chart types, and inverting those three defaults would
have made the first render ~80% of the final — the user nudging a good chart rather than rebuilding a
broken one. This proposal codifies the target defaults as a spec so the server produces them by
default and the skills verify them before publishing.

## What Changes

- **`chart-rebuild` (server output contract):** default gridlines off; no overlapping value labels;
  value labels are bare numbers or a very short unit with the unit stated once; non-emphasized marks
  render greyscale with the hero in brand color and ordered to the readable baseline; emphasis
  executes reliably across chart types (notably stacked-bar series emphasis); labels/legends align
  to the mark they name; bubble/scatter marks are semi-transparent; text is black by default; trend
  annotations get real clearance, weight, and contrast; the emitted `font-family` is a valid CSS
  stack.
- **`chart-bundle` (skills bundler):** embed the brand webfont (DM Sans) as a data URI so it renders
  in the CSP-restricted Artifact surface and in the offline `web.html`; lead the fallback stack with
  the brand font and never silently substitute a different family; extend `selftest.mjs` to catch
  the font-never-loads regression.
- **`chart-delivery-verification` (skills SHOW step):** the pre-publish visual check in
  `becise-chart-emphasis` asserts the design invariants (no unintended gridlines, no overlapping
  value labels, brand font actually rendered) and treats a violation like an empty render — it
  triggers the one allowed retry.

## Impact

- **Affected specs:** `chart-rebuild` (new), `chart-bundle` (new), `chart-delivery-verification` (new).
- **Affected code — server (separate repo):** rebuilt-chart HTML/JS emission, theming, and
  emphasis-execution paths. Delivered to the server team; this repo cannot edit it.
- **Affected code — skills (this repo):** `plugins/becise/skills/becise-chart/make-bundle.mjs`,
  `bundle-from-critique.mjs`, `selftest.mjs`, `vendor/`; `plugins/becise/skills/becise-chart-emphasis/SKILL.md`.
  A skills change requires a `plugins/becise` version bump per `CLAUDE.md`.
- **Backward compatibility:** these are default and correctness changes; already-published bundles are
  unaffected. The font fix is a straight bug fix. The new defaults change what *future* rebuilds look
  like; every default keeps an escape hatch (see `design.md`) so charts that genuinely need gridlines,
  extra colors, or a detached legend can still opt in.
