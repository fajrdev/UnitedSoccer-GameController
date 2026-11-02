import {
  ArrowDownTrayIcon,
  CheckBadgeIcon,
  MinusIcon,
  PlusIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";

export default function LeaderboardView({ snapshot, onApplyAction }) {
  const { leaderboard, matchState } = snapshot;

  const handleExportJson = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      competition: "FIRA HuroCup United Soccer",
      category: matchState.category,
      phase: matchState.phase,
      teams: {
        left: {
          name: matchState.leftTeam.name,
          goals: matchState.leftTeam.goals,
          shootoutGoals: matchState.leftTeam.shootoutGoals,
          shootoutAttempts: matchState.leftTeam.shootoutAttempts,
        },
        right: {
          name: matchState.rightTeam.name,
          goals: matchState.rightTeam.goals,
          shootoutGoals: matchState.rightTeam.shootoutGoals,
          shootoutAttempts: matchState.rightTeam.shootoutAttempts,
        },
      },
      individualLeaderboard: leaderboard,
      matchLog: matchState.matchLog,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fira-united-soccer-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const headers = [
      "Rank",
      "WireRobotID",
      "Side",
      "UnitedTeam",
      "OriginClub",
      "RobotName",
      "Role",
      "GoalsScored(+10)",
      "TeammateGoals(+2)",
      "OpponentGoals(-2)",
      "SavesMade(+7)",
      "PassingPoleKicks(+2)",
      "RemovalPenalties(-1)",
      "PositivePoints(US-20.2)",
      "RawTotal",
      "OfficialPoints(US-19.2)",
    ];
    const rows = leaderboard.map((e) => [
      e.rank ?? "UNRANKED (<1pt)",
      e.wireRobotId,
      e.side.toUpperCase(),
      `"${e.teamName}"`,
      `"${e.originClub}"`,
      `"${e.robotName}"`,
      e.role,
      e.score.goalsScored,
      e.score.teammateGoals,
      e.score.opponentGoals,
      e.score.savesMade,
      e.score.passingPoleKicks,
      e.score.removalPenalties,
      e.positivePoints,
      e.rawTotal,
      e.officialPoints,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fira-united-soccer-leaderboard-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 bg-[#ffffff] p-5">
      {/* Editorial Section Header + Pill CTAs (Ollama + MiniMax) */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#0a0a0a] text-[#ffffff]">
              <TrophyIcon className="h-4 w-4" />
            </span>
            <h2 className="text-[22px] font-bold tracking-[-0.5px] text-[#0a0a0a]">
              Individual Robot Scoring & Tiebreaker Matrix [US-19 & US-20]
            </h2>
          </div>
          <p className="mt-1.5 text-[14px] text-[#5f5f5f]">
            Unlike RoboCup, every robot on a United Team receives an individual score based on
            on-field actions. Robots with{" "}
            <strong className="font-semibold text-[#0a0a0a]">
              &lt; 1 net point receive no rank and 0 official points
            </strong>{" "}
            [US-19.2].
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-full border border-[#0a0a0a] bg-[#ffffff] px-4 py-2 text-[13px] font-medium text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center gap-1.5 rounded-full bg-[#000000] px-5 py-2 text-[13px] font-medium text-[#ffffff] transition hover:bg-[#262626]"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>Export Official Report [GN-3.14]</span>
          </button>
        </div>
      </div>

      {/* MiniMax Vibrant Product Matrix Cards for [US-19.1] Point Allocation Formula */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            label: "Goal Scored",
            rule: "US-19.1",
            pts: "+10 pts",
            bg: "bg-[#1456f0] text-[#ffffff]",
            sub: "text-white/80",
          },
          {
            label: "Save Preventing Goal",
            rule: "US-19.1",
            pts: "+7 pts",
            bg: "bg-[#a855f7] text-[#ffffff]",
            sub: "text-white/80",
          },
          {
            label: "Passing Pole Kick",
            rule: "US-1.21",
            pts: "+2 pts",
            bg: "bg-[#ea5ec1] text-[#ffffff]",
            sub: "text-white/85",
          },
          {
            label: "Goal by Teammate",
            rule: "US-19.1",
            pts: "+2 pts",
            bg: "bg-[#e8ffea] text-[#1ba673] border border-[#1ba673]/25",
            sub: "text-[#1ba673]/80",
          },
          {
            label: "Goal by Opponent",
            rule: "US-19.1",
            pts: "-2 pts",
            bg: "bg-[#ff5530] text-[#ffffff]",
            sub: "text-white/80",
          },
          {
            label: "30s Removal Penalty",
            rule: "US-16.1",
            pts: "-1 pt",
            bg: "bg-[#171717] text-[#ffffff]",
            sub: "text-[#a3a3a3]",
          },
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-[20px] p-4 ${item.bg}`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium ${item.sub}`}>{item.label}</span>
              <span className={`font-mono text-[10px] font-semibold ${item.sub}`}>
                [{item.rule}]
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[24px] font-bold tracking-[-0.5px]">
              {item.pts}
            </div>
          </div>
        ))}
      </div>

      {/* MiniMax Data Table Chrome for Individual Robot Rankings */}
      <div className="overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-[#ffffff]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#e5e7eb] bg-[#f7f8fa] text-[12px] font-bold text-[#5f5f5f]">
              <tr>
                <th className="px-4 py-3.5">Rank [US-19.3]</th>
                <th className="px-3 py-3.5">Wire ID</th>
                <th className="px-4 py-3.5">Robot & Origin University/Club</th>
                <th className="px-3 py-3.5">United Team</th>
                <th className="px-3 py-3.5 text-center">Goals (+10)</th>
                <th className="px-3 py-3.5 text-center">Saves (+7)</th>
                <th className="px-3 py-3.5 text-center">Poles (+2)</th>
                <th className="px-3 py-3.5 text-center">Team Goal (+2)</th>
                <th className="px-3 py-3.5 text-center">Opp Goal (-2)</th>
                <th className="px-3 py-3.5 text-center">Penalties (-1)</th>
                <th
                  className="px-3 py-3.5 text-center"
                  title="[US-20.2] Tiebreaker 2: Points excluding negative points"
                >
                  Positive Only [US-20.2]
                </th>
                <th className="px-3 py-3.5 text-center">Raw Net</th>
                <th className="px-4 py-3.5 text-right">Official Points [US-19.2]</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eaecf0]">
              {leaderboard.map((entry) => {
                const isLeft = entry.side === "left";
                return (
                  <tr
                    key={`${entry.side}-${entry.slotIndex}`}
                    className="transition hover:bg-[#fafafa]"
                  >
                    <td className="px-4 py-3">
                      {entry.rank !== null ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex h-6 w-8 items-center justify-center rounded-full font-mono text-[12px] font-bold ${
                              entry.rank === 1
                                ? "bg-[#0a0a0a] text-[#ffffff]"
                                : entry.rank === 2
                                  ? "bg-[#1456f0] text-[#ffffff]"
                                  : entry.rank === 3
                                    ? "bg-[#ff5530] text-[#ffffff]"
                                    : "border border-[#d4d4d4] bg-[#fafafa] text-[#0a0a0a]"
                            }`}
                          >
                            #{entry.rank}
                          </span>
                          {entry.requiresShootoutTiebreak && (
                            <span
                              title="[US-20.3] Tied on points, goals/saves, and positive points — decide via 5-round penalty kick shootout"
                              className="rounded-full bg-[#a855f7]/15 px-2 py-0.5 text-[10px] font-bold text-[#a855f7]"
                            >
                              TIE [US-20.3]
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="rounded-full border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-0.5 font-mono text-[11px] text-[#737373]">
                          No Rank (&lt;1pt)
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 font-mono font-semibold">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          isLeft
                            ? "bg-[#bfdbfe] text-[#1d4ed8]"
                            : "bg-[#ff5530]/15 text-[#ff5530]"
                        }`}
                      >
                        ID #{entry.wireRobotId}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-[#0a0a0a]">{entry.robotName}</div>
                      <div className="text-[12px] text-[#737373]">{entry.originClub}</div>
                    </td>

                    <td className="px-3 py-3 font-medium">
                      <span className={isLeft ? "text-[#1456f0]" : "text-[#ff5530]"}>
                        {entry.teamName}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-center font-mono">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-bold text-[#0a0a0a]">{entry.score.goalsScored}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onApplyAction({
                              type: "awardGoal",
                              args: { scoringSide: entry.side, scorerSlot: entry.slotIndex },
                            })
                          }
                          className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-1 text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffffff]"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center font-mono">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-bold text-[#0a0a0a]">{entry.score.savesMade}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onApplyAction({
                              type: "recordIndividualAction",
                              args: {
                                side: entry.side,
                                slotIndex: entry.slotIndex,
                                kind: "save",
                              },
                            })
                          }
                          className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-1 text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffffff]"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center font-mono">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-bold text-[#0a0a0a]">
                          {entry.score.passingPoleKicks}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onApplyAction({
                              type: "recordIndividualAction",
                              args: {
                                side: entry.side,
                                slotIndex: entry.slotIndex,
                                kind: "passingPoleKick",
                              },
                            })
                          }
                          className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-1 text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffffff]"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-semibold text-[#1ba673]">
                      {entry.score.teammateGoals}
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-semibold text-[#ff5530]">
                      {entry.score.opponentGoals}
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-semibold text-[#5f5f5f]">
                      {entry.score.removalPenalties}
                    </td>

                    <td className="px-3 py-3 text-center font-mono font-bold text-[#0a0a0a]">
                      +{entry.positivePoints}
                    </td>

                    <td className="px-3 py-3 text-center font-mono">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onApplyAction({
                              type: "adjustRobotScore",
                              args: {
                                side: entry.side,
                                slotIndex: entry.slotIndex,
                                manualDelta: -1,
                              },
                            })
                          }
                          className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-1 text-[#5f5f5f] transition hover:border-[#0a0a0a] hover:text-[#0a0a0a]"
                        >
                          <MinusIcon className="h-3 w-3" />
                        </button>
                        <span
                          className={
                            entry.rawTotal >= 1
                              ? "font-bold text-[#0a0a0a]"
                              : entry.rawTotal < 0
                                ? "font-bold text-[#ff5530]"
                                : "text-[#737373]"
                          }
                        >
                          {entry.rawTotal > 0 ? `+${entry.rawTotal}` : entry.rawTotal}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onApplyAction({
                              type: "adjustRobotScore",
                              args: {
                                side: entry.side,
                                slotIndex: entry.slotIndex,
                                manualDelta: 1,
                              },
                            })
                          }
                          className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-1 text-[#5f5f5f] transition hover:border-[#0a0a0a] hover:text-[#0a0a0a]"
                        >
                          <PlusIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-[13px] font-bold">
                      <span
                        className={`rounded-full px-3 py-1 ${
                          entry.officialPoints > 0
                            ? "bg-[#e8ffea] text-[#1ba673]"
                            : "bg-[#f5f5f5] text-[#737373]"
                        }`}
                      >
                        {entry.officialPoints} pts
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tiebreaker & Penalty Shootout Tracker [US-12.4, US-20.3] */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
          <h3 className="text-[16px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
            Tiebreaker Resolution Hierarchy [US-19.4, US-20.1 – US-20.3]
          </h3>
          <ol className="mt-3 list-inside list-decimal space-y-2 text-[13px] text-[#5f5f5f]">
            <li>
              <strong className="text-[#0a0a0a]">Minimum Threshold [US-19.2]:</strong> Any robot
              with &lt; 1 net point receives 0 points and no rank.
            </li>
            <li>
              <strong className="text-[#0a0a0a]">Tiebreaker 1 [US-19.4 / US-20.1]:</strong> Greater
              number of <span className="font-semibold text-[#1456f0]">Goals Scored</span> (and{" "}
              <span className="font-semibold text-[#a855f7]">Saves Made</span>).
            </li>
            <li>
              <strong className="text-[#0a0a0a]">Tiebreaker 2 [US-20.2]:</strong> Maximum points{" "}
              <span className="font-semibold text-[#1ba673]">
                after removal of negative points scored
              </span>{" "}
              (Positive Only column).
            </li>
            <li>
              <strong className="text-[#0a0a0a]">Tiebreaker 3 [US-20.3]:</strong> 5-round
              alternating Penalty Kick Shootout (followed by sudden death if still tied).
            </li>
          </ol>
        </div>

        <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
              5-Round Penalty Kick Shootout Tracker [US-12.4, US-20.3]
            </h3>
            <CheckBadgeIcon className="h-5 w-5 text-[#1ba673]" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              { side: "left", team: matchState.leftTeam, badge: "bg-[#bfdbfe] text-[#1d4ed8]" },
              {
                side: "right",
                team: matchState.rightTeam,
                badge: "bg-[#ff5530]/15 text-[#ff5530]",
              },
            ].map(({ side, team, badge }) => (
              <div
                key={side}
                className="rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] p-3.5"
              >
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-bold text-[#0a0a0a]">{team.name}</span>
                  <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${badge}`}>
                    {team.shootoutGoals} / {team.shootoutAttempts} Scored
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onApplyAction({
                        type: "recordShootoutAttempt",
                        args: { side, scored: true },
                      })
                    }
                    className="flex-1 rounded-full bg-[#0a0a0a] py-1.5 text-[12px] font-medium text-[#ffffff] transition hover:bg-[#262626]"
                  >
                    + Scored
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onApplyAction({
                        type: "recordShootoutAttempt",
                        args: { side, scored: false },
                      })
                    }
                    className="flex-1 rounded-full border border-[#d4d4d4] bg-[#ffffff] py-1.5 text-[12px] font-medium text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
                  >
                    + Missed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
