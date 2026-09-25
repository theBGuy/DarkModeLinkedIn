// Usage: node shots.mjs <variant> <url> <name> [scrollY] — viewport screenshot at 1280x900 (downscaled).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant, ...rest] = process.argv.slice(2);
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9990 + Math.floor(Math.random() * 8), profileRoot: here });
const page = await browser.newPage();
for (let i = 0; i < rest.length; i += 3) {
  const [url, name, y] = [rest[i], rest[i + 1], +rest[i + 2] || 0];
  await page.send("Page.bringToFront");
  await page.goto(url, 2500);
  await page.eval(`window.scrollTo(0, ${y}); true`);
  await new Promise((r) => setTimeout(r, 500));
  const r = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 60, clip: { x: 0, y, width: 1280, height: 900, scale: 0.55 } });
  (await import("node:fs")).writeFileSync(`${here}/out-${variant}/${name}.jpg`, Buffer.from(r.data, "base64"));
}
await browser.close();
