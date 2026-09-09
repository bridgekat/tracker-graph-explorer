import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

/* One file is the point: the page has to open from file://, take a graph.json dropped
   on it, and work with no server and nothing to install. Svelte and marked are
   build-time dependencies; what ships is still index.html and nothing else. */
export default defineConfig({
  root: "src",
  plugins: [svelte(), viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    reportCompressedSize: false,
  },
});
