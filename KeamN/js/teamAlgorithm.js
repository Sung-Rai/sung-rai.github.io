export const ROLE_KEYS = ["Top", "Jun", "Mid", "Adc", "Sup"];

/*
Solution representation:
Map of player index → { team: "A" | "B", role }
*/

// -------------------- Utility --------------------

// Shuffle an array
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deep clone a solution
function cloneSolution(sol) {
  return sol.map(p => ({ ...p }));
}

// -------------------- Logic --------------------

// Cost Function
function computeCost(players, solution) {
  let cost = 0;

  for (const role of ROLE_KEYS) {
    const a = solution.find(p => p.team === "A" && p.role === role);
    const b = solution.find(p => p.team === "B" && p.role === role);

    cost += Math.abs(
      players[a.playerIndex].ratings[role] -
      players[b.playerIndex].ratings[role]
    );
  }

  return cost;
}

// Generate a random initial solution
function randomSolution(players) {
  const indices = shuffle(players.map((_, i) => i));
  const roles = shuffle(ROLE_KEYS);

  const solution = [];

  // Seed: first random player + role → Team A
  solution.push({
    playerIndex: indices[0],
    team: "A",
    role: roles[0]
  });

  // Remaining slots
  const remainingSlots = [];

  for (const team of ["A", "B"]) {
    for (const role of ROLE_KEYS) {
      if (!(team === "A" && role === roles[0])) {
        remainingSlots.push({ team, role });
      }
    }
  }

  const remainingPlayers = indices.slice(1);

  shuffle(remainingPlayers).forEach((playerIndex, i) => {
    const slot = remainingSlots[i];
    solution.push({
      playerIndex,
      team: slot.team,
      role: slot.role
    });
  });

  return solution;
}

// Hill Climbing Optimization
function optimize(players, solution) {
  let improved = true;
  let bestCost = computeCost(players, solution);

  while (improved) {
    improved = false;

    for (let i = 0; i < solution.length; i++) {
      for (let j = i + 1; j < solution.length; j++) {
        const candidate = cloneSolution(solution);

        // Swap EVERYTHING (team + role)
        const tmp = candidate[i];
        candidate[i] = candidate[j];
        candidate[j] = tmp;

        const newCost = computeCost(players, candidate);

        if (newCost < bestCost) {
          solution = candidate;
          bestCost = newCost;
          improved = true;

          // restart from beginning
          i = solution.length;
          break;
        }
      }
    }
  }

  return { solution, cost: bestCost };
}

// -------------------- Public API --------------------

export function generateOptimalTeams(players, config) {
  const iterations = config.iterations ?? 10;

  let best = null;

  for (let i = 0; i < iterations; i++) {
    const initial = randomSolution(players);
    const result = optimize(players, initial);

    if (!best || result.cost < best.cost) {
      best = result;
    }
  }

  return formatResult(players, best.solution);
}

// -------------------- Formatting --------------------

function formatResult(players, solution) {
  const teamA = {};
  const teamB = {};

  for (const entry of solution) {
    const player = players[entry.playerIndex];
    if (entry.team === "A") {
      teamA[entry.role] = player;
    } else {
      teamB[entry.role] = player;
    }
  }

  return { teamA, teamB };
}
