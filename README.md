# The picture

`tracker graph` is the contract for anything that wants a picture, and the tracker itself does not
draw. This is the drawing: one HTML file, the whole window, that takes that JSON and lets you walk
the plan graph it describes — from the shape of the library down to a single theorem and what it
rests on.

Serve `index.html` — `npm run dev` does, and so does the Pages workflow — and drop a `graph.json` on
it, or use the button, or paste the JSON, or point the page at one with `index.html?graph=graph.json`.
Nothing is uploaded; a dropped file never leaves the browser. A build can also bake a graph into the
page, which makes it a page about that one graph rather than a page that takes any — see [what a
build can bake in](#what-a-build-can-bake-in).

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
And it moves: every box slides from where it was to where it now is, an opening container unfolds
its contents from the box it was, a closing one folds them back into the box it becomes, and an
edge that is there before and after bends from its old route to its new one. A box stands for a
group or a declaration, an edge for a pair of them, and that is what survives the change and knows
where it came from. The motion is off when the system asks for reduced motion, and skipped when a
view is too big for it to help.
That is the whole reason the layout is nested: each container is laid out on its own rather than
the canvas as a whole, so opening a group cannot reorder anything outside it. Nesting goes as deep
as the plan does — a library holding an area holding a module holding its theorems.

**Left to right.** A box sits after everything it rests on, so an edge always runs back towards the
left, and depth reads along the page. An edge that has to run the other way is one the layering
could not honour, and it is drawn dashed.

**How far a box is done is how far it is filled.** Every box has one hue in two strengths: the
proved share of it is drawn in the hue itself, and the rest is the same hue let down to a tint. The
bar is clipped by the box, so it runs edge to edge and ends in the box's own corners; on an open
container it fills the title strip instead. Colour says what a box is and strength says how far it
has got, so the two never have to share a channel.

**What a box is depends on which kind of box it is.** A declaration is coloured by what it is — a
definition and a theorem are different kinds of thing, and which of the two a box holds is the first
thing worth knowing about it. A declaration is proved or it is not, so its bar is all or nothing:
the kind's colour where the work is done, a pale version of it where it is still open. A group holds
both kinds, so a kind is not a question it can answer; it is coloured by its area instead, which is
two questions at once, since the root of the tree picks the hue family — so a backbone and its
surfaces read apart at a glance — and the area within it picks the shade.

The states that are not simply "not done yet" would be lost in a bar that only counts what is
proved, so a declaration resting on extra axioms, or marked wrong, says so in its outline instead of
in its fill.

Clicking a box lights everything it touches, above and below, and dims the rest; the lit edges are
ink rather than a colour of their own, since the colours already mean something here. A shut box
holding something in that cone stays lit, because it is standing in for it — the cone is followed
over what really touches what, and only then mapped onto whatever boxes are on screen. Walking the
graph between boxes instead would be a different answer rather than an approximation of that one: a
shut box stands for many declarations at once, so the walk arrives at it by one that is in the cone
and leaves it by one that is not, and lights whatever is past that for nothing.

Clicking the box that is already lit puts the drawing back the way it was, and so does Escape, or a
click on the ground. Hovering marks the box under the pointer and no more: a drawing that rearranges
its emphasis every time the pointer crosses it is hard to read.

**Every box carries one control, and clicking the box itself never does anything but light it.** The
control sits at the box's left, before its title, and does the one thing that box can be opened
into: a group opens into the boxes it holds, a declaration into the neighbourhood it sits in. Enter
does the same from the keyboard. It is at the left because that is the edge that opening does not
move — a box grows to hold what is in it, so a control at its right would travel the whole of that
width while you were still looking at it, and at the left the same click closes what it just opened.
No box answers a double-click. A double-click arrives as two clicks first, so a gesture meant to open
a box would take hold of it and let go of it on the way in, and one pointer gesture that means two
things depending on how fast you were is not something to have to know. The ground still takes one,
which fits the drawing to the window.

Three panes fill the window, and the **canvas** is the whole of it: the other two float over the
drawing rather than dividing it, so the drawing is the full width whether they are open or shut and
folding one uncovers what was already there instead of laying it out again. What the camera aims at
is the part no pane is over — fitted to the whole width, a graph would put a third of itself behind
them — while panning is left alone, since sliding something under a pane costs nothing.

The **index** on the left is the plan's tree with a search over every
group and every declaration; picking a result opens the tree to it and puts it in the middle of the
canvas, and the canvas pans and zooms from anywhere on it, boxes included. The **detail** on the
right is the node itself: its state, its module, its doc comment, its source, and the declarations
it rests on and that rest on it, each one a link to go there — and, where the build was told where
the API documentation lives, a link out to the declaration's own entry in it.

Both side panes drag wider from the strip at their inner edge — the pane's own colour, marked only
by the grip in the middle of it. Each folds away entirely from the button at its end of the row that
floats across the top of the drawing, which is also what brings it back: the chevron points the way
the pane is about to go, and a folded pane comes back to the width it had.

**One bar, and it is the file's.** What steers the drawing either belongs to the drawing and floats
on it — the zoom along the bottom, the fold buttons and a neighbourhood's card along the top — or is
a one-off you ask for when you want it, and lives in the canvas's right-click menu: how far to open
the whole tree at once, and whether to draw every edge or only the ones the drawing cannot do
without. Shift+F10 and the menu key reach the same menu. Everything floating is inset by whatever
the panes cover, so none of it ever competes with them; fold a pane and it all grows into what is
left. A row of controls held permanently above a drawing is a row of controls in the way of it.

Two ways to look. The **whole graph** is the current expansion of the tree. A **neighbourhood**
drops the tree and draws one declaration's cone at full detail: everything it rests on and
everything that rests on it, all the way down and all the way up. A cone cut off after so many steps
has a boundary that lies — a box at the edge of it looks like a box that rests on nothing — so there
is nothing to set, and the page asks first if the cone is too big to read. Four thousand
declarations are a hairball; one theorem's cone
is a diagram, and it is the level at which "why is this here" has an answer.

A neighbourhood is a different drawing rather than a setting, so nothing switches to one: a
declaration's own control, or Enter, draws its cone. While you are in one the ground goes dotted, and a
card in that floating row says what the cone is of and carries the way back out to the whole graph,
which comes back as you left it.

**Which node you are on is in the address bar**, so the way to send someone what you are looking at
is to copy the URL. The fragment is the node's address and nothing else:

```
index.html#Numlib/Krylov
index.html#Numlib/Krylov/CR,Numlib.Krylov.CR.isMinResIterate
```

Opening one of those lands the page there in one layout, rather than drawing the areas and then
going. What travels is one node and not the session: the rest of your expansion, the edge mode,
whether you were in a neighbourhood and how wide your panes were all stay yours, and a link opens the
tree down to its node and no further. A node is named by what the graph file calls it, so a link
survives a re-export that renumbers everything, and an address the graph does not have is ignored — a
stale link, or one made against another project's graph, still opens the page. The URL is replaced
rather than pushed, so clicking around a drawing does not fill the back button with it.

## How a node is addressed

```
Numlib/Krylov                                        a group
Numlib/Krylov/CR,Numlib.Krylov.CR.isMinResIterate    a declaration
```

The path to the module, in the notation a module is written in, and then — for a declaration — a
comma and the full name it is declared under. Both halves, because neither alone says where a thing
is: a Lean name does not say which file it was written in, and a file does not say what is in it. The
comma is what tells the two apart, and neither half can hold one; where an address has to go
somewhere that cannot take a name as it stands, such as a URL, each part is escaped and the
punctuation between them is left to read.

A declaration is found by its own name, and the module in front of it is context rather than a second
condition to satisfy: a declaration that has since moved to another file is still that declaration,
and a link to it still arrives. This is the format the page puts in the address bar, and the one the
detail pane hands you when you copy a declaration. `lib/derive.js` writes it down once — `address`
and `refAt` — and everything that names a node goes through there.

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
  asked instead which drawn line stands in for them, and that line lights. There are two things it
  can be carrying, and they are the two halves of the cone — the chain running down into what the
  focused box rests on, drawn the stronger of the two, and the chain running up into what rests on
  it. A box's own dependencies are the first step of those chains rather than a third kind of
  thing, so they are not called out: every lit line is drawn at one weight, and dashed and heavy
  both go on meaning what they meant — an edge the layering had to reverse, and the focused box.
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

`index.html` is the built page, and the only file you need to use it: serve it and drop a
`graph.json` on it, or publish it beside one. Everything is inlined, so there is nothing else to
fetch and nothing to install. It is built rather than committed: `npm run build` writes it at the
root, and the Pages workflow publishes the same file.

It is a Svelte app, built by Vite. The chrome — the panes, the index, the detail, the controls — is
components; the canvas is not. A scene at full depth is thousands of nodes and tens of thousands of
edges, and diffing that against a virtual DOM every time the pointer moves would cost more than
drawing it, so `lib/canvas.js` owns one `<svg>` and redraws it when the state says to.

The layout is elkjs, which is most of the built file's size. What ships is one file, so there is no
worker script beside it to fetch: the worker's source is inlined as a string and started from a blob
URL; where a worker cannot be made, the same source runs on the main thread.

A doc comment is Markdown, and the interesting half of one is usually inside a code span — a norm or
an operator in `backticks` inside **bold**. marked does that parsing and `Prose.svelte` renders its
tokens, so every value reaches the page as text in a template and nothing a graph file says can
become markup. There is no `{@html}` anywhere, and a test asserts it.

| file | what it is |
|---|---|
| `src/App.svelte` | the window: the bars, and the two panes floating over the drawing |
| `src/Grip.svelte` | the strip a side pane is dragged wider from |
| `src/IndexPane.svelte` | the search and the plan's tree |
| `src/DetailPane.svelte` | whatever is selected, in full |
| `src/Prose.svelte`, `src/Inline.svelte` | a Lean doc comment, from marked's tokens |
| `src/StateDot.svelte` | the coloured dot that says what state a thing is in |
| `src/Canvas.svelte` | the viewport, the chrome floating on it and the tooltip |
| `src/app.css`, `src/styles/` | the palette, the tokens and the whole of the look, the canvas included |
| `src/lib/derive.js` | reading a graph, how a node is addressed, and the transitive reduction of a container's edges — no DOM in it |
| `src/lib/scene.js` | the nested scene: what boxes exist for an expansion state, and where |
| `src/lib/elk.js` | the layout engine, ELK layered, in a worker |
| `src/lib/canvas.js` | the SVG drawing, and the pointer and key handling on it |
| `src/lib/state.svelte.js` | the state, and the few actions that change it |
| `src/lib/util.js` | the colours, the formatting and the text measuring |
| `src/lib/site.js` | what the build baked into the page: the graph, its download, the API docs |
| `src/lib/format.js` | the compact form of a graph and the gzip around it, shared by the build and the page |
| `test/ui.mjs` | the page driven by real mouse input, in a headless browser |

```
npm install
npm run build     # -> index.html
npm run dev       # the same, with a reload on save
npm test          # it builds its own browser and serves its own page
```

`.github/workflows/pages.yml` builds the page on a push to `main` and publishes `dist/` to
GitHub Pages, which is one file. Turn it on once at Settings → Pages → Source → GitHub Actions.
Nothing is baked into that one: the deployed page is the drawing, and the graph is whatever the
person opening it drops on it. The workflow does not run `npm test`, which wants a browser and a
graph to work on.

## What a build can bake in

Two things, read from the environment, so that a project's own CI can publish this page pinned to
the graph it has just exported:

```
TRACKER_GRAPH=graph.json TRACKER_DOCS=docs npm run build
```

**`TRACKER_GRAPH`** puts that graph in the page, compressed, in a `<script>` no browser will
execute. The build pays for the compression once and every reader of the page would otherwise pay
for the size of it forever, so it is done eagerly and twice over: the graph is rewritten into the
compact form — the contract said by column rather than by row, an edge naming its ends by their
index rather than spelling both out — and then gzipped, and `DecompressionStream` unpacks it on
the way in. On the plan of a large project that is 90MB of page down to 4MB, most of it because
the edges are nearly the whole of a graph and nearly the whole of each edge was two declaration
ids written out in full. `src/lib/format.js` holds both halves, and `expand` is the exact inverse
of `compact`, which is what lets the page hand back the file it was built from.

A graph the page is given rather than built with is still the contract as `tracker graph` prints
it — that format is what other tools read, and nothing here changes it. A `.json.gz` may be
dropped on the page as well as a `.json`; the first two bytes are what decides.

What comes out is a page about that graph rather than a page that takes one, and it is the whole
of the difference: the page opens on it, and every way of loading another — the button, the drop,
the paste, `?graph=` — is gone, because on a published page they are ways of making it say
something other than what it was published to say. In their place is the download of the graph it
was built from, so that what the page is drawing is still a file you can have.

**`TRACKER_DOCS`** is the root of a [doc-gen4](https://github.com/leanprover/doc-gen4) site,
absolute or relative to wherever the page is published. The detail pane then links a declaration to
its own anchor on its module's page — `<root>/Numlib/Krylov/CR.html#CR.isMinResIterate` — and a
module to its page, since what the graph calls a group and a node id are exactly what doc-gen4
names a page and an anchor by. It links only what the library actually has: a declaration that is
still open is not in the docs, and neither is a module none of whose declarations are written yet.
It needs `TRACKER_GRAPH`, and a build given it alone stops: it says where one project's
declarations are written down, and a page that has not been given that project's graph has nothing
to say it about.

Both are visible in the built file, in `<head>` and at the end of `<body>`; a build given neither
produces exactly the page it produced before.

The test drives the built page with real pointer events rather than by calling handlers, because
most of what this page does *is* pointer behaviour — a click that is not a drag, a drag that is not
a click, a toggle that has to be hit — and every bug of that kind has been invisible to a test that
called the handler directly. It wants a graph to work on: it takes one as an argument, or finds
`numlib.json` beside it or one directory up.
