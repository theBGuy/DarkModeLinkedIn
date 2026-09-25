// Text over <img> is invisible to a background-color walk, so measure the real
// pixels: hide the text, screenshot its box, and compare the ink against the
// backdrop that is actually painted there.
import { decodePng, relLum } from "./png.mjs";

const MARK = `(() => {
  const imgs = [...document.querySelectorAll("img")].map((i) => i.getBoundingClientRect()).filter((r) => r.width * r.height > 4000);
  const hit = (a) => imgs.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
  const out = []; const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const el = t.parentElement; if (!el || seen.has(el) || !t.data.trim()) continue; seen.add(el);
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < 4 || r.height < 4 || cs.visibility === "hidden" || +cs.opacity === 0 || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
    if (!hit(r)) continue;
    el.setAttribute("data-dmli-px", String(out.length));
    out.push({ text: t.data.trim().slice(0, 30), color: cs.color, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
  }
  return out;
})()`;

const hide = (i, on) => `(() => {
  const e = document.querySelector('[data-dmli-px="${i}"]');
  for (const p of ["color", "-webkit-text-fill-color"]) ${on ? `e.style.setProperty(p, "transparent", "important")` : `e.style.removeProperty(p)`};
  ${on ? `e.style.setProperty("text-shadow", "none", "important")` : `e.style.removeProperty("text-shadow")`};
  return true;
})()`;

const toSrgb = (L) => 255 * (L <= 0.0031308 ? 12.92 * L : 1.055 * L ** (1 / 2.4) - 0.055);

export async function imageBackdrops(page, cap = 40) {
  const cands = await page.eval(MARK);
  if (cands.length > cap) console.log(`  (image-backed text capped: ${cands.length} found, ${cap} measured)`);
  const res = [];
  for (const [i, c] of cands.slice(0, cap).entries()) {
    await page.eval(hide(i, true));
    await new Promise((r) => setTimeout(r, 60));
    const shot = await page.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: c.x, y: c.y, width: Math.max(1, c.w), height: Math.max(1, c.h), scale: 1 },
    });
    await page.eval(hide(i, false));
    const { px, bpp, width, height } = decodePng(Buffer.from(shot.data, "base64"));
    const ls = [];
    for (let p = 0; p < width * height; p++) ls.push(relLum(px[p * bpp], px[p * bpp + 1], px[p * bpp + 2]));
    ls.sort((a, b) => a - b);
    const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
    const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(c.color);
    const a = m[4] === undefined ? 1 : +m[4];
    // Composite the ink over a grey of the backdrop's luminance, then compare.
    const ratioAt = (L) => {
      const bg = toSrgb(L);
      const ink = relLum(+m[1] * a + bg * (1 - a), +m[2] * a + bg * (1 - a), +m[3] * a + bg * (1 - a));
      const [hi, lo] = [ink, L].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const inkL = relLum(+m[1], +m[2], +m[3]);
    const worst = inkL > mean ? ls[Math.floor(ls.length * 0.95)] : ls[Math.floor(ls.length * 0.05)];
    res.push({ text: c.text, color: c.color, mean: +ratioAt(mean).toFixed(2), p95: +ratioAt(worst).toFixed(2) });
  }
  return res;
}
