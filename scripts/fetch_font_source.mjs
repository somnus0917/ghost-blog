#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync, renameSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "shared/fonts/source.json"), "utf8"));
const destination = process.env.FONT_SOURCE_PATH || join(root, "build/font-source/LXGWWenKai-Regular.ttf");
const digest = (data) => createHash("sha256").update(data).digest("hex");

mkdirSync(dirname(destination), {recursive: true});
try {
  const current = readFileSync(destination);
  if (digest(current) === source.sha256) process.exit(0);
} catch {}
const response = await fetch(source.url, {signal: AbortSignal.timeout(120000)});
if (!response.ok) throw new Error(`font download failed: ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (digest(data) !== source.sha256) throw new Error("font SHA-256 mismatch");
const temporary = `${destination}.tmp`;
writeFileSync(temporary, data, {mode: 0o644});
renameSync(temporary, destination);
console.log(`downloaded LXGW WenKai ${source.version}`);
