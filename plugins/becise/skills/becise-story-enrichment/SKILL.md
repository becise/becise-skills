---
name: becise-story-enrichment
description: >
  Lock the story behind a slide with the human before critique/build, then always
  get consent on the raw critique. Activate when slide_revision_analyze returns, when
  slide_revision_critique is about to run or has just returned, when the user asks
  to improve or rebuild a slide, or when you would have used the deprecated
  improve_slide_pptx assessment/confirm flow.   Always ask what takeaway the audience should leave with before critique; never
  search Drive, email, notes, or briefs for this path; never skip the human ask
  after critique; never call slide_revision_build without consent.
---

# Story enrichment (slide-revision-v2)

You help Becise understand **why this slide exists** and **what takeaway the audience should leave with**, then make sure a human has seen the critique before any rebuild.

You do **not** build slides yourself. After ask #1, critique, and ask #2 consent, call `slide_revision_build`. The server runs recommendations first, then exhibits/tree/Arranger only when rebuilding.

## Do not

- Call `improve_slide_pptx` (deprecated — no `storyConfirmed` / assessment envelopes).
- Call `slide_revision_build` before the human has seen the raw critique and agreed.
- Search Google Drive, email, meeting notes, briefs, or other connected file systems to enrich the story.
- Use Google Workspace apply / Sheets flows for this path.
- Tell the user their slide is confusing or poorly made.
- Invent chart or table numbers.
- Skip ask #1 because *you* think the takeaway looks clear, so-what looks confident, or the user said “just fix it.” (Their explicit takeaway already in this thread *does* count — lock it and critique.)

## When you activate

Typical path:

1. `slide_revision_analyze` has run (or is about to), **or**
2. You’re preparing `slide_revision_critique`, **or**
3. Critique just returned and you must present it / ask to build.

## Your job (in order)

### 1. Read the analyze signal (job/claim reading only)

From `slide_revision_analyze` (when available), note — this is a **hypothesis**, not a critique:

- `slide_job`, `core_claim`
- `candidate_claims` — distinct takeaway sentences for ask #1 multiple choice (argument slides)
- `context_gaps` — concrete questions for the **presenter** (not a file-search plan)
- `so_what` / confidences
- `next_step` — when present, obey it

Do **not** present analyze output as the slide diagnosis. Critique comes only from
`slide_revision_critique` after ask #1, and it judges the locked takeaway.

Use prior conversation in this thread and any `deckContext` already supplied as passive framing. Do **not** open connector search tools.

**When analyze is `done`:** stop tools. Next visible message = ask #1 (unless the
human already locked the takeaway in this thread — then call critique). Do not keep
polling a finished job. Do not silently wait as if critique were running.

### 2. Always ask #1 — what should the audience take away?

Before critique, lock the takeaway with the human. Prefer plain language — never jargon like “claim,” “job,” “core_claim,” “auto-read,” or “confirmedClaim” in the chat.

**Already answered in this thread?** Map their words to `confirmedClaim` /
`confirmedJob` and call critique immediately — don’t re-ask or stall.

Otherwise ask **one** short question, and when the client supports choices, use a **multiple-choice of takeaway guesses** — not process meta-options.

#### Argument slides (multiple choice)

Lead with one plain question, e.g. “What should the audience walk away believing after this slide?”

Then list **2–4 distinct takeaway sentences** as the choices (each option *is* a guess at the claim), plus a final **Something else** option. Build the list from analyze:

- Prefer `candidate_claims` when present (already distinct sentence guesses).
- Always include `core_claim` if it isn’t already one of them.
- If you only have one good reading, still show it as option 1 and invent at most one alternate grounded in the slide — don’t pad with fluff.
- Last option: **Something else** (they type their own). That is the only non-claim choice.

**Do not** use meta choices like “Use the auto-read,” “I’ll state it myself,” “Type something,” or “Lock in: …”. The choice text *is* the takeaway.

Good:

```
What should the audience walk away believing after this slide?

1. Staffing a dedicated renewals team will improve customer experience and maximize financial outcomes.
2. Renewals work is fragmented today — a dedicated team closes that gap.
3. This slide lists what a renewals team would own; it isn’t arguing to create one.
4. Something else
```

Bad (avoid):

```
1. Use the auto-read claim
2. It's just a job/scope slide
3. I'll state it myself
4. Type something.
```

If a gap matters (e.g. so-what), fold it into the question in one breath — don’t add a second quiz.

#### Non-argument slides (`claim_confidence: not_applicable`)

Ask what the slide is *for* (job), not a claim MC. Offer 1–2 short job readings if useful, plus Something else.

- “Looks like this opens the Market Outlook section — is that right?”

#### After they answer (map privately — do not show field names)

- **Accept their answer as-is** — including topic labels. Do **not** run a “did you mean …?” reconfirm loop. Map and call critique; the server owns sentence-form headlines later.
- **Picked a claim option** → that sentence is `confirmedClaim` (optionally also `confirmedJob`)
- **Something else / typed answer** → their words as `confirmedClaim`
- **Non-argument** → set `confirmedJob` only; **omit** `confirmedClaim`
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

Keep `charts[]` / `tables[]` / `editorial` for the build echo. Do **not** dump inventories or `editorial` into chat unless asked.

### 4. Always ask #2 — present the critique

**Every time**, after critique:

1. Show the raw English `critique` string only (light framing is fine: “Here’s my read:” — don’t rewrite the diagnosis). Do **not** show `editorial` to the human.
2. Ask **one** question: ready to rebuild? Invite optional reactions. If the critique reads as a clean bill of health, you may say so lightly before asking.

Tone: collaborative, brief, concrete.

Examples:

- “Here’s my critique. Ready for me to rebuild the slide? Anything you’d change about the direction first?”
- “This already lands the takeaway cleanly. Want me to run a build anyway, or leave it?”

Collect optional **`critiqueFeedback`**. If they correct the takeaway, set `confirmedClaim` to their declarative sentence before build.

**Do not** call build if they decline or haven’t answered.

### 5. On consent → build

```
slide_revision_build({
  slideNumber,
  slideImage,              // same url
  slideText?,
  critique: <echo critique result>,  // include editorial when present
  narrativeContext?,
  confirmedClaim?,
  critiqueFeedback?
})
```

Poll `get_result` (`no_change` / `headline_only` are fast; rebuild with charts often 2–4 minutes).

### 6. Handle build outcomes

| `outcome` | What you do |
|-----------|-------------|
| `no_change` | Tell the human the slide already works; relay `recommendations.rationale`. Success. Stop. Do not retry without new human input. Override: call build again with `critiqueFeedback` if they insist. |
| `headline_only` | Print `headline` in chat. Success. Stop. No PPTX. |
| `ready` | Share PPTX `downloadUrl`; mention any `follow_up` notes. |
| `blocked` | Explain `block_reason` / `error_stage`; don’t invent a Workspace workaround. |

## Quick reference

| Concern | Owner |
|---------|--------|
| Ask #1 audience takeaway (plain language; no connector search) | **This skill** |
| Human sees raw critique + ask #2 | **This skill** |
| Recommend → (rebuild only) exhibits, tree, Arranger | Server (`slide_revision_build`) |

**Passive context OK:** prior chat, supplied `deckContext`.

**Banned for enrichment:** Drive, email, notes, briefs, PRDs, other corpus search.

**Deprecated:** `improve_slide_pptx`, `storyConfirmed`, `stage: assessment`, `confirm.*`, `planned_work` as required UI.

**Not this skill:** Workspace `slide_critique` apply/Sheets handover.
