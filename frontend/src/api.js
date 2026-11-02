import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UnitedSoccerRuntime } from "./protocol/usoccer_engine.js";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let browserRuntime = null;
const browserListeners = new Set();
let udpSseInitialized = false;
let initialConfigLoaded = false;

function notifyBrowserListeners() {
  if (!browserRuntime) return;
  const snap = browserRuntime.getSnapshot();
  for (const cb of browserListeners) {
    cb(snap);
  }
}

async function sendRealUdpViaViteBridge(bytes, networkConfig) {
  if (typeof fetch === "undefined") return;
  try {
    const res = await fetch("/api/udp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bytes: Array.from(bytes),
        broadcastIp: networkConfig.broadcastIp,
        port: networkConfig.port,
        interfaceAddress: networkConfig.interfaceAddress || "0.0.0.0",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (browserRuntime) {
        browserRuntime.lastTxError = data.ok ? null : data.error;
      }
    }
  } catch {
    // Running as static build without Vite dev middleware; ignore
  }
}

async function fetchAndApplyYamlConfig(rt) {
  if (typeof fetch === "undefined") return;
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        rt.applyYamlConfig(data);
        notifyBrowserListeners();
      }
    }
  } catch {
    // ignore if offline
  }
}

export async function savePermanentYamlConfig() {
  const rt = ensureBrowserRuntime();
  const payload = rt.exportYamlPayload();
  if (typeof fetch === "undefined") {
    return { ok: false, error: "Server unavailable" };
  }
  const res = await fetch("/api/config/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    // Refresh interfaces and paths
    await fetchAndApplyYamlConfig(rt);
  }
  return data;
}

export async function reloadFromYamlConfig() {
  const rt = ensureBrowserRuntime();
  await fetchAndApplyYamlConfig(rt);
  return rt.getSnapshot();
}

function ensureBrowserRuntime() {
  if (browserRuntime) return browserRuntime;
  browserRuntime = new UnitedSoccerRuntime("kidSize");

  if (!initialConfigLoaded) {
    initialConfigLoaded = true;
    fetchAndApplyYamlConfig(browserRuntime);
  }

  // Connect to Vite real UDP SSE listener if available
  if (typeof EventSource !== "undefined" && !udpSseInitialized) {
    udpSseInitialized = true;
    try {
      const es = new EventSource("/api/udp/events");
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "udpPacket" && Array.isArray(msg.bytes)) {
            browserRuntime.recordIncomingDatagram(new Uint8Array(msg.bytes));
            notifyBrowserListeners();
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  // 1-Hz Match Clock tick
  setInterval(() => {
    browserRuntime.tickOneSecond();
    notifyBrowserListeners();
  }, 1000);

  // 2-Hz Referee 0xADDE Broadcast loop
  setInterval(() => {
    const pktBytes = browserRuntime.buildCurrentRefereePacket(true);
    browserRuntime.recordRefereeTx(pktBytes);
    sendRealUdpViaViteBridge(pktBytes, browserRuntime.networkConfig);
    notifyBrowserListeners();
  }, 500);

  // 4-Hz Built-in Robot Packet Simulator loop
  setInterval(() => {
    if (browserRuntime.networkConfig.simulatorEnabled) {
      const pkts = browserRuntime.stepSimulator();
      for (const raw of pkts) {
        sendRealUdpViaViteBridge(raw, browserRuntime.networkConfig);
      }
      notifyBrowserListeners();
    }
  }, 250);

  return browserRuntime;
}

export async function getUiState() {
  if (isTauri()) {
    return await invoke("get_ui_state");
  }
  return ensureBrowserRuntime().getSnapshot();
}

export async function applyAction(action) {
  if (isTauri()) {
    return await invoke("apply_action", { action });
  }
  const rt = ensureBrowserRuntime();
  rt.applyAction(action);
  // Immediately broadcast updated referee packet on state transition
  const pktBytes = rt.buildCurrentRefereePacket(true);
  rt.recordRefereeTx(pktBytes);
  sendRealUdpViaViteBridge(pktBytes, rt.networkConfig);
  const snap = rt.getSnapshot();
  notifyBrowserListeners();
  return snap;
}

export async function updateNetworkConfig(config) {
  if (isTauri()) {
    return await invoke("update_network_config", { config });
  }
  const rt = ensureBrowserRuntime();
  rt.networkConfig = { ...rt.networkConfig, ...config };
  const snap = rt.getSnapshot();
  notifyBrowserListeners();
  return snap;
}

export async function stepSimulatorOnce() {
  if (isTauri()) {
    return await invoke("step_simulator_once");
  }
  const rt = ensureBrowserRuntime();
  const pkts = rt.stepSimulator();
  for (const raw of pkts) {
    sendRealUdpViaViteBridge(raw, rt.networkConfig);
  }
  const snap = rt.getSnapshot();
  notifyBrowserListeners();
  return snap;
}

export async function subscribeToState(callback) {
  if (isTauri()) {
    const unlisten = await listen("state", (event) => {
      callback(event.payload);
    });
    return unlisten;
  }
  ensureBrowserRuntime();
  browserListeners.add(callback);
  return () => {
    browserListeners.delete(callback);
  };
}
