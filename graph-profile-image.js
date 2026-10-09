/* Square player cards for browser PNG downloads and image sharing. */
(function (root) {
  "use strict";
  const renderer = typeof module !== "undefined" ? require("./graph-renderer.js") : root.EgdRenderer;
  const countries = typeof module !== "undefined" ? require("./country-chooser.js") : root.EgdCountries;
  const size = 1200;
  function createCard(nodes, links, pin) {
    const player = nodes.find(node => node.pin === pin);
    if (!player) throw new Error("The selected player is not in this graph.");
    const neighbours = new Set([player]);
    for (const link of links) {
      if (link.a === player) neighbours.add(link.b);
      if (link.b === player) neighbours.add(link.a);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      if (![node.x, node.y, node.radius].every(Number.isFinite)) throw new Error("Invalid player position or size.");
      if (!neighbours.has(node)) continue;
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    }
    // Frame this player's connections; the wider network continues to the image edges.
    const scale = Math.min((size - 120) / Math.max(80, maxX - minX), (size - 240) / Math.max(80, maxY - minY));
    const pictured = new Map(nodes.map(node => {
      const active = neighbours.has(node);
      const radius = node === player ? Math.max(12, Math.min(18, node.radius * scale))
        : active ? Math.max(3, Math.min(8, node.radius * scale)) : Math.max(0.8, Math.min(2.5, node.radius * scale));
      return [node, {...node, radius: radius / scale, fill: active ? node.fill : "#89919b"}];
    }));
    // Paint the grey network first, then opponents, then the selected player.
    const ordered = [...nodes.filter(node => !neighbours.has(node)),
      ...nodes.filter(node => neighbours.has(node) && node !== player), player].map(node => pictured.get(node));
    const view = {width: size, height: size, scale,
      panX: -(minX + maxX) / 2 * scale, panY: 60 - (minY + maxY) / 2 * scale,
      nodes: ordered, links: links.map(link => ({...link, a: pictured.get(link.a), b: pictured.get(link.b)})),
      focus: pictured.get(player), selected: player.pin, country: "", names: false,
      hideOverlappingNames: true, showGameCounts: false, muteUnrelated: true};
    const name = Array.from(player.name);
    const title = name.slice(0, 44).join("") + (name.length > 44 ? "…" : "");
    const opponents = neighbours.size - 1;
    return {view, title,
      summary: `${countries.countryName(player.country)} · ${player.grade || "Unknown rank"} · ${player.games.toLocaleString("en-US")} games`,
      caption: `Highlighted with ${opponents} ${opponents === 1 ? "opponent" : "opponents"} · PIN ${player.pin}`,
      size};
  }
  function render(context, card) {
    renderer.paintBackground(context, size, size);
    context.save();
    context.beginPath(); context.rect(0, 0, size, size); context.clip();
    renderer.render(context, card.view); context.restore();
    context.save(); context.textAlign = "left"; context.globalAlpha = 1;
    const top = context.createLinearGradient(0, 0, 0, 170);
    top.addColorStop(0, "#19212cf2"); top.addColorStop(1, "#19212c00");
    context.fillStyle = top; context.fillRect(0, 0, size, 170);
    const bottom = context.createLinearGradient(0, size - 80, 0, size);
    bottom.addColorStop(0, "#19212c00"); bottom.addColorStop(1, "#19212cf2");
    context.fillStyle = bottom; context.fillRect(0, size - 80, size, 80);
    context.fillStyle = "#e9db78"; context.font = "19px system-ui,sans-serif";
    context.fillText("EUROPEAN GO GRAPH", 42, 34);
    context.fillStyle = "#ffffff"; context.font = "bold 40px system-ui,sans-serif";
    context.fillText(card.title, 42, 87, size - 84);
    context.fillStyle = "#c0c7d2"; context.font = "22px system-ui,sans-serif";
    context.fillText(card.summary, 42, 122, size - 84);
    context.font = "20px system-ui,sans-serif"; context.fillText(card.caption, 42, 1175, size - 84);
    context.restore();
  }
  const api = {size, createCard, render};
  root.EgdProfileImage = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
