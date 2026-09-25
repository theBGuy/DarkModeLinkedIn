// Evaluated in the page's main world. Returns theme markers plus an independent
// contrast audit of EVERY visible text-owning element, and the verdicts the old
// (tag allowlist) and new (text-node walk) legibility samplers would reach.
(() => {
  const luminance = (r, g, b) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parseRgb = (v) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(v || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const effectiveBackground = (el) => {
    for (let node = el; node && node !== document; node = node.parentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const ratioOf = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") return null;
    const fg = parseRgb(cs.color);
    if (!fg || fg.a < 0.5) return null;
    const bg = effectiveBackground(el);
    const [hi, lo] = [luminance(fg.r, fg.g, fg.b), luminance(bg.r, bg.g, bg.b)].sort((a, b) => b - a);
    return { ratio: (hi + 0.05) / (lo + 0.05), fg: cs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})` };
  };
  const big = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 12 && r.height >= 8;
  };
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`.slice(0, 60);
  };

  // Old sampler (content.js at HEAD).
  const oldSampler = () => {
    let sampled = 0, illegible = 0;
    for (const el of document.querySelectorAll("p, span, h1, h2, h3, a, li, button, td")) {
      if (sampled >= 60) break;
      if (!el.textContent?.trim() || el.childElementCount > 0) continue;
      if (!big(el)) continue;
      const r = ratioOf(el);
      if (!r) continue;
      sampled++;
      if (r.ratio < 2) illegible++;
    }
    return { sampled, illegible, revoke: sampled >= 8 && illegible / sampled > 0.25 };
  };

  // Every visible element that directly owns non-whitespace text.
  const owners = [];
  const seen = new Set();
  if (document.body) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const el = t.parentElement;
      if (!el || seen.has(el) || !t.data.trim()) continue;
      seen.add(el);
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      owners.push(el);
    }
  }

  const newSampler = () => {
    let sampled = 0, illegible = 0;
    for (const el of owners) {
      if (sampled >= 60) break;
      if (!big(el)) continue;
      const r = ratioOf(el);
      if (!r) continue;
      sampled++;
      if (r.ratio < 2) illegible++;
    }
    return { sampled, illegible, revoke: sampled >= 8 && illegible / sampled > 0.25 };
  };

  // Full audit, WCAG-ish buckets.
  let total = 0, below2 = 0, below3 = 0, below45 = 0;
  const worst = [];
  for (const el of owners) {
    if (!big(el)) continue;
    const r = ratioOf(el);
    if (!r) continue;
    total++;
    if (r.ratio < 2) below2++;
    if (r.ratio < 3) below3++;
    if (r.ratio < 4.5) below45++;
    if (r.ratio < 3) worst.push({ el: label(el), text: el.textContent.trim().slice(0, 40), ratio: +r.ratio.toFixed(2), fg: r.fg, bg: r.bg });
  }
  worst.sort((a, b) => a.ratio - b.ratio);

  const body = document.body;
  return {
    url: location.href,
    htmlClass: document.documentElement.className,
    dmli: document.documentElement.getAttribute("data-dmli"),
    bodyClass: body?.className ?? null,
    bodyScheme: body?.getAttribute("data-color-scheme") ?? null,
    bodyBg: body ? getComputedStyle(body).backgroundColor : null,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyColor: body ? getComputedStyle(body).color : null,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    old: oldSampler(),
    new: newSampler(),
    audit: { total, below2, below3, below45 },
    worst: worst.slice(0, 12),
  };
})()
