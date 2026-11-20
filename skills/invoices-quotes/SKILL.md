---
name: invoices-quotes
description: "Make professional invoices and quotes as PDF (any currency, FCFA without cents, VAT by rate, discounts, automatic numbering), keep the books of what was sent and paid, turn an accepted quote into an invoice, and chase unpaid invoices. Use whenever the person asks for an invoice, a quote, an estimate, a receipt or a payment reminder."
---

# Invoices and quotes

`invoice.mjs` sits next to this guide, in this skill's `root`. It needs Node 18 or later and nothing installed. It makes
one self-contained A4 page per document (the logo is inlined) and, with `--pdf`, the PDF through the Chrome or Edge on
this computer. Every document is numbered and recorded in a ledger, so nothing is numbered twice and unpaid invoices can
be chased.

## Where the books live

Keep the person's books in your shared bot folder, `<sharedBotFolder>/invoices/`, so every conversation finds the same
numbering and ledger. Pass it as `--books` every time. Never number a document by hand.

## The first time: the seller

Ask once, then remember it with your memory or `project_note` and reuse it: business name, address, phone, e-mail,
tax number if any, logo (an image file the person gives, or one you made with `generate_image`), the currency, the VAT
rate they charge (0 if they don't), how clients pay (Wave, Orange Money, bank details, a payment link), payment terms
(days), and the language (fr or en).

## Make a document

Write the document as JSON in the books folder (`<books>/drafts/<client>-<date>.json`):

```json
{
  "kind": "invoice",
  "language": "fr",
  "currency": "XOF",
  "taxRate": 18,
  "discountPercent": 0,
  "dueDays": 30,
  "seller": { "name": "…", "address": "…", "phone": "…", "email": "…", "taxId": "…", "logo": "logo.png" },
  "client": { "name": "…", "address": "…", "email": "…", "phone": "…" },
  "items": [
    { "description": "…", "detail": "optional second line", "quantity": 2, "unitPrice": 15000, "taxRate": 18, "discountPercent": 0 }
  ],
  "paymentInfo": "Wave : +221 …\nOrange Money : +221 …",
  "notes": "…",
  "footer": "…",
  "accent": "#1f4e79"
}
```

- `kind` is `invoice` or `quote`. A quote takes `validDays` (30 when absent) instead of `dueDays`.
- `taxRate` on a line overrides the document's; a line without VAT takes `0`. Amounts are before tax.
- The logo path is relative to the JSON file. `accent` is the brand colour.
- Prices come from the person or their catalogue. Never invent a price, a tax number or bank details: ask.

```sh
node "<root>/invoice.mjs" --data <document.json> --books <books> --pdf
```

It answers with one line of JSON: `number` (FAC-2026-0001, DEV-2026-0001), `total`, `totalShown`, `html` and `pdf`.
Check the total against what the person expects before sending. To correct a document, set `"number"` in the JSON to
its number and run it again: the same number is reused.

Show the result: attach the PDF (or the HTML when no PDF could be made) with `attach_file`, and say the total.

## Send it

Only when the person says to send it. By e-mail through the connected Gmail or Outlook app (the PDF attached, a short
polite message in the document's language), or by WhatsApp when connected. Then mark it sent:

```sh
node "<root>/invoice.mjs" --mark-sent <number> --books <books>
```

## Quotes that become invoices

When the client accepts a quote: `--accept <DEV-number>`. Then make the invoice from the same JSON with `"kind":
"invoice"`, `"fromQuote": "<DEV-number>"`, and no `number`. The ledger links them.

## Payments and reminders

- Paid: `--mark-paid <number> --books <books>` (`--paid-on 2026-12-01` when it was another day). Making the document
  again then shows a PAID stamp, which serves as a receipt.
- What is owed: `--list --unpaid --books <books>`; late ones only: `--list --overdue`. `owed` sums the unpaid totals by
  currency.
- When the person wants reminders, set a routine with `trigger` (for example every Monday at 9:00) that runs
  `--list --overdue` and drafts a polite reminder for each late invoice, from the person, to send only once they agree
  (or automatically if they said so).

`--cancel <number>` voids a document; its number is never reused.
