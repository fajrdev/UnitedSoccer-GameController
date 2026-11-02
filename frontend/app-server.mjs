#!/usr/bin/env node
/**
 * Standalone Production Server + Real OS UDP [US-21] `0xADDE` Broadcast Bridge
 * + Network Interface Discovery + Permanent `config/settings.yaml` & `config/teams.yaml` Storage
 * for the FIRA HuroCup United Soccer GameController desktop executable (`./GameController`).
 */

import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listNetworkInterfaces,
  loadOrInitializeYamlConfigs,
  saveYamlConfigs,
} from "./server-utils.mjs";
import {
  createInitialMatchState,
  DEFAULT_CLUB_POOL,
} from "./src/protocol/usoccer_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(__dirname, "..");
const buildDir = path.join(__dirname, "build");

const defaultMatch = createInitialMatchState("kidSize", 1);
const initialYaml = loadOrInitializeYamlConfigs(
  repoRootDir,
  defaultMatch,
  {
    interfaceName: "all",
    interfaceAddress: "0.0.0.0",
    broadcastIp: process.env.USOCCER_BROADCAST_IP || "255.255.255.255",
    port: Number.parseInt(process.env.USOCCER_UDP_PORT || "3838", 10) || 3838,
    broadcastHz: 2,
    simulatorEnabled: true,
  },
  DEFAULT_CLUB_POOL,
);

const defaultUdpPort =
  Number.parseInt(
    process.env.USOCCER_UDP_PORT || String(initialYaml.settings?.network?.port || 3838),
    10,
  ) || 3838;
const defaultBroadcastIp =
  process.env.USOCCER_BROADCAST_IP ||
  initialYaml.settings?.network?.broadcastIp ||
  "255.255.255.255";
const defaultInterfaceAddress =
  initialYaml.settings?.network?.interfaceAddress || "0.0.0.0";
const requestedHttpPort = Number.parseInt(process.env.USOCCER_HTTP_PORT || "0", 10) || 0;

let rxSocket = null;
let txSocket = null;
let boundUdpPort = defaultUdpPort;
let boundInterfaceAddress = defaultInterfaceAddress;
const sseClients = new Set();

function bindUdpSockets(port, interfaceAddress = "0.0.0.0") {
  for (const s of [rxSocket, txSocket]) {
    if (s) {
      try {
        s.close();
      } catch {
        // ignore
      }
    }
  }
  rxSocket = null;
  txSocket = null;
  boundUdpPort = port;
  boundInterfaceAddress = interfaceAddress || "0.0.0.0";

  // 1. RX socket bound to 0.0.0.0:port so incoming broadcast/unicast packets arrive on Linux/macOS
  try {
    const rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
    rx.on("error", (err) => {
      const msg = JSON.stringify({ type: "udpError", error: err.message });
      for (const res of sseClients) {
        res.write(`data: ${msg}\n\n`);
      }
    });
    rx.on("message", (msg, rinfo) => {
      const bytes = Array.from(msg);
      const payload = JSON.stringify({
        type: "udpPacket",
        bytes,
        address: rinfo.address,
        port: rinfo.port,
      });
      for (const res of sseClients) {
        res.write(`data: ${payload}\n\n`);
      }
    });
    rx.bind(port, "0.0.0.0", () => {
      try {
        rx.setBroadcast(true);
      } catch {
        // ignore
      }
    });
    rxSocket = rx;
  } catch {
    // ignore bind error
  }

  // 2. TX socket bound to the selected interface IPv4 address (e.g., wlan0 IP or eth0 IP)
  // so outgoing broadcast datagrams exit through the chosen network interface when connected to multiple networks.
  if (boundInterfaceAddress && boundInterfaceAddress !== "0.0.0.0") {
    try {
      const tx = dgram.createSocket({ type: "udp4", reuseAddr: true });
      tx.on("error", () => {});
      tx.bind(0, boundInterfaceAddress, () => {
        try {
          tx.setBroadcast(true);
        } catch {
          // ignore
        }
      });
      txSocket = tx;
    } catch {
      txSocket = null;
    }
  }
}

bindUdpSockets(boundUdpPort, boundInterfaceAddress);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (url.pathname === "/api/config" && req.method === "GET") {
    const loaded = loadOrInitializeYamlConfigs(
      repoRootDir,
      defaultMatch,
      {
        interfaceName: "all",
        interfaceAddress: boundInterfaceAddress,
        broadcastIp: defaultBroadcastIp,
        port: boundUdpPort,
        broadcastHz: 2,
        simulatorEnabled: true,
      },
      DEFAULT_CLUB_POOL,
    );
    const interfaces = listNetworkInterfaces();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        ...loaded,
        interfaces,
      }),
    );
    return;
  }

  if (url.pathname === "/api/config/save" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const saved = saveYamlConfigs(repoRootDir, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(saved));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  if (url.pathname === "/api/udp/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        port: boundUdpPort,
        broadcastIp: defaultBroadcastIp,
        interfaceAddress: boundInterfaceAddress,
      })}\n\n`,
    );
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  if (url.pathname === "/api/udp/send" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const {
          bytes,
          broadcastIp = defaultBroadcastIp,
          port = boundUdpPort,
          interfaceAddress = boundInterfaceAddress,
        } = JSON.parse(body);
        if (
          port !== boundUdpPort ||
          interfaceAddress !== boundInterfaceAddress ||
          !rxSocket
        ) {
          bindUdpSockets(port, interfaceAddress);
        }
        const buf = Buffer.from(bytes);
        const sender = txSocket || rxSocket;
        if (sender) {
          sender.send(buf, 0, buf.length, port, broadcastIp, (err) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: !err, error: err ? err.message : null }));
          });
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "UDP socket unavailable" }));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Serve static files from frontend/build
  let filePath = path.join(buildDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(buildDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(buildDir, "index.html");
  }

  try {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(requestedHttpPort, "127.0.0.1", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedHttpPort;
  process.stdout.write(`READY_URL=http://127.0.0.1:${actualPort}\n`);
});

function shutdown() {
  for (const s of [rxSocket, txSocket]) {
    if (s) {
      try {
        s.close();
      } catch {
        // ignore
      }
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
