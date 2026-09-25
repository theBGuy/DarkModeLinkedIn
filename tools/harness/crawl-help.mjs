// Crawls the public Help Center from every product home: records each page's
// template (hue article vs the artdeco template) and which components it uses.
// Usage: node crawl-help.mjs [maxPages]
import { writeFileSync } from "node:fs";

const MAX = +(process.argv[2] ?? 500);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const PRODUCTS = ["linkedin", "billing", "learning", "lms", "recruiter", "sales-navigator", "talent-insights"];
const COMPONENTS = ["tabs__tab", "collapsible__trigger", "article-content-callout", "artdeco-table", "article-content__image", "video", "helpfulness-rating", "related-articles", "support-card", "article-preview", "topic-page", "search-result", "link-button", "machine-translation", "breadcrumb", "pagination", "hc-home", "product-", "card"];

const norm = (u) => {
  try {
    const x = new URL(u, "https://www.linkedin.com");
    if (x.hostname !== "www.linkedin.com" || !/^\/help\//.test(x.pathname)) return null;
    if (/\/(ask|cases|solve|contact)/.test(x.pathname)) return null; // forms / signed-in flows
    return "https://www.linkedin.com" + x.pathname.replace(/\/$/, "");
  } catch { return null; }
};

const seen = new Set();
const queue = PRODUCTS.map((p) => `https://www.linkedin.com/help/${p}`);
queue.forEach((u) => seen.add(u));
const pages = [];
let fetched = 0;

async function visit(url) {
  let html = "";
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      status = r.status;
      html = await r.text();
      if (r.status !== 429) break;
    } catch { status = -1; }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  const body = (/<body[^>]*>/.exec(html) || [""])[0];
  const template = /hue-web-color-scheme--/.test(body) ? "hue" : /data-in-hueify-scope="false"/.test(body) ? "artdeco" : body ? "other" : "none";
  const comps = COMPONENTS.filter((c) => html.includes(c));
  pages.push({ url, status, template, comps, kind: url.includes("/answer/") ? "answer" : url.includes("/topic/") ? "topic" : "other" });
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const u = norm(m[1].replace(/&amp;/g, "&"));
    if (u && !seen.has(u) && seen.size < MAX) { seen.add(u); queue.push(u); }
  }
}

const CONC = 4;
async function worker() {
  while (queue.length) {
    const u = queue.shift();
    fetched++;
    await visit(u);
    if (fetched % 50 === 0) console.log(`  ${fetched} fetched, ${queue.length} queued`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const by = {};
for (const p of pages) { const k = `${p.kind}/${p.template}/${p.status}`; by[k] = (by[k] || 0) + 1; }
console.log("pages", pages.length, JSON.stringify(by));
const compCount = {};
for (const p of pages.filter((p) => p.status === 200)) for (const c of p.comps) { const k = `${p.template}:${c}`; compCount[k] = (compCount[k] || 0) + 1; }
console.log(JSON.stringify(compCount, null, 0));
writeFileSync(new URL("./help-crawl.json", import.meta.url), JSON.stringify(pages, null, 1));
