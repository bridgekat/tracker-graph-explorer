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

/* ---------- what is visible ----------
   o.open is the set of open groups; o.cone, if given, is a set of declarations to
   draw on their own instead of the tree; o.measure sizes a box before layout. */
function build(B, o) {
  const nodes = [], owner = new Int32Array(B.decl.length).fill(-1);
  const add = (n) => { n.id = nodes.length; nodes.push(n); return n; };

  function declNode(di, parent) {
    const d = B.decl[di], t = B.tree[d.g];
    const n = add({
      kind: "decl", di, parent, children: null, expanded: false,
      label: d.label, name: d.id, group: t.name, sort: d.id,
      count: 1, proved: d.state === "proved" ? 1 : 0, state: d.state,
      declKind: d.kind, hue: t.hue, tone: t.tone,
    });
    owner[di] = n.id;
    return n;
  }

  function groupNode(gi, parent) {
    const t = B.tree[gi];
    if (!t.sub) return null;
    const n = add({
      kind: "group", gi, parent, children: null, expanded: false,
      label: t.label, name: t.name, short: t.short, sort: t.name,
      count: t.sub, proved: t.byState.proved, state: t.state,
      hue: t.hue, tone: t.tone,
    });
    const kids = !o.open.has(gi) ? []
      : t.kids.length ? t.kids.map((k) => groupNode(k, n)).filter(Boolean)
        : t.decls.map((d) => declNode(d, n));
    if (kids.length) { n.expanded = true; n.children = kids; }
    else for (const d of t.subDecls) owner[d] = n.id;
    return n;
  }

  const root = add({ kind: "root", parent: null, children: [] });
  root.children = o.cone
    ? [...o.cone].sort((a, b) => (B.decl[a].id < B.decl[b].id ? -1 : 1)).map((d) => declNode(d, root))
    : B.treeRoots.map((r) => groupNode(r, root)).filter(Boolean);
  nodes.forEach((n) => { n.depth = n.parent ? n.parent.depth + 1 : 0; });

  /* ---------- the edges between whatever is visible ----------

     An edge is drawn where it is laid out: in the deepest container holding both of
     its ends, between that container's own two children. So a view shows every
     dependency at the level you have opened it to, and an opened module leans on
     what is outside it along one line rather than along one per declaration. */
  nodes.forEach((n) => {
    if (!n.children) return;
    n.pairs = new Set();
    n.index = new Map(n.children.map((c, i) => [c.id, i]));
  });
  const drawn = new Map(), fine = new Map();
  B.dedges.forEach(([from, to]) => {
    const a = owner[from], b = owner[to];
    if (a < 0 || b < 0 || a === b) return;
    /* What actually touches what, box to box, whatever each is nested in. The cone is
       computed over this, and each of these knows which drawn edge stands in for it,
       so the drawing can light exactly the lines that carry a cone relation. */
    let rel = fine.get(a * TD.KEY + b);
    if (!rel) fine.set(a * TD.KEY + b, rel = { a: nodes[a], b: nodes[b], drawn: null });
    /* climb to the two children of the deepest container holding both ends */
    let x = nodes[a], y = nodes[b];
    while (x.depth > y.depth) x = x.parent;
    while (y.depth > x.depth) y = y.parent;
    while (x.parent !== y.parent) { x = x.parent; y = y.parent; }
    if (x === y) return;                          /* both ends inside one child */
    const box = x.parent, k = x.id * TD.KEY + y.id;
    let e = drawn.get(k);
    if (!e) drawn.set(k, e = { a: x, b: y, box, key: box.index.get(x.id) * TD.KEY + box.index.get(y.id) });
    rel.drawn = e;
  });
  const edges = [...drawn.values()];
  edges.forEach((e) => e.box.pairs.add(e.key));

  /* ---------- lay each container out, innermost first ---------- */
  nodes.forEach(o.measure);          /* box size for a leaf, title width for a container */
  layout(root, true);

  /* ---------- absolute positions, so edges can be drawn anywhere ---------- */
  (function place(n, ox, oy) {
    n.ax = ox; n.ay = oy;
    if (!n.children) return;
    n.cx = ox + (n.kind === "root" ? 0 : PAD);
    n.cy = oy + (n.kind === "root" ? 0 : PAD + HEAD);
    n.children.forEach((c) => place(c, n.cx + c.x, n.cy + c.y));
  })(root, 0, 0);

  /* ---------- which edges the drawing can do without ---------- */
  edges.forEach((e) => { e.essential = !e.box.redundant.has(e.key); });

  /* the cone follows what touches what, not what the drawing chose to merge */
  const adj = { out: nodes.map(() => []), in: nodes.map(() => []) };
  fine.forEach((r) => { adj.out[r.a.id].push(r.b.id); adj.in[r.b.id].push(r.a.id); });

  return { root, nodes, edges, fine: [...fine.values()], owner, adj, width: root.w, height: root.h };
}

/* ---------- one container ---------- */
function layout(n, isTop) {
  if (!n.children) return;           /* a leaf was already measured */
  n.children.forEach((c) => layout(c, false));

  const kids = n.children, m = kids.length;
  const pairs = [...n.pairs].map((k) => [Math.floor(k / TD.KEY), k % TD.KEY]);
  const core = TD.layoutCore(m, pairs, {
    nameOf: (i) => kids[i].sort,
    iterations: m > 400 ? 6 : 16,
    seeds: m > 900 ? 1 : 0,
  });
  const gx = isTop ? TOP_GAP_X : GAP_X, gy = isTop ? TOP_GAP_Y : GAP_Y;

  /* columns run left to right, each as wide as the widest thing in it */
  const colW = new Array(core.L + 1).fill(0), colX = [];
  for (let i = 0; i < m; i++) colW[core.layer[i]] = Math.max(colW[core.layer[i]], kids[i].w);
  let run = 0;
  colW.forEach((w) => { colX.push(run); run += w + gx; });
  const contentW = Math.max(0, run - gx);

  /* down the column, by the same priority method the layers use */
  const pos = TD.xAssign(core, (k) => (core.real[k] ? kids[k].h / 2 : 2), gy, m > 400 ? 8 : 16);
  squeeze(core, kids, pos, gy);

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m; i++) {
    lo = Math.min(lo, pos[i] - kids[i].h / 2);
    hi = Math.max(hi, pos[i] + kids[i].h / 2);
  }
  const contentH = m ? hi - lo : 0;
  for (let i = 0; i < m; i++) {
    const l = core.layer[i];
    /* centred in its column: one open container makes a column far wider than its
       neighbours need, and hugging either edge would put all of that slack on one
       side of every edge that crosses it */
    kids[i].x = colX[l] + (colW[l] - kids[i].w) / 2;
    kids[i].y = pos[i] - lo - kids[i].h / 2;
  }

  /* the shortcuts: pairs the reduction found nothing to say, and the ones it reversed */
  const inRed = new Set(core.red.map(([a, b]) => a * TD.KEY + b));
  n.redundant = new Set([...n.pairs].filter((k) => !inRed.has(k)));
  core.back.forEach(([a, b]) => n.redundant.add(a * TD.KEY + b));

  if (n.kind === "root") { n.w = contentW; n.h = contentH; }
  else {
    n.w = Math.max(contentW + 2 * PAD, n.headW);
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
