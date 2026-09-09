<!-- The window: a title bar, a toolbar and three resizable panes. The chrome is
     Flowbite; the canvas inside the middle pane is not — see lib/canvas.js.
     Everything that decides what is drawn lives in state.svelte.js.

     The colours here are the theme's own (gray-*, primary-*), which app.css defines as
     this project's palette, so nothing needs restyling one element at a time. -->
<script>
  import { Button, Select, SplitPane, Pane } from "flowbite-svelte";
  import ThemeProvider from "flowbite-svelte/ThemeProvider.svelte";
  import {
    SunOutline,
    MoonOutline,
    FolderOpenOutline,
    ZoomInOutline,
    ZoomOutOutline,
    ExpandOutline,
  } from "flowbite-svelte-icons";
  import IndexPane from "./IndexPane.svelte";
  import DetailPane from "./DetailPane.svelte";
  import Canvas from "./Canvas.svelte";
  import {
    app,
    fit,
    openWhere,
    pickFile,
    readFile,
    rebuild,
    setColour,
    setEdges,
    setMode,
    zoomBy,
  } from "./lib/state.svelte.js";
  import { fmt } from "./lib/util.js";

  let dragging = $state(false);
  let dark = $state(document.documentElement.classList.contains("dark"));

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle("dark", dark);
    /* the drawing samples the tokens rather than inheriting them, so it has to be told */
    setColour(app.colour);
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    readFile(e.dataTransfer?.files?.[0]);
  }

  /* how far to open the whole tree at once */
  const LEVELS = [
    [(t) => t.level < 1, "Areas"],
    [(t) => t.level < 2, "Sub-areas"],
    [(t) => !t.isModule, "Modules"],
    [() => true, "Declarations"],
  ];

  const summary = $derived.by(() => {
    const m = app.base?.meta;
    if (!m) return "";
    return (
      `${fmt(m.nodes)} results · ${fmt(m.modules)} modules · ${fmt(m.edges)} dependencies` +
      (m.dangling ? ` · ${fmt(m.dangling)} edges point outside the plan and were dropped` : "")
    );
  });
  $effect(() => {
    document.title = app.src ? `tracker graph > ${app.src}` : "tracker graph";
  });

  /* Component defaults that have no dark variant of their own. Set here, once, rather
     than overridden at each use: SplitPane's divider is a flat bg-gray-300, which is a
     bright band across a dark page, and its drag colour is Tailwind's blue rather than
     this project's primary. */
  const THEME = {
    divider:
      "bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 " +
      "focus:outline-primary-500",
  };
  const BAR =
    "flex shrink-0 items-center border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";
  const LABEL = "text-[11px] tracking-wide text-gray-500 uppercase";
  const PANE = "flex h-full flex-col bg-white dark:bg-gray-900";
</script>

<!-- Separate Buttons rather than a ButtonGroup: a grouped Button discards its own size
     prop and is pinned to "sm", and the only way back to xs is overriding the vendor
     styles. Ungrouped they take the size they are given. With no `current` the row is
     plain actions rather than a choice. -->
{#snippet buttons(options, current, pick, label)}
  <div class="flex items-center gap-1" role="group" aria-label={label}>
    {#each options as [v, text, disabled]}
      <Button
        size="xs"
        color={current === v ? "primary" : "alternative"}
        aria-pressed={current === null ? undefined : current === v}
        {disabled}
        onclick={() => pick(v)}>{text}</Button
      >
    {/each}
  </div>
{/snippet}

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false;
  }}
  ondrop={onDrop}
/>

<ThemeProvider theme={THEME}>
  <div class="flex h-full flex-col" class:dragging>
    <header class="{BAR} gap-4 px-3 py-2">
      <span class="flex min-w-0 items-baseline gap-1.5 font-mono text-sm whitespace-nowrap">
        <b class="text-gray-950 dark:text-white">tracker graph</b>
        {#if app.src}
          <span class="text-gray-400 dark:text-gray-600">&gt;</span>
          <span id="srcName" class="truncate text-gray-700 dark:text-gray-300">{app.src}</span>
        {/if}
      </span>
      <span id="srcSub" class="hidden min-w-0 flex-1 truncate text-xs text-gray-500 sm:inline">
        {summary}
      </span>
      <div class="ms-auto flex shrink-0 items-center gap-2">
        <Button id="fileBtn" size="xs" color="alternative" onclick={pickFile}>
          <FolderOpenOutline class="me-1.5 h-4 w-4" />Open graph JSON
        </Button>
        <Button
          id="themeBtn"
          size="xs"
          color="alternative"
          aria-label="Switch theme"
          onclick={toggleTheme}
        >
          {#if dark}<SunOutline class="h-4 w-4" />{:else}<MoonOutline class="h-4 w-4" />{/if}
        </Button>
      </div>
    </header>

    <div class="{BAR} flex-wrap gap-x-4 gap-y-2 overflow-x-auto px-3 py-1.5">
      <div class="flex shrink-0 items-center gap-2">
        <span class={LABEL}>Open to</span>
        {@render buttons(LEVELS, null, openWhere, "How far to open the tree")}
      </div>

      {@render buttons(
        [
          ["tree", "Whole graph"],
          ["cone", "Neighbourhood", !app.sel && !app.coneSeed],
        ],
        app.mode,
        setMode,
        "What the graph shows",
      )}

      {#if app.mode === "cone"}
        <div id="exConeCtl" class="flex shrink-0 items-center gap-2">
          <Select
            id="exConeDir"
            size="sm"
            class="w-40 py-1 text-xs"
            aria-label="Which way the neighbourhood runs"
            bind:value={app.coneDir}
            onchange={() => rebuild()}
            items={[
              { value: "both", name: "both ways" },
              { value: "down", name: "what it rests on" },
              { value: "up", name: "what rests on it" },
            ]}
          />
          <Select
            id="exConeR"
            size="sm"
            class="w-36 py-1 text-xs"
            aria-label="How far the neighbourhood reaches"
            bind:value={app.coneRadius}
            onchange={() => rebuild()}
            items={[
              { value: 1, name: "1 step" },
              { value: 2, name: "2 steps" },
              { value: 3, name: "3 steps" },
              { value: -1, name: "the whole cone" },
            ]}
          />
        </div>
      {/if}

      <div class="flex shrink-0 items-center gap-2">
        <span class={LABEL}>Colour</span>
        {@render buttons(
          [
            ["area", "Area"],
            ["progress", "Progress"],
            ["kind", "Kind"],
          ],
          app.colour,
          setColour,
          "Colour dimension",
        )}
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <span class={LABEL}>Edges</span>
        {@render buttons(
          [
            ["red", "Essential"],
            ["all", "All"],
          ],
          app.edges,
          setEdges,
          "Which edges to draw",
        )}
      </div>

      <div class="ms-auto flex shrink-0 items-center gap-1">
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

    <SplitPane class="min-h-0 flex-1" minSize={180} initialSizes={[21, 53, 26]} responsive={false}>
      <Pane class="min-w-0 overflow-hidden">
        <aside id="exSide" class={PANE} aria-label="Index of groups and declarations">
          <IndexPane />
        </aside>
      </Pane>
      <Pane class="min-w-0 overflow-hidden">
        <main class="flex h-full min-w-0 flex-col"><Canvas /></main>
      </Pane>
      <Pane class="min-w-0 overflow-hidden">
        <aside class={PANE} aria-label="The selected node">
          {#if app.base}<DetailPane />{/if}
        </aside>
      </Pane>
    </SplitPane>
  </div>
</ThemeProvider>
