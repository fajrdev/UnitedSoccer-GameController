# FIRA HuroCup United Soccer — GameController (`[US-21]`)

A dedicated, modern **GameController & Referee Box** for the **FIRA HuroCup United Soccer** humanoid robotics league, built with **Tauri 2 (Rust backend + React 19 / Tailwind CSS v4 frontend)** and a built-in **Node.js `dgram` real UDP bridge** for zero-dependency browser execution.

All rules, game states, penalties, individual robot scoring (`[US-19]`/`[US-20]`), and binary wire packets (`[US-21]`) strictly follow:
- [`unitedsoccer-rules-hurocup.md`](./unitedsoccer-rules-hurocup.md)
- [`general-rules-hurocup.md`](./general-rules-hurocup.md)

---

## Quick Start

### 1. Run Directly as a Desktop Application (`./GameController`)

Just like the RoboCup GameController, you can launch the standalone desktop application directly from the terminal without opening a browser tab:

```bash
./GameController
# or:
./UnitedSoccerGameController
# or:
./bin/GameController
```

Supported CLI options (`./GameController -h`):
- `-p, --port <PORT>`: UDP broadcast/listen port for `0xADDE` packets (default: `3838`)
- `-b, --broadcast <IP>`: UDP broadcast IPv4 address (default: `255.255.255.255`)
- `-f, --fullscreen`: Start the GameController window in fullscreen mode
- `--headless`: Run only the `[US-21]` UDP & UI engine without opening a GUI window

### 2. Match Categories & Freeform Training Mode (1v1 .. 11v11)

- **Kid Size (`kidSize`)**: Official 5v5 + 2 Substitutes with yellow tennis ball (`[US-2.1]`, `[US-4.1]`).
- **Adult Size (`adultSize`)**: Official 3v3 + 2 Substitutes with orange youth ball (`[US-2.1]`, `[US-4.1]`).
- **Training / Freeform Mode (`training`)**: Designed for lab development, testing with 2 robots (**1v1**), 2v2, or any custom player configuration. Slots are not locked to 5v5, and individual slot roles can be assigned freely.

### 3. Multi-Network Interface Selector

When your computer is connected to multiple network interfaces (e.g. WiFi and Ethernet / loopback):
- In **Match & Roster Setup → 2. Network Interface & UDP**, select the network interface to focus (e.g. `wlo1`, `eth0`, `lo`, or `all`).
- The GameController automatically binds the outgoing UDP broadcast socket to that interface's IPv4 address and computes its directed subnet broadcast IP.

### 4. Permanent YAML Configuration (`config/settings.yaml` & `config/teams.yaml`)

Configuration persists across restarts and can be edited in plain YAML:
- [`config/settings.yaml`](./config/settings.yaml): Match category, training mode player count, half duration, UDP port, broadcast IP, and focused network interface.
- [`config/teams.yaml`](./config/teams.yaml): Left/Right team names, colors, all 11 player slot assignments (`originClub`, `robotName`, `role`), and the club pool.
- You can edit these YAML files directly or click **"Save as Permanent Default (YAML)"** inside the UI's Setup modal.

### 5. Automated Unit Tests & Build

```bash
cd frontend
npm test        # Runs 9 automated unit tests ([US-21] protocol, [US-19/20] scoring, 1v1 training mode, UDP socket)
npm run build   # Rebuilds production bundle used by ./GameController
```

---

## `[US-21]` Binary UDP Communication Protocol

Unlike RoboCup's little-endian `RGme` struct, FIRA HuroCup United Soccer uses an **MSB-first (Big-Endian)** object-based UDP broadcast frame (`[US-21.3]`–`[US-21.25]`):

| Byte Offset | Field | Type | Value / Description |
| :--- | :--- | :--- | :--- |
| `0..2` | `Header` | `UINT16` (BE) | `0xADDE` (`[0xAD, 0xDE]`) |
| `2..4` | `Length` | `UINT16` (BE) | Total packet length in bytes (`10 + 8 * num_objects`) |
| `4` | `ID` | `UINT8` | `0..10` (Left Team), `16..26` (Right Team), `32` (`0x20` Referee Box) |
| `5..7` | `Sequence Number` | `UINT16` (BE) | Incremented for each message sent |
| `7` | `Number of Objects` | `UINT8` | `NUM` |
| `8..8+8*NUM` | `Objects` | `Object[NUM]` | 8 bytes per object (`State`, `Perception`, `Intention`, `Referee`, `Extension`) |
| `8+8*NUM` | `Dummy` | `UINT8` | `0x00` |
| `9+8*NUM` | `Checksum` | `UINT8` | Wrapping 8-bit sum of all preceding bytes in the message |

### Referee Object (`Type = 97`, 8 Bytes, Sent by `ID = 32`)

| Object Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0` | `Type` | `UINT8` | `97` (`0x61`) = Game State (`96` = UNDEFINED) |
| `1..3` | `Team Left` | `UINT16` (BE) | Bitmask of Left Team players (`IDs 0..10`) allowed to play. Bit `0` = must remain motionless / penalized (`[US-21.22]`). |
| `3..5` | `Team Right` | `UINT16` (BE) | Bitmask of Right Team players (`IDs 16..26`) allowed to play. |
| `5..7` | `Time` | `INT16` (BE) | Remaining seconds in the current period of play. |
| `7` | `State` | `UINT8` | `0` = Game stopped<br>`1` = Set: Kick off Left Team<br>`2` = Set: Kick off Right Team<br>`3` = Play: Kick off Left Team<br>`4` = Play: Kick off Right Team<br>`5` = Play: Ball in play |

---

## Key Differences from RoboCup 2026 GameController

1. **United Team Formation (`[US-8.1]`)**: Teams are formed by randomly combining robots from different clubs up to **5 players/team (Kid Size)** or **3 players/team (Adult Size)** plus up to **2 substitutes (`[US-4.3]`)**.
2. **Individual Robot Scoring & Tiebreakers (`[US-19]`, `[US-20]`)**:
   - Goal Scored by Robot: **+10 pts**
   - Save Preventing a Goal: **+7 pts**
   - Kicking Ball at a Passing Pole (`[US-1.21]`): **+2 pts**
   - Goal Scored by a Teammate: **+2 pts**
   - Goal Scored by Opposing Team: **-2 pts**
   - 30-Second Removal Penalty: **-1 pt**
   - Any robot with `< 1` point receives **0 points and no rank (`[US-19.2]`)**.
3. **Removed Unused RoboCup Set Plays**: Direct Free Kick, Indirect Free Kick, Goal Kick, Corner Kick, and stopped Throw-In set plays are excluded because in FIRA United Soccer any ball crossing the touch line or goal line outside the goal is a **continuous-play Throw-In (`[US-18.3]`: *"The game is not stopped for a throw-in"*)**, and fouls result in a fixed **30-second Removal Penalty (`[US-16.1]`)** or **Penalty Kick (`[US-17.1]`)**.
4. **Removed Delayed ("Fake") State & Incremental Penalties**: Removal penalties are always a fixed **30 seconds (`[US-16.1]`)**, and every **2 Yellow Cards** on a team reduces the number of active players allowed on that team by 1 (`[US-14.2]`).
5. **Per-Robot Bandwidth & Rate Compliance (`[US-3.6]`)**: Replaces RoboCup's 1200-packet team budget with real-time per-robot monitoring (`<= 10 KB/s` and `<= 30 messages/s`).
