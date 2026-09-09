/* The canvas: the SVG drawing of a scene, and the pointer and key handling on it.

   This is deliberately not a component. A scene at full depth is thousands of nodes
   and tens of thousands of edges, and diffing that against a virtual DOM every time
   the pointer moves would cost more than drawing it. Svelte owns the state and the
   chrome; this owns one <svg> and redraws it when told to. */
import * as SC from "./scene.js";
import {
  el, css, fmt, plural, textWidth, ellipsis, STATE_LABEL,
  hueFill, hueLine, hueWash, neutralWash, overlay,
} from "./util.js";

const H_DECL = 23, H_GROUP = 27, RX = 4, RX_C = 5;
const MAX_W = 230, PAD_W = 20, NUM_W = 30, TOG_W = 17;
const MARGIN = 44;
const K_MIN = 0.03, K_MAX = 4;
const ANIM_MAX = 4000;              /* boxes, old and new together, past which a change just cuts */

const r2 = (v) => Math.round(v * 10) / 10;
const clampK = (k) => Math.max(K_MIN, Math.min(K_MAX, k));
const shortNum = (v) => (v > 9999 ? Math.round(v / 1000) + "k" : fmt(v));
const refOf = (n) => (n.kind === "group" ? { t: 0, i: n.gi } : { t: 1, i: n.di });

/* ---------- measuring a box ----------
   scene.js asks for this before it lays anything out, so the two agree on size. */
let fonts = null;
export function measure(n) {
  if (n.kind === "root") return;
  fonts ??= {
    decl: `400 11px ${css("--mono")}`,
    group: `600 11px ${css("--sans")}`,
    head: `600 10.5px ${css("--sans")}`,
  };
  const isGroup = n.kind === "group";
  if (n.expanded) {
    /* an open container takes its size from its contents, but never less than the
       room its own title needs */
    n.headW = Math.round(textWidth(n.label, fonts.head)) + NUM_W + TOG_W + 26;
    return;
  }
  const font = isGroup ? fonts.group : fonts.decl;
  const chrome = PAD_W + (isGroup ? NUM_W + TOG_W : 0);
  /* ceil, so the room left for the label is never a fraction of a pixel short of
     what the label actually measured */
  n.w = Math.max(58, Math.min(MAX_W, Math.ceil(textWidth(n.label, font)) + chrome));
  n.h = isGroup ? H_GROUP : H_DECL;
  n.text = ellipsis(n.label, font, n.w - chrome);
}

export function createCanvas({ svg, viewport, on }) {
  let B = null;                       /* the base, for looking past a collapsed box */
  let S = null;                       /* the scene being drawn */
  let sceneG = null, edgeEls = [];    /* what draw() made of it */
  let elOf = new Map();               /* a node's id -> its <g> */
  /* the camera: one group carrying the pan and zoom, holding the scene — and,
     while one scene is becoming the next, both */
  const camG = el("g", { id: "exScene" });
  svg.appendChild(camG);
  let coneCache = new Map();
  let Z = { k: 1, x: 0, y: 0 };
  let colour = "area";
  let sel = null, hover = null;

  /* ================= colour ================= */
  const kindHue = (n) => (n.declKind === "definition" ? 28 : 210);
  function fillOf(n) {
    if (colour === "progress") return `var(--nf-${n.state})`;
    if (colour === "kind" && n.kind === "decl") return hueFill(kindHue(n));
    return hueFill(n.hue, n.tone);
  }
  function lineOf(n) {
    if (colour === "progress") return `var(--st-${n.state})`;
    if (colour === "kind" && n.kind === "decl") return hueLine(kindHue(n));
    return hueLine(n.hue, n.tone);
  }
  function washOf(n) {
    return colour === "progress" ? neutralWash() : hueWash(n.hue, n.tone);
  }

  /* ================= drawing ================= */
  /* draws the scene into a new group; whoever had the old one takes it away.
     Two scenes can be in the document at once, so ids carry the scene's serial. */
  let serial = 0;
  const clipId = (n) => `exclip${serial}-${n.id}`;
  function draw() {
    serial++;
    elOf = new Map();
    edgeEls = [];
    sceneG = el("g", { class: "ex-scene" });
    sceneG.appendChild(drawNode(S.root));
    camG.appendChild(sceneG);
    drawEdges();
    syncSize();
    applyTransform();
    paintFocus();
    paintHover();
  }

  /* A new colour dimension, or a new theme, changes what every box is painted with
     but not what is drawn: repaint in place, so the change can ease rather than cut. */
  function recolour() {
    S.nodes.forEach((n) => {
      const g = elOf.get(n.id);
      if (!g) return;
      const set = (cls, attr, v) => { for (const c of g.children) if (c.classList.contains(cls)) c.setAttribute(attr, v); };
      set("ex-fill", "fill", n.expanded ? washOf(n) : fillOf(n));
      set("ex-prog", "fill", overlay());
      set(n.expanded ? "ex-cbg" : "ex-box", "stroke", lineOf(n));
      set("ex-crule", "stroke", lineOf(n));
    });
  }

  /* one box — or, if it is open, the container it became */
  function drawNode(n) {
    let g;
    if (n.kind === "root") {
      g = el("g", { class: "ex-root" });
    } else {
      g = el("g", {
        class: "ex-node " + (n.kind === "group" ? "grp" : "decl") + (n.expanded ? " open" : ""),
        transform: `translate(${r2(n.x)},${r2(n.y)})`,
        tabindex: "-1", role: "button", "aria-label": aria(n),
      });
      elOf.set(n.id, g);
      if (n.expanded) drawContainer(g, n); else drawBox(g, n);
      wireNode(g, n);
    }
    if (n.children) {
      const ox = n.kind === "root" ? 0 : SC.PAD;
      const oy = n.kind === "root" ? 0 : SC.PAD + SC.HEAD;
      const inner = g.__inner = el("g", { transform: `translate(${ox},${oy})` });
      n.__edges = el("g", { class: "ex-elayer" });
      inner.appendChild(n.__edges);
      n.children.forEach((c) => inner.appendChild(drawNode(c)));
      g.appendChild(inner);
    }
    return g;
  }

  /* The parts of a box are kept on its element, and everything about them that
     depends on the box's size is set in geometry(), so a box can be resized in place
     while it animates from what it was to what it is. */
  function drawBox(g, n) {
    const isGroup = n.kind === "group", P = g.__parts = {};
    g.appendChild(clipFor(n, P, RX));
    g.appendChild(P.fill = el("rect", { class: "ex-fill", x: 0, y: 0, rx: RX, fill: fillOf(n) }));
    if (isGroup) g.appendChild(P.prog = progress(n));
    /* the outline last, so the shading stops at it rather than runs over it */
    g.appendChild(P.box = el("rect", { class: "ex-box", x: 0, y: 0, rx: RX, fill: "none", stroke: lineOf(n) }));
    g.appendChild(P.lab = el("text", {
      class: "ex-lab", x: 8, "text-anchor": isGroup ? "start" : "middle",
    }, n.text));
    if (isGroup) {
      g.appendChild(P.num = el("text", { class: "ex-num", "text-anchor": "end" }, shortNum(n.count)));
      g.appendChild(P.tog = toggle(n, P));
    }
    geometry(g, n, n.w, n.h);
  }

  function drawContainer(g, n) {
    const P = g.__parts = {};
    g.appendChild(clipFor(n, P, RX_C));
    g.appendChild(P.fill = el("rect", { class: "ex-fill", x: 0, y: 0, rx: RX_C, fill: washOf(n) }));
    g.appendChild(P.prog = progress(n));
    g.appendChild(P.rule = el("line", {
      class: "ex-crule", x1: 0, y1: SC.HEAD, y2: SC.HEAD, stroke: lineOf(n), opacity: ".4",
    }));
    g.appendChild(P.box = el("rect", { class: "ex-cbg", x: 0, y: 0, rx: RX_C, fill: "none", stroke: lineOf(n) }));
    g.appendChild(el("text", { class: "ex-chead", x: 8, y: SC.HEAD - 6.5 },
      ellipsis(n.label, fonts.head, Math.max(20, n.w - NUM_W - TOG_W - 18))));
    g.appendChild(P.num = el("text", { class: "ex-cnum", y: SC.HEAD - 6.5, "text-anchor": "end" }, shortNum(n.count)));
    g.appendChild(P.tog = toggle(n, P));
    geometry(g, n, n.w, n.h);
  }

  /* A box at a size: its own, or one on the way there. What a box carries — its
     title, its count, its toggle, its shading — sits in a strip: a container's
     title strip, or a closed box's own height. A closed box drawn larger than
     itself, on its way from being a container, keeps that strip at the top, where
     the container's was, rather than spreading over the whole. */
  function geometry(g, n, w, h) {
    const P = g.__parts, strip = n.expanded ? SC.HEAD : Math.min(h, n.h);
    for (const r of [P.clip, P.fill, P.box]) { r.setAttribute("width", r2(w)); r.setAttribute("height", r2(h)); }
    if (P.prog) {
      P.prog.setAttribute("width", r2(Math.max(0, w * (n.proved / Math.max(1, n.count)))));
      P.prog.setAttribute("height", r2(strip));
    }
    if (P.rule) P.rule.setAttribute("x2", r2(w));
    if (P.lab) {
      if (n.kind === "decl") P.lab.setAttribute("x", r2(w / 2));
      P.lab.setAttribute("y", r2(strip / 2 + 3.6));
    }
    if (P.num) {
      P.num.setAttribute("x", r2(w - TOG_W - 5));
      if (!n.expanded) P.num.setAttribute("y", r2(strip / 2 + 3.5));
    }
    if (P.tog) {
      P.tog.setAttribute("transform", `translate(${r2(w - TOG_W)},0)`);
      P.togRect.setAttribute("height", r2(strip));
      const cy = strip / 2, cx = TOG_W / 2;
      P.togIcon.setAttribute("d", n.expanded ? `M${cx - 3.5},${cy}h7` : `M${cx - 3.5},${cy}h7M${cx},${cy - 3.5}v7`);
    }
  }

  /* How far a box is filled is how much of what is inside it is proved. The fill is
     clipped by the box itself, so it ends in the box's own corners rather than in
     corners of its own, and it is drawn under the label rather than beside it. */
  function clipFor(n, P, rx) {
    const defs = el("defs"), cp = el("clipPath", { id: clipId(n) });
    cp.appendChild(P.clip = el("rect", { x: 0, y: 0, rx }));
    defs.appendChild(cp);
    return defs;
  }
  function progress(n) {
    return el("rect", { class: "ex-prog", x: 0, y: 0, fill: overlay(), "clip-path": `url(#${clipId(n)})` });
  }

  /* the one control that opens and closes a node, with a hit area of its own */
  function toggle(n, P) {
    const t = el("g", {
      class: "ex-toggle", role: "button", "aria-label": (n.expanded ? "Collapse " : "Expand ") + n.name,
    });
    t.appendChild(P.togRect = el("rect", { class: "ex-tog", x: 0, y: 0, width: TOG_W, rx: 3 }));
    t.appendChild(P.togIcon = el("path", { class: "ex-togi" }));
    t.__toggle = true;
    return t;
  }

  function aria(n) {
    if (n.kind === "group") {
      return `${n.short}, ${plural(n.count, "result")}, ${STATE_LABEL[n.state]}`
        + (n.expanded ? ", open" : ". Enter to open it.");
    }
    return `${n.name}, ${n.declKind}, ${STATE_LABEL[n.state]}.`;
  }

  /* ---------- edges ---------- */
  const port = (n, right) => [right ? n.ax + n.w : n.ax, n.ay + n.h / 2];
  const pt = (p) => `${r2(p[0])},${r2(p[1])}`;
  /* the route of an edge as points: the first, then the control points of each
     piece — three for a cubic, two for a quadratic, one for a line */
  function routeOf(e) {
    if (e.pts) return e.pts;
    const back = e.b.ax + e.b.w > e.a.ax;
    const p = port(e.a, back), q = port(e.b, !back), mx = (p[0] + q[0]) / 2;
    return [p, [mx, p[1]], [mx, q[1]], q];
  }
  /* An edge the layout routed comes as a spline: after the first point, every three
     are the control points of one cubic piece, and a short tail is a quadratic or a
     line. One the layout did not see — a shortcut, drawn only on request — is one
     curve from port to port. An edge runs from the dependent back to what it rests
     on, so leftward; one that has to run the other way is one the layering could not
     honour, and it is drawn dashed. */
  function edgePath(e) {
    e.back = e.b.ax + e.b.w > e.a.ax;
    const P = routeOf(e);
    let d = `M${pt(P[0])}`;
    for (let i = 1; i < P.length;) {
      const left = P.length - i;
      if (left >= 3) { d += `C${pt(P[i])} ${pt(P[i + 1])} ${pt(P[i + 2])}`; i += 3; }
      else if (left === 2) { d += `Q${pt(P[i])} ${pt(P[i + 1])}`; i += 2; }
      else { d += `L${pt(P[i])}`; i += 1; }
    }
    return d;
  }
  /* the same route as a polyline of M points at equal steps along it, which is
     what two routes with nothing else in common can be tweened between */
  function resample(P, M) {
    const bez = (out, cps) => {
      const n = cps.length - 1;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        let x = 0, y = 0;
        cps.forEach(([px, py], i) => {
          const w = (n === 3 ? [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] : [u * u, 2 * u * t, t * t])[i];
          x += w * px; y += w * py;
        });
        out.push([x, y]);
      }
    };
    const poly = [P[0]];
    for (let i = 1; i < P.length;) {
      const left = P.length - i, from = poly[poly.length - 1];
      if (left >= 3) { bez(poly, [from, P[i], P[i + 1], P[i + 2]]); i += 3; }
      else if (left === 2) { bez(poly, [from, P[i], P[i + 1]]); i += 2; }
      else { poly.push(P[i]); i += 1; }
    }
    const at = [0];
    for (let i = 1; i < poly.length; i++) at.push(at[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const total = at[at.length - 1], out = [];
    let j = 0;
    for (let m = 0; m < M; m++) {
      const s = total * m / (M - 1);
      while (j < at.length - 2 && at[j + 1] < s) j++;
      const span = at[j + 1] - at[j], t = span > 0 ? (s - at[j]) / span : 0;
      out.push([lerp(poly[j][0], poly[j + 1][0], t), lerp(poly[j][1], poly[j + 1][1], t)]);
    }
    return out;
  }
  function drawEdges() {
    S.edges.forEach((e) => {
      const p = el("path", {
        class: "ex-edge" + (e.essential ? "" : " extra") + (e.back ? " back" : ""),
        d: edgePath(e),
        /* the path is in absolute coordinates; its layer sits in a container frame */
        transform: `translate(${r2(-e.box.cx)},${r2(-e.box.cy)})`,
      });
      p.__e = e;
      e.box.__edges.appendChild(p);
      edgeEls.push(p);
    });
  }

  /* ================= focus ================= */
  function reach(adj, seeds) {
    const seen = new Set(), q = seeds.slice();
    while (q.length) {
      const u = q.pop();
      for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); }
    }
    return seen;
  }
  /* An open container has no edges of its own — they belong to the boxes inside it —
     so its cone is the cone of everything it holds, with its own contents taken back
     out, which is what makes "rests on" mean the same thing open or shut. */
  function coneOf(n) {
    if (coneCache.has(n.id)) return coneCache.get(n.id);
    const inside = new Set(), seeds = [];
    (function walk(x) {
      inside.add(x.id);
      if (x.children) x.children.forEach(walk); else seeds.push(x.id);
    })(n);
    const below = reach(S.adj.out, seeds), above = reach(S.adj.in, seeds);
    inside.forEach((i) => { below.delete(i); above.delete(i); });
    const r = { below, above, inside };
    coneCache.set(n.id, r);
    return r;
  }

  function nodeFor(ref) {
    if (!ref || !S) return null;
    for (const n of S.nodes) {
      if (ref.t === 0 && n.kind === "group" && n.gi === ref.i) return n;
      if (ref.t === 1 && n.kind === "decl" && n.di === ref.i) return n;
    }
    /* it collapsed into something: land on whatever stands for it */
    const probe = ref.t === 1 ? ref.i : B.tree[ref.i].subDecls[0];
    const owner = probe === undefined ? -1 : S.owner[probe];
    return owner >= 0 ? S.nodes[owner] : null;
  }

  function paintHover() {
    if (!S) return;
    S.nodes.forEach((n) => elOf.get(n.id)?.classList.toggle("hover", n === hover));
  }

  function paintFocus() {
    if (!S) return;
    const f = nodeFor(sel), c = f && coneOf(f);
    /* a lit box inside a container needs the container lit too, or it goes with it */
    const keep = new Set();
    if (c) {
      const light = (id) => { for (let p = S.nodes[id]; p; p = p.parent) keep.add(p.id); };
      c.inside.forEach(light); c.below.forEach(light); c.above.forEach(light);
    }
    svg.classList.toggle("focused", !!f);
    S.nodes.forEach((n) => {
      const g = elOf.get(n.id);
      if (!g) return;
      g.classList.toggle("sel", n === f);
      g.classList.toggle("dim", !!f && !keep.has(n.id));
    });
    /* One drawn line stands in for many real ones, so asking its two ends whether they
       are in the cone lights lines that carry nothing of it. Ask the real relations
       instead which drawn line they arrived on, and light that one at the strongest
       claim any of them makes. */
    const lit = new Map();
    if (c) S.fine.forEach((r) => {
      if (!r.drawn) return;
      const x = r.a.id, y = r.b.id;
      let rank;
      if (c.inside.has(x) !== c.inside.has(y)) rank = 3;                        /* its own */
      else if ((c.inside.has(x) || c.below.has(x)) && c.below.has(y)) rank = 2; /* under it */
      else if ((c.inside.has(y) || c.above.has(y)) && c.above.has(x)) rank = 1; /* over it */
      else return;
      if ((lit.get(r.drawn) || 0) < rank) lit.set(r.drawn, rank);
    });
    /* an edge drawn inside the focused container joins two things it holds: that is
       not its cone, but it is not the rest of the graph either, so it stays as it is */
    const within = (e) => { for (let b = e.box; b; b = b.parent) if (b === f) return true; return false; };
    edgeEls.forEach((p) => {
      const rank = lit.get(p.__e) || 0;
      p.classList.toggle("lit-direct", rank === 3);
      p.classList.toggle("lit-down", rank === 2);
      p.classList.toggle("lit-up", rank === 1);
      p.classList.toggle("within", !!f && within(p.__e));
    });
  }

  /* ================= one scene becoming the next =================

     A box stands for a group or a declaration, and both are there before and after
     a change, so every box in the new scene knows where its counterpart was. The
     new scene is drawn where it belongs, then each box starts from that old place
     and size and tweens home: this is a FLIP, and a box that ends up far away
     simply slides there. A container that has just opened unfolds its contents
     from the box it was; one that has just closed is still the old container,
     folding into the box it has become, while the new box fades in over it.
     Whatever nothing stands for any more fades out where it is, and whatever has
     no past fades in where it is. An edge is known by its two ends, and one that
     is there before and after is tweened from its old route to its new one, both
     resampled to the same number of points along their length; the rest fade
     out or in. The camera goes along, so what was held still stays held. */
  const keyOf = (n) => (n.kind === "group" ? "g" + n.gi : "d" + n.di);
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  let anim = null;

  /* end the running animation now, at its final state */
  function settle() {
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    anim.finish();
    anim = null;
  }

  function become(prev, camFrom, camTo) {
    const oldOf = new Map(), newOf = new Map();
    prev.S.nodes.forEach((o) => { if (o.kind !== "root") oldOf.set(keyOf(o), o); });
    S.nodes.forEach((n) => { if (n.kind !== "root") newOf.set(keyOf(n), n); });
    const steps = [], fades = [], reset = [];
    const fade = (elm, a, b, t0, t1) => fades.push({ elm, a, b, t0, t1 });
    /* where a parent's content origin was, in the old scene's frame */
    const originOf = (p) => (p.kind === "root" ? [0, 0] : [p.ax + SC.PAD, p.ay + SC.PAD + SC.HEAD]);
    /* tween a box from one rectangle to another, both absolute, in its own frame:
       the frame is its parent's content, which may itself be moving from one
       origin to another, so the two ends are taken relative to each */
    const move = (g, n, [ox0, oy0], [ox1, oy1], a, b) => {
      const x0 = a.ax - ox0, y0 = a.ay - oy0, x1 = b.ax - ox1, y1 = b.ay - oy1;
      steps.push((t) => g.setAttribute("transform", `translate(${lerp(x0, x1, t)},${lerp(y0, y1, t)})`));
      if (a.w !== b.w || a.h !== b.h) steps.push((t) => geometry(g, n, lerp(a.w, b.w, t), lerp(a.h, b.h, t)));
    };
    /* scale a container's contents with it: the contents are drawn at the size
       `own`, and follow the box from the size `a` to the size `b` */
    const scaleInner = (g, own, a, b) => {
      const inner = g.__inner;
      if (!inner) return;
      const s = (r) => Math.max(0.02, r);
      const sx0 = s(a.w / own.w), sy0 = s(a.h / own.h), sx1 = s(b.w / own.w), sy1 = s(b.h / own.h);
      steps.push((t) => inner.setAttribute("transform",
        `translate(${SC.PAD},${SC.PAD + SC.HEAD}) scale(${lerp(sx0, sx1, t)},${lerp(sy0, sy1, t)})`));
      reset.push(() => inner.setAttribute("transform", `translate(${SC.PAD},${SC.PAD + SC.HEAD})`));
    };

    /* --- the new scene: every box from where its counterpart was --- */
    S.nodes.forEach((n) => {
      if (n.kind === "root") return;
      const g = elOf.get(n.id), o = oldOf.get(keyOf(n));
      if (!o) {
        /* no past. Inside a container that is opening, or is itself new, it is
           carried by that; otherwise it fades in where it is */
        const p = n.parent, po = p.kind !== "root" && oldOf.get(keyOf(p));
        const carried = p.kind !== "root" && (!po || !po.expanded);
        if (!carried) fade(g, 0, 1, 0.35, 1);
        return;
      }
      const po = n.parent.kind === "root" ? null : oldOf.get(keyOf(n.parent));
      move(g, n, originOf(po || prev.S.root), originOf(n.parent), o, n);
      if (!o.expanded && n.expanded) {
        /* opening: the contents unfold from the box it was */
        scaleInner(g, n, o, n);
        fade(g.__inner, 0, 1, 0.25, 1);
      } else if (o.expanded && !n.expanded) {
        /* closing: the box comes in over the old container folding up under it */
        fade(g, 0, 1, 0.2, 0.8);
      }
    });
    /* --- the edges: the ones that stay move, the rest fade --- */
    const edgeKey = (e) => keyOf(e.a) + ">" + keyOf(e.b);
    const oldEdge = new Map(prev.edgeEls.map((p) => [edgeKey(p.__e), p]));
    const inFrame = (e) => routeOf(e).map(([x, y]) => [x - e.box.cx, y - e.box.cy]);
    const M = 24;
    edgeEls.forEach((p) => {
      const e = p.__e, op = oldEdge.get(edgeKey(e));
      if (!op) { fade(p, 0, 1, 0.55, 1); return; }
      op.style.display = "none";
      /* in the frame of the container that draws it, which is itself on its way:
         the route only needs tweening if it changed within that frame */
      const r0 = inFrame(op.__e), r1 = inFrame(e);
      if (r0.length === r1.length && r0.every(([x, y], i) => Math.abs(x - r1[i][0]) < 0.05 && Math.abs(y - r1[i][1]) < 0.05)) return;
      const a = resample(r0, M), b = resample(r1, M), cx = e.box.cx, cy = e.box.cy;
      steps.push((t) => {
        let d = "";
        for (let i = 0; i < M; i++) d += (i ? "L" : "M") + r2(lerp(a[i][0], b[i][0], t) + cx) + "," + r2(lerp(a[i][1], b[i][1], t) + cy);
        p.setAttribute("d", d);
      });
      reset.push(() => p.setAttribute("d", edgePath(e)));
    });
    prev.edgeEls.forEach((p) => { if (p.style.display !== "none") fade(p, 1, 0, 0, 0.45); });

    /* --- the old scene: only what is leaving still shows, and none of it is
       there to be used any more --- */
    prev.sceneG.style.pointerEvents = "none";
    prev.sceneG.setAttribute("aria-hidden", "true");
    const leave = (o, g, target) => {
      /* into the rectangle of whatever stands for it now, fading as it goes; the
         old scene's frames stay where they were */
      const origin = originOf(o.parent);
      move(g, o, origin, origin, o, target);
      scaleInner(g, o, o, target);
      fade(g, 1, 0, 0, 0.7);
    };
    (function visit(o) {
      const g = o.kind === "root" ? null : prev.elOf.get(o.id);
      const c = o.kind === "root" ? S.root : newOf.get(keyOf(o));
      if (c && (o.kind === "root" || o.expanded === c.expanded)) {
        /* the new box has taken over from this one; only its contents may be leaving */
        if (!o.children) { g.style.display = "none"; return; }
        if (g) for (const part of g.children) if (part !== g.__inner) part.style.visibility = "hidden";
        o.children.forEach(visit);
        return;
      }
      if (c) { leave(o, g, c); return; }
      /* nothing stands for it now: fold into the nearest thing that stands for
         what held it, or, at the top, fade out where it is */
      let a = o.parent;
      while (a.kind !== "root" && !newOf.has(keyOf(a))) a = a.parent;
      if (a.kind === "root") { fade(g, 1, 0, 0, 0.6); return; }
      leave(o, g, newOf.get(keyOf(a)));
    })(prev.S.root);

    /* --- run --- */
    const D = 300, ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (t) => {
      steps.forEach((f) => f(t));
      fades.forEach(({ elm, a, b, t0, t1 }) => {
        elm.style.opacity = lerp(a, b, Math.max(0, Math.min(1, (t - t0) / (t1 - t0))));
      });
      Z.x = lerp(camFrom.x, camTo.x, t);
      Z.y = lerp(camFrom.y, camTo.y, t);
      Z.k = camFrom.k * Math.pow(camTo.k / camFrom.k, t);
      applyTransform();
    };
    const finish = () => {
      step(1);
      reset.forEach((f) => f());
      fades.forEach(({ elm }) => { elm.style.opacity = ""; });
      prev.sceneG.remove();
    };
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / D);
      if (t < 1) { step(ease(t)); anim.raf = requestAnimationFrame(frame); }
      else { anim = null; finish(); }
    };
    step(0);
    anim = { raf: requestAnimationFrame(frame), finish };
  }

  /* ================= pan and zoom ================= */
  /* At full precision: the translation is chosen to hold the point under the pointer
     still through a zoom, and a rounded scale would move that point by the rounding
     error times its distance from the origin — a visible wobble far from it. */
  function applyTransform() {
    if (!S) return;
    camG.setAttribute("transform", `translate(${Z.x},${Z.y}) scale(${Z.k})`);
    svg.classList.toggle("far", Z.k < 0.34);
    on.zoom(Z.k);
  }
  const size = () => ({ w: viewport.clientWidth || 900, h: viewport.clientHeight || 600 });
  function syncSize() {
    const v = size();
    svg.setAttribute("viewBox", `0 0 ${v.w} ${v.h}`);
  }
  function fit() {
    if (!S) return;
    const v = size();
    Z.k = clampK(Math.min(1.3, v.w / (S.width + 2 * MARGIN), v.h / (S.height + 2 * MARGIN)));
    Z.x = (v.w - S.width * Z.k) / 2;
    Z.y = (v.h - S.height * Z.k) / 2;
    applyTransform();
  }
  function zoomBy(mult, cx, cy) {
    const v = size();
    if (cx == null) { cx = v.w / 2; cy = v.h / 2; }
    const k2 = clampK(Z.k * mult);
    Z.x = cx - (cx - Z.x) * (k2 / Z.k);
    Z.y = cy - (cy - Z.y) * (k2 / Z.k);
    Z.k = k2;
    applyTransform();
  }
  function centreOn(n, k) {
    const v = size();
    if (k) Z.k = clampK(k);
    Z.x = v.w / 2 - (n.ax + n.w / 2) * Z.k;
    Z.y = v.h / 2 - (n.ay + n.h / 2) * Z.k;
    applyTransform();
  }
  const screenOf = (n) => [n.ax * Z.k + Z.x, n.ay * Z.k + Z.y];
  /* Opening a group makes it much bigger: hold its corner where it was on screen, zoom
     out only as far as it takes to see all of what appeared, and then slide it back
     inside the viewport. */
  function holdAt(n, at) {
    const v = size(), m = 16;
    const need = Math.min((v.w - 36) / Math.max(1, n.w), (v.h - 36) / Math.max(1, n.h));
    if (need < Z.k) Z.k = Math.max(0.16, need);
    Z.x = at[0] - n.ax * Z.k;
    Z.y = at[1] - n.ay * Z.k;
    const x1 = (n.ax + n.w) * Z.k + Z.x, y1 = (n.ay + n.h) * Z.k + Z.y;
    if (x1 > v.w - m) Z.x -= x1 - (v.w - m);
    if (y1 > v.h - m) Z.y -= y1 - (v.h - m);
    const x0 = n.ax * Z.k + Z.x, y0 = n.ay * Z.k + Z.y;
    if (x0 < m) Z.x += m - x0;
    if (y0 < m) Z.y += m - y0;
    applyTransform();
  }

  /* ================= interaction ================= */
  /* Enter or a double-click on a group opens it; on a declaration, draws its cone */
  const activate = (n) => (n.kind === "group" ? on.toggle(n.gi) : on.cone(refOf(n)));
  function wireNode(g, n) {
    /* enter and leave do not bubble, so the innermost box under the pointer wins */
    g.addEventListener("pointerenter", (e) => { hover = n; paintHover(); tipFor(e, n); });
    /* pointermove must reach the canvas, or a drag that begins on a box never becomes
       a pan; it is the pointer's own idea of which box it is on that picks the tooltip */
    g.addEventListener("pointermove", (e) => { if (hover === n) tipFor(e, n); });
    g.addEventListener("pointerleave", () => {
      if (hover === n) {
        hover = n.parent && n.parent.kind !== "root" ? n.parent : null;
        paintHover();
      }
      on.tip(null);
    });
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      if (swallowClick) { swallowClick = false; return; }
      for (let t = e.target; t && t !== g; t = t.parentNode) {
        if (t.__toggle) { on.toggle(n.gi); return; }
      }
      on.select(refOf(n));
    });
    g.addEventListener("dblclick", (e) => { e.stopPropagation(); activate(n); });
    g.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      activate(n);
    });
  }
  function tipFor(e, n) {
    const c = coneOf(n), rows = [];
    if (n.kind === "group") {
      rows.push({ text: plural(n.count, "result") + (n.expanded ? " · open" : "") });
      rows.push({ state: n.state, text: `${STATE_LABEL[n.state]} · ${fmt(n.proved)} of ${fmt(n.count)} proved` });
      rows.push({ text: n.expanded ? "− closes it" : "＋ opens it" });
    } else {
      rows.push({ text: `${n.declKind} in ${n.group}` });
      rows.push({ state: n.state, text: STATE_LABEL[n.state] });
    }
    rows.push({ text: `rests on ${c.below.size} · ${c.above.size} rest on it` });
    on.tip({ title: n.kind === "group" ? n.short : n.name, rows, x: e.clientX, y: e.clientY });
  }

  let down = null, swallowClick = false;
  /* A pan is a drag, and a drag is not a click. Capturing the pointer on pointerdown —
     as the obvious version of this does — makes the browser retarget the click to the
     capture element, and then no box on the canvas ever hears one. So: remember where
     the pointer went down, and only become a pan, and only capture, once it has moved. */
  function onDown(e) {
    if (e.button !== 0) return;
    swallowClick = false;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: Z.x, oy: Z.y, panning: false, onBg: e.target === svg };
  }
  function onMove(e) {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.panning) {
      if (Math.abs(dx) + Math.abs(dy) <= 3) return;
      down.panning = true;
      try { svg.setPointerCapture(down.id); } catch { /* the pointer is already gone */ }
      svg.classList.add("grabbing");
      on.tip(null);
    }
    Z.x = down.ox + dx;
    Z.y = down.oy + dy;
    applyTransform();
  }
  function onUp() {
    if (!down) return;
    if (down.panning) {
      try { svg.releasePointerCapture(down.id); } catch { /* ditto */ }
      swallowClick = true;
    } else if (down.onBg) on.select(null);
    down = null;
    svg.classList.remove("grabbing");
  }
  function onWheel(e) {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.02 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
  }
  function onLeave() {
    if (down) return;
    hover = null; paintHover(); on.tip(null);
  }
  function onDbl(e) { if (e.target === svg) fit(); }

  function onKey(e) {
    if (!S) return;
    if (e.key === "Escape") { on.select(null); return; }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) return;
    e.preventDefault();
    const cur = nodeFor(sel);
    const boxes = S.nodes.filter((n) => n.kind !== "root" && !n.expanded);
    if (!boxes.length) return;
    if (!cur) { pick(boxes[0]); return; }
    if (e.key === "Enter") { activate(cur); return; }
    /* the nearest box in the direction asked for, centre to centre */
    const horiz = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const cx = cur.ax + cur.w / 2, cy = cur.ay + cur.h / 2;
    let best = null, bd = Infinity;
    boxes.forEach((n) => {
      if (n === cur) return;
      const dx = (n.ax + n.w / 2) - cx, dy = (n.ay + n.h / 2) - cy;
      const ok = e.key === "ArrowRight" ? dx > 4 : e.key === "ArrowLeft" ? dx < -4
        : e.key === "ArrowDown" ? dy > 4 : dy < -4;
      if (!ok) return;
      const d = horiz ? Math.abs(dx) + Math.abs(dy) * 2.5 : Math.abs(dy) + Math.abs(dx) * 2.5;
      if (d < bd) { bd = d; best = n; }
    });
    if (best) pick(best);
  }
  function pick(n) {
    on.select(refOf(n));
    centreOn(n, Math.max(Z.k, 0.6));
  }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("pointerleave", onLeave);
  svg.addEventListener("dblclick", onDbl);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("keydown", onKey);

  /* The panes drag wider and narrower, so the viewport changes size without the
     window doing anything. Watch the element itself rather than the window. */
  const ro = new ResizeObserver(() => { if (S) { syncSize(); applyTransform(); } });
  ro.observe(viewport);

  return {
    setBase(b) { B = b; },
    /* a new scene, with the camera told what to hold on to */
    setScene(scene, opts = {}) {
      const was = opts.anchor && nodeFor(opts.anchor);
      const at = was && screenOf(was);
      settle();
      const prev = S && { S, elOf, sceneG, edgeEls };
      const from = { ...Z };
      S = scene;
      coneCache = new Map();
      hover = null;
      draw();
      const now = at && nodeFor(opts.anchor);
      const centre = opts.centreOn && nodeFor(opts.centreOn);
      if (now) holdAt(now, at);
      else if (centre) centreOn(centre, Math.max(Z.k, 0.62));
      else fit();
      if (prev && !reducedMotion() && prev.S.boxes + S.boxes <= ANIM_MAX) become(prev, from, { ...Z });
      else prev?.sceneG.remove();
    },
    setSelection(ref) { sel = ref; paintFocus(); },
    /* the colours are sampled rather than inherited, so a new dimension — or a new
       theme — has to be painted on */
    setColour(mode) { colour = mode; if (S) recolour(); },
    setEdges(mode) { svg.classList.toggle("only-essential", mode === "red"); },
    reveal(ref) {
      const n = nodeFor(ref);
      if (n) centreOn(n, Math.max(Z.k, 0.7));
    },
    fit, zoomBy,
    destroy() { settle(); ro.disconnect(); },
  };
}
