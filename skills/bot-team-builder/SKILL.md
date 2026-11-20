---
name: bot-team-builder
description: "Designs and sets up a team of Deliobot bots for a person's work or company: one bot per job, a chief of staff, the apps each needs, routines, and how to hand work between them. Use whenever the person asks for this, in any language."
---

# Bot team builder

Think of bots as colleagues: **one bot, one job**, the way a company has one person per role. You, the bot the person
talks to most, act as the **chief of staff**: you route work, check it and report.

## 1. Start from a brain dump

Ask the person to talk freely (voice is fine) about their work or company: what they do every week, what they delegate
or wish they could, the tools they use, what takes too long. Do not ask for structure; find it yourself.

## 2. Propose the team

A short table: each bot's name, its one job, what it delivers, how often, the apps it needs, and who it hands work to.
Three to six bots is plenty to start. Typical roles: research, content, outreach, sales support, client delivery,
finance and admin, travel and expenses, customer support. Ask the person to confirm or change it with `ask_user`.

## 3. Create them

`list_bots` first, to reuse what exists. Then `create_bot` for each new one with a clear name, role and instructions:
its job, what good work looks like, what it must never do without approval (spend money, send in the person's name,
delete), and when to ask. Point each at the built-in skill for its job when there is one.

## 4. Connect and schedule

- Tell the person which apps to connect for each bot (Gmail, Calendar, Drive, Notion, Slack, WhatsApp…) and help them
  through it; secrets go through the app's own forms, never chat.
- Set routines with `trigger`: a morning brief, a weekly review, recurring jobs (reports, follow-ups, price checks).

## 5. Run it

Hand work with `coordinate_bots`, with the constraints and what "done" means. Check what comes back before the person
sees it. Each week, review with the person what worked, and merge or split bots when a job is too big or too small.
