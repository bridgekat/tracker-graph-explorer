<!-- The window: a bar, three panes and a status strip. Everything that decides what is
     drawn lives in state.svelte.js; the canvas is handed a scene and left to draw it. -->
<script>
  import IndexPane from "./IndexPane.svelte";
  import DetailPane from "./DetailPane.svelte";
  import Canvas from "./Canvas.svelte";
  import Grip from "./Grip.svelte";
  import {
    app, readText, openAllGroups, openEverything,
    openToLevel, rebuild, repaintTheme, setColour, setEdges, setMode,
  } from "./lib/state.svelte.js";
  import { STATE_LABEL, fmt, hueLine } from "./lib/util.js";
  import * as TD from "./lib/derive.js";

  let sideW = $state(272), asideW = $state(352);
  let sideOpen = $state(true), asideOpen = $state(true);
  let dragging = $state(false);
  let fileInput;
  let canvas = $state(null);

  const THEMES = ["system", "light", "dark"];
  let themeIdx = $state(0);
  function cycleTheme() {
    themeIdx = (themeIdx + 1) % THEMES.length;
    const t = THEMES[themeIdx];
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    repaintTheme();
  }

  function openTo(v) {
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
</script>

<svelte:window
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => { if (e.relatedTarget === null) dragging = false; }}
  ondrop={onDrop} />

<div class="app" class:dragging>
  <header class="bar">
    <span class="brand">tracker <b>graph</b></span>
    <div class="src-now">
      <span class="src-name" id="srcName">{app.src || "no graph loaded"}</span>
      <span class="src-sub" id="srcSub">{app.srcSub}</span>
    </div>
    <div class="right">
      <button id="fileBtn" onclick={() => fileInput.click()}>Open graph JSON</button>
      <button id="themeBtn" onclick={cycleTheme}>Theme: {THEMES[themeIdx]}</button>
    </div>
    <input type="file" id="fileInput" accept=".json,application/json" hidden
      bind:this={fileInput} onchange={onFile} />
  </header>

  <div class="panes">
    <aside class="ex-side" id="exSide" class:collapsed={!sideOpen}
      style="width: {sideOpen ? sideW + 'px' : ''}" aria-label="Index of groups and declarations">
      <div class="ex-pane-h">
        <span class="ex-pane-t">Index</span>
        <button class="ex-icon" id="exSideBtn" aria-expanded={sideOpen}
          title="Collapse the index" onclick={() => (sideOpen = !sideOpen)}>‹</button>
      </div>
      {#if sideOpen}<IndexPane />{/if}
    </aside>

    <Grip id="gripL" hidden={!sideOpen} label="Resize the index pane"
      width={sideW} dir={1} onresize={(w) => (sideW = w)} />

    <main class="stage">
      <div class="stage-bar">
        <span class="flab">Open to</span>
        <div class="fopts" role="group" aria-label="How far to open the tree">
          <button data-exlevel="areas" onclick={() => openTo("areas")}>Areas</button>
          <button data-exlevel="sub" onclick={() => openTo("sub")}>Sub-areas</button>
          <button data-exlevel="modules" onclick={() => openTo("modules")}>Modules</button>
          <button data-exlevel="all" onclick={() => openTo("all")}>Declarations</button>
        </div>
        <span class="gap"></span>
        <div class="fopts" role="group" aria-label="What the graph shows">
          <button data-exmode="tree" aria-pressed={app.mode === "tree"}
            onclick={() => setMode("tree")}>Whole graph</button>
          <button data-exmode="cone" aria-pressed={app.mode === "cone"}
            onclick={() => setMode("cone")}>Neighbourhood</button>
        </div>
        {#if app.mode === "cone"}
          <span class="ex-cone" id="exConeCtl">
            <select id="exConeDir" aria-label="Which way the neighbourhood runs"
              bind:value={app.coneDir} onchange={() => rebuild()}>
              <option value="both">both ways</option>
              <option value="down">what it rests on</option>
              <option value="up">what rests on it</option>
            </select>
            <select id="exConeR" aria-label="How far the neighbourhood reaches"
              bind:value={app.coneRadius} onchange={() => rebuild()}>
              <option value={1}>1 step</option>
              <option value={2}>2 steps</option>
              <option value={3}>3 steps</option>
              <option value={-1}>the whole cone</option>
            </select>
          </span>
        {/if}
        <span class="gap"></span>
        <div class="fopts" role="group" aria-label="Colour dimension">
          {#each [["area", "Area"], ["progress", "Progress"], ["kind", "Kind"]] as [v, label]}
            <button data-excolour={v} aria-pressed={app.colour === v}
              onclick={() => setColour(v)}>{label}</button>
          {/each}
        </div>
        <span class="gap"></span>
        <div class="fopts" role="group" aria-label="Which edges to draw">
          {#each [["red", "Essential"], ["all", "All"]] as [v, label]}
            <button data-exedges={v} aria-pressed={app.edges === v}
              onclick={() => setEdges(v)}>{label}</button>
          {/each}
        </div>
        <div class="ex-zoom" role="group" aria-label="Zoom">
          <button id="exZoomOut" aria-label="Zoom out" onclick={() => canvas?.zoomBy(1 / 1.3)}>−</button>
          <span id="exZoomLab">{Math.round(app.zoom * 100)}%</span>
          <button id="exZoomIn" aria-label="Zoom in" onclick={() => canvas?.zoomBy(1.3)}>+</button>
          <button id="exFit" onclick={() => canvas?.fit()}>Fit</button>
        </div>
      </div>

      <Canvas bind:api={canvas} />

      <div class="ex-foot">
        <div class="ex-status" id="exStatus">
          {#if app.status?.warn}
            <span class="warn">{app.status.warn}</span>
          {:else if statusNode}
            <b class="nm">{statusNode.kind === "group" ? statusNode.short : statusNode.name}</b>
            <span class="st"><b>{fmt(app.status.below)}</b> it rests on</span>
            <span class="st"><b>{fmt(app.status.above)}</b> rest on it</span>
            {#if statusNode.kind === "group"}
              <span class="st"><b>{fmt(statusNode.count)}</b> results inside</span>
            {/if}
          {:else}
            <span class="muted">
              {app.mode === "cone"
                ? "The neighbourhood of one declaration. Double-click another to move it there."
                : "Click a box to read it and to light what it touches. ＋ opens it."}
            </span>
          {/if}
        </div>
        <div class="legend" id="exLegend">
          {#each legend as item}
            {#if item.muted}
              <span class="lg muted">{item.muted}</span>
            {:else}
              <span class="lg" class:fam={item.family}>
                <i class="sw" style="background: {item.colour}"></i>
                {#if item.family}<b>{item.label}</b>{:else}{item.label}{/if}
              </span>
            {/if}
          {/each}
          <span class="lg muted">left to right — a box sits after what it rests on</span>
        </div>
        <div class="ex-stats" id="exStats">{app.stats}</div>
      </div>
    </main>

    <Grip id="gripR" hidden={!asideOpen} label="Resize the detail pane"
      width={asideW} dir={-1} onresize={(w) => (asideW = w)} />

    <aside class="ex-aside" id="exAside" class:collapsed={!asideOpen}
      style="width: {asideOpen ? asideW + 'px' : ''}" aria-label="The selected node">
      <div class="ex-pane-h">
        <button class="ex-icon" id="exDetailBtn" aria-expanded={asideOpen}
          title="Collapse the detail" onclick={() => (asideOpen = !asideOpen)}>›</button>
        <span class="ex-pane-t">Detail</span>
      </div>
      {#if asideOpen && app.base}<DetailPane />{/if}
    </aside>
  </div>
</div>

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
