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
  function draw() {
    svg.textContent = "";
    elOf = new Map();
    edgeEls = [];
    sceneG = el("g", { id: "exScene" });
    sceneG.appendChild(drawNode(S.root));
    svg.appendChild(sceneG);
    drawEdges();
    syncSize();
    applyTransform();
    paintFocus();
    paintHover();
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
      const inner = el("g", { transform: `translate(${ox},${oy})` });
      n.__edges = el("g", { class: "ex-elayer" });
      inner.appendChild(n.__edges);
      n.children.forEach((c) => inner.appendChild(drawNode(c)));
      g.appendChild(inner);
    }
    return g;
  }

  function drawBox(g, n) {
    const w = n.w, h = n.h, isGroup = n.kind === "group";
    g.appendChild(clipFor(n, w, h, RX));
    g.appendChild(el("rect", { class: "ex-fill", x: 0, y: 0, width: w, height: h, rx: RX, fill: fillOf(n) }));
    if (isGroup) g.appendChild(progress(n, w, h));
    /* the outline last, so the shading stops at it rather than runs over it */
    g.appendChild(el("rect", {
      class: "ex-box", x: 0, y: 0, width: w, height: h, rx: RX, fill: "none", stroke: lineOf(n),
    }));
    g.appendChild(el("text", {
      class: "ex-lab", x: isGroup ? 8 : w / 2, y: h / 2 + 3.6,
      "text-anchor": isGroup ? "start" : "middle",
    }, n.text));
    if (isGroup) {
      g.appendChild(el("text", {
        class: "ex-num", x: w - TOG_W - 5, y: h / 2 + 3.5, "text-anchor": "end",
      }, shortNum(n.count)));
      g.appendChild(toggle(n, w - TOG_W, h));
    }
  }

  function drawContainer(g, n) {
    const w = n.w, h = n.h;
    g.appendChild(clipFor(n, w, h, RX_C));
    g.appendChild(el("rect", { class: "ex-fill", x: 0, y: 0, width: w, height: h, rx: RX_C, fill: washOf(n) }));
    g.appendChild(progress(n, w, SC.HEAD));
    g.appendChild(el("line", {
      class: "ex-crule", x1: 0, y1: SC.HEAD, x2: w, y2: SC.HEAD, stroke: lineOf(n), opacity: ".4",
    }));
    g.appendChild(el("rect", {
      class: "ex-cbg", x: 0, y: 0, width: w, height: h, rx: RX_C, fill: "none", stroke: lineOf(n),
    }));
    g.appendChild(el("text", { class: "ex-chead", x: 8, y: SC.HEAD - 6.5 },
      ellipsis(n.label, fonts.head, Math.max(20, w - NUM_W - TOG_W - 18))));
    g.appendChild(el("text", {
      class: "ex-cnum", x: w - TOG_W - 5, y: SC.HEAD - 6.5, "text-anchor": "end",
    }, shortNum(n.count)));
    g.appendChild(toggle(n, w - TOG_W, SC.HEAD));
  }

  /* How far a box is filled is how much of what is inside it is proved. The fill is
     clipped by the box itself, so it ends in the box's own corners rather than in
     corners of its own, and it is drawn under the label rather than beside it. */
  function clipFor(n, w, h, rx) {
    const defs = el("defs"), cp = el("clipPath", { id: "exclip" + n.id });
    cp.appendChild(el("rect", { x: 0, y: 0, width: w, height: h, rx }));
    defs.appendChild(cp);
    return defs;
  }
  function progress(n, w, h) {
    return el("rect", {
      class: "ex-prog", x: 0, y: 0, height: h,
      width: Math.max(0, w * (n.proved / Math.max(1, n.count))),
      fill: overlay(), "clip-path": `url(#exclip${n.id})`,
    });
  }

  /* the one control that opens and closes a node, with a hit area of its own */
  function toggle(n, x, h) {
    const t = el("g", {
      class: "ex-toggle", transform: `translate(${r2(x)},0)`,
      role: "button", "aria-label": (n.expanded ? "Collapse " : "Expand ") + n.name,
    });
    t.appendChild(el("rect", { class: "ex-tog", x: 0, y: 0, width: TOG_W, height: h, rx: 3 }));
    const cy = h / 2, cx = TOG_W / 2;
    t.appendChild(el("path", {
      class: "ex-togi",
      d: n.expanded ? `M${cx - 3.5},${cy}h7` : `M${cx - 3.5},${cy}h7M${cx},${cy - 3.5}v7`,
    }));
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
  /* One curve from one port to the other. An edge runs from the dependent back to
     what it rests on, so leftward; one that has to run the other way is one the
     layering could not honour, and it is drawn dashed. */
  function edgePath(e) {
    e.back = e.b.ax + e.b.w > e.a.ax;
    const p = port(e.a, e.back), q = port(e.b, !e.back);
    const mx = r2((p[0] + q[0]) / 2);
    return `M${r2(p[0])},${r2(p[1])}C${mx},${r2(p[1])} ${mx},${r2(q[1])} ${r2(q[0])},${r2(q[1])}`;
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

  /* ================= pan and zoom ================= */
  function applyTransform() {
    if (!S) return;
    sceneG.setAttribute("transform",
      `translate(${r2(Z.x)},${r2(Z.y)}) scale(${Math.round(Z.k * 1000) / 1000})`);
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
      S = scene;
      coneCache = new Map();
      hover = null;
      draw();
      const now = at && nodeFor(opts.anchor);
      const centre = opts.centreOn && nodeFor(opts.centreOn);
      if (now) holdAt(now, at);
      else if (centre) centreOn(centre, Math.max(Z.k, 0.62));
      else fit();
    },
    setSelection(ref) { sel = ref; paintFocus(); },
    /* the colours are sampled rather than inherited, so a new dimension — or a new
       theme — is a redraw */
    setColour(mode) { colour = mode; if (S) draw(); },
    setEdges(mode) { svg.classList.toggle("only-essential", mode === "red"); },
    reveal(ref) {
      const n = nodeFor(ref);
      if (n) centreOn(n, Math.max(Z.k, 0.7));
    },
    fit, zoomBy,
    destroy() { ro.disconnect(); },
  };
}
