import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const SKILLS = join(process.cwd(), "skills");
const bundled = loadBundledSkills(SKILLS);
const selected = (text: string) => selectBundledSkills(text, [], bundled).map((skill) => skill.manifest.id);
const invoice = await import(pathToFileURL(join(SKILLS, "invoices-quotes", "invoice.mjs")).href) as {
  computeTotals(doc: unknown): { total: number; subtotal: number; discount: number; tax: number; taxes: { rate: number; base: number; amount: number }[] };
  formatMoney(value: number, currency: string, language?: string): string;
  run(argv: string[], options?: { today?: string; browsers?: string[] }): Promise<Record<string, any>>;
};
const store = await import(pathToFileURL(join(SKILLS, "online-store", "store.mjs")).href) as {
  whatsappNumber(value: unknown): string | null;
  readCatalog(raw: unknown): { errors: string[]; store: Record<string, any> };
  renderStore(store: Record<string, any>): string;
  build(catalogFile: string, out: string): Record<string, any>;
};

const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "odb-business-skill-")); dirs.push(dir); return dir; };
afterAll(async () => { for (const dir of dirs) await removeTempDir(dir); });

describe.each(["invoices-quotes", "online-store"])("bundled %s skill", (id) => {
  it("is a valid, clean, default-on skill", () => {
    const text = readFileSync(join(SKILLS, id, "SKILL.md"), "utf8");
    expect(parseSkillMd(text)).toMatchObject({ name: id });
    expect(scanSkillText(text)).toEqual([]);
    const skill = bundled.find((one) => one.manifest.id === id);
    expect(skill?.manifest.defaultEnabled).toBe(true);
  });
});

describe("invoices and quotes", () => {
  it("mounts for invoice and quote requests in French and English", () => {
    for (const text of ["Fais une facture pour Moussa", "j'ai besoin d'un devis pour la cuisine", "relance les impayés", "make an invoice for ACME", "send a quote for the logo"]) {
      expect(selected(text)).toContain("invoices-quotes");
    }
  });

  it("totals FCFA without cents, with a discount and VAT by rate", () => {
    const totals = invoice.computeTotals({
      currency: "XOF", taxRate: 18, discountPercent: 10,
      items: [{ description: "Site vitrine", quantity: 1, unitPrice: 250_000 }, { description: "Livre", quantity: 3, unitPrice: 12_345, taxRate: 0 }],
    });
    expect(totals.subtotal).toBe(287_035);
    expect(totals.discount).toBe(28_704);
    expect(totals.taxes).toEqual([{ rate: 18, base: 225_000, amount: 40_500 }]);
    expect(totals.total).toBe(298_831);
    expect(invoice.formatMoney(298_831, "XOF")).toMatch(/^298\s831\sF\sCFA$/);
  });

  it("numbers documents, links a quote to its invoice and tracks what is owed", async () => {
    const books = scratch();
    const draft = (doc: Record<string, unknown>) => { const file = join(books, `draft-${Math.random()}.json`); writeFileSync(file, JSON.stringify(doc)); return file; };
    const base = { currency: "EUR", taxRate: 20, seller: { name: "Atelier <b>Awa</b>" }, client: { name: "Client" }, items: [{ description: "Design", quantity: 2, unitPrice: 100 }] };
    const options = { today: "2026-11-20", browsers: [] };

    const quote = await invoice.run(["--data", draft({ ...base, kind: "quote" }), "--books", books], options);
    expect(quote).toMatchObject({ ok: true, number: "DEV-2026-0001", total: 240 });
    await invoice.run(["--accept", "DEV-2026-0001", "--books", books], options);
    const first = await invoice.run(["--data", draft({ ...base, fromQuote: "DEV-2026-0001", dueDays: 10 }), "--books", books], options);
    expect(first.number).toBe("FAC-2026-0001");
    const html = readFileSync(first.html, "utf8");
    expect(html).toContain("Atelier &#60;b&#62;Awa&#60;/b&#62;");
    expect(html).not.toContain("<b>Awa");

    const second = await invoice.run(["--data", draft(base), "--books", books, "--pdf"], options);
    expect(second).toMatchObject({ number: "FAC-2026-0002", pdf: null });
    expect(second.message).toMatch(/No Chrome or Edge/);
    await invoice.run(["--mark-paid", "FAC-2026-0002", "--books", books], options);

    const owed = await invoice.run(["--list", "--unpaid", "--books", books], options);
    expect(owed.documents.map((one: { number: string }) => one.number)).toEqual(["FAC-2026-0001"]);
    expect(owed.owed).toEqual({ EUR: 240 });
    const late = await invoice.run(["--list", "--overdue", "--books", books], { ...options, today: "2026-12-15" });
    expect(late.documents.map((one: { number: string }) => one.number)).toEqual(["FAC-2026-0001"]);
    const ledger = JSON.parse(readFileSync(join(books, "ledger.json"), "utf8"));
    expect(ledger.documents.find((one: { number: string }) => one.number === "DEV-2026-0001")).toMatchObject({ status: "accepted", invoicedAs: "FAC-2026-0001" });
    await expect(invoice.run(["--mark-paid", "DEV-2026-0001", "--books", books], options)).rejects.toThrow(/invoice it first/);
  });
});

describe("online store", () => {
  it("mounts for shop requests in French and English", () => {
    for (const text of ["Crée une boutique en ligne pour mes sacs", "je veux vendre en ligne", "build me an online store", "commande whatsapp pour mon catalogue"]) {
      expect(selected(text)).toContain("online-store");
    }
  });

  it("refuses a catalogue nobody could order from, and says why", () => {
    expect(store.whatsappNumber("+221 77 123 45 67")).toBe("221771234567");
    expect(store.whatsappNumber("12")).toBeNull();
    const { errors } = store.readCatalog({ name: "", products: [{ name: "Sac", price: "abc", payLink: "http://pay.example" }] });
    expect(errors).toEqual(expect.arrayContaining([
      "name is required",
      "give whatsapp, email or a payLink per product, so customers can order",
      "products[0].price must be a number",
      "products[0].payLink must be an https link",
    ]));
  });

  it("builds a page whose product data cannot break out of its script", () => {
    const dir = scratch();
    writeFileSync(join(dir, "bag.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    writeFileSync(join(dir, "store.json"), JSON.stringify({
      name: "Awa", currency: "XOF", whatsapp: "+221 77 123 45 67",
      products: [{ name: "Sac </script><script>alert(1)</script>", price: 18_000, image: "bag.png" }, { name: "Foulard", price: 9_500, compareAt: 12_000, soldOut: true }],
    }));
    const result = store.build(join(dir, "store.json"), join(dir, "site"));
    expect(result).toMatchObject({ ok: true, products: 2, images: 1, ordering: ["whatsapp"] });
    expect(existsSync(join(dir, "site", "images", "bag.png"))).toBe(true);
    const html = readFileSync(join(dir, "site", "index.html"), "utf8");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("wa.me/");
    expect(() => store.build(join(dir, "missing.json"), join(dir, "out"))).toThrow(/ENOENT/);
  });
});
