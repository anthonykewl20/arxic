---
name: remind
description: Rewrite the last response simpler and shorter in plain English, prefixed with a 3-5 sentence TLDR of the conversation so far. Manual-only, invoked as /remind.
disable-model-invocation: true
---

Rewrite your last response to make it simpler, shorter, and written in Plain English.

Also, start with a short one-paragraph summary in plain English of the topic/problem of this conversation, just give me the 80/20 of the most important context (what we are doing, why we are doing it, what we already did, and what's next)

But make this paragraph very clear & easy to understand, literally 3-5 sentences max. THE PARAGRAPH SHOULD BE VERY CONCISE.

MAKE SURE to always repeat the very first user prompt in this conversation, reminding the user of the very first user message in this chat, so they are aware how the entire conversation started.

Below the "tldr" paragraph, output your previous response, but make the whole thing simpler and shorter than before, formatted in nice readable markdown. Be concise.

---
*Source: [davidondrej/skills · thinking-and-docs/remind](https://github.com/davidondrej/skills/tree/main/skills/thinking-and-docs/remind). Installed verbatim with attribution. Manual-only (`disable-model-invocation: true`).*
