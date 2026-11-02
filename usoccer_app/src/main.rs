#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;
use usoccer_core::{
    CompetitionCategory, LeaderboardEntry, MatchState, RefereeAction, UnitedSoccerController,
};
use usoccer_msgs::WireGameState;
use usoccer_net::{
    bind_reusable_udp_socket, NetworkConfig, PacketLogRecord, RobotSimulator,
    RobotTelemetrySnapshot, TelemetryTracker,
};

/// Complete snapshot pushed to the React UI on every state change or network tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSnapshot {
    pub match_state: MatchState,
    pub wire_state: WireGameState,
    pub wire_state_label: String,
    pub left_bitmask: u16,
    pub right_bitmask: u16,
    pub left_max_players: u8,
    pub right_max_players: u8,
    pub leaderboard: Vec<LeaderboardEntry>,
    pub undo_labels: Vec<String>,
    pub network_config: NetworkConfig,
    pub total_referee_packets_sent: u64,
    pub last_referee_packet_hex: String,
    pub last_tx_error: Option<String>,
    pub robot_telemetry: Vec<RobotTelemetrySnapshot>,
    pub recent_packets: Vec<PacketLogRecord>,
}

struct SharedBackend {
    controller: UnitedSoccerController,
    network_config: NetworkConfig,
    telemetry: TelemetryTracker,
    simulator: RobotSimulator,
}

impl SharedBackend {
    fn new() -> Self {
        let mut controller = UnitedSoccerController::new(CompetitionCategory::KidSize);
        let mut telemetry = TelemetryTracker::new();
        let preview = controller.state.preview_referee_packet();
        let encoded = preview.encode();
        telemetry.record_referee_tx(&preview, &encoded);
        let _ = &mut controller;

        Self {
            controller,
            network_config: NetworkConfig::default(),
            telemetry,
            simulator: RobotSimulator::new(),
        }
    }

    fn build_snapshot(&self) -> UiSnapshot {
        let match_state = self.controller.state.clone();
        let wire_state = match_state.wire_game_state();
        let (left_bitmask, right_bitmask) = match_state.team_bitmasks();
        let left_max_players = match_state
            .left_team
            .effective_max_players(match_state.category);
        let right_max_players = match_state
            .right_team
            .effective_max_players(match_state.category);
        let leaderboard = match_state.compute_leaderboard();
        let undo_labels = self
            .controller
            .undo_stack
            .iter()
            .rev()
            .take(8)
            .map(|u| u.label.clone())
            .collect();

        UiSnapshot {
            match_state,
            wire_state,
            wire_state_label: wire_state.label().to_string(),
            left_bitmask,
            right_bitmask,
            left_max_players,
            right_max_players,
            leaderboard,
            undo_labels,
            network_config: self.network_config.clone(),
            total_referee_packets_sent: self.telemetry.total_referee_packets_sent,
            last_referee_packet_hex: self.telemetry.last_referee_packet_hex.clone(),
            last_tx_error: self.telemetry.last_tx_error.clone(),
            robot_telemetry: self.telemetry.snapshots(),
            recent_packets: self.telemetry.recent_packets.iter().cloned().collect(),
        }
    }
}

struct AppState {
    inner: Arc<Mutex<SharedBackend>>,
    immediate_tx: Arc<Notify>,
    rebind_socket: Arc<Notify>,
}

#[tauri::command]
fn get_ui_state(state: State<'_, AppState>) -> UiSnapshot {
    let guard = state.inner.lock().expect("backend mutex poisoned");
    guard.build_snapshot()
}

#[tauri::command]
fn apply_action(
    app: AppHandle,
    state: State<'_, AppState>,
    action: RefereeAction,
) -> UiSnapshot {
    let snapshot = {
        let mut guard = state.inner.lock().expect("backend mutex poisoned");
        guard.controller.apply_action(action);
        guard.build_snapshot()
    };
    state.immediate_tx.notify_one();
    let _ = app.emit("state", &snapshot);
    snapshot
}

#[tauri::command]
fn update_network_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: NetworkConfig,
) -> UiSnapshot {
    let port_changed;
    let snapshot = {
        let mut guard = state.inner.lock().expect("backend mutex poisoned");
        port_changed = guard.network_config.port != config.port;
        guard.network_config = config;
        guard.build_snapshot()
    };
    if port_changed {
        state.rebind_socket.notify_one();
    }
    state.immediate_tx.notify_one();
    let _ = app.emit("state", &snapshot);
    snapshot
}

#[tauri::command]
fn step_simulator_once(app: AppHandle, state: State<'_, AppState>) -> UiSnapshot {
    let snapshot = {
        let mut guard = state.inner.lock().expect("backend mutex poisoned");
        let wire_state = guard.controller.state.wire_game_state();
        let (left_mask, right_mask) = guard.controller.state.team_bitmasks();
        let packets = guard
            .simulator
            .step_packets(wire_state, left_mask, right_mask);
        for raw in packets {
            guard.telemetry.record_incoming_datagram(&raw);
        }
        guard.build_snapshot()
    };
    let _ = app.emit("state", &snapshot);
    snapshot
}

fn spawn_background_runtime(
    app: AppHandle,
    shared: Arc<Mutex<SharedBackend>>,
    immediate_tx: Arc<Notify>,
    rebind_socket: Arc<Notify>,
) {
    // 1. 1-Hz Match Clock & Simulator Loop
    let app_clock = app.clone();
    let shared_clock = shared.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            let snapshot = {
                let mut guard = shared_clock.lock().expect("backend mutex poisoned");
                guard.controller.state.tick_one_second();
                guard.build_snapshot()
            };
            let _ = app_clock.emit("state", &snapshot);
        }
    });

    // 2. UDP Broadcast Sender + Receiver + Simulator Loop
    tauri::async_runtime::spawn(async move {
        loop {
            let port = {
                let guard = shared.lock().expect("backend mutex poisoned");
                guard.network_config.port
            };

            let socket = match bind_reusable_udp_socket(port) {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    {
                        let mut guard = shared.lock().expect("backend mutex poisoned");
                        guard.telemetry.last_tx_error =
                            Some(format!("UDP bind error on port {}: {}", port, e));
                    }
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(2)) => continue,
                        _ = rebind_socket.notified() => continue,
                    }
                }
            };

            let mut recv_buf = [0u8; 4096];
            let mut broadcast_interval = tokio::time::interval(Duration::from_millis(500));
            let mut sim_interval = tokio::time::interval(Duration::from_millis(250));

            loop {
                tokio::select! {
                    _ = rebind_socket.notified() => {
                        break; // Re-bind on new port
                    }
                    _ = immediate_tx.notified() => {
                        send_referee_datagram(&app, &shared, &socket).await;
                    }
                    _ = broadcast_interval.tick() => {
                        send_referee_datagram(&app, &shared, &socket).await;
                    }
                    _ = sim_interval.tick() => {
                        let sim_packets = {
                            let mut guard = shared.lock().expect("backend mutex poisoned");
                            if guard.network_config.simulator_enabled {
                                let wire_state = guard.controller.state.wire_game_state();
                                let (left_mask, right_mask) = guard.controller.state.team_bitmasks();
                                let pkts = guard.simulator.step_packets(wire_state, left_mask, right_mask);
                                let port = guard.network_config.port;
                                Some((pkts, port))
                            } else {
                                None
                            }
                        };

                        if let Some((pkts, target_port)) = sim_packets {
                            let loopback_target: SocketAddr = format!("127.0.0.1:{}", target_port)
                                .parse()
                                .unwrap();
                            for raw in pkts {
                                if socket.send_to(&raw, loopback_target).await.is_err() {
                                    let mut guard = shared.lock().expect("backend mutex poisoned");
                                    guard.telemetry.record_incoming_datagram(&raw);
                                }
                            }
                        }
                    }
                    recv_res = socket.recv_from(&mut recv_buf) => {
                        if let Ok((len, _addr)) = recv_res {
                            let bytes = &recv_buf[..len];
                            let snapshot = {
                                let mut guard = shared.lock().expect("backend mutex poisoned");
                                guard.telemetry.record_incoming_datagram(bytes);
                                guard.build_snapshot()
                            };
                            let _ = app.emit("state", &snapshot);
                        }
                    }
                }
            }
        }
    });
}

async fn send_referee_datagram(
    app: &AppHandle,
    shared: &Arc<Mutex<SharedBackend>>,
    socket: &UdpSocket,
) {
    use tokio::net::UdpSocket;
    let (pkt, raw_bytes, target_str) = {
        let mut guard = shared.lock().expect("backend mutex poisoned");
        let pkt = guard.controller.state.next_referee_packet();
        let raw_bytes = pkt.encode();
        let target_str = format!(
            "{}:{}",
            guard.network_config.broadcast_ip, guard.network_config.port
        );
        (pkt, raw_bytes, target_str)
    };

    let tx_err = match target_str.parse::<SocketAddr>() {
        Ok(addr) => socket.send_to(&raw_bytes, addr).await.err().map(|e| e.to_string()),
        Err(e) => Some(format!("Invalid broadcast address '{}': {}", target_str, e)),
    };

    let snapshot = {
        let mut guard = shared.lock().expect("backend mutex poisoned");
        guard.telemetry.record_referee_tx(&pkt, &raw_bytes);
        guard.telemetry.last_tx_error = tx_err;
        guard.build_snapshot()
    };
    let _ = app.emit("state", &snapshot);
}

fn main() {
    let shared = Arc::new(Mutex::new(SharedBackend::new()));
    let immediate_tx = Arc::new(Notify::new());
    let rebind_socket = Arc::new(Notify::new());

    let shared_setup = shared.clone();
    let immediate_setup = immediate_tx.clone();
    let rebind_setup = rebind_socket.clone();

    tauri::Builder::default()
        .manage(AppState {
            inner: shared,
            immediate_tx,
            rebind_socket,
        })
        .setup(move |app| {
            spawn_background_runtime(
                app.handle().clone(),
                shared_setup,
                immediate_setup,
                rebind_setup,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_ui_state,
            apply_action,
            update_network_config,
            step_simulator_once
        ])
        .run(tauri::generate_context!())
        .expect("error while running FIRA HuroCup United Soccer GameController");
}
