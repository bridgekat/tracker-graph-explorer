/* The scene: what is on the canvas for one expansion state, and where it goes.

   A collapsed group is a box. An expanded group is a *container* — a rectangle
   holding its children, laid out among themselves. So opening a box does not
   rearrange the drawing: the box grows into the room its contents need, its
   siblings move aside, and everything it holds is inside the outline that was
   already there. The layered layout runs once per container rather than once for
   the whole canvas, which is also what keeps it cheap.

   Left to right: a node sits to the right of everything it rests on, so an edge
   always runs back towards the left. */
import * as TD from "./derive.js";

const PAD = 13;                /* inside a container, around its content */
const HEAD = 21;               /* the container's title strip */
const GAP_X = 44, GAP_Y = 11;  /* between columns, and within one */
const TOP_GAP_X = 68, TOP_GAP_Y = 30;
const CHANNEL = 46;            /* the widest empty lane the compactor will leave */

/* ---------- what is visible ---------- */
function build(B, o) {
  const nodes = [], owner = new Int32Array(B.decl.length).fill(-1);

  function add(n) { n.id = nodes.length; nodes.push(n); return n; }

  function declNode(di, parent) {
    const d = B.decl[di], t = B.tree[d.g];
    const n = add({
      kind: "decl", di, gi: d.g, parent, children: null, expanded: false,
      label: d.label, name: d.id, group: t.name,
      count: 1, proved: d.state === "proved" ? 1 : 0, state: d.state, sort: d.id,
      declKind: d.kind, hue: t.hue, tone: t.tone
    });
    owner[di] = n.id;
    return n;
  }

  function groupNode(gi, parent) {
    const t = B.tree[gi], total = t.sub;
    if (!total) return null;
    const n = add({
      kind: "group", gi, parent, children: null, expanded: false,
      label: t.label, name: t.name, short: t.short, sort: t.name,
      count: total, proved: t.byState.proved, state: t.state,
      hue: t.hue, tone: t.tone, isModule: t.isModule, ready: t.ready, done: t.done
    });
    if (!o.open.has(gi)) {
      for (const d of t.subDecls) owner[d] = n.id;
      return n;
    }
    n.expanded = true;
    const kids = [];
    if (t.kids.length) {
      t.kids.forEach((k) => { const c = groupNode(k, n); if (c) kids.push(c); });
    } else {
      t.decls.forEach((d) => { kids.push(declNode(d, n)); });
    }
    if (!kids.length) { n.expanded = false; return n; }
    n.children = kids;
    return n;
  }

  const root = add({
    kind: "root", parent: null, children: [], expanded: true,
    label: "", name: "", count: 0, proved: 0, state: "proved", sort: ""
  });
  if (o.mode === "cone" && o.coneSet) {
    const list = [];
    o.coneSet.forEach((d) => list.push(d));
    list.sort((a, b) => (B.decl[a].id < B.decl[b].id ? -1 : 1));
    root.children = list.map((d) => declNode(d, root));
  } else {
    B.treeRoots.forEach((r) => {
      const c = groupNode(r, root);
      if (c) root.children.push(c);
    });
  }
  nodes.forEach((n) => {
    n.depth = 0;
    for (let p = n.parent; p; p = p.parent) n.depth++;
  });

  /* ---------- the edges between whatever is visible ----------

     An edge is drawn where it is laid out: in the deepest container holding both of
     its ends, between that container's own two children. So a view shows every
     dependency at the level you have opened it to, and an opened module leans on
     what is outside it along one line rather than along one per declaration. */
  nodes.forEach((n) => {
    if (!n.children) return;
    n.pairs = new Map();
    n.index = new Map();
    n.children.forEach((c, i) => { n.index.set(c.id, i); });
  });
  const agg = new Map(), raw = new Map();
  B.dedges.forEach(([from, to]) => {
    const a = owner[from], b = owner[to];
    if (a < 0 || b < 0 || a === b) return;
    /* What actually touches what, box to box, whatever each is nested in. The cone is
       computed over this, and each of these knows which drawn edge stands in for it,
       so the drawing can light exactly the lines that carry a cone relation. */
    const rk = a * TD.KEY + b;
    let rrec = raw.get(rk);
    if (!rrec) raw.set(rk, rrec = { a: nodes[a], b: nodes[b], w: 0, drawn: null });
    rrec.w++;
    let x = nodes[a], y = nodes[b];
    while (x.depth > y.depth) x = x.parent;
    while (y.depth > x.depth) y = y.parent;
    while (x !== y) { x = x.parent; y = y.parent; }
    const C = x;                                  /* the common container, and its two */
    let ca = nodes[a], cb = nodes[b];
    while (ca.parent !== C) ca = ca.parent;
    while (cb.parent !== C) cb = cb.parent;
    if (ca === cb) return;                        /* both ends inside one child */
    const k = ca.id * TD.KEY + cb.id;
    let rec = agg.get(k);
    if (rec) rec.w++;
    else agg.set(k, rec = { a: ca, b: cb, box: C, w: 1 });
    rrec.drawn = rec;
  });
  const edges = [];
  agg.forEach((rec) => {
    rec.key = rec.box.index.get(rec.a.id) * TD.KEY + rec.box.index.get(rec.b.id);
    rec.box.pairs.set(rec.key, rec.w);
    edges.push(rec);
  });
  const fine = [...raw.values()];

  /* ---------- lay each container out, innermost first ---------- */
  nodes.forEach(o.measure);          /* box size for a leaf, title width for a container */
  layout(root, true);

  /* ---------- absolute positions, so edges can be drawn anywhere ---------- */
  (function place(n, ox, oy) {
    n.ax = ox; n.ay = oy;
    if (!n.children) return;
    const cx = ox + (n.kind === "root" ? 0 : PAD);
    const cy = oy + (n.kind === "root" ? 0 : PAD + HEAD);
    n.cx = cx; n.cy = cy;
    n.children.forEach((c) => { place(c, cx + c.x, cy + c.y); });
  })(root, 0, 0);

  /* ---------- which edges the drawing can do without ---------- */
  edges.forEach((e) => {
    e.essential = !e.box.redundant || !e.box.redundant.has(e.key);
  });

  /* the cone follows what touches what, not what the drawing chose to merge */
  const adj = { out: [], in: [] };
  for (let i = 0; i < nodes.length; i++) { adj.out.push([]); adj.in.push([]); }
  fine.forEach((e) => { adj.out[e.a.id].push(e.b.id); adj.in[e.b.id].push(e.a.id); });

  return {
    root, nodes, edges, fine, owner, adj,
    width: root.w, height: root.h
  };
}

/* ---------- one container ---------- */
function layout(n, isTop) {
  if (!n.children) return;           /* a leaf was already measured */
  n.children.forEach((c) => { layout(c, false); });

  const kids = n.children, m = kids.length;
  const pairs = [];
  if (n.pairs) n.pairs.forEach((w, k) => { pairs.push([Math.floor(k / TD.KEY), k % TD.KEY]); });
  const core = TD.layoutCore(m, pairs, {
    nameOf: (i) => kids[i].sort,
    iterations: m > 400 ? 6 : 16,
    seeds: m > 900 ? 1 : 0
  });
  const gx = isTop ? TOP_GAP_X : GAP_X, gy = isTop ? TOP_GAP_Y : GAP_Y;

  /* columns run left to right, each as wide as the widest thing in it */
  const L = core.L, colW = [], colX = [];
  for (let i = 0; i <= L; i++) colW.push(0);
  for (let i = 0; i < m; i++) colW[core.layer[i]] = Math.max(colW[core.layer[i]], kids[i].w);
  let run = 0;
  for (let i = 0; i <= L; i++) { colX.push(run); run += colW[i] + gx; }
  const contentW = Math.max(0, run - gx);

  /* down the column, by the same priority method the layers use */
  const pos = TD.xAssign(core, (k) => (core.real[k] ? kids[k].h / 2 : 2), gy,
    m > 400 ? 8 : 16);
  squeeze(core, kids, pos, gy);

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++) {
    lo = Math.min(lo, pos[i] - kids[i].h / 2);
    hi = Math.max(hi, pos[i] + kids[i].h / 2);
  }
  if (!isFinite(lo)) { lo = 0; hi = 0; }
  for (let i = 0; i < core.N2; i++) pos[i] -= lo;
  const contentH = hi - lo;

  for (let i = 0; i < m; i++) {
    const l = core.layer[i];
    /* centred in its column: one open container makes a column far wider than its
       neighbours need, and hugging either edge would put all of that slack on one
       side of every edge that crosses it */
    kids[i].x = colX[l] + (colW[l] - kids[i].w) / 2;
    kids[i].y = pos[i] - kids[i].h / 2;
    kids[i].layer = l;
  }

  /* the shortcuts: pairs the reduction found nothing to say, and the ones it reversed */
  n.redundant = new Set();
  const inRed = new Set();
  core.red.forEach(([a, b]) => { inRed.add(a * TD.KEY + b); });
  if (n.pairs) n.pairs.forEach((w, k) => { if (!inRed.has(k)) n.redundant.add(k); });
  core.back.forEach(([a, b]) => { n.redundant.add(a * TD.KEY + b); });

  n.contentW = contentW; n.contentH = contentH;
  n.layers = L + 1;
  if (n.kind === "root") { n.w = contentW; n.h = contentH; }
  else {
    n.w = Math.max(contentW + 2 * PAD, n.headW || 0);
    n.h = contentH + 2 * PAD + HEAD;
  }
}


/* Squeeze out the empty lanes. The priority method places each column well but
   says nothing about the height of the whole block, and a container of a few
   unrelated clusters is otherwise mostly air. */
function squeeze(core, kids, pos, gap) {
  const spans = [];
  for (let i = 0; i < core.N2; i++) {
    const half = core.real[i] ? kids[i].h / 2 : 2;
    spans.push([pos[i] - half, pos[i] + half]);
  }
  if (spans.length < 2) return;
  spans.sort((a, b) => a[0] - b[0]);
  const lane = Math.max(gap, CHANNEL);
  const merged = [spans[0].slice()];
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1];
    if (spans[i][0] - last[1] < lane) last[1] = Math.max(last[1], spans[i][1]);
    else merged.push(spans[i].slice());
  }
  if (merged.length < 2) return;
  const shift = [];
  let run = merged[0][0];
  for (const [top, bottom] of merged) {
    shift.push(run - top);
    run += (bottom - top) + lane;
  }
  /* the lane a position falls in, by binary search over the merged spans */
  const at = (v) => {
    let a = 0, b = merged.length - 1;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (merged[mid][0] <= v) a = mid; else b = mid - 1;
    }
    return v + shift[a];
  };
  for (let i = 0; i < core.N2; i++) pos[i] = at(pos[i]);
}

export { build, PAD, HEAD };
