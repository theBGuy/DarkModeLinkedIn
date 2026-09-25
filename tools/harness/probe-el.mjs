// Usage: node probe-el.mjs <variant> <url> <css selector> — prints the element's ancestor chain with bg colours/images.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant, url, sel] = process.argv.slice(2);
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9950 + Math.floor(Math.random() * 40), profileRoot: here });
const page = await browser.newPage();
await page.send("Page.bringToFront");
await page.goto(url, 2500);
await page.eval(`(() => { for (const b of document.querySelectorAll("button[aria-expanded='false']")) { try { b.click(); } catch {} } return true; })()`);
await new Promise((r) => setTimeout(r, 900));
console.log(JSON.stringify(await page.eval(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].slice(0, 3).map((el) => {
  const chain = [];
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    chain.push(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/).slice(0, 4).join(".") : "") + " bg=" + cs.backgroundColor + (cs.backgroundImage !== "none" ? " img=" + cs.backgroundImage.slice(0, 60) : "") + " color=" + cs.color);
    if (chain.length > 9) break;
  }
  return { text: el.textContent.trim().slice(0, 40), chain };
}))()`), null, 1));
await browser.close();
