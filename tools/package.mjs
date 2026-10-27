// Packs the files the extension needs at runtime into dist/clearpane-<version>.zip
// for the Chrome Web Store / Edge Add-ons. No dependencies: the zip is written
// with Node's own zlib (deflate + crc32, Node 22+).
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md',
  'src', 'popup', 'icons', 'redirects', 'rulesets', 'data', 'scriptlets'];
// Source-only: lib.js is inlined into every scriptlets/shard-*.js at build time.
const EXCLUDE = new Set(['src/scriptlets/lib.js']);

async function listFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const entries = await readdir(path);
  const nested = await Promise.all(entries.sort().map(name => listFiles(join(path, name))));
  return nested.flat();
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Builds a zip archive from [{ name, data }] using deflate. */
function buildZip(files) {
  const { time, day } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 names
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function main() {
  if (typeof zlib.crc32 !== 'function') throw new Error('Node 22 or newer is needed (zlib.crc32).');
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const paths = (await Promise.all(INCLUDE.map(p => listFiles(join(ROOT, p))))).flat();
  const files = [];
  for (const path of paths) {
    const name = relative(ROOT, path).split(sep).join('/');
    if (EXCLUDE.has(name)) continue;
    files.push({ name, data: await readFile(path) });
  }
  // Fail early on things the stores reject.
  for (const r of manifest.declarative_net_request.rule_resources) {
    if (!files.some(f => f.name === r.path)) throw new Error(`missing ruleset ${r.path}; run node tools/build.mjs`);
  }
  const zip = buildZip(files);
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  const out = join(ROOT, 'dist', `clearpane-${manifest.version}.zip`);
  await writeFile(out, zip);
  const rawSize = files.reduce((n, f) => n + f.data.length, 0);
  console.log(`${files.length} files, ${(rawSize / 1e6).toFixed(1)} MB -> ${relative(ROOT, out)} (${(zip.length / 1e6).toFixed(1)} MB)`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
