import { useEffect, useState } from "react";
import {
  ArrowUturnLeftIcon,
  ArrowsRightLeftIcon,
  BoltIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  HandRaisedIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import {
  CARD_OFFENCES,
  computeIndividualPoints,
  REMOVAL_PENALTY_REASONS,
  restartLabel,
} from "../protocol/usoccer_engine.js";

function formatClock(totalSeconds) {
  const neg = totalSeconds < 0;
  const abs = Math.abs(totalSeconds);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${neg ? "-" : ""}${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatBitmaskBinary(mask) {
  return (mask & 0x7ff).toString(2).padStart(11, "0");
}

export default function RefereeDeck({ snapshot, onApplyAction }) {
  const {
    matchState,
    wireState,
    wireStateLabel,
    leftBitmask,
    rightBitmask,
    leftMaxPlayers,
    rightMaxPlayers,
    undoLabels,
    robotTelemetry,
  } = snapshot;

  const [goalModalSide, setGoalModalSide] = useState(null);
  const [penaltyModalTarget, setPenaltyModalTarget] = useState(null);
  const [cardModalTarget, setCardModalTarget] = useState(null);
  const [subModalSide, setSubModalSide] = useState(null);
  const [selectedOutgoingSlot, setSelectedOutgoingSlot] = useState(0);
  const [selectedIncomingSlot, setSelectedIncomingSlot] = useState(5);

  // Spacebar emergency STOP PLAY shortcut
  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.code === "Space" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault();
        onApplyAction({ type: "stopPlay" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onApplyAction]);

  const telemetryByRobotId = new Map(robotTelemetry.map((t) => [t.robotId, t]));

  const renderTeamPanel = (side) => {
    const isLeft = side === "left";
    const team = isLeft ? matchState.leftTeam : matchState.rightTeam;
    const bitmask = isLeft ? leftBitmask : rightBitmask;
    const maxPlayers = isLeft ? leftMaxPlayers : rightMaxPlayers;
    const baseId = isLeft ? 0 : 16;

    const visibleSlots = team.slots.filter((s) => s.role !== "inactive");
    const activeFieldSlots = team.slots.filter(
      (s) => s.role === "goalkeeper" || s.role === "fieldPlayer",
    );
    const subSlots = team.slots.filter((s) => s.role === "substitute");

    return (
      <div className="flex flex-col gap-3.5">
        {/* MiniMax Vibrant Product Card (`rounded-[28px]`, `brand-blue` #1456f0 for Left, `brand-coral` #ff5530 for Right) */}
        <div
          className={`rounded-[28px] p-6 text-[#ffffff] ${
            isLeft ? "bg-[#1456f0]" : "bg-[#ff5530]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-[#ffffff]/20 px-3 py-0.5 font-mono text-[11px] font-semibold text-[#ffffff]">
                  {isLeft ? "LEFT GOAL · IDs 0..10" : "RIGHT GOAL · IDs 16..26"}
                </span>
                {matchState.nextKickoffSide === side && (
                  <span className="rounded-full bg-[#0a0a0a] px-3 py-0.5 text-[11px] font-semibold text-[#ffffff]">
                    NEXT KICK-OFF
                  </span>
                )}
              </div>
              <h2 className="mt-2.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.8px] text-[#ffffff]">
                {team.name}
              </h2>
              <p className="mt-1 font-mono text-[12px] text-[#ffffff]/80">
                Bitmask [US-21.22]:{" "}
                <strong className="text-[#ffffff]">
                  0x{bitmask.toString(16).toUpperCase().padStart(4, "0")}
                </strong>{" "}
                <span className="opacity-75">({formatBitmaskBinary(bitmask)})</span>
              </p>
            </div>

            {/* MiniMax Display-LG Score + White Pill CTA (`button-pill-on-dark`) */}
            <div className="flex flex-col items-end gap-2">
              <div className="text-[56px] font-semibold leading-none tracking-[-2px] text-[#ffffff]">
                {team.goals}
              </div>
              <button
                type="button"
                onClick={() => setGoalModalSide(side)}
                className="inline-flex h-[36px] items-center gap-1.5 rounded-full bg-[#ffffff] px-4 text-[13px] font-semibold text-[#0a0a0a] transition-transform active:scale-95"
              >
                <TrophyIcon className="h-4 w-4" />
                <span>+ Award Goal</span>
              </button>
            </div>
          </div>

          {/* Quota Badges & Team Pill Actions */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#ffffff]/20 pt-3.5">
            <div className="flex items-center gap-1.5 text-[12px]">
              <span
                title="[US-14.2] Max active players reduced by 1 after every 2 yellow cards on the team"
                className="rounded-full bg-[#ffffff]/15 px-3 py-1 font-medium text-[#ffffff]"
              >
                Max Active: <strong>{maxPlayers}</strong>
              </span>
              <span className="rounded-full bg-[#ffffff]/15 px-3 py-1 font-medium text-[#ffffff]">
                YC: <strong>{team.teamYellowCards}</strong>
              </span>
              <span className="rounded-full bg-[#ffffff]/15 px-3 py-1 font-medium text-[#ffffff]">
                RC: <strong>{team.teamRedCards}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={team.timeoutsRemaining <= 0 || matchState.stage.stage === "timeout"}
                onClick={() => onApplyAction({ type: "startTimeout", args: { calledBy: side } })}
                className="inline-flex h-[32px] items-center gap-1 rounded-full border border-[#ffffff]/35 bg-[#ffffff]/10 px-3 text-[12px] font-medium text-[#ffffff] hover:bg-[#ffffff]/20 disabled:opacity-40"
              >
                <ClockIcon className="h-3.5 w-3.5" />
                <span>Timeout ({team.timeoutsRemaining}/2)</span>
              </button>

              <button
                type="button"
                disabled={team.substitutionsRemaining <= 0 || subSlots.length === 0}
                onClick={() => {
                  setSelectedOutgoingSlot(activeFieldSlots[0]?.slotIndex ?? 0);
                  setSelectedIncomingSlot(subSlots[0]?.slotIndex ?? 5);
                  setSubModalSide(side);
                }}
                className="inline-flex h-[32px] items-center gap-1 rounded-full border border-[#ffffff]/35 bg-[#ffffff]/10 px-3 text-[12px] font-medium text-[#ffffff] hover:bg-[#ffffff]/20 disabled:opacity-40"
              >
                <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
                <span>Sub ({team.substitutionsRemaining}/2)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "signalReady",
                    args: { restart: { type: "penaltyKick", side } },
                  })
                }
                className="inline-flex h-[32px] items-center gap-1 rounded-full bg-[#0a0a0a] px-3 text-[12px] font-semibold text-[#ffffff] hover:bg-[#222222]"
              >
                <BoltIcon className="h-3.5 w-3.5" />
                <span>Penalty Kick [US-17]</span>
              </button>
            </div>
          </div>
        </div>

        {/* Ollama Flat Hairline Robot Cards (`#ffffff` canvas, `1px solid #e5e5e5`, `rounded-[12px]`) */}
        <div className="space-y-2.5">
          {visibleSlots.map((slot) => {
            const wireId = baseId + slot.slotIndex;
            const bitAllowed = (bitmask & (1 << slot.slotIndex)) !== 0;
            const pts = computeIndividualPoints(slot.score);
            const telem = telemetryByRobotId.get(wireId);
            const isOnline = telem && telem.ageMs < 3000;
            const penaltyReasonObj = REMOVAL_PENALTY_REASONS.find(
              (r) => r.id === slot.removalPenalty,
            );
            const isUrgentReturn =
              slot.removalPenalty &&
              slot.penaltyRemainingSecs <= 10 &&
              slot.penaltyRemainingSecs > 0;

            return (
              <div
                key={slot.slotIndex}
                className={`rounded-[12px] border p-3.5 transition-all ${
                  slot.redCard
                    ? "border-[#e5e5e5] bg-[#fafafa] opacity-60"
                    : slot.removalPenalty
                      ? isUrgentReturn
                        ? "animate-pulse-urgent border-[#ff5530] bg-[#fff5f2]"
                        : "border-[#ff5530]/60 bg-[#fffaf8]"
                      : slot.role === "substitute"
                        ? "border-[#e5e5e5] bg-[#fafafa]"
                        : "border-[#e5e5e5] bg-[#ffffff]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Robot Wire ID Pill + Name & Origin University */}
                  <div className="flex items-center gap-3">
                    <div
                      title={
                        bitAllowed
                          ? `Bit ${slot.slotIndex} = 1 (Allowed to Play)`
                          : `Bit ${slot.slotIndex} = 0 (Must Remain Motionless [US-21.22])`
                      }
                      className={`flex h-10 w-12 flex-col items-center justify-center rounded-full border font-mono text-[12px] font-bold ${
                        bitAllowed
                          ? "border-[#0a0a0a] bg-[#0a0a0a] text-[#ffffff]"
                          : "border-[#e5e5e5] bg-[#f2f3f5] text-[#8e8e93]"
                      }`}
                    >
                      <span>#{wireId}</span>
                      <span className="text-[9px] font-normal opacity-80">
                        {bitAllowed ? "BIT 1" : "BIT 0"}
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-[#000000]">
                          {slot.robotName}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            slot.role === "goalkeeper"
                              ? "bg-[#a855f7]/15 text-[#7e22ce]"
                              : slot.role === "fieldPlayer"
                                ? "bg-[#f2f3f5] text-[#222222]"
                                : "border border-[#e5e5e5] bg-[#ffffff] text-[#737373]"
                          }`}
                        >
                          {slot.role === "goalkeeper"
                            ? "GK"
                            : slot.role === "fieldPlayer"
                              ? "Field"
                              : "Sub"}
                        </span>

                        {slot.yellowCards > 0 && (
                          <span className="rounded-full bg-[#ffbd2e] px-2 py-0.5 text-[11px] font-bold text-[#000000]">
                            YC ×{slot.yellowCards}
                          </span>
                        )}
                        {slot.redCard && (
                          <span className="rounded-full bg-[#ff5530] px-2.5 py-0.5 text-[11px] font-bold text-[#ffffff]">
                            SENT OFF
                          </span>
                        )}
                        {isOnline && (
                          <span
                            title={`UDP [US-5.2] Active: ${telem.messagesPerSec} msg/s, ${telem.bytesPerSec} B/s`}
                            className="inline-flex items-center gap-1 rounded-full bg-[#e8ffea] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#1ba673]"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-[#1ba673]" />
                            UDP
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] text-[#737373]">{slot.originClub}</div>
                    </div>
                  </div>

                  {/* Individual Score Pill [US-19.1] */}
                  <div className="text-right">
                    <div
                      className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[13px] font-bold ${
                        pts.rawTotal >= 1
                          ? "bg-[#e8ffea] text-[#1ba673]"
                          : pts.rawTotal < 0
                            ? "bg-[#ff5530]/15 text-[#ff5530]"
                            : "bg-[#f2f3f5] text-[#525252]"
                      }`}
                    >
                      {pts.rawTotal > 0 ? `+${pts.rawTotal}` : pts.rawTotal} pts
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[#a3a3a3]">
                      Official: {pts.officialPoints}
                    </div>
                  </div>
                </div>

                {/* Active 30s Removal Penalty Strip [US-16] */}
                {slot.removalPenalty && (
                  <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[10px] border border-[#ff5530]/40 bg-[#ffffff] px-3 py-2">
                    <div>
                      <div className="text-[12px] font-semibold text-[#0a0a0a]">
                        30s Removal: {penaltyReasonObj?.shortLabel || slot.removalPenalty}
                      </div>
                      <div className="text-[11px] text-[#737373]">
                        {slot.penaltyRemainingSecs === 0
                          ? "Penalty expired! Re-enter at touch line near center line [US-16.3]"
                          : slot.penaltyTimerRunning
                            ? "Counting down..."
                            : "Paused — click Start when handler removes robot [US-16.2]"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-[#0a0a0a] px-3 py-1 font-mono text-[13px] font-bold text-[#ffffff]">
                        {slot.penaltyRemainingSecs}s
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onApplyAction({
                            type: "togglePenaltyTimer",
                            args: { side, slotIndex: slot.slotIndex },
                          })
                        }
                        className="rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3 py-1 text-[12px] font-medium text-[#000000] hover:bg-[#fafafa]"
                      >
                        {slot.penaltyTimerRunning ? "Pause" : "Start"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onApplyAction({
                            type: "returnPenalizedRobot",
                            args: { side, slotIndex: slot.slotIndex },
                          })
                        }
                        className="rounded-full bg-[#1ba673] px-3 py-1 text-[12px] font-semibold text-[#ffffff]"
                      >
                        Return [US-16.3]
                      </button>
                    </div>
                  </div>
                )}

                {/* Ollama Pill Geometry Action Row (`rounded-full` buttons everywhere) */}
                {!slot.redCard && slot.role !== "substitute" && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-[#eaecf0] pt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onApplyAction({
                            type: "awardGoal",
                            args: { scoringSide: side, scorerSlot: slot.slotIndex },
                          })
                        }
                        title="[US-19.1] Scoring a goal = +10 pts to scorer, +2 to teammates, -2 to opponents"
                        className="rounded-full bg-[#000000] px-3 py-1 text-[12px] font-medium text-[#ffffff] active:bg-[#222222]"
                      >
                        +Goal (+10)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onApplyAction({
                            type: "recordIndividualAction",
                            args: { side, slotIndex: slot.slotIndex, kind: "save" },
                          })
                        }
                        title="[US-19.1] Making a save to prevent a goal = +7 pts"
                        className="rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3 py-1 text-[12px] font-medium text-[#000000] hover:bg-[#fafafa]"
                      >
                        +Save (+7) {slot.score.savesMade > 0 ? `· ${slot.score.savesMade}` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onApplyAction({
                            type: "recordIndividualAction",
                            args: { side, slotIndex: slot.slotIndex, kind: "passingPoleKick" },
                          })
                        }
                        title="[US-19.1] Kicking the ball at a passing pole = +2 pts"
                        className="rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3 py-1 text-[12px] font-medium text-[#000000] hover:bg-[#fafafa]"
                      >
                        +Pole (+2){" "}
                        {slot.score.passingPoleKicks > 0 ? `· ${slot.score.passingPoleKicks}` : ""}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setPenaltyModalTarget({
                            side,
                            slotIndex: slot.slotIndex,
                            wireId,
                            robotName: slot.robotName,
                          })
                        }
                        className="rounded-full bg-[#fafafa] px-3 py-1 text-[12px] font-medium text-[#525252] ring-1 ring-[#e5e5e5] hover:text-[#000000]"
                      >
                        30s Foul (-1)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCardModalTarget({
                            side,
                            slotIndex: slot.slotIndex,
                            wireId,
                            robotName: slot.robotName,
                          })
                        }
                        className="rounded-full bg-[#fafafa] px-3 py-1 text-[12px] font-medium text-[#525252] ring-1 ring-[#e5e5e5] hover:text-[#ff5530]"
                      >
                        Card
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1600px] p-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Team Column (IDs 0..10) */}
        <div className="lg:col-span-4">{renderTeamPanel("left")}</div>

        {/* Center Referee Control Column */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          {/* Ollama's Single Inverted Dark Card (`pricing-card-dark`: #171717) + MiniMax 72px Display Clock */}
          <div className="rounded-[28px] bg-[#171717] p-6 text-[#ffffff]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] font-medium tracking-wider text-[rgba(255,255,255,0.7)] uppercase">
                Master Match Clock [US-8.3]
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onApplyAction({ type: "adjustPrimaryClock", args: { deltaSeconds: 60 } })
                  }
                  className="inline-flex h-[28px] items-center gap-1 rounded-full bg-[#262626] px-3 text-[12px] font-medium text-[#ffffff] hover:bg-[#333333]"
                >
                  <PlusCircleIcon className="h-3.5 w-3.5" />
                  <span>+1:00</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onApplyAction({ type: "adjustPrimaryClock", args: { deltaSeconds: -10 } })
                  }
                  className="inline-flex h-[28px] items-center rounded-full bg-[#262626] px-3 text-[12px] font-medium text-[rgba(255,255,255,0.75)] hover:bg-[#333333]"
                >
                  -10s
                </button>
                {/* Ollama `button-pill-on-dark` */}
                <button
                  type="button"
                  onClick={() => onApplyAction({ type: "advancePeriod" })}
                  className="inline-flex h-[28px] items-center rounded-full bg-[#ffffff] px-3.5 text-[12px] font-semibold text-[#000000]"
                >
                  Next Period [US-8.5] →
                </button>
              </div>
            </div>

            {/* Oversized MiniMax Hero Display Clock (-2px letter spacing) */}
            <div className="my-4 flex items-end justify-between border-y border-[#2e2e2e] py-4">
              <div>
                <div className="font-mono text-[68px] font-semibold leading-none tracking-[-2px] text-[#ffffff]">
                  {formatClock(matchState.primarySeconds)}
                </div>
                <div className="mt-2 text-[13px] text-[rgba(255,255,255,0.7)]">
                  Active Stage:{" "}
                  <strong className="text-[#ffffff] uppercase">{matchState.stage.stage}</strong>
                  {matchState.stage.restart && ` · ${restartLabel(matchState.stage.restart)}`}
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-[11px] text-[rgba(255,255,255,0.6)] uppercase">
                  Phase Countdown
                </div>
                <div
                  className={`font-mono text-[32px] font-semibold leading-tight ${
                    matchState.secondarySeconds > 0
                      ? "text-[#ffbd2e]"
                      : "text-[rgba(255,255,255,0.3)]"
                  }`}
                >
                  {formatClock(matchState.secondarySeconds)}
                </div>
              </div>
            </div>

            {/* Live [US-21.23] Wire State Pill */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-[rgba(255,255,255,0.7)]">
                Referee Object (Type=97) State:
              </span>
              <span
                className={`rounded-full px-3.5 py-1 font-mono text-[12px] font-semibold ${
                  wireState === 0
                    ? "bg-[#ff5530] text-[#ffffff]"
                    : wireState === 1 || wireState === 2
                      ? "bg-[#ffbd2e] text-[#000000]"
                      : "bg-[#27c93f] text-[#000000]"
                }`}
              >
                {wireStateLabel}
              </span>
            </div>
          </div>

          {/* Paper-White Referee Command Deck Card (`#ffffff`, `1px solid #e5e5e5`, `rounded-[16px]`) */}
          <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display-rounded text-[16px] font-semibold text-[#000000]">
                Referee Command Sequence [US-9, US-10]
              </h3>
              <span className="rounded-full bg-[#fafafa] px-2.5 py-0.5 font-mono text-[11px] text-[#737373] ring-1 ring-[#e5e5e5]">
                Spacebar = Stop
              </span>
            </div>

            {/* 4 Primary Pill Buttons (`rounded-full`) */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "signalReady",
                    args: {
                      restart: { type: "kickOff", side: matchState.nextKickoffSide },
                    },
                  })
                }
                className={`flex flex-col items-center justify-center rounded-full border px-4 py-2.5 transition-colors ${
                  matchState.stage.stage === "ready"
                    ? "border-[#000000] bg-[#000000] text-[#ffffff]"
                    : "border-[#0a0a0a] bg-[#ffffff] text-[#0a0a0a] hover:bg-[#fafafa]"
                }`}
              >
                <span className="text-[13px] font-semibold">1. Signal READY (10s)</span>
                <span
                  className={`text-[11px] ${
                    matchState.stage.stage === "ready" ? "text-[#ffffff]/75" : "text-[#737373]"
                  }`}
                >
                  Move to own half [US-9.3]
                </span>
              </button>

              <button
                type="button"
                onClick={() => onApplyAction({ type: "signalSet", args: {} })}
                className={`flex flex-col items-center justify-center rounded-full border px-4 py-2.5 transition-colors ${
                  matchState.stage.stage === "set"
                    ? "border-[#000000] bg-[#000000] text-[#ffffff]"
                    : "border-[#0a0a0a] bg-[#ffffff] text-[#0a0a0a] hover:bg-[#fafafa]"
                }`}
              >
                <span className="text-[13px] font-semibold">2. Signal SET (State 1/2)</span>
                <span
                  className={`text-[11px] ${
                    matchState.stage.stage === "set" ? "text-[#ffffff]/75" : "text-[#737373]"
                  }`}
                >
                  Place ball · Stationary
                </span>
              </button>

              <button
                type="button"
                onClick={() => onApplyAction({ type: "signalPlay" })}
                className={`flex flex-col items-center justify-center rounded-full border px-4 py-2.5 transition-colors ${
                  matchState.stage.stage === "playKickOff" ||
                  matchState.stage.stage === "playBallInPlay"
                    ? "border-[#1ba673] bg-[#1ba673] text-[#ffffff]"
                    : "border-[#000000] bg-[#000000] text-[#ffffff] active:bg-[#222222]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <PlayCircleIcon className="h-4 w-4" />
                  <span className="text-[13px] font-semibold">3. Whistle PLAY (UDP)</span>
                </div>
                <span className="text-[11px] text-[#ffffff]/80">
                  State 3/4 (10s) → State 5
                </span>
              </button>

              <button
                type="button"
                onClick={() => onApplyAction({ type: "stopPlay" })}
                className={`flex flex-col items-center justify-center rounded-full border px-4 py-2.5 transition-colors ${
                  matchState.stage.stage === "stopped"
                    ? "border-[#ff5530] bg-[#ff5530] text-[#ffffff]"
                    : "border-[#d4d4d4] bg-[#fafafa] text-[#0a0a0a] hover:border-[#ff5530] hover:text-[#ff5530]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <PauseCircleIcon className="h-4 w-4" />
                  <span className="text-[13px] font-semibold">STOP PLAY (State 0)</span>
                </div>
                <span
                  className={`text-[11px] ${
                    matchState.stage.stage === "stopped" ? "text-[#ffffff]/85" : "text-[#737373]"
                  }`}
                >
                  Emergency Stop [Space]
                </span>
              </button>
            </div>

            {/* Contextual Kick-Off Ball Touched Pill [US-9.6] */}
            {matchState.stage.stage === "playKickOff" && (
              <button
                type="button"
                onClick={() => onApplyAction({ type: "confirmKickOffTouch" })}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#000000] py-2.5 text-[13px] font-semibold text-[#ffffff]"
              >
                <SparklesIcon className="h-4 w-4 text-[#27c93f]" />
                <span>Ball Touched by Kicker → Switch Immediately to State 5 [US-9.6]</span>
              </button>
            )}

            {/* Secondary Set-Play Pills: Kick-Off Left/Right, Dropped Ball [US-10], Referee Timeout */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-[#e5e5e5] pt-3.5">
              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "signalReady",
                    args: { restart: { type: "kickOff", side: "left" } },
                  })
                }
                className="h-[36px] rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 text-[13px] font-medium text-[#000000] hover:border-[#1456f0] hover:text-[#1456f0]"
              >
                Kick-Off Left [US-9]
              </button>
              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "signalReady",
                    args: { restart: { type: "kickOff", side: "right" } },
                  })
                }
                className="h-[36px] rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 text-[13px] font-medium text-[#000000] hover:border-[#ff5530] hover:text-[#ff5530]"
              >
                Kick-Off Right [US-9]
              </button>
              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "signalReady",
                    args: { restart: { type: "droppedBall" } },
                  })
                }
                className="h-[36px] rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 text-[13px] font-medium text-[#000000] hover:border-[#000000]"
              >
                Dropped Ball [US-10]
              </button>
              <button
                type="button"
                onClick={() =>
                  onApplyAction({
                    type: "startTimeout",
                    args: { calledBy: null },
                  })
                }
                className="h-[36px] rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 text-[13px] font-medium text-[#000000] hover:border-[#000000]"
              >
                Referee Timeout
              </button>
            </div>

            {/* Ollama `install-snippet` Pill for Throw-In Continuous Play Rule [US-18.3] */}
            <div className="mt-3.5 rounded-full bg-[#fafafa] px-4 py-2 text-center text-[12px] text-[#525252] ring-1 ring-[#e5e5e5]">
              <strong className="text-[#000000]">[US-18.3] Continuous Throw-In:</strong> Game is{" "}
              <span className="underline">not stopped</span> for out-of-bounds; place ball 50cm
              inside touch line.
            </div>
          </div>

          {/* Ollama Signature `terminal-card`: 1px #e5e5e5 border, 12px radius, macOS Traffic Light Dots */}
          <div className="flex flex-1 flex-col rounded-[12px] border border-[#e5e5e5] bg-[#ffffff] p-4">
            <div className="mb-3 flex items-center justify-between border-b border-[#e5e5e5] pb-2.5">
              {/* macOS Traffic Lights (#ff5f56, #ffbd2e, #27c93f at 12px rounded-full) */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
                  <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
                </div>
                <span className="ml-1 font-mono text-[12px] font-medium text-[#737373]">
                  match-events.log [GN-3.14]
                </span>
              </div>

              {undoLabels.length > 0 && (
                <button
                  type="button"
                  onClick={() => onApplyAction({ type: "undo", args: { steps: 1 } })}
                  className="inline-flex h-[28px] items-center gap-1 rounded-full bg-[#000000] px-3 text-[12px] font-medium text-[#ffffff]"
                >
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                  <span>Undo: {undoLabels[0]}</span>
                </button>
              )}
            </div>

            <div className="max-h-56 flex-1 space-y-2 overflow-y-auto pr-1 font-mono text-[12px]">
              {matchState.matchLog.slice(0, 15).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-2 border-b border-[#f2f3f5] pb-1.5 last:border-none"
                >
                  <div className="leading-[1.45]">
                    <span className="text-[#a3a3a3]">
                      [{formatClock(entry.remainingSeconds)}]
                    </span>{" "}
                    <span className="text-[#000000]">{entry.summary}</span>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#fafafa] px-2 py-0.5 text-[10px] text-[#737373] ring-1 ring-[#e5e5e5]">
                    {entry.ruleRef}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Team Column (IDs 16..26) */}
        <div className="lg:col-span-4">{renderTeamPanel("right")}</div>
      </div>

      {/* Modal 1: Award Goal & Credit Scorer [US-19.1] */}
      {goalModalSide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[20px] border border-[#e5e5e5] bg-[#ffffff] p-6 shadow-xl">
            <h3 className="font-display-rounded text-[20px] font-semibold text-[#000000]">
              Award Goal —{" "}
              {goalModalSide === "left" ? matchState.leftTeam.name : matchState.rightTeam.name}
            </h3>
            <p className="mt-1 text-[14px] text-[#737373]">
              Select the scoring robot to award <strong className="text-[#000000]">+10 pts</strong>{" "}
              (active teammates receive <strong className="text-[#000000]">+2 pts</strong>,
              opponents receive <strong className="text-[#000000]">-2 pts</strong> per [US-19.1]).
            </p>
            <div className="mt-4 space-y-2">
              {(goalModalSide === "left"
                ? matchState.leftTeam.slots
                : matchState.rightTeam.slots
              )
                .filter((s) => s.role === "goalkeeper" || s.role === "fieldPlayer")
                .map((slot) => {
                  const wireId = (goalModalSide === "left" ? 0 : 16) + slot.slotIndex;
                  return (
                    <button
                      key={slot.slotIndex}
                      type="button"
                      onClick={() => {
                        onApplyAction({
                          type: "awardGoal",
                          args: { scoringSide: goalModalSide, scorerSlot: slot.slotIndex },
                        });
                        setGoalModalSide(null);
                      }}
                      className="flex w-full items-center justify-between rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 text-left text-[13px] transition hover:border-[#000000] hover:bg-[#ffffff]"
                    >
                      <div>
                        <span className="font-mono font-bold text-[#000000]">ID #{wireId}</span>{" "}
                        <span className="font-semibold text-[#000000]">{slot.robotName}</span>{" "}
                        <span className="text-[#737373]">({slot.originClub})</span>
                      </div>
                      <span className="rounded-full bg-[#e8ffea] px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#1ba673]">
                        +10 pts
                      </span>
                    </button>
                  );
                })}

              <button
                type="button"
                onClick={() => {
                  onApplyAction({
                    type: "awardGoal",
                    args: { scoringSide: goalModalSide, scorerSlot: null },
                  });
                  setGoalModalSide(null);
                }}
                className="mt-2 flex w-full items-center justify-between rounded-full border border-[#d4d4d4] bg-[#ffffff] px-4 py-2 text-[13px] font-medium text-[#525252] hover:border-[#000000] hover:text-[#000000]"
              >
                <span>Unknown Scorer / Own Goal (Teammates +2, Opponents -2)</span>
                <span>Select →</span>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setGoalModalSide(null)}
                className="h-[36px] rounded-full border border-[#d4d4d4] bg-[#ffffff] px-5 text-[13px] font-medium text-[#000000]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Apply 30s Removal Penalty [US-15, US-16] */}
      {penaltyModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-[20px] border border-[#e5e5e5] bg-[#ffffff] p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-[#ff5530]" />
              <h3 className="font-display-rounded text-[20px] font-semibold text-[#000000]">
                30s Removal Penalty — ID #{penaltyModalTarget.wireId} (
                {penaltyModalTarget.robotName})
              </h3>
            </div>
            <p className="mt-1 text-[14px] text-[#737373]">
              Clears ID #{penaltyModalTarget.wireId}&apos;s bit in the [US-21.22] bitmask, starts a
              fixed 30s timer [US-16.1], and deducts <strong className="text-[#000000]">-1 pt</strong>{" "}
              [US-19.1].
            </p>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {REMOVAL_PENALTY_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onApplyAction({
                      type: "applyRemovalPenalty",
                      args: {
                        side: penaltyModalTarget.side,
                        slotIndex: penaltyModalTarget.slotIndex,
                        reason: r.id,
                        startTimerImmediately: true,
                      },
                    });
                    setPenaltyModalTarget(null);
                  }}
                  className="flex w-full items-center justify-between rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 text-left text-[13px] hover:border-[#000000] hover:bg-[#ffffff]"
                >
                  <span className="font-medium text-[#000000]">{r.label}</span>
                  <span className="shrink-0 rounded-full bg-[#000000] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#ffffff]">
                    30s · -1 pt
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setPenaltyModalTarget(null)}
                className="h-[36px] rounded-full border border-[#d4d4d4] bg-[#ffffff] px-5 text-[13px] font-medium text-[#000000]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Issue Yellow Card or Red Card [US-14] */}
      {cardModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-[20px] border border-[#e5e5e5] bg-[#ffffff] p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <HandRaisedIcon className="h-5 w-5 text-[#ff5530]" />
              <h3 className="font-display-rounded text-[20px] font-semibold text-[#000000]">
                Caution / Send-Off Card [US-14] — ID #{cardModalTarget.wireId}
              </h3>
            </div>
            <p className="mt-1 text-[14px] text-[#737373]">
              Per [US-14.2]: The number of players on the team is reduced by one after every two
              Yellow Cards.
            </p>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {CARD_OFFENCES.map((off) => (
                <div
                  key={off.id}
                  className="flex items-center justify-between gap-2 rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2 text-[13px]"
                >
                  <span className="font-medium text-[#000000]">{off.label}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onApplyAction({
                          type: "issueCard",
                          args: {
                            side: cardModalTarget.side,
                            slotIndex: cardModalTarget.slotIndex,
                            isRed: false,
                            offence: off.id,
                          },
                        });
                        setCardModalTarget(null);
                      }}
                      className="rounded-full bg-[#ffbd2e] px-3 py-1 text-[12px] font-semibold text-[#000000]"
                    >
                      Yellow Card
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onApplyAction({
                          type: "issueCard",
                          args: {
                            side: cardModalTarget.side,
                            slotIndex: cardModalTarget.slotIndex,
                            isRed: true,
                            offence: off.id,
                          },
                        });
                        setCardModalTarget(null);
                      }}
                      className="rounded-full bg-[#ff5530] px-3 py-1 text-[12px] font-semibold text-[#ffffff]"
                    >
                      Red Card
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCardModalTarget(null)}
                className="h-[36px] rounded-full border border-[#d4d4d4] bg-[#ffffff] px-5 text-[13px] font-medium text-[#000000]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Substitute Player [US-4.3] */}
      {subModalSide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[20px] border border-[#e5e5e5] bg-[#ffffff] p-6 shadow-xl">
            <h3 className="font-display-rounded text-[20px] font-semibold text-[#000000]">
              Player Substitution [US-4.3]
            </h3>
            <p className="mt-1 text-[14px] text-[#737373]">
              Maximum of 2 substitutes per match. Outgoing robot must leave the field before the
              substitute enters.
            </p>
            <div className="mt-4 space-y-3 text-[13px]">
              <div>
                <label className="block font-medium text-[#000000]">Outgoing Active Player</label>
                <select
                  value={selectedOutgoingSlot}
                  onChange={(e) => setSelectedOutgoingSlot(Number(e.target.value))}
                  className="mt-1 h-[40px] w-full rounded-full border border-[#e5e5e5] bg-[#ffffff] px-4 text-[#000000]"
                >
                  {(subModalSide === "left"
                    ? matchState.leftTeam.slots
                    : matchState.rightTeam.slots
                  )
                    .filter((s) => s.role === "goalkeeper" || s.role === "fieldPlayer")
                    .map((s) => (
                      <option key={s.slotIndex} value={s.slotIndex}>
                        ID #{(subModalSide === "left" ? 0 : 16) + s.slotIndex} — {s.robotName} (
                        {s.originClub})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-[#000000]">Incoming Substitute</label>
                <select
                  value={selectedIncomingSlot}
                  onChange={(e) => setSelectedIncomingSlot(Number(e.target.value))}
                  className="mt-1 h-[40px] w-full rounded-full border border-[#e5e5e5] bg-[#ffffff] px-4 text-[#000000]"
                >
                  {(subModalSide === "left"
                    ? matchState.leftTeam.slots
                    : matchState.rightTeam.slots
                  )
                    .filter((s) => s.role === "substitute")
                    .map((s) => (
                      <option key={s.slotIndex} value={s.slotIndex}>
                        ID #{(subModalSide === "left" ? 0 : 16) + s.slotIndex} — {s.robotName} (
                        {s.originClub})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubModalSide(null)}
                className="h-[36px] rounded-full border border-[#d4d4d4] bg-[#ffffff] px-5 text-[13px] font-medium text-[#000000]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onApplyAction({
                    type: "substitutePlayer",
                    args: {
                      side: subModalSide,
                      outgoingSlot: selectedOutgoingSlot,
                      incomingSlot: selectedIncomingSlot,
                    },
                  });
                  setSubModalSide(null);
                }}
                className="inline-flex h-[36px] items-center gap-1.5 rounded-full bg-[#000000] px-5 text-[13px] font-semibold text-[#ffffff]"
              >
                <ShieldCheckIcon className="h-4 w-4" />
                <span>Confirm Substitution</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
