/* One renderer for the live canvas and standalone SVG exports. */
(function (root) {
  "use strict";
  function nodeRadius(node, country = "") {
    return node.radius * (country && node.country === (country === "__unknown__" ? "" : country) ? 1.75 : 1);
  }
  function render(context, view) {
    const {width, height, scale, panX, panY, nodes, links, focus, selected, country, names} = view;
    context.save(); context.translate(width / 2 + panX, height / 2 + panY); context.scale(scale, scale);
    const neighbours = new Set(focus ? [focus] : []);
    const belongs = node => node.country === (country === "__unknown__" ? "" : country);
    if (focus) for (const link of links) if (link.a === focus || link.b === focus) { neighbours.add(link.a); neighbours.add(link.b); }
    for (const link of links) {
      const active = focus && (link.a === focus || link.b === focus);
      const countryLink = country && (belongs(link.a) || belongs(link.b));
      context.strokeStyle = active ? "#c4eacf" : view.muteUnrelated ? "#89919b" : "#89aaa9";
      context.globalAlpha = active ? 0.85 : country ? (countryLink ? 0.35 : 0.025) : focus ? 0.065 : 0.22;
      context.lineWidth = Math.min(6, 0.65 + Math.sqrt(link.games) * 0.55) / Math.sqrt(scale);
      context.beginPath(); context.moveTo(link.a.x, link.a.y); context.lineTo(link.b.x, link.b.y); context.stroke();
      if (active && links.length < 1200 && view.showGameCounts !== false) {
        context.globalAlpha = 1; context.font = `${10 / scale}px system-ui`; context.textAlign = "center";
        context.fillStyle = "#e3eee1"; context.fillText(String(link.games), (link.a.x + link.b.x) / 2, (link.a.y + link.b.y) / 2 - 4 / scale);
      }
    }
    for (const node of nodes) {
      const countryNode = country && belongs(node);
      const radius = nodeRadius(node, country);
      context.globalAlpha = country ? (countryNode || neighbours.has(node) ? 1 : 0.1) : focus && !neighbours.has(node) ? 0.17 : 1;
      context.fillStyle = node.fill; context.beginPath(); context.arc(node.x, node.y, radius, 0, Math.PI * 2); context.fill();
      if (node === focus || node.pin === selected) {
        context.strokeStyle = "#f3f5df"; context.lineWidth = 1.5 / scale;
        context.beginPath(); context.arc(node.x, node.y, radius + 4 / scale, 0, Math.PI * 2); context.stroke();
      }
    }
    // Reserve space in priority order, then paint the most important labels last.
    // Screen coordinates keep spacing constant at every zoom and export resolution.
    const candidates = nodes.filter(node => names || neighbours.has(node) || node.pin === selected)
      .map(node => ({node, priority: node === focus ? 0 : node.pin === selected ? 1 : neighbours.has(node) ? 2 : country && belongs(node) ? 3 : 4}))
      .sort((a, b) => a.priority - b.priority);
    const labels = [], cells = new Map(), cellSize = 64;
    for (const {node, priority} of candidates) {
      const prominent = priority < 2, size = prominent ? 12 : 11;
      context.font = `${prominent ? "bold " : ""}${size}px system-ui`;
      context.textAlign = "left";
      const metrics = context.measureText(node.name);
      const x = width / 2 + panX + node.x * scale + nodeRadius(node, country) * scale + 5;
      const y = height / 2 + panY + node.y * scale + 4;
      const padding = 2;
      const box = {left: x - Math.max(0, metrics.actualBoundingBoxLeft || 0) - padding,
        right: x + Math.max(metrics.width, metrics.actualBoundingBoxRight || 0) + padding,
        top: y - Math.max(size, metrics.actualBoundingBoxAscent || 0) - padding,
        bottom: y + Math.max(3, metrics.actualBoundingBoxDescent || 0) + padding};
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
      if (view.hideOverlappingNames) {
        // Only index visible cells, so long or partially offscreen names stay cheap.
        const keys = [];
        for (let cy = Math.floor(Math.max(0, box.top) / cellSize); cy <= Math.floor(Math.min(height, box.bottom) / cellSize); cy++) {
          for (let cx = Math.floor(Math.max(0, box.left) / cellSize); cx <= Math.floor(Math.min(width, box.right) / cellSize); cx++) keys.push(`${cx},${cy}`);
        }
        if (keys.some(key => (cells.get(key) || []).some(other => box.left < other.right && box.right > other.left
            && box.top < other.bottom && box.bottom > other.top))) continue;
        for (const key of keys) {
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(box);
        }
      }
      labels.push({node, prominent, size, x, y, box});
    }
    for (const {node, prominent, size, x, y, box} of labels.reverse()) {
      const worldX = value => (value - width / 2 - panX) / scale;
      const worldY = value => (value - height / 2 - panY) / scale;
      context.globalAlpha = prominent ? 1 : country ? (belongs(node) || neighbours.has(node) ? 1 : 0.1)
        : focus && !neighbours.has(node) ? 0.17 : 1;
      context.font = `${prominent ? "bold " : ""}${size / scale}px system-ui`;
      context.textAlign = "left"; context.fillStyle = prominent ? "#ffffff" : "#e2e9db";
      context.fillText(node.name, worldX(x), worldY(y));
    }
    context.restore(); context.globalAlpha = 1;
  }
  function xml(value) {
    return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "\ufffd")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function svg(view, description = "European Go player connections", textContext = root.document?.createElement("canvas").getContext("2d")) {
    const elements = [];
    let path = [], circle = null;
    const painter = {
      globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "11px system-ui", textAlign: "left",
      save() {}, restore() {}, translate() {}, scale() {},
      beginPath() { path = []; circle = null; },
      moveTo(x, y) { path.push(`M ${x} ${y}`); }, lineTo(x, y) { path.push(`L ${x} ${y}`); },
      arc(x, y, radius) { circle = `cx="${x}" cy="${y}" r="${radius}"`; },
      paint(style) {
        elements.push(circle ? `<circle ${circle} ${style}/>` : `<path d="${path.join(" ")}" ${style}/>`);
      },
      fill() { this.paint(`fill="${xml(this.fillStyle)}" opacity="${this.globalAlpha}"`); },
      stroke() { this.paint(`fill="none" stroke="${xml(this.strokeStyle)}" stroke-width="${this.lineWidth}" opacity="${this.globalAlpha}"`); },
      fillRect(x, y, width, height) {
        elements.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${xml(this.fillStyle)}" opacity="${this.globalAlpha}"/>`);
      },
      measureText(text) {
        if (textContext) {
          textContext.save(); textContext.font = this.font; textContext.textAlign = "left";
          const metrics = textContext.measureText(text);
          textContext.restore(); return metrics;
        }
        // Headless consumers can supply a measuring context for exact font metrics.
        return {width: Array.from(text).length * parseFloat(this.font.replace(/^bold /, "")) * 0.65};
      },
      fillText(text, x, y) {
        const bold = this.font.startsWith("bold "), size = parseFloat(this.font.replace(/^bold /, "")), anchor = this.textAlign === "center" ? "middle" : "start";
        elements.push(`<text x="${x}" y="${y}" fill="${xml(this.fillStyle)}" opacity="${this.globalAlpha}" font-family="system-ui,sans-serif" font-size="${size}" font-weight="${bold ? "bold" : "normal"}" text-anchor="${anchor}">${xml(text)}</text>`);
      }
    };
    render(painter, view);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}" viewBox="0 0 ${view.width} ${view.height}" role="img">`
      + `<title>European Go player connections</title><desc>${xml(description)}</desc>`
      + `<defs><clipPath id="viewport"><rect width="${view.width}" height="${view.height}"/></clipPath></defs>`
      + `<rect width="100%" height="100%" fill="#19212c"/>`
      + `<g clip-path="url(#viewport)"><g transform="translate(${view.width / 2 + view.panX} ${view.height / 2 + view.panY}) scale(${view.scale})">`
      + elements.join("") + "</g></g></svg>\n";
  }
  function paintBackground(context, width, height) {
    context.save(); context.fillStyle = "#19212c"; context.fillRect(0, 0, width, height); context.restore();
  }
  const api = {render, svg, paintBackground, nodeRadius};
  root.EgdRenderer = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
