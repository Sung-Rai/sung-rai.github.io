const DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const CACHE_KEY = "keam_champions";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// True nicknames / shorthand only.
// Official names and punctuation/spacing variants are handled automatically.
const CHAMPION_ALIASES = {
  asol: "Aurelion Sol",
  gp: "Gangplank",
  j4: "Jarvan IV",
  k6: "Kha'Zix",
  lb: "LeBlanc",
  mf: "Miss Fortune",
  tk: "Tahm Kench",
  tf: "Twisted Fate",
  ww: "Warwick",
};
const CACHE_SCHEMA_VERSION = 2;
let championIndexPromise = null;

function normalizeSearch(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));

    if (!cached || !Array.isArray(cached.champions)) return null;
    if (cached.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (Date.now() - cached.savedAt > CACHE_TTL_MS) return null;

    return cached;
  } catch {
    return null;
  }
}

function writeCache(champions) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        schemaVersion: CACHE_SCHEMA_VERSION,
        savedAt: Date.now(),
        champions
      })
    );
  } catch {
    // Cache failure should not stop the app.
  }
}

function buildChampionIndex(champions) {
  const byKey = new Map();
  const aliases = [];

  const searchableChampions = champions.map(champion => {
    const normalizedName = normalizeSearch(champion.name);
    const normalizedId = normalizeSearch(champion.id);

    byKey.set(normalizedName, champion.name);
    byKey.set(normalizedId, champion.name);

    return {
      ...champion,
      normalizedName,
      normalizedId,
      searchText: [
        normalizedName,
        normalizedId,
        ...champion.name.split(/\s+/).map(normalizeSearch)
      ].join(" ")
    };
  });

  for (const [alias, championName] of Object.entries(CHAMPION_ALIASES)) {
    const normalizedAlias = normalizeSearch(alias);

    byKey.set(normalizedAlias, championName);

    aliases.push({
      alias,
      normalizedAlias,
      championName
    });
  }

  return {
    champions: searchableChampions,
    byKey,
    aliases
  };
}

async function fetchChampionIndex() {
  const cached = readCache();

  if (cached?.champions?.length) {
    return buildChampionIndex(cached.champions);
  }

  const versionResponse = await fetch(DDRAGON_VERSIONS_URL);

  if (!versionResponse.ok) {
    throw new Error("Could not load League patch versions.");
  }

  const versions = await versionResponse.json();
  const latestVersion = versions[0];

  const championResponse = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
  );

  if (!championResponse.ok) {
    throw new Error("Could not load champion list.");
  }

  const championJson = await championResponse.json();

  const champions = Object.values(championJson.data)
    .map(champion => ({
      id: champion.id,
      key: champion.key,
      name: champion.name,
      imageUrl: `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/champion/${champion.id}.png`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  writeCache(champions);

  return buildChampionIndex(champions);
}

export async function getChampionImageMap() {
  const championIndex = await getChampionIndex();

  return new Map(
    championIndex.champions.map(champion => [
      champion.name.toLowerCase(),
      champion.imageUrl
    ])
  );
}

export function getChampionIndex() {
  if (!championIndexPromise) {
    championIndexPromise = fetchChampionIndex();
  }

  return championIndexPromise;
}

export function searchChampions(query, championIndex, limit = 8) {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) return [];

  const results = new Map();

  function addResult(championName, score) {
    const champion = championIndex.champions.find(
      item => item.name === championName
    );

    if (!champion) return;

    const existing = results.get(champion.name);

    if (!existing || score < existing.score) {
      results.set(champion.name, {
        champion,
        score
      });
    }
  }

  const exactAliasMatch = championIndex.byKey.get(normalizedQuery);

  if (exactAliasMatch) {
    addResult(exactAliasMatch, 0);
  }

  for (const alias of championIndex.aliases) {
    if (alias.normalizedAlias.startsWith(normalizedQuery)) {
      addResult(alias.championName, 1);
    } else if (alias.normalizedAlias.includes(normalizedQuery)) {
      addResult(alias.championName, 4);
    }
  }

  for (const champion of championIndex.champions) {
    let score = null;

    if (champion.normalizedName === normalizedQuery) {
      score = 0;
    } else if (champion.normalizedId === normalizedQuery) {
      score = 0;
    } else if (champion.normalizedName.startsWith(normalizedQuery)) {
      score = 2;
    } else if (champion.normalizedId.startsWith(normalizedQuery)) {
      score = 2;
    } else if (champion.normalizedName.includes(normalizedQuery)) {
      score = 3;
    } else if (champion.normalizedId.includes(normalizedQuery)) {
      score = 3;
    } else if (champion.searchText.includes(normalizedQuery)) {
      score = 4;
    }

    if (score !== null) {
      addResult(champion.name, score);
    }
  }

  return [...results.values()]
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.champion.name.localeCompare(b.champion.name);
    })
    .slice(0, limit)
    .map(result => result.champion);
}

export function canonicalizeChampionName(value, championIndex) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) return null;

  const normalizedValue = normalizeSearch(rawValue);

  // Exact official name, official Data Dragon ID, or explicit alias.
  const exactMatch = championIndex.byKey.get(normalizedValue);

  if (exactMatch) {
    return exactMatch;
  }

  // Allow unique partial matches.
  // Examples:
  // "fortune" -> "Miss Fortune"
  // "gath" -> "Cho'Gath"
  // "zix" -> "Kha'Zix"
  const matches = searchChampions(rawValue, championIndex, 2);

  if (matches.length === 1) {
    return matches[0].name;
  }

  return null;
}

export function attachChampionAutocomplete(root, championIndex) {
  root.querySelectorAll("[data-champion-input]").forEach(input => {
    if (input.closest(".champion-autocomplete")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "champion-autocomplete";

    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const selectedIcon = document.createElement("img");
    selectedIcon.className = "champion-input-icon";
    selectedIcon.alt = "";
    selectedIcon.hidden = true;
    wrapper.appendChild(selectedIcon);

    function setSelectedIcon(championName) {
      const champion = championIndex.champions.find(item => {
        return item.name === championName;
      });

      if (champion?.imageUrl) {
        selectedIcon.src = champion.imageUrl;
        selectedIcon.hidden = false;
        wrapper.classList.add("has-champion-icon");
      } else {
        selectedIcon.removeAttribute("src");
        selectedIcon.hidden = true;
        wrapper.classList.remove("has-champion-icon");
      }
    }
    const menu = document.createElement("div");
    menu.className = "champion-autocomplete-menu";
    menu.hidden = true;
    wrapper.appendChild(menu);

    let activeIndex = -1;

    function getOptions() {
      return [...menu.querySelectorAll(".champion-autocomplete-option")];
    }

    function setActiveOption(index) {
      const options = getOptions();

      options.forEach(option => {
        option.classList.remove("active");
      });

      if (!options.length) {
        activeIndex = -1;
        return;
      }

      activeIndex = Math.max(0, Math.min(index, options.length - 1));
      options[activeIndex].classList.add("active");
      options[activeIndex].scrollIntoView({ block: "nearest" });
    }

    function chooseChampion(championName) {
      input.value = championName;
      input.setCustomValidity("");
      setSelectedIcon(championName);
      menu.hidden = true;
      activeIndex = -1;
    }

    function renderSuggestions() {
      const matches = searchChampions(input.value, championIndex);

      menu.innerHTML = "";
      activeIndex = -1;

      if (!input.value.trim() || matches.length === 0) {
        menu.hidden = true;
        return;
      }

      for (const champion of matches) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "champion-autocomplete-option";
        button.innerHTML = `
          ${
            champion.imageUrl
              ? `<img src="${escapeHtml(champion.imageUrl)}" alt="" class="champion-option-icon">`
              : ""
          }
          <span>${escapeHtml(champion.name)}</span>
        `;

        button.addEventListener("mousedown", event => {
          event.preventDefault();
          chooseChampion(champion.name);
        });

        menu.appendChild(button);
      }

      menu.hidden = false;
    }

    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", () => {
      input.setCustomValidity("");
      setSelectedIcon(null);
      renderSuggestions();
    });

    input.addEventListener("focus", renderSuggestions);

    input.addEventListener("keydown", event => {
      if (menu.hidden) return;

      const options = getOptions();

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveOption(activeIndex + 1);
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveOption(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
      }

      if (event.key === "Enter" && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        chooseChampion(options[activeIndex].textContent.trim());
      }

      if (event.key === "Escape") {
        menu.hidden = true;
        activeIndex = -1;
      }
    });

    input.addEventListener("blur", () => {
      const canonical = canonicalizeChampionName(input.value, championIndex);

      if (canonical) {
        input.value = canonical;
        input.setCustomValidity("");
        setSelectedIcon(canonical);
      } else if (input.value.trim()) {
        input.setCustomValidity("Enter a valid League of Legends champion.");
        setSelectedIcon(null);
      } else {
        input.setCustomValidity("");
        setSelectedIcon(null);
      }

      setTimeout(() => {
        menu.hidden = true;
        activeIndex = -1;
      }, 100);
    });
  });
}