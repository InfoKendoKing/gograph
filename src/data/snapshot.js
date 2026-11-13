/* One snapshot per worker, with a small cache of date-filtered models in the UI. */
(function (root) {
  "use strict";
  if (typeof document === "undefined" && typeof importScripts === "function") {
    importScripts("../graph/model.js?v=12e8f4f91e56");
    let snapshot;
    root.onmessage = ({data}) => {
      if (data.type === "init") { snapshot = data.snapshot; return; }
      try { root.postMessage({id: data.id, model: root.EgdGraph.buildModel(snapshot, data.start, data.end)}); }
      catch (error) { root.postMessage({id: data.id, error: error.message}); }
    };
    return;
  }
  const workerUrl = root.document?.currentScript?.src || "src/data/snapshot.js";
  function createSource(snapshot) {
    let worker = null, sequence = 0, disposed = false;
    const cache = new Map(), pending = new Map();
    const fallback = request => setTimeout(() => {
      if (disposed) return request.resolve(null);
      try { request.resolve(root.EgdGraph.buildModel(snapshot, request.start, request.end)); }
      catch (error) { request.reject(error); }
    }, 0);
    try {
      worker = new Worker(workerUrl);
      worker.onmessage = ({data}) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error)); else request.resolve(data.model);
      };
      worker.onerror = event => {
        event.preventDefault(); worker.terminate(); worker = null;
        for (const request of pending.values()) fallback(request);
        pending.clear();
      };
      worker.postMessage({type: "init", snapshot});
    } catch { worker?.terminate(); worker = null; }
    return {
      getModel(start = "", end = "") {
        if (disposed) return Promise.resolve(null);
        const key = JSON.stringify([start, end]);
        if (cache.has(key)) {
          const result = cache.get(key); cache.delete(key); cache.set(key, result); return result;
        }
        const result = new Promise((resolve, reject) => {
          const request = {resolve, reject, start, end}, id = ++sequence;
          if (worker) { pending.set(id, request); worker.postMessage({type: "model", id, start, end}); }
          else fallback(request);
        });
        cache.set(key, result);
        // The full model supplies global player search; retain three other ranges.
        for (const cachedKey of cache.keys()) {
          if (cache.size <= 4) break;
          if (cachedKey !== '["",""]') cache.delete(cachedKey);
        }
        result.catch(() => { if (cache.get(key) === result) cache.delete(key); });
        return result;
      },
      dispose() {
        disposed = true; worker?.terminate();
        for (const request of pending.values()) request.resolve(null);
        pending.clear(); cache.clear();
      }
    };
  }
  async function loadSnapshot(url, compressedUrl = "") {
    async function read(address, compressed = false) {
      const response = await root.fetch(address, {cache: "no-cache"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!compressed) return root.EgdGraph.validateSnapshot(await response.json());
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Some hosts transparently decode gzip through Content-Encoding. Check the
      // bytes so those responses and ordinary static .gz files both work.
      const stream = new Blob([bytes]).stream();
      const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
      return root.EgdGraph.validateSnapshot(await new Response(decoded).json());
    }
    if (compressedUrl && typeof root.DecompressionStream === "function") {
      try { return await read(compressedUrl, true); }
      catch { /* Older deployments or broken archives can use the plain snapshot. */ }
    }
    return read(url);
  }
  root.EgdData = {createSource, loadSnapshot};
})(globalThis);
