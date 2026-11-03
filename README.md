# tracker graph explorer

An interactive drawing of the dependency graph that
[`tracker graph`](https://github.com/bridgekat/tracker) exports for a Lean project. It is one
self-contained HTML file: open it, give it a graph, and walk from the areas of the library down to
a single theorem and everything it rests on.

## Quick start

Export a graph from the Lean project:

```
lake build
lake exe tracker graph --all --metrics > graph.json                 # every declaration, with sizes
lake exe tracker graph --all --under Numlib.Analysis > graph.json   # one part of the tree
```

Then build and serve the page:

```
npm install
npm run build        # writes index.html
npm run dev          # or: a dev server that reloads on save
```

Load the graph by dropping `graph.json` (or `graph.json.gz`) on the page, using *Open graph JSON*,
pasting it, or opening `index.html?graph=graph.json`. Nothing is uploaded; the file stays in the
browser.

## Reading the drawing

- **Boxes.** The page starts with one box per area of the library. A module opens in place into a
  container holding its submodules and declarations; the rest of the drawing moves aside.
- **Left to right.** Every box sits to the right of what it depends on. A dashed edge is one the
  layout had to draw backwards because of a cycle between containers.
- **Colour.** Declarations are coloured by kind (definition or theorem), modules by area. The
  filled share of a box is how much of it is proved, counting planned declarations (or all
  declarations when none are planned).
- **Outlines.** Planned declarations have bold names and solid outlines; declarations no plan
  names have dashed outlines. A coloured outline marks a declaration that is marked wrong or rests
  on extra axioms.
- **The number on a box** is chosen with the **Count** dropdown at the bottom: declarations, lines
  of source, characters of source, or term size. A module shows the total over everything under
  it. All but the first need a graph exported with `--metrics`.

## Moving around

| action | how |
|---|---|
| Open or close a module | the ＋/− at the left of its box, or Enter |
| Highlight everything a box touches | click it; click again, Escape, or click the background to clear |
| Show one declaration's neighbourhood | the ‹·› control at the left of its box, or Enter |
| Pan and zoom | drag and scroll; *Fit*, or double-click the background, fits the window |
| Open the whole tree to a depth, or show every edge | right-click the canvas (or Shift+F10) |
| Find a module or declaration | the search in the index pane |

A **neighbourhood** draws one declaration's complete cone: everything it depends on and everything
that depends on it. The card at the top leads back to the full graph as you left it.

The **index** (left) is the module tree with search; the **detail** pane (right) shows the
selected node's state, description, sizes and dependencies, each a link. Both panes can be resized
or folded.

The URL fragment names the selected node, so a link opens the page at that node:

```
index.html#Numlib.Krylov                               a module
index.html#Numlib.Krylov.CR,CR.isMinResidualIterate    a declaration, after its module
```

## Publishing a page for one project

A build can bake a graph into the page, so a project's CI can publish a page about its own graph:

```
TRACKER_GRAPH=graph.json TRACKER_DOCS=docs npm run build
```

- `TRACKER_GRAPH` embeds the graph (gzipped). The page opens on it, offers it as a download, and
  no longer accepts other graphs.
- `TRACKER_DOCS` is the root of a [doc-gen4](https://github.com/leanprover/doc-gen4) site; the
  detail pane then links modules and declarations to their API docs. It requires
  `TRACKER_GRAPH`.

`.github/workflows/pages.yml` publishes the plain page (no graph baked in) to GitHub Pages on
every push to `main`.

## Development

The page is a Svelte app built by Vite into one HTML file. The panes are Svelte components; the
canvas is plain SVG drawn by `src/lib/canvas.js`, since a full graph has too many nodes for a
virtual DOM. Layout is [ELK](https://eclipse.dev/elk/)'s layered algorithm, run in a Web Worker.

| file | contents |
|---|---|
| `src/lib/derive.js` | reading a graph: module tree, roll-ups, metrics, addresses, transitive reduction |
| `src/lib/scene.js` | which boxes and edges are visible, and their layout |
| `src/lib/canvas.js` | the SVG drawing and pointer/keyboard handling |
| `src/lib/state.svelte.js` | page state and the actions that change it |
| `src/*.svelte` | the window, panes, menus and tooltip |
| `test/ui.mjs` | end-to-end checks driving the built page in headless Chrome |

```
npm test -- path/to/graph.json     # BROWSER=/path/to/chrome if it is not found
```

The tests are written against numlib's graph (`tracker graph --all` in numlib), and look for
`numlib.json` here or one directory up when no path is given.
