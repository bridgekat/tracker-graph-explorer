/* The layout engine: ELK's layered algorithm (the Eclipse Layout Kernel, compiled to
   JavaScript as elkjs), run in a Web Worker.

   What ships is one file, so there is no worker script beside it to fetch: the worker's
   source is inlined here as a string and started from a blob URL. Where a worker cannot
   be made at all, the same source is evaluated on the main thread; the
   script exports a stand-in with the worker's interface for exactly that case. */
import ELK from "elkjs/lib/elk-api.js";
import workerSource from "elkjs/lib/elk-worker.min.js?raw";

function mainThreadWorker() {
  const module = { exports: {} };
  new Function("module", "exports", workerSource)(module, module.exports);
  return new module.exports.Worker();
}

function makeWorker() {
  try {
    const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    return new Worker(url);
  } catch {
    return mainThreadWorker();
  }
}

let elk = null;

/* lay out an ELK JSON graph; resolves to the same graph with positions filled in */
export function layoutGraph(graph) {
  elk ??= new ELK({ workerFactory: makeWorker, algorithms: ["layered"] });
  return elk.layout(graph);
}
