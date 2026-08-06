---
name: becise-slide-revision-v2
description: >
  Orchestrate slide-revision-v2 when the user wants to improve or rebuild a slide
  into a polished PPTX (or a headline-only fix). Activate whenever the user uploads
  a slide PNG/screenshot for revision, asks to improve a slide, or you are about to
  call slide_revision_critique / slide_revision_build / improve_slide_pptx.
  Do NOT use the deprecated improve_slide_pptx tool. Always ask what takeaway the
  audience should leave with before critique; never search Drive/email/notes for
  enrichment; always show the raw critique before building.
---

# Slide revision v2

Rebuild one slide with Becise MCP tools. You own ask #1 (audience takeaway), ask #2
(build consent), and sequencing. The server owns exhibits, recommendations, tree,
and Arranger — only after consent.

For the enrichment / human-ask details, follow the same contract as
`becise-story-enrichment` (this skill embeds that sequence so either skill can drive
the flow).

## Never do these

- Do **not** call `improve_slide_pptx` (deprecated).
- Do **not** call `slide_revision_build` until the human has seen the raw critique and agreed to build.
- Do **not** search Google Drive, email, meeting notes, briefs, or other connected file systems to enrich the story.
- Do **not** use Google Workspace / Slides apply flows for this product path.
- Do **not** invent chart or table numbers.
- Do **not** skip ask #1 because *you* think the takeaway looks clear or the user said “just fix it.” (If they already *stated* the takeaway in this thread, that counts as ask #1 — proceed to critique.)

## Mandatory sequence

```
1. Prepare slide inputs (image via get_upload_url when large)
2. slide_analyze          ← lean story reading (job/claim/so-what) — NOT a critique
3. ASK #1                 ← “what should the audience take away?” (human language)
4. slide_revision_critique  ← diagnoses against locked story (server-required confirmation)
5. ASK #2                 ← show raw critique → ready to build?
6. slide_revision_build     ← only after yes
7. Handle outcome: headline_only | ready | blocked / pending
```

---

### 1. Prepare inputs

Need:

- `slideNumber` (1-based)
- `slideImage`: prefer `{ mimeType, url }` from `get_upload_url` for large images; reuse the **same url** on later calls
- Optional: `slideText`, `deckContext`

### 2. `slide_analyze` (story reading only)

Call `slide_analyze` with the slide image (and any known context).

This is a **hypothesis for ask #1**, not a critique. Do **not** show it as the
slide diagnosis — that comes later from `slide_revision_critique`.

Use only:

- `slide_job` / `core_claim` — estimated purpose / takeaway
- `candidate_claims` — options when unclear/inferred
- `context_gaps` — concrete questions for the **presenter** (not a search plan)
- `so_what` / confidences
- `next_step` — when present, obey it (hard stop → ask #1)

There is no analyze critique paragraph, intervention hint, or chart inventory.

Prior chat + supplied `deckContext` are fair game as passive context.

**When analyze returns `state: "done"`:** stop all tools in that turn. Your next
visible message must be ask #1 (or critique — only if the human already locked the
takeaway in this thread). Do **not** keep polling `get_result` for a finished job.
Do **not** silently wait for critique — critique has not started yet.

If analyze returns `pending`, poll `get_result` until done, then ask #1 immediately.

### 3. Always ask #1 (before critique)

**Always** get a human-locked takeaway before critique. Prefer plain language —
never say “claim,” “job,” or tool field names in the chat.

**If they already stated the takeaway** earlier in this thread (e.g. “argue that
retention held”), treat that as ask #1 answered: map to `confirmedClaim` /
`confirmedJob` and call `slide_revision_critique` immediately — do not ask again
and do not stall.

Otherwise ask one natural question:

For argument slides, something like:

- “What’s the key idea you want your audience to come away with after this slide?”
- Or check a reading: “I’m reading this as arguing that June’s IVR changes are working.
  Is that what you want people to take away?”

For non-argument slides (title, divider, agenda): ask what the slide is for —
e.g. “Looks like this opens the Market Outlook section — right?”

Use analyze to offer a concrete reading when you can; fold gaps into the same question.

**After they answer** (map privately):

- Argument slides → `confirmedClaim` (echo or their correction); optionally `confirmedJob`
- Non-argument (`not_applicable`) → `confirmedJob` only; omit `confirmedClaim`
- Volunteer color → `narrativeContext`

The server rejects critique if neither field is set (empty strings don’t count).

**Banned:** Drive / email / notes / briefs / PRD corpus search.

### 4. `slide_revision_critique` (the diagnosis)

This is the only critique the human should see. It judges the slide against the
locked takeaway / purpose from ask #1. At least one of `confirmedClaim` /
`confirmedJob` is required:

```
slide_revision_critique({
  slideNumber,
  slideImage,          // same url as analyze when possible
  slideText?,
  deckContext?,
  narrativeContext?,
  confirmedClaim?,     // argument slides
  confirmedJob?        // non-argument: job only; or alongside claim
})
```

If the tool returns `{ state: "pending", jobId }`, poll `get_result` until done.

Result shape (important fields):

- `critique` — **the only thing you must show the human** (raw string)
- `slide_job`, `core_claim`
- `charts[]`, `tables[]` — inventories with stable ids (`CHART-001`, `TBL-001`, …). Keep for the build call; do **not** dump them into chat unless the human asks.

### 5. Always ask #2

**Every time** after critique:

1. Present the raw `critique` string (you may lightly frame it: “Here’s my read of the slide:” — do not rewrite or soften the diagnosis into a different message).
2. Ask **one** question: whether to rebuild, and invite optional reactions/context.

Tone:

- Collaborative, not interrogative
- Offer a concrete reading; never say the slide is “confusing” or “poorly made”
- Keep the ask brief

Examples:

- “Here’s my critique. Ready for me to rebuild the slide? Anything you’d tweak in the direction first?”
- If they already said “just fix it” earlier in the thread, still show the critique once, then confirm before build.

**Do not** call build if they decline or have not answered.

Collect optional `critiqueFeedback` (scope notes, “keep the chart”, “headline only”, corrections).

If they correct the takeaway, update `confirmedClaim` to their declarative sentence before build.

### 6. `slide_revision_build` (consent only)

```
slide_revision_build({
  slideNumber,
  slideImage,              // same url
  slideText?,
  critique: <echo full critique tool result>,  // slide_job, core_claim, critique, charts, tables
  narrativeContext?,
  confirmedClaim?,
  critiqueFeedback?,
  chartData?               // optional authoritative series per CHART-###
})
```

**Chart grounding (per inventory id):**

1. **Vision (default)** — omit `chartData` for that id; numbers come from `slideImage`.
2. **Authoritative** — include `{ chart_id, series: [{ name, data: [{ x, y }] }] }`; those values are ground truth. Do **not** invent numbers into free-text fields instead.

Mixing is fine (override `CHART-001`, vision for `CHART-002`). Omit `key_message` unless the human supplied one — the pipeline derives `key_insight` from the data.

Expect **pending** often (2–4 minutes with chart redesign). Poll `get_result`.

### 7. Handle outcomes

| `outcome` | What you do |
|-----------|-------------|
| `headline_only` | Print `headline` in chat. **Success.** Stop. No PPTX expected. |
| `ready` | Give the human the PPTX `downloadUrl` (and note `follow_up` / `manual_follow_up` if present). |
| `blocked` | Explain `block_reason` / `error_stage`; keep critique + any exhibits for retry. Do not invent a Workspace workaround. |

Pending:

- Tell the human you’re building; keep polling `get_result` with the `jobId`.

---

## Quick reference

**Enrichment:** human ask #1 only (+ prior chat / `deckContext`). Connector search banned.
Server requires `confirmedJob` and/or `confirmedClaim` on critique.

**Human sees:** ask #1 (audience takeaway, in plain language), then raw `critique` + ask #2 (build).

**Build echo:** pass the critique object through unchanged (ids must survive).

**Deprecated:** `improve_slide_pptx`, `storyConfirmed`, assessment `confirm.*` / `planned_work` scaffolding.

**Not this skill:** Google Workspace `slide_critique` apply/Sheets flows — different product.

---

## Install note (becise-skills repo)

Suggested path: `plugins/becise/skills/becise-slide-revision-v2/SKILL.md`

In the same commit, MAJOR-bump `plugins/becise/.claude-plugin/plugin.json` and update the plugin description to mention slide-revision-v2. Align `becise-story-enrichment` with this human-ask sequence (no Drive/email search).
