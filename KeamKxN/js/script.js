import { ROLE_KEYS, generateOptimalTeams } from './teamAlgorithm.js';
import {
  saveCompletedGame,
  fetchPlayers,
  updatePlayerDefaultRatings
} from "./statsApi.js";
import { setupStatsTab, refreshStats } from "./statsTab.js";
import { setupGameImport } from "./importGames.js";
import { supabase } from "./supabaseClient.js";
import {
  getChampionIndex,
  attachChampionAutocomplete,
  canonicalizeChampionName
} from "./champions.js";
import {
  loginWithUsername,
  logout,
  getCurrentUser,
  isAdmin
} from "./auth.js";

let adminMode = false;

// -------------------- Rating slider --------------------

const participants = [];


const line = document.querySelector(".shared-line");
const list = document.querySelector(".participants-list");

function setAdminUiEnabled(enabled) {
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !enabled;
  });

  if (!enabled) {
    const activeAdminPanel = document.querySelector(".tab-panel.active[data-admin-only]");

    if (activeAdminPanel) {
      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.remove("active");
      });

      document.querySelectorAll("[data-tab]").forEach(button => {
        button.classList.remove("active");
      });

      document.getElementById("generator-tab")?.classList.add("active");
      document.querySelector("[data-tab='generator']")?.classList.add("active");
    }
  }
}

async function refreshAuthState() {
  const user = await getCurrentUser();
  adminMode = await isAdmin();

  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const loginButton = document.getElementById("login-btn");
  const logoutButton = document.getElementById("logout-btn");
  const status = document.getElementById("auth-status");

  if (user && adminMode) {
    status.textContent = "Admin mode unlocked";
    usernameInput.hidden = true;
    passwordInput.hidden = true;
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else if (user && !adminMode) {
    status.textContent = "Logged in, but not authorised";
    usernameInput.hidden = true;
    passwordInput.hidden = true;
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else {
    status.textContent = "Base mode";
    usernameInput.hidden = false;
    passwordInput.hidden = false;
    loginButton.hidden = false;
    logoutButton.hidden = true;
  }

  setAdminUiEnabled(adminMode);

  if (adminMode) {
    await loadDatabasePlayers();
  } else {
    clearAdminGeneratedUi();

    if (usernameInput) usernameInput.value = "";
    if (passwordInput) passwordInput.value = "";
  }
}

document.getElementById("login-btn")?.addEventListener("click", async () => {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  try {
    await loginWithUsername(username, password);
    await refreshAuthState();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  clearAdminGeneratedUi();

  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");

  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";

  await logout();
  await refreshAuthState();
});

supabase.auth.onAuthStateChange(() => {
  refreshAuthState();
});

// -------------------- Player Management --------------------

const STORAGE_KEY = "keam_players";

function loadSavedPlayers() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function savePlayers(players) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

function renderSavedPlayers() {
  const container = document.getElementById("saved-players-list");
  container.innerHTML = "";


  const players = loadSavedPlayers();

  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "saved-player-row";
    const isUsed = participants.some(ap => ap.id === p.id);

    row.innerHTML = `
    <span style="color:${p.color}">●</span>
    <span>${p.name}</span>
    <span>(${p.value ?? 50})</span>

    <span class="player-controls">
      <button data-id="${p.id}" type="button" class="add-to-team selector" ${isUsed ? "disabled" : ""}>
        Use
      </button>

      <button data-id="${p.id}" type="button" class="delete-player selector">
        Delete
      </button>
    </span>
    `;

    container.appendChild(row);
  });
}

// Toggle saved players list

const toggleBtn = document.getElementById("toggle-saved-btn");
const savedList = document.getElementById("saved-players-list");

toggleBtn.addEventListener("click", () => {
  savedList.classList.toggle("expanded");
  if (savedList.classList.contains("expanded")) {
    toggleBtn.textContent = "Saved Players ▲";
  } else {
    toggleBtn.textContent = "Saved Players ▼";
  }
});

document.getElementById("savePlayerBtn").addEventListener("click", () => {

  const nameInput = document.getElementById("newPlayerName");
  const ratingInput = document.getElementById("newPlayerRating");
  const colorInput = document.getElementById("newPlayerColor");

  const players = loadSavedPlayers();

  if (!nameInput.value.trim()) return;

  const rating = ratingInput.value ? Number(ratingInput.value) : 50;

  const newPlayer = {
    id: Date.now(),
    name: nameInput.value,
    value: rating,
    color: colorInput.value
  };

  players.push(newPlayer);
  savePlayers(players);

  nameInput.value = "";
  ratingInput.value = "";
  colorInput.value = "#3b82f6";

  renderSavedPlayers();
});

let databasePlayers = [];

function normalizePlayerName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const PLAYER_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e"
];

function getPlayerColor(player) {
  const key = String(
    player.stable_key ??
    player.stableKey ??
    player.name ??
    player.display_name ??
    ""
  );

  let hash = 0;

  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }

  return PLAYER_COLORS[hash % PLAYER_COLORS.length];
}

function makeTempParticipantId() {
  return Date.now() + Math.floor(Math.random() * 100000);
}

function addDatabasePlayerToNumberline(dbPlayer) {
  if (participants.length >= 10) {
    alert("You can only select 10 players.");
    return;
  }

  const name = dbPlayer.display_name;
  const normalizedName = normalizePlayerName(name);

  const alreadySelected = participants.some(player => {
    return normalizePlayerName(player.name) === normalizedName;
  });

  if (alreadySelected) {
    alert(`${name} is already selected.`);
    return;
  }

  const rating = Number(dbPlayer.default_rating);

  participants.push({
    id: makeTempParticipantId(),
    dbPlayerId: dbPlayer.id,
    stableKey: dbPlayer.stable_key,
    name,
    value: Number.isFinite(rating) ? rating : 50,
    color: getPlayerColor(dbPlayer)
  });

  refreshSlider();
  renderDatabasePlayers();
}

function renderDatabasePlayers() {
  const container = document.getElementById("database-players-list");
  const searchInput = document.getElementById("database-player-search");

  if (!container) return;

  const query = normalizePlayerName(searchInput?.value ?? "");

  const filteredPlayers = databasePlayers.filter(player => {
    return normalizePlayerName(player.display_name).includes(query);
  });

  container.innerHTML = "";

  for (const player of filteredPlayers) {
    const alreadySelected = participants.some(selected => {
      return normalizePlayerName(selected.name) === normalizePlayerName(player.display_name);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "database-player-chip selector";
    const rating = Number.isFinite(Number(player.default_rating))
      ? Number(player.default_rating)
      : 50;
    button.textContent = alreadySelected
      ? `${player.display_name} (${rating}) ✓`
      : `${player.display_name} (${rating})`;
    button.disabled = alreadySelected;

    button.addEventListener("click", () => {
      addDatabasePlayerToNumberline(player);
    });

    container.appendChild(button);
  }

  if (!filteredPlayers.length) {
    container.innerHTML = `<p class="muted">No matching players.</p>`;
  }
}

function clearDatabasePlayers() {
  databasePlayers = [];

  const container = document.getElementById("database-players-list");
  if (container) {
    container.innerHTML = "";
  }

  const searchInput = document.getElementById("database-player-search");
  if (searchInput) {
    searchInput.value = "";
  }
}

async function loadDatabasePlayers() {
  if (!adminMode) return;

  try {
    databasePlayers = await fetchPlayers();
    renderDatabasePlayers();
  } catch (error) {
    console.warn("Could not load database players:", error.message);
  }
}

function clearAdminGeneratedUi() {
  clearDatabasePlayers();

  // Remove post-game submit panels generated while admin was logged in.
  document.querySelectorAll(".post-game-panel").forEach(panel => {
    panel.remove();
  });

  // Remove database-selected players from the numberline.
  for (let index = participants.length - 1; index >= 0; index -= 1) {
    if (participants[index].dbPlayerId) {
      participants.splice(index, 1);
    }
  }

  refreshSlider();
  renderSavedPlayers();

  // Clear generated team results too, because they may contain database players.
  const resultsEl = document.getElementById("results");
  if (resultsEl) {
    resultsEl.innerHTML = "";
    resultsEl.classList.add("hidden");
  }
}

document.getElementById("database-player-search")?.addEventListener("input", () => {
  renderDatabasePlayers();
});

document.getElementById("addPlayerBtn").addEventListener("click", () => {

  if (participants.length >= 10) {
    alert("You can only add 10 players.");
    return;
  }

  const nameInput = document.getElementById("newPlayerName");
  const ratingInput = document.getElementById("newPlayerRating");
  const colorInput = document.getElementById("newPlayerColor");

  if (!nameInput.value.trim()) return;

  const rating = ratingInput.value ? Number(ratingInput.value) : 50;

  const newPlayer = {
    id: Date.now(),
    name: nameInput.value,
    value: rating,
    color: colorInput.value || "#3b82f6"
  };

  // Add to participants (numberline)
  participants.push(newPlayer);
  refreshSlider();
  renderDatabasePlayers();  

  // Do NOT clear inputs
});

function refreshSlider() {

  line.innerHTML = "";
  list.innerHTML = "";

  participants.forEach(createParticipant);
}

document.addEventListener("click", e => {

  // Delete saved player
  if (e.target.classList.contains("delete-player")) {

    const id = Number(e.target.dataset.id);

    let players = loadSavedPlayers();
    players = players.filter(p => p.id !== id);

    savePlayers(players);
    renderSavedPlayers();

    return;
  }

  if (!e.target.classList.contains("add-to-team")) return;

  if (participants.length >= 10) {
    alert("You can only select 10 players.");
    return;
  }

  const id = Number(e.target.dataset.id);
  const players = loadSavedPlayers();

  const player = players.find(p => p.id === id);
  if (!player) return;

  if (participants.some(p => p.id === id)) {
    alert("Player already selected.");
  return;
  }

  participants.push({
  ...player,
  value: player.value ?? 50
  });

  refreshSlider();
  renderSavedPlayers();
  renderDatabasePlayers();
  });

// ----------------- Participant numberline -----------------

function enableDrag(dot, participant) {
  dot.addEventListener("pointerdown", e => {
    dot.setPointerCapture(e.pointerId);
    const rect = line.getBoundingClientRect();

    function move(e) {
      let x = e.clientX - rect.left;
      x = Math.max(0, Math.min(x, rect.width));

      dot.style.left = `${x}px`;

      const value = Math.round((x / rect.width) * 100);
      participant.value = value;

      const el = document.getElementById(`value-${participant.id}`);
      if (el) el.textContent = value;
    }

    function up(e) {
      dot.releasePointerCapture(e.pointerId);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

function repositionAllDots() {
  document.querySelectorAll(".participant-dot").forEach(dot => {
    const id = Number(dot.dataset.id);
    const participant = participants.find(p => p.id === id);
    if (participant) {
      positionDot(dot, participant.value);
    }
  });
}

window.addEventListener("load", () => {
  const saved = loadSavedPlayers();

  if (saved.length === 0) {
    savePlayers([
      { id: Date.now()+1, name: "Lemon", color: "#f6f33b" },
      { id: Date.now()+2, name: "Lime", color: "#4aef44" }
    ]);
  }

  renderSavedPlayers();
});

window.addEventListener("resize", repositionAllDots); // Helps with when resizing window
function positionDot(dot, value) {
  const rect = line.getBoundingClientRect();
  const x = (value / 100) * rect.width;
  dot.style.left = `${x}px`;
}

function createParticipant(p) {
  // Create the dot
  const dot = document.createElement("div");
  dot.className = "participant-dot";
  dot.dataset.id = p.id;
  dot.dataset.name = p.name;
  dot.style.backgroundColor = p.color || "#3b82f6";
  line.appendChild(dot);

  // Create row container
  const row = document.createElement("div");
  row.className = "participant-row";

  // Name input
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = p.name;
  nameInput.className = "participant-name";
  row.appendChild(nameInput);

  nameInput.addEventListener("input", (e) => {
    p.name = e.target.value;
    dot.dataset.name = p.name;
  });

  // Color picker
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = p.color || "#3b82f6";
  colorInput.className = "participant-color";
  row.appendChild(colorInput);

  colorInput.addEventListener("input", (e) => {
    p.color = e.target.value;
    dot.style.backgroundColor = p.color;
  });

  // Value display
  const valueSpan = document.createElement("span");
  valueSpan.id = `value-${p.id}`;
  valueSpan.textContent = p.value;
  row.appendChild(valueSpan);

  list.appendChild(row);

  // Remove button
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.className = "remove-player-btn";

  removeBtn.addEventListener("click", () => {
  const index = participants.findIndex(ap => ap.id === p.id);

  if (index !== -1) {
    participants.splice(index, 1);
  }

  refreshSlider();
  renderSavedPlayers();
  renderDatabasePlayers();
  });

row.appendChild(removeBtn);

  // Position dot and enable dragging
  positionDot(dot, p.value);
  enableDrag(dot, p);

  return dot;
}

// -------------------- Team Display --------------------

function displayTeams(players, solution) {
  const resultsEl = document.getElementById("results");

  resultsEl.innerHTML = "";
  resultsEl.classList.remove("hidden");

  const teamAName = document.getElementById("teamAName")?.value || "Team A";
  const teamBName = document.getElementById("teamBName")?.value || "Team B";

  const teamA = document.createElement("div");
  teamA.className = "team";

  const teamB = document.createElement("div");
  teamB.className = "team";

  teamA.innerHTML = `<h2>${teamAName}</h2>`;
  teamB.innerHTML = `<h2>${teamBName}</h2>`;

  let totalA = 0;
  let totalB = 0;

  for (const role of ROLE_KEYS) {
    const aPlayer = solution.find(p => p.team === "A" && p.role === role);
    const bPlayer = solution.find(p => p.team === "B" && p.role === role);

    const aName = players[aPlayer.playerIndex].name;
    const bName = players[bPlayer.playerIndex].name;

    const aRating = Math.round(players[aPlayer.playerIndex].ratings?.[role] ?? 0);
    const bRating = Math.round(players[bPlayer.playerIndex].ratings?.[role] ?? 0);

    totalA += aRating;
    totalB += bRating;

    const aRow = document.createElement("div");
    aRow.className = "role-row";
    aRow.innerHTML = `<span class="role-name">${role}</span><span class="skill">${aName} (${aRating})</span>`;
    teamA.appendChild(aRow);

    const bRow = document.createElement("div");
    bRow.className = "role-row";
    bRow.innerHTML = `<span class="role-name">${role}</span><span class="skill">${bName} (${bRating})</span>`;
    teamB.appendChild(bRow);
  }

  const totalARow = document.createElement("div");
  totalARow.className = "role-row total-row";
  totalARow.innerHTML = `<span class="role-name">Total</span><span class="skill">${totalA}</span>`;
  teamA.appendChild(totalARow);

  const totalBRow = document.createElement("div");
  totalBRow.className = "role-row total-row";
  totalBRow.innerHTML = `<span class="role-name">Total</span><span class="skill">${totalB}</span>`;
  teamB.appendChild(totalBRow);

  const container = document.createElement("div");
  container.className = "teams-container";
  container.appendChild(teamA);
  container.appendChild(teamB);

  resultsEl.appendChild(container);
  if (adminMode) {
    resultsEl.appendChild(createPostGameForm(players, solution, teamAName, teamBName));
  }
}

function createPostGameForm(players, solution, teamAName, teamBName) {
  const panel = document.createElement("section");
  panel.className = "post-game-panel";
  panel.setAttribute("data-admin-only", "");

  const title = document.getElementById("title")?.value || "Untitled Game";
  const today = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <h3>Save Completed Game</h3>

    <div class="post-game-meta">
      <label>
        Game Date
        <input id="completed-game-date" type="date" value="${today}">
      </label>

      <label>
        Winning Team
        <select id="completed-game-winner">
          <option value="A">${teamAName}</option>
          <option value="B">${teamBName}</option>
        </select>
      </label>

      <div class="ban-input-group">
      <label>Team A bans</label>
      <div id="team-a-bans" class="ban-inputs">
        <input data-ban-input data-champion-input type="text" placeholder="Ban 1">
        <input data-ban-input data-champion-input type="text" placeholder="Ban 2">
        <input data-ban-input data-champion-input type="text" placeholder="Ban 3">
        <input data-ban-input data-champion-input type="text" placeholder="Ban 4">
        <input data-ban-input data-champion-input type="text" placeholder="Ban 5">
      </div>
      </div>

      <div class="ban-input-group">
        <label>Team B bans</label>
        <div id="team-b-bans" class="ban-inputs">
          <input data-ban-input data-champion-input type="text" placeholder="Ban 1">
          <input data-ban-input data-champion-input type="text" placeholder="Ban 2">
          <input data-ban-input data-champion-input type="text" placeholder="Ban 3">
          <input data-ban-input data-champion-input type="text" placeholder="Ban 4">
          <input data-ban-input data-champion-input type="text" placeholder="Ban 5">
        </div>
      </div>

      <label>
        Notes
        <textarea id="completed-game-notes" rows="3" placeholder="Optional notes"></textarea>
      </label>
    </div>

    <div class="post-game-grid">
      <div class="post-game-team">
        <h4>${teamAName}</h4>
        <div id="post-game-team-a"></div>
      </div>

      <div class="post-game-team">
        <h4>${teamBName}</h4>
        <div id="post-game-team-b"></div>
      </div>
    </div>

    <div class="post-game-actions">
      <button id="submit-completed-game-btn" type="button" class="selector">Submit Completed Game</button>
      <span id="submit-game-status" class="submit-status"></span>
    </div>
  `;

  const teamAContainer = panel.querySelector("#post-game-team-a");
  const teamBContainer = panel.querySelector("#post-game-team-b");

  for (const role of ROLE_KEYS) {
    const aSolution = solution.find(entry => entry.team === "A" && entry.role === role);
    const bSolution = solution.find(entry => entry.team === "B" && entry.role === role);

    teamAContainer.appendChild(createPostGamePlayerRow(players, aSolution));
    teamBContainer.appendChild(createPostGamePlayerRow(players, bSolution));
  }
  getChampionIndex()
  .then(championIndex => {
    attachChampionAutocomplete(panel, championIndex);
  })
  .catch(error => {
    console.warn("Champion autocomplete unavailable:", error.message);
  });

  panel.querySelector("#submit-completed-game-btn").addEventListener("click", async () => {
    if (!adminMode) {
      alert("Only the admin login can save completed games.");
      return;
    }
    const button = panel.querySelector("#submit-completed-game-btn");
    const status = panel.querySelector("#submit-game-status");

    try {
      button.disabled = true;
      status.textContent = "Submitting game...";

      const winningTeam = panel.querySelector("#completed-game-winner").value;
      const playedAt = panel.querySelector("#completed-game-date").value;
      const notes = panel.querySelector("#completed-game-notes").value;

      const championIndex = await getChampionIndex();

      for (const input of panel.querySelectorAll("[data-field='champion']")) {
        const canonical = canonicalizeChampionName(input.value, championIndex);

        if (!canonical) {
          input.focus();
          throw new Error(`Invalid champion: ${input.value || "(empty)"}`);
        }

        input.value = canonical;
      }

      const submittedPlayers = [...panel.querySelectorAll(".post-game-row")].map(row => {
        const participant = participants.find(p => {
          return String(p.id) === String(row.dataset.playerId);
        });

        return {
          id: row.dataset.playerId,
          dbPlayerId: row.dataset.dbPlayerId || null,
          stableKey: row.dataset.stableKey || null,
          defaultRating: participant?.value ?? Number(row.dataset.defaultRating ?? 50),
          name: row.dataset.playerName,
          team: row.dataset.team,
          role: row.dataset.role,
          champion: row.querySelector("[data-field='champion']").value,
          kills: row.querySelector("[data-field='kills']").value,
          deaths: row.querySelector("[data-field='deaths']").value,
          assists: row.querySelector("[data-field='assists']").value
        };
      });

      const bans = [
        ...parseBanInputs(panel.querySelector("#team-a-bans"), "A", championIndex),
        ...parseBanInputs(panel.querySelector("#team-b-bans"), "B", championIndex)
      ];

      validateChampionDraftRules(submittedPlayers, bans);

      await saveCompletedGame({
        title,
        playedAt,
        winningTeam,
        notes,
        players: submittedPlayers,
        bans
      });

      try {
        const ratingUpdates = submittedPlayers
          .filter(player => player.dbPlayerId)
          .map(player => ({
            playerId: player.dbPlayerId,
            rating: player.defaultRating
          }));

        if (ratingUpdates.length > 0) {
          const updatedRatings = await updatePlayerDefaultRatings(ratingUpdates);

          for (const update of updatedRatings) {
            const dbPlayer = databasePlayers.find(player => {
              return String(player.id) === String(update.playerId);
            });

            if (dbPlayer) {
              dbPlayer.default_rating = update.rating;
            }
          }

          renderDatabasePlayers();
        }
      } catch (ratingError) {
        console.warn("Game saved, but rating update failed:", ratingError.message);
        status.textContent = "Game submitted, but rating update failed.";
        button.textContent = "Submitted";
        await refreshStats();
        return;
      }

      status.textContent = "Game submitted.";
      button.textContent = "Submitted";
      await refreshStats();
    } catch (error) {
      console.error(error);
      status.textContent = `Submit failed: ${error.message}`;
      button.disabled = false;
    }
  });

  return panel;
}

function createPostGamePlayerRow(players, solutionEntry) {
  const player = players[solutionEntry.playerIndex];

  const row = document.createElement("div");
  row.className = "post-game-row";
  row.dataset.playerId = player.id;
  row.dataset.playerName = player.name;
  row.dataset.team = solutionEntry.team;
  row.dataset.role = solutionEntry.role;
  row.dataset.dbPlayerId = player.dbPlayerId ?? "";
  row.dataset.stableKey = player.stableKey ?? "";
  row.dataset.defaultRating = String(player.value ?? 50);
  row.innerHTML = `
    <strong>${solutionEntry.role}</strong>
    <span>${player.name}</span>
    <input data-field="champion" data-champion-input type="text" placeholder="Champion" required>
    <input data-field="kills" type="number" min="0" placeholder="K">
    <input data-field="deaths" type="number" min="0" placeholder="D">
    <input data-field="assists" type="number" min="0" placeholder="A">
  `;

  return row;
}

function parseBanInputs(container, team, championIndex) {
  return [...container.querySelectorAll("[data-ban-input]")]
    .map((input, index) => ({
      rawValue: input.value.trim(),
      banOrder: index + 1
    }))
    .filter(({ rawValue }) => {
      const normalized = rawValue.toLowerCase();

      return (
        rawValue &&
        normalized !== "none" &&
        normalized !== "no ban" &&
        normalized !== "n/a" &&
        normalized !== "na"
      );
    })
    .map(({ rawValue, banOrder }) => {
      const canonical = canonicalizeChampionName(rawValue, championIndex);

      if (!canonical) {
        throw new Error(`Invalid Team ${team} ban: ${rawValue}`);
      }

      return {
        team,
        champion: canonical,
        banOrder
      };
    });
}

function championConflictKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validateChampionDraftRules(players, bans) {
  const pickedChampions = new Map();
  const bannedChampions = new Map();

  // Check duplicate picks
  for (const player of players) {
    const key = championConflictKey(player.champion);

    if (!key) continue;

    if (pickedChampions.has(key)) {
      const firstPick = pickedChampions.get(key);

      throw new Error(
        `${player.champion} has been picked more than once. ` +
        `First picked by ${firstPick.playerName} (${firstPick.role}, Team ${firstPick.team}), ` +
        `then by ${player.name} (${player.role}, Team ${player.team}).`
      );
    }

    pickedChampions.set(key, {
      champion: player.champion,
      playerName: player.name,
      team: player.team,
      role: player.role
    });
  }

  // Check duplicate bans
  for (const ban of bans) {
    const key = championConflictKey(ban.champion);

    if (!key) continue;

    if (bannedChampions.has(key)) {
      const firstBan = bannedChampions.get(key);

      throw new Error(
        `${ban.champion} has been banned more than once. ` +
        `First banned by Team ${firstBan.team}, then by Team ${ban.team}.`
      );
    }

    bannedChampions.set(key, {
      champion: ban.champion,
      team: ban.team
    });
  }

  // Check picked + banned conflict
  for (const [key, banned] of bannedChampions.entries()) {
    const picked = pickedChampions.get(key);

    if (picked) {
      throw new Error(
        `${picked.champion} cannot be both banned and picked. ` +
        `Picked by ${picked.playerName} (${picked.role}, Team ${picked.team}) ` +
        `and banned by Team ${banned.team}.`
      );
    }
  }
}

// -------------------- Team Generation --------------------

function generatePlayersFromSliders() {
  return participants.map((p) => {
    return {
      id: p.id,
      dbPlayerId: p.dbPlayerId ?? null,
      stableKey: p.stableKey ?? null,
      name: p.name,
      color: p.color,
      value: p.value,
      ratings: ROLE_KEYS.reduce((acc, role) => {
        acc[role] = p.value;
        return acc;
      }, {})
    };
  });
}

// -------------------- Form Submit --------------------
const form = document.querySelector(".form-container");
form.addEventListener("submit", e => {
  e.preventDefault();

  if (participants.length !== 10) {
    alert("You must select exactly 10 players.");
    return;
  }
  
  const players = generatePlayersFromSliders();

  // Get topN from dropdown
  const topNSelect = document.getElementById("topNSelect");
  const topN = parseInt(topNSelect.value, 10);

  // Generate teams using selected randomness
  const finalSolution = generateOptimalTeams(players, { topN });

  displayTeams(players, finalSolution);
});

// -------------------- Preset Management --------------------

// Toggle preset players list

const presetBtn = document.getElementById("toggle-presets-btn");
const presetList = document.getElementById("saved-presets-list");

presetBtn.addEventListener("click", () => {
  presetList.classList.toggle("expanded");
  if (presetList.classList.contains("expanded")) {
    presetBtn.textContent = "Saved Presets ▲";
  } else {
    presetBtn.textContent = "Saved Presets ▼";
  }
});

const PRESET_KEY = "keam_presets";

function loadSavedPresets() {
  const data = localStorage.getItem(PRESET_KEY);
  return data ? JSON.parse(data) : [];
}

function savePresets(presets) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

function renderSavedPresets() {
  const container = document.getElementById("saved-presets-list");
  container.innerHTML = "";

  const presets = loadSavedPresets();

  presets.forEach((preset, index) => {
    const row = document.createElement("div");
    row.className = "saved-preset-row";

    row.innerHTML = `
      <span>${preset.name}</span>
      <span class="preset-controls">
        <button data-index="${index}" type="button" class="load-preset-btn selector">Load</button>
        ${preset.default ? "" : `<button data-index="${index}" type="button" class="delete-preset-btn selector">Delete</button>`}
      </span>
    `;

    container.appendChild(row);
  });
}

// Default Preset
function ensureDefaultPreset() {
  let presets = loadSavedPresets();
  const hasDefault = presets.some(p => p.default);

  if (!hasDefault) {
    // create 10 evenly spaced default players
    const defaultPlayers = Array.from({ length: 10 }, (_, i) => ({
      id: Date.now() + i,
      name: `Player ${i + 1}`,
      value: Math.round((i + 1) * 100 / 11), // evenly spaced from ~9 to ~91
      color: ["#3b82f6","#ef4444","#facc15","#10b981","#8b5cf6","#f97316","#ec4899","#22d3ee","#a3e635","#f43f5e"][i]
    }));

    const defaultPreset = {
      name: "Default Preset",
      default: true,
      players: defaultPlayers
    };

    presets.unshift(defaultPreset);
    savePresets(presets);
  }

  renderSavedPresets();
}

// Clear numberline
document.getElementById("clearNumberlineBtn").addEventListener("click", () => {
    if (participants.length === 0) return; // nothing to clear

    if (!confirm("Are you sure you want to clear the numberline?")) return;

    participants.length = 0;
    refreshSlider();
    renderSavedPlayers();
    renderDatabasePlayers();
});

// Save Current Numberline as Preset
document.getElementById("savePresetBtn").addEventListener("click", () => {

  if (participants.length !== 10) {
    alert("You must have exactly 10 players on the numberline to save a preset.");
    return;
  }

  const presetName = prompt("Enter a name for this preset:");
  if (!presetName) return;

  const presetPlayers = participants.map(p => ({
    id: p.id,
    dbPlayerId: p.dbPlayerId ?? null,
    stableKey: p.stableKey ?? null,
    name: p.name,
    value: p.value,
    color: p.color
  }));

  const presets = loadSavedPresets();
  presets.push({ name: presetName, default: false, players: presetPlayers });
  savePresets(presets);

  renderSavedPresets();
});

// Handle Preset Load/Delete
document.addEventListener("click", (e) => {

  // Load preset
  if (e.target.classList.contains("load-preset-btn")) {
    const index = Number(e.target.dataset.index);
    const presets = loadSavedPresets();
    const preset = presets[index];

    if (!preset) return;

    participants.length = 0;
    preset.players.forEach(p => participants.push({ ...p }));
    refreshSlider();
    renderSavedPlayers();
    renderDatabasePlayers();
    return;
  }

  // Delete preset
  if (e.target.classList.contains("delete-preset-btn")) {
    const index = Number(e.target.dataset.index);
    let presets = loadSavedPresets();
    presets = presets.filter((_, i) => i !== index);
    savePresets(presets);
    renderSavedPresets();
    return;
  }

});

// -------------------- Initialize --------------------
window.addEventListener("load", () => {
  ensureDefaultPreset();
});

setupStatsTab({
  canUseAdminFeatures: () => adminMode
});

setupGameImport({
  canUseAdminFeatures: () => adminMode
});

refreshAuthState();

// -------------------- Share Results --------------------
// Todo: implement share results functionality

// -------------------- Import/Export --------------------
// Todo: implement import/export of player data


