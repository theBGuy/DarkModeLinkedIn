import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const variant = process.argv[2] ?? "after";
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9650 + Math.floor(Math.random() * 40), profileRoot: here });
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${browser.extId}/popup/popup.html`, 300);
for (const url of ["https://www.linkedin.com/help/linkedin", "https://www.linkedin.com/help/linkedin/search?q=dark", "https://www.linkedin.com/help/billing", "https://www.linkedin.com/help/learning", "https://www.linkedin.com/help/sales-navigator"]) {
  const pg = await browser.newPage();
  await pg.send("Page.bringToFront");
  await pg.goto(url, 3000);
  const html = await pg.eval(`document.documentElement.className + " | body=" + document.body.className`);
  const st = await popup.eval(`(async () => { const out = []; for (const t of await chrome.tabs.query({})) { try { const r = await chrome.tabs.sendMessage(t.id, { type: "dmli:get-state" }); if (r) out.push(r); } catch {} } return out; })()`);
  console.log(url.replace("https://www.linkedin.com", "").padEnd(28), JSON.stringify(st), "|", html.slice(0, 90));
  await pg.close();
}
await browser.close();
