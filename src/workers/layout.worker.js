"use strict";
importScripts("../graph/layout.js?v=b2206a3f054f");
let nodes = [], links = [], nodeMap = new Map(), version = 0;
onmessage = ({data}) => {
  if (data.type === "init") {
    version = data.version; nodes = data.nodes;
    nodeMap = new Map(nodes.map(node => [node.pin, node]));
    links = data.links.map(link => ({...link, a: nodeMap.get(link.a), b: nodeMap.get(link.b)}));
    return;
  }
  if (data.version !== version) return;
  const dragged = data.drag && nodeMap.get(data.drag.pin);
  if (dragged) { dragged.x = data.drag.x; dragged.y = data.drag.y; dragged.vx = dragged.vy = 0; }
  const movement = EgdLayout.step(nodes, links, dragged, data.repulsion, data.gameAttraction);
  const positions = new Float64Array(nodes.length * 4);
  nodes.forEach((node, i) => positions.set([node.x, node.y, node.vx, node.vy], i * 4));
  postMessage({version, movement, positions}, [positions.buffer]);
};
