/* The scene: what is on the canvas for one expansion state, and where it goes.

   A collapsed group is a box. An expanded group is a *container* — a rectangle
   holding its children, laid out among themselves. So opening a box does not
   rearrange the drawing: the box grows into the room its contents need, its
   siblings move aside, and everything it holds is inside the outline that was
   already there. Each container is laid out on its own, innermost first, which is
   also what keeps it cheap.

   Left to right: a node sits to the right of everything it rests on, so an edge
   always runs back towards the left.

   Two steps. assemble() decides what is on the canvas and which edges matter,
   and is synchronous; layout() hands every container to ELK and is not. */
import * as TD from "./derive.js";
import { layoutGraph } from "./elk.js";

const PAD = 13;                /* inside a container, around its content */
const HEAD = 21;               /* the container's title strip */
const GAP = { x: 44, y: 11 };  /* between columns, and within one */
const TOP_GAP = { x: 68, y: 30 };

/* ---------- what is visible ----------
   o.open is the set of open groups; o.cone, if given, is a set of declarations to
   draw on their own instead of the tree; o.measure sizes a box before layout. */
function assemble(B, o) {
  const nodes = [], owner = new Int32Array(B.decl.length).fill(-1);
  const add = (n) => { n.id = nodes.length; nodes.push(n); return n; };

  function declNode(di, parent) {
    const d = B.decl[di], t = B.tree[d.g];
    const n = add({
      kind: "decl", di, parent, children: null, expanded: false,
      label: d.label, name: d.id, group: t.name, sort: d.id,
      count: 1, proved: d.state === "proved" ? 1 : 0, state: d.state,
      declKind: d.kind,
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
    if (!e) drawn.set(k, e = { a: x, b: y, box, key: box.index.get(x.id) * TD.KEY + box.index.get(y.id), pts: null });
    rel.drawn = e;
  });
  const edges = [...drawn.values()];
  edges.forEach((e) => e.box.pairs.add(e.key));

  /* ---------- which edges the drawing can do without ----------
     Per container: the shortcuts the reduction found nothing to say, and the ones a
     cycle forced backwards. Only what is left is laid out; the rest is drawn faint,
     on request, from port to port. */
  nodes.forEach((n) => {
    if (!n.children) return;
    const pairs = [...n.pairs].map((k) => [Math.floor(k / TD.KEY), k % TD.KEY]);
    const { red, back } = TD.reduce(n.children.length, pairs);
    const inRed = new Set(red.map(([a, b]) => a * TD.KEY + b));
    n.redundant = new Set([...n.pairs].filter((k) => !inRed.has(k)));
    back.forEach(([a, b]) => n.redundant.add(a * TD.KEY + b));
  });
  edges.forEach((e) => { e.essential = !e.box.redundant.has(e.key); });

  nodes.forEach(o.measure);          /* box size for a leaf, title width for a container */

  /* the cone follows what touches what, not what the drawing chose to merge */
  const adj = { out: nodes.map(() => []), in: nodes.map(() => []) };
  fine.forEach((r) => { adj.out[r.a.id].push(r.b.id); adj.in[r.b.id].push(r.a.id); });

  return { root, nodes, edges, fine: [...fine.values()], owner, adj, boxes: nodes.length - 1, width: 0, height: 0 };
}

/* ---------- where everything goes ----------
   One ELK graph mirrors the scene: a container is a compound node holding its
   children and the essential edges between them. With hierarchy handled as
   "separate children" ELK lays each container out on its own, innermost first,
   and sizes it from what it holds — the nesting described above, in one call. */
const px = (v) => String(Math.round(v * 10) / 10);

function toElk(S) {
  const options = (n) => {
    /* the areas at the top of the tree stand further apart than the rest; a
       neighbourhood's declarations, which also sit at the root, do not */
    const gap = n.kind === "root" && n.children[0]?.kind === "group" ? TOP_GAP : GAP;
    const opt = {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "SEPARATE_CHILDREN",
      "elk.edgeRouting": "SPLINES",
      "elk.spacing.nodeNode": px(gap.y),
      "elk.layered.spacing.nodeNodeBetweenLayers": px(gap.x),
      "elk.spacing.edgeNode": "8",
      "elk.spacing.edgeEdge": "4",
      "elk.layered.spacing.edgeNodeBetweenLayers": "10",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "4",
      "elk.padding": n.kind === "root"
        ? "[top=0,left=0,bottom=0,right=0]"
        : `[top=${PAD + HEAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
    };
    if (n.kind !== "root") {
      /* an open container takes its size from its contents, but never less than
         the room its own title needs */
      opt["elk.nodeSize.constraints"] = "MINIMUM_SIZE";
      opt["elk.nodeSize.minimum"] = `(${Math.ceil(n.headW)},${PAD + HEAD + PAD})`;
    }
    return opt;
  };
  const conv = (n) => {
    const node = { id: String(n.id) };
    if (n.children) {
      node.layoutOptions = options(n);
      node.children = n.children.map(conv);
      node.edges = [];
    } else {
      node.width = n.w; node.height = n.h;
    }
    return node;
  };
  const g = conv(S.root);
  const byId = new Map();
  (function index(node) { byId.set(node.id, node); (node.children || []).forEach(index); })(g);
  S.edges.forEach((e) => {
    if (!e.essential) return;
    /* an edge runs from what is rested on to what rests on it, so the dependent
       lands to the right */
    byId.get(String(e.box.id)).edges.push({ id: `${e.a.id}-${e.b.id}`, sources: [String(e.b.id)], targets: [String(e.a.id)] });
  });
  return g;
}

async function layout(S) {
  const out = await layoutGraph(toElk(S));
  const edgeOf = new Map(S.edges.map((e) => [`${e.a.id}-${e.b.id}`, e]));

  /* positions, relative to the parent's content origin as the drawing expects
     them; ELK gives them relative to the parent's corner, padding included */
  (function read(node, parent) {
    const n = S.nodes[+node.id];
    if (parent) {
      n.x = node.x - (parent.kind === "root" ? 0 : PAD);
      n.y = node.y - (parent.kind === "root" ? 0 : PAD + HEAD);
    }
    if (n.children) {
      n.w = node.width; n.h = node.height;
      node.children.forEach((c) => read(c, n));
    }
    (node.edges || []).forEach((ed) => {
      const e = edgeOf.get(ed.id), s = ed.sections[0];
      e.pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map((p) => [p.x, p.y]);
    });
  })(out, null);
  S.width = out.width; S.height = out.height;

  /* absolute positions, so edges can be drawn anywhere */
  (function place(n, ox, oy) {
    n.ax = ox; n.ay = oy;
    if (!n.children) return;
    n.cx = ox + (n.kind === "root" ? 0 : PAD);
    n.cy = oy + (n.kind === "root" ? 0 : PAD + HEAD);
    n.children.forEach((c) => place(c, n.cx + c.x, n.cy + c.y));
  })(S.root, 0, 0);
  /* a route is given in its container's frame, corner included */
  S.edges.forEach((e) => {
    if (e.pts) e.pts = e.pts.map(([x, y]) => [x + e.box.ax, y + e.box.ay]);
  });
  return S;
}

export { assemble, layout, PAD, HEAD };
