const RANDOMNESS_POOL_SIZE = 5; // 1 = lowest randomness, 5-ish = fair
const RANDOM_FACTOR = 0.001;   // Small random factor to break ties

const roles = [
  { key: "Top", label: "Top" },
  { key: "Jun", label: "Jungle" },
  { key: "Mid", label: "Mid" },
  { key: "Adc", label: "ADC" },
  { key: "Sup", label: "Support" }
];

const ROLE_KEYS = roles.map(r => r.key);

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
      required
    />
  `;

  roles.forEach(role => {
    html += `
      <div class="role">
        <div class="role-label">${role.label}</div>
        <div class="radios">
    `;

    for (let i = 1; i <= 5; i++) {
      html += `
        <input
          id="participant${p}_${role.key}${i}"
          type="radio"
          name="participant${p}${role.key}"
          value="${i}"
          ${i === 1 ? "required" : ""}
        />
        <label for="participant${p}_${role.key}${i}">${i}</label>
      `;
    }

    html += `</div></div>`;
  });

  participant.innerHTML = html;
  container.appendChild(participant);
}

// -------------------- Team Distribution --------------------

// Shuffle helper
function shuffle(arr) {
  return arr.slice().sort(() => Math.random() - 0.5);
}

// Generate all 5-player combinations from 10 players
function combinations(arr, size) {
  if (size === 0) return [[]];
  if (arr.length < size) return [];

  const [first, ...rest] = arr;
  const withFirst = combinations(rest, size - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, size);

  return [...withFirst, ...withoutFirst];
}

// Generate all permutations of an array
function permutations(arr) {
  if (arr.length === 0) return [[]];
  return arr.flatMap((item, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [item, ...p])
  );
}

// Assign roles to a team with minimal total deviation from midpoint
function bestRoleAssignment(team) {
  const perms = shuffle(permutations(ROLE_KEYS));
  let best = null;
  let bestScore = Infinity;

  perms.forEach(perm => {
    const assignment = {};
    let score = 0;

    for (let i = 0; i < team.length; i++) {
      const role = perm[i];
      assignment[role] = team[i];
      // Score = deviation from midpoint (3) + tiny random factor to break ties
      score += Math.abs(team[i].ratings[role] - 3) + Math.random() * RANDOM_FACTOR;
    }

    if (score < bestScore) {
      bestScore = score;
      best = assignment;
    }
  });

  return best;
}

// Total role difference between two teams
function roleDifference(teamA, teamB) {
  return ROLE_KEYS.reduce(
    (sum, role) => sum + Math.abs(teamA[role].ratings[role] - teamB[role].ratings[role]),
    0
  );
}

// Pick a solution randomly, weighted by balance
function weightedRandomPick(solutions) {
  const weights = solutions.map(s => 1 / (s.diff + 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < solutions.length; i++) {
    random -= weights[i];
    if (random <= 0) return solutions[i];
  }

  return solutions[0]; // fallback
}

// Main team generator
function generateOptimalTeams(players) {
  const shuffledPlayers = shuffle(players); // prevent bias toward first input
  const solutions = [];
  const allSplits = combinations(shuffledPlayers, 5);

  allSplits.forEach(teamAPlayers => {
    const teamBPlayers = shuffledPlayers.filter(p => !teamAPlayers.includes(p));

    const teamA = bestRoleAssignment(teamAPlayers);
    const teamB = bestRoleAssignment(teamBPlayers);

    const diff = roleDifference(teamA, teamB);
    solutions.push({ teamA, teamB, diff });
  });

  solutions.sort((a, b) => a.diff - b.diff);

  const pool = shuffle(solutions).slice(0, Math.min(RANDOMNESS_POOL_SIZE, solutions.length));
  return weightedRandomPick(pool);
}

// -------------------- Form Handling --------------------
const form = document.querySelector(".form-container");
const resultsEl = document.getElementById("results");

form.addEventListener("submit", e => {
  e.preventDefault();
  const players = collectPlayers();
  const result = generateOptimalTeams(players);
  renderTeams(result);
});

function collectPlayers() {
  const roles = ROLE_KEYS;
  const players = [];

  for (let p = 1; p <= 10; p++) {
    const name = document.getElementById(`participant${p}`).value;
    const ratings = {};

    roles.forEach(role => {
      const checked = document.querySelector(`input[name="participant${p}${role}"]:checked`);
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
