import assert from "node:assert/strict";
import dgram from "node:dgram";
import test from "node:test";
import {
  computeChecksum,
  createRefereeStatePacket,
  decodeUsoccerPacket,
  encodeUsoccerPacket,
  HEADER_MAGIC,
  REFEREE_ID,
  WireGameState,
} from "../src/protocol/usoccer_protocol.js";
import {
  computeTeamBitmask,
  UnitedSoccerRuntime,
} from "../src/protocol/usoccer_engine.js";
import {
  computeSubnetBroadcast,
  formatSettingsYaml,
  formatTeamsYaml,
  listNetworkInterfaces,
  parseSimpleYaml,
} from "../server-utils.mjs";

test("[US-21.3 / US-21.6 / US-21.23] Referee 0xADDE MSB packet layout & checksum roundtrip", () => {
  const bytes = createRefereeStatePacket({
    sequenceNumber: 42,
    teamLeftBitmask: 0b0000_0000_0001_1111, // IDs 0..4 allowed
    teamRightBitmask: 0b0000_0000_0001_0111, // IDs 16,17,18,20 allowed
    remainingSeconds: 598,
    state: WireGameState.PLAY_KICKOFF_LEFT,
  });

  // 10-byte envelope + 8-byte Referee Object = 18 bytes
  assert.equal(bytes.length, 18);
  // Header 0xADDE in MSB-first (Big-Endian) byte order
  assert.equal(bytes[0], 0xad);
  assert.equal(bytes[1], 0xde);
  // Length = 18 (0x0012)
  assert.equal(bytes[2], 0x00);
  assert.equal(bytes[3], 0x12);
  // Referee ID = 32
  assert.equal(bytes[4], REFEREE_ID);
  // Sequence Number = 42 (0x002A)
  assert.equal(bytes[5], 0x00);
  assert.equal(bytes[6], 0x2a);
  // Number of objects = 1
  assert.equal(bytes[7], 1);
  // Referee Object Type = 97 (Game State)
  assert.equal(bytes[8], 97);
  // Team Left Bitmask = 0x001F
  assert.equal(bytes[9], 0x00);
  assert.equal(bytes[10], 0x1f);
  // Team Right Bitmask = 0x0017
  assert.equal(bytes[11], 0x00);
  assert.equal(bytes[12], 0x17);
  // Remaining seconds = 598 (0x0256)
  assert.equal(bytes[13], 0x02);
  assert.equal(bytes[14], 0x56);
  // State = 3 (Play: Kick off Left Team)
  assert.equal(bytes[15], 3);
  // Dummy = 0x00
  assert.equal(bytes[16], 0x00);
  // Checksum = wrapping 8-bit sum of bytes[0..17]
  assert.equal(bytes[17], computeChecksum(bytes.subarray(0, 17)));

  const decoded = decodeUsoccerPacket(bytes);
  assert.equal(decoded.senderId, 32);
  assert.equal(decoded.sequenceNumber, 42);
  assert.equal(decoded.numObjects, 1);
  assert.equal(decoded.objects[0].category, "referee");
  assert.equal(decoded.objects[0].teamLeftBitmask, 0x001f);
  assert.equal(decoded.objects[0].teamRightBitmask, 0x0017);
  assert.equal(decoded.objects[0].remainingSeconds, 598);
  assert.equal(decoded.objects[0].state, WireGameState.PLAY_KICKOFF_LEFT);
});

test("[US-21.14 - US-21.25] Robot State, Perception, Intention, and Extension objects roundtrip", () => {
  const bytes = encodeUsoccerPacket({
    senderId: 16,
    sequenceNumber: 512,
    objects: [
      {
        category: "state",
        typeId: 1,
        locationXMm: 3500,
        locationYMm: 1200,
        orientationRad10000: -18023,
        confidence: 240,
      },
      {
        category: "perception",
        typeId: 34,
        locationXMm: 4200,
        locationYMm: 2500,
        orientationRad10000: 0,
        confidence: 255,
      },
      {
        category: "intention",
        typeId: 65,
        targetXMm: 7000,
        targetYMm: 2500,
        targetOrientationRad10000: 15708,
        offence: 255,
      },
      {
        category: "extension",
        typeId: 128,
        user1: 0x1234,
        user2: 0x5678,
        user3: -42,
        user4: 99,
      },
    ],
  });

  assert.equal(bytes.length, 10 + 4 * 8);
  const decoded = decodeUsoccerPacket(bytes);
  assert.equal(decoded.senderId, 16);
  assert.equal(decoded.objects.length, 4);
  assert.equal(decoded.objects[0].orientationRad10000, -18023);
  assert.equal(decoded.objects[1].typeName, "Ball");
  assert.equal(decoded.objects[2].typeName, "Shot on Goal");
  assert.equal(decoded.objects[2].offence, 255);
  assert.equal(decoded.objects[3].user3, -42);
});

test("[US-9 / US-21.23] Kick-Off state transitions (READY -> SET -> PLAY Kick-Off -> Ball in Play)", () => {
  const rt = new UnitedSoccerRuntime("kidSize");
  assert.equal(rt.getSnapshot().wireState, WireGameState.STOPPED);

  // 1. Signal READY for Left Kick-Off -> 10s countdown
  rt.applyAction({
    type: "signalReady",
    args: { restart: { type: "kickOff", side: "left" } },
  });
  assert.equal(rt.state.secondarySeconds, 10);
  assert.equal(rt.getSnapshot().wireState, WireGameState.STOPPED);

  // 2. Tick 10 seconds -> automatically enters SET (Wire State = 1: Set Kick off Left Team)
  for (let i = 0; i < 10; i++) rt.tickOneSecond();
  assert.equal(rt.getSnapshot().wireState, WireGameState.SET_KICKOFF_LEFT);

  // 3. Signal PLAY -> enters Play Kick-Off Left Team (Wire State = 3) for 10s
  rt.applyAction({ type: "signalPlay" });
  assert.equal(rt.getSnapshot().wireState, WireGameState.PLAY_KICKOFF_LEFT);
  assert.equal(rt.state.secondarySeconds, 10);

  // 4. Confirm ball touched -> immediately enters Wire State = 5 (Play: Ball in Play)
  rt.applyAction({ type: "confirmKickOffTouch" });
  assert.equal(rt.getSnapshot().wireState, WireGameState.PLAY_BALL_IN_PLAY);
});

test("[US-15 / US-16 / US-21.22] 30s Removal Penalty clears bitmask bit & deducts -1 point", () => {
  const rt = new UnitedSoccerRuntime("kidSize");
  assert.equal(computeTeamBitmask(rt.state.leftTeam, "kidSize"), 0b0001_1111);

  rt.applyAction({
    type: "applyRemovalPenalty",
    args: {
      side: "left",
      slotIndex: 2,
      reason: "touchingPassingMarker",
      startTimerImmediately: true,
    },
  });

  // Bit 2 is cleared!
  assert.equal(computeTeamBitmask(rt.state.leftTeam, "kidSize"), 0b0001_1011);
  // -1 point applied to slot 2
  const boardAfterPenalty = rt.getSnapshot().leaderboard;
  const slot2Entry = boardAfterPenalty.find((e) => e.wireRobotId === 2);
  assert.equal(slot2Entry.rawTotal, -1);
  // [US-19.2]: < 1 point receives 0 official points and no rank
  assert.equal(slot2Entry.officialPoints, 0);
  assert.equal(slot2Entry.rank, null);

  // Return robot after penalty expires
  rt.applyAction({
    type: "returnPenalizedRobot",
    args: { side: "left", slotIndex: 2 },
  });
  assert.equal(computeTeamBitmask(rt.state.leftTeam, "kidSize"), 0b0001_1111);
});

test("[US-14.2] Two yellow cards on a team reduce max allowed players on the field by 1", () => {
  const rt = new UnitedSoccerRuntime("kidSize");
  assert.equal(rt.getSnapshot().leftMaxPlayers, 5);

  rt.applyAction({
    type: "issueCard",
    args: { side: "left", slotIndex: 1, isRed: false, offence: "pushingOpponent" },
  });
  assert.equal(rt.getSnapshot().leftMaxPlayers, 5);

  rt.applyAction({
    type: "issueCard",
    args: { side: "left", slotIndex: 3, isRed: false, offence: "chargingOpponent" },
  });
  // Team now has 2 yellow cards -> max allowed active players reduced from 5 to 4!
  assert.equal(rt.getSnapshot().leftMaxPlayers, 4);
});

test("[US-19 / US-20] Individual Robot Scoring & Tiebreaker hierarchy", () => {
  const rt = new UnitedSoccerRuntime("kidSize");

  // Left slot 1 scores a goal (+10 to slot 1, +2 to teammates 0,2,3,4, -2 to Right slots 0..4)
  rt.applyAction({
    type: "awardGoal",
    args: { scoringSide: "left", scorerSlot: 1 },
  });

  // Right GK (slot 0 -> wire ID 16) makes two saves (+14) -> net score = -2 + 14 = 12
  rt.applyAction({
    type: "recordIndividualAction",
    args: { side: "right", slotIndex: 0, kind: "save" },
  });
  rt.applyAction({
    type: "recordIndividualAction",
    args: { side: "right", slotIndex: 0, kind: "save" },
  });

  // Left slot 1 kicks ball at passing pole (+2) -> net score = 10 + 2 = 12
  rt.applyAction({
    type: "recordIndividualAction",
    args: { side: "left", slotIndex: 1, kind: "passingPoleKick" },
  });

  const snap = rt.getSnapshot();
  // Both Robot ID #1 and Robot ID #16 have 12 official points!
  // Tiebreaker [US-20.1]: Robot ID #1 has 1 goal scored vs Robot ID #16's 0 goals scored -> ID #1 is Rank 1!
  assert.equal(snap.leaderboard[0].wireRobotId, 1);
  assert.equal(snap.leaderboard[0].officialPoints, 12);
  assert.equal(snap.leaderboard[0].rank, 1);

  assert.equal(snap.leaderboard[1].wireRobotId, 16);
  assert.equal(snap.leaderboard[1].officialPoints, 12);
  assert.equal(snap.leaderboard[1].rank, 2);
});

test("[US-21.5 / US-3.6] Live UDP socket transmission & robot telemetry reception over OS dgram", async () => {
  const rt = new UnitedSoccerRuntime("kidSize");
  const receiver = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");

  await new Promise((resolve) => receiver.bind(0, "127.0.0.1", resolve));
  const port = receiver.address().port;

  const receivedRawPromise = new Promise((resolve) => {
    receiver.once("message", (msg) => resolve(new Uint8Array(msg)));
  });

  // 1. Transmit a Referee 0xADDE packet over real UDP
  const refBytes = rt.buildCurrentRefereePacket(true);
  sender.send(Buffer.from(refBytes), port, "127.0.0.1");
  const receivedRef = await receivedRawPromise;
  const decodedRef = decodeUsoccerPacket(receivedRef);
  assert.equal(decodedRef.senderId, 32);
  assert.equal(decodedRef.objects[0].category, "referee");

  // 2. Transmit a simulated Robot 0xADDE packet and feed it into the runtime telemetry tracker
  const simPackets = rt.stepSimulator();
  assert.equal(simPackets.length, 10); // 5 Left + 5 Right robots in KidSize
  const snap = rt.getSnapshot();
  assert.equal(snap.robotTelemetry.length, 10);
  assert.equal(snap.robotTelemetry[0].compliance, "compliant");

  sender.close();
  receiver.close();
});

test("[Training Mode 1v1] Freeform category supports 1v1 (2 robots) & custom slot roles without 5v5 lock", () => {
  const rt = new UnitedSoccerRuntime("kidSize");
  rt.applyAction({
    type: "configureMatch",
    args: {
      category: "training",
      trainingPlayersPerTeam: 1,
      applyTrainingPreset: true,
      leftTeamName: "Lab Left 1v1",
      rightTeamName: "Lab Right 1v1",
      firstKickoffSide: "left",
    },
  });

  const snap = rt.getSnapshot();
  assert.equal(snap.matchState.category, "training");
  assert.equal(snap.leftBitmask, 0b0000_0001); // Only Robot ID #0 active on Left
  assert.equal(snap.rightBitmask, 0b0000_0001); // Only Robot ID #16 active on Right

  // Simulator only emits 2 packets (ID #0 and ID #16) in 1v1 training mode
  const simPkts = rt.stepSimulator();
  assert.equal(simPkts.length, 2);

  // Unlocking an arbitrary additional slot (e.g. Slot #7 -> Wire ID #7) in Training Mode works immediately
  rt.applyAction({
    type: "updateRobotSlot",
    args: {
      side: "left",
      slotIndex: 7,
      role: "fieldPlayer",
    },
  });
  const snap2 = rt.getSnapshot();
  assert.equal(snap2.leftBitmask, (1 << 0) | (1 << 7));
});

test("[Network Interfaces & YAML Config] Interface broadcast computation & YAML roundtrip", () => {
  assert.equal(computeSubnetBroadcast("192.168.1.42", "255.255.255.0"), "192.168.1.255");
  assert.equal(computeSubnetBroadcast("10.0.0.15", "255.0.0.0"), "10.255.255.255");

  const ifaces = listNetworkInterfaces();
  assert.ok(ifaces.length >= 1);
  assert.equal(ifaces[0].name, "all");

  const rt = new UnitedSoccerRuntime("training");
  const exported = rt.exportYamlPayload();
  const settingsYaml = formatSettingsYaml(exported.settings);
  const teamsYaml = formatTeamsYaml(exported.teams);

  const parsedSettings = parseSimpleYaml(settingsYaml);
  const parsedTeams = parseSimpleYaml(teamsYaml);

  assert.equal(parsedSettings.match.category, "training");
  assert.equal(parsedSettings.network.port, 3838);
  assert.equal(parsedTeams.leftTeam.name, "United Cyan (Left)");
  assert.equal(parsedTeams.leftTeam.slots.length, 11);
});


