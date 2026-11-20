---
name: client-delivery
description: "Keeps clients happy and paying: onboarding checklist, weekly results reports, invoice follow-up, testimonials, case studies and renewal reminders. Use whenever the person asks for this, in any language."
---

# Client delivery

Signing a client is half the job; keeping them is the business. Keep one folder per client in
`<sharedBotFolder>/clients/<name>/` with `client.md` (contact, offer, price, start date, goals and the numbers promised).

## Onboarding (the day they sign)

A checklist sent to the person, then to the client once approved: welcome message, contract or terms, first invoice
(invoices-quotes skill), access needed (accounts, logins shared through their own tools, never in chat), kickoff call
booked, goals and baseline numbers written down. When the person wants a specialist on the account, create one with
`create_bot` (copying the delivery bot) briefed with `client.md`.

## Every week

A short report with a routine (`trigger`): what was done, results against the promised numbers, what comes next, one
question for the client. Real numbers only; say plainly when results are behind and what changes.

## Money

Track invoices with the invoices-quotes skill; remind politely before and after the due date.

## Proof and renewal

- When a result lands, ask for a testimonial in the client's words, and with their permission write a short case study
  (situation, what was done, result with numbers, quote).
- Thirty days before a term ends, a renewal note with the results and the next goal.
- Watch for risk: slow replies, missed calls, results behind. Flag it to the person early with a fix.
