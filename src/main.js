import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { app, readText } from "./lib/state.svelte.js";

/* The system preference is resolved to a class once, before anything mounts, so the
   tokens, Tailwind's dark variant and the canvas all read the same single signal.
   After this the theme button owns the class. */
if (matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.add("dark");

mount(App, { target: document.getElementById("app") });

/* A graph named in the query string, so the page can be published beside one:
   index.html?graph=graph.json. Nothing is fetched unless the URL asks for it. */
const q = new URLSearchParams(location.search).get("graph");
if (q) {
  fetch(q)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.text();
    })
    .then((t) => readText(t, q.split("/").pop() || q))
    .catch((e) => { app.error = `Could not read ${q}. ${e.message || ""}`; });
}
