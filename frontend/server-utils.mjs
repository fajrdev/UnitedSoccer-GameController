/**
 * Shared Node.js server utilities for:
 *  1. Enumerating OS IPv4 network interfaces (`os.networkInterfaces()`) + computing subnet broadcast IPs
 *  2. Reading & writing `config/settings.yaml` and `config/teams.yaml` so team names, player rosters,
 *     category, and UDP network settings persist permanently across restarts and are human-editable in YAML.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function computeSubnetBroadcast(address, netmask) {
  if (!address || !netmask) return "255.255.255.255";
  const addrParts = address.split(".").map((n) => Number.parseInt(n, 10));
  const maskParts = netmask.split(".").map((n) => Number.parseInt(n, 10));
  if (addrParts.length !== 4 || maskParts.length !== 4) return "255.255.255.255";
  if (addrParts.some(Number.isNaN) || maskParts.some(Number.isNaN)) return "255.255.255.255";

  const broadcastParts = addrParts.map((a, i) => (a & maskParts[i]) | (~maskParts[i] & 0xff));
  return broadcastParts.join(".");
}

export function listNetworkInterfaces() {
  const result = [
    {
      name: "all",
      label: "All Interfaces (0.0.0.0 → 255.255.255.255)",
      address: "0.0.0.0",
      netmask: "0.0.0.0",
      cidr: "0.0.0.0/0",
      broadcastIp: "255.255.255.255",
      internal: false,
    },
  ];

  const nets = os.networkInterfaces();
  for (const [ifaceName, addrs] of Object.entries(nets)) {
    if (!Array.isArray(addrs)) continue;
    for (const info of addrs) {
      if (info.family !== "IPv4" && info.family !== 4) continue;
      const broadcastIp = info.internal
        ? "127.255.255.255"
        : computeSubnetBroadcast(info.address, info.netmask);
      result.push({
        name: ifaceName,
        label: `${ifaceName} — ${info.address} (${info.internal ? "Loopback" : `Broadcast ${broadcastIp}`})`,
        address: info.address,
        netmask: info.netmask,
        cidr: info.cidr || `${info.address}`,
        broadcastIp,
        internal: Boolean(info.internal),
      });
    }
  }
  return result;
}

/**
 * Simple, dependency-free YAML serializer & parser tailored for `config/settings.yaml` and `config/teams.yaml`.
 * Supports standard scalar key-value pairs, nested maps, and arrays of objects (`- slot: 0 ...`).
 */
function parseScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  return trimmed;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

export function parseSimpleYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, container: root, isArray: false }];

  for (let idx = 0; idx < lines.length; idx++) {
    const cleaned = stripInlineComment(lines[idx]);
    if (!cleaned.trim()) continue;

    const indent = cleaned.match(/^ */)[0].length;
    const content = cleaned.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    if (content.startsWith("- ")) {
      const rest = content.slice(2).trim();
      if (!Array.isArray(parent.container)) {
        // Convert empty object placeholder into an array on parent's owner
        if (parent.owner && parent.key) {
          parent.container = [];
          parent.owner[parent.key] = parent.container;
          parent.isArray = true;
        }
      }
      if (!Array.isArray(parent.container)) continue;

      if (rest.includes(":")) {
        const colonIdx = rest.indexOf(":");
        const k = rest.slice(0, colonIdx).trim();
        const vRaw = rest.slice(colonIdx + 1).trim();
        const itemObj = {};
        if (vRaw === "") {
          itemObj[k] = {};
        } else {
          itemObj[k] = parseScalar(vRaw);
        }
        parent.container.push(itemObj);
        stack.push({ indent: indent + 1, container: itemObj, isArray: false });
      } else {
        parent.container.push(parseScalar(rest));
      }
    } else if (content.includes(":")) {
      const colonIdx = content.indexOf(":");
      const k = content.slice(0, colonIdx).trim();
      const vRaw = content.slice(colonIdx + 1).trim();

      if (vRaw === "") {
        const childContainer = {};
        parent.container[k] = childContainer;
        stack.push({
          indent,
          container: childContainer,
          owner: parent.container,
          key: k,
          isArray: false,
        });
      } else {
        parent.container[k] = parseScalar(vRaw);
      }
    }
  }
  return root;
}

function quoteYamlString(val) {
  const s = String(val ?? "");
  if (
    s === "" ||
    s.includes(":") ||
    s.includes("#") ||
    s.includes('"') ||
    s.includes("'") ||
    /^\s|\s$/.test(s)
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function formatSettingsYaml(settings) {
  const m = settings.match || {};
  const n = settings.network || {};
  return [
    "# ============================================================================",
    "# FIRA HuroCup United Soccer GameController — Permanent Match & UDP Settings",
    "# ============================================================================",
    "# Edit this file directly or click 'Save as Permanent Default (YAML)' in the UI.",
    "#",
    "# Categories:",
    "#   - kidSize     : Official Kid-Sized (Max 5v5 + 2 Substitutes)",
    "#   - adultSize   : Official Adult-Sized (Max 3v3 + 2 Substitutes)",
    "#   - training    : Freeform Training / Lab Mode (1v1, 2v2, or any custom slot mix)",
    "# ============================================================================",
    "",
    "match:",
    `  category: ${quoteYamlString(m.category || "kidSize")}`,
    `  trainingPlayersPerTeam: ${Number.isFinite(m.trainingPlayersPerTeam) ? m.trainingPlayersPerTeam : 1}`,
    `  firstHalfKickoffSide: ${quoteYamlString(m.firstHalfKickoffSide || "left")}`,
    `  halfDurationSeconds: ${Number.isFinite(m.halfDurationSeconds) ? m.halfDurationSeconds : 600}`,
    "",
    "network:",
    `  interfaceName: ${quoteYamlString(n.interfaceName || "all")}`,
    `  interfaceAddress: ${quoteYamlString(n.interfaceAddress || "0.0.0.0")}`,
    `  broadcastIp: ${quoteYamlString(n.broadcastIp || "255.255.255.255")}`,
    `  port: ${Number.isFinite(n.port) ? n.port : 3838}`,
    `  broadcastHz: ${Number.isFinite(n.broadcastHz) ? n.broadcastHz : 2}`,
    `  simulatorEnabled: ${Boolean(n.simulatorEnabled ?? true)}`,
    "",
  ].join("\n");
}

export function formatTeamsYaml(teamsConfig) {
  const left = teamsConfig.leftTeam || {};
  const right = teamsConfig.rightTeam || {};
  const pool = Array.isArray(teamsConfig.clubPool) ? teamsConfig.clubPool : [];

  const formatSlots = (slots = []) =>
    slots
      .map(
        (s) =>
          `    - slotIndex: ${s.slotIndex}\n      originClub: ${quoteYamlString(s.originClub)}\n      robotName: ${quoteYamlString(s.robotName)}\n      role: ${quoteYamlString(s.role)}`,
      )
      .join("\n");

  const formatPool = (items = []) =>
    items
      .map(
        (p) =>
          `  - originClub: ${quoteYamlString(p.originClub)}\n    robotName: ${quoteYamlString(p.robotName)}\n    prefersGoalkeeper: ${Boolean(p.prefersGoalkeeper)}`,
      )
      .join("\n");

  return [
    "# ============================================================================",
    "# FIRA HuroCup United Soccer GameController — Permanent Teams & Rosters YAML",
    "# ============================================================================",
    "# Edit this file to permanently customize default Team Names, Robot Names,",
    "# University/Club origins, and initial roles (goalkeeper, fieldPlayer, substitute, inactive).",
    "#",
    "# Wire IDs [US-21.7]:",
    "#   - Left Defending Team  : Wire ID = slotIndex (IDs 0..10)",
    "#   - Right Defending Team : Wire ID = 16 + slotIndex (IDs 16..26)",
    "# ============================================================================",
    "",
    "leftTeam:",
    `  name: ${quoteYamlString(left.name || "United Blue (Left)")}`,
    `  color: ${quoteYamlString(left.color || "blue")}`,
    "  slots:",
    formatSlots(left.slots || []),
    "",
    "rightTeam:",
    `  name: ${quoteYamlString(right.name || "United Coral (Right)")}`,
    `  color: ${quoteYamlString(right.color || "coral")}`,
    "  slots:",
    formatSlots(right.slots || []),
    "",
    "clubPool:",
    formatPool(pool),
    "",
  ].join("\n");
}

export function loadOrInitializeYamlConfigs(repoRootDir, defaultMatchState, defaultNetworkConfig, defaultClubPool) {
  const configDir = path.join(repoRootDir, "config");
  const settingsPath = path.join(configDir, "settings.yaml");
  const teamsPath = path.join(configDir, "teams.yaml");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(settingsPath)) {
    const initialSettings = {
      match: {
        category: defaultMatchState.category || "kidSize",
        trainingPlayersPerTeam: defaultMatchState.trainingPlayersPerTeam || 1,
        firstHalfKickoffSide: defaultMatchState.firstHalfKickoffSide || "left",
        halfDurationSeconds: defaultMatchState.primarySeconds || 600,
      },
      network: {
        interfaceName: defaultNetworkConfig.interfaceName || "all",
        interfaceAddress: defaultNetworkConfig.interfaceAddress || "0.0.0.0",
        broadcastIp: defaultNetworkConfig.broadcastIp || "255.255.255.255",
        port: defaultNetworkConfig.port || 3838,
        broadcastHz: defaultNetworkConfig.broadcastHz || 2,
        simulatorEnabled: defaultNetworkConfig.simulatorEnabled ?? true,
      },
    };
    fs.writeFileSync(settingsPath, formatSettingsYaml(initialSettings), "utf8");
  }

  if (!fs.existsSync(teamsPath)) {
    const initialTeams = {
      leftTeam: {
        name: defaultMatchState.leftTeam.name,
        color: defaultMatchState.leftTeam.color,
        slots: defaultMatchState.leftTeam.slots.map((s) => ({
          slotIndex: s.slotIndex,
          originClub: s.originClub,
          robotName: s.robotName,
          role: s.role,
        })),
      },
      rightTeam: {
        name: defaultMatchState.rightTeam.name,
        color: defaultMatchState.rightTeam.color,
        slots: defaultMatchState.rightTeam.slots.map((s) => ({
          slotIndex: s.slotIndex,
          originClub: s.originClub,
          robotName: s.robotName,
          role: s.role,
        })),
      },
      clubPool: defaultClubPool,
    };
    fs.writeFileSync(teamsPath, formatTeamsYaml(initialTeams), "utf8");
  }

  let parsedSettings = {};
  let parsedTeams = {};
  try {
    parsedSettings = parseSimpleYaml(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // fallback
  }
  try {
    parsedTeams = parseSimpleYaml(fs.readFileSync(teamsPath, "utf8"));
  } catch {
    // fallback
  }

  return {
    settingsPath,
    teamsPath,
    settings: parsedSettings,
    teams: parsedTeams,
  };
}

export function saveYamlConfigs(repoRootDir, payload) {
  const configDir = path.join(repoRootDir, "config");
  const settingsPath = path.join(configDir, "settings.yaml");
  const teamsPath = path.join(configDir, "teams.yaml");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (payload.settings) {
    fs.writeFileSync(settingsPath, formatSettingsYaml(payload.settings), "utf8");
  }
  if (payload.teams) {
    fs.writeFileSync(teamsPath, formatTeamsYaml(payload.teams), "utf8");
  }

  return {
    ok: true,
    settingsPath,
    teamsPath,
  };
}
