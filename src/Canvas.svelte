<!-- The viewport. The drawing inside it is not a component: see lib/canvas.js. -->
<script>
  import { onMount } from "svelte";
  import { Button, Card, Alert, Textarea } from "flowbite-svelte";
  import { createCanvas } from "./lib/canvas.js";
  import {
    app, attachCanvas, collapseToModules, drawAnyway, readText, select, setCone, toggleGroup,
  } from "./lib/state.svelte.js";
  import { fmt } from "./lib/util.js";

  let { api = $bindable(null) } = $props();
  let svg, viewport;
  let fileInput = $state(null);
  let pasteOpen = $state(false), pasteText = $state("");

  onMount(() => {
    const c = createCanvas({
      svg, viewport,
      on: {
        select: (ref) => select(ref),
        toggle: (gi) => toggleGroup(gi),
        cone: (ref) => setCone(ref),
        status: (s) => { app.status = s; },
        zoom: (k) => { app.zoom = k; },
        tip: (t) => {
          if (!t) { app.tip = null; return; }
          const w = 340, h = 24 + t.rows.length * 18;
          app.tip = {
            rows: t.rows,
            left: Math.max(8, t.x + 16 + w > innerWidth - 8 ? t.x - w - 16 : t.x + 16),
            top: Math.max(8, t.y + 16 + h > innerHeight - 8 ? t.y - h - 16 : t.y + 16),
          };
        },
      },
    });
    api = c;
    attachCanvas(c);
    return () => c.destroy();
  });
</script>

<!-- The role sits on the viewport, not on the <svg>: the viewport is what takes focus and
     handles the keys, and the drawing inside it is redrawn wholesale. An application must
     be focusable to be operable, which is the whole point of the role. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="ex-viewport" id="exViewport" tabindex="0" bind:this={viewport}
  role="application"
  aria-label="Dependency graph. Drag to pan, scroll to zoom, arrow keys to move between nodes, Enter to open one."
>
  <svg id="exSvg" bind:this={svg}></svg>

  {#if app.tooBig}
    <div id="exBig" class="absolute inset-0 flex items-center justify-center p-6">
      <Card class="max-w-lg p-5">
        <div class="font-mono text-2xl text-gray-950 dark:text-white">{fmt(app.tooBig.boxes)} boxes</div>
        <p class="mt-2 text-xs text-gray-700 dark:text-gray-300">That is a lot to draw at once, and it will be
          a hairball rather than a diagram. Opening one group at a time, or picking a
          declaration and switching to Neighbourhood, usually answers the question faster.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button size="xs" color="alternative" onclick={drawAnyway}>Draw it anyway</Button>
          <Button size="xs" onclick={collapseToModules}>Open to modules instead</Button>
        </div>
      </Card>
    </div>
  {:else if !app.base}
    <div id="exEmpty" class="absolute inset-0 flex items-center justify-center overflow-y-auto p-6">
      <Card class="max-w-xl p-5">
        <h2 class="text-lg text-gray-700 dark:text-gray-300">tracker <b class="text-gray-950 dark:text-white">graph explorer</b></h2>
        <p class="mt-2 text-xs text-gray-700 dark:text-gray-300">Drop the JSON from
          <code class="rounded bg-gray-100 dark:bg-gray-800 px-1 font-mono">tracker graph</code> anywhere on
          this page, or open it, and this draws the project's dependency graph — starting at its
          areas, and opening a group at a time down to the individual declaration. Nothing is
          uploaded; the file never leaves the browser.</p>
        <p class="mt-2 text-[11px] text-gray-500">
          <code class="rounded bg-gray-100 dark:bg-gray-800 px-1 font-mono"
            >lake build &amp;&amp; lake exe tracker graph &gt; graph.json</code>, then open it here;
          or publish this page beside one and load it with
          <code class="rounded bg-gray-100 dark:bg-gray-800 px-1 font-mono">index.html?graph=graph.json</code>.</p>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button id="emptyOpen" size="xs" onclick={() => fileInput.click()}>Open graph JSON</Button>
          <Button id="pasteBtn" size="xs" color="alternative" aria-pressed={pasteOpen}
            onclick={() => (pasteOpen = !pasteOpen)}>Paste it instead</Button>
        </div>

        {#if pasteOpen}
          <Textarea id="pasteArea" class="mt-3 font-mono !text-[11px]" rows={6} spellcheck="false"
            bind:value={pasteText} placeholder="Paste the contents of graph.json here" />
          <Button id="pasteGo" size="xs" class="mt-2"
            onclick={() => readText(pasteText.trim(), "pasted JSON")}>Use this JSON</Button>
        {/if}

        {#if app.error}
          <Alert id="srcErr" color="red" class="mt-3 !text-xs">{app.error}</Alert>
        {/if}

        <input type="file" accept=".json,application/json" hidden
          bind:this={fileInput}
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) f.text().then((t) => readText(t, f.name));
            e.currentTarget.value = "";
          }} />
      </Card>
    </div>
  {/if}
</div>
