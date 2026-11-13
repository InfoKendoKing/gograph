(function (root) {
  "use strict";
  function create({onHighlight, canHighlight = () => true, delay = 250, schedule = setTimeout, cancel = clearTimeout}) {
    let target = null, active = null, point = null, timer = null;
    function clear() {
      if (timer !== null) cancel(timer);
      timer = null; target = active = point = null;
      onHighlight(null, null);
    }
    function update(node, position) {
      if (node && node === target) {
        point = position;
        if (active === node) onHighlight(node, point);
        return;
      }
      clear();
      if (!node) return;
      target = node; point = position;
      timer = schedule(() => {
        timer = null;
        if (!canHighlight(node, point)) { clear(); return; }
        active = node; onHighlight(node, point);
      }, delay);
    }
    return {update, clear};
  }
  root.EgdHover = {create};
  if (typeof module !== "undefined") module.exports = {create};
})(globalThis);
