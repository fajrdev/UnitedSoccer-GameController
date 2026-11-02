//! UDP broadcast network engine, `[US-3.6]` bandwidth/rate compliance tracker,
//! and built-in `0xADDE` robot packet simulator for FIRA HuroCup United Soccer.

use std::{
    collections::{HashMap, VecDeque},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use usoccer_msgs::{
    IntentionObjectKind, PerceptionObjectKind, StateObjectKind, UsoccerObject, UsoccerPacket,
    WireGameState, LEFT_TEAM_IDS, REFEREE_ID, RIGHT_TEAM_IDS,
};

/// Maximum allowed bytes per second per robot (`10 kBytes/s` = `10,240 B/s` per `[US-3.6]`).
pub const MAX_ROBOT_BYTES_PER_SEC: u32 = 10_240;

/// Maximum allowed messages per second per robot (`30 messages/s` per `[US-3.6]`).
pub const MAX_ROBOT_MSGS_PER_SEC: u32 = 30;

/// Configurable UDP network settings exposed in the UI Launcher and live settings bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfig {
    /// Target UDP broadcast IPv4 address (e.g. `"255.255.255.255"` or `"127.0.0.1"`).
    pub broadcast_ip: String,
    /// UDP port used for transmitting referee packets and listening for robot packets (default `3838`).
    pub port: u16,
    /// Broadcast rate in Hz during normal play (default `2` Hz, boosts to `5` Hz on stop/transition).
    pub broadcast_hz: u8,
    /// Whether the built-in `0xADDE` robot packet simulator is active.
    pub simulator_enabled: bool,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            broadcast_ip: "255.255.255.255".to_string(),
            port: 3838,
            broadcast_hz: 2,
            simulator_enabled: false,
        }
    }
}

/// `[US-3.6]` compliance status for a single robot ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BandwidthCompliance {
    Compliant,
    RateExceeded,
    BandwidthExceeded,
    ChecksumError,
}

/// Live telemetry snapshot for a single robot (`ID 0..=10` or `16..=26`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RobotTelemetrySnapshot {
    pub robot_id: u8,
    pub last_sequence_number: u16,
    pub messages_per_sec: u32,
    pub bytes_per_sec: u32,
    pub total_packets_received: u64,
    pub checksum_errors: u64,
    pub compliance: BandwidthCompliance,
    /// Milliseconds since last valid packet received.
    pub age_ms: u64,
    /// Latest decoded OwnPosition `(x_mm, y_mm, orientation_rad10000, confidence)`.
    pub own_position: Option<(u16, u16, i16, u8)>,
    /// Latest decoded Ball position `(x_mm, y_mm, confidence)`.
    pub ball_position: Option<(u16, u16, u8)>,
    /// Latest decoded Intention `(kind, target_x_mm, target_y_mm, offence)`.
    pub intention: Option<(IntentionObjectKind, u16, u16, u8)>,
    /// All objects from the most recent packet.
    pub latest_objects: Vec<UsoccerObject>,
    /// Hex dump of the most recent packet.
    pub latest_raw_hex: String,
}

/// Recent packet record for the live Packet Inspector table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketLogRecord {
    pub id: u64,
    pub sender_id: u8,
    pub is_referee: bool,
    pub sequence_number: u16,
    pub length_bytes: usize,
    pub num_objects: usize,
    pub checksum_hex: String,
    pub raw_hex: String,
    pub summary: String,
}

struct RobotWindowEntry {
    timestamps_and_sizes: VecDeque<(Instant, usize)>,
    last_seen: Instant,
    last_sequence_number: u16,
    total_packets_received: u64,
    checksum_errors: u64,
    own_position: Option<(u16, u16, i16, u8)>,
    ball_position: Option<(u16, u16, u8)>,
    intention: Option<(IntentionObjectKind, u16, u16, u8)>,
    latest_objects: Vec<UsoccerObject>,
    latest_raw_hex: String,
}

/// Sliding-window telemetry tracker for all robots & referee packets.
#[derive(Default)]
pub struct TelemetryTracker {
    robots: HashMap<u8, RobotWindowEntry>,
    pub recent_packets: VecDeque<PacketLogRecord>,
    pub total_referee_packets_sent: u64,
    pub last_referee_packet_hex: String,
    pub last_tx_error: Option<String>,
    next_packet_id: u64,
}

impl TelemetryTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn format_hex(bytes: &[u8]) -> String {
        bytes
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn record_referee_tx(&mut self, pkt: &UsoccerPacket, raw_bytes: &[u8]) {
        self.total_referee_packets_sent = self.total_referee_packets_sent.wrapping_add(1);
        let hex = Self::format_hex(raw_bytes);
        self.last_referee_packet_hex = hex.clone();
        let checksum_hex = raw_bytes
            .last()
            .map(|b| format!("0x{:02X}", b))
            .unwrap_or_else(|| "0x00".to_string());

        let summary = match pkt.objects.first() {
            Some(UsoccerObject::Referee {
                team_left_bitmask,
                team_right_bitmask,
                remaining_seconds,
                state,
                ..
            }) => format!(
                "Referee State={} | Left=0x{:03X} Right=0x{:03X} | T={}s",
                state.label(),
                team_left_bitmask,
                team_right_bitmask,
                remaining_seconds
            ),
            _ => "Referee Packet".to_string(),
        };

        self.push_packet_record(PacketLogRecord {
            id: self.next_packet_id,
            sender_id: REFEREE_ID,
            is_referee: true,
            sequence_number: pkt.sequence_number,
            length_bytes: raw_bytes.len(),
            num_objects: pkt.objects.len(),
            checksum_hex,
            raw_hex: hex,
            summary,
        });
    }

    pub fn record_incoming_datagram(&mut self, raw_bytes: &[u8]) {
        let now = Instant::now();
        let hex = Self::format_hex(raw_bytes);
        match UsoccerPacket::decode(raw_bytes) {
            Ok(pkt) => {
                if pkt.sender_id == REFEREE_ID {
                    return; // Ignore our own loopback broadcast
                }
                let entry = self
                    .robots
                    .entry(pkt.sender_id)
                    .or_insert_with(|| RobotWindowEntry {
                        timestamps_and_sizes: VecDeque::new(),
                        last_seen: now,
                        last_sequence_number: 0,
                        total_packets_received: 0,
                        checksum_errors: 0,
                        own_position: None,
                        ball_position: None,
                        intention: None,
                        latest_objects: Vec::new(),
                        latest_raw_hex: String::new(),
                    });

                entry.last_seen = now;
                entry.last_sequence_number = pkt.sequence_number;
                entry.total_packets_received += 1;
                entry
                    .timestamps_and_sizes
                    .push_back((now, raw_bytes.len()));
                while let Some(&(ts, _)) = entry.timestamps_and_sizes.front() {
                    if now.duration_since(ts) > Duration::from_secs(1) {
                        entry.timestamps_and_sizes.pop_front();
                    } else {
                        break;
                    }
                }

                for obj in &pkt.objects {
                    match *obj {
                        UsoccerObject::State {
                            kind: StateObjectKind::OwnPosition,
                            location_x_mm,
                            location_y_mm,
                            orientation_rad10000,
                            confidence,
                        }
                        | UsoccerObject::Perception {
                            kind: PerceptionObjectKind::OwnPosition,
                            location_x_mm,
                            location_y_mm,
                            orientation_rad10000,
                            confidence,
                        } => {
                            entry.own_position = Some((
                                location_x_mm,
                                location_y_mm,
                                orientation_rad10000,
                                confidence,
                            ));
                        }
                        UsoccerObject::State {
                            kind: StateObjectKind::Ball,
                            location_x_mm,
                            location_y_mm,
                            confidence,
                            ..
                        }
                        | UsoccerObject::Perception {
                            kind: PerceptionObjectKind::Ball,
                            location_x_mm,
                            location_y_mm,
                            confidence,
                            ..
                        } => {
                            entry.ball_position = Some((location_x_mm, location_y_mm, confidence));
                        }
                        UsoccerObject::Intention {
                            kind,
                            target_x_mm,
                            target_y_mm,
                            offence,
                            ..
                        } => {
                            entry.intention = Some((kind, target_x_mm, target_y_mm, offence));
                        }
                        _ => {}
                    }
                }

                let summary = format!(
                    "Robot ID #{} | {} objs{}",
                    pkt.sender_id,
                    pkt.objects.len(),
                    if let Some((x, y, _, _)) = entry.own_position {
                        format!(" | Pos=({}, {}mm)", x, y)
                    } else {
                        String::new()
                    }
                );

                entry.latest_objects = pkt.objects.clone();
                entry.latest_raw_hex = hex.clone();

                let checksum_hex = raw_bytes
                    .last()
                    .map(|b| format!("0x{:02X}", b))
                    .unwrap_or_else(|| "0x00".to_string());

                self.push_packet_record(PacketLogRecord {
                    id: self.next_packet_id,
                    sender_id: pkt.sender_id,
                    is_referee: false,
                    sequence_number: pkt.sequence_number,
                    length_bytes: raw_bytes.len(),
                    num_objects: pkt.objects.len(),
                    checksum_hex,
                    raw_hex: hex,
                    summary,
                });
            }
            Err(_err) => {
                if raw_bytes.len() >= 5 {
                    let sender_id = raw_bytes[4];
                    if sender_id != REFEREE_ID {
                        let entry =
                            self.robots
                                .entry(sender_id)
                                .or_insert_with(|| RobotWindowEntry {
                                    timestamps_and_sizes: VecDeque::new(),
                                    last_seen: now,
                                    last_sequence_number: 0,
                                    total_packets_received: 0,
                                    checksum_errors: 0,
                                    own_position: None,
                                    ball_position: None,
                                    intention: None,
                                    latest_objects: Vec::new(),
                                    latest_raw_hex: String::new(),
                                });
                        entry.checksum_errors += 1;
                    }
                }
            }
        }
    }

    fn push_packet_record(&mut self, rec: PacketLogRecord) {
        self.next_packet_id = self.next_packet_id.wrapping_add(1);
        self.recent_packets.push_front(rec);
        while self.recent_packets.len() > 35 {
            self.recent_packets.pop_back();
        }
    }

    pub fn snapshots(&self) -> Vec<RobotTelemetrySnapshot> {
        let now = Instant::now();
        let mut list = Vec::new();
        for (&robot_id, entry) in &self.robots {
            let mut msgs_per_sec = 0u32;
            let mut bytes_per_sec = 0u32;
            for &(ts, sz) in &entry.timestamps_and_sizes {
                if now.duration_since(ts) <= Duration::from_secs(1) {
                    msgs_per_sec += 1;
                    bytes_per_sec += sz as u32;
                }
            }

            let compliance = if bytes_per_sec > MAX_ROBOT_BYTES_PER_SEC {
                BandwidthCompliance::BandwidthExceeded
            } else if msgs_per_sec > MAX_ROBOT_MSGS_PER_SEC {
                BandwidthCompliance::RateExceeded
            } else {
                BandwidthCompliance::Compliant
            };

            list.push(RobotTelemetrySnapshot {
                robot_id,
                last_sequence_number: entry.last_sequence_number,
                messages_per_sec: msgs_per_sec,
                bytes_per_sec,
                total_packets_received: entry.total_packets_received,
                checksum_errors: entry.checksum_errors,
                compliance,
                age_ms: now.duration_since(entry.last_seen).as_millis() as u64,
                own_position: entry.own_position,
                ball_position: entry.ball_position,
                intention: entry.intention,
                latest_objects: entry.latest_objects.clone(),
                latest_raw_hex: entry.latest_raw_hex.clone(),
            });
        }
        list.sort_by_key(|s| s.robot_id);
        list
    }
}

/// Creates a non-blocking reusable UDP socket bound to `0.0.0.0:port` with `SO_BROADCAST` and `SO_REUSEADDR` enabled.
pub fn bind_reusable_udp_socket(port: u16) -> anyhow::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    let _ = socket.set_reuse_port(true);
    socket.set_broadcast(true)?;
    socket.set_nonblocking(true)?;
    let addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port);
    socket.bind(&SocketAddr::V4(addr).into())?;
    let std_sock: std::net::UdpSocket = socket.into();
    Ok(UdpSocket::from_std(std_sock)?)
}

/// Generates synthetic `[US-21]` `0xADDE` robot packets for the built-in simulator so operators
/// can test the UDP protocol, 2D field telemetry, and bitmask compliance without physical robots.
pub struct RobotSimulator {
    tick: u64,
    seq_by_robot: HashMap<u8, u16>,
    ball_x: f32,
    ball_y: f32,
    ball_vx: f32,
    ball_vy: f32,
}

impl Default for RobotSimulator {
    fn default() -> Self {
        Self::new()
    }
}

impl RobotSimulator {
    pub fn new() -> Self {
        Self {
            tick: 0,
            seq_by_robot: HashMap::new(),
            ball_x: 3500.0,
            ball_y: 2500.0,
            ball_vx: 140.0,
            ball_vy: 95.0,
        }
    }

    /// Generates one batch of simulated `0xADDE` packets for active robots on Left (`0..=4`) and Right (`16..=20`).
    pub fn step_packets(
        &mut self,
        wire_state: WireGameState,
        left_mask: u16,
        right_mask: u16,
    ) -> Vec<Vec<u8>> {
        self.tick = self.tick.wrapping_add(1);
        let t = (self.tick as f32) * 0.25;

        // Move simulated ball only when game is in Play (State 3, 4, or 5)
        let is_playing = matches!(
            wire_state,
            WireGameState::PlayKickOffLeft
                | WireGameState::PlayKickOffRight
                | WireGameState::PlayBallInPlay
        );
        if is_playing {
            self.ball_x += self.ball_vx;
            self.ball_y += self.ball_vy;
            if !(400.0..=6600.0).contains(&self.ball_x) {
                self.ball_vx = -self.ball_vx;
                self.ball_x = self.ball_x.clamp(400.0, 6600.0);
            }
            if !(400.0..=4600.0).contains(&self.ball_y) {
                self.ball_vy = -self.ball_vy;
                self.ball_y = self.ball_y.clamp(400.0, 4600.0);
            }
        } else if matches!(
            wire_state,
            WireGameState::SetKickOffLeft | WireGameState::SetKickOffRight
        ) {
            self.ball_x = 3500.0;
            self.ball_y = 2500.0;
        }

        let ball_x_u16 = self.ball_x.round() as u16;
        let ball_y_u16 = self.ball_y.round() as u16;

        let mut packets = Vec::new();

        // Simulate 5 Left Team robots (IDs 0..=4) and 5 Right Team robots (IDs 16..=20)
        let left_base_positions: [(f32, f32); 5] = [
            (450.0, 2500.0),  // ID 0: Goalkeeper
            (1600.0, 1400.0), // ID 1: Defender Left
            (1600.0, 3600.0), // ID 2: Defender Right
            (2700.0, 1900.0), // ID 3: Midfielder
            (3100.0, 2900.0), // ID 4: Striker
        ];
        let right_base_positions: [(f32, f32); 5] = [
            (6550.0, 2500.0), // ID 16: Goalkeeper
            (5400.0, 1400.0), // ID 17: Defender
            (5400.0, 3600.0), // ID 18: Defender
            (4300.0, 3100.0), // ID 19: Midfielder
            (3900.0, 2100.0), // ID 20: Striker
        ];

        for (slot, &(bx, by)) in left_base_positions.iter().enumerate() {
            let robot_id = slot as u8;
            let allowed = (left_mask & (1 << slot)) != 0 && is_playing;
            let (rx, ry) = if allowed {
                let dx = ((t + slot as f32).sin() * 280.0)
                    + (self.ball_x - bx) * (if slot == 0 { 0.03 } else { 0.22 });
                let dy = ((t * 0.8 + slot as f32).cos() * 240.0)
                    + (self.ball_y - by) * (if slot == 0 { 0.15 } else { 0.22 });
                (
                    (bx + dx).clamp(250.0, 6750.0) as u16,
                    (by + dy).clamp(250.0, 4750.0) as u16,
                )
            } else {
                (bx as u16, by as u16)
            };

            let seq = self.seq_by_robot.entry(robot_id).or_insert(0);
            *seq = seq.wrapping_add(1);

            let intention = if slot == 0 {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::PlayGoalKeeper,
                    target_x_mm: 500,
                    target_y_mm: ball_y_u16.clamp(1800, 3200),
                    target_orientation_rad10000: 0,
                    offence: 10,
                }
            } else if slot == 4 {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::ShotOnGoal,
                    target_x_mm: 7000,
                    target_y_mm: 2500,
                    target_orientation_rad10000: 0,
                    offence: 255,
                }
            } else {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::Movement,
                    target_x_mm: ball_x_u16,
                    target_y_mm: ball_y_u16,
                    target_orientation_rad10000: 3200,
                    offence: 128,
                }
            };

            let pkt = UsoccerPacket {
                sender_id: robot_id,
                sequence_number: *seq,
                objects: vec![
                    UsoccerObject::State {
                        kind: StateObjectKind::OwnPosition,
                        location_x_mm: rx,
                        location_y_mm: ry,
                        orientation_rad10000: 0,
                        confidence: if allowed { 245 } else { 200 },
                    },
                    UsoccerObject::Perception {
                        kind: PerceptionObjectKind::Ball,
                        location_x_mm: ball_x_u16,
                        location_y_mm: ball_y_u16,
                        orientation_rad10000: 0,
                        confidence: 230,
                    },
                    intention,
                ],
                dummy: 0,
            };
            packets.push(pkt.encode());
        }

        for (slot, &(bx, by)) in right_base_positions.iter().enumerate() {
            let robot_id = 16 + (slot as u8);
            let allowed = (right_mask & (1 << slot)) != 0 && is_playing;
            let (rx, ry) = if allowed {
                let dx = ((t * 0.9 + slot as f32).cos() * 280.0)
                    + (self.ball_x - bx) * (if slot == 0 { 0.03 } else { 0.22 });
                let dy = ((t + slot as f32).sin() * 240.0)
                    + (self.ball_y - by) * (if slot == 0 { 0.15 } else { 0.22 });
                (
                    (bx + dx).clamp(250.0, 6750.0) as u16,
                    (by + dy).clamp(250.0, 4750.0) as u16,
                )
            } else {
                (bx as u16, by as u16)
            };

            let seq = self.seq_by_robot.entry(robot_id).or_insert(0);
            *seq = seq.wrapping_add(1);

            let intention = if slot == 0 {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::PlayGoalKeeper,
                    target_x_mm: 6500,
                    target_y_mm: ball_y_u16.clamp(1800, 3200),
                    target_orientation_rad10000: -31415,
                    offence: 10,
                }
            } else if slot == 4 {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::ShotOnGoal,
                    target_x_mm: 0,
                    target_y_mm: 2500,
                    target_orientation_rad10000: -31415,
                    offence: 255,
                }
            } else {
                UsoccerObject::Intention {
                    kind: IntentionObjectKind::Movement,
                    target_x_mm: ball_x_u16,
                    target_y_mm: ball_y_u16,
                    target_orientation_rad10000: -15700,
                    offence: 128,
                }
            };

            let pkt = UsoccerPacket {
                sender_id: robot_id,
                sequence_number: *seq,
                objects: vec![
                    UsoccerObject::State {
                        kind: StateObjectKind::OwnPosition,
                        location_x_mm: rx,
                        location_y_mm: ry,
                        orientation_rad10000: -31415,
                        confidence: if allowed { 245 } else { 200 },
                    },
                    UsoccerObject::Perception {
                        kind: PerceptionObjectKind::Ball,
                        location_x_mm: ball_x_u16,
                        location_y_mm: ball_y_u16,
                        orientation_rad10000: 0,
                        confidence: 225,
                    },
                    intention,
                ],
                dummy: 0,
            };
            packets.push(pkt.encode());
        }

        let _ = (LEFT_TEAM_IDS, RIGHT_TEAM_IDS);
        packets
    }
}
