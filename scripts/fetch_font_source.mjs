#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync, renameSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "shared/fonts/source.json"), "utf8"));
const digest = (data) => createHash("sha256").update(data).digest("hex");

async function fetchVerified({label, url, sha256, destination}) {
  mkdirSync(dirname(destination), {recursive: true});
  try {
    const current = readFileSync(destination);
    if (digest(current) === sha256) return;
  } catch {}
  const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`${label} download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== sha256) throw new Error(`${label} SHA-256 mismatch`);
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, data, {mode: 0o644});
  renameSync(temporary, destination);
  console.log(`downloaded ${label}`);
}

await fetchVerified({
  label: `LXGW WenKai ${source.version}`,
  url: source.url,
  sha256: source.sha256,
  destination: process.env.FONT_SOURCE_PATH
    || join(root, "build/font-source/LXGWWenKai-Regular.ttf")
});
await fetchVerified({
  label: `cn-font-split WASM ${source.engine.version}`,
  url: source.engine.url,
  sha256: source.engine.sha256,
  destination: process.env.FONT_ENGINE_PATH
    || join(root, `build/font-engine/cn-font-split-${source.engine.version}.wasm`)
});
