/* One renderer for the live canvas and standalone SVG exports. */
(function (root) {
  "use strict";
  function render(context, view) {
    const {width, height, scale, panX, panY, nodes, links, focus, selected, country, names} = view;
    context.save(); context.translate(width / 2 + panX, height / 2 + panY); context.scale(scale, scale);
    const neighbours = new Set(focus ? [focus] : []);
    const belongs = node => node.country === (country === "__unknown__" ? "" : country);
    if (focus) for (const link of links) if (link.a === focus || link.b === focus) { neighbours.add(link.a); neighbours.add(link.b); }
    for (const link of links) {
      const active = focus && (link.a === focus || link.b === focus);
      const countryLink = country && (belongs(link.a) || belongs(link.b));
      context.strokeStyle = active ? "#c4eacf" : "#89aaa9";
      context.globalAlpha = active ? 0.85 : country ? (countryLink ? 0.35 : 0.025) : focus ? 0.065 : 0.22;
      context.lineWidth = Math.min(6, 0.65 + Math.sqrt(link.games) * 0.55) / Math.sqrt(scale);
      context.beginPath(); context.moveTo(link.a.x, link.a.y); context.lineTo(link.b.x, link.b.y); context.stroke();
      if (active && links.length < 1200) {
        context.globalAlpha = 1; context.font = `${10 / scale}px system-ui`; context.textAlign = "center";
        context.fillStyle = "#e3eee1"; context.fillText(String(link.games), (link.a.x + link.b.x) / 2, (link.a.y + link.b.y) / 2 - 4 / scale);
      }
    }
    for (const node of nodes) {
      const countryNode = country && belongs(node);
      const radius = node.radius * (countryNode ? 1.75 : 1);
      context.globalAlpha = country ? (countryNode || neighbours.has(node) ? 1 : 0.1) : focus && !neighbours.has(node) ? 0.17 : 1;
      context.fillStyle = node.fill; context.beginPath(); context.arc(node.x, node.y, radius, 0, Math.PI * 2); context.fill();
      if (!countryNode && (node === focus || node.pin === selected)) {
        context.strokeStyle = "#f3f5df"; context.lineWidth = 1.5 / scale;
        context.beginPath(); context.arc(node.x, node.y, node.radius + 4 / scale, 0, Math.PI * 2); context.stroke();
      }
      if (names || neighbours.has(node)) {
        context.font = `${11 / scale}px system-ui`; context.textAlign = "left"; context.fillStyle = "#e2e9db";
        context.fillText(node.name, node.x + radius + 5 / scale, node.y + 4 / scale);
      }
    }
    context.restore(); context.globalAlpha = 1;
  }
  function xml(value) {
    return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "\ufffd")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function svg(view, description = "European Go player connections") {
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
      fillText(text, x, y) {
        const size = parseFloat(this.font), anchor = this.textAlign === "center" ? "middle" : "start";
        elements.push(`<text x="${x}" y="${y}" fill="${xml(this.fillStyle)}" opacity="${this.globalAlpha}" font-family="system-ui,sans-serif" font-size="${size}" text-anchor="${anchor}">${xml(text)}</text>`);
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
  const api = {render, svg, paintBackground};
  root.EgdRenderer = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
