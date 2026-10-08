"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $("graph"), stage = $("stage"), context = canvas.getContext("2d");
  const countryChooser = EgdCountries.setup($("country"), $("country-toggle"), $("country-options"), $("country-current"), $("country-box"), $("country-clear"));
  const {validateSnapshot, buildModel, selectGraph, rankValue, searchPlayers, sameCountryBand, sameCountryBands} = EgdGraph;
  const palette = ["#69b4ff", "#ffac69", "#9ae5bd", "#f58fc5", "#e9db78", "#77e0df", "#b19cff", "#fa817e", "#bded84", "#eae8df", "#eebccf", "#caa07a", "#9dcef5", "#67c9a3", "#f7ce9e", "#dba4ed"];
  let snapshot, countryColours = new Map(), model, nodes = [], links = [], nodeMap = new Map();
  let width = 1, height = 1, scale = 1, panX = 0, panY = 0, selected = null, hovered = null;
  let gesture = null, touchPoints = new Map(), paused = matchMedia("(prefers-reduced-motion: reduce)").matches, ticks = 0, lastTick = 0, dirty = true, loadId = 0;
  let suggestions = [], activeSuggestion = -1, appliedColour = null;

  function status(message, error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
  }
  function pause(value) {
    paused = value;
    if (!value) ticks = 0;
    $("pause").textContent = value ? "Resume" : "Pause";
    $("pause").setAttribute("aria-pressed", String(value));
    $("layout-state").textContent = value ? "Layout paused" : "Layout settling";
  }
  function install(data) {
    validateSnapshot(data);
    snapshot = data;
    const countries = [...new Set(data.games.flatMap(game => [game.first.country, game.second.country]))].sort();
    countryColours = new Map(countries.filter(c => c && c !== "??").map((country, i) =>
      [country, palette[i] || `hsl(${(i * 137.508) % 360} 70% 70%)`]));
    $("country").replaceChildren(new Option("All countries", ""), ...countries.map(c => new Option(c || "Unknown", c || "__unknown__")));
    $("player-country").replaceChildren(new Option("All countries", ""), ...countries.map(c => new Option(c || "Unknown", c || "__unknown__")));
    $("start").value = $("end").value = $("player-search").value = "";
    if (data.layout) {
      const layout = data.layout;
      if (![...$("limit").options].some(option => Number(option.value) === layout.maxPlayers)) {
        $("limit").add(new Option(String(layout.maxPlayers), String(layout.maxPlayers)));
      }
      $("limit").value = String(layout.maxPlayers);
      $("minimum").value = String(layout.minGames);
      $("country").value = layout.country;
      $("player-country").value = layout.playerCountry || "";
      $("start").value = layout.start; $("end").value = layout.end;
      // Older saved views used the removed games-played colour mode.
      $("colour").value = layout.colour === "games" ? "same-country" : layout.colour; $("names").checked = layout.names;
      pause(true);
    }
    selected = null;
    countryChooser.refresh();
    $("description").textContent = data.description || "Saved EGD games";
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
    const graph = selectGraph(model, Number($("limit").value), minimum, $("player-country").value);
    nodes = EgdLayout.createNodes(graph.players, snapshot.layout?.positions);
    for (const node of nodes) node.fill = colour(node);
    appliedColour = $("colour").value;
    nodeMap = new Map(nodes.map(node => [node.pin, node]));
    links = graph.links.map(link => ({a: nodeMap.get(link.a), b: nodeMap.get(link.b), games: link.games}));
    if (!nodeMap.has(selected)) selected = null;
    hovered = gesture = null;
    $("tooltip").hidden = true;
    ticks = 0;
    const displayedGames = links.reduce((total, link) => total + link.games, 0);
    $("counts").textContent = `${nodes.length.toLocaleString()} players / ${links.length.toLocaleString()} connections / ${displayedGames.toLocaleString()} games`;
    $("empty").hidden = nodes.length > 0;
    $("export-png").disabled = $("export-svg").disabled = !nodes.length;
    status(`${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`);
    $("layout-state").textContent = nodes.length ? (paused ? (snapshot.layout ? "Saved layout · paused" : "Layout paused") : "Layout settling") : "No visible connections";
    fit(); renderLegend(); renderPlayerOptions(); renderDetails();
    updateCountryHighlight();
  }
  function matchesCountry(node) {
    const country = $("country").value;
    return !country || node.country === (country === "__unknown__" ? "" : country);
  }
  function updateCountryHighlight() {
    const country = $("country").value;
    const playerCountry = $("player-country").value;
    const countryName = value => value === "__unknown__" ? "Unknown country" : value;
    const title = playerCountry ? `${countryName(playerCountry)} players` : "Player connections";
    $("graph-title").textContent = country ? `${title} · ${countryName(country)} highlighted` : title;
    if (model) {
      const messages = [playerCountry
        ? `${nodes.length.toLocaleString()} connected players from ${countryName(playerCountry)}.`
        : `${model.gameCount.toLocaleString()} unique games in the selected dates. Displayed players must share a qualifying connection.`];
      if (country) messages.push(`${nodes.filter(matchesCountry).length.toLocaleString()} visible players from ${countryName(country)} highlighted.`);
      status(messages.join(" "));
    }
    renderLegend(); dirty = true;
  }
  function colour(node) {
    if ($("colour").value === "country") return countryColours.get(node.country) || "#9ca3af";
    if ($("colour").value === "same-country") return sameCountryBand(node.sameCountryPercent)?.colour || "#9ca3af";
    const rank = rankValue(node.grade);
    if (rank === null) return "#9ca3af";
    if (rank > 40) return `hsl(${310 - (rank - 41) * 5} 85% 75%)`;
    return `hsl(${220 - (rank - 1) / 38 * 220} 82% 65%)`;
  }
  function updateColours() {
    if (appliedColour === $("colour").value) return;
    for (const node of nodes) node.fill = colour(node);
    appliedColour = $("colour").value;
    renderLegend();
    draw();
    dirty = false;
  }
  function renderLegend() {
    const rankMode = $("colour").value === "rank";
    const sameCountryMode = $("colour").value === "same-country";
    let entries;
    if (sameCountryMode) {
      entries = sameCountryBands.map(band => [band.label, band.colour]);
      if (nodes.some(node => node.sameCountryPercent === null)) entries.push(["Unknown country", "#9ca3af"]);
    } else {
      const values = new Map(nodes.map(node => [rankMode ? node.grade : node.country, colour(node)]));
      entries = [...values].sort(([a], [b]) => rankMode ? (rankValue(a) ?? 100) - (rankValue(b) ?? 100) || a.localeCompare(b) : a.localeCompare(b));
    }
    $("colour-note").textContent = sameCountryMode ? "Blue = lower share; yellow = higher share of games against players from the same country. Uses all loaded games in the selected dates, including hidden opponents. Unknown opponents count in the total; unknown player countries are grey."
      : rankMode ? "Rank is from the first encountered game in the selected dates." : "Colours identify players’ countries.";
    $("legend").replaceChildren();
    for (const [label, fill] of entries) {
      const item = document.createElement("span"), swatch = document.createElement("i");
      item.className = "legend-item";
      if (!rankMode && !sameCountryMode && $("country").value && label !== ($("country").value === "__unknown__" ? "" : $("country").value)) item.classList.add("dim");
      swatch.className = "swatch"; swatch.style.background = fill;
      item.append(swatch, document.createTextNode(label || "Unknown"));
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
    selected = nodeMap.has(pin) ? pin : null;
    renderPlayerOptions(); renderDetails(); dirty = true;
  }
  function sameCountrySummary(node) {
    return node.sameCountryPercent === null ? "Same-country share unavailable (unknown country)"
      : `${node.sameCountryPercent.toFixed(1)}% against same-country players (${node.sameCountryGames}/${node.games} games)`;
  }
  function renderDetails() {
    const box = $("player-details"); box.replaceChildren();
    const node = nodeMap.get(selected);
    if (!node) {
      const message = document.createElement("p"); message.className = "fine-print";
      message.textContent = "Select a dot or find a player to see their connections."; box.append(message); return;
    }
    const heading = document.createElement("h2"), info = document.createElement("p"), profile = document.createElement("a");
    heading.textContent = node.name;
    info.textContent = `${node.country || "Unknown country"} · ${node.grade || "Unknown rank"} · ${node.games} games in the selected dates · ${sameCountrySummary(node)}`;
    profile.textContent = "Open EGD player profile ↗";
    profile.href = "https://europeangodatabase.eu/EGD/Player_Card.php?key=" + encodeURIComponent(node.pin);
    profile.target = "_blank"; profile.rel = "noopener noreferrer";
    const opponents = links.filter(link => link.a === node || link.b === node).map(link =>
      ({node: link.a === node ? link.b : link.a, games: link.games})).sort((a, b) => b.games - a.games || a.node.name.localeCompare(b.node.name));
    const label = document.createElement("p"); label.className = "fine-print";
    label.textContent = `${opponents.length} visible opponents · shared games`;
    const list = document.createElement("ul"); list.className = "opponents";
    for (const opponent of opponents) {
      const item = document.createElement("li"), button = document.createElement("button"), count = document.createElement("span");
      button.type = "button"; button.textContent = opponent.node.name; button.addEventListener("click", () => choose(opponent.node.pin));
      count.textContent = `${opponent.games} ${opponent.games === 1 ? "game" : "games"}`;
      item.append(button, count); list.append(item);
    }
    box.append(heading, info, profile, label, list);
  }
  function fit() {
    if (!nodes.length) { scale = 1; panX = panY = 0; dirty = true; return; }
    const minX = Math.min(...nodes.map(n => n.x - 35)), maxX = Math.max(...nodes.map(n => n.x + 35));
    const minY = Math.min(...nodes.map(n => n.y - 35)), maxY = Math.max(...nodes.map(n => n.y + 35));
    scale = Math.max(0.05, Math.min(2, Math.min(Math.max(80, width - 80) / (maxX - minX), Math.max(80, height - 100) / (maxY - minY))));
    panX = -(minX + maxX) / 2 * scale; panY = -(minY + maxY) / 2 * scale; dirty = true;
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    const wx = (x - width / 2 - panX) / scale, wy = (y - height / 2 - panY) / scale;
    scale = Math.max(0.05, Math.min(8, scale * factor));
    panX = x - width / 2 - wx * scale; panY = y - height / 2 - wy * scale; dirty = true;
  }
  function position(event) { const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top}; }
  function hit(x, y) {
    const wx = (x - width / 2 - panX) / scale, wy = (y - height / 2 - panY) / scale;
    return [...nodes].reverse().find(node => Math.hypot(node.x - wx, node.y - wy) <= Math.max(node.radius, 7 / scale));
  }
  function tooltip(node, x, y) {
    const box = $("tooltip"); box.hidden = !node;
    if (!node) return;
    box.textContent = `${node.name}\n${node.country || "?"} · ${node.grade || "?"} · ${node.games} games\n${sameCountrySummary(node)}`;
    const selectedNode = nodeMap.get(selected);
    if (selectedNode && selectedNode !== node) {
      const link = links.find(link => (link.a === selectedNode && link.b === node) || (link.b === selectedNode && link.a === node));
      if (link) box.textContent += `\n${link.games} shared with ${selectedNode.name}`;
    }
    box.style.left = Math.max(5, Math.min(width - box.offsetWidth - 8, x + 14)) + "px";
    box.style.top = Math.max(5, Math.min(height - box.offsetHeight - 8, y + 14)) + "px";
  }
  function step() {
    EgdLayout.step(nodes, links, gesture?.node);
  }
  function graphView() {
    return {width, height, scale, panX, panY, nodes, links, focus: hovered || nodeMap.get(selected), selected,
      country: $("country").value, names: $("names").checked};
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
      if (format === "svg") {
        blob = new Blob([EgdRenderer.svg(graphView(), snapshot.description)], {type: "image/svg+xml;charset=utf-8"});
      } else {
        // Copy one frame before encoding, so a running simulation stays live.
        draw();
        const image = document.createElement("canvas"); image.width = canvas.width; image.height = canvas.height;
        const painter = image.getContext("2d"); EgdRenderer.paintBackground(painter, image.width, image.height);
        painter.drawImage(canvas, 0, 0);
        blob = await new Promise((resolve, reject) => image.toBlob(result => result ? resolve(result) : reject(new Error("PNG encoding failed.")), "image/png"));
      }
      downloadBlob(blob, "european-go-graph." + format);
      status(`Exported the current graph view as ${format.toUpperCase()}.`);
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
  function finishPointer(event, cancelled = false) {
    const wasTouch = touchPoints.delete(event.pointerId);
    if (gesture?.type === "pinch" && gesture.pointerIds.includes(event.pointerId)) {
      const remaining = [...touchPoints];
      if (remaining.length >= 2) {
        const [[firstId, first], [secondId, second]] = remaining;
        gesture = {type: "pinch", pointerIds: [firstId, secondId], distance: Math.hypot(second.x - first.x, second.y - first.y),
          center: {x: (first.x + second.x) / 2, y: (first.y + second.y) / 2}, moved: true};
      } else if (remaining.length === 1) {
        const [pointerId, point] = remaining[0];
        gesture = {...point, pointerId, startX: point.x, startY: point.y, moved: true};
      } else gesture = null;
    } else if (gesture?.pointerId === event.pointerId) {
      if (!cancelled && !gesture.moved) choose(gesture.node ? gesture.node.pin : null);
      gesture = null;
    } else if (wasTouch && !touchPoints.size) gesture = null;
    if (!gesture) canvas.style.cursor = "grab";
    hovered = null; dirty = true;
  }
  canvas.addEventListener("pointerdown", event => {
    const isTouch = event.pointerType === "touch";
    if (!isTouch && (!event.isPrimary || event.button !== 0)) return;
    const point = position(event); canvas.setPointerCapture(event.pointerId);
    if (isTouch) {
      touchPoints.set(event.pointerId, point);
      if (touchPoints.size >= 2) {
        const [[firstId, first], [secondId, second]] = [...touchPoints].slice(0, 2);
        gesture = {type: "pinch", pointerIds: [firstId, secondId], distance: Math.hypot(second.x - first.x, second.y - first.y),
          center: {x: (first.x + second.x) / 2, y: (first.y + second.y) / 2}, moved: true};
      } else gesture = {...point, pointerId: event.pointerId, startX: point.x, startY: point.y, node: hit(point.x, point.y), moved: false};
    } else gesture = {...point, pointerId: event.pointerId, startX: point.x, startY: point.y, node: hit(point.x, point.y), moved: false};
    $("tooltip").hidden = true; canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", event => {
    const point = position(event);
    if (gesture?.type === "pinch") {
      if (!gesture.pointerIds.includes(event.pointerId)) return;
      touchPoints.set(event.pointerId, point);
      const [first, second] = gesture.pointerIds.map(pointerId => touchPoints.get(pointerId));
      if (!first || !second) return;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const center = {x: (first.x + second.x) / 2, y: (first.y + second.y) / 2};
      if (gesture.distance > 0 && distance > 0) zoom(distance / gesture.distance, center.x, center.y);
      panX += center.x - gesture.center.x; panY += center.y - gesture.center.y;
      gesture.distance = distance; gesture.center = center; dirty = true;
      return;
    }
    if (gesture && event.pointerId !== gesture.pointerId) return;
    if (gesture) {
      if (event.pointerType === "touch") touchPoints.set(event.pointerId, point);
      if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > 4) gesture.moved = true;
      if (gesture.moved) {
        panX += point.x - gesture.x; panY += point.y - gesture.y;
      }
      gesture.x = point.x; gesture.y = point.y; dirty = true;
    } else {
      hovered = hit(point.x, point.y); canvas.style.cursor = hovered ? "pointer" : "grab";
      tooltip(hovered, point.x, point.y); dirty = true;
    }
  });
  canvas.addEventListener("pointerup", event => {
    finishPointer(event);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", event => finishPointer(event, true));
  canvas.addEventListener("lostpointercapture", event => {
    if (touchPoints.has(event.pointerId) || gesture?.pointerId === event.pointerId || gesture?.pointerIds?.includes(event.pointerId)) finishPointer(event, true);
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; $("tooltip").hidden = true; dirty = true; });
  canvas.addEventListener("dblclick", event => {
    const point = position(event), node = hit(point.x, point.y);
    if (node) window.open("https://europeangodatabase.eu/EGD/Player_Card.php?key=" + encodeURIComponent(node.pin), "_blank", "noopener,noreferrer");
  });
  canvas.addEventListener("wheel", event => { event.preventDefault(); const point = position(event); zoom(Math.exp(-event.deltaY * 0.0015), point.x, point.y); }, {passive: false});
  canvas.addEventListener("keydown", event => {
    if (["+", "=", "-", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
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
  $("export-png").addEventListener("click", () => exportGraph("png"));
  $("export-svg").addEventListener("click", () => exportGraph("svg"));
  for (const id of ["limit", "minimum", "start", "end"]) $(id).addEventListener("change", rebuild);
  $("country").addEventListener("change", updateCountryHighlight);
  $("player-country").addEventListener("change", rebuild);
  $("colour").addEventListener("input", updateColours);
  $("colour").addEventListener("change", updateColours);
  $("names").addEventListener("change", () => { dirty = true; });
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
        country: $("country").value, playerCountry: $("player-country").value, start: $("start").value, end: $("end").value,
        colour: $("colour").value, names: $("names").checked, positions}};
      validateSnapshot(saved);
      downloadBlob(new Blob([JSON.stringify(saved) + "\n"], {type: "application/json"}), "games.json");
      status("Saved games.json with your player positions and view settings. Publish it as the website dataset to share this view.");
    } catch (error) { status("Could not save the view: " + error.message, true); }
  });
  async function loadPublished() {
    const id = ++loadId;
    status("Loading the published snapshot…");
    try {
      const response = await fetch("data/games.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = validateSnapshot(await response.json());
      if (id === loadId) install(data);
    } catch (error) {
      if (id === loadId) {
        status("Could not load the published snapshot. Serve the docs folder over HTTP. " + error.message, true);
        if (!snapshot) { $("description").textContent = "Published snapshot unavailable"; $("counts").textContent = "No games loaded"; $("empty").hidden = false; $("layout-state").textContent = "Waiting for data"; }
      }
    }
  }
  $("reset-data").addEventListener("click", loadPublished);
  pause(paused); requestAnimationFrame(animate); loadPublished();
})();
