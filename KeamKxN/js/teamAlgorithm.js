/*
Map of player index → { team: "A" | "B", role }

Exports:

ROLE_KEYS
randomSolution(players)
optimize(players, initialSolution, randomness = 0.3, iterations = 10)

// #########################################################################
*/

// -------------------- Constants --------------------
export const ROLE_KEYS = ["Top", "Jun", "Mid", "Adc", "Sup"];

// For future implementation
const constraints = {
  bannedRoles: {
    0: ["Top"], // Player 0 cannot be Top
  },
  cannotBeTogether: [
    [2, 3], // Players 2 and 3 cannot be on same team
  ]
};

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

// Generate all combinations of n elements from arr
function combinations(arr, n) {
  if (n === 0) return [[]];
  if (arr.length < n) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, n - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, n);
  return withFirst.concat(withoutFirst);
}

// Compute total rating of a team
function totalRating(players, indices) {
  return indices.reduce((sum, idx) => {
    const ratings = players[idx].ratings;
    const total = Object.values(ratings).reduce((a, b) => a + b, 0);
    return sum + total;
  }, 0);
}

// -------------------- Logic --------------------

export function generateOptimalTeams(players, config = {}) {
  const topN = config.topN || 5; // number of top-balanced teams to pick from

  // Generate all combinations of 5 players
  const allCombinations = combinations(players.map((_, i) => i), 5);

  // Rank combinations by total rating difference
  const ranked = allCombinations.map(teamA => {
    const teamB = players.map((_, i) => i).filter(idx => !teamA.includes(idx));
    const teamA_total = totalRating(players, teamA);
    const teamB_total = totalRating(players, teamB);
    const diff = Math.abs(teamA_total - teamB_total);
    return { teamA, teamB, diff };
  }).sort((a, b) => a.diff - b.diff);

  // Pick a random combination from top N
  const topChoices = ranked.slice(0, topN);
  const choice = topChoices[Math.floor(Math.random() * topChoices.length)];

  // Randomize roles for both teams
  const rolesShuffledA = shuffle(ROLE_KEYS);
  const rolesShuffledB = shuffle(ROLE_KEYS);

  const solution = [];

  choice.teamA.forEach((playerIndex, i) => {
    solution.push({ playerIndex, team: "A", role: rolesShuffledA[i] });
  });
  choice.teamB.forEach((playerIndex, i) => {
    solution.push({ playerIndex, team: "B", role: rolesShuffledB[i] });
  });

  return solution;
}