import { importCompletedGames } from "./statsApi.js";
import { refreshStats } from "./statsTab.js";

function parseImportPayload(rawText) {
  const parsed = JSON.parse(rawText);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.games)) {
    return parsed.games;
  }

  throw new Error("Expected either an array of games or an object with a games array.");
}

async function loadPresetGames() {
  const response = await fetch("data/presetGames.json", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load data/presetGames.json.");
  }

  const parsed = await response.json();

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.games)) return parsed.games;

  throw new Error("Preset file must contain a games array.");
}

export function setupGameImport(options = {}) {
  const canUseAdminFeatures = options.canUseAdminFeatures || (() => false);
  const importButton = document.getElementById("import-games-btn");
  const presetButton = document.getElementById("load-preset-games-btn");
  const textArea = document.getElementById("import-games-json");
  const status = document.getElementById("import-status");

  importButton?.addEventListener("click", async () => {
    try {
        if (!canUseAdminFeatures()) {
            if (status) status.textContent = "Log in as admin before importing games.";
            return;
        }
      if (status) status.textContent = "Importing games...";

      const games = parseImportPayload(textArea.value);
      const saved = await importCompletedGames(games);

      if (status) {
        status.textContent = `Imported ${saved.length} game${saved.length === 1 ? "" : "s"}.`;
      }

      await refreshStats();
    } catch (error) {
      console.error(error);

      if (status) {
        status.textContent = `Import failed: ${error.message}`;
      }
    }
  });

  presetButton?.addEventListener("click", async () => {
    try {
      if (status) status.textContent = "Loading preset games...";

      const games = await loadPresetGames();
      textArea.value = JSON.stringify({ games }, null, 2);

      if (status) {
        status.textContent = `Loaded ${games.length} preset game${games.length === 1 ? "" : "s"} into the import box. Click Import Games to upload them.`;
      }
    } catch (error) {
      console.error(error);

      if (status) {
        status.textContent = `Could not load preset games: ${error.message}`;
      }
    }
  });
}