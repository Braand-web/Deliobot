---
name: command-center
description: "One live page that shows everything the person's bots are doing and tracking: routines and the ones that failed, what is waiting for the person, money owed, price alerts, business numbers, today's calendar. Use when the person wants an overview, a command center, a home page or a live dashboard of their Deliobot."
---

# Command center

A single live page the person opens to know, in ten seconds, what is going on and what needs them. Build it with the
data-dashboards skill as a **folder page** shown with `show_html` and `live: true`, kept fresh by a routine.

## What goes on it (only what applies)

| Block | Where it comes from |
|---|---|
| Needs you now | questions waiting, drafts to approve, failed routines, overdue invoices |
| Routines | `trigger_info`: each automation, its last run and result; failures first, in red |
| Today | the connected calendar's events and the morning brief's top three tasks |
| Money | owed and overdue invoices (invoices-quotes: `--list --unpaid`), revenue this month |
| Business sprint | day of the 100-day sprint, streak, outreach against plan (solo-service-business `sprint.mjs`) |
| Price alerts | items at or under target (price-watch `prices.mjs`) |
| Projects | what each bot is working on (`list_bots`), last result, next step |

Each block shows a number or a short list and links to where to act. Empty blocks are hidden, not shown as zero.

## Build it

1. Ask what matters to the person (or propose from what they use), then gather each block's data into JSON files in
   `<sharedBotFolder>/command-center/data/`.
2. Write `index.html` in `<sharedBotFolder>/command-center/` reading those files: one column on a phone, a grid on a
   computer, the "Needs you now" block first, the time of the last refresh at the top.
3. Show it with `show_html` (folder, `live: true`).
4. Create a routine with `trigger` (`when: schedule`, every hour in the day, or what the person prefers) whose
   instructions refresh the data files only, so the page updates by itself.

Keep personal and financial details out of anything published; this page stays in the app unless the person asks for a
link, and then only with what they agree to share.
