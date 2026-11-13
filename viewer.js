"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $("graph"), stage = $("stage"), viewport = $("graph-viewport"), context = canvas.getContext("2d");
  const visibleCountryChooser = EgdCountries.setup($("visible-countries"), $("visible-countries-toggle"), $("visible-countries-options"), $("visible-countries-current"), $("visible-countries-box"), $("visible-countries-clear"));
  const {validateSnapshot, selectGraph, rankValue, searchPlayers, sameCountryBand, sameCountryBands, gamesBand, gamesBands} = EgdGraph;
  let snapshot, countryIndices = new Map(), model, nodes = [], links = [], nodeMap = new Map();
  let width = 1, height = 1, scale = 1, panX = 0, panY = 0, selected = null, hovered = null;
  let gesture = null, paused = matchMedia("(prefers-reduced-motion: reduce)").matches, ticks = 0, lastTick = 0, dirty = true, loadId = 0;
  let suggestions = [], activeSuggestion = -1, appliedColour = null;
  let repulsion = 1, gameAttraction = 1, highlightedCountry = "";
  let profileImageUrl = null, profileImageRequest = 0, touchPoints = new Map(), pinch = null;
  let dataSource = null, allModel = null, rebuildId = 0, building = false;
  let positions = Object.create(null), focusPin = "", pathPins = [], currentPath = null, revealCandidate = null;
  let layoutWorker = null, layoutVersion = 0, layoutPending = false;
  const settler = EgdLayout.createSettler();
  const mobileFilters = matchMedia("(max-width: 900px)");
  let drawerReturnFocus = null;
  for (const id of ["min-rank", "max-rank"]) {
    for (const grade of [...Array.from({length: 30}, (_, i) => `${30 - i}k`),
      ...Array.from({length: 9}, (_, i) => `${i + 1}d`), ...Array.from({length: 9}, (_, i) => `${i + 1}p`)]) {
      $(id).add(new Option(grade, String(rankValue(grade))));
    }
  }

  function setRepulsion(value, resume = false) {
    repulsion = value;
    $("repulsion").value = String(value);
    $("repulsion-value").textContent = `${value}×`;
    if (resume && snapshot) pause(false);
  }

  function setGameAttraction(value, resume = false) {
    gameAttraction = value;
    $("game-attraction").value = String(value);
    $("game-attraction-value").textContent = `${value}×`;
    if (resume && snapshot) pause(false);
  }
  function status(message, error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
  }
  function setFilterDrawer(open, restoreFocus = true) {
    const wasOpen = document.body.classList.contains("filters-open");
    open = open && mobileFilters.matches;
    if (open && !wasOpen) drawerReturnFocus = document.activeElement;
    document.body.classList.toggle("filters-open", open);
    $("filters-toggle").setAttribute("aria-expanded", String(open));
    $("filters-backdrop").hidden = !open;
    $("filters-panel").inert = mobileFilters.matches && !open;
    if (open) {
      $("filters-panel").setAttribute("role", "dialog");
      $("filters-panel").setAttribute("aria-modal", "true");
      $("filters-close").focus({preventScroll: true});
    } else {
      $("filters-panel").removeAttribute("role");
      $("filters-panel").removeAttribute("aria-modal");
      if (wasOpen && restoreFocus && mobileFilters.matches) (drawerReturnFocus || $("filters-toggle")).focus({preventScroll: true});
    }
  }
  function renderCounts(players, connections, games) {
    $("counts").replaceChildren(...[[players, "Players"], [connections, "Connections"], [games, "Games"]].map(([value, label]) => {
      const item = document.createElement("div"), number = document.createElement("strong"), caption = document.createElement("span");
      item.className = "network-stat"; number.textContent = value.toLocaleString(); caption.textContent = label;
      item.append(number, caption); return item;
    }));
    $("counts").setAttribute("aria-label", `${players.toLocaleString()} visible players, ${connections.toLocaleString()} connections, ${games.toLocaleString()} games`);
  }
  function resetFilters() {
    if (!snapshot) return;
    $("start").value = $("end").value = $("min-rank").value = $("max-rank").value = "";
    $("limit").value = "15000"; $("minimum").value = "1";
    for (const option of $("visible-countries").options) option.selected = option.value === "";
    visibleCountryChooser.refresh(); highlightedCountry = ""; focusPin = ""; pathPins = [];
    rebuild({fitView: true});
  }
  function renderActiveFilters() {
    const chips = [], countries = visibleCountries();
    const clear = (...ids) => { for (const id of ids) $(id).value = ""; };
    if (countries.length) chips.push([countries.length === 1 ? EgdCountries.countryName(countries[0]) : `${countries.length} countries`, () => {
      for (const option of $("visible-countries").options) option.selected = option.value === "";
      visibleCountryChooser.refresh();
    }]);
    const start = $("start").value, end = $("end").value;
    if (start || end) chips.push([start && end ? `${start} → ${end}` : start ? `Since ${start}` : `Until ${end}`, () => clear("start", "end")]);
    if ($("min-rank").value || $("max-rank").value) {
      const min = $("min-rank").value ? $("min-rank").selectedOptions[0].textContent : "Any";
      const max = $("max-rank").value ? $("max-rank").selectedOptions[0].textContent : "Any";
      chips.push([`Rank: ${min} to ${max}`, () => clear("min-rank", "max-rank")]);
    }
    if (Number($("minimum").value) > 1) chips.push([`${$("minimum").value}+ shared games`, () => { $("minimum").value = "1"; }]);
    if (Number($("limit").value) !== 15000) chips.push([`Top ${Number($("limit").value).toLocaleString()} players`, () => { $("limit").value = "15000"; }]);
    if (highlightedCountry) chips.push([`${EgdCountries.countryName(highlightedCountry)} highlighted`, () => { highlightedCountry = ""; }]);
    $("active-filters").replaceChildren(...chips.map(([label, remove]) => {
      const button = document.createElement("button"), cross = document.createElement("span");
      button.type = "button"; button.className = "filter-chip"; button.setAttribute("aria-label", `Remove filter: ${label}`);
      cross.textContent = "×"; cross.setAttribute("aria-hidden", "true"); button.append(document.createTextNode(label), cross);
      button.addEventListener("click", () => { remove(); rebuild(); }); return button;
    }));
    $("active-filters").hidden = !chips.length;
    $("filter-count").textContent = String(chips.length); $("filter-count").hidden = !chips.length;
    $("reset-filters").disabled = !snapshot || (!chips.length && !focusPin && !pathPins.length);
  }
  function filterFailure(message, ids) {
    $("filter-error").textContent = message; $("filter-error").hidden = false;
    $("advanced-filters").open = true;
    $("reset-filters").disabled = false;
    for (const id of ids) { $(id).setAttribute("aria-invalid", "true"); $(id).setAttribute("aria-describedby", "filter-error"); }
    status(message, true);
  }
  EgdFullscreen.setup(stage, $("fullscreen"), canvas, message => status(message, true));
  const hoverHighlight = EgdHover.create({
    canHighlight: (node, point) => !gesture && $("hover-highlight").checked && hit(point.x, point.y) === node,
    onHighlight: (node, point) => {
      hovered = node;
      if (node) tooltip(node, point.x, point.y);
      else $("tooltip").hidden = true;
      dirty = true;
    }
  });
  function pause(value) {
    paused = value;
    if (!value) { ticks = 0; settler.reset(); }
    syncLayout();
    $("pause").textContent = value ? "Resume" : "Pause";
    $("pause").setAttribute("aria-pressed", String(value));
    $("layout-state").classList.toggle("is-paused", value);
    $("layout-state").textContent = value ? "Layout paused" : "Layout settling";
  }
  function defaultDateRange() {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);
    return {start: localDate(start), end: localDate(end)};
  }
  async function install(data) {
    dataSource?.dispose();
    dataSource = EgdData.createSource(data);
    const source = dataSource;
    allModel = null;
    model = null;
    ++rebuildId;
    nodes = []; links = []; nodeMap.clear();
    dirty = true;
    $("graph-loading").hidden = false;
    stage.classList.remove("has-selection"); $("player-panel").hidden = true;
    positions = Object.assign(Object.create(null), data.layout?.positions);
    focusPin = data.layout?.focusPin || ""; pathPins = data.layout?.pathPins || [];
    currentPath = null; revealCandidate = null;
    $("reveal-player").hidden = true;
    snapshot = data;
    $("save-view").disabled = $("find-path").disabled = true;
    $("export-png").disabled = $("export-svg").disabled = $("export-gexf").disabled = true;
    const countries = [...new Set(data.games.flatMap(game => [game.first.country, game.second.country]))].sort();
    countryIndices = new Map(countries.filter(c => c && c !== "??").map((country, i) => [country, i]));
    $("hide-overlapping-names").checked = data.layout?.hideOverlappingNames ?? true;
    $("colour-blind-friendly").checked = data.layout?.colourBlindFriendly ?? false;
    $("hover-highlight").checked = data.layout?.hoverHighlight ?? true;
    setRepulsion(data.layout?.repulsion ?? 1);
    setGameAttraction(data.layout?.gameAttraction ?? 1);
    highlightedCountry = data.layout?.country ?? "";
    $("visible-countries").replaceChildren(new Option("All countries", ""), ...countries.map(c => new Option(c || "Unknown", c || "__unknown__")));
    $("visible-countries").options[0].selected = true;
    $("player-search").value = "";
    if (data.layout) {
      const layout = data.layout;
      if (![...$("limit").options].some(option => Number(option.value) === layout.maxPlayers)) {
        $("limit").add(new Option(String(layout.maxPlayers), String(layout.maxPlayers)));
      }
      $("limit").value = String(layout.maxPlayers);
      $("minimum").value = String(layout.minGames);
      highlightedCountry = layout.country;
      $("start").value = layout.start;
      $("end").value = layout.end;
      $("colour").value = layout.colour; $("names").checked = layout.names;
      for (const option of $("visible-countries").options) option.selected = option.value
        ? (layout.visibleCountries || []).includes(option.value) : !layout.visibleCountries?.length;
      pause(true);
    } else {
      const range = defaultDateRange();
      $("start").value = range.start; $("end").value = range.end;
      $("limit").value = "15000"; $("minimum").value = "1";
      $("colour").value = "country"; $("names").checked = false;
      pause(matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    $("min-rank").value = String(data.layout?.minRank ?? "");
    $("max-rank").value = String(data.layout?.maxRank ?? "");
    selected = data.layout?.selectedPin || null;
    visibleCountryChooser.refresh();
    let firstDate = "", lastDate = "";
    for (const game of data.games) if (game.date) {
      if (!firstDate || game.date < firstDate) firstDate = game.date;
      if (!lastDate || game.date > lastDate) lastDate = game.date;
    }
    const incomplete = /incomplete/i.test(data.description);
    const dateLabel = value => new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"}).format(new Date(value + "T00:00:00Z"));
    $("dataset-summary").textContent = `${data.games.length.toLocaleString()} games${firstDate ? ` · ${dateLabel(firstDate)} — ${dateLabel(lastDate)}` : ""}${incomplete ? " · INCOMPLETE dataset" : ""}`;
    $("dataset-summary").classList.toggle("error", incomplete);
    $("snapshot-badge").textContent = firstDate ? `${firstDate.slice(0, 4)} — ${lastDate.slice(0, 4)}` : "EGD snapshot";
    status("Preparing player search and graph…");
    const fullModel = await source.getModel();
    if (source !== dataSource || !fullModel) return false;
    allModel = fullModel;
    $("path-from").value = pathPins[0] ? playerLabel(pathPins[0]) : "";
    $("path-to").value = pathPins[1] ? playerLabel(pathPins[1]) : "";
    await rebuild({fitView: true});
    if (source !== dataSource) return false;
    if (data.layout?.viewport) {
      ({scale, panX, panY} = data.layout.viewport); dirty = true;
    }
    return true;
  }
  function rememberPositions() {
    for (const node of nodes) positions[node.pin] = [node.x, node.y];
  }
  async function rebuild({fitView = false} = {}) {
    if (!snapshot) return;
    const request = ++rebuildId, source = dataSource;
    $("filter-error").hidden = true;
    for (const id of ["start", "end", "minimum", "min-rank", "max-rank"]) { $(id).removeAttribute("aria-invalid"); $(id).removeAttribute("aria-describedby"); }
    renderActiveFilters();
    building = false; stage.setAttribute("aria-busy", "false");
    $("save-view").disabled = !snapshot; $("find-path").disabled = !model;
    const start = $("start").value, end = $("end").value;
    if (start && end && start > end) { filterFailure("The start date must be on or before the end date.", ["start", "end"]); return; }
    const minimum = Number($("minimum").value);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100000) { filterFailure("Shared games must be a whole number from 1 to 100000.", ["minimum"]); return; }
    const minRank = Number($("min-rank").value), maxRank = Number($("max-rank").value);
    if (minRank && maxRank && minRank > maxRank) { filterFailure("Lowest rank must be no stronger than highest rank.", ["min-rank", "max-rank"]); return; }
    building = true;
    stage.setAttribute("aria-busy", "true");
    $("save-view").disabled = true;
    $("find-path").disabled = true;
    status("Updating graph…");
    try {
      const nextModel = await source.getModel(start, end);
      if (request !== rebuildId || source !== dataSource || !nextModel) return;
      model = nextModel;
      rememberPositions();
      let graph = selectGraph(model, Number($("limit").value), minimum, visibleCountries(), {minRank, maxRank, focusPin});
      currentPath = pathPins.length ? EgdGraph.shortestPath(graph.links, ...pathPins) : null;
      if (currentPath) {
        const pins = new Set(currentPath), edges = new Set(currentPath.slice(1).map((pin, i) => JSON.stringify([currentPath[i], pin].sort())));
        graph = {players: graph.players.filter(player => pins.has(player.pin)),
          links: graph.links.filter(link => edges.has(JSON.stringify([link.a, link.b].sort())))};
      }
      const hadNodes = nodes.length > 0;
      nodes = EgdLayout.createNodes(graph.players, positions);
      for (const node of nodes) node.fill = colour(node);
      appliedColour = colourSettings();
      nodeMap = new Map(nodes.map(node => [node.pin, node]));
      links = graph.links.map(link => ({a: nodeMap.get(link.a), b: nodeMap.get(link.b), games: link.games}));
      if (!nodeMap.has(selected)) selected = null;
      gesture = null; hoverHighlight.clear();
      $("tooltip").hidden = true;
      ticks = 0;
      settler.reset(); syncLayout();
      const displayedGames = links.reduce((total, link) => total + link.games, 0);
      renderCounts(nodes.length, links.length, displayedGames);
      $("empty").hidden = nodes.length > 0;
      $("export-png").disabled = $("export-svg").disabled = $("export-gexf").disabled = !nodes.length;
      status(`${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`);
      $("layout-state").textContent = nodes.length ? (paused ? (snapshot.layout ? "Saved layout · paused" : "Layout paused") : "Layout settling") : "No visible connections";
      $("layout-state").classList.toggle("is-paused", paused || !nodes.length);
      if (fitView || !hadNodes) fit();
      renderLegend(); renderPlayerOptions(); renderDetails(); renderExploration();
      updateCountryHighlight();
    } catch (error) {
      if (request === rebuildId) status("Could not update the graph: " + error.message, true);
    } finally {
      if (request === rebuildId) {
        building = false; stage.setAttribute("aria-busy", "false");
        $("graph-loading").hidden = true;
        $("save-view").disabled = !snapshot; $("find-path").disabled = !model;
      }
    }
  }
  function matchesCountry(node) {
    const country = highlightedCountry;
    return !country || node.country === (country === "__unknown__" ? "" : country);
  }
  function visibleCountries() {
    return [...$("visible-countries").selectedOptions].map(option => option.value).filter(Boolean);
  }
  function updateCountryHighlight() {
    const country = highlightedCountry;
    const activeFilters = Number(Boolean($("start").value || $("end").value))
      + Number(Number($("limit").value) !== 15000) + Number(Number($("minimum").value) > 1)
      + Number(Boolean($("min-rank").value || $("max-rank").value));
    $("advanced-filters-summary").textContent = `Dates, ranks & connections${activeFilters ? ` (${activeFilters})` : ""}`;
    $("graph-title").textContent = country ? `${EgdCountries.countryName(country)} highlighted` : activeFilters || visibleCountries().length ? "Filtered network" : "All players";
    if (model) {
      status(country ? `${nodes.filter(matchesCountry).length.toLocaleString()} visible players from ${country === "__unknown__" ? "an unknown country" : country} highlighted.`
        : `${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`);
    }
    renderActiveFilters(); renderLegend(); dirty = true;
  }
  function colour(node) {
    if ($("colour").value === "country") return EgdColours.countryColour(countryIndices.get(node.country), $("colour-blind-friendly").checked);
    if ($("colour").value === "same-country") return bandColour(sameCountryBand(node.sameCountryPercent), sameCountryBands);
    if ($("colour").value === "games") return bandColour(gamesBand(node.games), gamesBands);
    if ($("colour").value === "rank-change") return EgdColours.rankChangeColour(node.rankChange, $("colour-blind-friendly").checked);
    const rank = rankValue(node.grade);
    if (rank === null) return "#9ca3af";
    if ($("colour-blind-friendly").checked) return EgdColours.sequentialColour((rank - 1) / 48);
    if (rank > 40) return `hsl(${310 - (rank - 41) * 5} 85% 75%)`;
    return `hsl(${220 - (rank - 1) / 38 * 220} 82% 65%)`;
  }
  function bandColour(band, bands) {
    if (!band) return "#9ca3af";
    return $("colour-blind-friendly").checked ? EgdColours.sequentialColour(bands.indexOf(band) / (bands.length - 1)) : band.colour;
  }
  function colourSettings() { return `${$("colour").value}:${$("colour-blind-friendly").checked}`; }
  function updateColours() {
    if (appliedColour === colourSettings()) return;
    for (const node of nodes) node.fill = colour(node);
    appliedColour = colourSettings();
    renderLegend();
    renderDetails();
    draw();
    dirty = false;
  }
  function renderLegend() {
    const rankMode = $("colour").value === "rank";
    const sameCountryMode = $("colour").value === "same-country";
    const gamesMode = $("colour").value === "games";
    const rankChangeMode = $("colour").value === "rank-change";
    const countryMode = $("colour").value === "country";
    let entries;
    if (rankChangeMode) {
      entries = [["↑ Improved", 1], ["→ No change", 0], ["↓ Declined", -1], ["Unavailable", null]]
        .map(([label, change]) => [label, EgdColours.rankChangeColour(change, $("colour-blind-friendly").checked)]);
    } else if (sameCountryMode) {
      entries = sameCountryBands.map(band => [band.label, bandColour(band, sameCountryBands)]);
      if (nodes.some(node => node.sameCountryPercent === null)) entries.push(["Unknown country", "#9ca3af"]);
    } else if (gamesMode) {
      entries = gamesBands.map(band => [band.label, bandColour(band, gamesBands)]);
    } else {
      const values = new Map(nodes.map(node => [rankMode ? node.grade : node.country, colour(node)]));
      entries = [...values].sort(([a], [b]) => rankMode ? (rankValue(a) ?? 100) - (rankValue(b) ?? 100) || a.localeCompare(b)
        : EgdCountries.countryName(a).localeCompare(EgdCountries.countryName(b)) || a.localeCompare(b));
    }
    $("legend").replaceChildren();
    for (const [label, fill] of entries) {
      const item = document.createElement(countryMode ? "button" : "span"), swatch = document.createElement("i");
      item.className = "legend-item";
      if (countryMode) {
        const code = label || "__unknown__", active = highlightedCountry === code;
        item.type = "button"; item.dataset.country = code;
        item.setAttribute("aria-pressed", String(active));
        item.title = `${active ? "Clear" : "Highlight"} ${EgdCountries.countryName(label)}${label ? ` (${label})` : ""}`;
        if (highlightedCountry && !active) item.classList.add("dim");
        item.addEventListener("click", () => {
          highlightedCountry = highlightedCountry === code ? "" : code;
          updateCountryHighlight();
          [...$("legend").children].find(entry => entry.dataset.country === code)?.focus({preventScroll: true});
        });
      }
      swatch.className = "swatch"; swatch.style.background = fill;
      const name = document.createElement("span"); name.className = "legend-name";
      name.textContent = countryMode ? EgdCountries.countryName(label) : label || "Unknown";
      item.append(swatch, name);
      $("legend").append(item);
    }
    if (!entries.length) $("legend").textContent = "No visible players";
  }
  function renderPlayerOptions() {
    const query = $("player-search").value.trim();
    const matches = query ? searchPlayers(allModel?.players || nodes, query) : [];
    if ($("player-select").closest("details").open) {
      const visible = searchPlayers(nodes, query);
      $("player-select").replaceChildren(new Option(visible.length ? "Select a player…" : "No matching visible players", ""),
        ...visible.map(node => new Option(`${node.name} · ${node.grade || "?"} · ${node.country || "?"}`, node.pin)));
      $("player-select").value = nodeMap.has(selected) ? selected : "";
    }
    renderSuggestions(matches, query);
  }
  function hideSuggestions() {
    $("search-results").hidden = true;
    $("player-search").setAttribute("aria-expanded", "false");
    $("player-search").removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
  }
  function renderSuggestions(matches, query) {
    suggestions = matches.slice(0, 12); activeSuggestion = -1;
    $("player-suggestions").replaceChildren();
    $("player-search").removeAttribute("aria-activedescendant");
    if (!query || document.activeElement !== $("player-search")) { hideSuggestions(); return; }
    for (const [index, node] of suggestions.entries()) {
      const option = document.createElement("li"), meta = document.createElement("small");
      option.id = `player-suggestion-${index}`; option.setAttribute("role", "option"); option.setAttribute("aria-selected", "false");
      option.append(document.createTextNode(node.name));
      meta.textContent = `${node.country || "Unknown"} · ${node.grade || "Unknown rank"} · PIN ${node.pin}${nodeMap.has(node.pin) ? "" : " · Hidden by current filters"}`;
      option.append(meta);
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => selectSuggestion(index));
      $("player-suggestions").append(option);
    }
    $("search-feedback").textContent = matches.length ? (matches.length > 12 ? `Showing 12 of ${matches.length.toLocaleString()} matches. Keep typing to narrow the list.`
      : `${matches.length} matching ${matches.length === 1 ? "player" : "players"}`) : "No matching players in this dataset.";
    $("search-results").hidden = false;
    $("player-search").setAttribute("aria-expanded", "true");
  }
  function selectSuggestion(index) {
    const node = suggestions[index]; if (!node) return;
    $("player-search").value = node.name;
    if (nodeMap.has(node.pin)) { $("reveal-player").hidden = true; centrePlayer(node.pin); }
    else {
      revealCandidate = node.pin;
      $("reveal-description").textContent = `${node.name} is hidden by the current view. Reveal them by clearing date, country, rank, connection and exploration filters.`;
      $("reveal-player").hidden = false;
    }
    hideSuggestions();
  }
  function centrePlayer(pin) {
    choose(pin);
    const node = nodeMap.get(pin);
    if (!node) return;
    scale = Math.max(scale, 1); panX = -node.x * scale; panY = -node.y * scale; dirty = true;
  }
  async function revealPlayer(pin) {
    const player = EgdSharing.findPlayer(allModel?.players || [], pin);
    if (!player) { status(`Player PIN ${pin} is not in this dataset.`, true); return; }
    $("start").value = $("end").value = $("min-rank").value = $("max-rank").value = "";
    $("limit").value = "15000"; $("minimum").value = "1";
    for (const option of $("visible-countries").options) option.selected = option.value === "";
    visibleCountryChooser.refresh();
    focusPin = ""; pathPins = []; highlightedCountry = "";
    await rebuild({fitView: true});
    if (!nodeMap.has(player.pin)) {
      // Very large snapshots can exceed the display cap. Use this player's local
      // neighbourhood so even a low-activity player can be revealed.
      focusPin = player.pin;
      await rebuild({fitView: true});
    }
    if (!nodeMap.has(player.pin)) { status(`${player.name} has no opponent connection in this dataset.`, true); return; }
    $("reveal-player").hidden = true; revealCandidate = null;
    $("player-search").value = player.name; centrePlayer(player.pin);
    status(`Revealed ${player.name}. Filters were cleared.`);
  }
  function playerLabel(pin) {
    const player = allModel?.players.find(player => player.pin === pin);
    return player ? `${player.name} · ${player.pin}` : pin;
  }
  function resolvePathPlayer(value) {
    const text = value.trim(), pin = /(?:^| · )(\d+)$/.exec(text)?.[1];
    if (pin) return EgdSharing.findPlayer(allModel?.players || [], pin);
    const exact = (allModel?.players || []).filter(player => player.name.toLocaleLowerCase() === text.toLocaleLowerCase());
    return exact.length === 1 ? exact[0] : null;
  }
  function renderExploration() {
    $("exploration-view").hidden = !focusPin && !pathPins.length;
    $("exploration-description").textContent = focusPin ? `Player and opponents: ${playerLabel(focusPin)}`
      : currentPath ? `Shortest path · ${currentPath.length - 1} connections` : "No path within the current filters · showing filtered graph";
    $("path-result").replaceChildren();
    if (pathPins.length) {
      $("path-tools").open = true;
      $("path-status").textContent = currentPath ? `${currentPath.length - 1} opponent connections (fewest possible within these filters).`
        : "No path found. Both players must have a visible connection; try clearing filters or increasing the player limit.";
      for (const pin of currentPath || []) {
        const item = document.createElement("li"), button = document.createElement("button");
        button.type = "button"; button.textContent = playerLabel(pin);
        button.addEventListener("click", () => centrePlayer(pin)); item.append(button); $("path-result").append(item);
      }
    } else $("path-status").textContent = "";
  }
  function choose(pin) {
    hoverHighlight.clear();
    selected = nodeMap.has(pin) ? pin : null;
    renderPlayerOptions(); renderDetails(); dirty = true;
    $("player-panel").scrollTop = 0;
    if (selected && matchMedia("(max-width: 650px)").matches) stage.scrollIntoView({block: "start"});
  }
  function sameCountrySummary(node) {
    return node.sameCountryPercent === null ? "Same-country share unavailable (unknown country)"
      : `${node.sameCountryPercent.toFixed(1)}% against same-country players (${node.sameCountryGames}/${node.games} games)`;
  }
  async function makeProfileImage(node) {
    const card = EgdProfileImage.createCard(nodes, links, node.pin);
    const image = document.createElement("canvas"); image.width = image.height = card.size;
    EgdProfileImage.render(image.getContext("2d"), card);
    return new Promise((resolve, reject) => image.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png"));
  }
  function renderDetails() {
    profileImageRequest++;
    if (profileImageUrl) { URL.revokeObjectURL(profileImageUrl); profileImageUrl = null; }
    const box = $("player-details"); box.replaceChildren();
    const node = nodeMap.get(selected);
    $("player-panel").hidden = !node;
    stage.classList.toggle("has-selection", Boolean(node));
    $("fit").textContent = node ? "Fit player" : "Fit graph";
    $("fit").title = node ? "Fit this player and their visible opponents (Home)" : "Fit all visible players (Home)";
    if (!node) return;
    const heading = document.createElement("h2"), info = document.createElement("p"), profile = document.createElement("a");
    heading.textContent = node.name;
    info.className = "player-meta";
    const flag = document.createElement("img"); flag.src = EgdCountries.flagPath(node.country); flag.alt = "";
    info.append(flag, document.createTextNode(`${EgdCountries.countryName(node.country)} · ${node.grade || "Unknown rank"} · ${node.pin}`));
    const opponents = links.filter(link => link.a === node || link.b === node).map(link =>
      ({node: link.a === node ? link.b : link.a, games: link.games})).sort((a, b) => b.games - a.games || a.node.name.localeCompare(b.node.name));
    const metrics = document.createElement("div"); metrics.className = "player-metrics";
    for (const [value, label] of [[node.games, "Games in selected dates"], [opponents.length, "Visible opponents"]]) {
      const item = document.createElement("div"), number = document.createElement("strong"), caption = document.createElement("span");
      number.textContent = value.toLocaleString(); caption.textContent = label; item.append(number, caption); metrics.append(item);
    }
    const insight = document.createElement("p"); insight.className = "fine-print";
    insight.textContent = sameCountrySummary(node);
    if ($("colour").value === "rank-change") insight.textContent += ` · ${rankChangeSummary(node)}`;
    profile.textContent = "EGD profile ↗";
    profile.href = EgdSharing.egdProfileUrl(node.pin);
    profile.target = "_blank"; profile.rel = "noopener noreferrer";
    const share = document.createElement("button"), shareStatus = document.createElement("p"), shareUrl = document.createElement("input");
    share.type = "button"; share.className = "share-profile"; share.textContent = "Share profile";
    shareStatus.className = "fine-print"; shareStatus.setAttribute("role", "status"); shareStatus.hidden = true;
    shareUrl.type = "text"; shareUrl.readOnly = true; shareUrl.hidden = true;
    shareUrl.setAttribute("aria-label", "Player profile URL");
    share.addEventListener("click", async () => {
      share.disabled = true;
      try {
        const result = await EgdSharing.shareProfile(location.href, node, navigator);
        shareUrl.hidden = result.method !== "manual";
        shareStatus.textContent = result.method === "copied" ? "Profile link copied." : result.method === "shared" ? "Profile link shared."
          : result.method === "manual" ? "Copy this profile link:" : "";
        shareStatus.hidden = !shareStatus.textContent;
        if (result.method === "manual") { shareUrl.value = result.url; shareUrl.focus(); shareUrl.select(); }
      } catch (error) { shareStatus.textContent = "Could not share profile: " + error.message; shareStatus.hidden = false; }
      finally { share.disabled = false; }
    });
    const imageTools = document.createElement("div"), generate = document.createElement("button"), imagePreview = document.createElement("img");
    const imageStatus = document.createElement("p"), imageActions = document.createElement("div");
    const downloadImage = document.createElement("button"), shareImage = document.createElement("button");
    let imageBlob = null;
    imageTools.className = "profile-image-tools";
    generate.type = "button"; generate.className = "generate-profile-image";
    const imageIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    imageIcon.setAttribute("viewBox", "0 0 24 24"); imageIcon.setAttribute("aria-hidden", "true");
    imageIcon.setAttribute("fill", "none"); imageIcon.setAttribute("stroke", "currentColor"); imageIcon.setAttribute("stroke-width", "1.8");
    const imagePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    imagePath.setAttribute("d", "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M3 17l6-6 5 5 3-3 4 4 M9 7h.01");
    imagePath.setAttribute("stroke-linecap", "round"); imagePath.setAttribute("stroke-linejoin", "round");
    imageIcon.append(imagePath);
    const generateLabel = document.createElement("span"); generateLabel.textContent = "Share Graph Image";
    generate.append(imageIcon, generateLabel);
    imagePreview.className = "profile-image-preview"; imagePreview.hidden = true;
    imagePreview.alt = `${node.name}'s highlighted graph`;
    imageStatus.className = "fine-print"; imageStatus.setAttribute("role", "status"); imageStatus.hidden = true;
    imageActions.className = "profile-image-actions"; imageActions.hidden = true;
    downloadImage.type = shareImage.type = "button";
    downloadImage.textContent = "Download PNG"; shareImage.textContent = "Share image";
    generate.addEventListener("click", async () => {
      const request = profileImageRequest;
      generate.disabled = true; imageStatus.hidden = false; imageStatus.textContent = "Generating your graph image…";
      try {
        const blob = await makeProfileImage(node);
        if (request !== profileImageRequest) return;
        imageBlob = blob;
        if (profileImageUrl) URL.revokeObjectURL(profileImageUrl);
        profileImageUrl = URL.createObjectURL(blob); imagePreview.src = profileImageUrl;
        imagePreview.hidden = imageActions.hidden = false;
        imageStatus.textContent = "Square image ready.";
      } catch (error) {imageStatus.textContent = "Could not generate image: " + error.message;}
      finally {generate.disabled = false;}
    });
    downloadImage.addEventListener("click", () => {if (imageBlob) downloadBlob(imageBlob, `european-go-${node.pin}.png`);});
    shareImage.addEventListener("click", async () => {
      if (!imageBlob) return;
      shareImage.disabled = true;
      try {
        const result = await EgdSharing.shareImage(imageBlob, node);
        imageStatus.hidden = false;
        if (result.method === "download") {
          downloadBlob(imageBlob, `european-go-${node.pin}.png`);
          imageStatus.textContent = "Image downloaded. Attach it in your favourite sharing app.";
        } else imageStatus.textContent = result.method === "shared" ? "Graph image shared." : "Image sharing cancelled.";
      } catch (error) {imageStatus.hidden = false; imageStatus.textContent = "Could not share image: " + error.message;}
      finally {shareImage.disabled = false;}
    });
    imageActions.append(downloadImage, shareImage);
    imageTools.append(generate, imagePreview, imageActions, imageStatus);
    const extra = document.createElement("details"), label = document.createElement("summary");
    label.textContent = `Opponents (${opponents.length.toLocaleString()})`;
    const explanation = document.createElement("p"); explanation.className = "fine-print";
    explanation.textContent = "Visible opponents · games played together";
    const list = document.createElement("ul"); list.className = "opponents";
    for (const opponent of opponents) {
      const item = document.createElement("li"), button = document.createElement("button"), count = document.createElement("span");
      button.type = "button"; button.textContent = opponent.node.name; button.addEventListener("click", () => choose(opponent.node.pin));
      count.textContent = `${opponent.games} ${opponent.games === 1 ? "game" : "games"}`;
      item.append(button, count); list.append(item);
    }
    extra.append(label, explanation, list);
    const explore = document.createElement("div"), isolate = document.createElement("button"), pathFrom = document.createElement("button"), pathTo = document.createElement("button");
    explore.className = "player-explore-actions";
    isolate.className = "primary";
    isolate.type = pathFrom.type = pathTo.type = "button";
    isolate.textContent = "Show player and opponents";
    isolate.addEventListener("click", () => {
      focusPin = node.pin; pathPins = []; rebuild({fitView: true});
    });
    pathFrom.textContent = "Start path here"; pathTo.textContent = "End path here";
    for (const [button, id] of [[pathFrom, "path-from"], [pathTo, "path-to"]]) button.addEventListener("click", () => {
      $("path-tools").open = true; $(id).value = playerLabel(node.pin); $(id).focus();
      $("path-tools").scrollIntoView({block: "nearest"});
    });
    explore.append(isolate, pathFrom, pathTo);
    const profileLinks = document.createElement("div"); profileLinks.className = "profile-links";
    profileLinks.append(share, profile);
    box.append(heading, info, metrics, explore, profileLinks, shareStatus, shareUrl, extra, insight, imageTools);
  }
  function fit() {
    hoverHighlight.clear();
    if (!nodes.length) { scale = 1; panX = panY = 0; dirty = true; return; }
    let fittedNodes = nodes;
    const player = nodeMap.get(selected);
    if (player) {
      const neighbours = new Set([player]);
      for (const link of links) {
        if (link.a === player) neighbours.add(link.b);
        if (link.b === player) neighbours.add(link.a);
      }
      fittedNodes = [...neighbours];
    }
    const minX = Math.min(...fittedNodes.map(n => n.x - 35)), maxX = Math.max(...fittedNodes.map(n => n.x + 35));
    const minY = Math.min(...fittedNodes.map(n => n.y - 35)), maxY = Math.max(...fittedNodes.map(n => n.y + 35));
    scale = Math.max(0.05, Math.min(2, Math.min(Math.max(80, width - 80) / (maxX - minX), Math.max(80, height - 100) / (maxY - minY))));
    panX = -(minX + maxX) / 2 * scale; panY = -(minY + maxY) / 2 * scale; dirty = true;
  }
  function rankChangeSummary(node) {
    if (!Number.isFinite(node.rankChange)) return "Rank change unavailable (needs two dated games and known endpoint ranks)";
    const change = node.rankChange > 0 ? "Improved" : node.rankChange < 0 ? "Declined" : "No recorded change";
    return `${change}: ${node.firstGrade} (${node.firstRankDate}) → ${node.grade} (${node.latestRankDate})`;
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    hoverHighlight.clear();
    const wx = (x - width / 2 - panX) / scale, wy = (y - height / 2 - panY) / scale;
    scale = Math.max(0.05, Math.min(8, scale * factor));
    panX = x - width / 2 - wx * scale; panY = y - height / 2 - wy * scale; dirty = true;
  }
  function position(event) { const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top}; }
  function hit(x, y) {
    const wx = (x - width / 2 - panX) / scale, wy = (y - height / 2 - panY) / scale;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (Math.hypot(node.x - wx, node.y - wy) <= Math.max(EgdRenderer.nodeRadius(node, highlightedCountry), 7 / scale)) return node;
    }
  }
  function tooltip(node, x, y) {
    const box = $("tooltip"); box.hidden = !node;
    if (!node) return;
    box.textContent = `${node.name}\n${node.country || "?"} · ${node.grade || "?"} · ${node.games} games\n${sameCountrySummary(node)}`;
    if ($("colour").value === "rank-change") box.textContent += `\n${rankChangeSummary(node)}`;
    const selectedNode = nodeMap.get(selected);
    if (selectedNode && selectedNode !== node) {
      const link = links.find(link => (link.a === selectedNode && link.b === node) || (link.b === selectedNode && link.a === node));
      if (link) box.textContent += `\n${link.games} shared with ${selectedNode.name}`;
    }
    box.style.left = Math.max(5, Math.min(width - box.offsetWidth - 8, x + 14)) + "px";
    box.style.top = Math.max(5, Math.min(height - box.offsetHeight - 8, y + 14)) + "px";
  }
  function step() {
    if (layoutWorker) {
      if (layoutPending) return;
      layoutPending = true;
      const node = gesture?.node;
      layoutWorker.postMessage({type: "step", version: layoutVersion, repulsion, gameAttraction,
        drag: node ? {pin: node.pin, x: node.x, y: node.y} : null});
    } else recordMovement(EgdLayout.step(nodes, links, gesture?.node, repulsion, gameAttraction));
  }
  function recordMovement(movement) {
    ticks++;
    if (settler.update(movement, Boolean(gesture))) {
      pause(true); $("layout-state").textContent = "Layout settled · Resume to continue";
    } else if (ticks >= 2400 && !gesture) {
      pause(true); $("layout-state").textContent = "Layout paused to save CPU · Resume to continue";
    }
    dirty = true;
  }
  function syncLayout() {
    layoutVersion++; layoutPending = false;
    layoutWorker?.postMessage({type: "init", version: layoutVersion, nodes,
      links: links.map(link => ({a: link.a.pin, b: link.b.pin, games: link.games}))});
  }
  try {
    layoutWorker = new Worker("graph-layout-worker.js?v=e2757a1f38e3");
    layoutWorker.onmessage = ({data}) => {
      if (data.version !== layoutVersion) return;
      layoutPending = false;
      if (paused || building) return;
      nodes.forEach((node, i) => {
        if (node === gesture?.node) return;
        [node.x, node.y, node.vx, node.vy] = data.positions.subarray(i * 4, i * 4 + 4);
      });
      recordMovement(data.movement);
    };
    layoutWorker.onerror = event => {
      event.preventDefault(); layoutWorker.terminate(); layoutWorker = null; layoutPending = false;
    };
  } catch { layoutWorker = null; }
  function graphView() {
    return {width, height, scale, panX, panY, nodes, links, focus: hovered || nodeMap.get(selected), selected,
      country: highlightedCountry, names: $("names").checked, hideOverlappingNames: $("hide-overlapping-names").checked};
  }
  function draw() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    EgdRenderer.render(context, graphView());
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), download = document.createElement("a");
    download.href = url; download.download = name;
    document.body.append(download); download.click(); download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportGraph(format) {
    if (!nodes.length) return;
    const button = $("export-" + format); button.disabled = true;
    try {
      let blob;
      if (format === "gexf") {
        blob = new Blob([EgdGephi.gexf(graphView(), snapshot.description)], {type: "application/gexf+xml;charset=utf-8"});
      } else if (format === "svg") {
        blob = new Blob([EgdRenderer.svg(graphView(), snapshot.description, context)], {type: "image/svg+xml;charset=utf-8"});
      } else {
        // Copy one frame before encoding, so a running simulation stays live.
        draw();
        const image = document.createElement("canvas"); image.width = canvas.width; image.height = canvas.height;
        const painter = image.getContext("2d"); EgdRenderer.paintBackground(painter, image.width, image.height);
        painter.drawImage(canvas, 0, 0);
        blob = await new Promise((resolve, reject) => image.toBlob(result => result ? resolve(result) : reject(new Error("PNG encoding failed.")), "image/png"));
      }
      downloadBlob(blob, "european-go-graph." + format);
      status(format === "gexf" ? "Exported the displayed graph. Open the GEXF file in Gephi." : `Exported the current graph view as ${format.toUpperCase()}.`);
    } catch (error) { status("Could not export graph: " + error.message, true); }
    finally { button.disabled = !nodes.length; }
  }
  function animate(time) {
    if (!paused && !building && nodes.length && time - lastTick >= 25) {
      step(); lastTick = time;
    }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(animate);
  }
  new ResizeObserver(() => {
    const nextWidth = viewport.clientWidth, nextHeight = viewport.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (width === nextWidth && height === nextHeight && canvas.width === Math.round(nextWidth * ratio) && canvas.height === Math.round(nextHeight * ratio)) return;
    width = nextWidth; height = nextHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); fit();
  }).observe(viewport);
  canvas.addEventListener("pointerdown", event => {
    const point = position(event);
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, point);
      if (touchPoints.size === 2) {
        const [first, second] = [...touchPoints.values()];
        pinch = {initialDistance: Math.hypot(second.x - first.x, second.y - first.y), startScale: scale, x: (first.x + second.x) / 2, y: (first.y + second.y) / 2};
        gesture = null;
        hoverHighlight.clear();
        canvas.style.cursor = "zoom-in";
        return;
      }
    }
    if (!event.isPrimary || (event.button !== 0 && event.button !== 2) || gesture) return;
    hoverHighlight.clear();
    if (event.button === 2) { event.preventDefault(); canvas.focus({preventScroll: true}); }
    canvas.setPointerCapture(event.pointerId);
    gesture = {...point, pointerId: event.pointerId, button: event.button, startX: point.x, startY: point.y,
      node: event.button === 2 ? null : hit(point.x, point.y), moved: false};
    $("tooltip").hidden = true; canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", event => {
    const point = position(event);
    if (event.pointerType === "touch") {
      if (touchPoints.has(event.pointerId)) touchPoints.set(event.pointerId, point);
      if (touchPoints.size >= 2 && pinch) {
        const [first, second] = [...touchPoints.values()];
        const midX = (first.x + second.x) / 2, midY = (first.y + second.y) / 2;
        const nextDistance = Math.hypot(second.x - first.x, second.y - first.y) || 1;
        const worldX = (midX - width / 2 - panX) / scale;
        const worldY = (midY - height / 2 - panY) / scale;
        const nextScale = Math.max(0.05, Math.min(8, pinch.startScale * (nextDistance / pinch.initialDistance)));
        scale = nextScale;
        panX = midX - width / 2 - worldX * scale;
        panY = midY - height / 2 - worldY * scale;
        dirty = true; canvas.style.cursor = "zoom-in"; return;
      }
    }
    if (gesture && event.pointerId !== gesture.pointerId) return;
    if (gesture) {
      if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > 4) gesture.moved = true;
      if (gesture.moved) {
        if (gesture.node) {
          gesture.node.x = (point.x - width / 2 - panX) / scale; gesture.node.y = (point.y - height / 2 - panY) / scale;
          gesture.node.vx = gesture.node.vy = 0; ticks = 0; settler.reset();
        } else { panX += point.x - gesture.x; panY += point.y - gesture.y; }
      }
      gesture.x = point.x; gesture.y = point.y; dirty = true;
    } else {
      const node = hit(point.x, point.y); canvas.style.cursor = node ? "pointer" : "grab";
      if ($("hover-highlight").checked && event.pointerType !== "touch") hoverHighlight.update(node, point);
      else hoverHighlight.clear();
    }
  });
  canvas.addEventListener("pointerup", event => {
    if (event.pointerType === "touch") touchPoints.delete(event.pointerId);
    if (touchPoints.size < 2) pinch = null;
    if (gesture && event.pointerId !== gesture.pointerId) return;
    if (gesture && gesture.button === 0 && !gesture.moved) choose(gesture.node ? gesture.node.pin : null);
    gesture = null; canvas.style.cursor = "grab";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", event => {
    if (event.pointerType === "touch") touchPoints.delete(event.pointerId);
    pinch = null; gesture = null; hoverHighlight.clear(); canvas.style.cursor = "grab";
  });
  canvas.addEventListener("lostpointercapture", () => { pinch = null; gesture = null; hoverHighlight.clear(); });
  canvas.addEventListener("pointerleave", () => hoverHighlight.clear());
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("dblclick", event => {
    if (event.button !== 0) return;
    const point = position(event), node = hit(point.x, point.y);
    if (node) window.open(EgdSharing.egdProfileUrl(node.pin), "_blank", "noopener,noreferrer");
  });
  canvas.addEventListener("wheel", event => { event.preventDefault(); const point = position(event); zoom(Math.exp(-event.deltaY * 0.0015), point.x, point.y); }, {passive: false});
  canvas.addEventListener("keydown", event => {
    if (["+", "=", "-", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); hoverHighlight.clear(); }
    if (event.key === "+" || event.key === "=") zoom(1.2);
    if (event.key === "-") zoom(1 / 1.2);
    if (event.key === "Home") fit();
    if (event.key === "Escape") choose(null);
    if (event.key === "ArrowUp") panY += 30;
    if (event.key === "ArrowDown") panY -= 30;
    if (event.key === "ArrowLeft") panX += 30;
    if (event.key === "ArrowRight") panX -= 30;
    dirty = true;
  });
  $("fit").addEventListener("click", fit);
  $("zoom-in").addEventListener("click", () => zoom(1.2));
  $("zoom-out").addEventListener("click", () => zoom(1 / 1.2));
  $("pause").addEventListener("click", () => pause(!paused));
  $("player-close").addEventListener("click", () => { choose(null); canvas.focus({preventScroll: true}); });
  $("filters-toggle").addEventListener("click", () => setFilterDrawer(true));
  for (const id of ["filters-close", "filters-done", "filters-backdrop"]) $(id).addEventListener("click", () => setFilterDrawer(false));
  for (const id of ["reset-filters", "empty-reset"]) $(id).addEventListener("click", resetFilters);
  mobileFilters.addEventListener("change", () => setFilterDrawer(false, false));
  document.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (document.body.classList.contains("filters-open")) {
      if (event.key === "Escape") { event.preventDefault(); setFilterDrawer(false); return; }
      if (event.key === "Tab") {
        const focusable = [...$("filters-panel").querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), summary, a[href]')]
          .filter(element => element.getClientRects().length > 0);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      event.preventDefault(); $("player-search").focus(); $("player-search").select();
    }
  });
  $("swap-path").addEventListener("click", () => {
    const from = $("path-from").value; $("path-from").value = $("path-to").value; $("path-to").value = from;
  });
  for (const menu of document.querySelectorAll(".action-menu")) {
    menu.addEventListener("click", event => { if (event.target.closest("button")) menu.open = false; });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.open = false; });
  }
  $("export-png").addEventListener("click", () => exportGraph("png"));
  $("export-svg").addEventListener("click", () => exportGraph("svg"));
  $("export-gexf").addEventListener("click", () => exportGraph("gexf"));
  for (const id of ["limit", "minimum", "start", "end", "min-rank", "max-rank"]) $(id).addEventListener("change", rebuild);
  $("visible-countries").addEventListener("change", rebuild);
  $("colour").addEventListener("input", updateColours);
  $("colour").addEventListener("change", updateColours);
  $("colour-blind-friendly").addEventListener("change", updateColours);
  $("names").addEventListener("change", () => { dirty = true; });
  $("hide-overlapping-names").addEventListener("change", () => { dirty = true; });
  $("hover-highlight").addEventListener("change", () => hoverHighlight.clear());
  $("repulsion").addEventListener("input", () => setRepulsion(Number($("repulsion").value), true));
  $("reset-repulsion").addEventListener("click", () => setRepulsion(1, true));
  $("game-attraction").addEventListener("input", () => setGameAttraction(Number($("game-attraction").value), true));
  $("reset-game-attraction").addEventListener("click", () => setGameAttraction(1, true));
  $("player-search").addEventListener("input", renderPlayerOptions);
  $("player-select").closest("details").addEventListener("toggle", renderPlayerOptions);
  $("reveal-player-button").addEventListener("click", () => {
    if (revealCandidate) revealPlayer(revealCandidate);
  });
  for (const id of ["path-from", "path-to"]) $(id).addEventListener("input", () => {
    const matches = searchPlayers(allModel?.players || [], $(id).value).slice(0, 20);
    $("path-players").replaceChildren(...matches.map(player => new Option(`${player.country || "?"} · ${player.grade || "?"}`, playerLabel(player.pin))));
  });
  $("path-form").addEventListener("submit", async event => {
    event.preventDefault();
    let from, to;
    try { from = resolvePathPlayer($("path-from").value); to = resolvePathPlayer($("path-to").value); }
    catch { /* Invalid PINs receive the same actionable message as ambiguous names. */ }
    if (!from || !to) {
      $("path-status").textContent = "Choose both players from the suggestions, enter their PINs, or use unique full names."; return;
    }
    $("path-from").value = playerLabel(from.pin); $("path-to").value = playerLabel(to.pin);
    focusPin = ""; selected = null; pathPins = [from.pin, to.pin];
    await rebuild({fitView: true});
  });
  $("clear-exploration").addEventListener("click", () => {
    focusPin = ""; pathPins = []; selected = null; rebuild({fitView: true});
  });
  $("open-view").addEventListener("click", () => $("view-file").click());
  $("view-file").addEventListener("change", async () => {
    const file = $("view-file").files[0];
    $("view-file").value = "";
    if (!file) return;
    const id = ++loadId;
    status(`Opening ${file.name}…`);
    try {
      // Validate before replacing the current dataset so malformed files keep the
      // active graph and its positions intact.
      const data = validateSnapshot(JSON.parse(await file.text()));
      if (id === loadId && await install(data) && id === loadId) status(`Opened ${file.name}. Saved dates and view settings restored.`);
    } catch (error) {
      if (id === loadId) status("Could not open this saved view: " + error.message, true);
    }
  });
  $("player-search").addEventListener("focus", renderPlayerOptions);
  $("player-search").addEventListener("blur", hideSuggestions);
  $("player-search").addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape") { hideSuggestions(); return; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length && $("player-search").value.trim()) {
      event.preventDefault();
      if ($("search-results").hidden) renderPlayerOptions();
      activeSuggestion = event.key === "ArrowDown" ? (activeSuggestion + 1) % suggestions.length
        : (activeSuggestion <= 0 ? suggestions.length : activeSuggestion) - 1;
      for (const [index, option] of [...$("player-suggestions").children].entries()) {
        option.classList.toggle("active", index === activeSuggestion); option.setAttribute("aria-selected", String(index === activeSuggestion));
      }
      const option = $("player-suggestions").children[activeSuggestion];
      $("player-search").setAttribute("aria-activedescendant", option.id); option.scrollIntoView({block: "nearest"});
    }
    if (event.key === "Enter" && !$("search-results").hidden && suggestions.length) {
      event.preventDefault(); selectSuggestion(activeSuggestion < 0 ? 0 : activeSuggestion);
    }
  });
  $("player-select").addEventListener("change", () => choose($("player-select").value));
  $("save-view").addEventListener("click", () => {
    if (!snapshot) return;
    try {
      rememberPositions();
      const saved = {...snapshot, layout: {version: 1, maxPlayers: Number($("limit").value), minGames: Number($("minimum").value),
        country: highlightedCountry, start: $("start").value, end: $("end").value, colour: $("colour").value, names: $("names").checked,
        hideOverlappingNames: $("hide-overlapping-names").checked, colourBlindFriendly: $("colour-blind-friendly").checked,
        hoverHighlight: $("hover-highlight").checked, repulsion, gameAttraction, visibleCountries: visibleCountries(), positions,
        minRank: Number($("min-rank").value) || "", maxRank: Number($("max-rank").value) || "",
        focusPin, selectedPin: selected || "", ...(pathPins.length ? {pathPins} : {}), viewport: {scale, panX, panY}}};
      validateSnapshot(saved);
      downloadBlob(new Blob([JSON.stringify(saved) + "\n"], {type: "application/json"}), "games.json");
      status("Saved games.json with your player positions and view settings. Open it to restore this view, or publish it as the website dataset.");
    } catch (error) { status("Could not save the view: " + error.message, true); }
  });
  async function openLinkedPlayer() {
    let pin;
    try { pin = EgdSharing.playerPin(location.href); }
    catch (error) { status("Cannot open the shared profile: " + error.message, true); return; }
    if (!pin) return;
    let node = EgdSharing.findPlayer(nodes, pin);
    if (!node) {
      const player = EgdSharing.findPlayer(allModel.players, pin);
      if (!player) { status(`Player PIN ${pin} is not in the published dataset.`, true); return; }
      await revealPlayer(player.pin);
      node = EgdSharing.findPlayer(nodes, pin);
      if (!node) { status(`Player PIN ${pin} has no visible connection in this dataset.`, true); return; }
    }
    highlightedCountry = ""; updateCountryHighlight();
    $("player-search").value = node.name;
    choose(node.pin);
    scale = Math.max(scale, 1); panX = -node.x * scale; panY = -node.y * scale;
    dirty = true;
    status(`Opened ${node.name} · PIN ${node.pin}.`);
  }
  async function loadPublished() {
    const id = ++loadId;
    status("Loading the published snapshot…");
    try {
      const data = await EgdData.loadSnapshot(document.body.dataset.snapshot || "data/games.json", document.body.dataset.snapshotCompressed);
      if (id === loadId && await install(data) && id === loadId) await openLinkedPlayer();
    } catch (error) {
      if (id === loadId) {
        $("graph-loading").hidden = true; stage.setAttribute("aria-busy", "false");
        status("Could not load the published snapshot. Serve the project folder over HTTP, or open a saved view. " + error.message, true);
        if (!snapshot) { $("dataset-summary").textContent = "Published snapshot unavailable"; renderCounts(0, 0, 0); $("empty").hidden = false; $("layout-state").textContent = "Waiting for data"; }
      }
    }
  }
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  setFilterDrawer(false, false); pause(paused); requestAnimationFrame(animate); loadPublished();
})();
