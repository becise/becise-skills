---
name: "becise-story-enrichment"
description: "Use whenever calling the Becise MCP's improve_slide_pptx tool and the result comes back with story_status: \"needs_context\" -- meaning the slide's narrative/claim isn't clear enough to build an outline or PPTX yet. Also use any time a Becise slide improvement stalls because the tool needs to know what point the slide is meant to make. Governs how to search for the missing narrative context first, and how to ask the user a single well-framed question (with candidate claims) if search doesn't resolve it, before re-calling improve_slide_pptx with confirmedClaim and narrativeContext."
---

## Becise Story Enrichment

Instructions for handling improve_slide_pptx (Becise MCP) results when the slide's narrative isn't clear from the image alone.

### When this applies

After calling improve_slide_pptx, check the result for story_status: "needs_context". That means the server diagnosed the slide (a critique is included) but will not build an outline or .pptx until it knows what the slide is meant to convey -- the job and claim.

If story_status is absent, proceed as usual (apply critique, download PPTX, etc.) -- this skill doesn't apply.

### Search first -- do not bother the user if you can resolve it

Before asking the user anything:

1. Check connected resources: Drive files, emails, meeting notes, briefs, prior conversation, and any deckContext already provided.
2. Look for why this slide exists in the presentation and what takeaway the audience should leave with.
3. If you can confidently determine the claim, re-call improve_slide_pptx with the same original inputs plus:
   - confirmedClaim -- the declarative insight sentence
   - narrativeContext -- a short summary of what you found (source optional but helpful)

Do not ask the user if search already answered the question.

### One question, with guesses, when search is not enough

If you still cannot resolve the story, ask the user exactly one question.

- Use question.prompt from the tool result as the default framing (it incorporates the slide's job). You may lightly rephrase for warmth, but keep the same intent.
- Always present candidate_claims / question.options as concrete choices.
- Always include an open-ended "something else" option so the user can author their own claim.
- The question is about what they are trying to convey or why this slide is in the presentation -- not about layout, fonts, or chart types.

#### Tone

- Collaborative, not interrogative. The user is the expert on their narrative; you are helping them articulate it.
- Frame positively: "I have a few ideas for what this slide is driving at..."
- Never say the slide is confusing, unclear, poorly made, or that you "can't figure it out."
- Keep it brief: one short framing sentence, then the options.

Example shape:

"I want to make sure I nail the story for this slide. Based on the data I can see, it could be arguing:
1. ...
2. ...
3. ...
Or something else -- what takeaway should the audience leave with?"

### After the user answers

Re-call improve_slide_pptx with the same slide image / text / deck context plus:

- confirmedClaim -- the option they picked, or their freeform answer rewritten as one declarative insight sentence
- narrativeContext -- any extra explanation they gave (and anything useful from your earlier search)

Then continue with the returned critique, outline, and PPTX as usual.

