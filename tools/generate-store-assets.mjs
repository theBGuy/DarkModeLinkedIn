// Renders the Chrome Web Store listing images into store/.
//
// Chrome is the whole toolchain here: the promo tiles are HTML rendered at
// exact viewport sizes, and the screenshot is cropped and downscaled through a
// canvas. That keeps the project dependency-free and gives real high-quality
// resampling instead of a hand-rolled resize.
//
// Usage: node tools/generate-store-assets.mjs [path/to/source-screenshot.png]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const OUT = join(ROOT, "store");
const PORT = 9412;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const CHROME = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error("Chrome not found. Set CHROME_PATH to the executable.");
  process.exit(1);
}

// Store requirements. The screenshot may also be 640x400, but 1280x800 is the
// size the listing actually displays at.
const TILES = [
  { html: "marquee.html", out: "marquee-1400x560.png", w: 1400, h: 560 },
  { html: "small-tile.html", out: "small-tile-440x280.png", w: 440, h: 280 },
];
// Crop and redaction are expressed in SOURCE pixels, measured against the
// captured page, so they are checkable against the original rather than being
// fractions tuned by eye. Replace these when you replace the screenshot.
const SHOT = {
  out: "screenshot-1280x800.png",
  w: 1280,
  h: 800,
  // Full width, anchored at the top. Trimming either edge to make the 8:5 crop
  // clear the tab row costs the nav logo on the left or its right-hand text, so
  // the tab row ends up cut instead — which reads as a page continuing rather
  // than as a broken crop.
  crop: { left: 0, top: 0, width: 2080 },
  // The line naming a third party, plus its avatar cluster.
  redact: [{ x: 125, y: 815, w: 655, h: 54 }],
};

// Any PNG dropped in screenshots/ works; pass a path to pick a specific one.
const defaultShot = () => {
  const dir = join(ROOT, "screenshots");
  if (!existsSync(dir)) return null;
  const png = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")).sort()[0];
  return png ? join(dir, png) : null;
};
const sourceShot = process.argv[2] ? resolve(process.argv[2]) : defaultShot();

const profile = join(process.env.TEMP ?? "/tmp", "dmli-store-assets-profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--headless=new",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const s = new Session(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && s.pending.has(msg.id)) {
        const { res, rej } = s.pending.get(msg.id);
        s.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    return s;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error(method + " timed out")); }, 60000);
    });
  }
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  close() { this.ws.close(); }
}

const newTab = async (url) =>
  (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();

// PNG dimensions live in the IHDR chunk; reading them back is how we prove the
// output is exactly the size the store demands rather than trusting the request.
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

try {
  for (let i = 0; i < 80; i++) {
    try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(300); }
  }
  await sleep(800);

  // ---------- promo tiles ----------
  for (const tile of TILES) {
    const tab = await newTab("file:///" + join(here, "promo", tile.html).replace(/\\/g, "/"));
    const s = await Session.open(tab.webSocketDebuggerUrl);
    await s.send("Page.enable");
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: tile.w, height: tile.h, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(700);
    const { data } = await s.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: tile.w, height: tile.h, scale: 1 },
    });
    const buf = Buffer.from(data, "base64");
    writeFileSync(join(OUT, tile.out), buf);
    const size = pngSize(buf);
    const ok = size.w === tile.w && size.h === tile.h;
    console.log(`${ok ? "ok  " : "BAD "} store/${tile.out}  ${size.w}x${size.h}`);
    if (!ok) process.exitCode = 1;
    s.close();
  }

  // ---------- screenshot ----------
  if (!sourceShot || !existsSync(sourceShot)) {
    console.log(`\nskipped screenshot: put a PNG in screenshots/ or pass a path`);
  } else {
    // Inlined as a data URI: a file:// image would taint the canvas and make
    // toDataURL throw.
    const dataUri = "data:image/png;base64," + readFileSync(sourceShot).toString("base64");
    const tab = await newTab("about:blank");
    const s = await Session.open(tab.webSocketDebuggerUrl);
    await s.send("Runtime.enable");

    const out = await s.ev(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(dataUri)};
      await img.decode();

      const W = ${SHOT.w}, H = ${SHOT.h};
      const crop = ${JSON.stringify(SHOT.crop)};
      const cropW = Math.min(crop.width, img.width - crop.left);
      const cropH = Math.round(cropW * H / W);

      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.left, crop.top, cropW, cropH, 0, 0, W, H);

      // Privacy redaction, pixelated rather than blacked out so it reads as a
      // deliberate omission. Source rects are mapped through the same crop.
      const k = W / cropW;
      const applied = [];
      for (const r of ${JSON.stringify(SHOT.redact)}) {
        const rx = Math.round((r.x - crop.left) * k);
        const ry = Math.round((r.y - crop.top) * k);
        const rw = Math.round(r.w * k);
        const rh = Math.round(r.h * k);
        if (rw <= 0 || rh <= 0 || ry > H) continue;
        const px = 7;
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(rw / px));
        tmp.height = Math.max(1, Math.round(rh / px));
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(c, rx, ry, rw, rh, 0, 0, tmp.width, tmp.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, rx, ry, rw, rh);
        applied.push([rx, ry, rw, rh].join(','));
      }

      return JSON.stringify({
        dataUrl: c.toDataURL('image/png'),
        source: img.width + 'x' + img.height,
        crop: cropW + 'x' + cropH + ' @' + crop.left + ',' + crop.top,
        redaction: applied.join(' | '),
      });
    })()`);

    const parsed = JSON.parse(out);
    const buf = Buffer.from(parsed.dataUrl.split(",")[1], "base64");
    writeFileSync(join(OUT, SHOT.out), buf);
    const size = pngSize(buf);
    const ok = size.w === SHOT.w && size.h === SHOT.h;
    console.log(`${ok ? "ok  " : "BAD "} store/${SHOT.out}  ${size.w}x${size.h}` +
      `   (source ${parsed.source}, cropped ${parsed.crop}, redacted ${parsed.redaction})`);
    if (!ok) process.exitCode = 1;
    s.close();
  }

  console.log(`\nStore icon: icons/icon128.png (already 128x128)`);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(400);
}
