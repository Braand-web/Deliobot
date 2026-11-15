import { describe, expect, it } from "vitest";

import { faqEntries, pagePath, ROBOTS, sitemap, withSeo } from "./seo.mjs";

const page = (body = "") => `<html lang="fr"><head><title>Vendre · Deliobot</title><meta name="description" content="Un guide &amp; plus">
<meta property="og:image" content="/assets/old.webp"></head><body>${body}</body></html>`;

describe("search and sharing tags for deliobot.fun", () => {
  it("serves each page at its clean address", () => {
    expect(pagePath("/index.html")).toBe("/");
    expect(pagePath("/guides/index.html")).toBe("/guides");
    expect(pagePath("/guides/ventes.html")).toBe("/guides/ventes");
  });

  it("gives every page one canonical address and absolute sharing tags, replacing older ones", () => {
    const html = withSeo(page(), "/guides/ventes.html");
    expect(html).toContain('<link rel="canonical" href="https://deliobot.fun/guides/ventes">');
    expect(html).toContain('<meta property="og:image" content="https://deliobot.fun/media/deliobot-film.jpg">');
    expect(html).not.toContain("/assets/old.webp");
    expect(html).toContain('<meta property="og:description" content="Un guide &amp; plus">');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    expect(data["@graph"].map((item) => item["@type"])).toEqual(["BreadcrumbList", "Article"]);
  });

  it("describes the product, its plans and its questions on the home page", () => {
    const html = withSeo(page("<details open><summary>Combien coûte Deliobot ?</summary><p>Starter est à 15 $.</p></details>"), "/index.html");
    const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])["@graph"];
    expect(graph.find((item) => item["@type"] === "SoftwareApplication").offers.map((offer) => offer.price)).toEqual(["15", "49", "99"]);
    expect(graph.find((item) => item["@type"] === "FAQPage").mainEntity[0].name).toBe("Combien coûte Deliobot ?");
    expect(faqEntries("<details><summary>Q</summary><p>A <b>b</b></p></details>")).toEqual([{ question: "Q", answer: "A b" }]);
  });

  it("keeps the 404 page out of search, and lists only real pages in the sitemap", () => {
    expect(withSeo(page(), "/404.html")).toContain('<meta name="robots" content="noindex">');
    const xml = sitemap(["/index.html", "/404.html", "/guides/ventes.html", "/site.css"], "2026-11-15");
    expect(xml).toContain("<loc>https://deliobot.fun/</loc>");
    expect(xml).toContain("<loc>https://deliobot.fun/guides/ventes</loc>");
    expect(xml).not.toContain("404");
    expect(ROBOTS).toContain("Sitemap: https://deliobot.fun/sitemap.xml");
  });
});
