import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyAction,
  getUiState,
  stepSimulatorOnce,
  subscribeToState,
  updateNetworkConfig,
} from "./api.js";
import ComparisonView from "./components/ComparisonView.jsx";
import HeaderBar from "./components/HeaderBar.jsx";
import LauncherModal from "./components/LauncherModal.jsx";
import LeaderboardView from "./components/LeaderboardView.jsx";
import RefereeDeck from "./components/RefereeDeck.jsx";
import TelemetryView from "./components/TelemetryView.jsx";
import "./style.css";

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [activeTab, setActiveTab] = useState("referee");
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    let unlisten = null;
    getUiState().then((initial) => setSnapshot(initial));
    subscribeToState((updated) => setSnapshot(updated)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleApplyAction = useCallback(async (action) => {
    const updated = await applyAction(action);
    setSnapshot(updated);
  }, []);

  const handleUpdateNetworkConfig = useCallback(async (config) => {
    const updated = await updateNetworkConfig(config);
    setSnapshot(updated);
  }, []);

  const handleToggleSimulator = useCallback(async () => {
    if (!snapshot) return;
    const updated = await updateNetworkConfig({
      ...snapshot.networkConfig,
      simulatorEnabled: !snapshot.networkConfig.simulatorEnabled,
    });
    setSnapshot(updated);
  }, [snapshot]);

  const handleStepSimulatorOnce = useCallback(async () => {
    const updated = await stepSimulatorOnce();
    setSnapshot(updated);
  }, []);

  if (!snapshot) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#ffffff] font-mono text-[14px] text-[#0a0a0a]">
        Initializing FIRA HuroCup United Soccer GameController [US-21]...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] text-[#0a0a0a]">
      <HeaderBar
        snapshot={snapshot}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenSetup={() => setSetupOpen(true)}
        onToggleSimulator={handleToggleSimulator}
      />

      <main className="flex-1 overflow-y-auto bg-[#ffffff]">
        {activeTab === "referee" && (
          <RefereeDeck snapshot={snapshot} onApplyAction={handleApplyAction} />
        )}
        {activeTab === "leaderboard" && (
          <LeaderboardView snapshot={snapshot} onApplyAction={handleApplyAction} />
        )}
        {activeTab === "telemetry" && (
          <TelemetryView
            snapshot={snapshot}
            onApplyAction={handleApplyAction}
            onStepSimulatorOnce={handleStepSimulatorOnce}
          />
        )}
        {activeTab === "comparison" && <ComparisonView />}
      </main>

      {/* Minimalist Ollama Editorial Footer */}
      <footer className="border-t border-[#e5e5e5] bg-[#ffffff] px-5 py-3">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 text-[12px] text-[#737373]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#0a0a0a]">
              FIRA HuroCup United Soccer GameController
            </span>
            <span>•</span>
            <span>Protocol [US-21] 0xADDE MSB-First UDP</span>
            <span>•</span>
            <span>Individual Scoring Engine [US-19 & US-20]</span>
          </div>
          <div className="font-mono text-[11px] text-[#737373]">
            Referee ID #32 • Left IDs 0..10 • Right IDs 16..26
          </div>
        </div>
      </footer>

      {setupOpen && (
        <LauncherModal
          snapshot={snapshot}
          onClose={() => setSetupOpen(false)}
          onApplyAction={handleApplyAction}
          onUpdateNetworkConfig={handleUpdateNetworkConfig}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
