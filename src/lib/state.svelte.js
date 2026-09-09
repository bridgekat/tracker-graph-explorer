/* The state of the page, and the few actions that change it.

   Building a scene is expensive, so it is not reactive: an action that changes what
   is on the canvas calls rebuild() and hands the result to the canvas. Everything the
   components read — counts, the selection, the filters — is reactive as usual. */
import { SvelteSet } from "svelte/reactivity";
import * as TD from "./derive.js";
import * as SC from "./scene.js";
import { measure } from "./canvas.js";
import { fmt } from "./util.js";

const SOFT_LIMIT = 1500;          /* above this the page asks before drawing */

export const app = $state({
  base: null,
  src: "", srcSub: "", error: "",
  open: new SvelteSet(),
  sel: null,
  mode: "tree", coneSeed: null, coneDir: "both", coneRadius: 2,
  colour: "area", edges: "red",
  states: new SvelteSet(), stateCount: 0,
  kinds: new SvelteSet(), kindCount: 0,
  query: "",
  stats: "", status: null, zoom: 1,
  tooBig: null,                   /* { boxes } waiting on a yes; the scene is held below */
  confirmed: 0,
  tip: null,
});

let canvas = null;
export function attachCanvas(c) {
  canvas = c;
  if (app.base) c.setBase(app.base);
}

/* ---------- the filter over declarations ---------- */
/* A filter is on when some state or kind is switched off. Both are sets of what is
   shown, never null, so the two chip rows behave the same way as each other. */
export function filtering() {
  return app.states.size !== app.stateCount || app.kinds.size !== app.kindCount;
}
function keepDecl(d) {
  const dd = app.base.decl[d];
  if (!app.states.has(dd.state)) return false;
  if (!app.kinds.has(dd.kind)) return false;
  return true;
}

/* ---------- expansion ---------- */
export function openToLevel(n) {
  app.open.clear();
  app.base.tree.forEach((t) => { if (t.level < n) app.open.add(t.i); });
}
export function openAllGroups() {
  app.open.clear();
  app.base.tree.forEach((t) => { if (!t.isModule) app.open.add(t.i); });
}
export function openEverything() {
  app.open.clear();
  app.base.tree.forEach((t) => app.open.add(t.i));
}
function revealGroup(gi, alsoItself) {
  let cur = app.base.tree[gi].parent;
  while (cur !== null) { app.open.add(cur); cur = app.base.tree[cur].parent; }
  if (alsoItself) app.open.add(gi);
}

/* ---------- building ---------- */
function computeScene() {
  const opts = {
    open: app.open, keep: filtering() ? keepDecl : null, measure, mode: app.mode,
  };
  if (app.mode === "cone" && app.coneSeed) {
    const s = app.coneSeed;
    opts.seeds = s.t === 1 ? [s.i] : app.base.tree[s.i].subDecls.slice();
    opts.coneSet = TD.cone(app.base, opts.seeds, app.coneDir, app.coneRadius);
  } else opts.mode = "tree";
  return SC.build(app.base, opts);
}

/* The scene a warning is waiting on. It is deliberately not in `app`: $state deep-proxies
   plain objects, and a scene at full depth is thousands of nodes that the canvas then
   writes its own layer references onto. Proxied, those writes land on one identity and
   the edge records read another, and the drawing comes out with no edges at all. */
let pending = null;

export function rebuild(opts = {}) {
  if (!app.base || !canvas) return;
  const scene = computeScene();
  const boxes = scene.nodes.length - 1;
  if (boxes > SOFT_LIMIT && boxes > app.confirmed) {
    pending = { scene, opts };
    app.tooBig = { boxes };
    return;
  }
  commit(scene, opts);
}
function commit(scene, opts) {
  app.tooBig = null;
  pending = null;
  canvas.setScene(scene, opts);
  canvas.setSelection(app.sel);
  let groups = 0, decls = 0, open = 0;
  scene.nodes.forEach((n) => {
    if (n.kind === "group") { groups++; if (n.expanded) open++; }
    else if (n.kind === "decl") decls++;
  });
  const parts = [];
  if (groups) parts.push(`${fmt(groups)} groups` + (open ? `, ${fmt(open)} open` : ""));
  if (decls) parts.push(`${fmt(decls)} declarations`);
  parts.push(`${fmt(scene.edges.length)} dependencies`);
  app.stats = parts.join(" · ");
}
export function drawAnyway() {
  if (!app.tooBig || !pending) return;
  app.confirmed = app.tooBig.boxes;
  commit(pending.scene, pending.opts);
}
export function collapseToModules() {
  app.tooBig = null;
  pending = null;
  openAllGroups();
  rebuild();
}

/* ---------- actions ---------- */
export function toggleGroup(gi) {
  if (app.open.has(gi)) app.open.delete(gi); else app.open.add(gi);
  if (app.mode !== "tree") app.mode = "tree";
  rebuild({ anchor: { t: 0, i: gi } });
}
export function select(ref, reveal = false) {
  app.sel = ref;
  if (reveal && ref && app.mode === "tree") {
    const gi = ref.t === 0 ? ref.i : app.base.decl[ref.i].g;
    const before = app.open.size;
    revealGroup(gi, ref.t === 1);
    if (app.open.size !== before) { rebuild({ centreOn: ref }); return; }
  }
  if (canvas) {
    canvas.setSelection(ref);
    if (reveal && ref) canvas.reveal(ref);
  }
}
export function setCone(ref) {
  app.mode = "cone";
  app.coneSeed = ref;
  app.sel = ref;
  rebuild();
}
export function setMode(m) {
  if (m === "cone" && !app.coneSeed) {
    if (!app.sel) { app.status = { warn: "Pick a declaration first — the neighbourhood is drawn around one." }; return; }
    app.coneSeed = app.sel;
  }
  app.mode = m;
  rebuild();
}
export function setColour(mode) { app.colour = mode; canvas?.setColour(mode); }
export function setEdges(mode) { app.edges = mode; canvas?.setEdges(mode); }
export function openAllUnder(gi) {
  const stack = [gi];
  while (stack.length) {
    const u = stack.pop();
    app.open.add(u);
    app.base.tree[u].kids.forEach((k) => stack.push(k));
  }
  rebuild({ anchor: { t: 0, i: gi } });
}
export function repaintTheme() { canvas?.setColour(app.colour); }

/* ---------- loading ---------- */
export function adopt(raw, label) {
  let base;
  try { base = TD.buildBase(raw); }
  catch (err) { app.error = err.message || String(err); return false; }
  app.error = "";
  app.base = base;
  app.src = label;
  const m = base.meta;
  app.srcSub = `${fmt(m.nodes)} results · ${fmt(m.modules)} modules · ${fmt(m.edges)} dependencies`
    + (m.dangling ? ` · ${fmt(m.dangling)} edges point outside the plan and were dropped` : "");
  app.sel = null;
  app.query = "";
  app.confirmed = 0;
  app.mode = "tree";
  app.coneSeed = null;
  app.tooBig = null;
  app.states = new SvelteSet(TD.STATES.filter((s) => m.states[s] > 0));
  app.stateCount = app.states.size;
  app.kinds = new SvelteSet(Object.keys(m.kinds));
  app.kindCount = app.kinds.size;
  canvas?.setBase(base);
  /* the areas: the picture of the project that fits on a screen */
  openToLevel(base.tree.length > 40 ? 1 : 2);
  rebuild();
  return true;
}
export function readText(txt, label) {
  let raw;
  try { raw = JSON.parse(txt); }
  catch (e) { app.error = "That file is not valid JSON. " + (e.message || ""); return false; }
  return adopt(raw, label);
}
