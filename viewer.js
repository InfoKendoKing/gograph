"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $("graph"), stage = $("stage"), context = canvas.getContext("2d");
  const visibleCountryChooser = EgdCountries.setup($("visible-countries"), $("visible-countries-toggle"), $("visible-countries-options"), $("visible-countries-current"), $("visible-countries-box"), $("visible-countries-clear"));
  const {validateSnapshot, parseEgd, buildModel, selectGraph, rankValue, searchPlayers, sameCountryBand, sameCountryBands, gamesBand, gamesBands} = EgdGraph;
  let snapshot, countryIndices = new Map(), model, nodes = [], links = [], nodeMap = new Map();
  let width = 1, height = 1, scale = 1, panX = 0, panY = 0, selected = null, hovered = null;
  let gesture = null, paused = matchMedia("(prefers-reduced-motion: reduce)").matches, ticks = 0, lastTick = 0, dirty = true, loadId = 0;
  let suggestions = [], activeSuggestion = -1, appliedColour = null;
  let repulsion = 1, gameAttraction = 1, highlightedCountry = "";
  let profileImageUrl = null, profileImageRequest = 0;

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
    if (!value) ticks = 0;
    $("pause").textContent = value ? "Resume" : "Pause";
    $("pause").setAttribute("aria-pressed", String(value));
    $("layout-state").textContent = value ? "Layout paused" : "Layout settling";
  }
  function defaultDateRange() {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);
    return {start: localDate(start), end: localDate(end)};
  }
  function install(data) {
    validateSnapshot(data);
    snapshot = data;
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
      $("start").value = layout.start || defaultDateRange().start;
      $("end").value = layout.end || defaultDateRange().end;
      $("colour").value = layout.colour; $("names").checked = layout.names;
      for (const option of $("visible-countries").options) option.selected = option.value
        ? (layout.visibleCountries || []).includes(option.value) : !layout.visibleCountries?.length;
      pause(true);
    } else {
      const range = defaultDateRange();
      $("start").value = range.start; $("end").value = range.end;
      $("limit").value = "15000"; $("minimum").value = "1";
      $("colour").value = "country"; $("names").checked = false;
    }
    selected = null;
    visibleCountryChooser.refresh();
    let firstDate = "", lastDate = "";
    for (const game of data.games) if (game.date) {
      if (!firstDate || game.date < firstDate) firstDate = game.date;
      if (!lastDate || game.date > lastDate) lastDate = game.date;
    }
    const incomplete = /incomplete/i.test(data.description);
    $("dataset-summary").textContent = `${data.games.length.toLocaleString()} games loaded${firstDate ? ` · ${firstDate} to ${lastDate}` : ""}${incomplete ? " · INCOMPLETE dataset" : ""}`;
    $("dataset-summary").classList.toggle("error", incomplete);
    rebuild();
    $("save-view").disabled = false;
    status(`${model.gameCount.toLocaleString()} unique games loaded. Filters explore this dataset.`);
  }
  function rebuild() {
    if (!snapshot) return;
    const start = $("start").value, end = $("end").value;
    if (start && end && start > end) { status("The start date must be on or before the end date.", true); return; }
    const minimum = Number($("minimum").value);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100000) { status("Shared games must be a whole number from 1 to 100000.", true); return; }
    model = buildModel(snapshot, start, end);
    const graph = selectGraph(model, Number($("limit").value), minimum, visibleCountries());
    nodes = EgdLayout.createNodes(graph.players, snapshot.layout?.positions);
    for (const node of nodes) node.fill = colour(node);
    appliedColour = colourSettings();
    nodeMap = new Map(nodes.map(node => [node.pin, node]));
    links = graph.links.map(link => ({a: nodeMap.get(link.a), b: nodeMap.get(link.b), games: link.games}));
    if (!nodeMap.has(selected)) selected = null;
    gesture = null; hoverHighlight.clear();
    $("tooltip").hidden = true;
    ticks = 0;
    const displayedGames = links.reduce((total, link) => total + link.games, 0);
    $("counts").textContent = `${nodes.length.toLocaleString()} players / ${links.length.toLocaleString()} connections / ${displayedGames.toLocaleString()} games`;
    $("empty").hidden = nodes.length > 0;
    $("export-png").disabled = $("export-svg").disabled = $("export-gexf").disabled = !nodes.length;
    status(`${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`);
    $("layout-state").textContent = nodes.length ? (paused ? (snapshot.layout ? "Saved layout · paused" : "Layout paused") : "Layout settling") : "No visible connections";
    fit(); renderLegend(); renderPlayerOptions(); renderDetails();
    updateCountryHighlight();
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
      + Number(Number($("limit").value) !== 15000) + Number(Number($("minimum").value) > 1);
    $("advanced-filters-summary").textContent = `Advanced filters${activeFilters ? ` (${activeFilters} active)` : ""}`;
    $("graph-title").textContent = country ? `${country === "__unknown__" ? "Unknown country" : country} highlighted` : "Player connections";
    if (model) {
      status(country ? `${nodes.filter(matchesCountry).length.toLocaleString()} visible players from ${country === "__unknown__" ? "an unknown country" : country} highlighted.`
        : `${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`);
    }
    renderLegend(); dirty = true;
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
    const matches = searchPlayers(nodes, query);
    $("player-select").replaceChildren(new Option(matches.length ? "Select a player…" : "No matching visible players", ""),
      ...matches.map(node => new Option(`${node.name} · ${node.grade || "?"} · ${node.country || "?"}`, node.pin)));
    $("player-select").value = matches.some(node => node.pin === selected) ? selected : "";
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
      meta.textContent = `${node.country || "Unknown"} · ${node.grade || "Unknown rank"} · PIN ${node.pin}`;
      option.append(meta);
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => selectSuggestion(index));
      $("player-suggestions").append(option);
    }
    $("search-feedback").textContent = matches.length ? (matches.length > 12 ? `Showing 12 of ${matches.length.toLocaleString()} matches. Keep typing to narrow the list.`
      : `${matches.length} matching ${matches.length === 1 ? "player" : "players"}`) : "No matching visible players.";
    $("search-results").hidden = false;
    $("player-search").setAttribute("aria-expanded", "true");
  }
  function selectSuggestion(index) {
    const node = suggestions[index]; if (!node) return;
    $("player-search").value = node.name;
    choose(node.pin); hideSuggestions();
  }
  function choose(pin) {
    hoverHighlight.clear();
    selected = nodeMap.has(pin) ? pin : null;
    renderPlayerOptions(); renderDetails(); dirty = true;
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
    if (!node) return;
    const heading = document.createElement("h2"), info = document.createElement("p"), profile = document.createElement("a");
    heading.textContent = node.name;
    info.textContent = `${node.country || "Unknown country"} · ${node.grade || "Unknown rank"} · ${node.games} games in the selected dates · ${sameCountrySummary(node)}`;
    if ($("colour").value === "rank-change") info.textContent += ` · ${rankChangeSummary(node)}`;
    profile.textContent = "Open EGD player profile ↗";
    profile.href = "https://europeangodatabase.eu/EGD/Player_Card.php?key=" + encodeURIComponent(node.pin);
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
    const generateLabel = document.createElement("span"); generateLabel.textContent = "Generate graph image";
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
        generateLabel.textContent = "Regenerate graph image"; imageStatus.textContent = "Square image ready.";
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
    const opponents = links.filter(link => link.a === node || link.b === node).map(link =>
      ({node: link.a === node ? link.b : link.a, games: link.games})).sort((a, b) => b.games - a.games || a.node.name.localeCompare(b.node.name));
    const extra = document.createElement("details"), label = document.createElement("summary");
    label.textContent = `${opponents.length} opponents & profile`;
    const explanation = document.createElement("p"); explanation.className = "fine-print";
    explanation.textContent = "Visible opponents · games played together";
    const list = document.createElement("ul"); list.className = "opponents";
    for (const opponent of opponents) {
      const item = document.createElement("li"), button = document.createElement("button"), count = document.createElement("span");
      button.type = "button"; button.textContent = opponent.node.name; button.addEventListener("click", () => choose(opponent.node.pin));
      count.textContent = `${opponent.games} ${opponent.games === 1 ? "game" : "games"}`;
      item.append(button, count); list.append(item);
    }
    extra.append(label, profile, explanation, list);
    box.append(heading, info, share, shareStatus, shareUrl, imageTools, extra);
  }
  function fit() {
    hoverHighlight.clear();
    if (!nodes.length) { scale = 1; panX = panY = 0; dirty = true; return; }
    const minX = Math.min(...nodes.map(n => n.x - 35)), maxX = Math.max(...nodes.map(n => n.x + 35));
    const minY = Math.min(...nodes.map(n => n.y - 35)), maxY = Math.max(...nodes.map(n => n.y + 35));
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
    return [...nodes].reverse().find(node => Math.hypot(node.x - wx, node.y - wy) <= Math.max(EgdRenderer.nodeRadius(node, highlightedCountry), 7 / scale));
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
    EgdLayout.step(nodes, links, gesture?.node, repulsion, gameAttraction);
  }
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
    if (!paused && nodes.length && time - lastTick >= 25) {
      step(); ticks++; lastTick = time; dirty = true;
      if (ticks >= 2400 && !gesture) { pause(true); $("layout-state").textContent = "Layout settled · Resume to continue"; }
    }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(animate);
  }
  new ResizeObserver(() => {
    const nextWidth = stage.clientWidth, nextHeight = stage.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (width === nextWidth && height === nextHeight && canvas.width === Math.round(nextWidth * ratio) && canvas.height === Math.round(nextHeight * ratio)) return;
    width = nextWidth; height = nextHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); fit();
  }).observe(stage);
  canvas.addEventListener("pointerdown", event => {
    if (!event.isPrimary || (event.button !== 0 && event.button !== 2) || gesture) return;
    hoverHighlight.clear();
    if (event.button === 2) { event.preventDefault(); canvas.focus({preventScroll: true}); }
    const point = position(event); canvas.setPointerCapture(event.pointerId);
    gesture = {...point, pointerId: event.pointerId, button: event.button, startX: point.x, startY: point.y,
      node: event.button === 2 ? null : hit(point.x, point.y), moved: false};
    $("tooltip").hidden = true; canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", event => {
    if (gesture && event.pointerId !== gesture.pointerId) return;
    const point = position(event);
    if (gesture) {
      if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > 4) gesture.moved = true;
      if (gesture.moved) {
        if (gesture.node) {
          gesture.node.x = (point.x - width / 2 - panX) / scale; gesture.node.y = (point.y - height / 2 - panY) / scale;
          gesture.node.vx = gesture.node.vy = 0; ticks = 0;
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
    if (gesture && event.pointerId !== gesture.pointerId) return;
    if (gesture && gesture.button === 0 && !gesture.moved) choose(gesture.node ? gesture.node.pin : null);
    gesture = null; canvas.style.cursor = "grab";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", () => { gesture = null; hoverHighlight.clear(); canvas.style.cursor = "grab"; });
  canvas.addEventListener("lostpointercapture", () => { gesture = null; hoverHighlight.clear(); });
  canvas.addEventListener("pointerleave", () => hoverHighlight.clear());
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("dblclick", event => {
    if (event.button !== 0) return;
    const point = position(event), node = hit(point.x, point.y);
    if (node) window.open("https://europeangodatabase.eu/EGD/Player_Card.php?key=" + encodeURIComponent(node.pin), "_blank", "noopener,noreferrer");
  });
  canvas.addEventListener("wheel", event => { event.preventDefault(); const point = position(event); zoom(Math.exp(-event.deltaY * 0.0015), point.x, point.y); }, {passive: false});
  canvas.addEventListener("keydown", event => {
    if (["+", "=", "-", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); hoverHighlight.clear(); }
    if (event.key === "+" || event.key === "=") zoom(1.2);
    if (event.key === "-") zoom(1 / 1.2);
    if (event.key === "Home") fit();
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
  for (const id of ["limit", "minimum", "start", "end"]) $(id).addEventListener("change", rebuild);
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
      const positions = {...snapshot.layout?.positions};
      for (const node of nodes) positions[node.pin] = [node.x, node.y];
      const saved = {...snapshot, layout: {version: 1, maxPlayers: Number($("limit").value), minGames: Number($("minimum").value),
        country: highlightedCountry, start: $("start").value, end: $("end").value, colour: $("colour").value, names: $("names").checked,
        hideOverlappingNames: $("hide-overlapping-names").checked, colourBlindFriendly: $("colour-blind-friendly").checked,
        hoverHighlight: $("hover-highlight").checked, repulsion, gameAttraction, visibleCountries: visibleCountries(), positions}};
      validateSnapshot(saved);
      downloadBlob(new Blob([JSON.stringify(saved) + "\n"], {type: "application/json"}), "games.json");
      status("Saved games.json with your player positions and view settings. Open it to restore this view, or publish it as the website dataset.");
    } catch (error) { status("Could not save the view: " + error.message, true); }
  });
  function openLinkedPlayer() {
    let pin;
    try { pin = EgdSharing.playerPin(location.href); }
    catch (error) { status("Cannot open the shared profile: " + error.message, true); return; }
    if (!pin) return;
    let node = EgdSharing.findPlayer(nodes, pin);
    if (!node) {
      const player = EgdSharing.findPlayer(buildModel(snapshot).players, pin);
      if (!player) { status(`Player PIN ${pin} is not in the published dataset.`, true); return; }
      // A shared profile must remain reachable even when the saved view hides it.
      $("start").value = $("end").value = "";
      $("limit").value = "15000"; $("minimum").value = "1";
      for (const option of $("visible-countries").options) option.selected = option.value === "";
      visibleCountryChooser.refresh(); rebuild();
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
      const response = await fetch(document.body.dataset.snapshot || "data/games.json", {cache: "no-cache"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = validateSnapshot(await response.json());
      if (id === loadId) { install(data); openLinkedPlayer(); }
    } catch (error) {
      if (id === loadId) {
        status("Could not load the published snapshot. Serve the docs folder over HTTP. " + error.message, true);
        if (!snapshot) { $("dataset-summary").textContent = "Published snapshot unavailable"; $("counts").textContent = "No games loaded"; $("empty").hidden = false; $("layout-state").textContent = "Waiting for data"; }
      }
    }
  }
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  pause(paused); requestAnimationFrame(animate); loadPublished();
})();
