#!/usr/bin/env node

import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "theme", "src");
const outputRoot = path.join(repositoryRoot, "theme", "somnus-yohaku", "assets");

const sharedOptions = {
  bundle: true,
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  charset: "utf8",
  logLevel: "info"
};

await build({
  ...sharedOptions,
  entryPoints: [
    path.join(sourceRoot, "js", "main.js"),
    path.join(sourceRoot, "js", "theme-bootstrap.js")
  ],
  outdir: path.join(outputRoot, "js"),
  entryNames: "[name]",
  format: "iife",
  platform: "browser"
});

await build({
  ...sharedOptions,
  entryPoints: [path.join(sourceRoot, "css", "screen.css")],
  outfile: path.join(outputRoot, "css", "screen.css")
});
