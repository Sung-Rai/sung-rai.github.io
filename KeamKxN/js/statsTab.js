import { fetchGames } from "./statsApi.js";
import {
  calculateChampionStats,
  calculatePlayerStats
} from "./statsCalculations.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatKda(value) {
  if (value === null || value === undefined) return "—";
  if (value === Infinity) return "Perfect";
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

const sortState = {};

function compareValues(a, b, direction) {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier;
  }

  return String(a ?? "").localeCompare(String(b ?? "")) * multiplier;
}

function renderSortableTable(containerId, columns, rows, defaultSortKey, defaultDirection = "desc") {
  const container = document.getElementById(containerId);

  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<p class="muted">No data yet.</p>`;
    return;
  }

  if (!sortState[containerId]) {
    sortState[containerId] = {
      key: defaultSortKey,
      direction: defaultDirection
    };
  }

  const currentSort = sortState[containerId];
  const sortedRows = [...rows].sort((a, b) => {
    return compareValues(
      a[currentSort.key]?.sortValue,
      b[currentSort.key]?.sortValue,
      currentSort.direction
    );
  });

  container.innerHTML = `
    <div class="stats-table-scroll">
      <table class="stats-table">
        <thead>
          <tr>
            ${columns.map(column => {
              const active = currentSort.key === column.key;
              const indicator = active
                ? currentSort.direction === "asc"
                  ? "▲"
                  : "▼"
                : "";

              return `
                <th class="sortable-header" data-table="${containerId}" data-sort-key="${column.key}">
                  ${escapeHtml(column.label)}
                  <span class="sort-indicator">${indicator}</span>
                </th>
              `;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${sortedRows.map(row => `
            <tr>
              ${columns.map(column => `
                <td>${row[column.key]?.displayValue ?? ""}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll(".sortable-header").forEach(header => {
    header.addEventListener("click", () => {
      const sortKey = header.dataset.sortKey;

      if (sortState[containerId].key === sortKey) {
        sortState[containerId].direction =
          sortState[containerId].direction === "asc" ? "desc" : "asc";
      } else {
        sortState[containerId].key = sortKey;
        sortState[containerId].direction = "desc";
      }

      renderSortableTable(
        containerId,
        columns,
        rows,
        defaultSortKey,
        defaultDirection
      );
    });
  });
}

function renderTable(containerId, headers, rows) {
  const container = document.getElementById(containerId);

  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<p class="muted">No data yet.</p>`;
    return;
  }

  container.innerHTML = `
    <table class="stats-table">
      <thead>
        <tr>
          ${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            ${row.map(cell => `<td>${cell}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderRecentGames(games) {
  const container = document.getElementById("recent-games");

  if (!container) return;

  if (!games.length) {
    container.innerHTML = `<p class="muted">No games saved yet.</p>`;
    return;
  }

  container.innerHTML = games.slice(0, 20).map(game => {
    const teamA = (game.game_players ?? [])
      .filter(row => row.team === "A")
      .map(row => `${row.role}: ${row.players?.display_name ?? "Unknown"}`)
      .join(", ");

    const teamB = (game.game_players ?? [])
      .filter(row => row.team === "B")
      .map(row => `${row.role}: ${row.players?.display_name ?? "Unknown"}`)
      .join(", ");

    return `
      <article class="game-card">
        <h3>${escapeHtml(game.title || "Untitled Game")}</h3>
        <p><strong>Date:</strong> ${escapeHtml(game.played_at)}</p>
        <p><strong>Winner:</strong> Team ${escapeHtml(game.winning_team)}</p>
        <p><strong>Team A:</strong> ${escapeHtml(teamA)}</p>
        <p><strong>Team B:</strong> ${escapeHtml(teamB)}</p>
      </article>
    `;
  }).join("");
}

export async function refreshStats() {
  const status = document.getElementById("stats-status");

  try {
    if (status) status.textContent = "Loading stats...";

    const games = await fetchGames();
    const playerStats = calculatePlayerStats(games);
    const championStats = calculateChampionStats(games);

    renderTable(
        "player-stats",
        [
            "Player",
            "Games",
            "Wins",
            "Losses",
            "Winrate",
            "KDA"
        ],
        playerStats.map(player => [
            escapeHtml(player.name),
            player.games,
            player.wins,
            player.losses,
            formatPercent(player.winrate),
            formatKda(player.kda)
        ])
    );


    renderSortableTable(
        "champion-pick-stats",
        [
            { key: "champion", label: "Champion" },
            { key: "picks", label: "Picks" },
            { key: "wins", label: "Wins" },
            { key: "winrate", label: "Winrate" },
            { key: "pickrate", label: "Pickrate" }
        ],
        championStats.picks.map(champ => ({
            champion: {
            displayValue: escapeHtml(champ.champion),
            sortValue: champ.champion
            },
            picks: {
            displayValue: champ.picks,
            sortValue: champ.picks
            },
            wins: {
            displayValue: champ.wins,
            sortValue: champ.wins
            },
            winrate: {
            displayValue: formatPercent(champ.winrate),
            sortValue: champ.winrate
            },
            pickrate: {
            displayValue: formatPercent(champ.pickrate),
            sortValue: champ.pickrate
            }
        })),
        "picks",
        "desc"
    );

    renderSortableTable(
        "champion-ban-stats",
        [
            { key: "champion", label: "Champion" },
            { key: "bans", label: "Bans" },
            { key: "banrate", label: "Banrate" }
        ],
        championStats.bans.map(champ => ({
            champion: {
            displayValue: escapeHtml(champ.champion),
            sortValue: champ.champion
            },
            bans: {
            displayValue: champ.bans,
            sortValue: champ.bans
            },
            banrate: {
            displayValue: formatPercent(champ.banrate),
            sortValue: champ.banrate
            }
        })),
        "bans",
        "desc"
    );

    renderRecentGames(games);

    if (status) {
      status.textContent = `${games.length} saved game${games.length === 1 ? "" : "s"} loaded.`;
    }
  } catch (error) {
    console.error(error);

    if (status) {
      status.textContent = `Could not load stats: ${error.message}`;
    }
  }
}

export function setupStatsTab() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", async () => {
      const selectedTab = button.dataset.tab;

      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.remove("active");
      });

      document.querySelectorAll("[data-tab]").forEach(tabButton => {
        tabButton.classList.remove("active");
      });

      document.getElementById(`${selectedTab}-tab`)?.classList.add("active");
      button.classList.add("active");

      if (selectedTab === "stats" || selectedTab === "champions") {
        await refreshStats();
      }
    });
  });

  document.getElementById("refresh-stats-btn")?.addEventListener("click", refreshStats);
  document.getElementById("refresh-champion-stats-btn")?.addEventListener("click", refreshStats);
}