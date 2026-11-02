import { useState } from "react";
import {
  ArrowDownOnSquareIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  SparklesIcon,
  WifiIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { reloadFromYamlConfig, savePermanentYamlConfig } from "../api.js";
import { DEFAULT_CLUB_POOL } from "../protocol/usoccer_engine.js";

export default function LauncherModal({
  snapshot,
  onClose,
  onApplyAction,
  onUpdateNetworkConfig,
}) {
  const { matchState, networkConfig, networkInterfaces = [], yamlPaths } = snapshot;

  const [category, setCategory] = useState(matchState.category);
  const [trainingPlayersPerTeam, setTrainingPlayersPerTeam] = useState(
    matchState.trainingPlayersPerTeam || 1,
  );
  const [leftTeamName, setLeftTeamName] = useState(matchState.leftTeam.name);
  const [rightTeamName, setRightTeamName] = useState(matchState.rightTeam.name);
  const [firstKickoffSide, setFirstKickoffSide] = useState(matchState.firstHalfKickoffSide);

  const [interfaceName, setInterfaceName] = useState(networkConfig.interfaceName || "all");
  const [interfaceAddress, setInterfaceAddress] = useState(
    networkConfig.interfaceAddress || "0.0.0.0",
  );
  const [broadcastIp, setBroadcastIp] = useState(networkConfig.broadcastIp);
  const [port, setPort] = useState(String(networkConfig.port));

  const [coinWinner, setCoinWinner] = useState(null);
  const [yamlStatus, setYamlStatus] = useState(null);

  const availableInterfaces =
    networkInterfaces.length > 0
      ? networkInterfaces
      : [
          {
            name: "all",
            label: "All Interfaces (0.0.0.0 → 255.255.255.255)",
            address: "0.0.0.0",
            broadcastIp: "255.255.255.255",
          },
        ];

  const handleSelectInterface = (selectedValue) => {
    // Format is `${iface.name}|${iface.address}`
    const [selName, selAddr] = selectedValue.split("|");
    const found = availableInterfaces.find(
      (i) => i.name === selName && i.address === selAddr,
    );
    if (found) {
      setInterfaceName(found.name);
      setInterfaceAddress(found.address);
      setBroadcastIp(found.broadcastIp || "255.255.255.255");
    }
  };

  const handleSelectTrainingPreset = async (playersCount) => {
    setCategory("training");
    setTrainingPlayersPerTeam(playersCount);
    await onApplyAction({
      type: "configureMatch",
      args: {
        category: "training",
        trainingPlayersPerTeam: playersCount,
        applyTrainingPreset: true,
        leftTeamName,
        rightTeamName,
        firstKickoffSide,
      },
    });
  };

  const handleTossCoin = () => {
    const side = Math.random() < 0.5 ? "left" : "right";
    setCoinWinner(side);
    setFirstKickoffSide(side);
  };

  const applyCurrentFormToRuntime = async () => {
    const parsedPort = Math.max(1024, Math.min(65535, Number.parseInt(port, 10) || 3838));
    await onUpdateNetworkConfig({
      interfaceName: interfaceName || "all",
      interfaceAddress: interfaceAddress || "0.0.0.0",
      broadcastIp: broadcastIp.trim() || "255.255.255.255",
      port: parsedPort,
    });
    await onApplyAction({
      type: "configureMatch",
      args: {
        category,
        trainingPlayersPerTeam: Number(trainingPlayersPerTeam) || 1,
        applyTrainingPreset: false,
        leftTeamName,
        leftTeamColor: "cyan",
        rightTeamName,
        rightTeamColor: "rose",
        firstKickoffSide,
      },
    });
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    await applyCurrentFormToRuntime();
    onClose();
  };

  const handleSavePermanentYaml = async () => {
    await applyCurrentFormToRuntime();
    const res = await savePermanentYamlConfig();
    if (res.ok) {
      setYamlStatus(
        "Saved permanently to config/settings.yaml & config/teams.yaml! These defaults will load automatically on every startup.",
      );
    } else {
      setYamlStatus(`Error saving YAML: ${res.error || "Unknown error"}`);
    }
  };

  const handleReloadYaml = async () => {
    const updated = await reloadFromYamlConfig();
    setCategory(updated.matchState.category);
    setTrainingPlayersPerTeam(updated.matchState.trainingPlayersPerTeam || 1);
    setLeftTeamName(updated.matchState.leftTeam.name);
    setRightTeamName(updated.matchState.rightTeam.name);
    setFirstKickoffSide(updated.matchState.firstHalfKickoffSide);
    setInterfaceName(updated.networkConfig.interfaceName || "all");
    setInterfaceAddress(updated.networkConfig.interfaceAddress || "0.0.0.0");
    setBroadcastIp(updated.networkConfig.broadcastIp);
    setPort(String(updated.networkConfig.port));
    setYamlStatus("Reloaded latest configuration from config/settings.yaml & config/teams.yaml.");
  };

  const handleRandomizeRoster = async () => {
    await onApplyAction({
      type: "randomizeUnitedTeams",
      args: { pool: DEFAULT_CLUB_POOL },
    });
  };

  const handleUpdateSlot = async (side, slotIndex, field, value) => {
    const team = side === "left" ? matchState.leftTeam : matchState.rightTeam;
    const current = team.slots[slotIndex];
    if (!current) return;
    await onApplyAction({
      type: "updateRobotSlot",
      args: {
        side,
        slotIndex,
        originClub: field === "originClub" ? value : current.originClub,
        robotName: field === "robotName" ? value : current.robotName,
        role: field === "role" ? value : current.role,
      },
    });
  };

  const visibleSlotCount = category === "training" ? 11 : 7;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-[#e5e5e5] bg-[#ffffff]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#ffffff] px-6 py-4">
          <div>
            <h2 className="text-[20px] font-bold tracking-[-0.5px] text-[#0a0a0a]">
              FIRA HuroCup United Soccer — Match, Network Interface & YAML Configuration
            </h2>
            <p className="text-[13px] text-[#5f5f5f]">
              Configure [US-21] Network Interface & UDP Broadcast, [US-4.1] / Freeform Training
              Category (1v1, 2v2, etc.), and Permanent YAML Defaults
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#d4d4d4] bg-[#ffffff] p-2 text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto bg-[#fafafa] p-6">
          {/* Top Grid: Match Category (with Training Mode) + UDP Interface Picker + Coin Toss */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 1. Competition & Training Category */}
            <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
              <h3 className="mb-3 text-[12px] font-bold tracking-wider text-[#0a0a0a] uppercase">
                1. Robot Category [US-2.1, US-4.1]
              </h3>
              <div className="space-y-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 transition ${
                    category === "kidSize"
                      ? "border-[#0a0a0a] bg-[#fafafa]"
                      : "border-[#e5e5e5] bg-[#ffffff] hover:border-[#a3a3a3]"
                  }`}
                >
                  <input
                    type="radio"
                    name="category"
                    checked={category === "kidSize"}
                    onChange={() => setCategory("kidSize")}
                    className="mt-1 accent-[#0a0a0a]"
                  />
                  <div>
                    <div className="text-[13px] font-bold text-[#0a0a0a]">
                      Kid-Sized Category (Max 5v5 + 2 Subs)
                    </div>
                    <div className="text-[11px] text-[#5f5f5f]">
                      Yellow tennis ball [US-2.1] • 1 GK + up to 4 Field Players
                    </div>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 transition ${
                    category === "adultSize"
                      ? "border-[#0a0a0a] bg-[#fafafa]"
                      : "border-[#e5e5e5] bg-[#ffffff] hover:border-[#a3a3a3]"
                  }`}
                >
                  <input
                    type="radio"
                    name="category"
                    checked={category === "adultSize"}
                    onChange={() => setCategory("adultSize")}
                    className="mt-1 accent-[#0a0a0a]"
                  />
                  <div>
                    <div className="text-[13px] font-bold text-[#0a0a0a]">
                      Adult-Sized Category (Max 3v3 + 2 Subs)
                    </div>
                    <div className="text-[11px] text-[#5f5f5f]">
                      Orange youth (Size 3) soccer ball [US-2.1] • 1 GK + up to 2 Field Players
                    </div>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 transition ${
                    category === "training"
                      ? "border-[#1456f0] bg-[#bfdbfe]/20"
                      : "border-[#e5e5e5] bg-[#ffffff] hover:border-[#a3a3a3]"
                  }`}
                >
                  <input
                    type="radio"
                    name="category"
                    checked={category === "training"}
                    onChange={() => handleSelectTrainingPreset(trainingPlayersPerTeam)}
                    className="mt-1 accent-[#1456f0]"
                  />
                  <div className="w-full">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-[#0a0a0a]">
                        Training / Freeform Mode (1v1 .. 11v11)
                      </span>
                      <span className="rounded-full bg-[#e8ffea] px-2 py-0.5 text-[10px] font-bold text-[#1ba673]">
                        UNLOCKED
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#5f5f5f]">
                      Not locked to 5v5 — ideal for testing 2 robots (1v1) or any custom slot mix.
                    </div>
                    {/* Quick 1v1, 2v2, 3v3, 4v4, 5v5 Preset Pills */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {[
                        { count: 1, label: "1v1 (2 Bots)" },
                        { count: 2, label: "2v2" },
                        { count: 3, label: "3v3" },
                        { count: 4, label: "4v4" },
                        { count: 5, label: "5v5" },
                      ].map((preset) => (
                        <button
                          key={preset.count}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            handleSelectTrainingPreset(preset.count);
                          }}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                            category === "training" && trainingPlayersPerTeam === preset.count
                              ? "bg-[#0a0a0a] text-[#ffffff]"
                              : "border border-[#d4d4d4] bg-[#ffffff] text-[#0a0a0a] hover:bg-[#f5f5f5]"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* 2. Network Interface & UDP Broadcast Settings [US-3, US-21] */}
            <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[12px] font-bold tracking-wider text-[#0a0a0a] uppercase">
                  2. Network Interface & UDP [US-21.5]
                </h3>
                <WifiIcon className="h-4 w-4 text-[#1ba673]" />
              </div>
              <div className="space-y-2.5">
                <div>
                  <label className="block text-[12px] font-medium text-[#5f5f5f]">
                    Focus Network Interface (Multi-Network Selector)
                  </label>
                  <select
                    value={`${interfaceName}|${interfaceAddress}`}
                    onChange={(e) => handleSelectInterface(e.target.value)}
                    className="mt-1 w-full rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3.5 py-2 font-mono text-[12px] text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none"
                  >
                    {availableInterfaces.map((iface) => (
                      <option
                        key={`${iface.name}|${iface.address}`}
                        value={`${iface.name}|${iface.address}`}
                      >
                        {iface.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-[#737373]">
                    Binds the outgoing UDP socket to <code className="font-mono font-bold text-[#0a0a0a]">{interfaceAddress}</code> and auto-fills its subnet broadcast address.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[12px] font-medium text-[#5f5f5f]">
                      Broadcast IPv4
                    </label>
                    <input
                      type="text"
                      value={broadcastIp}
                      onChange={(e) => setBroadcastIp(e.target.value)}
                      placeholder="255.255.255.255"
                      className="mt-1 w-full rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3.5 py-1.5 font-mono text-[12px] text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#5f5f5f]">
                      UDP Port
                    </label>
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="mt-1 w-full rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3.5 py-1.5 font-mono text-[12px] text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-[#737373]">
                  Header <code className="font-mono font-bold text-[#0a0a0a]">0xADDE</code> (MSB),
                  Referee ID <code className="font-mono font-bold text-[#1ba673]">32</code>, Left{" "}
                  <code className="font-mono font-bold text-[#1456f0]">0..10</code>, Right{" "}
                  <code className="font-mono font-bold text-[#ff5530]">16..26</code>.
                </p>
              </div>
            </div>

            {/* 3. Coin Toss & Kick-Off Selection [US-8.2] */}
            <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[12px] font-bold tracking-wider text-[#0a0a0a] uppercase">
                  3. Coin Toss & Team Names [US-8.2]
                </h3>
                <button
                  type="button"
                  onClick={handleTossCoin}
                  className="flex items-center gap-1 rounded-full bg-[#0a0a0a] px-3 py-1 text-[11px] font-semibold text-[#ffffff] transition hover:bg-[#262626]"
                >
                  <SparklesIcon className="h-3.5 w-3.5" />
                  <span>Toss Coin</span>
                </button>
              </div>

              {coinWinner && (
                <div className="mb-3 rounded-full bg-[#e8ffea] px-3.5 py-1.5 text-[12px] font-medium text-[#1ba673]">
                  Coin Toss Winner:{" "}
                  <strong>{coinWinner === "left" ? leftTeamName : rightTeamName}</strong>!
                </div>
              )}

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[12px] text-[#5f5f5f]">
                    Left Defending Team Name
                  </label>
                  <input
                    type="text"
                    value={leftTeamName}
                    onChange={(e) => setLeftTeamName(e.target.value)}
                    className="mt-1 w-full rounded-full border border-[#d4d4d4] bg-[#ffffff] px-4 py-1.5 text-[13px] font-semibold text-[#1456f0] focus:border-[#0a0a0a] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-[#5f5f5f]">
                    Right Defending Team Name
                  </label>
                  <input
                    type="text"
                    value={rightTeamName}
                    onChange={(e) => setRightTeamName(e.target.value)}
                    className="mt-1 w-full rounded-full border border-[#d4d4d4] bg-[#ffffff] px-4 py-1.5 text-[13px] font-semibold text-[#ff5530] focus:border-[#0a0a0a] focus:outline-none"
                  />
                </div>
                <div className="pt-1">
                  <span className="block text-[12px] text-[#5f5f5f]">1st Half Kick-Off Team:</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFirstKickoffSide("left")}
                      className={`rounded-full border py-1.5 text-[12px] font-bold transition ${
                        firstKickoffSide === "left"
                          ? "border-[#1456f0] bg-[#1456f0] text-[#ffffff]"
                          : "border-[#d4d4d4] bg-[#ffffff] text-[#5f5f5f]"
                      }`}
                    >
                      Left Team (IDs 0–10)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFirstKickoffSide("right")}
                      className={`rounded-full border py-1.5 text-[12px] font-bold transition ${
                        firstKickoffSide === "right"
                          ? "border-[#ff5530] bg-[#ff5530] text-[#ffffff]"
                          : "border-[#d4d4d4] bg-[#ffffff] text-[#5f5f5f]"
                      }`}
                    >
                      Right Team (IDs 16–26)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Permanent YAML Configuration Banner (`config/settings.yaml` & `config/teams.yaml`) */}
          <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0a0a0a] text-[#ffffff]">
                  <DocumentTextIcon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[14px] font-bold text-[#0a0a0a]">
                    Permanent YAML Configuration Files
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#5f5f5f]">
                    Edit{" "}
                    <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#0a0a0a]">
                      {yamlPaths?.settingsPath || "config/settings.yaml"}
                    </code>{" "}
                    (Category, Training 1v1, Interface, UDP Port) and{" "}
                    <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#0a0a0a]">
                      {yamlPaths?.teamsPath || "config/teams.yaml"}
                    </code>{" "}
                    (Team Names & Player Rosters) directly in any text editor, or click{" "}
                    <strong className="text-[#0a0a0a]">Save as Permanent Default (YAML)</strong>{" "}
                    below.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReloadYaml}
                  className="flex items-center gap-1.5 rounded-full border border-[#d4d4d4] bg-[#ffffff] px-3.5 py-1.5 text-[12px] font-medium text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />
                  <span>Reload from YAML</span>
                </button>
                <button
                  type="button"
                  onClick={handleSavePermanentYaml}
                  className="flex items-center gap-1.5 rounded-full bg-[#1456f0] px-4 py-1.5 text-[12px] font-semibold text-[#ffffff] transition hover:bg-[#1d4ed8]"
                >
                  <ArrowDownOnSquareIcon className="h-4 w-4" />
                  <span>Save as Permanent Default (YAML)</span>
                </button>
              </div>
            </div>

            {yamlStatus && (
              <div className="mt-2.5 rounded-full bg-[#e8ffea] px-4 py-1.5 text-[12px] font-medium text-[#1ba673]">
                {yamlStatus}
              </div>
            )}
          </div>

          {/* United Team Randomizer & Roster Assignment [US-8.1, US-21.7] */}
          <div className="rounded-[16px] border border-[#e5e5e5] bg-[#ffffff] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[16px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
                  United Soccer Multi-Club Roster Assignment [US-8.1, US-21.7]
                </h3>
                <p className="text-[13px] text-[#5f5f5f]">
                  {category === "training"
                    ? "Training Mode: Set any robot slot to Field Player or Goalkeeper (e.g. only ID #0 and ID #16 for 1v1) and set unused slots to Inactive."
                    : "Assign each robot slot's university/club, robot name, and role below."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRandomizeRoster}
                className="flex items-center gap-1.5 rounded-full bg-[#000000] px-4 py-2 text-[12px] font-medium text-[#ffffff] transition hover:bg-[#262626]"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span>Randomize United Teams [US-8.1]</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[
                {
                  side: "left",
                  title: `${leftTeamName} — Defending Left Goal (Wire IDs 0..10)`,
                  team: matchState.leftTeam,
                  baseId: 0,
                  headerColor: "text-[#1456f0]",
                },
                {
                  side: "right",
                  title: `${rightTeamName} — Defending Right Goal (Wire IDs 16..26)`,
                  team: matchState.rightTeam,
                  baseId: 16,
                  headerColor: "text-[#ff5530]",
                },
              ].map(({ side, title, team, baseId, headerColor }) => (
                <div
                  key={side}
                  className="rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] p-3.5"
                >
                  <div className={`mb-2.5 text-[12px] font-bold uppercase ${headerColor}`}>
                    {title}
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {team.slots.slice(0, visibleSlotCount).map((slot) => (
                      <div
                        key={slot.slotIndex}
                        className="grid grid-cols-12 items-center gap-1.5 rounded-full border border-[#e5e5e5] bg-[#ffffff] px-3 py-1.5 text-[12px]"
                      >
                        <span className="col-span-2 font-mono font-bold text-[#0a0a0a]">
                          ID #{baseId + slot.slotIndex}
                        </span>
                        <input
                          type="text"
                          value={slot.originClub}
                          onChange={(e) =>
                            handleUpdateSlot(side, slot.slotIndex, "originClub", e.target.value)
                          }
                          placeholder="Origin Club"
                          className="col-span-4 rounded-full border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-[12px] text-[#0a0a0a]"
                        />
                        <input
                          type="text"
                          value={slot.robotName}
                          onChange={(e) =>
                            handleUpdateSlot(side, slot.slotIndex, "robotName", e.target.value)
                          }
                          placeholder="Robot Name"
                          className="col-span-3 rounded-full border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-[12px] text-[#0a0a0a]"
                        />
                        <select
                          value={slot.role}
                          onChange={(e) =>
                            handleUpdateSlot(side, slot.slotIndex, "role", e.target.value)
                          }
                          className="col-span-3 rounded-full border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-[12px] text-[#0a0a0a]"
                        >
                          <option value="goalkeeper">Goalkeeper</option>
                          <option value="fieldPlayer">Field Player</option>
                          <option value="substitute">Substitute</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[#e5e5e5] bg-[#ffffff] px-6 py-4">
          <div className="text-[12px] text-[#737373]">
            Tip: Click <strong className="text-[#0a0a0a]">Save as Permanent Default (YAML)</strong>{" "}
            above to persist changes into <code className="font-mono">config/*.yaml</code>.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[#d4d4d4] bg-[#ffffff] px-5 py-2 text-[13px] font-medium text-[#0a0a0a] transition hover:bg-[#f5f5f5]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              className="flex items-center gap-1.5 rounded-full bg-[#000000] px-6 py-2 text-[13px] font-medium text-[#ffffff] transition hover:bg-[#262626]"
            >
              <CheckCircleIcon className="h-4 w-4" />
              <span>Apply Match & Network Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
