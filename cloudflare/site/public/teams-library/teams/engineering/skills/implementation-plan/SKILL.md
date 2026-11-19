---
name: implementation-plan
description: Convert a requested outcome into sequenced engineering work with ownership and verification.
---

# Implementation Plan

## Use this when

A feature, fix, migration, or refactor crosses multiple files, layers, or owners.

## Process

1. Restate the user-visible outcome and acceptance criteria.
2. Inspect the relevant code paths, tests, stored data, and release constraints.
3. Separate required work from optional follow-ups and identify compatibility needs.
4. Break the work into the smallest independently verifiable steps.
5. Assign an owner or discipline to each step and call out dependencies.
6. Define proportionate tests, manual checks, telemetry, rollback, and documentation.

## Output

Provide scope, non-goals, assumptions, ordered work items, ownership, tests, risks, rollout, and definition of done.

## Guardrails

Do not propose edits before inspecting the existing behavior. Preserve unrelated user work and require confirmation before destructive migrations or irreversible external actions.
