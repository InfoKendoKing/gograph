/* Static, undirected GEXF export for Gephi, using the displayed graph. */
(function (root) {
  "use strict";
  const renderer = typeof module !== "undefined" ? require("./graph-renderer.js") : root.EgdRenderer;
  function xml(value) {
    return Array.from(String(value), char => {
      const code = char.codePointAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
        || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff) ? char : "\ufffd";
    }).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
      .replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
  }
  function rgb(colour) {
    const hex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(colour);
    if (hex) {
      const value = hex[1].length === 3 ? Array.from(hex[1], c => c + c).join("") : hex[1];
      return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
    }
    const hsl = /^hsl\(\s*([\d.+-]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(colour);
    if (!hsl) throw new Error("Cannot export an unsupported node colour.");
    const hue = ((Number(hsl[1]) % 360) + 360) % 360 / 60;
    const saturation = Number(hsl[2]) / 100, lightness = Number(hsl[3]) / 100;
    if (![hue, saturation, lightness].every(Number.isFinite) || saturation > 1 || lightness > 1) throw new Error("Invalid node colour.");
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs(hue % 2 - 1)), m = lightness - chroma / 2;
    const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x]
      : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
    return channels.map(channel => Math.round((channel + m) * 255));
  }
  const attributes = [
    ["country", "Country", "string"], ["grade", "Rank", "string"], ["games", "Games played", "integer"],
    ["rankChange", "Rank change", "integer"], ["firstGrade", "First recorded rank", "string"],
    ["firstRankDate", "First rank date", "string"], ["latestRankDate", "Latest rank date", "string"],
    ["sameCountryGames", "Games against own country", "integer"], ["sameCountryPercent", "Games against own country (%)", "double"]
  ];
  function gexf(view, description = "European Go player connections") {
    const pins = new Set();
    const nodes = view.nodes.map(node => {
      if (!/^\d+$/.test(node.pin) || pins.has(node.pin)) throw new Error("Duplicate or invalid exported player PIN.");
      pins.add(node.pin);
      const size = renderer.nodeRadius(node, view.country) * 2;
      if (![node.x, node.y, size].every(Number.isFinite) || size <= 0) throw new Error("Invalid exported node position or size.");
      const values = attributes.filter(([key]) => node[key] != null).map(([key, , type]) => {
        if (type !== "string" && (!Number.isFinite(node[key]) || (type === "integer" && !Number.isInteger(node[key])))) throw new Error("Invalid exported player attribute.");
        return `<attvalue for="${key}" value="${xml(node[key])}"/>`;
      }).join("");
      const [r, g, b] = rgb(node.fill);
      // Gephi's Y axis points upward; the canvas Y axis points downward.
      return `<node id="${xml(node.pin)}" label="${xml(node.name)}"><attvalues>${values}</attvalues>`
        + `<viz:position x="${node.x}" y="${-node.y}" z="0"/><viz:color r="${r}" g="${g}" b="${b}"/><viz:size value="${size}"/></node>`;
    });
    const edges = view.links.map((link, i) => {
      if (!pins.has(link.a.pin) || !pins.has(link.b.pin) || !Number.isInteger(link.games) || link.games < 1) throw new Error("Invalid exported edge.");
      return `<edge id="${i}" source="${xml(link.a.pin)}" target="${xml(link.b.pin)}" weight="${link.games}"><attvalues><attvalue for="games" value="${link.games}"/></attvalues></edge>`;
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<gexf xmlns="http://www.gexf.net/1.2draft" xmlns:viz="http://www.gexf.net/1.2draft/viz" version="1.2">\n'
      + `<meta><creator>European Go Graph</creator><description>${xml(description)}</description></meta>\n`
      + '<graph mode="static" defaultedgetype="undirected"><attributes class="node">'
      + attributes.map(([id, title, type]) => `<attribute id="${id}" title="${xml(title)}" type="${type}"/>`).join("")
      + '</attributes><attributes class="edge"><attribute id="games" title="Games together" type="integer"/></attributes>\n'
      + `<nodes>${nodes.join("\n")}</nodes>\n<edges>${edges.join("\n")}</edges></graph></gexf>\n`;
  }
  const api = {gexf};
  root.EgdGephi = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
