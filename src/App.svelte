<!-- The window: one title bar and, under it, the drawing with two panes floating over
     it. The chrome is Flowbite; the canvas is not — see lib/canvas.js. Everything that
     decides what is drawn lives in state.svelte.js.

     There is no second bar. What steers the drawing either belongs to the drawing, and
     floats on it — the zoom, the fold buttons, a neighbourhood's own card — or is a
     one-off that is asked for when it is wanted, and lives in the canvas's right-click
     menu. A row of controls held permanently above a drawing is a row of controls in
     the way of it.

     The colours here are the theme's own (gray-*, primary-*), which app.css defines as
     this project's palette, so nothing needs restyling one element at a time. -->
<script>
  import { Button } from "flowbite-svelte";
  import {
    SunOutline,
    MoonOutline,
    DownloadOutline,
    FolderOpenOutline,
  } from "flowbite-svelte-icons";
  import { bakedName, downloadGraph, hasBaked } from "./lib/site.js";
  import Grip from "./Grip.svelte";
  import IndexPane from "./IndexPane.svelte";
  import DetailPane from "./DetailPane.svelte";
  import Canvas from "./Canvas.svelte";
  import { app, covers, GRIP, pickFile, readFile, setTheme } from "./lib/state.svelte.js";

  let dragging = $state(false);

  /* A page built around one graph does not take another, but it still has to swallow the
     drop: left to itself the browser navigates away from the page to whatever was
     dropped on it, which is a worse answer than nothing happening. */
  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    if (!hasBaked) readFile(e.dataTransfer?.files?.[0]);
  }

  $effect(() => {
    document.title = app.src ? `tracker graph > ${app.src}` : "tracker graph";
  });

  const BAR =
    "flex shrink-0 items-center border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";
  const PANE = "flex h-full flex-col bg-white dark:bg-gray-900";
</script>

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    if (!hasBaked) dragging = true;
  }}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false;
  }}
  ondrop={onDrop}
/>

<div class="flex h-full flex-col" class:dragging>
  <header class="{BAR} gap-4 px-3 py-2">
    <span class="flex min-w-0 items-baseline gap-1.5 font-mono text-sm whitespace-nowrap">
      <b class="text-gray-950 dark:text-white">tracker graph</b>
      {#if app.src}
        <span class="text-gray-400 dark:text-gray-600">&gt;</span>
        <span id="srcName" class="truncate text-gray-700 dark:text-gray-300">{app.src}</span>
      {/if}
    </span>
    <div class="ms-auto flex shrink-0 items-center gap-2">
      <!-- the graph is the build's, so the way out of the page is the way in reversed -->
      {#if hasBaked}
        <Button
          id="saveBtn"
          size="xs"
          color="alternative"
          onclick={downloadGraph}
          title="Download {bakedName}"
        >
          <DownloadOutline class="me-1.5 h-4 w-4" />Download graph JSON
        </Button>
      {:else}
        <Button id="fileBtn" size="xs" color="alternative" onclick={pickFile}>
          <FolderOpenOutline class="me-1.5 h-4 w-4" />Open graph JSON
        </Button>
      {/if}
      <Button
        id="themeBtn"
        size="xs"
        color="alternative"
        aria-label="Switch theme"
        onclick={() => setTheme(!app.dark)}
      >
        {#if app.dark}<SunOutline class="h-4 w-4" />{:else}<MoonOutline class="h-4 w-4" />{/if}
      </Button>
    </div>
  </header>

  <!-- The panes float over the drawing rather than dividing it, so the canvas is the
       whole of the space under the bar and folding a pane uncovers the drawing instead
       of laying it out again. How much each side covers is said once, here, and
       everything that has to keep clear of it reads it back — see styles/shell.css. -->
  <div
    class="ex-shell relative min-h-0 flex-1"
    class:ex-sizing={app.sizing}
    style="--grip: {GRIP}px; --pane-l: {covers('index')}px; --pane-r: {covers('detail')}px"
  >
    <main class="absolute inset-0 flex flex-col"><Canvas /></main>

    <aside
      id="exSide"
      class="{PANE} ex-pane ex-pane-left {app.shut.index ? 'ex-pane-shut' : ''}"
      aria-label="Index of groups and declarations"
    >
      <IndexPane />
    </aside>
    {#if !app.shut.index}<Grip which="index" />{/if}

    <aside
      class="{PANE} ex-pane ex-pane-right {app.shut.detail ? 'ex-pane-shut' : ''}"
      aria-label="The selected node"
    >
      {#if app.base}<DetailPane />{/if}
    </aside>
    {#if !app.shut.detail}<Grip which="detail" />{/if}
  </div>
</div>
