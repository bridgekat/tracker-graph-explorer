# The picture

`tracker graph` is the contract for anything that wants a picture, and the tracker itself does not
draw. This is the drawing: one HTML file, the whole window, that takes that JSON and lets you walk
the plan graph it describes — from the shape of the library down to a single theorem and what it
rests on.

Open `index.html` and drop a `graph.json` on it, or use the button, or paste the JSON, or point the
page at one with `index.html?graph=graph.json`. Nothing is uploaded; a dropped file never leaves the
browser.

```
lake build                            # the tracker reads oleans, so build first
lake exe tracker graph > graph.json   # the whole project
lake exe tracker graph --under Convex/Duality > graph.json   # one group and its descendants
```

## What it draws

**A node in the plan is a declaration; a node in the picture is whatever you have opened it to.**
The page starts with one box per area, and every box is a door.

**A box does not become a new drawing when you open it — it becomes a container.** Its children are
laid out inside the outline that was already there, its siblings move aside to make room, and the
camera holds its corner where it was, so you can see what was inside the thing you just opened.
That is the whole reason the layout is nested: each container is laid out on its own rather than
the canvas as a whole, so opening a group cannot reorder anything outside it. Nesting goes as deep
as the plan does — a library holding an area holding a module holding its theorems.

**Left to right.** A box sits after everything it rests on, so an edge always runs back towards the
left, and depth reads along the page. An edge that has to run the other way is one the layering
could not honour, and it is drawn dashed.

**How far a group is done is how far it is filled.** The proved share of a box is shaded — a wash of
black, of white in the dark — clipped by the box, so it runs edge to edge and ends in the box's own
corners; on an open container it fills the title strip instead. Shading is ink rather than a colour,
so it cannot clash with the fill: the colour of a box still says one thing, not two.

That one thing is area, progress or kind. Area is two questions at once, since the root of the tree
picks the hue family — so a backbone and its surfaces read apart at a glance — and the area within
it picks the shade.

Clicking a box lights everything it touches, above and below, and dims the rest; the lit edges are
ink rather than a colour of their own, since the colours already mean something here. A shut box
holding something in that cone stays lit, because it is standing in for it — the cone is followed
over what really touches what, and only then mapped onto whatever boxes are on screen. Hovering
marks the box under the pointer and no more: a drawing that rearranges its emphasis every time the
pointer crosses it is hard to read.

Three panes fill the window. The **index** on the left is the plan's tree with a search over every
group and every declaration; picking a result opens the tree to it and puts it in the middle of the
canvas. The **canvas** pans and zooms, from anywhere on it, boxes included. The **detail** on the
right is the node itself: its state, its module, its doc comment, its source, and the declarations
it rests on and that rest on it, each one a link to go there. Both side panes drag wider from the
line beside them, double-click back to their old width, and fold away entirely.

Two ways to look. **Whole graph** draws the current expansion of the tree. **Neighbourhood** drops
the tree and draws one declaration's cone at full detail — one, two, three steps, or the whole of
it, upstream, downstream or both. Four thousand declarations are a hairball; one theorem's cone is
a diagram, and it is the level at which "why is this here" has an answer.

## What it derives

Only the three arrays are read: `groups` for the tree, `nodes` for `group`, `kind`, `state`, `desc`,
`source`, `wrong` and `deprecated`, and `edges` for `from` and `to`. Everything else in the picture
is computed here, for the view on screen, every time it changes.

* **The rollup.** Each declaration edge is carried up to whichever boxes are visible and the
  parallel ones are merged, so two closed groups are joined by one line however many result
  dependencies run between them.
* **Where an edge belongs.** Every edge is laid out — and drawn — in the deepest container holding
  both of its ends, between that container's own two children. So a view shows each dependency at
  the level it has been opened to: the declarations inside a module you opened are wired to each
  other exactly, while everything that module leans on outside itself arrives on one line rather
  than on one line per declaration.
* **Which lines light.** One drawn line stands in for many real dependencies, so asking its two
  ends whether they are in the cone lights lines that carry none of it. The real relations are
  asked instead which drawn line stands in for them, and that line lights, at the strongest claim
  any of them makes: heaviest where it carries the focused box's own dependencies, lighter where it
  only carries the chain those start. Nothing else is dashed, so dashed goes on meaning one thing —
  an edge the layering had to reverse.
* **Cycles.** The real graph between declarations is acyclic, but the graph between *containers*
  need not be. A greedy feedback-arc pass picks a linear order, the edges that contradict it are
  counted and drawn dashed, and the reduction runs on what is left.
* **The essential edges.** The transitive reduction, over bitsets so that it holds up when every
  module is opened at once. Most edges in a view like that are shortcuts across a chain the drawing
  already shows; dropping them loses no reachability and is the difference between a diagram and a
  smear. The full set is one click away.
* **The layout.** Everything from here on is the Eclipse Layout Kernel's layered algorithm
  ([ELK](https://eclipse.dev/elk/), as elkjs): the layering, the order down a column, the position
  of each box by Brandes–Köpf, and the route of each edge as a spline that goes round boxes rather
  than through them. The whole scene goes in as one graph whose compound nodes are the containers,
  with hierarchy handled as *separate children*: each container is laid out on its own, innermost
  first, and sized from what it holds, which is the nesting above in one call. A container of a
  few unrelated clusters comes out packed rather than stacked, because ELK lays connected
  components out separately. The layout runs in a Web Worker, so the page stays responsive while
  a view at full depth is placed.

None of this is specific to any project. The page has no notion of a backbone or a surface — those
are conventions of `tracker/`, not of the tracker — it only knows that the roots of the tree it was
given are the coarsest thing about it, and colours them accordingly.

## The files

`index.html` is the built page, and the only file you need to use it: open it, drop a `graph.json`
on it, or publish it beside one. Everything is inlined, so it works from `file://` with nothing to
fetch and nothing to install. It is built rather than committed: `npm run build` writes it at the
root, and the Pages workflow publishes the same file.

It is a Svelte app, built by Vite. The chrome — the panes, the index, the detail, the controls — is
components; the canvas is not. A scene at full depth is thousands of nodes and tens of thousands of
edges, and diffing that against a virtual DOM every time the pointer moves would cost more than
drawing it, so `lib/canvas.js` owns one `<svg>` and redraws it when the state says to.

The layout is elkjs, which is most of the built file's size. There is no worker script to fetch
from a page that opens from `file://`, so the worker's source is inlined as a string and started
from a blob URL; where a worker cannot be made, the same source runs on the main thread.

A doc comment is Markdown, and the interesting half of one is usually inside a code span — a norm or
an operator in `backticks` inside **bold**. marked does that parsing and `Prose.svelte` renders its
tokens, so every value reaches the page as text in a template and nothing a graph file says can
become markup. There is no `{@html}` anywhere, and a test asserts it.

| file | what it is |
|---|---|
| `src/App.svelte` | the window: the bars and the three panes |
| `src/IndexPane.svelte` | the search and the plan's tree |
| `src/DetailPane.svelte` | whatever is selected, in full |
| `src/Prose.svelte`, `src/Inline.svelte` | a Lean doc comment, from marked's tokens |
| `src/StateDot.svelte` | the coloured dot that says what state a thing is in |
| `src/Canvas.svelte` | the viewport, its overlays and the tooltip |
| `src/app.css`, `src/styles/` | the palette, the tokens and the whole of the look, the canvas included |
| `src/lib/derive.js` | reading a graph, and the transitive reduction of a container's edges — no DOM in it |
| `src/lib/scene.js` | the nested scene: what boxes exist for an expansion state, and where |
| `src/lib/elk.js` | the layout engine, ELK layered, in a worker |
| `src/lib/canvas.js` | the SVG drawing, and the pointer and key handling on it |
| `src/lib/state.svelte.js` | the state, and the few actions that change it |
| `src/lib/util.js` | the colours, the formatting and the text measuring |
| `test/ui.mjs` | the page driven by real mouse input, in a headless browser |

```
npm install
npm run build     # -> index.html
npm run dev       # the same, with a reload on save
npm test          # it builds its own browser and serves its own page
```

`.github/workflows/pages.yml` builds the page on a push to `main` and publishes `dist/` to
GitHub Pages, which is one file. Turn it on once at Settings → Pages → Source → GitHub Actions.
Nothing is bundled with it: the deployed page is the drawing, and the graph is whatever the
person opening it drops on the page. The workflow does not run `npm test`, which wants a
browser and a graph to work on.

The test drives the built page with real pointer events rather than by calling handlers, because
most of what this page does *is* pointer behaviour — a click that is not a drag, a drag that is not
a click, a toggle that has to be hit — and every bug of that kind has been invisible to a test that
called the handler directly. It wants a graph to work on: it takes one as an argument, or finds
`numlib.json` beside it or one directory up.
