/**
 * Isomorphic FIRA HuroCup United Soccer Game Engine, [US-19]/[US-20] Individual Scoring &
 * Tiebreaker Calculator, [US-3.6] Bandwidth Compliance Monitor, and [US-21] Robot Simulator.
 */

import {
  createRefereeStatePacket,
  decodeUsoccerPacket,
  encodeUsoccerPacket,
  formatHex,
  REFEREE_ID,
  WIRE_STATE_LABELS,
  WireGameState,
} from "./usoccer_protocol.js";

export const REMOVAL_PENALTY_SECS = 30;
export const READY_PHASE_SECS = 10;
export const SET_PHASE_SECS = 10;
export const KICKOFF_RESTRICTION_SECS = 10;
export const TIMEOUT_SECS = 120;
export const MAX_ROBOT_BYTES_PER_SEC = 10240; // 10 KB/s [US-3.6]
export const MAX_ROBOT_MSGS_PER_SEC = 30; // 30 msg/s [US-3.6]

export const REMOVAL_PENALTY_REASONS = [
  {
    id: "handArmManipulation",
    rule: "[US-15.1]",
    shortLabel: "Hand / Arm Foul",
    label: "[US-15.1] Hand, Arm, or Shoulder Manipulation (Non-GK)",
  },
  {
    id: "ballHolding",
    rule: "[US-15.2]",
    shortLabel: "Ball Holding",
    label: "[US-15.2] Ball Holding (>1s Field Player / >6s Goalkeeper)",
  },
  {
    id: "physicalContactOrCollision",
    rule: "[US-15.3]",
    shortLabel: "Collision / Contact",
    label: "[US-15.3] Collision or Touching GK in Goal Area",
  },
  {
    id: "fallen30sOrHandlerRemoval",
    rule: "[US-15.4]",
    shortLabel: "Fallen >30s / Handler",
    label: "[US-15.4] Unable to Stand Within 30s / Handler Removal Request",
  },
  {
    id: "chargingWithForce",
    rule: "[US-15.5]",
    shortLabel: "Charging Force",
    label: "[US-15.5] Charging Another Robot with Significant Force",
  },
  {
    id: "goalLineBlocking",
    rule: "[US-15.6]",
    shortLabel: "Goal Line Block >15s",
    label: "[US-15.6] Blocking >50% of Goal Line for >15 Seconds",
  },
  {
    id: "passingPoleDoubleTouch",
    rule: "[US-15.7]",
    shortLabel: "Pole Double-Touch",
    label: "[US-15.7] Double-Touch After Passing Pole Kick (<30cm)",
  },
  {
    id: "touchingPassingMarker",
    rule: "[US-15.8]",
    shortLabel: "Touched Passing Pole",
    label: "[US-15.8] Touching Any of the 6 Passing Markers",
  },
  {
    id: "handlerInterference",
    rule: "[US-15.9]",
    shortLabel: "Handler Interference",
    label: "[US-15.9] Robot Handler Entered Field / Interfered",
  },
  {
    id: "incapableOfPlay",
    rule: "[US-4.2]",
    shortLabel: "Incapable Robot",
    label: "[US-4.2] Incapable of Walking Stably for >= 1 Meter",
  },
];

export const CARD_OFFENCES = [
  { id: "pushingOpponent", label: "[US-14.1.1] Pushing an Opponent" },
  { id: "holdingOpponent", label: "[US-14.1.2] Holding an Opponent" },
  { id: "strikingOpponent", label: "[US-14.1.3] Striking / Attempting to Strike" },
  { id: "chargingOpponent", label: "[US-14.1.4] Charging an Opponent" },
  { id: "damagingRobot", label: "[US-14.1.5] Damaging / Likely Damaging Robot" },
  { id: "unsportingBehaviour", label: "[US-14.1.6] Unsporting Behaviour" },
  { id: "damagingFieldOrBall", label: "[US-14.1.7] Modifying / Damaging Field, Goal, or Ball" },
  { id: "persistentInfringement", label: "[US-14.1.8] Persistent Infringement of Laws" },
];

export const DEFAULT_CLUB_POOL = [
  { originClub: "NTNU ERC (Taiwan)", robotName: "HuroBot-Alpha", prefersGoalkeeper: true },
  { originClub: "TKU Robotics (Taiwan)", robotName: "TKU-Striker", prefersGoalkeeper: false },
  { originClub: "ITS Surabaya (Indonesia)", robotName: "Ichiro-Wing", prefersGoalkeeper: false },
  { originClub: "KAIST Humanoid (Korea)", robotName: "Hubo-Mid", prefersGoalkeeper: false },
  { originClub: "Univ. Manitoba (Canada)", robotName: "Autonomous-5", prefersGoalkeeper: false },
  { originClub: "TU Dortmund (Germany)", robotName: "WalkMan-GK", prefersGoalkeeper: true },
  { originClub: "POSTECH (Korea)", robotName: "Pohang-Forward", prefersGoalkeeper: false },
  { originClub: "NTU Singapore", robotName: "Merlion-Bot", prefersGoalkeeper: false },
  { originClub: "Kyutech (Japan)", robotName: "Hibikino-4", prefersGoalkeeper: false },
  { originClub: "UI Indonesia", robotName: "Garuda-5", prefersGoalkeeper: false },
  { originClub: "NCKU Lab (Taiwan)", robotName: "ChengKung-Sub1", prefersGoalkeeper: false },
  { originClub: "Unicamp (Brazil)", robotName: "BrasilBot-Sub2", prefersGoalkeeper: false },
  { originClub: "UTM Malaysia", robotName: "Harimau-Sub1", prefersGoalkeeper: false },
  { originClub: "SNU Korea", robotName: "Seoul-Sub2", prefersGoalkeeper: false },
];

export function createEmptyScore() {
  return {
    goalsScored: 0, // +10
    teammateGoals: 0, // +2
    opponentGoals: 0, // -2
    savesMade: 0, // +7
    passingPoleKicks: 0, // +2
    removalPenalties: 0, // -1
    manualAdjustment: 0,
  };
}

export function computeIndividualPoints(score) {
  const positivePoints =
    score.goalsScored * 10 +
    score.teammateGoals * 2 +
    score.savesMade * 7 +
    score.passingPoleKicks * 2 +
    Math.max(0, score.manualAdjustment);
  const negativePoints =
    score.opponentGoals * 2 +
    score.removalPenalties * 1 +
    Math.max(0, -score.manualAdjustment);
  const rawTotal = positivePoints - negativePoints;
  // [US-19.2]: "Any robot that has achieved less than one point is awarded no rank and 0 points."
  const officialPoints = rawTotal < 1 ? 0 : rawTotal;
  return { positivePoints, negativePoints, rawTotal, officialPoints, isRanked: rawTotal >= 1 };
}

function createTeamSlots(clubs, maxActive) {
  const slots = [];
  for (let idx = 0; idx <= 10; idx++) {
    const entry = clubs[idx] || {
      originClub: "Reserve Club",
      robotName: `Unit-${idx}`,
    };
    let role = "inactive";
    if (entry.role) {
      role = entry.role;
    } else if (idx === 0 && maxActive >= 1) {
      role = "goalkeeper";
    } else if (idx < maxActive) {
      role = "fieldPlayer";
    } else if (idx < maxActive + 2) {
      role = "substitute";
    }

    slots.push({
      slotIndex: idx,
      originClub: entry.originClub,
      robotName: entry.robotName,
      role,
      removalPenalty: null,
      penaltyRemainingSecs: 0,
      penaltyTimerRunning: false,
      yellowCards: 0,
      redCard: false,
      lastCardOffence: null,
      score: createEmptyScore(),
    });
  }
  return slots;
}

export function baseMaxPlayersForCategory(category, trainingPlayersPerTeam = 1) {
  if (category === "training") {
    return Math.max(1, Math.min(11, Number(trainingPlayersPerTeam) || 11));
  }
  if (category === "adultSize") {
    return 3;
  }
  return 5;
}

export function createInitialMatchState(category = "kidSize", trainingPlayersPerTeam = 1) {
  const maxActive = baseMaxPlayersForCategory(category, trainingPlayersPerTeam);
  const leftClubs = [
    DEFAULT_CLUB_POOL[0],
    DEFAULT_CLUB_POOL[1],
    DEFAULT_CLUB_POOL[2],
    DEFAULT_CLUB_POOL[3],
    DEFAULT_CLUB_POOL[4],
    DEFAULT_CLUB_POOL[10],
    DEFAULT_CLUB_POOL[11],
  ];
  const rightClubs = [
    DEFAULT_CLUB_POOL[5],
    DEFAULT_CLUB_POOL[6],
    DEFAULT_CLUB_POOL[7],
    DEFAULT_CLUB_POOL[8],
    DEFAULT_CLUB_POOL[9],
    DEFAULT_CLUB_POOL[12],
    DEFAULT_CLUB_POOL[13],
  ];

  return {
    category,
    trainingPlayersPerTeam: Math.max(1, Math.min(11, Number(trainingPlayersPerTeam) || 1)),
    phase: "firstHalf",
    stage: { stage: "stopped" },
    nextKickoffSide: "left",
    firstHalfKickoffSide: "left",
    primarySeconds: 600, // 10 minutes [US-8.3]
    secondarySeconds: 0,
    refereeSequenceNumber: 0,
    leftTeam: {
      name: "United Cyan (Left)",
      color: "cyan",
      goals: 0,
      timeoutsRemaining: 2,
      substitutionsRemaining: category === "training" ? 99 : 2,
      teamYellowCards: 0,
      teamRedCards: 0,
      shootoutAttempts: 0,
      shootoutGoals: 0,
      slots: createTeamSlots(leftClubs, maxActive),
    },
    rightTeam: {
      name: "United Rose (Right)",
      color: "rose",
      goals: 0,
      timeoutsRemaining: 2,
      substitutionsRemaining: category === "training" ? 99 : 2,
      teamYellowCards: 0,
      teamRedCards: 0,
      shootoutAttempts: 0,
      shootoutGoals: 0,
      slots: createTeamSlots(rightClubs, maxActive),
    },
    passingMarkersMm: [
      [2200, 1200],
      [2200, 3800],
      [3500, 900],
      [3500, 4100],
      [4800, 1200],
      [4800, 3800],
    ],
    matchLog: [
      {
        id: 1,
        phase: "firstHalf",
        remainingSeconds: 600,
        summary:
          "Match initialized. Teams must demonstrate referee box listener compliance before start.",
        ruleRef: "[US-5.2]",
      },
    ],
    nextLogId: 2,
  };
}

export function effectiveMaxPlayers(team, category, trainingPlayersPerTeam = 11) {
  if (category === "training") {
    // Freeform Training Mode: do not lock active field players to 5v5 or 3v3; allow up to 11 slots
    const activeConfigured = team.slots.filter(
      (s) => (s.role === "goalkeeper" || s.role === "fieldPlayer") && !s.redCard,
    ).length;
    const base = Math.max(activeConfigured, Number(trainingPlayersPerTeam) || 1);
    const reduction = Math.floor(team.teamYellowCards / 2);
    return Math.max(1, base - reduction);
  }
  const base = category === "adultSize" ? 3 : 5;
  // [US-14.2]: "The number of players on the team is reduced by one after every two yellow cards."
  const reduction = Math.floor(team.teamYellowCards / 2);
  return Math.max(1, base - reduction);
}

export function computeTeamBitmask(team, category, trainingPlayersPerTeam = 11) {
  const maxAllowed = effectiveMaxPlayers(team, category, trainingPlayersPerTeam);
  let activeCount = 0;
  let mask = 0;
  for (const slot of team.slots) {
    const isOnField = slot.role === "goalkeeper" || slot.role === "fieldPlayer";
    if (isOnField && !slot.redCard) {
      if (activeCount < maxAllowed && !slot.removalPenalty) {
        mask |= 1 << slot.slotIndex;
      }
      activeCount++;
    }
  }
  return mask & 0xffff;
}

export function computeWireGameState(matchState) {
  const st = matchState.stage;
  switch (st.stage) {
    case "stopped":
    case "ready":
    case "timeout":
    case "finished":
      return WireGameState.STOPPED;
    case "set":
      if (st.restart?.type === "kickOff" && st.restart.side === "right") {
        return WireGameState.SET_KICKOFF_RIGHT;
      }
      if (st.restart?.type === "penaltyKick" && st.restart.side === "right") {
        return WireGameState.SET_KICKOFF_RIGHT;
      }
      return WireGameState.SET_KICKOFF_LEFT;
    case "playKickOff":
      return st.kickingSide === "right"
        ? WireGameState.PLAY_KICKOFF_RIGHT
        : WireGameState.PLAY_KICKOFF_LEFT;
    case "playBallInPlay":
      return WireGameState.PLAY_BALL_IN_PLAY;
    default:
      return WireGameState.STOPPED;
  }
}

export function computeLeaderboard(matchState) {
  const entries = [];
  for (const [side, team] of [
    ["left", matchState.leftTeam],
    ["right", matchState.rightTeam],
  ]) {
    const baseId = side === "left" ? 0 : 16;
    for (const slot of team.slots) {
      if (slot.role === "inactive") continue;
      const pts = computeIndividualPoints(slot.score);
      entries.push({
        rank: null,
        requiresShootoutTiebreak: false,
        side,
        wireRobotId: baseId + slot.slotIndex,
        slotIndex: slot.slotIndex,
        teamName: team.name,
        originClub: slot.originClub,
        robotName: slot.robotName,
        role: slot.role,
        score: { ...slot.score },
        rawTotal: pts.rawTotal,
        officialPoints: pts.officialPoints,
        positivePoints: pts.positivePoints,
        negativePoints: pts.negativePoints,
      });
    }
  }

  // Sort per [US-19.3], [US-19.4], [US-20.1], [US-20.2]:
  // 1. officialPoints descending
  // 2. goalsScored descending [US-20.1]
  // 3. savesMade descending [US-19.4]
  // 4. positivePoints descending (points after removing negative points [US-20.2])
  // 5. rawTotal descending
  entries.sort((a, b) => {
    if (b.officialPoints !== a.officialPoints) return b.officialPoints - a.officialPoints;
    if (b.score.goalsScored !== a.score.goalsScored)
      return b.score.goalsScored - a.score.goalsScored;
    if (b.score.savesMade !== a.score.savesMade) return b.score.savesMade - a.score.savesMade;
    if (b.positivePoints !== a.positivePoints) return b.positivePoints - a.positivePoints;
    if (b.rawTotal !== a.rawTotal) return b.rawTotal - a.rawTotal;
    return a.wireRobotId - b.wireRobotId;
  });

  let currentRank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].rawTotal < 1) {
      entries[i].rank = null;
      continue;
    }
    if (i > 0 && entries[i - 1].rawTotal >= 1) {
      const prev = entries[i - 1];
      const curr = entries[i];
      const exactTie =
        prev.officialPoints === curr.officialPoints &&
        prev.score.goalsScored === curr.score.goalsScored &&
        prev.score.savesMade === curr.score.savesMade &&
        prev.positivePoints === curr.positivePoints;
      if (exactTie) {
        curr.rank = prev.rank;
        curr.requiresShootoutTiebreak = true;
        prev.requiresShootoutTiebreak = true;
      } else {
        currentRank = i + 1;
        curr.rank = currentRank;
      }
    } else {
      entries[i].rank = currentRank;
    }
  }

  return entries;
}

function pushLog(state, summary, ruleRef) {
  state.matchLog.unshift({
    id: state.nextLogId++,
    phase: state.phase,
    remainingSeconds: state.primarySeconds,
    summary,
    ruleRef,
  });
  if (state.matchLog.length > 100) {
    state.matchLog.length = 100;
  }
}

export function restartLabel(restart) {
  if (!restart) return "Kick-Off";
  if (restart.type === "kickOff") {
    return `Kick-Off (${restart.side === "left" ? "Left Team" : "Right Team"}) [US-9]`;
  }
  if (restart.type === "droppedBall") {
    return "Dropped Ball [US-10]";
  }
  if (restart.type === "penaltyKick") {
    return `Penalty Kick (${restart.side === "left" ? "Left Attacking" : "Right Attacking"}) [US-17]`;
  }
  return "Restart";
}

export class UnitedSoccerRuntime {
  constructor(category = "kidSize") {
    this.state = createInitialMatchState(category);
    this.undoStack = [];
    this.networkConfig = {
      interfaceName: "all",
      interfaceAddress: "0.0.0.0",
      broadcastIp: "255.255.255.255",
      port: 3838,
      broadcastHz: 2,
      simulatorEnabled: true,
    };
    this.networkInterfaces = [];
    this.yamlPaths = {
      settingsPath: "config/settings.yaml",
      teamsPath: "config/teams.yaml",
    };
    this.customClubPool = [...DEFAULT_CLUB_POOL];
    this.totalRefereePacketsSent = 0;
    this.lastRefereePacketHex = "";
    this.lastTxError = null;
    this.recentPackets = [];
    this.nextPacketId = 1;
    this.robotsMap = new Map();
    this.simTick = 0;
    this.simBall = { x: 3500, y: 2500, vx: 135, vy: 90 };
    this.simSeq = new Map();

    // Generate initial referee packet preview
    const pktBytes = this.buildCurrentRefereePacket(false);
    this.recordRefereeTx(pktBytes);
  }

  applyYamlConfig({ settings, teams, interfaces, settingsPath, teamsPath }) {
    if (Array.isArray(interfaces)) {
      this.networkInterfaces = interfaces;
    }
    if (settingsPath || teamsPath) {
      this.yamlPaths = {
        settingsPath: settingsPath || this.yamlPaths.settingsPath,
        teamsPath: teamsPath || this.yamlPaths.teamsPath,
      };
    }
    if (settings?.network) {
      const n = settings.network;
      this.networkConfig = {
        ...this.networkConfig,
        interfaceName: n.interfaceName || this.networkConfig.interfaceName || "all",
        interfaceAddress: n.interfaceAddress || this.networkConfig.interfaceAddress || "0.0.0.0",
        broadcastIp: n.broadcastIp || this.networkConfig.broadcastIp,
        port: Number(n.port) || this.networkConfig.port,
        broadcastHz: Number(n.broadcastHz) || this.networkConfig.broadcastHz,
        simulatorEnabled:
          typeof n.simulatorEnabled === "boolean"
            ? n.simulatorEnabled
            : this.networkConfig.simulatorEnabled,
      };
    }
    if (settings?.match) {
      const m = settings.match;
      if (m.category) this.state.category = m.category;
      if (Number.isFinite(Number(m.trainingPlayersPerTeam))) {
        this.state.trainingPlayersPerTeam = Math.max(
          1,
          Math.min(11, Number(m.trainingPlayersPerTeam)),
        );
      }
      if (m.firstHalfKickoffSide) {
        this.state.firstHalfKickoffSide = m.firstHalfKickoffSide;
        this.state.nextKickoffSide = m.firstHalfKickoffSide;
      }
      if (Number.isFinite(Number(m.halfDurationSeconds)) && Number(m.halfDurationSeconds) > 0) {
        this.state.primarySeconds = Number(m.halfDurationSeconds);
      }
      this.state.leftTeam.substitutionsRemaining = this.state.category === "training" ? 99 : 2;
      this.state.rightTeam.substitutionsRemaining = this.state.category === "training" ? 99 : 2;
    }
    if (teams) {
      if (Array.isArray(teams.clubPool) && teams.clubPool.length > 0) {
        this.customClubPool = teams.clubPool;
      }
      for (const [sideKey, teamState] of [
        ["leftTeam", this.state.leftTeam],
        ["rightTeam", this.state.rightTeam],
      ]) {
        const yTeam = teams[sideKey];
        if (!yTeam) continue;
        if (yTeam.name) teamState.name = yTeam.name;
        if (yTeam.color) teamState.color = yTeam.color;
        if (Array.isArray(yTeam.slots)) {
          for (const ys of yTeam.slots) {
            const idx = Number(ys.slotIndex);
            if (idx >= 0 && idx <= 10 && teamState.slots[idx]) {
              teamState.slots[idx] = {
                ...teamState.slots[idx],
                originClub: ys.originClub ?? teamState.slots[idx].originClub,
                robotName: ys.robotName ?? teamState.slots[idx].robotName,
                role: ys.role ?? teamState.slots[idx].role,
              };
            }
          }
        }
      }
    }
    pushLog(
      this.state,
      "Loaded permanent match, roster, and UDP configuration from config/settings.yaml & config/teams.yaml.",
      "[YAML Config]",
    );
  }

  exportYamlPayload() {
    return {
      settings: {
        match: {
          category: this.state.category,
          trainingPlayersPerTeam: this.state.trainingPlayersPerTeam || 1,
          firstHalfKickoffSide: this.state.firstHalfKickoffSide,
          halfDurationSeconds: this.state.primarySeconds || 600,
        },
        network: {
          interfaceName: this.networkConfig.interfaceName || "all",
          interfaceAddress: this.networkConfig.interfaceAddress || "0.0.0.0",
          broadcastIp: this.networkConfig.broadcastIp || "255.255.255.255",
          port: this.networkConfig.port || 3838,
          broadcastHz: this.networkConfig.broadcastHz || 2,
          simulatorEnabled: Boolean(this.networkConfig.simulatorEnabled),
        },
      },
      teams: {
        leftTeam: {
          name: this.state.leftTeam.name,
          color: this.state.leftTeam.color,
          slots: this.state.leftTeam.slots.map((s) => ({
            slotIndex: s.slotIndex,
            originClub: s.originClub,
            robotName: s.robotName,
            role: s.role,
          })),
        },
        rightTeam: {
          name: this.state.rightTeam.name,
          color: this.state.rightTeam.color,
          slots: this.state.rightTeam.slots.map((s) => ({
            slotIndex: s.slotIndex,
            originClub: s.originClub,
            robotName: s.robotName,
            role: s.role,
          })),
        },
        clubPool: this.customClubPool,
      },
    };
  }

  saveUndo(label) {
    this.undoStack.push({
      label,
      snapshot: structuredClone(this.state),
    });
    if (this.undoStack.length > 25) {
      this.undoStack.shift();
    }
  }

  buildCurrentRefereePacket(incrementSeq = true) {
    const seq = this.state.refereeSequenceNumber;
    if (incrementSeq) {
      this.state.refereeSequenceNumber = (seq + 1) & 0xffff;
    }
    const leftMask = computeTeamBitmask(
      this.state.leftTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const rightMask = computeTeamBitmask(
      this.state.rightTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const wireState = computeWireGameState(this.state);
    return createRefereeStatePacket({
      sequenceNumber: seq,
      teamLeftBitmask: leftMask,
      teamRightBitmask: rightMask,
      remainingSeconds: this.state.primarySeconds,
      state: wireState,
    });
  }

  recordRefereeTx(rawBytes) {
    this.totalRefereePacketsSent++;
    const hex = formatHex(rawBytes);
    this.lastRefereePacketHex = hex;
    const decoded = decodeUsoccerPacket(rawBytes);
    const refObj = decoded.objects[0];
    const checksumHex = `0x${decoded.checksum.toString(16).toUpperCase().padStart(2, "0")}`;

    this.pushPacketRecord({
      id: this.nextPacketId++,
      senderId: REFEREE_ID,
      isReferee: true,
      sequenceNumber: decoded.sequenceNumber,
      lengthBytes: rawBytes.length,
      numObjects: decoded.numObjects,
      checksumHex,
      rawHex: hex,
      summary: `Referee State=${refObj.stateLabel} | Left=0x${refObj.teamLeftBitmask.toString(16).toUpperCase().padStart(3, "0")} Right=0x${refObj.teamRightBitmask.toString(16).toUpperCase().padStart(3, "0")} | T=${refObj.remainingSeconds}s`,
    });
  }

  recordIncomingDatagram(inputBytes) {
    const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
    const now = Date.now();
    const hex = formatHex(bytes);
    try {
      const pkt = decodeUsoccerPacket(bytes);
      if (pkt.senderId === REFEREE_ID) return;

      let entry = this.robotsMap.get(pkt.senderId);
      if (!entry) {
        entry = {
          robotId: pkt.senderId,
          window: [],
          lastSeen: now,
          lastSequenceNumber: 0,
          totalPacketsReceived: 0,
          checksumErrors: 0,
          ownPosition: null,
          ballPosition: null,
          intention: null,
          latestObjects: [],
          latestRawHex: "",
        };
        this.robotsMap.set(pkt.senderId, entry);
      }

      entry.lastSeen = now;
      entry.lastSequenceNumber = pkt.sequenceNumber;
      entry.totalPacketsReceived++;
      entry.window.push({ ts: now, size: bytes.length });
      while (entry.window.length > 0 && now - entry.window[0].ts > 1000) {
        entry.window.shift();
      }

      for (const obj of pkt.objects) {
        if (
          (obj.category === "state" && obj.typeId === 1) ||
          (obj.category === "perception" && obj.typeId === 33)
        ) {
          entry.ownPosition = [
            obj.locationXMm,
            obj.locationYMm,
            obj.orientationRad10000,
            obj.confidence,
          ];
        } else if (
          (obj.category === "state" && obj.typeId === 2) ||
          (obj.category === "perception" && obj.typeId === 34)
        ) {
          entry.ballPosition = [obj.locationXMm, obj.locationYMm, obj.confidence];
        } else if (obj.category === "intention") {
          entry.intention = [obj.typeName, obj.targetXMm, obj.targetYMm, obj.offence];
        }
      }

      entry.latestObjects = pkt.objects;
      entry.latestRawHex = hex;

      const checksumHex = `0x${pkt.checksum.toString(16).toUpperCase().padStart(2, "0")}`;
      this.pushPacketRecord({
        id: this.nextPacketId++,
        senderId: pkt.senderId,
        isReferee: false,
        sequenceNumber: pkt.sequenceNumber,
        lengthBytes: bytes.length,
        numObjects: pkt.numObjects,
        checksumHex,
        rawHex: hex,
        summary: `Robot ID #${pkt.senderId} | ${pkt.numObjects} objs${
          entry.ownPosition ? ` | Pos=(${entry.ownPosition[0]}, ${entry.ownPosition[1]}mm)` : ""
        }`,
      });
    } catch {
      if (bytes.length >= 5) {
        const senderId = bytes[4];
        if (senderId !== REFEREE_ID) {
          const entry = this.robotsMap.get(senderId);
          if (entry) entry.checksumErrors++;
        }
      }
    }
  }

  pushPacketRecord(rec) {
    this.recentPackets.unshift(rec);
    if (this.recentPackets.length > 35) {
      this.recentPackets.length = 35;
    }
  }

  stepSimulator() {
    this.simTick++;
    const t = this.simTick * 0.25;
    const wireState = computeWireGameState(this.state);
    const leftMask = computeTeamBitmask(
      this.state.leftTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const rightMask = computeTeamBitmask(
      this.state.rightTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );

    const isPlaying =
      wireState === WireGameState.PLAY_KICKOFF_LEFT ||
      wireState === WireGameState.PLAY_KICKOFF_RIGHT ||
      wireState === WireGameState.PLAY_BALL_IN_PLAY;

    if (isPlaying) {
      this.simBall.x += this.simBall.vx;
      this.simBall.y += this.simBall.vy;
      if (this.simBall.x < 400 || this.simBall.x > 6600) {
        this.simBall.vx = -this.simBall.vx;
        this.simBall.x = Math.max(400, Math.min(6600, this.simBall.x));
      }
      if (this.simBall.y < 400 || this.simBall.y > 4600) {
        this.simBall.vy = -this.simBall.vy;
        this.simBall.y = Math.max(400, Math.min(4600, this.simBall.y));
      }
    } else if (
      wireState === WireGameState.SET_KICKOFF_LEFT ||
      wireState === WireGameState.SET_KICKOFF_RIGHT
    ) {
      this.simBall.x = 3500;
      this.simBall.y = 2500;
    }

    const ballX = Math.round(this.simBall.x);
    const ballY = Math.round(this.simBall.y);

    const leftFormations = [
      [450, 2500],
      [1650, 1450],
      [1650, 3550],
      [2750, 1850],
      [3100, 2950],
      [1100, 900],
      [1100, 4100],
      [2150, 2500],
      [2950, 1100],
      [2950, 3900],
      [3300, 2500],
    ];
    const rightFormations = [
      [6550, 2500],
      [5350, 1450],
      [5350, 3550],
      [4250, 3150],
      [3900, 2050],
      [5900, 900],
      [5900, 4100],
      [4850, 2500],
      [4050, 1100],
      [4050, 3900],
      [3700, 2500],
    ];

    const activeLeftSlots = this.state.leftTeam.slots
      .filter((s) => s.role === "goalkeeper" || s.role === "fieldPlayer")
      .map((s) => s.slotIndex);
    const activeRightSlots = this.state.rightTeam.slots
      .filter((s) => s.role === "goalkeeper" || s.role === "fieldPlayer")
      .map((s) => s.slotIndex);

    const generated = [];

    for (const slot of activeLeftSlots) {
      const robotId = slot;
      const [bx, by] = leftFormations[slot] || [1500, 2500];
      const allowed = (leftMask & (1 << slot)) !== 0 && isPlaying;
      const rx = allowed
        ? Math.round(
            Math.max(
              250,
              Math.min(
                6750,
                bx + Math.sin(t + slot) * 260 + (ballX - bx) * (slot === 0 ? 0.03 : 0.22),
              ),
            ),
          )
        : bx;
      const ry = allowed
        ? Math.round(
            Math.max(
              250,
              Math.min(
                4750,
                by + Math.cos(t * 0.8 + slot) * 220 + (ballY - by) * (slot === 0 ? 0.16 : 0.22),
              ),
            ),
          )
        : by;

      const seq = ((this.simSeq.get(robotId) ?? 0) + 1) & 0xffff;
      this.simSeq.set(robotId, seq);

      const pkt = encodeUsoccerPacket({
        senderId: robotId,
        sequenceNumber: seq,
        objects: [
          {
            category: "state",
            typeId: 1, // Own position
            locationXMm: rx,
            locationYMm: ry,
            orientationRad10000: 0,
            confidence: allowed ? 248 : 200,
          },
          {
            category: "perception",
            typeId: 34, // Ball
            locationXMm: ballX,
            locationYMm: ballY,
            orientationRad10000: 0,
            confidence: 235,
          },
          this.state.leftTeam.slots[slot]?.role === "goalkeeper" && activeLeftSlots.length > 1
            ? {
                category: "intention",
                typeId: 66, // Play Goalkeeper
                targetXMm: 500,
                targetYMm: Math.max(1800, Math.min(3200, ballY)),
                targetOrientationRad10000: 0,
                offence: 15,
              }
            : {
                category: "intention",
                typeId: 67, // Movement
                targetXMm: ballX,
                targetYMm: ballY,
                targetOrientationRad10000: 2500,
                offence: 128,
              },
        ],
      });
      generated.push(pkt);
      this.recordIncomingDatagram(pkt);
    }

    for (const slot of activeRightSlots) {
      const robotId = 16 + slot;
      const [bx, by] = rightFormations[slot] || [5500, 2500];
      const allowed = (rightMask & (1 << slot)) !== 0 && isPlaying;
      const rx = allowed
        ? Math.round(
            Math.max(
              250,
              Math.min(
                6750,
                bx + Math.cos(t * 0.9 + slot) * 260 + (ballX - bx) * (slot === 0 ? 0.03 : 0.22),
              ),
            ),
          )
        : bx;
      const ry = allowed
        ? Math.round(
            Math.max(
              250,
              Math.min(
                4750,
                by + Math.sin(t + slot) * 220 + (ballY - by) * (slot === 0 ? 0.16 : 0.22),
              ),
            ),
          )
        : by;

      const seq = ((this.simSeq.get(robotId) ?? 0) + 1) & 0xffff;
      this.simSeq.set(robotId, seq);

      const pkt = encodeUsoccerPacket({
        senderId: robotId,
        sequenceNumber: seq,
        objects: [
          {
            category: "state",
            typeId: 1,
            locationXMm: rx,
            locationYMm: ry,
            orientationRad10000: -31415,
            confidence: allowed ? 248 : 200,
          },
          {
            category: "perception",
            typeId: 34,
            locationXMm: ballX,
            locationYMm: ballY,
            orientationRad10000: 0,
            confidence: 230,
          },
          this.state.rightTeam.slots[slot]?.role === "goalkeeper" && activeRightSlots.length > 1
            ? {
                category: "intention",
                typeId: 66,
                targetXMm: 6500,
                targetYMm: Math.max(1800, Math.min(3200, ballY)),
                targetOrientationRad10000: -31415,
                offence: 15,
              }
            : {
                category: "intention",
                typeId: 67,
                targetXMm: ballX,
                targetYMm: ballY,
                targetOrientationRad10000: -15700,
                offence: 128,
              },
        ],
      });
      generated.push(pkt);
      this.recordIncomingDatagram(pkt);
    }

    return generated;
  }

  tickOneSecond() {
    const s = this.state;
    const inBreak =
      s.phase === "halfTimeBreak" ||
      s.phase === "overtimeHalfTimeBreak" ||
      s.stage.stage === "timeout";

    if (!inBreak) {
      for (const team of [s.leftTeam, s.rightTeam]) {
        for (const slot of team.slots) {
          if (slot.removalPenalty && slot.penaltyTimerRunning && slot.penaltyRemainingSecs > 0) {
            slot.penaltyRemainingSecs = Math.max(0, slot.penaltyRemainingSecs - 1);
          }
        }
      }
    }

    switch (s.stage.stage) {
      case "ready":
        if (s.secondarySeconds > 0) {
          s.secondarySeconds--;
          if (s.secondarySeconds === 0) {
            const restart = s.stage.restart;
            s.stage = { stage: "set", restart };
            s.secondarySeconds = SET_PHASE_SECS;
            pushLog(
              s,
              `READY elapsed (10s) -> Entered SET for ${restartLabel(restart)}. Place ball; robots must remain motionless.`,
              "[US-9.5] / [US-21.23]",
            );
          }
        }
        break;
      case "set":
        if (s.secondarySeconds > 0) {
          s.secondarySeconds--;
        }
        break;
      case "playKickOff":
        if (s.primarySeconds > 0) s.primarySeconds--;
        if (s.secondarySeconds > 0) {
          s.secondarySeconds--;
          if (s.secondarySeconds === 0) {
            const sideLabel = s.stage.kickingSide === "left" ? "Left" : "Right";
            s.stage = { stage: "playBallInPlay" };
            pushLog(
              s,
              `10s kick-off restriction elapsed (${sideLabel} Team) -> State=5 (Play: Ball in Play).`,
              "[US-9.6]",
            );
          }
        }
        if (s.primarySeconds <= 0) {
          s.stage = { stage: "finished" };
          pushLog(s, "Period time expired.", "[US-8.3]");
        }
        break;
      case "playBallInPlay":
        if (s.primarySeconds > 0) {
          s.primarySeconds--;
          if (s.primarySeconds <= 0) {
            s.stage = { stage: "finished" };
            pushLog(s, "Period time expired.", "[US-8.3]");
          }
        }
        break;
      case "timeout":
        if (s.secondarySeconds > 0) {
          s.secondarySeconds--;
          if (s.secondarySeconds === 0) {
            s.stage = { stage: "stopped" };
            pushLog(s, "2-minute Timeout concluded.", "[US-8.6]");
          }
        }
        break;
      default:
        if (
          (s.phase === "halfTimeBreak" || s.phase === "overtimeHalfTimeBreak") &&
          s.primarySeconds > 0
        ) {
          s.primarySeconds--;
        }
        break;
    }
  }

  applyAction(action) {
    const s = this.state;
    const { type, args = {} } = action;

    switch (type) {
      case "undo": {
        const steps = Math.min(args.steps || 1, this.undoStack.length);
        if (steps > 0) {
          let restored = null;
          for (let i = 0; i < steps; i++) {
            restored = this.undoStack.pop();
          }
          if (restored) {
            const seq = s.refereeSequenceNumber;
            this.state = restored.snapshot;
            this.state.refereeSequenceNumber = seq;
          }
        }
        break;
      }
      case "stopPlay": {
        s.stage = { stage: "stopped" };
        s.secondarySeconds = 0;
        pushLog(s, "Referee signaled STOP PLAY (Wire State = 0).", "[GN-3.6]");
        break;
      }
      case "configureMatch": {
        this.saveUndo("Configure Match");
        s.category = args.category || "kidSize";
        if (Number.isFinite(Number(args.trainingPlayersPerTeam))) {
          s.trainingPlayersPerTeam = Math.max(
            1,
            Math.min(11, Number(args.trainingPlayersPerTeam)),
          );
        }
        s.leftTeam.name = args.leftTeamName || s.leftTeam.name;
        s.leftTeam.color = args.leftTeamColor || s.leftTeam.color;
        s.rightTeam.name = args.rightTeamName || s.rightTeam.name;
        s.rightTeam.color = args.rightTeamColor || s.rightTeam.color;
        s.firstHalfKickoffSide = args.firstHalfKickoffSide || "left";
        s.nextKickoffSide = s.firstHalfKickoffSide;
        s.leftTeam.substitutionsRemaining = s.category === "training" ? 99 : 2;
        s.rightTeam.substitutionsRemaining = s.category === "training" ? 99 : 2;

        if (s.category === "training") {
          if (args.applyTrainingPreset) {
            const targetActive = s.trainingPlayersPerTeam || 1;
            for (const team of [s.leftTeam, s.rightTeam]) {
              for (const slot of team.slots) {
                if (slot.slotIndex === 0 && targetActive >= 1) {
                  slot.role = targetActive === 1 ? "fieldPlayer" : "goalkeeper";
                } else if (slot.slotIndex < targetActive) {
                  slot.role = "fieldPlayer";
                } else if (slot.slotIndex < targetActive + 1) {
                  slot.role = "substitute";
                } else {
                  slot.role = "inactive";
                }
              }
            }
          }
          pushLog(
            s,
            `Configured Training / Freeform Mode (${s.trainingPlayersPerTeam}v${s.trainingPlayersPerTeam} or custom slot roles). First Kick-Off: ${s.firstHalfKickoffSide.toUpperCase()} Team.`,
            "[Training Mode]",
          );
        } else {
          const maxActive = s.category === "adultSize" ? 3 : 5;
          for (const team of [s.leftTeam, s.rightTeam]) {
            let active = 0;
            for (const slot of team.slots) {
              if (slot.role === "goalkeeper" || slot.role === "fieldPlayer") {
                if (active < maxActive) {
                  active++;
                } else {
                  slot.role = "substitute";
                }
              } else if (slot.slotIndex < maxActive) {
                slot.role = slot.slotIndex === 0 ? "goalkeeper" : "fieldPlayer";
                active++;
              }
            }
          }
          pushLog(
            s,
            `Configured ${s.category === "adultSize" ? "Adult Size (3v3)" : "Kid Size (5v5)"} match. First Kick-Off: ${s.firstHalfKickoffSide.toUpperCase()} Team.`,
            "[US-8.2]",
          );
        }
        break;
      }
      case "randomizeUnitedTeams": {
        this.saveUndo("Randomize United Teams");
        const pool = [...(args.pool || this.customClubPool || DEFAULT_CLUB_POOL)];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const maxActive = baseMaxPlayersForCategory(s.category, s.trainingPlayersPerTeam);
        const half = Math.ceil(pool.length / 2);
        const leftPool = pool.slice(0, half);
        const rightPool = pool.slice(half);

        for (const [team, subPool] of [
          [s.leftTeam, leftPool],
          [s.rightTeam, rightPool],
        ]) {
          for (let idx = 0; idx <= 10; idx++) {
            const item = subPool[idx];
            if (item) {
              const role =
                idx === 0
                  ? maxActive === 1 && s.category === "training"
                    ? "fieldPlayer"
                    : "goalkeeper"
                  : idx < maxActive
                    ? "fieldPlayer"
                    : idx < maxActive + 2
                      ? "substitute"
                      : "inactive";
              team.slots[idx] = {
                ...team.slots[idx],
                originClub: item.originClub,
                robotName: item.robotName,
                role,
              };
            } else {
              team.slots[idx].role = "inactive";
            }
          }
        }
        pushLog(
          s,
          "Randomly assigned robots from participating clubs into Left & Right United Teams.",
          "[US-8.1]",
        );
        break;
      }
      case "randomizePassingMarkers": {
        this.saveUndo("Randomize 6 Passing Poles");
        const candidates = [
          [1800, 1000],
          [1800, 2500],
          [1800, 4000],
          [2600, 1300],
          [2600, 3700],
          [3500, 850],
          [3500, 4150],
          [4400, 1300],
          [4400, 3700],
          [5200, 1000],
          [5200, 2500],
          [5200, 4000],
        ];
        const shuffled = [...candidates].sort(() => Math.random() - 0.5);
        s.passingMarkersMm = shuffled.slice(0, 6);
        pushLog(
          s,
          "Randomly placed the 6 Passing Markers on the field outside penalty/goal areas.",
          "[US-1.21]",
        );
        break;
      }
      case "updateRobotSlot": {
        this.saveUndo(`Edit Slot #${args.slotIndex}`);
        const team = args.side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[args.slotIndex];
        if (slot) {
          if (args.originClub !== undefined) slot.originClub = args.originClub;
          if (args.robotName !== undefined) slot.robotName = args.robotName;
          if (args.role !== undefined) slot.role = args.role;
        }
        break;
      }
      case "signalReady": {
        const restart = args.restart || { type: "kickOff", side: s.nextKickoffSide };
        this.saveUndo(`READY: ${restartLabel(restart)}`);
        if (restart.type === "kickOff") {
          s.nextKickoffSide = restart.side;
        }
        s.stage = { stage: "ready", restart };
        s.secondarySeconds = READY_PHASE_SECS;
        pushLog(
          s,
          `Referee signaled READY for ${restartLabel(restart)}. 10s for robots to move to own half.`,
          "[US-9.3]",
        );
        break;
      }
      case "signalSet": {
        const currentRestart =
          args.restart ||
          s.stage.restart || {
            type: "kickOff",
            side: s.nextKickoffSide,
          };
        this.saveUndo(`SET: ${restartLabel(currentRestart)}`);
        if (currentRestart.type === "kickOff") {
          s.nextKickoffSide = currentRestart.side;
        }
        s.stage = { stage: "set", restart: currentRestart };
        s.secondarySeconds = SET_PHASE_SECS;
        pushLog(
          s,
          `Referee signaled SET (${restartLabel(currentRestart)}). Ball placed; all robots must remain motionless.`,
          "[US-9.5] / [US-21.23]",
        );
        break;
      }
      case "signalPlay": {
        this.saveUndo("PLAY Whistle");
        const restart = s.stage.restart;
        if (restart?.type === "kickOff") {
          s.stage = { stage: "playKickOff", kickingSide: restart.side };
          s.secondarySeconds = KICKOFF_RESTRICTION_SECS;
        } else {
          s.stage = { stage: "playBallInPlay" };
          s.secondarySeconds = 0;
        }
        const ws = computeWireGameState(s);
        pushLog(
          s,
          `Referee whistled PLAY -> Broadcasting ${WIRE_STATE_LABELS[ws]}.`,
          "[US-9.6]",
        );
        break;
      }
      case "confirmKickOffTouch": {
        if (s.stage.stage === "playKickOff") {
          this.saveUndo("Kick-Off Ball Touched");
          s.stage = { stage: "playBallInPlay" };
          s.secondarySeconds = 0;
          pushLog(
            s,
            "Kick-off player touched ball -> Transitioned immediately to State=5 (Play: Ball in Play).",
            "[US-9.6]",
          );
        }
        break;
      }
      case "awardGoal": {
        const scoringSide = args.scoringSide || "left";
        const concedingSide = scoringSide === "left" ? "right" : "left";
        const scorerSlot = args.scorerSlot ?? null;
        this.saveUndo(`Goal (${scoringSide.toUpperCase()})`);

        const scoringTeam = scoringSide === "left" ? s.leftTeam : s.rightTeam;
        const concedingTeam = concedingSide === "left" ? s.leftTeam : s.rightTeam;

        scoringTeam.goals++;

        // [US-19.1]: Scorer gets +10, teammates on field get +2, opposing players on field get -2
        for (const slot of scoringTeam.slots) {
          const onField = slot.role === "goalkeeper" || slot.role === "fieldPlayer";
          if (scorerSlot !== null && slot.slotIndex === scorerSlot) {
            slot.score.goalsScored++;
          } else if (onField && !slot.redCard) {
            slot.score.teammateGoals++;
          }
        }

        for (const slot of concedingTeam.slots) {
          const onField = slot.role === "goalkeeper" || slot.role === "fieldPlayer";
          if (onField && !slot.redCard) {
            slot.score.opponentGoals++;
          }
        }

        // [US-9.1]: Conceding team receives the next kick-off
        s.nextKickoffSide = concedingSide;
        s.stage = {
          stage: "ready",
          restart: { type: "kickOff", side: concedingSide },
        };
        s.secondarySeconds = READY_PHASE_SECS;

        const baseId = scoringSide === "left" ? 0 : 16;
        const scorerText =
          scorerSlot !== null
            ? `Scorer ID #${baseId + scorerSlot} (+10 pts, teammates +2, opponents -2)`
            : "Team Goal (teammates +2, opponents -2)";
        pushLog(
          s,
          `GOAL for ${scoringTeam.name}! ${scorerText} -> READY for ${concedingTeam.name} Kick-Off.`,
          "[US-12.1] / [US-19.1]",
        );
        break;
      }
      case "recordIndividualAction": {
        const { side, slotIndex, kind } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        const wireId = (side === "right" ? 16 : 0) + slotIndex;
        if (slot) {
          if (kind === "save") {
            this.saveUndo(`ID #${wireId} Save (+7)`);
            slot.score.savesMade++;
            pushLog(
              s,
              `Recorded Goal Save (+7 pts) for Robot ID #${wireId} (${slot.robotName}).`,
              "[US-19.1]",
            );
          } else if (kind === "passingPoleKick") {
            this.saveUndo(`ID #${wireId} Passing Pole (+2)`);
            slot.score.passingPoleKicks++;
            pushLog(
              s,
              `Recorded Passing Pole Kick (+2 pts) for Robot ID #${wireId} (${slot.robotName}).`,
              "[US-19.1]",
            );
          }
        }
        break;
      }
      case "adjustRobotScore": {
        const { side, slotIndex, manualDelta } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        const wireId = (side === "right" ? 16 : 0) + slotIndex;
        if (slot && manualDelta) {
          this.saveUndo(`Adjust ID #${wireId} (${manualDelta > 0 ? "+" : ""}${manualDelta})`);
          slot.score.manualAdjustment += manualDelta;
        }
        break;
      }
      case "applyRemovalPenalty": {
        const { side, slotIndex, reason, startTimerImmediately = true } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        const wireId = (side === "right" ? 16 : 0) + slotIndex;
        if (slot) {
          this.saveUndo(`30s Penalty ID #${wireId}`);
          slot.removalPenalty = reason;
          slot.penaltyRemainingSecs = REMOVAL_PENALTY_SECS;
          slot.penaltyTimerRunning = startTimerImmediately;
          // [US-19.1]: -1 point for 30-second removal penalty
          slot.score.removalPenalties++;
          const reasonObj = REMOVAL_PENALTY_REASONS.find((r) => r.id === reason);
          pushLog(
            s,
            `30s Removal Penalty on Robot ID #${wireId} (${slot.robotName}): ${reasonObj?.label || reason}. Bitmask bit cleared & -1 pt applied.`,
            "[US-16.1] / [US-21.22]",
          );
        }
        break;
      }
      case "togglePenaltyTimer": {
        const { side, slotIndex } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        if (slot && slot.removalPenalty) {
          slot.penaltyTimerRunning = !slot.penaltyTimerRunning;
        }
        break;
      }
      case "returnPenalizedRobot": {
        const { side, slotIndex } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        const wireId = (side === "right" ? 16 : 0) + slotIndex;
        if (slot) {
          this.saveUndo(`Return ID #${wireId}`);
          slot.removalPenalty = null;
          slot.penaltyRemainingSecs = 0;
          slot.penaltyTimerRunning = false;
          pushLog(
            s,
            `Robot ID #${wireId} (${slot.robotName}) re-entered from touch line near center line facing center circle. Bitmask bit restored.`,
            "[US-16.3]",
          );
        }
        break;
      }
      case "issueCard": {
        const { side, slotIndex, isRed, offence } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const slot = team.slots[slotIndex];
        const wireId = (side === "right" ? 16 : 0) + slotIndex;
        if (slot) {
          this.saveUndo(`${isRed ? "Red" : "Yellow"} Card ID #${wireId}`);
          slot.lastCardOffence = offence;
          if (isRed) {
            slot.redCard = true;
            team.teamRedCards++;
          } else {
            slot.yellowCards++;
            team.teamYellowCards++;
            if (slot.yellowCards >= 2) {
              slot.redCard = true;
              team.teamRedCards++;
            }
          }
          const newMax = effectiveMaxPlayers(team, s.category);
          pushLog(
            s,
            `${isRed ? "RED CARD (Sent Off)" : "YELLOW CARD (Caution)"} issued to Robot ID #${wireId} (${slot.robotName}). Team max allowed players on field: ${newMax}.`,
            "[US-14.2]",
          );
        }
        break;
      }
      case "substitutePlayer": {
        const { side, outgoingSlot, incomingSlot } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        const outBot = team.slots[outgoingSlot];
        const inBot = team.slots[incomingSlot];
        if (
          team.substitutionsRemaining > 0 &&
          outBot &&
          inBot &&
          (outBot.role === "goalkeeper" || outBot.role === "fieldPlayer") &&
          inBot.role === "substitute"
        ) {
          this.saveUndo(`Substitute #${outgoingSlot} -> #${incomingSlot}`);
          const inheritedRole = outBot.role;
          outBot.role = "substitute";
          inBot.role = inheritedRole;
          team.substitutionsRemaining--;
          const baseId = side === "right" ? 16 : 0;
          pushLog(
            s,
            `Substitution on ${team.name}: ID #${baseId + incomingSlot} (${inBot.robotName}) replaced ID #${baseId + outgoingSlot} (${outBot.robotName}). (${team.substitutionsRemaining} left).`,
            "[US-4.3]",
          );
        }
        break;
      }
      case "startTimeout": {
        const calledBy = args.calledBy ?? null;
        if (calledBy) {
          const team = calledBy === "right" ? s.rightTeam : s.leftTeam;
          if (team.timeoutsRemaining <= 0) break;
          this.saveUndo(`Timeout (${team.name})`);
          team.timeoutsRemaining--;
          // [US-9.1]: "If a kick-off occurs because of a time-out, then the team that did not choose the time-out will have kick-off."
          s.nextKickoffSide = calledBy === "left" ? "right" : "left";
          s.stage = { stage: "timeout", calledBy };
          s.secondarySeconds = TIMEOUT_SECS;
          pushLog(
            s,
            `${team.name} took a 2-minute Timeout (${team.timeoutsRemaining} left). Opposing team receives subsequent Kick-Off.`,
            "[US-8.6] / [US-9.1]",
          );
        } else {
          this.saveUndo("Referee Timeout");
          s.stage = { stage: "timeout", calledBy: null };
          s.secondarySeconds = TIMEOUT_SECS;
          pushLog(s, "Referee started a 2-minute Timeout.", "[US-8.6]");
        }
        break;
      }
      case "advancePeriod": {
        this.saveUndo("Advance Match Period");
        if (s.phase === "firstHalf") {
          s.phase = "halfTimeBreak";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 300; // 5 min break [US-8.4]
          s.secondarySeconds = 0;
          pushLog(s, "1st Half ended -> Started 5-minute Half-Time Break.", "[US-8.4]");
        } else if (s.phase === "halfTimeBreak") {
          // [US-8.5]: "After the end of the half time, the teams will switch their start side."
          const temp = s.leftTeam;
          s.leftTeam = s.rightTeam;
          s.rightTeam = temp;
          s.phase = "secondHalf";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 600; // 10 min 2nd half [US-8.3]
          s.secondarySeconds = 0;
          s.nextKickoffSide = s.firstHalfKickoffSide;
          pushLog(
            s,
            "Half-Time Break ended -> Teams switched sides (Left IDs 0..10 <-> Right IDs 16..26). Started 2nd Half (10:00).",
            "[US-8.5]",
          );
        } else if (s.phase === "secondHalf") {
          s.phase = "overtimeFirstHalf";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 300; // 5 min overtime [US-12.4]
          s.secondarySeconds = 0;
          pushLog(s, "Started Overtime 1st Period (5:00).", "[US-12.4]");
        } else if (s.phase === "overtimeFirstHalf") {
          s.phase = "overtimeHalfTimeBreak";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 300;
          s.secondarySeconds = 0;
          pushLog(s, "Started Overtime Half-Time Break (5:00).", "[US-12.4]");
        } else if (s.phase === "overtimeHalfTimeBreak") {
          const temp = s.leftTeam;
          s.leftTeam = s.rightTeam;
          s.rightTeam = temp;
          s.phase = "overtimeSecondHalf";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 300;
          s.secondarySeconds = 0;
          pushLog(s, "Teams switched sides. Started Overtime 2nd Period (5:00).", "[US-12.4]");
        } else {
          s.phase = "penaltyShootout";
          s.stage = { stage: "stopped" };
          s.primarySeconds = 60;
          s.secondarySeconds = 0;
          pushLog(s, "Entered 5-Round Alternating Penalty Kick Shootout.", "[US-12.4] / [US-20.3]");
        }
        break;
      }
      case "adjustPrimaryClock": {
        const delta = args.deltaSeconds || 0;
        this.saveUndo(`Clock ${delta >= 0 ? "+" : ""}${delta}s`);
        s.primarySeconds = Math.max(0, s.primarySeconds + delta);
        break;
      }
      case "recordShootoutAttempt": {
        const { side, scored } = args;
        const team = side === "right" ? s.rightTeam : s.leftTeam;
        this.saveUndo(`Shootout ${team.name}`);
        team.shootoutAttempts++;
        if (scored) team.shootoutGoals++;
        pushLog(
          s,
          `Penalty Shootout #${team.shootoutAttempts} for ${team.name}: ${scored ? "GOAL" : "MISSED / SAVED"}.`,
          "[US-12.4]",
        );
        break;
      }
      default:
        break;
    }
  }

  getSnapshot() {
    const now = Date.now();
    const wireState = computeWireGameState(this.state);
    const leftBitmask = computeTeamBitmask(
      this.state.leftTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const rightBitmask = computeTeamBitmask(
      this.state.rightTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const leftMaxPlayers = effectiveMaxPlayers(
      this.state.leftTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const rightMaxPlayers = effectiveMaxPlayers(
      this.state.rightTeam,
      this.state.category,
      this.state.trainingPlayersPerTeam,
    );
    const leaderboard = computeLeaderboard(this.state);

    const robotTelemetry = [];
    for (const entry of this.robotsMap.values()) {
      let messagesPerSec = 0;
      let bytesPerSec = 0;
      for (const item of entry.window) {
        if (now - item.ts <= 1000) {
          messagesPerSec++;
          bytesPerSec += item.size;
        }
      }
      let compliance = "compliant";
      if (bytesPerSec > MAX_ROBOT_BYTES_PER_SEC) compliance = "bandwidthExceeded";
      else if (messagesPerSec > MAX_ROBOT_MSGS_PER_SEC) compliance = "rateExceeded";

      robotTelemetry.push({
        robotId: entry.robotId,
        lastSequenceNumber: entry.lastSequenceNumber,
        messagesPerSec,
        bytesPerSec,
        totalPacketsReceived: entry.totalPacketsReceived,
        checksumErrors: entry.checksumErrors,
        compliance,
        ageMs: now - entry.lastSeen,
        ownPosition: entry.ownPosition,
        ballPosition: entry.ballPosition,
        intention: entry.intention,
        latestObjects: entry.latestObjects,
        latestRawHex: entry.latestRawHex,
      });
    }
    robotTelemetry.sort((a, b) => a.robotId - b.robotId);

    return {
      matchState: structuredClone(this.state),
      wireState,
      wireStateLabel: WIRE_STATE_LABELS[wireState],
      leftBitmask,
      rightBitmask,
      leftMaxPlayers,
      rightMaxPlayers,
      leaderboard,
      undoLabels: this.undoStack
        .slice(-8)
        .reverse()
        .map((u) => u.label),
      networkConfig: { ...this.networkConfig },
      networkInterfaces: [...this.networkInterfaces],
      yamlPaths: { ...this.yamlPaths },
      totalRefereePacketsSent: this.totalRefereePacketsSent,
      lastRefereePacketHex: this.lastRefereePacketHex,
      lastTxError: this.lastTxError,
      robotTelemetry,
      recentPackets: [...this.recentPackets],
    };
  }
}
