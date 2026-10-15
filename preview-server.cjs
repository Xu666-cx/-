"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const htmlPath = path.join(__dirname, "index.html");
const envPath = path.join(__dirname, ".env");

function readLocalEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const key = line.slice(0, separator).trim();
          let value = line.slice(separator + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return [key, value];
        })
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

const localEnv = readLocalEnv();
const configuredValue = (key) => (Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : localEnv[key]) || "";
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";
const appId = configuredValue("XMOV_APP_ID").trim();
const appSecret = configuredValue("XMOV_APP_SECRET").trim();
const configured = Boolean(appId && appSecret);

function json(response, value) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  // The demo credential endpoint is only for a loopback-bound local review environment.
  const requestHost = String(request.headers.host || "").toLowerCase().split(":")[0];
  if (requestHost !== "localhost" && requestHost !== "127.0.0.1") {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Local access only");
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET" });
    response.end("Method not allowed");
    return;
  }
  const pathname = new URL(request.url, "http://localhost:8765").pathname;
  if (pathname === "/healthz") {
    json(response, { status: "ok", credentialsConfigured: configured });
    return;
  }
  if (pathname === "/runtime-config") {
    json(response, configured ? { configured: true, appId, appSecret } : { configured: false });
    return;
  }
  if (pathname !== "/" && pathname !== "/index.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  fs.readFile(htmlPath, (error, content) => {
    if (error) { response.writeHead(500); response.end("Unable to load preview page"); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(content);
  });
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use.` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Preview is ready on ${host}:${port}`);
  console.log("Keep this window open. Press Ctrl+C to stop.");
});
