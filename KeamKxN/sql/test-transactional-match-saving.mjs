import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { resolve } from "node:path";

const dependencyPath = process.env.KEAMKXN_TEST_DEPS;
const require = dependencyPath
  ? createRequire(resolve(dependencyPath, "package.json"))
  : createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { JSDOM } = require("jsdom");

const db = new PGlite();
const admin = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const baseline = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL(
  "./migrations/001_transactional_match_saving.sql", import.meta.url
), "utf8");
const verification = await readFile(new URL("./verify-001.sql", import.meta.url), "utf8");

async function as(role, user) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec(`SET ROLE ${role}`);
}

async function counts() {
  const result = await db.query(`
    SELECT (SELECT count(*)::int FROM public.games) AS games,
      (SELECT count(*)::int FROM public.players) AS players,
      (SELECT count(*)::int FROM public.game_players) AS participants,
      (SELECT count(*)::int FROM public.game_bans) AS bans
  `);
  return result.rows[0];
}

const championNames = [
  "Ahri", "Ashe", "Bard", "Braum", "Diana", "Garen", "Jinx", "Lux", "Nami", "Vex"
];
const roles = ["Top", "Jun", "Mid", "Adc", "Sup"];
const roster = championNames.map((champion, index) => ({
  stable_key: `test-player-${index}`,
  display_name: `Test Player ${index}`,
  team: index < 5 ? "A" : "B",
  role: null,
  champion,
  kills: 1,
  deaths: 1,
  assists: 1
}));
const game = { title: "Synthetic Match", played_at: "2026-01-01", winning_team: "A" };

async function save(players = roster, bans = []) {
  const result = await db.query("SELECT public.save_completed_game($1, $2, $3) AS id", [
    JSON.stringify(game), JSON.stringify(players), JSON.stringify(bans)
  ]);
  return result.rows[0].id;
}

async function edit(id, revision, assignments) {
  const result = await db.query("SELECT public.update_match_roles($1, $2, $3) AS revision", [
    id, revision, JSON.stringify(assignments)
  ]);
  return result.rows[0].revision;
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(baseline);
  await db.query("INSERT INTO public.admin_users VALUES ($1)", [admin]);
  await db.exec(`
    WITH player AS (
      INSERT INTO public.players(stable_key, display_name, default_rating)
      VALUES ('test-player-0', 'Historical Name', 79) RETURNING id
    ), game AS (
      INSERT INTO public.games(title, winning_team) VALUES ('Historical', 'A') RETURNING id
    )
    INSERT INTO public.game_players(game_id, player_id, team, role, champion)
    SELECT game.id, player.id, 'A', 'Top', 'Ahri' FROM player CROSS JOIN game;
  `);
  await db.exec(`
    CREATE ROLE extra_writer;
    GRANT extra_writer TO authenticated;
    GRANT TRUNCATE ON public.admin_users TO extra_writer;
  `);
  await assert.rejects(db.exec(migration), /Unexpected effective client write grants/);
  await db.exec("ROLLBACK");
  await db.exec("REVOKE TRUNCATE ON public.admin_users FROM extra_writer");
  await db.exec(migration);
  const verificationResults = (await db.exec(verification)).filter(result => result.rows.length);
  assert.equal(verificationResults[0].rows.length, 10);
  assert.ok(verificationResults[0].rows.every(row => row.rls_enabled && !row.can_truncate));
  assert.equal(verificationResults[1].rows.length, 3);
  assert.ok(verificationResults[1].rows.every(row => row.authenticated_execute && !row.anon_execute));

  await as("anon", "");
  await assert.rejects(save(), { code: "42501" });
  await assert.rejects(db.query("SELECT * FROM public.games"), { code: "42501" });
  await as("authenticated", member);
  await assert.rejects(save(), { code: "42501" });
  await assert.rejects(edit(admin, 0, []), { code: "42501" });
  assert.equal((await counts()).games, 0);
  assert.equal((await db.query("UPDATE public.players SET default_rating = 99")).affectedRows, 0);
  await as("authenticated", admin);
  for (const table of ["admin_users", "players", "games", "game_players", "game_bans"]) {
    await assert.rejects(db.query(`TRUNCATE public.${table} CASCADE`), { code: "42501" });
  }
  await assert.rejects(db.query("INSERT INTO public.games(winning_team) VALUES ('A')"), {
    code: "42501"
  });
  await assert.rejects(db.query("UPDATE public.game_players SET role = 'Top'"), { code: "42501" });
  await assert.rejects(db.query("UPDATE public.players SET display_name = 'Changed'"), {
    code: "42501"
  });
  assert.equal((await db.query("SELECT role FROM public.game_players")).rows[0].role, "Top");

  const before = await counts();
  await assert.rejects(save(roster, [{ champion: "Ahri", team: "invalid" }]), { code: "23514" });
  assert.deepEqual(await counts(), before, "late failure must roll back roster and player creation");
  await assert.rejects(save([roster[1], ...roster.slice(1)]), { code: "23505" });
  await assert.rejects(save(roster.map(p => ({ ...p, role: "Top" }))), { code: "23505" });
  await assert.rejects(save(roster.map(p => ({ ...p, role: "invalid" }))), { code: "23514" });
  await assert.rejects(save(roster.map(p => ({ ...p, team: "A" }))), { code: "22023" });
  assert.deepEqual(await counts(), before);

  const unassigned = await save();
  const assigned = await save(roster.map((p, i) => ({ ...p, role: roles[i % 5] })));
  const partial = await save(roster.map((p, i) => ({ ...p, role: i === 0 ? "Sup" : null })));
  const readRoster = async id => (await db.query(
    "SELECT id, role, team FROM public.game_players WHERE game_id = $1 ORDER BY team, id", [id]
  )).rows;
  assert.equal((await readRoster(unassigned)).filter(p => p.role == null).length, 10);
  assert.equal((await readRoster(assigned)).filter(p => p.role != null).length, 10);
  assert.equal((await readRoster(partial)).filter(p => p.role != null).length, 1);

  const original = await readRoster(assigned);
  const swap = original.map(p => ({
    id: p.id,
    role: p.team === "A" && p.role === "Top" ? "Mid"
      : p.team === "A" && p.role === "Mid" ? "Top" : p.role
  }));
  assert.equal(await edit(assigned, 0, swap), 1);
  assert.deepEqual((await readRoster(assigned)).map(p => p.role), swap.map(p => p.role));
  await assert.rejects(edit(assigned, 0, original), { code: "40001" });
  await assert.rejects(edit(assigned, 1, swap.slice(1)), { code: "22023" });
  await assert.rejects(edit(assigned, 1, swap.map(p => ({ ...p, role: "Top" }))), {
    code: "23505"
  });
  assert.deepEqual((await readRoster(assigned)).map(p => p.role), swap.map(p => p.role));
  const clear = swap.map(p => ({ id: p.id, role: null }));
  assert.equal(await edit(assigned, 1, clear), 2);

  const existing = (await db.query(
    "SELECT display_name, default_rating FROM public.players WHERE stable_key = 'test-player-0'"
  )).rows[0];
  assert.deepEqual(existing, { display_name: "Historical Name", default_rating: 79 });
  assert.equal((await db.query(
    "UPDATE public.players SET default_rating = 83 WHERE stable_key = 'test-player-0'"
  )).affectedRows, 1);
  console.log("PASS database migration, permissions, rollback, optional roles, swaps and stale revisions");

  const dom = new JSDOM(`
    <div id="player-stats"></div><div id="recent-games"></div>
    <textarea id="import-games-json"></textarea>
    <button id="import-games-btn">Import</button><p id="import-status"></p>
  `);
  globalThis.document = dom.window.document;
  globalThis.keamTestSupabase = {
    async rpc(name, args) {
      try {
        if (name === "update_match_roles") {
          return { data: await edit(args.match_id, args.expected_revision, args.assignments) };
        }
        const rows = await db.query(
          "SELECT public.save_completed_game($1, $2, $3) AS id",
          [JSON.stringify(args.game), JSON.stringify(args.roster), JSON.stringify(args.bans)]
        );
        return { data: rows.rows[0].id };
      } catch (error) {
        return { error };
      }
    },
    from(table) {
      assert.equal(table, "games");
      return {
        select() { return this; },
        order() { return this; },
        async range(start, end) {
          const result = await db.query(`
            SELECT g.*, coalesce((
              SELECT json_agg(to_jsonb(gp) || jsonb_build_object('players',
                jsonb_build_object('stable_key', p.stable_key, 'display_name', p.display_name)))
              FROM public.game_players gp
              JOIN public.players p ON p.id = gp.player_id WHERE gp.game_id = g.id
            ), '[]') AS game_players, '[]'::json AS game_bans
            FROM public.games g ORDER BY played_at DESC, created_at DESC, id DESC
            LIMIT $1 OFFSET $2
          `, [end - start + 1, start]);
          return { data: result.rows };
        }
      };
    }
  };
  const hooks = registerHooks({
    load(url, context, next) {
      if (url.endsWith("/js/supabaseClient.js")) {
        return { format: "module", shortCircuit: true,
          source: "export const supabase = globalThis.keamTestSupabase;" };
      }
      if (url.endsWith("/js/champions.js")) {
        return { format: "module", shortCircuit: true, source: `
          export async function getChampionIndex() { return new Set(${JSON.stringify(championNames)}); }
          export function canonicalizeChampionName(name, index) { return index.has(name) ? name : null; }
          export async function getChampionImageMap() { return new Map(); }
        ` };
      }
      return next(url, context);
    }
  });
  const { setupStatsTab, refreshStats } = await import("../js/statsTab.js");
  const { setupGameImport } = await import("../js/importGames.js");
  const { saveCompletedGame } = await import("../js/statsApi.js");
  const { calculateChampionStats, calculatePlayerStats, calculateRoleStats } =
    await import("../js/statsCalculations.js");
  let adminUi = true;
  setupStatsTab({ canUseAdminFeatures: () => adminUi });
  setupGameImport({ canUseAdminFeatures: () => true });
  const legacy = { title: "Legacy", winningTeam: "A", players: roster.map(p => ({
    name: p.display_name, stable_key: p.stable_key, team: p.team, champion: p.champion
  })) };
  const input = document.getElementById("import-games-json");
  const importButton = document.getElementById("import-games-btn");
  const importStatus = document.getElementById("import-status");

  async function waitUntil(predicate) {
    for (let i = 0; i < 100 && !predicate(); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(predicate(), "timed out waiting for DOM update");
  }

  for (const payload of [[legacy], { games: [legacy] }]) {
    input.value = JSON.stringify(payload);
    importButton.click();
    await waitUntil(() => !importButton.disabled);
    assert.match(importStatus.textContent, /Imported 1 game/);
  }
  input.value = JSON.stringify([legacy, { ...legacy, players: [] }]);
  importButton.click();
  await waitUntil(() => !importButton.disabled);
  assert.match(importStatus.textContent, /Saved 1 of 2 games/);
  assert.equal(await refreshStats(), true);
  assert.deepEqual(
    [...document.querySelectorAll("#player-stats th")].map(cell => cell.textContent.trim()),
    ["Player", "Games", "Wins", "Losses", "Winrate", "KDA"]
  );
  const form = document.querySelector(`[data-match-id="${unassigned}"]`);
  const card = form.closest("article");
  assert.equal(card.querySelectorAll(".match-player-row").length, 10);
  assert.equal(card.querySelector("dialog").hasAttribute("open"), false);
  assert.ok(card.querySelector(".match-history-header [data-open-role-editor]"));
  form.querySelector("select").value = "Sup";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitUntil(() => form.dataset.revision === "1" && !form.isConnected);
  assert.equal((await readRoster(unassigned)).filter(p => p.role === "Sup").length, 1);

  const savedPlayers = (await db.query("SELECT id, stable_key FROM public.players")).rows;
  const manual = {
    ...legacy,
    title: "Manual game",
    players: legacy.players.map(player => ({
      ...player, dbPlayerId: savedPlayers.find(row => row.stable_key === player.stable_key).id
    }))
  };
  assert.equal((await readRoster(await saveCompletedGame(manual))).length, 10);
  const generated = {
    ...manual,
    title: "Generated game",
    players: manual.players.map((player, index) => ({
      ...player, role: roles[index % roles.length]
    }))
  };
  assert.equal((await readRoster(await saveCompletedGame(generated))).filter(row => row.role).length, 10);

  const player = { stable_key: "sample", display_name: "Sample" };
  const samples = [null, "Sup"].map(role => ({
    winning_team: "A",
    game_players: [{ team: "A", role, champion: "Ahri", players: player }]
  }));
  const [stats] = calculatePlayerStats(samples);
  assert.equal(stats.games, 2);
  assert.equal(stats.assignedRoleGames, 1);
  assert.equal(stats.roleRates.Sup, 100);
  assert.equal(stats.botLaneRate, 100);
  assert.equal(calculatePlayerStats(samples.slice(0, 1))[0].roleRates.Sup, null);
  assert.equal(calculateChampionStats(samples).champions[0].picks, 2);
  assert.equal(calculateRoleStats(samples).find(row => row.role === "Sup").games, 1);
  adminUi = false;
  assert.equal(await refreshStats(), true);
  assert.equal(document.querySelector("[data-open-role-editor], [data-role-editor]"), null);
  hooks.deregister();
  dom.window.close();
  console.log("PASS manual and generated save payloads, legacy JSON formats, partial batches, history and statistics");
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
