---
tags: [project, customer]
---
# Northwind Escalation

Northwind (enterprise, $95K ARR) cannot export reports over 10k rows. Third ticket this week; their ops lead mentioned evaluating alternatives.

- Root cause: bug EXP-77, timeouts on large exports
- Fix: PLAT-88 bulk export API, in QA in [[Sprint 24]]
- Next step: send ETA to the customer and offer a CSV workaround
