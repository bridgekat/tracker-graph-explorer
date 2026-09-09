/* The small pieces the canvas and the components both use: SVG element building,
   the colour arithmetic, and text measurement. No state and no layout in here. */

const NS = "http://www.w3.org/2000/svg";

export const STATE_LABEL = {
  proved: "proved", stated: "stated", open: "open",
  axioms: "extra axioms", wrong: "marked wrong",
};

export function el(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

export const fmt = (n) => (n || 0).toLocaleString("en-US");
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + "s")}`;

/* ---------- colour ---------- */
function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
/* A hue from the tree turned into the fill and the stroke of a node. `tone` is the
   second channel: neighbours in one family sit a few degrees apart, which is not
   enough on its own, so they step in weight as well. */
export function hueFill(h, tone = 0) {
  return isDark()
    ? `hsl(${h} ${44 - tone * 9}% ${21 + tone * 4}%)`
    : `hsl(${h} ${70 - tone * 14}% ${92 - tone * 4}%)`;
}
export function hueLine(h, tone = 0) {
  return isDark()
    ? `hsl(${h} ${58 - tone * 8}% ${62 - tone * 7}%)`
    : `hsl(${h} ${58 - tone * 8}% ${42 + tone * 7}%)`;
}
/* How much of a box is finished is shown by shading that much of it, and shading is
   ink rather than a colour: a wash of black — of white, in the dark — over whatever
   the box is already painted. It cannot clash with the fill, because it is the fill. */
export const overlay = () => (isDark() ? "rgba(255, 255, 255, .13)" : "rgba(0, 0, 0, .11)");
/* the same idea where there is no fill to darken: the bars in the index sit on a
   plain track, so they carry the hue themselves */
export function hueBar(h, tone = 0) {
  return isDark()
    ? `hsl(${h} ${46 - tone * 7}% ${44 - tone * 4}%)`
    : `hsl(${h} ${52 - tone * 9}% ${66 + tone * 4}%)`;
}
/* the ground of an open container: the same hue again, barely there, so that its
   children keep their own colour on top of it */
export function hueWash(h, tone = 0) {
  return isDark() ? `hsl(${h} ${30 - tone * 5}% 12%)` : `hsl(${h} ${44 - tone * 8}% 97%)`;
}
/* a container drawn by state gets no colour of its own: the states of what is inside
   it are the point, and a wash would fight them */
export const neutralWash = () => (isDark() ? "#141413" : "#f8f8f5");

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
