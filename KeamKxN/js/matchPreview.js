import { getChampionIndex } from "./champions.js";

const COMPANION = "http://127.0.0.1:8765";
const TEAM_NAMES = { 100: "Blue", 200: "Red" };
const MISSING = "—";
const numberFormat = new Intl.NumberFormat();
const OBJECTIVE_ICONS = {
  Towers: "turret",
  Inhibitors: "inhibitor",
  Dragons: "dragon",
  Barons: "baron",
  Heralds: "herald",
  "Void Grubs": "voidgrub"
};
const PLAYER_METRICS = {
  damage: "Champion damage",
  gold: "Gold",
  laneCs: "Lane CS",
  jungleCs: "Jungle CS",
  vision: "Vision score"
};

async function companionRequest(route, token, payload, signal) {
  const response = await fetch(COMPANION + route, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    targetAddressSpace: "loopback",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "The companion rejected the request.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function append(parent, tag, value) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value ?? MISSING;
  parent.append(element);
  return element;
}

function formatStat(value) {
  return value == null ? MISSING : numberFormat.format(value);
}

function renderMatchDetails(container, teams, champions, championName) {
  const details = append(container, "details");
  details.className = "lcu-match-details";
  append(details, "summary", "Match details");
  const metrics = append(details, "div");
  metrics.className = "lcu-metrics";
  metrics.setAttribute("role", "group");
  metrics.setAttribute("aria-label", "Compare players by");
  const charts = append(details, "div");
  charts.className = "lcu-chart-grid";
  const rows = [];
  for (const team of teams) {
    const panel = append(charts, "section");
    panel.className = "lcu-chart-team";
    panel.dataset.team = team.id;
    append(panel, "h4", `${TEAM_NAMES[team.id]} team`);
    const list = append(panel, "ul");
    list.className = "lcu-chart";
    for (const player of team.players) {
      const row = append(list, "li");
      row.className = "lcu-chart-row";
      const name = championName(player.championId);
      const playerName = player.riotId?.split("#")[0];
      const icon = champions.get(player.championId)?.imageUrl;
      if (icon) {
        const image = append(row, "img");
        image.className = "match-champion-icon";
        image.alt = playerName ? name : "";
        image.title = name;
        image.referrerPolicy = "no-referrer";
        image.src = icon;
      } else {
        const placeholder = append(row, "span", "?");
        placeholder.className = "match-champion-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
      }
      const stat = append(row, "div");
      const label = append(stat, "div");
      label.className = "lcu-chart-label";
      append(label, "span", playerName || name);
      if (playerName && !icon && name !== MISSING) {
        append(label, "span", name).className = "muted";
      }
      const value = append(label, "strong");
      const track = append(stat, "div");
      track.className = "lcu-chart-track";
      track.setAttribute("aria-hidden", "true");
      const fill = append(track, "span");
      rows.push({ player, value, fill });
    }
  }

  function selectMetric(metric, selectedButton) {
    for (const button of metrics.children) {
      button.setAttribute("aria-pressed", String(button === selectedButton));
    }
    const maximum = Math.max(1, ...rows.map(({ player }) => player[metric] ?? 0));
    for (const { player, value, fill } of rows) {
      const total = player[metric];
      value.textContent = formatStat(total);
      fill.style.width = `${100 * (total ?? 0) / maximum}%`;
    }
  }

  for (const [key, name] of Object.entries(PLAYER_METRICS)) {
    const button = append(metrics, "button", name);
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectMetric(key, button));
  }
  selectMetric("damage", metrics.firstElementChild);
}

function renderPreview(container, match, champions) {
  const championName = id => id == null ? MISSING : champions.get(id)?.name ?? `Champion #${id}`;
  const date = new Date(match.createdAt ?? NaN);
  const played = Number.isNaN(date.valueOf()) ? MISSING : date.toLocaleString();
  const duration = match.duration == null ? MISSING
    : `${Math.floor(match.duration / 60)}:${String(match.duration % 60).padStart(2, "0")}`;
  const card = append(container, "article");
  card.className = "match-history-card lcu-match-card";
  if (match.winningTeam === 100) card.classList.add("team-a-win");
  if (match.winningTeam === 200) card.classList.add("team-b-win");
  const metadata = append(card, "header");
  metadata.className = "match-history-header";
  const summary = append(metadata, "div");
  append(summary, "h4", `Game ${match.gameId}`);
  append(summary, "p", `${played} · ${duration}`);
  const winner = TEAM_NAMES[match.winningTeam];
  if (winner) append(metadata, "span", `${winner} win`).className = "match-result-badge";
  const boards = append(card, "div");
  boards.className = "match-history-body";
  const teams = [...match.teams].sort((a, b) => a.id - b.id);
  for (const team of teams) {
    const name = TEAM_NAMES[team.id];
    const section = append(boards, "section");
    section.className = "match-team-block lcu-team";
    section.dataset.team = team.id;
    const heading = append(section, "header");
    heading.className = "lcu-team-heading";
    append(heading, "h4", `${name} team`);
    if (TEAM_NAMES[match.winningTeam]) {
      const result = team.id === match.winningTeam ? "Victory" : "Defeat";
      const badge = append(heading, "span", result);
      badge.className = "lcu-team-result";
      badge.dataset.result = result.toLowerCase();
    }
    const wrapper = append(section, "div");
    wrapper.className = "lcu-table-wrap";
    const table = append(wrapper, "table");
    table.setAttribute("aria-label", `${name} team scoreboard`);
    const header = append(append(table, "thead"), "tr");
    for (const label of ["Riot ID", "Champion", "KDA"]) {
      append(header, "th", label).scope = "col";
    }
    const body = append(table, "tbody");
    for (const player of team.players) {
      const row = append(body, "tr");
      append(row, "td", player.riotId ?? MISSING);
      const pick = append(append(row, "td"), "span");
      pick.className = "match-champion";
      const icon = champions.get(player.championId)?.imageUrl;
      if (icon) {
        const image = append(pick, "img");
        image.className = "match-champion-icon";
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.src = icon;
      }
      append(pick, "span", championName(player.championId));
      append(row, "td", [player.kills, player.deaths, player.assists].map(formatStat).join(" / "));
    }
    const details = append(section, "div");
    details.className = "lcu-team-details";
    const bans = append(details, "div");
    bans.className = "match-bans";
    append(bans, "span", "Bans");
    const portraits = append(bans, "div");
    if (!team.bans.length) append(portraits, "span", MISSING);
    for (const id of team.bans) {
      const name = championName(id);
      const slot = append(portraits, "span");
      slot.className = "match-ban-slot";
      slot.title = name;
      const icon = champions.get(id)?.imageUrl;
      if (icon) {
        const image = append(slot, "img");
        image.alt = name;
        image.referrerPolicy = "no-referrer";
        image.src = icon;
      } else {
        slot.classList.add("lcu-ban-name");
        slot.textContent = name;
      }
    }
    const objectives = append(details, "ul");
    objectives.className = "lcu-objectives";
    for (const [label, file] of Object.entries(OBJECTIVE_ICONS)) {
      const value = formatStat(team.objectives[label]);
      const objective = append(objectives, "li");
      objective.title = `${label}: ${value}`;
      const icon = append(objective, "img");
      icon.alt = "";
      icon.src = new URL(`../assets/objectives/${file}.svg`, import.meta.url).href;
      append(objective, "span", label);
      append(objective, "strong", value);
    }
  }
  renderMatchDetails(card, teams, champions, championName);
}

export function setupMatchPreview(canUseAdminFeatures) {
  const pairForm = document.getElementById("lcu-pair-form");
  const matchForm = document.getElementById("lcu-match-form");
  const code = document.getElementById("lcu-code");
  const gameId = document.getElementById("lcu-game-id");
  const status = document.getElementById("lcu-status");
  const preview = document.getElementById("lcu-preview");
  let token;
  let pending;
  let expires;

  function reset(message = "Start the Windows companion to get a pairing code.") {
    pending?.abort();
    pending = undefined;
    token = undefined;
    clearTimeout(expires);
    code.value = "";
    gameId.value = "";
    pairForm.hidden = false;
    matchForm.hidden = true;
    preview.replaceChildren();
    status.textContent = message;
  }

  function start(form) {
    pending?.abort();
    const request = new AbortController();
    pending = request;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    const timeout = setTimeout(() => request.abort(), 45000);
    return {
      signal: request.signal,
      current: () => pending === request && canUseAdminFeatures(),
      finish() {
        clearTimeout(timeout);
        button.disabled = false;
        if (pending === request) pending = undefined;
      }
    };
  }

  const unavailable = window.location.origin === "http://127.0.0.1:8000"
    ? "Could not reach the companion. For this local site, restart it with --dev and use the new pairing code."
    : "Could not reach the companion. Check that it is running and allow loopback access when prompted.";
  pairForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!canUseAdminFeatures()) return;
    const pairingCode = code.value.trim();
    code.value = "";
    if (!/^[A-Za-z0-9_-]{32}$/.test(pairingCode)) {
      status.textContent = "Enter the 32-character code shown by the companion.";
      return;
    }
    const request = start(pairForm);
    status.textContent = "Pairing companion…";
    try {
      const pairing = await companionRequest("/pair", pairingCode, {}, request.signal);
      if (!request.current()) return;
      if (!Number.isInteger(pairing?.expiresIn) || pairing.expiresIn < 1 || pairing.expiresIn > 900) {
        throw new Error("Invalid companion response.");
      }
      token = pairingCode;
      expires = setTimeout(() => reset("Pairing expired. Restart the companion to get a new code."), pairing.expiresIn * 1000);
      pairForm.hidden = true;
      matchForm.hidden = false;
      status.textContent = "Companion paired.";
      gameId.focus();
    } catch (error) {
      if (request.current()) status.textContent = error.status ? error.message : unavailable;
    } finally {
      request.finish();
    }
  });

  matchForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!canUseAdminFeatures() || !token) return;
    preview.replaceChildren();
    const request = start(matchForm);
    status.textContent = "Retrieving game…";
    try {
      const result = await companionRequest("/match", token, { gameId: gameId.value.trim() }, request.signal);
      if (!request.current()) return;
      const index = await getChampionIndex().catch(() => null);
      if (!request.current()) return;
      const champions = new Map((index?.champions ?? []).map(row => [Number(row.key), row]));
      renderPreview(preview, result, champions);
      status.textContent = "Match retrieved for preview.";
    } catch (error) {
      if (!request.current()) return;
      preview.replaceChildren();
      if (error.status === 401) reset("Pairing expired. Restart the companion to get a new code.");
      else status.textContent = error.status ? error.message : unavailable;
    } finally {
      request.finish();
    }
  });
  document.getElementById("lcu-disconnect").addEventListener("click", () => reset());
  window.addEventListener("pagehide", () => reset());
  return reset;
}
