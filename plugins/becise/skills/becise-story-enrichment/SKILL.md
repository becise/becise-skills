---
name: becise-story-enrichment
description: >
  Lock the story behind a slide with the human before critique/build, then always
  get consent on the raw critique. Activate when slide_analyze returns, when
  slide_revision_critique is about to run or has just returned, when the user asks
  to improve or rebuild a slide, or when you would have used the deprecated
  improve_slide_pptx assessment/confirm flow.   Always ask what takeaway the audience should leave with before critique; never
  search Drive, email, notes, or briefs for this path; never skip the human ask
  after critique; never call slide_revision_build without consent.
---

# Story enrichment (slide-revision-v2)

You help Becise understand **why this slide exists** and **what takeaway the audience should leave with**, then make sure a human has seen the critique before any rebuild.

You do **not** build slides yourself. After ask #1, critique, and ask #2 consent, call `slide_revision_build`. Exhibits, recommendations, tree, and Arranger run on the server.

## Do not

- Call `improve_slide_pptx` (deprecated — no `storyConfirmed` / assessment envelopes).
- Call `slide_revision_build` before the human has seen the raw critique and agreed.
- Search Google Drive, email, meeting notes, briefs, or other connected file systems to enrich the story.
- Use Google Workspace apply / Sheets flows for this path.
- Tell the user their slide is confusing or poorly made.
- Invent chart or table numbers.
- Skip ask #1 because the takeaway looks clear, so-what looks confident, or the user said “just fix it.”

## When you activate

Typical path:

1. `slide_analyze` has run (or is about to), **or**
2. You’re preparing `slide_revision_critique`, **or**
3. Critique just returned and you must present it / ask to build.

## Your job (in order)

### 1. Read the analyze signal (story reading only)

From `slide_analyze` (when available), note — this is a **hypothesis**, not a critique:

- `slide_job`, `core_claim`
- `candidate_claims` — options when the claim is inferred/unclear
- `context_gaps` — concrete questions for the **presenter** (not a file-search plan)
- `so_what` / confidences

Do **not** present analyze output as the slide diagnosis. Critique comes only from
`slide_revision_critique` after ask #1, and it judges the locked takeaway.

Use prior conversation in this thread and any `deckContext` already supplied as passive framing. Do **not** open connector search tools.

### 2. Always ask #1 — what should the audience take away?

**Every time**, before critique, ask the human **one** natural question. Prefer plain language — never jargon like “claim,” “job,” “core_claim,” or “confirmedClaim” in the chat.

For slides that argue a point, ask something like:

- “What’s the key idea you want your audience to come away with after this slide?”
- Or offer a reading and check it: “I’m reading this as: June’s IVR changes are working — 3 of 4 metrics improved. Is that what you want people to take away? And is 18% above target for your audience?”

For slides that don’t argue (title, divider, agenda, thank-you), ask what the slide is *for*:

- “Looks like this opens the Market Outlook section — is that right?”

Use analyze to frame a concrete guess when you can; fold gaps into the same question. Collaborative, brief — don’t interrogate or accuse.

**After they answer** (map privately — do not show field names to the user):

- **Argument slide, agreement** → echo the reading as `confirmedClaim` (optionally also `confirmedJob`)
- **Argument slide, correction** → their takeaway sentence as `confirmedClaim`
- **Non-argument** (`claim_confidence: not_applicable`) → set `confirmedJob` only; **omit** `confirmedClaim`
- Extra color they volunteer → `narrativeContext`

The server requires one of those fields on critique (empty strings don’t count).

### 3. Call critique with enrichment

Critique diagnoses against the locked story (not a fresh guess at the takeaway).

```
slide_revision_critique({
  slideNumber,
  slideImage,           // prefer get_upload_url; reuse the same url later
  slideText?,
  deckContext?,
  narrativeContext?,
  confirmedClaim?,      // argument slides
  confirmedJob?         // required alone for non-argument; or alongside claim
})
```

Poll `get_result` if pending.

Keep `charts[]` / `tables[]` for the build echo. Do **not** dump inventories into chat unless asked.

### 4. Always ask #2 — present the critique

**Every time**, after critique:

1. Show the raw `critique` string (light framing is fine: “Here’s my read:” — don’t rewrite the diagnosis).
2. Ask **one** question: ready to rebuild? Invite optional reactions.

Tone: collaborative, brief, concrete.

Examples:

- “Here’s my critique. Ready for me to rebuild the slide? Anything you’d change about the direction first?”

Collect optional **`critiqueFeedback`**. If they correct the takeaway, set `confirmedClaim` to their declarative sentence before build.

**Do not** call build if they decline or haven’t answered.

### 5. On consent → build

```
slide_revision_build({
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
| Ask #1 audience takeaway (plain language; no connector search) | **This skill** |
| Human sees raw critique + ask #2 | **This skill** |
| Exhibits, recommend, tree, Arranger | Server (`slide_revision_build`) |

**Passive context OK:** prior chat, supplied `deckContext`.

**Banned for enrichment:** Drive, email, notes, briefs, PRDs, other corpus search.

**Deprecated:** `improve_slide_pptx`, `storyConfirmed`, `stage: assessment`, `confirm.*`, `planned_work` as required UI.

**Not this skill:** Workspace `slide_critique` apply/Sheets handover.
