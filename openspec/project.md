# Project Context — becise-skills + Becise MCP

## Purpose

Becise rebuilds any chart from any source into clean, themed, ready-to-embed chart HTML. The
system has two halves:

- **Server** (Becise MCP, separate repo, not in this marketplace): owns extraction, takeaway
  candidates, mark/emphasis selection, chart-type choice, theming, and the emission of the rebuilt
  chart's HTML/JS. Reached through the `chart_assess` / `rebuild_chart` MCP tools. **All chart-design
  IP lives here** — the skills never author chart code.
- **Skills** (this repo, `plugins/becise/skills/*`): orchestration only. `becise-chart` crops and
  hosts. `becise-chart-emphasis` asks the takeaway, calls `rebuild_chart`, bundles, verifies, and
  SHOWS. `becise-place` places the bundle. The bundler scripts (`make-bundle.mjs`,
  `bundle-from-critique.mjs`) turn the server's raw HTML into portable, dependency-inlined files.

## Capabilities (specs)

- `chart-rebuild` — the server's rebuilt-chart output contract: what a good default chart looks like.
- `chart-bundle` — the skills-side bundler: fonts, dependency inlining, portability, self-test.
- `chart-delivery-verification` — the skills-side pre-publish visual check in `becise-chart-emphasis`.

## Conventions

- Any commit touching `plugins/<name>/` must bump that plugin's `version` in
  `.claude-plugin/plugin.json` (semver). See `CLAUDE.md`.
- Skills contain no Becise IP. Design defaults that need one source of truth belong server-side; the
  skills verify them but never re-author chart code.
