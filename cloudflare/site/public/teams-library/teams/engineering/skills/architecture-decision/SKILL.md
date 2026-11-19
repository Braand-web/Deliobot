---
name: architecture-decision
description: Record a focused technical decision with context, alternatives, tradeoffs, and follow-up.
---

# Architecture Decision

## Use this when

A meaningful implementation choice affects interfaces, data, security, operations, compatibility, or future work.

## Process

1. Inspect the existing system and state the user or operational outcome being protected.
2. Record constraints, known facts, assumptions, and non-goals.
3. Describe two or three realistic options, including keeping the current design.
4. Compare complexity, reversibility, compatibility, security, performance, and maintenance cost.
5. Choose the smallest option that satisfies the outcome and explain why.
6. Define consequences, migration or rollback needs, and a date or condition for revisiting the choice.

## Output

Use: Status, Context, Decision, Alternatives, Consequences, Verification, and Follow-up.

## Guardrails

Do not invent system constraints. Do not use an architecture record to hide an unresolved product decision or to justify unnecessary infrastructure.
