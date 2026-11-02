/**
 * FIRA HuroCup United Soccer [US-21] Binary Protocol Encoder & Decoder
 *
 * Strictly implements [US-21.1] - [US-21.25] from `unitedsoccer-rules-hurocup.md`:
 * - Byte order: Most Significant Byte first (Big-Endian) [US-21.3]
 * - Header: UINT16 = 0xADDE [US-21.6]
 * - Length: UINT16 = Total message length in bytes (10 + 8 * numObjects) [US-21.6]
 * - ID: UINT8 = Robot ID (0..10 Left, 16..26 Right) or Referee ID (32) [US-21.7]
 * - Sequence Number: UINT16 [US-21.6]
 * - Number of Objects: UINT8 [US-21.6]
 * - Objects: OBJECTS[NUM] (8 bytes each) [US-21.8] - [US-21.25]
 * - Dummy: UINT8 = 0x00 [US-21.6]
 * - Checksum: UINT8 = Wrapping 8-bit sum of all preceding bytes [US-21.6]
 */

export const HEADER_MAGIC = 0xadde;
export const REFEREE_ID = 32;
export const ENVELOPE_BYTES = 10;
export const OBJECT_BYTES = 8;

export const WireGameState = Object.freeze({
  STOPPED: 0,
  SET_KICKOFF_LEFT: 1,
  SET_KICKOFF_RIGHT: 2,
  PLAY_KICKOFF_LEFT: 3,
  PLAY_KICKOFF_RIGHT: 4,
  PLAY_BALL_IN_PLAY: 5,
});

export const WIRE_STATE_LABELS = Object.freeze({
  0: "0: Game Stopped",
  1: "1: Set — Kick-Off Left Team",
  2: "2: Set — Kick-Off Right Team",
  3: "3: Play — Kick-Off Left Team",
  4: "4: Play — Kick-Off Right Team",
  5: "5: Play — Ball in Play",
});

export const STATE_OBJECT_NAMES = Object.freeze({
  0: "UNDEFINED",
  1: "Own Position",
  2: "Ball",
  3: "Team Robot",
  4: "Opponent Robot",
  5: "Team Goal",
  6: "Opponent Goal",
});

export const PERCEPTION_OBJECT_NAMES = Object.freeze({
  32: "UNDEFINED",
  33: "Own Position",
  34: "Ball",
  35: "Team Robot",
  36: "Opponent Robot",
  37: "Team Goal",
  38: "Opponent Goal",
  39: "Field Line",
  40: "Center Circle Arc",
});

export const INTENTION_OBJECT_NAMES = Object.freeze({
  64: "UNDEFINED",
  65: "Shot on Goal",
  66: "Play Goalkeeper",
  67: "Movement",
});

/**
 * Computes wrapping 8-bit sum over a Uint8Array or number[] slice [US-21.6].
 */
export function computeChecksum(bytesWithoutChecksum) {
  let sum = 0;
  for (let i = 0; i < bytesWithoutChecksum.length; i++) {
    sum = (sum + (bytesWithoutChecksum[i] & 0xff)) & 0xff;
  }
  return sum;
}

/**
 * Formats a byte array into uppercase space-separated hex string.
 */
export function formatHex(bytes) {
  return Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/**
 * Encodes an 8-byte [US-21] object into a Uint8Array(8) in MSB (Big-Endian) byte order.
 */
export function encodeObject(obj) {
  const buf = new ArrayBuffer(OBJECT_BYTES);
  const view = new DataView(buf);

  if (obj.category === "referee") {
    view.setUint8(0, obj.isGameState === false ? 96 : 97);
    view.setUint16(1, obj.teamLeftBitmask & 0xffff, false); // MSB first
    view.setUint16(3, obj.teamRightBitmask & 0xffff, false);
    view.setInt16(5, obj.remainingSeconds, false);
    view.setUint8(7, obj.state & 0xff);
  } else if (obj.category === "state") {
    view.setUint8(0, obj.typeId & 0xff);
    view.setUint16(1, obj.locationXMm & 0xffff, false);
    view.setUint16(3, obj.locationYMm & 0xffff, false);
    view.setInt16(5, obj.orientationRad10000 ?? 0, false);
    view.setUint8(7, obj.confidence & 0xff);
  } else if (obj.category === "perception") {
    view.setUint8(0, obj.typeId & 0xff);
    view.setUint16(1, obj.locationXMm & 0xffff, false);
    view.setUint16(3, obj.locationYMm & 0xffff, false);
    view.setInt16(5, obj.orientationRad10000 ?? 0, false);
    view.setUint8(7, obj.confidence & 0xff);
  } else if (obj.category === "intention") {
    view.setUint8(0, obj.typeId & 0xff);
    view.setUint16(1, obj.targetXMm & 0xffff, false);
    view.setUint16(3, obj.targetYMm & 0xffff, false);
    view.setInt16(5, obj.targetOrientationRad10000 ?? 0, false);
    view.setUint8(7, obj.offence & 0xff);
  } else {
    // extension (128..255)
    view.setUint8(0, (obj.typeId ?? 128) & 0xff);
    view.setUint16(1, (obj.user1 ?? 0) & 0xffff, false);
    view.setUint16(3, (obj.user2 ?? 0) & 0xffff, false);
    view.setInt16(5, obj.user3 ?? 0, false);
    view.setUint8(7, (obj.user4 ?? 0) & 0xff);
  }

  return new Uint8Array(buf);
}

/**
 * Decodes an 8-byte Uint8Array slice into a structured [US-21] object.
 */
export function decodeObject(bytes8) {
  const buf = new Uint8Array(bytes8).buffer;
  const view = new DataView(buf);
  const typeId = view.getUint8(0);
  const u1 = view.getUint16(1, false);
  const u2 = view.getUint16(3, false);
  const i3 = view.getInt16(5, false);
  const b4 = view.getUint8(7);

  if (typeId >= 0 && typeId <= 31) {
    return {
      category: "state",
      typeId,
      typeName: STATE_OBJECT_NAMES[typeId] || `State(${typeId})`,
      locationXMm: u1,
      locationYMm: u2,
      orientationRad10000: i3,
      confidence: b4,
    };
  }
  if (typeId >= 32 && typeId <= 63) {
    return {
      category: "perception",
      typeId,
      typeName: PERCEPTION_OBJECT_NAMES[typeId] || `Perception(${typeId})`,
      locationXMm: u1,
      locationYMm: u2,
      orientationRad10000: i3,
      confidence: b4,
    };
  }
  if (typeId >= 64 && typeId <= 95) {
    return {
      category: "intention",
      typeId,
      typeName: INTENTION_OBJECT_NAMES[typeId] || `Intention(${typeId})`,
      targetXMm: u1,
      targetYMm: u2,
      targetOrientationRad10000: i3,
      offence: b4,
    };
  }
  if (typeId >= 96 && typeId <= 127) {
    return {
      category: "referee",
      typeId,
      isGameState: typeId === 97,
      teamLeftBitmask: u1,
      teamRightBitmask: u2,
      remainingSeconds: i3,
      state: b4,
      stateLabel: WIRE_STATE_LABELS[b4] || `${b4}: Unknown`,
    };
  }
  return {
    category: "extension",
    typeId,
    user1: u1,
    user2: u2,
    user3: i3,
    user4: b4,
  };
}

/**
 * Encodes a complete [US-21.6] packet into a Uint8Array (MSB-first).
 */
export function encodeUsoccerPacket({
  senderId = REFEREE_ID,
  sequenceNumber = 0,
  objects = [],
  dummy = 0x00,
}) {
  const numObjects = Math.min(objects.length, 255);
  const totalLen = ENVELOPE_BYTES + numObjects * OBJECT_BYTES;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);

  // Header: 0xADDE (MSB first -> 0xAD, 0xDE)
  view.setUint16(0, HEADER_MAGIC, false);
  // Length: total bytes
  view.setUint16(2, totalLen, false);
  // ID: robot or referee ID
  view.setUint8(4, senderId & 0xff);
  // Sequence Number
  view.setUint16(5, sequenceNumber & 0xffff, false);
  // Number of Objects
  view.setUint8(7, numObjects);

  for (let i = 0; i < numObjects; i++) {
    const encodedObj = encodeObject(objects[i]);
    out.set(encodedObj, 8 + i * OBJECT_BYTES);
  }

  // Dummy byte
  view.setUint8(totalLen - 2, dummy & 0xff);
  // Checksum: sum of all preceding bytes
  const checksum = computeChecksum(out.subarray(0, totalLen - 1));
  view.setUint8(totalLen - 1, checksum);

  return out;
}

/**
 * Helper to create a standard Referee Box (ID = 32, Type = 97) packet.
 */
export function createRefereeStatePacket({
  sequenceNumber,
  teamLeftBitmask,
  teamRightBitmask,
  remainingSeconds,
  state,
}) {
  return encodeUsoccerPacket({
    senderId: REFEREE_ID,
    sequenceNumber,
    objects: [
      {
        category: "referee",
        isGameState: true,
        teamLeftBitmask,
        teamRightBitmask,
        remainingSeconds,
        state,
      },
    ],
    dummy: 0x00,
  });
}

/**
 * Decodes and validates a [US-21.6] packet from a Uint8Array or number[].
 */
export function decodeUsoccerPacket(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  if (bytes.length < ENVELOPE_BYTES) {
    throw new Error(`Packet too short: expected >= ${ENVELOPE_BYTES} bytes, got ${bytes.length}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = view.getUint16(0, false);
  if (header !== HEADER_MAGIC) {
    throw new Error(
      `Invalid header magic: expected 0xADDE, got 0x${header.toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }

  const declaredLen = view.getUint16(2, false);
  const senderId = view.getUint8(4);
  const sequenceNumber = view.getUint16(5, false);
  const numObjects = view.getUint8(7);
  const expectedLen = ENVELOPE_BYTES + numObjects * OBJECT_BYTES;

  if (bytes.length !== expectedLen || declaredLen !== expectedLen) {
    throw new Error(
      `Length mismatch: header=${declaredLen}, actual=${bytes.length}, expected=${expectedLen}`,
    );
  }

  const expectedChecksum = computeChecksum(bytes.subarray(0, expectedLen - 1));
  const actualChecksum = bytes[expectedLen - 1];
  if (expectedChecksum !== actualChecksum) {
    throw new Error(
      `Checksum mismatch: expected 0x${expectedChecksum.toString(16).toUpperCase()}, got 0x${actualChecksum.toString(16).toUpperCase()}`,
    );
  }

  const objects = [];
  for (let i = 0; i < numObjects; i++) {
    const start = 8 + i * OBJECT_BYTES;
    objects.push(decodeObject(bytes.subarray(start, start + OBJECT_BYTES)));
  }

  const dummy = bytes[expectedLen - 2];

  return {
    senderId,
    sequenceNumber,
    numObjects,
    objects,
    dummy,
    checksum: actualChecksum,
    lengthBytes: expectedLen,
  };
}
