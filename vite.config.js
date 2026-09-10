import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { compact } from "./src/lib/format.js";

/* What a build may bake into the page, read from the environment, so that a job which
   has just exported a graph can publish a page that opens on that graph and links every
   declaration to its own API documentation:

     TRACKER_GRAPH=graph.json TRACKER_DOCS=docs npm run build

   With neither, nothing changes: the page is still the empty drawing that waits for a
   graph to be dropped on it, and it still links nowhere. With a graph, the page becomes
   a page about that graph - the ways of loading another one go, and a way of taking this
   one away arrives in their place - which is why a docs root on its own is refused: it
   describes one project's declarations, and there would be nothing to say it about.

   The graph is compressed on the way in, eagerly, because the build pays for that once
   and every reader of the page would pay for the size of it forever: the compact form of
   the contract (src/lib/format.js), gzipped, in base64, in a `<script>` no browser will
   execute. On the plan of a large project that is a two-megabyte page rather than a
   ninety-megabyte one - the edges are nearly the whole of a graph and nearly the whole
   of each one is two declaration ids spelled out, which the compact form says as a pair
   of numbers and gzip then says again for almost nothing. `data-encoding` names what was
   done, so a page built before this still reads, and base64 is what survives being HTML.

   The root of the doc-gen4 site is a `<meta>`, and needs nothing done to it. */
function bake() {
  const path = process.env.TRACKER_GRAPH || "";
  const docs = (process.env.TRACKER_DOCS || "").replace(/\/+$/, "");
  if (docs && !path)
    throw new Error("TRACKER_DOCS is a place to link this project's declarations to, and "
      + "without TRACKER_GRAPH there are none in the page. Pass a graph as well, or neither.");
  const MB = (n) => (n / 1048576).toFixed(2);
  let graph = "";
  if (path) {
    const json = Buffer.from(JSON.stringify(compact(JSON.parse(readFileSync(path, "utf8")))), "utf8");
    graph = gzipSync(json, { level: 9 }).toString("base64");
    console.log(`${path} — ${MB(statSync(path).size)}MB read, ${MB(json.length)}MB compact, `
      + `${MB(graph.length)}MB baked in`);
  }
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
              attrs: {
                type: "text/plain",
                id: "bakedGraph",
                "data-name": basename(path),
                "data-encoding": "gzip+base64",
              },
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
