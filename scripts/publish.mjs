/* Vite writes dist/index.html; the project's artifact is index.html at the root, which
   is the file that gets served — on its own, or beside a graph for it to open. */
import { copyFileSync, statSync } from "node:fs";

copyFileSync("dist/index.html", "index.html");
console.log(`index.html — ${(statSync("index.html").size / 1048576).toFixed(2)}MB`);
