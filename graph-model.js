/* Shared data logic: usable in the browser and in the dependency-free Node checks. */
(function (root) {
  "use strict";
  function validateSnapshot(snapshot) {
    if (!snapshot || snapshot.version !== 1 || typeof snapshot.description !== "string" || !Array.isArray(snapshot.games)) {
      throw new Error("Expected a version 1 EGD snapshot with a description and games.");
    }
    for (const game of snapshot.games) {
      if (!game || typeof game.tournament !== "string" || typeof game.round !== "string") throw new Error("Invalid game record.");
      if (game.date != null) {
        if (typeof game.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(game.date)) throw new Error("Invalid game date.");
        const date = new Date(game.date + "T00:00:00Z");
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== game.date) throw new Error("Invalid game date.");
      }
      for (const player of [game.first, game.second]) {
        if (!player || !["pin", "name", "country", "grade"].every(key => typeof player[key] === "string") || !/^\d+$/.test(player.pin)) {
          throw new Error("Invalid player record or EGD PIN.");
        }
      }
    }
    if (snapshot.layout != null) {
      const layout = snapshot.layout;
      if (layout.version !== 1 || !layout.positions || typeof layout.positions !== "object" || Array.isArray(layout.positions)
          || !Number.isInteger(layout.maxPlayers) || layout.maxPlayers < 1 || layout.maxPlayers > 15000
          || !Number.isInteger(layout.minGames) || layout.minGames < 1 || layout.minGames > 100000
          || !["country", "rank", "same-country", "games"].includes(layout.colour) || typeof layout.names !== "boolean"
          || !["country", "start", "end"].every(key => typeof layout[key] === "string")) {
        throw new Error("Invalid saved graph layout.");
      }
      for (const date of [layout.start, layout.end]) {
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z"))
            || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)) throw new Error("Invalid saved layout date.");
      }
      if (layout.start && layout.end && layout.start > layout.end) throw new Error("Invalid saved layout date range.");
      for (const [pin, point] of Object.entries(layout.positions)) {
        if (!/^\d+$/.test(pin) || !Array.isArray(point) || point.length !== 2 || !point.every(n => Number.isFinite(n) && Math.abs(n) <= 10000000)) {
          throw new Error("Invalid saved player position.");
        }
      }
    }
    return snapshot;
  }
  function parseEgd(contents) {
    if (/<!DOCTYPE|<!ENTITY/i.test(contents)) throw new Error("EGD saves must not contain document types or entities.");
    const xml = new DOMParser().parseFromString(contents, "application/xml");
    const element = xml.documentElement;
    if (xml.querySelector("parsererror") || element.tagName !== "egd-games" || element.getAttribute("version") !== "1") {
      throw new Error("This is not a supported .egd save file.");
    }
    function attribute(node, key) {
      if (!node.hasAttribute(key)) throw new Error("Missing " + key + " in EGD save file.");
      return node.getAttribute(key);
    }
    function checkText(node) {
      if (Array.from(node.childNodes).some(child => (child.nodeType === 3 || child.nodeType === 4) && child.textContent.trim())) {
        throw new Error("Unexpected text in EGD save file.");
      }
    }
    checkText(element);
    const games = Array.from(element.children, game => {
      if (game.tagName !== "game" || game.children.length !== 2 || game.children[0].tagName !== "first" || game.children[1].tagName !== "second") {
        throw new Error("Invalid game in EGD save file.");
      }
      checkText(game);
      const player = node => {
        if (node.children.length) throw new Error("Invalid player in EGD save file.");
        checkText(node);
        return Object.fromEntries(["pin", "name", "country", "grade"].map(key => [key, attribute(node, key)]));
      };
      return {tournament: attribute(game, "tournament"), round: attribute(game, "round"), date: game.getAttribute("date"),
        first: player(game.children[0]), second: player(game.children[1])};
    });
    return validateSnapshot({version: 1, description: attribute(element, "description"), games});
  }
  function buildModel(snapshot, start = "", end = "") {
    const players = new Map(), pairs = new Map(), seen = new Set();
    for (const game of snapshot.games) {
      if ((start || end) && (!game.date || (start && game.date < start) || (end && game.date > end))) continue;
      const a = game.first.pin, b = game.second.pin;
      if (a === b) continue;
      const pair = JSON.stringify([a, b].sort());
      const key = JSON.stringify([game.tournament, game.round, pair]);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const player of [game.first, game.second]) {
        if (!players.has(player.pin)) players.set(player.pin, {...player, games: 0, sameCountryGames: 0});
        players.get(player.pin).games++;
      }
      if (!pairs.has(pair)) pairs.set(pair, {a, b, games: 0});
      pairs.get(pair).games++;
    }
    // Use the same player countries as the graph, before any display filtering.
    for (const link of pairs.values()) {
      const first = players.get(link.a), second = players.get(link.b);
      const country = countryKey(first.country);
      if (country && country === countryKey(second.country)) {
        first.sameCountryGames += link.games;
        second.sameCountryGames += link.games;
      }
    }
    for (const player of players.values()) {
      player.sameCountryPercent = countryKey(player.country) ? 100 * player.sameCountryGames / player.games : null;
    }
    return {players: Array.from(players.values()), links: Array.from(pairs.values()), gameCount: seen.size};
  }
  function selectGraph(model, limit, minimum, country = "") {
    const players = model.players.filter(player => !country || player.country === country)
      .sort((a, b) => b.games - a.games || (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0)).slice(0, limit);
    const pins = new Set(players.map(player => player.pin));
    const links = model.links.filter(link => pins.has(link.a) && pins.has(link.b) && link.games >= minimum);
    const connected = new Set(links.flatMap(link => [link.a, link.b]));
    return {players: players.filter(player => connected.has(player.pin)), links};
  }
  function rankValue(grade) {
    const match = /^(\d+)([kdp])$/i.exec(grade);
    if (!match) return null;
    const n = Number(match[1]), unit = match[2].toLowerCase();
    if (n < 1 || n > (unit === "k" ? 30 : 9)) return null;
    return unit === "k" ? 31 - n : unit === "d" ? 30 + n : 40 + n;
  }
  function searchPlayers(players, query) {
    const normalise = value => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    const needle = normalise(query.trim());
    return players.filter(player => normalise(`${player.name} ${player.pin}`).includes(needle))
      .sort((a, b) => Number(normalise(b.name).startsWith(needle)) - Number(normalise(a.name).startsWith(needle))
        || a.name.localeCompare(b.name) || a.pin.localeCompare(b.pin));
  }
  function countryKey(country) {
    const code = country.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? (code === "UK" ? "GB" : code) : null;
  }
  const sameCountryBands = [
    {min: 0, label: "0–<20%", colour: "#617ac7"},
    {min: 20, label: "20–<40%", colour: "#438bb5"},
    {min: 40, label: "40–<60%", colour: "#329d9c"},
    {min: 60, label: "60–<80%", colour: "#75be64"},
    {min: 80, label: "80–100%", colour: "#e9dc55"}
  ];
  function sameCountryBand(percent) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    return sameCountryBands[Math.min(4, Math.floor(percent / 20))];
  }
  const api = {validateSnapshot, parseEgd, buildModel, selectGraph, rankValue, searchPlayers, sameCountryBand, sameCountryBands};
  root.EgdGraph = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
