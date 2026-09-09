/* Derivation pipeline for a tracker `graph` JSON.
   Input is the documented contract: { groups[], nodes[], edges[] }.
   Everything the page draws is computed here, with no project-specific assumptions.

   Three layers sit on top of one another:
     buildBase   the group tree and the graph between declarations, read once
     layoutCore  a layered (Sugiyama) layout of any DAG: cycles broken, layers
                 assigned, the transitive reduction taken, each layer ordered
     xAssign     positions along the layer, by the priority method

   scene.js calls the last two once per container; nothing here knows what a
   container is. */
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
  ["nodes", "groups", "edges"].forEach((k) => {
    if (!Array.isArray(g[k])) throw new Error('Missing the "' + k + '" array. This does not look like `tracker graph` output.');
  });
  if (!g.nodes.length) throw new Error("The graph has no nodes.");
  const n = g.nodes[0];
  if (typeof n.id !== "string" || typeof n.group !== "string")
    throw new Error('Nodes need "id" and "group" strings.');
  if (g.edges.length) {
    const e = g.edges[0];
    if (typeof e.from !== "string" || typeof e.to !== "string")
      throw new Error('Edges need "from" and "to" strings.');
  }
  return true;
}

/* ================================================================
   base: the group tree, the declaration graph, the module rollup
   ================================================================ */
function buildBase(g) {
  validate(g);

  /* ---- the tree of groups ------------------------------------- */
  const gidx = {}, T = [];
  function addGroup(rec) {
    rec.i = T.length;
    gidx[rec.name] = rec.i;
    T.push(rec);
    return rec.i;
  }
  function blank(name, parent, desc, done, ready, implied) {
    return {
      i: -1, name, label: lastSeg(name, "/"), short: name,
      parentName: parent || null, parent: null, kids: [], level: 0,
      decls: [], subDecls: [], byState: zeroStates(), state: "open",
      desc: desc || "", done: !!done, ready: !!ready, topic: -1, hue: 0,
      implied: !!implied
    };
  }
  g.groups.forEach((x) => {
    if (gidx[x.name] === undefined) addGroup(blank(x.name, x.parent, x.desc, x.done, x.ready, false));
  });
  /* a node may name a group the plan does not list; it still needs a home */
  g.nodes.forEach((n) => {
    if (gidx[n.group] === undefined) addGroup(blank(n.group, null, "", false, false, true));
  });
  T.forEach((t) => {
    const p = t.parentName != null ? gidx[t.parentName] : undefined;
    t.parent = (p === undefined || p === t.i) ? null : p;
  });
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

  /* the level of a group is its depth below its root */
  const stack = treeRoots.slice();
  treeRoots.forEach((r) => { T[r].level = 0; });
  while (stack.length) {
    const u = stack.pop();
    T[u].kids.forEach((k) => { T[k].level = T[u].level + 1; stack.push(k); });
  }

  T.forEach((t) => {
    t.isModule = t.kids.length === 0;
    t.kids.sort((a, b) => (T[a].name < T[b].name ? -1 : 1));
  });
  /* the topic is the ancestor just below the root: the level at which colour is legible */
  T.forEach((t) => {
    let cur = t.i;
    while (T[cur].level > 1) cur = T[cur].parent;
    t.topic = cur;
    let r = t.i;
    while (T[r].parent !== null) r = T[r].parent;
    t.root = r;
  });

  const roots = treeRoots.map((r) => T[r].name);
  const rootPrefix = roots.length === 1 ? roots[0] + "/" : null;
  const shortOf = (name) =>
    (rootPrefix && name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);
  T.forEach((t) => { t.short = shortOf(t.name); });

  /* ---- the declarations --------------------------------------- */
  const D = [], didx = {}, states = zeroStates(), kinds = {};
  g.nodes.forEach((n) => {
    const st = n.wrong ? "wrong" : normState(n.state);
    const kd = n.kind === "definition" ? "definition" : (n.kind === "theorem" ? "theorem" : (n.kind || "other"));
    const d = {
      i: D.length, id: n.id, label: lastSeg(n.id, "."), g: gidx[n.group],
      kind: kd, state: st, desc: n.desc || "", source: n.source || null,
      wrong: n.wrong || null, deprecated: n.deprecated || null, path: null
    };
    didx[n.id] = d.i;
    D.push(d);
    states[st]++;
    kinds[kd] = (kinds[kd] || 0) + 1;
  });
  /* attach each declaration to its group and to every ancestor of it */
  D.forEach((d) => {
    let cur = d.g;
    const path = [];
    T[cur].decls.push(d.i);
    while (cur !== null) { path.push(cur); T[cur].subDecls.push(d.i); T[cur].byState[d.state]++; cur = T[cur].parent; }
    path.reverse();
    d.path = path;                              /* root … own group */
  });
  T.forEach((t) => { t.sub = t.subDecls.length; t.state = rollState(t.byState); });

  /* ---- the declaration graph ---------------------------------- */
  const DE = [], dout = [], din = [];
  let dangling = 0;
  for (let q = 0; q < D.length; q++) { dout.push([]); din.push([]); }
  g.edges.forEach((e) => {
    const u = didx[e.from], v = didx[e.to];
    if (u === undefined || v === undefined || u === v) { dangling++; return; }
    DE.push([u, v, (e.real ? 1 : 0) | (e.suggested ? 2 : 0)]);
    dout[u].push(v); din[v].push(u);
  });

  /* ---- topics: the colour dimension of the explorer ------------
     The root decides the family and the topic decides the shade inside it, so that
     the first thing colour says is which library a node belongs to — a backbone and
     its surfaces read apart at a glance — and the second is which area of it.
     A project with one root gets the whole wheel, as it should. */
  const bySize = (a, b) => T[b].sub - T[a].sub || (T[a].name < T[b].name ? -1 : 1);
  const liveRoots = treeRoots.filter((r) => T[r].sub).sort(bySize);
  const band = liveRoots.length > 1 ? (360 / liveRoots.length) * 0.44 : 320;
  const topics = [];
  liveRoots.forEach((r, ri) => {
    const base = Math.round((205 + ri * 360 / liveRoots.length) % 360);
    T[r].hue = base; T[r].tone = 0; T[r].topicSlot = 0;
    const kids = [];
    T.forEach((t) => { if (t.sub && t.root === r && t.topic === t.i && t.level === 1) kids.push(t.i); });
    if (!kids.length) { topics.push(r); return; }   /* a root that holds results itself */
    kids.sort(bySize);
    const m = kids.length, step = m > 1 ? Math.min(17, band / (m - 1)) : 0;
    kids.forEach((ti, k) => {
      T[ti].hue = Math.round((base + (k - (m - 1) / 2) * step + 360) % 360);
      T[ti].tone = k % 3;
      T[ti].topicSlot = k;
      topics.push(ti);
    });
  });
  T.forEach((t) => {
    const src = T[t.topic];
    t.hue = src.hue || 0; t.tone = src.tone || 0; t.topicSlot = src.topicSlot || 0;
  });

  const modules = T.filter((t) => t.decls.length).length;

  return {
    tree: T, gidx, treeRoots, topics, roots,
    decl: D, didx, dedges: DE, dout, din,
    meta: {
      nodes: D.length, groups: g.groups.length, modules,
      edges: g.edges.length, dangling,
      states, kinds,
      rootDesc: (T[treeRoots[0]] || {}).desc || ""
    }
  };
}
/* ================================================================
   layoutCore — the layered layout of any DAG, up to ordering.
   pairs: [a, b] means "a depends on b", so a is drawn above b.
   ================================================================ */
function layoutCore(R, pairs, opt) {
  opt = opt || {};
  if (!R) {
    return {
      R: 0, L: 0, N2: 0, layer: new Int32Array(0), lay: [], real: [], rows: [],
      rank: new Int32Array(0), red: [], back: [], chains: [], up: [], dn: [],
      topo: [], crossings: 0, routed: 0
    };
  }
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

  /* --- layering: longest path from the bottom --- */
  const layer = new Int32Array(R);
  topo.forEach((u) => {
    let mx = 0;
    dsucc[u].forEach((v) => { if (layer[v] + 1 > mx) mx = layer[v] + 1; });
    layer[u] = mx;
  });
  let L = 0;
  for (let i = 0; i < R; i++) if (layer[i] > L) L = layer[i];

  /* --- transitive reduction, over bitsets so it scales past a few hundred nodes --- */
  const WS = (R + 31) >> 5;
  let reach = new Uint32Array(R * WS);
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
  reach = null;

  /* --- slide each node within its slack to shorten the essential edges --- */
  const rdn = [], rup = [];
  for (let i = 0; i < R; i++) { rdn.push([]); rup.push([]); }
  red.forEach(([a, b]) => { rdn[a].push(b); rup[b].push(a); });
  for (let it = 0; it < 40; it++) {
    let moved = 0;
    for (const u of topo) {
      let lo = 0, hi = Infinity;
      rdn[u].forEach((v) => { if (layer[v] + 1 > lo) lo = layer[v] + 1; });
      rup[u].forEach((w) => { if (layer[w] - 1 < hi) hi = layer[w] - 1; });
      if (hi === Infinity) hi = L;
      if (hi < lo) hi = lo;
      let bestL = layer[u], bestC = Infinity;
      for (let l = lo; l <= hi; l++) {
        let c = 0;
        rdn[u].forEach((v) => { c += l - layer[v]; });
        rup[u].forEach((w) => { c += layer[w] - l; });
        if (c < bestC) { bestC = c; bestL = l; }
      }
      if (bestL !== layer[u]) { layer[u] = bestL; moved++; }
    }
    if (!moved) break;
  }

  /* --- proper graph: long edges routed through invisible nodes --- */
  const lay = Array.from(layer), real = [], chains = [];
  for (let i = 0; i < R; i++) real.push(true);
  red.forEach(([a, b]) => {
    /* the chain runs downwards, from the dependent to what it rests on, so the
       routing nodes are laid out in descending layers and every hop is one layer */
    const ch = [a];
    for (let l = lay[a] - 1; l > lay[b]; l--) { ch.push(lay.length); lay.push(l); real.push(false); }
    ch.push(b);
    chains.push(ch);
  });
  const N2 = lay.length;
  const up = [], dn = [];
  for (let i = 0; i < N2; i++) { up.push([]); dn.push([]); }
  chains.forEach((ch) => {
    for (let i = 0; i < ch.length - 1; i++) { dn[ch[i]].push(ch[i + 1]); up[ch[i + 1]].push(ch[i]); }
  });

  /* --- ordering within each layer --- */
  const rows = [];
  for (let l = 0; l <= L; l++) rows.push([]);
  const nameOf = opt.nameOf || ((i) => String(i));
  const byName = [];
  for (let i = 0; i < R; i++) byName.push(i);
  byName.sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1));
  const SEEDS = [byName, topo.slice(), linear.slice()];
  const applySeed = (seq) => {
    for (let l = 0; l <= L; l++) rows[l] = [];
    seq.forEach((u) => { if (u < R) rows[lay[u]].push(u); });
    for (let d = R; d < N2; d++) rows[lay[d]].push(d);
  };
  const rank = new Int32Array(N2);
  const reindex = () => { rows.forEach((r) => { r.forEach((u, i) => { rank[u] = i; }); }); };

  /* bilayer crossings by Barth, Jünger and Mutzel: sort the endpoints, then count
     inversions with an accumulator tree, which is what lets a big layer stay cheap */
  const biCross = (l) => {
    if (l < 0 || l >= L) return 0;
    const south = rows[l], northN = rows[l + 1].length;
    if (!northN) return 0;
    const seq = [];
    for (const s of south) {
      const nb = up[s];
      if (!nb.length) continue;
      const tmp = nb.map((v) => rank[v]).sort((a, b) => a - b);
      for (const r of tmp) seq.push(r);
    }
    if (seq.length < 2) return 0;
    let first = 1;
    while (first < northN) first *= 2;
    const tree = new Int32Array(2 * first - 1);
    first -= 1;
    let cross = 0;
    for (const s of seq) {
      let idx = s + first;
      tree[idx]++;
      while (idx > 0) {
        if (idx % 2) cross += tree[idx + 1];
        idx = (idx - 1) >> 1;
        tree[idx]++;
      }
    }
    return cross;
  };
  const total = () => {
    let s = 0;
    for (let l = 0; l < L; l++) s += biCross(l);
    return s;
  };
  const med = (u, dir) => {
    const nb = dir ? up[u] : dn[u];
    if (!nb.length) return -1;
    const arr = nb.map((v) => rank[v]).sort((a, b) => a - b);
    const h = arr.length >> 1;
    return arr.length % 2 ? arr[h] : (arr[h - 1] + arr[h]) / 2;
  };
  const wmedian = (down) => {
    const seq = [];
    for (let l = 0; l <= L; l++) seq.push(l);
    if (!down) seq.reverse();
    seq.forEach((li) => {
      const key = new Map();
      rows[li].forEach((u) => { const m = med(u, !down); key.set(u, m < 0 ? rank[u] : m); });
      rows[li].sort((a, b) => key.get(a) - key.get(b) || rank[a] - rank[b]);
      reindex();
    });
  };
  const pairCross = (u, v, adj) => {
    const A = adj[u], B = adj[v];
    let c = 0;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++)
      if (rank[A[i]] > rank[B[j]]) c++;
    return c;
  };
  const transpose = () => {
    let improved = true, guard = 0;
    while (improved && guard++ < 30) {
      improved = false;
      for (let li = 0; li <= L; li++) {
        const row = rows[li];
        for (let i = 0; i + 1 < row.length; i++) {
          const u = row[i], v = row[i + 1];
          const before = pairCross(u, v, up) + pairCross(u, v, dn);
          const after = pairCross(v, u, up) + pairCross(v, u, dn);
          if (after < before) {
            row[i] = v; row[i + 1] = u;
            rank[v] = i; rank[u] = i + 1;
            improved = true;
          }
        }
      }
    }
  };
  const ITER = opt.iterations || (N2 > 4000 ? 4 : N2 > 1200 ? 8 : 16);
  const seeds = opt.seeds === 1 ? [SEEDS[0]] : SEEDS;
  let best = null, bestC = Infinity;
  const keep = (c) => {
    if (c >= bestC) return;
    bestC = c;
    best = rows.map((r) => r.slice());
  };
  seeds.forEach((seq) => {
    applySeed(seq); reindex();
    keep(total());
    for (let it = 0; it < ITER; it++) {
      wmedian(it % 2 === 0);
      transpose();
      keep(total());
    }
  });
  for (let l = 0; l <= L; l++) rows[l] = best[l];
  reindex();

  return {
    R, L, N2, layer, lay, real, rows, rank,
    red, back, chains, up, dn, topo,
    crossings: bestC, routed: N2 - R
  };
}

/* --- x by the priority method: routing nodes first, so long edges straighten.
       halfWidth(i) is in whatever unit the caller wants x back in. --- */
function xAssign(core, halfWidth, sep, iterations) {
  const { N2, rows, up, dn, real, L } = core;
  const prio = new Int32Array(N2);
  for (let i = 0; i < N2; i++) prio[i] = real[i] ? (up[i].length + dn[i].length) : 100000;
  const pos = new Float64Array(N2);
  const gapOf = (a, b) => halfWidth(a) + halfWidth(b) + sep;
  rows.forEach((r) => {
    let x = 0;
    r.forEach((u, i) => {
      if (i) x += gapOf(r[i - 1], u);
      pos[u] = x;
    });
    const mid = x / 2;
    r.forEach((u) => { pos[u] -= mid; });
  });
  const medPos = (arr) => {
    if (!arr.length) return null;
    const a = arr.map((v) => pos[v]).sort((x, y) => x - y);
    const h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  };
  /* move one node towards its median, as far as the nodes beyond it will allow,
     and drag the lower-priority ones along with it */
  const shift = (row, i, target) => {
    const v = row[i];
    if (target > pos[v] + 1e-9) {
      let need = 0, limit = Infinity;
      for (let j = i + 1; j < row.length; j++) {
        need += gapOf(row[j - 1], row[j]);
        if (prio[row[j]] >= prio[v]) { limit = pos[row[j]] - need; break; }
      }
      const nx = Math.min(target, limit);
      if (nx <= pos[v]) return;
      pos[v] = nx;
      for (let j = i + 1; j < row.length; j++) {
        const g = gapOf(row[j - 1], row[j]);
        if (pos[row[j]] < pos[row[j - 1]] + g) pos[row[j]] = pos[row[j - 1]] + g; else break;
      }
    } else if (target < pos[v] - 1e-9) {
      let need = 0, limit = -Infinity;
      for (let j = i - 1; j >= 0; j--) {
        need += gapOf(row[j], row[j + 1]);
        if (prio[row[j]] >= prio[v]) { limit = pos[row[j]] + need; break; }
      }
      const nx = Math.max(target, limit);
      if (nx >= pos[v]) return;
      pos[v] = nx;
      for (let j = i - 1; j >= 0; j--) {
        const g = gapOf(row[j], row[j + 1]);
        if (pos[row[j]] > pos[row[j + 1]] - g) pos[row[j]] = pos[row[j + 1]] - g; else break;
      }
    }
  };
  const IT = iterations || 16;
  for (let it = 0; it < IT; it++) {
    const down = it % 2 === 0;
    const seq = [];
    for (let l = 0; l <= L; l++) seq.push(l);
    if (!down) seq.reverse();
    seq.forEach((li) => {
      const row = rows[li];
      const byPrio = row.map((_, i) => i).sort((a, b) => prio[row[b]] - prio[row[a]]);
      byPrio.forEach((i) => {
        const v = row[i], ref = down ? up[v] : dn[v];
        const t = medPos(ref.length ? ref : (down ? dn[v] : up[v]));
        if (t !== null) shift(row, i, t);
      });
    });
  }
  rows.forEach((r) => {
    for (let i = 1; i < r.length; i++) {
      const g = gapOf(r[i - 1], r[i]);
      if (pos[r[i]] - pos[r[i - 1]] < g) pos[r[i]] = pos[r[i - 1]] + g;
    }
  });
  return pos;
}

/* --- the cone around a set of declarations, over the declaration graph --- */
function cone(base, seeds, dir, radius) {
  const out = new Set(seeds);
  const R = (radius == null || radius < 0) ? Infinity : radius;
  const expand = (adj) => {
    let front = seeds.slice(), step = 0;
    while (front.length && step < R) {
      const next = [];
      front.forEach((u) => {
        adj[u].forEach((v) => { if (!out.has(v)) { out.add(v); next.push(v); } });
      });
      front = next; step++;
    }
  };
  if (dir !== "up") expand(base.dout);        /* what it rests on */
  if (dir !== "down") expand(base.din);       /* what rests on it */
  return out;
}

export { STATES, KEY, buildBase, layoutCore, xAssign, cone, rollState };
