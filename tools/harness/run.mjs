// Usage: [BASE_REF=<git ref>] node run.mjs <before|after> [--shots] [--only substr]
// Stages a copy of the extension (HEAD or working tree), adds a localhost match
// so fixtures are reachable (file:// never matches), and audits each page.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const REPO = dirname(dirname(here));
// "before" stages this ref; after a commit HEAD is the new code, so pass BASE_REF.
const BASE_REF = process.env.BASE_REF || "HEAD";
const variant = process.argv[2] ?? "after";
const shots = process.argv.includes("--shots");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- stage the extension ----
const ext = `${here}/ext-${variant}`;
rmSync(ext, { recursive: true, force: true });
mkdirSync(ext, { recursive: true });
for (const f of ["manifest.json", "content.js", "dark.css", "icons", "popup"]) cpSync(`${REPO}/${f}`, `${ext}/${f}`, { recursive: true });
if (variant === "before") {
  for (const f of ["content.js", "dark.css", "popup/popup.js"]) {
    writeFileSync(`${ext}/${f}`, execFileSync("git", ["-C", REPO, "show", `${BASE_REF}:${f}`]));
  }
}
const manifest = JSON.parse(readFileSync(`${ext}/manifest.json`, "utf8"));
manifest.content_scripts[0].matches.push("http://localhost/*");
writeFileSync(`${ext}/manifest.json`, JSON.stringify(manifest, null, 2));

// ---- fixture server ----
const FIX = `${REPO}/tools/fixtures`;
const server = createServer((req, res) => {
  const name = req.url.split("?")[0].replace(/^\//, "") || "index.html";
  const candidates = [`${FIX}/${name}`, `${here}/fixtures/${name}`];
  for (const p of candidates) {
    try {
      const body = readFileSync(p);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    } catch {}
  }
  res.writeHead(404);
  res.end("nf");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const L = (p) => `http://localhost:${port}/${p}`;

const PAGES = [
  ["help-answer", "https://www.linkedin.com/help/linkedin/answer/a1339364"],
  ["help-answer-2", "https://www.linkedin.com/help/linkedin/answer/a6214075"],
  ["help-home", "https://www.linkedin.com/help/linkedin"],
  ["help-search", "https://www.linkedin.com/help/linkedin/search?q=dark"],
  ["guest-home", "https://www.linkedin.com/"],
  ["guest-jobs", "https://www.linkedin.com/jobs"],
  ["guest-company", "https://www.linkedin.com/company/linkedin"],
  ["login-sdui", "https://www.linkedin.com/login"],
  ["legal", "https://www.linkedin.com/legal/privacy-policy"],
  ["fx-voyager", L("voyager.html")],
  ["fx-unthemeable", L("unthemeable.html")],
  ["fx-hue", L("hue.html")],
  ["fx-hue-late", L("hue-late.html")],
].filter(([n]) => !only || n.includes(only));

const audit = readFileSync(`${here}/audit.js`, "utf8");
const outDir = `${here}/out-${variant}`;
mkdirSync(outDir, { recursive: true });

const browser = await launch({ extPath: ext.replace(/\//g, "\\"), port: 9300 + Math.floor(Math.random() * 400), profileRoot: here });
console.log(`ext ${variant} loaded as ${browser.extId}; fixtures on :${port}`);
const page = await browser.newPage();
const results = {};
for (const [name, url] of PAGES) {
  try {
    await page.goto(url, 3000);
    const r = await page.eval(audit);
    results[name] = r;
    if (shots) await page.shot(`${outDir}/${name}.jpg`, { fullPage: true, scale: 0.5 });
    console.log(
      `${name.padEnd(15)} dmli=${String(r.dmli).padEnd(4)} scheme=${String(r.bodyScheme).padEnd(5)} ` +
      `hue=${(r.bodyClass?.match(/hue-web-color-scheme--\w+/) ?? ["-"])[0].padEnd(28)} bodyBg=${r.bodyBg.padEnd(20)} htmlBg=${r.htmlBg.padEnd(20)} ` +
      `old=${r.old.illegible}/${r.old.sampled}${r.old.revoke ? "!" : ""} new=${r.new.illegible}/${r.new.sampled}${r.new.revoke ? "!" : ""} ` +
      `audit<2=${r.audit.below2} <3=${r.audit.below3} <4.5=${r.audit.below45} of ${r.audit.total}`,
    );
  } catch (e) {
    console.log(`${name} FAILED: ${e.message}`);
  }
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2));
if (browser.exceptions.length) console.log("exceptions:\n  " + browser.exceptions.join("\n  "));
await browser.close();
server.close();
