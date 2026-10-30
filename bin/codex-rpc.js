#!/usr/bin/env node
import { main } from "../src/cli.js";
main().catch((e) => {
  console.error(`codex-rpc: ${e.message}`);
  process.exitCode = 1;
});
