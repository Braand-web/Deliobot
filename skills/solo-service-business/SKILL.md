---
name: solo-service-business
description: "Takes a person from zero to a steady monthly income with a one-person service business in a 100-day sprint: offer, outreach, sales and delivery, run by a small team of bots and tracked every day. Use whenever the person asks for this, in any language."
---

# Solo service business

The fastest road from nothing to a steady income for one person is a **service sold to businesses at a monthly price**:
five clients at 200 000 F CFA a month is 1 000 000 F CFA a month, with no stock, no ads budget and no audience needed.
It works when the person does one thing for 100 days without stopping. Your job is to make that easy and to keep them
honest with the numbers.

## Set it up (first conversation)

1. **Interview the person**, a few questions at a time: their goal for 100 days (monthly income), what they have done for
   work, problems they have lived through and solved, industries they know through family or past jobs, what they enjoy,
   hours a day they can give, money they can spend, their phone and social contacts, the apps they use.
2. **The offer**: follow the offer-builder skill. Do not move on without a one-line offer they can start testing this week.
3. **The numbers**: work backwards from the goal with `sprint.mjs` (next to this guide):

   ```sh
   node "<root>/sprint.mjs" --start --dir <sharedBotFolder>/business --goal 1000000 --price 200000 --offer "<one line>"
   ```

   It answers with how many clients, qualified calls, shows, booked calls and outreach messages the goal needs, and the
   outreach per day. Defaults: 2% of outreach books a call, 80% show up, 60% are qualified, 33% close; pass `--book`,
   `--show`, `--qualified`, `--close` once real numbers exist. `--plan` with the same numbers only computes.
4. **The team** (with the person's agreement; see the bot-team-builder skill): you stay the chief of staff; create four
   specialists with `create_bot`, each with one job and clear instructions: **Offer**, **Outreach**, **Sales** and
   **Delivery**, briefed from the offer-builder, client-outreach, sales-calls and client-delivery skills. Hand work to
   them with `coordinate_bots`.
5. **The rhythm** with `trigger`: a **morning brief** (today's outreach target, follow-ups due, calls to prepare, one
   thing that matters most) and a **Sunday review** (the week's numbers against the plan, what to change).

## Every day

Log what was done, on the person's word, never invented:

```sh
node "<root>/sprint.mjs" --log --dir <sharedBotFolder>/business --outreach 40 --conversations 6 --booked 1 --note "…"
```

Fields: `outreach`, `conversations`, `booked`, `showed`, `qualified`, `closed`, `revenue`. Plain `node "<root>/sprint.mjs"
--dir …` gives the day of the sprint, the streak, totals, real conversion rates, whether they are on pace and how much is
left to the goal. When they fall behind, say so plainly with the number, and make today's plan smaller and concrete
rather than longer.

## Rules

- Focus beats variety: one offer, one niche, one main channel for the whole sprint unless the numbers say otherwise.
- Never promise income, never invent results, testimonials or client numbers, and never send anything in the person's
  name without their approval.
- Money in local currency; prices and costs come from the person.
