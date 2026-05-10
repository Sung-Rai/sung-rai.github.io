const ROLE_ORDER = ["Top", "Jun", "Mid", "Adc", "Sup"];

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function ensurePlayer(stats, player) {
  const key = player.stable_key;

  if (!stats.has(key)) {
    stats.set(key, {
      stableKey: key,
      name: player.display_name,
      games: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      gamesWithKda: 0,
      kda: null,
      roles: {
        Top: 0,
        Jun: 0,
        Mid: 0,
        Adc: 0,
        Sup: 0
      },
      roleWins: {
        Top: 0,
        Jun: 0,
        Mid: 0,
        Adc: 0,
        Sup: 0
      },
      botLaneGames: 0,
      botLaneRate: 0
    });
  }

  return stats.get(key);
}

export function calculatePlayerStats(games) {
  const stats = new Map();

  for (const game of games) {
    for (const row of game.game_players ?? []) {
      if (!row.players) continue;

      const player = ensurePlayer(stats, row.players);
      const won = row.team === game.winning_team;

      player.games += 1;

      if (won) {
        player.wins += 1;
      } else {
        player.losses += 1;
      }
      const hasKda =
        row.kills !== null &&
        row.kills !== undefined &&
        row.deaths !== null &&
        row.deaths !== undefined &&
        row.assists !== null &&
        row.assists !== undefined;

    if (hasKda) {
        player.kills += Number(row.kills);
        player.deaths += Number(row.deaths);
        player.assists += Number(row.assists);
        player.gamesWithKda += 1;
    }

      if (ROLE_ORDER.includes(row.role)) {
        player.roles[row.role] += 1;

        if (won) {
          player.roleWins[row.role] += 1;
        }

        if (row.role === "Adc" || row.role === "Sup") {
          player.botLaneGames += 1;
        }
      }
    }
  }

  return [...stats.values()]
    .map(player => ({
      ...player,
      winrate: pct(player.wins, player.games),
      botLaneRate: pct(player.botLaneGames, player.games),
      kda: player.gamesWithKda > 0
        ? player.deaths === 0
            ? player.kills + player.assists > 0
                ? Infinity
                : null
            : (player.kills + player.assists) / player.deaths
        : null,
      roleRates: Object.fromEntries(
        ROLE_ORDER.map(role => [role, pct(player.roles[role], player.games)])
      ),
      roleWinrates: Object.fromEntries(
        ROLE_ORDER.map(role => [role, pct(player.roleWins[role], player.roles[role])])
      )
    }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

export function calculateChampionStats(games) {
  const champions = new Map();

  let gamesWithPickData = 0;
  let gamesWithBanData = 0;
  let gamesWithChampionData = 0;

  function ensureChampion(championName) {
    const champion = String(championName ?? "").trim();

    if (!champion) return null;

    const key = champion.toLowerCase();

    if (!champions.has(key)) {
      champions.set(key, {
        champion,
        picks: 0,
        wins: 0,
        bans: 0,
        presenceGames: 0,
        pickrate: 0,
        banrate: 0,
        presence: 0,
        winrate: 0
      });
    }

    return champions.get(key);
  }

  for (const game of games) {
    const pickedChampionsThisGame = new Set();
    const bannedChampionsThisGame = new Set();

    // ---------- Picks ----------
    for (const row of game.game_players ?? []) {
      const champion = String(row.champion ?? "").trim();

      if (!champion) continue;

      const key = champion.toLowerCase();
      const stat = ensureChampion(champion);

      if (!stat) continue;

      pickedChampionsThisGame.add(key);
      stat.picks += 1;

      if (row.team === game.winning_team) {
        stat.wins += 1;
      }
    }

    if (pickedChampionsThisGame.size > 0) {
      gamesWithPickData += 1;
    }

    // ---------- Bans ----------
    for (const ban of game.game_bans ?? []) {
      const champion = String(ban.champion ?? "").trim();

      if (!champion) continue;

      const key = champion.toLowerCase();
      const stat = ensureChampion(champion);

      if (!stat) continue;

      bannedChampionsThisGame.add(key);
      stat.bans += 1;
    }

    if (bannedChampionsThisGame.size > 0) {
      gamesWithBanData += 1;
    }

    // ---------- Presence ----------
    const presentChampionsThisGame = new Set([
      ...pickedChampionsThisGame,
      ...bannedChampionsThisGame
    ]);

    if (presentChampionsThisGame.size > 0) {
      gamesWithChampionData += 1;
    }

    for (const key of presentChampionsThisGame) {
      const stat = champions.get(key);

      if (stat) {
        stat.presenceGames += 1;
      }
    }
  }

  const championStats = [...champions.values()]
    .map(stat => ({
      ...stat,
      pickrate: pct(stat.picks, gamesWithPickData),
      banrate: pct(stat.bans, gamesWithBanData),
      presence: pct(stat.presenceGames, gamesWithChampionData),
      winrate: pct(stat.wins, stat.picks)
    }))
    .sort((a, b) => {
      const totalA = a.picks + a.bans;
      const totalB = b.picks + b.bans;

      return totalB - totalA || a.champion.localeCompare(b.champion);
    });

  return {
    champions: championStats,
    gamesWithPickData,
    gamesWithBanData,
    gamesWithChampionData
  };
}

export function calculateRoleStats(games) {
  const roleStats = Object.fromEntries(
    ROLE_ORDER.map(role => [
      role,
      {
        role,
        games: 0,
        wins: 0,
        winrate: 0
      }
    ])
  );

  for (const game of games) {
    for (const row of game.game_players ?? []) {
      if (!ROLE_ORDER.includes(row.role)) continue;

      roleStats[row.role].games += 1;

      if (row.team === game.winning_team) {
        roleStats[row.role].wins += 1;
      }
    }
  }

  return ROLE_ORDER.map(role => ({
    ...roleStats[role],
    winrate: pct(roleStats[role].wins, roleStats[role].games)
  }));
}