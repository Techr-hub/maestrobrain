---
tags: [memory, protocol]
---
# Memory Protocol

How this brain remembers. Every model and agent follows these rules.

1. **Read before answering.** Load [[About Me]], [[Preferences]] and [[Memory Log]] for every request.
2. **Write what lasts.** When the user says "remember…", or states a stable fact (a preference, a person, a decision), append it to [[Memory Log]] with the date.
3. **Separate memory from knowledge.** Memory = facts about the user. Knowledge = notes about work and life (Projects, People, Meetings).
4. **Decisions get their own note** in `Decisions/` with the why, linked from [[Decision Log]].
5. **Profiles.** Notes in `Personal/` are only used in Personal mode. Business mode never reads them.
6. **Prune monthly.** Move outdated facts out of the log during the [[Weekly Review]].
7. **Cite sources** as [[wikilinks]] so you can always see where an answer came from.
