<!-- The viewport. The drawing inside it is not a component: see lib/canvas.js. -->
<script>
  import { onMount } from "svelte";
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
    <div class="ex-over" id="exBig">
      <div class="big-n">{fmt(app.tooBig.boxes)} boxes</div>
      <p>That is a lot to draw at once, and it will be a hairball rather than a diagram.
        Opening one group at a time, or picking a declaration and switching to
        Neighbourhood, usually answers the question faster.</p>
      <div class="row">
        <button onclick={drawAnyway}>Draw it anyway</button>
        <button onclick={collapseToModules}>Open to modules instead</button>
      </div>
    </div>
  {:else if !app.base}
    <div class="ex-over" id="exEmpty">
      <h2>tracker <b>graph explorer</b></h2>
      <p>Drop the JSON from <code>tracker graph</code> anywhere on this page, or open it, and
        this draws the project's dependency graph — starting at its areas, and opening a group
        at a time down to the individual declaration. Nothing is uploaded; the file never
        leaves the browser.</p>
      <p class="muted"><code>lake build &amp;&amp; lake exe tracker graph &gt; graph.json</code>, then
        open it here; or publish this page beside one and load it with
        <code>index.html?graph=graph.json</code>.</p>
      <div class="row">
        <button id="emptyOpen" onclick={() => fileInput.click()}>Open graph JSON</button>
        <button id="pasteBtn" aria-pressed={pasteOpen}
          onclick={() => (pasteOpen = !pasteOpen)}>Paste it instead</button>
      </div>
      {#if pasteOpen}
        <div class="row">
          <textarea id="pasteArea" spellcheck="false" bind:value={pasteText}
            placeholder="Paste the contents of graph.json here"></textarea>
        </div>
        <div class="row">
          <button id="pasteGo" onclick={() => readText(pasteText.trim(), "pasted JSON")}>Use this JSON</button>
        </div>
      {/if}
      {#if app.error}<div class="err" id="srcErr">{app.error}</div>{/if}
      <input type="file" accept=".json,application/json" hidden
        bind:this={fileInput}
        onchange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) f.text().then((t) => readText(t, f.name));
          e.currentTarget.value = "";
        }} />
    </div>
  {/if}
</div>
