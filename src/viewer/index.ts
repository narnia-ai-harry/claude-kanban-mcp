#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { loadBoardSnapshot } from "./loader.js";
import { renderViewerHtml } from "./ui.js";

interface CliOptions {
  root: string;
  port: number;
}

function parseArgs(argv: string[]): CliOptions {
  let root: string | undefined;
  let port = 4310;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --root");
      }
      root = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--port") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --port");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      port = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!root) {
    throw new Error("Missing required argument: --root");
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`--root must point to an existing directory: ${root}`);
  }

  return { root, port };
}

function usage(): string {
  return [
    "Kanban Board Viewer",
    "Usage:",
    "  npm run board -- --root /abs/path/to/project [--port 4310]",
    "",
    "Options:",
    "  --root  Required. Project root containing tickets/*.yml",
    "  --port  Optional. HTTP port (default: 4310)",
  ].join("\n");
}

function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error("");
    console.error(usage());
    process.exit(1);
    return;
  }

  const appHtml = renderViewerHtml(options.root);

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (url.pathname === "/api/board") {
      try {
        const snapshot = loadBoardSnapshot(options.root);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(snapshot));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(appHtml);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.on("error", (e) => {
    console.error(`Viewer failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`Kanban Board Viewer listening on http://127.0.0.1:${options.port}`);
    console.log(`Root: ${options.root}`);
  });
}

main();
