/* Vite writes dist/index.html; the project's artifact is index.html at the root, which
   is the file you open, drop a graph on, or publish beside one. */
import { copyFileSync, statSync } from "node:fs";

copyFileSync("dist/index.html", "index.html");
console.log(`index.html — ${(statSync("index.html").size / 1048576).toFixed(2)}MB`);
