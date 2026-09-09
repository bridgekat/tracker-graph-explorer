/* The state of the page, and the few actions that change it.

   Building a scene is expensive, so it is not reactive: an action that changes what
   is on the canvas calls rebuild() and hands the result to the canvas. Everything the
   components read — the selection, the expansion, the modes — is reactive as usual.
   The layout runs in a worker, so rebuild() is asynchronous, and only the newest
   scene asked for is ever drawn. */
import { SvelteSet } from "svelte/reactivity";
import * as TD from "./derive.js";
import * as SC from "./scene.js";
import { measure } from "./canvas.js";

const SOFT_LIMIT = 1500;          /* above this the page asks before drawing */

export const app = $state({
  base: null,
  src: "", error: "",
  open: new SvelteSet(),
  sel: null,
  mode: "tree", coneSeed: null, coneDir: "both", coneRadius: 2,
  colour: "area", edges: "red",
  zoom: 1,
  tooBig: null,                   /* { boxes } waiting on a yes; the scene is held below */
  confirmed: 0,
  busy: false,                    /* a layout is running */
});

let canvas = null;
export function attachCanvas(c) {
  canvas = c;
  c.setColour(app.colour);
  c.setEdges(app.edges);
  /* A graph baked into the page is read before the canvas exists, so the expansion
     readText chose has nothing to draw it on and rebuild() gave up. Drawing it is this
     attachment's job; a page that arrives at its graph any other way already has one. */
  if (app.base) { c.setBase(app.base); rebuild(); }
}
export const zoomBy = (mult) => canvas?.zoomBy(mult);
export const fit = () => canvas?.fit();

/* ---------- building ---------- */
function assembleScene() {
  const opts = { open: app.open, measure };
  if (app.mode === "cone" && app.coneSeed) {
    const s = app.coneSeed;
    const seeds = s.t === 1 ? [s.i] : app.base.tree[s.i].subDecls;
    opts.cone = TD.cone(app.base, seeds, app.coneDir, app.coneRadius);
  }
  return SC.assemble(app.base, opts);
}

/* The scene a warning is waiting on. It is deliberately not in `app`: $state deep-proxies
   plain objects, and a scene at full depth is thousands of nodes that the canvas then
   writes its own layer references onto. Proxied, those writes land on one identity and
   the edge records read another, and the drawing comes out with no edges at all. */
let pending = null;
let seq = 0;                      /* which scene was asked for last */

export function rebuild(opts = {}) {
  if (!app.base || !canvas) return;
  const scene = assembleScene();
  if (scene.boxes > SOFT_LIMIT && scene.boxes > app.confirmed) {
    pending = { scene, opts };
    app.tooBig = { boxes: scene.boxes };
    return;
  }
  return settle(scene, opts);
}
/* lay the scene out and draw it, unless something newer was asked for meanwhile */
async function settle(scene, opts) {
  const mine = ++seq;
  app.busy = true;
  try {
    await SC.layout(scene);
  } catch (e) {
    if (mine === seq) app.error = `The layout failed. ${e.message || e}`;
    return;
  } finally {
    if (mine === seq) app.busy = false;
  }
  if (mine !== seq) return;
  app.tooBig = null;
  pending = null;
  canvas.setScene(scene, opts);
  canvas.setSelection(app.sel);
}
export function drawAnyway() {
  if (!pending) return;
  app.confirmed = app.tooBig.boxes;
  const p = pending;
  app.tooBig = null;
  pending = null;
  settle(p.scene, p.opts);
}

/* ---------- actions ---------- */
/* open exactly the groups that pass: the top levels, every group, or everything */
export function openWhere(keep) {
  app.open.clear();
  app.base.tree.forEach((t) => { if (keep(t)) app.open.add(t.i); });
  app.mode = "tree";
  rebuild();
}
export function toggleGroup(gi) {
  if (app.open.has(gi)) app.open.delete(gi); else app.open.add(gi);
  app.mode = "tree";
  rebuild({ anchor: { t: 0, i: gi } });
}
/* select a node; with `reveal`, also open the tree down to it and bring it into view */
export function select(ref, reveal = false) {
  app.sel = ref;
  if (reveal && ref && app.mode === "tree") {
    const before = app.open.size;
    let g = ref.t === 0 ? app.base.tree[ref.i].parent : app.base.decl[ref.i].g;
    for (; g !== null; g = app.base.tree[g].parent) app.open.add(g);
    if (app.open.size !== before) { rebuild({ centreOn: ref }); return; }
  }
  canvas?.setSelection(ref);
  if (reveal && ref) canvas?.reveal(ref);
}
/* the neighbourhood of one node: its cone, drawn on its own */
export function setCone(ref) {
  app.mode = "cone";
  app.coneSeed = ref;
  app.sel = ref;
  rebuild();
}
export function setMode(mode) {
  if (mode === "cone") {
    const seed = app.sel || app.coneSeed;
    if (seed) setCone(seed);
  } else {
    app.mode = mode;
    rebuild();
  }
}
export function setColour(mode) { app.colour = mode; canvas?.setColour(mode); }
export function setEdges(mode) { app.edges = mode; canvas?.setEdges(mode); }

/* ---------- loading ---------- */
export function readText(txt, label) {
  let raw;
  try { raw = JSON.parse(txt); }
  catch (e) { app.error = `That file is not valid JSON. ${e.message}`; return; }
  let base;
  try { base = TD.buildBase(raw); }
  catch (e) { app.error = e.message || String(e); return; }
  app.error = "";
  app.base = base;
  app.src = label;
  app.sel = null;
  app.mode = "tree";
  app.coneSeed = null;
  app.tooBig = null;
  app.confirmed = 0;
  canvas?.setBase(base);
  /* the areas: the picture of the project that fits on a screen */
  const depth = base.tree.length > 40 ? 1 : 2;
  openWhere((t) => t.level < depth);
}
export function readFile(f) {
  if (f) f.text().then((t) => readText(t, f.name));
}
/* the file picker, without a hidden <input> in every component that wants one */
export function pickFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => readFile(input.files[0]);
  input.click();
}
