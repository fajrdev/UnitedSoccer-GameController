//! FIRA HuroCup United Soccer Communication Protocol (`[US-21]`).
//!
//! Specification highlights (`unitedsoccer-rules-hurocup.md` `[US-21]`):
//! - Byte order: Most Significant Byte first (Big-Endian / network byte order) `[US-21.3]`.
//! - Max message length: 65536 bytes `[US-21.4]`.
//! - Transport: UDP/IP broadcast messages `[US-21.5]`.
//! - Robot & Referee IDs `[US-21.7]`:
//!   - Left goal defending robots: `0..=10`
//!   - Right goal defending robots: `16..=26`
//!   - Referee Box: `32` (`0x20`)
//! - Packet format `[US-21.6]`:
//!   - `Header`: `UINT16` = `0xADDE`
//!   - `Length`: `UINT16` = Total message length in bytes (`10 + 8 * num_objects`)
//!   - `ID`: `UINT8` = Robot or Referee ID
//!   - `Sequence Number`: `UINT16` = Incremented for each message sent
//!   - `Number of Objects`: `UINT8` = `NUM`
//!   - `Objects`: `OBJECTS[NUM]` (each object is 8 bytes)
//!   - `Dummy`: `UINT8` = `0x00`
//!   - `Checksum`: `UINT8` = Wrapping 8-bit sum of all preceding bytes in the message

use std::ops::RangeInclusive;

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use thiserror::Error;

/// Protocol magic header (`0xADDE`, sent MSB-first as `[0xAD, 0xDE]`).
pub const HEADER_MAGIC: u16 = 0xADDE;

/// Special ID assigned to the referee box (`[US-21.7]`).
pub const REFEREE_ID: u8 = 32;

/// Valid robot IDs for the team defending the left goal (`[US-21.7]`).
pub const LEFT_TEAM_IDS: RangeInclusive<u8> = 0..=10;

/// Valid robot IDs for the team defending the right goal (`[US-21.7]`).
pub const RIGHT_TEAM_IDS: RangeInclusive<u8> = 16..=26;

/// Size in bytes of a fixed packet envelope (without objects):
/// Header(2) + Length(2) + ID(1) + Seq(2) + NumObjects(1) + Dummy(1) + Checksum(1) = 10 bytes.
pub const ENVELOPE_BYTES: usize = 10;

/// Every object in `[US-21]` is 8 bytes.
pub const OBJECT_BYTES: usize = 8;

/// Errors that can occur when decoding or validating a `[US-21]` packet.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum PacketError {
    #[error("packet too short: expected at least {ENVELOPE_BYTES} bytes, got {0}")]
    TooShort(usize),
    #[error("invalid header magic: expected 0xADDE, got 0x{0:04X}")]
    InvalidHeader(u16),
    #[error("length mismatch: header says {declared} bytes, actual buffer is {actual} bytes, expected {expected} for {num_objects} objects")]
    LengthMismatch {
        declared: u16,
        actual: usize,
        expected: usize,
        num_objects: u8,
    },
    #[error("checksum mismatch: expected 0x{expected:02X}, got 0x{actual:02X}")]
    ChecksumMismatch { expected: u8, actual: u8 },
}

/// Wire states transmitted inside the Referee Object (`Type = 97`, `[US-21.23]`).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr, Default,
)]
#[repr(u8)]
pub enum WireGameState {
    /// `0 = Game stopped`
    #[default]
    Stopped = 0,
    /// `1 = Set: Kick off Left Team`
    SetKickOffLeft = 1,
    /// `2 = Set: Kick off Right Team`
    SetKickOffRight = 2,
    /// `3 = Play: Kick off Left Team`
    PlayKickOffLeft = 3,
    /// `4 = Play: Kick off Right Team`
    PlayKickOffRight = 4,
    /// `5 = Play: Ball in play`
    PlayBallInPlay = 5,
}

impl WireGameState {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Stopped,
            1 => Self::SetKickOffLeft,
            2 => Self::SetKickOffRight,
            3 => Self::PlayKickOffLeft,
            4 => Self::PlayKickOffRight,
            5 => Self::PlayBallInPlay,
            _ => Self::Stopped,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Stopped => "0: Game Stopped",
            Self::SetKickOffLeft => "1: Set — Kick-Off Left Team",
            Self::SetKickOffRight => "2: Set — Kick-Off Right Team",
            Self::PlayKickOffLeft => "3: Play — Kick-Off Left Team",
            Self::PlayKickOffRight => "4: Play — Kick-Off Right Team",
            Self::PlayBallInPlay => "5: Play — Ball in Play",
        }
    }
}

/// State Object types (`0..=6`, `[US-21.16]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StateObjectKind {
    Undefined,
    OwnPosition,
    Ball,
    TeamRobot,
    OpponentRobot,
    TeamGoal,
    OpponentGoal,
    Unknown(u8),
}

impl StateObjectKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Undefined,
            1 => Self::OwnPosition,
            2 => Self::Ball,
            3 => Self::TeamRobot,
            4 => Self::OpponentRobot,
            5 => Self::TeamGoal,
            6 => Self::OpponentGoal,
            other => Self::Unknown(other),
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Undefined => 0,
            Self::OwnPosition => 1,
            Self::Ball => 2,
            Self::TeamRobot => 3,
            Self::OpponentRobot => 4,
            Self::TeamGoal => 5,
            Self::OpponentGoal => 6,
            Self::Unknown(v) => v,
        }
    }
}

/// Perception Object types (`32..=40`, `[US-21.18]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerceptionObjectKind {
    Undefined,
    OwnPosition,
    Ball,
    TeamRobot,
    OpponentRobot,
    TeamGoal,
    OpponentGoal,
    FieldLine,
    CenterCircleArc,
    Unknown(u8),
}

impl PerceptionObjectKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            32 => Self::Undefined,
            33 => Self::OwnPosition,
            34 => Self::Ball,
            35 => Self::TeamRobot,
            36 => Self::OpponentRobot,
            37 => Self::TeamGoal,
            38 => Self::OpponentGoal,
            39 => Self::FieldLine,
            40 => Self::CenterCircleArc,
            other => Self::Unknown(other),
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Undefined => 32,
            Self::OwnPosition => 33,
            Self::Ball => 34,
            Self::TeamRobot => 35,
            Self::OpponentRobot => 36,
            Self::TeamGoal => 37,
            Self::OpponentGoal => 38,
            Self::FieldLine => 39,
            Self::CenterCircleArc => 40,
            Self::Unknown(v) => v,
        }
    }
}

/// Intention Object types (`64..=67`, `[US-21.19]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IntentionObjectKind {
    Undefined,
    ShotOnGoal,
    PlayGoalKeeper,
    Movement,
    Unknown(u8),
}

impl IntentionObjectKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            64 => Self::Undefined,
            65 => Self::ShotOnGoal,
            66 => Self::PlayGoalKeeper,
            67 => Self::Movement,
            other => Self::Unknown(other),
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Undefined => 64,
            Self::ShotOnGoal => 65,
            Self::PlayGoalKeeper => 66,
            Self::Movement => 67,
            Self::Unknown(v) => v,
        }
    }
}

/// An 8-byte object inside a `[US-21]` packet (`[US-21.8]`–`[US-21.25]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "category", rename_all = "camelCase")]
pub enum UsoccerObject {
    /// State Object (`0..=31`, `[US-21.16]`)
    State {
        kind: StateObjectKind,
        location_x_mm: u16,
        location_y_mm: u16,
        orientation_rad10000: i16,
        confidence: u8,
    },
    /// Perception Object (`32..=63`, `[US-21.18]`)
    Perception {
        kind: PerceptionObjectKind,
        location_x_mm: u16,
        location_y_mm: u16,
        orientation_rad10000: i16,
        confidence: u8,
    },
    /// Intention Object (`64..=95`, `[US-21.19]`)
    Intention {
        kind: IntentionObjectKind,
        target_x_mm: u16,
        target_y_mm: u16,
        target_orientation_rad10000: i16,
        offence: u8,
    },
    /// Referee Object (`96..=127`, `[US-21.23]`)
    Referee {
        is_game_state: bool,
        team_left_bitmask: u16,
        team_right_bitmask: u16,
        remaining_seconds: i16,
        state: WireGameState,
    },
    /// Extension Object (`128..=255`, `[US-21.25]`)
    Extension {
        type_id: u8,
        user1: u16,
        user2: u16,
        user3: i16,
        user4: u8,
    },
}

impl UsoccerObject {
    /// Encodes the object into its 8-byte MSB-first representation.
    pub fn encode(&self) -> [u8; OBJECT_BYTES] {
        let mut out = [0u8; OBJECT_BYTES];
        match *self {
            Self::State {
                kind,
                location_x_mm,
                location_y_mm,
                orientation_rad10000,
                confidence,
            } => {
                out[0] = kind.to_u8();
                out[1..3].copy_from_slice(&location_x_mm.to_be_bytes());
                out[3..5].copy_from_slice(&location_y_mm.to_be_bytes());
                out[5..7].copy_from_slice(&orientation_rad10000.to_be_bytes());
                out[7] = confidence;
            }
            Self::Perception {
                kind,
                location_x_mm,
                location_y_mm,
                orientation_rad10000,
                confidence,
            } => {
                out[0] = kind.to_u8();
                out[1..3].copy_from_slice(&location_x_mm.to_be_bytes());
                out[3..5].copy_from_slice(&location_y_mm.to_be_bytes());
                out[5..7].copy_from_slice(&orientation_rad10000.to_be_bytes());
                out[7] = confidence;
            }
            Self::Intention {
                kind,
                target_x_mm,
                target_y_mm,
                target_orientation_rad10000,
                offence,
            } => {
                out[0] = kind.to_u8();
                out[1..3].copy_from_slice(&target_x_mm.to_be_bytes());
                out[3..5].copy_from_slice(&target_y_mm.to_be_bytes());
                out[5..7].copy_from_slice(&target_orientation_rad10000.to_be_bytes());
                out[7] = offence;
            }
            Self::Referee {
                is_game_state,
                team_left_bitmask,
                team_right_bitmask,
                remaining_seconds,
                state,
            } => {
                out[0] = if is_game_state { 97 } else { 96 };
                out[1..3].copy_from_slice(&team_left_bitmask.to_be_bytes());
                out[3..5].copy_from_slice(&team_right_bitmask.to_be_bytes());
                out[5..7].copy_from_slice(&remaining_seconds.to_be_bytes());
                out[7] = state as u8;
            }
            Self::Extension {
                type_id,
                user1,
                user2,
                user3,
                user4,
            } => {
                out[0] = type_id;
                out[1..3].copy_from_slice(&user1.to_be_bytes());
                out[3..5].copy_from_slice(&user2.to_be_bytes());
                out[5..7].copy_from_slice(&user3.to_be_bytes());
                out[7] = user4;
            }
        }
        out
    }

    /// Decodes an 8-byte MSB-first slice into a `UsoccerObject`.
    pub fn decode(bytes: &[u8; OBJECT_BYTES]) -> Self {
        let type_byte = bytes[0];
        let u1 = u16::from_be_bytes([bytes[1], bytes[2]]);
        let u2 = u16::from_be_bytes([bytes[3], bytes[4]]);
        let i3 = i16::from_be_bytes([bytes[5], bytes[6]]);
        let b4 = bytes[7];

        match type_byte {
            0..=31 => Self::State {
                kind: StateObjectKind::from_u8(type_byte),
                location_x_mm: u1,
                location_y_mm: u2,
                orientation_rad10000: i3,
                confidence: b4,
            },
            32..=63 => Self::Perception {
                kind: PerceptionObjectKind::from_u8(type_byte),
                location_x_mm: u1,
                location_y_mm: u2,
                orientation_rad10000: i3,
                confidence: b4,
            },
            64..=95 => Self::Intention {
                kind: IntentionObjectKind::from_u8(type_byte),
                target_x_mm: u1,
                target_y_mm: u2,
                target_orientation_rad10000: i3,
                offence: b4,
            },
            96..=127 => Self::Referee {
                is_game_state: type_byte == 97,
                team_left_bitmask: u1,
                team_right_bitmask: u2,
                remaining_seconds: i3,
                state: WireGameState::from_u8(b4),
            },
            128..=255 => Self::Extension {
                type_id: type_byte,
                user1: u1,
                user2: u2,
                user3: i3,
                user4: b4,
            },
        }
    }
}

/// Complete `[US-21.6]` message frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsoccerPacket {
    /// Robot ID (`0..=10` Left, `16..=26` Right) or Referee ID (`32`).
    pub sender_id: u8,
    /// Sequence number incremented for each message sent (`[US-21.6]`).
    pub sequence_number: u16,
    /// Array of 8-byte objects (`[US-21.6]`).
    pub objects: Vec<UsoccerObject>,
    /// Reserved dummy byte (`0x00` for now, `[US-21.6]`).
    pub dummy: u8,
}

impl UsoccerPacket {
    /// Creates a standard Referee Box (`ID = 32`) broadcast packet with a single `Type = 97` Game State object.
    pub fn new_referee_state(
        sequence_number: u16,
        team_left_bitmask: u16,
        team_right_bitmask: u16,
        remaining_seconds: i16,
        state: WireGameState,
    ) -> Self {
        Self {
            sender_id: REFEREE_ID,
            sequence_number,
            objects: vec![UsoccerObject::Referee {
                is_game_state: true,
                team_left_bitmask,
                team_right_bitmask,
                remaining_seconds,
                state,
            }],
            dummy: 0x00,
        }
    }

    /// Computes the wrapping 8-bit sum over a byte slice (`[US-21.6]`).
    pub fn compute_checksum(bytes_without_checksum: &[u8]) -> u8 {
        bytes_without_checksum
            .iter()
            .fold(0u8, |acc, &b| acc.wrapping_add(b))
    }

    /// Encodes the packet into a big-endian byte vector ready for UDP broadcast.
    pub fn encode(&self) -> Vec<u8> {
        let num_objects = self.objects.len().min(u8::MAX as usize) as u8;
        let total_len = (ENVELOPE_BYTES + (num_objects as usize) * OBJECT_BYTES) as u16;

        let mut buf = Vec::with_capacity(total_len as usize);
        buf.extend_from_slice(&HEADER_MAGIC.to_be_bytes());
        buf.extend_from_slice(&total_len.to_be_bytes());
        buf.push(self.sender_id);
        buf.extend_from_slice(&self.sequence_number.to_be_bytes());
        buf.push(num_objects);

        for obj in self.objects.iter().take(num_objects as usize) {
            buf.extend_from_slice(&obj.encode());
        }

        buf.push(self.dummy);
        let checksum = Self::compute_checksum(&buf);
        buf.push(checksum);
        buf
    }

    /// Decodes and validates a `[US-21]` packet from raw UDP bytes.
    pub fn decode(buf: &[u8]) -> Result<Self, PacketError> {
        if buf.len() < ENVELOPE_BYTES {
            return Err(PacketError::TooShort(buf.len()));
        }

        let header = u16::from_be_bytes([buf[0], buf[1]]);
        if header != HEADER_MAGIC {
            return Err(PacketError::InvalidHeader(header));
        }

        let declared_len = u16::from_be_bytes([buf[2], buf[3]]);
        let sender_id = buf[4];
        let sequence_number = u16::from_be_bytes([buf[5], buf[6]]);
        let num_objects = buf[7];

        let expected_len = ENVELOPE_BYTES + (num_objects as usize) * OBJECT_BYTES;
        if buf.len() != expected_len || (declared_len as usize) != expected_len {
            return Err(PacketError::LengthMismatch {
                declared: declared_len,
                actual: buf.len(),
                expected: expected_len,
                num_objects,
            });
        }

        let expected_checksum = Self::compute_checksum(&buf[..expected_len - 1]);
        let actual_checksum = buf[expected_len - 1];
        if expected_checksum != actual_checksum {
            return Err(PacketError::ChecksumMismatch {
                expected: expected_checksum,
                actual: actual_checksum,
            });
        }

        let mut objects = Vec::with_capacity(num_objects as usize);
        for i in 0..(num_objects as usize) {
            let offset = 8 + i * OBJECT_BYTES;
            let slice: &[u8; OBJECT_BYTES] = buf[offset..offset + OBJECT_BYTES]
                .try_into()
                .expect("slice length checked");
            objects.push(UsoccerObject::decode(slice));
        }

        let dummy = buf[expected_len - 2];

        Ok(Self {
            sender_id,
            sequence_number,
            objects,
            dummy,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn referee_packet_roundtrip_and_wire_layout() {
        let pkt = UsoccerPacket::new_referee_state(
            42,
            0b0000_0000_0001_1111, // Left team robots 0..4 allowed
            0b0000_0000_0001_0111, // Right team robots 16,17,18,20 allowed
            598,
            WireGameState::PlayKickOffLeft,
        );

        let bytes = pkt.encode();
        // 10 envelope bytes + 8 object bytes = 18 bytes
        assert_eq!(bytes.len(), 18);
        // Header 0xADDE MSB first
        assert_eq!(&bytes[0..2], &[0xAD, 0xDE]);
        // Length = 18 (0x0012)
        assert_eq!(&bytes[2..4], &[0x00, 0x12]);
        // Referee ID = 32 (0x20)
        assert_eq!(bytes[4], 32);
        // Sequence Number = 42 (0x002A)
        assert_eq!(&bytes[5..7], &[0x00, 0x2A]);
        // Number of objects = 1
        assert_eq!(bytes[7], 1);
        // Referee Object Type = 97
        assert_eq!(bytes[8], 97);
        // Team Left bitmask = 0x001F
        assert_eq!(&bytes[9..11], &[0x00, 0x1F]);
        // Team Right bitmask = 0x0017
        assert_eq!(&bytes[11..13], &[0x00, 0x17]);
        // Remaining time = 598 (0x0256)
        assert_eq!(&bytes[13..15], &[0x02, 0x56]);
        // State = 3 (Play: Kick off Left Team)
        assert_eq!(bytes[15], 3);
        // Dummy = 0x00
        assert_eq!(bytes[16], 0x00);

        let decoded = UsoccerPacket::decode(&bytes).expect("valid packet should decode");
        assert_eq!(decoded, pkt);
    }

    #[test]
    fn robot_multi_object_roundtrip() {
        let pkt = UsoccerPacket {
            sender_id: 16, // Right team goalkeeper
            sequence_number: 1025,
            objects: vec![
                UsoccerObject::State {
                    kind: StateObjectKind::OwnPosition,
                    location_x_mm: 3500,
                    location_y_mm: 1200,
                    orientation_rad10000: -18023,
                    confidence: 240,
                },
                UsoccerObject::Perception {
                    kind: PerceptionObjectKind::Ball,
                    location_x_mm: 4100,
                    location_y_mm: 2500,
                    orientation_rad10000: 0,
                    confidence: 255,
                },
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::ShotOnGoal,
                    target_x_mm: 7000,
                    target_y_mm: 2500,
                    target_orientation_rad10000: 15708,
                    offence: 255,
                },
                UsoccerObject::Extension {
                    type_id: 128,
                    user1: 0x1234,
                    user2: 0x5678,
                    user3: -42,
                    user4: 99,
                },
            ],
            dummy: 0,
        };

        let bytes = pkt.encode();
        assert_eq!(bytes.len(), 10 + 4 * 8);
        let decoded = UsoccerPacket::decode(&bytes).expect("valid multi-object packet");
        assert_eq!(decoded, pkt);
    }

    #[test]
    fn invalid_checksum_and_header_rejected() {
        let pkt = UsoccerPacket::new_referee_state(1, 0x1F, 0x1F, 600, WireGameState::Stopped);
        let mut bytes = pkt.encode();
        bytes[17] ^= 0xFF;
        assert!(matches!(
            UsoccerPacket::decode(&bytes),
            Err(PacketError::ChecksumMismatch { .. })
        ));

        let mut bad_header = pkt.encode();
        bad_header[0] = 0xDE;
        bad_header[1] = 0xAD; // Little-endian mistake should be caught!
        assert!(matches!(
            UsoccerPacket::decode(&bad_header),
            Err(PacketError::InvalidHeader(0xDEAD))
        ));
    }
}
