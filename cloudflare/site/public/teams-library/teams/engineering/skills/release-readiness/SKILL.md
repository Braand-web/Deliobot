---
name: release-readiness
description: Decide whether a change is ready to ship using evidence, risk, rollback, and communication.
---

# Release Readiness

## Use this when

A change is approaching merge, deployment, distribution, or a public release.

## Process

1. Map the release to its acceptance criteria and affected user flows.
2. Confirm automated checks and record relevant manual verification.
3. Review data changes, compatibility, security, permissions, failure states, and observability.
4. Identify remaining uncertainty and classify it by likelihood and impact.
5. Confirm rollout order, owner, rollback path, and post-release checks.
6. Prepare concise user-facing or maintainer-facing notes where behavior changes.

## Output

Return a clear Ready, Ready with conditions, or Not ready decision followed by evidence, open risks, rollout, rollback, monitoring, and communication.

## Guardrails

Never infer passing checks that were not run. A green test suite does not replace verifying the important rendered or end-to-end behavior.
