import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const browser = await launch({ extPath: `${here}/ext-${process.argv[2] ?? "after"}`.split("/").join(String.fromCharCode(92)), port: 9930 + Math.floor(Math.random() * 20), profileRoot: here });
const pg = await browser.newPage();
await pg.send("Page.bringToFront");
await pg.goto("https://www.linkedin.com/help/linkedin/answer/a519904", 2500);
console.log(JSON.stringify(await pg.eval(`(() => [...document.querySelectorAll(".tabs__tab")].map((t) => {
  const own = [...t.querySelectorAll("*")].concat([t]).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()));
  return { html: t.outerHTML.replace(/\s+/g, " ").slice(0, 260), btn: getComputedStyle(t).color, textOwners: own.map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ")[0] + "=" + getComputedStyle(e).color) };
}))()`), null, 1));
await browser.close();
