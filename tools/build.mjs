// Builds the publishable Chrome Web Store package into dist/.
//
// Regenerates the generated assets first, so a stale dark.css can never ship,
// then validates against the rules the Web Store actually rejects on, then zips
// only the files the manifest reaches. The file list is derived from the
// manifest rather than filtered from the directory: an allowlist can leak a
// stray file, a reachability walk cannot.
//
// Usage: node tools/build.mjs [--skip-generate]
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const DIST = join(ROOT, "dist");

const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

// ---------- 1. regenerate ----------
if (!process.argv.includes("--skip-generate")) {
  for (const script of ["generate-theme.mjs", "generate-icons.mjs"]) {
    process.stdout.write(`  running ${script} … `);
    execFileSync(process.execPath, [join(here, script)], { stdio: ["ignore", "pipe", "inherit"] });
    console.log("ok");
  }
}

// ---------- 2. validate the manifest ----------
const manifestPath = join(ROOT, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
  console.error("manifest.json is not valid JSON: " + e.message);
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!manifest.name) fail("name is required");
if (!manifest.description) fail("description is required");

// Store listing limits — exceeding either is a submission-time rejection.
if (manifest.name && manifest.name.length > 75) {
  fail(`name is ${manifest.name.length} chars; the Web Store caps it at 75`);
}
if (manifest.description && manifest.description.length > 132) {
  fail(`description is ${manifest.description.length} chars; the Web Store caps it at 132`);
}

// One to four dot-separated integers, each 0–65535, no leading zeros.
const VERSION_RE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/;
if (!VERSION_RE.test(manifest.version ?? "")) {
  fail(`version "${manifest.version}" is not a valid Web Store version string`);
} else if (manifest.version.split(".").some((p) => Number(p) > 65535)) {
  fail(`version "${manifest.version}" has a part above the 65535 maximum`);
}

// ---------- 3. walk everything the manifest can reach ----------
const shipped = new Set(["manifest.json"]);

const addRef = (ref, source) => {
  if (typeof ref !== "string" || !ref) return;
  // Packed extensions resolve against the package root; a leading slash or an
  // absolute URL means it is not a packaged file at all.
  if (/^[a-z]+:/i.test(ref)) return;
  const clean = ref.replace(/^\//, "").split(/[?#]/)[0];
  try {
    statSync(join(ROOT, clean));
  } catch {
    fail(`${source} references "${clean}", which does not exist`);
    return;
  }
  shipped.add(posix.normalize(clean));
};

for (const icon of Object.values(manifest.icons ?? {})) addRef(icon, "icons");
for (const icon of Object.values(manifest.action?.default_icon ?? {})) {
  addRef(icon, "action.default_icon");
}
for (const cs of manifest.content_scripts ?? []) {
  for (const f of cs.js ?? []) addRef(f, "content_scripts.js");
  for (const f of cs.css ?? []) addRef(f, "content_scripts.css");
}
for (const war of manifest.web_accessible_resources ?? []) {
  for (const f of war.resources ?? []) addRef(f, "web_accessible_resources");
}
addRef(manifest.background?.service_worker, "background.service_worker");

// The popup is HTML, so its own assets are only discoverable by reading it —
// which is exactly how a renamed stylesheet slips into a release unnoticed.
const popup = manifest.action?.default_popup;
if (popup) {
  addRef(popup, "action.default_popup");
  const popupDir = posix.dirname(popup);
  let html = "";
  try {
    html = readFileSync(join(ROOT, popup), "utf8");
  } catch {
    /* addRef already recorded the missing file */
  }
  for (const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = m[1];
    if (/^[a-z]+:/i.test(ref) || ref.startsWith("#")) continue;
    addRef(ref.startsWith("/") ? ref : posix.join(popupDir, ref), popup);
  }
}

// ---------- 4. report anything present but unreachable ----------
// store/ and screenshots/ hold listing assets; tools/ and dist/ are build-time.
// None are packaged, and none are worth reporting as "unreachable".
const NON_SHIPPING = new Set([
  "tools", "dist", "store", "screenshots", ".git", ".github", "node_modules",
]);
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || NON_SHIPPING.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const rel = relative(ROOT, full).split(sep).join("/");
      if (rel !== "README.md" && !shipped.has(rel)) warn(`${rel} is unreachable from the manifest and will not ship`);
    }
  }
};
walk(ROOT);

if (problems.length) {
  console.error("\nBuild failed:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}

// ---------- 5. zip ----------
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Fixed 1980-01-01 stamp (the ZIP epoch) so identical sources produce a
// byte-identical package; a build timestamp would make every zip differ.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const compressed = deflateRawSync(data, { level: 9 });
    // Deflate can exceed the input on tiny or already-compressed files.
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(name, "utf8");
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    // Regular file, mode 0644. The >>>0 matters: << is signed 32-bit in JS and
    // this value overflows into a negative number without it.
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

// Sorted so the archive order is stable across platforms and runs.
const files = [...shipped].sort().map((name) => ({ name, data: readFileSync(join(ROOT, name)) }));

const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outName = `${slug}-${manifest.version}.zip`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
const outPath = join(DIST, outName);
writeFileSync(outPath, zip(files));

// ---------- 6. report ----------
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`\n${manifest.name} ${manifest.version}`);
console.log(`${files.length} files, manifest.json at the package root:\n`);
for (const f of files) console.log(`  ${f.name.padEnd(24)} ${kb(f.data.length).padStart(10)}`);
console.log(`\n→ dist/${outName}  (${kb(statSync(outPath).size)})`);

for (const w of warnings) console.log(`\n  note: ${w}`);
console.log("\nUpload at https://chrome.google.com/webstore/devconsole");
