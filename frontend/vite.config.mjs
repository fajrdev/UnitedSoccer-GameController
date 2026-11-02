import dgram from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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

/**
 * Vite plugin that provides:
 *  - Real OS-level UDP broadcast sender & listener (using `node:dgram`) with network interface selection
 *  - Permanent YAML config persistence (`config/settings.yaml` and `config/teams.yaml`)
 */
function usoccerUdpBridgePlugin() {
  let rxSocket = null;
  let txSocket = null;
  let boundPort = 3838;
  let boundInterfaceAddress = "0.0.0.0";
  const sseClients = new Set();

  function bindSockets(port, interfaceAddress = "0.0.0.0") {
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
    boundPort = port;
    boundInterfaceAddress = interfaceAddress || "0.0.0.0";

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

  return {
    name: "usoccer-udp-bridge",
    configureServer(server) {
      const defaultMatch = createInitialMatchState("kidSize", 1);
      const initialYaml = loadOrInitializeYamlConfigs(
        repoRootDir,
        defaultMatch,
        {
          interfaceName: "all",
          interfaceAddress: "0.0.0.0",
          broadcastIp: "255.255.255.255",
          port: 3838,
          broadcastHz: 2,
          simulatorEnabled: true,
        },
        DEFAULT_CLUB_POOL,
      );
      bindSockets(
        initialYaml.settings?.network?.port || 3838,
        initialYaml.settings?.network?.interfaceAddress || "0.0.0.0",
      );

      server.middlewares.use("/api/config", (req, res, next) => {
        if (req.url === "/" || req.url === "") {
          if (req.method === "GET") {
            const loaded = loadOrInitializeYamlConfigs(
              repoRootDir,
              defaultMatch,
              {
                interfaceName: "all",
                interfaceAddress: boundInterfaceAddress,
                broadcastIp: "255.255.255.255",
                port: boundPort,
                broadcastHz: 2,
                simulatorEnabled: true,
              },
              DEFAULT_CLUB_POOL,
            );
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: true,
                ...loaded,
                interfaces: listNetworkInterfaces(),
              }),
            );
            return;
          }
        }
        if (req.url === "/save" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body);
              const saved = saveYamlConfigs(repoRootDir, payload);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(saved));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: String(e) }));
            }
          });
          return;
        }
        next();
      });

      server.middlewares.use("/api/udp/events", (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ type: "connected", port: boundPort })}\n\n`);
        sseClients.add(res);
        req.on("close", () => {
          sseClients.delete(res);
        });
      });

      server.middlewares.use("/api/udp/send", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const {
              bytes,
              broadcastIp = "255.255.255.255",
              port = 3838,
              interfaceAddress = "0.0.0.0",
            } = JSON.parse(body);
            if (
              port !== boundPort ||
              interfaceAddress !== boundInterfaceAddress ||
              !rxSocket
            ) {
              bindSockets(port, interfaceAddress);
            }
            const buf = Buffer.from(bytes);
            const sender = txSocket || rxSocket;
            if (sender) {
              sender.send(buf, 0, buf.length, port, broadcastIp, (err) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: !err, error: err ? err.message : null }));
              });
            } else {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "UDP socket unavailable" }));
            }
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), usoccerUdpBridgePlugin()],
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
  build: { outDir: "build", emptyOutDir: true },
});
