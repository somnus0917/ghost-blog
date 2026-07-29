#!/usr/bin/env node

import {
  fontSplit as runWasmFontSplit,
  StaticWasm
} from "cn-font-split/dist/wasm/index.mjs";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, extname, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_FONT = process.env.FONT_SOURCE_PATH
  || join(REPO_ROOT, "build/font-source/LXGWWenKai-Regular.ttf");
const FONT_ENGINE = process.env.FONT_ENGINE_PATH
  || join(REPO_ROOT, "build/font-engine/cn-font-split-7.6.8.wasm");
const SOURCE_LICENSE = join(REPO_ROOT, "shared/fonts/OFL.txt");
const LOCAL_PYFTSUBSET = join(REPO_ROOT, ".venv-fonts/bin/pyftsubset");
const OUTPUT_DIR = join(
  REPO_ROOT,
  "theme/somnus-yohaku/assets/fonts/lxgw-wenkai-v2"
);
const FALLBACK_OUTPUT_DIR = join(
  REPO_ROOT,
  "shared/fonts/lxgw-wenkai-v2"
);
const FALLBACK_PUBLIC_URL = "/content/images/fonts/lxgw-wenkai-v2";
const DEFAULT_CORPUS_URL = "";
const LOCAL_TEXT_ROOTS = [
  join(REPO_ROOT, "theme/somnus-yohaku"),
  join(REPO_ROOT, "fixtures")
];
const LOCAL_TEXT_SUFFIXES = new Set([".hbs", ".js", ".json", ".md", ".yaml"]);
const REQUIRED_INTERFACE_TEXT = `
Somnus的博客 首页 博客 笔记 随笔 日记 关于 LaTeX 搜索 切换主题
最近博客 全部博客 知识笔记 加入本站 评论 注册 登录 复制文章链接
阅读最近博客 技术 工具 实验 日常 学习 项目 时间 记录
`;

async function fontSplit(config) {
  const engine = new StaticWasm(readFileSync(FONT_ENGINE));
  const normalized = {
    ...config,
    subsets: Array.isArray(config.subsets)
      ? config.subsets.map(
        (points) => new Uint8Array(new Uint32Array(points).buffer)
      )
      : config.subsets
  };
  const generated = await runWasmFontSplit(
    normalized,
    engine.WasiHandle,
    {logger() {}}
  );
  mkdirSync(config.outDir, {recursive: true});
  for (const output of generated.filter(Boolean)) {
    writeFileSync(join(config.outDir, output.name), output.data);
  }
}

function parseArguments(argv) {
  const options = {corpusUrl: DEFAULT_CORPUS_URL};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--no-public-corpus") {
      options.corpusUrl = "";
    } else if (argv[index] === "--corpus-url") {
      options.corpusUrl = argv[index + 1] || "";
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  return options;
}

function collectTextFiles(root, output = []) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectTextFiles(path, output);
    } else if (entry.isFile() && LOCAL_TEXT_SUFFIXES.has(extname(entry.name))) {
      output.push(path);
    }
  }
  return output;
}

function readLocalCorpus() {
  const parts = [REQUIRED_INTERFACE_TEXT];
  for (const root of LOCAL_TEXT_ROOTS) {
    for (const path of collectTextFiles(root).sort()) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join("\n");
}

async function readPublicCorpus(url) {
  if (!url) return "";
  const response = await fetch(url, {
    headers: {"user-agent": "somnus-webfont-builder/2.0"},
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    throw new Error(`public corpus returned ${response.status}: ${url}`);
  }
  return response.text();
}

function codePoints(value) {
  return [...new Set(Array.from(value, (character) => character.codePointAt(0)))]
    .sort((left, right) => left - right);
}

function fontCss(overrides = {}) {
  return {
    fontFamily: "LXGW WenKai Web",
    fontWeight: "400",
    fontStyle: "normal",
    fontDisplay: "swap",
    localFamily: ["LXGW WenKai", "霞鹜文楷"],
    commentBase: false,
    commentNameTable: false,
    commentUnicodes: false,
    compress: true,
    fileName: "font.css",
    ...overrides
  };
}

function listFonts(root) {
  return readdirSync(root)
    .filter((name) => name.endsWith(".woff2"))
    .sort();
}

function formatUnicodeRanges(points) {
  if (!points.length) return "";
  const ranges = [];
  let start = points[0];
  let end = points[0];
  for (const point of points.slice(1)) {
    if (point === end + 1) {
      end = point;
      continue;
    }
    ranges.push(
      start === end
        ? `U+${start.toString(16).toUpperCase()}`
        : `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`
    );
    start = point;
    end = point;
  }
  ranges.push(
    start === end
      ? `U+${start.toString(16).toUpperCase()}`
      : `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`
  );
  return ranges.join(",");
}

function excludeCodePointsFromFontCss(css, excludedPoints) {
  const excluded = new Set(excludedPoints);
  return css.replace(/@font-face\{[^}]+\}/g, (face) => {
    const declaration = face.match(/unicode-range:([^;}]+);/);
    if (!declaration) {
      throw new Error("generated fallback face is missing its unicode-range");
    }
    const retained = [];
    for (const rawToken of declaration[1].split(",")) {
      const token = rawToken.trim();
      const match = token.match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
      if (!match) {
        throw new Error(`unsupported generated unicode-range token: ${token}`);
      }
      const start = Number.parseInt(match[1], 16);
      const end = Number.parseInt(match[2] || match[1], 16);
      for (let point = start; point <= end; point += 1) {
        if (!excluded.has(point)) retained.push(point);
      }
    }
    if (!retained.length) return "";
    return face.replace(
      declaration[0],
      `unicode-range:${formatUnicodeRanges(retained)};`
    );
  });
}

function referencedFontNames(css) {
  return new Set(
    Array.from(
      css.matchAll(/url\("([^"]+\.woff2)"\)/g),
      (match) => basename(match[1])
    )
  );
}

function persistentFallbackCss(css) {
  return css.replace(
    /url\("\.\/(LXGWWenKai-Fallback-v2-[^"]+\.woff2)"\)/g,
    (_match, name) => `url("${FALLBACK_PUBLIC_URL}/${name}")`
  );
}

function readFontCodePoints(fontPath) {
  const python = existsSync(LOCAL_PYFTSUBSET)
    ? join(REPO_ROOT, ".venv-fonts/bin/python")
    : "python3";
  const result = spawnSync(
    python,
    [
      "-c",
      [
        "from fontTools.ttLib import TTFont",
        "import sys",
        "font = TTFont(sys.argv[1])",
        "points = sorted(set().union(*(set(table.cmap) for table in font['cmap'].tables)))",
        "print(','.join(str(point) for point in points))"
      ].join("; "),
      fontPath
    ],
    {encoding: "utf8"}
  );
  if (result.error?.code === "ENOENT") {
    throw new Error("Python with FontTools was not found");
  }
  if (result.status !== 0) {
    throw new Error(`failed to read subset cmap: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().split(",").filter(Boolean).map(Number);
}

function coreFontCss(fileName, points) {
  return [
    '@font-face{font-family:"LXGW WenKai Web";',
    'src:local("LXGW WenKai"),local("霞鹜文楷"),',
    `url("./${fileName}")format("woff2");`,
    "font-style:normal;font-display:swap;font-weight:400;",
    `unicode-range:${formatUnicodeRanges(points)};}`
  ].join("");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(SOURCE_FONT) || !existsSync(FONT_ENGINE) || !existsSync(SOURCE_LICENSE)) {
    throw new Error("LXGW WenKai source, font engine, or OFL license is missing");
  }

  const corpus = `${readLocalCorpus()}\n${await readPublicCorpus(options.corpusUrl)}`;
  const coreCodePoints = codePoints(corpus);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "somnus-webfont-v2-"));
  const coreDir = join(temporaryRoot, "core");
  const fallbackDir = join(temporaryRoot, "fallback");
  const assembledThemeDir = join(temporaryRoot, "theme-fonts");
  const assembledFallbackDir = join(temporaryRoot, "persistent-fonts");
  const input = new Uint8Array(readFileSync(SOURCE_FONT));

  try {
    mkdirSync(assembledThemeDir);
    mkdirSync(assembledFallbackDir);
    await fontSplit({
      input,
      outDir: coreDir,
      subsets: [coreCodePoints],
      subsetRemainChars: false,
      autoSubset: false,
      fontFeature: true,
      css: fontCss(),
      renameOutputFont: "LXGWWenKai-Core-v2.[ext]",
      testHtml: false,
      reporter: false,
      silent: true
    });

    const generatedCoreFonts = listFonts(coreDir);
    if (generatedCoreFonts.length !== 1) {
      throw new Error(`expected one generated core font, got ${generatedCoreFonts.length}`);
    }
    const coreTextFile = join(temporaryRoot, "core-characters.txt");
    writeFileSync(
      coreTextFile,
      String.fromCodePoint(...coreCodePoints),
      "utf8"
    );
    const subsetResult = spawnSync(
      existsSync(LOCAL_PYFTSUBSET) ? LOCAL_PYFTSUBSET : "pyftsubset",
      [
        SOURCE_FONT,
        `--output-file=${join(coreDir, generatedCoreFonts[0])}`,
        `--text-file=${coreTextFile}`,
        "--flavor=woff2",
        "--layout-features=*",
        "--name-IDs=*",
        "--name-languages=*",
        "--name-legacy",
        "--glyph-names",
        "--symbol-cmap",
        "--legacy-cmap",
        "--notdef-glyph",
        "--notdef-outline",
        "--recommended-glyphs"
      ],
      {encoding: "utf8"}
    );
    if (subsetResult.error?.code === "ENOENT") {
      throw new Error(
        "pyftsubset was not found; install requirements-fonts.txt in an active virtual environment"
      );
    }
    if (subsetResult.status !== 0) {
      throw new Error(`pyftsubset failed: ${subsetResult.stderr || subsetResult.stdout}`);
    }
    const coreFontCodePoints = readFontCodePoints(
      join(coreDir, generatedCoreFonts[0])
    );
    if (!coreFontCodePoints.length) {
      throw new Error("generated core font has no Unicode cmap");
    }

    await fontSplit({
      input,
      outDir: fallbackDir,
      chunkSize: 70 * 1024,
      chunkSizeTolerance: 1024,
      languageAreas: true,
      autoSubset: true,
      reduceMins: true,
      fontFeature: true,
      css: fontCss(),
      renameOutputFont: "LXGWWenKai-Fallback-v2-[hash:8].[ext]",
      testHtml: false,
      reporter: false,
      silent: true
    });

    const coreFonts = listFonts(coreDir);
    const generatedFallbackFonts = listFonts(fallbackDir);
    if (coreFonts.length !== 1) {
      throw new Error(`expected one core font, got ${coreFonts.length}`);
    }
    if (generatedFallbackFonts.length < 20) {
      throw new Error(`expected complete fallback shards, got ${generatedFallbackFonts.length}`);
    }

    cpSync(
      join(coreDir, coreFonts[0]),
      join(assembledThemeDir, coreFonts[0])
    );
    cpSync(SOURCE_LICENSE, join(assembledThemeDir, "OFL.txt"));

    const fallbackCss = persistentFallbackCss(
      excludeCodePointsFromFontCss(
        readFileSync(join(fallbackDir, "font.css"), "utf8").trim(),
        coreFontCodePoints
      )
    );
    const coreCss = coreFontCss(coreFonts[0], coreFontCodePoints);
    if (!fallbackCss.includes("unicode-range:") || !coreCss.includes("unicode-range:")) {
      throw new Error("generated font CSS is missing unicode-range declarations");
    }
    const referencedFallbackFonts = referencedFontNames(fallbackCss);
    const fallbackFonts = generatedFallbackFonts.filter((name) =>
      referencedFallbackFonts.has(name)
    );
    for (const name of fallbackFonts) {
      cpSync(join(fallbackDir, name), join(assembledFallbackDir, name));
    }
    if (fallbackFonts.length < 20) {
      throw new Error(`expected complete non-core fallback shards, got ${fallbackFonts.length}`);
    }
    writeFileSync(
      join(assembledThemeDir, "font.css"),
      [
        "/* Complete LXGW WenKai Unicode shards. Core site glyphs are last so they win overlaps. */",
        fallbackCss,
        coreCss,
        ""
      ].join("\n"),
      "utf8"
    );

    const coreBytes = statSync(join(assembledThemeDir, coreFonts[0])).size;
    const fallbackBytes = fallbackFonts.reduce(
      (total, name) => total + statSync(join(assembledFallbackDir, name)).size,
      0
    );
    const manifest = {
      schema: 1,
      generator: "cn-font-split@7.4.3",
      source: "LXGWWenKai-Regular.ttf",
      corpusUrl: options.corpusUrl || null,
      corpusCodePointCount: coreCodePoints.length,
      coreCodePointCount: coreFontCodePoints.length,
      coreFile: coreFonts[0],
      coreBytes,
      fallbackBaseUrl: FALLBACK_PUBLIC_URL,
      fallbackFileCount: fallbackFonts.length,
      fallbackBytes,
      totalFontBytes: coreBytes + fallbackBytes
    };
    writeFileSync(
      join(assembledThemeDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      join(assembledFallbackDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    rmSync(OUTPUT_DIR, {recursive: true, force: true});
    mkdirSync(dirname(OUTPUT_DIR), {recursive: true});
    renameSync(assembledThemeDir, OUTPUT_DIR);
    rmSync(FALLBACK_OUTPUT_DIR, {recursive: true, force: true});
    mkdirSync(dirname(FALLBACK_OUTPUT_DIR), {recursive: true});
    renameSync(assembledFallbackDir, FALLBACK_OUTPUT_DIR);
    console.log(
      `built complete webfont: ${coreFontCodePoints.length} supported core code points `
      + `from ${coreCodePoints.length} corpus code points, ${Math.round(coreBytes / 1024)} KiB core, `
      + `${fallbackFonts.length} fallback shards, `
      + `${(manifest.totalFontBytes / 1024 / 1024).toFixed(1)} MiB total`
    );
  } finally {
    rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
