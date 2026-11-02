import {
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import {
  MAX_ROBOT_BYTES_PER_SEC,
  MAX_ROBOT_MSGS_PER_SEC,
} from "../protocol/usoccer_engine.js";

export default function TelemetryView({
  snapshot,
  onApplyAction,
  onStepSimulatorOnce,
}) {
  const {
    matchState,
    robotTelemetry,
    recentPackets,
    lastRefereePacketHex,
    leftBitmask,
    rightBitmask,
  } = snapshot;

  // Field coordinate system [US-21.9, US-1.11]:
  // Total field play area: 7000mm length (X: 0..7000) x 5000mm width (Y: 0..5000)
  const FIELD_W = 7000;
  const FIELD_H = 5000;

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-5 bg-[#ffffff] p-5 xl:grid-cols-12">
      {/* Left 7 Columns: 2D Interactive Field Map [US-1.11, US-1.21, US-21.14-20] */}
      <div className="flex flex-col gap-5 xl:col-span-7">
        <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold tracking-[-0.4px] text-[#0a0a0a]">
                Live 2D Field Telemetry & Passing Markers [US-1.11, US-1.21, US-21]
              </h2>
              <p className="mt-0.5 text-[13px] text-[#5f5f5f]">
                Visualizes decoded{" "}
                <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">
                  State (0..6)
                </code>
                ,{" "}
                <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">
                  Perception (32..40)
                </code>
                ,{" "}
                <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">
                  Intention (64..67)
                </code>{" "}
                vectors, and the 6 Passing Markers [US-1.21].
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onApplyAction({ type: "randomizePassingMarkers" })}
                className="flex items-center gap-1.5 rounded-full border border-[#0a0a0a] bg-[#ffffff] px-4 py-1.5 text-[12px] font-medium text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                <span>Randomize 6 Passing Poles [US-1.21]</span>
              </button>
              <button
                type="button"
                onClick={onStepSimulatorOnce}
                className="flex items-center gap-1.5 rounded-full bg-[#000000] px-4 py-1.5 text-[12px] font-medium text-[#ffffff] transition hover:bg-[#262626]"
              >
                <BoltIcon className="h-3.5 w-3.5" />
                <span>Pulse 0xADDE Burst</span>
              </button>
            </div>
          </div>

          {/* 2D SVG Soccer Field */}
          <div className="overflow-hidden rounded-[12px] border border-[#e5e5e5] bg-[#064e3b] p-2">
            <svg
              viewBox={`-350 -350 ${FIELD_W + 700} ${FIELD_H + 700}`}
              className="h-auto w-full select-none"
            >
              {/* Outer Boundary Border (>30cm [US-1.5]) */}
              <rect
                x="-300"
                y="-300"
                width={FIELD_W + 600}
                height={FIELD_H + 600}
                rx="80"
                fill="#064e3b"
                stroke="#047857"
                strokeWidth="25"
              />

              {/* Playing Field Surface [US-1.3] */}
              <rect
                x="0"
                y="0"
                width={FIELD_W}
                height={FIELD_H}
                fill="#065f46"
                stroke="#ffffff"
                strokeWidth="50"
              />

              {/* Halfway Line & Center Circle ($DC = 100cm = 1000mm diameter -> 500mm radius [US-1.8, US-1.9]) */}
              <line
                x1={FIELD_W / 2}
                y1="0"
                x2={FIELD_W / 2}
                y2={FIELD_H}
                stroke="#ffffff"
                strokeWidth="50"
              />
              <circle
                cx={FIELD_W / 2}
                cy={FIELD_H / 2}
                r="500"
                fill="none"
                stroke="#ffffff"
                strokeWidth="50"
              />
              <circle cx={FIELD_W / 2} cy={FIELD_H / 2} r="45" fill="#ffffff" />

              {/* Left Goal (Red Posts [US-1.19], Width $GW=2000mm, Depth $GL=300mm) */}
              <rect
                x="-300"
                y={(FIELD_H - 2000) / 2}
                width="300"
                height="2000"
                fill="rgba(255, 85, 48, 0.35)"
                stroke="#ff5530"
                strokeWidth="50"
              />
              {/* Left Goal Area ($DW=2500mm, $DL=500mm [US-1.12]) */}
              <rect
                x="0"
                y={(FIELD_H - 2500) / 2}
                width="500"
                height="2500"
                fill="none"
                stroke="#ffffff"
                strokeWidth="45"
              />
              {/* Left Penalty Area ($PW=3000mm, $PL=1200mm [US-1.13]) */}
              <rect
                x="0"
                y={(FIELD_H - 3000) / 2}
                width="1200"
                height="3000"
                fill="none"
                stroke="#ffffff"
                strokeWidth="45"
              />
              {/* Left Penalty Mark (750mm / 1000mm [US-1.14]) */}
              <circle cx="1000" cy={FIELD_H / 2} r="40" fill="#ffffff" />

              {/* Right Goal (Red Posts [US-1.19]) */}
              <rect
                x={FIELD_W}
                y={(FIELD_H - 2000) / 2}
                width="300"
                height="2000"
                fill="rgba(255, 85, 48, 0.35)"
                stroke="#ff5530"
                strokeWidth="50"
              />
              {/* Right Goal Area */}
              <rect
                x={FIELD_W - 500}
                y={(FIELD_H - 2500) / 2}
                width="500"
                height="2500"
                fill="none"
                stroke="#ffffff"
                strokeWidth="45"
              />
              {/* Right Penalty Area */}
              <rect
                x={FIELD_W - 1200}
                y={(FIELD_H - 3000) / 2}
                width="1200"
                height="3000"
                fill="none"
                stroke="#ffffff"
                strokeWidth="45"
              />
              {/* Right Penalty Mark */}
              <circle cx={FIELD_W - 1000} cy={FIELD_H / 2} r="40" fill="#ffffff" />

              {/* 6 Passing Markers [US-1.21] */}
              {matchState.passingMarkersMm.map(([px, py], idx) => (
                <g key={`pole-${idx}`}>
                  <circle
                    cx={px}
                    cy={py}
                    r="130"
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="30"
                  />
                  <text
                    x={px}
                    y={py + 45}
                    textAnchor="middle"
                    fill="#0a0a0a"
                    fontSize="130"
                    fontWeight="bold"
                  >
                    P{idx + 1}
                  </text>
                </g>
              ))}

              {/* Sensed Ball Positions & Intention Vectors from Active Robots */}
              {robotTelemetry.map((bot) => {
                if (!bot.ownPosition) return null;
                const [rx, ry] = bot.ownPosition;
                const isLeft = bot.robotId <= 10;
                const slotIdx = isLeft ? bot.robotId : bot.robotId - 16;
                const bitAllowed = isLeft
                  ? (leftBitmask & (1 << slotIdx)) !== 0
                  : (rightBitmask & (1 << slotIdx)) !== 0;

                return (
                  <g key={`bot-${bot.robotId}`}>
                    {/* Intention Vector Line [US-21.19] */}
                    {bot.intention && (
                      <line
                        x1={rx}
                        y1={ry}
                        x2={bot.intention[1]}
                        y2={bot.intention[2]}
                        stroke={isLeft ? "#60a5fa" : "#ff8a70"}
                        strokeWidth="28"
                        strokeDasharray="70 50"
                        opacity="0.85"
                      />
                    )}

                    {/* Sensed Ball (from Robot ID #0 or #16 so we don't draw 10 overlapping balls) */}
                    {bot.ballPosition && (bot.robotId === 0 || bot.robotId === 16) && (
                      <circle
                        cx={bot.ballPosition[0]}
                        cy={bot.ballPosition[1]}
                        r="110"
                        fill="#fde047"
                        stroke="#0a0a0a"
                        strokeWidth="25"
                      />
                    )}

                    {/* Robot Circle */}
                    <circle
                      cx={rx}
                      cy={ry}
                      r="175"
                      fill={
                        !bitAllowed
                          ? "#525252"
                          : isLeft
                            ? "#1456f0"
                            : "#ff5530"
                      }
                      stroke="#ffffff"
                      strokeWidth="35"
                    />
                    <text
                      x={rx}
                      y={ry + 55}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="155"
                      fontWeight="bold"
                    >
                      {bot.robotId}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Field Legend */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#5f5f5f]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 font-medium text-[#0a0a0a]">
                <span className="h-3 w-3 rounded-full bg-[#1456f0]" /> Left Team (IDs 0..10)
              </span>
              <span className="flex items-center gap-1.5 font-medium text-[#0a0a0a]">
                <span className="h-3 w-3 rounded-full bg-[#ff5530]" /> Right Team (IDs 16..26)
              </span>
              <span className="flex items-center gap-1.5 font-medium text-[#0a0a0a]">
                <span className="h-3 w-3 rounded-full bg-[#f59e0b]" /> 6 Passing Markers [US-1.21]
              </span>
              <span className="flex items-center gap-1.5 font-medium text-[#0a0a0a]">
                <span className="h-3 w-3 rounded-full border border-[#0a0a0a] bg-[#fde047]" />{" "}
                Sensed Ball [US-21.18]
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#737373]">
              Origin (0,0) = Goal line ∩ Touch line • Units: mm [US-21.9]
            </span>
          </div>
        </div>

        {/* [US-3.6 & US-5.2] Robot Bandwidth & Message Rate Compliance Monitor (MiniMax Data Table) */}
        <div className="overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-[#ffffff]">
          <div className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-4">
            <div>
              <h3 className="text-[16px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
                Robot Communication & Bandwidth Compliance [US-3.6, US-5.2]
              </h3>
              <p className="text-[12px] text-[#5f5f5f]">
                Per [US-3.6]: Each robot must not exceed{" "}
                <strong className="text-[#0a0a0a]">30 messages/s</strong> or{" "}
                <strong className="text-[#0a0a0a]">10 kBytes/s (10,240 B/s)</strong>.
              </p>
            </div>
            <SignalIcon className="h-5 w-5 text-[#1ba673]" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-[#e5e7eb] bg-[#f7f8fa] text-[11px] font-bold text-[#5f5f5f] uppercase">
                <tr>
                  <th className="px-4 py-2.5">Robot ID</th>
                  <th className="px-3 py-2.5">Seq #</th>
                  <th className="px-3 py-2.5">Rate (≤30 msg/s)</th>
                  <th className="px-3 py-2.5">Bandwidth (≤10 KB/s)</th>
                  <th className="px-3 py-2.5">Pose (X, Y mm)</th>
                  <th className="px-3 py-2.5">Intention [US-21.19]</th>
                  <th className="px-4 py-2.5 text-right">[US-3.6] Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eaecf0]">
                {robotTelemetry.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[#737373]">
                      No incoming robot 0xADDE packets yet. Enable &quot;Sim Robots: ON&quot; in the
                      top bar or connect robots on UDP port {snapshot.networkConfig.port}.
                    </td>
                  </tr>
                ) : (
                  robotTelemetry.map((bot) => {
                    const isLeft = bot.robotId <= 10;
                    const ratePct = Math.min(
                      100,
                      Math.round((bot.messagesPerSec / MAX_ROBOT_MSGS_PER_SEC) * 100),
                    );
                    const bwPct = Math.min(
                      100,
                      Math.round((bot.bytesPerSec / MAX_ROBOT_BYTES_PER_SEC) * 100),
                    );
                    return (
                      <tr key={bot.robotId} className="hover:bg-[#fafafa]">
                        <td className="px-4 py-2.5 font-mono font-bold">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                              isLeft
                                ? "bg-[#bfdbfe] text-[#1d4ed8]"
                                : "bg-[#ff5530]/15 text-[#ff5530]"
                            }`}
                          >
                            ID #{bot.robotId}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[#5f5f5f]">
                          #{bot.lastSequenceNumber}
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="w-16 font-semibold text-[#0a0a0a]">
                              {bot.messagesPerSec} msg/s
                            </span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e5e5]">
                              <div
                                className={`h-full ${
                                  ratePct > 100 ? "bg-[#ff5530]" : "bg-[#1ba673]"
                                }`}
                                style={{ width: `${ratePct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <div className="flex items-center gap-2">
                            <span className="w-16 font-semibold text-[#0a0a0a]">
                              {bot.bytesPerSec} B/s
                            </span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e5e5e5]">
                              <div
                                className={`h-full ${
                                  bwPct > 100 ? "bg-[#ff5530]" : "bg-[#1456f0]"
                                }`}
                                style={{ width: `${bwPct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[#0a0a0a]">
                          {bot.ownPosition
                            ? `(${bot.ownPosition[0]}, ${bot.ownPosition[1]})`
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[#5f5f5f]">
                          {bot.intention
                            ? `${bot.intention[0]} (Off=${bot.intention[3]})`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {bot.compliance === "compliant" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#e8ffea] px-2.5 py-0.5 text-[11px] font-semibold text-[#1ba673]">
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                              OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#ff5530] px-2.5 py-0.5 text-[11px] font-semibold text-[#ffffff]">
                              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                              {bot.compliance}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right 5 Columns: Ollama Terminal-Card [US-21] 0xADDE Binary Frame & Checksum Inspector */}
      <div className="flex flex-col gap-5 xl:col-span-5">
        {/* Ollama Terminal Card for Current Referee Broadcast Frame [US-21.6, US-21.23] */}
        <div className="terminal-card p-5">
          <div className="mb-3 flex items-center justify-between border-b border-[#e5e5e5] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="terminal-dot bg-[#ff5f56]" />
              <span className="terminal-dot bg-[#ffbd2e]" />
              <span className="terminal-dot bg-[#27c93f]" />
              <span className="ml-1.5 font-mono text-[12px] font-semibold text-[#0a0a0a]">
                usoccer-referee-frame (ID=32, Type=97)
              </span>
            </div>
            <span className="rounded-full bg-[#e8ffea] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#1ba673]">
              MSB-FIRST [US-21.3]
            </span>
          </div>

          <p className="text-[12px] text-[#5f5f5f]">
            18-byte Big-Endian UDP datagram broadcast to all robots on{" "}
            <code className="font-mono font-semibold text-[#0a0a0a]">
              {snapshot.networkConfig.broadcastIp}:{snapshot.networkConfig.port}
            </code>
          </p>

          {/* Ollama Install-Snippet Pill for 18-Byte Hex Payload */}
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-bold tracking-wider text-[#737373] uppercase">
              Latest 18-Byte Hex Payload:
            </div>
            <div className="install-snippet w-full justify-between overflow-x-auto text-[12px] font-semibold text-[#0a0a0a]">
              <span>$ {lastRefereePacketHex}</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Header (UINT16):</span>{" "}
              <span className="font-bold text-[#0a0a0a]">0xADDE</span>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Length (UINT16):</span>{" "}
              <span className="font-bold text-[#0a0a0a]">18 bytes (0x0012)</span>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Sender ID (UINT8):</span>{" "}
              <span className="font-bold text-[#1ba673]">32 (0x20 Referee)</span>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Object Type (UINT8):</span>{" "}
              <span className="font-bold text-[#0a0a0a]">97 (0x61 State)</span>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Team Left (UINT16):</span>{" "}
              <span className="font-bold text-[#1456f0]">
                0x{leftBitmask.toString(16).toUpperCase().padStart(4, "0")}
              </span>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
              <span className="text-[#737373]">Team Right (UINT16):</span>{" "}
              <span className="font-bold text-[#ff5530]">
                0x{rightBitmask.toString(16).toUpperCase().padStart(4, "0")}
              </span>
            </div>
          </div>
        </div>

        {/* Ollama Terminal-Card Live UDP Packet Stream */}
        <div className="terminal-card flex flex-1 flex-col p-5">
          <div className="mb-3 flex items-center justify-between border-b border-[#e5e5e5] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="terminal-dot bg-[#ff5f56]" />
              <span className="terminal-dot bg-[#ffbd2e]" />
              <span className="terminal-dot bg-[#27c93f]" />
              <span className="ml-1.5 font-mono text-[12px] font-semibold text-[#0a0a0a]">
                udp-stream://0xADDE
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#737373]">
              Last {recentPackets.length} frames
            </span>
          </div>

          <div className="max-h-96 flex-1 space-y-2 overflow-y-auto pr-1">
            {recentPackets.map((pkt) => (
              <div
                key={pkt.id}
                className={`rounded-[10px] border p-3 font-mono text-[11px] ${
                  pkt.isReferee
                    ? "border-[#1ba673]/30 bg-[#e8ffea]/40"
                    : "border-[#e5e5e5] bg-[#fafafa]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      pkt.isReferee
                        ? "bg-[#e8ffea] text-[#1ba673]"
                        : pkt.senderId <= 10
                          ? "bg-[#bfdbfe] text-[#1d4ed8]"
                          : "bg-[#ff5530]/15 text-[#ff5530]"
                    }`}
                  >
                    {pkt.isReferee ? "TX REFEREE (ID #32)" : `RX ROBOT (ID #${pkt.senderId})`}
                  </span>
                  <span className="text-[#737373]">
                    Seq #{pkt.sequenceNumber} • {pkt.lengthBytes}B • Cksum {pkt.checksumHex}
                  </span>
                </div>
                <div className="mt-1.5 font-sans text-[12px] font-medium text-[#0a0a0a]">
                  {pkt.summary}
                </div>
                <div className="mt-1 truncate text-[10px] text-[#737373]">{pkt.rawHex}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
