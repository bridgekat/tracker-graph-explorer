/* What the build baked into this page, if anything: a graph, so that a published copy
   opens on one rather than waiting to be given one, and the root of a doc-gen4 site, so
   that a declaration can link to its own API documentation. Both are written into the
   HTML by the `bake` plugin in vite.config.js and read back from it here; a page built
   without them has neither, and nothing else in the app behaves differently.

   The graph rides in compressed: `tracker graph` as it is, gzipped, in base64. On the
   graph of every declaration of a large project that is a six-megabyte page rather than
   a seventeen-megabyte one, and what the page holds afterwards is the four megabytes of
   bytes rather than the JSON. It is inflated when it is wanted — once on the way in, and
   again if the page is asked for the file back.

   A page built with one is a page about that graph, so it is the only graph it will
   show: the ways in — the file picker, the drop, the paste, `?graph=` — are gone, and
   what stands where they were is a way to take the graph back out again. */
import { bytesFromBase64, inflateJson } from "./format.js";

const baked = document.getElementById("bakedGraph");
export const hasBaked = !!baked;
export const bakedName = baked?.dataset.name || "graph.json";

/* what the element holds, as the build says it wrote it; a build that baked the JSON
   itself sets no encoding, and is read as it always was */
const bytes = baked?.dataset.encoding === "gzip+base64"
  ? bytesFromBase64(baked.textContent.trim())
  : null;

/* the graph the page was built around, in the shape every reader in the page takes */
export async function loadBaked() {
  if (!baked) return null;
  return bytes ? await inflateJson(bytes) : JSON.parse(baked.textContent);
}

/* the graph handed back as the file it was built from — the same JSON, minus the
   indentation the build dropped on the way in */
export async function downloadGraph() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(await loadBaked())], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = bakedName;
  a.click();
  /* not before the browser has started reading it */
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const meta = document.querySelector('meta[name="docs-root"]');
export const docsRoot = meta ? meta.content.replace(/\/+$/, "") : "";

/* doc-gen4 lays its pages out by module — Numlib/Analysis/Sobolev/Domain.html for the
   module named Numlib.Analysis.Sobolev.Domain — and anchors every declaration on a page
   by its id, so the link needs nothing the page does not already have. What it does need
   is for the thing to be in the library: a declaration still open has no anchor, and a
   module that does not exist yet has no page, so the caller asks only for the ones that
   are there. */
export const moduleDocs = (module) => `${docsRoot}/${module.split(".").join("/")}.html`;
export const declDocs = (module, id) => `${moduleDocs(module)}#${encodeURIComponent(id)}`;
