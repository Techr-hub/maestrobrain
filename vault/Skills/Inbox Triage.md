---
name: Inbox Triage
description: Group email, Slack, texts and calls; flag what needs a reply and draft quick responses.
triggers: [triage, inbox, what needs a reply, messages]
agent: Maestro
tags: [skill]
---
# Inbox Triage

1. Call `get_feed` for EMAIL, CONVERSATION, SMS and CALL.
2. Sort into: Reply today, Reply this week, FYI, Ignore.
3. For "Reply today", draft a 1–2 sentence reply in the user's voice ([[Preferences]]).
4. Create tasks for anything that needs work, with `add_task`.

Part of [[Skills Library]]
