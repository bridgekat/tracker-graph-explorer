<!-- The window: a navbar, a toolbar, three resizable panes and a status strip. The
     chrome is Flowbite; the canvas inside the middle pane is not — see lib/canvas.js.
     Everything that decides what is drawn lives in state.svelte.js.

     The colours here are the theme's own (gray-*, primary-*), which app.css defines as
     this project's palette, so nothing needs restyling one element at a time. -->
<script>
  import { Navbar, NavBrand, Button, ButtonGroup, Select, SplitPane, Pane } from "flowbite-svelte";
  import ThemeProvider from "flowbite-svelte/ThemeProvider.svelte";
  import {
    SunOutline, MoonOutline, FolderOpenOutline,
    ZoomInOutline, ZoomOutOutline, ExpandOutline,
  } from "flowbite-svelte-icons";
  import IndexPane from "./IndexPane.svelte";
  import DetailPane from "./DetailPane.svelte";
  import Canvas from "./Canvas.svelte";
  import {
    app, readText, openAllGroups, openEverything,
    openToLevel, rebuild, repaintTheme, setColour, setEdges, setMode,
  } from "./lib/state.svelte.js";
  import { STATE_LABEL, fmt, hueLine } from "./lib/util.js";
  import * as TD from "./lib/derive.js";

  let dragging = $state(false);
  let fileInput = $state(null);
  let canvas = $state(null);
  let dark = $state(document.documentElement.classList.contains("dark"));

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle("dark", dark);
    /* the drawing samples the tokens rather than inheriting them, so it has to be told */
    repaintTheme();
  }

  const LEVELS = [["areas", "Areas"], ["sub", "Sub-areas"], ["modules", "Modules"], ["all", "Declarations"]];
  let level = $state("sub");
  function openTo(v) {
    level = v;
    if (app.mode !== "tree") app.mode = "tree";
    if (v === "areas") openToLevel(1);
    else if (v === "modules") openAllGroups();
    else if (v === "all") openEverything();
    else openToLevel(2);
    rebuild();
  }

  function onFile(e) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    f.text().then((t) => readText(t, f.name));
    e.currentTarget.value = "";
  }
  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) f.text().then((t) => readText(t, f.name));
  }

  /* the legend, grouped so that a backbone and its surfaces read as families */
  const legend = $derived.by(() => {
    if (!app.base) return [];
    if (app.colour === "progress") {
      return TD.STATES.filter((s) => app.base.meta.states[s])
        .map((s) => ({ colour: `var(--st-${s})`, label: STATE_LABEL[s] }));
    }
    if (app.colour === "kind") {
      return [{ colour: hueLine(210), label: "theorem" }, { colour: hueLine(28), label: "definition" }];
    }
    const roots = [];
    app.base.topics.forEach((ti) => {
      const r = app.base.tree[ti].root;
      if (!roots.includes(r)) roots.push(r);
    });
    const per = Math.max(3, Math.floor(14 / roots.length));
    const out = [];
    let hidden = 0;
    roots.forEach((r) => {
      let left = per;
      const rt = app.base.tree[r];
      if (roots.length > 1) out.push({ colour: hueLine(rt.hue), label: rt.label, family: true });
      app.base.topics.forEach((ti) => {
        const t = app.base.tree[ti];
        if (t.root !== r || ti === r) return;
        if (left <= 0) { hidden++; return; }
        left--;
        out.push({ colour: hueLine(t.hue, t.tone), label: t.label });
      });
    });
    if (hidden) out.push({ muted: `and ${hidden} more, which the index names` });
    return out;
  });

  const statusNode = $derived(app.status?.node);

  /* Component defaults that have no dark variant of their own. Set here, once, rather
     than overridden at each use: SplitPane's divider is a flat bg-gray-300, which is a
     bright band across a dark page, and its drag colour is Tailwind's blue rather than
     this project's primary. */
  const THEME = {
    divider: "bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 "
      + "focus:outline-primary-500",
  };
  const BAR = "shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";
  const LABEL = "text-[11px] tracking-wide text-gray-500 uppercase";
</script>

<!-- A row of Buttons in a ButtonGroup: Flowbite's own segmented control, so the
     selected and unselected states are the theme's rather than something drawn here. -->
{#snippet segmented(options, current, pick, label)}
  <ButtonGroup size="xs" aria-label={label}>
    {#each options as [v, text]}
      <Button size="xs" color={current === v ? "primary" : "alternative"}
        aria-pressed={current === v} onclick={() => pick(v)}>{text}</Button>
    {/each}
  </ButtonGroup>
{/snippet}

<svelte:window
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => { if (e.relatedTarget === null) dragging = false; }}
  ondrop={onDrop} />

<ThemeProvider theme={THEME}>
<div class="flex h-full flex-col" class:dragging>
  <Navbar class="{BAR} px-3 py-2">
    <NavBrand href="##" class="gap-2">
      <span class="font-mono text-sm text-gray-700 dark:text-gray-300">
        tracker <b class="text-gray-950 dark:text-white">graph</b>
      </span>
    </NavBrand>
    <div class="flex min-w-0 flex-1 items-baseline gap-2 px-4">
      <span id="srcName" class="truncate font-mono text-xs text-gray-950 dark:text-white"
        >{app.src || "no graph loaded"}</span>
      <span id="srcSub" class="hidden truncate text-xs text-gray-500 sm:inline">{app.srcSub}</span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button id="fileBtn" size="xs" color="alternative" onclick={() => fileInput.click()}>
        <FolderOpenOutline class="me-1.5 h-4 w-4" />Open graph JSON
      </Button>
      <Button id="themeBtn" size="xs" color="alternative" aria-label="Switch theme" onclick={toggleTheme}>
        {#if dark}<SunOutline class="h-4 w-4" />{:else}<MoonOutline class="h-4 w-4" />{/if}
      </Button>
    </div>
    <input type="file" id="fileInput" accept=".json,application/json" hidden
      bind:this={fileInput} onchange={onFile} />
  </Navbar>

  <div class="{BAR} flex flex-wrap items-center gap-x-4 gap-y-2 overflow-x-auto px-3 py-1.5">
    <div class="flex shrink-0 items-center gap-2">
      <span class={LABEL}>Open to</span>
      {@render segmented(LEVELS, level, openTo, "How far to open the tree")}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      {@render segmented([["tree", "Whole graph"], ["cone", "Neighbourhood"]],
        app.mode, setMode, "What the graph shows")}
    </div>

    {#if app.mode === "cone"}
      <div id="exConeCtl" class="flex shrink-0 items-center gap-2">
        <Select id="exConeDir" size="sm" class="w-40 py-1 text-xs"
          aria-label="Which way the neighbourhood runs"
          bind:value={app.coneDir} onchange={() => rebuild()}
          items={[{ value: "both", name: "both ways" },
                  { value: "down", name: "what it rests on" },
                  { value: "up", name: "what rests on it" }]} />
        <Select id="exConeR" size="sm" class="w-36 py-1 text-xs"
          aria-label="How far the neighbourhood reaches"
          bind:value={app.coneRadius} onchange={() => rebuild()}
          items={[{ value: 1, name: "1 step" }, { value: 2, name: "2 steps" },
                  { value: 3, name: "3 steps" }, { value: -1, name: "the whole cone" }]} />
      </div>
    {/if}

    <div class="flex shrink-0 items-center gap-2">
      <span class={LABEL}>Colour</span>
      {@render segmented([["area", "Area"], ["progress", "Progress"], ["kind", "Kind"]],
        app.colour, setColour, "Colour dimension")}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <span class={LABEL}>Edges</span>
      {@render segmented([["red", "Essential"], ["all", "All"]],
        app.edges, setEdges, "Which edges to draw")}
    </div>

    <div class="ms-auto flex shrink-0 items-center gap-1">
      <Button id="exZoomOut" size="xs" color="alternative" aria-label="Zoom out"
        onclick={() => canvas?.zoomBy(1 / 1.3)}><ZoomOutOutline class="h-4 w-4" /></Button>
      <span id="exZoomLab" class="w-11 text-center font-mono text-[11px] text-gray-500"
        >{Math.round(app.zoom * 100)}%</span>
      <Button id="exZoomIn" size="xs" color="alternative" aria-label="Zoom in"
        onclick={() => canvas?.zoomBy(1.3)}><ZoomInOutline class="h-4 w-4" /></Button>
      <Button id="exFit" size="xs" color="alternative" onclick={() => canvas?.fit()}>
        <ExpandOutline class="me-1.5 h-4 w-4" />Fit
      </Button>
    </div>
  </div>

  <SplitPane class="min-h-0 flex-1" minSize={180} initialSizes={[21, 53, 26]} responsive={false}>
    <Pane class="min-w-0 overflow-hidden">
      <aside id="exSide" class="flex h-full flex-col bg-white dark:bg-gray-900"
        aria-label="Index of groups and declarations">
        <IndexPane />
      </aside>
    </Pane>

    <Pane class="min-w-0 overflow-hidden">
      <main class="flex h-full min-w-0 flex-col">
        <Canvas bind:api={canvas} />
      </main>
    </Pane>

    <Pane class="min-w-0 overflow-hidden">
      <aside class="flex h-full flex-col bg-white dark:bg-gray-900" aria-label="The selected node">
        {#if app.base}<DetailPane />{/if}
      </aside>
    </Pane>
  </SplitPane>

  <div class="flex shrink-0 items-center gap-4 overflow-x-auto border-t border-gray-200 bg-white
              px-3 py-1.5 text-[11.5px] text-gray-700 dark:border-gray-800 dark:bg-gray-900
              dark:text-gray-300">
    <div id="exStatus" class="flex shrink-0 items-center gap-2 whitespace-nowrap">
      {#if app.status?.warn}
        <span class="text-orange-700 dark:text-orange-400">{app.status.warn}</span>
      {:else if statusNode}
        <span><b class="tabular-nums text-gray-950 dark:text-white">{fmt(app.status.below)}</b> it rests on</span>
        <span><b class="tabular-nums text-gray-950 dark:text-white">{fmt(app.status.above)}</b> rest on it</span>
        {#if statusNode.kind === "group"}
          <span><b class="tabular-nums text-gray-950 dark:text-white">{fmt(statusNode.count)}</b> results inside</span>
        {/if}
      {:else}
        <span class="text-gray-500">
          {app.mode === "cone"
            ? "The neighbourhood of one declaration. Double-click another to move it there."
            : "Click a box to read it and to light what it touches. ＋ opens it."}
        </span>
      {/if}
    </div>

    <div id="exLegend" class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {#each legend as item}
        {#if item.muted}
          <span class="text-gray-500">{item.muted}</span>
        {:else}
          <span class="flex items-center gap-1.5 whitespace-nowrap">
            <i class="inline-block h-2.5 w-2.5 rounded-[2px]" style="background: {item.colour}"></i>
            {#if item.family}<b class="text-gray-950 dark:text-white">{item.label}</b>{:else}{item.label}{/if}
          </span>
        {/if}
      {/each}
      <span class="text-gray-500">left to right — a box sits after what it rests on</span>
    </div>

    <div id="exStats" class="ms-auto shrink-0 ps-3 font-mono text-[10.5px] whitespace-nowrap
                             text-gray-500">{app.stats}</div>
  </div>
</div>
</ThemeProvider>

{#if app.tip}
  <div id="tip" class="on" role="status" aria-live="polite"
    style="left: {app.tip.left}px; top: {app.tip.top}px">
    {#each app.tip.rows as r}
      <div class={r.cls}>
        {#if r.key}<i class="tk" style="background: {r.key}"></i>{/if}{r.text}
      </div>
    {/each}
  </div>
{/if}
