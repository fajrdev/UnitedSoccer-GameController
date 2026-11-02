import {
  AdjustmentsHorizontalIcon,
  BoltIcon,
  ChartBarIcon,
  CpuChipIcon,
  DocumentTextIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";

const PHASE_LABELS = {
  firstHalf: "1ST HALF · 10:00",
  halfTimeBreak: "HALF-TIME BREAK · 5:00",
  secondHalf: "2ND HALF · 10:00",
  overtimeFirstHalf: "OVERTIME 1ST HALF · 5:00",
  overtimeHalfTimeBreak: "OVERTIME HALF-TIME · 5:00",
  overtimeSecondHalf: "OVERTIME 2ND HALF · 5:00",
  penaltyShootout: "PENALTY SHOOTOUT · 5 ROUNDS",
};

/**
 * Minimalist single-stroke line-art humanoid soccer mascot icon (inspired by Ollama's stroke-only line art).
 */
function HumanoidLineMascot() {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7 text-[#000000]"
    >
      {/* Robot Head Antenna & Visor */}
      <line x1="18" y1="3" x2="18" y2="7" />
      <circle cx="18" cy="2.5" r="1" fill="currentColor" />
      <rect x="9" y="7" width="18" height="12" rx="4" />
      <circle cx="14" cy="13" r="1.2" fill="currentColor" />
      <circle cx="22" cy="13" r="1.2" fill="currentColor" />
      {/* Torso & Bipedal Legs + Soccer Ball */}
      <path d="M12 19v7h12v-7" />
      <path d="M9 21l-3 4" />
      <path d="M27 21l3 4" />
      <path d="M14 26v6" />
      <path d="M22 26l3 5" />
      <circle cx="29" cy="31" r="3" />
    </svg>
  );
}

export default function HeaderBar({
  snapshot,
  activeTab,
  setActiveTab,
  onOpenSetup,
  onToggleSimulator,
}) {
  const { matchState, networkConfig, totalRefereePacketsSent, robotTelemetry } = snapshot;
  const activeRobotsCount = robotTelemetry.filter((r) => r.ageMs < 3000).length;
  const hasViolation = robotTelemetry.some((r) => r.compliance !== "compliant");
  const rankedCount = snapshot.leaderboard.filter((e) => e.rank !== null).length;

  const tabs = [
    { id: "referee", label: "Referee Deck", icon: BoltIcon },
    {
      id: "leaderboard",
      label: "US-19 Leaderboard",
      icon: TrophyIcon,
      badge: `${rankedCount} Ranked`,
      badgeStyle: "beta",
    },
    {
      id: "telemetry",
      label: "2D Field & US-21 Telemetry",
      icon: ChartBarIcon,
      badge: `${activeRobotsCount} Online`,
      badgeStyle: hasViolation ? "coral" : "success",
    },
    {
      id: "comparison",
      label: "HuroCup vs. RoboCup Specs",
      icon: DocumentTextIcon,
    },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#ffffff]">
      {/* MiniMax `promo-banner`: Crisp #0a0a0a black telemetry status strip above primary nav */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0a0a0a] px-5 py-1.5 text-[12px] font-medium text-[#ffffff]">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#27c93f]/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#27c93f]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#27c93f]" />
            US-21 LIVE
          </span>
          <span className="text-[rgba(255,255,255,0.85)]">
            FIRA HuroCup United Soccer Referee Box
          </span>
          <span className="text-[#525252]">·</span>
          <span className="font-mono text-[11px] text-[rgba(255,255,255,0.7)]">
            Header <code className="text-[#ffffff]">0xADDE</code> (MSB) · Referee ID{" "}
            <code className="text-[#ffffff]">#32</code>
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="rounded-full bg-[#171717] px-2.5 py-0.5 text-[rgba(255,255,255,0.85)] ring-1 ring-[#333333]">
            {matchState.category === "training"
              ? `Training / Freeform · ${matchState.trainingPlayersPerTeam || 1}v${matchState.trainingPlayersPerTeam || 1}`
              : matchState.category === "adultSize"
                ? "Adult Size · Max 3v3 [US-4.1]"
                : "Kid Size · Max 5v5 [US-4.1]"}
          </span>
          <span className="rounded-full bg-[#ff5530] px-2.5 py-0.5 font-sans text-[11px] font-semibold text-[#ffffff]">
            {PHASE_LABELS[matchState.phase] || matchState.phase}
          </span>
          <span className="text-[rgba(255,255,255,0.7)]">
            IF{" "}
            <strong className="text-[#ffffff]">
              {networkConfig.interfaceName || "all"}
            </strong>{" "}
            · UDP{" "}
            <strong className="text-[#ffffff]">
              {networkConfig.broadcastIp}:{networkConfig.port}
            </strong>{" "}
            · Seq <strong className="text-[#ffffff]">#{matchState.refereeSequenceNumber}</strong> ·
            Tx <strong className="text-[#ffffff]">{totalRefereePacketsSent}</strong>
          </span>
        </div>
      </div>

      {/* Ollama + MiniMax `primary-nav`: 60px Paper-White Bar with 1px #e5e5e5 Hairline & Pill Geometry */}
      <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] bg-[#ffffff] px-5 py-2">
        {/* Left Brand Cluster */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e5e5] bg-[#fafafa]">
            <HumanoidLineMascot />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display-rounded text-[18px] font-semibold tracking-[-0.4px] text-[#000000]">
                United Soccer
              </span>
              <span className="rounded-full bg-[#f2f3f5] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#525252]">
                v15.0.2 / 2026
              </span>
            </div>
            <p className="text-[12px] text-[#737373]">
              FIRA HuroCup Autonomous Humanoid Referee Controller
            </p>
          </div>
        </div>

        {/* Center Navigation: MiniMax `pill-tab` / `pill-tab-active` (`rounded-full`) */}
        <nav className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-[36px] items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "border border-[#0a0a0a] bg-[#0a0a0a] text-[#ffffff]"
                    : "border border-[#e5e7eb] bg-[#ffffff] text-[#5f5f5f] hover:border-[#0a0a0a] hover:text-[#0a0a0a]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${
                      isActive
                        ? "bg-[#ffffff]/20 text-[#ffffff]"
                        : tab.badgeStyle === "coral"
                          ? "bg-[#ff5530] text-[#ffffff]"
                          : tab.badgeStyle === "success"
                            ? "bg-[#e8ffea] text-[#1ba673]"
                            : "bg-[#bfdbfe] text-[#1d4ed8]"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Actions: Ollama `command-tag` Pill + Pure Black `button-primary` Pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSimulator}
            title="Toggle built-in [US-21] 0xADDE multi-robot UDP packet simulator"
            className={`inline-flex h-[36px] items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors ${
              networkConfig.simulatorEnabled
                ? "border-[#1ba673]/40 bg-[#e8ffea] text-[#1ba673]"
                : "border-[#e5e5e5] bg-[#fafafa] text-[#525252] hover:border-[#d4d4d4] hover:text-[#000000]"
            }`}
          >
            <CpuChipIcon className="h-4 w-4" />
            <span>Sim Robots</span>
            <span className="font-mono text-[11px] font-bold">
              {networkConfig.simulatorEnabled ? "ON" : "OFF"}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenSetup}
            className="inline-flex h-[36px] items-center gap-2 rounded-full bg-[#000000] px-5 text-[13px] font-semibold text-[#ffffff] transition-colors active:bg-[#222222]"
          >
            <AdjustmentsHorizontalIcon className="h-4 w-4" />
            <span>Match & Roster Setup</span>
          </button>
        </div>
      </div>
    </header>
  );
}
