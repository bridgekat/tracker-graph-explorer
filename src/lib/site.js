/* What the build baked into this page, if anything: a graph, so that a published copy
   opens on one rather than waiting to be given one, and the root of a doc-gen4 site, so
   that a declaration can link to its own API documentation. Both are written into the
   HTML by the `bake` plugin in vite.config.js and read back from it here; a page built
   without them has neither, and nothing else in the app behaves differently.

   A page built with one is a page about that graph, so it is the only graph it will
   show: the ways in — the file picker, the drop, the paste, `?graph=` — are gone, and
   what stands where they were is a way to take the graph back out again. */

const baked = document.getElementById("bakedGraph");
export const bakedGraph = baked ? baked.textContent : "";
export const bakedName = baked?.dataset.name || "graph.json";

/* the graph the page was built around, handed back as the file it was built from — the
   same JSON, minus the indentation the build dropped on the way in */
export function downloadGraph() {
  const url = URL.createObjectURL(new Blob([bakedGraph], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = bakedName;
  a.click();
  /* not before the browser has started reading it */
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const meta = document.querySelector('meta[name="docs-root"]');
export const docsRoot = meta ? meta.content.replace(/\/+$/, "") : "";

/* doc-gen4 lays its pages out by module — Numlib/Analysis/Sobolev/Domain.html — and
   anchors every declaration on a page by its full name. Those are exactly what a graph
   calls a group and a node id, so the link needs nothing the page does not already have.
   What it does need is for the thing to be in the library: a declaration still open has
   no anchor, and a group whose declarations are all open has no page, so the caller asks
   only for the ones that are attached. */
export const moduleDocs = (group) => `${docsRoot}/${group}.html`;
export const declDocs = (group, id) => `${moduleDocs(group)}#${encodeURIComponent(id)}`;
