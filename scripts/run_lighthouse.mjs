#!/usr/bin/env node

import {chromium} from "@playwright/test";
import {spawn} from "node:child_process";
import path from "node:path";

const executable = path.resolve("node_modules", ".bin", process.platform === "win32" ? "lhci.cmd" : "lhci");
const child = spawn(executable, ["autorun"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CHROME_PATH: chromium.executablePath()
  }
});

child.on("error", (error) => {
  console.error(`Unable to start Lighthouse CI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Lighthouse CI exited after signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
