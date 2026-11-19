// Search and sharing tags for every page of deliobot.fun, added when the site is built: the canonical address, Open
// Graph and Twitter cards with absolute URLs, structured data for the product and its questions, and the robots.txt
// and sitemap.xml that point search engines at all of it, and the llms.txt files that AI assistants read.
export const ORIGIN = "https://deliobot.fun";
export const SHARE_IMAGE = `${ORIGIN}/media/deliobot-film.jpg`;
export const SUMMARY = "Deliobot est une application d'agents IA pour les entreprises : des bots qui se connectent à vos outils, ont chacun leur propre ordinateur, travaillent avec votre équipe et reviennent avec le travail terminé.";
const FEATURES = [
  "Bots IA qui mènent des tâches de bout en bout et demandent votre accord avant les actions importantes",
  "Un ordinateur par bot pour utiliser vos applications et vos sites",
  "Apprentissage d'une tâche par démonstration et routines planifiées",
  "Travail en équipe avec des personnes et d'autres bots, dans l'application ou dans Slack",
  "Participation aux réunions Google Meet et Zoom",
  "Claude, GPT, Gemini, Grok, DeepSeek, Mistral, Llama et plus de 300 modèles, avec le mode Auto",
  "Comptes Claude et ChatGPT ou clés API personnelles avec Max et BYOK",
  "Paiement par Mobile Money ou carte, en francs CFA",
];

/** The address a page is served at: "/" for the home page, no ".html", no trailing "/index". */
export function pagePath(file) {
  const path = file.replace(/\.html$/, "").replace(/\/index$/, "");
  return path === "" || path === "/index" ? "/" : path;
}

const attr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const decode = (text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const meta = (html, pattern) => decode(pattern.exec(html)?.[1] ?? "");

/** The page's questions, from its <details><summary>…</summary><p>…</p> pairs. */
export function faqEntries(html) {
  return [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((match) => ({ question: decode(plain(match[1])), answer: decode(plain(match[2])) }))
    .filter((entry) => entry.question && entry.answer);
}

function structuredData(path, title, description, html) {
  const graph = [];
  if (path === "/") {
    graph.push(
      { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Deliobot", url: ORIGIN, logo: `${ORIGIN}/assets/delio-happy.webp`, email: "support@deliobot.fun", description: SUMMARY, slogan: "Des collègues IA qui terminent le travail." },
      { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Deliobot", url: ORIGIN, inLanguage: "fr", publisher: { "@id": `${ORIGIN}/#organization` } },
      {
        "@type": "SoftwareApplication", name: "Deliobot", url: ORIGIN, description, applicationCategory: "BusinessApplication",
        operatingSystem: "Windows, Linux", image: SHARE_IMAGE, featureList: FEATURES, publisher: { "@id": `${ORIGIN}/#organization` },
        offers: [["Starter", "15"], ["Pro", "49"], ["Max", "99"]].map(([name, price]) => ({
          "@type": "Offer", name, price, priceCurrency: "USD", url: `${ORIGIN}/#tarifs`, category: "subscription",
        })),
      },
    );
    const faq = faqEntries(html);
    if (faq.length) graph.push({ "@type": "FAQPage", mainEntity: faq.map((entry) => ({ "@type": "Question", name: entry.question, acceptedAnswer: { "@type": "Answer", text: entry.answer } })) });
  } else {
    const crumbs = [{ name: "Deliobot", path: "/" }];
    if (path.startsWith("/guides/")) crumbs.push({ name: "Guides", path: "/guides" });
    crumbs.push({ name: title.replace(/\s*·\s*Deliobot$/, ""), path });
    graph.push({ "@type": "BreadcrumbList", itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: `${ORIGIN}${crumb.path === "/" ? "/" : crumb.path}` })) });
    if (path === "/a-propos") graph.push({ "@type": "AboutPage", name: title, description, url: `${ORIGIN}${path}`, inLanguage: "fr", about: { "@id": `${ORIGIN}/#organization` } });
    const questions = faqEntries(html);
    if (questions.length) graph.push({ "@type": "FAQPage", mainEntity: questions.map((entry) => ({ "@type": "Question", name: entry.question, acceptedAnswer: { "@type": "Answer", text: entry.answer } })) });
    if (path.startsWith("/guides/")) graph.push({ "@type": "Article", headline: title.replace(/\s*·\s*Deliobot$/, ""), description, inLanguage: "fr", image: SHARE_IMAGE, author: { "@type": "Organization", name: "Deliobot" }, mainEntityOfPage: `${ORIGIN}${path}` });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

/** The page with its search and sharing tags; earlier ones of the same kind are replaced. `indexable`: false for 404. */
export function withSeo(html, file) {
  const path = pagePath(file);
  const indexable = !file.endsWith("404.html");
  const title = meta(html, /<title>([^<]*)<\/title>/);
  const description = meta(html, /<meta name="description" content="([^"]*)"/);
  const url = `${ORIGIN}${path}`;
  const cleaned = html
    .replace(/\s*<link rel="canonical"[^>]*>/g, "")
    .replace(/\s*<meta (?:property|name)="(?:og:[^"]+|twitter:[^"]+|robots)"[^>]*>/g, "")
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
  const tags = indexable ? [
    `<link rel="canonical" href="${url}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<meta property="og:type" content="${path.startsWith("/guides/") ? "article" : "website"}">`,
    `<meta property="og:site_name" content="Deliobot">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:image" content="${SHARE_IMAGE}">`,
    `<meta property="og:image:alt" content="La mascotte de Deliobot">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    `<meta name="twitter:image" content="${SHARE_IMAGE}">`,
    `<script type="application/ld+json">${structuredData(path, title, description, html)}</script>`,
  ] : [`<meta name="robots" content="noindex">`];
  return cleaned.replace(/<\/head>/, `${tags.join("\n")}\n</head>`);
}

/** Every indexable page, for sitemap.xml. */
export function sitemap(files, lastmod) {
  const pages = files.filter((file) => file.endsWith(".html") && !file.endsWith("404.html")).map(pagePath).sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  const priority = (path) => (path === "/" ? "1.0" : path.startsWith("/guides") || path === "/a-propos" || path === "/ambassadeurs" ? "0.8" : "0.3");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((path) =>
    `  <url><loc>${ORIGIN}${path}</loc><lastmod>${lastmod}</lastmod><priority>${priority(path)}</priority></url>`).join("\n")}\n</urlset>\n`;
}

/** Search engines and AI assistants are named so that a host-wide AI-crawler default cannot shut them out. */
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Googlebot", "Bingbot", "Applebot", "Applebot-Extended", "DuckAssistBot", "MistralAI-User", "Meta-ExternalAgent", "CCBot", "cohere-ai"];
const RULES = "Allow: /\nDisallow: /download/\nDisallow: /__upload/\n";
export const ROBOTS = `User-agent: *\n${RULES}\n${AI_CRAWLERS.map((bot) => `User-agent: ${bot}`).join("\n")}\n${RULES}\nSitemap: ${ORIGIN}/sitemap.xml\n`;

const titleOf = (html) => meta(html, /<title>([^<]*)<\/title>/).replace(/\s*·\s*Deliobot$/, "");
const descriptionOf = (html) => meta(html, /<meta name="description" content="([^"]*)"/);

/** A page's readable text as Markdown, from its headings, paragraphs, list items and questions; the product mock-ups,
 * navigation and footer are left out. */
export function pageMarkdown(html) {
  const main = (/<main[\s\S]*?<\/main>/.exec(html) ?? /<body[\s\S]*<\/body>/.exec(html) ?? [html])[0]
    .replace(/<(script|style|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<div class="(?:shot|mock|demo|ui)[\s\S]*?<\/div>/g, "");
  const blocks = [...main.matchAll(/<(h[1-4]|p|li|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(([, tag, inner]) => {
    const text = decode(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([,.;:?!])/g, "$1").trim());
    if (!text) return "";
    if (tag[0] === "h") return `\n${"#".repeat(Math.min(Number(tag[1]) + 1, 4))} ${text}\n`;
    if (tag === "summary") return `\n#### ${text}\n`;
    return tag === "li" ? `- ${text}` : `\n${text}\n`;
  });
  return blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const indexablePages = (pages) => Object.entries(pages).filter(([file]) => file.endsWith(".html") && !file.endsWith("404.html"))
  .sort(([a], [b]) => pagePath(a) === "/" ? -1 : pagePath(b) === "/" ? 1 : a.localeCompare(b));

const LLMS_HEADER = `# Deliobot\n\n> ${SUMMARY}\n\n${FEATURES.map((feature) => `- ${feature}`).join("\n")}\n- Application pour Windows et Linux ; macOS, web et mobile bientôt\n- Starter 15 $, Pro 49 $ et Max 99 $ par mois ; essai de 3 jours pour 5 $ avec 300 crédits\n- Site : ${ORIGIN} · Compte : https://compte.deliobot.fun · Support : support@deliobot.fun\n`;

/** /llms.txt: what Deliobot is, then every page with its summary. `pages` maps a file to its HTML. */
export function llms(pages) {
  const line = ([file, html]) => `- [${titleOf(html)}](${ORIGIN}${pagePath(file)}): ${descriptionOf(html)}`;
  const entries = indexablePages(pages);
  const group = (test) => entries.filter(([file]) => test(pagePath(file))).map(line).join("\n");
  return `${LLMS_HEADER}\n## Pages\n\n${group((path) => !path.startsWith("/guides") && !["/conditions", "/confidentialite"].includes(path))}\n\n## Guides\n\n${group((path) => path.startsWith("/guides"))}\n\n## Optional\n\n${group((path) => ["/conditions", "/confidentialite"].includes(path))}\n- [Texte complet du site](${ORIGIN}/llms-full.txt)\n`;
}

/** /llms-full.txt: the text of every page, so an assistant can answer from one file. */
export function llmsFull(pages) {
  return `${LLMS_HEADER}\n${indexablePages(pages).map(([file, html]) => `\n---\n\n## ${titleOf(html)}\n\nSource : ${ORIGIN}${pagePath(file)}\n\n${pageMarkdown(html)}\n`).join("")}`;
}
