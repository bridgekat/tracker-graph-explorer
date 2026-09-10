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
  coneSeed: null,                 /* what the neighbourhood on screen is of, or the tree */
  edges: "red",
  shut: { index: false, detail: false },   /* a side pane folded away */
  pane: { index: 330, detail: 400 },       /* and how wide it is when it is not */
  sizing: false,                  /* a pane is being dragged wider: styles/shell.css */
  dark: document.documentElement.classList.contains("dark"),
  zoom: 1,
  tooBig: null,                   /* { boxes } waiting on a yes; the scene is held below */
  confirmed: 0,
  busy: false,                    /* a layout is running */
});

let canvas = null;
export function attachCanvas(c) {
  canvas = c;
  c.setEdges(app.edges);
  /* A graph baked into the page is read before the canvas exists, so the expansion
     readText chose has nothing to draw it on and rebuild() gave up. Drawing it is this
     attachment's job; a page that arrives at its graph any other way already has one.
     Anything selected at this point was selected by the URL and by nothing else, since
     nobody has had a drawing to click on yet, so this first draw is aimed at it. */
  if (app.base) { c.setBase(app.base); rebuild(app.sel ? { centreOn: app.sel } : {}); }
}
export const zoomBy = (mult) => canvas?.zoomBy(mult);
export const fit = () => canvas?.fit();
/* the drawing spans the whole shell and cannot see the panes floating over it, so it is
   told which part of itself is uncovered */
export const setInset = (l, r) => canvas?.setInset(l, r);

/* ---------- building ---------- */
function assembleScene() {
  const opts = { open: app.open, measure };
  if (app.coneSeed) {
    const s = app.coneSeed;
    const seeds = s.t === 1 ? [s.i] : app.base.tree[s.i].subDecls;
    opts.cone = TD.cone(app.base, seeds);
  }
  return SC.assemble(app.base, opts);
}

/* The scene a warning is waiting on. It is deliberately not in `app`: $state deep-proxies
   plain objects, and a scene at full depth is thousands of nodes that the canvas then
   writes its own layer references onto. Proxied, those writes land on one identity and
   the edge records read another, and the drawing comes out with no edges at all. */
let pending = null;
let seq = 0;                      /* which scene was asked for last */

function rebuild(opts = {}) {
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
function openTo(keep) {
  app.open.clear();
  app.base.tree.forEach((t) => { if (keep(t)) app.open.add(t.i); });
}
export function openWhere(keep) {
  openTo(keep);
  app.coneSeed = null;
  rebuild();
}
export function toggleGroup(gi) {
  if (app.open.has(gi)) app.open.delete(gi); else app.open.add(gi);
  app.coneSeed = null;
  rebuild({ anchor: { t: 0, i: gi } });
}
/* every group above a node, so that opening them puts the node on the canvas */
function openDownTo(ref) {
  let g = ref.t === 0 ? app.base.tree[ref.i].parent : app.base.decl[ref.i].g;
  for (; g !== null; g = app.base.tree[g].parent) app.open.add(g);
}
/* select a node; with `reveal`, also open the tree down to it and bring it into view.
   A neighbourhood is left where it is: what is drawn there is the point of being there,
   and picking something in the index is not asking to leave. */
export function select(ref, reveal = false) {
  app.sel = ref;
  writeHash();
  if (reveal && ref && !app.coneSeed) {
    const before = app.open.size;
    openDownTo(ref);
    if (app.open.size !== before) { rebuild({ centreOn: ref }); return; }
  }
  canvas?.setSelection(ref);
  if (reveal && ref) canvas?.reveal(ref);
}
/* the neighbourhood of one node: its cone, drawn on its own */
export function setCone(ref) {
  app.coneSeed = ref;
  app.sel = ref;
  writeHash();
  rebuild();
}
/* Out of a neighbourhood and back to the whole graph, which comes back as it was left:
   the tree's expansion is untouched while a cone is on screen, so this is the view you
   came from, with the camera on whatever is still selected. */
export function showTree() {
  if (!app.coneSeed) return;
  app.coneSeed = null;
  rebuild({ centreOn: app.sel });
}

/* ---------- the address bar ----------
   Which node you are on is in the URL, so that the way to send someone what you are
   looking at is to copy the address. The fragment is the node's address and nothing
   else — TD.address, the project's one way of writing down which node it means:

     #Numlib/Krylov
     #Numlib/Krylov/CR,Numlib.Krylov.CR.isMinResIterate

   `/` and `,` are legal in a fragment and are what make an address readable, so the
   address's own punctuation stands as itself and everything else is escaped — a comma
   inside a name included, or it would read as the one comma that means "and inside it".
   What is written is a name the graph file gave and never an index, which belongs to the
   build and moves under a link. An address this graph does not have is ignored rather
   than reported: a link that has gone stale, or one made against another project's
   graph, should still open the page.

   The URL is replaced rather than pushed. Pushed, every click on a box would be a step in
   the history, and the back button would spend the whole session walking out of a drawing
   nobody navigated away from. */
function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw || !app.base) return null;
  /* a fragment somebody typed can hold an escape that is not one */
  try { return TD.refAt(app.base, raw, decodeURIComponent); } catch { return null; }
}
function writeHash() {
  const hash = app.sel ? `#${TD.address(app.base, app.sel, encodeURIComponent)}` : "";
  if (hash === location.hash) return;
  history.replaceState(null, "", hash || location.pathname + location.search);
}
/* Land on the node a link asks for: selected, with the tree opened down to it so that it
   is on the canvas. It goes through the state rather than through select(), so that the
   page a link opens is laid out once and aimed at the node the first time, rather than
   drawn and then moved. */
function land(ref) {
  app.sel = ref;
  app.coneSeed = null;
  openDownTo(ref);
  rebuild({ centreOn: ref });
}
/* The URL changed under the page: someone edited it, or followed a link into the page
   it is already on. Nothing this page writes arrives here — replacing the URL does not
   raise the event — so this is always somebody else asking to go somewhere. */
addEventListener("hashchange", () => {
  const ref = parseHash();
  if (ref) land(ref);
});

/* The drawing samples the theme's tokens rather than inheriting them, so a change of
   theme is a change it has to be told about. So does anything a component paints from
   the same arithmetic, which is why the theme is state here and not only a class on
   <html> — see the note above hueFill in util.js. */
export function setTheme(on) {
  app.dark = on;
  document.documentElement.classList.toggle("dark", on);
  canvas?.repaint();
}
export function setEdges(mode) { app.edges = mode; canvas?.setEdges(mode); }
/* ---------- the side panes ----------
   They float over the drawing rather than dividing it, so what a pane costs the drawing
   is not room but cover: `covers` is the whole width one hides, its grip included, and
   it is what the chrome over the drawing and the camera under it both measure from. */
export const GRIP = 10;                 /* the strip at a pane's inner edge it drags from */
const PANE_MIN = 180;
const PANE_ROOM = 420;                  /* the drawing is never squeezed below this */
const other = (which) => (which === "index" ? "detail" : "index");
export const covers = (which) => (app.shut[which] ? 0 : app.pane[which] + GRIP);

export function togglePane(which) { app.shut[which] = !app.shut[which]; }
export function setPaneWidth(which, px) {
  app.pane[which] = Math.round(Math.max(PANE_MIN,
    Math.min(px, window.innerWidth - covers(other(which)) - PANE_ROOM)));
}
/* The room the panes have to share is the window's, so a window that has just become
   narrower can leave them wider than it. Clamping only where a width is set would let
   that stand until the next drag; clamping again here keeps the promise the canvas and
   the floating chrome are both drawn against. */
addEventListener("resize", () => {
  setPaneWidth("index", app.pane.index);
  setPaneWidth("detail", app.pane.detail);
});

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
  app.coneSeed = null;
  app.tooBig = null;
  app.confirmed = 0;
  canvas?.setBase(base);
  /* the areas: the picture of the project that fits on a screen */
  const depth = base.tree.length > 40 ? 1 : 2;
  openTo((t) => t.level < depth);
  /* and then wherever the URL says, which is where this page was opened to go */
  const ref = parseHash();
  if (ref) land(ref); else rebuild();
  /* a link into some other graph is not this graph's address */
  writeHash();
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
