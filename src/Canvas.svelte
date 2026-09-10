<!-- The viewport, the chrome floating on it, and the tooltip. The drawing inside it
     is not a component: see lib/canvas.js.

     A neighbourhood is a different drawing rather than a different setting, so what
     says so lives here, over the drawing it belongs to: a card that is there while a
     cone is, and gone with it. It is the whole cone, both ways — a cone cut short has a
     boundary that lies, since a box at the edge of it looks like a box that rests on
     nothing — so there is nothing on the card to set, only what it is of and the way
     back out. -->
<script>
  import { onMount } from "svelte";
  import { Button, Card, Alert, Textarea } from "flowbite-svelte";
  import {
    ArrowLeftOutline,
    ChevronDoubleLeftOutline,
    ChevronDoubleRightOutline,
    ExpandOutline,
    ZoomInOutline,
    ZoomOutOutline,
  } from "flowbite-svelte-icons";
  import { createCanvas } from "./lib/canvas.js";
  import {
    app,
    attachCanvas,
    covers,
    fit,
    openWhere,
    pickFile,
    readText,
    select,
    setCone,
    setEdges,
    setInset,
    showTree,
    togglePane,
    toggleGroup,
    zoomBy,
  } from "./lib/state.svelte.js";
  import { hasBaked } from "./lib/site.js";
  import { fmt } from "./lib/util.js";

  let svg, viewport;
  let tip = $state(null);
  let pasteOpen = $state(false),
    pasteText = $state("");

  /* the tooltip sits beside the pointer, on whichever side has the room */
  function showTip(t) {
    if (!t) {
      tip = null;
      return;
    }
    const w = 340,
      h = 42 + t.rows.length * 18;
    tip = {
      ...t,
      left: Math.max(8, t.x + 16 + w > innerWidth - 8 ? t.x - w - 16 : t.x + 16),
      top: Math.max(8, t.y + 16 + h > innerHeight - 8 ? t.y - h - 16 : t.y + 16),
    };
  }

  onMount(() => {
    const c = createCanvas({
      svg,
      viewport,
      on: {
        select,
        toggle: toggleGroup,
        cone: setCone,
        tip: showTip,
        zoom: (k) => {
          app.zoom = k;
        },
      },
    });
    attachCanvas(c);
    return () => c.destroy();
  });

  /* The drawing spans the whole shell, so the panes over it are not something it can
     see: which part of it is uncovered has to be handed to it, and that changes with
     every frame of a pane being dragged. */
  $effect(() => setInset(covers("index"), covers("detail")));

  /* what the neighbourhood on screen is of */
  const seedName = $derived.by(() => {
    const s = app.coneSeed;
    if (!s || !app.base) return "";
    return s.t === 0 ? app.base.tree[s.i].short : app.base.decl[s.i].id;
  });

  /* ---------- the right-click menu ----------
     What is left of the toolbar. Opening the tree to a level is a one-off — you ask for
     it, it happens, and there is nothing left to look at — and which edges to draw is
     asked for about as often. Neither earns a row of buttons held over the drawing for
     the rest of the session, and a menu is what a question you ask occasionally looks
     like. Shift+F10 and the menu key reach it too: the browser turns both into the same
     event, and the only thing missing from them is where the pointer was. */
  const MODULES = (t) => !t.isModule;
  const LEVELS = [
    ["Areas", (t) => t.level < 1],
    ["Sub-areas", (t) => t.level < 2],
    ["Modules", MODULES],
    ["Declarations", () => true],
  ];
  const EDGES = [
    ["red", "Essential only"],
    ["all", "All of them"],
  ];
  let menu = $state(null);        /* where it was asked for */
  let at = $state(null);          /* and where it turned out to fit */
  let menuEl = $state(null);

  function openMenu(e) {
    if (!app.base) return;
    e.preventDefault();
    /* Shift+F10 and the menu key arrive as this same event with no pointer behind them,
       so what they get is the corner of the drawing rather than the corner of the page */
    const r = viewport.getBoundingClientRect();
    const byKey = e.button !== 2;
    at = null;
    menu = byKey
      ? { left: r.left + 24, top: r.top + 24 }
      : { left: e.clientX, top: e.clientY };
  }
  function closeMenu(focus) {
    if (!menu) return;
    menu = null;
    if (focus) viewport.focus();
  }
  /* Where it fits is taken from the menu once it is there to measure: a size written
     down here instead would have to be kept in step with whatever is put in it. The
     container takes the focus, as a native menu does, and the arrows walk from it into
     the items and around them. */
  $effect(() => {
    if (!menu || !menuEl) return;
    menuEl.focus();
    const r = menuEl.getBoundingClientRect();
    at = {
      left: Math.max(8, Math.min(menu.left, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.top, innerHeight - r.height - 8)),
    };
  });
  function menuKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menuEl.querySelectorAll("button")];
    const at = items.indexOf(document.activeElement);
    const to = at < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : at + (e.key === "ArrowDown" ? 1 : -1);
    items[(to + items.length) % items.length].focus();
  }

  const MENU_HEAD = "px-3 pt-2 pb-1 text-[10.5px] tracking-wide text-gray-500 uppercase";
  const MENU_ITEM =
    "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-gray-700 " +
    "hover:bg-gray-100 focus:bg-gray-100 focus:outline-none " +
    "dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800";
  const MENU_TICK = "w-3.5 shrink-0 text-primary-600 dark:text-primary-400";
  const CARD = "ex-card flex items-center shadow-sm";

  /* what a fold button says and points, open and shut */
  const FOLD = {
    index: {
      say: ["Fold the index away", "Bring the index back"],
      icon: [ChevronDoubleLeftOutline, ChevronDoubleRightOutline],
    },
    detail: {
      say: ["Fold the detail away", "Bring the detail back"],
      icon: [ChevronDoubleRightOutline, ChevronDoubleLeftOutline],
    },
  };

  const CODE = "rounded bg-gray-100 px-1 font-mono dark:bg-gray-800";
  const P = "mt-2 text-xs text-gray-700 dark:text-gray-300";
</script>

{#snippet fold(which, id, cls)}
  {@const Icon = FOLD[which].icon[+app.shut[which]]}
  <Button
    {id}
    size="xs"
    color="alternative"
    class="{cls} ex-paper"
    title={FOLD[which].say[+app.shut[which]]}
    aria-label={FOLD[which].say[+app.shut[which]]}
    onclick={() => togglePane(which)}
  >
    <Icon class="h-4 w-4" />
  </Button>
{/snippet}

<svelte:window
  onpointerdown={(e) => { if (!menuEl?.contains(e.target)) closeMenu(false); }}
  onwheel={() => closeMenu(false)}
  onblur={() => closeMenu(false)}
/>

<!-- The role sits on the viewport, not on the <svg>: the viewport is what takes focus and
     handles the keys, and the drawing inside it is redrawn wholesale. An application must
     be focusable to be operable, which is the whole point of the role. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="ex-viewport"
  class:cone={!!app.coneSeed}
  id="exViewport"
  tabindex="0"
  bind:this={viewport}
  role="application"
  oncontextmenu={openMenu}
  aria-label="Dependency graph. Drag to pan, scroll to zoom, arrow keys to move between nodes, Enter to open one, right-click for what to draw."
>
  <svg id="exSvg" bind:this={svg}></svg>

  <!-- One row of floating chrome across the top of whatever the panes leave uncovered:
       a fold button at each end, its chevron pointing the way its pane is about to go,
       and a neighbourhood's own bar between them when there is one. An "alternative"
       Button is a border and no fill, which reads as a button on a bar because the bar
       is behind it; these stand on the drawing, so each carries a surface with it. -->
  <div class="ex-hud">
    {@render fold("index", "exFoldIndex", "ex-hud-l")}

    {#if app.coneSeed}
      <div id="exConeBar" class="ex-hud-c {CARD} min-w-0 gap-3 px-2 py-1.5">
        <Button
          id="exConeBack"
          size="xs"
          color="alternative"
          class="shrink-0"
          title="Back to the whole graph"
          aria-label="Back to the whole graph"
          onclick={() => showTree()}
        >
          <ArrowLeftOutline class="h-4 w-4" />
        </Button>
        <span class="flex min-w-0 items-baseline gap-1.5 text-xs whitespace-nowrap">
          <span class="shrink-0 text-[11px] tracking-wide text-gray-500 uppercase">
            Neighbourhood of
          </span>
          <span id="exConeOf" class="truncate font-mono text-gray-700 dark:text-gray-300">
            {seedName}
          </span>
        </span>
      </div>
    {/if}

    {@render fold("detail", "exFoldDetail", "ex-hud-r")}
  </div>

  <!-- The zoom belongs to the drawing rather than to the window, so it sits on it, in
       the corner nothing is ever laid out into. -->
  <div class="ex-hud ex-hud-foot">
    <div class="ex-hud-c {CARD} gap-1 px-1.5 py-1">
      <Button
        id="exZoomOut"
        size="xs"
        color="alternative"
        aria-label="Zoom out"
        onclick={() => zoomBy(1 / 1.3)}><ZoomOutOutline class="h-4 w-4" /></Button
      >
      <span id="exZoomLab" class="w-11 text-center font-mono text-[11px] text-gray-500">
        {Math.round(app.zoom * 100)}%
      </span>
      <Button
        id="exZoomIn"
        size="xs"
        color="alternative"
        aria-label="Zoom in"
        onclick={() => zoomBy(1.3)}><ZoomInOutline class="h-4 w-4" /></Button
      >
      <Button id="exFit" size="xs" color="alternative" onclick={fit}>
        <ExpandOutline class="me-1.5 h-4 w-4" />Fit
      </Button>
    </div>
  </div>

  {#if app.error}
    <Alert id="srcErr" color="red" class="absolute inset-x-6 top-4 z-10 !text-xs">
      {app.error}
    </Alert>
  {/if}

  {#if app.busy}
    <div
      id="exBusy"
      class="ex-busy ex-card absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-gray-600 shadow-sm dark:text-gray-300"
      role="status"
    >
      Laying out…
    </div>
  {/if}

  <!-- Every way in this card offers is a way of loading another graph, so a page built
       around one does not show it. Reaching here at all means that graph did not read,
       and the error above it is the whole of what there is to say. -->
  {#if !app.base && !hasBaked}
    <div
      id="exEmpty"
      class="absolute inset-0 flex items-center justify-center overflow-y-auto p-6"
    >
      <Card class="max-w-xl p-5">
        <h2 class="text-lg text-gray-700 dark:text-gray-300">
          tracker <b class="text-gray-950 dark:text-white">graph explorer</b>
        </h2>
        <p class={P}>
          Drop the JSON from <code class={CODE}>tracker graph</code> anywhere on this page, or
          open it, and this draws the project's dependency graph — starting at its areas, and
          opening a group at a time down to the individual declaration. Nothing is uploaded;
          the file never leaves the browser.
        </p>
        <p class="mt-2 text-[11px] text-gray-500">
          <code class={CODE}>lake build &amp;&amp; lake exe tracker graph &gt; graph.json</code>,
          then open it here; or publish this page beside one and load it with
          <code class={CODE}>index.html?graph=graph.json</code>.
        </p>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button id="emptyOpen" size="xs" onclick={pickFile}>Open graph JSON</Button>
          <Button
            id="pasteBtn"
            size="xs"
            color="alternative"
            aria-pressed={pasteOpen}
            onclick={() => (pasteOpen = !pasteOpen)}>Paste it instead</Button
          >
        </div>

        {#if pasteOpen}
          <Textarea
            id="pasteArea"
            class="mt-3 font-mono !text-[11px]"
            rows={6}
            spellcheck="false"
            bind:value={pasteText}
            placeholder="Paste the contents of graph.json here"
          />
          <Button
            id="pasteGo"
            size="xs"
            class="mt-2"
            onclick={() => readText(pasteText.trim(), "pasted JSON")}>Use this JSON</Button
          >
        {/if}
      </Card>
    </div>
  {/if}
</div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
{#if menu}
  <div
    bind:this={menuEl}
    id="exMenu"
    class="ex-card fixed z-50 w-52 py-1 shadow-lg focus:outline-none"
    style="left: {(at ?? menu).left}px; top: {(at ?? menu).top}px"
    role="menu"
    tabindex="-1"
    aria-label="What to draw"
    onkeydown={menuKey}
  >
    <div class={MENU_HEAD}>Open the tree to</div>
    {#each LEVELS as [text, keep]}
      <button
        class={MENU_ITEM}
        role="menuitem"
        onclick={() => { openWhere(keep); closeMenu(true); }}
      >
        <span class="w-3.5 shrink-0"></span>{text}
      </button>
    {/each}

    <div class="my-1 border-t border-gray-200 dark:border-gray-800"></div>

    <div class={MENU_HEAD}>Draw the edges</div>
    {#each EDGES as [v, text]}
      <button
        class={MENU_ITEM}
        role="menuitemradio"
        aria-checked={app.edges === v}
        onclick={() => { setEdges(v); closeMenu(true); }}
      >
        <span class={MENU_TICK}>{app.edges === v ? "✓" : ""}</span>{text}
      </button>
    {/each}
  </div>
{/if}

{#if tip}
  <div
    id="tip"
    role="status"
    aria-live="polite"
    class="ex-card pointer-events-none fixed z-40 max-w-[330px] px-2.5 py-1.5 shadow-lg"
    style="left: {tip.left}px; top: {tip.top}px"
  >
    <div class="mb-0.5 font-mono text-[11.5px] break-all text-gray-950 dark:text-white">
      {tip.title}
    </div>
    {#each tip.rows as r}
      <div class="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-300">
        {#if r.state}<i
            class="h-2 w-2 flex-none rounded-[2px]"
            style="background: var(--st-{r.state})"
          ></i>{/if}{r.text}
      </div>
    {/each}
  </div>
{/if}
