/* The small pieces the canvas and the components both use: SVG element building,
   the colour arithmetic, and text measurement. No state and no layout in here. */

const NS = "http://www.w3.org/2000/svg";

export const STATE_LABEL = {
  proved: "proved", stated: "stated", open: "open",
  axioms: "extra axioms", wrong: "marked wrong",
};
/* The states that are not a stage of progress but an alarm. A bar that counts what is
   proved files them with the merely unfinished, so they are said another way — see the
   flag rules in styles/graph.css. */
export const FLAGGED = { axioms: 1, wrong: 1 };

export function el(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

export const fmt = (n) => (n || 0).toLocaleString("en-US");
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + "s")}`;

/* ---------- colour ----------
   One hue in two strengths paints every box. The strong one is the bar — the proved
   share of what is inside the box — and the tint is the ground it runs over, so a box
   that is done reads solid and one that is not reads pale. Colour says what a thing is
   and strength says how far it has got, and neither has to borrow the other's channel.
   `tone` is the second channel of the hue itself: neighbours in one family sit a few
   degrees apart, which is not enough on its own, so they step in weight as well. */
/* One signal for the whole page: main.js resolves the system preference to this
   class before mounting, and the theme button owns it after that. The drawing samples
   the tokens rather than inheriting them, so it has to ask the same question the CSS
   does — reading the media query here is what left the graph in light colours.

   The canvas is repainted when the theme changes and can take the answer as it finds
   it. A component cannot: nothing it renders depends on a class on <html>, so it would
   keep the colours it first drew. Those callers pass `dark` themselves, from the state
   that changing the theme changes, and the recompute follows from that. */
function isDark() {
  return document.documentElement.classList.contains("dark");
}
/* What a declaration is decides its hue: a definition and a theorem are different kinds
   of thing, and which of the two a box holds is the first thing worth knowing about it.
   A group holds both, so a kind is not a question it can answer, and it takes the hue of
   its area instead — which derive.js works out per project, and this cannot. */
export const kindHue = (declKind) => (declKind === "definition" ? 28 : 210);

/* the ground of a box: the hue let down to a tint, which is all an unproved box shows */
export function hueFill(h, tone = 0, dark = isDark()) {
  return dark
    ? `hsl(${h} ${44 - tone * 9}% ${21 + tone * 4}%)`
    : `hsl(${h} ${70 - tone * 14}% ${92 - tone * 4}%)`;
}
export function hueLine(h, tone = 0, dark = isDark()) {
  return dark
    ? `hsl(${h} ${58 - tone * 8}% ${62 - tone * 7}%)`
    : `hsl(${h} ${58 - tone * 8}% ${42 + tone * 7}%)`;
}
/* the hue itself: the proved share of a box on the canvas, and the same bar in the
   index. Deep enough to read as the colour of the thing, light enough to write on. */
export function hueBar(h, tone = 0, dark = isDark()) {
  return dark
    ? `hsl(${h} ${46 - tone * 7}% ${44 - tone * 4}%)`
    : `hsl(${h} ${52 - tone * 9}% ${66 + tone * 4}%)`;
}
/* the ground of an open container: the same hue again, barely there, so that its
   children keep their own colour on top of it */
export function hueWash(h, tone = 0) {
  return isDark() ? `hsl(${h} ${30 - tone * 5}% 12%)` : `hsl(${h} ${44 - tone * 8}% 97%)`;
}

/* ---------- text ---------- */
let mc = null;
/* measure a label once, in the font it will actually be drawn in */
export function textWidth(s, font) {
  if (!mc) mc = document.createElement("canvas").getContext("2d");
  if (mc.font !== font) mc.font = font;
  return mc.measureText(s).width;
}
export function ellipsis(s, font, max) {
  if (textWidth(s, font) <= max) return s;
  let lo = 1, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(s.slice(0, mid) + "…", font) <= max) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}
