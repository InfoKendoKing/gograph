/* PIN-based player links and browser sharing, with a manual-copy fallback. */
(function (root) {
  "use strict";
  function normalisePin(pin) {
    if (typeof pin !== "string" || !/^\d{1,10}$/.test(pin) || Number(pin) < 1 || Number(pin) > 2147483647) {
      throw new Error("Player PIN must be a positive numeric EGD PIN.");
    }
    return String(Number(pin)).padStart(8, "0");
  }
  function playerPin(url) {
    const pin = new URL(url).searchParams.get("pin");
    return pin === null ? null : normalisePin(pin);
  }
  function profileUrl(url, pin) {
    const link = new URL(url);
    link.search = ""; link.hash = "";
    link.searchParams.set("pin", normalisePin(pin));
    return link.href;
  }
  function findPlayer(players, pin) {
    const key = normalisePin(pin);
    return players.find(player => normalisePin(player.pin) === key);
  }
  async function shareProfile(url, player, navigator = root.navigator) {
    const link = profileUrl(url, player.pin);
    if (typeof navigator?.share === "function") {
      try {
        await navigator.share({title: `${player.name} · European Go Graph`, url: link});
        return {url: link, method: "shared"};
      } catch (error) {
        if (error.name === "AbortError") return {url: link, method: "cancelled"};
      }
    }
    if (typeof navigator?.clipboard?.writeText === "function") {
      try {
        await navigator.clipboard.writeText(link);
        return {url: link, method: "copied"};
      } catch { /* Show a selectable URL when clipboard permission is unavailable. */ }
    }
    return {url: link, method: "manual"};
  }
  async function shareImage(blob, player, navigator = root.navigator, FileType = root.File) {
    if (!FileType || typeof navigator?.share !== "function" || typeof navigator?.canShare !== "function") return {method: "download"};
    const file = new FileType([blob], `european-go-${player.pin}.png`, {type: "image/png"});
    try {
      if (!navigator.canShare({files: [file]})) return {method: "download"};
      await navigator.share({title: `${player.name} · European Go Graph`, files: [file]});
      return {method: "shared"};
    } catch (error) {return {method: error.name === "AbortError" ? "cancelled" : "download"};}
  }
  const api = {normalisePin, playerPin, profileUrl, findPlayer, shareProfile, shareImage};
  root.EgdSharing = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
