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

  var PAD = 13;                  /* inside a container, around its content */
  var HEAD = 21;                 /* the container's title strip */
  var GAP_X = 44, GAP_Y = 11;    /* between columns, and within one */
  var TOP_GAP_X = 68, TOP_GAP_Y = 30;
  var CHANNEL = 46;              /* the widest empty lane the compactor will leave */

  /* ---------- what is visible ---------- */
  function build(B, o) {
    var nodes = [], owner = new Int32Array(B.decl.length).fill(-1);
    var keep = o.keep || null;

    /* counts restricted to what passes the filter, one pass up the ancestor chains */
    var kept = null, keptProved = null, keptState = null;
    if (keep) {
      kept = new Int32Array(B.tree.length);
      keptProved = new Int32Array(B.tree.length);
      keptState = B.tree.map(function () { return null; });
      B.decl.forEach(function (d) {
        if (!keep(d.i)) return;
        for (var k = 0; k < d.path.length; k++) {
          var g = d.path[k];
          kept[g]++;
          if (d.state === "proved") keptProved[g]++;
          var by = keptState[g] || (keptState[g] = {});
          by[d.state] = (by[d.state] || 0) + 1;
        }
      });
    }
    var countOf = function (gi) { return keep ? kept[gi] : B.tree[gi].sub; };
    var provedOf = function (gi) { return keep ? keptProved[gi] : B.tree[gi].byState.proved; };
    var stateOf = function (gi) {
      if (!keep) return B.tree[gi].state;
      var by = keptState[gi] || {};
      return TD.rollState({
        proved: by.proved || 0, stated: by.stated || 0, open: by.open || 0,
        axioms: by.axioms || 0, wrong: by.wrong || 0
      });
    };

    function add(n) { n.id = nodes.length; nodes.push(n); return n; }

    function declNode(di, parent) {
      var d = B.decl[di], t = B.tree[d.g];
      var n = add({
        kind: "decl", di: di, gi: d.g, parent: parent, children: null, expanded: false,
        label: d.label, name: d.id, group: t.name,
        count: 1, proved: d.state === "proved" ? 1 : 0, state: d.state, sort: d.id,
        declKind: d.kind, hue: t.hue, tone: t.tone
      });
      owner[di] = n.id;
      return n;
    }

    function groupNode(gi, parent) {
      var t = B.tree[gi], total = countOf(gi);
      if (!total) return null;
      var n = add({
        kind: "group", gi: gi, parent: parent, children: null, expanded: false,
        label: t.label, name: t.name, short: t.short, sort: t.name,
        count: total, proved: provedOf(gi), state: stateOf(gi),
        hue: t.hue, tone: t.tone, isModule: t.isModule, ready: t.ready, done: t.done
      });
      if (!o.open.has(gi)) {
        for (var j = 0; j < t.subDecls.length; j++) {
          var d = t.subDecls[j];
          if (!keep || keep(d)) owner[d] = n.id;
        }
        return n;
      }
      n.expanded = true;
      var kids = [];
      if (t.kids.length) {
        t.kids.forEach(function (k) { var c = groupNode(k, n); if (c) kids.push(c); });
      } else {
        t.decls.forEach(function (d) { if (!keep || keep(d)) kids.push(declNode(d, n)); });
      }
      if (!kids.length) { n.expanded = false; return n; }
      n.children = kids;
      return n;
    }

    var root = add({
      kind: "root", parent: null, children: [], expanded: true,
      label: "", name: "", count: 0, proved: 0, state: "proved", sort: ""
    });
    if (o.mode === "cone" && o.coneSet) {
      var list = [];
      o.coneSet.forEach(function (d) { if (!keep || keep(d) || (o.seeds && o.seeds.indexOf(d) >= 0)) list.push(d); });
      list.sort(function (a, b) { return B.decl[a].id < B.decl[b].id ? -1 : 1; });
      root.children = list.map(function (d) { return declNode(d, root); });
    } else {
      B.treeRoots.forEach(function (r) {
        var c = groupNode(r, root);
        if (c) root.children.push(c);
      });
    }
    nodes.forEach(function (n) {
      n.depth = 0;
      for (var p = n.parent; p; p = p.parent) n.depth++;
    });

    /* ---------- the edges between whatever is visible ----------

       An edge is drawn where it is laid out: in the deepest container holding both of
       its ends, between that container's own two children. So a view shows every
       dependency at the level you have opened it to, and an opened module leans on
       what is outside it along one line rather than along one per declaration. */
    nodes.forEach(function (n) {
      if (!n.children) return;
      n.pairs = new Map();
      n.index = new Map();
      n.children.forEach(function (c, i) { n.index.set(c.id, i); });
    });
    var agg = new Map(), raw = new Map();
    B.dedges.forEach(function (e) {
      var a = owner[e[0]], b = owner[e[1]];
      if (a < 0 || b < 0 || a === b) return;
      /* What actually touches what, box to box, whatever each is nested in. The cone is
         computed over this, and each of these knows which drawn edge stands in for it,
         so the drawing can light exactly the lines that carry a cone relation. */
      var rk = a * TD.KEY + b, rrec = raw.get(rk);
      if (!rrec) raw.set(rk, rrec = { a: nodes[a], b: nodes[b], w: 0, drawn: null });
      rrec.w++;
      var x = nodes[a], y = nodes[b];
      while (x.depth > y.depth) x = x.parent;
      while (y.depth > x.depth) y = y.parent;
      while (x !== y) { x = x.parent; y = y.parent; }
      var C = x, ca = nodes[a], cb = nodes[b];      /* the common container, and its two */
      while (ca.parent !== C) ca = ca.parent;
      while (cb.parent !== C) cb = cb.parent;
      if (ca === cb) return;                        /* both ends inside one child */
      var k = ca.id * TD.KEY + cb.id, rec = agg.get(k);
      if (rec) rec.w++;
      else agg.set(k, rec = { a: ca, b: cb, box: C, w: 1 });
      rrec.drawn = rec;
    });
    var edges = [];
    agg.forEach(function (rec) {
      rec.key = rec.box.index.get(rec.a.id) * TD.KEY + rec.box.index.get(rec.b.id);
      rec.box.pairs.set(rec.key, rec.w);
      edges.push(rec);
    });
    var fine = [];
    raw.forEach(function (rec) { fine.push(rec); });

    /* ---------- lay each container out, innermost first ---------- */
    nodes.forEach(o.measure);          /* box size for a leaf, title width for a container */
    layout(root, true);

    /* ---------- absolute positions, so edges can be drawn anywhere ---------- */
    (function place(n, ox, oy) {
      n.ax = ox; n.ay = oy;
      if (!n.children) return;
      var cx = ox + (n.kind === "root" ? 0 : PAD);
      var cy = oy + (n.kind === "root" ? 0 : PAD + HEAD);
      n.cx = cx; n.cy = cy;
      n.children.forEach(function (c) { place(c, cx + c.x, cy + c.y); });
    })(root, 0, 0);

    /* ---------- which edges the drawing can do without ---------- */
    edges.forEach(function (e) {
      e.essential = !e.box.redundant || !e.box.redundant.has(e.key);
    });

    /* the cone follows what touches what, not what the drawing chose to merge */
    var adj = { out: [], in: [] };
    for (var q = 0; q < nodes.length; q++) { adj.out.push([]); adj.in.push([]); }
    fine.forEach(function (e) { adj.out[e.a.id].push(e.b.id); adj.in[e.b.id].push(e.a.id); });

    return {
      root: root, nodes: nodes, edges: edges, fine: fine, owner: owner, adj: adj,
      width: root.w, height: root.h
    };
  }

  /* ---------- one container ---------- */
  function layout(n, isTop) {
    if (!n.children) return;           /* a leaf was already measured */
    n.children.forEach(function (c) { layout(c, false); });

    var kids = n.children, m = kids.length;
    var pairs = [];
    if (n.pairs) n.pairs.forEach(function (w, k) { pairs.push([Math.floor(k / TD.KEY), k % TD.KEY]); });
    var core = TD.layoutCore(m, pairs, {
      nameOf: function (i) { return kids[i].sort; },
      iterations: m > 400 ? 6 : 16,
      seeds: m > 900 ? 1 : 0
    });
    var gx = isTop ? TOP_GAP_X : GAP_X, gy = isTop ? TOP_GAP_Y : GAP_Y;

    /* columns run left to right, each as wide as the widest thing in it */
    var L = core.L, colW = [], colX = [], i;
    for (i = 0; i <= L; i++) colW.push(0);
    for (i = 0; i < m; i++) colW[core.layer[i]] = Math.max(colW[core.layer[i]], kids[i].w);
    var run = 0;
    for (i = 0; i <= L; i++) { colX.push(run); run += colW[i] + gx; }
    var contentW = Math.max(0, run - gx);

    /* down the column, by the same priority method the layers use */
    var pos = TD.xAssign(core, function (k) { return core.real[k] ? kids[k].h / 2 : 2; }, gy,
      m > 400 ? 8 : 16);
    squeeze(core, kids, pos, gy);

    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < m; i++) {
      lo = Math.min(lo, pos[i] - kids[i].h / 2);
      hi = Math.max(hi, pos[i] + kids[i].h / 2);
    }
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    for (i = 0; i < core.N2; i++) pos[i] -= lo;
    var contentH = hi - lo;

    for (i = 0; i < m; i++) {
      var l = core.layer[i];
      /* centred in its column: one open container makes a column far wider than its
         neighbours need, and hugging either edge would put all of that slack on one
         side of every edge that crosses it */
      kids[i].x = colX[l] + (colW[l] - kids[i].w) / 2;
      kids[i].y = pos[i] - kids[i].h / 2;
      kids[i].layer = l;
    }

    /* the shortcuts: pairs the reduction found nothing to say, and the ones it reversed */
    n.redundant = new Set();
    var inRed = new Set();
    core.red.forEach(function (e) { inRed.add(e[0] * TD.KEY + e[1]); });
    if (n.pairs) n.pairs.forEach(function (w, k) { if (!inRed.has(k)) n.redundant.add(k); });
    core.back.forEach(function (e) { n.redundant.add(e[0] * TD.KEY + e[1]); });

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
    var spans = [], i;
    for (i = 0; i < core.N2; i++) {
      var half = core.real[i] ? kids[i].h / 2 : 2;
      spans.push([pos[i] - half, pos[i] + half]);
    }
    if (spans.length < 2) return;
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var lane = Math.max(gap, CHANNEL);
    var merged = [spans[0].slice()];
    for (i = 1; i < spans.length; i++) {
      var last = merged[merged.length - 1];
      if (spans[i][0] - last[1] < lane) last[1] = Math.max(last[1], spans[i][1]);
      else merged.push(spans[i].slice());
    }
    if (merged.length < 2) return;
    var shift = [], run = merged[0][0];
    for (i = 0; i < merged.length; i++) {
      shift.push(run - merged[i][0]);
      run += (merged[i][1] - merged[i][0]) + lane;
    }
    var at = function (v) {
      var a = 0, b = merged.length - 1;
      while (a < b) {
        var mid = (a + b + 1) >> 1;
        if (merged[mid][0] <= v) a = mid; else b = mid - 1;
      }
      return v + shift[a];
    };
    for (i = 0; i < core.N2; i++) pos[i] = at(pos[i]);
  }

export { build, PAD, HEAD };
