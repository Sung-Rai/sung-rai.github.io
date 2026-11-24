import { supabase } from "./supabaseClient.js";
import {
  getChampionIndex,
  canonicalizeChampionName
} from "./champions.js";

const VALID_ROLES = new Set(["Top", "Jun", "Mid", "Adc", "Sup"]);

function normaliseStableKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPlayerStableKey(player) {
  if (player.stable_key) return normaliseStableKey(player.stable_key);
  if (player.stableKey) return normaliseStableKey(player.stableKey);

  const name = String(player.name ?? player.display_name ?? "").trim();

  if (name) {
    return normaliseStableKey(name);
  }

  if (player.playerId) return normaliseStableKey(player.playerId);
  if (player.id) return normaliseStableKey(player.id);

  throw new Error("Player is missing name/id.");
}

function cleanNullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return Math.max(0, Math.trunc(parsed));
}

function normaliseRequiredChampion(value, championIndex, context = "champion") {
  const cleaned = String(value ?? "").trim();

  if (!cleaned) {
    throw new Error(`Missing ${context}.`);
  }

  const canonical = canonicalizeChampionName(cleaned, championIndex);

  if (!canonical) {
    throw new Error(`Invalid ${context}: ${cleaned}`);
  }

  return canonical;
}

function normaliseOptionalChampion(value, championIndex, context = "champion") {
  const cleaned = String(value ?? "").trim();

  if (!cleaned) return null;

  const canonical = canonicalizeChampionName(cleaned, championIndex);

  if (!canonical) {
    throw new Error(`Invalid ${context}: ${cleaned}`);
  }

  return canonical;
}

function validateCompletedGame(game) {
  if (!game) throw new Error("Missing game payload.");

  if (!["A", "B"].includes(game.winningTeam)) {
    throw new Error("winningTeam must be either A or B.");
  }

  if (!Array.isArray(game.players) || game.players.length !== 10) {
    throw new Error("A completed game must contain exactly 10 players.");
  }

  const assignedRoles = new Set();
  for (const player of game.players) {
    if (!["A", "B"].includes(player.team)) {
      throw new Error(`Invalid team for ${player.name}.`);
    }

    if (player.role != null && player.role !== "") {
      if (!VALID_ROLES.has(player.role)) {
        throw new Error(`Invalid role for ${player.name}: ${player.role}`);
      }
      const assignment = `${player.team}:${player.role}`;
      if (assignedRoles.has(assignment)) {
        throw new Error(`Team ${player.team} has more than one ${player.role} assignment.`);
      }
      assignedRoles.add(assignment);
    }

    if (!player.name || !String(player.name).trim()) {
      throw new Error("Every player needs a name.");
    }
  }
}

export async function saveCompletedGame(game) {
  validateCompletedGame(game);
  const championIndex = await getChampionIndex();
  const roster = game.players.map(player => ({
    player_id: player.dbPlayerId || null,
    stable_key: player.dbPlayerId ? null : getPlayerStableKey(player),
    display_name: String(player.name).trim(),
    team: player.team,
    role: player.role || null,
    champion: normaliseRequiredChampion(player.champion, championIndex, `${player.name}'s champion`),
    kills: cleanNullableNumber(player.kills),
    deaths: cleanNullableNumber(player.deaths),
    assists: cleanNullableNumber(player.assists)
  }));
  const bans = (Array.isArray(game.bans) ? game.bans : [])
    .map((ban, index) => ({
      team: ["A", "B"].includes(ban.team) ? ban.team : null,
      champion: normaliseOptionalChampion(ban.champion, championIndex, `ban ${index + 1}`),
      ban_order: Number.isFinite(Number(ban.banOrder)) ? Number(ban.banOrder) : index + 1
    }))
    .filter(ban => ban.champion);

  const { data, error } = await supabase.rpc("save_completed_game", {
    game: {
      played_at: game.playedAt || new Date().toISOString().slice(0, 10),
      title: game.title || null,
      winning_team: game.winningTeam,
      notes: game.notes || null,
      source: game.source || "manual"
    },
    roster,
    bans
  });
  if (error) throw error;
  return data;
}

export async function updateMatchRoles(matchId, revision, assignments) {
  const { data, error } = await supabase.rpc("update_match_roles", {
    match_id: matchId,
    expected_revision: revision,
    assignments
  });
  if (error) throw error;
  return data;
}

export async function fetchGames() {
  const games = [];
  const pageSize = 200;

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("games")
      .select(`
      id,
      played_at,
      title,
      winning_team,
      notes,
      source,
      created_at,
      role_revision,
      game_players (
        id,
        team,
        role,
        champion,
        kills,
        deaths,
        assists,
        players (
          stable_key,
          display_name
        )
      ),
      game_bans (
        team,
        champion,
        ban_order
      )
    `)
      .order("played_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, start + pageSize - 1);

    if (error) throw error;
    games.push(...data);
    if (data.length < pageSize) return games;
  }
}

export async function fetchPlayers() {
  const { data, error } = await supabase
    .from("players")
    .select("id, stable_key, display_name, default_rating")
    .order("display_name", { ascending: true });

  if (error) throw error;

  return data ?? [];
}

export async function updatePlayerDefaultRatings(updates) {
  const cleanUpdates = updates
    .filter(update => update.playerId)
    .map(update => ({
      playerId: update.playerId,
      rating: Math.max(0, Math.min(100, Math.round(Number(update.rating))))
    }))
    .filter(update => Number.isFinite(update.rating));

  await Promise.all(
    cleanUpdates.map(update => {
      return supabase
        .from("players")
        .update({ default_rating: update.rating })
        .eq("id", update.playerId)
        .then(({ error }) => {
          if (error) throw error;
        });
    })
  );

  return cleanUpdates;
}

export async function importCompletedGames(games) {
  if (!Array.isArray(games)) {
    throw new Error("Import payload must be an array of games.");
  }

  const results = [];

  for (const game of games) {
    try {
      results.push(await saveCompletedGame({ ...game, source: game.source || "import" }));
    } catch (error) {
      throw new Error(
        `Saved ${results.length} of ${games.length} games. Game ${results.length + 1} failed: ${error.message}`,
        { cause: error }
      );
    }
  }

  return results;
}
