import { ROLE_KEYS, generateOptimalTeams } from './teamAlgorithm.js';
// -------------------- Rating slider --------------------

const participants = [];


const line = document.querySelector(".shared-line");
const list = document.querySelector(".participants-list");

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
      { id: Date.now()+1, name: "Player 1", color: "#3b82f6" },
      { id: Date.now()+2, name: "Player 2", color: "#ef4444" }
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
    if (index !== -1) participants.splice(index, 1);
    refreshSlider();
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
  resultsEl.innerHTML = ""; // clear previous results
  resultsEl.classList.remove("hidden");

  const teamA = document.createElement("div");
  teamA.className = "team";
  const teamB = document.createElement("div");
  teamB.className = "team";

  teamA.innerHTML = "<h2>Team A</h2>";
  teamB.innerHTML = "<h2>Team B</h2>";

  // Store totals
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

  // Add total ratings below each team
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
}

// -------------------- Team Generation --------------------

function generatePlayersFromSliders() {

  return participants.map((p) => {
    return {
      name: p.name,
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

// -------------------- Share Results --------------------
// Todo: implement share results functionality

// -------------------- Import/Export --------------------
// Todo: implement import/export of player data


