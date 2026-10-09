(function (root) {
  "use strict";
  const standard = ["#69b4ff", "#ffac69", "#9ae5bd", "#f58fc5", "#e9db78", "#77e0df", "#b19cff", "#fa817e", "#bded84", "#eae8df", "#eebccf", "#caa07a", "#9dcef5", "#67c9a3", "#f7ce9e", "#dba4ed"];
  // Okabe–Ito categorical colours, with white replacing black on the dark graph.
  const accessible = ["#56b4e9", "#e69f00", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#f5f5f5"];
  // The brighter portion of Cividis: increasing lightness conveys ordered values.
  const sequential = ["#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"];
  function countryColour(index, colourBlindFriendly = false) {
    if (!Number.isInteger(index) || index < 0) return "#9ca3af";
    return colourBlindFriendly ? accessible[index % accessible.length]
      : standard[index] || `hsl(${(index * 137.508) % 360} 70% 70%)`;
  }
  function sequentialColour(value) {
    if (!Number.isFinite(value)) return "#9ca3af";
    const position = Math.max(0, Math.min(1, value)) * (sequential.length - 1);
    const index = Math.min(sequential.length - 2, Math.floor(position)), fraction = position - index;
    const a = sequential[index], b = sequential[index + 1];
    return "#" + [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - fraction)
      + parseInt(b.slice(offset, offset + 2), 16) * fraction).toString(16).padStart(2, "0")).join("");
  }
  function rankChangeColour(change, colourBlindFriendly = false) {
    if (!Number.isFinite(change)) return "#9ca3af";
    if (change > 0) return colourBlindFriendly ? "#56b4e9" : "#75be64";
    if (change < 0) return colourBlindFriendly ? "#e69f00" : "#fa817e";
    return colourBlindFriendly ? "#f5f5f5" : "#eae8df";
  }
  const api = {countryColour, sequentialColour, rankChangeColour};
  root.EgdColours = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
