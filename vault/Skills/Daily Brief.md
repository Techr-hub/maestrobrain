---
name: Daily Brief
description: "Morning briefing: schedule, what needs you first, top tasks and one insight."
triggers: [brief me, my day, morning brief, what did i miss, catch me up]
agent: Jarvis
tags: [skill]
---
# Daily Brief

1. Call `get_calendar` for today and `get_feed` for the last 24 hours.
2. List today's events with times. Flag conflicts and back-to-backs.
3. Pick the 3 items that need the user first (High priority, deadlines today, people waiting).
4. List the top 3 tasks from `list_tasks`.
5. Add one insight: a pattern, risk or opportunity.
6. Keep it under 150 words. Offer to save it to today's Daily note.

Part of [[Skills Library]]
