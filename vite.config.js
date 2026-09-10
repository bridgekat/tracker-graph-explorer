import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/* What a build may bake into the page, read from the environment, so that a job which
   has just exported a graph can publish a page that opens on that graph and links every
   declaration to its own API documentation:

     TRACKER_GRAPH=graph.json TRACKER_DOCS=docs npm run build

   With neither, nothing changes: the page is still the empty drawing that waits for a
   graph to be dropped on it, and it still links nowhere. With a graph, the page becomes
   a page about that graph — the ways of loading another one go, and a way of taking this
   one away arrives in their place — which is why a docs root on its own is refused: it
   describes one project's declarations, and there would be nothing to say it about.

   What is baked in goes into the HTML rather than into the script — the graph as JSON in
   a `<script type="application/json">`, the root of the doc-gen4 site as a `<meta>` — so
   that it stays legible in the built file, and so that the graph is read by JSON.parse
   rather than by the JavaScript parser, which is the faster of the two. It is
   re-serialised on the way in, which drops the indentation `tracker graph` prints. `<`
   is escaped because the one thing that ends a script element is `</script`. */
function bake() {
  const path = process.env.TRACKER_GRAPH || "";
  const docs = (process.env.TRACKER_DOCS || "").replace(/\/+$/, "");
  if (docs && !path)
    throw new Error("TRACKER_DOCS is a place to link this project's declarations to, and "
      + "without TRACKER_GRAPH there are none in the page. Pass a graph as well, or neither.");
  const graph = path
    ? JSON.stringify(JSON.parse(readFileSync(path, "utf8"))).replaceAll("<", "\\u003c")
    : "";
  if (path) console.log(`${path} — ${(graph.length / 1048576).toFixed(2)}MB baked in`);
  if (docs) console.log(`API docs — ${docs}`);
  return {
    name: "bake",
    transformIndexHtml: {
      order: "post",
      handler: (html) => ({
        html,
        tags: [
          ...(docs
            ? [{ tag: "meta", attrs: { name: "docs-root", content: docs }, injectTo: "head" }]
            : []),
          ...(graph
            ? [{
              tag: "script",
              attrs: { type: "application/json", id: "bakedGraph", "data-name": basename(path) },
              children: graph,
              injectTo: "body",
            }]
            : []),
        ],
      }),
    },
  };
}

/* One file is the point: the page is published as an index.html with nothing beside it
   to fetch and nothing to install, and a copy of it is a copy of the whole thing. Svelte
   and marked are build-time dependencies; what ships is still index.html and nothing
   else. */
export default defineConfig({
  root: "src",
  plugins: [tailwindcss(), svelte(), viteSingleFile(), bake()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    reportCompressedSize: false,
  },
});
