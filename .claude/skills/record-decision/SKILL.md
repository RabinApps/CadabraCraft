---
name: record-decision
description: Record an architecture or dependency decision in docs/architecture.md with reasons and rejected alternatives.
---

Append a section to `docs/architecture.md`:

- **Decision:** what was chosen.
- **Why:** the deciding factors (prefer permissive license, active maintenance, no runtime network calls).
- **Rejected:** each alternative and why.
- **Follow-ups / caveats:** what was not verified.

Keep it short; match the existing table style where comparing options. Ideas outside the current milestone go in `docs/roadmap.md` instead.
