import { fetchGames } from "./statsApi.js";
import {
  calculateChampionStats,
  calculatePlayerStats
} from "./statsCalculations.js";
import { getChampionImageMap } from "./champions.js";

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
      direction: defaultDirection,
      userSelected: false
    };
  }

  const currentSort = sortState[containerId];
  const showSortHighlight = currentSort.userSelected === true;

  const sortedRows = [...rows].sort((a, b) => {
    return compareValues(
      a[currentSort.key]?.sortValue,
      b[currentSort.key]?.sortValue,
      currentSort.direction
    );
  });

  container.innerHTML = `
    <div class="stats-table-scroll">
      <table class="stats-table sortable-stats-table">
        <thead>
          <tr>
            ${columns.map(column => {
              const active = showSortHighlight && currentSort.key === column.key;
              const directionClass = active
                ? currentSort.direction === "asc"
                  ? "sorted-asc"
                  : "sorted-desc"
                : "";

              return `
                <th
                  class="sortable-stats-header ${directionClass}"
                  data-table="${containerId}"
                  data-sort-key="${column.key}"
                  role="button"
                  tabindex="0"
                >
                  ${escapeHtml(column.label)}
                </th>
              `;
            }).join("")}
          </tr>
        </thead>

        <tbody>
          ${sortedRows.map(row => `
            <tr>
              ${columns.map(column => {
                const active = showSortHighlight && currentSort.key === column.key;

                return `
                  <td class="${active ? "sorted-column" : ""}">
                    ${row[column.key]?.displayValue ?? ""}
                  </td>
                `;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll(".sortable-stats-header").forEach(header => {
    const handleSort = () => {
      const sortKey = header.dataset.sortKey;

      if (sortState[containerId].key === sortKey) {
        sortState[containerId].direction =
          sortState[containerId].direction === "asc" ? "desc" : "asc";
      } else {
        sortState[containerId].key = sortKey;
        sortState[containerId].direction = "desc";
      }

      sortState[containerId].userSelected = true;

      renderSortableTable(
        containerId,
        columns,
        rows,
        defaultSortKey,
        defaultDirection
      );
    };

    header.addEventListener("click", handleSort);

    header.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      handleSort();
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

function renderRecentGames(games, championImageMap) {
  const container = document.getElementById("recent-games");

  if (!container) return;

  if (!games.length) {
    container.innerHTML = `<p class="muted">No games saved yet.</p>`;
    return;
  }

  container.innerHTML = games
    .slice(0, 20)
    .map(game => renderRecentGameCard(game, championImageMap))
    .join("");
}

function getSortableCellValue(cell) {
  const explicitValue = cell.dataset.sortValue;

  if (explicitValue !== undefined) {
    const numericExplicitValue = Number(explicitValue);

    if (Number.isFinite(numericExplicitValue)) {
      return numericExplicitValue;
    }

    return String(explicitValue).trim().toLowerCase();
  }

  const text = cell.textContent.trim();

  if (!text) {
    return "";
  }

  // Sort KDA-looking cells like "10 / 8 / 16" by KDA ratio.
  const kdaMatch = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);

  if (kdaMatch) {
    const kills = Number(kdaMatch[1]);
    const deaths = Number(kdaMatch[2]);
    const assists = Number(kdaMatch[3]);

    return (kills + assists) / Math.max(1, deaths);
  }

  // Sort numbers, commas, and percentages correctly.
  const cleanedNumber = text
    .replaceAll(",", "")
    .replace("%", "")
    .trim();

  if (/^-?\d+(\.\d+)?$/.test(cleanedNumber)) {
    return Number(cleanedNumber);
  }

  return text.toLowerCase();
}

function compareSortableValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function getDefaultSortDirectionForColumn(table, columnIndex) {
  const rows = [...table.tBodies[0].rows];

  for (const row of rows) {
    const value = getSortableCellValue(row.cells[columnIndex]);

    if (value !== "" && value !== null && value !== undefined) {
      return typeof value === "number" ? "desc" : "asc";
    }
  }

  return "desc";
}

function updateSortHeaderState(table, sortedColumnIndex, direction) {
  const headers = [...table.querySelectorAll("thead th")];

  headers.forEach((header, index) => {
    header.classList.remove("sorted-asc", "sorted-desc");

    if (index === sortedColumnIndex) {
      header.classList.add(direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });

  [...table.querySelectorAll("tbody td")].forEach(cell => {
    cell.classList.remove("sorted-column");
  });

  [...table.tBodies[0].rows].forEach(row => {
    const cell = row.cells[sortedColumnIndex];

    if (cell) {
      cell.classList.add("sorted-column");
    }
  });
}

function sortTableByColumn(table, columnIndex, direction) {
  const tbody = table.tBodies[0];

  if (!tbody) return;

  const multiplier = direction === "asc" ? 1 : -1;

  const sortedRows = [...tbody.rows].sort((leftRow, rightRow) => {
    const leftValue = getSortableCellValue(leftRow.cells[columnIndex]);
    const rightValue = getSortableCellValue(rightRow.cells[columnIndex]);

    return compareSortableValues(leftValue, rightValue) * multiplier;
  });

  tbody.replaceChildren(...sortedRows);

  table.dataset.sortColumn = String(columnIndex);
  table.dataset.sortDirection = direction;

  updateSortHeaderState(table, columnIndex, direction);
}

function enableStatsTableSorting(root = document) {
  const tables = root.querySelectorAll("table");

  tables.forEach(table => {
    if (table.dataset.sortableReady === "true") return;
    if (!table.tBodies.length) return;

    const headers = [...table.querySelectorAll("thead th")];

    if (!headers.length) return;

    table.dataset.sortableReady = "true";
    table.classList.add("sortable-stats-table");

    headers.forEach((header, columnIndex) => {
      header.classList.add("sortable-stats-header");
      header.tabIndex = 0;
      header.setAttribute("role", "button");

      const handleSort = () => {
        const currentColumn = Number(table.dataset.sortColumn ?? -1);
        const currentDirection = table.dataset.sortDirection;

        let nextDirection;

        if (currentColumn === columnIndex) {
          nextDirection = currentDirection === "desc" ? "asc" : "desc";
        } else {
          nextDirection = getDefaultSortDirectionForColumn(table, columnIndex);
        }

        sortTableByColumn(table, columnIndex, nextDirection);
      };

      header.addEventListener("click", handleSort);

      header.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;

        event.preventDefault();
        handleSort();
      });
    });
  });
}

export async function refreshStats() {
  const status = document.getElementById("stats-status");

  try {
    if (status) status.textContent = "Loading stats...";

    const games = await fetchGames();
    const playerStats = calculatePlayerStats(games);
    const championStats = calculateChampionStats(games);
    const championImageMap = await getChampionImageMap();

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
      "champion-stats",
      [
        { key: "champion", label: "Champion" },
        { key: "picks", label: "Picks" },
        { key: "bans", label: "Bans" },
        { key: "totalPresence", label: "Total" },
        { key: "wins", label: "Wins" },
        { key: "winrate", label: "Winrate" },
        { key: "pickrate", label: "Pickrate" },
        { key: "banrate", label: "Banrate" },
        { key: "presence", label: "Presence" }
      ],
      championStats.champions.map(champ => {
      const imageUrl = championImageMap.get(champ.champion.toLowerCase());

      return {
        champion: {
          displayValue: `
            <span class="champion-cell">
              ${
                imageUrl
                  ? `<img src="${escapeHtml(imageUrl)}" alt="" class="champion-icon">`
                  : ""
              }
              <span>${escapeHtml(champ.champion)}</span>
            </span>
          `,
          sortValue: champ.champion
        },
        picks: {
          displayValue: champ.picks,
          sortValue: champ.picks
        },
        bans: {
          displayValue: champ.bans,
          sortValue: champ.bans
        },
        totalPresence: {
          displayValue: champ.picks + champ.bans,
          sortValue: champ.picks + champ.bans
        },
        wins: {
          displayValue: champ.wins,
          sortValue: champ.wins
        },
        winrate: {
          displayValue: champ.picks > 0 ? formatPercent(champ.winrate) : "—",
          sortValue: champ.picks > 0 ? champ.winrate : -1
        },
        pickrate: {
          displayValue: formatPercent(champ.pickrate),
          sortValue: champ.pickrate
        },
        banrate: {
          displayValue: formatPercent(champ.banrate),
          sortValue: champ.banrate
        },
        presence: {
          displayValue: formatPercent(champ.presence),
          sortValue: champ.presence
        }
      };
    }),
      "totalPresence",
      "desc"
    );

    renderRecentGames(games, championImageMap);

    if (status) {
      status.textContent = `${games.length} saved game${games.length === 1 ? "" : "s"} loaded.`;
    }
  } catch (error) {
    console.error(error);

    if (status) {
      status.textContent = `Could not load stats: ${error.message}`;
    }
  }
  enableStatsTableSorting(document.getElementById("stats-tab") || document);
}

export function setupStatsTab(options = {}) {
  const canUseAdminFeatures = options.canUseAdminFeatures || (() => false);
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", async () => {
      const selectedTab = button.dataset.tab;
      if (
        ["stats", "champions", "import", "manual-game"].includes(selectedTab) &&
        !canUseAdminFeatures()
      ) {
        alert("Log in to access this section.");
        return;
      }
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

const MATCH_HISTORY_ROLES = ["Top", "Jun", "Mid", "Adc", "Sup"];

function hasStatValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function formatOptionalValue(value) {
  return hasStatValue(value) ? escapeHtml(value) : "—";
}

function formatOptionalKda(player) {
  const hasKda =
    hasStatValue(player.kills) ||
    hasStatValue(player.deaths) ||
    hasStatValue(player.assists);

  if (!hasKda) {
    return "—";
  }

  return `${player.kills ?? "—"} / ${player.deaths ?? "—"} / ${player.assists ?? "—"}`;
}

function getGamePlayersForHistory(game) {
  const rows = game.players ?? game.game_players ?? [];

  return rows.map(row => {
    return {
      team: row.team,
      role: row.role,
      name:
        row.name ??
        row.playerName ??
        row.players?.display_name ??
        row.display_name ??
        "Unknown",
      champion: row.champion ?? null,
      kills: row.kills ?? null,
      deaths: row.deaths ?? null,
      assists: row.assists ?? null
    };
  });
}

function getGameBansForHistory(game) {
  const rows = game.bans ?? game.game_bans ?? [];

  return rows.map(row => {
    return {
      team: row.team,
      champion: row.champion ?? null,
      banOrder: row.banOrder ?? row.ban_order ?? 0
    };
  });
}

function getPlayersByRole(players, team) {
  const teamPlayers = (players ?? []).filter(player => player.team === team);

  return MATCH_HISTORY_ROLES.map(role => {
    return teamPlayers.find(player => player.role === role) ?? {
      role,
      name: null,
      champion: null,
      kills: null,
      deaths: null,
      assists: null
    };
  });
}

function renderChampionPill(championName, championImageMap) {
  if (!championName) {
    return `
      <span class="match-champion match-champion-empty">
        <span class="match-champion-placeholder">?</span>
        <span>—</span>
      </span>
    `;
  }

  const imageUrl = championImageMap.get(String(championName).toLowerCase());

  return `
    <span class="match-champion">
      ${
        imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="" class="match-champion-icon">`
          : `<span class="match-champion-placeholder">?</span>`
      }
      <span>${escapeHtml(championName)}</span>
    </span>
  `;
}

function renderTeamMatchRows(players, team, championImageMap) {
  const rolePlayers = getPlayersByRole(players, team);

  return rolePlayers
    .map(player => {
      return `
        <div class="match-player-row">
          <span class="match-role">${escapeHtml(player.role)}</span>
          <span class="match-player-name">${formatOptionalValue(player.name)}</span>
          ${renderChampionPill(player.champion, championImageMap)}
          <span class="match-kda">${formatOptionalKda(player)}</span>
        </div>
      `;
    })
    .join("");
}

function renderBanSlots(bans, team, championImageMap) {
  const teamBans = (bans ?? [])
    .filter(ban => ban.team === team)
    .sort((a, b) => Number(a.banOrder ?? 0) - Number(b.banOrder ?? 0));

  const slots = Array.from({ length: 5 }, (_, index) => {
    return teamBans[index]?.champion ?? null;
  });

  return slots
    .map(champion => {
      if (!champion) {
        return `<span class="match-ban-slot match-ban-empty">—</span>`;
      }

      const imageUrl = championImageMap.get(String(champion).toLowerCase());

      return `
        <span class="match-ban-slot" title="${escapeHtml(champion)}">
          ${
            imageUrl
              ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(champion)}">`
              : escapeHtml(champion)
          }
        </span>
      `;
    })
    .join("");
}

function renderRecentGameCard(game, championImageMap) {
  const winningTeam = game.winningTeam ?? game.winning_team;
  const playedAt = game.playedAt ?? game.played_at ?? game.created_at ?? "Unknown date";
  const players = getGamePlayersForHistory(game);
  const bans = getGameBansForHistory(game);

  const winClass =
    winningTeam === "A"
      ? "team-a-win"
      : winningTeam === "B"
        ? "team-b-win"
        : "team-unknown";

  return `
    <article class="match-history-card ${winClass}">
      <header class="match-history-header">
        <div>
          <h4>${escapeHtml(game.title ?? "Untitled Game")}</h4>
          <p>${escapeHtml(String(playedAt).slice(0, 10))}</p>
        </div>

        <span class="match-result-badge">
          ${winningTeam ? `Team ${escapeHtml(winningTeam)} Win` : "Result unknown"}
        </span>
      </header>

      <div class="match-history-body">
        <section class="match-team-block">
          <div class="match-team-title">
            <span>Team A</span>
            ${winningTeam === "A" ? "<strong>Victory</strong>" : "<em>Defeat</em>"}
          </div>

          <div class="match-player-header">
            <span>Role</span>
            <span>Player</span>
            <span>Champion</span>
            <span>KDA</span>
          </div>

          ${renderTeamMatchRows(players, "A", championImageMap)}

          <div class="match-bans">
            <span>Bans</span>
            <div>${renderBanSlots(bans, "A", championImageMap)}</div>
          </div>
        </section>

        <section class="match-team-block">
          <div class="match-team-title">
            <span>Team B</span>
            ${winningTeam === "B" ? "<strong>Victory</strong>" : "<em>Defeat</em>"}
          </div>

          <div class="match-player-header">
            <span>Role</span>
            <span>Player</span>
            <span>Champion</span>
            <span>KDA</span>
          </div>

          ${renderTeamMatchRows(players, "B", championImageMap)}

          <div class="match-bans">
            <span>Bans</span>
            <div>${renderBanSlots(bans, "B", championImageMap)}</div>
          </div>
        </section>
      </div>
    </article>
  `;
}