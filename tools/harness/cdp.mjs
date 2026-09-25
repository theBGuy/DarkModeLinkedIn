// Minimal CDP driver: launches Chrome with a throwaway profile, loads an
// unpacked extension over Extensions.loadUnpacked, and exposes a page session.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ extPath, port = 9333, headless = true, profileRoot }) {
  const profile = mkdtempSync(join(profileRoot ?? tmpdir(), "prof-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,OptimizationHints",
    "--window-size=1280,900",
  ];
  if (headless) args.push("--headless=new");
  args.push("about:blank");
  const proc = spawn(CHROME, args, { stdio: "ignore" });

  let ver;
  for (let i = 0; i < 100; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!ver) throw new Error("chrome did not expose CDP");

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      return;
    }
    for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const exceptions = [];
  listeners.add((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      exceptions.push(`${d.url ?? ""}:${d.lineNumber} ${d.exception?.description ?? d.text}`.slice(0, 300));
    }
  });

  let extId = null;
  if (extPath) {
    const r = await send("Extensions.loadUnpacked", { path: extPath });
    extId = r.id;
  }

  async function newPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const waitEvent = (name, timeout = 30000) =>
      new Promise((res) => {
        const t = setTimeout(() => { listeners.delete(fn); res(null); }, timeout);
        const fn = (msg) => {
          if (msg.sessionId === sessionId && msg.method === name) {
            clearTimeout(t);
            listeners.delete(fn);
            res(msg.params);
          }
        };
        listeners.add(fn);
      });
    return {
      targetId,
      send: s,
      async goto(url, settle = 2500) {
        const loaded = waitEvent("Page.loadEventFired", 45000);
        await s("Page.navigate", { url });
        await loaded;
        await sleep(settle);
      },
      async eval(expr) {
        const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      async shot(path, { fullPage = false, scale = 0.6 } = {}) {
        let clip;
        if (fullPage) {
          const m = await s("Page.getLayoutMetrics");
          clip = { x: 0, y: 0, width: 1280, height: Math.min(m.cssContentSize.height, 4000), scale };
        } else clip = { x: 0, y: 0, width: 1280, height: 900, scale };
        const r = await s("Page.captureScreenshot", { format: "jpeg", quality: 55, clip, captureBeyondViewport: fullPage });
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, Buffer.from(r.data, "base64"));
      },
      close: () => send("Target.closeTarget", { targetId }),
    };
  }

  async function close() {
    try { await send("Browser.close"); } catch {}
    await sleep(800);
    try { proc.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  return { send, newPage, close, extId, exceptions, pid: proc.pid };
}
