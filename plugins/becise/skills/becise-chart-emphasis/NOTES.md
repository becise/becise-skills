# becise-chart-emphasis — background notes

Reference for `SKILL.md`. Nothing here is needed to run the skill; read it when something surprises
you. Pipeline/bundler mechanics (chart_id uniqueness, URL-mode HTML, manifest shape, vendor deps,
artifact fragments, the visual-verification finding) live in `becise-chart/NOTES.md` — this file
only covers what's specific to the ask/clarification/emphasis contract.

## Why the ask never skips, even when the user already said the takeaway

`becise-story-enrichment` (the slide-revision skill) lets an already-stated takeaway skip straight to
critique. This skill deliberately does **not** carry that shortcut over, even though the two skills
look similar on the surface. Two reasons:

1. **Per-chart, not per-slide.** A user statement like "this chart should show Q3 was strong" is
   often true of the slide's *story* but ambiguous about *which mark* proves it — the server still
   needs a specific candidate sentence (or their exact words) to derive `emphasis.targets` from.
   Silently guessing which candidate they meant reintroduces the very guessing this whole feature
   exists to remove.
2. **The user asked the requirement, not us.** The emphasis contract on the server side is opt-in
   and locked to this standalone path specifically because a human is supposed to be in the loop
   for every chart. Skipping the ask because the skill *inferred* the takeaway defeats that.

## Why `emphasis_status: "needs_clarification"` is capped at one round

The server itself won't ask a second clarifying question — `rebuild_chart` either resolves the
takeaway after one `emphasisClarification`, or proceeds with `mode: "none"`. The skill's "never ask
twice" rule isn't a client-side restriction layered on top of a more patient server; it's the same
policy enforced at both ends, because a chart nobody can confidently annotate is better served by an
honest "no single hero" than an endless disambiguation loop.

## Why the retry cap excludes the clarification round

Easy to conflate: both involve a second `rebuild_chart` call for the same chart. But a
`needs_clarification` round-trip is **designed flow** — the server told you exactly what it needs
and you provided it. The retry cap exists for **failures** (`isFallback`, content-filter trips, a
broken/empty payload) where a re-run is a bet that the same input will work better the second time.
Charging the clarification round against that budget would mean a chart that legitimately needed one
human answer could no longer tolerate an unrelated transient failure — two unrelated concerns
sharing one counter.

## Why an even-comparison option is always offered, even when assess didn't suggest one

`chart_assess`'s `candidate_claims` *may* include an even-comparison reading when the data supports
it, but "the candidates didn't suggest it" isn't evidence the human agrees there's a single hero —
they're looking at the source chart in a different context (the slide, the deck, the conversation)
than the extraction-only assess call. Offering option 4 unconditionally costs nothing when it's the
wrong answer (they just don't pick it) and avoids a state where the only way to say "no, they're all
roughly equal" is to overload "Something else."

## Assess and rebuild both extract — that's accepted, not a bug to route around

`chart_assess` runs its own Call 1 (extraction); `rebuild_chart` runs its own Call 1 again later. No
echo of assess's canonical data passes between them. This means a locked takeaway chosen from
assess's reading could, in principle, fail to resolve against rebuild's independent re-extraction if
the two disagree on a label's exact spelling — that shows up as an unexpected
`needs_clarification`, not a bug in this skill. If it happens often on real decks, that's server-side
signal to consider echoing canonical data between the two calls; nothing to fix client-side.
