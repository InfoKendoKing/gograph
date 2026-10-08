/* Barnes–Hut repulsion keeps large player graphs practical to arrange. */
(function (root) {
  "use strict";
  function createNodes(players, positions = {}) {
    const spread = Math.sqrt(players.length) * 30;
    return players.map((player, i) => {
      const angle = i * 2.399963, radius = Math.sqrt((i + 0.5) / Math.max(1, players.length)) * spread;
      const saved = positions[player.pin];
      return {...player, x: saved ? saved[0] : Math.cos(angle) * radius, y: saved ? saved[1] : Math.sin(angle) * radius,
        vx: 0, vy: 0, fx: 0, fy: 0, radius: 5 + Math.min(10, Math.sqrt(player.games))};
    });
  }
  function treeFor(nodes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x); minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x); maxY = Math.max(maxY, node.y);
    }
    const size = Math.max(1, maxX - minX, maxY - minY) + 1;
    function branch(x, y, size) { return {x, y, size, count: 0, cx: 0, cy: 0, children: null, bodies: []}; }
    const tree = branch(minX - 0.5, minY - 0.5, size);
    function insert(cell, node, depth) {
      cell.count++; cell.cx += node.x; cell.cy += node.y;
      if (!cell.children && (!cell.bodies.length || depth >= 24)) { cell.bodies.push(node); return; }
      const half = cell.size / 2;
      if (!cell.children) {
        cell.children = [branch(cell.x, cell.y, half), branch(cell.x + half, cell.y, half),
          branch(cell.x, cell.y + half, half), branch(cell.x + half, cell.y + half, half)];
        for (const previous of cell.bodies) insert(cell.children[(previous.x >= cell.x + half ? 1 : 0) + (previous.y >= cell.y + half ? 2 : 0)], previous, depth + 1);
        cell.bodies = [];
      }
      insert(cell.children[(node.x >= cell.x + half ? 1 : 0) + (node.y >= cell.y + half ? 2 : 0)], node, depth + 1);
    }
    for (const node of nodes) insert(tree, node, 0);
    return tree;
  }
  function step(nodes, links, dragged = null) {
    if (!nodes.length) return 0;
    const tree = treeFor(nodes);
    function repel(node, cell) {
      if (!cell.count) return;
      if (!cell.children) {
        for (const other of cell.bodies) {
          if (other === node) continue;
          let dx = other.x - node.x, dy = other.y - node.y;
          if (dx === 0 && dy === 0) { dx = node.pin < other.pin ? 0.01 : -0.01; dy = dx; }
          const distance = Math.max(1, Math.hypot(dx, dy));
          const force = 1500 / Math.max(100, distance * distance) + Math.max(0, node.radius + other.radius + 8 - distance) * 0.08;
          node.fx -= dx / distance * force; node.fy -= dy / distance * force;
        }
        return;
      }
      const dx = cell.cx / cell.count - node.x, dy = cell.cy / cell.count - node.y, squared = dx * dx + dy * dy;
      const contains = node.x >= cell.x && node.x < cell.x + cell.size && node.y >= cell.y && node.y < cell.y + cell.size;
      if (!contains && cell.size * cell.size < 0.64 * squared && squared > 1600) {
        const distance = Math.sqrt(squared), force = 1500 * cell.count / squared;
        node.fx -= dx / distance * force; node.fy -= dy / distance * force;
      } else for (const child of cell.children) repel(node, child);
    }
    for (const node of nodes) { node.fx = -node.x * 0.0007; node.fy = -node.y * 0.0007; repel(node, tree); }
    for (const link of links) {
      const dx = link.b.x - link.a.x, dy = link.b.y - link.a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const strength = 0.004 * Math.sqrt(link.games), force = strength * (distance - 110 / Math.sqrt(link.games));
      const fx = dx / distance * force, fy = dy / distance * force;
      link.a.fx += fx; link.a.fy += fy; link.b.fx -= fx; link.b.fy -= fy;
    }
    let movement = 0;
    for (const node of nodes) {
      if (node === dragged) continue;
      node.vx = (node.vx + node.fx) * 0.82; node.vy = (node.vy + node.fy) * 0.82;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 12) { node.vx *= 12 / speed; node.vy *= 12 / speed; }
      node.x += node.vx; node.y += node.vy;
      movement += Math.hypot(node.vx, node.vy);
    }
    return movement / nodes.length;
  }
  const api = {createNodes, step};
  root.EgdLayout = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
