---
name: becise-story-enrichment
description: >
  Enrich the story behind a slide before critique/build, then always get human
  consent on the raw critique. Activate when slide_analyze returns (especially
  with context_gaps / uncertain so_what), when slide_revision:critique is
  about to run or has just returned, when the user asks to improve or rebuild
  a slide, or when you would have used the deprecated improve_slide_pptx
  assessment/confirm flow. Search Drive, email, notes, briefs, and prior chat
  for why the slide exists and what takeaway the audience should leave with;
  never skip the human ask; never call slide_revision:build without consent.
---

# Story enrichment (slide-revision-v2)

You help Becise understand **why this slide exists** and **what takeaway the audience should leave with**, then make sure a human has seen the critique before any rebuild.

You do **not** build slides yourself. After enrichment and consent, call `slide_revision:build`. Exhibits, recommendations, tree, and Arranger run on the server.

## Do not

- Call `improve_slide_pptx` (deprecated — no `storyConfirmed` / assessment envelopes).
- Call `slide_revision:build` before the human has seen the raw critique and agreed.
- Use Google Workspace apply / Sheets flows for this path.
- Tell the user their slide is confusing or poorly made.
- Invent chart or table numbers.

## When you activate

Typical path:

1. `slide_analyze` has run (or is about to), **or**
2. You’re preparing `slide_revision:critique`, **or**
3. Critique just returned and you must present it / ask to build.

## Your job (in order)

### 1. Read the analyze signal

From `slide_analyze` (when available), note:

- `slide_job`, `core_claim`
- `context_gaps` — concrete questions to search
- `so_what` / `so_what_confidence` / claim confidence

Treat gaps as a **search plan**, not as a reason to skip work. Enrichment is always worth attempting; it never replaces the later human ask.

### 2. Always search connected resources

Before critique (or before asking the human, if critique already ran without enrichment), search:

- Drive / docs / decks
- Email
- Meeting notes
- Briefs / PRDs
- Prior conversation in this thread
- Any `deckContext` already supplied

Focus on:

- Why this slide is in the presentation
- What decision, risk, or action the audience should take away
- Targets, benchmarks, audience, or prior claims that ground the so-what

Synthesize into:

- **`narrativeContext`** — short paragraph of what you found (grounded; no invented facts)
- **`confirmedClaim`** — one declarative insight sentence when the slide argues; **omit** for non-argument slides (title, divider, agenda, credit, mood) where there is no claim

If search finds nothing useful, proceed anyway with whatever you have. Still always ask the human after critique.

### 3. Call critique with enrichment

```
slide_revision:critique({
  slideNumber,
  slideImage,           // prefer get_upload_url; reuse the same url later
  slideText?,
  deckContext?,
  narrativeContext?,
  confirmedClaim?
})
```

Poll `get_result` if pending.

Keep `charts[]` / `tables[]` for the build echo. Do **not** dump inventories into chat unless asked.

### 4. Always present the critique and ask once

**Every time**, after critique:

1. Show the raw `critique` string (light framing is fine: “Here’s my read:” — don’t rewrite the diagnosis).
2. Ask **one** question: ready to rebuild? Invite optional reactions.

Tone: collaborative, brief, concrete. Offer a reading; don’t interrogate.

Examples:

- “Here’s my critique. Ready for me to rebuild the slide? Anything you’d change about the direction first?”

Collect optional **`critiqueFeedback`**. If they correct the takeaway, set `confirmedClaim` to their declarative sentence before build.

**Do not** call build if they decline or haven’t answered.

### 5. On consent → build

```
slide_revision:build({
  slideNumber,
  slideImage,              // same url
  slideText?,
  critique: <echo critique result>,  // slide_job, core_claim, critique, charts, tables
  narrativeContext?,
  confirmedClaim?,
  critiqueFeedback?
})
```

Poll `get_result` (often 2–4 minutes with charts).

### 6. Handle build outcomes

| `outcome` | What you do |
|-----------|-------------|
| `headline_only` | Print `headline` in chat. Success. Stop. No PPTX. |
| `ready` | Share PPTX `downloadUrl`; mention any `follow_up` notes. |
| `blocked` | Explain `block_reason` / `error_stage`; don’t invent a Workspace workaround. |

## Quick reference

| Concern | Owner |
|---------|--------|
| Drive / email / notes search | **This skill** |
| Human sees raw critique + consent | **This skill** |
| Exhibits, recommend, tree, Arranger | Server (`slide_revision:build`) |

**Deprecated:** `improve_slide_pptx`, `storyConfirmed`, `stage: assessment`, `confirm.*`, `planned_work` as required UI.

**Not this skill:** Workspace `slide_critique` apply/Sheets handover.
