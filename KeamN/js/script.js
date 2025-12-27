import { generateOptimalTeams, ROLE_KEYS } from "./teamAlgorithm.js";
import { DEFAULT_CONFIG } from "./config.js";

const roles = ROLE_KEYS;
const ROLE_LABELS = { Top: "Top", Jun: "Jungle", Mid: "Mid", Adc: "ADC", Sup: "Support" };

// -------------------- Helpers --------------------

function showTooltip(inputEl, message) {
  // Remove existing tooltip
  let existing = inputEl.parentElement.querySelector('.tooltip');
  if (existing) existing.remove();

  // Create new tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.textContent = message;
  inputEl.parentElement.appendChild(tooltip);

  // Position tooltip above the input
  const rect = inputEl.getBoundingClientRect();
  tooltip.style.top = `${inputEl.offsetTop - tooltip.offsetHeight - 5}px`;
  tooltip.style.left = `${inputEl.offsetLeft}px`;

  // Show it
  setTimeout(() => tooltip.classList.add('show'), 10);

  // Remove after 3 seconds
  setTimeout(() => tooltip.remove(), 3000);
}

// -------------------- Participant Layout --------------------
const container = document.getElementById("participants-container");

for (let p = 1; p <= 10; p++) {
  const participant = document.createElement("div");
  participant.className = "participants";

  let html = `
    <input
      id="participant${p}"
      class="participantText"
      type="text"
      placeholder="Participant ${p}"
    />
  `;

  roles.forEach(role => {
    html += `
      <div class="role">
        <div class="role-label">${ROLE_LABELS[role]}</div>
        <div class="radios">
    `;

    for (let i = 1; i <= 5; i++) {
      html += `
        <input
          id="participant${p}_${role}${i}"
          type="radio"
          name="participant${p}${role}"
          value="${i}"
        />
        <label for="participant${p}_${role}${i}">${i}</label>
      `;
    }

    html += `</div></div>`;
  });

  participant.innerHTML = html;
  container.appendChild(participant);
}

// -------------------- Form Handling --------------------
const form = document.querySelector(".form-container");
const resultsEl = document.getElementById("results");

form.addEventListener("submit", e => {
  e.preventDefault();
  const players = collectPlayers();

  const config = {
    ...DEFAULT_CONFIG,
    iterations: Number(document.getElementById("randomness").value),
  };
  console.log("Using config:", config); // optional for debugging
  
  const result = generateOptimalTeams(players, config);
  renderTeams(result);
});

function collectPlayers() {
  const players = [];

  for (let p = 1; p <= 10; p++) {
    const name = document.getElementById(`participant${p}`).value;
    if (!name) {
      const nameInput = document.getElementById(`participant${p}`);
      showTooltip(nameInput, `Player ${p} must have a name.`);
      nameInput.focus();
      throw new Error(`Validation failed: Player ${p} name is empty`);
    }

    const ratings = {};
    roles.forEach(role => {
      const checked = document.querySelector(`input[name="participant${p}${role}"]:checked`);
      if (!checked) {
        const roleInput = document.getElementsByName(`participant${p}${role}`)[0];
        showTooltip(roleInput, `Player ${p} must select a rating for ${role}.`);
        roleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        throw new Error(`Player ${p} must select a rating for ${role}`);
      }
      ratings[role] = Number(checked.value);
    });

    players.push({ name, ratings });
  }

  return players;
}

function renderTeams({ teamA, teamB }) {
  const title = document.getElementById("title").value;
  const teamAName = document.getElementById("teamAName").value;
  const teamBName = document.getElementById("teamBName").value;

  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = `
    <h2 class="draw-title">${title}</h2>
    <div class="teams-container">
      ${renderTeam(teamAName, teamA)}
      ${renderTeam(teamBName, teamB)}
    </div>
  `;
}

function renderTeam(title, team) {
  return `
    <div class="team">
      <h2>${title}</h2>
      ${ROLE_KEYS.map(role => {
        const player = team[role];
        return `
          <div class="role-row">
            <span class="role-name">${role}</span>
            <span>${player.name}</span>
            <span class="skill">${player.ratings[role]}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// -------------------- Import/Export --------------------

// Export current participants as a JSON string
const exportBtn = document.getElementById("exportBtn");
exportBtn.addEventListener("click", () => {
  const players = collectPlayers();
  const exportString = JSON.stringify(players);
  prompt("Copy your saved configuration:", exportString);
});

// Import participants from a JSON string
const importBtn = document.getElementById("importBtn");
const importInput = document.getElementById("importInput");

importBtn.addEventListener("click", () => {
  try {
    const players = JSON.parse(importInput.value);
    if (!Array.isArray(players)) throw new Error("Invalid format");

    players.forEach((player, index) => {
      const p = index + 1;
      document.getElementById(`participant${p}`).value = player.name;
      ROLE_KEYS.forEach(role => {
        const radios = document.getElementsByName(`participant${p}${role}`);
        radios.forEach(radio => {
          radio.checked = Number(radio.value) === player.ratings[role];
        });
      });
    });

    alert("Configuration imported successfully!");
  } catch (err) {
    alert("Failed to import configuration. Make sure the format is correct.");
  }
});

// -------------------- Config UI --------------------

// Randomness slider

const randomnessSlider = document.getElementById("randomness");
const randomnessValue = document.getElementById("randomnessValue");

// Set initial display
randomnessValue.textContent = randomnessSlider.value;

randomnessSlider.addEventListener("input", () => {
  randomnessValue.textContent = randomnessSlider.value;
});

