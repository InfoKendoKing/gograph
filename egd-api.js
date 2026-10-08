/* Read-only EGD GraphQL importer, shared by the browser and Node checks. */
(function (root) {
  "use strict";
  const graph = typeof module !== "undefined" ? require("./graph-model.js") : root.EgdGraph;
  const endpoint = "https://europeangodatabase.eu/api/v2026.02/graphql";
  // EGD currently returns HTTP 500 for variable-based game queries. Values are
  // validated below before being embedded as GraphQL literals.
  const queryFor = (start, end, pin, page) => `{
    games(filter: {dateFrom: ${JSON.stringify(start)}, dateTo: ${JSON.stringify(end)}${pin ? `, pinPlayer: ${Number(pin)}` : ""}}, pagination: {page: ${page}, limit: 100}) {
      total currentPage lastPage hasMorePages
      data {
        id tournamentCode round date pinPlayer1 pinPlayer2
        player1 { pin firstName lastName countryCode grade }
        player2 { pin firstName lastName countryCode grade }
      }
    }
  }`;

  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value + "T00:00:00Z"))
      && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  }
  function player(record, pin) {
    if (!Number.isInteger(pin) || pin < 1) throw new Error("The API returned an invalid player PIN.");
    if (record && record.pin !== pin) throw new Error("The API returned inconsistent player details.");
    return {pin: String(pin).padStart(8, "0"),
      name: record ? [record.firstName, record.lastName].filter(Boolean).join(" ").trim() || `PIN ${pin}` : `PIN ${pin}`,
      country: record?.countryCode || "", grade: record?.grade || ""};
  }
  function convertGame(record) {
    if (!record || !Number.isInteger(record.id) || typeof record.tournamentCode !== "string"
        || !Number.isInteger(record.round)) throw new Error("The API returned an invalid game.");
    let date = null;
    if (record.date != null && record.date !== "") {
      if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(record.date)
          || !validDate(record.date.slice(0, 10))) throw new Error("The API returned an invalid game date.");
      // EGD sends database timestamps; retain the recorded calendar day.
      date = record.date.slice(0, 10);
    }
    return {tournament: record.tournamentCode, round: String(record.round), date,
      first: player(record.player1, record.pinPlayer1), second: player(record.player2, record.pinPlayer2)};
  }
  async function fetchGames({token, start, end, pin = "", maxGames = 10000, signal, onProgress = () => {}, fetchImpl = root.fetch}) {
    if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) throw new Error("Enter an EGD read-only API token.");
    if (!validDate(start) || !validDate(end) || start > end) throw new Error("Choose a valid date range, with From on or before To.");
    if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 100000) throw new Error("Maximum games must be between 1 and 100000.");
    if (pin && (!/^\d+$/.test(pin) || Number(pin) < 1 || Number(pin) > 2147483647)) throw new Error("Player PIN must be a positive numeric EGD PIN.");
    const games = [], seen = new Set();
    let total = null, changed = false, capped = false, missingPlayers = 0;
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener("abort", abort, {once: true});
      const timeout = setTimeout(() => controller.abort(new Error("The API request timed out. Try a shorter date range.")), 30000);
      let response, body;
      try {
        response = await fetchImpl(endpoint, {method: "POST", headers: {Authorization: "Bearer " + token.trim(), "Content-Type": "application/json", Accept: "application/json"},
          body: JSON.stringify({query: queryFor(start, end, pin, page)}),
          signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer"});
        if (response.status === 401 || response.status === 403) throw new Error("EGD rejected this token. Check its read scope and expiry.");
        if (response.status === 429) throw new Error("EGD's request limit was reached. Wait before trying again, or choose a shorter date range.");
        if (!response.ok) throw new Error(`EGD returned HTTP ${response.status}. Try again later.`);
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error instanceof TypeError) throw new Error("Could not reach the EGD API. Check your connection; the API must allow requests from this website.");
        throw error;
      } finally {
        clearTimeout(timeout); signal?.removeEventListener("abort", abort);
      }
      signal?.throwIfAborted();
      if (body.errors?.length) throw new Error("EGD returned GraphQL errors. Check the token's access or try again later. The current dataset has been kept.");
      const result = body.data?.games;
      if (!result || !Array.isArray(result.data) || !Number.isInteger(result.total) || result.total < 0
          || result.currentPage !== page || !Number.isInteger(result.lastPage) || result.lastPage < page
          || typeof result.hasMorePages !== "boolean" || (result.hasMorePages && !result.data.length)) {
        throw new Error("EGD returned unexpected pagination data. The current dataset has been kept.");
      }
      if (total !== null && total !== result.total) changed = true;
      total = result.total;
      const before = games.length;
      for (const record of result.data) {
        const game = convertGame(record);
        if (game.date && (game.date < start || game.date > end)) throw new Error("EGD returned games outside the requested dates. The current dataset has been kept.");
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        games.push(game);
        if (!record.player1 || !record.player2) missingPlayers++;
        if (games.length === maxGames) { capped = result.hasMorePages || seen.size < total; break; }
      }
      onProgress({loaded: games.length, total, page, lastPage: result.lastPage});
      if (capped || !result.hasMorePages) break;
      if (before === games.length || page >= result.lastPage) throw new Error("EGD pagination did not advance. The current dataset has been kept.");
    }
    let description = `EGD GraphQL · ${start} to ${end}${pin ? ` · player PIN ${pin}` : ""} · ${games.length.toLocaleString()} games`;
    if (capped) description += ` · INCOMPLETE: stopped at the ${maxGames.toLocaleString()}-game download limit (${total.toLocaleString()} reported)`;
    if (changed || (!capped && games.length !== total)) description += " · INCOMPLETE: API results changed or overlapped during pagination; download again for a fresh copy";
    if (missingPlayers) description += ` · ${missingPlayers} games have missing player details`;
    description += " · API countries and ranks are current player details";
    return graph.validateSnapshot({version: 1, description, games});
  }
  const api = {fetchGames, convertGame};
  root.EgdApi = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
