/* Derivation pipeline for a tracker `graph` JSON.
   Input is the documented contract: { modules[], nodes[] }, whose entries name each
   other by index. Everything the page draws is computed here, with no project-specific
   assumptions.

   Three things live here:
     buildBase   the module tree and the graph between declarations, read once
     reduce      the transitive reduction of one container's edges, with the
                 cycles among them broken first
     address     how the project writes down which node it means, and reads it back

   scene.js calls the second once per container and hands what survives to the
   layout engine; nothing here knows what a container is. */
const STATES = ["proved", "stated", "open", "axioms", "wrong"];
const KEY = 1048576;                     /* pair-key radix; graphs stay well under it */

function zeroStates() {
  const o = {};
  for (const s of STATES) o[s] = 0;
  return o;
}
const normState = (s) => (STATES.includes(s) ? s : "open");
function lastSeg(name, sep) {
  const i = name.lastIndexOf(sep);
  return i < 0 ? name : name.slice(i + 1);
}
/* the state a container reports: the worst thing under it wins, so a dot never
   overstates progress, but a container that still holds finished work is not "open" */
function rollState(by) {
  return by.wrong ? "wrong"
    : by.axioms ? "axioms"
      : by.open ? (by.proved || by.stated ? "stated" : "open")
        : by.stated ? "stated" : "proved";
}

function validate(g) {
  if (!g || typeof g !== "object") throw new Error("Not a JSON object.");
  if (Array.isArray(g.groups) || Array.isArray(g.edges))
    throw new Error("This is the graph of an older tracker, with groups and edges. Export it "
      + "again with the current one: `lake exe tracker graph`.");
  ["modules", "nodes"].forEach((k) => {
    if (!Array.isArray(g[k])) throw new Error('Missing the "' + k + '" table. This does not look like `tracker graph` output.');
  });
  if (!g.nodes.length) throw new Error("The graph has no nodes.");
  const n = g.nodes[0], m = g.modules[0];
  if (typeof n.id !== "string" || typeof n.module !== "number")
    throw new Error('Nodes need an "id" string and a "module" index.');
  if (!m || typeof m.name !== "string") throw new Error('Modules need a "name" string.');
  return true;
}

/* ================================================================
   base: the module tree, the declaration graph, the rollup
   ================================================================ */
function buildBase(g) {
  validate(g);

  /* ---- the module tree ---------------------------------------- */
  const blank = (i, x) => ({
    i, name: x.name, label: lastSeg(x.name, "."), short: x.name,
    parent: null, kids: [], level: 0,
    decls: [], subDecls: [], byState: zeroStates(), state: "open",
    desc: x.desc || "", exists: !!x.exists, plan: !!x.plan, done: !!x.done, ready: !!x.ready,
    topic: -1, hue: 0, tone: 0
  });
  const T = g.modules.map((x, i) => blank(i, x));
  g.modules.forEach((x, i) => {
    const p = x.parent;
    T[i].parent = (Number.isInteger(p) && T[p] && p !== i) ? p : null;
  });
  /* a node may name a module the file does not list; it still needs a home */
  let orphans = -1;
  const home = (m) => {
    if (Number.isInteger(m) && T[m]) return m;
    if (orphans < 0) { orphans = T.length; T.push(blank(orphans, { name: "(no module)" })); }
    return orphans;
  };
  /* a malformed plan could name a parent cycle; cut it rather than hang */
  T.forEach((t) => {
    const seen = new Set();
    let cur = t.i;
    while (T[cur].parent !== null) {
      if (seen.has(cur)) { T[cur].parent = null; break; }
      seen.add(cur); cur = T[cur].parent;
    }
  });
  T.forEach((t) => { if (t.parent !== null) T[t.parent].kids.push(t.i); });
  const treeRoots = [];
  T.forEach((t) => { if (t.parent === null) treeRoots.push(t.i); });

  /* the level of a module is its depth below its root */
  const stack = treeRoots.slice();
  treeRoots.forEach((r) => { T[r].level = 0; });
  while (stack.length) {
    const u = stack.pop();
    T[u].kids.forEach((k) => { T[k].level = T[u].level + 1; stack.push(k); });
  }

  T.forEach((t) => {
    t.isLeaf = t.kids.length === 0;
    t.kids.sort((a, b) => (T[a].name < T[b].name ? -1 : 1));
  });
  /* the topic is the ancestor just below the root: the level at which colour is legible */
  T.forEach((t) => {
    let cur = t.i;
    while (T[cur].level > 1) cur = T[cur].parent;
    t.topic = cur;
  });

  /* with one root, its name is noise in front of every module's */
  const rootPrefix = treeRoots.length === 1 ? T[treeRoots[0]].name + "." : null;
  T.forEach((t) => {
    t.short = rootPrefix && t.name.startsWith(rootPrefix) ? t.name.slice(rootPrefix.length) : t.name;
  });

  /* ---- the declarations --------------------------------------- */
  const D = g.nodes.map((n, i) => ({
    i, id: n.id, label: lastSeg(n.id, "."), g: home(n.module), planned: !!n.planned,
    kind: n.kind || "other", state: n.wrong ? "wrong" : normState(n.state),
    desc: n.desc || "", source: n.source || null,
    wrong: n.wrong || null, deprecated: n.deprecated || null
  }));
  /* Attach each declaration to its module and to every module above it. Progress is
     counted over the planned declarations, as `tracker status` counts it: they are what
     the plan asks for, and the rest are helpers, nearly always proved. A module with no
     planned declaration in or under it is measured by all of its declarations instead.
     `sub` counts every declaration either way: it is how big a module is. */
  const all = T.map(() => zeroStates());
  D.forEach((d) => {
    T[d.g].decls.push(d.i);
    for (let cur = d.g; cur !== null; cur = T[cur].parent) {
      T[cur].subDecls.push(d.i);
      all[cur][d.state]++;
      if (d.planned) T[cur].byState[d.state]++;
    }
  });
  T.forEach((t) => {
    t.sub = t.subDecls.length;
    if (!STATES.some((s) => t.byState[s])) t.byState = all[t.i];
    t.goal = STATES.reduce((a, s) => a + t.byState[s], 0);
    t.measured = t.byState === all[t.i] ? "all" : "planned";
    t.state = rollState(t.byState);
  });

  /* ---- the declaration graph ----------------------------------
     What a node rests on is in its `deps` and its `suggested`, as indexes into
     `nodes`; both are drawn, since an open declaration has only the second. */
  const DE = [], dout = [], din = [];
  for (let q = 0; q < D.length; q++) { dout.push([]); din.push([]); }
  g.nodes.forEach((n, u) => {
    const seen = new Set();
    for (const v of [...(n.deps || []), ...(n.suggested || [])]) {
      /* an index the file does not have has no end to draw to */
      if (!Number.isInteger(v) || !D[v] || v === u || seen.has(v)) continue;
      seen.add(v);
      DE.push([u, v]);
      dout[u].push(v); din[v].push(u);
    }
  });

  /* ---- topics: the colour dimension of the explorer ------------
     The root decides the family and the topic decides the shade inside it, so that
     the first thing colour says is which library a node belongs to — a backbone and
     its surfaces read apart at a glance — and the second is which area of it.
     A project with one root gets the whole wheel, as it should. */
  const bySize = (a, b) => T[b].sub - T[a].sub || (T[a].name < T[b].name ? -1 : 1);
  const liveRoots = treeRoots.filter((r) => T[r].sub).sort(bySize);
  const band = liveRoots.length > 1 ? (360 / liveRoots.length) * 0.44 : 320;
  liveRoots.forEach((r, ri) => {
    const base = Math.round((205 + ri * 360 / liveRoots.length) % 360);
    T[r].hue = base;
    const kids = T[r].kids.filter((k) => T[k].sub).sort(bySize);
    const m = kids.length, step = m > 1 ? Math.min(17, band / (m - 1)) : 0;
    kids.forEach((ti, k) => {
      T[ti].hue = Math.round((base + (k - (m - 1) / 2) * step + 360) % 360);
      T[ti].tone = k % 3;
    });
  });
  T.forEach((t) => { t.hue = T[t.topic].hue; t.tone = T[t.topic].tone; });

  return {
    tree: T, treeRoots, decl: D, dedges: DE, dout, din,
    meta: {
      nodes: D.length, modules: T.filter((t) => t.decls.length).length,
      planned: D.filter((d) => d.planned).length
    }
  };
}
/* ================================================================
   reduce — what the drawing can do without, for one container.
   pairs: [a, b] means "a depends on b". Returns the edges that survive the
   transitive reduction (`red`) and the ones a cycle forced backwards (`back`);
   everything else is a shortcut across a chain the drawing already shows.
   ================================================================ */
function reduce(R, pairs) {
  const succ = [], pred = [];
  for (let i = 0; i < R; i++) { succ.push(new Set()); pred.push(new Set()); }
  pairs.forEach(([a, b]) => {
    if (a === b) return;
    succ[a].add(b); pred[b].add(a);
  });

  /* --- break cycles: greedy feedback arc set (Eades, Lin & Smyth) --- */
  function feedbackArcOrder() {
    const left = [], right = [];
    const alive = new Uint8Array(R).fill(1);
    const outd = new Int32Array(R), ind = new Int32Array(R);
    let remaining = R;
    for (let u = 0; u < R; u++) { outd[u] = succ[u].size; ind[u] = pred[u].size; }
    const kill = (u) => {
      alive[u] = 0; remaining--;
      succ[u].forEach((v) => { if (alive[v]) ind[v]--; });
      pred[u].forEach((v) => { if (alive[v]) outd[v]--; });
    };
    while (remaining > 0) {
      let moved = true;
      while (moved) {
        moved = false;
        for (let s = 0; s < R; s++) if (alive[s] && outd[s] === 0) { right.unshift(s); kill(s); moved = true; }
        for (let t = 0; t < R; t++) if (alive[t] && ind[t] === 0) { left.push(t); kill(t); moved = true; }
      }
      if (remaining > 0) {
        let best = -1, bd = -Infinity;
        for (let w = 0; w < R; w++) if (alive[w] && outd[w] - ind[w] > bd) { bd = outd[w] - ind[w]; best = w; }
        left.push(best); kill(best);
      }
    }
    return left.concat(right).reverse();
  }
  const linear = feedbackArcOrder();       /* base nodes first, dependents after */

  const lrank = new Int32Array(R);
  linear.forEach((u, i) => { lrank[u] = i; });
  const removed = new Set(), back = [];
  for (let u = 0; u < R; u++) succ[u].forEach((v) => {
    /* u -> v means u rests on v, so v should come earlier in the linear order */
    if (lrank[v] > lrank[u]) { back.push([u, v]); removed.add(u * KEY + v); }
  });
  const dag = [];
  for (let u = 0; u < R; u++) succ[u].forEach((v) => { if (!removed.has(u * KEY + v)) dag.push([u, v]); });

  const dsucc = [], dpred = [];
  for (let i = 0; i < R; i++) { dsucc.push([]); dpred.push([]); }
  dag.forEach(([u, v]) => { dsucc[u].push(v); dpred[v].push(u); });

  /* --- topological order of the acyclic remainder: sinks first --- */
  const indeg = new Int32Array(R);
  dag.forEach(([u]) => { indeg[u]++; });
  const q = [], topo = [], ind = Int32Array.from(indeg);
  for (let i = 0; i < R; i++) if (!indeg[i]) q.push(i);
  while (q.length) {
    const u = q.pop();
    topo.push(u);
    dpred[u].forEach((w) => { if (--ind[w] === 0) q.push(w); });
  }

  /* --- transitive reduction, over bitsets so it scales past a few hundred nodes --- */
  const WS = (R + 31) >> 5;
  const reach = new Uint32Array(R * WS);
  topo.forEach((u) => {
    const ub = u * WS;
    for (let i = 0; i < dsucc[u].length; i++) {
      const v = dsucc[u][i], vb = v * WS;
      reach[ub + (v >> 5)] |= (1 << (v & 31));
      for (let w = 0; w < WS; w++) reach[ub + w] |= reach[vb + w];
    }
  });
  const red = [];
  dag.forEach(([u, v]) => {
    let dup = false;
    for (let i = 0; i < dsucc[u].length; i++) {
      const w = dsucc[u][i];
      if (w !== v && (reach[w * WS + (v >> 5)] & (1 << (v & 31)))) { dup = true; break; }
    }
    if (!dup) red.push([u, v]);
  });
  return { red, back };
}

/* ================================================================
   address — how this project writes down which node it means.

     Numlib.Krylov                                      a module
     Numlib.Krylov.CR,Numlib.Krylov.CR.isMinResIterate  a declaration

   The module name, as `import` writes it, and then — for a declaration — a comma and
   the id it is declared under. Both halves, because
   neither alone says where a thing is: a Lean name does not say which file it was
   written in, and a file does not say what is in it. So an address is a module and, if
   the thing addressed is inside it, the name of the thing inside it. The comma is what
   tells the two apart, and neither half can hold one.

   A declaration is found by its own name; the module in front of it is not a second
   condition to satisfy but the context that makes the address legible — a declaration
   that has since moved to another file is still that declaration, and a link to it
   should still arrive. A module is found by its name.

   This is the one place the format is written down. Everything that has to name a node
   — the address bar above all — reads and writes it through here. Somewhere that cannot
   take a name as it stands hands in an escape, which is applied to each part and never
   to the punctuation between them: that way a comma inside a name is escaped out of the
   way of the comma that means "and inside it", and the address still reads as one.
   ================================================================ */
function address(base, ref, esc = (s) => s) {
  const decl = ref.t === 1 ? base.decl[ref.i] : null;
  const module = base.tree[decl ? decl.g : ref.i];
  const name = module.name.split(".").map(esc).join(".");
  return decl ? `${name},${esc(decl.id)}` : name;
}
/* the node an address names, or null if this graph does not have it */
function refAt(base, addr, unesc = (s) => s) {
  const c = addr.indexOf(",");
  if (c < 0) {
    const name = addr.split(".").map(unesc).join(".");
    const g = base.tree.findIndex((t) => t.name === name);
    return g < 0 ? null : { t: 0, i: g };
  }
  const d = base.decl.findIndex((x) => x.id === unesc(addr.slice(c + 1)));
  return d < 0 ? null : { t: 1, i: d };
}

/* --- The cone around a set of declarations, over the declaration graph: everything
   they rest on and everything that rests on them, all the way down and all the way up.
   Stopping short of that is a picture with an edge that means nothing — a box at the
   boundary looks like a box that rests on nothing — so the whole of it is drawn, and
   the drawing asks before it lays out a cone too big to read.

   Each direction is walked on its own. Sharing one visited set between them would let
   the walk downwards stop the walk upwards: a declaration the seeds rest on can also
   rest on them — through another seed, or around a cycle — and reaching it downwards
   first would leave everything above it out of the picture. --- */
function cone(base, seeds) {
  const out = new Set(seeds);
  const expand = (adj) => {
    const seen = new Set(seeds), todo = seeds.slice();
    while (todo.length) {
      const u = todo.pop();
      for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); out.add(v); todo.push(v); }
    }
  };
  expand(base.dout);                          /* what they rest on */
  expand(base.din);                           /* what rests on them */
  return out;
}

export { STATES, KEY, buildBase, reduce, cone, address, refAt };
