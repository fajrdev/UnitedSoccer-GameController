import {
  CheckCircleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

const COMPARISON_ROWS = [
  {
    feature: "Wire Protocol & Endianness",
    robocup:
      "Little-endian C struct `RoboCupGameControlData` (`RGme` v20 on UDP 3838, `RGrt` v4 on 3939, monitor `RGTr` on 3636).",
    usoccer:
      "MSB-first (Big-Endian) `0xADDE` frame [US-21.3, US-21.6] with Length, Sender ID, SeqNum, 8-byte Objects[], Dummy `0x00`, and wrapping 8-bit Checksum.",
    status: "Native [US-21] 0xADDE MSB protocol",
    kept: true,
  },
  {
    feature: "Player & Referee Addressing",
    robocup: "Team Number (u8) + Player Number (1..20).",
    usoccer:
      "Left Defending Team: IDs 0..10 • Right Defending Team: IDs 16..26 • Referee Box: Special ID 32 [US-21.7].",
    status: "IDs 0..10, 16..26 & Referee ID 32",
    kept: true,
  },
  {
    feature: "Play Permission & Penalty Signaling",
    robocup: "Per-player `RobotInfo { penalty, secsTillUnpenalised, cautions }` array.",
    usoccer:
      "16-bit `Team Left` & `Team Right` bitmasks in Referee Object (Type=97) [US-21.22]. Any robot whose ID bit is 0 must remain motionless.",
    status: "16-bit Team Left / Right bitmasks",
    kept: true,
  },
  {
    feature: "Referee Game State Values",
    robocup:
      "`STATE_INITIAL(0)`, `READY(1)`, `SET(2)`, `PLAYING(3)`, `FINISHED(4)` + separate `stopped`, `setPlay`, `kickingTeam` fields.",
    usoccer:
      "Single `State (UINT8)` in Type=97 [US-21.23]: `0`=Stopped, `1`=Set Kick-off Left, `2`=Set Kick-off Right, `3`=Play Kick-off Left, `4`=Play Kick-off Right, `5`=Play Ball in play.",
    status: "Exact [US-21.23] States 0..5",
    kept: true,
  },
  {
    feature: "Team Formation & Club Mixing",
    robocup: "Single-club teams from `teams.yaml` with jersey color conflict validation.",
    usoccer:
      "United Teams formed by randomly selecting robots from different clubs up to 5 players (Kid Size) or 3 players (Adult Size) + max 2 substitutes [US-4.1, US-4.3, US-8.1].",
    status: "Random United Team Builder",
    kept: true,
  },
  {
    feature: "Scoring & Winner Determination",
    robocup: "Team goals only + Mercy Rule (`mercyRuleScoreDifference`).",
    usoccer:
      "Team Goals + Individual Robot Scoring [US-19.1]: Goal (+10), Save (+7), Passing Pole Kick (+2), Teammate Goal (+2), Opponent Goal (-2), 30s Removal Penalty (-1), plus [US-20] Tiebreakers.",
    status: "US-19/US-20 Scoring Engine",
    kept: true,
  },
  {
    feature: "Direct / Indirect Free Kicks, Goal Kicks, Corner Kicks",
    robocup: "Dedicated set-play buttons & timers for Direct/Indirect Free Kick, Goal Kick, Corner Kick.",
    usoccer:
      "NOT USED in United Soccer. Ball out of bounds over touch line or goal line results in a continuous-play Throw-In [US-18.1–18.3]; fouls result in 30s Removal Penalty [US-16.1] or Penalty Kick [US-17.1].",
    status: "Omitted (Not in FIRA United Soccer)",
    kept: false,
  },
  {
    feature: "Throw-In Stoppage Set Play",
    robocup: "Stops/restricts play with a Throw-In set-play state.",
    usoccer:
      "[US-18.3]: 'The game is not stopped for a throw-in.' Referee places ball 50cm inside touch line while play continues.",
    status: "Omitted stoppage; continuous play",
    kept: false,
  },
  {
    feature: "Delayed Game State ('Fake' State Forking)",
    robocup: "Sends pre-transition state to robots for 10s after entering Playing (`fork`).",
    usoccer:
      "NOT USED. Assistant referee broadcasts UDP PLAY simultaneously with the referee's whistle [US-9.6].",
    status: "Omitted delayed fake state",
    kept: false,
  },
  {
    feature: "Incremental Penalty Duration",
    robocup: "Penalty duration increases with each previous incremental penalty on the team.",
    usoccer:
      "Fixed 30-second Removal Penalty [US-16.1] for all [US-15] fouls (non-incremental, deducts -1 individual point).",
    status: "Fixed at 30s [US-16.1]",
    kept: false,
  },
  {
    feature: "Total Match Message Budget & Score Zeroing",
    robocup: "1200 message budget per game; exceeding resets team's goals to 0.",
    usoccer:
      "Per-robot rate & bandwidth limit [US-3.6]: max 10 KB/s and max 30 messages/s per robot. Does not zero team score.",
    status: "Per-robot B/s & msg/s monitor [US-3.6]",
    kept: true,
  },
];

export default function ComparisonView() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6 bg-[#ffffff] p-5">
      {/* Ollama Docs-Prose Header Block */}
      <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#0a0a0a] text-[#ffffff]">
            <InformationCircleIcon className="h-4 w-4" />
          </span>
          <h2 className="text-[22px] font-bold tracking-[-0.5px] text-[#0a0a0a]">
            Architecture & Rule Comparison: FIRA HuroCup United Soccer vs. RoboCup 2026
            GameController
          </h2>
        </div>
        <p className="mt-2 max-w-[82ch] text-[14px] leading-[1.6] text-[#5f5f5f]">
          Every subsystem below was audited against{" "}
          <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">
            unitedsoccer-rules-hurocup.md
          </code>{" "}
          and{" "}
          <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">
            general-rules-hurocup.md
          </code>{" "}
          so unused RoboCup 2026 controls are excluded and all FIRA United Soccer mechanics are
          first-class.
        </p>
      </div>

      {/* MiniMax Models-Comparison-Table Chrome */}
      <div className="overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-[#ffffff]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#e5e7eb] bg-[#f7f8fa] text-[12px] font-bold text-[#5f5f5f]">
              <tr>
                <th className="px-5 py-3.5">Feature / Subsystem</th>
                <th className="px-5 py-3.5">RoboCup 2026 GameController</th>
                <th className="px-5 py-3.5">FIRA HuroCup United Soccer Rules</th>
                <th className="px-5 py-3.5">Implementation Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eaecf0]">
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature} className="transition hover:bg-[#fafafa]">
                  <td className="px-5 py-4 font-bold text-[#0a0a0a]">{row.feature}</td>
                  <td className="px-5 py-4 text-[#5f5f5f]">{row.robocup}</td>
                  <td className="px-5 py-4 font-medium text-[#0a0a0a]">{row.usoccer}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
                        row.kept
                          ? "bg-[#e8ffea] text-[#1ba673]"
                          : "bg-[#ff5530]/15 text-[#ff5530]"
                      }`}
                    >
                      {row.kept ? (
                        <CheckCircleIcon className="h-4 w-4 shrink-0" />
                      ) : (
                        <XCircleIcon className="h-4 w-4 shrink-0" />
                      )}
                      <span>{row.status}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
