---
name: engineering-practices
description: "The most-installed coding practices: test-driven development, root-cause debugging, plan grilling, architecture, prototypes, hand-offs, React performance. Use whenever the person asks for this, in any language."
---

# Engineering practices

Proven ways of working for code, from the most-installed skills. `<SKILLS>` below is this skill's folder. Read the
guide that fits the step you are on and follow it; several can apply in one task (brainstorm, then TDD, then
verification).

| Step | Read |
|---|---|
| A vague feature idea: turn it into an approved design before code | `<SKILLS>/brainstorming/SKILL.md` |
| Pressure-test a plan against the code and its docs | `<SKILLS>/grill-with-docs/SKILL.md` |
| Build or fix with a strict red, green, refactor loop | `<SKILLS>/tdd/SKILL.md` |
| A bug: find the real root cause before changing anything | `<SKILLS>/diagnosing-bugs/SKILL.md`, `<SKILLS>/systematic-debugging/SKILL.md` |
| Before saying it works | `<SKILLS>/verification-before-completion/SKILL.md` |
| Shallow, tangled modules: deepen them safely | `<SKILLS>/improve-codebase-architecture/SKILL.md`, `<SKILLS>/codebase-design/SKILL.md` |
| Try logic or a data model fast before building it properly | `<SKILLS>/prototype/SKILL.md` |
| Name the domain and record decisions | `<SKILLS>/domain-modeling/SKILL.md` |
| Long session: hand over cleanly to the next turn or bot | `<SKILLS>/handoff/SKILL.md` |
| Simple, careful code in general | `<SKILLS>/karpathy-guidelines/SKILL.md` |
| React and Next.js speed and component design | `<SKILLS>/react-best-practices/SKILL.md`, `<SKILLS>/composition-patterns/SKILL.md` |

## In Deliobot

Mode Codeur already verifies every change with the project's checks and can have it reviewed by another engine; these
guides decide how you work before that. Where a guide mentions a tool you do not have (a specific sub-agent or command),
do the same step with your own tools. Project conventions written in the project's notes win over a guide.

Licences: Matt Pocock, Jesse Vincent (superpowers), multica-ai and Vercel, all MIT (`LICENSE-*`).
