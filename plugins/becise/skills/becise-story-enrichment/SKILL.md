---
name: "becise-story-enrichment"
description: "Use whenever calling the Becise MCP's improve_slide_pptx tool and the result comes back with stage: \"assessment\" -- meaning the server has diagnosed the slide (job, claim, so-what, and planned work) but is unconditionally waiting for a human to confirm the reading and authorize the build before it renders anything. This applies on EVERY assessment, including fully confident ones -- confirmation is never skipped. Governs how to resolve context_gaps from available resources first, then ask the user at most one well-framed question (with candidate claims) covering both the takeaway and the go-ahead, before re-calling improve_slide_pptx with storyConfirmed: true."
---

## Becise Story Enrichment

Instructions for handling `improve_slide_pptx` (Becise MCP) assessment results -- the server's diagnosis of a slide, returned before it builds anything.

### When this applies

`improve_slide_pptx` is called twice per slide. The FIRST call (no `storyConfirmed`) always returns `stage: "assessment"` -- a fast diagnosis with no outline or PPTX. The SECOND call, with `storyConfirmed: true`, does the actual build.

This skill applies to every `stage: "assessment"` result, regardless of how confident the diagnosis is. There is no signal to check for "is this one of the uncertain ones" -- the pause is unconditional, because the assessment can be wrong even when it reads confident. If the result instead carries `stage: "build"` (i.e. you already sent `storyConfirmed: true`), this skill has already done its job for that call.

### Read the assessment first

From the result, note:

- `story_assessment.reading` -- the server's best guess at the slide's takeaway (or the slide's job, for non-argument slides)
- `story_assessment.so_what` and `so_what_confidence` (`confident` / `partial` / `guessing`) -- whether the CONSEQUENCE of that takeaway is grounded, independent of how clear the claim itself is
- `story_assessment.enrichment` (`not_needed` / `recommended` / `important`) -- how hard to search before confirming; it never blocks anything, it's just a hint
- `story_assessment.context_gaps` -- specific questions that would resolve an ungrounded so-what
- `changes_expected` -- whether the server plans to change anything at all
- `human_summary` -- ready-to-present markdown covering all of the above plus the critique and planned work

### No build when nothing is planned

If `changes_expected` is `false`, the slide already serves its job. Present the critique (via `human_summary` or your own words) and STOP -- do not re-call with `storyConfirmed`. There is nothing to confirm.

### Search first -- do not bother the user if you can resolve it

When `enrichment` is `recommended` or `important`, try to resolve each `context_gaps` entry before involving the user:

1. Check connected resources: Drive files, emails, meeting notes, briefs, prior conversation, and any `deckContext` already supplied.
2. Look specifically for what the gap asks -- a target figure, an audience identity, a deck-level argument this slide supports.
3. Whatever you find, pass it along as `narrativeContext` on the re-call (source noted, if helpful) -- but still present the reading for confirmation. Search resolves the SERVER's uncertainty; it does not replace the human's go-ahead.

Do not skip the confirmation step just because search resolved every gap.

### One question, covering both asks

Present the assessment to the user and ask **at most one** question that covers both:

- Is the reading right? (the takeaway, or for non-argument slides, the job)
- Should I go ahead and build it?

Use `human_summary` as the default framing -- it already has the job, the reading, the so-what (or lack of one), the critique, and the planned work. You may lightly rephrase for warmth, but keep the same intent and don't drop information.

- Always present `story_assessment.candidate_claims` as concrete choices when non-empty.
- Always include an open-ended "something else" option so the user can author their own claim.
- If `context_gaps` remain unresolved after search, fold them into the question naturally (e.g. "...and one thing I couldn't tell from the slide: is 18% above or below target?") rather than asking a second, separate question.
- The question is about what the slide is trying to convey (and, secondarily, whether to build) -- not about layout, fonts, or chart types.

**Never send `storyConfirmed: true` without having shown the assessment (or its substance) to the user first.** A re-call is not automatic just because search resolved the gaps -- the human still authorizes the build.

#### Tone

- Collaborative, not interrogative. The user is the expert on their narrative; you are helping them articulate and approve it.
- State the reading confidently -- "Here's what I think this slide is driving at: ..." -- even when `so_what_confidence` is `guessing`. Be candid about the specific thing you don't know (the consequence), not vague about the whole slide.
- Never say the slide is confusing, unclear, poorly made, or that you "can't figure it out."
- Keep it brief: one short framing sentence, the reading, then (if needed) options and the one open gap, then the go-ahead ask.

Example shape (uncertain so-what):

"Here's what I think this slide is driving at: three call-outcome metrics improved in June. One thing I can't tell from the slide -- is that ahead of target? Assuming it is, should I go ahead and sharpen the headline to make that point?"

Example shape (unclear claim, candidates available):

"I want to make sure I nail the story for this slide. Based on the data I can see, it could be arguing:
1. ...
2. ...
3. ...
Or something else -- what takeaway should the audience leave with, and should I go ahead and build it?"

### Non-argument slides: confirm the job, not a claim

When `story_assessment.claim_confidence` is `not_applicable` (title, divider, agenda, thank-you, credit, mood slides), there is no takeaway to confirm -- confirm the slide's JOB instead, and omit `confirmedClaim` on the re-call.

Example: "This looks like the section opener for Market Outlook -- want me to go ahead and clean up the layout?"

### After the user answers

Re-call `improve_slide_pptx` with the same slide image / text / deck context plus `storyConfirmed: true`, and:

- **Plain agreement** ("looks right", "yes go ahead"): pass `confirmedClaim` set to `story_assessment.reading` VERBATIM -- do not paraphrase it. Echoing the server's own reading back pins the rebuild to exactly what was approved.
- **Correction**: pass `confirmedClaim` set to the user's takeaway, rewritten as one declarative insight sentence.
- **Non-argument slide**: omit `confirmedClaim` entirely; the job confirmation needs no claim payload.
- Pass `narrativeContext` for anything useful you found in search or the user gave you.
- Pass `critiqueFeedback` for any freeform reaction to the diagnosis itself (a story correction, a scope instruction like "don't restructure the body, just fix the chart") -- it reaches both the re-analysis and, on the build, the prescription stage.

Then continue with the returned critique, outline, and PPTX as usual. If the build call returns `{ state: "pending", jobId }` (expect 2-4 minutes), poll `get_result`.
