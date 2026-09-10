import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { app, readGraph, readText } from "./lib/state.svelte.js";
import { bakedName, hasBaked, loadBaked } from "./lib/site.js";

/* The system preference is resolved to a class once, before anything mounts, so the
   tokens, Tailwind's dark variant and the canvas all read the same single signal.
   After this the theme button owns the class. */
if (matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.add("dark");

mount(App, { target: document.getElementById("app") });

/* A graph baked in by the build is the page's whole subject, and the only graph it
   shows: the query string cannot swap it out any more than the file picker can.
   Otherwise, a graph named in the query string, so the page can be published beside one:
   index.html?graph=graph.json. Nothing is fetched unless the URL asks for it. */
const q = new URLSearchParams(location.search).get("graph");
if (hasBaked) {
  loadBaked()
    .then((g) => readGraph(g, bakedName))
    .catch((e) => { app.error = `Could not read the graph built into this page. ${e.message || ""}`; });
} else if (q) {
  fetch(q)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.text();
    })
    .then((t) => readText(t, q.split("/").pop() || q))
    .catch((e) => { app.error = `Could not read ${q}. ${e.message || ""}`; });
}
