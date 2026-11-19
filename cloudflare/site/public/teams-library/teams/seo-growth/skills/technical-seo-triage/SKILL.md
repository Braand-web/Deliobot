---
name: technical-seo-triage
description: Turn crawl and indexing evidence into reproducible, severity-ranked technical findings.
---

# Technical SEO Triage

## Use this when

The user has crawl results, Search Console evidence, URL samples, rendering problems, or a suspected indexing issue.

## Process

1. Establish the symptom, affected templates or URLs, first-known date, and expected behavior.
2. Gather evidence from representative URLs and distinguish site-wide issues from isolated examples.
3. Check discovery, robots rules, status codes, redirects, canonicals, renderability, indexability, sitemaps, structured data, internal links, and performance only where relevant.
4. Identify the most likely cause and list plausible alternatives when evidence is incomplete.
5. Rank each finding as blocker, high, medium, or low based on reach and business impact.
6. Define a fix owner and a verification step that can prove the issue is resolved.

## Output

For every finding provide: evidence, affected scope, severity, likely cause, recommended fix, risk, owner, and verification.

## Guardrails

Do not claim a crawl or index state without evidence. Avoid dumping generic audit checks that are unrelated to the reported symptom.
