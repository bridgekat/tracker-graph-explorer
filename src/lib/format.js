/* The compact form of a `tracker graph`, and the gzip around it.

   The documented contract — `{ groups[], nodes[], edges[] }` of objects — is what the
   tracker prints and what this page takes from a drop, a paste or `?graph=`. It stays
   the way in and the way out. It is not what a build should carry: every edge spells
   out two declaration ids and four key names, so on a graph of any size the edges are
   the file. On the plan of a large project they were 88% of it.

   The compact form says the same by column rather than by row: one array per field, an
   edge naming its ends by their index in `nodes`, a group naming its parent by its index
   in `groups`, and the closed vocabularies — kind, state — as a position in their list.
   Nothing is lost. `expand` is the inverse of `compact`, so the page can be handed either
   shape and the build can hand back the file it was built from.

   Anything outside a vocabulary, or naming something the graph does not list, is kept as
   itself rather than forced into an index — a graph the page cannot fully draw still
   round-trips — and `-1` is how an absent one is written. That is why the readers ask
   what a value *is* rather than whether it is true: `null` and `"0"` are different
   things and both come back. */

const KINDS = ["definition", "theorem"];
const STATES = ["open", "stated", "proved", "axioms", "wrong"];

/* a member of a closed vocabulary as its position, anything else as itself, absent as -1 */
const enc = (list, s) => {
  const i = list.indexOf(s);
  return i < 0 ? (typeof s === "string" ? s : -1) : i;
};
const dec = (list, x) => (typeof x === "number" ? (x >= 0 ? (list[x] ?? null) : null) : x);
/* the same for a reference into a name column, where the lookup is worth a map */
const encRef = (index, name) => {
  const i = index.get(name);
  return i === undefined ? (typeof name === "string" ? name : -1) : i;
};
const str = (x) => (typeof x === "string" ? x : null);

/* Whether this is the compact shape rather than the contract: `nodes` is a column set
   in one and an array in the other, which is the difference a reader has to know. */
export const isCompact = (g) =>
  !!g && typeof g === "object" && g.v === 1 && !!g.nodes && !Array.isArray(g.nodes);

export function compact(g) {
  const gi = new Map(g.groups.map((x, i) => [x.name, i]));
  const ni = new Map(g.nodes.map((x, i) => [x.id, i]));
  return {
    v: 1,
    groups: {
      name: g.groups.map((x) => x.name),
      parent: g.groups.map((x) => encRef(gi, x.parent)),
      desc: g.groups.map((x) => x.desc || ""),
      done: g.groups.map((x) => (x.done ? 1 : 0)),
      ready: g.groups.map((x) => (x.ready ? 1 : 0)),
    },
    nodes: {
      id: g.nodes.map((x) => x.id),
      group: g.nodes.map((x) => encRef(gi, x.group)),
      kind: g.nodes.map((x) => enc(KINDS, x.kind)),
      state: g.nodes.map((x) => enc(STATES, x.state)),
      desc: g.nodes.map((x) => x.desc || ""),
      source: g.nodes.map((x) => str(x.source) ?? -1),
      wrong: g.nodes.map((x) => str(x.wrong) ?? -1),
      deprecated: g.nodes.map((x) => str(x.deprecated) ?? -1),
    },
    edges: {
      from: g.edges.map((e) => encRef(ni, e.from)),
      to: g.edges.map((e) => encRef(ni, e.to)),
      /* the two flags of an edge are two bits: real is 1, suggested is 2, both are 3 */
      flag: g.edges.map((e) => (e.real ? 1 : 0) | (e.suggested ? 2 : 0)),
    },
  };
}

export function expand(c) {
  const G = c.groups, N = c.nodes, E = c.edges;
  return {
    groups: G.name.map((name, i) => ({
      name,
      parent: dec(G.name, G.parent[i]),
      desc: G.desc[i],
      done: !!G.done[i],
      ready: !!G.ready[i],
    })),
    nodes: N.id.map((id, i) => ({
      id,
      group: dec(G.name, N.group[i]),
      kind: dec(KINDS, N.kind[i]),
      state: dec(STATES, N.state[i]),
      desc: N.desc[i],
      source: dec([], N.source[i]),
      wrong: dec([], N.wrong[i]),
      deprecated: dec([], N.deprecated[i]),
    })),
    edges: E.from.map((from, i) => ({
      from: dec(N.id, from),
      to: dec(N.id, E.to[i]),
      real: !!(E.flag[i] & 1),
      suggested: !!(E.flag[i] & 2),
    })),
  };
}

/* Either shape in, the contract out: what every reader in the page goes through. */
export const asGraph = (g) => (isCompact(g) ? expand(g) : g);

/* ---------- gzip ---------- */

/* The first two bytes of a gzip member, which is how a dropped file says what it is. */
export const isGzip = (head) => head[0] === 0x1f && head[1] === 0x8b;

const GZIP_UNSUPPORTED =
  "This browser cannot decompress gzip (DecompressionStream is missing).";

/* Gzipped bytes, or a stream of them, straight into the parsed graph: between the
   decompressor and the parser the JSON never becomes a string on this side. */
export async function inflateJson(source) {
  if (typeof DecompressionStream !== "function") throw new Error(GZIP_UNSUPPORTED);
  const stream = source instanceof ReadableStream ? source : new Blob([source]).stream();
  return new Response(stream.pipeThrough(new DecompressionStream("gzip"))).json();
}

/* base64 is how bytes ride in an HTML attribute or a script element; it costs a third
   more than the bytes and is still a fraction of what the JSON would have cost. */
export function bytesFromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
