---
name: becise-slide-revision-v2
description: >
  Orchestrate slide-revision-v2 when the user wants to improve or rebuild a slide
  into a polished PPTX (or a headline-only fix). Activate whenever the user uploads
  a slide PNG/screenshot for revision, asks to improve a slide, or you are about to
  call slide_revision_critique / slide_revision_build / improve_slide_pptx.
  Do NOT use the deprecated improve_slide_pptx tool. Always ask the human to lock
  job/claim before critique; never search Drive/email/notes for enrichment; always
  show the raw critique before building.
---

# Slide revision v2

Rebuild one slide with Becise MCP tools. You own ask #1 (job/claim), ask #2 (build
consent), and sequencing. The server owns exhibits, recommendations, tree, and
Arranger — only after consent.

For the enrichment / human-ask details, follow the same contract as
`becise-story-enrichment` (this skill embeds that sequence so either skill can drive
the flow).

## Never do these

- Do **not** call `improve_slide_pptx` (deprecated).
- Do **not** call `slide_revision_build` until the human has seen the raw critique and agreed to build.
- Do **not** search Google Drive, email, meeting notes, briefs, or other connected file systems to enrich the story.
- Do **not** use Google Workspace / Slides apply flows for this product path.
- Do **not** invent chart or table numbers.
- Do **not** skip ask #1 because the claim looks clear or the user said “just fix it.”

## Mandatory sequence

```
1. Prepare slide inputs (image via get_upload_url when large)
2. slide_analyze          ← job, claim, so_what, context_gaps
3. ASK #1                 ← always lock job/claim with the human
4. slide_revision_critique  ← with confirmedClaim / narrativeContext
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

### 2. `slide_analyze`

Call `slide_analyze` with the slide image (and any known context).

Use the result to frame ask #1:

- `slide_job` / `core_claim` — what the slide is for / takeaway
- `candidate_claims` — options when unclear/inferred
- `context_gaps` — concrete questions for the **presenter** (not a search plan)
- `so_what` / confidences

Prior chat + supplied `deckContext` are fair game as passive context.

### 3. Always ask #1 (before critique)

**Always** ask one targeted question that locks job and claim with the human.

- Offer a concrete reading; fold gaps/candidates into the same question
- Argument slides → set `confirmedClaim` (echo reading on agreement, or their correction)
- Non-argument slides (`not_applicable`) → confirm **job** only; omit `confirmedClaim`
- Volunteer color → `narrativeContext`

**Banned:** Drive / email / notes / briefs / PRD corpus search.

### 4. `slide_revision_critique`

Call with the same slide inputs plus enrichment from ask #1:

```
slide_revision_critique({
  slideNumber,
  slideImage,          // same url as analyze when possible
  slideText?,
  deckContext?,
  narrativeContext?,
  confirmedClaim?
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

**Human sees:** ask #1 (job/claim), then raw `critique` + ask #2 (build).

**Build echo:** pass the critique object through unchanged (ids must survive).

**Deprecated:** `improve_slide_pptx`, `storyConfirmed`, assessment `confirm.*` / `planned_work` scaffolding.

**Not this skill:** Google Workspace `slide_critique` apply/Sheets flows — different product.
