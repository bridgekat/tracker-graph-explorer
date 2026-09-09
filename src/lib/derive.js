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
/* eslint-disable */

  var STATES = ["proved", "stated", "open", "axioms", "wrong"];
  var KEY = 1048576;                       /* pair-key radix; graphs stay well under it */

  function zeroStates() {
    var o = {};
    for (var i = 0; i < STATES.length; i++) o[STATES[i]] = 0;
    return o;
  }
  function normState(s) { return STATES.indexOf(s) >= 0 ? s : "open"; }
  function lastSeg(name, sep) {
    var i = name.lastIndexOf(sep);
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
    ["nodes", "groups", "edges"].forEach(function (k) {
      if (!Array.isArray(g[k])) throw new Error('Missing the "' + k + '" array. This does not look like `tracker graph` output.');
    });
    if (!g.nodes.length) throw new Error("The graph has no nodes.");
    var n = g.nodes[0];
    if (typeof n.id !== "string" || typeof n.group !== "string")
      throw new Error('Nodes need "id" and "group" strings.');
    if (g.edges.length) {
      var e = g.edges[0];
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
    var gidx = {}, T = [];
    function addGroup(rec) {
      rec.i = T.length;
      gidx[rec.name] = rec.i;
      T.push(rec);
      return rec.i;
    }
    function blank(name, parent, desc, done, ready, implied) {
      return {
        i: -1, name: name, label: lastSeg(name, "/"), short: name,
        parentName: parent || null, parent: null, kids: [], level: 0,
        decls: [], subDecls: [], byState: zeroStates(), state: "open",
        desc: desc || "", done: !!done, ready: !!ready, topic: -1, hue: 0,
        implied: !!implied
      };
    }
    g.groups.forEach(function (x) {
      if (gidx[x.name] === undefined) addGroup(blank(x.name, x.parent, x.desc, x.done, x.ready, false));
    });
    /* a node may name a group the plan does not list; it still needs a home */
    g.nodes.forEach(function (n) {
      if (gidx[n.group] === undefined) addGroup(blank(n.group, null, "", false, false, true));
    });
    T.forEach(function (t) {
      var p = t.parentName != null ? gidx[t.parentName] : undefined;
      t.parent = (p === undefined || p === t.i) ? null : p;
    });
    /* a malformed plan could name a parent cycle; cut it rather than hang */
    T.forEach(function (t) {
      var seen = {}, cur = t.i;
      while (T[cur].parent !== null) {
        if (seen[cur]) { T[cur].parent = null; break; }
        seen[cur] = 1; cur = T[cur].parent;
      }
    });
    T.forEach(function (t) { if (t.parent !== null) T[t.parent].kids.push(t.i); });
    var treeRoots = [];
    T.forEach(function (t) { if (t.parent === null) treeRoots.push(t.i); });
    (function setLevels() {
      var stack = treeRoots.slice();
      treeRoots.forEach(function (r) { T[r].level = 0; });
      while (stack.length) {
        var u = stack.pop();
        T[u].kids.forEach(function (k) { T[k].level = T[u].level + 1; stack.push(k); });
      }
    })();
    T.forEach(function (t) {
      t.isModule = t.kids.length === 0;
      t.kids.sort(function (a, b) { return T[a].name < T[b].name ? -1 : 1; });
    });
    /* the topic is the ancestor just below the root: the level at which colour is legible */
    T.forEach(function (t) {
      var cur = t.i;
      while (T[cur].level > 1) cur = T[cur].parent;
      t.topic = cur;
      var r = t.i;
      while (T[r].parent !== null) r = T[r].parent;
      t.root = r;
    });

    var roots = treeRoots.map(function (r) { return T[r].name; });
    var rootPrefix = roots.length === 1 ? roots[0] + "/" : null;
    var shortOf = function (name) {
      return rootPrefix && name.indexOf(rootPrefix) === 0 ? name.slice(rootPrefix.length) : name;
    };
    T.forEach(function (t) { t.short = shortOf(t.name); });

    /* ---- the declarations --------------------------------------- */
    var D = [], didx = {}, states = zeroStates(), kinds = {};
    g.nodes.forEach(function (n) {
      var st = n.wrong ? "wrong" : normState(n.state);
      var kd = n.kind === "definition" ? "definition" : (n.kind === "theorem" ? "theorem" : (n.kind || "other"));
      var d = {
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
    D.forEach(function (d) {
      var cur = d.g, path = [];
      T[cur].decls.push(d.i);
      while (cur !== null) { path.push(cur); T[cur].subDecls.push(d.i); T[cur].byState[d.state]++; cur = T[cur].parent; }
      path.reverse();
      d.path = path;                              /* root … own group */
    });
    T.forEach(function (t) { t.sub = t.subDecls.length; t.state = rollState(t.byState); });

    /* ---- the declaration graph ---------------------------------- */
    var DE = [], dout = [], din = [], dangling = 0;
    for (var q = 0; q < D.length; q++) { dout.push([]); din.push([]); }
    g.edges.forEach(function (e) {
      var u = didx[e.from], v = didx[e.to];
      if (u === undefined || v === undefined || u === v) { dangling++; return; }
      DE.push([u, v, (e.real ? 1 : 0) | (e.suggested ? 2 : 0)]);
      dout[u].push(v); din[v].push(u);
    });

    /* ---- topics: the colour dimension of the explorer ------------
       The root decides the family and the topic decides the shade inside it, so that
       the first thing colour says is which library a node belongs to — a backbone and
       its surfaces read apart at a glance — and the second is which area of it.
       A project with one root gets the whole wheel, as it should. */
    var bySize = function (a, b) { return T[b].sub - T[a].sub || (T[a].name < T[b].name ? -1 : 1); };
    var liveRoots = treeRoots.filter(function (r) { return T[r].sub; }).sort(bySize);
    var band = liveRoots.length > 1 ? (360 / liveRoots.length) * 0.44 : 320;
    var topics = [];
    liveRoots.forEach(function (r, ri) {
      var base = Math.round((205 + ri * 360 / liveRoots.length) % 360);
      T[r].hue = base; T[r].tone = 0; T[r].topicSlot = 0;
      var kids = [];
      T.forEach(function (t) { if (t.sub && t.root === r && t.topic === t.i && t.level === 1) kids.push(t.i); });
      if (!kids.length) { topics.push(r); return; }   /* a root that holds results itself */
      kids.sort(bySize);
      var m = kids.length, step = m > 1 ? Math.min(17, band / (m - 1)) : 0;
      kids.forEach(function (ti, k) {
        T[ti].hue = Math.round((base + (k - (m - 1) / 2) * step + 360) % 360);
        T[ti].tone = k % 3;
        T[ti].topicSlot = k;
        topics.push(ti);
      });
    });
    T.forEach(function (t) {
      var src = T[t.topic];
      t.hue = src.hue || 0; t.tone = src.tone || 0; t.topicSlot = src.topicSlot || 0;
    });

    var modules = 0;
    T.forEach(function (t) { if (t.decls.length) modules++; });

    return {
      tree: T, gidx: gidx, treeRoots: treeRoots, topics: topics, roots: roots,
      decl: D, didx: didx, dedges: DE, dout: dout, din: din,
      meta: {
        nodes: D.length, groups: g.groups.length, modules: modules,
        edges: g.edges.length, dangling: dangling,
        states: states, kinds: kinds,
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
    var succ = [], pred = [];
    for (var i = 0; i < R; i++) { succ.push(new Set()); pred.push(new Set()); }
    pairs.forEach(function (e) {
      if (e[0] === e[1]) return;
      succ[e[0]].add(e[1]); pred[e[1]].add(e[0]);
    });

    /* --- break cycles: greedy feedback arc set (Eades, Lin & Smyth) --- */
    var left = [], right = [], removed = new Set(), linear;
    (function () {
      var alive = new Uint8Array(R).fill(1), remaining = R;
      var outd = new Int32Array(R), ind2 = new Int32Array(R);
      for (var u = 0; u < R; u++) { outd[u] = succ[u].size; ind2[u] = pred[u].size; }
      var kill = function (u) {
        alive[u] = 0; remaining--;
        succ[u].forEach(function (v) { if (alive[v]) ind2[v]--; });
        pred[u].forEach(function (v) { if (alive[v]) outd[v]--; });
      };
      while (remaining > 0) {
        var moved = true;
        while (moved) {
          moved = false;
          for (var s = 0; s < R; s++) if (alive[s] && outd[s] === 0) { right.unshift(s); kill(s); moved = true; }
          for (var t = 0; t < R; t++) if (alive[t] && ind2[t] === 0) { left.push(t); kill(t); moved = true; }
        }
        if (remaining > 0) {
          var best = -1, bd = -Infinity;
          for (var w = 0; w < R; w++) if (alive[w] && outd[w] - ind2[w] > bd) { bd = outd[w] - ind2[w]; best = w; }
          left.push(best); kill(best);
        }
      }
      linear = left.concat(right).reverse();   /* base nodes first, dependents after */
    })();
    var lrank = new Int32Array(R);
    linear.forEach(function (u, i) { lrank[u] = i; });
    var back = [];
    for (var u2 = 0; u2 < R; u2++) succ[u2].forEach(function (v) {
      /* u -> v means u rests on v, so v should come earlier in the linear order */
      if (lrank[v] > lrank[u2]) { back.push([u2, v]); removed.add(u2 * KEY + v); }
    });
    var dag = [];
    for (var u3 = 0; u3 < R; u3++) succ[u3].forEach(function (v) { if (!removed.has(u3 * KEY + v)) dag.push([u3, v]); });

    var dsucc = [], dpred = [];
    for (var z = 0; z < R; z++) { dsucc.push([]); dpred.push([]); }
    dag.forEach(function (e) { dsucc[e[0]].push(e[1]); dpred[e[1]].push(e[0]); });

    /* --- topological order of the acyclic remainder: sinks first --- */
    var indeg = new Int32Array(R);
    dag.forEach(function (e) { indeg[e[0]]++; });
    var q = [], topo = [], ind3 = Int32Array.from(indeg);
    for (var a1 = 0; a1 < R; a1++) if (!indeg[a1]) q.push(a1);
    while (q.length) {
      var n1 = q.pop(); topo.push(n1);
      dpred[n1].forEach(function (w) { if (--ind3[w] === 0) q.push(w); });
    }

    /* --- layering: longest path from the bottom --- */
    var layer = new Int32Array(R);
    topo.forEach(function (u) {
      var mx = 0;
      dsucc[u].forEach(function (v) { if (layer[v] + 1 > mx) mx = layer[v] + 1; });
      layer[u] = mx;
    });
    var L = 0;
    for (var g1 = 0; g1 < R; g1++) if (layer[g1] > L) L = layer[g1];

    /* --- transitive reduction, over bitsets so it scales past a few hundred nodes --- */
    var WS = (R + 31) >> 5;
    var reach = new Uint32Array(R * WS);
    topo.forEach(function (u) {
      var ub = u * WS;
      for (var i2 = 0; i2 < dsucc[u].length; i2++) {
        var v = dsucc[u][i2], vb = v * WS;
        reach[ub + (v >> 5)] |= (1 << (v & 31));
        for (var w2 = 0; w2 < WS; w2++) reach[ub + w2] |= reach[vb + w2];
      }
    });
    var red = [];
    dag.forEach(function (e) {
      var u = e[0], v = e[1], dup = false;
      for (var i3 = 0; i3 < dsucc[u].length; i3++) {
        var w = dsucc[u][i3];
        if (w !== v && (reach[w * WS + (v >> 5)] & (1 << (v & 31)))) { dup = true; break; }
      }
      if (!dup) red.push([u, v]);
    });
    reach = null;

    /* --- slide each node within its slack to shorten the essential edges --- */
    var rdn = [], rup = [];
    for (var y = 0; y < R; y++) { rdn.push([]); rup.push([]); }
    red.forEach(function (e) { rdn[e[0]].push(e[1]); rup[e[1]].push(e[0]); });
    for (var it0 = 0; it0 < 40; it0++) {
      var moved2 = 0;
      for (var ti = 0; ti < topo.length; ti++) {
        var u4 = topo[ti], lo = 0, hi = Infinity;
        rdn[u4].forEach(function (v) { if (layer[v] + 1 > lo) lo = layer[v] + 1; });
        rup[u4].forEach(function (w) { if (layer[w] - 1 < hi) hi = layer[w] - 1; });
        if (hi === Infinity) hi = L;
        if (hi < lo) hi = lo;
        var bestL = layer[u4], bestC = Infinity;
        for (var l2 = lo; l2 <= hi; l2++) {
          var c2 = 0;
          rdn[u4].forEach(function (v) { c2 += l2 - layer[v]; });
          rup[u4].forEach(function (w) { c2 += layer[w] - l2; });
          if (c2 < bestC) { bestC = c2; bestL = l2; }
        }
        if (bestL !== layer[u4]) { layer[u4] = bestL; moved2++; }
      }
      if (!moved2) break;
    }

    /* --- proper graph: long edges routed through invisible nodes --- */
    var lay = Array.prototype.slice.call(layer), real = [], chains = [];
    for (var r1 = 0; r1 < R; r1++) real.push(true);
    red.forEach(function (e) {
      /* the chain runs downwards, from the dependent to what it rests on, so the
         routing nodes are laid out in descending layers and every hop is one layer */
      var ch = [e[0]];
      for (var l3 = lay[e[0]] - 1; l3 > lay[e[1]]; l3--) { ch.push(lay.length); lay.push(l3); real.push(false); }
      ch.push(e[1]);
      chains.push(ch);
    });
    var N2 = lay.length;
    var up = [], dn = [];
    for (var q1 = 0; q1 < N2; q1++) { up.push([]); dn.push([]); }
    chains.forEach(function (ch) {
      for (var i4 = 0; i4 < ch.length - 1; i4++) { dn[ch[i4]].push(ch[i4 + 1]); up[ch[i4 + 1]].push(ch[i4]); }
    });

    /* --- ordering within each layer --- */
    var rows = [];
    for (var l4 = 0; l4 <= L; l4++) rows.push([]);
    var nameOf = opt.nameOf || function (i) { return String(i); };
    var byName = [];
    for (var s1 = 0; s1 < R; s1++) byName.push(s1);
    byName.sort(function (a, b) { return nameOf(a) < nameOf(b) ? -1 : 1; });
    var SEEDS = [byName, topo.slice(), linear.slice()];
    var applySeed = function (seq) {
      for (var z2 = 0; z2 <= L; z2++) rows[z2] = [];
      seq.forEach(function (u) { if (u < R) rows[lay[u]].push(u); });
      for (var d1 = R; d1 < N2; d1++) rows[lay[d1]].push(d1);
    };
    var rank = new Int32Array(N2);
    var reindex = function () { rows.forEach(function (r) { r.forEach(function (u, i) { rank[u] = i; }); }); };

    /* bilayer crossings by Barth, Jünger and Mutzel: sort the endpoints, then count
       inversions with an accumulator tree, which is what lets a big layer stay cheap */
    var biCross = function (l) {
      if (l < 0 || l >= L) return 0;
      var south = rows[l], q2 = rows[l + 1].length;
      if (!q2) return 0;
      var seq = [];
      for (var i5 = 0; i5 < south.length; i5++) {
        var nb = up[south[i5]];
        if (!nb.length) continue;
        var tmp = [];
        for (var j5 = 0; j5 < nb.length; j5++) tmp.push(rank[nb[j5]]);
        tmp.sort(function (a, b) { return a - b; });
        for (var k5 = 0; k5 < tmp.length; k5++) seq.push(tmp[k5]);
      }
      if (seq.length < 2) return 0;
      var first = 1;
      while (first < q2) first *= 2;
      var tree = new Int32Array(2 * first - 1);
      first -= 1;
      var cross = 0;
      for (var k6 = 0; k6 < seq.length; k6++) {
        var idx = seq[k6] + first;
        tree[idx]++;
        while (idx > 0) {
          if (idx % 2) cross += tree[idx + 1];
          idx = (idx - 1) >> 1;
          tree[idx]++;
        }
      }
      return cross;
    };
    var total = function () { var s = 0; for (var l5 = 0; l5 < L; l5++) s += biCross(l5); return s; };
    var med = function (u, dir) {
      var nb = dir ? up[u] : dn[u];
      if (!nb.length) return -1;
      var arr = nb.map(function (v) { return rank[v]; }).sort(function (a, b) { return a - b; });
      var h = arr.length >> 1;
      return arr.length % 2 ? arr[h] : (arr[h - 1] + arr[h]) / 2;
    };
    var wmedian = function (down) {
      var seq = [];
      for (var l6 = 0; l6 <= L; l6++) seq.push(l6);
      if (!down) seq.reverse();
      seq.forEach(function (li) {
        var key = new Map();
        rows[li].forEach(function (u) { var m2 = med(u, !down); key.set(u, m2 < 0 ? rank[u] : m2); });
        rows[li].sort(function (a, b) { return key.get(a) - key.get(b) || rank[a] - rank[b]; });
        reindex();
      });
    };
    var pairCross = function (u, v, adj) {
      var A = adj[u], B = adj[v], c = 0;
      for (var i6 = 0; i6 < A.length; i6++) for (var j6 = 0; j6 < B.length; j6++)
        if (rank[A[i6]] > rank[B[j6]]) c++;
      return c;
    };
    var transpose = function () {
      var improved = true, guard = 0;
      while (improved && guard++ < 30) {
        improved = false;
        for (var li = 0; li <= L; li++) {
          var row = rows[li];
          for (var i7 = 0; i7 + 1 < row.length; i7++) {
            var u = row[i7], v = row[i7 + 1];
            var before = pairCross(u, v, up) + pairCross(u, v, dn);
            var after = pairCross(v, u, up) + pairCross(v, u, dn);
            if (after < before) {
              row[i7] = v; row[i7 + 1] = u;
              rank[v] = i7; rank[u] = i7 + 1;
              improved = true;
            }
          }
        }
      }
    };
    var ITER = opt.iterations || (N2 > 4000 ? 4 : N2 > 1200 ? 8 : 16);
    var seeds = opt.seeds === 1 ? [SEEDS[0]] : SEEDS;
    var best = null, bestC = Infinity;
    seeds.forEach(function (seq) {
      applySeed(seq); reindex();
      var c0 = total();
      if (c0 < bestC) { bestC = c0; best = rows.map(function (r) { return r.slice(); }); }
      for (var it = 0; it < ITER; it++) {
        wmedian(it % 2 === 0);
        transpose();
        var c3 = total();
        if (c3 < bestC) { bestC = c3; best = rows.map(function (r) { return r.slice(); }); }
      }
    });
    for (var l7 = 0; l7 <= L; l7++) rows[l7] = best[l7];
    reindex();

    return {
      R: R, L: L, N2: N2, layer: layer, lay: lay, real: real, rows: rows, rank: rank,
      red: red, back: back, chains: chains, up: up, dn: dn, topo: topo,
      crossings: bestC, routed: N2 - R
    };
  }

  /* --- x by the priority method: routing nodes first, so long edges straighten.
         halfWidth(i) is in whatever unit the caller wants x back in. --- */
  function xAssign(core, halfWidth, sep, iterations) {
    var N2 = core.N2, rows = core.rows, up = core.up, dn = core.dn, real = core.real, L = core.L;
    var prio = new Int32Array(N2);
    for (var p1 = 0; p1 < N2; p1++) prio[p1] = real[p1] ? (up[p1].length + dn[p1].length) : 100000;
    var pos = new Float64Array(N2);
    var gapOf = function (a, b) { return halfWidth(a) + halfWidth(b) + sep; };
    rows.forEach(function (r) {
      var x = 0;
      r.forEach(function (u, i) {
        if (i) x += gapOf(r[i - 1], u);
        pos[u] = x;
      });
      var mid = x / 2;
      r.forEach(function (u) { pos[u] -= mid; });
    });
    var medPos = function (arr) {
      if (!arr.length) return null;
      var a2 = arr.map(function (v) { return pos[v]; }).sort(function (x, y) { return x - y; });
      var h2 = a2.length >> 1;
      return a2.length % 2 ? a2[h2] : (a2[h2 - 1] + a2[h2]) / 2;
    };
    var shift = function (row, i, target) {
      var v = row[i];
      if (target > pos[v] + 1e-9) {
        var need = 0, limit = Infinity;
        for (var j = i + 1; j < row.length; j++) {
          need += gapOf(row[j - 1], row[j]);
          if (prio[row[j]] >= prio[v]) { limit = pos[row[j]] - need; break; }
        }
        var nx = Math.min(target, limit);
        if (nx <= pos[v]) return;
        pos[v] = nx;
        for (var j2 = i + 1; j2 < row.length; j2++) {
          var g2 = gapOf(row[j2 - 1], row[j2]);
          if (pos[row[j2]] < pos[row[j2 - 1]] + g2) pos[row[j2]] = pos[row[j2 - 1]] + g2; else break;
        }
      } else if (target < pos[v] - 1e-9) {
        var need2 = 0, lim2 = -Infinity;
        for (var j3 = i - 1; j3 >= 0; j3--) {
          need2 += gapOf(row[j3], row[j3 + 1]);
          if (prio[row[j3]] >= prio[v]) { lim2 = pos[row[j3]] + need2; break; }
        }
        var nx2 = Math.max(target, lim2);
        if (nx2 >= pos[v]) return;
        pos[v] = nx2;
        for (var j4 = i - 1; j4 >= 0; j4--) {
          var g3 = gapOf(row[j4], row[j4 + 1]);
          if (pos[row[j4]] > pos[row[j4 + 1]] - g3) pos[row[j4]] = pos[row[j4 + 1]] - g3; else break;
        }
      }
    };
    var IT = iterations || 16;
    for (var it2 = 0; it2 < IT; it2++) {
      var down2 = it2 % 2 === 0;
      var seq2 = [];
      for (var l8 = 0; l8 <= L; l8++) seq2.push(l8);
      if (!down2) seq2.reverse();
      seq2.forEach(function (li) {
        var row = rows[li];
        var byPrio = row.map(function (u, i) { return i; })
          .sort(function (a, b) { return prio[row[b]] - prio[row[a]]; });
        byPrio.forEach(function (i) {
          var v = row[i], ref = down2 ? up[v] : dn[v];
          var t2 = medPos(ref.length ? ref : (down2 ? dn[v] : up[v]));
          if (t2 !== null) shift(row, i, t2);
        });
      });
    }
    rows.forEach(function (r) {
      for (var i8 = 1; i8 < r.length; i8++) {
        var g4 = gapOf(r[i8 - 1], r[i8]);
        if (pos[r[i8]] - pos[r[i8 - 1]] < g4) pos[r[i8]] = pos[r[i8 - 1]] + g4;
      }
    });
    return pos;
  }

  /* --- the cone around a set of declarations, over the declaration graph --- */
  function cone(base, seeds, dir, radius) {
    var out = new Set(), R = (radius == null || radius < 0) ? Infinity : radius;
    seeds.forEach(function (s) { out.add(s); });
    var expand = function (adj) {
      var front = seeds.slice(), step = 0;
      while (front.length && step < R) {
        var next = [];
        front.forEach(function (u) {
          adj[u].forEach(function (v) { if (!out.has(v)) { out.add(v); next.push(v); } });
        });
        front = next; step++;
      }
    };
    if (dir !== "up") expand(base.dout);        /* what it rests on */
    if (dir !== "down") expand(base.din);       /* what rests on it */
    return out;
  }

export { STATES, KEY, buildBase, layoutCore, xAssign, cone, rollState };
