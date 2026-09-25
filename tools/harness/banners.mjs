// Classifies every Lithograph banner: image pin/size vs banner and headline rects.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const urls = readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean);
const browser = await launch({ extPath: `${here}/ext-after`.split("/").join(String.fromCharCode(92)), port: 9900 + Math.floor(Math.random() * 40), profileRoot: here });
const pg = await browser.newPage();
const out = [];
for (const url of urls) {
  await pg.send("Page.bringToFront");
  await pg.goto(url, 2500);
  const r = await pg.eval(`(() => [...document.querySelectorAll("#lithograph-app .banner")].map((b) => {
    const br = b.getBoundingClientRect(); const img = b.querySelector(".banner__image"); const ir = img && img.getBoundingClientRect();
    const h = b.querySelector(".banner__headline"); const hr = h && h.getBoundingClientRect();
    const cover = ir ? (Math.max(0, Math.min(ir.right, br.right) - Math.max(ir.left, br.left)) * Math.max(0, Math.min(ir.bottom, br.bottom) - Math.max(ir.top, br.top))) / (br.width * br.height) : 0;
    const underHead = ir && hr ? (Math.max(0, Math.min(ir.right, hr.right) - Math.max(ir.left, hr.left)) * Math.max(0, Math.min(ir.bottom, hr.bottom) - Math.max(ir.top, hr.top))) / (hr.width * hr.height) : 0;
    return { cls: b.className.replace(/banner-height-\S+/g, "").replace(/\s+/g, " ").trim(), imgCls: img && img.className, src: img && (img.currentSrc || img.src || "").split("/").slice(-3, -2)[0], natural: img && img.naturalWidth + "x" + img.naturalHeight, cover: +cover.toFixed(2), underHead: +underHead.toFixed(2), head: h && h.textContent.trim().slice(0, 30), headColor: h && getComputedStyle(h).color };
  }))()`);
  out.push({ url, banners: r });
  for (const b of r) console.log(url.replace("https://www.linkedin.com", "").padEnd(40), b.cls.replace("banner banner--v3 ", "").padEnd(62), (b.imgCls || "-").replace("banner__image ", "").padEnd(26), "cover=" + b.cover, "underHead=" + b.underHead, b.natural, b.src, "|", b.head);
  if (!r.length) console.log(url.replace("https://www.linkedin.com", "").padEnd(40), "(no banner)");
}
writeFileSync(`${here}/out-after/banners.json`, JSON.stringify(out, null, 2));
await browser.close();
