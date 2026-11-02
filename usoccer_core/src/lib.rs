//! Core game state machine, bitmask computation (`[US-21.22]`), and individual robot scoring
//! & tiebreaker engine (`[US-19]`, `[US-20]`) for FIRA HuroCup United Soccer.

use std::cmp::Ordering;

use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use usoccer_msgs::{UsoccerPacket, WireGameState};

/// Maximum number of robot slots per side (`0..=10` for Left, `16..=26` for Right, `[US-21.7]`).
pub const SLOTS_PER_TEAM: usize = 11;

/// Fixed 30-second removal penalty duration (`[US-16.1]`).
pub const REMOVAL_PENALTY_SECS: u16 = 30;

/// Ready phase duration (10 seconds for robots to move to their own half `[US-9.3]`).
pub const READY_PHASE_SECS: u16 = 10;

/// Set phase duration (~10 seconds before whistle `[US-9.6]`).
pub const SET_PHASE_SECS: u16 = 10;

/// Kick-off Play restriction duration (10 seconds or until touched `[US-9.6]`).
pub const KICKOFF_RESTRICTION_SECS: u16 = 10;

/// Timeout duration (2 minutes `[US-8.6]`).
pub const TIMEOUT_SECS: u16 = 120;

/// Maximum timeouts per team per game (`[US-8.6]`).
pub const MAX_TIMEOUTS_PER_TEAM: u8 = 2;

/// Maximum substitutions per team per game (`[US-4.3]`).
pub const MAX_SUBSTITUTIONS_PER_TEAM: u8 = 2;

/// Size category for FIRA HuroCup United Soccer (`[US-2.1]`, `[US-4.1]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CompetitionCategory {
    /// Kid-Sized Category: up to 5 active players per team (`[US-4.1]`), yellow tennis ball (`[US-2.1]`).
    #[default]
    KidSize,
    /// Adult-Sized Category: up to 3 active players per team (`[US-4.1]`), orange size 3 ball (`[US-2.1]`).
    AdultSize,
}

impl CompetitionCategory {
    pub fn max_active_players(self) -> u8 {
        match self {
            Self::KidSize => 5,
            Self::AdultSize => 3,
        }
    }

    pub fn ball_description(self) -> &'static str {
        match self {
            Self::KidSize => "Yellow Tennis Ball [US-2.1]",
            Self::AdultSize => "Orange Youth (Size 3) Soccer Ball [US-2.1]",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::KidSize => "Kid Size (5v5 Max)",
            Self::AdultSize => "Adult Size (3v3 Max)",
        }
    }
}

/// Defending side of the field (`[US-21.7]`).
/// Left defends left goal (Robot IDs `0..=10`), Right defends right goal (Robot IDs `16..=26`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DefendingSide {
    Left,
    Right,
}

impl DefendingSide {
    pub fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
        }
    }

    pub fn base_robot_id(self) -> u8 {
        match self {
            Self::Left => 0,
            Self::Right => 16,
        }
    }
}

/// Role of a robot slot in a United Soccer team (`[US-4.1]`, `[US-4.3]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RobotRole {
    Goalkeeper,
    FieldPlayer,
    Substitute,
    Inactive,
}

impl RobotRole {
    pub fn is_on_field(self) -> bool {
        matches!(self, Self::Goalkeeper | Self::FieldPlayer)
    }
}

/// Reasons for a 30-second Removal Penalty (`[US-15]` & `[US-16]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemovalPenaltyReason {
    /// `[US-15.1]` Hand, arm, or shoulder ball manipulation by non-GK
    HandArmManipulation,
    /// `[US-15.2]` Holding ball >1s (field player) or >6s (GK in goal area)
    BallHolding,
    /// `[US-15.3]` Physical contact / collision / touching GK in goal area
    PhysicalContactOrCollision,
    /// `[US-15.4]` Unable to stand up within 30s after fall / handler requested removal
    Fallen30sOrHandlerRemoval,
    /// `[US-15.5]` Charging another robot with significant force
    ChargingWithForce,
    /// `[US-15.6]` Blocking >50% of goal line for >15s
    GoalLineBlocking,
    /// `[US-15.7]` Double-touch after kicking ball to a passing pole (<30cm)
    PassingPoleDoubleTouch,
    /// `[US-15.8]` Touching any of the 6 passing markers
    TouchingPassingMarker,
    /// `[US-15.9]` Robot handler entered field or interfered with play
    HandlerInterference,
    /// `[US-4.2]` Incapable of walking stably for >= 1 meter
    IncapableOfPlay,
}

impl RemovalPenaltyReason {
    pub fn label(self) -> &'static str {
        match self {
            Self::HandArmManipulation => "[US-15.1] Hand / Arm / Shoulder Ball Manipulation",
            Self::BallHolding => "[US-15.2] Ball Holding (>1s Field / >6s GK)",
            Self::PhysicalContactOrCollision => "[US-15.3] Collision / Contact with GK",
            Self::Fallen30sOrHandlerRemoval => "[US-15.4] Fallen >30s / Handler Removal Request",
            Self::ChargingWithForce => "[US-15.5] Charging with Significant Force",
            Self::GoalLineBlocking => "[US-15.6] Blocking >50% Goal Line (>15s)",
            Self::PassingPoleDoubleTouch => "[US-15.7] Double-Touch on Passing Pole (<30cm)",
            Self::TouchingPassingMarker => "[US-15.8] Touching Passing Marker Obstacle",
            Self::HandlerInterference => "[US-15.9] Robot Handler Field Interference",
            Self::IncapableOfPlay => "[US-4.2] Incapable of Walking >= 1m",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            Self::HandArmManipulation => "Hand/Arm Foul",
            Self::BallHolding => "Ball Holding",
            Self::PhysicalContactOrCollision => "Collision",
            Self::Fallen30sOrHandlerRemoval => "Fallen / Pickup",
            Self::ChargingWithForce => "Charging",
            Self::GoalLineBlocking => "Goal Blocking",
            Self::PassingPoleDoubleTouch => "Pole Double-Touch",
            Self::TouchingPassingMarker => "Touched Pole",
            Self::HandlerInterference => "Handler Foul",
            Self::IncapableOfPlay => "Incapable Robot",
        }
    }
}

/// Cautionable and sending-off offences (`[US-14.1]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardOffence {
    PushingOpponent,
    HoldingOpponent,
    StrikingOpponent,
    ChargingOpponent,
    DamagingRobot,
    UnsportingBehaviour,
    DamagingFieldOrBall,
    PersistentInfringement,
}

impl CardOffence {
    pub fn label(self) -> &'static str {
        match self {
            Self::PushingOpponent => "[US-14.1.1] Pushing an Opponent",
            Self::HoldingOpponent => "[US-14.1.2] Holding an Opponent",
            Self::StrikingOpponent => "[US-14.1.3] Striking / Attempting to Strike",
            Self::ChargingOpponent => "[US-14.1.4] Charging an Opponent",
            Self::DamagingRobot => "[US-14.1.5] Damaging / Likely Damaging Robot",
            Self::UnsportingBehaviour => "[US-14.1.6] Unsporting Behaviour",
            Self::DamagingFieldOrBall => "[US-14.1.7] Modifying / Damaging Field, Goal, or Ball",
            Self::PersistentInfringement => "[US-14.1.8] Persistent Infringement of Laws",
        }
    }
}

/// Individual score breakdown for a single robot (`[US-19.1]`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndividualScore {
    /// Scoring a goal (`+10` points each)
    pub goals_scored: u16,
    /// Scoring a goal by a teammate (`+2` points each)
    pub teammate_goals: u16,
    /// Scoring a goal by the opposing team (`-2` points each)
    pub opponent_goals: u16,
    /// Making a save to prevent a goal (`+7` points each)
    pub saves_made: u16,
    /// Kicking the ball at a passing pole (`+2` points each)
    pub passing_pole_kicks: u16,
    /// Removal of the player for a 30-second penalty (`-1` point each)
    pub removal_penalties: u16,
    /// Optional manual point adjustment by referee
    pub manual_adjustment: i32,
}

impl IndividualScore {
    /// Positive points earned before deducting negative points (`[US-20.2]` tiebreaker 2).
    pub fn positive_points(&self) -> i32 {
        (self.goals_scored as i32) * 10
            + (self.teammate_goals as i32) * 2
            + (self.saves_made as i32) * 7
            + (self.passing_pole_kicks as i32) * 2
            + self.manual_adjustment.max(0)
    }

    /// Negative points deducted (`[US-19.1]`).
    pub fn negative_points(&self) -> i32 {
        (self.opponent_goals as i32) * 2
            + (self.removal_penalties as i32)
            + (-self.manual_adjustment.min(0))
    }

    /// Raw net score (can be <= 0).
    pub fn raw_total(&self) -> i32 {
        self.positive_points() - self.negative_points()
    }

    /// Official awarded points per `[US-19.2]`:
    /// "Any robot that has achieved less than one point is awarded no rank and 0 points."
    pub fn official_points(&self) -> u32 {
        let raw = self.raw_total();
        if raw < 1 {
            0
        } else {
            raw as u32
        }
    }

    /// Whether the robot qualifies for a rank (`>= 1` point, `[US-19.2]`, `[US-19.3]`).
    pub fn is_ranked(&self) -> bool {
        self.raw_total() >= 1
    }
}

/// State of a single robot slot (`0..=10`) on a United Soccer team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RobotSlot {
    /// Slot index within the team (`0..=10`).
    /// Wire Robot ID is `slot_index` on Left Team, or `16 + slot_index` on Right Team (`[US-21.7]`).
    pub slot_index: u8,
    /// Origin university / club name (since United Soccer randomly mixes players `[US-8.1]`).
    pub origin_club: String,
    /// Robot name / identifier.
    pub robot_name: String,
    /// Active role on the team.
    pub role: RobotRole,
    /// Active 30-second removal penalty reason, if currently penalized (`[US-16.1]`).
    pub removal_penalty: Option<RemovalPenaltyReason>,
    /// Remaining seconds on the 30-second removal penalty timer.
    pub penalty_Related_remaining_secs: u16,
    /// Whether the 30s penalty timer is actively counting down (starts once handler removes robot `[US-16.2]`).
    pub penalty_timer_running: bool,
    /// Number of yellow cards received by this robot (`[US-14.2]`).
    pub yellow_cards: u8,
    /// Whether this robot has been sent off (Red Card `[US-14.2]`).
    pub red_card: bool,
    /// Last card offence reason.
    pub last_card_offence: Option<CardOffence>,
    /// Individual score breakdown (`[US-19.1]`).
    pub score: IndividualScore,
}

impl RobotSlot {
    pub fn new(slot_index: u8, origin_club: impl Into<String>, robot_name: impl Into<String>, role: RobotRole) -> Self {
        Self {
            slot_index,
            origin_club: origin_club.into(),
            robot_name: robot_name.into(),
            role,
            removal_penalty: None,
            penalty_Related_remaining_secs: 0,
            penalty_timer_running: false,
            yellow_cards: 0,
            red_card: false,
            last_card_offence: None,
            score: IndividualScore::default(),
        }
    }

    /// Returns true if this robot is currently allowed to play on the field (not substitute/inactive,
    /// not serving a 30s removal penalty, and not sent off with a red card).
    pub fn is_eligible_for_bitmask(&self) -> bool {
        self.role.is_on_field() && self.removal_penalty.is_none() && !self.red_card
    }
}

/// Ranked entry in the post-match / live `[US-19]` & `[US-20]` Individual Leaderboard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    /// `Some(1)`, `Some(2)`, ... if `raw_total >= 1`, or `None` if `< 1` point (`[US-19.2]`).
    pub rank: Option<u8>,
    /// Whether this robot is tied with another robot even after `[US-20.1]` & `[US-20.2]` (requires penalty shootout `[US-20.3]`).
    pub requires_shootout_tiebreak: bool,
    pub side: DefendingSide,
    pub wire_robot_id: u8,
    pub slot_index: u8,
    pub team_name: String,
    pub origin_club: String,
    pub robot_name: String,
    pub role: RobotRole,
    pub score: IndividualScore,
    pub raw_total: i32,
    pub official_points: u32,
    pub positive_points: i32,
}

/// Match period / phase (`[US-8.3]`, `[US-8.4]`, `[US-12.4]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MatchPhase {
    #[default]
    FirstHalf,
    HalfTimeBreak,
    SecondHalf,
    OvertimeFirstHalf,
    OvertimeHalfTimeBreak,
    OvertimeSecondHalf,
    PenaltyShootout,
}

impl MatchPhase {
    pub fn label(self) -> &'static str {
        match self {
            Self::FirstHalf => "1st Half (10:00)",
            Self::HalfTimeBreak => "Half-Time Break (5:00)",
            Self::SecondHalf => "2nd Half (10:00)",
            Self::OvertimeFirstHalf => "Overtime 1st Half (5:00)",
            Self::OvertimeHalfTimeBreak => "Overtime Half-Time (5:00)",
            Self::OvertimeSecondHalf => "Overtime 2nd Half (5:00)",
            Self::PenaltyShootout => "Penalty Shootout (5 Rounds)",
        }
    }

    pub fn default_duration_secs(self) -> i16 {
        match self {
            Self::FirstHalf | Self::SecondHalf => 600, // 10 minutes [US-8.3]
            Self::HalfTimeBreak | Self::OvertimeHalfTimeBreak => 300, // 5 minutes [US-8.4, US-12.4]
            Self::OvertimeFirstHalf | Self::OvertimeSecondHalf => 300, // 5 minutes [US-12.4]
            Self::PenaltyShootout => 60,
        }
    }
}

/// Restart / Set-play context in United Soccer (`[US-9]`, `[US-10]`, `[US-17]`).
/// Note: Throw-ins do NOT stop the game (`[US-18.3]`) and there are NO free kicks, corner kicks, or goal kicks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestartKind {
    KickOff(DefendingSide),
    DroppedBall,
    PenaltyKick(DefendingSide),
}

impl RestartKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::KickOff(DefendingSide::Left) => "Kick-Off: Left Team [US-9]",
            Self::KickOff(DefendingSide::Right) => "Kick-Off: Right Team [US-9]",
            Self::DroppedBall => "Dropped Ball [US-10]",
            Self::PenaltyKick(DefendingSide::Left) => "Penalty Kick: Left Team Attacking [US-17]",
            Self::PenaltyKick(DefendingSide::Right) => "Penalty Kick: Right Team Attacking [US-17]",
        }
    }
}

/// High-level referee stage that drives the `[US-21.23]` wire `State (0..5)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum RefereeStage {
    /// Game is stopped (`WireGameState::Stopped = 0`).
    #[default]
    Stopped,
    /// `READY` signal (`[US-9.3]`, `[US-10.2]`): 10s countdown for robots to move to own half / outside center circle.
    Ready { restart: RestartKind },
    /// `SET` signal (`[US-9.5]`, `[US-21.23]`): ~10s countdown, referee places ball, all robots must remain motionless.
    Set { restart: RestartKind },
    /// `PLAY` Kick-off restriction (`[US-9.6]`): first 10s of kick-off or until ball is touched (`WireGameState 3 or 4`).
    PlayKickOff { kicking_side: DefendingSide },
    /// `PLAY` Ball in play (`[US-9.6]`, `[US-10.2]`, `[US-17.12]`): `WireGameState::PlayBallInPlay = 5`.
    PlayBallInPlay,
    /// Team or Referee Timeout (`[US-8.6]`, 2 minutes): `WireGameState::Stopped = 0`.
    Timeout { called_by: Option<DefendingSide> },
    /// Period or Match Finished (`WireGameState::Stopped = 0`).
    Finished,
}

/// State of one United Team (`Left` or `Right`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitedTeam {
    /// Display name of the united squad (e.g. "United Blue (Left)" or "United Red (Right)").
    pub name: String,
    /// Accent color identifier (`"cyan"`, `"rose"`, `"amber"`, `"emerald"`).
    pub color: String,
    /// Team goals scored (`[US-12]`).
    pub goals: u8,
    /// Remaining 2-minute timeouts (`[US-8.6]`, starts at 2).
    pub timeouts_remaining: u8,
    /// Remaining substitutions (`[US-4.3]`, starts at 2).
    pub substitutions_remaining: u8,
    /// Total yellow cards accumulated by the team (`[US-14.2]`: every 2 yellow cards reduces max players by 1).
    pub team_yellow_cards: u8,
    /// Total red cards accumulated by the team.
    pub team_red_cards: u8,
    /// Penalty shootout attempts taken.
    pub shootout_attempts: u8,
    /// Penalty shootout goals scored.
    pub shootout_goals: u8,
    /// 11 robot slots (`0..=10`).
    pub slots: Vec<RobotSlot>,
}

impl UnitedTeam {
    pub fn new_default(name: &str, color: &str, clubs: &[(&str, &str)], max_active: u8) -> Self {
        let mut slots = Vec::with_capacity(SLOTS_PER_TEAM);
        for idx in 0..(SLOTS_PER_TEAM as u8) {
            let (club, bot) = clubs
                .get(idx as usize)
                .copied()
                .unwrap_or(("Unassigned Club", "Reserve Unit"));
            let role = if idx == 0 {
                RobotRole::Goalkeeper
            } else if idx < max_active {
                RobotRole::FieldPlayer
            } else if idx < max_active + 2 {
                RobotRole::Substitute
            } else {
                RobotRole::Inactive
            };
            slots.push(RobotSlot::new(idx, club, bot, role));
        }
        Self {
            name: name.to_string(),
            color: color.to_string(),
            goals: 0,
            timeouts_remaining: MAX_TIMEOUTS_PER_TEAM,
            substitutions_remaining: MAX_SUBSTITUTIONS_PER_TEAM,
            team_yellow_cards: 0,
            team_red_cards: 0,
            shootout_attempts: 0,
            shootout_goals: 0,
            slots,
        }
    }

    /// Maximum players allowed on the field for this team after accounting for `[US-14.2]`:
    /// "The number of players on the team is reduced by one after every two yellow cards."
    pub fn effective_max_players(&self, category: CompetitionCategory) -> u8 {
        let base = category.max_active_players();
        let reduction_from_yellows = self.team_yellow_cards / 2;
        base.saturating_sub(reduction_from_yellows).max(1)
    }

    /// Computes the 16-bit play permission bitmask for this team (`[US-21.22]`, `[US-21.23]`).
    /// During `Set` (`[US-21.23]`) or `Stopped`/`Timeout`/`Finished`, returns `0x0000` if `zero_bitmask_when_motionless` is enabled,
    /// or reflects each slot's individual eligibility while `State=0/1/2` commands motionless behavior.
    pub fn compute_bitmask(&self, category: CompetitionCategory, stage: RefereeStage) -> u16 {
        // Per [US-21.22]: "This message includes a bitmask identifying which robots on each team are
        // currently in play or have been penalized with a 30 second removal penalty. Any robot whose id
        // bit is not set must remain motionless."
        // Per [US-21.23]: "During Game Set, all robots should remain motionless."
        let _ = stage;
        let max_allowed = self.effective_max_players(category) as usize;
        let mut active_count = 0usize;
        let mut mask: u16 = 0;

        for slot in &self.slots {
            if slot.role.is_on_field() && !slot.red_card {
                if active_count < max_allowed && slot.is_eligible_for_bitmask() {
                    mask |= 1u16 << (slot.slot_index as u16);
                }
                active_count += 1;
            }
        }
        mask
    }
}

/// Event log entry for match timeline & report (`[GN-3.14]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchLogEntry {
    pub id: u64,
    pub phase: MatchPhase,
    pub remaining_seconds: i16,
    pub summary: String,
    pub rule_ref: &'static str,
}

/// Complete state of a FIRA HuroCup United Soccer match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchState {
    pub category: CompetitionCategory,
    pub phase: MatchPhase,
    pub stage: RefereeStage,
    /// Which side has the next kick-off (`[US-8.2]`, `[US-9.1]`).
    pub next_kickoff_side: DefendingSide,
    /// Which side won the initial coin toss and kicked off in the 1st half (`[US-8.2]`).
    pub first_half_kickoff_side: DefendingSide,
    /// Primary period clock in seconds (`[US-21.23]` `Time` `INT16`).
    pub primary_seconds: i16,
    /// Secondary phase clock in seconds (10s Ready, 10s Set, 10s Kick-off restriction, 120s Timeout).
    pub secondary_seconds: u16,
    /// Sequence number of the last `[US-21]` packet sent by Referee (`ID = 32`).
    pub referee_sequence_number: u16,
    /// Team currently defending the Left Goal (`IDs 0..=10`).
    pub left_team: UnitedTeam,
    /// Team currently defending the Right Goal (`IDs 16..=26`).
    pub right_team: UnitedTeam,
    /// Coordinates (in mm, `[US-21.9]`) of the 6 randomly placed Passing Markers (`[US-1.21]`).
    pub passing_markers_mm: Vec<(u16, u16)>,
    /// Chronological match log (`[GN-3.14]`).
    pub match_log: Vec<MatchLogEntry>,
    next_log_id: u64,
}

impl Default for MatchState {
    fn default() -> Self {
        Self::new(CompetitionCategory::KidSize)
    }
}

impl MatchState {
    pub fn new(category: CompetitionCategory) -> Self {
        let left_clubs = [
            ("NTNU ERC", "HuroBot-Alpha"),
            ("TKU Robotics", "TKU-Striker"),
            ("ITS Surabaya", "Ichiro-Wing"),
            ("KAIST Humanoid", "Hubo-Mid"),
            ("Univ. Manitoba", "Autonomous-5"),
            ("NCKU Lab", "ChengKung-Sub1"),
            ("Unicamp", "BrasilBot-Sub2"),
        ];
        let right_clubs = [
            ("TU Dortmund", "WalkMan-GK"),
            ("POSTECH", "Pohang-Forward"),
            ("NTU Singapore", "Merlion-Bot"),
            ("Kyutech", "Hibikino-4"),
            ("UI Indonesia", "Garuda-5"),
            ("UTM Malaysia", "Harimau-Sub1"),
            ("SNU Korea", "Seoul-Sub2"),
        ];

        let max_active = category.max_active_players();
        Self {
            category,
            phase: MatchPhase::FirstHalf,
            stage: RefereeStage::Stopped,
            next_kickoff_side: DefendingSide::Left,
            first_half_kickoff_side: DefendingSide::Left,
            primary_seconds: MatchPhase::FirstHalf.default_duration_secs(),
            secondary_seconds: 0,
            referee_sequence_number: 0,
            left_team: UnitedTeam::new_default("United Cyan (Left)", "cyan", &left_clubs, max_active),
            right_team: UnitedTeam::new_default("United Rose (Right)", "rose", &right_clubs, max_active),
            passing_markers_mm: Self::default_passing_markers(),
            match_log: vec![MatchLogEntry {
                id: 1,
                phase: MatchPhase::FirstHalf,
                remaining_seconds: 600,
                summary: "Match initialized. Teams must demonstrate referee box listener compliance before start.".to_string(),
                rule_ref: "[US-5.2]",
            }],
            next_log_id: 2,
        }
    }

    /// Six passing markers placed outside penalty box & goal box areas (`[US-1.21]`).
    /// Field dimensions: 7000mm x 5000mm. Penalty box extends 1200mm from each goal line.
    pub fn default_passing_markers() -> Vec<(u16, u16)> {
        vec![
            (2200, 1200),
            (2200, 3800),
            (3500, 900),
            (3500, 4100),
            (4800, 1200),
            (4800, 3800),
        ]
    }

    pub fn team(&self, side: DefendingSide) -> &UnitedTeam {
        match side {
            DefendingSide::Left => &self.left_team,
            DefendingSide::Right => &self.right_team,
        }
    }

    pub fn team_mut(&mut self, side: DefendingSide) -> &mut UnitedTeam {
        match side {
            DefendingSide::Left => &mut self.left_team,
            DefendingSide::Right => &mut self.right_team,
        }
    }

    pub fn push_log(&mut self, summary: impl Into<String>, rule_ref: &'static str) {
        let entry = MatchLogEntry {
            id: self.next_log_id,
            phase: self.phase,
            remaining_seconds: self.primary_seconds,
            summary: summary.into(),
            rule_ref,
        };
        self.next_log_id += 1;
        self.match_log.insert(0, entry);
        if self.match_log.len() > 100 {
            self.match_log.truncate(100);
        }
    }

    /// Computes the `[US-21.23]` `WireGameState` (`0..=5`) corresponding to the current `RefereeStage`.
    pub fn wire_game_state(&self) -> WireGameState {
        match self.stage {
            RefereeStage::Stopped
            | RefereeStage::Ready { .. }
            | RefereeStage::Timeout { .. }
            | RefereeStage::Finished => WireGameState::Stopped,
            RefereeStage::Set { restart } => match restart {
                RestartKind::KickOff(DefendingSide::Left)
                | RestartKind::PenaltyKick(DefendingSide::Left) => WireGameState::SetKickOffLeft,
                RestartKind::KickOff(DefendingSide::Right)
                | RestartKind::PenaltyKick(DefendingSide::Right) => WireGameState::SetKickOffRight,
                RestartKind::DroppedBall => WireGameState::SetKickOffLeft,
            },
            RefereeStage::PlayKickOff {
                kicking_side: DefendingSide::Left,
            } => WireGameState::PlayKickOffLeft,
            RefereeStage::PlayKickOff {
                kicking_side: DefendingSide::Right,
            } => WireGameState::PlayKickOffRight,
            RefereeStage::PlayBallInPlay => WireGameState::PlayBallInPlay,
        }
    }

    /// Computes `(team_left_bitmask, team_right_bitmask)` for `[US-21.22]`.
    pub fn team_bitmasks(&self) -> (u16, u16) {
        (
            self.left_team.compute_bitmask(self.category, self.stage),
            self.right_team.compute_bitmask(self.category, self.stage),
        )
    }

    /// Builds the next `[US-21]` `0xADDE` Referee (`ID = 32`) packet and increments the sequence number.
    pub fn next_referee_packet(&mut self) -> UsoccerPacket {
        let seq = self.referee_sequence_number;
        self.referee_sequence_number = self.referee_sequence_number.wrapping_add(1);
        let (left_mask, right_mask) = self.team_bitmasks();
        UsoccerPacket::new_referee_state(
            seq,
            left_mask,
            right_mask,
            self.primary_seconds,
            self.wire_game_state(),
        )
    }

    /// Builds a snapshot of the current `[US-21]` `0xADDE` Referee packet without mutating sequence number.
    pub fn preview_referee_packet(&self) -> UsoccerPacket {
        let (left_mask, right_mask) = self.team_bitmasks();
        UsoccerPacket::new_referee_state(
            self.referee_sequence_number,
            left_mask,
            right_mask,
            self.primary_seconds,
            self.wire_game_state(),
        )
    }

    /// Advances active match, secondary, and 30s removal penalty timers by 1 second.
    pub fn tick_one_second(&mut self) {
        // 1. Advance 30-second removal penalty timers whenever not in Timeout/HalfTime
        let in_break = matches!(
            self.phase,
            MatchPhase::HalfTimeBreak | MatchPhase::OvertimeHalfTimeBreak
        ) || matches!(self.stage, RefereeStage::Timeout { .. });

        if !in_break {
            for side in [DefendingSide::Left, DefendingSide::Right] {
                let team = self.team_mut(side);
                for slot in &mut team.slots {
                    if slot.removal_penalty.is_some()
                        && slot.penalty_timer_running
                        && slot.penalty_Related_remaining_secs > 0
                    {
                        slot.penalty_Related_remaining_secs =
                            slot.penalty_Related_remaining_secs.saturating_sub(1);
                    }
                }
            }
        }

        // 2. Advance primary clock and secondary clock based on stage
        match self.stage {
            RefereeStage::Ready { restart } => {
                if self.secondary_seconds > 0 {
                    self.secondary_seconds -= 1;
                    if self.secondary_seconds == 0 {
                        // Automatically transition READY -> SET after 10 seconds [US-9.3, US-9.5]
                        self.stage = RefereeStage::Set { restart };
                        self.secondary_seconds = SET_PHASE_SECS;
                        self.push_log(
                            format!("READY elapsed (10s) -> Entering SET for {}. Place ball on mark; robots must remain motionless.", restart.label()),
                            "[US-9.5]",
                        );
                    }
                }
            }
            RefereeStage::Set { .. } => {
                if self.secondary_seconds > 0 {
                    self.secondary_seconds -= 1;
                }
            }
            RefereeStage::PlayKickOff { kicking_side } => {
                if self.primary_seconds > 0 {
                    self.primary_seconds -= 1;
                }
                if self.secondary_seconds > 0 {
                    self.secondary_seconds -= 1;
                    if self.secondary_seconds == 0 {
                        // 10 seconds elapsed since kick-off whistle -> Ball is now in open play (State 5) [US-9.6]
                        self.stage = RefereeStage::PlayBallInPlay;
                        self.push_log(
                            format!(
                                "10s kick-off restriction elapsed for {:?} Team -> State=5 (Play: Ball in Play).",
                                kicking_side
                            ),
                            "[US-9.6]",
                        );
                    }
                }
                if self.primary_seconds <= 0 {
                    self.stage = RefereeStage::Finished;
                    self.push_log(
                        format!("{} time expired.", self.phase.label()),
                        "[US-8.3]",
                    );
                }
            }
            RefereeStage::PlayBallInPlay => {
                if self.primary_seconds > 0 {
                    self.primary_seconds -= 1;
                    if self.primary_seconds <= 0 {
                        self.stage = RefereeStage::Finished;
                        self.push_log(
                            format!("{} time expired.", self.phase.label()),
                            "[US-8.3]",
                        );
                    }
                }
            }
            RefereeStage::Timeout { called_by } => {
                if self.secondary_seconds > 0 {
                    self.secondary_seconds -= 1;
                    if self.secondary_seconds == 0 {
                        self.stage = RefereeStage::Stopped;
                        let who = match called_by {
                            Some(DefendingSide::Left) => "Left Team",
                            Some(DefendingSide::Right) => "Right Team",
                            None => "Referee",
                        };
                        self.push_log(
                            format!("{} 2-minute timeout concluded.", who),
                            "[US-8.6]",
                        );
                    }
                }
            }
            RefereeStage::Stopped | RefereeStage::Finished => {
                if matches!(
                    self.phase,
                    MatchPhase::HalfTimeBreak | MatchPhase::OvertimeHalfTimeBreak
                ) && self.primary_seconds > 0
                {
                    self.primary_seconds -= 1;
                }
            }
        }
    }

    /// Computes the full `[US-19]` & `[US-20]` Individual Robot Leaderboard across both teams.
    ///
    /// Rules enforced:
    /// - `[US-19.2]`: Any robot that has achieved `< 1` point is awarded no rank and `0` points.
    /// - `[US-19.3]`: Among robots with `>= 1` point, ranked 1st, 2nd, etc. by greater number of points.
    /// - `[US-19.4]` & `[US-20.1]`: Tiebreaker 1 — number of goals scored (and saves made).
    /// - `[US-20.2]`: Tiebreaker 2 — maximum points after removal of negative points scored (`positive_points`).
    /// - `[US-20.3]`: Tiebreaker 3 — if still tied, flagged for 5-round penalty kick shootout.
    pub fn compute_leaderboard(&self) -> Vec<LeaderboardEntry> {
        let mut entries = Vec::new();

        for (side, team) in [
            (DefendingSide::Left, &self.left_team),
            (DefendingSide::Right, &self.right_team),
        ] {
            for slot in &team.slots {
                if slot.role == RobotRole::Inactive {
                    continue;
                }
                entries.push(LeaderboardEntry {
                    rank: None,
                    requires_shootout_tiebreak: false,
                    side,
                    wire_robot_id: side.base_robot_id() + slot.slot_index,
                    slot_index: slot.slot_index,
                    team_name: team.name.clone(),
                    origin_club: slot.origin_club.clone(),
                    robot_name: slot.robot_name.clone(),
                    role: slot.role,
                    raw_total: slot.score.raw_total(),
                    official_points: slot.score.official_points(),
                    positive_points: slot.score.positive_points(),
                    score: slot.score.clone(),
                });
            }
        }

        // Sort descending by:
        // 1. official_points (or raw_total for unranked ordering)
        // 2. Tiebreaker 1 [US-20.1 / US-19.4]: goals_scored + saves_made (with goals_scored primary)
        // 3. Tiebreaker 2 [US-20.2]: positive_points (points after removing negative points)
        entries.sort_by(|a, b| {
            b.official_points
                .cmp(&a.official_points)
                .then_with(|| b.score.goals_scored.cmp(&a.score.goals_scored))
                .then_with(|| b.score.saves_made.cmp(&a.score.saves_made))
                .then_with(|| b.positive_points.cmp(&a.positive_points))
                .then_with(|| b.raw_total.cmp(&a.raw_total))
                .then_with(|| a.wire_robot_id.cmp(&b.wire_robot_id))
        });

        // Assign ranks to robots with >= 1 point [US-19.2, US-19.3]
        let mut current_rank = 1u8;
        for i in 0..entries.len() {
            if entries[i].raw_total < 1 {
                entries[i].rank = None;
                continue;
            }
            if i > 0 && entries[i - 1].raw_total >= 1 {
                let prev = &entries[i - 1];
                let curr = &entries[i];
                let exact_tie = prev.official_points == curr.official_points
                    && prev.score.goals_scored == curr.score.goals_scored
                    && prev.score.saves_made == curr.score.saves_made
                    && prev.positive_points == curr.positive_points;
                if exact_tie {
                    entries[i].rank = prev.rank;
                    entries[i].requires_shootout_tiebreak = true;
                    entries[i - 1].requires_shootout_tiebreak = true;
                } else {
                    current_rank = (i as u8) + 1;
                    entries[i].rank = Some(current_rank);
                }
            } else {
                entries[i].rank = Some(current_rank);
            }
        }

        entries
    }
}

/// Player entry used when configuring or randomly forming United Teams (`[US-8.1]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrantRobot {
    pub origin_club: String,
    pub robot_name: String,
    pub prefers_goalkeeper: bool,
}

/// Actions that the Referee or Assistant Referee can execute on the controller.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "args", rename_all = "camelCase")]
pub enum RefereeAction {
    /// Configure match parameters and optionally randomize united teams (`[US-8.1]`, `[US-8.2]`).
    ConfigureMatch {
        category: CompetitionCategory,
        left_team_name: String,
        left_team_color: String,
        right_team_name: String,
        right_team_color: String,
        first_kickoff_side: DefendingSide,
    },
    /// Randomly assign a pool of registered robots across Left and Right United Teams (`[US-8.1]`).
    RandomizeUnitedTeams {
        pool: Vec<RegistrantRobot>,
    },
    /// Randomize the 6 passing markers outside the penalty & goal areas (`[US-1.21]`).
    RandomizePassingMarkers,
    /// Update a specific robot slot's metadata or role (`[US-4.1]`, `[US-4.3]`).
    UpdateRobotSlot {
        side: DefendingSide,
        slot_index: u8,
        origin_club: String,
        robot_name: String,
        role: RobotRole,
    },
    /// Signal `READY` (`[US-9.3]`, `[US-10.2]`): starts 10s countdown for Kick-Off, Dropped Ball, or Penalty Kick.
    SignalReady {
        restart: RestartKind,
    },
    /// Signal `SET` (`[US-9.5]`, `[US-10.2]`): places ball on mark, broadcasts `State 1/2`, all robots motionless.
    SignalSet {
        restart: Option<RestartKind>,
    },
    /// Signal `PLAY` (`[US-9.6]`, `[US-10.2]`, `[US-17.12]`): whistle + UDP `PLAY` (`State 3/4` for Kick-Off, `State 5` for Dropped Ball / Penalty Kick).
    SignalPlay,
    /// Confirm ball was touched during Kick-Off (`[US-9.6]`): immediately transitions `State 3/4` -> `State 5 (Ball in Play)`.
    ConfirmKickOffTouch,
    /// Stop play immediately (`[GN-3.6]`, `[US-21.23]`): broadcasts `State = 0 (Game stopped)`.
    StopPlay,
    /// Award a Goal (`[US-12.1]`, `[US-19.1]`):
    /// Increments team score, credits `+10` to `scorer_slot` (if identified), `+2` to active teammates,
    /// deducts `-2` from active opponents, and sets `next_kickoff_side` to the conceding team (`[US-9.1]`).
    AwardGoal {
        scoring_side: DefendingSide,
        scorer_slot: Option<u8>,
    },
    /// Record an individual robot achievement (`[US-19.1]`):
    /// - Save preventing a goal (`+7`)
    /// - Kicking the ball at a passing pole (`+2`)
    RecordIndividualAction {
        side: DefendingSide,
        slot_index: u8,
        kind: IndividualActionKind,
    },
    /// Adjust individual robot score counters directly if referee corrects a call (`[GN-3.18]`).
    AdjustRobotScore {
        side: DefendingSide,
        slot_index: u8,
        manual_delta: i32,
    },
    /// Apply a 30-second Removal Penalty (`[US-15]`, `[US-16.1]`, `[US-19.1]`, `[US-21.22]`):
    /// Clears robot bit in team bitmask, deducts `-1` individual point, and sets 30s timer.
    ApplyRemovalPenalty {
        side: DefendingSide,
        slot_index: u8,
        reason: RemovalPenaltyReason,
        start_timer_immediately: bool,
    },
    /// Start or pause the 30s removal penalty countdown once the handler has removed the robot (`[US-16.2]`).
    TogglePenaltyTimer {
        side: DefendingSide,
        slot_index: u8,
    },
    /// Return a penalized robot to play at the touch line near the center line (`[US-16.3]`).
    ReturnPenalizedRobot {
        side: DefendingSide,
        slot_index: u8,
    },
    /// Issue a Yellow Card (Caution) or Red Card (Send-Off) (`[US-14.1]`, `[US-14.2]`).
    IssueCard {
        side: DefendingSide,
        slot_index: u8,
        is_red: bool,
        offence: CardOffence,
    },
    /// Substitute a player (`[US-4.3]`, max 2 substitutes per game).
    SubstitutePlayer {
        side: DefendingSide,
        outgoing_slot: u8,
        incoming_slot: u8,
    },
    /// Start a 2-minute Timeout (`[US-8.6]`, `[US-9.1]`).
    /// If called by a team, the other team gets the subsequent kick-off (`[US-9.1]`).
    StartTimeout {
        called_by: Option<DefendingSide>,
    },
    /// End current period or advance to next period (swapping team sides after half-time `[US-8.5]`).
    AdvancePeriod,
    /// Add or subtract seconds on the primary clock (`[US-17.3]`).
    AdjustPrimaryClock {
        delta_seconds: i16,
    },
    /// Record a Penalty Shootout attempt outcome (`[US-12.4]`, `[US-20.3]`).
    RecordShootoutAttempt {
        side: DefendingSide,
        scored: bool,
    },
    /// Undo to a previous snapshot (`[GN-3.18]`).
    Undo {
        steps: usize,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndividualActionKind {
    /// Making a save to prevent a goal (`+7` points `[US-19.1]`)
    Save,
    /// Kicking the ball at the passing pole (`+2` points `[US-19.1]`)
    PassingPoleKick,
}

/// Summary of an undoable user action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntry {
    pub label: String,
    pub state_before: MatchState,
}

/// Top-level controller managing `MatchState` and undo history.
#[derive(Debug, Clone, Default)]
pub struct UnitedSoccerController {
    pub state: MatchState,
    pub undo_stack: Vec<UndoEntry>,
}

impl UnitedSoccerController {
    pub fn new(category: CompetitionCategory) -> Self {
        Self {
            state: MatchState::new(category),
            undo_stack: Vec::new(),
        }
    }

    fn save_undo(&mut self, label: impl Into<String>) {
        let entry = UndoEntry {
            label: label.into(),
            state_before: self.state.clone(),
        };
        self.undo_stack.push(entry);
        if self.undo_stack.len() > 25 {
            self.undo_stack.remove(0);
        }
    }

    pub fn apply_action(&mut self, action: RefereeAction) {
        match action {
            RefereeAction::Undo { steps } => {
                let count = steps.min(self.undo_stack.len());
                if count > 0 {
                    let target_idx = self.undo_stack.len() - count;
                    let restored = self.undo_stack.truncate_and_pop(target_idx);
                    if let Some(state_before) = restored {
                        let current_seq = self.state.referee_sequence_number;
                        self.state = state_before;
                        self.state.referee_sequence_number = current_seq;
                    }
                }
            }
            RefereeAction::StopPlay => {
                // Emergency stop does not pollute undo history, immediately enters Stopped (State 0)
                self.state.stage = RefereeStage::Stopped;
                self.state.secondary_seconds = 0;
                self.state
                    .push_log("Referee signaled STOP PLAY (State = 0).", "[GN-3.6]");
            }
            RefereeAction::ConfigureMatch {
                category,
                left_team_name,
                left_team_color,
                right_team_name,
                right_team_color,
                first_kickoff_side,
            } => {
                self.save_undo("Configure Match");
                self.state.category = category;
                self.state.left_team.name = left_team_name;
                self.state.left_team.color = left_team_color;
                self.state.right_team.name = right_team_name;
                self.state.right_team.color = right_team_color;
                self.state.first_half_kickoff_side = first_kickoff_side;
                self.state.next_kickoff_side = first_kickoff_side;

                // Adjust active field players to match category limit (5 for KidSize, 3 for AdultSize)
                let max_active = category.max_active_players();
                for side in [DefendingSide::Left, DefendingSide::Right] {
                    let team = self.state.team_mut(side);
                    let mut active = 0u8;
                    for slot in &mut team.slots {
                        if slot.role.is_on_field() {
                            if active < max_active {
                                active += 1;
                            } else {
                                slot.role = RobotRole::Substitute;
                            }
                        }
                    }
                }
                self.state.push_log(
                    format!(
                        "Configured {} match. First kick-off: {:?} Team.",
                        category.label(),
                        first_kickoff_side
                    ),
                    "[US-8.2]",
                );
            }
            RefereeAction::RandomizeUnitedTeams { mut pool } => {
                self.save_undo("Randomize United Teams");
                let mut rng = rand::thread_rng();
                pool.shuffle(&mut rng);
                let max_active = self.state.category.max_active_players() as usize;
                let per_team = (pool.len() / 2).clamp(1, SLOTS_PER_TEAM);

                for (side_idx, side) in [DefendingSide::Left, DefendingSide::Right]
                    .into_iter()
                    .enumerate()
                {
                    let team = self.state.team_mut(side);
                    let slice_start = side_idx * per_team;
                    for idx in 0..SLOTS_PER_TEAM {
                        if let Some(reg) = pool.get(slice_start + idx) {
                            let role = if idx == 0 {
                                RobotRole::Goalkeeper
                            } else if idx < max_active {
                                RobotRole::FieldPlayer
                            } else if idx < max_active + 2 {
                                RobotRole::Substitute
                            } else {
                                RobotRole::Inactive
                            };
                            team.slots[idx] = RobotSlot::new(
                                idx as u8,
                                reg.origin_club.clone(),
                                reg.robot_name.clone(),
                                role,
                            );
                        } else {
                            team.slots[idx].role = RobotRole::Inactive;
                        }
                    }
                }
                self.state.push_log(
                    "Randomly formed United Soccer teams from robot pool.",
                    "[US-8.1]",
                );
            }
            RefereeAction::RandomizePassingMarkers => {
                self.save_undo("Randomize 6 Passing Markers");
                let mut rng = rand::thread_rng();
                let candidates = [
                    (1800, 1000),
                    (1800, 2500),
                    (1800, 4000),
                    (2600, 1400),
                    (2600, 3600),
                    (3500, 800),
                    (3500, 4200),
                    (4400, 1400),
                    (4400, 3600),
                    (5200, 1000),
                    (5200, 2500),
                    (5200, 4000),
                ];
                let mut chosen: Vec<(u16, u16)> = candidates
                    .choose_multiple(&mut rng, 6)
                    .copied()
                    .collect();
                chosen.sort();
                self.state.passing_markers_mm = chosen;
                self.state.push_log(
                    "Referee randomized the 6 field passing markers outside penalty/goal areas.",
                    "[US-1.21]",
                );
            }
            RefereeAction::UpdateRobotSlot {
                side,
                slot_index,
                origin_club,
                robot_name,
                role,
            } => {
                self.save_undo(format!("Update Slot {}", slot_index));
                let team = self.state.team_mut(side);
                if let Some(slot) = team.slots.get_mut(slot_index as usize) {
                    slot.origin_club = origin_club;
                    slot.robot_name = robot_name;
                    slot.role = role;
                }
            }
            RefereeAction::SignalReady { restart } => {
                self.save_undo(format!("READY ({})", restart.label()));
                if let RestartKind::KickOff(side) = restart {
                    self.state.next_kickoff_side = side;
                }
                self.state.stage = RefereeStage::Ready { restart };
                self.state.secondary_seconds = READY_PHASE_SECS;
                self.state.push_log(
                    format!(
                        "Referee signaled READY for {}. Robots have 10s to move to own half.",
                        restart.label()
                    ),
                    "[US-9.3]",
                );
            }
            RefereeAction::SignalSet { restart } => {
                let effective_restart = restart.unwrap_or(match self.state.stage {
                    RefereeStage::Ready { restart: r } | RefereeStage::Set { restart: r } => r,
                    _ => RestartKind::KickOff(self.state.next_kickoff_side),
                });
                self.save_undo(format!("SET ({})", effective_restart.label()));
                if let RestartKind::KickOff(side) = effective_restart {
                    self.state.next_kickoff_side = side;
                }
                self.state.stage = RefereeStage::Set {
                    restart: effective_restart,
                };
                self.state.secondary_seconds = SET_PHASE_SECS;
                self.state.push_log(
                    format!(
                        "Referee signaled SET ({}). All robots must remain motionless.",
                        effective_restart.label()
                    ),
                    "[US-9.5] / [US-21.23]",
                );
            }
            RefereeAction::SignalPlay => {
                self.save_undo("PLAY Whistle");
                let next_stage = match self.state.stage {
                    RefereeStage::Set {
                        restart: RestartKind::KickOff(side),
                    }
                    | RefereeStage::Ready {
                        restart: RestartKind::KickOff(side),
                    } => {
                        self.state.secondary_seconds = KICKOFF_RESTRICTION_SECS;
                        RefereeStage::PlayKickOff { kicking_side: side }
                    }
                    RefereeStage::Set {
                        restart: RestartKind::DroppedBall | RestartKind::PenaltyKick(_),
                    }
                    | RefereeStage::Ready {
                        restart: RestartKind::DroppedBall | RestartKind::PenaltyKick(_),
                    } => {
                        self.state.secondary_seconds = 0;
                        RefereeStage::PlayBallInPlay
                    }
                    _ => {
                        self.state.secondary_seconds = 0;
                        RefereeStage::PlayBallInPlay
                    }
                };
                self.state.stage = next_stage;
                self.state.push_log(
                    format!(
                        "Referee whistled PLAY -> Wire State = {}.",
                        self.state.wire_game_state().label()
                    ),
                    "[US-9.6]",
                );
            }
            RefereeAction::ConfirmKickOffTouch => {
                if matches!(self.state.stage, RefereeStage::PlayKickOff { .. }) {
                    self.save_undo("Kick-Off Ball Touched");
                    self.state.stage = RefereeStage::PlayBallInPlay;
                    self.state.secondary_seconds = 0;
                    self.state.push_log(
                        "Ball touched on kick-off -> State=5 (Play: Ball in Play).",
                        "[US-9.6]",
                    );
                }
            }
            RefereeAction::AwardGoal {
                scoring_side,
                scorer_slot,
            } => {
                self.save_undo(format!("Goal {:?}", scoring_side));
                let conceding_side = scoring_side.opposite();

                // 1. Increment team goal counter [US-12.1]
                {
                    let scoring_team = self.state.team_mut(scoring_side);
                    scoring_team.goals = scoring_team.goals.saturating_add(1);

                    // 2. Credit +10 to the scoring robot and +2 to active teammates on field [US-19.1]
                    for slot in &mut scoring_team.slots {
                        if Some(slot.slot_index) == scorer_slot {
                            slot.score.goals_scored = slot.score.goals_scored.saturating_add(1);
                        } else if slot.role.is_on_field() && !slot.red_card {
                            slot.score.teammate_goals =
                                slot.score.teammate_goals.saturating_add(1);
                        }
                    }
                }

                // 3. Deduct -2 from active players on the opposing (conceding) team [US-19.1]
                {
                    let conceding_team = self.state.team_mut(conceding_side);
                    for slot in &mut conceding_team.slots {
                        if slot.role.is_on_field() && !slot.red_card {
                            slot.score.opponent_goals =
                                slot.score.opponent_goals.saturating_add(1);
                        }
                    }
                }

                // 4. Opposing team gets the next kick-off; transition to READY [US-9.1, US-9.3]
                self.state.next_kickoff_side = conceding_side;
                self.state.stage = RefereeStage::Ready {
                    restart: RestartKind::KickOff(conceding_side),
                };
                self.state.secondary_seconds = READY_PHASE_SECS;

                let scorer_desc = match scorer_slot {
                    Some(idx) => {
                        let wire_id = scoring_side.base_robot_id() + idx;
                        format!("Robot ID #{} (+10 pts, teammates +2, opponents -2)", wire_id)
                    }
                    None => "Team Goal (teammates +2, opponents -2)".to_string(),
                };
                self.state.push_log(
                    format!(
                        "GOAL for {:?} Team! {} -> READY for {:?} Kick-Off.",
                        scoring_side, scorer_desc, conceding_side
                    ),
                    "[US-12.1] / [US-19.1]",
                );
            }
            RefereeAction::RecordIndividualAction {
                side,
                slot_index,
                kind,
            } => {
                let wire_id = side.base_robot_id() + slot_index;
                let action_name = match kind {
                    IndividualActionKind::Save => "Goal Save (+7 pts)",
                    IndividualActionKind::PassingPoleKick => "Passing Pole Kick (+2 pts)",
                };
                self.save_undo(format!("ID #{} {}", wire_id, action_name));
                if let Some(slot) = self.state.team_mut(side).slots.get_mut(slot_index as usize) {
                    match kind {
                        IndividualActionKind::Save => {
                            slot.score.saves_made = slot.score.saves_made.saturating_add(1);
                        }
                        IndividualActionKind::PassingPoleKick => {
                            slot.score.passing_pole_kicks =
                                slot.score.passing_pole_kicks.saturating_add(1);
                        }
                    }
                }
                self.state.push_log(
                    format!("Awarded {} to Robot ID #{}.", action_name, wire_id),
                    "[US-19.1]",
                );
            }
            RefereeAction::AdjustRobotScore {
                side,
                slot_index,
                manual_delta,
            } => {
                let wire_id = side.base_robot_id() + slot_index;
                self.save_undo(format!("Adjust ID #{} ({:+})", wire_id, manual_delta));
                if let Some(slot) = self.state.team_mut(side).slots.get_mut(slot_index as usize) {
                    slot.score.manual_adjustment += manual_delta;
                }
            }
            RefereeAction::ApplyRemovalPenalty {
                side,
                slot_index,
                reason,
                start_timer_immediately,
            } => {
                let wire_id = side.base_robot_id() + slot_index;
                self.save_undo(format!("30s Penalty ID #{}", wire_id));
                if let Some(slot) = self.state.team_mut(side).slots.get_mut(slot_index as usize) {
                    slot.removal_penalty = Some(reason);
                    slot.penalty_Related_remaining_secs = REMOVAL_PENALTY_SECS;
                    slot.penalty_timer_running = start_timer_immediately;
                    // [US-19.1]: Removal of the player for a 30-second penalty = -1 point
                    slot.score.removal_penalties = slot.score.removal_penalties.saturating_add(1);
                }
                self.state.push_log(
                    format!(
                        "30s Removal Penalty on Robot ID #{}: {} (-1 pt, bitmask bit cleared).",
                        wire_id,
                        reason.label()
                    ),
                    "[US-16.1] / [US-21.22]",
                );
            }
            RefereeAction::TogglePenaltyTimer { side, slot_index } => {
                if let Some(slot) = self.state.team_mut(side).slots.get_mut(slot_index as usize) {
                    if slot.removal_penalty.is_some() {
                        slot.penalty_timer_running = !slot.penalty_timer_running;
                    }
                }
            }
            RefereeAction::ReturnPenalizedRobot { side, slot_index } => {
                let wire_id = side.base_robot_id() + slot_index;
                self.save_undo(format!("Return ID #{}", wire_id));
                if let Some(slot) = self.state.team_mut(side).slots.get_mut(slot_index as usize) {
                    slot.removal_penalty = None;
                    slot.penalty_Related_remaining_secs = 0;
                    slot.penalty_timer_running = false;
                }
                self.state.push_log(
                    format!(
                        "Robot ID #{} re-entered at touch line near center line facing center circle.",
                        wire_id
                    ),
                    "[US-16.3]",
                );
            }
            RefereeAction::IssueCard {
                side,
                slot_index,
                is_red,
                offence,
            } => {
                let wire_id = side.base_robot_id() + slot_index;
                self.save_undo(format!(
                    "{} Card ID #{}",
                    if is_red { "Red" } else { "Yellow" },
                    wire_id
                ));
                let category = self.state.category;
                let team = self.state.team_mut(side);
                if is_red {
                    team.team_red_cards = team.team_red_cards.saturating_add(1);
                    if let Some(slot) = team.slots.get_mut(slot_index as usize) {
                        slot.red_card = true;
                        slot.last_card_offence = Some(offence);
                    }
                } else {
                    team.team_yellow_cards = team.team_yellow_cards.saturating_add(1);
                    if let Some(slot) = team.slots.get_mut(slot_index as usize) {
                        slot.yellow_cards = slot.yellow_cards.saturating_add(1);
                        slot.last_card_offence = Some(offence);
                        if slot.yellow_cards >= 2 {
                            slot.red_card = true;
                            team.team_red_cards = team.team_red_cards.saturating_add(1);
                        }
                    }
                }
                let new_max = team.effective_max_players(category);
                self.state.push_log(
                    format!(
                        "{} Card shown to Robot ID #{} for {}. Team max active players now {}.",
                        if is_red { "RED" } else { "YELLOW" },
                        wire_id,
                        offence.label(),
                        new_max
                    ),
                    "[US-14.2]",
                );
            }
            RefereeAction::SubstitutePlayer {
                side,
                outgoing_slot,
                incoming_slot,
            } => {
                self.save_undo(format!(
                    "Substitute {:?} {} -> {}",
                    side, outgoing_slot, incoming_slot
                ));
                let team = self.state.team_mut(side);
                if team.substitutions_remaining > 0
                    && outgoing_slot != incoming_slot
                    && (outgoing_slot as usize) < team.slots.len()
                    && (incoming_slot as usize) < team.slots.len()
                {
                    let outgoing_role = team.slots[outgoing_slot as usize].role;
                    if outgoing_role.is_on_field()
                        && team.slots[incoming_slot as usize].role == RobotRole::Substitute
                    {
                        team.slots[outgoing_slot as usize].role = RobotRole::Substitute;
                        team.slots[incoming_slot as usize].role = outgoing_role;
                        team.substitutions_remaining -= 1;
                        let base = side.base_robot_id();
                        self.state.push_log(
                            format!(
                                "Substitution on {:?} Team: ID #{} replaced ID #{}. ({} substitutions left).",
                                side,
                                base + incoming_slot,
                                base + outgoing_slot,
                                team.substitutions_remaining
                            ),
                            "[US-4.3]",
                        );
                    }
                }
            }
            RefereeAction::StartTimeout { called_by } => {
                self.save_undo("Start Timeout");
                if let Some(side) = called_by {
                    let team = self.state.team_mut(side);
                    if team.timeouts_remaining == 0 {
                        return;
                    }
                    team.timeouts_remaining -= 1;
                    // [US-9.1]: "If a kick-off occurs because of a time-out, then the team that did not choose the time-out will have kick-off."
                    self.state.next_kickoff_side = side.opposite();
                }
                self.state.stage = RefereeStage::Timeout { called_by };
                self.state.secondary_seconds = TIMEOUT_SECS;
                self.state.push_log(
                    match called_by {
                        Some(s) => format!(
                            "{:?} Team called a 2-minute Timeout. Opposing team ({:?}) receives next Kick-Off.",
                            s,
                            s.opposite()
                        ),
                        None => "Referee called a Timeout.".to_string(),
                    },
                    "[US-8.6] / [US-9.1]",
                );
            }
            RefereeAction::AdvancePeriod => {
                self.save_undo("Advance Period");
                match self.state.phase {
                    MatchPhase::FirstHalf => {
                        self.state.phase = MatchPhase::HalfTimeBreak;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds =
                            MatchPhase::HalfTimeBreak.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        self.state
                            .push_log("Entered 5-minute Half-Time Break.", "[US-8.4]");
                    }
                    MatchPhase::HalfTimeBreak => {
                        // [US-8.5]: "After the end of the half time, the teams will switch their start side."
                        std::mem::swap(&mut self.state.left_team, &mut self.state.right_team);
                        self.state.phase = MatchPhase::SecondHalf;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds = MatchPhase::SecondHalf.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        // Since teams swapped sides, the team that did NOT kick off in 1st half is now on the same side as `first_half_kickoff_side`!
                        self.state.next_kickoff_side = self.state.first_half_kickoff_side;
                        self.state.push_log(
                            "Teams switched sides after Half-Time. Started 2nd Half (10:00).",
                            "[US-8.5]",
                        );
                    }
                    MatchPhase::SecondHalf => {
                        // [US-12.4]: "If a game ends in a draw, two additional periods of five minute duration with an additional five minute half-time will be played (Overtime)."
                        self.state.phase = MatchPhase::OvertimeFirstHalf;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds =
                            MatchPhase::OvertimeFirstHalf.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        self.state.push_log(
                            "Started Overtime 1st Half (5:00).",
                            "[US-12.4]",
                        );
                    }
                    MatchPhase::OvertimeFirstHalf => {
                        self.state.phase = MatchPhase::OvertimeHalfTimeBreak;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds =
                            MatchPhase::OvertimeHalfTimeBreak.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        self.state.push_log(
                            "Entered Overtime Half-Time Break (5:00).",
                            "[US-12.4]",
                        );
                    }
                    MatchPhase::OvertimeHalfTimeBreak => {
                        std::mem::swap(&mut self.state.left_team, &mut self.state.right_team);
                        self.state.phase = MatchPhase::OvertimeSecondHalf;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds =
                            MatchPhase::OvertimeSecondHalf.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        self.state.push_log(
                            "Teams switched sides. Started Overtime 2nd Half (5:00).",
                            "[US-12.4]",
                        );
                    }
                    MatchPhase::OvertimeSecondHalf | MatchPhase::PenaltyShootout => {
                        self.state.phase = MatchPhase::PenaltyShootout;
                        self.state.stage = RefereeStage::Stopped;
                        self.state.primary_seconds =
                            MatchPhase::PenaltyShootout.default_duration_secs();
                        self.state.secondary_seconds = 0;
                        self.state.push_log(
                            "Entered 5-Round Alternating Penalty Shootout.",
                            "[US-12.4] / [US-20.3]",
                        );
                    }
                }
            }
            RefereeAction::AdjustPrimaryClock { delta_seconds } => {
                self.save_undo(format!("Clock {:+}s", delta_seconds));
                self.state.primary_seconds = (self.state.primary_seconds + delta_seconds).max(0);
            }
            RefereeAction::RecordShootoutAttempt { side, scored } => {
                self.save_undo(format!("Shootout {:?}", side));
                let team = self.state.team_mut(side);
                team.shootout_attempts = team.shootout_attempts.saturating_add(1);
                if scored {
                    team.shootout_goals = team.shootout_goals.saturating_add(1);
                }
                self.state.push_log(
                    format!(
                        "Penalty Shootout attempt #{}: {:?} Team {}.",
                        team.shootout_attempts,
                        side,
                        if scored { "SCORED" } else { "MISSED / SAVED" }
                    ),
                    "[US-12.4] / [US-20.3]",
                );
            }
        }
    }
}

trait TruncateAndPop<T> {
    fn truncate_and_pop(&mut self, index: usize) -> Option<T>;
}

impl<T> TruncateAndPop<T> for Vec<T> {
    fn truncate_and_pop(&mut self, index: usize) -> Option<T> {
        if index < self.len() {
            let item = self.swap_remove(index);
            self.truncate(index);
            Some(item)
        } else {
            None
        }
    }
}

impl PartialOrd for LeaderboardEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for LeaderboardEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.official_points
            .cmp(&other.official_points)
            .then_with(|| self.score.goals_scored.cmp(&other.score.goals_scored))
            .then_with(|| self.score.saves_made.cmp(&other.score.saves_made))
            .then_with(|| self.positive_points.cmp(&other.positive_points))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kickoff_flow_and_wire_states() {
        let mut ctrl = UnitedSoccerController::new(CompetitionCategory::KidSize);
        assert_eq!(ctrl.state.wire_game_state(), WireGameState::Stopped);
        assert_eq!(ctrl.state.team_bitmasks(), (0b0001_1111, 0b0001_1111));

        // 1. Signal READY for Left Team Kick-Off
        ctrl.apply_action(RefereeAction::SignalReady {
            restart: RestartKind::KickOff(DefendingSide::Left),
        });
        assert_eq!(ctrl.state.secondary_seconds, 10);
        assert_eq!(ctrl.state.wire_game_state(), WireGameState::Stopped);

        // 2. Tick 10 seconds -> automatically transitions to SET (State = 1: Set Kick off Left Team)
        for _ in 0..10 {
            ctrl.state.tick_one_second();
        }
        assert_eq!(ctrl.state.wire_game_state(), WireGameState::SetKickOffLeft);

        // 3. Signal PLAY -> enters PlayKickOff (State = 3: Play Kick off Left Team) for 10s
        ctrl.apply_action(RefereeAction::SignalPlay);
        assert_eq!(ctrl.state.wire_game_state(), WireGameState::PlayKickOffLeft);
        assert_eq!(ctrl.state.secondary_seconds, 10);

        // 4. Confirm ball touched -> immediately transitions to State = 5 (Play: Ball in play)
        ctrl.apply_action(RefereeAction::ConfirmKickOffTouch);
        assert_eq!(ctrl.state.wire_game_state(), WireGameState::PlayBallInPlay);
    }

    #[test]
    fn removal_penalty_clears_bitmask_and_deducts_point() {
        let mut ctrl = UnitedSoccerController::new(CompetitionCategory::KidSize);
        assert_eq!(ctrl.state.team_bitmasks().0, 0b0001_1111); // Slots 0..4 active

        // Penalize slot 2 on Left Team for 30s (Touching Passing Marker [US-15.8])
        ctrl.apply_action(RefereeAction::ApplyRemovalPenalty {
            side: DefendingSide::Left,
            slot_index: 2,
            reason: RemovalPenaltyReason::TouchingPassingMarker,
            start_timer_immediately: true,
        });

        // Bit 2 must be cleared in Team Left bitmask [US-21.22]
        assert_eq!(ctrl.state.team_bitmasks().0, 0b0001_1011);
        // Slot 2 has -1 point [US-19.1]
        assert_eq!(ctrl.state.left_team.slots[2].score.raw_total(), -1);
        assert_eq!(ctrl.state.left_team.slots[2].score.official_points(), 0);

        // Return robot after 30s
        ctrl.apply_action(RefereeAction::ReturnPenalizedRobot {
            side: DefendingSide::Left,
            slot_index: 2,
        });
        assert_eq!(ctrl.state.team_bitmasks().0, 0b0001_1111);
    }

    #[test]
    fn yellow_cards_reduce_team_player_quota() {
        let mut ctrl = UnitedSoccerController::new(CompetitionCategory::KidSize);
        assert_eq!(
            ctrl.state
                .left_team
                .effective_max_players(CompetitionCategory::KidSize),
            5
        );

        // First yellow card on slot 1 -> still 5 players allowed
        ctrl.apply_action(RefereeAction::IssueCard {
            side: DefendingSide::Left,
            slot_index: 1,
            is_red: false,
            offence: CardOffence::PushingOpponent,
        });
        assert_eq!(
            ctrl.state
                .left_team
                .effective_max_players(CompetitionCategory::KidSize),
            5
        );

        // Second yellow card on slot 3 -> team now has 2 yellow cards -> reduced to 4 players [US-14.2]
        ctrl.apply_action(RefereeAction::IssueCard {
            side: DefendingSide::Left,
            slot_index: 3,
            is_red: false,
            offence: CardOffence::ChargingOpponent,
        });
        assert_eq!(
            ctrl.state
                .left_team
                .effective_max_players(CompetitionCategory::KidSize),
            4
        );
        // Only 4 bits set in bitmask!
        assert_eq!(ctrl.state.team_bitmasks().0.count_ones(), 4);
    }

    #[test]
    fn individual_scoring_and_us20_tiebreakers() {
        let mut ctrl = UnitedSoccerController::new(CompetitionCategory::KidSize);

        // Left slot 1 scores a goal (+10 to slot 1, +2 to slots 0,2,3,4, -2 to Right slots 0..4)
        ctrl.apply_action(RefereeAction::AwardGoal {
            scoring_side: DefendingSide::Left,
            scorer_slot: Some(1),
        });

        assert_eq!(ctrl.state.left_team.slots[1].score.raw_total(), 10);
        assert_eq!(ctrl.state.left_team.slots[0].score.raw_total(), 2);
        assert_eq!(ctrl.state.right_team.slots[0].score.raw_total(), -2);
        // Per [US-19.2], < 1 point receives 0 official points and no rank
        assert_eq!(ctrl.state.right_team.slots[0].score.official_points(), 0);
        assert!(!ctrl.state.right_team.slots[0].score.is_ranked());

        // Give Right slot 0 two saves (+14) so its net score is -2 + 14 = 12
        ctrl.apply_action(RefereeAction::RecordIndividualAction {
            side: DefendingSide::Right,
            slot_index: 0,
            kind: IndividualActionKind::Save,
        });
        ctrl.apply_action(RefereeAction::RecordIndividualAction {
            side: DefendingSide::Right,
            slot_index: 0,
            kind: IndividualActionKind::Save,
        });
        assert_eq!(ctrl.state.right_team.slots[0].score.raw_total(), 12);

        // Give Left slot 1 a passing pole kick (+2) so its net score is also 10 + 2 = 12
        ctrl.apply_action(RefereeAction::RecordIndividualAction {
            side: DefendingSide::Left,
            slot_index: 1,
            kind: IndividualActionKind::PassingPoleKick,
        });
        assert_eq!(ctrl.state.left_team.slots[1].score.raw_total(), 12);

        // Both have 12 points! Tiebreaker [US-20.1] uses goals scored (Left slot 1 has 1 goal vs Right slot 0's 0 goals)
        let board = ctrl.state.compute_leaderboard();
        assert_eq!(board[0].wire_robot_id, 1); // Left slot 1 is Rank 1
        assert_eq!(board[0].rank, Some(1));
        assert_eq!(board[1].wire_robot_id, 16); // Right slot 0 (ID 16) is Rank 2
        assert_eq!(board[1].rank, Some(2));
    }
}
