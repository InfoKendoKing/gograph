# European Go Graph

A static browser app for exploring connections between players in European Go Database (EGD) tournament games. Dots are players, lines join opponents, and thicker lines represent more games together.

## Run locally

From this directory, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. Stop the server with **Ctrl+C**.

There is no package installation or build step. Serve the directory over HTTP: opening `index.html` directly does not reliably support dataset fetching or workers.

## Explore the graph

- Search by name or EGD PIN. Search covers every participating player in the loaded snapshot. Hidden results offer **Reveal player and clear filters** before changing the view.
- Filter by countries, dates, rank range, player limit, or minimum games between opponents. The graph shows connections between qualifying players; isolated players are omitted.
- Rank filters use the latest recorded tournament-declared rank within the selected dates. Players with unknown ranks appear when both rank limits are cleared.
- Select a player, then choose **Show player and opponents** to isolate their neighbourhood. **Back to filtered graph** restores the wider view.
- Open **Find a connection between two players** to find the fewest opponent connections. Use suggested names, unique full names, or PINs. Paths respect the current date, country, rank, game-count, and player-limit filters. A missing path does not imply that the players are disconnected in all EGD data.
- Drag the background or right-drag to pan, scroll or pinch to zoom, and drag a dot to arrange it. Keyboard controls on the graph include arrow keys to pan, `+`/`-` to zoom, and `Home` to fit.
- Layout simulation pauses after sustained low movement, with a longer CPU-saving limit for graphs that keep moving. **Resume** or a force adjustment restarts it. Reduced-motion preferences are respected.

## Save, open, and export

**Save / Export → Save arranged view** downloads `games.json`. It contains the complete loaded dataset plus positions, filters, selected player, zoom, and neighbourhood/path settings. Clearing a date saves an unrestricted date boundary.

Use **Open saved view…** to restore a file. The file is read locally in the browser. Invalid files leave the active graph intact. Saved views restore paused so positions remain stable.

PNG and SVG exports capture the displayed view. GEXF exports the displayed graph for Gephi. Player details also provide shareable profile links and downloadable player graph images.

## Dataset coverage

<!-- dataset-summary:start -->
The included snapshot contains **151,923 games** involving **11,096 participating players**. Returned game dates run from **2023-01-01** through **2026-11-08**. The API was queried for **2023-01-01 through 2026-11-13**, with **151,923 games** reported by the API. Downloaded at `2026-11-13T11:25:32.954Z`.
<!-- dataset-summary:end -->

The source is the [European Go Database](https://europeangodatabase.eu/v2). The snapshot contains tournament encounter records, player PINs, names, countries, historical declared ranks, and available before/after tournament GoR values. It does not contain SGF move sequences or every player in EGD's registry: player coverage comes from the downloaded games.

Ranks and ratings describe the tournament encounter. Country and name fields come from player details supplied at download time. Blank ranks or missing details remain unavailable rather than being replaced with a player's current rank.

The date interval describes the API request and the dates of returned records. Late submissions or corrections can change EGD after a refresh. Display filters may show fewer players and games than the snapshot totals; the default display cap is 15,000 players.

## Refresh the dataset

Maintainer downloads happen outside the browser, there is no API-import panel. Normal viewing needs no token.

For a future refresh, use the read-only importer exported by `egd-api.js` from Node.js 22 or newer. Its `fetchGames` function accepts a read-only `token`, inclusive `start` and `end` dates (`YYYY-MM-DD`), `maxGames`, an optional player `pin`, an abort `signal`, an `onProgress` callback, and `requestTimeoutMs` (30 seconds by default, up to 120 seconds for large requests). Omit `pin` to include all players' games in the requested period. The default download cap is 10,000 games; a complete multi-year refresh must explicitly raise `maxGames` (up to 1,000,000).

Keep tokens and temporary download scripts outside the repository. Do not replace the published dataset if the importer marks the result `INCOMPLETE`. Verify the API-reported total and retain the published `layout` if existing positions should be preserved. The `coverage` metadata in the included snapshot records this refresh's requested interval, API total, download time, and monthly counts.

## Compressed loading and hosting

`data/games.json` is the editable source. `data/games.json.gz` is a generated, lossless compressed copy. Supported browsers load the smaller archive and decompress it locally. If decompression is unavailable or the archive cannot be loaded or validated, the app falls back to the JSON file.

This works with the Python server above and ordinary static hosting, server-side compression is optional. Hosts that automatically decode gzip are supported too. Publish both dataset files, the HTML/CSS/JavaScript files, and `flags/` together. Regenerate the compressed copy whenever the source JSON changes so both copies stay in sync.

## Code map

- `viewer.js`: controls, selection, graph state, and exports.
- `graph-model.js`: snapshot validation, statistics, filters, search, and shortest paths.
- `graph-data.js`: compressed loading, cached models, and model-building worker.
- `graph-layout.js` / `graph-layout-worker.js`: force simulation and settling.
- `graph-renderer.js`: shared canvas and SVG rendering.
- `egd-api.js`: read-only API download and conversion for maintainer refreshes.

Flag assets are bundled locally, attribution and licensing are in [flags/README.md](flags/README.md).
